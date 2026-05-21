"""
Lambda function to manage ATX knowledge items for transformation definitions.

GET  /knowledge-items?transformationName=X  → reads cached result from S3 (instant)
POST /knowledge-items { action: "submit", ... }  → submits Batch job, writes S3 marker, returns request_id
POST /knowledge-items { action: "poll", request_id: "..." }  → reads result from S3
POST /knowledge-items { action: "delete-ki"|"update-ki-status"|"update-ki-config", ... }  → Batch job for writes
"""
import json
import boto3
import os
import re
import uuid
from datetime import datetime

batch = boto3.client('batch')
s3 = boto3.client('s3')
logs = boto3.client('logs')

RESULT_BUCKET = os.environ.get('OUTPUT_BUCKET', '')
CACHE_PREFIX = 'knowledge-items/cache/'
RESULT_PREFIX = 'knowledge-items/results/'


def lambda_handler(event, context):
    method = event.get('httpMethod') or event.get('requestContext', {}).get('httpMethod', 'POST')

    if method == 'GET':
        return _handle_get(event)
    return _handle_post(event)


# ── GET: read from S3 cache ──────────────────────────────────────────────────

def _handle_get(event):
    """GET /knowledge-items?transformationName=X"""
    try:
        params = event.get('queryStringParameters') or {}
        name = params.get('transformationName')

        if not name:
            return _error(400, 'Missing required query parameter: transformationName')

        key = f'{CACHE_PREFIX}{name.replace("/", "_")}/list-ki.json'
        try:
            obj = s3.get_object(Bucket=RESULT_BUCKET, Key=key)
            data = json.loads(obj['Body'].read().decode('utf-8'))
            return _resp(200, {'source': 'cache', 'transformationName': name, **data})
        except s3.exceptions.NoSuchKey:
            return _resp(200, {
                'source': 'cache',
                'transformationName': name,
                'knowledgeItems': [],
                'message': f'No knowledge items available for {name}. This transformation may not have been used yet, or the cache has not been populated. Try again later.',
            })
    except Exception as e:
        print(f'Error: {e}')
        return _resp(500, {'error': str(e)})


# ── POST: submit / poll / write actions ──────────────────────────────────────

def _handle_post(event):
    try:
        body = json.loads(event.get('body', '{}'))
        action = body.get('action')

        if not action:
            return _error(400, 'Missing required field: action')

        if action == 'poll':
            return _handle_poll(body)
        if action == 'submit':
            return _handle_submit(body, event)

        # Legacy write actions: submit as Batch job directly
        if action in ('delete-ki', 'update-ki-status', 'update-ki-config', 'export-ki-markdown'):
            return _handle_write(body)

        return _error(400, f'Invalid action. Must be one of: submit, poll, delete-ki, update-ki-status, update-ki-config, export-ki-markdown')

    except json.JSONDecodeError:
        return _error(400, 'Invalid JSON in request body')
    except Exception as e:
        print(f'Error: {e}')
        return _error(500, str(e))


def _handle_submit(body, event):
    """Submit a list-ki or get-ki job via Batch, write S3 marker, return request_id."""
    cli_action = body.get('cliAction', 'list-ki')
    name = body.get('transformationName')

    if cli_action not in ('list-ki', 'get-ki'):
        return _error(400, 'cliAction must be list-ki or get-ki')
    if not name:
        return _error(400, 'Missing required field: transformationName')
    if not re.match(r'^[a-zA-Z0-9/_-]+$', name):
        return _error(400, 'Invalid transformationName')

    ki_id = body.get('id')
    if cli_action == 'get-ki':
        if not ki_id:
            return _error(400, 'Missing required field: id (for get-ki)')
        if not re.match(r'^[a-zA-Z0-9_-]+$', ki_id):
            return _error(400, 'Invalid id')

    request_id = str(uuid.uuid4())

    # Build CLI command
    cmd = f'atx custom def {cli_action} -n {name} --json'
    if cli_action == 'get-ki' and ki_id:
        cmd = f'atx custom def {cli_action} -n {name} --id {ki_id} --json'

    # Write PROCESSING marker to S3 (batchJobId added after submit)
    marker = {'status': 'PROCESSING', 'cliAction': cli_action, 'transformationName': name}

    # S3 cache key where the Batch job should write results
    cache_key = f'{CACHE_PREFIX}{name.replace("/", "_")}/{cli_action}'
    if ki_id:
        cache_key += f'-{ki_id}'
    cache_key += '.json'

    # Submit Batch job with output directed to known S3 paths
    job_queue = os.environ.get('JOB_QUEUE', 'atx-job-queue')
    job_definition = os.environ.get('JOB_DEFINITION', 'atx-transform-job')
    job_name = f'ki-{cli_action}-{name.replace("/", "-")}'[:128]

    response = batch.submit_job(
        jobName=job_name,
        jobQueue=job_queue,
        jobDefinition=job_definition,
        containerOverrides={
            'command': ['--output', f'knowledge-items/{job_name}/', '--command', cmd],
            'environment': [
                {'name': 'KI_REQUEST_ID', 'value': request_id},
                {'name': 'KI_RESULT_KEY', 'value': f'{RESULT_PREFIX}{request_id}.json'},
                {'name': 'KI_CACHE_KEY', 'value': cache_key},
            ],
        },
    )

    # Write marker with batchJobId so poll can check job status
    marker['batchJobId'] = response['jobId']
    s3.put_object(
        Bucket=RESULT_BUCKET,
        Key=f'{RESULT_PREFIX}{request_id}.json',
        Body=json.dumps(marker).encode(),
        ContentType='application/json',
    )

    return _resp(200, {
        'status': 'SUBMITTED',
        'request_id': request_id,
        'batchJobId': response['jobId'],
        'cliAction': cli_action,
        'transformationName': name,
        'message': f'Poll for results: POST /knowledge-items with {{"action":"poll","request_id":"{request_id}"}}',
    })


def _handle_poll(body):
    """Poll for result by request_id — reads from S3, scrapes logs if Batch job is done."""
    request_id = body.get('request_id', '')
    if not request_id:
        return _error(400, 'Missing required field: request_id')

    try:
        obj = s3.get_object(Bucket=RESULT_BUCKET, Key=f'{RESULT_PREFIX}{request_id}.json')
        result = json.loads(obj['Body'].read().decode('utf-8'))

        # If already completed or failed, return as-is
        if result.get('status') != 'PROCESSING':
            return _resp(200, result)

        # Still processing — check if the Batch job finished
        batch_job_id = result.get('batchJobId', '')
        if not batch_job_id:
            return _resp(200, result)

        resp = batch.describe_jobs(jobs=[batch_job_id])
        if not resp.get('jobs'):
            return _resp(200, result)

        job = resp['jobs'][0]
        job_status = job['status']

        if job_status in ('SUBMITTED', 'PENDING', 'RUNNABLE', 'STARTING', 'RUNNING'):
            return _resp(200, result)

        if job_status == 'FAILED':
            reason = job.get('statusReason', 'Unknown error')
            failed = {'status': 'FAILED', 'error': reason}
            _write_result(request_id, failed)
            return _resp(200, failed)

        # SUCCEEDED — scrape JSON from CloudWatch logs
        log_stream = job.get('container', {}).get('logStreamName')
        if not log_stream:
            failed = {'status': 'FAILED', 'error': 'No log stream found for completed job'}
            _write_result(request_id, failed)
            return _resp(200, failed)

        ki_data = _extract_json_from_logs(log_stream)
        if not ki_data:
            failed = {'status': 'FAILED', 'error': 'Could not extract knowledge items from job logs'}
            _write_result(request_id, failed)
            return _resp(200, failed)

        # Write to cache for future GET requests
        t_name = result.get('transformationName', '')
        cli_action = result.get('cliAction', 'list-ki')
        if t_name:
            cache_key = f'{CACHE_PREFIX}{t_name.replace("/", "_")}/{cli_action}.json'
            s3.put_object(Bucket=RESULT_BUCKET, Key=cache_key,
                          Body=json.dumps(ki_data).encode(), ContentType='application/json')

        # Write completed result for poll
        completed = {'status': 'COMPLETED', **ki_data}
        _write_result(request_id, completed)
        return _resp(200, completed)

    except s3.exceptions.NoSuchKey:
        return _resp(200, {'status': 'NOT_FOUND'})
    except Exception as e:
        print(f'Poll error: {e}')
        return _resp(200, {'status': 'PROCESSING'})


def _write_result(request_id, data):
    """Write result JSON to S3."""
    s3.put_object(Bucket=RESULT_BUCKET, Key=f'{RESULT_PREFIX}{request_id}.json',
                  Body=json.dumps(data).encode(), ContentType='application/json')


def _extract_json_from_logs(log_stream):
    """Extract the JSON knowledge items output from CloudWatch logs."""
    try:
        resp = logs.get_log_events(
            logGroupName='/aws/batch/atx-transform',
            logStreamName=log_stream,
            startFromHead=True,
            limit=100,
        )
        for event in resp.get('events', []):
            msg = event.get('message', '').strip()
            if msg.startswith('{"transformationName"'):
                return json.loads(msg)
        return None
    except Exception as e:
        print(f'Log extraction error: {e}')
        return None


def _handle_write(body):
    """Write actions (delete, update-status, update-config, export) via Batch."""
    action = body.get('action')
    name = body.get('transformationName')

    if not name:
        return _error(400, 'Missing required field: transformationName')
    if not re.match(r'^[a-zA-Z0-9/_-]+$', name):
        return _error(400, 'Invalid transformationName')

    cmd = f'atx custom def {action} -n {name}'

    ki_id = body.get('id')
    if action in ('delete-ki', 'update-ki-status'):
        if not ki_id:
            return _error(400, f'Missing required field: id (for {action})')
        if not re.match(r'^[a-zA-Z0-9_-]+$', ki_id):
            return _error(400, 'Invalid id')
        cmd += f' --id {ki_id}'

    if action == 'update-ki-status':
        status = body.get('status')
        if status not in ('ENABLED', 'DISABLED'):
            return _error(400, 'status must be ENABLED or DISABLED')
        cmd += f' --status {status}'

    if action == 'update-ki-config':
        auto = body.get('autoEnabled')
        if auto not in ('TRUE', 'FALSE'):
            return _error(400, 'autoEnabled must be TRUE or FALSE')
        cmd += f' --auto-enabled {auto}'

    job_queue = os.environ.get('JOB_QUEUE', 'atx-job-queue')
    job_definition = os.environ.get('JOB_DEFINITION', 'atx-transform-job')
    job_name = f'ki-{action}-{name.replace("/", "-")}'[:128]

    response = batch.submit_job(
        jobName=job_name,
        jobQueue=job_queue,
        jobDefinition=job_definition,
        containerOverrides={
            'command': ['--output', f'knowledge-items/{job_name}/', '--command', cmd],
        },
    )

    return _resp(200, {
        'batchJobId': response['jobId'],
        'jobName': response['jobName'],
        'action': action,
        'transformationName': name,
        'command': cmd,
        'status': 'SUBMITTED',
        'submittedAt': datetime.utcnow().isoformat() + 'Z',
        'message': f'Check status at /jobs/{response["jobId"]}',
    })


# ── Helpers ──────────────────────────────────────────────────────────────────

def _resp(code, body):
    return {
        'statusCode': code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }


def _error(code, msg):
    return {
        'statusCode': code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'error': msg}),
    }
