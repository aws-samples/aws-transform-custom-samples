#!/bin/bash
# Usage: ./1-build-and-push.sh [--rebuild] [--public]
#   --rebuild: Force rebuild with --no-cache (ignore Docker layer cache)
#   --public: Build and push to AWS Public ECR (requires authentication)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$SCRIPT_DIR/config.env"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Parse flags
FORCE_REBUILD=false
USE_PUBLIC_ECR=false
for arg in "$@"; do
    case $arg in
        --rebuild) FORCE_REBUILD=true ;;
        --public) USE_PUBLIC_ECR=true ;;
    esac
done

echo "=========================================="
echo "Step 1: Build and Push Container to ECR"
echo "=========================================="
echo ""

# Load configuration
if [ -f "$CONFIG_FILE" ]; then
    log_info "Loading configuration from config.env"
    source "$CONFIG_FILE"
fi

# Override with flag if provided
if [ "$USE_PUBLIC_ECR" = true ]; then
    log_warning "Public ECR mode enabled via --public flag"
fi

# Detect AWS account ID
if [ -z "$AWS_ACCOUNT_ID" ]; then
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
    if [ -z "$AWS_ACCOUNT_ID" ]; then
        log_error "Failed to detect AWS account ID. Is AWS CLI configured?"
        exit 1
    fi
fi

AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPO_NAME="${ECR_REPO_NAME:-aws-transform-custom}"

# Determine ECR type and URI
if [ "$USE_PUBLIC_ECR" = true ]; then
    ECR_TYPE="public"
    PUBLIC_ECR_ALIAS="${PUBLIC_ECR_ALIAS:-b7y6j9m3}"
    ECR_URI="public.ecr.aws/${PUBLIC_ECR_ALIAS}/${ECR_REPO_NAME}"
    
    log_info "Mode: Public ECR"
    log_info "Public Alias: $PUBLIC_ECR_ALIAS"
    log_info "Repository: $ECR_REPO_NAME"
    echo ""
    
    # Create public ECR repository if it doesn't exist
    log_info "Checking public ECR repository..."
    aws ecr-public describe-repositories --repository-names "$ECR_REPO_NAME" --region us-east-1 &>/dev/null || {
        log_info "Creating public ECR repository..."
        aws ecr-public create-repository \
            --repository-name "$ECR_REPO_NAME" \
            --catalog-data "description=AWS Transform Custom - AI-powered code transformation container,architectures=x86-64,aboutText=# AWS Transform Custom Container\n\nProduction-ready container for running AWS Transform custom transformations at scale.\n\n## Features\n- Multi-language support (Java, Python, Node.js, .NET)\n- AWS Transform CLI pre-installed\n- Optimized for AWS Batch and Fargate\n- Security-hardened base image\n\n## Usage\nSee [GitHub repository](https://github.com/aws-samples/sample-aws-transform-custom-container) for documentation." \
            --region us-east-1 >/dev/null
        log_success "Public ECR repository created"
    }
    log_success "Public ECR repository ready: $ECR_URI"
    
    # Login to public ECR
    log_info "Authenticating with Public ECR..."
    aws ecr-public get-login-password --region us-east-1 | \
        docker login --username AWS --password-stdin public.ecr.aws
else
    ECR_TYPE="private"
    ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"
    
    log_info "Mode: Private ECR"
    log_info "Account: $AWS_ACCOUNT_ID"
    log_info "Region: $AWS_REGION"
    log_info "Repository: $ECR_REPO_NAME"
    echo ""
    
    # Create private ECR repository if it doesn't exist
    log_info "Checking private ECR repository..."
    aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" --region "$AWS_REGION" &>/dev/null || {
        log_info "Creating private ECR repository..."
        aws ecr create-repository \
            --repository-name "$ECR_REPO_NAME" \
            --image-scanning-configuration scanOnPush=true \
            --region "$AWS_REGION" >/dev/null
        log_success "Private ECR repository created"
    }
    log_success "Private ECR repository ready: $ECR_URI"
    
    # Login to private ECR
    log_info "Authenticating with Private ECR..."
    aws ecr get-login-password --region "$AWS_REGION" | \
        docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
fi

echo ""

# Build container
log_info "Building container from Dockerfile..."
cd "$PROJECT_ROOT/container"
if [ "$FORCE_REBUILD" = true ]; then
    log_info "Using --no-cache for clean build"
    docker build --no-cache -t "$ECR_REPO_NAME:latest" .
else
    docker build -t "$ECR_REPO_NAME:latest" .
fi
log_success "Container built"

echo ""
log_info "Pushing to $ECR_TYPE ECR..."

# Tag and push
docker tag "$ECR_REPO_NAME:latest" "$ECR_URI:latest"
docker push "$ECR_URI:latest"

log_success "Container pushed to $ECR_TYPE ECR"
echo ""

# Save ECR URI for step 2
echo "$ECR_URI:latest" > "$SCRIPT_DIR/.ecr-uri.txt"

echo "=========================================="
echo "Step 1 Complete!"
echo "=========================================="
echo ""
log_success "Container available at: $ECR_URI:latest"
echo ""
if [ "$USE_PUBLIC_ECR" = true ]; then
    log_info "Public ECR Gallery: https://gallery.ecr.aws/${PUBLIC_ECR_ALIAS}/${ECR_REPO_NAME}"
    echo ""
fi
echo "Next step:"
echo "  ./2-deploy-infrastructure.sh"
echo ""
