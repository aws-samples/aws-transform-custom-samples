#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
// import { AwsSolutionsChecks } from 'cdk-nag';
// import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';
import { ContainerStack } from '../lib/container-stack';
import { InfrastructureStack } from '../lib/infrastructure-stack';
import { AgentCoreStack } from '../lib/agentcore-stack';
import { UiStack } from '../lib/ui-stack';

const app = new cdk.App();

const ecrRepoName = app.node.tryGetContext('ecrRepoName') || 'atx-custom-ecr';
const awsRegion = app.node.tryGetContext('awsRegion') || 'us-east-1';
const fargateVcpu = app.node.tryGetContext('fargateVcpu') || 2;
const fargateMemory = app.node.tryGetContext('fargateMemory') || 4096;
const jobTimeout = app.node.tryGetContext('jobTimeout') || 43200;
const maxVcpus = app.node.tryGetContext('maxVcpus') || 256;

const existingOutputBucket = app.node.tryGetContext('existingOutputBucket') || '';
const existingSourceBucket = app.node.tryGetContext('existingSourceBucket') || '';
const existingVpcId = app.node.tryGetContext('existingVpcId') || '';
const existingSubnetIds = (() => {
  const raw = app.node.tryGetContext('existingSubnetIds');
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return raw.split(','); }
  }
  return [];
})();
const existingSecurityGroupId = app.node.tryGetContext('existingSecurityGroupId') || '';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: awsRegion,
};

// Stack 1: Container (ECR + Docker Image)
const containerStack = new ContainerStack(app, 'AtxContainerStack', {
  env,
  ecrRepoName,
  description: 'AWS Transform CLI - Container and ECR Repository',
});

// Stack 2: Infrastructure (Batch, S3, IAM, CloudWatch)
const infrastructureStack = new InfrastructureStack(app, 'AtxInfrastructureStack', {
  env,
  imageUri: containerStack.imageUri,
  fargateVcpu,
  fargateMemory,
  jobTimeout,
  maxVcpus,
  existingOutputBucket,
  existingSourceBucket,
  existingVpcId,
  existingSubnetIds,
  existingSecurityGroupId,
  description: 'AWS Transform CLI - Batch Infrastructure',
});
infrastructureStack.addDependency(containerStack);

// Stack 3: AgentCore + API (Orchestrator, Lambda, HTTP API)
// ⚠️ EXPERIMENTAL: Uses @aws-cdk/aws-bedrock-agentcore-alpha
const agentCoreStack = new AgentCoreStack(app, 'AtxAgentCoreStack', {
  env,
  outputBucketName: infrastructureStack.outputBucket.bucketName,
  sourceBucketName: infrastructureStack.sourceBucket.bucketName,
  jobsTableName: infrastructureStack.jobsTable.tableName,
  description: 'AWS Transform CLI - AgentCore Orchestrator + API (Experimental)',
});
agentCoreStack.addDependency(infrastructureStack);

// Stack 4: UI (S3 Static Site + CloudFront)
// No dependency on AgentCore — works with both SAM (Option A) and CDK (Option B)
const uiStack = new UiStack(app, 'AtxUiStack', {
  env,
  description: 'AWS Transform CLI - UI (S3 + CloudFront)',
});

// Apply cdk-nag to stable stacks (uncomment for security audits)
// Aspects.of(containerStack).add(new AwsSolutionsChecks({ verbose: true }));
// Aspects.of(infrastructureStack).add(new AwsSolutionsChecks({ verbose: true }));
// Aspects.of(uiStack).add(new AwsSolutionsChecks({ verbose: true }));
