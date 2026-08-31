"""
CreateTransform Sub-Agent

Creates custom transformation definitions (skills) using the ATX CLI in
headless mode. A single Batch job:
1. Clones the source repository (optional)
2. Runs `atx -x "<prompt>" -t` so the ATX agent analyzes the code and writes
   the SKILL.md itself (no separate Bedrock generation pipeline)
3. Stages the SKILL.md in S3 (custom-definitions/<name>/SKILL.md) for the UI
4. Publishes to the ATX registry via `atx custom def publish` (unless the
   request is preview-only: "do not publish")
"""

import os
import json
import time
import logging
import re
import base64
import boto3
from typing import Any, Dict

from strands import Agent, tool
from strands.models import BedrockModel

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

region = os.getenv("AWS_REGION", "us-east-1")
bedrock_runtime = boto3.client('bedrock-runtime', region_name=region)
s3_client = boto3.client('s3', region_name=region)
batch_client = boto3.client('batch', region_name=region)

_account_id = None
def _get_account():
    global _account_id
    if not _account_id:
        _account_id = boto3.client('sts').get_caller_identity()['Account']
    return _account_id

def _get_source_bucket():
    return f"atx-source-code-{_get_account()}"


# SKILL.md name rules (from ATX CLI skill discovery): lowercase alphanumeric +
# single hyphens, 1-64 chars, no leading/trailing/consecutive hyphens. Must match
# the parent directory name. Normalize so `atx custom def publish` won't reject it.
def _normalize_skill_name(name: str) -> str:
    n = (name or "").strip().lower()
    n = re.sub(r'[^a-z0-9]+', '-', n)   # non-alphanumeric runs -> single hyphen
    n = re.sub(r'-{2,}', '-', n)         # collapse consecutive hyphens
    n = n.strip('-')                      # no leading/trailing hyphen
    if not n:
        n = "custom-transformation"
    return n[:64].rstrip('-')


# The Batch container entrypoint evals the --command string, so anything
# user-controlled is base64-encoded and decoded inside the job instead of
# being interpolated into the shell command directly.
def _b64(value: str) -> str:
    return base64.b64encode((value or "").encode('utf-8')).decode('ascii')


# Git/S3 URLs are interpolated into the job command, so reject anything with
# shell metacharacters.
_SOURCE_URL_RE = re.compile(r'^[A-Za-z0-9@.:/_~+-]+$')

def _validate_source_url(url: str) -> bool:
    return bool(url) and bool(_SOURCE_URL_RE.match(url)) and len(url) < 512


def _build_headless_prompt(name: str, description: str, requirements: str,
                           has_source: bool) -> str:
    """Prompt for `atx -x`: the ATX agent generates the SKILL.md itself."""
    if has_source:
        context_line = (
            "First analyze the source code in the current directory and tailor the "
            "instructions to the actual files, frameworks, and patterns you find. "
            "Reference real file names, function names, and code patterns."
        )
    else:
        context_line = (
            "No reference repository is available; base the instructions on the "
            "requirements alone."
        )

    return f"""You are creating an AWS Transform custom transformation definition (skill).

Skill name: {name}
Description: {description}

Requirements:
{requirements}

{context_line}

Write the completed skill to /tmp/skills/{name}/SKILL.md with:
- YAML frontmatter containing exactly two fields: `name: {name}` and a one-line `description`.
- A markdown body with clear, detailed step-by-step instructions that an AI agent will follow to transform a codebase: what changes to make, specific patterns to look for, how to validate the changes, and edge cases to handle.

Do not publish the skill. Do not modify any repository files. Your only output artifact is /tmp/skills/{name}/SKILL.md."""


def _submit_headless_create(name: str, description: str, requirements: str,
                            source_url: str, publish: bool) -> Dict[str, Any]:
    """
    Submit a single fire-and-forget Batch job that generates the SKILL.md with
    ATX headless mode, stages it in S3, and optionally publishes it.
    """
    bucket = _get_source_bucket()
    skill_name = _normalize_skill_name(name)
    description = (description or skill_name).strip()
    if len(description) > 1024:
        description = description[:1021] + '...'
    # Keep the submit_job payload well under the Batch 30 KiB limit.
    if len(requirements) > 8000:
        requirements = requirements[:8000] + '\n[truncated]'

    if source_url and not _validate_source_url(source_url):
        return {"status": "error", "error": f"Invalid source URL: {source_url}"}

    prompt = _build_headless_prompt(skill_name, description, requirements,
                                    has_source=bool(source_url))
    skill_dir = f"/tmp/skills/{skill_name}"
    s3_dest = f"s3://{bucket}/custom-definitions/{skill_name}/SKILL.md"

    steps = []
    if source_url:
        steps.append(f"git clone --depth 1 {source_url} /source/repo")
        steps.append("cd /source/repo")
    else:
        steps.append("mkdir -p /source/workdir")
        steps.append("cd /source/workdir")
        steps.append("git init -q")
    steps.append(f"mkdir -p {skill_dir}")
    # Decode user-controlled text inside the job (the entrypoint evals this string).
    steps.append(f"ATX_PROMPT=\"$(echo {_b64(prompt)} | base64 -d)\"")
    steps.append("atx -x \"$ATX_PROMPT\" -t")
    steps.append(f"test -f {skill_dir}/SKILL.md")
    steps.append(f"aws s3 cp {skill_dir}/SKILL.md {s3_dest}")
    if publish:
        steps.append(f"SKILL_DESC=\"$(echo {_b64(description)} | base64 -d)\"")
        steps.append(f"atx custom def publish -n {skill_name} --description \"$SKILL_DESC\" --sd {skill_dir}")
    cmd = " && ".join(steps)

    mode = "create-publish" if publish else "create-preview"
    job_name = f"{mode}-{skill_name}-{int(time.time())}"
    job_queue = os.environ.get('JOB_QUEUE_NAME', 'atx-job-queue')
    job_definition = os.environ.get('JOB_DEFINITION_NAME', 'atx-transform-job')

    try:
        response = batch_client.submit_job(
            jobName=job_name, jobQueue=job_queue, jobDefinition=job_definition,
            containerOverrides={'command': ['--command', cmd]}
        )
        job_id = response['jobId']

        # Status tracked by the UI (list_custom / check_publish ops).
        # 'generating' -> 'generated' for previews; 'publishing' -> 'published'
        # for auto-publish. Failures flip to 'failed'.
        status_data = {
            "status": "publishing" if publish else "generating",
            "job_id": job_id,
            "job_name": job_name,
            "name": skill_name,
            "description": description,
            "created_at": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }
        s3_client.put_object(
            Bucket=bucket, Key=f"custom-definitions/{skill_name}/status.json",
            Body=json.dumps(status_data).encode(), ContentType='application/json'
        )

        return {
            "status": "success",
            "job_id": job_id,
            "job_name": job_name,
            "name": skill_name,
            "definition_location": s3_dest,
            "publish": publish,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def publish_transformation(name: str, description: str) -> Dict[str, Any]:
    """
    Publish a previously generated transformation definition to the ATX registry
    by submitting a Batch job. Used by the review flow after the user approves
    a staged SKILL.md.

    Args:
        name: Name of the transformation to publish
        description: Description for the registry

    Returns:
        Dictionary with the Batch job ID for the publish operation
    """
    bucket = _get_source_bucket()
    skill_name = _normalize_skill_name(name)

    # Prefer the new SKILL.md format; fall back to the legacy transformation_definition.md
    # so previously-generated definitions can still be published.
    skill_key = f"custom-definitions/{skill_name}/SKILL.md"
    legacy_key = f"custom-definitions/{skill_name}/transformation_definition.md"
    staged_file = None
    for candidate in (skill_key, legacy_key):
        try:
            s3_client.head_object(Bucket=bucket, Key=candidate)
            staged_file = candidate
            break
        except Exception:
            continue
    if not staged_file:
        return {"status": "error",
                "error": f"Definition not found: s3://{bucket}/{skill_key} (or legacy transformation_definition.md). Generate it first."}

    name = skill_name
    description = (description or skill_name).strip()
    if len(description) > 1024:
        description = description[:1021] + '...'
    job_name = f"publish-{name}-{int(time.time())}"
    job_queue = os.environ.get('JOB_QUEUE_NAME', 'atx-job-queue')
    job_definition = os.environ.get('JOB_DEFINITION_NAME', 'atx-transform-job')

    filename = staged_file.split('/')[-1]
    cmd = (
        f"mkdir -p /tmp/{name} && "
        f"aws s3 cp s3://{bucket}/{staged_file} /tmp/{name}/{filename} && "
        f"SKILL_DESC=\"$(echo {_b64(description)} | base64 -d)\" && "
        f"atx custom def publish -n {name} --description \"$SKILL_DESC\" --sd /tmp/{name}"
    )

    try:
        response = batch_client.submit_job(
            jobName=job_name, jobQueue=job_queue, jobDefinition=job_definition,
            containerOverrides={'command': ['--command', cmd]}
        )

        status_data = {
            "status": "publishing",
            "job_id": response['jobId'],
            "job_name": job_name,
            "name": name,
            "description": description,
            "created_at": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }
        s3_client.put_object(
            Bucket=bucket, Key=f"custom-definitions/{name}/status.json",
            Body=json.dumps(status_data).encode(), ContentType='application/json'
        )

        return {
            "status": "success",
            "action": "publish",
            "job_id": response['jobId'],
            "transformation_name": name,
            "message": f"Publish job submitted. '{name}' will be available once complete.",
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def list_registry_transformations() -> Dict[str, Any]:
    """Submit a Batch job to list all transformations in the ATX registry."""
    job_name = f"list-transforms-{int(time.time())}"
    job_queue = os.environ.get('JOB_QUEUE_NAME', 'atx-job-queue')
    job_definition = os.environ.get('JOB_DEFINITION_NAME', 'atx-transform-job')
    try:
        response = batch_client.submit_job(
            jobName=job_name, jobQueue=job_queue, jobDefinition=job_definition,
            containerOverrides={'command': ['--command', 'atx custom def list --json']}
        )
        return {"status": "success", "job_id": response['jobId'], "message": "List job submitted."}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def create_transform_agent(query: str) -> Dict[str, Any]:
    """
    Creates and publishes custom transformation definitions to the ATX registry.
    Submits a Batch job that runs the ATX CLI in headless mode: the ATX agent
    clones the source repository (when provided), analyzes the code, generates
    the SKILL.md, and publishes it (unless the request says not to publish).

    Args:
        query: Natural language request describing the custom transformation to create.

    Returns:
        Dictionary with results
    """
    logger.info("CREATE TRANSFORM AGENT INVOKED")

    try:
        # Step 1: Extract parameters from natural language
        extract_prompt = f"""Extract the following from this request. Return ONLY valid JSON, no other text.

Request: {query}

Return JSON with these fields:
- "action": one of "create", "publish", "list" (default: "create")
- "name": transformation name (lowercase, hyphenated, e.g., "add-logging")
- "description": short description
- "requirements": detailed requirements
- "source_url": repository URL if mentioned, or empty string

Example: {{"action": "create", "name": "add-logging", "description": "Add logging", "requirements": "Add structured logging to all functions", "source_url": "https://github.com/user/repo"}}"""

        response = bedrock_runtime.invoke_model(
            modelId=os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2048, "temperature": 0.1,
                "messages": [{"role": "user", "content": extract_prompt}]
            })
        )
        raw_text = json.loads(response['body'].read())['content'][0]['text'].strip()
        if '```' in raw_text:
            raw_text = raw_text.split('```')[1]
            if raw_text.startswith('json'): raw_text = raw_text[4:]
            raw_text = raw_text.strip()
        params = json.loads(raw_text)

        action = params.get('action', 'create')
        name = params.get('name', '')
        description = params.get('description', name)
        requirements = params.get('requirements', '')
        source_url = params.get('source_url', '')

        if action == 'list':
            return list_registry_transformations()
        if action == 'publish' and name:
            return publish_transformation(name, description)
        if not name or not requirements:
            return {"status": "error", "error": "Could not extract transformation name and requirements."}

        # Preview mode: generate and stage the SKILL.md without publishing
        # (contract with the UI's "Generate & Review" button).
        generate_only = 'do not publish' in query.lower() or 'don\'t publish' in query.lower()

        result = _submit_headless_create(
            name=name, description=description, requirements=requirements,
            source_url=source_url, publish=not generate_only
        )
        if result.get('status') == 'error':
            return result

        skill_name = result['name']
        if generate_only:
            return {
                "status": "success",
                "result": f"Custom transformation '{skill_name}' generation started (preview mode, will not be published).\n"
                          f"Batch job ID: {result['job_id']}\n"
                          f"The ATX CLI is analyzing the repository and generating the definition in headless mode.\n"
                          f"Definition will be staged at: {result['definition_location']}\n"
                          f"Once the job succeeds, review the definition and publish it from the UI.",
            }

        return {
            "status": "success",
            "result": f"Custom transformation '{skill_name}' creation started.\n"
                      f"Batch job ID: {result['job_id']}\n"
                      f"The ATX CLI is analyzing the repository, generating the definition in headless mode, "
                      f"and publishing it to the ATX registry in a single job.\n"
                      f"Definition will be staged at: {result['definition_location']}\n"
                      f"'{skill_name}' will be available for execution once the job completes.",
        }

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse response: {e}")
        return {"status": "error", "error": f"Failed to parse parameters: {e}"}
    except Exception as e:
        logger.error(f"Create transform agent failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
