#!/bin/bash
# Test SNS notifications by submitting a bulk job
# This will trigger both SUCCESS and FAILURE notifications

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Get configuration
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)

if [ -z "$ACCOUNT_ID" ]; then
    echo -e "${RED}Error: Unable to get AWS account ID. Check your credentials.${NC}"
    exit 1
fi

# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name AtxApiStack \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$API_ENDPOINT" ] || [ "$API_ENDPOINT" == "None" ]; then
    echo -e "${RED}Error: API_ENDPOINT not found. Deploy the infrastructure first.${NC}"
    exit 1
fi

# Get SNS topic ARN
TOPIC_ARN=$(aws cloudformation describe-stacks \
    --stack-name AtxNotificationStack \
    --query 'Stacks[0].Outputs[?OutputKey==`NotificationTopicArn`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$TOPIC_ARN" ] || [ "$TOPIC_ARN" == "None" ]; then
    echo -e "${YELLOW}Warning: SNS topic not found. Notifications may not be configured.${NC}"
fi

echo "=============================================="
echo "  SNS Notification Test - Bulk Job"
echo "=============================================="
echo "Account:      $ACCOUNT_ID"
echo "Region:       $REGION"
echo "API Endpoint: $API_ENDPOINT"
echo "SNS Topic:    ${TOPIC_ARN:-Not configured}"
echo "=============================================="
echo ""

# Check if user is subscribed to SNS
if [ -n "$TOPIC_ARN" ]; then
    echo -e "${BLUE}Checking SNS subscriptions...${NC}"
    SUBSCRIPTIONS=$(aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --query 'Subscriptions[*].Endpoint' --output text 2>/dev/null || echo "")
    
    if [ -z "$SUBSCRIPTIONS" ]; then
        echo -e "${YELLOW}No email subscriptions found!${NC}"
        echo ""
        echo "To receive notifications, subscribe to the SNS topic:"
        echo ""
        echo -e "${GREEN}aws sns subscribe --topic-arn $TOPIC_ARN --protocol email --notification-endpoint your-email@example.com${NC}"
        echo ""
        read -p "Press Enter to continue without email notifications, or Ctrl+C to exit and subscribe first..."
    else
        echo -e "${GREEN}Found subscriptions: $SUBSCRIPTIONS${NC}"
    fi
    echo ""
fi

# Submit bulk job with mix of quick and potentially failing jobs
echo -e "${BLUE}Submitting bulk job to test SNS notifications...${NC}"
echo ""
echo "This batch includes:"
echo "  - 2 quick jobs (list transformations) - should SUCCEED"
echo "  - 1 real transformation job - should SUCCEED"
echo ""

RESPONSE=$(python3 "$PROJECT_DIR/utilities/invoke-api.py" \
    --endpoint "$API_ENDPOINT" \
    --path "/jobs/batch" \
    --data '{"batchName":"sns-notification-test","jobs":[{"command":"atx custom def list"},{"command":"atx custom def list"},{"source":"https://github.com/venuvasu/todoapilambda","command":"atx custom def exec -n AWS/python-version-upgrade -p /source/todoapilambda -c noop --configuration \"validationCommands=pytest,additionalPlanContext=The target Python version to upgrade to is Python 3.13. Python 3.13 is already installed at /usr/bin/python3.13\" -x -t"}]}')

echo "$RESPONSE"
echo ""

# Extract batch ID
BATCH_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('batchId',''))" 2>/dev/null || echo "")

if [ -z "$BATCH_ID" ]; then
    echo -e "${RED}Failed to submit batch job${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Batch submitted successfully!${NC}"
echo "Batch ID: $BATCH_ID"
echo ""

# Monitor batch progress
echo -e "${BLUE}Monitoring batch progress...${NC}"
echo "You should receive SNS notifications as jobs complete."
echo ""

for i in {1..30}; do
    sleep 10
    
    STATUS_RESPONSE=$(python3 "$PROJECT_DIR/utilities/invoke-api.py" \
        --endpoint "$API_ENDPOINT" \
        --method GET \
        --path "/jobs/batch/$BATCH_ID" 2>/dev/null || echo "")
    
    if [ -n "$STATUS_RESPONSE" ]; then
        PROGRESS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('progress','0'))" 2>/dev/null || echo "0")
        TOTAL=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalJobs','0'))" 2>/dev/null || echo "0")
        SUCCEEDED=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCounts',{}).get('SUCCEEDED',0))" 2>/dev/null || echo "0")
        FAILED=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCounts',{}).get('FAILED',0))" 2>/dev/null || echo "0")
        RUNNING=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCounts',{}).get('RUNNING',0))" 2>/dev/null || echo "0")
        
        echo -e "[$(date '+%H:%M:%S')] Progress: ${PROGRESS}% | Total: $TOTAL | Running: $RUNNING | Succeeded: $SUCCEEDED | Failed: $FAILED"
        
        # Check if all jobs are done
        COMPLETED=$((SUCCEEDED + FAILED))
        if [ "$COMPLETED" -eq "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
            echo ""
            echo -e "${GREEN}✓ All jobs completed!${NC}"
            break
        fi
    fi
done

echo ""
echo "=============================================="
echo "  Test Complete"
echo "=============================================="
echo ""
echo "Check your email for SNS notifications!"
echo ""
echo "You can also view notifications in CloudWatch:"
echo "  aws logs tail /aws/lambda/AtxNotificationStack-FormatNotificationFunction --follow"
echo ""
echo "View job results:"
echo "  aws s3 ls s3://atx-custom-output-$ACCOUNT_ID/transformations/"
echo ""
