"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InfrastructureStack = void 0;
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const kms = require("aws-cdk-lib/aws-kms");
const iam = require("aws-cdk-lib/aws-iam");
const ec2 = require("aws-cdk-lib/aws-ec2");
const batch = require("aws-cdk-lib/aws-batch");
const logs = require("aws-cdk-lib/aws-logs");
const lambda = require("aws-cdk-lib/aws-lambda");
const lambdaNode = require("aws-cdk-lib/aws-lambda-nodejs");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const cdk_nag_1 = require("cdk-nag");
const path = require("path");
class InfrastructureStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const accountId = cdk.Stack.of(this).account;
        // S3 Buckets - Use existing or create new
        // KMS key for S3 encryption
        this.encryptionKey = new kms.Key(this, 'AtxEncryptionKey', {
            alias: 'atx-encryption-key',
            description: 'KMS key for ATX S3 and CloudWatch Logs encryption',
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // CloudWatch Logs requires an explicit key policy to use KMS encryption
        this.encryptionKey.addToResourcePolicy(new iam.PolicyStatement({
            actions: [
                'kms:Encrypt',
                'kms:Decrypt',
                'kms:ReEncrypt*',
                'kms:GenerateDataKey*',
                'kms:DescribeKey',
            ],
            principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
            resources: ['*'],
            conditions: {
                ArnLike: {
                    'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${this.region}:${accountId}:log-group:*`,
                },
            },
        }));
        // S3 Buckets - Use existing or create new
        if (props.existingOutputBucket) {
            this.outputBucket = s3.Bucket.fromBucketName(this, 'OutputBucket', props.existingOutputBucket);
        }
        else {
            this.outputBucket = new s3.Bucket(this, 'OutputBucket', {
                bucketName: `atx-custom-output-${accountId}`,
                versioned: true,
                encryptionKey: this.encryptionKey,
                encryption: s3.BucketEncryption.KMS,
                blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
                removalPolicy: cdk.RemovalPolicy.RETAIN,
                enforceSSL: true,
                lifecycleRules: [{ id: 'expire-30d', expiration: cdk.Duration.days(30) }],
            });
        }
        if (props.existingSourceBucket) {
            this.sourceBucket = s3.Bucket.fromBucketName(this, 'SourceBucket', props.existingSourceBucket);
        }
        else {
            this.sourceBucket = new s3.Bucket(this, 'SourceBucket', {
                bucketName: `atx-source-code-${accountId}`,
                encryptionKey: this.encryptionKey,
                encryption: s3.BucketEncryption.KMS,
                blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
                lifecycleRules: [{ id: 'expire-7d', expiration: cdk.Duration.days(7) }],
                removalPolicy: cdk.RemovalPolicy.RETAIN,
                enforceSSL: true,
            });
        }
        // Suppress S3 access logging — these are short-lived transformation buckets
        // with lifecycle rules (7d/30d). Access is already auditable via CloudTrail.
        if (!props.existingOutputBucket) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(this.outputBucket, [
                { id: 'AwsSolutions-S1', reason: 'Access logging not required for short-lived transformation output bucket with 30d lifecycle. Auditable via CloudTrail.' },
            ], true);
        }
        if (!props.existingSourceBucket) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(this.sourceBucket, [
                { id: 'AwsSolutions-S1', reason: 'Access logging not required for short-lived source code bucket with 7d lifecycle. Auditable via CloudTrail.' },
            ], true);
        }
        // CloudWatch Log Group
        this.logGroup = new logs.LogGroup(this, 'LogGroup', {
            logGroupName: '/aws/batch/atx-transform',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            encryptionKey: this.encryptionKey,
        });
        // IAM Role for Batch Job
        const jobRole = new iam.Role(this, 'BatchJobRole', {
            roleName: 'ATXBatchJobRole',
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AWSTransformCustomFullAccess'),
            ],
        });
        // Grant S3 access to job role
        this.outputBucket.grantReadWrite(jobRole);
        this.sourceBucket.grantRead(jobRole);
        this.encryptionKey.grantEncryptDecrypt(jobRole);
        // Allow container to fetch private repo credentials from Secrets Manager
        jobRole.addToPolicy(new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [cdk.Arn.format({
                    service: 'secretsmanager', resource: 'secret', resourceName: 'atx/*',
                    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
                }, this)],
        }));
        // Suppress cdk-nag findings for job role
        cdk_nag_1.NagSuppressions.addResourceSuppressions(jobRole, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWSTransformCustomFullAccess is required for AWS Transform API access. This is an AWS-managed policy specifically designed for this service.',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AWSTransformCustomFullAccess'],
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'S3 wildcard permissions are required for dynamic file operations. KMS GenerateDataKey*/ReEncrypt* are standard CDK grant patterns scoped to a single key. Secrets Manager wildcard is scoped to atx/* prefix for credential management.',
                appliesTo: [
                    'Action::s3:Abort*',
                    'Action::s3:DeleteObject*',
                    'Action::s3:GetBucket*',
                    'Action::s3:GetObject*',
                    'Action::s3:List*',
                    'Action::kms:GenerateDataKey*',
                    'Action::kms:ReEncrypt*',
                    'Resource::<OutputBucket7114EB27.Arn>/*',
                    'Resource::<SourceBucketDDD2130A.Arn>/*',
                    `Resource::arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${accountId}:secret:atx/*`,
                ],
            },
        ], true);
        // IAM Role for Batch Execution
        const executionRole = new iam.Role(this, 'BatchExecutionRole', {
            roleName: 'ATXBatchExecutionRole',
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });
        // Suppress cdk-nag findings for execution role
        cdk_nag_1.NagSuppressions.addResourceSuppressions(executionRole, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AmazonECSTaskExecutionRolePolicy is the standard AWS-managed policy for ECS task execution. It provides necessary permissions for ECR, CloudWatch Logs, and Secrets Manager.',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
            },
        ], true);
        // Get VPC - Use existing or default
        let vpc;
        if (props.existingVpcId) {
            // Use fromVpcAttributes to avoid lookup
            const subnetIds = props.existingSubnetIds && props.existingSubnetIds.length > 0
                ? props.existingSubnetIds
                : [];
            vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
                vpcId: props.existingVpcId,
                availabilityZones: [`${this.region}a`, `${this.region}b`],
                publicSubnetIds: subnetIds.length > 0 ? subnetIds : undefined,
            });
        }
        else {
            // Lookup default VPC
            vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
        }
        // Security Group - Use existing or create new
        let securityGroup;
        if (props.existingSecurityGroupId) {
            securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'SecurityGroup', props.existingSecurityGroupId);
        }
        else {
            securityGroup = new ec2.SecurityGroup(this, 'BatchSecurityGroup', {
                vpc,
                description: 'Security group for AWS Transform Batch jobs',
                allowAllOutbound: true,
            });
        }
        // Get subnets - Use existing or VPC public subnets
        const subnetIds = props.existingSubnetIds && props.existingSubnetIds.length > 0
            ? props.existingSubnetIds
            : vpc.publicSubnets.map(subnet => subnet.subnetId);
        // Batch Compute Environment
        const computeEnvironment = new batch.CfnComputeEnvironment(this, 'ComputeEnvironment', {
            computeEnvironmentName: 'atx-fargate-compute',
            type: 'MANAGED',
            state: 'ENABLED',
            computeResources: {
                type: 'FARGATE',
                maxvCpus: props.maxVcpus,
                subnets: subnetIds,
                securityGroupIds: [securityGroup.securityGroupId],
            },
        });
        // Batch Job Queue
        this.jobQueue = new batch.CfnJobQueue(this, 'JobQueue', {
            jobQueueName: 'atx-job-queue',
            state: 'ENABLED',
            priority: 1,
            computeEnvironmentOrder: [
                {
                    order: 1,
                    computeEnvironment: computeEnvironment.attrComputeEnvironmentArn,
                },
            ],
        });
        this.jobQueue.addDependency(computeEnvironment);
        // Batch Job Definition
        this.jobDefinition = new batch.CfnJobDefinition(this, 'JobDefinition', {
            jobDefinitionName: 'atx-transform-job',
            type: 'container',
            platformCapabilities: ['FARGATE'],
            timeout: {
                attemptDurationSeconds: props.jobTimeout,
            },
            retryStrategy: {
                attempts: 3,
            },
            containerProperties: {
                image: props.imageUri,
                jobRoleArn: jobRole.roleArn,
                executionRoleArn: executionRole.roleArn,
                resourceRequirements: [
                    { type: 'VCPU', value: props.fargateVcpu.toString() },
                    { type: 'MEMORY', value: props.fargateMemory.toString() },
                ],
                logConfiguration: {
                    logDriver: 'awslogs',
                    options: {
                        'awslogs-group': this.logGroup.logGroupName,
                        'awslogs-region': this.region,
                        'awslogs-stream-prefix': 'atx',
                    },
                },
                networkConfiguration: {
                    assignPublicIp: props.existingSubnetIds && props.existingSubnetIds.length > 0 ? 'DISABLED' : 'ENABLED',
                },
                environment: [
                    { name: 'S3_BUCKET', value: this.outputBucket.bucketName },
                    { name: 'SOURCE_BUCKET', value: this.sourceBucket.bucketName },
                    { name: 'AWS_DEFAULT_REGION', value: this.region },
                ],
            },
        });
        // ============================================================
        // Lambda Functions (invoked directly via aws lambda invoke)
        // ============================================================
        const lambdaDir = path.join(__dirname, '..', 'lambda');
        const baseLambdaProps = {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        };
        // --- Submit role (trigger-job, trigger-batch-jobs) ---
        const submitRole = new iam.Role(this, 'LambdaSubmitRole', {
            roleName: 'ATXLambdaSubmitRole',
            ...baseLambdaProps,
        });
        submitRole.addToPolicy(new iam.PolicyStatement({
            actions: ['batch:SubmitJob'],
            resources: [
                `arn:aws:batch:${this.region}:${this.account}:job-definition/${this.jobDefinition.jobDefinitionName}*`,
                `arn:aws:batch:${this.region}:${this.account}:job-queue/${this.jobQueue.jobQueueName}`,
            ],
        }));
        submitRole.addToPolicy(new iam.PolicyStatement({
            actions: ['batch:TagResource'],
            resources: ['*'],
        }));
        this.outputBucket.grantReadWrite(submitRole);
        this.encryptionKey.grantEncryptDecrypt(submitRole);
        // --- Read-only status role (get-job-status, get-batch-status, list-jobs, list-batches) ---
        const statusRole = new iam.Role(this, 'LambdaStatusRole', {
            roleName: 'ATXLambdaStatusRole',
            ...baseLambdaProps,
        });
        statusRole.addToPolicy(new iam.PolicyStatement({
            actions: ['batch:DescribeJobs', 'batch:ListJobs'],
            resources: ['*'],
        }));
        this.outputBucket.grantRead(statusRole);
        this.encryptionKey.grantDecrypt(statusRole);
        // --- Terminate role (terminate-job, terminate-batch-jobs) ---
        const terminateRole = new iam.Role(this, 'LambdaTerminateRole', {
            roleName: 'ATXLambdaTerminateRole',
            ...baseLambdaProps,
        });
        terminateRole.addToPolicy(new iam.PolicyStatement({
            actions: ['batch:DescribeJobs', 'batch:TerminateJob'],
            resources: ['*'],
        }));
        this.outputBucket.grantRead(terminateRole);
        this.encryptionKey.grantDecrypt(terminateRole);
        // --- Configure role (configure-mcp) ---
        const configureRole = new iam.Role(this, 'LambdaConfigureRole', {
            roleName: 'ATXLambdaConfigureRole',
            ...baseLambdaProps,
        });
        this.sourceBucket.grantWrite(configureRole);
        this.encryptionKey.grantEncrypt(configureRole);
        // Suppress cdk-nag findings for all Lambda roles
        for (const role of [submitRole, statusRole, terminateRole, configureRole]) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(role, [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'AWSLambdaBasicExecutionRole is the standard AWS-managed policy for Lambda CloudWatch Logs access.',
                    appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
                },
            ], true);
        }
        for (const role of [submitRole, statusRole, terminateRole]) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(role, [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Batch DescribeJobs/ListJobs require wildcard resources. S3 and KMS wildcards are standard CDK grant patterns scoped to specific buckets/keys.',
                    appliesTo: [
                        'Resource::*',
                        'Action::s3:Abort*',
                        'Action::s3:DeleteObject*',
                        'Action::s3:GetBucket*',
                        'Action::s3:GetObject*',
                        'Action::s3:List*',
                        'Action::kms:GenerateDataKey*',
                        'Action::kms:ReEncrypt*',
                        'Resource::<OutputBucket7114EB27.Arn>/*',
                        `Resource::arn:aws:batch:${this.region}:${this.account}:job-definition/${this.jobDefinition.jobDefinitionName}*`,
                    ],
                },
            ], true);
        }
        cdk_nag_1.NagSuppressions.addResourceSuppressions(configureRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'S3 and KMS wildcards are standard CDK grant patterns scoped to specific buckets/keys.',
                appliesTo: [
                    'Action::s3:Abort*',
                    'Action::s3:DeleteObject*',
                    'Action::s3:GetBucket*',
                    'Action::s3:GetObject*',
                    'Action::s3:List*',
                    'Action::kms:GenerateDataKey*',
                    'Action::kms:ReEncrypt*',
                    'Resource::<SourceBucketDDD2130A.Arn>/*',
                ],
            },
        ], true);
        const lambdaEnv = {
            JOB_QUEUE: 'atx-job-queue',
            JOB_DEFINITION: 'atx-transform-job',
            OUTPUT_BUCKET: this.outputBucket.bucketName,
            SOURCE_BUCKET: this.sourceBucket.bucketName,
        };
        const defaultFnProps = {
            runtime: lambda.Runtime.NODEJS_24_X,
            environment: lambdaEnv,
            timeout: cdk.Duration.seconds(30),
            bundling: { minify: true, sourceMap: true },
        };
        const makeFn = (id, name, entry, role, overrides) => new lambdaNode.NodejsFunction(this, id, {
            ...defaultFnProps,
            role,
            functionName: name,
            entry: path.join(lambdaDir, entry, 'index.ts'),
            ...overrides,
        });
        makeFn('TriggerJobFunction', 'atx-trigger-job', 'trigger-job', submitRole);
        makeFn('GetJobStatusFunction', 'atx-get-job-status', 'get-job-status', statusRole);
        makeFn('TerminateJobFunction', 'atx-terminate-job', 'terminate-job', terminateRole);
        makeFn('ListJobsFunction', 'atx-list-jobs', 'list-jobs', statusRole);
        makeFn('TriggerBatchJobsFunction', 'atx-trigger-batch-jobs', 'trigger-batch-jobs', submitRole, {
            timeout: cdk.Duration.minutes(15),
        });
        makeFn('GetBatchStatusFunction', 'atx-get-batch-status', 'get-batch-status', statusRole);
        makeFn('TerminateBatchJobsFunction', 'atx-terminate-batch-jobs', 'terminate-batch-jobs', terminateRole);
        makeFn('ListBatchesFunction', 'atx-list-batches', 'list-batches', statusRole);
        makeFn('ConfigureMcpFunction', 'atx-configure-mcp', 'configure-mcp', configureRole);
        // CloudWatch Dashboard
        const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
            dashboardName: 'ATX-Transform-CLI-Dashboard',
        });
        // Row 1: Job results summary — success/failure counts by TD
        dashboard.addWidgets(new cloudwatch.LogQueryWidget({
            title: '📊 Transformation Results by TD',
            logGroupNames: [this.logGroup.logGroupName],
            queryLines: [
                'filter @message like /JOB_SUMMARY/',
                'parse @message /jobStatus=(?<jobStat>\\S+)/',
                'parse @message /tdName=(?<tdNm>\\S+)/',
                'fields jobStat = "SUCCEEDED" as isSuccess, jobStat = "FAILED" as isFail',
                'stats count(*) as Total, sum(isSuccess) as Succeeded, sum(isFail) as Failed by tdNm',
                'sort Total desc',
            ],
            width: 24,
            height: 6,
        }));
        // Row 2: Recent job history with status and TD
        dashboard.addWidgets(new cloudwatch.LogQueryWidget({
            title: '📋 Recent Job History',
            logGroupNames: [this.logGroup.logGroupName],
            queryLines: [
                'filter @message like /JOB_SUMMARY/',
                'parse @message /jobStatus=(?<jobStat>\\S+)/',
                'parse @message /exitCode=(?<exitCd>\\S+)/',
                'parse @message /tdName=(?<tdNm>\\S+)/',
                'parse @message /sourceRepo=(?<srcRepo>\\S+)/',
                'display @timestamp, jobStat, tdNm, srcRepo, exitCd',
                'sort @timestamp desc',
                'limit 500',
            ],
            width: 24,
            height: 8,
        }));
        // Row 3: Success/failure trend over time
        dashboard.addWidgets(new cloudwatch.LogQueryWidget({
            title: '📈 Job Success/Failure Trend (Hourly)',
            logGroupNames: [this.logGroup.logGroupName],
            queryLines: [
                'filter @message like /JOB_SUMMARY/',
                'parse @message /jobStatus=(?<jobStat>\\S+)/',
                'fields jobStat = "SUCCEEDED" as isSuccess, jobStat = "FAILED" as isFail',
                'stats sum(isSuccess) as Succeeded, sum(isFail) as Failed by bin(1h)',
            ],
            width: 12,
            height: 6,
        }), new cloudwatch.LogQueryWidget({
            title: '❌ Recent Errors',
            logGroupNames: [this.logGroup.logGroupName],
            queryLines: [
                'filter @message like /JOB_SUMMARY/ and @message like /jobStatus=FAILED/',
                'parse @message /exitCode=(?<exitCd>\\S+)/',
                'parse @message /tdName=(?<tdNm>\\S+)/',
                'parse @message /sourceRepo=(?<srcRepo>\\S+)/',
                'display @timestamp, tdNm, srcRepo, exitCd',
                'sort @timestamp desc',
                'limit 500',
            ],
            width: 12,
            height: 6,
        }));
        // Outputs
        new cdk.CfnOutput(this, 'OutputBucketName', {
            value: this.outputBucket.bucketName,
            description: 'S3 bucket for transformation outputs',
            exportName: 'AtxOutputBucketName',
        });
        new cdk.CfnOutput(this, 'SourceBucketName', {
            value: this.sourceBucket.bucketName,
            description: 'S3 bucket for source code uploads',
            exportName: 'AtxSourceBucketName',
        });
        new cdk.CfnOutput(this, 'JobQueueArn', {
            value: this.jobQueue.attrJobQueueArn,
            description: 'Batch job queue ARN',
            exportName: 'AtxJobQueueArn',
        });
        new cdk.CfnOutput(this, 'JobDefinitionArn', {
            value: this.jobDefinition.ref,
            description: 'Batch job definition ARN',
            exportName: 'AtxJobDefinitionArn',
        });
        new cdk.CfnOutput(this, 'LogGroupName', {
            value: this.logGroup.logGroupName,
            description: 'CloudWatch log group name',
        });
        new cdk.CfnOutput(this, 'KmsKeyArn', {
            value: this.encryptionKey.keyArn,
            description: 'KMS key ARN for S3 encryption',
            exportName: 'AtxKmsKeyArn',
        });
    }
}
exports.InfrastructureStack = InfrastructureStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmFzdHJ1Y3R1cmUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYXN0cnVjdHVyZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMseUNBQXlDO0FBQ3pDLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLCtDQUErQztBQUMvQyw2Q0FBNkM7QUFDN0MsaURBQWlEO0FBQ2pELDREQUE0RDtBQUM1RCx5REFBeUQ7QUFDekQscUNBQTBDO0FBRTFDLDZCQUE2QjtBQWU3QixNQUFhLG1CQUFvQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBUWhELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBK0I7UUFDdkUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDO1FBRTdDLDBDQUEwQztRQUUxQyw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ3pELEtBQUssRUFBRSxvQkFBb0I7WUFDM0IsV0FBVyxFQUFFLG1EQUFtRDtZQUNoRSxpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07U0FDeEMsQ0FBQyxDQUFDO1FBRUgsd0VBQXdFO1FBQ3hFLElBQUksQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzdELE9BQU8sRUFBRTtnQkFDUCxhQUFhO2dCQUNiLGFBQWE7Z0JBQ2IsZ0JBQWdCO2dCQUNoQixzQkFBc0I7Z0JBQ3RCLGlCQUFpQjthQUNsQjtZQUNELFVBQVUsRUFBRSxDQUFDLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLFFBQVEsSUFBSSxDQUFDLE1BQU0sZ0JBQWdCLENBQUMsQ0FBQztZQUMzRSxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7WUFDaEIsVUFBVSxFQUFFO2dCQUNWLE9BQU8sRUFBRTtvQkFDUCxvQ0FBb0MsRUFBRSxnQkFBZ0IsSUFBSSxDQUFDLE1BQU0sSUFBSSxTQUFTLGNBQWM7aUJBQzdGO2FBQ0Y7U0FDRixDQUFDLENBQUMsQ0FBQztRQUVKLDBDQUEwQztRQUMxQyxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQy9CLElBQUksQ0FBQyxZQUFZLEdBQUcsRUFBRSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQztRQUNqRyxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7Z0JBQ3RELFVBQVUsRUFBRSxxQkFBcUIsU0FBUyxFQUFFO2dCQUM1QyxTQUFTLEVBQUUsSUFBSTtnQkFDZixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7Z0JBQ2pDLFVBQVUsRUFBRSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsR0FBRztnQkFDbkMsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7Z0JBQ2pELGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07Z0JBQ3ZDLFVBQVUsRUFBRSxJQUFJO2dCQUNoQixjQUFjLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7YUFDMUUsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELElBQUksS0FBSyxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDL0IsSUFBSSxDQUFDLFlBQVksR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1FBQ2pHLENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtnQkFDdEQsVUFBVSxFQUFFLG1CQUFtQixTQUFTLEVBQUU7Z0JBQzFDLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtnQkFDakMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHO2dCQUNuQyxpQkFBaUIsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsU0FBUztnQkFDakQsY0FBYyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUN2RSxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO2dCQUN2QyxVQUFVLEVBQUUsSUFBSTthQUNqQixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsNEVBQTRFO1FBQzVFLDZFQUE2RTtRQUM3RSxJQUFJLENBQUMsS0FBSyxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDaEMseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFO2dCQUN6RCxFQUFFLEVBQUUsRUFBRSxpQkFBaUIsRUFBRSxNQUFNLEVBQUUsd0hBQXdILEVBQUU7YUFDNUosRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNYLENBQUM7UUFDRCxJQUFJLENBQUMsS0FBSyxDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDaEMseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFO2dCQUN6RCxFQUFFLEVBQUUsRUFBRSxpQkFBaUIsRUFBRSxNQUFNLEVBQUUsNkdBQTZHLEVBQUU7YUFDakosRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNYLENBQUM7UUFFRCx1QkFBdUI7UUFDdkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUNsRCxZQUFZLEVBQUUsMEJBQTBCO1lBQ3hDLFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7WUFDdkMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7U0FDbEMsQ0FBQyxDQUFDO1FBRUgseUJBQXlCO1FBQ3pCLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ2pELFFBQVEsRUFBRSxpQkFBaUI7WUFDM0IsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHlCQUF5QixDQUFDO1lBQzlELGVBQWUsRUFBRTtnQkFDZixHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLDhCQUE4QixDQUFDO2FBQzNFO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsOEJBQThCO1FBQzlCLElBQUksQ0FBQyxZQUFZLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzFDLElBQUksQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3JDLElBQUksQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQUMsT0FBTyxDQUFDLENBQUM7UUFFaEQseUVBQXlFO1FBQ3pFLE9BQU8sQ0FBQyxXQUFXLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzFDLE9BQU8sRUFBRSxDQUFDLCtCQUErQixDQUFDO1lBQzFDLFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO29CQUN6QixPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxZQUFZLEVBQUUsT0FBTztvQkFDcEUsU0FBUyxFQUFFLEdBQUcsQ0FBQyxTQUFTLENBQUMsbUJBQW1CO2lCQUM3QyxFQUFFLElBQUksQ0FBQyxDQUFDO1NBQ1YsQ0FBQyxDQUFDLENBQUM7UUFFSix5Q0FBeUM7UUFDekMseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxPQUFPLEVBQUU7WUFDL0M7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLDhJQUE4STtnQkFDdEosU0FBUyxFQUFFLENBQUMsMkVBQTJFLENBQUM7YUFDekY7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUseU9BQXlPO2dCQUNqUCxTQUFTLEVBQUU7b0JBQ1QsbUJBQW1CO29CQUNuQiwwQkFBMEI7b0JBQzFCLHVCQUF1QjtvQkFDdkIsdUJBQXVCO29CQUN2QixrQkFBa0I7b0JBQ2xCLDhCQUE4QjtvQkFDOUIsd0JBQXdCO29CQUN4Qix3Q0FBd0M7b0JBQ3hDLHdDQUF3QztvQkFDeEMsb0NBQW9DLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sSUFBSSxTQUFTLGVBQWU7aUJBQzFGO2FBQ0Y7U0FDRixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQsK0JBQStCO1FBQy9CLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDN0QsUUFBUSxFQUFFLHVCQUF1QjtZQUNqQyxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMseUJBQXlCLENBQUM7WUFDOUQsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsK0NBQStDLENBQUM7YUFDNUY7U0FDRixDQUFDLENBQUM7UUFFSCwrQ0FBK0M7UUFDL0MseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxhQUFhLEVBQUU7WUFDckQ7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLDhLQUE4SztnQkFDdEwsU0FBUyxFQUFFLENBQUMsNEZBQTRGLENBQUM7YUFDMUc7U0FDRixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQsb0NBQW9DO1FBQ3BDLElBQUksR0FBYSxDQUFDO1FBQ2xCLElBQUksS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ3hCLHdDQUF3QztZQUN4QyxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsaUJBQWlCLElBQUksS0FBSyxDQUFDLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUM3RSxDQUFDLENBQUMsS0FBSyxDQUFDLGlCQUFpQjtnQkFDekIsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUVQLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7Z0JBQzNDLEtBQUssRUFBRSxLQUFLLENBQUMsYUFBYTtnQkFDMUIsaUJBQWlCLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQztnQkFDekQsZUFBZSxFQUFFLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVM7YUFDOUQsQ0FBQyxDQUFDO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDTixxQkFBcUI7WUFDckIsR0FBRyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNwRSxDQUFDO1FBRUQsOENBQThDO1FBQzlDLElBQUksYUFBaUMsQ0FBQztRQUN0QyxJQUFJLEtBQUssQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1lBQ2xDLGFBQWEsR0FBRyxHQUFHLENBQUMsYUFBYSxDQUFDLG1CQUFtQixDQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsS0FBSyxDQUFDLHVCQUF1QixDQUFDLENBQUM7UUFDOUcsQ0FBQzthQUFNLENBQUM7WUFDTixhQUFhLEdBQUcsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtnQkFDaEUsR0FBRztnQkFDSCxXQUFXLEVBQUUsNkNBQTZDO2dCQUMxRCxnQkFBZ0IsRUFBRSxJQUFJO2FBQ3ZCLENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCxtREFBbUQ7UUFDbkQsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUM3RSxDQUFDLENBQUMsS0FBSyxDQUFDLGlCQUFpQjtZQUN6QixDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7UUFFckQsNEJBQTRCO1FBQzVCLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxLQUFLLENBQUMscUJBQXFCLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQ3JGLHNCQUFzQixFQUFFLHFCQUFxQjtZQUM3QyxJQUFJLEVBQUUsU0FBUztZQUNmLEtBQUssRUFBRSxTQUFTO1lBQ2hCLGdCQUFnQixFQUFFO2dCQUNoQixJQUFJLEVBQUUsU0FBUztnQkFDZixRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7Z0JBQ3hCLE9BQU8sRUFBRSxTQUFTO2dCQUNsQixnQkFBZ0IsRUFBRSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUM7YUFDbEQ7U0FDRixDQUFDLENBQUM7UUFFSCxrQkFBa0I7UUFDbEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUN0RCxZQUFZLEVBQUUsZUFBZTtZQUM3QixLQUFLLEVBQUUsU0FBUztZQUNoQixRQUFRLEVBQUUsQ0FBQztZQUNYLHVCQUF1QixFQUFFO2dCQUN2QjtvQkFDRSxLQUFLLEVBQUUsQ0FBQztvQkFDUixrQkFBa0IsRUFBRSxrQkFBa0IsQ0FBQyx5QkFBeUI7aUJBQ2pFO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBRWhELHVCQUF1QjtRQUN2QixJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksS0FBSyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDckUsaUJBQWlCLEVBQUUsbUJBQW1CO1lBQ3RDLElBQUksRUFBRSxXQUFXO1lBQ2pCLG9CQUFvQixFQUFFLENBQUMsU0FBUyxDQUFDO1lBQ2pDLE9BQU8sRUFBRTtnQkFDUCxzQkFBc0IsRUFBRSxLQUFLLENBQUMsVUFBVTthQUN6QztZQUNELGFBQWEsRUFBRTtnQkFDYixRQUFRLEVBQUUsQ0FBQzthQUNaO1lBQ0QsbUJBQW1CLEVBQUU7Z0JBQ25CLEtBQUssRUFBRSxLQUFLLENBQUMsUUFBUTtnQkFDckIsVUFBVSxFQUFFLE9BQU8sQ0FBQyxPQUFPO2dCQUMzQixnQkFBZ0IsRUFBRSxhQUFhLENBQUMsT0FBTztnQkFDdkMsb0JBQW9CLEVBQUU7b0JBQ3BCLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsRUFBRTtvQkFDckQsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsYUFBYSxDQUFDLFFBQVEsRUFBRSxFQUFFO2lCQUMxRDtnQkFDRCxnQkFBZ0IsRUFBRTtvQkFDaEIsU0FBUyxFQUFFLFNBQVM7b0JBQ3BCLE9BQU8sRUFBRTt3QkFDUCxlQUFlLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZO3dCQUMzQyxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsTUFBTTt3QkFDN0IsdUJBQXVCLEVBQUUsS0FBSztxQkFDL0I7aUJBQ0Y7Z0JBQ0Qsb0JBQW9CLEVBQUU7b0JBQ3BCLGNBQWMsRUFBRSxLQUFLLENBQUMsaUJBQWlCLElBQUksS0FBSyxDQUFDLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsU0FBUztpQkFDdkc7Z0JBQ0QsV0FBVyxFQUFFO29CQUNYLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUU7b0JBQzFELEVBQUUsSUFBSSxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUU7b0JBQzlELEVBQUUsSUFBSSxFQUFFLG9CQUFvQixFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFO2lCQUNuRDthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsK0RBQStEO1FBQy9ELDREQUE0RDtRQUM1RCwrREFBK0Q7UUFDL0QsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBRXZELE1BQU0sZUFBZSxHQUFHO1lBQ3RCLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQywwQ0FBMEMsQ0FBQzthQUN2RjtTQUNGLENBQUM7UUFFRix3REFBd0Q7UUFDeEQsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUN4RCxRQUFRLEVBQUUscUJBQXFCO1lBQy9CLEdBQUcsZUFBZTtTQUNuQixDQUFDLENBQUM7UUFDSCxVQUFVLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUM3QyxPQUFPLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztZQUM1QixTQUFTLEVBQUU7Z0JBQ1QsaUJBQWlCLElBQUksQ0FBQyxNQUFNLElBQUksSUFBSSxDQUFDLE9BQU8sbUJBQW1CLElBQUksQ0FBQyxhQUFhLENBQUMsaUJBQWlCLEdBQUc7Z0JBQ3RHLGlCQUFpQixJQUFJLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLGNBQWMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZLEVBQUU7YUFDdkY7U0FDRixDQUFDLENBQUMsQ0FBQztRQUNKLFVBQVUsQ0FBQyxXQUFXLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzdDLE9BQU8sRUFBRSxDQUFDLG1CQUFtQixDQUFDO1lBQzlCLFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztTQUNqQixDQUFDLENBQUMsQ0FBQztRQUNKLElBQUksQ0FBQyxZQUFZLENBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzdDLElBQUksQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFbkQsNEZBQTRGO1FBQzVGLE1BQU0sVUFBVSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDeEQsUUFBUSxFQUFFLHFCQUFxQjtZQUMvQixHQUFHLGVBQWU7U0FDbkIsQ0FBQyxDQUFDO1FBQ0gsVUFBVSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDN0MsT0FBTyxFQUFFLENBQUMsb0JBQW9CLEVBQUUsZ0JBQWdCLENBQUM7WUFDakQsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FBQyxDQUFDO1FBQ0osSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDeEMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFNUMsK0RBQStEO1FBQy9ELE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDOUQsUUFBUSxFQUFFLHdCQUF3QjtZQUNsQyxHQUFHLGVBQWU7U0FDbkIsQ0FBQyxDQUFDO1FBQ0gsYUFBYSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDaEQsT0FBTyxFQUFFLENBQUMsb0JBQW9CLEVBQUUsb0JBQW9CLENBQUM7WUFDckQsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FBQyxDQUFDO1FBQ0osSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDM0MsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFL0MseUNBQXlDO1FBQ3pDLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDOUQsUUFBUSxFQUFFLHdCQUF3QjtZQUNsQyxHQUFHLGVBQWU7U0FDbkIsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDNUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFL0MsaURBQWlEO1FBQ2pELEtBQUssTUFBTSxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsVUFBVSxFQUFFLGFBQWEsRUFBRSxhQUFhLENBQUMsRUFBRSxDQUFDO1lBQzFFLHlCQUFlLENBQUMsdUJBQXVCLENBQUMsSUFBSSxFQUFFO2dCQUM1QztvQkFDRSxFQUFFLEVBQUUsbUJBQW1CO29CQUN2QixNQUFNLEVBQUUsbUdBQW1HO29CQUMzRyxTQUFTLEVBQUUsQ0FBQyx1RkFBdUYsQ0FBQztpQkFDckc7YUFDRixFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ1gsQ0FBQztRQUNELEtBQUssTUFBTSxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsVUFBVSxFQUFFLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDM0QseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLEVBQUU7Z0JBQzVDO29CQUNFLEVBQUUsRUFBRSxtQkFBbUI7b0JBQ3ZCLE1BQU0sRUFBRSwrSUFBK0k7b0JBQ3ZKLFNBQVMsRUFBRTt3QkFDVCxhQUFhO3dCQUNiLG1CQUFtQjt3QkFDbkIsMEJBQTBCO3dCQUMxQix1QkFBdUI7d0JBQ3ZCLHVCQUF1Qjt3QkFDdkIsa0JBQWtCO3dCQUNsQiw4QkFBOEI7d0JBQzlCLHdCQUF3Qjt3QkFDeEIsd0NBQXdDO3dCQUN4QywyQkFBMkIsSUFBSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsT0FBTyxtQkFBbUIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsR0FBRztxQkFDakg7aUJBQ0Y7YUFDRixFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ1gsQ0FBQztRQUNELHlCQUFlLENBQUMsdUJBQXVCLENBQUMsYUFBYSxFQUFFO1lBQ3JEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSx1RkFBdUY7Z0JBQy9GLFNBQVMsRUFBRTtvQkFDVCxtQkFBbUI7b0JBQ25CLDBCQUEwQjtvQkFDMUIsdUJBQXVCO29CQUN2Qix1QkFBdUI7b0JBQ3ZCLGtCQUFrQjtvQkFDbEIsOEJBQThCO29CQUM5Qix3QkFBd0I7b0JBQ3hCLHdDQUF3QztpQkFDekM7YUFDRjtTQUNGLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFVCxNQUFNLFNBQVMsR0FBRztZQUNoQixTQUFTLEVBQUUsZUFBZTtZQUMxQixjQUFjLEVBQUUsbUJBQW1CO1lBQ25DLGFBQWEsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVU7WUFDM0MsYUFBYSxFQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsVUFBVTtTQUM1QyxDQUFDO1FBRUYsTUFBTSxjQUFjLEdBQTRDO1lBQzlELE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsV0FBVyxFQUFFLFNBQVM7WUFDdEIsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNqQyxRQUFRLEVBQUUsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUU7U0FDNUMsQ0FBQztRQUVGLE1BQU0sTUFBTSxHQUFHLENBQUMsRUFBVSxFQUFFLElBQVksRUFBRSxLQUFhLEVBQUUsSUFBZSxFQUFFLFNBQW1ELEVBQUUsRUFBRSxDQUMvSCxJQUFJLFVBQVUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEVBQUUsRUFBRTtZQUN0QyxHQUFHLGNBQWM7WUFDakIsSUFBSTtZQUNKLFlBQVksRUFBRSxJQUFJO1lBQ2xCLEtBQUssRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsVUFBVSxDQUFDO1lBQzlDLEdBQUcsU0FBUztTQUNiLENBQUMsQ0FBQztRQUVMLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxpQkFBaUIsRUFBRSxhQUFhLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDM0UsTUFBTSxDQUFDLHNCQUFzQixFQUFFLG9CQUFvQixFQUFFLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQ25GLE1BQU0sQ0FBQyxzQkFBc0IsRUFBRSxtQkFBbUIsRUFBRSxlQUFlLEVBQUUsYUFBYSxDQUFDLENBQUM7UUFDcEYsTUFBTSxDQUFDLGtCQUFrQixFQUFFLGVBQWUsRUFBRSxXQUFXLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDckUsTUFBTSxDQUFDLDBCQUEwQixFQUFFLHdCQUF3QixFQUFFLG9CQUFvQixFQUFFLFVBQVUsRUFBRTtZQUM3RixPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1NBQ2xDLENBQUMsQ0FBQztRQUNILE1BQU0sQ0FBQyx3QkFBd0IsRUFBRSxzQkFBc0IsRUFBRSxrQkFBa0IsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUN6RixNQUFNLENBQUMsNEJBQTRCLEVBQUUsMEJBQTBCLEVBQUUsc0JBQXNCLEVBQUUsYUFBYSxDQUFDLENBQUM7UUFDeEcsTUFBTSxDQUFDLHFCQUFxQixFQUFFLGtCQUFrQixFQUFFLGNBQWMsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUM5RSxNQUFNLENBQUMsc0JBQXNCLEVBQUUsbUJBQW1CLEVBQUUsZUFBZSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1FBRXBGLHVCQUF1QjtRQUN2QixNQUFNLFNBQVMsR0FBRyxJQUFJLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRTtZQUM1RCxhQUFhLEVBQUUsNkJBQTZCO1NBQzdDLENBQUMsQ0FBQztRQUVILDREQUE0RDtRQUM1RCxTQUFTLENBQUMsVUFBVSxDQUNsQixJQUFJLFVBQVUsQ0FBQyxjQUFjLENBQUM7WUFDNUIsS0FBSyxFQUFFLGlDQUFpQztZQUN4QyxhQUFhLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQztZQUMzQyxVQUFVLEVBQUU7Z0JBQ1Ysb0NBQW9DO2dCQUNwQyw2Q0FBNkM7Z0JBQzdDLHVDQUF1QztnQkFDdkMseUVBQXlFO2dCQUN6RSxxRkFBcUY7Z0JBQ3JGLGlCQUFpQjthQUNsQjtZQUNELEtBQUssRUFBRSxFQUFFO1lBQ1QsTUFBTSxFQUFFLENBQUM7U0FDVixDQUFDLENBQ0gsQ0FBQztRQUVGLCtDQUErQztRQUMvQyxTQUFTLENBQUMsVUFBVSxDQUNsQixJQUFJLFVBQVUsQ0FBQyxjQUFjLENBQUM7WUFDNUIsS0FBSyxFQUFFLHVCQUF1QjtZQUM5QixhQUFhLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQztZQUMzQyxVQUFVLEVBQUU7Z0JBQ1Ysb0NBQW9DO2dCQUNwQyw2Q0FBNkM7Z0JBQzdDLDJDQUEyQztnQkFDM0MsdUNBQXVDO2dCQUN2Qyw4Q0FBOEM7Z0JBQzlDLG9EQUFvRDtnQkFDcEQsc0JBQXNCO2dCQUN0QixXQUFXO2FBQ1o7WUFDRCxLQUFLLEVBQUUsRUFBRTtZQUNULE1BQU0sRUFBRSxDQUFDO1NBQ1YsQ0FBQyxDQUNILENBQUM7UUFFRix5Q0FBeUM7UUFDekMsU0FBUyxDQUFDLFVBQVUsQ0FDbEIsSUFBSSxVQUFVLENBQUMsY0FBYyxDQUFDO1lBQzVCLEtBQUssRUFBRSx1Q0FBdUM7WUFDOUMsYUFBYSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUM7WUFDM0MsVUFBVSxFQUFFO2dCQUNWLG9DQUFvQztnQkFDcEMsNkNBQTZDO2dCQUM3Qyx5RUFBeUU7Z0JBQ3pFLHFFQUFxRTthQUN0RTtZQUNELEtBQUssRUFBRSxFQUFFO1lBQ1QsTUFBTSxFQUFFLENBQUM7U0FDVixDQUFDLEVBQ0YsSUFBSSxVQUFVLENBQUMsY0FBYyxDQUFDO1lBQzVCLEtBQUssRUFBRSxpQkFBaUI7WUFDeEIsYUFBYSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUM7WUFDM0MsVUFBVSxFQUFFO2dCQUNWLHlFQUF5RTtnQkFDekUsMkNBQTJDO2dCQUMzQyx1Q0FBdUM7Z0JBQ3ZDLDhDQUE4QztnQkFDOUMsMkNBQTJDO2dCQUMzQyxzQkFBc0I7Z0JBQ3RCLFdBQVc7YUFDWjtZQUNELEtBQUssRUFBRSxFQUFFO1lBQ1QsTUFBTSxFQUFFLENBQUM7U0FDVixDQUFDLENBQ0gsQ0FBQztRQUVGLFVBQVU7UUFDVixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVU7WUFDbkMsV0FBVyxFQUFFLHNDQUFzQztZQUNuRCxVQUFVLEVBQUUscUJBQXFCO1NBQ2xDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsVUFBVTtZQUNuQyxXQUFXLEVBQUUsbUNBQW1DO1lBQ2hELFVBQVUsRUFBRSxxQkFBcUI7U0FDbEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDckMsS0FBSyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsZUFBZTtZQUNwQyxXQUFXLEVBQUUscUJBQXFCO1lBQ2xDLFVBQVUsRUFBRSxnQkFBZ0I7U0FDN0IsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHO1lBQzdCLFdBQVcsRUFBRSwwQkFBMEI7WUFDdkMsVUFBVSxFQUFFLHFCQUFxQjtTQUNsQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUN0QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZO1lBQ2pDLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDbkMsS0FBSyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUNoQyxXQUFXLEVBQUUsK0JBQStCO1lBQzVDLFVBQVUsRUFBRSxjQUFjO1NBQzNCLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWxnQkQsa0RBa2dCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMga21zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rbXMnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgYmF0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWJhdGNoJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgbGFtYmRhTm9kZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEluZnJhc3RydWN0dXJlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgaW1hZ2VVcmk6IHN0cmluZztcbiAgZmFyZ2F0ZVZjcHU6IG51bWJlcjtcbiAgZmFyZ2F0ZU1lbW9yeTogbnVtYmVyO1xuICBqb2JUaW1lb3V0OiBudW1iZXI7XG4gIG1heFZjcHVzOiBudW1iZXI7XG4gIGV4aXN0aW5nT3V0cHV0QnVja2V0Pzogc3RyaW5nO1xuICBleGlzdGluZ1NvdXJjZUJ1Y2tldD86IHN0cmluZztcbiAgZXhpc3RpbmdWcGNJZD86IHN0cmluZztcbiAgZXhpc3RpbmdTdWJuZXRJZHM/OiBzdHJpbmdbXTtcbiAgZXhpc3RpbmdTZWN1cml0eUdyb3VwSWQ/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBJbmZyYXN0cnVjdHVyZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IG91dHB1dEJ1Y2tldDogczMuSUJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IHNvdXJjZUJ1Y2tldDogczMuSUJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IGVuY3J5cHRpb25LZXk6IGttcy5JS2V5O1xuICBwdWJsaWMgcmVhZG9ubHkgam9iUXVldWU6IGJhdGNoLkNmbkpvYlF1ZXVlO1xuICBwdWJsaWMgcmVhZG9ubHkgam9iRGVmaW5pdGlvbjogYmF0Y2guQ2ZuSm9iRGVmaW5pdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IGxvZ0dyb3VwOiBsb2dzLkxvZ0dyb3VwO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBJbmZyYXN0cnVjdHVyZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IGFjY291bnRJZCA9IGNkay5TdGFjay5vZih0aGlzKS5hY2NvdW50O1xuXG4gICAgLy8gUzMgQnVja2V0cyAtIFVzZSBleGlzdGluZyBvciBjcmVhdGUgbmV3XG4gICAgXG4gICAgLy8gS01TIGtleSBmb3IgUzMgZW5jcnlwdGlvblxuICAgIHRoaXMuZW5jcnlwdGlvbktleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdBdHhFbmNyeXB0aW9uS2V5Jywge1xuICAgICAgYWxpYXM6ICdhdHgtZW5jcnlwdGlvbi1rZXknLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IGZvciBBVFggUzMgYW5kIENsb3VkV2F0Y2ggTG9ncyBlbmNyeXB0aW9uJyxcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBMb2dzIHJlcXVpcmVzIGFuIGV4cGxpY2l0IGtleSBwb2xpY3kgdG8gdXNlIEtNUyBlbmNyeXB0aW9uXG4gICAgdGhpcy5lbmNyeXB0aW9uS2V5LmFkZFRvUmVzb3VyY2VQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogW1xuICAgICAgICAna21zOkVuY3J5cHQnLFxuICAgICAgICAna21zOkRlY3J5cHQnLFxuICAgICAgICAna21zOlJlRW5jcnlwdConLFxuICAgICAgICAna21zOkdlbmVyYXRlRGF0YUtleSonLFxuICAgICAgICAna21zOkRlc2NyaWJlS2V5JyxcbiAgICAgIF0sXG4gICAgICBwcmluY2lwYWxzOiBbbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKGBsb2dzLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gKV0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICBBcm5MaWtlOiB7XG4gICAgICAgICAgJ2ttczpFbmNyeXB0aW9uQ29udGV4dDphd3M6bG9nczphcm4nOiBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7YWNjb3VudElkfTpsb2ctZ3JvdXA6KmAsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pKTtcblxuICAgIC8vIFMzIEJ1Y2tldHMgLSBVc2UgZXhpc3Rpbmcgb3IgY3JlYXRlIG5ld1xuICAgIGlmIChwcm9wcy5leGlzdGluZ091dHB1dEJ1Y2tldCkge1xuICAgICAgdGhpcy5vdXRwdXRCdWNrZXQgPSBzMy5CdWNrZXQuZnJvbUJ1Y2tldE5hbWUodGhpcywgJ091dHB1dEJ1Y2tldCcsIHByb3BzLmV4aXN0aW5nT3V0cHV0QnVja2V0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5vdXRwdXRCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdPdXRwdXRCdWNrZXQnLCB7XG4gICAgICAgIGJ1Y2tldE5hbWU6IGBhdHgtY3VzdG9tLW91dHB1dC0ke2FjY291bnRJZH1gLFxuICAgICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZW5jcnlwdGlvbktleSxcbiAgICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsXG4gICAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7IGlkOiAnZXhwaXJlLTMwZCcsIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDMwKSB9XSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChwcm9wcy5leGlzdGluZ1NvdXJjZUJ1Y2tldCkge1xuICAgICAgdGhpcy5zb3VyY2VCdWNrZXQgPSBzMy5CdWNrZXQuZnJvbUJ1Y2tldE5hbWUodGhpcywgJ1NvdXJjZUJ1Y2tldCcsIHByb3BzLmV4aXN0aW5nU291cmNlQnVja2V0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zb3VyY2VCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdTb3VyY2VCdWNrZXQnLCB7XG4gICAgICAgIGJ1Y2tldE5hbWU6IGBhdHgtc291cmNlLWNvZGUtJHthY2NvdW50SWR9YCxcbiAgICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxuICAgICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyxcbiAgICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7IGlkOiAnZXhwaXJlLTdkJywgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNykgfV0sXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIFN1cHByZXNzIFMzIGFjY2VzcyBsb2dnaW5nIOKAlCB0aGVzZSBhcmUgc2hvcnQtbGl2ZWQgdHJhbnNmb3JtYXRpb24gYnVja2V0c1xuICAgIC8vIHdpdGggbGlmZWN5Y2xlIHJ1bGVzICg3ZC8zMGQpLiBBY2Nlc3MgaXMgYWxyZWFkeSBhdWRpdGFibGUgdmlhIENsb3VkVHJhaWwuXG4gICAgaWYgKCFwcm9wcy5leGlzdGluZ091dHB1dEJ1Y2tldCkge1xuICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHRoaXMub3V0cHV0QnVja2V0LCBbXG4gICAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtUzEnLCByZWFzb246ICdBY2Nlc3MgbG9nZ2luZyBub3QgcmVxdWlyZWQgZm9yIHNob3J0LWxpdmVkIHRyYW5zZm9ybWF0aW9uIG91dHB1dCBidWNrZXQgd2l0aCAzMGQgbGlmZWN5Y2xlLiBBdWRpdGFibGUgdmlhIENsb3VkVHJhaWwuJyB9LFxuICAgICAgXSwgdHJ1ZSk7XG4gICAgfVxuICAgIGlmICghcHJvcHMuZXhpc3RpbmdTb3VyY2VCdWNrZXQpIHtcbiAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh0aGlzLnNvdXJjZUJ1Y2tldCwgW1xuICAgICAgICB7IGlkOiAnQXdzU29sdXRpb25zLVMxJywgcmVhc29uOiAnQWNjZXNzIGxvZ2dpbmcgbm90IHJlcXVpcmVkIGZvciBzaG9ydC1saXZlZCBzb3VyY2UgY29kZSBidWNrZXQgd2l0aCA3ZCBsaWZlY3ljbGUuIEF1ZGl0YWJsZSB2aWEgQ2xvdWRUcmFpbC4nIH0sXG4gICAgICBdLCB0cnVlKTtcbiAgICB9XG5cbiAgICAvLyBDbG91ZFdhdGNoIExvZyBHcm91cFxuICAgIHRoaXMubG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnTG9nR3JvdXAnLCB7XG4gICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2JhdGNoL2F0eC10cmFuc2Zvcm0nLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxuICAgIH0pO1xuXG4gICAgLy8gSUFNIFJvbGUgZm9yIEJhdGNoIEpvYlxuICAgIGNvbnN0IGpvYlJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0JhdGNoSm9iUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiAnQVRYQmF0Y2hKb2JSb2xlJyxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQVdTVHJhbnNmb3JtQ3VzdG9tRnVsbEFjY2VzcycpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IFMzIGFjY2VzcyB0byBqb2Igcm9sZVxuICAgIHRoaXMub3V0cHV0QnVja2V0LmdyYW50UmVhZFdyaXRlKGpvYlJvbGUpO1xuICAgIHRoaXMuc291cmNlQnVja2V0LmdyYW50UmVhZChqb2JSb2xlKTtcbiAgICB0aGlzLmVuY3J5cHRpb25LZXkuZ3JhbnRFbmNyeXB0RGVjcnlwdChqb2JSb2xlKTtcblxuICAgIC8vIEFsbG93IGNvbnRhaW5lciB0byBmZXRjaCBwcml2YXRlIHJlcG8gY3JlZGVudGlhbHMgZnJvbSBTZWNyZXRzIE1hbmFnZXJcbiAgICBqb2JSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnc2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWUnXSxcbiAgICAgIHJlc291cmNlczogW2Nkay5Bcm4uZm9ybWF0KHtcbiAgICAgICAgc2VydmljZTogJ3NlY3JldHNtYW5hZ2VyJywgcmVzb3VyY2U6ICdzZWNyZXQnLCByZXNvdXJjZU5hbWU6ICdhdHgvKicsXG4gICAgICAgIGFybkZvcm1hdDogY2RrLkFybkZvcm1hdC5DT0xPTl9SRVNPVVJDRV9OQU1FLFxuICAgICAgfSwgdGhpcyldLFxuICAgIH0pKTtcblxuICAgIC8vIFN1cHByZXNzIGNkay1uYWcgZmluZGluZ3MgZm9yIGpvYiByb2xlXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGpvYlJvbGUsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgIHJlYXNvbjogJ0FXU1RyYW5zZm9ybUN1c3RvbUZ1bGxBY2Nlc3MgaXMgcmVxdWlyZWQgZm9yIEFXUyBUcmFuc2Zvcm0gQVBJIGFjY2Vzcy4gVGhpcyBpcyBhbiBBV1MtbWFuYWdlZCBwb2xpY3kgc3BlY2lmaWNhbGx5IGRlc2lnbmVkIGZvciB0aGlzIHNlcnZpY2UuJyxcbiAgICAgICAgYXBwbGllc1RvOiBbJ1BvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L0FXU1RyYW5zZm9ybUN1c3RvbUZ1bGxBY2Nlc3MnXSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdTMyB3aWxkY2FyZCBwZXJtaXNzaW9ucyBhcmUgcmVxdWlyZWQgZm9yIGR5bmFtaWMgZmlsZSBvcGVyYXRpb25zLiBLTVMgR2VuZXJhdGVEYXRhS2V5Ki9SZUVuY3J5cHQqIGFyZSBzdGFuZGFyZCBDREsgZ3JhbnQgcGF0dGVybnMgc2NvcGVkIHRvIGEgc2luZ2xlIGtleS4gU2VjcmV0cyBNYW5hZ2VyIHdpbGRjYXJkIGlzIHNjb3BlZCB0byBhdHgvKiBwcmVmaXggZm9yIGNyZWRlbnRpYWwgbWFuYWdlbWVudC4nLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAnQWN0aW9uOjpzMzpBYm9ydConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkRlbGV0ZU9iamVjdConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkdldEJ1Y2tldConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkdldE9iamVjdConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkxpc3QqJyxcbiAgICAgICAgICAnQWN0aW9uOjprbXM6R2VuZXJhdGVEYXRhS2V5KicsXG4gICAgICAgICAgJ0FjdGlvbjo6a21zOlJlRW5jcnlwdConLFxuICAgICAgICAgICdSZXNvdXJjZTo6PE91dHB1dEJ1Y2tldDcxMTRFQjI3LkFybj4vKicsXG4gICAgICAgICAgJ1Jlc291cmNlOjo8U291cmNlQnVja2V0REREMjEzMEEuQXJuPi8qJyxcbiAgICAgICAgICBgUmVzb3VyY2U6OmFybjphd3M6c2VjcmV0c21hbmFnZXI6JHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufToke2FjY291bnRJZH06c2VjcmV0OmF0eC8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgQmF0Y2ggRXhlY3V0aW9uXG4gICAgY29uc3QgZXhlY3V0aW9uUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQmF0Y2hFeGVjdXRpb25Sb2xlJywge1xuICAgICAgcm9sZU5hbWU6ICdBVFhCYXRjaEV4ZWN1dGlvblJvbGUnLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQW1hem9uRUNTVGFza0V4ZWN1dGlvblJvbGVQb2xpY3knKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBTdXBwcmVzcyBjZGstbmFnIGZpbmRpbmdzIGZvciBleGVjdXRpb24gcm9sZVxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhleGVjdXRpb25Sb2xlLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICByZWFzb246ICdBbWF6b25FQ1NUYXNrRXhlY3V0aW9uUm9sZVBvbGljeSBpcyB0aGUgc3RhbmRhcmQgQVdTLW1hbmFnZWQgcG9saWN5IGZvciBFQ1MgdGFzayBleGVjdXRpb24uIEl0IHByb3ZpZGVzIG5lY2Vzc2FyeSBwZXJtaXNzaW9ucyBmb3IgRUNSLCBDbG91ZFdhdGNoIExvZ3MsIGFuZCBTZWNyZXRzIE1hbmFnZXIuJyxcbiAgICAgICAgYXBwbGllc1RvOiBbJ1BvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BbWF6b25FQ1NUYXNrRXhlY3V0aW9uUm9sZVBvbGljeSddLFxuICAgICAgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIC8vIEdldCBWUEMgLSBVc2UgZXhpc3Rpbmcgb3IgZGVmYXVsdFxuICAgIGxldCB2cGM6IGVjMi5JVnBjO1xuICAgIGlmIChwcm9wcy5leGlzdGluZ1ZwY0lkKSB7XG4gICAgICAvLyBVc2UgZnJvbVZwY0F0dHJpYnV0ZXMgdG8gYXZvaWQgbG9va3VwXG4gICAgICBjb25zdCBzdWJuZXRJZHMgPSBwcm9wcy5leGlzdGluZ1N1Ym5ldElkcyAmJiBwcm9wcy5leGlzdGluZ1N1Ym5ldElkcy5sZW5ndGggPiAwXG4gICAgICAgID8gcHJvcHMuZXhpc3RpbmdTdWJuZXRJZHNcbiAgICAgICAgOiBbXTtcbiAgICAgIFxuICAgICAgdnBjID0gZWMyLlZwYy5mcm9tVnBjQXR0cmlidXRlcyh0aGlzLCAnVnBjJywge1xuICAgICAgICB2cGNJZDogcHJvcHMuZXhpc3RpbmdWcGNJZCxcbiAgICAgICAgYXZhaWxhYmlsaXR5Wm9uZXM6IFtgJHt0aGlzLnJlZ2lvbn1hYCwgYCR7dGhpcy5yZWdpb259YmBdLFxuICAgICAgICBwdWJsaWNTdWJuZXRJZHM6IHN1Ym5ldElkcy5sZW5ndGggPiAwID8gc3VibmV0SWRzIDogdW5kZWZpbmVkLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIExvb2t1cCBkZWZhdWx0IFZQQ1xuICAgICAgdnBjID0gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdEZWZhdWx0VnBjJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgLy8gU2VjdXJpdHkgR3JvdXAgLSBVc2UgZXhpc3Rpbmcgb3IgY3JlYXRlIG5ld1xuICAgIGxldCBzZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG4gICAgaWYgKHByb3BzLmV4aXN0aW5nU2VjdXJpdHlHcm91cElkKSB7XG4gICAgICBzZWN1cml0eUdyb3VwID0gZWMyLlNlY3VyaXR5R3JvdXAuZnJvbVNlY3VyaXR5R3JvdXBJZCh0aGlzLCAnU2VjdXJpdHlHcm91cCcsIHByb3BzLmV4aXN0aW5nU2VjdXJpdHlHcm91cElkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnQmF0Y2hTZWN1cml0eUdyb3VwJywge1xuICAgICAgICB2cGMsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIEFXUyBUcmFuc2Zvcm0gQmF0Y2ggam9icycsXG4gICAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBHZXQgc3VibmV0cyAtIFVzZSBleGlzdGluZyBvciBWUEMgcHVibGljIHN1Ym5ldHNcbiAgICBjb25zdCBzdWJuZXRJZHMgPSBwcm9wcy5leGlzdGluZ1N1Ym5ldElkcyAmJiBwcm9wcy5leGlzdGluZ1N1Ym5ldElkcy5sZW5ndGggPiAwXG4gICAgICA/IHByb3BzLmV4aXN0aW5nU3VibmV0SWRzXG4gICAgICA6IHZwYy5wdWJsaWNTdWJuZXRzLm1hcChzdWJuZXQgPT4gc3VibmV0LnN1Ym5ldElkKTtcblxuICAgIC8vIEJhdGNoIENvbXB1dGUgRW52aXJvbm1lbnRcbiAgICBjb25zdCBjb21wdXRlRW52aXJvbm1lbnQgPSBuZXcgYmF0Y2guQ2ZuQ29tcHV0ZUVudmlyb25tZW50KHRoaXMsICdDb21wdXRlRW52aXJvbm1lbnQnLCB7XG4gICAgICBjb21wdXRlRW52aXJvbm1lbnROYW1lOiAnYXR4LWZhcmdhdGUtY29tcHV0ZScsXG4gICAgICB0eXBlOiAnTUFOQUdFRCcsXG4gICAgICBzdGF0ZTogJ0VOQUJMRUQnLFxuICAgICAgY29tcHV0ZVJlc291cmNlczoge1xuICAgICAgICB0eXBlOiAnRkFSR0FURScsXG4gICAgICAgIG1heHZDcHVzOiBwcm9wcy5tYXhWY3B1cyxcbiAgICAgICAgc3VibmV0czogc3VibmV0SWRzLFxuICAgICAgICBzZWN1cml0eUdyb3VwSWRzOiBbc2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEJhdGNoIEpvYiBRdWV1ZVxuICAgIHRoaXMuam9iUXVldWUgPSBuZXcgYmF0Y2guQ2ZuSm9iUXVldWUodGhpcywgJ0pvYlF1ZXVlJywge1xuICAgICAgam9iUXVldWVOYW1lOiAnYXR4LWpvYi1xdWV1ZScsXG4gICAgICBzdGF0ZTogJ0VOQUJMRUQnLFxuICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICBjb21wdXRlRW52aXJvbm1lbnRPcmRlcjogW1xuICAgICAgICB7XG4gICAgICAgICAgb3JkZXI6IDEsXG4gICAgICAgICAgY29tcHV0ZUVudmlyb25tZW50OiBjb21wdXRlRW52aXJvbm1lbnQuYXR0ckNvbXB1dGVFbnZpcm9ubWVudEFybixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmpvYlF1ZXVlLmFkZERlcGVuZGVuY3koY29tcHV0ZUVudmlyb25tZW50KTtcblxuICAgIC8vIEJhdGNoIEpvYiBEZWZpbml0aW9uXG4gICAgdGhpcy5qb2JEZWZpbml0aW9uID0gbmV3IGJhdGNoLkNmbkpvYkRlZmluaXRpb24odGhpcywgJ0pvYkRlZmluaXRpb24nLCB7XG4gICAgICBqb2JEZWZpbml0aW9uTmFtZTogJ2F0eC10cmFuc2Zvcm0tam9iJyxcbiAgICAgIHR5cGU6ICdjb250YWluZXInLFxuICAgICAgcGxhdGZvcm1DYXBhYmlsaXRpZXM6IFsnRkFSR0FURSddLFxuICAgICAgdGltZW91dDoge1xuICAgICAgICBhdHRlbXB0RHVyYXRpb25TZWNvbmRzOiBwcm9wcy5qb2JUaW1lb3V0LFxuICAgICAgfSxcbiAgICAgIHJldHJ5U3RyYXRlZ3k6IHtcbiAgICAgICAgYXR0ZW1wdHM6IDMsXG4gICAgICB9LFxuICAgICAgY29udGFpbmVyUHJvcGVydGllczoge1xuICAgICAgICBpbWFnZTogcHJvcHMuaW1hZ2VVcmksXG4gICAgICAgIGpvYlJvbGVBcm46IGpvYlJvbGUucm9sZUFybixcbiAgICAgICAgZXhlY3V0aW9uUm9sZUFybjogZXhlY3V0aW9uUm9sZS5yb2xlQXJuLFxuICAgICAgICByZXNvdXJjZVJlcXVpcmVtZW50czogW1xuICAgICAgICAgIHsgdHlwZTogJ1ZDUFUnLCB2YWx1ZTogcHJvcHMuZmFyZ2F0ZVZjcHUudG9TdHJpbmcoKSB9LFxuICAgICAgICAgIHsgdHlwZTogJ01FTU9SWScsIHZhbHVlOiBwcm9wcy5mYXJnYXRlTWVtb3J5LnRvU3RyaW5nKCkgfSxcbiAgICAgICAgXSxcbiAgICAgICAgbG9nQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGxvZ0RyaXZlcjogJ2F3c2xvZ3MnLFxuICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICdhd3Nsb2dzLWdyb3VwJzogdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICAgICAgICAnYXdzbG9ncy1yZWdpb24nOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgICAgICdhd3Nsb2dzLXN0cmVhbS1wcmVmaXgnOiAnYXR4JyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBuZXR3b3JrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGFzc2lnblB1YmxpY0lwOiBwcm9wcy5leGlzdGluZ1N1Ym5ldElkcyAmJiBwcm9wcy5leGlzdGluZ1N1Ym5ldElkcy5sZW5ndGggPiAwID8gJ0RJU0FCTEVEJyA6ICdFTkFCTEVEJyxcbiAgICAgICAgfSxcbiAgICAgICAgZW52aXJvbm1lbnQ6IFtcbiAgICAgICAgICB7IG5hbWU6ICdTM19CVUNLRVQnLCB2YWx1ZTogdGhpcy5vdXRwdXRCdWNrZXQuYnVja2V0TmFtZSB9LFxuICAgICAgICAgIHsgbmFtZTogJ1NPVVJDRV9CVUNLRVQnLCB2YWx1ZTogdGhpcy5zb3VyY2VCdWNrZXQuYnVja2V0TmFtZSB9LFxuICAgICAgICAgIHsgbmFtZTogJ0FXU19ERUZBVUxUX1JFR0lPTicsIHZhbHVlOiB0aGlzLnJlZ2lvbiB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIExhbWJkYSBGdW5jdGlvbnMgKGludm9rZWQgZGlyZWN0bHkgdmlhIGF3cyBsYW1iZGEgaW52b2tlKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGxhbWJkYURpciA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICdsYW1iZGEnKTtcblxuICAgIGNvbnN0IGJhc2VMYW1iZGFQcm9wcyA9IHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgXSxcbiAgICB9O1xuXG4gICAgLy8gLS0tIFN1Ym1pdCByb2xlICh0cmlnZ2VyLWpvYiwgdHJpZ2dlci1iYXRjaC1qb2JzKSAtLS1cbiAgICBjb25zdCBzdWJtaXRSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMYW1iZGFTdWJtaXRSb2xlJywge1xuICAgICAgcm9sZU5hbWU6ICdBVFhMYW1iZGFTdWJtaXRSb2xlJyxcbiAgICAgIC4uLmJhc2VMYW1iZGFQcm9wcyxcbiAgICB9KTtcbiAgICBzdWJtaXRSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnYmF0Y2g6U3VibWl0Sm9iJ10sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6YmF0Y2g6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmpvYi1kZWZpbml0aW9uLyR7dGhpcy5qb2JEZWZpbml0aW9uLmpvYkRlZmluaXRpb25OYW1lfSpgLFxuICAgICAgICBgYXJuOmF3czpiYXRjaDoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06am9iLXF1ZXVlLyR7dGhpcy5qb2JRdWV1ZS5qb2JRdWV1ZU5hbWV9YCxcbiAgICAgIF0sXG4gICAgfSkpO1xuICAgIHN1Ym1pdFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydiYXRjaDpUYWdSZXNvdXJjZSddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG4gICAgdGhpcy5vdXRwdXRCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoc3VibWl0Um9sZSk7XG4gICAgdGhpcy5lbmNyeXB0aW9uS2V5LmdyYW50RW5jcnlwdERlY3J5cHQoc3VibWl0Um9sZSk7XG5cbiAgICAvLyAtLS0gUmVhZC1vbmx5IHN0YXR1cyByb2xlIChnZXQtam9iLXN0YXR1cywgZ2V0LWJhdGNoLXN0YXR1cywgbGlzdC1qb2JzLCBsaXN0LWJhdGNoZXMpIC0tLVxuICAgIGNvbnN0IHN0YXR1c1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xhbWJkYVN0YXR1c1JvbGUnLCB7XG4gICAgICByb2xlTmFtZTogJ0FUWExhbWJkYVN0YXR1c1JvbGUnLFxuICAgICAgLi4uYmFzZUxhbWJkYVByb3BzLFxuICAgIH0pO1xuICAgIHN0YXR1c1JvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydiYXRjaDpEZXNjcmliZUpvYnMnLCAnYmF0Y2g6TGlzdEpvYnMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuICAgIHRoaXMub3V0cHV0QnVja2V0LmdyYW50UmVhZChzdGF0dXNSb2xlKTtcbiAgICB0aGlzLmVuY3J5cHRpb25LZXkuZ3JhbnREZWNyeXB0KHN0YXR1c1JvbGUpO1xuXG4gICAgLy8gLS0tIFRlcm1pbmF0ZSByb2xlICh0ZXJtaW5hdGUtam9iLCB0ZXJtaW5hdGUtYmF0Y2gtam9icykgLS0tXG4gICAgY29uc3QgdGVybWluYXRlUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnTGFtYmRhVGVybWluYXRlUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiAnQVRYTGFtYmRhVGVybWluYXRlUm9sZScsXG4gICAgICAuLi5iYXNlTGFtYmRhUHJvcHMsXG4gICAgfSk7XG4gICAgdGVybWluYXRlUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2JhdGNoOkRlc2NyaWJlSm9icycsICdiYXRjaDpUZXJtaW5hdGVKb2InXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuICAgIHRoaXMub3V0cHV0QnVja2V0LmdyYW50UmVhZCh0ZXJtaW5hdGVSb2xlKTtcbiAgICB0aGlzLmVuY3J5cHRpb25LZXkuZ3JhbnREZWNyeXB0KHRlcm1pbmF0ZVJvbGUpO1xuXG4gICAgLy8gLS0tIENvbmZpZ3VyZSByb2xlIChjb25maWd1cmUtbWNwKSAtLS1cbiAgICBjb25zdCBjb25maWd1cmVSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMYW1iZGFDb25maWd1cmVSb2xlJywge1xuICAgICAgcm9sZU5hbWU6ICdBVFhMYW1iZGFDb25maWd1cmVSb2xlJyxcbiAgICAgIC4uLmJhc2VMYW1iZGFQcm9wcyxcbiAgICB9KTtcbiAgICB0aGlzLnNvdXJjZUJ1Y2tldC5ncmFudFdyaXRlKGNvbmZpZ3VyZVJvbGUpO1xuICAgIHRoaXMuZW5jcnlwdGlvbktleS5ncmFudEVuY3J5cHQoY29uZmlndXJlUm9sZSk7XG5cbiAgICAvLyBTdXBwcmVzcyBjZGstbmFnIGZpbmRpbmdzIGZvciBhbGwgTGFtYmRhIHJvbGVzXG4gICAgZm9yIChjb25zdCByb2xlIG9mIFtzdWJtaXRSb2xlLCBzdGF0dXNSb2xlLCB0ZXJtaW5hdGVSb2xlLCBjb25maWd1cmVSb2xlXSkge1xuICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHJvbGUsIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICAgIHJlYXNvbjogJ0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBpcyB0aGUgc3RhbmRhcmQgQVdTLW1hbmFnZWQgcG9saWN5IGZvciBMYW1iZGEgQ2xvdWRXYXRjaCBMb2dzIGFjY2Vzcy4nLFxuICAgICAgICAgIGFwcGxpZXNUbzogWydQb2xpY3k6OmFybjo8QVdTOjpQYXJ0aXRpb24+OmlhbTo6YXdzOnBvbGljeS9zZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJ10sXG4gICAgICAgIH0sXG4gICAgICBdLCB0cnVlKTtcbiAgICB9XG4gICAgZm9yIChjb25zdCByb2xlIG9mIFtzdWJtaXRSb2xlLCBzdGF0dXNSb2xlLCB0ZXJtaW5hdGVSb2xlXSkge1xuICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHJvbGUsIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgIHJlYXNvbjogJ0JhdGNoIERlc2NyaWJlSm9icy9MaXN0Sm9icyByZXF1aXJlIHdpbGRjYXJkIHJlc291cmNlcy4gUzMgYW5kIEtNUyB3aWxkY2FyZHMgYXJlIHN0YW5kYXJkIENESyBncmFudCBwYXR0ZXJucyBzY29wZWQgdG8gc3BlY2lmaWMgYnVja2V0cy9rZXlzLicsXG4gICAgICAgICAgYXBwbGllc1RvOiBbXG4gICAgICAgICAgICAnUmVzb3VyY2U6OionLFxuICAgICAgICAgICAgJ0FjdGlvbjo6czM6QWJvcnQqJyxcbiAgICAgICAgICAgICdBY3Rpb246OnMzOkRlbGV0ZU9iamVjdConLFxuICAgICAgICAgICAgJ0FjdGlvbjo6czM6R2V0QnVja2V0KicsXG4gICAgICAgICAgICAnQWN0aW9uOjpzMzpHZXRPYmplY3QqJyxcbiAgICAgICAgICAgICdBY3Rpb246OnMzOkxpc3QqJyxcbiAgICAgICAgICAgICdBY3Rpb246OmttczpHZW5lcmF0ZURhdGFLZXkqJyxcbiAgICAgICAgICAgICdBY3Rpb246OmttczpSZUVuY3J5cHQqJyxcbiAgICAgICAgICAgICdSZXNvdXJjZTo6PE91dHB1dEJ1Y2tldDcxMTRFQjI3LkFybj4vKicsXG4gICAgICAgICAgICBgUmVzb3VyY2U6OmFybjphd3M6YmF0Y2g6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmpvYi1kZWZpbml0aW9uLyR7dGhpcy5qb2JEZWZpbml0aW9uLmpvYkRlZmluaXRpb25OYW1lfSpgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdLCB0cnVlKTtcbiAgICB9XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGNvbmZpZ3VyZVJvbGUsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1MzIGFuZCBLTVMgd2lsZGNhcmRzIGFyZSBzdGFuZGFyZCBDREsgZ3JhbnQgcGF0dGVybnMgc2NvcGVkIHRvIHNwZWNpZmljIGJ1Y2tldHMva2V5cy4nLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAnQWN0aW9uOjpzMzpBYm9ydConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkRlbGV0ZU9iamVjdConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkdldEJ1Y2tldConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkdldE9iamVjdConLFxuICAgICAgICAgICdBY3Rpb246OnMzOkxpc3QqJyxcbiAgICAgICAgICAnQWN0aW9uOjprbXM6R2VuZXJhdGVEYXRhS2V5KicsXG4gICAgICAgICAgJ0FjdGlvbjo6a21zOlJlRW5jcnlwdConLFxuICAgICAgICAgICdSZXNvdXJjZTo6PFNvdXJjZUJ1Y2tldERERDIxMzBBLkFybj4vKicsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIF0sIHRydWUpO1xuXG4gICAgY29uc3QgbGFtYmRhRW52ID0ge1xuICAgICAgSk9CX1FVRVVFOiAnYXR4LWpvYi1xdWV1ZScsXG4gICAgICBKT0JfREVGSU5JVElPTjogJ2F0eC10cmFuc2Zvcm0tam9iJyxcbiAgICAgIE9VVFBVVF9CVUNLRVQ6IHRoaXMub3V0cHV0QnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBTT1VSQ0VfQlVDS0VUOiB0aGlzLnNvdXJjZUJ1Y2tldC5idWNrZXROYW1lLFxuICAgIH07XG5cbiAgICBjb25zdCBkZWZhdWx0Rm5Qcm9wczogUGFydGlhbDxsYW1iZGFOb2RlLk5vZGVqc0Z1bmN0aW9uUHJvcHM+ID0ge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzI0X1gsXG4gICAgICBlbnZpcm9ubWVudDogbGFtYmRhRW52LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgYnVuZGxpbmc6IHsgbWluaWZ5OiB0cnVlLCBzb3VyY2VNYXA6IHRydWUgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgbWFrZUZuID0gKGlkOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgZW50cnk6IHN0cmluZywgcm9sZTogaWFtLklSb2xlLCBvdmVycmlkZXM/OiBQYXJ0aWFsPGxhbWJkYU5vZGUuTm9kZWpzRnVuY3Rpb25Qcm9wcz4pID0+XG4gICAgICBuZXcgbGFtYmRhTm9kZS5Ob2RlanNGdW5jdGlvbih0aGlzLCBpZCwge1xuICAgICAgICAuLi5kZWZhdWx0Rm5Qcm9wcyxcbiAgICAgICAgcm9sZSxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBuYW1lLFxuICAgICAgICBlbnRyeTogcGF0aC5qb2luKGxhbWJkYURpciwgZW50cnksICdpbmRleC50cycpLFxuICAgICAgICAuLi5vdmVycmlkZXMsXG4gICAgICB9KTtcblxuICAgIG1ha2VGbignVHJpZ2dlckpvYkZ1bmN0aW9uJywgJ2F0eC10cmlnZ2VyLWpvYicsICd0cmlnZ2VyLWpvYicsIHN1Ym1pdFJvbGUpO1xuICAgIG1ha2VGbignR2V0Sm9iU3RhdHVzRnVuY3Rpb24nLCAnYXR4LWdldC1qb2Itc3RhdHVzJywgJ2dldC1qb2Itc3RhdHVzJywgc3RhdHVzUm9sZSk7XG4gICAgbWFrZUZuKCdUZXJtaW5hdGVKb2JGdW5jdGlvbicsICdhdHgtdGVybWluYXRlLWpvYicsICd0ZXJtaW5hdGUtam9iJywgdGVybWluYXRlUm9sZSk7XG4gICAgbWFrZUZuKCdMaXN0Sm9ic0Z1bmN0aW9uJywgJ2F0eC1saXN0LWpvYnMnLCAnbGlzdC1qb2JzJywgc3RhdHVzUm9sZSk7XG4gICAgbWFrZUZuKCdUcmlnZ2VyQmF0Y2hKb2JzRnVuY3Rpb24nLCAnYXR4LXRyaWdnZXItYmF0Y2gtam9icycsICd0cmlnZ2VyLWJhdGNoLWpvYnMnLCBzdWJtaXRSb2xlLCB7XG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgfSk7XG4gICAgbWFrZUZuKCdHZXRCYXRjaFN0YXR1c0Z1bmN0aW9uJywgJ2F0eC1nZXQtYmF0Y2gtc3RhdHVzJywgJ2dldC1iYXRjaC1zdGF0dXMnLCBzdGF0dXNSb2xlKTtcbiAgICBtYWtlRm4oJ1Rlcm1pbmF0ZUJhdGNoSm9ic0Z1bmN0aW9uJywgJ2F0eC10ZXJtaW5hdGUtYmF0Y2gtam9icycsICd0ZXJtaW5hdGUtYmF0Y2gtam9icycsIHRlcm1pbmF0ZVJvbGUpO1xuICAgIG1ha2VGbignTGlzdEJhdGNoZXNGdW5jdGlvbicsICdhdHgtbGlzdC1iYXRjaGVzJywgJ2xpc3QtYmF0Y2hlcycsIHN0YXR1c1JvbGUpO1xuICAgIG1ha2VGbignQ29uZmlndXJlTWNwRnVuY3Rpb24nLCAnYXR4LWNvbmZpZ3VyZS1tY3AnLCAnY29uZmlndXJlLW1jcCcsIGNvbmZpZ3VyZVJvbGUpO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBEYXNoYm9hcmRcbiAgICBjb25zdCBkYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ0Rhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6ICdBVFgtVHJhbnNmb3JtLUNMSS1EYXNoYm9hcmQnLFxuICAgIH0pO1xuXG4gICAgLy8gUm93IDE6IEpvYiByZXN1bHRzIHN1bW1hcnkg4oCUIHN1Y2Nlc3MvZmFpbHVyZSBjb3VudHMgYnkgVERcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkxvZ1F1ZXJ5V2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICfwn5OKIFRyYW5zZm9ybWF0aW9uIFJlc3VsdHMgYnkgVEQnLFxuICAgICAgICBsb2dHcm91cE5hbWVzOiBbdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWVdLFxuICAgICAgICBxdWVyeUxpbmVzOiBbXG4gICAgICAgICAgJ2ZpbHRlciBAbWVzc2FnZSBsaWtlIC9KT0JfU1VNTUFSWS8nLFxuICAgICAgICAgICdwYXJzZSBAbWVzc2FnZSAvam9iU3RhdHVzPSg/PGpvYlN0YXQ+XFxcXFMrKS8nLFxuICAgICAgICAgICdwYXJzZSBAbWVzc2FnZSAvdGROYW1lPSg/PHRkTm0+XFxcXFMrKS8nLFxuICAgICAgICAgICdmaWVsZHMgam9iU3RhdCA9IFwiU1VDQ0VFREVEXCIgYXMgaXNTdWNjZXNzLCBqb2JTdGF0ID0gXCJGQUlMRURcIiBhcyBpc0ZhaWwnLFxuICAgICAgICAgICdzdGF0cyBjb3VudCgqKSBhcyBUb3RhbCwgc3VtKGlzU3VjY2VzcykgYXMgU3VjY2VlZGVkLCBzdW0oaXNGYWlsKSBhcyBGYWlsZWQgYnkgdGRObScsXG4gICAgICAgICAgJ3NvcnQgVG90YWwgZGVzYycsXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gUm93IDI6IFJlY2VudCBqb2IgaGlzdG9yeSB3aXRoIHN0YXR1cyBhbmQgVERcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkxvZ1F1ZXJ5V2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICfwn5OLIFJlY2VudCBKb2IgSGlzdG9yeScsXG4gICAgICAgIGxvZ0dyb3VwTmFtZXM6IFt0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZV0sXG4gICAgICAgIHF1ZXJ5TGluZXM6IFtcbiAgICAgICAgICAnZmlsdGVyIEBtZXNzYWdlIGxpa2UgL0pPQl9TVU1NQVJZLycsXG4gICAgICAgICAgJ3BhcnNlIEBtZXNzYWdlIC9qb2JTdGF0dXM9KD88am9iU3RhdD5cXFxcUyspLycsXG4gICAgICAgICAgJ3BhcnNlIEBtZXNzYWdlIC9leGl0Q29kZT0oPzxleGl0Q2Q+XFxcXFMrKS8nLFxuICAgICAgICAgICdwYXJzZSBAbWVzc2FnZSAvdGROYW1lPSg/PHRkTm0+XFxcXFMrKS8nLFxuICAgICAgICAgICdwYXJzZSBAbWVzc2FnZSAvc291cmNlUmVwbz0oPzxzcmNSZXBvPlxcXFxTKykvJyxcbiAgICAgICAgICAnZGlzcGxheSBAdGltZXN0YW1wLCBqb2JTdGF0LCB0ZE5tLCBzcmNSZXBvLCBleGl0Q2QnLFxuICAgICAgICAgICdzb3J0IEB0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgICAgJ2xpbWl0IDUwMCcsXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiA4LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gUm93IDM6IFN1Y2Nlc3MvZmFpbHVyZSB0cmVuZCBvdmVyIHRpbWVcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkxvZ1F1ZXJ5V2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICfwn5OIIEpvYiBTdWNjZXNzL0ZhaWx1cmUgVHJlbmQgKEhvdXJseSknLFxuICAgICAgICBsb2dHcm91cE5hbWVzOiBbdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWVdLFxuICAgICAgICBxdWVyeUxpbmVzOiBbXG4gICAgICAgICAgJ2ZpbHRlciBAbWVzc2FnZSBsaWtlIC9KT0JfU1VNTUFSWS8nLFxuICAgICAgICAgICdwYXJzZSBAbWVzc2FnZSAvam9iU3RhdHVzPSg/PGpvYlN0YXQ+XFxcXFMrKS8nLFxuICAgICAgICAgICdmaWVsZHMgam9iU3RhdCA9IFwiU1VDQ0VFREVEXCIgYXMgaXNTdWNjZXNzLCBqb2JTdGF0ID0gXCJGQUlMRURcIiBhcyBpc0ZhaWwnLFxuICAgICAgICAgICdzdGF0cyBzdW0oaXNTdWNjZXNzKSBhcyBTdWNjZWVkZWQsIHN1bShpc0ZhaWwpIGFzIEZhaWxlZCBieSBiaW4oMWgpJyxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkxvZ1F1ZXJ5V2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICfinYwgUmVjZW50IEVycm9ycycsXG4gICAgICAgIGxvZ0dyb3VwTmFtZXM6IFt0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZV0sXG4gICAgICAgIHF1ZXJ5TGluZXM6IFtcbiAgICAgICAgICAnZmlsdGVyIEBtZXNzYWdlIGxpa2UgL0pPQl9TVU1NQVJZLyBhbmQgQG1lc3NhZ2UgbGlrZSAvam9iU3RhdHVzPUZBSUxFRC8nLFxuICAgICAgICAgICdwYXJzZSBAbWVzc2FnZSAvZXhpdENvZGU9KD88ZXhpdENkPlxcXFxTKykvJyxcbiAgICAgICAgICAncGFyc2UgQG1lc3NhZ2UgL3RkTmFtZT0oPzx0ZE5tPlxcXFxTKykvJyxcbiAgICAgICAgICAncGFyc2UgQG1lc3NhZ2UgL3NvdXJjZVJlcG89KD88c3JjUmVwbz5cXFxcUyspLycsXG4gICAgICAgICAgJ2Rpc3BsYXkgQHRpbWVzdGFtcCwgdGRObSwgc3JjUmVwbywgZXhpdENkJyxcbiAgICAgICAgICAnc29ydCBAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICAgICdsaW1pdCA1MDAnLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT3V0cHV0QnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm91dHB1dEJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBidWNrZXQgZm9yIHRyYW5zZm9ybWF0aW9uIG91dHB1dHMnLFxuICAgICAgZXhwb3J0TmFtZTogJ0F0eE91dHB1dEJ1Y2tldE5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NvdXJjZUJ1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5zb3VyY2VCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IGZvciBzb3VyY2UgY29kZSB1cGxvYWRzJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdBdHhTb3VyY2VCdWNrZXROYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdKb2JRdWV1ZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmpvYlF1ZXVlLmF0dHJKb2JRdWV1ZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmF0Y2ggam9iIHF1ZXVlIEFSTicsXG4gICAgICBleHBvcnROYW1lOiAnQXR4Sm9iUXVldWVBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0pvYkRlZmluaXRpb25Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5qb2JEZWZpbml0aW9uLnJlZixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmF0Y2ggam9iIGRlZmluaXRpb24gQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdBdHhKb2JEZWZpbml0aW9uQXJuJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMb2dHcm91cE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggbG9nIGdyb3VwIG5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ttc0tleUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmVuY3J5cHRpb25LZXkua2V5QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IEFSTiBmb3IgUzMgZW5jcnlwdGlvbicsXG4gICAgICBleHBvcnROYW1lOiAnQXR4S21zS2V5QXJuJyxcbiAgICB9KTtcbiAgfVxufVxuIl19