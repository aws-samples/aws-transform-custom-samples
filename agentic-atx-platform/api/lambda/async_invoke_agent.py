"""
Async AgentCore invocation Lambda.
Submit: fires async self-invoke, returns request_id immediately.
Execute: calls AgentCore, writes result to S3.
Poll: reads result from S3.
"""

import json
import uuid
import os
import logging
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get('AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))

s3_client = boto3.client('s3', region_name=REGION)
from botocore.config import Config as BotoConfig
agentcore_client = boto3.client('bedrock-agentcore', region_name=REGION,
    config=BotoConfig(read_timeout=900, connect_timeout=10, retries={'max_attempts': 0}))

AGENT_RUNTIME_ARN = os.environ.get('AGENT_RUNTIME_ARN', '')
RESULT_BUCKET = os.environ.get('RESULT_BUCKET', '')
RESULT_PREFIX = 'orchestrator-results/'
JOBS_TABLE = os.environ.get('JOBS_TABLE', 'atx-transform-jobs')

dynamodb_client = boto3.resource('dynamodb', region_name=REGION)


def _jobs_table():
    return dynamodb_client.Table(JOBS_TABLE)


def lambda_handler(event, context):
    # Internal async execution (invoked with InvocationType='Event')
    if event.get('_async_execute'):
        return _execute_agentcore(event['request_id'], event['prompt'])

    # Internal async download (invoked with InvocationType='Event')
    if event.get('_async_download'):
        return _execute_download(event['download_id'], event['bucket'], event['prefix'])

    # HTTP request from API Gateway
    if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return cors_response(200, '')

    try:
        body = json.loads(event.get('body', '{}'))
        action = body.get('action', 'submit')

        if action == 'submit':
            return _handle_submit(body)
        elif action == 'poll':
            return _handle_poll(body)
        elif action == 'direct':
            return _handle_direct(body)
        else:
            return cors_response(400, json.dumps({'error': f'Unknown action: {action}'}))
    except Exception as e:
        logger.error(f"Handler error: {e}")
        return cors_response(500, json.dumps({'error': str(e)}))


def _handle_submit(body):
    prompt = body.get('prompt', '')
    if not prompt:
        return cors_response(400, json.dumps({'error': 'Missing prompt'}))

    request_id = str(uuid.uuid4())

    # Write pending marker
    s3_client.put_object(
        Bucket=RESULT_BUCKET,
        Key=f'{RESULT_PREFIX}{request_id}.json',
        Body=json.dumps({'status': 'PROCESSING', 'prompt': prompt}).encode(),
        ContentType='application/json'
    )

    # Fire async self-invoke
    lambda_client = boto3.client('lambda', region_name=REGION)
    lambda_client.invoke(
        FunctionName=context_function_name() or 'atx-async-invoke-agent',
        InvocationType='Event',
        Payload=json.dumps({
            '_async_execute': True,
            'request_id': request_id,
            'prompt': prompt,
        })
    )

    return cors_response(200, json.dumps({'status': 'SUBMITTED', 'request_id': request_id}))


def _handle_poll(body):
    request_id = body.get('request_id', '')
    if not request_id:
        return cors_response(400, json.dumps({'error': 'Missing request_id'}))

    try:
        response = s3_client.get_object(Bucket=RESULT_BUCKET, Key=f'{RESULT_PREFIX}{request_id}.json')
        result = json.loads(response['Body'].read().decode('utf-8'))
        return cors_response(200, json.dumps(result))
    except s3_client.exceptions.NoSuchKey:
        return cors_response(200, json.dumps({'status': 'NOT_FOUND'}))


def _handle_direct(body):
    """Direct AWS service calls - no AgentCore, instant response."""
    op = body.get('op', '')
    batch_client = boto3.client('batch', region_name=REGION)

    if op == 'status':
        job_id = body.get('job_id', '')
        if not job_id:
            return cors_response(400, json.dumps({'error': 'Missing job_id'}))
        try:
            resp = batch_client.describe_jobs(jobs=[job_id])
            if not resp['jobs']:
                return cors_response(200, json.dumps({'error': f'Job not found: {job_id}'}))
            job = resp['jobs'][0]
            result = {
                'job_id': job_id, 'job_name': job['jobName'], 'job_status': job['status'],
                'created_at': job.get('createdAt'), 'started_at': job.get('startedAt'),
                'stopped_at': job.get('stoppedAt'),
                'log_stream': job.get('container', {}).get('logStreamName'),
            }
            if job['status'] == 'FAILED' and 'statusReason' in job:
                result['failure_reason'] = job['statusReason']
            if job['status'] == 'SUCCEEDED':
                account = boto3.client('sts').get_caller_identity()['Account']
                result['results_location'] = f"s3://atx-custom-output-{account}/transformations/{job['jobName']}/"
            # Persist job_name to DynamoDB for future lookups after Batch purges the record
            try:
                _jobs_table().update_item(
                    Key={'id': job_id},
                    UpdateExpression='SET job_name = :jn',
                    ExpressionAttributeValues={':jn': job['jobName']},
                )
            except Exception:
                pass
            return cors_response(200, json.dumps(result))
        except Exception as e:
            return cors_response(500, json.dumps({'error': str(e)}))

    elif op == 'results':
        job_id = body.get('job_id', '')
        if not job_id:
            return cors_response(400, json.dumps({'error': 'Missing job_id'}))
        try:
            job_name = None
            # Try Batch first
            resp = batch_client.describe_jobs(jobs=[job_id])
            if resp['jobs']:
                job_name = resp['jobs'][0]['jobName']
            else:
                # Fallback: read job_name from DynamoDB
                try:
                    ddb_item = _jobs_table().get_item(Key={'id': job_id}).get('Item', {})
                    job_name = ddb_item.get('job_name')
                except Exception:
                    pass
            if not job_name:
                return cors_response(200, json.dumps({'error': f'Job not found and no stored job_name for: {job_id}', 'files': []}))
            account = boto3.client('sts').get_caller_identity()['Account']
            bucket = f"atx-custom-output-{account}"
            prefix = f"transformations/{job_name}/"
            # List all objects recursively (ATX creates nested conversation folders)
            all_files = []
            paginator = s3_client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    name = key[len(prefix):]
                    # Skip .git internals and hidden files
                    if '/.git/' in key or name.startswith('.git/'):
                        continue
                    all_files.append({'key': key, 'size': obj['Size'], 'name': name})
            return cors_response(200, json.dumps({
                'job_id': job_id, 'job_name': job_name,
                'results_location': f's3://{bucket}/{prefix}',
                'file_count': len(all_files), 'files': all_files,
            }))
        except Exception as e:
            return cors_response(500, json.dumps({'error': str(e)}))

    elif op == 'list_custom':
        try:
            account = boto3.client('sts').get_caller_identity()['Account']
            bucket = f"atx-source-code-{account}"
            # List all custom definition directories that have status.json
            paginator = s3_client.get_paginator('list_objects_v2')
            customs = []
            for page in paginator.paginate(Bucket=bucket, Prefix='custom-definitions/', Delimiter='/'):
                for prefix in page.get('CommonPrefixes', []):
                    name = prefix['Prefix'].replace('custom-definitions/', '').rstrip('/')
                    if not name:
                        continue
                    # Read status.json
                    try:
                        status_obj = s3_client.get_object(Bucket=bucket, Key=f'custom-definitions/{name}/status.json')
                        status_data = json.loads(status_obj['Body'].read().decode('utf-8'))
                        customs.append(status_data)
                    except Exception:
                        customs.append({'name': name, 'status': 'unknown'})
            return cors_response(200, json.dumps({'customs': customs}))
        except Exception as e:
            return cors_response(500, json.dumps({'error': str(e)}))

    elif op == 'check_publish':
        # Check if a publish job succeeded and update status.json
        try:
            name = body.get('name', '')
            if not name:
                return cors_response(400, json.dumps({'error': 'Missing name'}))
            account = boto3.client('sts').get_caller_identity()['Account']
            bucket = f"atx-source-code-{account}"
            # Read current status
            status_obj = s3_client.get_object(Bucket=bucket, Key=f'custom-definitions/{name}/status.json')
            status_data = json.loads(status_obj['Body'].read().decode('utf-8'))
            pub_job_id = status_data.get('job_id')
            if not pub_job_id or status_data.get('status') == 'published':
                return cors_response(200, json.dumps(status_data))
            # Check Batch job
            resp = batch_client.describe_jobs(jobs=[pub_job_id])
            if resp['jobs']:
                job_status = resp['jobs'][0]['status']
                if job_status == 'SUCCEEDED':
                    status_data['status'] = 'published'
                elif job_status == 'FAILED':
                    status_data['status'] = 'failed'
                    status_data['failure_reason'] = resp['jobs'][0].get('statusReason', '')
                else:
                    status_data['status'] = 'publishing'
                # Update S3
                s3_client.put_object(Bucket=bucket, Key=f'custom-definitions/{name}/status.json',
                    Body=json.dumps(status_data).encode(), ContentType='application/json')
            return cors_response(200, json.dumps(status_data))
        except Exception as e:
            return cors_response(500, json.dumps({'error': str(e)}))

    elif op in ('save_job', 'list_jobs', 'delete_job', 'update_job'):
        return _handle_jobs_ops(op, body)

    elif op == 'get_file':
        try:
            bucket = body.get('bucket', '')
            key = body.get('key', '')
            # Support shorthand for custom definitions
            def_name = body.get('definition_name', '')
            if def_name and not bucket:
                account = boto3.client('sts').get_caller_identity()['Account']
                bucket = f"atx-source-code-{account}"
                # Normalize name to lowercase-hyphenated (matches how create agent stores it)
                normalized = def_name.lower().replace(' ', '-')
                key = f"custom-definitions/{normalized}/transformation_definition.md"
            if not bucket or not key:
                return cors_response(400, json.dumps({'error': 'Missing bucket/key or definition_name'}))
            obj = s3_client.get_object(Bucket=bucket, Key=key)
            content = obj['Body'].read().decode('utf-8', errors='replace')
            if len(content) > 512000:
                content = content[:512000] + '\n\n... [truncated, file too large for preview]'
            return cors_response(200, json.dumps({
                'bucket': bucket, 'key': key,
                'content': content, 'size': obj['ContentLength'],
                'content_type': obj.get('ContentType', 'text/plain'),
            }))
        except Exception as e:
            return cors_response(500, json.dumps({'error': str(e)}))

    elif op == 'download_url':
        try:
            bucket = body.get('bucket', '')
            key = body.get('key', '')
            if not bucket or not key:
                return cors_response(400, json.dumps({'error': 'Missing bucket or key'}))
            url = s3_client.generate_presigned_url('get_object',
                Params={'Bucket': bucket, 'Key': key}, ExpiresIn=3600)
            return cors_response(200, json.dumps({'url': url}))
        except Exception as e:
            return cors_response(500, json.dumps({'error': str(e)}))

    elif op == 'download_all':
        try:
            import tempfile, os as _os
            bucket = body.get('bucket', '')
            prefix = body.get('prefix', '')
            if not bucket or not prefix:
                return cors_response(400, json.dumps({'error': 'Missing bucket or prefix'}))

            download_id = body.get('download_id', '')
            # Check if this is a poll for an existing download
            if download_id:
                try:
                    result_obj = s3_client.get_object(Bucket=bucket, Key=f'downloads/{download_id}.json')
                    result = json.loads(result_obj['Body'].read().decode('utf-8'))
                    return cors_response(200, json.dumps(result))
                except s3_client.exceptions.NoSuchKey:
                    return cors_response(200, json.dumps({'status': 'PROCESSING'}))

            # Start async download
            import uuid
            download_id = str(uuid.uuid4())[:8]

            # Check if a ZIP already exists for this prefix
            zip_key = f"downloads/{prefix.rstrip('/').split('/')[-1]}.zip"
            try:
                s3_client.head_object(Bucket=bucket, Key=zip_key)
                # ZIP exists, return presigned URL immediately
                url = s3_client.generate_presigned_url('get_object',
                    Params={'Bucket': bucket, 'Key': zip_key}, ExpiresIn=3600)
                return cors_response(200, json.dumps({'status': 'COMPLETED', 'url': url, 'cached': True}))
            except s3_client.exceptions.ClientError:
                pass  # ZIP doesn't exist, create it

            # Write pending marker
            s3_client.put_object(Bucket=bucket, Key=f'downloads/{download_id}.json',
                Body=json.dumps({'status': 'PROCESSING'}).encode(), ContentType='application/json')

            # Fire async self-invoke
            lambda_client = boto3.client('lambda', region_name=REGION)
            lambda_client.invoke(
                FunctionName=os.environ.get('AWS_LAMBDA_FUNCTION_NAME', 'atx-async-invoke-agent'),
                InvocationType='Event',
                Payload=json.dumps({
                    '_async_download': True,
                    'download_id': download_id,
                    'bucket': bucket,
                    'prefix': prefix,
                })
            )
            return cors_response(200, json.dumps({'status': 'STARTED', 'download_id': download_id}))
        except Exception as e:
            return cors_response(500, json.dumps({'error': str(e)}))
        except Exception as e:
            return cors_response(500, json.dumps({'error': str(e)}))

    return cors_response(400, json.dumps({'error': f'Unknown op: {op}. Use status, results, list_custom, check_publish, save_job, list_jobs, or delete_job'}))


def _handle_jobs_ops(op, body):
    """DynamoDB job tracking operations."""
    import time as _time
    from decimal import Decimal

    class DecimalEncoder(json.JSONEncoder):
        def default(self, o):
            if isinstance(o, Decimal):
                return int(o) if o == int(o) else float(o)
            return super().default(o)

    if op == 'save_job':
        job = body.get('job', {})
        if not job.get('id'):
            return cors_response(400, json.dumps({'error': 'Missing job.id'}))
        # Add TTL (30 days from now)
        job['ttl'] = int(_time.time()) + 30 * 86400
        _jobs_table().put_item(Item=job)
        return cors_response(200, json.dumps({'status': 'saved', 'id': job['id']}))

    elif op == 'list_jobs':
        result = _jobs_table().scan()
        jobs = sorted(result.get('Items', []), key=lambda j: j.get('submittedAt', ''), reverse=True)
        return cors_response(200, json.dumps({'jobs': jobs}, cls=DecimalEncoder))

    elif op == 'delete_job':
        job_id = body.get('job_id', '')
        if not job_id:
            return cors_response(400, json.dumps({'error': 'Missing job_id'}))
        _jobs_table().delete_item(Key={'id': job_id})
        return cors_response(200, json.dumps({'status': 'deleted', 'id': job_id}))

    elif op == 'update_job':
        job_id = body.get('job_id', '')
        updates = body.get('updates', {})
        if not job_id or not updates:
            return cors_response(400, json.dumps({'error': 'Missing job_id or updates'}))
        expr_parts = []
        expr_values = {}
        expr_names = {}
        for k, v in updates.items():
            safe_key = f'#k_{k}'
            val_key = f':v_{k}'
            expr_parts.append(f'{safe_key} = {val_key}')
            expr_values[val_key] = v
            expr_names[safe_key] = k
        _jobs_table().update_item(
            Key={'id': job_id},
            UpdateExpression='SET ' + ', '.join(expr_parts),
            ExpressionAttributeValues=expr_values,
            ExpressionAttributeNames=expr_names,
        )
        return cors_response(200, json.dumps({'status': 'updated', 'id': job_id}))

    return cors_response(400, json.dumps({'error': f'Unknown jobs op: {op}'}))


def _execute_agentcore(request_id, prompt):
    """Called asynchronously - no timeout pressure."""
    logger.info(f"Executing AgentCore for request {request_id}")

    def _update_step(step):
        """Write intermediate step to S3 so the UI can show progress."""
        try:
            s3_client.put_object(
                Bucket=RESULT_BUCKET,
                Key=f'{RESULT_PREFIX}{request_id}.json',
                Body=json.dumps({'status': 'PROCESSING', 'step': step}).encode(),
                ContentType='application/json'
            )
        except Exception:
            pass  # Don't fail the main flow for a status update

    try:
        _update_step('Sending request to orchestrator...')

        payload = json.dumps({'prompt': prompt}).encode()
        session_id = str(uuid.uuid4())

        response = agentcore_client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            runtimeSessionId=session_id,
            payload=payload
        )

        _update_step('Orchestrator is processing...')

        content_type = response.get('contentType', '')
        chunks = []
        chunk_count = 0
        if 'text/event-stream' in content_type:
            for line in response['response'].iter_lines(chunk_size=10):
                if line:
                    decoded = line.decode('utf-8')
                    if decoded.startswith('data: '):
                        chunk_text = decoded[6:]
                        chunks.append(chunk_text)
                        chunk_count += 1
                        # Detect orchestrator steps from streaming chunks
                        _detect_and_update_step(request_id, chunk_text, chunk_count)
        else:
            for chunk in response.get('response', []):
                if isinstance(chunk, bytes):
                    chunk_text = chunk.decode('utf-8')
                    chunks.append(chunk_text)
                    chunk_count += 1
                    _detect_and_update_step(request_id, chunk_text, chunk_count)

        result_text = ''.join(chunks)
        try:
            result = json.loads(result_text)
        except json.JSONDecodeError:
            result = {'result': result_text}

        s3_client.put_object(
            Bucket=RESULT_BUCKET,
            Key=f'{RESULT_PREFIX}{request_id}.json',
            Body=json.dumps({'status': 'COMPLETED', 'result': result}).encode(),
            ContentType='application/json'
        )
        logger.info(f"Request {request_id} completed successfully")

    except Exception as e:
        logger.error(f"Request {request_id} failed: {e}")
        s3_client.put_object(
            Bucket=RESULT_BUCKET,
            Key=f'{RESULT_PREFIX}{request_id}.json',
            Body=json.dumps({'status': 'FAILED', 'error': str(e)}).encode(),
            ContentType='application/json'
        )


def _detect_and_update_step(request_id, chunk_text, chunk_count):
    """Parse streaming chunks to detect orchestrator steps and update S3."""
    lower = chunk_text.lower()
    step = None

    if 'find_transform_agent' in lower or 'searching' in lower or 'finding' in lower:
        step = 'Finding best transformation...'
    elif 'create_transform_agent' in lower or 'generating' in lower or 'creating' in lower:
        step = 'Creating custom transformation...'
    elif 'publish' in lower:
        step = 'Publishing transformation to registry...'
    elif 'execute_transform_agent' in lower or 'executing' in lower or 'submit' in lower:
        step = 'Executing transformation...'

    if step:
        try:
            s3_client.put_object(
                Bucket=RESULT_BUCKET,
                Key=f'{RESULT_PREFIX}{request_id}.json',
                Body=json.dumps({'status': 'PROCESSING', 'step': step}).encode(),
                ContentType='application/json'
            )
        except Exception:
            pass


def _execute_download(download_id, bucket, prefix):
    """Called asynchronously to create ZIP of all result files."""
    import zipfile, tempfile, os as _os
    logger.info(f"Starting download {download_id}: s3://{bucket}/{prefix}")
    try:
        zip_file = tempfile.NamedTemporaryFile(suffix='.zip', dir='/tmp', delete=False)  # nosec B108
        zip_path = zip_file.name
        zip_file.close()
        paginator = s3_client.get_paginator('list_objects_v2')
        file_count = 0
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    name = key[len(prefix):]
                    if not name or '/.git/' in key or name.startswith('.git/'):
                        continue
                    file_obj = s3_client.get_object(Bucket=bucket, Key=key)
                    zf.writestr(name, file_obj['Body'].read())
                    file_count += 1

        zip_key = f"downloads/{prefix.rstrip('/').split('/')[-1]}.zip"
        zip_size = _os.path.getsize(zip_path)
        with open(zip_path, 'rb') as f:
            s3_client.put_object(Bucket=bucket, Key=zip_key, Body=f, ContentType='application/zip')
        _os.remove(zip_path)

        url = s3_client.generate_presigned_url('get_object',
            Params={'Bucket': bucket, 'Key': zip_key}, ExpiresIn=3600)

        s3_client.put_object(Bucket=bucket, Key=f'downloads/{download_id}.json',
            Body=json.dumps({'status': 'COMPLETED', 'url': url, 'file_count': file_count, 'zip_size': zip_size}).encode(),
            ContentType='application/json')
        logger.info(f"Download {download_id} complete: {file_count} files, {zip_size} bytes")
    except Exception as e:
        logger.error(f"Download {download_id} failed: {e}")
        s3_client.put_object(Bucket=bucket, Key=f'downloads/{download_id}.json',
            Body=json.dumps({'status': 'FAILED', 'error': str(e)}).encode(),
            ContentType='application/json')


def context_function_name():
    return os.environ.get('AWS_LAMBDA_FUNCTION_NAME')


def cors_response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
        'body': body
    }
