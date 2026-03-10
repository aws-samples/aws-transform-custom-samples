#!/bin/bash
set -e

REPOSITORY_NAME="aws-transform-custom"
REGION="us-east-1"

# Short description (160 characters max)
DESCRIPTION="AI-powered code modernization at scale. Run AWS Transform custom with Java, Python, Node.js pre-installed. Process 1000s of repos with AWS Batch + Fargate."

# About text (markdown format)
read -r -d '' ABOUT_TEXT << 'EOF' || true
**Production-ready container for AWS Transform custom** - Automate code modernization, framework upgrades, and technical debt reduction across thousands of repositories using AI-driven transformations.

## What's Included

**Languages & Runtimes:**
- Java: OpenJDK 8, 11, 17, 21 (default: 17)
- Python: 3.8, 3.9, 3.10, 3.11, 3.12, 3.13 (default: 3.11)
- Node.js: 16, 18, 20, 22, 24 (default: 20)

**Build Tools:**
- Maven 3.9.6, Gradle 8.5
- npm, yarn, pnpm, TypeScript
- pip, virtualenv, uv

**AWS Tools:**
- AWS Transform CLI (atx)
- AWS CLI v2
- Git, build essentials

**Base OS:** Amazon Linux 2023

## Use Cases

- Python version upgrades (2.7 → 3.x, 3.8 → 3.13)
- Java version migrations (8 → 11 → 17 → 21)
- Framework upgrades (Spring Boot, Django, React, Angular)
- SDK migrations (AWS SDK v1 → v2, JUnit 4 → 5)
- Lambda runtime upgrades
- Technical debt reduction at scale
- Deprecated API modernization

## Key Features

- **Massive Scale:** Process 1000s of repositories concurrently with AWS Batch
- **Secure:** IAM credential auto-refresh every 45 minutes, no long-lived keys
- **Complete Infrastructure:** REST API, monitoring, campaign tracking included
- **One-Command Deploy:** Full CDK deployment in ~10 minutes
- **Extensible:** Customize for private repositories and additional tools

## Documentation

- GitHub: https://github.com/aws-samples/aws-transform-custom-samples
- AWS Transform Docs: https://docs.aws.amazon.com/transform/latest/userguide/custom.html

## Security

- IAM credentials auto-refresh every 45 minutes
- No long-lived credentials stored in container
- Least-privilege IAM policies
- VPC isolation supported
- CloudWatch audit logging

## License

This sample code is made available under the MIT-0 license.
EOF

# Usage text (markdown format)
read -r -d '' USAGE_TEXT << 'EOF' || true
## Quick Start (Standalone)

Run a single transformation on a public repository:

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN \
  -e AWS_DEFAULT_REGION=us-east-1 \
  public.ecr.aws/b7y6j9m3/aws-transform-custom:latest \
  /bin/bash -c "
    git clone https://github.com/your-org/your-repo /source/repo && \
    atx custom def exec \
      -n AWS/python-version-upgrade \
      -p /source/repo \
      -c noop \
      --configuration 'validationCommands=pytest,additionalPlanContext=Upgrade to Python 3.13' \
      -x -t
  "
```

## Production Deployment (Recommended)

Deploy complete infrastructure with AWS Batch, API Gateway, and monitoring:

**1. Clone the sample repository:**
```bash
git clone https://github.com/aws-samples/aws-transform-custom-samples.git
cd aws-transform-custom-samples/scaled-execution-containers
```

**2. Set AWS credentials:**
```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_ACCOUNT=$AWS_ACCOUNT_ID
export CDK_DEFAULT_REGION=us-east-1
```

**3. Deploy with CDK (uses this public image):**
```bash
cd cdk
chmod +x deploy.sh

cdk deploy --all \
  -c usePublicEcr=true \
  -c publicEcrImage=public.ecr.aws/b7y6j9m3/aws-transform-custom:latest
```

**Time:** ~10 minutes (no container build required)

**What gets deployed:**
- AWS Batch compute environment (Fargate, 256 vCPUs)
- REST API for job submission and management
- S3 buckets for source code and results
- IAM roles with least-privilege access
- CloudWatch dashboard and logs
- Lambda functions for orchestration

**4. Submit jobs via API:**
```bash
# Get API endpoint from CDK output
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ATXCustomAPIStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

# Submit transformation job
curl -X POST "$API_ENDPOINT/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "https://github.com/your-org/your-repo",
    "command": "atx custom def exec -n AWS/python-version-upgrade -p /source/repo -c noop --configuration \"validationCommands=pytest,additionalPlanContext=Upgrade to Python 3.13\" -x -t"
  }'
```

**5. Monitor and retrieve results:**
```bash
# Check job status
curl "$API_ENDPOINT/jobs/{jobId}/status"

# Download results from S3
aws s3 sync s3://atx-custom-output-$AWS_ACCOUNT_ID/transformations/ ./results/
```

## Bulk Transformations

Process multiple repositories in parallel:

```bash
curl -X POST "$API_ENDPOINT/batch-jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "jobs": [
      {
        "source": "https://github.com/org/repo1",
        "command": "atx custom def exec -n AWS/python-version-upgrade -p /source/repo1 -c noop -x -t"
      },
      {
        "source": "https://github.com/org/repo2",
        "command": "atx custom def exec -n AWS/java-version-upgrade -p /source/repo2 -c noop -x -t"
      }
    ],
    "campaignId": "q1-2026-modernization"
  }'
```

## Available Transformations

List all AWS-managed transformation definitions:

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN \
  -e AWS_DEFAULT_REGION=us-east-1 \
  public.ecr.aws/b7y6j9m3/aws-transform-custom:latest \
  atx custom def list
```

Common transformations:
- `AWS/python-version-upgrade` - Python 2.7 → 3.x, 3.8 → 3.13
- `AWS/java-version-upgrade` - Java 8 → 11 → 17 → 21
- `AWS/spring-boot-upgrade` - Spring Boot version upgrades
- `AWS/aws-sdk-migration` - AWS SDK v1 → v2
- `AWS/junit-upgrade` - JUnit 4 → 5

## Switching Language Versions

```bash
# Use Java 21
docker run --rm \
  -e JAVA_VERSION=21 \
  public.ecr.aws/b7y6j9m3/aws-transform-custom:latest \
  java -version

# Use Python 3.13
docker run --rm \
  public.ecr.aws/b7y6j9m3/aws-transform-custom:latest \
  python3.13 --version

# Use Node.js 22
docker run --rm \
  public.ecr.aws/b7y6j9m3/aws-transform-custom:latest \
  /bin/bash -c "source ~/.nvm/nvm.sh && nvm use 22 && node --version"
```

## Private Repositories

For private repository access, build a custom image:

```bash
git clone https://github.com/aws-samples/aws-transform-custom-samples.git
cd aws-transform-custom-samples/scaled-execution-containers/container

# Edit Dockerfile to add credentials (use AWS Secrets Manager in production)
# See container/README.md for detailed instructions

docker build -t my-custom-atx .
```

## Cost Estimate

- Fargate: ~$0.04/vCPU-hour + $0.004/GB-hour
- AWS Transform: $0.035/agent-minute
- Example: 2 vCPU, 4GB, 1 hour = ~$0.20 + agent time

## Prerequisites

- AWS account with appropriate permissions
- AWS CLI v2 configured
- Docker Desktop (for local testing)
- Node.js 18+ and AWS CDK (for deployment)

## Support

- Issues: https://github.com/aws-samples/aws-transform-custom-samples/issues
- Full Documentation: https://github.com/aws-samples/aws-transform-custom-samples
EOF

echo "Updating ECR Public repository catalog data..."

aws ecr-public put-repository-catalog-data \
  --region "$REGION" \
  --repository-name "$REPOSITORY_NAME" \
  --catalog-data "{
    \"description\": \"$DESCRIPTION\",
    \"architectures\": [\"x86-64\", \"ARM 64\"],
    \"operatingSystems\": [\"Linux\"],
    \"aboutText\": $(echo "$ABOUT_TEXT" | jq -Rs .),
    \"usageText\": $(echo "$USAGE_TEXT" | jq -Rs .)
  }"

echo "✅ ECR Public repository catalog data updated successfully!"
echo ""
echo "View at: https://gallery.ecr.aws/b7y6j9m3/aws-transform-custom"
