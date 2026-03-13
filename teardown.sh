#!/usr/bin/env bash
set -euo pipefail

# ATX Remote Infrastructure — Permanent removal
# Usage: ./teardown.sh
#
# Permanently destroys all ATX CDK stacks from your AWS account.
# Only use this if you want to completely remove ATX remote execution
# capability. There is no need to tear down between sessions — the
# infrastructure costs nothing when idle.
#
# Retained after teardown (must delete manually if desired):
#   - S3 buckets (contain transformation results and source code)
#   - KMS encryption key
#   - CloudWatch log group
#   - IAM policies (ATXRuntimePolicy, ATXDeploymentPolicy)
#   - Secrets Manager secrets (atx/github-token, atx/ssh-key, atx/credentials)

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
echo " ATX Remote Infrastructure Teardown"
echo "═══════════════════════════════════════════════"
echo ""

# --- Check prerequisites ---

command -v aws >/dev/null 2>&1 || fail "AWS CLI is not installed"
aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Region resolution: match bin/cdk.ts precedence
SUPPORTED_REGIONS=("us-east-1" "eu-central-1")
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo "")}}"
REGION="${REGION:-us-east-1}"

is_supported=false
for r in "${SUPPORTED_REGIONS[@]}"; do
  [[ "$r" == "$REGION" ]] && is_supported=true && break
done
$is_supported || fail "Region '$REGION' is not supported. Supported: ${SUPPORTED_REGIONS[*]}."

info "AWS Account: $ACCOUNT_ID | Region: $REGION"

# --- Check if deployed ---

STACK_STATUS=$(aws cloudformation describe-stacks --stack-name AtxInfrastructureStack \
  --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_DEPLOYED")

if [ "$STACK_STATUS" = "NOT_DEPLOYED" ]; then
  echo "Infrastructure is not deployed. Nothing to tear down."
  exit 0
fi

info "Found deployed stack (status: $STACK_STATUS)"

# --- Destroy ---

echo ""
echo "Destroying ATX infrastructure..."

# Delete stacks directly via CloudFormation to avoid CDK synthesis issues
# (VPC lookups during synthesis can fail without cached context)
for STACK_NAME in AtxInfrastructureStack AtxContainerStack; do
  STACK_EXISTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")

  if [ "$STACK_EXISTS" != "NOT_FOUND" ]; then
    echo "Deleting $STACK_NAME..."
    aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
    echo "Waiting for $STACK_NAME deletion to complete..."
    aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION" \
      || fail "$STACK_NAME deletion failed. Check CloudFormation console for details."
    info "$STACK_NAME deleted"
  else
    info "$STACK_NAME not found (already deleted)"
  fi
done

echo ""
echo "═══════════════════════════════════════════════"
echo -e " ${GREEN}Teardown complete!${NC}"
echo "═══════════════════════════════════════════════"
echo ""
echo "Deleted:"
echo "  Batch compute environment (Fargate)"
echo "  Batch job queue and job definition"
echo "  Lambda functions (trigger, status, terminate, batch, configure)"
echo "  IAM roles (ATXBatchJobRole, ATXBatchExecutionRole, ATXLambdaRole)"
echo "  Security group"
echo "  CloudWatch dashboard (ATX-Transform-CLI-Dashboard)"
echo "  ECR container image"
echo ""
warn "Retained (auto-expire, no action needed):"
echo "  S3: atx-source-code-${ACCOUNT_ID} — expires in 7 days"
echo "  S3: atx-custom-output-${ACCOUNT_ID} — expires in 30 days"
echo "  CloudWatch log group: /aws/batch/atx-transform — expires in 30 days"
echo ""
warn "Retained (must delete manually if desired):"
echo "  KMS key: atx-encryption-key (\$1/month until deleted)"
echo "    aws kms schedule-key-deletion --key-id alias/atx-encryption-key --pending-window-in-days 7"
echo ""
warn "Not created by CDK (delete manually if desired):"
echo "  IAM policies: ATXRuntimePolicy, ATXDeploymentPolicy"
echo "  Secrets Manager: atx/github-token, atx/ssh-key, atx/credentials"
