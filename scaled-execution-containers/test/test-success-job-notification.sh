#!/bin/bash
# Test successful job SNS notification by invoking the Lambda function directly

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

echo "=============================================="
echo "  Test Successful Job SNS Notification"
echo "=============================================="
echo ""

# Get Lambda function name
FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name AtxNotificationStack \
    --query 'Stacks[0].Outputs[?OutputKey==`FormatNotificationFunctionName`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$FUNCTION_NAME" ] || [ "$FUNCTION_NAME" == "None" ]; then
    echo -e "${RED}Error: Lambda function not found. Deploy the notification stack first.${NC}"
    exit 1
fi

echo -e "${BLUE}Lambda Function: $FUNCTION_NAME${NC}"
echo ""

# Create test event for successful job
TEST_EVENT=$(cat <<EOF
{
  "version": "0",
  "id": "test-event-$(date +%s)",
  "detail-type": "Batch Job State Change",
  "source": "aws.batch",
  "account": "123456789012",
  "time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "region": "$REGION",
  "resources": [],
  "detail": {
    "jobName": "test-success-job-$(date +%s)",
    "jobId": "test-job-id-$(uuidgen | tr '[:upper:]' '[:lower:]')",
    "jobQueue": "arn:aws:batch:$REGION:123456789012:job-queue/atx-job-queue",
    "status": "SUCCEEDED",
    "jobDefinition": "arn:aws:batch:$REGION:123456789012:job-definition/atx-transform-job:1",
    "container": {
      "exitCode": 0,
      "logStreamName": "atx-transform-job/default/test-log-stream"
    }
  }
}
EOF
)

echo -e "${YELLOW}Invoking Lambda with successful job event...${NC}"
echo ""

# Invoke Lambda function
RESPONSE=$(aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --payload "$TEST_EVENT" \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout 2>&1)

echo "$RESPONSE"
echo ""

if echo "$RESPONSE" | grep -q "statusCode.*200"; then
    echo -e "${GREEN}✓ Lambda invoked successfully!${NC}"
    echo ""
    echo "Check your email for the successful job notification."
    echo ""
    echo "The notification should include:"
    echo "  - Subject: ✅ AWS Transform Job Completed: test-success-job-*"
    echo "  - Exit Code: 0"
    echo "  - Status: SUCCEEDED"
    echo "  - CloudWatch logs link"
    echo "  - AWS CLI command to check job status"
else
    echo -e "${RED}✗ Lambda invocation failed${NC}"
    exit 1
fi

echo ""
echo "=============================================="
echo ""
echo "To test a failed job notification, run:"
echo "  ./test-failed-job-notification.sh"
echo ""
