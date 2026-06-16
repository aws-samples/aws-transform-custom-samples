#!/usr/bin/env bash
# Do NOT use set -e — teardown must continue past individual failures
set -uo pipefail

# ATX Remote Infrastructure — Complete removal
# Usage: ./teardown.sh [--dry-run]
#
# Scans for ATX resources, shows what will be deleted, then asks for
# confirmation before proceeding. Pass --dry-run to preview only.
#
# ════════════════════════════════════════════════════════════════════
# SAFETY CONTRACT:
# This script NEVER deletes:
#   - VPCs, subnets, NAT gateways, internet gateways, route tables
#   - S3 buckets (atx-source-code-*, atx-custom-output-*, atx-ct-output-*)
#   - KMS key (alias/atx-encryption-key) — encrypts the preserved S3 buckets;
#     deleting it makes bucket contents permanently unreadable
# Those are customer-managed resources that persist independently of
# the ATX stack lifecycle. S3 lifecycle policies auto-expire content.
# ════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ERRORS=0
fail() { echo -e "${RED}ERROR: $1${NC}" >&2; exit 1; }
info() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ERRORS=$((ERRORS + 1)); }
skip() { echo -e "  $1 — skipped (not found)"; }

echo "═══════════════════════════════════════════════"
echo " ATX Remote Infrastructure — Teardown"
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
# Discovery: scan all resources before any destructive action
# ============================================================
echo "Scanning resources..."
echo ""

FOUND_STACKS=()
FOUND_LOG_GROUPS=()
FOUND_POLICIES=()
FOUND_SECRETS=()
FOUND_ECR_REPOS=()
FOUND_CDK_BUCKET=""
FOUND_CDK_STACK=""
FOUND_LOCAL_FILES=()

# -- CloudFormation stacks --
for STACK_NAME in AtxInfrastructureStack AtxContainerStack; do
  STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$STACK_STATUS" != "NOT_FOUND" ]; then
    FOUND_STACKS+=("$STACK_NAME ($STACK_STATUS)")
  fi
done


# -- CloudWatch log groups --
ALL_LOG_GROUPS=("/aws/batch/atx-transform" "/aws/batch/job")
for FN in atx-trigger-job atx-get-job-status atx-terminate-job atx-list-jobs \
           atx-trigger-batch-jobs atx-get-batch-status atx-terminate-batch-jobs \
           atx-list-batches; do
  ALL_LOG_GROUPS+=("/aws/lambda/${FN}")
done
for LG in "${ALL_LOG_GROUPS[@]}"; do
  if aws logs describe-log-groups --log-group-name-prefix "$LG" --region "$REGION" \
    --query "logGroups[?logGroupName=='$LG'].logGroupName" --output text 2>/dev/null | grep -q "$LG"; then
    FOUND_LOG_GROUPS+=("$LG")
  fi
done

# -- IAM policies --
for POLICY_NAME in ATXRuntimePolicy ATXDeploymentPolicy ATXLocalPolicy; do
  POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
  if aws iam get-policy --policy-arn "$POLICY_ARN" 2>/dev/null >/dev/null; then
    FOUND_POLICIES+=("$POLICY_NAME")
  fi
done

# -- Secrets Manager --
for SECRET_ID in "atx/github-token" "atx/ssh-key" "atx/credentials"; do
  if aws secretsmanager describe-secret --secret-id "$SECRET_ID" --region "$REGION" 2>/dev/null >/dev/null; then
    FOUND_SECRETS+=("$SECRET_ID")
  fi
done

# -- ECR repositories --
for REPO in $(aws ecr describe-repositories --region "$REGION" \
  --query 'repositories[?starts_with(repositoryName, `cdk-atxinfra-container-assets-`)].repositoryName' \
  --output text 2>/dev/null || echo ""); do
  [ "$REPO" = "None" ] && continue
  [ -z "$REPO" ] && continue
  FOUND_ECR_REPOS+=("$REPO")
done

# -- CDK bootstrap --
CDK_BUCKET="cdk-atxinfra-assets-${ACCOUNT_ID}-${REGION}"
if aws s3api head-bucket --bucket "$CDK_BUCKET" --region "$REGION" 2>/dev/null; then
  FOUND_CDK_BUCKET="s3://$CDK_BUCKET"
fi
CDK_STACK_STATUS=$(aws cloudformation describe-stacks --stack-name CDKToolkit-atxinfra \
  --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
if [ "$CDK_STACK_STATUS" != "NOT_FOUND" ]; then
  FOUND_CDK_STACK="CDKToolkit-atxinfra ($CDK_STACK_STATUS)"
else
  CDK_DEFAULT_STATUS=$(aws cloudformation describe-stacks --stack-name CDKToolkit \
    --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$CDK_DEFAULT_STATUS" != "NOT_FOUND" ]; then
    HAS_OUR_QUALIFIER=$(aws cloudformation describe-stacks --stack-name CDKToolkit \
      --region "$REGION" --query "Stacks[0].Parameters[?ParameterKey=='Qualifier'].ParameterValue" \
      --output text 2>/dev/null || echo "")
    if [ "$HAS_OUR_QUALIFIER" = "atxinfra" ]; then
      FOUND_CDK_STACK="CDKToolkit ($CDK_DEFAULT_STATUS)"
    fi
  fi
fi

# -- Local generated files --
for F in atx-runtime-policy.json atx-deployment-policy.json cdk.context.json; do
  if [ -f "$SCRIPT_DIR/$F" ]; then
    FOUND_LOCAL_FILES+=("$F")
  fi
done

# ============================================================
# Display preview
# ============================================================
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  Resources that WILL be deleted:                         │"
echo "├─────────────────────────────────────────────────────────┤"

if [ ${#FOUND_STACKS[@]} -gt 0 ]; then
  echo -e "│  ${CYAN}CloudFormation stacks:${NC}"
  for s in "${FOUND_STACKS[@]}"; do echo "│    • $s"; done
fi


if [ ${#FOUND_LOG_GROUPS[@]} -gt 0 ]; then
  echo -e "│  ${CYAN}CloudWatch log groups:${NC}"
  for lg in "${FOUND_LOG_GROUPS[@]}"; do echo "│    • $lg"; done
fi

if [ ${#FOUND_POLICIES[@]} -gt 0 ]; then
  echo -e "│  ${CYAN}IAM policies:${NC}"
  for p in "${FOUND_POLICIES[@]}"; do echo "│    • $p"; done
fi

if [ ${#FOUND_SECRETS[@]} -gt 0 ]; then
  echo -e "│  ${CYAN}Secrets Manager secrets:${NC}"
  for s in "${FOUND_SECRETS[@]}"; do echo "│    • $s"; done
fi

if [ ${#FOUND_ECR_REPOS[@]} -gt 0 ]; then
  echo -e "│  ${CYAN}ECR repositories:${NC}"
  for r in "${FOUND_ECR_REPOS[@]}"; do echo "│    • $r"; done
fi

if [ -n "$FOUND_CDK_BUCKET" ] || [ -n "$FOUND_CDK_STACK" ]; then
  echo -e "│  ${CYAN}CDK bootstrap:${NC}"
  [ -n "$FOUND_CDK_BUCKET" ] && echo "│    • $FOUND_CDK_BUCKET"
  [ -n "$FOUND_CDK_STACK" ] && echo "│    • $FOUND_CDK_STACK"
fi

if [ ${#FOUND_LOCAL_FILES[@]} -gt 0 ]; then
  echo -e "│  ${CYAN}Local generated files:${NC}"
  for f in "${FOUND_LOCAL_FILES[@]}"; do echo "│    • $f"; done
fi

# Check if nothing was found
TOTAL_FOUND=$(( ${#FOUND_STACKS[@]} + ${#FOUND_LOG_GROUPS[@]} + ${#FOUND_POLICIES[@]} + ${#FOUND_SECRETS[@]} + ${#FOUND_ECR_REPOS[@]} + ${#FOUND_LOCAL_FILES[@]} ))
[ -n "$FOUND_CDK_BUCKET" ] && TOTAL_FOUND=$((TOTAL_FOUND + 1))
[ -n "$FOUND_CDK_STACK" ] && TOTAL_FOUND=$((TOTAL_FOUND + 1))

if [ "$TOTAL_FOUND" -eq 0 ]; then
  echo "│  (none found — nothing to delete)"
fi

echo "├─────────────────────────────────────────────────────────┤"
echo -e "│  ${GREEN}PRESERVED (never deleted):${NC}"
echo "│    • VPCs, subnets, NAT gateways, route tables"
echo "│    • S3: atx-source-code-*, atx-custom-output-*,"
echo "│          atx-ct-output-*"
echo "│    • KMS key (alias/atx-encryption-key) — encrypts S3 data"
echo "└─────────────────────────────────────────────────────────┘"
echo ""

if [ "$TOTAL_FOUND" -eq 0 ]; then
  echo "Nothing to tear down."
  exit 0
fi

if $DRY_RUN; then
  echo "(dry-run mode — no resources were deleted)"
  exit 0
fi

# ============================================================
# Confirmation gate
# ============================================================
read -p "Proceed with teardown? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Proceeding with teardown..."
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

# NOTE: The stack uses imported VPC resources (existingVpcId). CFN stack
# deletion does NOT cascade to VPC, subnet, NAT, or IGW resources.
# NOTE: KMS key (alias/atx-encryption-key) is preserved — it encrypts the
# S3 buckets that persist across teardown. Deleting it makes data unreadable.

# ============================================================
# Phase 2: CloudWatch log groups
# ============================================================
echo ""
echo "Phase 2: CloudWatch log groups..."

if [ ${#FOUND_LOG_GROUPS[@]} -gt 0 ]; then
  for LG in "${FOUND_LOG_GROUPS[@]}"; do
    if aws logs delete-log-group --log-group-name "$LG" --region "$REGION" 2>/dev/null; then
      info "Log group $LG deleted"
    else
      warn "Could not delete $LG"
    fi
  done
else
  skip "No ATX log groups found"
fi

# ============================================================
# Phase 3: IAM policies
# ============================================================
echo ""
echo "Phase 3: IAM policies..."

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
# Phase 4: Secrets Manager secrets
# ============================================================
echo ""
echo "Phase 4: Secrets Manager secrets..."

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
# Phase 5: ECR repositories
# ============================================================
echo ""
echo "Phase 5: ECR repositories..."

if [ ${#FOUND_ECR_REPOS[@]} -gt 0 ]; then
  for REPO in "${FOUND_ECR_REPOS[@]}"; do
    aws ecr delete-repository --repository-name "$REPO" --region "$REGION" --force 2>/dev/null \
      && info "ECR repo $REPO deleted" \
      || warn "Could not delete ECR repo $REPO"
  done
else
  skip "No ATX ECR repositories found"
fi

# ============================================================
# Helper: Empty a versioned S3 bucket (used by CDK bootstrap cleanup only)
# ============================================================
empty_versioned_bucket() {
  local bucket="$1"
  local region="$2"
  aws s3 rm "s3://${bucket}" --recursive --region "$region" --quiet 2>/dev/null || true
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
    if [[ -z "$payload" ]]; then break; fi
    aws s3api delete-objects --bucket "$bucket" --region "$region" --delete "$payload" 2>/dev/null || true
    local is_truncated
    is_truncated=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('IsTruncated', False))" 2>/dev/null || echo "False")
    if [[ "$is_truncated" != "True" ]]; then break; fi
    key_marker=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('NextKeyMarker',''))" 2>/dev/null || echo "")
    version_marker=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('NextVersionIdMarker',''))" 2>/dev/null || echo "")
  done
}

# ============================================================
# Phase 6: CDK bootstrap (our custom qualifier)
# ============================================================
echo ""
echo "Phase 6: CDK bootstrap resources..."

if [ -n "$FOUND_CDK_BUCKET" ]; then
  echo "  Emptying and deleting $FOUND_CDK_BUCKET..."
  empty_versioned_bucket "$CDK_BUCKET" "$REGION"
  if aws s3api delete-bucket --bucket "$CDK_BUCKET" --region "$REGION" 2>&1; then
    info "CDK bootstrap bucket deleted"
  else
    warn "Could not delete CDK bootstrap bucket (see error above)"
  fi
else
  skip "CDK bootstrap bucket ($CDK_BUCKET)"
fi

if [ -n "$FOUND_CDK_STACK" ]; then
  CDK_STACK_TO_DELETE=$(echo "$FOUND_CDK_STACK" | cut -d' ' -f1)
  echo "  Deleting $CDK_STACK_TO_DELETE stack..."
  aws cloudformation delete-stack --stack-name "$CDK_STACK_TO_DELETE" --region "$REGION" 2>/dev/null || true
  aws cloudformation wait stack-delete-complete --stack-name "$CDK_STACK_TO_DELETE" --region "$REGION" 2>/dev/null \
    && info "CDK bootstrap stack deleted" \
    || warn "Could not delete CDK bootstrap stack"
else
  skip "CDK bootstrap stack"
fi

# ============================================================
# Phase 7: Local generated files
# ============================================================
echo ""
echo "Phase 7: Local generated files..."

if [ ${#FOUND_LOCAL_FILES[@]} -gt 0 ]; then
  for F in "${FOUND_LOCAL_FILES[@]}"; do
    rm -f "$SCRIPT_DIR/$F"
    info "Removed $F"
  done
else
  skip "No generated files found"
fi

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
  echo -e " ${GREEN}Teardown finished!${NC}"
  echo "═══════════════════════════════════════════════"
  echo ""
  echo "ATX compute and IAM resources have been removed from your account."
fi
echo ""
echo "Preserved (not deleted by teardown):"
echo "  - S3 buckets (lifecycle policies auto-expire: 7-day source, 30-day output)"
echo "  - KMS key (alias/atx-encryption-key) — encrypts the preserved S3 data"
echo "  - VPC/subnet/NAT/IGW (customer-managed network resources)"
