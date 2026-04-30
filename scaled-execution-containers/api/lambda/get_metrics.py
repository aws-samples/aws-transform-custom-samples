"""
Lambda function to retrieve CloudWatch metrics for ATX transformation jobs.

Supports filtering by type to keep response times fast:
  ?type=jobs       - Batch job counts (~200ms)
  ?type=transform  - AWS/TransformCustom metrics (~1-2s)
  ?type=lambda     - Lambda invocation/error/duration (~300ms)
  ?type=api        - API Gateway request/error counts (~200ms)
  ?type=all        - Everything (default)
"""
import json
import boto3
import os
from datetime import datetime, timedelta

batch = boto3.client('batch')
cloudwatch = boto3.client('cloudwatch')

VALID_TYPES = {'jobs', 'transform', 'lambda', 'api', 'all', 'job_list', 'job_detail'}


def lambda_handler(event, context):
    """
    GET /metrics?type=jobs|transform|lambda|api|all|job_list|job_detail&period=24&jobId=xxx
    """
    try:
        params = event.get('queryStringParameters') or {}
        period_hours = min(int(params.get('period', '24')), 168)
        metric_type = params.get('type', 'all').lower()

        if metric_type not in VALID_TYPES:
            return _resp(400, {'error': f'Invalid type. Must be one of: {", ".join(sorted(VALID_TYPES))}'})

        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=period_hours)

        # Job list: return all jobs with IDs, names, status
        if metric_type == 'job_list':
            return _resp(200, {'jobs': _get_job_list()})

        # Job detail: return conversation ID + all metrics for a specific job
        if metric_type == 'job_detail':
            job_id = params.get('jobId')
            if not job_id:
                return _resp(400, {'error': 'jobId parameter required for job_detail type'})
            return _resp(200, _get_job_detail(job_id))

        fetch_all = metric_type == 'all'

        result = {
            'periodHours': period_hours,
            'type': metric_type,
            'startTime': start_time.isoformat() + 'Z',
            'endTime': end_time.isoformat() + 'Z',
        }

        if fetch_all or metric_type == 'jobs':
            result['jobs'] = _get_job_counts()
        if fetch_all or metric_type == 'transform':
            result['transformCustom'] = _get_transform_custom_metrics(start_time, end_time)
        if fetch_all or metric_type == 'lambda':
            result['lambda'] = _get_lambda_metrics(start_time, end_time)
        if fetch_all or metric_type == 'api':
            result['api'] = _get_api_metrics(start_time, end_time)

        return _resp(200, result)
    except Exception as e:
        print(f"Error: {e}")
        return _resp(500, {'error': str(e)})


def _get_job_list():
    """List all Batch jobs across all statuses with IDs, names, timestamps."""
    job_queue = os.environ.get('JOB_QUEUE', 'atx-job-queue')
    all_jobs = []
    for status in ['RUNNING', 'SUBMITTED', 'PENDING', 'RUNNABLE', 'STARTING', 'SUCCEEDED', 'FAILED']:
        try:
            paginator_token = None
            while True:
                kwargs = {'jobQueue': job_queue, 'jobStatus': status, 'maxResults': 100}
                if paginator_token:
                    kwargs['nextToken'] = paginator_token
                resp = batch.list_jobs(**kwargs)
                for j in resp.get('jobSummaryList', []):
                    all_jobs.append({
                        'jobId': j['jobId'],
                        'jobName': j['jobName'],
                        'status': j['status'],
                        'createdAt': _fmt_ts(j.get('createdAt')),
                        'startedAt': _fmt_ts(j.get('startedAt')),
                        'stoppedAt': _fmt_ts(j.get('stoppedAt')),
                    })
                paginator_token = resp.get('nextToken')
                if not paginator_token:
                    break
        except Exception as e:
            print(f"Error listing {status} jobs: {e}")
    # Sort by createdAt descending
    all_jobs.sort(key=lambda x: x.get('createdAt') or '', reverse=True)
    return all_jobs


def _get_job_detail(job_id):
    """Get full detail for a single job: conversation ID, CloudWatch metrics, logs."""
    logs_client = boto3.client('logs')
    s3_client = boto3.client('s3')

    # 1. Get job info from Batch
    resp = batch.describe_jobs(jobs=[job_id])
    if not resp.get('jobs'):
        return {'error': f'Job not found: {job_id}'}
    job = resp['jobs'][0]

    result = {
        'jobId': job['jobId'],
        'jobName': job['jobName'],
        'status': job['status'],
        'createdAt': _fmt_ts(job.get('createdAt')),
        'startedAt': _fmt_ts(job.get('startedAt')),
        'stoppedAt': _fmt_ts(job.get('stoppedAt')),
        'duration': _calc_dur(job.get('startedAt'), job.get('stoppedAt')),
        'command': job.get('container', {}).get('command', []),
        'exitCode': job.get('container', {}).get('exitCode'),
        'conversationId': None,
        's3OutputPath': None,
        'metrics': {},
    }

    # 2. Extract conversation ID from logs or S3
    log_stream = job.get('container', {}).get('logStreamName')
    log_group = '/aws/batch/atx-transform'
    conversation_id = None

    if log_stream:
        result['logStream'] = {'logGroup': log_group, 'logStreamName': log_stream}
        try:
            log_resp = logs_client.get_log_events(
                logGroupName=log_group, logStreamName=log_stream,
                limit=200, startFromHead=False,
            )
            import re
            for ev in log_resp.get('events', []):
                msg = ev.get('message', '')
                # Pattern: "Conversation log: /home/atxuser/.aws/atx/custom/20260427_153222_180e2369/logs/..."
                m = re.search(r'/atx/custom/(\d{8}_\d{6}_[a-f0-9]+)/', msg)
                if m:
                    conversation_id = m.group(1)
                    break
        except Exception as e:
            print(f"Error reading logs: {e}")

    # Try S3 fallback for conversation ID
    if not conversation_id:
        s3_bucket = None
        env_vars = job.get('container', {}).get('environment', [])
        for v in env_vars:
            if v.get('name') == 'S3_BUCKET':
                s3_bucket = v.get('value')
        cmd = job.get('container', {}).get('command', [])
        output_prefix = 'transformations/'
        try:
            idx = cmd.index('--output')
            if idx + 1 < len(cmd):
                output_prefix = cmd[idx + 1]
        except (ValueError, IndexError):
            pass
        if s3_bucket:
            try:
                s3_resp = s3_client.list_objects_v2(Bucket=s3_bucket, Prefix=output_prefix, MaxKeys=5)
                import re
                for obj in s3_resp.get('Contents', []):
                    # Path: transformations/{jobName}/{conversationId}/...
                    # conversationId format: 20260427_153222_180e2369
                    m = re.search(r'/(\d{8}_\d{6}_[a-f0-9]+)/', obj['Key'])
                    if m:
                        conversation_id = m.group(1)
                        break
            except Exception as e:
                print(f"Error listing S3: {e}")

    result['conversationId'] = conversation_id
    if conversation_id:
        s3_bucket = None
        for v in job.get('container', {}).get('environment', []):
            if v.get('name') == 'S3_BUCKET':
                s3_bucket = v.get('value')
        cmd = job.get('container', {}).get('command', [])
        output_prefix = 'transformations/'
        try:
            idx = cmd.index('--output')
            if idx + 1 < len(cmd):
                output_prefix = cmd[idx + 1]
        except (ValueError, IndexError):
            pass
        if s3_bucket:
            result['s3OutputPath'] = f"s3://{s3_bucket}/{output_prefix}{conversation_id}/"

    # 3. Get CloudWatch metrics scoped to this job's time window
    start_ms = job.get('createdAt') or job.get('startedAt')
    stop_ms = job.get('stoppedAt')
    if start_ms:
        m_start = datetime.utcfromtimestamp(start_ms / 1000) - timedelta(minutes=5)
        m_end = datetime.utcfromtimestamp(stop_ms / 1000) + timedelta(minutes=5) if stop_ms else datetime.utcnow()

        # 3a. Lambda metrics for trigger-job during this window
        for fn in ['atx-trigger-job', 'atx-trigger-batch-jobs', 'atx-async-invoke-agent']:
            inv = _get_stat('AWS/Lambda', 'Invocations', 'FunctionName', fn, m_start, m_end, 'Sum')
            err = _get_stat('AWS/Lambda', 'Errors', 'FunctionName', fn, m_start, m_end, 'Sum')
            dur = _get_stat('AWS/Lambda', 'Duration', 'FunctionName', fn, m_start, m_end, 'Average')
            if inv:
                result['metrics'].setdefault('lambda', {})[fn] = {
                    'invocations': int(inv or 0), 'errors': int(err or 0),
                    'avgDurationMs': round(dur, 1) if dur else None,
                }

        # 3b. TransformCustom metrics filtered by job name or conversation ID
        transform_metrics = _get_job_transform_metrics(job['jobName'], conversation_id, m_start, m_end)
        if transform_metrics:
            result['metrics']['transformCustom'] = transform_metrics

        # 3c. Batch job-level CloudWatch metrics (if available)
        result['metrics']['batch'] = {
            'vcpus': job.get('container', {}).get('vcpus'),
            'memory': job.get('container', {}).get('memory'),
            'attempts': len(job.get('attempts', [])),
        }

    return result


def _get_job_transform_metrics(job_name, conversation_id, start_time, end_time):
    """Get AWS/TransformCustom metrics that match this job."""
    namespace = 'AWS/TransformCustom'
    result = {}
    try:
        for metric_name in ['AgentExecutionMinutes', 'TransformationExecutionStarted', 'ConversationStarted']:
            resp = cloudwatch.list_metrics(Namespace=namespace, MetricName=metric_name)
            for m in resp.get('Metrics', []):
                dims = {d['Name']: d['Value'] for d in m['Dimensions']}
                # Match by job name in TransformationName or ConversationId dimension
                t_name = dims.get('TransformationName', '')
                if job_name and job_name in t_name or conversation_id and conversation_id in str(dims):
                    val = _get_stat(namespace, metric_name, m['Dimensions'][0]['Name'],
                                    m['Dimensions'][0]['Value'], start_time, end_time, 'Sum')
                    if val:
                        result[metric_name] = result.get(metric_name, 0) + val
                        result.setdefault('dimensions', {})[t_name] = dims
    except Exception as e:
        print(f"Error getting job transform metrics: {e}")
    return result


def _fmt_ts(ts_ms):
    if ts_ms:
        return datetime.utcfromtimestamp(ts_ms / 1000).isoformat() + 'Z'
    return None


def _calc_dur(start_ms, end_ms):
    if start_ms and end_ms:
        return int((end_ms - start_ms) / 1000)
    return None


def _get_job_counts():
    job_queue = os.environ.get('JOB_QUEUE', 'atx-job-queue')
    counts = {}
    for status in ['SUBMITTED', 'PENDING', 'RUNNABLE', 'STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED']:
        try:
            resp = batch.list_jobs(jobQueue=job_queue, jobStatus=status, maxResults=1)
            jobs = resp.get('jobSummaryList', [])
            counts[status] = f"{len(jobs)}+" if 'nextToken' in resp else len(jobs)
        except Exception:
            counts[status] = 0
    return counts


def _get_transform_custom_metrics(start_time, end_time):
    namespace = 'AWS/TransformCustom'
    total_minutes = 0
    total_conversations = 0
    total_executions = 0
    by_transform = {}

    try:
        queries = []
        metric_map = {}

        for metric_name, prefix in [
            ('AgentExecutionMinutes', 'am'),
            ('TransformationExecutionStarted', 'te'),
            ('ConversationStarted', 'cs'),
        ]:
            resp = cloudwatch.list_metrics(Namespace=namespace, MetricName=metric_name)
            for i, m in enumerate(resp.get('Metrics', [])):
                qid = f'{prefix}_{i}'
                queries.append({
                    'Id': qid,
                    'MetricStat': {
                        'Metric': {'Namespace': namespace, 'MetricName': metric_name, 'Dimensions': m['Dimensions']},
                        'Period': 3600,
                        'Stat': 'Sum',
                    },
                    'ReturnData': True,
                })
                t_name = next((d['Value'] for d in m['Dimensions'] if d['Name'] == 'TransformationName'), None)
                metric_map[qid] = (metric_name, t_name)

        if not queries:
            return {'agentExecutionMinutes': 0, 'conversationsStarted': 0, 'transformationExecutionsStarted': 0, 'byTransformation': {}}

        for batch_start in range(0, len(queries), 500):
            batch_q = queries[batch_start:batch_start + 500]
            resp = cloudwatch.get_metric_data(MetricDataQueries=batch_q, StartTime=start_time, EndTime=end_time)
            for r in resp.get('MetricDataResults', []):
                val = sum(r.get('Values', []))
                if val == 0:
                    continue
                mn, t_name = metric_map.get(r['Id'], (None, None))
                if mn == 'AgentExecutionMinutes':
                    total_minutes += val
                    if t_name:
                        by_transform.setdefault(t_name, {'executions': 0, 'agentMinutes': 0})
                        by_transform[t_name]['agentMinutes'] += val
                elif mn == 'TransformationExecutionStarted':
                    total_executions += val
                    if t_name:
                        by_transform.setdefault(t_name, {'executions': 0, 'agentMinutes': 0})
                        by_transform[t_name]['executions'] += int(val)
                elif mn == 'ConversationStarted':
                    total_conversations += val

        for t in by_transform.values():
            t['agentMinutes'] = round(t['agentMinutes'], 2)
    except Exception as e:
        print(f"Error getting TransformCustom metrics: {e}")

    return {
        'agentExecutionMinutes': round(total_minutes, 2),
        'conversationsStarted': int(total_conversations),
        'transformationExecutionsStarted': int(total_executions),
        'byTransformation': by_transform,
    }


def _get_lambda_metrics(start_time, end_time):
    functions = [
        'atx-trigger-job', 'atx-trigger-batch-jobs',
        'atx-get-job-status', 'atx-get-batch-status',
        'atx-get-knowledge-items', 'atx-get-metrics',
    ]
    metrics = {}
    for fn in functions:
        invocations = _get_stat('AWS/Lambda', 'Invocations', 'FunctionName', fn, start_time, end_time, 'Sum')
        errors = _get_stat('AWS/Lambda', 'Errors', 'FunctionName', fn, start_time, end_time, 'Sum')
        avg_dur = _get_stat('AWS/Lambda', 'Duration', 'FunctionName', fn, start_time, end_time, 'Average')
        if invocations or errors:
            metrics[fn] = {
                'invocations': int(invocations or 0),
                'errors': int(errors or 0),
                'avgDurationMs': round(avg_dur, 1) if avg_dur else None,
            }
    return metrics


def _get_api_metrics(start_time, end_time):
    g = lambda m: int(_get_stat('AWS/ApiGateway', m, 'ApiName', 'atx-transform-api', start_time, end_time, 'Sum') or 0)
    return {'requests': g('Count'), '4xxErrors': g('4XXError'), '5xxErrors': g('5XXError')}


def _get_stat(namespace, metric, dim_name, dim_value, start, end, stat):
    try:
        resp = cloudwatch.get_metric_statistics(
            Namespace=namespace, MetricName=metric,
            Dimensions=[{'Name': dim_name, 'Value': dim_value}],
            StartTime=start, EndTime=end,
            Period=int((end - start).total_seconds()),
            Statistics=[stat],
        )
        pts = resp.get('Datapoints', [])
        return pts[0][stat] if pts else None
    except Exception:
        return None


def _resp(code, body):
    return {
        'statusCode': code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }
