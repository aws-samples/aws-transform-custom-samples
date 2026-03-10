#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';
import { ContainerStack } from '../lib/container-stack';
import { InfrastructureStack } from '../lib/infrastructure-stack';
import { ApiStack } from '../lib/api-stack';
import { NotificationStack } from '../lib/notification-stack';

const app = new cdk.App();

// Add cdk-nag AWS Solutions checks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Get configuration from context or use defaults
// Note: Context from cdk.json is read automatically by CDK
const ecrRepoName = app.node.tryGetContext('ecrRepoName') || 'aws-transform-custom';
const usePublicEcr = app.node.tryGetContext('usePublicEcr') === 'true';
const publicEcrImage = app.node.tryGetContext('publicEcrImage') || 'public.ecr.aws/b7y6j9m3/aws-transform-custom:latest';
const awsRegion = app.node.tryGetContext('awsRegion') || 'us-east-1';
const fargateVcpu = app.node.tryGetContext('fargateVcpu') || 2;
const fargateMemory = app.node.tryGetContext('fargateMemory') || 4096;
const jobTimeout = app.node.tryGetContext('jobTimeout') || 43200;
const maxVcpus = app.node.tryGetContext('maxVcpus') || 256;

// Optional: Use existing resources instead of creating new ones
const existingOutputBucket = app.node.tryGetContext('existingOutputBucket') || '';
const existingSourceBucket = app.node.tryGetContext('existingSourceBucket') || '';
const existingVpcId = app.node.tryGetContext('existingVpcId') || '';
const existingSubnetIds = app.node.tryGetContext('existingSubnetIds') || [];
const existingSecurityGroupId = app.node.tryGetContext('existingSecurityGroupId') || '';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: awsRegion,
};

let imageUri: string;
let containerStack: ContainerStack | undefined;

if (usePublicEcr) {
  // Use public ECR image directly
  imageUri = publicEcrImage;
  console.log(`Using public ECR image: ${imageUri}`);
} else {
  // Stack 1: Container (ECR + Docker Image) - only for private ECR
  containerStack = new ContainerStack(app, 'AtxContainerStack', {
    env,
    ecrRepoName,
    description: 'AWS Transform CLI - Container and ECR Repository',
  });
  imageUri = containerStack.imageUri;
}

// Stack 2: Infrastructure (Batch, S3, IAM, CloudWatch)
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
  description: 'AWS Transform CLI - Batch Infrastructure',
});
if (containerStack) {
  infrastructureStack.addDependency(containerStack);
}

// Stack 3: API (Lambda + API Gateway)
const apiStack = new ApiStack(app, 'AtxApiStack', {
  env,
  jobQueueName: 'atx-job-queue',
  jobDefinitionName: 'atx-transform-job',
  outputBucket: infrastructureStack.outputBucket,
  sourceBucket: infrastructureStack.sourceBucket,
  description: 'AWS Transform CLI - REST API',
});
apiStack.addDependency(infrastructureStack);

// Stack 4: Notifications (EventBridge + SNS)
const notificationStack = new NotificationStack(app, 'AtxNotificationStack', {
  env,
  jobQueueArn: infrastructureStack.jobQueue.attrJobQueueArn,
  description: 'AWS Transform CLI - Job Notifications',
});
notificationStack.addDependency(infrastructureStack);