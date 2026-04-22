import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Agentic Extras Stack
 *
 * Adds resources required by the agentic platform on top of the base
 * scaled-execution-containers infrastructure. Deploy this when using
 * the base CDK stacks instead of the agentic-specific infrastructure stack.
 *
 * Creates:
 *   - DynamoDB table (atx-transform-jobs) for async job tracking
 *   - Write access on the source bucket for the Batch job role
 *     (needed by the create-transform flow to upload cloned repos)
 */
export interface AgenticExtrasStackProps extends cdk.StackProps {
  /** Source bucket name. Defaults to Fn::ImportValue('AtxSourceBucketName'). */
  sourceBucketName?: string;
  /** Batch job role name. Defaults to 'ATXBatchJobRole'. */
  jobRoleName?: string;
}

export class AgenticExtrasStack extends cdk.Stack {
  public readonly jobsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: AgenticExtrasStackProps = {}) {
    super(scope, id, props);

    // ========================================
    // 1. DynamoDB table for job tracking
    // ========================================
    this.jobsTable = new dynamodb.Table(this, 'JobsTable', {
      tableName: 'atx-transform-jobs',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // ========================================
    // 2. Grant write access on source bucket
    // ========================================
    const sourceBucketName = props.sourceBucketName
      || cdk.Fn.importValue('AtxSourceBucketName');

    const sourceBucket = s3.Bucket.fromBucketName(
      this, 'SourceBucket', sourceBucketName,
    );

    const jobRole = iam.Role.fromRoleName(
      this, 'BatchJobRole', props.jobRoleName || 'ATXBatchJobRole',
    );

    // The base stack already grants read; add write for create-transform
    // flow (uploads cloned repos via `aws s3 sync`)
    sourceBucket.grantWrite(jobRole);

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'JobsTableName', {
      value: this.jobsTable.tableName,
      description: 'DynamoDB table for agentic job tracking',
      exportName: 'AtxJobsTableName',
    });
  }
}
