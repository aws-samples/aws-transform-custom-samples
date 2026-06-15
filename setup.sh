#!/usr/bin/env bash
set -euo pipefail

# ATX Remote Infrastructure — One-command setup
# Usage: ./setup.sh
#
# Handles everything needed to deploy ATX remote transformation
# infrastructure to your AWS account:
#   1. Checks prerequisites (Node.js, npm, Docker*, AWS CLI, credentials)
#      *Docker is only required when building a custom container image
#       (i.e., when prebuiltImageUri is empty in npx cdk.json)
#   2. Installs npm dependencies
#   3. Compiles TypeScript
#   4. Bootstraps CDK (if needed)
#   5. Deploys all stacks
#
# Idempotent — safe to run multiple times.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

fail() { echo -e "${RED}ERROR: $1${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

echo "═══════════════════════════════════════════════"
echo " ATX Remote Infrastructure Setup"
echo "═══════════════════════════════════════════════"
echo ""

# --- Prerequisite checks ---

echo "Checking prerequisites..."

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install: brew install node (macOS) or https://nodejs.org/"
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js v18+ required (found $(node -v))"
info "Node.js $(node -v)"

command -v npm >/dev/null 2>&1 || fail "npm is not installed"
info "npm $(npm -v)"

# Check if using a pre-built image (Docker not required)
PREBUILT_IMAGE_URI=$(node -e "console.log(require('./cdk.json').context.prebuiltImageUri || '')" 2>/dev/null || echo "")
if [ -z "$PREBUILT_IMAGE_URI" ]; then
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install: https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || fail "Docker is not running. Please start Docker Desktop and try again."
  info "Docker is running"
else
  info "Using pre-built image (Docker not required)"
fi

command -v aws >/dev/null 2>&1 || fail "AWS CLI is not installed. Install: brew install awscli (macOS)"
info "AWS CLI $(aws --version 2>&1 | head -1)"

aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured. Run: aws configure sso"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Region resolution: match bin/npx cdk.ts precedence
SUPPORTED_REGIONS=("us-east-1" "eu-central-1")
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo "")}}"
REGION="${REGION:-us-east-1}"

is_supported=false
for r in "${SUPPORTED_REGIONS[@]}"; do
  [[ "$r" == "$REGION" ]] && is_supported=true && break
done
$is_supported || fail "Region '$REGION' is not supported by AWS Transform Custom. Supported: ${SUPPORTED_REGIONS[*]}. Set a supported region via AWS_REGION, 'aws configure set region <region>', or -c awsRegion=<region>."

info "AWS Account: $ACCOUNT_ID | Region: $REGION"

# region and account exports
export AWS_DEFAULT_REGION="$REGION"
export CDK_DEFAULT_REGION="$REGION"
export CDK_DEFAULT_ACCOUNT="$ACCOUNT_ID"

echo ""

# --- Validate network configuration (mandatory) ---

echo "Checking network configuration..."
EXISTING_VPC_ID=$(node -e "console.log(require('./cdk.json').context.existingVpcId || '')" 2>/dev/null || echo "")
EXISTING_SUBNET_IDS=$(node -e "const s=require('./cdk.json').context.existingSubnetIds||[];console.log(s.length?'ok':'')" 2>/dev/null || echo "")
EXISTING_SG_ID=$(node -e "console.log(require('./cdk.json').context.existingSecurityGroupId || '')" 2>/dev/null || echo "")

[ -z "$EXISTING_VPC_ID" ] && fail "existingVpcId is not set in cdk.json. You must provide a VPC ID before deploying. AWS Transform does NOT create VPCs — you provide one."
[ -z "$EXISTING_SUBNET_IDS" ] && fail "existingSubnetIds is empty in cdk.json. You must provide at least two subnet IDs before deploying."
[ -z "$EXISTING_SG_ID" ] && fail "existingSecurityGroupId is not set in cdk.json. You must provide a security group ID before deploying."
info "Network: VPC=$EXISTING_VPC_ID, SG=$EXISTING_SG_ID"

echo ""

# --- Detect existing S3 buckets (auto-populate context to avoid CREATE conflict) ---

echo "Checking for existing S3 buckets..."
SOURCE_BUCKET="atx-source-code-${ACCOUNT_ID}"
OUTPUT_BUCKET="atx-custom-output-${ACCOUNT_ID}"
CT_OUTPUT_BUCKET="atx-ct-output-${ACCOUNT_ID}"

UPDATED_CDK_JSON=false

if aws s3api head-bucket --bucket "$SOURCE_BUCKET" --region "$REGION" 2>/dev/null; then
  CURRENT_SOURCE=$(node -e "console.log(require('./cdk.json').context.existingSourceBucket || '')" 2>/dev/null || echo "")
  if [ -z "$CURRENT_SOURCE" ]; then
    node -e "const f='./cdk.json';const c=JSON.parse(require('fs').readFileSync(f));c.context.existingSourceBucket='${SOURCE_BUCKET}';require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n')"
    UPDATED_CDK_JSON=true
  fi
  info "Source bucket exists: $SOURCE_BUCKET (will import)"
fi

if aws s3api head-bucket --bucket "$OUTPUT_BUCKET" --region "$REGION" 2>/dev/null; then
  CURRENT_OUTPUT=$(node -e "console.log(require('./cdk.json').context.existingOutputBucket || '')" 2>/dev/null || echo "")
  if [ -z "$CURRENT_OUTPUT" ]; then
    node -e "const f='./cdk.json';const c=JSON.parse(require('fs').readFileSync(f));c.context.existingOutputBucket='${OUTPUT_BUCKET}';require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n')"
    UPDATED_CDK_JSON=true
  fi
  info "Output bucket exists: $OUTPUT_BUCKET (will import)"
fi

if aws s3api head-bucket --bucket "$CT_OUTPUT_BUCKET" --region "$REGION" 2>/dev/null; then
  CURRENT_CT_OUTPUT=$(node -e "console.log(require('./cdk.json').context.existingCtOutputBucket || '')" 2>/dev/null || echo "")
  if [ -z "$CURRENT_CT_OUTPUT" ]; then
    node -e "const f='./cdk.json';const c=JSON.parse(require('fs').readFileSync(f));c.context.existingCtOutputBucket='${CT_OUTPUT_BUCKET}';require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n')"
    UPDATED_CDK_JSON=true
  fi
  info "CT output bucket exists: $CT_OUTPUT_BUCKET (will import)"
fi

if $UPDATED_CDK_JSON; then
  warn "Updated cdk.json to import pre-existing S3 buckets (avoids CREATE conflict)"
fi

echo ""

# --- Install dependencies ---

echo "Installing dependencies..."
if [ -f "package-lock.json" ]; then
  npm ci --silent
else
  npm install --silent
fi
info "Dependencies installed"

# --- Compile TypeScript ---

echo "Compiling TypeScript..."
npx tsc
info "TypeScript compiled"

CDK="npx cdk"
info "CDK CLI $($CDK --version 2>&1 | head -1)"

# --- Bootstrap CDK (idempotent) ---

echo "Bootstrapping CDK (if needed)..."
if ! $CDK bootstrap "aws://${ACCOUNT_ID}/${REGION}" --qualifier atxinfra; then
  fail "CDK bootstrap failed. Check the error above."
fi
info "CDK bootstrapped"

# --- Deploy ---

echo ""
echo "Deploying ATX infrastructure..."
if [ -z "$PREBUILT_IMAGE_URI" ]; then
  echo "Building container image locally and pushing to ECR..."
  echo "This may take 5-10 minutes on first deploy."
else
  echo "Using pre-built container image. This may take 3-5 minutes on first deploy."
fi
echo ""
$CDK deploy --all --require-approval never

# --- Verify deployment ---

echo ""
echo "Verifying deployment..."
STACKS_TO_VERIFY="AtxInfrastructureStack"
if [ -z "$PREBUILT_IMAGE_URI" ]; then
  STACKS_TO_VERIFY="AtxContainerStack AtxInfrastructureStack"
fi
for STACK_NAME in $STACKS_TO_VERIFY; do
  STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
  case "$STACK_STATUS" in
    CREATE_COMPLETE|UPDATE_COMPLETE|UPDATE_ROLLBACK_COMPLETE)
      info "$STACK_NAME: $STACK_STATUS"
      ;;
    *)
      fail "$STACK_NAME deployment failed (status: $STACK_STATUS). Run 'npx cdk deploy --all' to retry."
      ;;
  esac
done

# --- Scheduler role (idempotent) ---

echo ""
echo "Configuring scheduler role..."
SCHEDULER_ROLE_NAME="AtxSchedulerInvocationRole"
LAMBDA_POLICY_NAME="lambda-invoke-batch-trigger"
LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:atx-trigger-batch-jobs"

if aws iam get-role --role-name "$SCHEDULER_ROLE_NAME" >/dev/null 2>&1; then
  info "$SCHEDULER_ROLE_NAME exists"
else
  aws iam create-role --role-name "$SCHEDULER_ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "scheduler.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
  info "$SCHEDULER_ROLE_NAME created"
fi

EXPECTED_POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"${LAMBDA_ARN}\"}]}"
CURRENT_POLICY=$(aws iam get-role-policy --role-name "$SCHEDULER_ROLE_NAME" --policy-name "$LAMBDA_POLICY_NAME" \
  --query 'PolicyDocument' --output json 2>/dev/null | jq -c '.' 2>/dev/null || echo "")

if [ "$CURRENT_POLICY" != "$EXPECTED_POLICY" ]; then
  aws iam put-role-policy --role-name "$SCHEDULER_ROLE_NAME" \
    --policy-name "$LAMBDA_POLICY_NAME" \
    --policy-document "$EXPECTED_POLICY"
  info "$LAMBDA_POLICY_NAME policy attached"
else
  info "$LAMBDA_POLICY_NAME policy already correct"
fi

echo ""
echo "═══════════════════════════════════════════════"
echo -e " ${GREEN}Setup complete!${NC}"
echo "═══════════════════════════════════════════════"
echo ""
echo "Lambda functions deployed:"
echo "  atx-trigger-job          atx-get-job-status"
echo "  atx-trigger-batch-jobs   atx-get-batch-status"
echo "  atx-terminate-job        atx-terminate-batch-jobs"
echo "  atx-list-jobs            atx-list-batches"
echo ""
echo "S3 buckets:"
echo "  atx-source-code-${ACCOUNT_ID}"
echo "  atx-custom-output-${ACCOUNT_ID}"
echo "  atx-ct-output-${ACCOUNT_ID}"
echo ""
echo "CloudWatch dashboard: ATX-Transform-CLI-Dashboard"
