# CDK Infrastructure

AWS CDK stacks for the ATX Transform Platform.

## Stacks

| Stack | Resources |
|-------|-----------|
| `AtxContainerStack` | ECR repository + Docker image build |
| `AtxInfrastructureStack` | VPC, S3 buckets, AWS Batch (Fargate), IAM roles, CloudWatch |
| `AtxAgentCoreStack` | AgentCore Runtime + async Lambda + HTTP API (experimental) |
| `AtxUiStack` | S3 bucket + CloudFront distribution for UI hosting |

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

## Deploy (Option A: CLI-Based)

For Option A, only `AtxContainerStack` and `AtxInfrastructureStack` are used:
```bash
cd deployment
./1-build-and-push.sh
./2-deploy-infrastructure.sh
```

## Destroy

```bash
./destroy.sh
```
