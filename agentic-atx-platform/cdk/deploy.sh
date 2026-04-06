#!/bin/bash
set -e

echo "=========================================="
echo "AWS Transform CLI - CDK Deployment"
echo "=========================================="
echo ""

cd "$(dirname "$0")"

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &>/dev/null; then
    echo "❌ AWS CLI is not configured"
    echo "   Run: aws configure"
    exit 1
fi

# Get AWS account and region
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region || echo "us-east-1")

export CDK_DEFAULT_ACCOUNT=$AWS_ACCOUNT
export CDK_DEFAULT_REGION=$AWS_REGION

echo "✓ AWS Account: $AWS_ACCOUNT"
echo "✓ AWS Region: $AWS_REGION"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install
echo ""

# Login to ECR Public (required for Docker base image pull)
echo "Authenticating with ECR Public..."
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws 2>/dev/null || echo "ECR Public login skipped (may not be needed)"
echo ""

# Build TypeScript
echo "Building CDK project..."
npm run build
echo ""

# Bootstrap CDK (if not already done)
echo "Checking CDK bootstrap..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &>/dev/null; then
    echo "Bootstrapping CDK..."
    cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION
else
    echo "✓ CDK already bootstrapped"
fi
echo ""

# Deploy all stacks
echo "Deploying stacks..."
echo "  1. AtxContainerStack (ECR + Docker Image)"
echo "  2. AtxInfrastructureStack (Batch, S3, IAM)"
echo "  3. AtxAgentCoreStack (AgentCore + Lambda + HTTP API) [Experimental]"
echo "  4. AtxUiStack (S3 + CloudFront)"
echo ""

# Use global cdk CLI (not npx) to avoid version conflicts with alpha packages
CDK_DEFAULT_ACCOUNT=$AWS_ACCOUNT CDK_DEFAULT_REGION=$AWS_REGION cdk deploy --all --require-approval never

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo '  1. Get API endpoint:'
echo '     aws cloudformation describe-stacks --stack-name AtxAgentCoreStack --query "Stacks[0].Outputs[?OutputKey=='"'"'ApiEndpoint'"'"'].OutputValue" --output text'
echo '  2. Build and deploy UI with the API endpoint (see README.md Step 5)'
echo ""
