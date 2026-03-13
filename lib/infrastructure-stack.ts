import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';

export interface InfrastructureStackProps extends cdk.StackProps {
  imageUri: string;
  fargateVcpu: number;
  fargateMemory: number;
  jobTimeout: number;
  maxVcpus: number;
  existingOutputBucket?: string;
  existingSourceBucket?: string;
  existingVpcId?: string;
  existingSubnetIds?: string[];
  existingSecurityGroupId?: string;
}

export class InfrastructureStack extends cdk.Stack {
  public readonly outputBucket: s3.IBucket;
  public readonly sourceBucket: s3.IBucket;
  public readonly encryptionKey: kms.IKey;
  public readonly jobQueue: batch.CfnJobQueue;
  public readonly jobDefinition: batch.CfnJobDefinition;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;

    // S3 Buckets - Use existing or create new
    
    // KMS key for S3 encryption
    this.encryptionKey = new kms.Key(this, 'AtxEncryptionKey', {
      alias: 'atx-encryption-key',
      description: 'KMS key for ATX S3 bucket encryption',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // S3 Buckets - Use existing or create new
    if (props.existingOutputBucket) {
      this.outputBucket = s3.Bucket.fromBucketName(this, 'OutputBucket', props.existingOutputBucket);
    } else {
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
    } else {
      this.sourceBucket = new s3.Bucket(this, 'SourceBucket', {
        bucketName: `atx-source-code-${accountId}`,
        encryptionKey: this.encryptionKey,
        encryption: s3.BucketEncryption.KMS,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        lifecycleRules: [{ id: 'expire-48h', expiration: cdk.Duration.days(2) }],
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        enforceSSL: true,
      });
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
    NagSuppressions.addResourceSuppressions(jobRole, [
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
    NagSuppressions.addResourceSuppressions(executionRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AmazonECSTaskExecutionRolePolicy is the standard AWS-managed policy for ECS task execution. It provides necessary permissions for ECR, CloudWatch Logs, and Secrets Manager.',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
      },
    ], true);

    // Get VPC - Use existing or default
    let vpc: ec2.IVpc;
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
    } else {
      // Lookup default VPC
      vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
    }

    // Security Group - Use existing or create new
    let securityGroup: ec2.ISecurityGroup;
    if (props.existingSecurityGroupId) {
      securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'SecurityGroup', props.existingSecurityGroupId);
    } else {
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
          assignPublicIp: 'ENABLED',
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

    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: 'ATXLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['batch:SubmitJob'],
      resources: [
        `arn:aws:batch:${this.region}:${this.account}:job-definition/${this.jobDefinition.jobDefinitionName}*`,
        `arn:aws:batch:${this.region}:${this.account}:job-queue/${this.jobQueue.jobQueueName}`,
      ],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['batch:DescribeJobs', 'batch:ListJobs', 'batch:TerminateJob', 'batch:TagResource'],
      resources: ['*'],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:GetLogEvents', 'logs:FilterLogEvents'],
      resources: [this.logGroup.logGroupArn],
    }));

    this.outputBucket.grantReadWrite(lambdaRole);
    this.sourceBucket.grantReadWrite(lambdaRole);
    this.encryptionKey.grantEncryptDecrypt(lambdaRole);

    NagSuppressions.addResourceSuppressions(lambdaRole, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole is the standard AWS-managed policy for Lambda CloudWatch Logs access.',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required: Batch API needs wildcard for DescribeJobs/ListJobs, S3 wildcards for dynamic paths, KMS GenerateDataKey*/ReEncrypt* are standard CDK grant patterns scoped to a single key.',
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
          'Resource::<SourceBucketDDD2130A.Arn>/*',
          `Resource::arn:aws:batch:${this.region}:${this.account}:job-definition/${this.jobDefinition.jobDefinitionName}*`,
        ],
      },
    ], true);

    const lambdaEnv = {
      JOB_QUEUE: 'atx-job-queue',
      JOB_DEFINITION: 'atx-transform-job',
      OUTPUT_BUCKET: this.outputBucket.bucketName,
      SOURCE_BUCKET: this.sourceBucket.bucketName,
    };

    const defaultFnProps: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_24_X,
      role: lambdaRole,
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(30),
      bundling: { minify: true, sourceMap: true },
    };

    const makeFn = (id: string, name: string, entry: string, overrides?: Partial<lambdaNode.NodejsFunctionProps>) =>
      new lambdaNode.NodejsFunction(this, id, {
        ...defaultFnProps,
        functionName: name,
        entry: path.join(lambdaDir, entry, 'index.ts'),
        ...overrides,
      });

    makeFn('TriggerJobFunction', 'atx-trigger-job', 'trigger-job');
    makeFn('GetJobStatusFunction', 'atx-get-job-status', 'get-job-status');
    makeFn('TerminateJobFunction', 'atx-terminate-job', 'terminate-job');
    makeFn('ListJobsFunction', 'atx-list-jobs', 'list-jobs');
    makeFn('TriggerBatchJobsFunction', 'atx-trigger-batch-jobs', 'trigger-batch-jobs', {
      timeout: cdk.Duration.minutes(15),
    });
    makeFn('GetBatchStatusFunction', 'atx-get-batch-status', 'get-batch-status');
    makeFn('TerminateBatchJobsFunction', 'atx-terminate-batch-jobs', 'terminate-batch-jobs');
    makeFn('ListBatchesFunction', 'atx-list-batches', 'list-batches');
    makeFn('ConfigureMcpFunction', 'atx-configure-mcp', 'configure-mcp');

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'ATX-Transform-CLI-Dashboard',
    });

    // Row 1: Job results summary — success/failure counts by TD
    dashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
        title: '📊 Transformation Results by TD',
        logGroupNames: [this.logGroup.logGroupName],
        queryLines: [
          'filter @message like /JOB_SUMMARY/',
          'parse @message /jobStatus=(?<jobStat>\\S+)/',
          'parse @message /tdName=(?<tdNm>\\S+)/',
          'stats count(*) as Total, sum(jobStat="SUCCEEDED") as Succeeded, sum(jobStat="FAILED") as Failed by tdNm',
          'sort Total desc',
        ],
        width: 24,
        height: 6,
      })
    );

    // Row 2: Recent job history with status and TD
    dashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
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
      })
    );

    // Row 3: Success/failure trend over time
    dashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
        title: '📈 Job Success/Failure Trend (Hourly)',
        logGroupNames: [this.logGroup.logGroupName],
        queryLines: [
          'filter @message like /JOB_SUMMARY/',
          'parse @message /jobStatus=(?<jobStat>\\S+)/',
          'stats sum(jobStat="SUCCEEDED") as Succeeded, sum(jobStat="FAILED") as Failed by bin(1h)',
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.LogQueryWidget({
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
      })
    );

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
