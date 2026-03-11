#!/bin/bash
set -e

# Generate IAM policies for the ATX remote execution caller.
#
# Produces two policies:
#   1. atx-deployment-policy.json  — One-time CDK deployment (cdk deploy/destroy)
#   2. atx-runtime-policy.json     — Day-to-day operations (invoke Lambdas, S3 sync)
#
# The runtime policy is what the agent's AWS credentials need for a fully
# hands-off remote mode experience. The deployment policy is only needed
# when setting up or tearing down the infrastructure.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_POLICY="$SCRIPT_DIR/atx-deployment-policy.json"
RUNTIME_POLICY="$SCRIPT_DIR/atx-runtime-policy.json"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1"; }

echo "=========================================="
echo "Generate ATX Caller IAM Policies"
echo "=========================================="
echo ""

# Auto-detect AWS account and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)
if [[ -z "$AWS_ACCOUNT_ID" ]]; then
    log_warning "Could not detect AWS Account ID. Using placeholder."
    AWS_ACCOUNT_ID="REPLACE_WITH_ACCOUNT_ID"
else
    log_info "AWS Account: $AWS_ACCOUNT_ID"
fi

AWS_REGION=$(aws configure get region 2>/dev/null || echo "")
AWS_REGION="${AWS_REGION:-us-east-1}"
log_info "AWS Region:  $AWS_REGION"

# Resource names (must match CDK stack definitions)
S3_OUTPUT_BUCKET="atx-custom-output-${AWS_ACCOUNT_ID}"
S3_SOURCE_BUCKET="atx-source-code-${AWS_ACCOUNT_ID}"
S3_LOG_BUCKET="atx-logs-${AWS_ACCOUNT_ID}"
LOG_GROUP="/aws/batch/atx-transform"
KMS_ALIAS="atx-encryption-key"
COMPUTE_ENV="atx-fargate-compute"
JOB_QUEUE="atx-job-queue"
JOB_DEFINITION="atx-transform-job"
DASHBOARD_NAME="ATX-Transform-CLI-Dashboard"

echo ""
log_info "Generating policies for these resources:"
echo "  • S3 Output:    $S3_OUTPUT_BUCKET"
echo "  • S3 Source:    $S3_SOURCE_BUCKET"
echo "  • S3 Logs:      $S3_LOG_BUCKET"
echo "  • Log Group:    $LOG_GROUP"
echo "  • KMS Alias:    $KMS_ALIAS"
echo "  • Job Queue:    $JOB_QUEUE"
echo "  • Job Def:      $JOB_DEFINITION"
echo ""

# ============================================================================
# Policy 1: Runtime (day-to-day agent operations)
# ============================================================================
cat > "$RUNTIME_POLICY" << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ATXTransformCustomAPI",
      "Effect": "Allow",
      "Action": "transform-custom:*",
      "Resource": "*"
    },
    {
      "Sid": "LambdaInvokeATXFunctions",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": [
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-trigger-job",
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-get-job-status",
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-terminate-job",
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-list-jobs",
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-trigger-batch-jobs",
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-get-batch-status",
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-terminate-batch-jobs",
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-list-batches",
        "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-configure-mcp"
      ]
    },
    {
      "Sid": "S3UploadSourceCode",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${S3_SOURCE_BUCKET}",
        "arn:aws:s3:::${S3_SOURCE_BUCKET}/*"
      ]
    },
    {
      "Sid": "S3DownloadResults",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${S3_OUTPUT_BUCKET}",
        "arn:aws:s3:::${S3_OUTPUT_BUCKET}/*"
      ]
    },
    {
      "Sid": "KMSEncryptDecrypt",
      "Effect": "Allow",
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "arn:aws:kms:${AWS_REGION}:${AWS_ACCOUNT_ID}:alias/${KMS_ALIAS}"
    },
    {
      "Sid": "SecretsManagerATXCredentials",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:DeleteSecret",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:atx/*"
    },
    {
      "Sid": "CloudWatchReadLogs",
      "Effect": "Allow",
      "Action": [
        "logs:GetLogEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:${LOG_GROUP}*"
    },
    {
      "Sid": "CheckInfrastructureStatus",
      "Effect": "Allow",
      "Action": "cloudformation:DescribeStacks",
      "Resource": "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/AtxInfrastructureStack/*"
    },
    {
      "Sid": "STSIdentity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
EOF

log_success "Runtime policy generated: $RUNTIME_POLICY"

# ============================================================================
# Policy 2: Deployment (one-time CDK deploy/destroy)
# ============================================================================
cat > "$DEPLOY_POLICY" << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationFullStacks",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:GetTemplate",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet",
        "cloudformation:ListStacks"
      ],
      "Resource": [
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/AtxContainerStack/*",
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/AtxInfrastructureStack/*",
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/CDKToolkit/*"
      ]
    },
    {
      "Sid": "CDKBootstrapS3",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetEncryptionConfiguration",
        "s3:PutEncryptionConfiguration",
        "s3:PutBucketVersioning",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutLifecycleConfiguration",
        "s3:PutBucketPolicy",
        "s3:GetBucketPolicy"
      ],
      "Resource": [
        "arn:aws:s3:::cdk-*-assets-${AWS_ACCOUNT_ID}-${AWS_REGION}",
        "arn:aws:s3:::cdk-*-assets-${AWS_ACCOUNT_ID}-${AWS_REGION}/*",
        "arn:aws:s3:::${S3_OUTPUT_BUCKET}",
        "arn:aws:s3:::${S3_OUTPUT_BUCKET}/*",
        "arn:aws:s3:::${S3_SOURCE_BUCKET}",
        "arn:aws:s3:::${S3_SOURCE_BUCKET}/*",
        "arn:aws:s3:::${S3_LOG_BUCKET}",
        "arn:aws:s3:::${S3_LOG_BUCKET}/*"
      ]
    },
    {
      "Sid": "ECRContainerImage",
      "Effect": "Allow",
      "Action": [
        "ecr:CreateRepository",
        "ecr:DescribeRepositories",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
        "ecr:SetRepositoryPolicy",
        "ecr:GetRepositoryPolicy"
      ],
      "Resource": "arn:aws:ecr:${AWS_REGION}:${AWS_ACCOUNT_ID}:repository/cdk-*"
    },
    {
      "Sid": "ECRAuthToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "IAMRolesForATX",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PassRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:GetRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:TagRole",
        "iam:UntagRole"
      ],
      "Resource": [
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ATXBatchJobRole",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ATXBatchExecutionRole",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ATXLambdaRole",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/cdk-*"
      ]
    },
    {
      "Sid": "LambdaManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:TagResource",
        "lambda:ListTags"
      ],
      "Resource": "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:atx-*"
    },
    {
      "Sid": "BatchManagement",
      "Effect": "Allow",
      "Action": [
        "batch:CreateComputeEnvironment",
        "batch:UpdateComputeEnvironment",
        "batch:DeleteComputeEnvironment",
        "batch:CreateJobQueue",
        "batch:UpdateJobQueue",
        "batch:DeleteJobQueue",
        "batch:RegisterJobDefinition",
        "batch:DeregisterJobDefinition",
        "batch:DescribeComputeEnvironments",
        "batch:DescribeJobQueues",
        "batch:DescribeJobDefinitions",
        "batch:TagResource"
      ],
      "Resource": [
        "arn:aws:batch:${AWS_REGION}:${AWS_ACCOUNT_ID}:compute-environment/${COMPUTE_ENV}",
        "arn:aws:batch:${AWS_REGION}:${AWS_ACCOUNT_ID}:job-queue/${JOB_QUEUE}",
        "arn:aws:batch:${AWS_REGION}:${AWS_ACCOUNT_ID}:job-definition/${JOB_DEFINITION}",
        "arn:aws:batch:${AWS_REGION}:${AWS_ACCOUNT_ID}:job-definition/${JOB_DEFINITION}:*"
      ]
    },
    {
      "Sid": "EC2NetworkForBatch",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:CreateTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "KMSKeyManagement",
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:CreateAlias",
        "kms:DeleteAlias",
        "kms:DescribeKey",
        "kms:EnableKeyRotation",
        "kms:GetKeyPolicy",
        "kms:PutKeyPolicy",
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:TagResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogsAndDashboard",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:PutRetentionPolicy",
        "logs:DescribeLogGroups",
        "logs:TagResource"
      ],
      "Resource": [
        "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:${LOG_GROUP}*",
        "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/lambda/atx-*"
      ]
    },
    {
      "Sid": "CloudWatchDashboard",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutDashboard",
        "cloudwatch:DeleteDashboards",
        "cloudwatch:GetDashboard"
      ],
      "Resource": "arn:aws:cloudwatch::${AWS_ACCOUNT_ID}:dashboard/${DASHBOARD_NAME}"
    },
    {
      "Sid": "SSMForCDKBootstrap",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:PutParameter"
      ],
      "Resource": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/cdk-bootstrap/*"
    },
    {
      "Sid": "STSIdentity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
EOF

log_success "Deployment policy generated: $DEPLOY_POLICY"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "=========================================="
echo "Policy Summary"
echo "=========================================="
echo ""
echo "Two policies generated:"
echo ""
echo "  1. ${RUNTIME_POLICY##*/}"
echo "     Day-to-day operations: invoke Lambdas, upload source to S3,"
echo "     download results, manage private repo secrets, read logs."
echo "     This is what the agent needs for a hands-off remote mode."
echo ""
echo "  2. ${DEPLOY_POLICY##*/}"
echo "     One-time infrastructure setup: CDK deploy, CloudFormation,"
echo "     ECR, IAM roles, Batch, KMS, VPC, CloudWatch."
echo "     Only needed when deploying or destroying the stacks."
echo ""
echo "Usage:"
echo ""
echo "  # Create the policies"
echo "  aws iam create-policy \\"
echo "    --policy-name ATXRuntimePolicy \\"
echo "    --policy-document file://${RUNTIME_POLICY}"
echo ""
echo "  aws iam create-policy \\"
echo "    --policy-name ATXDeploymentPolicy \\"
echo "    --policy-document file://${DEPLOY_POLICY}"
echo ""
echo "  # Attach to your IAM user or role"
echo "  aws iam attach-user-policy \\"
echo "    --user-name YOUR_USERNAME \\"
echo "    --policy-arn arn:aws:iam::${AWS_ACCOUNT_ID}:policy/ATXRuntimePolicy"
echo ""

if [[ "$AWS_ACCOUNT_ID" == "REPLACE_WITH_ACCOUNT_ID" ]]; then
    echo ""
    log_warning "Account ID could not be detected."
    echo "Replace 'REPLACE_WITH_ACCOUNT_ID' in both policy files with your actual AWS account ID."
fi

echo ""
echo "To regenerate after changes: ./generate-caller-policy.sh"
echo ""
