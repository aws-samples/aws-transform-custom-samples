# AWS Transform CLI - CDK Deployment

Deploy AWS Transform CLI infrastructure using AWS CDK (TypeScript).

## Overview

CDK deployment provides a **fully automated, one-command deployment** that:
- ✅ Builds Docker container from Dockerfile automatically
- ✅ Pushes image to ECR automatically
- ✅ Deploys all infrastructure (Batch, S3, IAM, Lambda, API Gateway)
- ✅ No manual Docker commands needed
- ✅ Automatic rollback on failure

**Key Advantage:** Unlike bash scripts (3 separate commands), CDK does everything in one command with `./deploy.sh`.

---

## Prerequisites

- **Node.js 20+** (Node 18 works but is deprecated)
- **AWS CLI v2** configured with credentials
- **AWS CDK CLI**: `npm install -g aws-cdk`
- **Docker** (for building container image)
- **Git** (for cloning repository)


## AWS Profile Setup

**Using a specific AWS profile:** If you have multiple AWS accounts or profiles configured, set the `AWS_PROFILE` environment variable before deployment:

```bash
export AWS_PROFILE=your_profile_name
```

This ensures CDK deploys to the correct AWS account. Verify the profile is working:

```bash
aws sts get-caller-identity --profile your_profile_name
```

**Note:** When using a named profile, set both `AWS_PROFILE` and the account variables:

```bash
export AWS_PROFILE=your_profile_name
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile your_profile_name)
export CDK_DEFAULT_ACCOUNT=$AWS_ACCOUNT_ID
export CDK_DEFAULT_REGION=us-east-1
```

---

## Configuration

All CDK configuration is managed through context values in **`cdk.json`**. The user-configurable settings are at the bottom of the `context` block (the `@aws-cdk/...` entries above them are CDK feature flags and should not be changed).

Edit `cdk.json` before deploying to customize your infrastructure:

```json
{
  "context": {
    "ecrRepoName": "aws-transform-custom",
    "usePublicEcr": "false",
    "publicEcrImage": "public.ecr.aws/b7y6j9m3/aws-transform-custom:latest",
    "awsRegion": "us-east-1",
    "fargateVcpu": 2,
    "fargateMemory": 4096,
    "jobTimeout": 43200,
    "maxVcpus": 256,
    "existingOutputBucket": "",
    "existingSourceBucket": "",
    "existingVpcId": "",
    "existingSubnetIds": [],
    "existingSecurityGroupId": ""
  }
}
```

### Resource Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `ecrRepoName` | `aws-transform-custom` | ECR repository name |
| `usePublicEcr` | `false` | Use pre-built public ECR image (skip Docker build) |
| `publicEcrImage` | `public.ecr.aws/...` | Public ECR image URI (only when `usePublicEcr` is `true`) |
| `awsRegion` | `us-east-1` | AWS region for all resources |
| `fargateVcpu` | `2` | vCPU per Fargate task (0.25, 0.5, 1, 2, 4, 8, 16) |
| `fargateMemory` | `4096` | Memory in MB per task (512–30720, must be compatible with vCPU) |
| `jobTimeout` | `43200` | Max job duration in seconds (default: 12 hours) |
| `maxVcpus` | `256` | Max concurrent vCPUs (e.g., 256 = 128 jobs at 2 vCPU each) |

### Use Existing Resources (Optional)

By default, CDK creates all resources from scratch. To use existing resources instead, set these values:

| Setting | Default | Description |
|---------|---------|-------------|
| `existingOutputBucket` | `""` | Existing S3 bucket name for outputs (empty = create new) |
| `existingSourceBucket` | `""` | Existing S3 bucket name for source code (empty = create new) |
| `existingVpcId` | `""` | Existing VPC ID (empty = use account's default VPC) |
| `existingSubnetIds` | `[]` | Array of subnet IDs (empty = auto-discover public subnets from VPC) |
| `existingSecurityGroupId` | `""` | Existing security group ID (empty = create new) |

### ⚠️ No Default VPC? You Must Configure VPC Settings

If your AWS account does not have a default VPC (common in accounts created through AWS Organizations or where the default VPC was deleted), deployment will fail with an error like:

```
Cannot retrieve value from context provider vpc-provider
```

**To fix this**, set `existingVpcId` and `existingSubnetIds` in `cdk.json` before deploying:

```json
{
  "context": {
    "existingVpcId": "vpc-0123456789abcdef0",
    "existingSubnetIds": ["subnet-aaa111", "subnet-bbb222"],
    "existingSecurityGroupId": ""
  }
}
```

**Requirements for subnets:**
- Subnets must have **internet access** (Fargate tasks need to pull container images and reach AWS APIs)
- Use **public subnets** with an Internet Gateway, or **private subnets** with a NAT Gateway
- Provide at least **two subnets** in different Availability Zones for reliability

**Find your VPC and subnets:**
```bash
# List VPCs
aws ec2 describe-vpcs --query 'Vpcs[*].[VpcId,Tags[?Key==`Name`].Value|[0],IsDefault]' --output table

# List subnets for a VPC (look for ones with internet access)
aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-YOUR_VPC_ID" \
  --query 'Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch]' --output table
```

### Command-Line Overrides

You can also override any `cdk.json` context value on the command line without editing the file:

```bash
npx cdk deploy --all \
  -c existingVpcId=vpc-0123456789abcdef0 \
  -c existingSubnetIds='["subnet-aaa111","subnet-bbb222"]' \
  -c fargateVcpu=4 \
  -c fargateMemory=8192
```

Command-line values take precedence over `cdk.json`.

---

## Quick Start

> **Before you start:** If your AWS account doesn't have a default VPC, or you want to customize compute resources, region, or S3 buckets, edit `cdk.json` first. See the [Configuration](#configuration) section above.

### Option 1: With Least-Privilege IAM Policy (Recommended for Production)

```bash
# 1. Verify prerequisites
cd deployment
chmod +x *.sh
./check-prereqs.sh

# 2. Generate IAM policy with your account ID
./generate-custom-policy.sh

# 3. Create and attach policy
aws iam create-policy \
  --policy-name ATXCDKDeploymentPolicy \
  --policy-document file://iam-custom-policy.json

aws iam attach-user-policy \
  --user-name YOUR_USERNAME \
  --policy-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/ATXCDKDeploymentPolicy

# 4. Deploy with CDK
cd ../cdk
./deploy.sh
```

**Time:** 10 minutes

**Note:** `check-prereqs.sh` validates Docker, AWS CLI v2, Git, Node.js, CDK CLI, VPC, and public subnets.

### Option 2: With Admin Access (Quick Testing)

```bash
# 1. Verify prerequisites (optional but recommended)
cd deployment
./check-prereqs.sh

# 2. Deploy
cd ../cdk
./deploy.sh  # Automatically runs npm install and sets environment variables
```

**Time:** 10 minutes

**Note:** `./deploy.sh` handles all setup automatically. No need to manually set environment variables or run npm install.

**Force rebuild (if Dockerfile changes aren't detected):**
```bash
./deploy.sh --force  # Clears cache and rebuilds Docker image
```

**Force rebuild container only (after customizing Dockerfile):**
```bash
rm -rf cdk.out
cdk deploy AtxContainerStack --require-approval never --profile <your-profile> --force
```

This is useful when you've modified the Dockerfile (e.g., for private repository access) and want to rebuild just the container without redeploying the entire infrastructure.

---

## Docker Image Build

### Automatic Build (Default - Recommended)

CDK automatically builds and pushes the Docker image during deployment.

**What happens:**
1. CDK reads `container/Dockerfile`
2. Builds Docker image (~15-20 minutes first time)
3. Pushes to CDK-managed ECR repository
4. Uses image for Batch job definition

**No manual Docker commands needed!**

---

---

## Deployment Time

**Tested Performance:**
- **First deployment**: 10 minutes (all resources)
- **Subsequent updates**: 2-5 minutes (only changed resources)
- **Cleanup**: 3 minutes (destroy all stacks)

**Breakdown:**
- Container Stack: 1 minute
- Infrastructure Stack: 5 minutes
- API Stack: 4 minutes

---

## What Gets Deployed

### Stack 1: AtxContainerStack
- ECR repository
- Docker image (built from `../container/Dockerfile`)

### Stack 2: AtxInfrastructureStack
- S3 buckets (output, source)
- IAM roles (job role, execution role)
- Security group
- Batch compute environment (Fargate)
- Batch job queue
- Batch job definition
- CloudWatch log group
- CloudWatch dashboard

### Stack 3: AtxApiStack
- 7 Lambda functions
- API Gateway REST API
- IAM role for Lambda

---

## CDK Commands

```bash
# Synthesize CloudFormation templates
npm run build
npx cdk synth

# Show differences
npx cdk diff

# Deploy specific stack
npx cdk deploy AtxContainerStack
npx cdk deploy AtxInfrastructureStack
npx cdk deploy AtxApiStack

# Deploy all stacks
npx cdk deploy --all

# Destroy all stacks
./destroy.sh
# or
npx cdk destroy --all
```

---

## Stack Dependencies

```
AtxContainerStack
  ↓
AtxInfrastructureStack (depends on container image URI)
  ↓
AtxApiStack (depends on Batch resources and S3 buckets)
```

Stacks are deployed in order automatically.

---

## Outputs

After deployment, get outputs:

```bash
# All outputs
npx cdk output --all

# Specific output
npx cdk output AtxApiStack.ApiEndpoint
```

**Key outputs:**
- `AtxContainerStack.ImageUri` - Container image URI
- `AtxInfrastructureStack.OutputBucketName` - S3 output bucket
- `AtxInfrastructureStack.JobQueueArn` - Batch job queue ARN
- `AtxApiStack.ApiEndpoint` - API Gateway URL

---

## Next Steps

After successful deployment, test the API:

```bash
# Get API endpoint
export API_ENDPOINT=$(npx cdk output AtxApiStack.ApiEndpoint --json | jq -r '.AtxApiStack.ApiEndpoint')

# Option 1: Run comprehensive test suite (recommended)
cd ../test
./test-apis.sh

# Option 2: Test with a single job
python3 ../utilities/invoke-api.py \
  --endpoint "$API_ENDPOINT" \
  --path "/jobs" \
  --data '{
    "source": "https://github.com/venuvasu/todoapilambda",
    "command": "atx custom def exec -n AWS/python-version-upgrade -p /source/todoapilambda -x -t"
  }'
```

**See [../api/README.md](../api/README.md) for:**
- Complete API documentation
- All available endpoints
- Campaign-based transformations
- Bulk job submission examples

---

## Troubleshooting

### VPC Lookup Error

**Error:** "Cannot retrieve value from context provider vpc-provider"

**Cause:** Your AWS account does not have a default VPC. This is common in accounts created through AWS Organizations or where the default VPC was deleted.

**Fix:** Set your VPC and subnet IDs in `cdk.json` before deploying:

```json
{
  "context": {
    "existingVpcId": "vpc-0123456789abcdef0",
    "existingSubnetIds": ["subnet-aaa111", "subnet-bbb222"]
  }
}
```

Or pass them on the command line:
```bash
npx cdk deploy --all -c existingVpcId=vpc-YOUR_ID -c existingSubnetIds='["subnet-aaa","subnet-bbb"]'
```

To find your VPC and subnets:
```bash
aws ec2 describe-vpcs --query 'Vpcs[*].[VpcId,Tags[?Key==`Name`].Value|[0],IsDefault]' --output table
aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-YOUR_VPC_ID" \
  --query 'Subnets[*].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch]' --output table
```

See the [Configuration](#configuration) section for full details on VPC requirements.

### Docker Build Fails

**Error:** "Cannot connect to Docker daemon"

**Fix:** Start Docker Desktop or Docker daemon

### IAM Permissions

Deploying requires permissions for:
- CloudFormation
- ECR, S3, IAM, Batch, Lambda, API Gateway, CloudWatch, EC2

Use the generated policy from `../deployment/generate-custom-policy.sh` or have admin access.

### Node Version Warning

**Warning:** "Node 18 has reached end-of-life"

**Fix:** Upgrade to Node 20 or 22:
```bash
nvm install 20
nvm use 20
```

---

## Cleanup

```bash
./destroy.sh
```

**Note:** S3 buckets with data are retained by default. Delete manually if needed:
```bash
aws s3 rb s3://atx-custom-output-ACCOUNT_ID --force
aws s3 rb s3://atx-source-code-ACCOUNT_ID --force
```

---

## Development

### Project Structure

```
cdk/
├── bin/
│   └── cdk.ts              # CDK app entry point
├── lib/
│   ├── container-stack.ts  # ECR + Docker
│   ├── infrastructure-stack.ts  # Batch, S3, IAM
│   └── api-stack.ts        # Lambda + API Gateway
├── cdk.json                # CDK configuration
├── deploy.sh               # Deployment script
├── destroy.sh              # Cleanup script
└── README.md               # This file
```

### Making Changes

1. Edit TypeScript files in `lib/`
2. Build: `npm run build`
3. Test: `npx cdk synth`
4. Deploy: `npx cdk deploy --all`

### Adding Resources

Add resources to the appropriate stack:
- Container-related → `container-stack.ts`
- Batch/S3/IAM → `infrastructure-stack.ts`
- Lambda/API → `api-stack.ts`

---

## Support

For issues:
1. Check CloudFormation console for stack events
2. Review CDK synthesis: `npx cdk synth > template.yaml`
3. Check CloudWatch logs
4. See main project troubleshooting: `../docs/TROUBLESHOOTING.md`
