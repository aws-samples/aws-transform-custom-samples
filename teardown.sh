#!/usr/bin/env bash
# Do NOT use set -e — teardown must continue past individual failures
set -uo pipefail

# ATX Remote Infrastructure — Complete removal
# Usage: ./teardown.sh
#
# Permanently destroys ALL ATX resources from your AWS account.
# This is a total reset — nothing ATX-related is left behind.
# Resilient: continues past individual failures and reports at the end.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
fail() { echo -e "${RED}ERROR: $1${NC}" >&2; exit 1; }
info() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ERRORS=$((ERRORS + 1)); }
skip() { echo -e "  $1 — skipped (not found)"; }

echo "═══════════════════════════════════════════════"
echo " ATX Remote Infrastructure — Complete Teardown"
echo "═══════════════════════════════════════════════"
echo ""

# --- Check prerequisites (these are fatal) ---

command -v aws >/dev/null 2>&1 || fail "AWS CLI is not installed"
aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured. Run: aws sso login (SSO) or aws configure (IAM)"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

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
  STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")

  if [ "$STACK_STATUS" = "NOT_FOUND" ]; then
    skip "$STACK_NAME"
    continue
  fi

  echo "  Deleting $STACK_NAME (status: $STACK_STATUS)..."

  # ROLLBACK_COMPLETE can be deleted directly.
  # DELETE_FAILED needs --retain-resources to force past stuck resources.
  if [[ "$STACK_STATUS" == "DELETE_FAILED" ]]; then
    RETAIN_IDS=$(aws cloudformation list-stack-resources --stack-name "$STACK_NAME" --region "$REGION" \
      --query 'StackResourceSummaries[?ResourceStatus!=`DELETE_COMPLETE`].LogicalResourceId' --output text 2>/dev/null || echo "")
    if [ -n "$RETAIN_IDS" ] && [ "$RETAIN_IDS" != "None" ]; then
      echo "  Retaining stuck resources: $RETAIN_IDS"
      # shellcheck disable=SC2086
      aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION" \
        --retain-resources $RETAIN_IDS 2>&1 || true
    else
      aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION" 2>&1 || true
    fi
  else
    aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION" 2>&1 || true
  fi

  echo "  Waiting for $STACK_NAME deletion (up to 5 minutes)..."
  if aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION" 2>/dev/null; then
    info "$STACK_NAME deleted"
  else
    warn "$STACK_NAME deletion may have failed — continuing with manual cleanup"
  fi
done

# ============================================================
# Helper: Empty a versioned S3 bucket (deletes all objects,
# versions, and delete markers)
# ============================================================
empty_versioned_bucket() {
  local bucket="$1"
  local region="$2"

  # Delete current objects
  aws s3 rm "s3://${bucket}" --recursive --region "$region" --quiet 2>/dev/null || true

  # Delete all versions and delete markers in a loop
  local key_marker="" version_marker=""
  while true; do
    local list_args=(--bucket "$bucket" --region "$region" --output json --max-keys 500)
    [[ -n "$key_marker" ]] && list_args+=(--key-marker "$key_marker" --version-id-marker "$version_marker")

    local response
    response=$(aws s3api list-object-versions "${list_args[@]}" 2>/dev/null || echo '{}')

    local payload
    payload=$(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
objects = []
for v in data.get('Versions', []):
    objects.append({'Key': v['Key'], 'VersionId': v['VersionId']})
for d in data.get('DeleteMarkers', []):
    objects.append({'Key': d['Key'], 'VersionId': d['VersionId']})
if objects:
    print(json.dumps({'Objects': objects[:1000], 'Quiet': True}))
" 2>/dev/null || echo "")

    if [[ -z "$payload" ]]; then
      break
    fi

    aws s3api delete-objects --bucket "$bucket" --region "$region" \
      --delete "$payload" 2>/dev/null || true

    # Check if there are more versions to process
    local is_truncated
    is_truncated=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('IsTruncated', False))" 2>/dev/null || echo "False")
    if [[ "$is_truncated" != "True" ]]; then
      break
    fi

    key_marker=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('NextKeyMarker',''))" 2>/dev/null || echo "")
    version_marker=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('NextVersionIdMarker',''))" 2>/dev/null || echo "")
  done
}

# ============================================================
# Phase 2: S3 buckets (RETAIN policy — not deleted by CFN)
# ============================================================
echo ""
echo "Phase 2: S3 buckets..."

for BUCKET in "atx-source-code-${ACCOUNT_ID}" "atx-custom-output-${ACCOUNT_ID}" "atx-logs-${ACCOUNT_ID}"; do
  if ! aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
    skip "s3://${BUCKET}"
    continue
  fi

  echo "  Emptying s3://${BUCKET}..."
  empty_versioned_bucket "$BUCKET" "$REGION"

  if aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION" 2>&1; then
    info "s3://${BUCKET} deleted"
  else
    warn "Could not delete s3://${BUCKET} (see error above)"
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
  aws kms delete-alias --alias-name "alias/atx-encryption-key" --region "$REGION" 2>/dev/null || true
  if aws kms schedule-key-deletion --key-id "$KMS_KEY_ID" --pending-window-in-days 7 --region "$REGION" 2>/dev/null; then
    info "KMS key scheduled for deletion in 7 days (ID: $KMS_KEY_ID)"
  else
    warn "Could not schedule KMS key deletion — may already be pending"
  fi
else
  skip "KMS key alias/atx-encryption-key"
fi

# ============================================================
# Phase 4: CloudWatch log groups
# ============================================================
echo ""
echo "Phase 4: CloudWatch log groups..."

ALL_LOG_GROUPS=("/aws/batch/atx-transform" "/aws/batch/job")
for FN in atx-trigger-job atx-get-job-status atx-terminate-job atx-list-jobs \
           atx-trigger-batch-jobs atx-get-batch-status atx-terminate-batch-jobs \
           atx-list-batches atx-configure-mcp; do
  ALL_LOG_GROUPS+=("/aws/lambda/${FN}")
done

LOGS_FOUND=false
for LG in "${ALL_LOG_GROUPS[@]}"; do
  if aws logs delete-log-group --log-group-name "$LG" --region "$REGION" 2>/dev/null; then
    info "Log group $LG deleted"
    LOGS_FOUND=true
  fi
done
$LOGS_FOUND || skip "No ATX log groups found"

# ============================================================
# Phase 5: IAM policies
# ============================================================
echo ""
echo "Phase 5: IAM policies..."

for POLICY_NAME in ATXRuntimePolicy ATXDeploymentPolicy ATXLocalPolicy; do
  POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
  if ! aws iam get-policy --policy-arn "$POLICY_ARN" 2>/dev/null >/dev/null; then
    skip "$POLICY_NAME"
    continue
  fi

  # Detach from all entities
  for USER in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" \
    --query 'PolicyUsers[].UserName' --output text 2>/dev/null); do
    [ "$USER" = "None" ] && continue
    aws iam detach-user-policy --user-name "$USER" --policy-arn "$POLICY_ARN" 2>/dev/null || true
  done
  for ROLE in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" \
    --query 'PolicyRoles[].RoleName' --output text 2>/dev/null); do
    [ "$ROLE" = "None" ] && continue
    aws iam detach-role-policy --role-name "$ROLE" --policy-arn "$POLICY_ARN" 2>/dev/null || true
  done
  for GROUP in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" \
    --query 'PolicyGroups[].GroupName' --output text 2>/dev/null); do
    [ "$GROUP" = "None" ] && continue
    aws iam detach-group-policy --group-name "$GROUP" --policy-arn "$POLICY_ARN" 2>/dev/null || true
  done

  # Delete non-default versions
  for VID in $(aws iam list-policy-versions --policy-arn "$POLICY_ARN" \
    --query 'Versions[?!IsDefaultVersion].VersionId' --output text 2>/dev/null); do
    [ "$VID" = "None" ] && continue
    aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$VID" 2>/dev/null || true
  done

  if aws iam delete-policy --policy-arn "$POLICY_ARN" 2>/dev/null; then
    info "$POLICY_NAME deleted"
  else
    warn "Could not delete $POLICY_NAME"
  fi
done

# Clean up inline ATXLocalPolicy from current caller
CALLER_ARN=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null || echo "")
if echo "$CALLER_ARN" | grep -q ":user/"; then
  IDENTITY_NAME=$(echo "$CALLER_ARN" | awk -F'/' '{print $NF}')
  aws iam delete-user-policy --user-name "$IDENTITY_NAME" --policy-name ATXLocalPolicy 2>/dev/null || true
elif echo "$CALLER_ARN" | grep -Eq ":assumed-role/|:role/"; then
  ROLE_NAME=$(echo "$CALLER_ARN" | sed 's/.*:\(assumed-\)\{0,1\}role\///' | cut -d'/' -f1)
  aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name ATXLocalPolicy 2>/dev/null || true
fi

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
# Phase 7: ECR repositories
# ============================================================
echo ""
echo "Phase 7: ECR repositories..."

# CDK asset repos follow the pattern: cdk-{qualifier}-container-assets-{account}-{region}
ECR_FOUND=false
for REPO in $(aws ecr describe-repositories --region "$REGION" \
  --query 'repositories[?starts_with(repositoryName, `cdk-atxinfra-container-assets-`)].repositoryName' \
  --output text 2>/dev/null || echo ""); do
  [ "$REPO" = "None" ] && continue
  [ -z "$REPO" ] && continue
  ECR_FOUND=true
  aws ecr delete-repository --repository-name "$REPO" --region "$REGION" --force 2>/dev/null \
    && info "ECR repo $REPO deleted" \
    || warn "Could not delete ECR repo $REPO"
done
$ECR_FOUND || skip "No ATX ECR repositories found"

# ============================================================
# Phase 8: CDK bootstrap (our custom qualifier)
# ============================================================
echo ""
echo "Phase 8: CDK bootstrap resources..."

CDK_BUCKET="cdk-atxinfra-assets-${ACCOUNT_ID}-${REGION}"
if aws s3api head-bucket --bucket "$CDK_BUCKET" --region "$REGION" 2>/dev/null; then
  echo "  Emptying and deleting s3://${CDK_BUCKET}..."
  empty_versioned_bucket "$CDK_BUCKET" "$REGION"
  if aws s3api delete-bucket --bucket "$CDK_BUCKET" --region "$REGION" 2>&1; then
    info "CDK bootstrap bucket deleted"
  else
    warn "Could not delete CDK bootstrap bucket (see error above)"
  fi
else
  skip "CDK bootstrap bucket ($CDK_BUCKET)"
fi

# Delete the CDK bootstrap stack (uses our custom qualifier)
CDK_STACK_STATUS=$(aws cloudformation describe-stacks --stack-name CDKToolkit-atxinfra \
  --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
if [ "$CDK_STACK_STATUS" != "NOT_FOUND" ]; then
  echo "  Deleting CDKToolkit-atxinfra stack..."
  aws cloudformation delete-stack --stack-name CDKToolkit-atxinfra --region "$REGION" 2>/dev/null || true
  aws cloudformation wait stack-delete-complete --stack-name CDKToolkit-atxinfra --region "$REGION" 2>/dev/null \
    && info "CDK bootstrap stack deleted" \
    || warn "Could not delete CDK bootstrap stack"
else
  # Try default name too (CDKToolkit) — but only if it has our qualifier
  CDK_DEFAULT_STATUS=$(aws cloudformation describe-stacks --stack-name CDKToolkit \
    --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$CDK_DEFAULT_STATUS" != "NOT_FOUND" ]; then
    # Check if this bootstrap uses our qualifier
    HAS_OUR_QUALIFIER=$(aws cloudformation describe-stacks --stack-name CDKToolkit \
      --region "$REGION" --query "Stacks[0].Parameters[?ParameterKey=='Qualifier'].ParameterValue" \
      --output text 2>/dev/null || echo "")
    if [ "$HAS_OUR_QUALIFIER" = "atxinfra" ]; then
      echo "  Deleting CDKToolkit stack (qualifier: atxinfra)..."
      aws cloudformation delete-stack --stack-name CDKToolkit --region "$REGION" 2>/dev/null || true
      aws cloudformation wait stack-delete-complete --stack-name CDKToolkit --region "$REGION" 2>/dev/null \
        && info "CDK bootstrap stack deleted" \
        || warn "Could not delete CDK bootstrap stack"
    else
      skip "CDKToolkit stack (different qualifier: ${HAS_OUR_QUALIFIER:-default})"
    fi
  else
    skip "CDK bootstrap stack"
  fi
fi

# ============================================================
# Phase 9: Local generated files
# ============================================================
echo ""
echo "Phase 9: Local generated files..."

LOCAL_FOUND=false
for F in atx-runtime-policy.json atx-deployment-policy.json cdk.context.json; do
  if [ -f "$SCRIPT_DIR/$F" ]; then
    rm -f "$SCRIPT_DIR/$F"
    info "Removed $F"
    LOCAL_FOUND=true
  fi
done
$LOCAL_FOUND || skip "No generated files found"

# ============================================================
# Done
# ============================================================
echo ""
echo "═══════════════════════════════════════════════"
if [ "$ERRORS" -gt 0 ]; then
  echo -e " ${YELLOW}Teardown completed with $ERRORS warning(s)${NC}"
  echo "═══════════════════════════════════════════════"
  echo ""
  echo "Some resources may not have been fully cleaned up."
  echo "Check the warnings above and retry if needed."
else
  echo -e " ${GREEN}Complete teardown finished!${NC}"
  echo "═══════════════════════════════════════════════"
  echo ""
  echo "All ATX resources have been removed from your account."
fi
echo ""
echo "Note: KMS key deletion is scheduled (7-day AWS minimum)."
echo "To cancel: aws kms cancel-key-deletion --key-id <key-id> --region $REGION"
