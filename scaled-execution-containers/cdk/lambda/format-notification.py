import json
import boto3
import os

sns = boto3.client('sns')
TOPIC_ARN = os.environ['TOPIC_ARN']

def handler(event, context):
    """Format Batch job notifications with proper line breaks for email"""
    
    detail = event['detail']
    status = detail['status']
    job_name = detail['jobName']
    job_id = detail['jobId']
    region = event['region']
    time = event['time']
    exit_code = detail.get('container', {}).get('exitCode', 'N/A')
    
    if status == 'SUCCEEDED':
        subject = f"✅ AWS Transform Job Completed: {job_name}"
        message = f"""✅ AWS Transform Job Completed Successfully

Job Name: {job_name}
Job ID: {job_id}
Status: {status}
Exit Code: {exit_code}
Region: {region}
Completed At: {time}

View logs:
https://console.aws.amazon.com/cloudwatch/home?region={region}#logsV2:log-groups/log-group/$252Faws$252Fbatch$252Fatx-transform

Check job status:
aws batch describe-jobs --jobs {job_id} --region {region}
"""
    else:  # FAILED
        status_reason = detail.get('statusReason', 'Unknown')
        subject = f"❌ AWS Transform Job Failed: {job_name}"
        message = f"""❌ AWS Transform Job Failed

Job Name: {job_name}
Job ID: {job_id}
Status: {status}
Exit Code: {exit_code}
Reason: {status_reason}
Region: {region}
Failed At: {time}

View logs:
https://console.aws.amazon.com/cloudwatch/home?region={region}#logsV2:log-groups/log-group/$252Faws$252Fbatch$252Fatx-transform

Check job status:
aws batch describe-jobs --jobs {job_id} --region {region}

Troubleshooting:
https://github.com/aws-samples/aws-transform-custom-samples/blob/main/scaled-execution-containers/docs/TROUBLESHOOTING.md
"""
    
    # Publish to SNS with proper formatting
    sns.publish(
        TopicArn=TOPIC_ARN,
        Subject=subject,
        Message=message
    )
    
    return {'statusCode': 200}
