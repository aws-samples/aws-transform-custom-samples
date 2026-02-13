#!/bin/bash
# Test failed job SNS notification by submitting a real job with invalid repository URL

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

echo "=============================================="
echo "  Test Real Failed Job SNS Notification"
echo "=============================================="
echo ""

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

echo "API Endpoint: $API_ENDPOINT"
echo "SNS Topic:    ${TOPIC_ARN:-Not configured}"
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

echo "=============================================="
echo ""
echo -e "${YELLOW}Submitting job with INVALID repository URL...${NC}"
echo "This job will fail during git clone, triggering a failure notification."
echo ""

# Submit job with invalid repository URL
RESPONSE=$(python3 "$PROJECT_DIR/utilities/invoke-api.py" \
    --endpoint "$API_ENDPOINT" \
    --path "/jobs" \
    --data '{
        "source": "https://github.com/invalid-org/non-existent-repo-12345",
        "command": "atx custom def exec -n AWS/python-version-upgrade -p /source/non-existent-repo-12345 -x -t"
    }')

echo "$RESPONSE"
echo ""

# Extract job ID (try both jobId and batchJobId)
JOB_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('batchJobId') or data.get('jobId',''))" 2>/dev/null || echo "")
JOB_NAME=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('jobName',''))" 2>/dev/null || echo "")

if [ -z "$JOB_ID" ]; then
    echo -e "${RED}Failed to submit job${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Job submitted successfully!${NC}"
echo "Job ID:   $JOB_ID"
echo "Job Name: $JOB_NAME"
echo ""

# Monitor job status
echo -e "${BLUE}Monitoring job status...${NC}"
echo "Waiting for job to fail (this should take 1-2 minutes)..."
echo ""

for i in {1..30}; do
    sleep 10
    
    STATUS_RESPONSE=$(python3 "$PROJECT_DIR/utilities/invoke-api.py" \
        --endpoint "$API_ENDPOINT" \
        --method GET \
        --path "/jobs/$JOB_ID" 2>/dev/null || echo "")
    
    if [ -n "$STATUS_RESPONSE" ]; then
        STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
        
        echo -e "[$(date '+%H:%M:%S')] Job Status: $STATUS"
        
        if [ "$STATUS" == "FAILED" ]; then
            echo ""
            echo -e "${RED}✓ Job failed as expected!${NC}"
            echo ""
            
            # Get failure details
            STATUS_REASON=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusReason',''))" 2>/dev/null || echo "")
            EXIT_CODE=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('container',{}).get('exitCode',''))" 2>/dev/null || echo "")
            
            echo "Failure Details:"
            echo "  Exit Code: $EXIT_CODE"
            echo "  Reason: $STATUS_REASON"
            echo ""
            break
        elif [ "$STATUS" == "SUCCEEDED" ]; then
            echo ""
            echo -e "${YELLOW}Unexpected: Job succeeded (should have failed)${NC}"
            break
        fi
    fi
    
    if [ $i -eq 30 ]; then
        echo ""
        echo -e "${YELLOW}Timeout: Job is still running after 5 minutes${NC}"
        echo "Check job status manually:"
        echo "  aws batch describe-jobs --jobs $JOB_ID --region $REGION"
    fi
done

echo ""
echo "=============================================="
echo "  Test Complete"
echo "=============================================="
echo ""
echo "Check your email for the failure notification!"
echo ""
echo "The notification should include:"
echo "  - Subject: ❌ AWS Transform Job Failed: $JOB_NAME"
echo "  - Exit Code: (non-zero)"
echo "  - Reason: (git clone failure or similar)"
echo "  - CloudWatch logs link"
echo "  - Troubleshooting guide link"
echo ""
echo "View logs:"
echo "  aws logs tail /aws/batch/atx-transform --follow --region $REGION"
echo ""
echo "Check job details:"
echo "  aws batch describe-jobs --jobs $JOB_ID --region $REGION"
echo ""
