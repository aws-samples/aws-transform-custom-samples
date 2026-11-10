#!/bin/bash
set -e

echo "=========================================="
echo "AWS Transform CLI - CDK Cleanup"
echo "=========================================="
echo ""

cd "$(dirname "$0")"

# Get AWS account
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")

if [ -z "$AWS_ACCOUNT" ]; then
    echo "❌ AWS CLI is not configured"
    echo "   Run: aws configure"
    exit 1
fi

echo "⚠️  This will delete all deployed resources:"
echo "  - Lambda functions and API Gateway"
echo "  - Batch compute environment, job queue, job definition"
echo "  - S3 buckets (if empty)"
echo "  - IAM roles"
echo "  - CloudWatch log groups"
echo "  - ECR repository"
echo ""
echo "Note: This does NOT remove the CDK bootstrap stack (CDKToolkit)."
echo "      To remove everything including bootstrap, use: ./cleanup-bootstrap.sh"
echo ""
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Destroying stacks..."
npx cdk destroy --all --force

echo ""
echo "=========================================="
echo "✅ Cleanup Complete!"
echo "=========================================="
echo ""
echo "Note: S3 buckets with data are retained by default."
echo "To delete them manually:"
echo "  aws s3 rb s3://atx-custom-output-${AWS_ACCOUNT} --force"
echo "  aws s3 rb s3://atx-source-code-${AWS_ACCOUNT} --force"
echo ""
echo "To remove CDK bootstrap resources:"
echo "  ./cleanup-bootstrap.sh"
echo ""
