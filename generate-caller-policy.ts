#!/usr/bin/env npx ts-node
/**
 * Generate IAM policies for the ATX remote execution caller.
 *
 * Produces two policies:
 *   1. atx-deployment-policy.json  — One-time CDK deployment (cdk deploy/destroy)
 *   2. atx-runtime-policy.json     — Day-to-day operations (invoke Lambdas, S3 sync)
 *
 * Usage: npx ts-node generate-caller-policy.ts
 */

import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

// -- Colours ------------------------------------------------------------------
const GREEN = '\x1b[32m', BLUE = '\x1b[34m', YELLOW = '\x1b[33m', RED = '\x1b[31m', NC = '\x1b[0m';
const log = {
  info:    (m: string) => console.log(`${BLUE}ℹ${NC} ${m}`),
  success: (m: string) => console.log(`${GREEN}✓${NC} ${m}`),
  warning: (m: string) => console.log(`${YELLOW}⚠${NC} ${m}`),
  error:   (m: string) => console.log(`${RED}✗${NC} ${m}`),
};

// -- Helpers ------------------------------------------------------------------
function exec(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch { return ''; }
}

// -- Auto-detect AWS context --------------------------------------------------
console.log('==========================================');
console.log('Generate ATX Caller IAM Policies');
console.log('==========================================\n');

let accountId = exec('aws sts get-caller-identity --query Account --output text');
if (!accountId) {
  log.warning('Could not detect AWS Account ID. Using placeholder.');
  accountId = 'REPLACE_WITH_ACCOUNT_ID';
} else {
  log.info(`AWS Account: ${accountId}`);
}

const region = exec('echo ${AWS_REGION:-${AWS_DEFAULT_REGION:-}}') || exec('aws configure get region') || 'us-east-1';
log.info(`AWS Region:  ${region}`);

// -- Resource names (must match CDK stack definitions) ------------------------
const resources = {
  s3Output:    `atx-custom-output-${accountId}`,
  s3Source:    `atx-source-code-${accountId}`,
  logGroup:    '/aws/batch/atx-transform',
  kmsAlias:    'atx-encryption-key',
  computeEnv:  'atx-fargate-compute',
  jobQueue:    'atx-job-queue',
  jobDef:      'atx-transform-job',
  dashboard:   'ATX-Transform-CLI-Dashboard',
} as const;

console.log('\nGenerating policies for these resources:');
console.log(`  • S3 Output:    ${resources.s3Output}`);
console.log(`  • S3 Source:    ${resources.s3Source}`);
console.log(`  • Log Group:    ${resources.logGroup}`);
console.log(`  • KMS Alias:    ${resources.kmsAlias}`);
console.log(`  • Job Queue:    ${resources.jobQueue}`);
console.log(`  • Job Def:      ${resources.jobDef}\n`);

// -- Shorthand for ARN building -----------------------------------------------
const arn = (service: string, resource: string) =>
  `arn:aws:${service}:${region}:${accountId}:${resource}`;

const lambdaFunctions = [
  'atx-trigger-job', 'atx-get-job-status', 'atx-terminate-job', 'atx-list-jobs',
  'atx-trigger-batch-jobs', 'atx-get-batch-status', 'atx-terminate-batch-jobs',
  'atx-list-batches', 'atx-configure-mcp',
];

// -- Policy types -------------------------------------------------------------
interface Statement {
  Sid: string;
  Effect: 'Allow';
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

interface PolicyDocument {
  Version: '2012-10-17';
  Statement: Statement[];
}

// -- Runtime policy -----------------------------------------------------------
const runtimePolicy: PolicyDocument = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'ATXTransformCustomAPI',
      Effect: 'Allow',
      Action: 'transform-custom:*',
      Resource: '*',
    },
    {
      Sid: 'LambdaInvokeATXFunctions',
      Effect: 'Allow',
      Action: 'lambda:InvokeFunction',
      Resource: lambdaFunctions.map(fn => arn('lambda', `function:${fn}`)),
    },
    {
      Sid: 'S3UploadSourceCode',
      Effect: 'Allow',
      Action: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
      Resource: [`arn:aws:s3:::${resources.s3Source}`, `arn:aws:s3:::${resources.s3Source}/*`],
    },
    {
      Sid: 'S3DownloadResults',
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:ListBucket'],
      Resource: [`arn:aws:s3:::${resources.s3Output}`, `arn:aws:s3:::${resources.s3Output}/*`],
    },
    {
      Sid: 'KMSEncryptDecrypt',
      Effect: 'Allow',
      Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey'],
      Resource: arn('kms', 'key/*'),
      Condition: {
        'ForAnyValue:StringEquals': {
          'kms:ResourceAliases': `alias/${resources.kmsAlias}`,
        },
      },
    },
    {
      Sid: 'SecretsManagerATXCredentials',
      Effect: 'Allow',
      Action: [
        'secretsmanager:CreateSecret', 'secretsmanager:PutSecretValue',
        'secretsmanager:DeleteSecret', 'secretsmanager:DescribeSecret',
      ],
      Resource: arn('secretsmanager', 'secret:atx/*'),
    },
    {
      Sid: 'CloudWatchReadLogs',
      Effect: 'Allow',
      Action: ['logs:GetLogEvents', 'logs:FilterLogEvents'],
      Resource: arn('logs', `log-group:${resources.logGroup}*`),
    },
    {
      Sid: 'CheckInfrastructureStatus',
      Effect: 'Allow',
      Action: 'cloudformation:DescribeStacks',
      Resource: arn('cloudformation', 'stack/AtxInfrastructureStack/*'),
    },
    {
      Sid: 'STSIdentity',
      Effect: 'Allow',
      Action: 'sts:GetCallerIdentity',
      Resource: '*',
    },
  ],
};

// -- Deployment policy --------------------------------------------------------
const deploymentPolicy: PolicyDocument = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'CloudFormationFullStacks',
      Effect: 'Allow',
      Action: [
        'cloudformation:CreateStack', 'cloudformation:UpdateStack', 'cloudformation:DeleteStack',
        'cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents',
        'cloudformation:GetTemplate', 'cloudformation:CreateChangeSet',
        'cloudformation:DescribeChangeSet', 'cloudformation:ExecuteChangeSet',
        'cloudformation:DeleteChangeSet', 'cloudformation:ListStacks',
      ],
      Resource: [
        arn('cloudformation', 'stack/AtxContainerStack/*'),
        arn('cloudformation', 'stack/AtxInfrastructureStack/*'),
        arn('cloudformation', 'stack/CDKToolkit/*'),
      ],
    },
    {
      Sid: 'CDKBootstrapS3',
      Effect: 'Allow',
      Action: [
        's3:CreateBucket', 's3:GetObject', 's3:PutObject', 's3:ListBucket',
        's3:GetBucketLocation', 's3:GetEncryptionConfiguration',
        's3:PutEncryptionConfiguration', 's3:PutBucketVersioning',
        's3:PutBucketPublicAccessBlock', 's3:PutLifecycleConfiguration',
        's3:PutBucketPolicy', 's3:GetBucketPolicy',
      ],
      Resource: [
        `arn:aws:s3:::cdk-*-assets-${accountId}-${region}`,
        `arn:aws:s3:::cdk-*-assets-${accountId}-${region}/*`,
        ...[resources.s3Output, resources.s3Source].flatMap(b =>
          [`arn:aws:s3:::${b}`, `arn:aws:s3:::${b}/*`]
        ),
      ],
    },
    {
      Sid: 'ECRContainerImage',
      Effect: 'Allow',
      Action: [
        'ecr:CreateRepository', 'ecr:DescribeRepositories',
        'ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload', 'ecr:PutImage',
        'ecr:SetRepositoryPolicy', 'ecr:GetRepositoryPolicy',
      ],
      Resource: arn('ecr', 'repository/cdk-*'),
    },
    {
      Sid: 'ECRAuthToken',
      Effect: 'Allow',
      Action: 'ecr:GetAuthorizationToken',
      Resource: '*',
    },
    {
      Sid: 'IAMRolesForATX',
      Effect: 'Allow',
      Action: [
        'iam:CreateRole', 'iam:DeleteRole', 'iam:GetRole', 'iam:PassRole',
        'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:PutRolePolicy',
        'iam:GetRolePolicy', 'iam:DeleteRolePolicy', 'iam:ListAttachedRolePolicies',
        'iam:ListRolePolicies', 'iam:TagRole', 'iam:UntagRole',
      ],
      Resource: [
        `arn:aws:iam::${accountId}:role/ATXBatchJobRole`,
        `arn:aws:iam::${accountId}:role/ATXBatchExecutionRole`,
        `arn:aws:iam::${accountId}:role/ATXLambdaSubmitRole`,
        `arn:aws:iam::${accountId}:role/ATXLambdaStatusRole`,
        `arn:aws:iam::${accountId}:role/ATXLambdaTerminateRole`,
        `arn:aws:iam::${accountId}:role/ATXLambdaConfigureRole`,
        `arn:aws:iam::${accountId}:role/cdk-*`,
      ],
    },
    {
      Sid: 'LambdaManagement',
      Effect: 'Allow',
      Action: [
        'lambda:CreateFunction', 'lambda:DeleteFunction', 'lambda:GetFunction',
        'lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration', 'lambda:AddPermission',
        'lambda:RemovePermission', 'lambda:TagResource', 'lambda:ListTags',
      ],
      Resource: arn('lambda', 'function:atx-*'),
    },
    {
      Sid: 'BatchManagement',
      Effect: 'Allow',
      Action: [
        'batch:CreateComputeEnvironment', 'batch:UpdateComputeEnvironment',
        'batch:DeleteComputeEnvironment', 'batch:CreateJobQueue',
        'batch:UpdateJobQueue', 'batch:DeleteJobQueue',
        'batch:RegisterJobDefinition', 'batch:DeregisterJobDefinition',
        'batch:DescribeComputeEnvironments', 'batch:DescribeJobQueues',
        'batch:DescribeJobDefinitions', 'batch:TagResource',
      ],
      Resource: [
        arn('batch', `compute-environment/${resources.computeEnv}`),
        arn('batch', `job-queue/${resources.jobQueue}`),
        arn('batch', `job-definition/${resources.jobDef}`),
        arn('batch', `job-definition/${resources.jobDef}:*`),
      ],
    },
    {
      Sid: 'EC2NetworkForBatch',
      Effect: 'Allow',
      Action: [
        'ec2:DescribeVpcs', 'ec2:DescribeSubnets', 'ec2:DescribeSecurityGroups',
        'ec2:DescribeRouteTables', 'ec2:DescribeInternetGateways',
        'ec2:DescribeNatGateways', 'ec2:DescribeAddresses',
        'ec2:DescribeAvailabilityZones', 'ec2:DescribeNetworkInterfaces',
        'ec2:CreateVpc', 'ec2:DeleteVpc', 'ec2:ModifyVpcAttribute',
        'ec2:CreateSubnet', 'ec2:DeleteSubnet',
        'ec2:CreateInternetGateway', 'ec2:DeleteInternetGateway',
        'ec2:AttachInternetGateway', 'ec2:DetachInternetGateway',
        'ec2:CreateNatGateway', 'ec2:DeleteNatGateway',
        'ec2:AllocateAddress', 'ec2:ReleaseAddress',
        'ec2:CreateRouteTable', 'ec2:DeleteRouteTable',
        'ec2:CreateRoute', 'ec2:DeleteRoute',
        'ec2:AssociateRouteTable', 'ec2:DisassociateRouteTable',
        'ec2:CreateSecurityGroup', 'ec2:DeleteSecurityGroup',
        'ec2:AuthorizeSecurityGroupEgress', 'ec2:RevokeSecurityGroupEgress',
        'ec2:CreateTags',
      ],
      Resource: '*',
    },
    {
      Sid: 'KMSKeyManagement',
      Effect: 'Allow',
      Action: [
        'kms:CreateKey', 'kms:CreateAlias', 'kms:DeleteAlias', 'kms:DescribeKey',
        'kms:EnableKeyRotation', 'kms:GetKeyPolicy', 'kms:PutKeyPolicy',
        'kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey', 'kms:TagResource',
      ],
      Resource: '*',
    },
    {
      Sid: 'CloudWatchLogsAndDashboard',
      Effect: 'Allow',
      Action: [
        'logs:CreateLogGroup', 'logs:DeleteLogGroup', 'logs:PutRetentionPolicy',
        'logs:DescribeLogGroups', 'logs:TagResource',
      ],
      Resource: [
        arn('logs', `log-group:${resources.logGroup}*`),
        arn('logs', 'log-group:/aws/lambda/atx-*'),
      ],
    },
    {
      Sid: 'CloudWatchDashboard',
      Effect: 'Allow',
      Action: ['cloudwatch:PutDashboard', 'cloudwatch:DeleteDashboards', 'cloudwatch:GetDashboard'],
      Resource: `arn:aws:cloudwatch::${accountId}:dashboard/${resources.dashboard}`,
    },
    {
      Sid: 'SSMForCDKBootstrap',
      Effect: 'Allow',
      Action: ['ssm:GetParameter', 'ssm:PutParameter'],
      Resource: arn('ssm', 'parameter/cdk-bootstrap/*'),
    },
    {
      Sid: 'STSIdentity',
      Effect: 'Allow',
      Action: 'sts:GetCallerIdentity',
      Resource: '*',
    },
  ],
};

// -- Write files --------------------------------------------------------------
const scriptDir = __dirname;
const runtimePath = resolve(scriptDir, 'atx-runtime-policy.json');
const deployPath  = resolve(scriptDir, 'atx-deployment-policy.json');

writeFileSync(runtimePath, JSON.stringify(runtimePolicy, null, 2) + '\n');
log.success(`Runtime policy generated: ${runtimePath}`);

writeFileSync(deployPath, JSON.stringify(deploymentPolicy, null, 2) + '\n');
log.success(`Deployment policy generated: ${deployPath}`);

// -- Summary ------------------------------------------------------------------
console.log(`
==========================================
Policy Summary
==========================================

Two policies generated:

  1. atx-runtime-policy.json
     Day-to-day operations: invoke Lambdas, upload source to S3,
     download results, manage private repo secrets, read logs.
     Required for remote mode execution.

  2. atx-deployment-policy.json
     One-time infrastructure setup: CDK deploy, CloudFormation,
     ECR, IAM roles, Batch, KMS, VPC, CloudWatch.
     Only needed when deploying or destroying the stacks.

Usage:

  # Create the policies
  aws iam create-policy \\
    --policy-name ATXRuntimePolicy \\
    --policy-document file://${runtimePath}

  aws iam create-policy \\
    --policy-name ATXDeploymentPolicy \\
    --policy-document file://${deployPath}

  # Attach to your IAM user or role
  aws iam attach-user-policy \\
    --user-name YOUR_USERNAME \\
    --policy-arn arn:aws:iam::${accountId}:policy/ATXRuntimePolicy`);

if (accountId === 'REPLACE_WITH_ACCOUNT_ID') {
  console.log('');
  log.warning("Account ID could not be detected.");
  console.log("Replace 'REPLACE_WITH_ACCOUNT_ID' in both policy files with your actual AWS account ID.");
}

console.log(`\nTo regenerate after changes: npx ts-node generate-caller-policy.ts\n`);
