# ATX Transform Platform

AI-powered code transformation platform built on Amazon Bedrock AgentCore and AWS Transform CLI (ATX). Transform and modernize codebases at scale using natural language through a web UI or CLI.

## What It Does

- Execute AWS-managed transformations (Python/Java/Node.js upgrades, SDK migrations, codebase analysis)
- Create and publish custom transformations using natural language
- Batch process multiple repositories via CSV upload
- Track transformation jobs with real-time status and results

## Architecture

```
UI (CloudFront) → HTTP API (/orchestrate) → async Lambda → AgentCore Orchestrator
                                                             ├── find_transform_agent
                                                             ├── execute_transform_agent → AWS Batch (ATX CLI)
                                                             └── create_transform_agent  → Bedrock AI + Batch publish
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed diagrams and data flows.

---

## Prerequisites

| Tool | Version | macOS | Windows | Linux |
|------|---------|-------|---------|-------|
| AWS CLI | v2.13+ | `brew install awscli` | [MSI Installer](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) | `curl`, `apt`, or `yum` |
| Python | 3.11+ | `brew install python@3.11` | [python.org](https://www.python.org/downloads/) | `apt install python3.11` |
| Node.js | 18+ | `brew install node` | [nodejs.org](https://nodejs.org/) | `apt install nodejs` |
| Docker | 20+ | [Docker Desktop](https://docs.docker.com/get-docker/) | [Docker Desktop](https://docs.docker.com/get-docker/) | `apt install docker.io` |
| SAM CLI | Latest | `brew install aws-sam-cli` | [MSI Installer](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) | `pip install aws-sam-cli` |

> **Windows users:** Use WSL2 (Windows Subsystem for Linux) for the best experience. The deployment scripts are bash-based. Alternatively, run commands in Git Bash or PowerShell with adjustments.

**AWS Account Requirements:**
- Bedrock model access enabled for Claude Sonnet 4
- Default VPC with public subnets (or configure existing VPC)

---

## Configuration

All configuration is in `deployment/config.env`. Copy the template and customize:

```bash
cd deployment
cp config.env.template config.env
# Edit config.env as needed (defaults work for most setups)
```

Key settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `AWS_REGION` | `us-east-1` | AWS region for all services |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-20250514-v1:0` | AI model for orchestrator |
| `FARGATE_VCPU` | `2` | vCPU for Batch jobs |
| `FARGATE_MEMORY` | `4096` | Memory (MB) for Batch jobs |
| `JOB_TIMEOUT` | `43200` | Max job duration (seconds) |

See `deployment/config.env.template` for all options.

---

## Deployment

Two deployment options are available. Choose the one that fits your needs.

### Option A: CDK + SAM Deployment (Recommended)

Uses CDK for infrastructure (stable constructs only) and SAM for the AgentCore + API layer. No alpha/experimental constructs. Uses the `bedrock-agentcore-control` SDK to deploy the orchestrator.

> **Requires:** [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) in addition to CDK.

#### Step 1: Enable Bedrock Model Access

1. Go to [Bedrock console](https://console.aws.amazon.com/bedrock/home) → Model access
2. Enable **Anthropic Claude Sonnet 4**

#### Step 2: Deploy Base Infrastructure via CDK

```bash
cd deployment
cp config.env.template config.env

# Login to ECR Public
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws

cd ../cdk
npm install
cdk bootstrap  # First time only

# Build and deploy Container + Infrastructure + UI stacks
npx tsc
CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text) \
  cdk deploy AtxContainerStack AtxInfrastructureStack AtxUiStack --require-approval never
```

> For accounts without a default VPC, pass VPC context:
> ```bash
> cdk deploy AtxContainerStack AtxInfrastructureStack AtxUiStack --require-approval never \
>   -c existingVpcId=vpc-xxx -c existingSubnetIds=subnet-aaa,subnet-bbb -c existingSecurityGroupId=sg-ccc
> ```
> Subnets must be public (auto-assign public IP) or private with a NAT gateway so
> Fargate tasks can reach ECR, S3, and git.

#### Step 3: Deploy AgentCore + API via SAM

```bash
cd ../sam
./deploy.sh
```

This builds the orchestrator Docker image, pushes to ECR, and deploys:
- A deploy-Lambda that creates the AgentCore Runtime via SDK
- The async invoke Lambda + HTTP API Gateway

#### Step 4: Deploy Orchestrator to AgentCore

Invoke the deploy-Lambda directly (takes 2-5 minutes):
```bash
aws lambda invoke --function-name atx-deploy-agentcore \
  --cli-binary-format raw-in-base64-out \
  --payload '{"action":"deploy"}' \
  --cli-read-timeout 900 /tmp/deploy-output.json

cat /tmp/deploy-output.json
```

The Lambda uses the `bedrock-agentcore-control` SDK to:
1. Create the AgentCore Runtime with the orchestrator container
2. Poll until the runtime is READY
3. Return the runtime ARN

Then update the async Lambda with the Agent Runtime ARN from the output:
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
RUNTIME_ARN=$(python3 -c "import json; print(json.loads(json.load(open('/tmp/deploy-output.json'))['body'])['runtime_arn'])")

aws lambda update-function-configuration --function-name atx-async-invoke-agent \
  --environment "Variables={AGENT_RUNTIME_ARN=${RUNTIME_ARN},RESULT_BUCKET=atx-custom-output-${ACCOUNT_ID},JOBS_TABLE=atx-transform-jobs}"
```

#### Step 5: Rebuild UI with API Endpoint

```bash
API_URL=$(aws cloudformation describe-stacks --stack-name AtxAgentCoreSAM \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' --output text)

cd ui && npm install
VITE_API_ENDPOINT=$API_URL npx vite build
./deploy-aws.sh
```
---

### Option B: CDK-Only Deployment (Experimental)

Deploys the entire platform with a single `cdk deploy --all`. Uses the `@aws-cdk/aws-bedrock-agentcore-alpha` CDK construct.

> ⚠️ **Note:** The AgentCore CDK construct is experimental and under active development. APIs may change in future releases. For production workloads, use Option A.

#### Step 1: Enable Bedrock Model Access

Same as Option A Step 1.

#### Step 2: Deploy Everything

```bash
cd deployment
cp config.env.template config.env    # Edit if needed (defaults work)

# Login to ECR Public (required for Docker base image pull)
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws

# Build UI placeholder (CDK needs ui/dist/ to exist at synth time)
cd ../ui && npm install && npx vite build && cd ../cdk
npm install

# Bootstrap CDK (first time only)
cdk bootstrap

# Build TypeScript and deploy all stacks
npx tsc
CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text) \
  cdk deploy --all --require-approval never
```

> **Note:** Use the global `cdk` CLI (`npm install -g aws-cdk`) rather than `npx cdk` to avoid version conflicts with the alpha package.

> For accounts without a default VPC, pass VPC context (same pattern as Option A):
> ```bash
> cdk deploy --all --require-approval never \
>   -c existingVpcId=vpc-xxx -c existingSubnetIds=subnet-aaa,subnet-bbb -c existingSecurityGroupId=sg-ccc
> ```
> Subnets must be public (auto-assign public IP) or private with a NAT gateway so
> Fargate tasks can reach ECR, S3, and git.

This deploys 4 stacks in order:
1. `AtxContainerStack` — ECR + Docker image
2. `AtxInfrastructureStack` — Batch, S3, VPC, IAM
3. `AtxAgentCoreStack` — AgentCore Runtime + Lambda + HTTP API
4. `AtxUiStack` — S3 + CloudFront

#### Step 3: Rebuild UI with API Endpoint

The initial `cdk deploy` deploys the UI without the API endpoint (it's not known until the AgentCore stack completes). Rebuild with the correct endpoint:
```bash
API_URL=$(aws cloudformation describe-stacks --stack-name AtxAgentCoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' --output text)

cd ui && npm install
VITE_API_ENDPOINT=$API_URL npx vite build

# Upload to the CDK-created S3 bucket and invalidate CloudFront
./deploy-aws.sh
```

> The `deploy-aws.sh` script auto-detects the CDK-managed `AtxUiStack` and uploads directly to its S3 bucket. It will not create a duplicate CloudFormation stack.

---

## Hybrid Mode: Deploy on Top of Existing Base Infrastructure

If you already have the base `scaled-execution-containers/cdk` stacks deployed and want to
add the agentic platform without redeploying the full infrastructure, use the hybrid mode:

```bash
cd cdk
npm install && npx tsc

CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text) \
  cdk deploy --all --require-approval never -c useBaseInfra=true
```

This deploys `AtxAgenticExtrasStack` (DynamoDB table + source bucket write access),
`AtxAgentCoreStack`, and `AtxUiStack` on top of the existing base infrastructure.
See [cdk/README.md](cdk/README.md#hybrid-mode-deploy-on-top-of-base-infrastructure) for details.

Then continue with the SAM deployment (Option A Step 3+) or use the CDK AgentCore stack directly.

---

## Local Development

```bash
# Terminal 1: Orchestrator (port 8080)
cd orchestrator && source .venv/bin/activate && python3.11 agent.py

# Terminal 2: UI (port 3000, proxies /api to 8080)
cd ui && npm run dev
```

---

## Available Transformations

### AWS Managed (10)

| Transformation | Description |
|---|---|
| `AWS/python-version-upgrade` | Python 3.8 → 3.13 |
| `AWS/java-version-upgrade` | Java any → any (with dependency modernization) |
| `AWS/nodejs-version-upgrade` | Node.js any → any |
| `AWS/python-boto2-to-boto3` | boto2 → boto3 |
| `AWS/java-aws-sdk-v1-to-v2` | Java AWS SDK v1 → v2 |
| `AWS/nodejs-aws-sdk-v2-to-v3` | Node.js AWS SDK v2 → v3 |
| `AWS/early-access-comprehensive-codebase-analysis` | Deep codebase analysis |
| `AWS/early-access-java-x86-to-graviton` | Java x86 → ARM64/Graviton |
| `AWS/early-access-angular-to-react-migration` | Angular → React |
| `AWS/early-access-jfr-performance-optimization` | Java JFR performance |

### Custom Transformations

Create via the "Create Custom" tab. Published to the ATX registry via `atx custom def publish`.

---

## UI Tabs

| Tab | Purpose |
|-----|---------|
| **Transformations** | Browse AWS-managed + published custom transforms |
| **Execute** | Run a single transformation on a repository |
| **Create Custom** | Define and publish custom transformations |
| **CSV Batch** | Upload CSV to process multiple repos |
| **Jobs** | Track job status, view results |

---

## Project Structure

```
├── orchestrator/               # Bedrock AgentCore orchestrator
│   ├── agent.py                # Main agent (3 sub-agents)
│   ├── tools/                  # find, execute, create, memory
│   ├── Dockerfile              # Container image for CDK deployment
│   └── requirements.txt
├── api/lambda/
│   └── async_invoke_agent.py   # Async bridge (submit/poll/direct)
├── sam/                        # SAM template for AgentCore + API (Option A)
│   ├── template.yaml           # SAM resources
│   ├── deploy_agentcore.py     # Deploy Lambda (SDK-based)
│   └── deploy.sh               # One-command SAM deploy
├── ui/                         # React frontend (5 tabs)
│   └── src/components/
├── cdk/                        # CDK stacks
│   └── lib/
│       ├── container-stack.ts      # ECR + Docker image (builds from ../../../scaled-execution-containers/container/)
│       ├── infrastructure-stack.ts # Batch, S3, VPC, IAM
│       ├── agentcore-stack.ts      # AgentCore + Lambda + API (Option B, experimental)
│       └── ui-stack.ts             # S3 + CloudFront
├── deployment/                 # Configuration template (config.env.template)
├── docs/                       # Security + troubleshooting
├── ARCHITECTURE.md
└── README.md

# Shared with scaled-execution-containers/
# - container/ (ATX CLI Dockerfile and helper scripts — referenced by container-stack.ts)
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| AI Orchestration | Amazon Bedrock AgentCore + Strands Agents |
| AI Model | Claude Sonnet 4 (cross-region inference) |
| Memory | AgentCore Memory (short-term) |
| Transformation Engine | AWS Transform CLI (ATX) |
| Compute | AWS Batch (Fargate) |
| Storage | Amazon S3 |
| UI | React + Vite |
| CDN | Amazon CloudFront |
| API | API Gateway v2 (HTTP API) |
| Job Tracking | Amazon DynamoDB |
| Infrastructure | AWS CDK (TypeScript) |

---

## Observability

The platform uses [AgentCore Observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html) for tracing, debugging, and monitoring agent performance.

### One-Time Setup: Enable CloudWatch Transaction Search

Before traces appear, enable Transaction Search in your account (once per account):

```bash
# 1. Create resource policy for X-Ray → CloudWatch Logs
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws logs put-resource-policy --policy-name AgentCoreTransactionSearch \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"TransactionSearchXRayAccess\",
      \"Effect\": \"Allow\",
      \"Principal\": {\"Service\": \"xray.amazonaws.com\"},
      \"Action\": \"logs:PutLogEvents\",
      \"Resource\": [
        \"arn:aws:logs:us-east-1:${ACCOUNT_ID}:log-group:aws/spans:*\",
        \"arn:aws:logs:us-east-1:${ACCOUNT_ID}:log-group:/aws/application-signals/data:*\"
      ],
      \"Condition\": {
        \"ArnLike\": {\"aws:SourceArn\": \"arn:aws:xray:us-east-1:${ACCOUNT_ID}:*\"},
        \"StringEquals\": {\"aws:SourceAccount\": \"${ACCOUNT_ID}\"}
      }
    }]
  }"

# 2. Route trace segments to CloudWatch Logs
aws xray update-trace-segment-destination --destination CloudWatchLogs
```

Or enable via the [CloudWatch console](https://console.aws.amazon.com/cloudwatch/) → Settings → X-Ray traces → Transaction Search → Enable.

### What's Instrumented

- **Agent tracing (ADOT)**: The orchestrator includes `aws-opentelemetry-distro` and runs via `opentelemetry-instrument`, which auto-captures Bedrock model invocations, tool calls, and sub-agent interactions using GenAI semantic conventions.
- **Lambda tracing (X-Ray)**: The async invoke Lambda has X-Ray active tracing enabled for end-to-end visibility from API Gateway through Lambda to AgentCore.
- **Batch job logs**: ATX CLI container output goes to CloudWatch Logs (`/aws/batch/atx-transform`).
- **CloudWatch dashboard**: Pre-built dashboard with Lambda metrics and Batch job log insights.

### Viewing Traces

- **CloudWatch GenAI Observability**: [CloudWatch console](https://console.aws.amazon.com/cloudwatch/) → Application Signals → Traces. Shows agent workflow steps, token usage, latency, and error rates.
- **X-Ray**: [X-Ray console](https://console.aws.amazon.com/xray/home) → Traces. Filter by service name.
- **CloudWatch Dashboard**: Search for `ATX-Transform-CLI-Dashboard` in CloudWatch Dashboards.

See the [AgentCore Observability docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html) for advanced configuration.
