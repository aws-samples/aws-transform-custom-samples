# SNS Notifications for AWS Transform Jobs

This document describes the SNS notification system for AWS Transform batch jobs.

## Overview

The notification system uses **EventBridge + SNS with Input Transformer** to send formatted notifications when batch jobs complete (both SUCCESS and FAILURE).

### Architecture

```
AWS Batch Job → State Change Event → EventBridge Rule → Input Transformer → SNS Topic → Email/SMS/Lambda
```

### Key Features

- ✅ **Automatic notifications** for both single and bulk jobs
- ✅ **Custom formatted messages** using EventBridge Input Transformer
- ✅ **No code changes** required in Lambda functions or containers
- ✅ **Separate rules** for SUCCESS and FAILURE with different message formats
- ✅ **Direct links** to CloudWatch logs and AWS CLI commands
- ✅ **Works immediately** after deployment

## Deployment

### Option 1: Deploy with CDK (Recommended)

The notification stack is automatically deployed with the main infrastructure:

```bash
cd cdk
./deploy.sh
```

This deploys 4 stacks:
1. `AtxContainerStack` - ECR repository
2. `AtxInfrastructureStack` - Batch, S3, IAM
3. `AtxApiStack` - Lambda, API Gateway
4. `AtxNotificationStack` - EventBridge, SNS (NEW)

### Option 2: Deploy Notification Stack Only

If you already have the infrastructure deployed:

```bash
cd cdk
npm install
npx cdk deploy AtxNotificationStack
```

## Subscribe to Notifications

After deployment, subscribe to the SNS topic:

### Email Subscription

```bash
# Get the topic ARN from CloudFormation outputs
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name AtxNotificationStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NotificationTopicArn`].OutputValue' \
  --output text)

# Subscribe your email
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint your-email@example.com

# Confirm subscription via email
```

### SMS Subscription

```bash
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol sms \
  --notification-endpoint +1234567890
```

### Lambda Subscription (for custom processing)

```bash
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol lambda \
  --notification-endpoint arn:aws:lambda:us-east-1:123456789012:function:my-notification-handler
```

## Notification Message Formats

### Success Notification

```
✅ AWS Transform Job Completed Successfully

Job Name: spring-petclinic-python-upgrade
Job ID: abc-123-def-456
Status: SUCCEEDED
Exit Code: 0
Region: us-east-1
Completed At: 2026-02-11T19:30:00Z

View logs:
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/$252Faws$252Fbatch$252Fatx-transform

Check job status:
aws batch describe-jobs --jobs abc-123-def-456 --region us-east-1
```

### Failure Notification

```
❌ AWS Transform Job Failed

Job Name: spring-petclinic-python-upgrade
Job ID: abc-123-def-456
Status: FAILED
Exit Code: 1
Reason: Essential container in task exited
Region: us-east-1
Failed At: 2026-02-11T19:30:00Z

View logs:
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/$252Faws$252Fbatch$252Fatx-transform

Check job status:
aws batch describe-jobs --jobs abc-123-def-456 --region us-east-1

Troubleshooting:
https://github.com/aws-samples/aws-transform-custom-samples/blob/main/scaled-execution-containers/docs/TROUBLESHOOTING.md
```

## How It Works

### EventBridge Rules

Two EventBridge rules monitor AWS Batch job state changes:

1. **Success Rule** (`atx-batch-job-success`)
   - Triggers on: `status = SUCCEEDED`
   - Filters by: `jobQueue = atx-job-queue`

2. **Failure Rule** (`atx-batch-job-failure`)
   - Triggers on: `status = FAILED`
   - Filters by: `jobQueue = atx-job-queue`

### Input Transformer

EventBridge Input Transformer extracts specific fields from the event and formats them into a readable message:

**Input Paths** (fields to extract):
- `jobName` - Name of the batch job
- `jobId` - Unique job identifier
- `status` - Job status (SUCCEEDED/FAILED)
- `exitCode` - Container exit code
- `statusReason` - Failure reason (for failures)
- `time` - Event timestamp
- `region` - AWS region

**Input Template** (message format):
- Custom formatted string with placeholders like `<jobName>`, `<jobId>`
- Includes direct links to CloudWatch logs
- Includes AWS CLI commands for troubleshooting

### Event Flow

```
1. Batch Job Completes (SUCCEEDED or FAILED)
   ↓
2. AWS Batch emits "Batch Job State Change" event
   ↓
3. EventBridge Rule matches the event
   ↓
4. Input Transformer extracts fields and formats message
   ↓
5. SNS publishes formatted message to topic
   ↓
6. Subscribers receive notification (Email/SMS/Lambda)
```

## Testing

### Test with a Single Job

```bash
# Submit a test job
python3 utilities/invoke-api.py \
  --endpoint "$API_ENDPOINT" \
  --path "/jobs" \
  --data '{
    "source": "https://github.com/spring-projects/spring-petclinic",
    "command": "atx custom def list"
  }'

# Wait for job to complete (2-5 minutes)
# Check your email for notification
```

### Test with Bulk Jobs

```bash
# Submit bulk jobs
python3 utilities/invoke-api.py \
  --endpoint "$API_ENDPOINT" \
  --path "/jobs/batch" \
  --data '{
    "batchName": "test-notifications",
    "jobs": [
      {
        "source": "https://github.com/spring-projects/spring-petclinic",
        "command": "atx custom def list"
      },
      {
        "source": "https://github.com/aws-samples/aws-transform-custom-samples",
        "command": "atx custom def list"
      }
    ]
  }'

# You will receive 2 notifications (one per job)
```

### Test Failure Notification

```bash
# Submit a job that will fail
python3 utilities/invoke-api.py \
  --endpoint "$API_ENDPOINT" \
  --path "/jobs" \
  --data '{
    "command": "atx custom def exec -n NonExistentTransformation"
  }'

# Check your email for failure notification
```

## Monitoring

### CloudWatch Metrics

Monitor notification delivery:

```bash
# Check SNS metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/SNS \
  --metric-name NumberOfNotificationsDelivered \
  --dimensions Name=TopicName,Value=atx-job-notifications \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# Check EventBridge metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=atx-batch-job-success \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### CloudWatch Logs

EventBridge rule invocations are logged:

```bash
# View EventBridge logs
aws logs tail /aws/events/rules/atx-batch-job-success --follow
aws logs tail /aws/events/rules/atx-batch-job-failure --follow
```

## Customization

### Modify Message Format

Edit `cdk/lib/notification-stack.ts` and update the `inputTemplate`:

```typescript
inputTemplate: `"Your custom message format

Job: <jobName>
Status: <status>
..."`
```

Then redeploy:

```bash
cd cdk
npx cdk deploy AtxNotificationStack
```

### Add Additional Fields

Add more fields to `inputPathsMap`:

```typescript
inputPathsMap: {
  jobName: '$.detail.jobName',
  jobId: '$.detail.jobId',
  // Add custom fields
  jobDefinition: '$.detail.jobDefinition',
  attempts: '$.detail.attempts',
  // ... more fields
}
```

### Filter by Job Name Pattern

Add pattern matching to EventBridge rule:

```typescript
eventPattern: {
  source: ['aws.batch'],
  'detail-type': ['Batch Job State Change'],
  detail: {
    status: ['SUCCEEDED'],
    jobQueue: [props.jobQueueArn],
    jobName: [{ prefix: 'prod-' }], // Only prod jobs
  },
}
```

### Add Slack Notifications

Use AWS Chatbot or Lambda:

```bash
# Option 1: AWS Chatbot (recommended)
# Configure in AWS Console: Chatbot → Slack → Add SNS topic

# Option 2: Lambda function
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol lambda \
  --notification-endpoint arn:aws:lambda:us-east-1:123456789012:function:slack-notifier
```

## Cost Estimation

### SNS Costs
- First 1,000 notifications/month: **Free**
- Additional notifications: **$0.50 per 1 million**
- Email: **Free**
- SMS: **$0.00645 per message** (US)

### EventBridge Costs
- First 1 million events/month: **Free**
- Additional events: **$1.00 per million**

### Example Monthly Costs

| Jobs/Month | SNS Cost | EventBridge Cost | Total |
|------------|----------|------------------|-------|
| 1,000      | $0.00    | $0.00           | $0.00 |
| 10,000     | $0.00    | $0.00           | $0.00 |
| 100,000    | $0.05    | $0.00           | $0.05 |
| 1,000,000  | $0.50    | $0.00           | $0.50 |

## Troubleshooting

### Not Receiving Notifications

1. **Check subscription status:**
   ```bash
   aws sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN
   ```

2. **Confirm email subscription:**
   - Check spam folder
   - Click confirmation link in email

3. **Check EventBridge rule:**
   ```bash
   aws events describe-rule --name atx-batch-job-success
   ```

4. **Check SNS topic policy:**
   ```bash
   aws sns get-topic-attributes --topic-arn $TOPIC_ARN
   ```

### Notifications Not Formatted Correctly

1. **Check Input Transformer configuration:**
   ```bash
   aws events list-targets-by-rule --rule atx-batch-job-success
   ```

2. **Test with sample event:**
   ```bash
   aws events put-events --entries file://test-event.json
   ```

### Too Many Notifications

1. **Add filters to EventBridge rule** (see Customization section)
2. **Use SNS message filtering:**
   ```bash
   aws sns set-subscription-attributes \
     --subscription-arn $SUBSCRIPTION_ARN \
     --attribute-name FilterPolicy \
     --attribute-value '{"status": ["FAILED"]}'  # Only failures
   ```

## Security Considerations

1. **SNS Topic Access**: Only EventBridge can publish (enforced by resource policy)
2. **Subscription Confirmation**: Required for email/SMS subscriptions
3. **Message Content**: Does not include sensitive data (only job metadata)
4. **Encryption**: Optional, can be enabled with KMS key
5. **Access Logging**: CloudTrail logs all SNS API calls

## Future Enhancements

### Phase 2: Bulk Job Summary

Add Lambda function to aggregate multiple job completions:

```
Bulk Batch Complete → Lambda → Aggregate Results → SNS Summary
```

### Phase 3: Advanced Filtering

- Filter by transformation type
- Filter by success/failure rate
- Filter by execution time

### Phase 4: Rich Notifications

- HTML email templates
- Slack rich messages with buttons
- Microsoft Teams adaptive cards

## References

- [EventBridge Input Transformer](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html)
- [AWS Batch Events](https://docs.aws.amazon.com/batch/latest/userguide/batch_cwe_events.html)
- [SNS Message Filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
