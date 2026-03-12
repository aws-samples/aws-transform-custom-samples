#!/usr/bin/env bash
set -euo pipefail

# ATX Remote Infrastructure — One-command setup
# Usage: ./setup.sh
#
# Handles everything needed to deploy ATX remote transformation
# infrastructure to your AWS account:
#   1. Checks prerequisites (Node.js, npm, Docker, AWS CLI, credentials)
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

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install: https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || fail "Docker is not running. Please start Docker Desktop and try again."
info "Docker is running"

command -v aws >/dev/null 2>&1 || fail "AWS CLI is not installed. Install: brew install awscli (macOS)"
info "AWS CLI $(aws --version 2>&1 | head -1)"

aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured. Run: aws configure sso"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
info "AWS Account: $ACCOUNT_ID | Region: $REGION"

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

# --- Install CDK CLI if needed ---

if ! command -v cdk >/dev/null 2>&1; then
  warn "CDK CLI not found globally, installing..."
  npm install -g aws-cdk 2>&1 | tail -1
fi
info "CDK CLI $(cdk --version 2>&1 | head -1)"

# --- Bootstrap CDK (idempotent) ---

echo "Bootstrapping CDK (if needed)..."
cdk bootstrap "aws://${ACCOUNT_ID}/${REGION}" 2>&1 | grep -E "✅|already|Bootstrapping" || true
info "CDK bootstrapped"

# --- Deploy ---

echo ""
echo "Deploying ATX infrastructure (this may take 5-10 minutes on first deploy)..."
echo "Building container image locally and pushing to ECR..."
echo ""
cdk deploy --all --require-approval never

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
echo "  atx-configure-mcp"
echo ""
echo "S3 buckets:"
echo "  atx-source-code-${ACCOUNT_ID}"
echo "  atx-custom-output-${ACCOUNT_ID}"
echo ""
echo "CloudWatch dashboard: ATX-Transform-CLI-Dashboard"
