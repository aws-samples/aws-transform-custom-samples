#!/usr/bin/env npx ts-node
"use strict";
/**
 * Generate IAM policies for the ATX remote execution caller.
 *
 * Produces two policies:
 *   1. atx-deployment-policy.json  — One-time CDK deployment (cdk deploy/destroy)
 *   2. atx-runtime-policy.json     — Day-to-day operations (invoke Lambdas, S3 sync)
 *
 * Usage: npx ts-node generate-caller-policy.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const path_1 = require("path");
// -- Colours ------------------------------------------------------------------
const GREEN = '\x1b[32m', BLUE = '\x1b[34m', YELLOW = '\x1b[33m', RED = '\x1b[31m', NC = '\x1b[0m';
const log = {
    info: (m) => console.log(`${BLUE}ℹ${NC} ${m}`),
    success: (m) => console.log(`${GREEN}✓${NC} ${m}`),
    warning: (m) => console.log(`${YELLOW}⚠${NC} ${m}`),
    error: (m) => console.log(`${RED}✗${NC} ${m}`),
};
// -- Helpers ------------------------------------------------------------------
function exec(cmd) {
    try {
        return (0, child_process_1.execSync)(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch {
        return '';
    }
}
// -- Auto-detect AWS context --------------------------------------------------
console.log('==========================================');
console.log('Generate ATX Caller IAM Policies');
console.log('==========================================\n');
let accountId = exec('aws sts get-caller-identity --query Account --output text');
if (!accountId) {
    log.warning('Could not detect AWS Account ID. Using placeholder.');
    accountId = 'REPLACE_WITH_ACCOUNT_ID';
}
else {
    log.info(`AWS Account: ${accountId}`);
}
const region = exec('echo ${AWS_REGION:-${AWS_DEFAULT_REGION:-}}') || exec('aws configure get region') || 'us-east-1';
log.info(`AWS Region:  ${region}`);
// -- Resource names (must match CDK stack definitions) ------------------------
const resources = {
    s3Output: `atx-custom-output-${accountId}`,
    s3Source: `atx-source-code-${accountId}`,
    logGroup: '/aws/batch/atx-transform',
    kmsAlias: 'atx-encryption-key',
    computeEnv: 'atx-fargate-compute',
    jobQueue: 'atx-job-queue',
    jobDef: 'atx-transform-job',
    dashboard: 'ATX-Transform-CLI-Dashboard',
};
console.log('\nGenerating policies for these resources:');
console.log(`  • S3 Output:    ${resources.s3Output}`);
console.log(`  • S3 Source:    ${resources.s3Source}`);
console.log(`  • Log Group:    ${resources.logGroup}`);
console.log(`  • KMS Alias:    ${resources.kmsAlias}`);
console.log(`  • Job Queue:    ${resources.jobQueue}`);
console.log(`  • Job Def:      ${resources.jobDef}\n`);
// -- Shorthand for ARN building -----------------------------------------------
const arn = (service, resource) => `arn:aws:${service}:${region}:${accountId}:${resource}`;
const lambdaFunctions = [
    'atx-trigger-job', 'atx-get-job-status', 'atx-terminate-job', 'atx-list-jobs',
    'atx-trigger-batch-jobs', 'atx-get-batch-status', 'atx-terminate-batch-jobs',
    'atx-list-batches', 'atx-configure-mcp',
];
// -- Runtime policy -----------------------------------------------------------
const runtimePolicy = {
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
const deploymentPolicy = {
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
                ...[resources.s3Output, resources.s3Source].flatMap(b => [`arn:aws:s3:::${b}`, `arn:aws:s3:::${b}/*`]),
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
const runtimePath = (0, path_1.resolve)(scriptDir, 'atx-runtime-policy.json');
const deployPath = (0, path_1.resolve)(scriptDir, 'atx-deployment-policy.json');
(0, fs_1.writeFileSync)(runtimePath, JSON.stringify(runtimePolicy, null, 2) + '\n');
log.success(`Runtime policy generated: ${runtimePath}`);
(0, fs_1.writeFileSync)(deployPath, JSON.stringify(deploymentPolicy, null, 2) + '\n');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2VuZXJhdGUtY2FsbGVyLXBvbGljeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImdlbmVyYXRlLWNhbGxlci1wb2xpY3kudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFDQTs7Ozs7Ozs7R0FRRzs7QUFFSCwyQkFBbUM7QUFDbkMsaURBQXlDO0FBQ3pDLCtCQUErQjtBQUUvQixnRkFBZ0Y7QUFDaEYsTUFBTSxLQUFLLEdBQUcsVUFBVSxFQUFFLElBQUksR0FBRyxVQUFVLEVBQUUsTUFBTSxHQUFHLFVBQVUsRUFBRSxHQUFHLEdBQUcsVUFBVSxFQUFFLEVBQUUsR0FBRyxTQUFTLENBQUM7QUFDbkcsTUFBTSxHQUFHLEdBQUc7SUFDVixJQUFJLEVBQUssQ0FBQyxDQUFTLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ3pELE9BQU8sRUFBRSxDQUFDLENBQVMsRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDMUQsT0FBTyxFQUFFLENBQUMsQ0FBUyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsTUFBTSxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUMzRCxLQUFLLEVBQUksQ0FBQyxDQUFTLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDO0NBQ3pELENBQUM7QUFFRixnRkFBZ0Y7QUFDaEYsU0FBUyxJQUFJLENBQUMsR0FBVztJQUN2QixJQUFJLENBQUM7UUFBQyxPQUFPLElBQUEsd0JBQVEsRUFBQyxHQUFHLEVBQUUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQUMsQ0FBQztJQUM1RixNQUFNLENBQUM7UUFBQyxPQUFPLEVBQUUsQ0FBQztJQUFDLENBQUM7QUFDdEIsQ0FBQztBQUVELGdGQUFnRjtBQUNoRixPQUFPLENBQUMsR0FBRyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7QUFDMUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO0FBQ2hELE9BQU8sQ0FBQyxHQUFHLENBQUMsOENBQThDLENBQUMsQ0FBQztBQUU1RCxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUMsMkRBQTJELENBQUMsQ0FBQztBQUNsRixJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7SUFDZixHQUFHLENBQUMsT0FBTyxDQUFDLHFEQUFxRCxDQUFDLENBQUM7SUFDbkUsU0FBUyxHQUFHLHlCQUF5QixDQUFDO0FBQ3hDLENBQUM7S0FBTSxDQUFDO0lBQ04sR0FBRyxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsU0FBUyxFQUFFLENBQUMsQ0FBQztBQUN4QyxDQUFDO0FBRUQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLDZDQUE2QyxDQUFDLElBQUksSUFBSSxDQUFDLDBCQUEwQixDQUFDLElBQUksV0FBVyxDQUFDO0FBQ3RILEdBQUcsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLE1BQU0sRUFBRSxDQUFDLENBQUM7QUFFbkMsZ0ZBQWdGO0FBQ2hGLE1BQU0sU0FBUyxHQUFHO0lBQ2hCLFFBQVEsRUFBSyxxQkFBcUIsU0FBUyxFQUFFO0lBQzdDLFFBQVEsRUFBSyxtQkFBbUIsU0FBUyxFQUFFO0lBQzNDLFFBQVEsRUFBSywwQkFBMEI7SUFDdkMsUUFBUSxFQUFLLG9CQUFvQjtJQUNqQyxVQUFVLEVBQUcscUJBQXFCO0lBQ2xDLFFBQVEsRUFBSyxlQUFlO0lBQzVCLE1BQU0sRUFBTyxtQkFBbUI7SUFDaEMsU0FBUyxFQUFJLDZCQUE2QjtDQUNsQyxDQUFDO0FBRVgsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDO0FBQzFELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO0FBQ3ZELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO0FBQ3ZELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO0FBQ3ZELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO0FBQ3ZELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO0FBQ3ZELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLFNBQVMsQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDO0FBRXZELGdGQUFnRjtBQUNoRixNQUFNLEdBQUcsR0FBRyxDQUFDLE9BQWUsRUFBRSxRQUFnQixFQUFFLEVBQUUsQ0FDaEQsV0FBVyxPQUFPLElBQUksTUFBTSxJQUFJLFNBQVMsSUFBSSxRQUFRLEVBQUUsQ0FBQztBQUUxRCxNQUFNLGVBQWUsR0FBRztJQUN0QixpQkFBaUIsRUFBRSxvQkFBb0IsRUFBRSxtQkFBbUIsRUFBRSxlQUFlO0lBQzdFLHdCQUF3QixFQUFFLHNCQUFzQixFQUFFLDBCQUEwQjtJQUM1RSxrQkFBa0IsRUFBRSxtQkFBbUI7Q0FDeEMsQ0FBQztBQWdCRixnRkFBZ0Y7QUFDaEYsTUFBTSxhQUFhLEdBQW1CO0lBQ3BDLE9BQU8sRUFBRSxZQUFZO0lBQ3JCLFNBQVMsRUFBRTtRQUNUO1lBQ0UsR0FBRyxFQUFFLHVCQUF1QjtZQUM1QixNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRSxvQkFBb0I7WUFDNUIsUUFBUSxFQUFFLEdBQUc7U0FDZDtRQUNEO1lBQ0UsR0FBRyxFQUFFLDBCQUEwQjtZQUMvQixNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRSx1QkFBdUI7WUFDL0IsUUFBUSxFQUFFLGVBQWUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLFlBQVksRUFBRSxFQUFFLENBQUMsQ0FBQztTQUNyRTtRQUNEO1lBQ0UsR0FBRyxFQUFFLG9CQUFvQjtZQUN6QixNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRSxDQUFDLGNBQWMsRUFBRSxjQUFjLEVBQUUsZUFBZSxDQUFDO1lBQ3pELFFBQVEsRUFBRSxDQUFDLGdCQUFnQixTQUFTLENBQUMsUUFBUSxFQUFFLEVBQUUsZ0JBQWdCLFNBQVMsQ0FBQyxRQUFRLElBQUksQ0FBQztTQUN6RjtRQUNEO1lBQ0UsR0FBRyxFQUFFLG1CQUFtQjtZQUN4QixNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRSxDQUFDLGNBQWMsRUFBRSxlQUFlLENBQUM7WUFDekMsUUFBUSxFQUFFLENBQUMsZ0JBQWdCLFNBQVMsQ0FBQyxRQUFRLEVBQUUsRUFBRSxnQkFBZ0IsU0FBUyxDQUFDLFFBQVEsSUFBSSxDQUFDO1NBQ3pGO1FBQ0Q7WUFDRSxHQUFHLEVBQUUsbUJBQW1CO1lBQ3hCLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFLENBQUMsYUFBYSxFQUFFLGFBQWEsRUFBRSxxQkFBcUIsQ0FBQztZQUM3RCxRQUFRLEVBQUUsR0FBRyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUM7WUFDN0IsU0FBUyxFQUFFO2dCQUNULDBCQUEwQixFQUFFO29CQUMxQixxQkFBcUIsRUFBRSxTQUFTLFNBQVMsQ0FBQyxRQUFRLEVBQUU7aUJBQ3JEO2FBQ0Y7U0FDRjtRQUNEO1lBQ0UsR0FBRyxFQUFFLDhCQUE4QjtZQUNuQyxNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRTtnQkFDTiw2QkFBNkIsRUFBRSwrQkFBK0I7Z0JBQzlELDZCQUE2QixFQUFFLCtCQUErQjthQUMvRDtZQUNELFFBQVEsRUFBRSxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsY0FBYyxDQUFDO1NBQ2hEO1FBQ0Q7WUFDRSxHQUFHLEVBQUUsb0JBQW9CO1lBQ3pCLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFLENBQUMsbUJBQW1CLEVBQUUsc0JBQXNCLENBQUM7WUFDckQsUUFBUSxFQUFFLEdBQUcsQ0FBQyxNQUFNLEVBQUUsYUFBYSxTQUFTLENBQUMsUUFBUSxHQUFHLENBQUM7U0FDMUQ7UUFDRDtZQUNFLEdBQUcsRUFBRSwyQkFBMkI7WUFDaEMsTUFBTSxFQUFFLE9BQU87WUFDZixNQUFNLEVBQUUsK0JBQStCO1lBQ3ZDLFFBQVEsRUFBRSxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsZ0NBQWdDLENBQUM7U0FDbEU7UUFDRDtZQUNFLEdBQUcsRUFBRSxhQUFhO1lBQ2xCLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFLHVCQUF1QjtZQUMvQixRQUFRLEVBQUUsR0FBRztTQUNkO0tBQ0Y7Q0FDRixDQUFDO0FBRUYsZ0ZBQWdGO0FBQ2hGLE1BQU0sZ0JBQWdCLEdBQW1CO0lBQ3ZDLE9BQU8sRUFBRSxZQUFZO0lBQ3JCLFNBQVMsRUFBRTtRQUNUO1lBQ0UsR0FBRyxFQUFFLDBCQUEwQjtZQUMvQixNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRTtnQkFDTiw0QkFBNEIsRUFBRSw0QkFBNEIsRUFBRSw0QkFBNEI7Z0JBQ3hGLCtCQUErQixFQUFFLG9DQUFvQztnQkFDckUsNEJBQTRCLEVBQUUsZ0NBQWdDO2dCQUM5RCxrQ0FBa0MsRUFBRSxpQ0FBaUM7Z0JBQ3JFLGdDQUFnQyxFQUFFLDJCQUEyQjthQUM5RDtZQUNELFFBQVEsRUFBRTtnQkFDUixHQUFHLENBQUMsZ0JBQWdCLEVBQUUsMkJBQTJCLENBQUM7Z0JBQ2xELEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxnQ0FBZ0MsQ0FBQztnQkFDdkQsR0FBRyxDQUFDLGdCQUFnQixFQUFFLG9CQUFvQixDQUFDO2FBQzVDO1NBQ0Y7UUFDRDtZQUNFLEdBQUcsRUFBRSxnQkFBZ0I7WUFDckIsTUFBTSxFQUFFLE9BQU87WUFDZixNQUFNLEVBQUU7Z0JBQ04saUJBQWlCLEVBQUUsY0FBYyxFQUFFLGNBQWMsRUFBRSxlQUFlO2dCQUNsRSxzQkFBc0IsRUFBRSwrQkFBK0I7Z0JBQ3ZELCtCQUErQixFQUFFLHdCQUF3QjtnQkFDekQsK0JBQStCLEVBQUUsOEJBQThCO2dCQUMvRCxvQkFBb0IsRUFBRSxvQkFBb0I7YUFDM0M7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsNkJBQTZCLFNBQVMsSUFBSSxNQUFNLEVBQUU7Z0JBQ2xELDZCQUE2QixTQUFTLElBQUksTUFBTSxJQUFJO2dCQUNwRCxHQUFHLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQ3RELENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUFFLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUM3QzthQUNGO1NBQ0Y7UUFDRDtZQUNFLEdBQUcsRUFBRSxtQkFBbUI7WUFDeEIsTUFBTSxFQUFFLE9BQU87WUFDZixNQUFNLEVBQUU7Z0JBQ04sc0JBQXNCLEVBQUUsMEJBQTBCO2dCQUNsRCxpQ0FBaUMsRUFBRSw0QkFBNEI7Z0JBQy9ELG1CQUFtQixFQUFFLHlCQUF5QixFQUFFLHFCQUFxQjtnQkFDckUseUJBQXlCLEVBQUUsY0FBYztnQkFDekMseUJBQXlCLEVBQUUseUJBQXlCO2FBQ3JEO1lBQ0QsUUFBUSxFQUFFLEdBQUcsQ0FBQyxLQUFLLEVBQUUsa0JBQWtCLENBQUM7U0FDekM7UUFDRDtZQUNFLEdBQUcsRUFBRSxjQUFjO1lBQ25CLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFLDJCQUEyQjtZQUNuQyxRQUFRLEVBQUUsR0FBRztTQUNkO1FBQ0Q7WUFDRSxHQUFHLEVBQUUsZ0JBQWdCO1lBQ3JCLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFO2dCQUNOLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLGFBQWEsRUFBRSxjQUFjO2dCQUNqRSxzQkFBc0IsRUFBRSxzQkFBc0IsRUFBRSxtQkFBbUI7Z0JBQ25FLG1CQUFtQixFQUFFLHNCQUFzQixFQUFFLDhCQUE4QjtnQkFDM0Usc0JBQXNCLEVBQUUsYUFBYSxFQUFFLGVBQWU7YUFDdkQ7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsZ0JBQWdCLFNBQVMsdUJBQXVCO2dCQUNoRCxnQkFBZ0IsU0FBUyw2QkFBNkI7Z0JBQ3RELGdCQUFnQixTQUFTLDJCQUEyQjtnQkFDcEQsZ0JBQWdCLFNBQVMsMkJBQTJCO2dCQUNwRCxnQkFBZ0IsU0FBUyw4QkFBOEI7Z0JBQ3ZELGdCQUFnQixTQUFTLDhCQUE4QjtnQkFDdkQsZ0JBQWdCLFNBQVMsYUFBYTthQUN2QztTQUNGO1FBQ0Q7WUFDRSxHQUFHLEVBQUUsa0JBQWtCO1lBQ3ZCLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFO2dCQUNOLHVCQUF1QixFQUFFLHVCQUF1QixFQUFFLG9CQUFvQjtnQkFDdEUsaUNBQWlDLEVBQUUsMkJBQTJCO2dCQUM5RCxvQ0FBb0MsRUFBRSxzQkFBc0I7Z0JBQzVELHlCQUF5QixFQUFFLG9CQUFvQixFQUFFLGlCQUFpQjthQUNuRTtZQUNELFFBQVEsRUFBRSxHQUFHLENBQUMsUUFBUSxFQUFFLGdCQUFnQixDQUFDO1NBQzFDO1FBQ0Q7WUFDRSxHQUFHLEVBQUUsaUJBQWlCO1lBQ3RCLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFO2dCQUNOLGdDQUFnQyxFQUFFLGdDQUFnQztnQkFDbEUsZ0NBQWdDLEVBQUUsc0JBQXNCO2dCQUN4RCxzQkFBc0IsRUFBRSxzQkFBc0I7Z0JBQzlDLDZCQUE2QixFQUFFLCtCQUErQjtnQkFDOUQsbUNBQW1DLEVBQUUseUJBQXlCO2dCQUM5RCw4QkFBOEIsRUFBRSxtQkFBbUI7YUFDcEQ7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsR0FBRyxDQUFDLE9BQU8sRUFBRSx1QkFBdUIsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUMzRCxHQUFHLENBQUMsT0FBTyxFQUFFLGFBQWEsU0FBUyxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUMvQyxHQUFHLENBQUMsT0FBTyxFQUFFLGtCQUFrQixTQUFTLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ2xELEdBQUcsQ0FBQyxPQUFPLEVBQUUsa0JBQWtCLFNBQVMsQ0FBQyxNQUFNLElBQUksQ0FBQzthQUNyRDtTQUNGO1FBQ0Q7WUFDRSxHQUFHLEVBQUUsb0JBQW9CO1lBQ3pCLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFO2dCQUNOLGtCQUFrQixFQUFFLHFCQUFxQixFQUFFLDRCQUE0QjtnQkFDdkUseUJBQXlCLEVBQUUseUJBQXlCO2dCQUNwRCxrQ0FBa0MsRUFBRSwrQkFBK0I7Z0JBQ25FLGdCQUFnQjthQUNqQjtZQUNELFFBQVEsRUFBRSxHQUFHO1NBQ2Q7UUFDRDtZQUNFLEdBQUcsRUFBRSxrQkFBa0I7WUFDdkIsTUFBTSxFQUFFLE9BQU87WUFDZixNQUFNLEVBQUU7Z0JBQ04sZUFBZSxFQUFFLGlCQUFpQixFQUFFLGlCQUFpQixFQUFFLGlCQUFpQjtnQkFDeEUsdUJBQXVCLEVBQUUsa0JBQWtCLEVBQUUsa0JBQWtCO2dCQUMvRCxhQUFhLEVBQUUsYUFBYSxFQUFFLHFCQUFxQixFQUFFLGlCQUFpQjthQUN2RTtZQUNELFFBQVEsRUFBRSxHQUFHO1NBQ2Q7UUFDRDtZQUNFLEdBQUcsRUFBRSw0QkFBNEI7WUFDakMsTUFBTSxFQUFFLE9BQU87WUFDZixNQUFNLEVBQUU7Z0JBQ04scUJBQXFCLEVBQUUscUJBQXFCLEVBQUUseUJBQXlCO2dCQUN2RSx3QkFBd0IsRUFBRSxrQkFBa0I7YUFDN0M7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsR0FBRyxDQUFDLE1BQU0sRUFBRSxhQUFhLFNBQVMsQ0FBQyxRQUFRLEdBQUcsQ0FBQztnQkFDL0MsR0FBRyxDQUFDLE1BQU0sRUFBRSw2QkFBNkIsQ0FBQzthQUMzQztTQUNGO1FBQ0Q7WUFDRSxHQUFHLEVBQUUscUJBQXFCO1lBQzFCLE1BQU0sRUFBRSxPQUFPO1lBQ2YsTUFBTSxFQUFFLENBQUMseUJBQXlCLEVBQUUsNkJBQTZCLEVBQUUseUJBQXlCLENBQUM7WUFDN0YsUUFBUSxFQUFFLHVCQUF1QixTQUFTLGNBQWMsU0FBUyxDQUFDLFNBQVMsRUFBRTtTQUM5RTtRQUNEO1lBQ0UsR0FBRyxFQUFFLG9CQUFvQjtZQUN6QixNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRSxDQUFDLGtCQUFrQixFQUFFLGtCQUFrQixDQUFDO1lBQ2hELFFBQVEsRUFBRSxHQUFHLENBQUMsS0FBSyxFQUFFLDJCQUEyQixDQUFDO1NBQ2xEO1FBQ0Q7WUFDRSxHQUFHLEVBQUUsYUFBYTtZQUNsQixNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRSx1QkFBdUI7WUFDL0IsUUFBUSxFQUFFLEdBQUc7U0FDZDtLQUNGO0NBQ0YsQ0FBQztBQUVGLGdGQUFnRjtBQUNoRixNQUFNLFNBQVMsR0FBRyxTQUFTLENBQUM7QUFDNUIsTUFBTSxXQUFXLEdBQUcsSUFBQSxjQUFPLEVBQUMsU0FBUyxFQUFFLHlCQUF5QixDQUFDLENBQUM7QUFDbEUsTUFBTSxVQUFVLEdBQUksSUFBQSxjQUFPLEVBQUMsU0FBUyxFQUFFLDRCQUE0QixDQUFDLENBQUM7QUFFckUsSUFBQSxrQkFBYSxFQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7QUFDMUUsR0FBRyxDQUFDLE9BQU8sQ0FBQyw2QkFBNkIsV0FBVyxFQUFFLENBQUMsQ0FBQztBQUV4RCxJQUFBLGtCQUFhLEVBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDO0FBQzVFLEdBQUcsQ0FBQyxPQUFPLENBQUMsZ0NBQWdDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFFMUQsZ0ZBQWdGO0FBQ2hGLE9BQU8sQ0FBQyxHQUFHLENBQUM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7K0JBc0JtQixXQUFXOzs7OytCQUlYLFVBQVU7Ozs7O2dDQUtULFNBQVMsMEJBQTBCLENBQUMsQ0FBQztBQUVyRSxJQUFJLFNBQVMsS0FBSyx5QkFBeUIsRUFBRSxDQUFDO0lBQzVDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDaEIsR0FBRyxDQUFDLE9BQU8sQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDO0lBQ2pELE9BQU8sQ0FBQyxHQUFHLENBQUMseUZBQXlGLENBQUMsQ0FBQztBQUN6RyxDQUFDO0FBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3RUFBd0UsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbnB4IHRzLW5vZGVcbi8qKlxuICogR2VuZXJhdGUgSUFNIHBvbGljaWVzIGZvciB0aGUgQVRYIHJlbW90ZSBleGVjdXRpb24gY2FsbGVyLlxuICpcbiAqIFByb2R1Y2VzIHR3byBwb2xpY2llczpcbiAqICAgMS4gYXR4LWRlcGxveW1lbnQtcG9saWN5Lmpzb24gIOKAlCBPbmUtdGltZSBDREsgZGVwbG95bWVudCAoY2RrIGRlcGxveS9kZXN0cm95KVxuICogICAyLiBhdHgtcnVudGltZS1wb2xpY3kuanNvbiAgICAg4oCUIERheS10by1kYXkgb3BlcmF0aW9ucyAoaW52b2tlIExhbWJkYXMsIFMzIHN5bmMpXG4gKlxuICogVXNhZ2U6IG5weCB0cy1ub2RlIGdlbmVyYXRlLWNhbGxlci1wb2xpY3kudHNcbiAqL1xuXG5pbXBvcnQgeyB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJztcblxuLy8gLS0gQ29sb3VycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmNvbnN0IEdSRUVOID0gJ1xceDFiWzMybScsIEJMVUUgPSAnXFx4MWJbMzRtJywgWUVMTE9XID0gJ1xceDFiWzMzbScsIFJFRCA9ICdcXHgxYlszMW0nLCBOQyA9ICdcXHgxYlswbSc7XG5jb25zdCBsb2cgPSB7XG4gIGluZm86ICAgIChtOiBzdHJpbmcpID0+IGNvbnNvbGUubG9nKGAke0JMVUV94oS5JHtOQ30gJHttfWApLFxuICBzdWNjZXNzOiAobTogc3RyaW5nKSA9PiBjb25zb2xlLmxvZyhgJHtHUkVFTn3inJMke05DfSAke219YCksXG4gIHdhcm5pbmc6IChtOiBzdHJpbmcpID0+IGNvbnNvbGUubG9nKGAke1lFTExPV33imqAke05DfSAke219YCksXG4gIGVycm9yOiAgIChtOiBzdHJpbmcpID0+IGNvbnNvbGUubG9nKGAke1JFRH3inJcke05DfSAke219YCksXG59O1xuXG4vLyAtLSBIZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuZnVuY3Rpb24gZXhlYyhjbWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7IHJldHVybiBleGVjU3luYyhjbWQsIHsgZW5jb2Rpbmc6ICd1dGYtOCcsIHN0ZGlvOiBbJ3BpcGUnLCAncGlwZScsICdwaXBlJ10gfSkudHJpbSgpOyB9XG4gIGNhdGNoIHsgcmV0dXJuICcnOyB9XG59XG5cbi8vIC0tIEF1dG8tZGV0ZWN0IEFXUyBjb250ZXh0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5jb25zb2xlLmxvZygnPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09Jyk7XG5jb25zb2xlLmxvZygnR2VuZXJhdGUgQVRYIENhbGxlciBJQU0gUG9saWNpZXMnKTtcbmNvbnNvbGUubG9nKCc9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cXG4nKTtcblxubGV0IGFjY291bnRJZCA9IGV4ZWMoJ2F3cyBzdHMgZ2V0LWNhbGxlci1pZGVudGl0eSAtLXF1ZXJ5IEFjY291bnQgLS1vdXRwdXQgdGV4dCcpO1xuaWYgKCFhY2NvdW50SWQpIHtcbiAgbG9nLndhcm5pbmcoJ0NvdWxkIG5vdCBkZXRlY3QgQVdTIEFjY291bnQgSUQuIFVzaW5nIHBsYWNlaG9sZGVyLicpO1xuICBhY2NvdW50SWQgPSAnUkVQTEFDRV9XSVRIX0FDQ09VTlRfSUQnO1xufSBlbHNlIHtcbiAgbG9nLmluZm8oYEFXUyBBY2NvdW50OiAke2FjY291bnRJZH1gKTtcbn1cblxuY29uc3QgcmVnaW9uID0gZXhlYygnZWNobyAke0FXU19SRUdJT046LSR7QVdTX0RFRkFVTFRfUkVHSU9OOi19fScpIHx8IGV4ZWMoJ2F3cyBjb25maWd1cmUgZ2V0IHJlZ2lvbicpIHx8ICd1cy1lYXN0LTEnO1xubG9nLmluZm8oYEFXUyBSZWdpb246ICAke3JlZ2lvbn1gKTtcblxuLy8gLS0gUmVzb3VyY2UgbmFtZXMgKG11c3QgbWF0Y2ggQ0RLIHN0YWNrIGRlZmluaXRpb25zKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmNvbnN0IHJlc291cmNlcyA9IHtcbiAgczNPdXRwdXQ6ICAgIGBhdHgtY3VzdG9tLW91dHB1dC0ke2FjY291bnRJZH1gLFxuICBzM1NvdXJjZTogICAgYGF0eC1zb3VyY2UtY29kZS0ke2FjY291bnRJZH1gLFxuICBsb2dHcm91cDogICAgJy9hd3MvYmF0Y2gvYXR4LXRyYW5zZm9ybScsXG4gIGttc0FsaWFzOiAgICAnYXR4LWVuY3J5cHRpb24ta2V5JyxcbiAgY29tcHV0ZUVudjogICdhdHgtZmFyZ2F0ZS1jb21wdXRlJyxcbiAgam9iUXVldWU6ICAgICdhdHgtam9iLXF1ZXVlJyxcbiAgam9iRGVmOiAgICAgICdhdHgtdHJhbnNmb3JtLWpvYicsXG4gIGRhc2hib2FyZDogICAnQVRYLVRyYW5zZm9ybS1DTEktRGFzaGJvYXJkJyxcbn0gYXMgY29uc3Q7XG5cbmNvbnNvbGUubG9nKCdcXG5HZW5lcmF0aW5nIHBvbGljaWVzIGZvciB0aGVzZSByZXNvdXJjZXM6Jyk7XG5jb25zb2xlLmxvZyhgICDigKIgUzMgT3V0cHV0OiAgICAke3Jlc291cmNlcy5zM091dHB1dH1gKTtcbmNvbnNvbGUubG9nKGAgIOKAoiBTMyBTb3VyY2U6ICAgICR7cmVzb3VyY2VzLnMzU291cmNlfWApO1xuY29uc29sZS5sb2coYCAg4oCiIExvZyBHcm91cDogICAgJHtyZXNvdXJjZXMubG9nR3JvdXB9YCk7XG5jb25zb2xlLmxvZyhgICDigKIgS01TIEFsaWFzOiAgICAke3Jlc291cmNlcy5rbXNBbGlhc31gKTtcbmNvbnNvbGUubG9nKGAgIOKAoiBKb2IgUXVldWU6ICAgICR7cmVzb3VyY2VzLmpvYlF1ZXVlfWApO1xuY29uc29sZS5sb2coYCAg4oCiIEpvYiBEZWY6ICAgICAgJHtyZXNvdXJjZXMuam9iRGVmfVxcbmApO1xuXG4vLyAtLSBTaG9ydGhhbmQgZm9yIEFSTiBidWlsZGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuY29uc3QgYXJuID0gKHNlcnZpY2U6IHN0cmluZywgcmVzb3VyY2U6IHN0cmluZykgPT5cbiAgYGFybjphd3M6JHtzZXJ2aWNlfToke3JlZ2lvbn06JHthY2NvdW50SWR9OiR7cmVzb3VyY2V9YDtcblxuY29uc3QgbGFtYmRhRnVuY3Rpb25zID0gW1xuICAnYXR4LXRyaWdnZXItam9iJywgJ2F0eC1nZXQtam9iLXN0YXR1cycsICdhdHgtdGVybWluYXRlLWpvYicsICdhdHgtbGlzdC1qb2JzJyxcbiAgJ2F0eC10cmlnZ2VyLWJhdGNoLWpvYnMnLCAnYXR4LWdldC1iYXRjaC1zdGF0dXMnLCAnYXR4LXRlcm1pbmF0ZS1iYXRjaC1qb2JzJyxcbiAgJ2F0eC1saXN0LWJhdGNoZXMnLCAnYXR4LWNvbmZpZ3VyZS1tY3AnLFxuXTtcblxuLy8gLS0gUG9saWN5IHR5cGVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmludGVyZmFjZSBTdGF0ZW1lbnQge1xuICBTaWQ6IHN0cmluZztcbiAgRWZmZWN0OiAnQWxsb3cnO1xuICBBY3Rpb246IHN0cmluZyB8IHN0cmluZ1tdO1xuICBSZXNvdXJjZTogc3RyaW5nIHwgc3RyaW5nW107XG4gIENvbmRpdGlvbj86IFJlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHN0cmluZ1tdPj47XG59XG5cbmludGVyZmFjZSBQb2xpY3lEb2N1bWVudCB7XG4gIFZlcnNpb246ICcyMDEyLTEwLTE3JztcbiAgU3RhdGVtZW50OiBTdGF0ZW1lbnRbXTtcbn1cblxuLy8gLS0gUnVudGltZSBwb2xpY3kgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmNvbnN0IHJ1bnRpbWVQb2xpY3k6IFBvbGljeURvY3VtZW50ID0ge1xuICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gIFN0YXRlbWVudDogW1xuICAgIHtcbiAgICAgIFNpZDogJ0FUWFRyYW5zZm9ybUN1c3RvbUFQSScsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246ICd0cmFuc2Zvcm0tY3VzdG9tOionLFxuICAgICAgUmVzb3VyY2U6ICcqJyxcbiAgICB9LFxuICAgIHtcbiAgICAgIFNpZDogJ0xhbWJkYUludm9rZUFUWEZ1bmN0aW9ucycsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246ICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nLFxuICAgICAgUmVzb3VyY2U6IGxhbWJkYUZ1bmN0aW9ucy5tYXAoZm4gPT4gYXJuKCdsYW1iZGEnLCBgZnVuY3Rpb246JHtmbn1gKSksXG4gICAgfSxcbiAgICB7XG4gICAgICBTaWQ6ICdTM1VwbG9hZFNvdXJjZUNvZGUnLFxuICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgQWN0aW9uOiBbJ3MzOlB1dE9iamVjdCcsICdzMzpHZXRPYmplY3QnLCAnczM6TGlzdEJ1Y2tldCddLFxuICAgICAgUmVzb3VyY2U6IFtgYXJuOmF3czpzMzo6OiR7cmVzb3VyY2VzLnMzU291cmNlfWAsIGBhcm46YXdzOnMzOjo6JHtyZXNvdXJjZXMuczNTb3VyY2V9LypgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIFNpZDogJ1MzRG93bmxvYWRSZXN1bHRzJyxcbiAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgIEFjdGlvbjogWydzMzpHZXRPYmplY3QnLCAnczM6TGlzdEJ1Y2tldCddLFxuICAgICAgUmVzb3VyY2U6IFtgYXJuOmF3czpzMzo6OiR7cmVzb3VyY2VzLnMzT3V0cHV0fWAsIGBhcm46YXdzOnMzOjo6JHtyZXNvdXJjZXMuczNPdXRwdXR9LypgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIFNpZDogJ0tNU0VuY3J5cHREZWNyeXB0JyxcbiAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgIEFjdGlvbjogWydrbXM6RW5jcnlwdCcsICdrbXM6RGVjcnlwdCcsICdrbXM6R2VuZXJhdGVEYXRhS2V5J10sXG4gICAgICBSZXNvdXJjZTogYXJuKCdrbXMnLCAna2V5LyonKSxcbiAgICAgIENvbmRpdGlvbjoge1xuICAgICAgICAnRm9yQW55VmFsdWU6U3RyaW5nRXF1YWxzJzoge1xuICAgICAgICAgICdrbXM6UmVzb3VyY2VBbGlhc2VzJzogYGFsaWFzLyR7cmVzb3VyY2VzLmttc0FsaWFzfWAsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnU2VjcmV0c01hbmFnZXJBVFhDcmVkZW50aWFscycsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246IFtcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkNyZWF0ZVNlY3JldCcsICdzZWNyZXRzbWFuYWdlcjpQdXRTZWNyZXRWYWx1ZScsXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpEZWxldGVTZWNyZXQnLCAnc2VjcmV0c21hbmFnZXI6RGVzY3JpYmVTZWNyZXQnLFxuICAgICAgXSxcbiAgICAgIFJlc291cmNlOiBhcm4oJ3NlY3JldHNtYW5hZ2VyJywgJ3NlY3JldDphdHgvKicpLFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnQ2xvdWRXYXRjaFJlYWRMb2dzJyxcbiAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgIEFjdGlvbjogWydsb2dzOkdldExvZ0V2ZW50cycsICdsb2dzOkZpbHRlckxvZ0V2ZW50cyddLFxuICAgICAgUmVzb3VyY2U6IGFybignbG9ncycsIGBsb2ctZ3JvdXA6JHtyZXNvdXJjZXMubG9nR3JvdXB9KmApLFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnQ2hlY2tJbmZyYXN0cnVjdHVyZVN0YXR1cycsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246ICdjbG91ZGZvcm1hdGlvbjpEZXNjcmliZVN0YWNrcycsXG4gICAgICBSZXNvdXJjZTogYXJuKCdjbG91ZGZvcm1hdGlvbicsICdzdGFjay9BdHhJbmZyYXN0cnVjdHVyZVN0YWNrLyonKSxcbiAgICB9LFxuICAgIHtcbiAgICAgIFNpZDogJ1NUU0lkZW50aXR5JyxcbiAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgIEFjdGlvbjogJ3N0czpHZXRDYWxsZXJJZGVudGl0eScsXG4gICAgICBSZXNvdXJjZTogJyonLFxuICAgIH0sXG4gIF0sXG59O1xuXG4vLyAtLSBEZXBsb3ltZW50IHBvbGljeSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuY29uc3QgZGVwbG95bWVudFBvbGljeTogUG9saWN5RG9jdW1lbnQgPSB7XG4gIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgU3RhdGVtZW50OiBbXG4gICAge1xuICAgICAgU2lkOiAnQ2xvdWRGb3JtYXRpb25GdWxsU3RhY2tzJyxcbiAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgIEFjdGlvbjogW1xuICAgICAgICAnY2xvdWRmb3JtYXRpb246Q3JlYXRlU3RhY2snLCAnY2xvdWRmb3JtYXRpb246VXBkYXRlU3RhY2snLCAnY2xvdWRmb3JtYXRpb246RGVsZXRlU3RhY2snLFxuICAgICAgICAnY2xvdWRmb3JtYXRpb246RGVzY3JpYmVTdGFja3MnLCAnY2xvdWRmb3JtYXRpb246RGVzY3JpYmVTdGFja0V2ZW50cycsXG4gICAgICAgICdjbG91ZGZvcm1hdGlvbjpHZXRUZW1wbGF0ZScsICdjbG91ZGZvcm1hdGlvbjpDcmVhdGVDaGFuZ2VTZXQnLFxuICAgICAgICAnY2xvdWRmb3JtYXRpb246RGVzY3JpYmVDaGFuZ2VTZXQnLCAnY2xvdWRmb3JtYXRpb246RXhlY3V0ZUNoYW5nZVNldCcsXG4gICAgICAgICdjbG91ZGZvcm1hdGlvbjpEZWxldGVDaGFuZ2VTZXQnLCAnY2xvdWRmb3JtYXRpb246TGlzdFN0YWNrcycsXG4gICAgICBdLFxuICAgICAgUmVzb3VyY2U6IFtcbiAgICAgICAgYXJuKCdjbG91ZGZvcm1hdGlvbicsICdzdGFjay9BdHhDb250YWluZXJTdGFjay8qJyksXG4gICAgICAgIGFybignY2xvdWRmb3JtYXRpb24nLCAnc3RhY2svQXR4SW5mcmFzdHJ1Y3R1cmVTdGFjay8qJyksXG4gICAgICAgIGFybignY2xvdWRmb3JtYXRpb24nLCAnc3RhY2svQ0RLVG9vbGtpdC8qJyksXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnQ0RLQm9vdHN0cmFwUzMnLFxuICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgQWN0aW9uOiBbXG4gICAgICAgICdzMzpDcmVhdGVCdWNrZXQnLCAnczM6R2V0T2JqZWN0JywgJ3MzOlB1dE9iamVjdCcsICdzMzpMaXN0QnVja2V0JyxcbiAgICAgICAgJ3MzOkdldEJ1Y2tldExvY2F0aW9uJywgJ3MzOkdldEVuY3J5cHRpb25Db25maWd1cmF0aW9uJyxcbiAgICAgICAgJ3MzOlB1dEVuY3J5cHRpb25Db25maWd1cmF0aW9uJywgJ3MzOlB1dEJ1Y2tldFZlcnNpb25pbmcnLFxuICAgICAgICAnczM6UHV0QnVja2V0UHVibGljQWNjZXNzQmxvY2snLCAnczM6UHV0TGlmZWN5Y2xlQ29uZmlndXJhdGlvbicsXG4gICAgICAgICdzMzpQdXRCdWNrZXRQb2xpY3knLCAnczM6R2V0QnVja2V0UG9saWN5JyxcbiAgICAgIF0sXG4gICAgICBSZXNvdXJjZTogW1xuICAgICAgICBgYXJuOmF3czpzMzo6OmNkay0qLWFzc2V0cy0ke2FjY291bnRJZH0tJHtyZWdpb259YCxcbiAgICAgICAgYGFybjphd3M6czM6OjpjZGstKi1hc3NldHMtJHthY2NvdW50SWR9LSR7cmVnaW9ufS8qYCxcbiAgICAgICAgLi4uW3Jlc291cmNlcy5zM091dHB1dCwgcmVzb3VyY2VzLnMzU291cmNlXS5mbGF0TWFwKGIgPT5cbiAgICAgICAgICBbYGFybjphd3M6czM6Ojoke2J9YCwgYGFybjphd3M6czM6Ojoke2J9LypgXVxuICAgICAgICApLFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIFNpZDogJ0VDUkNvbnRhaW5lckltYWdlJyxcbiAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgIEFjdGlvbjogW1xuICAgICAgICAnZWNyOkNyZWF0ZVJlcG9zaXRvcnknLCAnZWNyOkRlc2NyaWJlUmVwb3NpdG9yaWVzJyxcbiAgICAgICAgJ2VjcjpCYXRjaENoZWNrTGF5ZXJBdmFpbGFiaWxpdHknLCAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLFxuICAgICAgICAnZWNyOkJhdGNoR2V0SW1hZ2UnLCAnZWNyOkluaXRpYXRlTGF5ZXJVcGxvYWQnLCAnZWNyOlVwbG9hZExheWVyUGFydCcsXG4gICAgICAgICdlY3I6Q29tcGxldGVMYXllclVwbG9hZCcsICdlY3I6UHV0SW1hZ2UnLFxuICAgICAgICAnZWNyOlNldFJlcG9zaXRvcnlQb2xpY3knLCAnZWNyOkdldFJlcG9zaXRvcnlQb2xpY3knLFxuICAgICAgXSxcbiAgICAgIFJlc291cmNlOiBhcm4oJ2VjcicsICdyZXBvc2l0b3J5L2Nkay0qJyksXG4gICAgfSxcbiAgICB7XG4gICAgICBTaWQ6ICdFQ1JBdXRoVG9rZW4nLFxuICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgQWN0aW9uOiAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbicsXG4gICAgICBSZXNvdXJjZTogJyonLFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnSUFNUm9sZXNGb3JBVFgnLFxuICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgQWN0aW9uOiBbXG4gICAgICAgICdpYW06Q3JlYXRlUm9sZScsICdpYW06RGVsZXRlUm9sZScsICdpYW06R2V0Um9sZScsICdpYW06UGFzc1JvbGUnLFxuICAgICAgICAnaWFtOkF0dGFjaFJvbGVQb2xpY3knLCAnaWFtOkRldGFjaFJvbGVQb2xpY3knLCAnaWFtOlB1dFJvbGVQb2xpY3knLFxuICAgICAgICAnaWFtOkdldFJvbGVQb2xpY3knLCAnaWFtOkRlbGV0ZVJvbGVQb2xpY3knLCAnaWFtOkxpc3RBdHRhY2hlZFJvbGVQb2xpY2llcycsXG4gICAgICAgICdpYW06TGlzdFJvbGVQb2xpY2llcycsICdpYW06VGFnUm9sZScsICdpYW06VW50YWdSb2xlJyxcbiAgICAgIF0sXG4gICAgICBSZXNvdXJjZTogW1xuICAgICAgICBgYXJuOmF3czppYW06OiR7YWNjb3VudElkfTpyb2xlL0FUWEJhdGNoSm9iUm9sZWAsXG4gICAgICAgIGBhcm46YXdzOmlhbTo6JHthY2NvdW50SWR9OnJvbGUvQVRYQmF0Y2hFeGVjdXRpb25Sb2xlYCxcbiAgICAgICAgYGFybjphd3M6aWFtOjoke2FjY291bnRJZH06cm9sZS9BVFhMYW1iZGFTdWJtaXRSb2xlYCxcbiAgICAgICAgYGFybjphd3M6aWFtOjoke2FjY291bnRJZH06cm9sZS9BVFhMYW1iZGFTdGF0dXNSb2xlYCxcbiAgICAgICAgYGFybjphd3M6aWFtOjoke2FjY291bnRJZH06cm9sZS9BVFhMYW1iZGFUZXJtaW5hdGVSb2xlYCxcbiAgICAgICAgYGFybjphd3M6aWFtOjoke2FjY291bnRJZH06cm9sZS9BVFhMYW1iZGFDb25maWd1cmVSb2xlYCxcbiAgICAgICAgYGFybjphd3M6aWFtOjoke2FjY291bnRJZH06cm9sZS9jZGstKmAsXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnTGFtYmRhTWFuYWdlbWVudCcsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246IFtcbiAgICAgICAgJ2xhbWJkYTpDcmVhdGVGdW5jdGlvbicsICdsYW1iZGE6RGVsZXRlRnVuY3Rpb24nLCAnbGFtYmRhOkdldEZ1bmN0aW9uJyxcbiAgICAgICAgJ2xhbWJkYTpHZXRGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLCAnbGFtYmRhOlVwZGF0ZUZ1bmN0aW9uQ29kZScsXG4gICAgICAgICdsYW1iZGE6VXBkYXRlRnVuY3Rpb25Db25maWd1cmF0aW9uJywgJ2xhbWJkYTpBZGRQZXJtaXNzaW9uJyxcbiAgICAgICAgJ2xhbWJkYTpSZW1vdmVQZXJtaXNzaW9uJywgJ2xhbWJkYTpUYWdSZXNvdXJjZScsICdsYW1iZGE6TGlzdFRhZ3MnLFxuICAgICAgXSxcbiAgICAgIFJlc291cmNlOiBhcm4oJ2xhbWJkYScsICdmdW5jdGlvbjphdHgtKicpLFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnQmF0Y2hNYW5hZ2VtZW50JyxcbiAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgIEFjdGlvbjogW1xuICAgICAgICAnYmF0Y2g6Q3JlYXRlQ29tcHV0ZUVudmlyb25tZW50JywgJ2JhdGNoOlVwZGF0ZUNvbXB1dGVFbnZpcm9ubWVudCcsXG4gICAgICAgICdiYXRjaDpEZWxldGVDb21wdXRlRW52aXJvbm1lbnQnLCAnYmF0Y2g6Q3JlYXRlSm9iUXVldWUnLFxuICAgICAgICAnYmF0Y2g6VXBkYXRlSm9iUXVldWUnLCAnYmF0Y2g6RGVsZXRlSm9iUXVldWUnLFxuICAgICAgICAnYmF0Y2g6UmVnaXN0ZXJKb2JEZWZpbml0aW9uJywgJ2JhdGNoOkRlcmVnaXN0ZXJKb2JEZWZpbml0aW9uJyxcbiAgICAgICAgJ2JhdGNoOkRlc2NyaWJlQ29tcHV0ZUVudmlyb25tZW50cycsICdiYXRjaDpEZXNjcmliZUpvYlF1ZXVlcycsXG4gICAgICAgICdiYXRjaDpEZXNjcmliZUpvYkRlZmluaXRpb25zJywgJ2JhdGNoOlRhZ1Jlc291cmNlJyxcbiAgICAgIF0sXG4gICAgICBSZXNvdXJjZTogW1xuICAgICAgICBhcm4oJ2JhdGNoJywgYGNvbXB1dGUtZW52aXJvbm1lbnQvJHtyZXNvdXJjZXMuY29tcHV0ZUVudn1gKSxcbiAgICAgICAgYXJuKCdiYXRjaCcsIGBqb2ItcXVldWUvJHtyZXNvdXJjZXMuam9iUXVldWV9YCksXG4gICAgICAgIGFybignYmF0Y2gnLCBgam9iLWRlZmluaXRpb24vJHtyZXNvdXJjZXMuam9iRGVmfWApLFxuICAgICAgICBhcm4oJ2JhdGNoJywgYGpvYi1kZWZpbml0aW9uLyR7cmVzb3VyY2VzLmpvYkRlZn06KmApLFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIFNpZDogJ0VDMk5ldHdvcmtGb3JCYXRjaCcsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246IFtcbiAgICAgICAgJ2VjMjpEZXNjcmliZVZwY3MnLCAnZWMyOkRlc2NyaWJlU3VibmV0cycsICdlYzI6RGVzY3JpYmVTZWN1cml0eUdyb3VwcycsXG4gICAgICAgICdlYzI6Q3JlYXRlU2VjdXJpdHlHcm91cCcsICdlYzI6RGVsZXRlU2VjdXJpdHlHcm91cCcsXG4gICAgICAgICdlYzI6QXV0aG9yaXplU2VjdXJpdHlHcm91cEVncmVzcycsICdlYzI6UmV2b2tlU2VjdXJpdHlHcm91cEVncmVzcycsXG4gICAgICAgICdlYzI6Q3JlYXRlVGFncycsXG4gICAgICBdLFxuICAgICAgUmVzb3VyY2U6ICcqJyxcbiAgICB9LFxuICAgIHtcbiAgICAgIFNpZDogJ0tNU0tleU1hbmFnZW1lbnQnLFxuICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgQWN0aW9uOiBbXG4gICAgICAgICdrbXM6Q3JlYXRlS2V5JywgJ2ttczpDcmVhdGVBbGlhcycsICdrbXM6RGVsZXRlQWxpYXMnLCAna21zOkRlc2NyaWJlS2V5JyxcbiAgICAgICAgJ2ttczpFbmFibGVLZXlSb3RhdGlvbicsICdrbXM6R2V0S2V5UG9saWN5JywgJ2ttczpQdXRLZXlQb2xpY3knLFxuICAgICAgICAna21zOkVuY3J5cHQnLCAna21zOkRlY3J5cHQnLCAna21zOkdlbmVyYXRlRGF0YUtleScsICdrbXM6VGFnUmVzb3VyY2UnLFxuICAgICAgXSxcbiAgICAgIFJlc291cmNlOiAnKicsXG4gICAgfSxcbiAgICB7XG4gICAgICBTaWQ6ICdDbG91ZFdhdGNoTG9nc0FuZERhc2hib2FyZCcsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246IFtcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLCAnbG9nczpEZWxldGVMb2dHcm91cCcsICdsb2dzOlB1dFJldGVudGlvblBvbGljeScsXG4gICAgICAgICdsb2dzOkRlc2NyaWJlTG9nR3JvdXBzJywgJ2xvZ3M6VGFnUmVzb3VyY2UnLFxuICAgICAgXSxcbiAgICAgIFJlc291cmNlOiBbXG4gICAgICAgIGFybignbG9ncycsIGBsb2ctZ3JvdXA6JHtyZXNvdXJjZXMubG9nR3JvdXB9KmApLFxuICAgICAgICBhcm4oJ2xvZ3MnLCAnbG9nLWdyb3VwOi9hd3MvbGFtYmRhL2F0eC0qJyksXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnQ2xvdWRXYXRjaERhc2hib2FyZCcsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246IFsnY2xvdWR3YXRjaDpQdXREYXNoYm9hcmQnLCAnY2xvdWR3YXRjaDpEZWxldGVEYXNoYm9hcmRzJywgJ2Nsb3Vkd2F0Y2g6R2V0RGFzaGJvYXJkJ10sXG4gICAgICBSZXNvdXJjZTogYGFybjphd3M6Y2xvdWR3YXRjaDo6JHthY2NvdW50SWR9OmRhc2hib2FyZC8ke3Jlc291cmNlcy5kYXNoYm9hcmR9YCxcbiAgICB9LFxuICAgIHtcbiAgICAgIFNpZDogJ1NTTUZvckNES0Jvb3RzdHJhcCcsXG4gICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICBBY3Rpb246IFsnc3NtOkdldFBhcmFtZXRlcicsICdzc206UHV0UGFyYW1ldGVyJ10sXG4gICAgICBSZXNvdXJjZTogYXJuKCdzc20nLCAncGFyYW1ldGVyL2Nkay1ib290c3RyYXAvKicpLFxuICAgIH0sXG4gICAge1xuICAgICAgU2lkOiAnU1RTSWRlbnRpdHknLFxuICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgQWN0aW9uOiAnc3RzOkdldENhbGxlcklkZW50aXR5JyxcbiAgICAgIFJlc291cmNlOiAnKicsXG4gICAgfSxcbiAgXSxcbn07XG5cbi8vIC0tIFdyaXRlIGZpbGVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5jb25zdCBzY3JpcHREaXIgPSBfX2Rpcm5hbWU7XG5jb25zdCBydW50aW1lUGF0aCA9IHJlc29sdmUoc2NyaXB0RGlyLCAnYXR4LXJ1bnRpbWUtcG9saWN5Lmpzb24nKTtcbmNvbnN0IGRlcGxveVBhdGggID0gcmVzb2x2ZShzY3JpcHREaXIsICdhdHgtZGVwbG95bWVudC1wb2xpY3kuanNvbicpO1xuXG53cml0ZUZpbGVTeW5jKHJ1bnRpbWVQYXRoLCBKU09OLnN0cmluZ2lmeShydW50aW1lUG9saWN5LCBudWxsLCAyKSArICdcXG4nKTtcbmxvZy5zdWNjZXNzKGBSdW50aW1lIHBvbGljeSBnZW5lcmF0ZWQ6ICR7cnVudGltZVBhdGh9YCk7XG5cbndyaXRlRmlsZVN5bmMoZGVwbG95UGF0aCwgSlNPTi5zdHJpbmdpZnkoZGVwbG95bWVudFBvbGljeSwgbnVsbCwgMikgKyAnXFxuJyk7XG5sb2cuc3VjY2VzcyhgRGVwbG95bWVudCBwb2xpY3kgZ2VuZXJhdGVkOiAke2RlcGxveVBhdGh9YCk7XG5cbi8vIC0tIFN1bW1hcnkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5jb25zb2xlLmxvZyhgXG49PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblBvbGljeSBTdW1tYXJ5XG49PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuVHdvIHBvbGljaWVzIGdlbmVyYXRlZDpcblxuICAxLiBhdHgtcnVudGltZS1wb2xpY3kuanNvblxuICAgICBEYXktdG8tZGF5IG9wZXJhdGlvbnM6IGludm9rZSBMYW1iZGFzLCB1cGxvYWQgc291cmNlIHRvIFMzLFxuICAgICBkb3dubG9hZCByZXN1bHRzLCBtYW5hZ2UgcHJpdmF0ZSByZXBvIHNlY3JldHMsIHJlYWQgbG9ncy5cbiAgICAgUmVxdWlyZWQgZm9yIHJlbW90ZSBtb2RlIGV4ZWN1dGlvbi5cblxuICAyLiBhdHgtZGVwbG95bWVudC1wb2xpY3kuanNvblxuICAgICBPbmUtdGltZSBpbmZyYXN0cnVjdHVyZSBzZXR1cDogQ0RLIGRlcGxveSwgQ2xvdWRGb3JtYXRpb24sXG4gICAgIEVDUiwgSUFNIHJvbGVzLCBCYXRjaCwgS01TLCBWUEMsIENsb3VkV2F0Y2guXG4gICAgIE9ubHkgbmVlZGVkIHdoZW4gZGVwbG95aW5nIG9yIGRlc3Ryb3lpbmcgdGhlIHN0YWNrcy5cblxuVXNhZ2U6XG5cbiAgIyBDcmVhdGUgdGhlIHBvbGljaWVzXG4gIGF3cyBpYW0gY3JlYXRlLXBvbGljeSBcXFxcXG4gICAgLS1wb2xpY3ktbmFtZSBBVFhSdW50aW1lUG9saWN5IFxcXFxcbiAgICAtLXBvbGljeS1kb2N1bWVudCBmaWxlOi8vJHtydW50aW1lUGF0aH1cblxuICBhd3MgaWFtIGNyZWF0ZS1wb2xpY3kgXFxcXFxuICAgIC0tcG9saWN5LW5hbWUgQVRYRGVwbG95bWVudFBvbGljeSBcXFxcXG4gICAgLS1wb2xpY3ktZG9jdW1lbnQgZmlsZTovLyR7ZGVwbG95UGF0aH1cblxuICAjIEF0dGFjaCB0byB5b3VyIElBTSB1c2VyIG9yIHJvbGVcbiAgYXdzIGlhbSBhdHRhY2gtdXNlci1wb2xpY3kgXFxcXFxuICAgIC0tdXNlci1uYW1lIFlPVVJfVVNFUk5BTUUgXFxcXFxuICAgIC0tcG9saWN5LWFybiBhcm46YXdzOmlhbTo6JHthY2NvdW50SWR9OnBvbGljeS9BVFhSdW50aW1lUG9saWN5YCk7XG5cbmlmIChhY2NvdW50SWQgPT09ICdSRVBMQUNFX1dJVEhfQUNDT1VOVF9JRCcpIHtcbiAgY29uc29sZS5sb2coJycpO1xuICBsb2cud2FybmluZyhcIkFjY291bnQgSUQgY291bGQgbm90IGJlIGRldGVjdGVkLlwiKTtcbiAgY29uc29sZS5sb2coXCJSZXBsYWNlICdSRVBMQUNFX1dJVEhfQUNDT1VOVF9JRCcgaW4gYm90aCBwb2xpY3kgZmlsZXMgd2l0aCB5b3VyIGFjdHVhbCBBV1MgYWNjb3VudCBJRC5cIik7XG59XG5cbmNvbnNvbGUubG9nKGBcXG5UbyByZWdlbmVyYXRlIGFmdGVyIGNoYW5nZXM6IG5weCB0cy1ub2RlIGdlbmVyYXRlLWNhbGxlci1wb2xpY3kudHNcXG5gKTtcbiJdfQ==