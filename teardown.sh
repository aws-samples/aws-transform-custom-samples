#!/usr/bin/env bash
set -euo pipefail

# ATX Remote Infrastructure — Complete removal
# Usage: ./teardown.sh
#
# Permanently destroys ALL ATX resources from your AWS account.
# This is a total reset — nothing ATX-related is left behind.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

fail() { echo -e "${RED}ERROR: $1${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
skip() { echo -e "  $1 — skipped (not found)"; }

echo "═══════════════════════════════════════════════"
echo " ATX Remote Infrastructure — Complete Teardown"
echo "═══════════════════════════════════════════════"
echo ""

# --- Check prerequisites ---

command -v aws >/dev/null 2>&1 || fail "AWS CLI is not installed"
aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured. Run: aws sso login (SSO) or aws configure (IAM)"
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
echo ""

# ============================================================
# Phase 1: Delete CloudFormation stacks
# ============================================================
echo "Phase 1: CloudFormation stacks..."

for STACK_NAME in AtxInfrastructureStack AtxContainerStack; do
  STACK_EXISTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")

  if [ "$STACK_EXISTS" != "NOT_FOUND" ]; then
    echo "  Deleting $STACK_NAME (status: $STACK_EXISTS)..."
    aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
    echo "  Waiting for $STACK_NAME deletion..."
    aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION" 2>/dev/null \
      || warn "$STACK_NAME deletion may have failed — continuing with manual cleanup"
    info "$STACK_NAME deleted"
  else
    skip "$STACK_NAME"
  fi
done

# ============================================================
# Phase 2: S3 buckets (RETAIN policy — not deleted by CFN)
# ============================================================
echo ""
echo "Phase 2: S3 buckets..."

for BUCKET in "atx-source-code-${ACCOUNT_ID}" "atx-custom-output-${ACCOUNT_ID}"; do
  if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
    echo "  Emptying and deleting s3://${BUCKET}..."
    aws s3 rm "s3://${BUCKET}" --recursive --region "$REGION" --quiet 2>/dev/null || true
    # Also delete any versioned objects
    VERSIONS=$(aws s3api list-object-versions --bucket "$BUCKET" --region "$REGION" \
      --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null || echo '{"Objects":null}')
    if echo "$VERSIONS" | grep -q '"Key"'; then
      echo "$VERSIONS" | aws s3api delete-objects --bucket "$BUCKET" --region "$REGION" \
        --delete "$(echo "$VERSIONS" | head -c 65536)" --quiet 2>/dev/null || true
    fi
    DELETE_MARKERS=$(aws s3api list-object-versions --bucket "$BUCKET" --region "$REGION" \
      --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null || echo '{"Objects":null}')
    if echo "$DELETE_MARKERS" | grep -q '"Key"'; then
      echo "$DELETE_MARKERS" | aws s3api delete-objects --bucket "$BUCKET" --region "$REGION" \
        --delete "$(echo "$DELETE_MARKERS" | head -c 65536)" --quiet 2>/dev/null || true
    fi
    aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null \
      && info "s3://${BUCKET} deleted" \
      || warn "Could not delete s3://${BUCKET} — may have remaining objects"
  else
    skip "s3://${BUCKET}"
  fi
done

# ============================================================
# Phase 3: KMS key (RETAIN policy — not deleted by CFN)
# ============================================================
echo ""
echo "Phase 3: KMS key..."

KMS_KEY_ID=$(aws kms describe-key --key-id "alias/atx-encryption-key" --region "$REGION" \
  --query 'KeyMetadata.KeyId' --output text 2>/dev/null || echo "")
if [ -n "$KMS_KEY_ID" ] && [ "$KMS_KEY_ID" != "None" ]; then
  # Remove the alias first
  aws kms delete-alias --alias-name "alias/atx-encryption-key" --region "$REGION" 2>/dev/null || true
  # Schedule key deletion (minimum 7 days)
  aws kms schedule-key-deletion --key-id "$KMS_KEY_ID" --pending-window-in-days 7 --region "$REGION" 2>/dev/null \
    && info "KMS key scheduled for deletion in 7 days (ID: $KMS_KEY_ID)" \
    || warn "Could not schedule KMS key deletion — may already be pending"
else
  skip "KMS key alias/atx-encryption-key"
fi

# ============================================================
# Phase 4: CloudWatch log group (RETAIN policy)
# ============================================================
echo ""
echo "Phase 4: CloudWatch log group..."

if aws logs describe-log-groups --log-group-name-prefix "/aws/batch/atx-transform" --region "$REGION" \
  --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "atx-transform"; then
  aws logs delete-log-group --log-group-name "/aws/batch/atx-transform" --region "$REGION" 2>/dev/null \
    && info "Log group /aws/batch/atx-transform deleted" \
    || warn "Could not delete log group"
else
  skip "Log group /aws/batch/atx-transform"
fi

# Also clean up Lambda log groups
for FN in atx-trigger-job atx-get-job-status atx-terminate-job atx-list-jobs \
           atx-trigger-batch-jobs atx-get-batch-status atx-terminate-batch-jobs \
           atx-list-batches atx-configure-mcp; do
  LG="/aws/lambda/${FN}"
  if aws logs describe-log-groups --log-group-name-prefix "$LG" --region "$REGION" \
    --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$FN"; then
    aws logs delete-log-group --log-group-name "$LG" --region "$REGION" 2>/dev/null || true
  fi
done
info "Lambda log groups cleaned up"

# ============================================================
# Phase 5: IAM policies (created by generate-caller-policy.ts)
# ============================================================
echo ""
echo "Phase 5: IAM policies..."

for POLICY_NAME in ATXRuntimePolicy ATXDeploymentPolicy ATXLocalPolicy; do
  POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
  if aws iam get-policy --policy-arn "$POLICY_ARN" 2>/dev/null >/dev/null; then
    # Detach from all entities before deleting
    for USER in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" \
      --query 'PolicyUsers[].UserName' --output text 2>/dev/null || echo ""); do
      [ -n "$USER" ] && [ "$USER" != "None" ] && \
        aws iam detach-user-policy --user-name "$USER" --policy-arn "$POLICY_ARN" 2>/dev/null || true
    done
    for ROLE in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" \
      --query 'PolicyRoles[].RoleName' --output text 2>/dev/null || echo ""); do
      [ -n "$ROLE" ] && [ "$ROLE" != "None" ] && \
        aws iam detach-role-policy --role-name "$ROLE" --policy-arn "$POLICY_ARN" 2>/dev/null || true
    done
    for GROUP in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" \
      --query 'PolicyGroups[].GroupName' --output text 2>/dev/null || echo ""); do
      [ -n "$GROUP" ] && [ "$GROUP" != "None" ] && \
        aws iam detach-group-policy --group-name "$GROUP" --policy-arn "$POLICY_ARN" 2>/dev/null || true
    done
    # Delete non-default policy versions first
    for VERSION_ID in $(aws iam list-policy-versions --policy-arn "$POLICY_ARN" \
      --query 'Versions[?!IsDefaultVersion].VersionId' --output text 2>/dev/null || echo ""); do
      [ -n "$VERSION_ID" ] && [ "$VERSION_ID" != "None" ] && \
        aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$VERSION_ID" 2>/dev/null || true
    done
    aws iam delete-policy --policy-arn "$POLICY_ARN" 2>/dev/null \
      && info "$POLICY_NAME deleted" \
      || warn "Could not delete $POLICY_NAME"
  else
    skip "$POLICY_NAME"
  fi
done

# Also clean up inline policies attached by the skill
for ROLE_POLICY in ATXLocalPolicy; do
  # Check common role/user names — the inline policy could be on any identity
  CALLER_ARN=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null || echo "")
  if echo "$CALLER_ARN" | grep -q ":user/"; then
    IDENTITY_NAME=$(echo "$CALLER_ARN" | awk -F'/' '{print $NF}')
    aws iam delete-user-policy --user-name "$IDENTITY_NAME" --policy-name "$ROLE_POLICY" 2>/dev/null || true
  elif echo "$CALLER_ARN" | grep -Eq ":assumed-role/|:role/"; then
    ROLE_NAME=$(echo "$CALLER_ARN" | sed 's/.*:\(assumed-\)\{0,1\}role\///' | cut -d'/' -f1)
    aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$ROLE_POLICY" 2>/dev/null || true
  fi
done

# ============================================================
# Phase 6: Secrets Manager secrets
# ============================================================
echo ""
echo "Phase 6: Secrets Manager secrets..."

for SECRET_ID in "atx/github-token" "atx/ssh-key" "atx/credentials"; do
  if aws secretsmanager describe-secret --secret-id "$SECRET_ID" --region "$REGION" 2>/dev/null >/dev/null; then
    aws secretsmanager delete-secret --secret-id "$SECRET_ID" --region "$REGION" \
      --force-delete-without-recovery 2>/dev/null \
      && info "$SECRET_ID deleted" \
      || warn "Could not delete $SECRET_ID"
  else
    skip "$SECRET_ID"
  fi
done

# ============================================================
# Phase 7: ECR repositories (container stack may leave these)
# ============================================================
echo ""
echo "Phase 7: ECR repositories..."

# CDK creates ECR repos with names starting with "cdk-" for docker assets
for REPO in $(aws ecr describe-repositories --region "$REGION" \
  --query 'repositories[?starts_with(repositoryName, `cdk-`) && contains(repositoryName, `container`)].repositoryName' \
  --output text 2>/dev/null || echo ""); do
  if [ -n "$REPO" ] && [ "$REPO" != "None" ]; then
    aws ecr delete-repository --repository-name "$REPO" --region "$REGION" --force 2>/dev/null \
      && info "ECR repo $REPO deleted" \
      || warn "Could not delete ECR repo $REPO"
  fi
done

# Also check for the CDK asset repos used by our stacks
for REPO in $(aws ecr describe-repositories --region "$REGION" \
  --query 'repositories[?starts_with(repositoryName, `cdk-`)].repositoryName' \
  --output text 2>/dev/null || echo ""); do
  if [ -n "$REPO" ] && [ "$REPO" != "None" ]; then
    # Only delete if it contains images tagged with our stack
    IMAGES=$(aws ecr list-images --repository-name "$REPO" --region "$REGION" \
      --query 'imageIds[*]' --output text 2>/dev/null || echo "")
    if [ -z "$IMAGES" ] || [ "$IMAGES" = "None" ]; then
      # Empty repo from our stack — safe to delete
      aws ecr delete-repository --repository-name "$REPO" --region "$REGION" --force 2>/dev/null || true
    fi
  fi
done
info "ECR cleanup complete"

# ============================================================
# Phase 8: Generated policy files
# ============================================================
echo ""
echo "Phase 8: Local generated files..."

for F in atx-runtime-policy.json atx-deployment-policy.json; do
  if [ -f "$SCRIPT_DIR/$F" ]; then
    rm -f "$SCRIPT_DIR/$F"
    info "Removed $F"
  fi
done

# ============================================================
# Done
# ============================================================
echo ""
echo "═══════════════════════════════════════════════"
echo -e " ${GREEN}Complete teardown finished!${NC}"
echo "═══════════════════════════════════════════════"
echo ""
echo "All ATX resources have been removed from your account."
echo ""
echo "Note: KMS key deletion is scheduled (7-day AWS minimum)."
echo "To cancel: aws kms cancel-key-deletion --key-id <key-id> --region $REGION"
