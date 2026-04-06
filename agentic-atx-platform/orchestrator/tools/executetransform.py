"""
ExecuteTransform Sub-Agent

Executes transformations on source repositories via AWS Batch,
monitors job progress, and retrieves results. No Lambda dependency.
"""

import os
import time
import json
import logging
import boto3
from typing import Any, Dict
from datetime import datetime

from strands import Agent, tool

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

region = os.getenv("AWS_REGION", "us-east-1")
batch_client = boto3.client('batch', region_name=region)
s3_client = boto3.client('s3', region_name=region)


def _get_output_bucket() -> str:
    account = boto3.client('sts').get_caller_identity()['Account']
    return f"atx-custom-output-{account}"


def _extract_repo_name(source: str) -> str:
    if not source:
        return 'unknown'
    try:
        from urllib.parse import urlparse
        parsed = urlparse(source)
        if parsed.hostname and (parsed.hostname == 'github.com' or parsed.hostname.endswith('.github.com')):
            return parsed.path.rstrip('/').rstrip('.git').split('/')[-1] or 'unknown'
    except Exception:
        pass
    if source.startswith('s3://'):
        return source.split('/')[-1].replace('.zip', '').replace('.tar.gz', '')
    return 'unknown'


@tool
def execute_transformation(transformation: str, source: str, configuration: str = "") -> Dict[str, Any]:
    """
    Execute a transformation on a source code repository.

    Args:
        transformation: Transformation name (e.g., 'AWS/python-version-upgrade')
        source: Source code URL (GitHub URL or S3 path)
        configuration: Optional comma-separated config (e.g., 'validationCommands=pytest,additionalPlanContext=Target Python 3.13')

    Returns:
        Dictionary with job ID and submission details
    """
    config = {}
    if configuration:
        for pair in configuration.split(","):
            if "=" in pair:
                k, v = pair.split("=", 1)
                config[k.strip()] = v.strip()

    repo_name = _extract_repo_name(source)
    job_name = f"{repo_name}-{transformation.split('/')[-1]}-{int(time.time())}"

    # Validate transformation name - strip incorrect AWS/ prefix for custom transforms
    AWS_MANAGED = [
        'AWS/python-version-upgrade', 'AWS/java-version-upgrade', 'AWS/nodejs-version-upgrade',
        'AWS/python-boto2-to-boto3', 'AWS/java-aws-sdk-v1-to-v2', 'AWS/nodejs-aws-sdk-v2-to-v3',
        'AWS/early-access-comprehensive-codebase-analysis', 'AWS/early-access-java-x86-to-graviton',
        'AWS/early-access-angular-to-react-migration', 'AWS/early-access-jfr-performance-optimization',
    ]
    if transformation.startswith('AWS/') and transformation not in AWS_MANAGED:
        transformation = transformation.replace('AWS/', '', 1)

    cmd = f"atx custom def exec -n {transformation} -p /source/repo"
    if config:
        # Ensure version upgrades have additionalPlanContext
        if 'version-upgrade' in transformation and 'additionalPlanContext' not in config:
            version_map = {
                'python-version-upgrade': 'The target Python version to upgrade to is Python 3.13. Python 3.13 is already installed at /usr/bin/python3.13',
                'java-version-upgrade': 'The target Java version to upgrade to is Java 21. Java 21 is already installed at /usr/lib/jvm/java-21-amazon-corretto',
                'nodejs-version-upgrade': 'The target nodejs version to upgrade to is 22. Node.js 22 is already installed at /home/atxuser/.nvm/versions/node/v22.12.0/bin/node',
            }
            for key, default_ctx in version_map.items():
                if key in transformation:
                    config['additionalPlanContext'] = default_ctx
                    break
        config_str = ','.join(f"{k}={v}" for k, v in config.items())
        cmd += f" --configuration '{config_str}'"
    elif 'version-upgrade' in transformation:
        # Version upgrades REQUIRE additionalPlanContext in non-interactive mode
        version_map = {
            'python-version-upgrade': 'The target Python version to upgrade to is Python 3.13. Python 3.13 is already installed at /usr/bin/python3.13',
            'java-version-upgrade': 'The target Java version to upgrade to is Java 21. Java 21 is already installed at /usr/lib/jvm/java-21-amazon-corretto',
            'nodejs-version-upgrade': 'The target nodejs version to upgrade to is 22. Node.js 22 is already installed at /home/atxuser/.nvm/versions/node/v22.12.0/bin/node',
        }
        for key, default_ctx in version_map.items():
            if key in transformation:
                cmd += f" --configuration 'additionalPlanContext={default_ctx}'"
                break
    cmd += " -x -t"

    job_queue = os.environ.get('JOB_QUEUE_NAME', 'atx-job-queue')
    job_definition = os.environ.get('JOB_DEFINITION_NAME', 'atx-transform-job')

    container_overrides = {'command': ['--source', source, '--output', f'transformations/{job_name}/', '--command', cmd]} if source else {'command': ['--command', cmd]}

    try:
        response = batch_client.submit_job(jobName=job_name, jobQueue=job_queue, jobDefinition=job_definition, containerOverrides=container_overrides)
        return {
            "status": "success", "action": "execute",
            "job_id": response['jobId'], "job_name": job_name,
            "transformation": transformation, "source": source,
            "command": cmd, "submitted_at": datetime.utcnow().isoformat() + 'Z',
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def get_job_status(job_id: str) -> Dict[str, Any]:
    """
    Check the status of a transformation job.

    Args:
        job_id: The job ID returned from execute_transformation

    Returns:
        Dictionary with job status, timestamps, and log stream info
    """
    try:
        response = batch_client.describe_jobs(jobs=[job_id])
        if not response['jobs']:
            return {"status": "error", "error": f"Job not found: {job_id}"}
        job = response['jobs'][0]
        result = {
            "status": "success", "action": "status",
            "job_id": job_id, "job_name": job['jobName'],
            "job_status": job['status'],
            "created_at": job.get('createdAt'),
            "started_at": job.get('startedAt'),
            "stopped_at": job.get('stoppedAt'),
            "log_stream": job.get('container', {}).get('logStreamName'),
        }
        if job['status'] == 'SUCCEEDED':
            bucket = _get_output_bucket()
            result['results_location'] = f"s3://{bucket}/transformations/{job['jobName']}/"
        if job['status'] == 'FAILED' and 'statusReason' in job:
            result['failure_reason'] = job['statusReason']
        return result
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def list_job_results(job_id: str) -> Dict[str, Any]:
    """
    List the output files from a completed transformation job.

    Args:
        job_id: The job ID to get results for

    Returns:
        Dictionary with list of output files in S3
    """
    try:
        response = batch_client.describe_jobs(jobs=[job_id])
        if not response['jobs']:
            return {"status": "error", "error": f"Job not found: {job_id}"}
        job_name = response['jobs'][0]['jobName']
        bucket = _get_output_bucket()
        prefix = f"transformations/{job_name}/"
        objects = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=100)
        files = [{"key": obj['Key'], "size": obj['Size'], "last_modified": obj['LastModified'].isoformat(), "s3_uri": f"s3://{bucket}/{obj['Key']}"} for obj in objects.get('Contents', [])]
        return {"status": "success", "action": "list_results", "job_id": job_id, "job_name": job_name, "results_location": f"s3://{bucket}/{prefix}", "file_count": len(files), "files": files}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@tool
def execute_transform_agent(query: str) -> Dict[str, Any]:
    """
    Handles transformation execution, job status checks, and result retrieval.

    Args:
        query: Natural language request. Examples:
            - "Execute AWS/python-version-upgrade on https://github.com/user/repo with configuration validationCommands=pytest"
            - "Check status of job abc-123-def-456"
            - "List results for job abc-123-def-456"

    Returns:
        Dictionary with results
    """
    logger.info("EXECUTE TRANSFORM AGENT INVOKED")

    # Use direct Bedrock call to extract parameters (avoids Strands streaming bug)
    try:
        bedrock_rt = boto3.client('bedrock-runtime', region_name=os.getenv("AWS_REGION", "us-east-1"))
        extract_prompt = f"""Extract the following from this request. Return ONLY valid JSON, no other text.

Request: {query}

Return JSON with these fields:
- "action": one of "execute", "status", "results" (default: "execute")
- "transformation": transformation name (e.g., "AWS/python-version-upgrade" or "add-logging")
- "source": repository URL or S3 path
- "configuration": comma-separated config string (e.g., "validationCommands=pytest,additionalPlanContext=Target Python 3.13")
- "job_id": job ID if checking status or results

Example: {{"action": "execute", "transformation": "AWS/python-version-upgrade", "source": "https://github.com/user/repo", "configuration": "validationCommands=pytest", "job_id": ""}}"""

        response = bedrock_rt.invoke_model(
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

        action = params.get('action', 'execute')
        job_id = params.get('job_id', '')

        if action == 'status' and job_id:
            result = get_job_status(job_id=job_id)
            return {"status": "success", "result": json.dumps(result)}

        if action == 'results' and job_id:
            result = list_job_results(job_id=job_id)
            return {"status": "success", "result": json.dumps(result)}

        # Execute transformation
        transformation = params.get('transformation', '')
        source = params.get('source', '')
        configuration = params.get('configuration', '')

        if not transformation or not source:
            return {"status": "error", "error": "Could not extract transformation name and source from the request."}

        result = execute_transformation(
            transformation=transformation,
            source=source,
            configuration=configuration
        )
        return {"status": "success", "result": json.dumps(result)}

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse response: {e}")
        return {"status": "error", "error": f"Failed to parse parameters: {e}"}
    except Exception as e:
        logger.error(f"Execute transform agent failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
