"""
AgentCore Deploy Lambda (SDK-based)

Deploys the ATX Transform orchestrator to Bedrock AgentCore Runtime
using the boto3 bedrock-agentcore-control SDK directly.
No CLI subprocess calls — pure SDK.

Flow:
1. Package orchestrator code into a ZIP
2. Upload ZIP to S3
3. Call create_agent_runtime or update_agent_runtime via SDK
4. Poll until READY
5. Return the runtime ARN
"""

import json
import os
import io
import zipfile
import time
import logging
import boto3
import uuid

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get('ATX_REGION', os.environ.get('AWS_REGION', 'us-east-1'))
RUNTIME_NAME = os.environ.get('AGENT_RUNTIME_NAME', 'atxTransformOrchestrator')
EXECUTION_ROLE_ARN = os.environ.get('AGENT_EXECUTION_ROLE_ARN', '')
RESULT_BUCKET = os.environ.get('RESULT_BUCKET', '')  # S3 bucket for ZIP staging

agentcore_client = boto3.client('bedrock-agentcore-control', region_name=REGION)
s3_client = boto3.client('s3', region_name=REGION)


def lambda_handler(event, context):
    """Deploy or update the orchestrator on AgentCore Runtime."""
    try:
        body = {}
        if event.get('body'):
            body = json.loads(event['body'])
        elif event.get('action'):
            body = event

        action = body.get('action', 'deploy')

        if action == 'status':
            return _get_status()
        elif action == 'deploy':
            return _deploy()
        else:
            return _response(400, {'error': f'Unknown action: {action}'})

    except Exception as e:
        logger.error(f"Deploy failed: {e}", exc_info=True)
        return _response(500, {'error': str(e)})


def _deploy():
    """Package orchestrator code, upload to S3, create/update AgentCore runtime."""
    logger.info("Starting AgentCore deployment via SDK")

    if not EXECUTION_ROLE_ARN:
        return _response(400, {'error': 'AGENT_EXECUTION_ROLE_ARN environment variable not set'})
    if not RESULT_BUCKET:
        return _response(400, {'error': 'RESULT_BUCKET environment variable not set'})

    # Step 1: Package orchestrator code into ZIP
    logger.info("Packaging orchestrator code...")
    zip_buffer = io.BytesIO()
    # Look for orchestrator code in the Lambda package (bundled by deploy.sh)
    agent_dir = os.path.dirname(os.path.abspath(__file__))
    bundle_dir = os.path.join(agent_dir, 'orchestrator-bundle')
    if not os.path.exists(bundle_dir):
        bundle_dir = agent_dir  # Fallback: code is in the same directory

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(bundle_dir):
            dirs[:] = [d for d in dirs if d not in ('__pycache__', '.venv', '.git', 'node_modules')]
            for file in files:
                if file.endswith('.pyc') or file == 'deploy_agentcore.py':
                    continue
                full_path = os.path.join(root, file)
                arcname = os.path.relpath(full_path, bundle_dir)
                zf.write(full_path, arcname)

    zip_buffer.seek(0)
    zip_size = zip_buffer.getbuffer().nbytes
    logger.info(f"ZIP size: {zip_size / 1024:.1f} KB")

    # Step 2: Upload ZIP to S3
    s3_key = f'agentcore-deployments/{RUNTIME_NAME}/agent-{int(time.time())}.zip'
    logger.info(f"Uploading ZIP to s3://{RESULT_BUCKET}/{s3_key}")
    s3_client.put_object(
        Bucket=RESULT_BUCKET,
        Key=s3_key,
        Body=zip_buffer.getvalue(),
        ContentType='application/zip'
    )

    # Step 3: Check if runtime already exists
    existing_runtime_id = _find_existing_runtime()

    # Build and push orchestrator container to ECR, then use containerConfiguration
    # First, check if we have a pre-built container URI
    container_uri = os.environ.get('ORCHESTRATOR_CONTAINER_URI', '')

    if not container_uri:
        # Use code configuration (direct deploy) if available, fall back to error
        artifact = {
            'containerConfiguration': {
                'containerUri': 'PLACEHOLDER'  # Must be set via ORCHESTRATOR_CONTAINER_URI env var
            }
        }
        return _response(400, {
            'error': 'ORCHESTRATOR_CONTAINER_URI environment variable not set. '
                     'Build and push the orchestrator Docker image first, then set this env var.',
            'hint': 'cd orchestrator && docker build -t orchestrator . && docker tag orchestrator:latest <ecr-uri>:latest && docker push <ecr-uri>:latest'
        })

    artifact = {
        'containerConfiguration': {
            'containerUri': container_uri
        }
    }

    network_config = {
        'networkMode': 'PUBLIC'
    }

    env_vars = {
        'AWS_REGION': REGION,
        'BEDROCK_MODEL_ID': os.environ.get('BEDROCK_MODEL_ID', 'us.anthropic.claude-sonnet-4-20250514-v1:0'),
    }

    if existing_runtime_id:
        # Update existing runtime
        logger.info(f"Updating existing runtime: {existing_runtime_id}")
        response = agentcore_client.update_agent_runtime(
            agentRuntimeId=existing_runtime_id,
            agentRuntimeArtifact=artifact,
            roleArn=EXECUTION_ROLE_ARN,
            networkConfiguration=network_config,
            environmentVariables=env_vars,
            clientToken=str(uuid.uuid4()),
        )
        runtime_id = response['agentRuntimeId']
        runtime_arn = response['agentRuntimeArn']
        operation = 'updated'
    else:
        # Create new runtime
        logger.info(f"Creating new runtime: {RUNTIME_NAME}")
        response = agentcore_client.create_agent_runtime(
            agentRuntimeName=RUNTIME_NAME,
            agentRuntimeArtifact=artifact,
            roleArn=EXECUTION_ROLE_ARN,
            networkConfiguration=network_config,
            environmentVariables=env_vars,
            clientToken=str(uuid.uuid4()),
        )
        runtime_id = response['agentRuntimeId']
        runtime_arn = response['agentRuntimeArn']
        operation = 'created'

    logger.info(f"Runtime {operation}: {runtime_arn}")

    # Step 4: Poll until READY
    logger.info("Waiting for runtime to become READY...")
    for attempt in range(60):  # Max 10 minutes
        time.sleep(10)
        status_response = agentcore_client.get_agent_runtime(agentRuntimeId=runtime_id)
        status = status_response.get('status', 'UNKNOWN')
        logger.info(f"Runtime status: {status} (attempt {attempt + 1})")

        if status == 'READY':
            return _response(200, {
                'status': 'deployed',
                'operation': operation,
                'runtime_id': runtime_id,
                'runtime_arn': runtime_arn,
                'message': f'AgentCore runtime {operation} and READY. Update the async Lambda AGENT_RUNTIME_ARN env var.',
            })
        elif status in ('CREATE_FAILED', 'UPDATE_FAILED'):
            return _response(500, {
                'status': 'failed',
                'runtime_id': runtime_id,
                'runtime_status': status,
                'error': f'Runtime {status}. Check CloudWatch logs for details.',
            })

    return _response(500, {'error': 'Timed out waiting for runtime to become READY (10 min)'})


def _find_existing_runtime():
    """Find an existing runtime by name. Returns runtime ID or None."""
    try:
        paginator = agentcore_client.get_paginator('list_agent_runtimes')
        for page in paginator.paginate():
            for runtime in page.get('agentRuntimes', []):
                if runtime.get('agentRuntimeName') == RUNTIME_NAME:
                    return runtime['agentRuntimeId']
    except Exception as e:
        logger.warning(f"Could not list runtimes: {e}")
    return None


def _get_status():
    """Get current runtime status."""
    runtime_id = _find_existing_runtime()
    if not runtime_id:
        return _response(200, {'status': 'not_deployed', 'message': f'No runtime named {RUNTIME_NAME} found.'})

    try:
        response = agentcore_client.get_agent_runtime(agentRuntimeId=runtime_id)
        return _response(200, {
            'status': response.get('status'),
            'runtime_id': runtime_id,
            'runtime_arn': response.get('agentRuntimeArn'),
            'created_at': str(response.get('createdAt', '')),
            'updated_at': str(response.get('lastUpdatedAt', '')),
        })
    except Exception as e:
        return _response(500, {'error': str(e)})


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(body),
    }
