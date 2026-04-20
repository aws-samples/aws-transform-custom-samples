# CDK Infrastructure

AWS CDK stacks for the ATX Transform Platform.

## Stacks

| Stack | Resources |
|-------|-----------|
| `AtxContainerStack` | ECR repository + Docker image build (shared Dockerfile from `../../scaled-execution-containers/container/`) |
| `AtxInfrastructureStack` | VPC, S3 buckets, AWS Batch (Fargate), IAM roles, CloudWatch |
| `AtxAgentCoreStack` | AgentCore Runtime + async Lambda + HTTP API (experimental) |
| `AtxUiStack` | S3 bucket + CloudFront distribution for UI hosting |

> **Note:** `AtxContainerStack` reuses the container image defined in
> `scaled-execution-containers/container/` rather than duplicating the
> Dockerfile. Customizing the ATX CLI container for the agentic platform
> means editing that shared Dockerfile.

## Deploy (Option B: CDK-Only)

```bash
cd cdk
npm install

# Build UI first (AtxUiStack deploys from ui/dist/)
cd ../ui && npm install && npx vite build && cd ../cdk

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy all stacks
npx tsc
CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text) \
  cdk deploy --all --require-approval never
```

Or use the deploy script:
```bash
./deploy.sh
```

After deployment, rebuild the UI with the API endpoint and upload:
```bash
API_URL=$(aws cloudformation describe-stacks --stack-name AtxAgentCoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' --output text)
cd ../ui
VITE_API_ENDPOINT=$API_URL npx vite build
./deploy-aws.sh
```

## Deploy (Option A: CDK + SAM)

For Option A, CDK deploys `AtxContainerStack` and `AtxInfrastructureStack` only;
the AgentCore + API layer is deployed separately via `../sam/deploy.sh`. See the
top-level [README.md](../README.md) for the full Option A walkthrough.

```bash
# Deploy container + infrastructure only
cd cdk
npm install
npx tsc
cdk deploy AtxContainerStack AtxInfrastructureStack AtxUiStack --require-approval never
```

## Destroy

```bash
./destroy.sh
```
