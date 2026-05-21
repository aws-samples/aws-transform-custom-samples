/**
 * AgentCore + API Stack
 *
 * Deploys the orchestrator to Bedrock AgentCore, the async Lambda bridge,
 * and the HTTP API Gateway. Single stack for the entire agent layer.
 *
 * ⚠️ EXPERIMENTAL: Uses @aws-cdk/aws-bedrock-agentcore-alpha which is
 * under active development and subject to breaking changes.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Runtime, AgentRuntimeArtifact } from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';

export interface AgentCoreStackProps extends cdk.StackProps {
  outputBucketName: string;
  sourceBucketName: string;
  jobsTableName: string;
}

export class AgentCoreStack extends cdk.Stack {
  public readonly agentRuntime: Runtime;
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. AgentCore Orchestrator Runtime
    // ========================================

    // IAM role for the AgentCore runtime
    const agentRole = new iam.Role(this, 'AgentCoreRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for ATX Transform orchestrator on AgentCore',
    });

    // Bedrock model access
    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));

    // Batch access (for execute_transform_agent)
    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: ['batch:SubmitJob', 'batch:DescribeJobs'],
      resources: ['*'],
    }));

    // S3 access (for find/create/execute tools)
    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket', 's3:GetObject', 's3:PutObject'],
      resources: [
        `arn:aws:s3:::${props.outputBucketName}`,
        `arn:aws:s3:::${props.outputBucketName}/*`,
        `arn:aws:s3:::${props.sourceBucketName}`,
        `arn:aws:s3:::${props.sourceBucketName}/*`,
      ],
    }));

    // STS for account ID lookups
    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:GetCallerIdentity'],
      resources: ['*'],
    }));

    // AgentCore Memory access
    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock-agentcore:ListMemories', 'bedrock-agentcore:GetMemory',
        'bedrock-agentcore:CreateMemory', 'bedrock-agentcore:UpdateMemory',
        'bedrock-agentcore:DeleteMemory', 'bedrock-agentcore:ListEvents',
        'bedrock-agentcore:GetEvent', 'bedrock-agentcore:CreateEvent',
        'bedrock-agentcore:DeleteEvent',
      ],
      resources: ['*'],
    }));

    // Observability: X-Ray tracing + CloudWatch Application Signals
    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'xray:PutTraceSegments', 'xray:PutTelemetryRecords',
        'xray:GetSamplingRules', 'xray:GetSamplingTargets',
      ],
      resources: ['*'],
    }));

    agentRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents',
        'logs:PutDeliverySource', 'logs:PutDeliveryDestination',
        'logs:CreateDelivery',
      ],
      resources: [
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/*`,
        `arn:aws:logs:${this.region}:${this.account}:log-group:aws/spans:*`,
      ],
    }));

    // Deploy orchestrator from local directory
    const artifact = AgentRuntimeArtifact.fromAsset(
      path.join(__dirname, '../../orchestrator')
    );

    this.agentRuntime = new Runtime(this, 'OrchestratorRuntime', {
      runtimeName: 'atxTransformOrchestrator',
      executionRole: agentRole,
      agentRuntimeArtifact: artifact,
      environmentVariables: {
        AWS_REGION: this.region,
      },
    });

    // Suppress cdk-nag for AgentCore role
    NagSuppressions.addResourceSuppressions(agentRole, [
      { id: 'AwsSolutions-IAM5', reason: 'Bedrock model and Batch resources require wildcard. S3 is scoped to atx-* buckets.' },
    ], true);

    // ========================================
    // 2. Async Lambda Bridge
    // ========================================

    const asyncLambdaRole = new iam.Role(this, 'AsyncLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // AgentCore invoke permission
    asyncLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resources: [this.agentRuntime.agentRuntimeArn + '*'],
    }));

    // S3 for orchestrator results + custom definitions
    asyncLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
      resources: [
        `arn:aws:s3:::${props.outputBucketName}`,
        `arn:aws:s3:::${props.outputBucketName}/*`,
        `arn:aws:s3:::${props.sourceBucketName}`,
        `arn:aws:s3:::${props.sourceBucketName}/*`,
      ],
    }));

    // Batch describe for direct status/results
    asyncLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['batch:DescribeJobs'],
      resources: ['*'],
    }));

    // STS for account ID
    asyncLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:GetCallerIdentity'],
      resources: ['*'],
    }));

    // DynamoDB for job tracking
    asyncLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Scan'],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${props.jobsTableName}`],
    }));

    // X-Ray tracing
    asyncLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
      resources: ['*'],
    }));

    const asyncLambda = new lambda.Function(this, 'AsyncInvokeAgent', {
      functionName: 'atx-async-invoke-agent',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'async_invoke_agent.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../api/lambda')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      role: asyncLambdaRole,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        AGENT_RUNTIME_ARN: this.agentRuntime.agentRuntimeArn,
        RESULT_BUCKET: props.outputBucketName,
        JOBS_TABLE: props.jobsTableName,
      },
    });

    // Self-invoke permission (for async fire-and-forget)
    // Use wildcard to avoid circular dependency with HTTP API integration
    asyncLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:atx-async-invoke-agent`],
    }));

    NagSuppressions.addResourceSuppressions(asyncLambdaRole, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is standard for Lambda CloudWatch access.' },
      { id: 'AwsSolutions-IAM5', reason: 'Batch DescribeJobs requires wildcard. S3 scoped to atx-* buckets.' },
    ], true);

    NagSuppressions.addResourceSuppressions(asyncLambda, [
      { id: 'AwsSolutions-L1', reason: 'Python 3.11 is stable and supported until Oct 2027.' },
    ], true);

    // ========================================
    // 3. HTTP API Gateway
    // ========================================

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'atx-ui-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.POST],
        allowHeaders: ['content-type'],
        maxAge: cdk.Duration.days(1),
      },
    });

    httpApi.addRoutes({
      path: '/orchestrate',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('OrchestrateIntegration', asyncLambda),
    });

    new apigwv2.HttpStage(this, 'ProdStage', {
      httpApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    this.apiEndpoint = `${httpApi.apiEndpoint}/prod`;

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: this.agentRuntime.agentRuntimeArn,
      description: 'AgentCore Runtime ARN',
      exportName: 'AtxAgentRuntimeArn',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.apiEndpoint,
      description: 'HTTP API endpoint for UI',
      exportName: 'AtxAgentCoreApiEndpoint',
    });

    new cdk.CfnOutput(this, 'AsyncLambdaArn', {
      value: asyncLambda.functionArn,
      description: 'Async invoke Lambda ARN',
    });
  }
}
