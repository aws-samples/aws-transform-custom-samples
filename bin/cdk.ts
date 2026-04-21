#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';
import { ContainerStack } from '../lib/container-stack';
import { InfrastructureStack } from '../lib/infrastructure-stack';

const app = new cdk.App();

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

const fargateVcpu = app.node.tryGetContext('fargateVcpu') || 2;
const fargateMemory = app.node.tryGetContext('fargateMemory') || 8192;
const jobTimeout = app.node.tryGetContext('jobTimeout') || 43200;
const maxVcpus = app.node.tryGetContext('maxVcpus') || 256;

const existingOutputBucket = app.node.tryGetContext('existingOutputBucket') || '';
const existingSourceBucket = app.node.tryGetContext('existingSourceBucket') || '';
const existingVpcId = app.node.tryGetContext('existingVpcId') || '';
const existingSubnetIds = app.node.tryGetContext('existingSubnetIds') || [];
const existingSecurityGroupId = app.node.tryGetContext('existingSecurityGroupId') || '';
const prebuiltImageUri = app.node.tryGetContext('prebuiltImageUri') || '';

// Region resolution: match ATX CLI precedence, then CDK default, then us-east-1
const SUPPORTED_REGIONS = ['us-east-1', 'eu-central-1'];
const resolvedRegion =
  app.node.tryGetContext('awsRegion') ||
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  process.env.CDK_DEFAULT_REGION ||
  'us-east-1';

if (!SUPPORTED_REGIONS.includes(resolvedRegion)) {
  throw new Error(
    `Region '${resolvedRegion}' is not supported by AWS Transform Custom. ` +
    `Supported regions: ${SUPPORTED_REGIONS.join(', ')}. ` +
    `Set a supported region via -c awsRegion=<region>, AWS_REGION, or 'aws configure set region <region>'.`
  );
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: resolvedRegion,
};

// Stack 1: Container (ECR + Docker Image) — skipped when using a pre-built image
let imageUri: string;
let containerStack: ContainerStack | undefined;

if (prebuiltImageUri) {
  imageUri = prebuiltImageUri;
} else {
  containerStack = new ContainerStack(app, 'AtxContainerStack', {
    env,
    description: 'AWS Transform CLI - Container Image',
  });
  imageUri = containerStack.imageUri;
}

// Stack 2: Infrastructure (Batch, S3, IAM, Lambda, CloudWatch)
const infrastructureStack = new InfrastructureStack(app, 'AtxInfrastructureStack', {
  env,
  imageUri,
  fargateVcpu,
  fargateMemory,
  jobTimeout,
  maxVcpus,
  existingOutputBucket,
  existingSourceBucket,
  existingVpcId,
  existingSubnetIds,
  existingSecurityGroupId,
  description: 'AWS Transform CLI - Batch Infrastructure and Lambda Functions',
});
if (containerStack) {
  infrastructureStack.addDependency(containerStack);
}
