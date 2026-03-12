#!/usr/bin/env bash
set -euo pipefail

# ATX Remote Infrastructure — One-command teardown
# Usage: ./teardown.sh
#
# Destroys all ATX CDK stacks from your AWS account.
# S3 buckets with data and CloudWatch log groups are retained.

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
info "AWS Account: $ACCOUNT_ID"

# --- Check if deployed ---

STACK_STATUS=$(aws cloudformation describe-stacks --stack-name AtxInfrastructureStack \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_DEPLOYED")

if [ "$STACK_STATUS" = "NOT_DEPLOYED" ]; then
  echo "Infrastructure is not deployed. Nothing to tear down."
  exit 0
fi

info "Found deployed stack (status: $STACK_STATUS)"

# --- Ensure dependencies are installed ---

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  if [ -f "package-lock.json" ]; then
    npm ci --silent
  else
    npm install --silent
  fi
fi

if [ ! -f "lib/infrastructure-stack.js" ]; then
  npx tsc 2>/dev/null || true
fi

# --- Destroy ---

echo ""
echo "Destroying ATX infrastructure..."
cdk destroy --all --force

echo ""
echo "═══════════════════════════════════════════════"
echo -e " ${GREEN}Teardown complete!${NC}"
echo "═══════════════════════════════════════════════"
echo ""
warn "The following resources are retained (delete manually if desired):"
echo "  S3: atx-source-code-${ACCOUNT_ID} (source uploads)"
echo "  S3: atx-custom-output-${ACCOUNT_ID} (transformation results)"
echo "  CloudWatch log group: /aws/batch/atx-transform"
