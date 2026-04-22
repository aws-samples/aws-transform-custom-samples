"""
CreateTransform Sub-Agent

Creates custom transformation definitions by:
1. Cloning repo to S3 via Batch job
2. AI-driven file selection: list files → pick relevant ones → read them
3. Generating transformation_definition.md using Bedrock with full source context
4. Publishing to ATX registry via Batch job
"""

import os
import json
import time
import logging
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


@tool
def upload_repo_to_s3(source_url: str, name: str) -> Dict[str, Any]:
    """
    Submit a Batch job to clone a repository and upload all source files to S3.
    Files are uploaded to s3://{bucket}/repo-snapshots/{name}/ for AI-driven browsing.

    Args:
        source_url: Git repository URL (e.g., 'https://github.com/user/repo')
        name: Transformation name (used as S3 prefix)

    Returns:
        Dictionary with job ID and S3 prefix
    """
    bucket = _get_source_bucket()
    s3_prefix = f"repo-snapshots/{name}"
    job_name = f"upload-repo-{name}-{int(time.time())}"
    job_queue = os.environ.get('JOB_QUEUE_NAME', 'atx-job-queue')
    job_definition = os.environ.get('JOB_DEFINITION_NAME', 'atx-transform-job')

    # Clone repo and sync all source files to S3 (exclude .git)
    cmd = (
        f"git clone {source_url} /source/repo && "
        f"cd /source/repo && "
        f"aws s3 sync . s3://{bucket}/{s3_prefix}/ --exclude '.git/*'"
    )

    try:
        response = batch_client.submit_job(
            jobName=job_name, jobQueue=job_queue, jobDefinition=job_definition,
            containerOverrides={'command': ['--command', cmd]}
        )
        job_id = response['jobId']

        logger.info(f"Waiting for repo upload job {job_id}...")
        for _ in range(60):  # Max 5 minutes
            time.sleep(5)
            status = batch_client.describe_jobs(jobs=[job_id])
            if not status['jobs']:
                break
            job_status = status['jobs'][0]['status']
            if job_status == 'SUCCEEDED':
                return {
                    "status": "success",
                    "s3_prefix": f"s3://{bucket}/{s3_prefix}/",
                    "message": f"Repository uploaded to S3. Use list_repo_files and read_repo_file to browse.",
                }
            if job_status == 'FAILED':
                reason = status['jobs'][0].get('statusReason', 'Unknown')
                return {"status": "error", "error": f"Upload job failed: {reason}"}

        return {"status": "error", "error": "Upload job timed out after 5 minutes"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def list_repo_files(name: str) -> Dict[str, Any]:
    """
    List all files in a repository snapshot uploaded to S3.

    Args:
        name: Transformation name (matches the S3 prefix from upload_repo_to_s3)

    Returns:
        Dictionary with list of file paths and sizes
    """
    bucket = _get_source_bucket()
    prefix = f"repo-snapshots/{name}/"
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        files = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get('Contents', []):
                rel_path = obj['Key'][len(prefix):]
                if rel_path and not rel_path.startswith('.git/'):
                    files.append({'path': rel_path, 'size': obj['Size']})
        return {
            "status": "success",
            "file_count": len(files),
            "files": files,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def read_repo_file(name: str, file_path: str) -> Dict[str, Any]:
    """
    Read the content of a specific file from the repository snapshot in S3.

    Args:
        name: Transformation name (matches the S3 prefix)
        file_path: Relative file path within the repo (e.g., 'src/app.py')

    Returns:
        Dictionary with file content (truncated to 50KB for context window safety)
    """
    bucket = _get_source_bucket()
    key = f"repo-snapshots/{name}/{file_path}"
    try:
        obj = s3_client.get_object(Bucket=bucket, Key=key)
        content = obj['Body'].read().decode('utf-8', errors='replace')
        truncated = False
        if len(content) > 50000:
            content = content[:50000]
            truncated = True
        return {
            "status": "success",
            "path": file_path,
            "content": content,
            "size": obj['ContentLength'],
            "truncated": truncated,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def generate_transformation_definition(name: str, description: str, requirements: str,
                                        source_context: str = "") -> Dict[str, Any]:
    """
    Generate a transformation_definition.md file using Bedrock AI and upload to S3.

    Args:
        name: Name for the transformation (e.g., 'add-structured-logging')
        description: Short description of what the transformation does
        requirements: Detailed requirements for the transformation
        source_context: Source code context (file contents read from the repo)

    Returns:
        Dictionary with the generated definition and S3 location
    """
    bucket = _get_source_bucket()

    prompt = f"""Create a transformation_definition.md file for AWS Transform custom.

Name: {name}
Description: {description}
Requirements: {requirements}
"""
    if source_context:
        prompt += f"""
The following is the actual source code from the target repository.
Use this to make the transformation definition specific and accurate for this codebase.
Reference actual file names, function names, class names, and patterns you see.

{source_context}
"""

    prompt += """
The file should contain clear, detailed instructions that an AI agent will follow to transform code.
Include:
- What changes to make (be specific based on the actual code patterns found)
- Specific files and functions to modify
- Patterns to look for in the source code
- How to validate the changes
- Edge cases to handle

Output ONLY the markdown content, no code fences."""

    try:
        response = bedrock_runtime.invoke_model(
            modelId=os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0"),
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 8192,
                "temperature": 0.3,
                "messages": [{"role": "user", "content": prompt}]
            })
        )
        body = json.loads(response['body'].read())
        definition_md = body['content'][0]['text'].strip()

        s3_key = f"custom-definitions/{name}/transformation_definition.md"
        s3_client.put_object(
            Bucket=bucket, Key=s3_key,
            Body=definition_md.encode('utf-8'),
            ContentType='text/markdown'
        )

        return {
            "status": "success",
            "name": name,
            "s3_uri": f"s3://{bucket}/{s3_key}",
            "source_analyzed": bool(source_context),
            "definition_preview": definition_md[:500] + "..." if len(definition_md) > 500 else definition_md,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def publish_transformation(name: str, description: str) -> Dict[str, Any]:
    """
    Publish a transformation definition to the ATX registry by submitting a Batch job.

    Args:
        name: Name of the transformation to publish
        description: Description for the registry

    Returns:
        Dictionary with the Batch job ID for the publish operation
    """
    bucket = _get_source_bucket()
    s3_key = f"custom-definitions/{name}/transformation_definition.md"

    try:
        s3_client.head_object(Bucket=bucket, Key=s3_key)
    except Exception:
        return {"status": "error", "error": f"Definition not found: s3://{bucket}/{s3_key}. Generate it first."}

    job_name = f"publish-{name}-{int(time.time())}"
    job_queue = os.environ.get('JOB_QUEUE_NAME', 'atx-job-queue')
    job_definition = os.environ.get('JOB_DEFINITION_NAME', 'atx-transform-job')

    cmd = (
        f"mkdir -p /tmp/{name} && "
        f"aws s3 cp s3://{bucket}/custom-definitions/{name}/transformation_definition.md /tmp/{name}/transformation_definition.md && "
        f"atx custom def publish -n {name} --description '{description}' --sd /tmp/{name}"
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
    When a source repository is provided, uses AI-driven file selection to read
    relevant source files and generate a definition tailored to the actual codebase.

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
            modelId=os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0"),
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

        results = []
        source_context = ""

        # Step 2: Upload repo to S3 if source URL provided
        if source_url:
            logger.info(f"Uploading repo to S3: {source_url}")
            upload_result = upload_repo_to_s3(source_url=source_url, name=name)
            results.append(f"Repo upload: {upload_result.get('status')}")

            if upload_result.get('status') == 'success':
                # Step 3: List files
                file_list = list_repo_files(name=name)
                if file_list.get('status') == 'success':
                    files = file_list['files']
                    results.append(f"Files found: {file_list['file_count']}")

                    max_context = 400000  # ~100K tokens
                    # Filter to source code files only (skip binaries, images, etc.)
                    SOURCE_EXTS = {'.py', '.java', '.js', '.ts', '.jsx', '.tsx', '.go', '.rb', '.rs',
                                   '.c', '.cpp', '.h', '.cs', '.kt', '.scala', '.swift',
                                   '.json', '.yaml', '.yml', '.toml', '.xml', '.properties',
                                   '.md', '.txt', '.html', '.css', '.scss', '.sql',
                                   '.gradle', '.cfg', '.ini', '.env', '.sh', '.bat'}
                    source_files = [f for f in files if any(f['path'].endswith(ext) for ext in SOURCE_EXTS)
                                    or '.' not in f['path'].split('/')[-1]  # files without extension (Makefile, Dockerfile, etc.)
                                    or f['path'].split('/')[-1] in ('Makefile', 'Dockerfile', 'Gemfile', 'Rakefile')]
                    total_source_size = sum(f['size'] for f in source_files)

                    if total_source_size <= max_context:
                        # Small repo: read ALL source files, skip AI selection
                        results.append(f"Small repo ({total_source_size} chars) — reading all {len(source_files)} source files")
                        selected_files = [f['path'] for f in source_files]
                    else:
                        # Large repo: AI selects files, budget-aware
                        avg_file_size = total_source_size // max(len(source_files), 1)
                        max_files = max(10, min(30, max_context // max(avg_file_size, 1)))
                        results.append(f"Large repo ({total_source_size} chars) — AI selecting up to {max_files} files")

                        file_paths = [f['path'] for f in source_files]
                        select_prompt = f"""Given these files in a repository and the transformation requirements below,
select the most relevant files to read (max {max_files} files). Prioritize:
1. Main source files related to the transformation requirements
2. Configuration/dependency files (requirements.txt, package.json, pom.xml)
3. README or documentation files
4. Test files if relevant

Return ONLY a JSON array of file paths.

Requirements: {requirements}

Files:
{json.dumps(file_paths, indent=2)}"""

                        select_response = bedrock_runtime.invoke_model(
                            modelId=os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0"),
                            body=json.dumps({
                                "anthropic_version": "bedrock-2023-05-31",
                                "max_tokens": 4096, "temperature": 0.1,
                                "messages": [{"role": "user", "content": select_prompt}]
                            })
                        )
                        select_text = json.loads(select_response['body'].read())['content'][0]['text'].strip()
                        if '```' in select_text:
                            select_text = select_text.split('```')[1]
                            if select_text.startswith('json'): select_text = select_text[4:]
                            select_text = select_text.strip()
                        selected_files = json.loads(select_text)
                        results.append(f"AI selected {len(selected_files)} files")

                    # Step 4: Read selected files
                    context_parts = []
                    total_chars = 0
                    for fp in selected_files:
                        if total_chars >= max_context:
                            break
                        file_data = read_repo_file(name=name, file_path=fp)
                        if file_data.get('status') == 'success':
                            content = file_data['content']
                            context_parts.append(f"=== {fp} ===\n{content}")
                            total_chars += len(content)

                    source_context = "\n\n".join(context_parts)
                    results.append(f"Read {len(context_parts)} files ({total_chars} chars)")

        # Step 5: Generate definition
        logger.info(f"Generating definition for: {name}")
        gen_result = generate_transformation_definition(
            name=name, description=description,
            requirements=requirements, source_context=source_context
        )
        if gen_result.get('status') == 'error':
            return gen_result
        results.append(f"Definition generated: {gen_result.get('s3_uri')}")

        # Check if this is a generate-only request (preview mode)
        generate_only = 'do not publish' in query.lower() or 'don\'t publish' in query.lower()

        if generate_only:
            return {
                "status": "success",
                "result": f"Custom transformation '{name}' definition generated (preview mode, not published).\n" +
                          f"Definition location: {gen_result.get('s3_uri')}\n" +
                          f"Source analyzed: {bool(source_context)}\n" +
                          f"Definition preview: {gen_result.get('definition_preview', '')}\n\n" +
                          "\n".join(results),
            }

        # Step 6: Publish
        logger.info(f"Publishing: {name}")
        pub_result = publish_transformation(name=name, description=description)
        if pub_result.get('status') == 'error':
            return pub_result
        results.append(f"Publish job: {pub_result.get('job_id')}")

        return {
            "status": "success",
            "result": f"Custom transformation '{name}' created and publish job submitted.\n" +
                      f"Publish job ID: {pub_result.get('job_id')}\n" +
                      f"Source analyzed: {bool(source_context)}\n" +
                      f"Definition preview: {gen_result.get('definition_preview', '')}\n\n" +
                      "\n".join(results),
        }

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse response: {e}")
        return {"status": "error", "error": f"Failed to parse parameters: {e}"}
    except Exception as e:
        logger.error(f"Create transform agent failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
