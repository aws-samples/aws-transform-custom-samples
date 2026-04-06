# Deployment Guide

2-step deployment for the base infrastructure (Batch + S3). The orchestrator and UI are deployed separately.

## Prerequisites

- Docker installed and running
- AWS CLI v2.13+ configured
- Git, Bash

## Configuration

```bash
cd deployment
cp config.env.template config.env
# Edit config.env if you want custom resource names (optional)
```

## Quick Start

```bash
# Step 0: Check prerequisites
./check-prereqs.sh

# Step 1: Build and push ATX CLI container
./1-build-and-push.sh

# Step 2: Deploy infrastructure (Batch, S3, VPC, IAM)
./2-deploy-infrastructure.sh
```

**Time:** 20-30 minutes total

After this, deploy the orchestrator and UI following the main [README.md](../README.md).

## Cleanup

```bash
./cleanup.sh
```

## IAM Permissions

Generate a least-privilege policy:
```bash
./generate-custom-policy.sh
aws iam create-policy --policy-name ATXCustomDeploymentPolicy --policy-document file://iam-custom-policy.json
```

## Troubleshooting

See [../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md).
