#!/bin/bash
# Simple SNS notification test with bulk job submission

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name AtxApiStack \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text 2>/dev/null)

# Get SNS topic
TOPIC_ARN=$(aws cloudformation describe-stacks \
    --stack-name AtxNotificationStack \
    --query 'Stacks[0].Outputs[?OutputKey==`NotificationTopicArn`].OutputValue' \
    --output text 2>/dev/null || echo "")

echo "=============================================="
echo "  SNS Notification Test"
echo "=============================================="
echo "Account:   $ACCOUNT_ID"
echo "Region:    $REGION"
echo "API:       $API_ENDPOINT"
echo "SNS Topic: $TOPIC_ARN"
echo "=============================================="
echo ""

# Check subscriptions
if [ -n "$TOPIC_ARN" ]; then
    echo -e "${BLUE}SNS Subscriptions:${NC}"
    aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
        --query 'Subscriptions[*].[Protocol,Endpoint,SubscriptionArn]' \
        --output table 2>/dev/null || echo "None"
    echo ""
fi

# Create JSON file for bulk submission
cat > /tmp/bulk-job.json <<'EOF'
{
  "batchName": "sns-test-batch",
  "jobs": [
    {
      "source": "https://github.com/spring-projects/spring-petclinic",
      "command": "atx custom def exec -n AWS/early-access-comprehensive-codebase-analysis -p /source/spring-petclinic -x -t"
    },
    {
      "source": "https://github.com/venuvasu/todoapilambda",
      "command": "atx custom def exec -n AWS/early-access-comprehensive-codebase-analysis -p /source/todoapilambda -x -t"
    },
    {
      "source": "https://github.com/aws-samples/aws-appconfig-java-sample",
      "command": "atx custom def exec -n AWS/early-access-comprehensive-codebase-analysis -p /source/aws-appconfig-java-sample -x -t"
    }
  ]
}
EOF

echo -e "${BLUE}Submitting bulk job (3 codebase analysis jobs)...${NC}"
echo ""

RESPONSE=$(python3 "$PROJECT_DIR/utilities/invoke-api.py" \
    --endpoint "$API_ENDPOINT" \
    --path "/jobs/batch" < /tmp/bulk-job.json)

echo "$RESPONSE"
echo ""

BATCH_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('batchId',''))" 2>/dev/null || echo "")

if [ -z "$BATCH_ID" ]; then
    echo -e "${RED}Failed to submit batch${NC}"
    rm -f /tmp/bulk-job.json
    exit 1
fi

echo -e "${GREEN}✓ Batch submitted: $BATCH_ID${NC}"
echo ""
echo -e "${YELLOW}Monitoring progress (Ctrl+C to stop)...${NC}"
echo "You should receive SNS email notifications as jobs complete."
echo ""

# Monitor for 5 minutes
for i in {1..30}; do
    sleep 10
    
    STATUS=$(python3 "$PROJECT_DIR/utilities/invoke-api.py" \
        --endpoint "$API_ENDPOINT" \
        --method GET \
        --path "/jobs/batch/$BATCH_ID" 2>/dev/null || echo "{}")
    
    PROGRESS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('progress',0))" 2>/dev/null || echo "0")
    TOTAL=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalJobs',0))" 2>/dev/null || echo "0")
    SUCCEEDED=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCounts',{}).get('SUCCEEDED',0))" 2>/dev/null || echo "0")
    FAILED=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCounts',{}).get('FAILED',0))" 2>/dev/null || echo "0")
    RUNNING=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCounts',{}).get('RUNNING',0))" 2>/dev/null || echo "0")
    
    echo "[$(date '+%H:%M:%S')] Progress: ${PROGRESS}% | Running: $RUNNING | Succeeded: $SUCCEEDED | Failed: $FAILED"
    
    COMPLETED=$((SUCCEEDED + FAILED))
    if [ "$COMPLETED" -eq "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
        echo ""
        echo -e "${GREEN}✓ All jobs completed!${NC}"
        break
    fi
done

rm -f /tmp/bulk-job.json

echo ""
echo "=============================================="
echo "  Next Steps"
echo "=============================================="
echo ""
echo "1. Check your email for SNS notifications"
echo ""
echo "2. View CloudWatch logs:"
echo "   aws logs tail /aws/batch/atx-transform --follow"
echo ""
echo "3. View results in S3:"
echo "   aws s3 ls s3://atx-custom-output-$ACCOUNT_ID/transformations/"
echo ""
echo "4. Check batch status:"
echo "   python3 utilities/invoke-api.py --endpoint $API_ENDPOINT --method GET --path /jobs/batch/$BATCH_ID"
echo ""
