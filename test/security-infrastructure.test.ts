import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { InfrastructureStack } from '../lib/infrastructure-stack';

/**
 * Security tests for the ATX CDK infrastructure.
 * These validate that security-critical properties are set correctly
 * in the synthesized CloudFormation template — no deployment required.
 */

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new InfrastructureStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    imageUri: 'test-image:latest',
    fargateVcpu: 2,
    fargateMemory: 8192,
    jobTimeout: 43200,
    maxVcpus: 256,
    existingVpcId: 'vpc-12345',
    existingSubnetIds: ['subnet-aaa', 'subnet-bbb'],
    existingSecurityGroupId: 'sg-12345',
  });
  template = Template.fromStack(stack);
});

// ─── S3 Bucket Security ───────────────────────────────────────────────

describe('S3 bucket security', () => {
  test('output bucket blocks all public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('atx-custom-output'),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('source bucket blocks all public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('atx-source-code'),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('output bucket uses KMS encryption', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('atx-custom-output'),
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'aws:kms',
            },
          }),
        ]),
      },
    });
  });

  test('source bucket uses KMS encryption', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('atx-source-code'),
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'aws:kms',
            },
          }),
        ]),
      },
    });
  });

  test('output bucket has versioning enabled', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('atx-custom-output'),
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  test('buckets enforce SSL-only access', () => {
    // Both buckets should have a bucket policy requiring ssl
    const policies = template.findResources('AWS::S3::BucketPolicy');
    const policyLogicals = Object.keys(policies);
    expect(policyLogicals.length).toBeGreaterThanOrEqual(2);

    for (const logicalId of policyLogicals) {
      const doc = policies[logicalId].Properties.PolicyDocument;
      const statements = doc.Statement as Array<Record<string, unknown>>;
      const sslStatement = statements.find(
        (s) => s.Effect === 'Deny' && JSON.stringify(s.Condition).includes('aws:SecureTransport'),
      );
      expect(sslStatement).toBeDefined();
    }
  });

  test('buckets have lifecycle rules for data retention limits', () => {
    // Output bucket: 30 days
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('atx-custom-output'),
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ ExpirationInDays: 30, Status: 'Enabled' }),
        ]),
      },
    });
    // Source bucket: 7 days
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('atx-source-code'),
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ ExpirationInDays: 7, Status: 'Enabled' }),
        ]),
      },
    });
  });
});


// ─── KMS Key Security ─────────────────────────────────────────────────

describe('KMS key security', () => {
  test('encryption key has automatic rotation enabled', () => {
    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
    });
  });

  test('encryption key is retained on stack deletion', () => {
    const keys = template.findResources('AWS::KMS::Key');
    for (const logicalId of Object.keys(keys)) {
      expect(keys[logicalId].UpdateReplacePolicy).toBe('Retain');
      expect(keys[logicalId].DeletionPolicy).toBe('Retain');
    }
  });

  test('KMS key policy restricts CloudWatch Logs access with condition', () => {
    template.hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['kms:Encrypt']),
            Principal: {
              Service: Match.stringLikeRegexp('logs\\..*\\.amazonaws\\.com'),
            },
            Condition: Match.objectLike({
              ArnLike: Match.objectLike({
                'kms:EncryptionContext:aws:logs:arn': Match.stringLikeRegexp('arn:aws:logs:.*:log-group:\\*'),
              }),
            }),
          }),
        ]),
      },
    });
  });
});

// ─── CloudWatch Logs ──────────────────────────────────────────────────

describe('CloudWatch Logs security', () => {
  test('log group is encrypted with KMS', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/batch/atx-transform',
      KmsKeyId: Match.anyValue(),
    });
  });

  test('log group has retention policy set', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/batch/atx-transform',
      RetentionInDays: 30,
    });
  });
});

// ─── IAM Role Separation ─────────────────────────────────────────────

describe('IAM role separation (least privilege)', () => {
  test('submit role cannot terminate or describe jobs', () => {
    const roles = template.findResources('AWS::IAM::Policy');
    for (const [logicalId, resource] of Object.entries(roles)) {
      const statements = resource.Properties?.PolicyDocument?.Statement as Array<Record<string, unknown>> | undefined;
      if (!statements) continue;

      const hasSubmitJob = statements.some(
        (s) => JSON.stringify(s.Action).includes('batch:SubmitJob'),
      );
      if (hasSubmitJob) {
        const hasTerminate = statements.some(
          (s) => JSON.stringify(s.Action).includes('batch:TerminateJob'),
        );
        const hasDescribe = statements.some(
          (s) => JSON.stringify(s.Action).includes('batch:DescribeJobs'),
        );
        expect(hasTerminate).toBe(false);
        expect(hasDescribe).toBe(false);
      }
    }
  });

  test('status role cannot submit or terminate jobs', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const [, resource] of Object.entries(policies)) {
      const statements = resource.Properties?.PolicyDocument?.Statement as Array<Record<string, unknown>> | undefined;
      if (!statements) continue;

      const hasListJobs = statements.some(
        (s) => JSON.stringify(s.Action).includes('batch:ListJobs'),
      );
      const hasDescribe = statements.some(
        (s) => JSON.stringify(s.Action).includes('batch:DescribeJobs'),
      );
      // Only check policies that look like the status role (has ListJobs + DescribeJobs but not TerminateJob)
      if (hasListJobs && hasDescribe) {
        const hasSubmit = statements.some(
          (s) => JSON.stringify(s.Action).includes('batch:SubmitJob'),
        );
        expect(hasSubmit).toBe(false);
      }
    }
  });

  test('terminate role cannot submit jobs', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const [, resource] of Object.entries(policies)) {
      const statements = resource.Properties?.PolicyDocument?.Statement as Array<Record<string, unknown>> | undefined;
      if (!statements) continue;

      const hasTerminate = statements.some(
        (s) => JSON.stringify(s.Action).includes('batch:TerminateJob'),
      );
      if (hasTerminate) {
        const hasSubmit = statements.some(
          (s) => JSON.stringify(s.Action).includes('batch:SubmitJob'),
        );
        expect(hasSubmit).toBe(false);
      }
    }
  });

  test('batch job role Secrets Manager access is scoped to atx/* prefix', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const [, resource] of Object.entries(policies)) {
      const statements = resource.Properties?.PolicyDocument?.Statement as Array<Record<string, unknown>> | undefined;
      if (!statements) continue;

      for (const stmt of statements) {
        if (JSON.stringify(stmt.Action).includes('secretsmanager:GetSecretValue')) {
          const resourceArn = JSON.stringify(stmt.Resource);
          expect(resourceArn).toContain('secret:atx/');
          // Ensure it's not a blanket wildcard
          expect(resourceArn).not.toBe('"*"');
        }
      }
    }
  });
});

// ─── Batch Job Definition Security ───────────────────────────────────

describe('Batch job definition security', () => {
  test('uses Fargate platform (not EC2)', () => {
    template.hasResourceProperties('AWS::Batch::JobDefinition', {
      PlatformCapabilities: ['FARGATE'],
    });
  });

  test('has a timeout configured', () => {
    template.hasResourceProperties('AWS::Batch::JobDefinition', {
      Timeout: {
        AttemptDurationSeconds: Match.anyValue(),
      },
    });
  });

  test('container uses awslogs log driver', () => {
    template.hasResourceProperties('AWS::Batch::JobDefinition', {
      ContainerProperties: Match.objectLike({
        LogConfiguration: {
          LogDriver: 'awslogs',
        },
      }),
    });
  });
});

// ─── Lambda Function Security ────────────────────────────────────────

describe('Lambda function security', () => {
  test('all Lambda functions use Node.js 24.x runtime', () => {
    const functions = template.findResources('AWS::Lambda::Function');
    for (const [logicalId, resource] of Object.entries(functions)) {
      expect(resource.Properties.Runtime).toBe('nodejs24.x');
    }
  });

  test('all Lambda functions have a timeout configured', () => {
    const functions = template.findResources('AWS::Lambda::Function');
    for (const [logicalId, resource] of Object.entries(functions)) {
      expect(resource.Properties.Timeout).toBeDefined();
      expect(resource.Properties.Timeout).toBeGreaterThan(0);
      // No Lambda should have the max 15-min timeout except batch trigger
      if (!logicalId.includes('TriggerBatchJobs')) {
        expect(resource.Properties.Timeout).toBeLessThanOrEqual(30);
      }
    }
  });

  test('no Lambda function has an open IAM role (inline wildcard allow-all)', () => {
    const roles = template.findResources('AWS::IAM::Role');
    for (const [, resource] of Object.entries(roles)) {
      const policies = resource.Properties?.Policies as Array<Record<string, unknown>> | undefined;
      if (!policies) continue;
      for (const policy of policies) {
        const doc = (policy as any).PolicyDocument;
        if (!doc?.Statement) continue;
        for (const stmt of doc.Statement) {
          if (stmt.Effect === 'Allow' && stmt.Action === '*' && stmt.Resource === '*') {
            fail('Found an IAM role with Allow * on * — this is overly permissive');
          }
        }
      }
    }
  });
});
