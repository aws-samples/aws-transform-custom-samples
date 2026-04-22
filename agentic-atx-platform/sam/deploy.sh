#!/bin/bash
# Option B: Deploy AgentCore + API layer via SAM
# Prerequisites: CDK stacks (Container + Infrastructure) already deployed
set -e

cd "$(dirname "$0")"

echo "=== ATX Transform - SAM Deployment (AgentCore + API) ==="
echo ""

# Check prerequisites
if ! aws sts get-caller-identity &>/dev/null; then
    echo "❌ AWS CLI not configured. Run: aws configure"
    exit 1
fi

if ! command -v sam &>/dev/null; then
    echo "❌ SAM CLI not found. Install: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}
OUTPUT_BUCKET="atx-custom-output-${ACCOUNT_ID}"
SOURCE_BUCKET="atx-source-code-${ACCOUNT_ID}"

echo "Account: ${ACCOUNT_ID}"
echo "Region: ${REGION}"
echo "Output Bucket: ${OUTPUT_BUCKET}"
echo "Source Bucket: ${SOURCE_BUCKET}"
echo ""

# Verify CDK infrastructure exists
echo "1. Verifying CDK infrastructure..."
if ! aws s3 ls "s3://${OUTPUT_BUCKET}" &>/dev/null; then
    echo "❌ Output bucket not found: ${OUTPUT_BUCKET}"
    echo "   Deploy CDK infrastructure first: cd cdk && ./deploy.sh (skip AgentCore stack)"
    exit 1
fi
echo "   ✅ Infrastructure found"
echo ""

# Copy orchestrator files into bundle for Docker build
echo "2. Bundling orchestrator code..."
rm -rf orchestrator-bundle
mkdir -p orchestrator-bundle/tools
cp ../orchestrator/agent.py orchestrator-bundle/
cp ../orchestrator/requirements.txt orchestrator-bundle/
cp ../orchestrator/tools/*.py orchestrator-bundle/tools/
echo "   ✅ Orchestrator bundled"
echo ""

# Build and push orchestrator container to ECR
echo "3. Building orchestrator container..."
ORCH_ECR_REPO="atx-orchestrator"
aws ecr describe-repositories --repository-names ${ORCH_ECR_REPO} --region ${REGION} &>/dev/null || \
  aws ecr create-repository --repository-name ${ORCH_ECR_REPO} --region ${REGION} --image-scanning-configuration scanOnPush=true &>/dev/null
ORCH_ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ORCH_ECR_REPO}"
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com 2>/dev/null
docker build --platform linux/arm64 -t ${ORCH_ECR_REPO}:latest ../orchestrator/ 2>&1 | tail -3
docker tag ${ORCH_ECR_REPO}:latest ${ORCH_ECR_URI}:latest
docker push ${ORCH_ECR_URI}:latest 2>&1 | tail -3
echo "   ✅ Orchestrator container pushed: ${ORCH_ECR_URI}:latest"
echo ""

echo "4. Building SAM application..."
SAM_CLI_CONTAINER_TOOL=docker sam build 2>&1
echo ""

echo "5. Deploying SAM stack..."
sam deploy \
    --stack-name AtxAgentCoreSAM \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --parameter-overrides \
        OutputBucketName="${OUTPUT_BUCKET}" \
        SourceBucketName="${SOURCE_BUCKET}" \
        AwsRegion="${REGION}" \
        OrchestratorContainerUri="${ORCH_ECR_URI}:latest" \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset \
    --region "${REGION}" \
    --resolve-s3 \
    2>&1
echo ""

# Get outputs
API_ENDPOINT=$(aws cloudformation describe-stacks --stack-name AtxAgentCoreSAM --region "${REGION}" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' --output text)

echo "=== SAM Deployment Complete ==="
echo ""
echo "API Endpoint: ${API_ENDPOINT}"
echo ""
echo "Next steps:"
echo "  1. Deploy orchestrator to AgentCore (direct Lambda invocation):"
echo "     aws lambda invoke --function-name atx-deploy-agentcore \\"
echo "       --payload '{\"action\": \"deploy\"}' \\"
echo "       --cli-read-timeout 900 /tmp/deploy-output.json"
echo "     cat /tmp/deploy-output.json"
echo ""
echo "  2. Get the Agent Runtime ARN from the deploy output, then update the Lambda:"
echo "     aws lambda update-function-configuration --function-name atx-async-invoke-agent \\"
echo "       --environment 'Variables={AGENT_RUNTIME_ARN=<arn-from-step-1>,RESULT_BUCKET=${OUTPUT_BUCKET}}'"
echo ""
echo "  3. Build and deploy UI:"
echo "     cd ui && npm install"
echo "     VITE_API_ENDPOINT=${API_ENDPOINT} npx vite build"
echo "     ./deploy-aws.sh"
echo ""
