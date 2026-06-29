"""
ATX knowledge item management.

Ported from scaled-execution-containers/api/lambda/get_knowledge_items.py so the
agentic platform can serve knowledge items through its own /orchestrate `direct` op
instead of the IAM-authenticated REST API.

Knowledge items (KIs) are reusable artifacts AWS Transform Custom learns during a
transformation run (patterns, fixes, edge cases). They are generated DISABLED and
only applied once a human enables them. Each KI: { id, status, title, description, fix }.

Entry point: handle(body: dict) -> (status_code: int, response: dict)
`body` carries an `op` already routed here; this reads `kiAction`:
  - get        : read cached list from S3 (instant)            { transformationName }
  - submit     : run list-ki/get-ki via Batch, return request_id { cliAction, transformationName, id? }
  - poll       : read submit result by request_id              { request_id }
  - delete-ki / update-ki-status / update-ki-config / export-ki-markdown : Batch write jobs
"""
import json
import os
import re
import uuid
from datetime import datetime

import boto3

batch = boto3.client('batch')
s3 = boto3.client('s3')
logs = boto3.client('logs')

RESULT_BUCKET = os.environ.get('RESULT_BUCKET', os.environ.get('OUTPUT_BUCKET', ''))
CACHE_PREFIX = 'knowledge-items/cache/'
RESULT_PREFIX = 'knowledge-items/results/'

_NAME_RE = re.compile(r'^[a-zA-Z0-9/_-]+$')
_ID_RE = re.compile(r'^[a-zA-Z0-9_-]+$')


def _job_queue():
    return os.environ.get('JOB_QUEUE_NAME', os.environ.get('JOB_QUEUE', 'atx-job-queue'))


def _job_definition():
    return os.environ.get('JOB_DEFINITION_NAME', os.environ.get('JOB_DEFINITION', 'atx-transform-job'))


def handle(body):
    """Route a knowledge-items request. Returns (status_code, dict)."""
    ki_action = body.get('kiAction', 'get')

    if ki_action == 'get':
        return _handle_get(body)
    if ki_action == 'submit':
        return _handle_submit(body)
    if ki_action == 'poll':
        return _handle_poll(body)
    if ki_action in ('delete-ki', 'update-ki-status', 'update-ki-config', 'export-ki-markdown'):
        return _handle_write(body)
    return 400, {'error': 'Invalid kiAction. Use get, submit, poll, delete-ki, update-ki-status, update-ki-config, or export-ki-markdown'}


# ── GET: read from S3 cache ──────────────────────────────────────────────────

def _handle_get(body):
    name = body.get('transformationName')
    if not name:
        return 400, {'error': 'Missing required field: transformationName'}

    key = f'{CACHE_PREFIX}{name.replace("/", "_")}/list-ki.json'
    try:
        obj = s3.get_object(Bucket=RESULT_BUCKET, Key=key)
        data = json.loads(obj['Body'].read().decode('utf-8'))
        return 200, {'source': 'cache', 'transformationName': name, **data}
    except s3.exceptions.NoSuchKey:
        return 200, {
            'source': 'cache',
            'transformationName': name,
            'knowledgeItems': [],
            'message': f'No knowledge items cached for {name}. Submit a list-ki refresh to populate.',
        }
    except Exception as e:
        return 500, {'error': str(e)}


# ── POST: submit a read job ──────────────────────────────────────────────────

def _handle_submit(body):
    cli_action = body.get('cliAction', 'list-ki')
    name = body.get('transformationName')

    if cli_action not in ('list-ki', 'get-ki'):
        return 400, {'error': 'cliAction must be list-ki or get-ki'}
    if not name:
        return 400, {'error': 'Missing required field: transformationName'}
    if not _NAME_RE.match(name):
        return 400, {'error': 'Invalid transformationName'}

    ki_id = body.get('id')
    if cli_action == 'get-ki':
        if not ki_id:
            return 400, {'error': 'Missing required field: id (for get-ki)'}
        if not _ID_RE.match(ki_id):
            return 400, {'error': 'Invalid id'}

    request_id = str(uuid.uuid4())

    cmd = f'atx custom def {cli_action} -n {name} --json'
    if cli_action == 'get-ki' and ki_id:
        cmd = f'atx custom def {cli_action} -n {name} --id {ki_id} --json'

    cache_key = f'{CACHE_PREFIX}{name.replace("/", "_")}/{cli_action}'
    if ki_id:
        cache_key += f'-{ki_id}'
    cache_key += '.json'

    job_name = f'ki-{cli_action}-{name.replace("/", "-")}'[:128]
    try:
        response = batch.submit_job(
            jobName=job_name,
            jobQueue=_job_queue(),
            jobDefinition=_job_definition(),
            containerOverrides={
                'command': ['--output', f'knowledge-items/{job_name}/', '--command', cmd],
                'environment': [
                    {'name': 'KI_REQUEST_ID', 'value': request_id},
                    {'name': 'KI_RESULT_KEY', 'value': f'{RESULT_PREFIX}{request_id}.json'},
                    {'name': 'KI_CACHE_KEY', 'value': cache_key},
                ],
            },
        )
    except Exception as e:
        return 500, {'error': str(e)}

    marker = {
        'status': 'PROCESSING', 'cliAction': cli_action,
        'transformationName': name, 'batchJobId': response['jobId'],
    }
    s3.put_object(
        Bucket=RESULT_BUCKET, Key=f'{RESULT_PREFIX}{request_id}.json',
        Body=json.dumps(marker).encode(), ContentType='application/json',
    )

    return 200, {
        'status': 'SUBMITTED',
        'request_id': request_id,
        'batchJobId': response['jobId'],
        'cliAction': cli_action,
        'transformationName': name,
    }


def _handle_poll(body):
    request_id = body.get('request_id', '')
    if not request_id:
        return 400, {'error': 'Missing required field: request_id'}

    try:
        obj = s3.get_object(Bucket=RESULT_BUCKET, Key=f'{RESULT_PREFIX}{request_id}.json')
        result = json.loads(obj['Body'].read().decode('utf-8'))

        if result.get('status') != 'PROCESSING':
            return 200, result

        batch_job_id = result.get('batchJobId', '')
        if not batch_job_id:
            return 200, result

        resp = batch.describe_jobs(jobs=[batch_job_id])
        if not resp.get('jobs'):
            return 200, result

        job = resp['jobs'][0]
        job_status = job['status']

        if job_status in ('SUBMITTED', 'PENDING', 'RUNNABLE', 'STARTING', 'RUNNING'):
            return 200, result

        if job_status == 'FAILED':
            failed = {'status': 'FAILED', 'error': job.get('statusReason', 'Unknown error')}
            _write_result(request_id, failed)
            return 200, failed

        # SUCCEEDED — scrape JSON from CloudWatch logs
        log_stream = job.get('container', {}).get('logStreamName')
        if not log_stream:
            failed = {'status': 'FAILED', 'error': 'No log stream found for completed job'}
            _write_result(request_id, failed)
            return 200, failed

        ki_data = _extract_json_from_logs(log_stream)
        if not ki_data:
            failed = {'status': 'FAILED', 'error': 'Could not extract knowledge items from job logs'}
            _write_result(request_id, failed)
            return 200, failed

        t_name = result.get('transformationName', '')
        cli_action = result.get('cliAction', 'list-ki')
        if t_name:
            cache_key = f'{CACHE_PREFIX}{t_name.replace("/", "_")}/{cli_action}.json'
            s3.put_object(Bucket=RESULT_BUCKET, Key=cache_key,
                          Body=json.dumps(ki_data).encode(), ContentType='application/json')

        completed = {'status': 'COMPLETED', **ki_data}
        _write_result(request_id, completed)
        return 200, completed

    except s3.exceptions.NoSuchKey:
        return 200, {'status': 'NOT_FOUND'}
    except Exception as e:
        print(f'KI poll error: {e}')
        return 200, {'status': 'PROCESSING'}


def _write_result(request_id, data):
    s3.put_object(Bucket=RESULT_BUCKET, Key=f'{RESULT_PREFIX}{request_id}.json',
                  Body=json.dumps(data).encode(), ContentType='application/json')


def _extract_json_from_logs(log_stream):
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
        print(f'KI log extraction error: {e}')
        return None


# ── Write actions (delete / update / export) via Batch ───────────────────────

def _handle_write(body):
    action = body.get('kiAction')
    name = body.get('transformationName')

    if not name:
        return 400, {'error': 'Missing required field: transformationName'}
    if not _NAME_RE.match(name):
        return 400, {'error': 'Invalid transformationName'}

    cmd = f'atx custom def {action} -n {name}'

    ki_id = body.get('id')
    if action in ('delete-ki', 'update-ki-status'):
        if not ki_id:
            return 400, {'error': f'Missing required field: id (for {action})'}
        if not _ID_RE.match(ki_id):
            return 400, {'error': 'Invalid id'}
        cmd += f' --id {ki_id}'

    if action == 'update-ki-status':
        status = body.get('status')
        if status not in ('ENABLED', 'DISABLED'):
            return 400, {'error': 'status must be ENABLED or DISABLED'}
        cmd += f' --status {status}'

    if action == 'update-ki-config':
        auto = body.get('autoEnabled')
        if auto not in ('TRUE', 'FALSE'):
            return 400, {'error': 'autoEnabled must be TRUE or FALSE'}
        cmd += f' --auto-enabled {auto}'

    job_name = f'ki-{action}-{name.replace("/", "-")}'[:128]
    try:
        response = batch.submit_job(
            jobName=job_name,
            jobQueue=_job_queue(),
            jobDefinition=_job_definition(),
            containerOverrides={
                'command': ['--output', f'knowledge-items/{job_name}/', '--command', cmd],
            },
        )
    except Exception as e:
        return 500, {'error': str(e)}

    return 200, {
        'batchJobId': response['jobId'],
        'jobName': response['jobName'],
        'action': action,
        'transformationName': name,
        'status': 'SUBMITTED',
        'submittedAt': datetime.utcnow().isoformat() + 'Z',
    }
