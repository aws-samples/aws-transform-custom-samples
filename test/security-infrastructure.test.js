"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const infrastructure_stack_1 = require("../lib/infrastructure-stack");
/**
 * Security tests for the ATX CDK infrastructure.
 * These validate that security-critical properties are set correctly
 * in the synthesized CloudFormation template — no deployment required.
 */
let template;
beforeAll(() => {
    const app = new cdk.App();
    const stack = new infrastructure_stack_1.InfrastructureStack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        imageUri: 'test-image:latest',
        fargateVcpu: 2,
        fargateMemory: 4096,
        jobTimeout: 43200,
        maxVcpus: 256,
        existingVpcId: 'vpc-12345',
        existingSubnetIds: ['subnet-aaa', 'subnet-bbb'],
        existingSecurityGroupId: 'sg-12345',
    });
    template = assertions_1.Template.fromStack(stack);
});
// ─── S3 Bucket Security ───────────────────────────────────────────────
describe('S3 bucket security', () => {
    test('output bucket blocks all public access', () => {
        template.hasResourceProperties('AWS::S3::Bucket', {
            BucketName: assertions_1.Match.stringLikeRegexp('atx-custom-output'),
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
            BucketName: assertions_1.Match.stringLikeRegexp('atx-source-code'),
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
            BucketName: assertions_1.Match.stringLikeRegexp('atx-custom-output'),
            BucketEncryption: {
                ServerSideEncryptionConfiguration: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
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
            BucketName: assertions_1.Match.stringLikeRegexp('atx-source-code'),
            BucketEncryption: {
                ServerSideEncryptionConfiguration: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
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
            BucketName: assertions_1.Match.stringLikeRegexp('atx-custom-output'),
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
            const statements = doc.Statement;
            const sslStatement = statements.find((s) => s.Effect === 'Deny' && JSON.stringify(s.Condition).includes('aws:SecureTransport'));
            expect(sslStatement).toBeDefined();
        }
    });
    test('buckets have lifecycle rules for data retention limits', () => {
        // Output bucket: 30 days
        template.hasResourceProperties('AWS::S3::Bucket', {
            BucketName: assertions_1.Match.stringLikeRegexp('atx-custom-output'),
            LifecycleConfiguration: {
                Rules: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({ ExpirationInDays: 30, Status: 'Enabled' }),
                ]),
            },
        });
        // Source bucket: 7 days
        template.hasResourceProperties('AWS::S3::Bucket', {
            BucketName: assertions_1.Match.stringLikeRegexp('atx-source-code'),
            LifecycleConfiguration: {
                Rules: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({ ExpirationInDays: 7, Status: 'Enabled' }),
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
                Statement: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Action: assertions_1.Match.arrayWith(['kms:Encrypt']),
                        Principal: {
                            Service: assertions_1.Match.stringLikeRegexp('logs\\..*\\.amazonaws\\.com'),
                        },
                        Condition: assertions_1.Match.objectLike({
                            ArnLike: assertions_1.Match.objectLike({
                                'kms:EncryptionContext:aws:logs:arn': assertions_1.Match.stringLikeRegexp('arn:aws:logs:.*:log-group:\\*'),
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
            KmsKeyId: assertions_1.Match.anyValue(),
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
            const statements = resource.Properties?.PolicyDocument?.Statement;
            if (!statements)
                continue;
            const hasSubmitJob = statements.some((s) => JSON.stringify(s.Action).includes('batch:SubmitJob'));
            if (hasSubmitJob) {
                const hasTerminate = statements.some((s) => JSON.stringify(s.Action).includes('batch:TerminateJob'));
                const hasDescribe = statements.some((s) => JSON.stringify(s.Action).includes('batch:DescribeJobs'));
                expect(hasTerminate).toBe(false);
                expect(hasDescribe).toBe(false);
            }
        }
    });
    test('status role cannot submit or terminate jobs', () => {
        const policies = template.findResources('AWS::IAM::Policy');
        for (const [, resource] of Object.entries(policies)) {
            const statements = resource.Properties?.PolicyDocument?.Statement;
            if (!statements)
                continue;
            const hasListJobs = statements.some((s) => JSON.stringify(s.Action).includes('batch:ListJobs'));
            const hasDescribe = statements.some((s) => JSON.stringify(s.Action).includes('batch:DescribeJobs'));
            // Only check policies that look like the status role (has ListJobs + DescribeJobs but not TerminateJob)
            if (hasListJobs && hasDescribe) {
                const hasSubmit = statements.some((s) => JSON.stringify(s.Action).includes('batch:SubmitJob'));
                expect(hasSubmit).toBe(false);
            }
        }
    });
    test('terminate role cannot submit jobs', () => {
        const policies = template.findResources('AWS::IAM::Policy');
        for (const [, resource] of Object.entries(policies)) {
            const statements = resource.Properties?.PolicyDocument?.Statement;
            if (!statements)
                continue;
            const hasTerminate = statements.some((s) => JSON.stringify(s.Action).includes('batch:TerminateJob'));
            if (hasTerminate) {
                const hasSubmit = statements.some((s) => JSON.stringify(s.Action).includes('batch:SubmitJob'));
                expect(hasSubmit).toBe(false);
            }
        }
    });
    test('configure role has no Batch permissions', () => {
        // The configure role should only have S3 + KMS, no Batch actions
        const roles = template.findResources('AWS::IAM::Role', {
            Properties: { RoleName: 'ATXLambdaConfigureRole' },
        });
        const configureRoleLogical = Object.keys(roles)[0];
        expect(configureRoleLogical).toBeDefined();
        const policies = template.findResources('AWS::IAM::Policy');
        for (const [, resource] of Object.entries(policies)) {
            const attachedRoles = resource.Properties?.Roles;
            if (!attachedRoles)
                continue;
            const isConfigurePolicy = JSON.stringify(attachedRoles).includes(configureRoleLogical);
            if (isConfigurePolicy) {
                const statements = resource.Properties?.PolicyDocument?.Statement;
                for (const stmt of statements) {
                    expect(JSON.stringify(stmt.Action)).not.toContain('batch:');
                }
            }
        }
    });
    test('batch job role Secrets Manager access is scoped to atx/* prefix', () => {
        const policies = template.findResources('AWS::IAM::Policy');
        for (const [, resource] of Object.entries(policies)) {
            const statements = resource.Properties?.PolicyDocument?.Statement;
            if (!statements)
                continue;
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
                AttemptDurationSeconds: assertions_1.Match.anyValue(),
            },
        });
    });
    test('container uses awslogs log driver', () => {
        template.hasResourceProperties('AWS::Batch::JobDefinition', {
            ContainerProperties: assertions_1.Match.objectLike({
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
            const policies = resource.Properties?.Policies;
            if (!policies)
                continue;
            for (const policy of policies) {
                const doc = policy.PolicyDocument;
                if (!doc?.Statement)
                    continue;
                for (const stmt of doc.Statement) {
                    if (stmt.Effect === 'Allow' && stmt.Action === '*' && stmt.Resource === '*') {
                        fail('Found an IAM role with Allow * on * — this is overly permissive');
                    }
                }
            }
        }
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJpdHktaW5mcmFzdHJ1Y3R1cmUudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNlY3VyaXR5LWluZnJhc3RydWN0dXJlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtQ0FBbUM7QUFDbkMsdURBQXlEO0FBQ3pELHNFQUFrRTtBQUVsRTs7OztHQUlHO0FBRUgsSUFBSSxRQUFrQixDQUFDO0FBRXZCLFNBQVMsQ0FBQyxHQUFHLEVBQUU7SUFDYixNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUMxQixNQUFNLEtBQUssR0FBRyxJQUFJLDBDQUFtQixDQUFDLEdBQUcsRUFBRSxXQUFXLEVBQUU7UUFDdEQsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFO1FBQ3JELFFBQVEsRUFBRSxtQkFBbUI7UUFDN0IsV0FBVyxFQUFFLENBQUM7UUFDZCxhQUFhLEVBQUUsSUFBSTtRQUNuQixVQUFVLEVBQUUsS0FBSztRQUNqQixRQUFRLEVBQUUsR0FBRztRQUNiLGFBQWEsRUFBRSxXQUFXO1FBQzFCLGlCQUFpQixFQUFFLENBQUMsWUFBWSxFQUFFLFlBQVksQ0FBQztRQUMvQyx1QkFBdUIsRUFBRSxVQUFVO0tBQ3BDLENBQUMsQ0FBQztJQUNILFFBQVEsR0FBRyxxQkFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUN2QyxDQUFDLENBQUMsQ0FBQztBQUVILHlFQUF5RTtBQUV6RSxRQUFRLENBQUMsb0JBQW9CLEVBQUUsR0FBRyxFQUFFO0lBQ2xDLElBQUksQ0FBQyx3Q0FBd0MsRUFBRSxHQUFHLEVBQUU7UUFDbEQsUUFBUSxDQUFDLHFCQUFxQixDQUFDLGlCQUFpQixFQUFFO1lBQ2hELFVBQVUsRUFBRSxrQkFBSyxDQUFDLGdCQUFnQixDQUFDLG1CQUFtQixDQUFDO1lBQ3ZELDhCQUE4QixFQUFFO2dCQUM5QixlQUFlLEVB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QUFJLENBQUMsTUFBTSxLQUFLLE9BQU8sSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxLQUFLLEdBQUcsRUFBRSxDQUFDO3dCQUM1RSxJQUFJLENBQUMsaUVBQWlFLENBQUMsQ0FBQztvQkFDMUUsQ0FBQztnQkFDSCxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgSW5mcmFzdHJ1Y3R1cmVTdGFjayB9IGZyb20gJy4uL2xpYi9pbmZyYXN0cnVjdHVyZS1zdGFjayc7XG5cbi8qKlxuICogU2VjdXJpdHkgdGVzdHMgZm9yIHRoZSBBVFggQ0RLIGluZnJhc3RydWN0dXJlLlxuICogVGhlc2UgdmFsaWRhdGUgdGhhdCBzZWN1cml0eS1jcml0aWNhbCBwcm9wZXJ0aWVzIGFyZSBzZXQgY29ycmVjdGx5XG4gKiBpbiB0aGUgc3ludGhlc2l6ZWQgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUg4oCUIG5vIGRlcGxveW1lbnQgcmVxdWlyZWQuXG4gKi9cblxubGV0IHRlbXBsYXRlOiBUZW1wbGF0ZTtcblxuYmVmb3JlQWxsKCgpID0+IHtcbiAgY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbiAgY29uc3Qgc3RhY2sgPSBuZXcgSW5mcmFzdHJ1Y3R1cmVTdGFjayhhcHAsICdUZXN0U3RhY2snLCB7XG4gICAgZW52OiB7IGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLCByZWdpb246ICd1cy1lYXN0LTEnIH0sXG4gICAgaW1hZ2VVcmk6ICd0ZXN0LWltYWdlOmxhdGVzdCcsXG4gICAgZmFyZ2F0ZVZjcHU6IDIsXG4gICAgZmFyZ2F0ZU1lbW9yeTogNDA5NixcbiAgICBqb2JUaW1lb3V0OiA0MzIwMCxcbiAgICBtYXhWY3B1czogMjU2LFxuICAgIGV4aXN0aW5nVnBjSWQ6ICd2cGMtMTIzNDUnLFxuICAgIGV4aXN0aW5nU3VibmV0SWRzOiBbJ3N1Ym5ldC1hYWEnLCAnc3VibmV0LWJiYiddLFxuICAgIGV4aXN0aW5nU2VjdXJpdHlHcm91cElkOiAnc2ctMTIzNDUnLFxuICB9KTtcbiAgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xufSk7XG5cbi8vIOKUgOKUgOKUgCBTMyBCdWNrZXQgU2VjdXJpdHkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmRlc2NyaWJlKCdTMyBidWNrZXQgc2VjdXJpdHknLCAoKSA9PiB7XG4gIHRlc3QoJ291dHB1dCBidWNrZXQgYmxvY2tzIGFsbCBwdWJsaWMgYWNjZXNzJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnYXR4LWN1c3RvbS1vdXRwdXQnKSxcbiAgICAgIFB1YmxpY0FjY2Vzc0Jsb2NrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBCbG9ja1B1YmxpY0FjbHM6IHRydWUsXG4gICAgICAgIEJsb2NrUHVibGljUG9saWN5OiB0cnVlLFxuICAgICAgICBJZ25vcmVQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBSZXN0cmljdFB1YmxpY0J1Y2tldHM6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdzb3VyY2UgYnVja2V0IGJsb2NrcyBhbGwgcHVibGljIGFjY2VzcycsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIEJ1Y2tldE5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2F0eC1zb3VyY2UtY29kZScpLFxuICAgICAgUHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIEJsb2NrUHVibGljQWNsczogdHJ1ZSxcbiAgICAgICAgQmxvY2tQdWJsaWNQb2xpY3k6IHRydWUsXG4gICAgICAgIElnbm9yZVB1YmxpY0FjbHM6IHRydWUsXG4gICAgICAgIFJlc3RyaWN0UHVibGljQnVja2V0czogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ291dHB1dCBidWNrZXQgdXNlcyBLTVMgZW5jcnlwdGlvbicsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIEJ1Y2tldE5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2F0eC1jdXN0b20tb3V0cHV0JyksXG4gICAgICBCdWNrZXRFbmNyeXB0aW9uOiB7XG4gICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbjogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XG4gICAgICAgICAgICAgIFNTRUFsZ29yaXRobTogJ2F3czprbXMnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdzb3VyY2UgYnVja2V0IHVzZXMgS01TIGVuY3J5cHRpb24nLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlMzOjpCdWNrZXQnLCB7XG4gICAgICBCdWNrZXROYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdhdHgtc291cmNlLWNvZGUnKSxcbiAgICAgIEJ1Y2tldEVuY3J5cHRpb246IHtcbiAgICAgICAgU2VydmVyU2lkZUVuY3J5cHRpb25Db25maWd1cmF0aW9uOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgU2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnYXdzOmttcycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgICBdKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ291dHB1dCBidWNrZXQgaGFzIHZlcnNpb25pbmcgZW5hYmxlZCcsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIEJ1Y2tldE5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2F0eC1jdXN0b20tb3V0cHV0JyksXG4gICAgICBWZXJzaW9uaW5nQ29uZmlndXJhdGlvbjogeyBTdGF0dXM6ICdFbmFibGVkJyB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdidWNrZXRzIGVuZm9yY2UgU1NMLW9ubHkgYWNjZXNzJywgKCkgPT4ge1xuICAgIC8vIEJvdGggYnVja2V0cyBzaG91bGQgaGF2ZSBhIGJ1Y2tldCBwb2xpY3kgcmVxdWlyaW5nIHNzbFxuICAgIGNvbnN0IHBvbGljaWVzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTMzo6QnVja2V0UG9saWN5Jyk7XG4gICAgY29uc3QgcG9saWN5TG9naWNhbHMgPSBPYmplY3Qua2V5cyhwb2xpY2llcyk7XG4gICAgZXhwZWN0KHBvbGljeUxvZ2ljYWxzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcblxuICAgIGZvciAoY29uc3QgbG9naWNhbElkIG9mIHBvbGljeUxvZ2ljYWxzKSB7XG4gICAgICBjb25zdCBkb2MgPSBwb2xpY2llc1tsb2dpY2FsSWRdLlByb3BlcnRpZXMuUG9saWN5RG9jdW1lbnQ7XG4gICAgICBjb25zdCBzdGF0ZW1lbnRzID0gZG9jLlN0YXRlbWVudCBhcyBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICBjb25zdCBzc2xTdGF0ZW1lbnQgPSBzdGF0ZW1lbnRzLmZpbmQoXG4gICAgICAgIChzKSA9PiBzLkVmZmVjdCA9PT0gJ0RlbnknICYmIEpTT04uc3RyaW5naWZ5KHMuQ29uZGl0aW9uKS5pbmNsdWRlcygnYXdzOlNlY3VyZVRyYW5zcG9ydCcpLFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChzc2xTdGF0ZW1lbnQpLnRvQmVEZWZpbmVkKCk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdidWNrZXRzIGhhdmUgbGlmZWN5Y2xlIHJ1bGVzIGZvciBkYXRhIHJldGVudGlvbiBsaW1pdHMnLCAoKSA9PiB7XG4gICAgLy8gT3V0cHV0IGJ1Y2tldDogMzAgZGF5c1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnYXR4LWN1c3RvbS1vdXRwdXQnKSxcbiAgICAgIExpZmVjeWNsZUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgUnVsZXM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7IEV4cGlyYXRpb25JbkRheXM6IDMwLCBTdGF0dXM6ICdFbmFibGVkJyB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIC8vIFNvdXJjZSBidWNrZXQ6IDcgZGF5c1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnYXR4LXNvdXJjZS1jb2RlJyksXG4gICAgICBMaWZlY3ljbGVDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIFJ1bGVzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2UoeyBFeHBpcmF0aW9uSW5EYXlzOiA3LCBTdGF0dXM6ICdFbmFibGVkJyB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcbn0pO1xuXG5cbi8vIOKUgOKUgOKUgCBLTVMgS2V5IFNlY3VyaXR5IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5kZXNjcmliZSgnS01TIGtleSBzZWN1cml0eScsICgpID0+IHtcbiAgdGVzdCgnZW5jcnlwdGlvbiBrZXkgaGFzIGF1dG9tYXRpYyByb3RhdGlvbiBlbmFibGVkJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpLTVM6OktleScsIHtcbiAgICAgIEVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdlbmNyeXB0aW9uIGtleSBpcyByZXRhaW5lZCBvbiBzdGFjayBkZWxldGlvbicsICgpID0+IHtcbiAgICBjb25zdCBrZXlzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpLTVM6OktleScpO1xuICAgIGZvciAoY29uc3QgbG9naWNhbElkIG9mIE9iamVjdC5rZXlzKGtleXMpKSB7XG4gICAgICBleHBlY3Qoa2V5c1tsb2dpY2FsSWRdLlVwZGF0ZVJlcGxhY2VQb2xpY3kpLnRvQmUoJ1JldGFpbicpO1xuICAgICAgZXhwZWN0KGtleXNbbG9naWNhbElkXS5EZWxldGlvblBvbGljeSkudG9CZSgnUmV0YWluJyk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdLTVMga2V5IHBvbGljeSByZXN0cmljdHMgQ2xvdWRXYXRjaCBMb2dzIGFjY2VzcyB3aXRoIGNvbmRpdGlvbicsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6S01TOjpLZXknLCB7XG4gICAgICBLZXlQb2xpY3k6IHtcbiAgICAgICAgU3RhdGVtZW50OiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgQWN0aW9uOiBNYXRjaC5hcnJheVdpdGgoWydrbXM6RW5jcnlwdCddKSxcbiAgICAgICAgICAgIFByaW5jaXBhbDoge1xuICAgICAgICAgICAgICBTZXJ2aWNlOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdsb2dzXFxcXC4uKlxcXFwuYW1hem9uYXdzXFxcXC5jb20nKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBDb25kaXRpb246IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgICBBcm5MaWtlOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgICAna21zOkVuY3J5cHRpb25Db250ZXh0OmF3czpsb2dzOmFybic6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2Fybjphd3M6bG9nczouKjpsb2ctZ3JvdXA6XFxcXConKSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcbn0pO1xuXG4vLyDilIDilIDilIAgQ2xvdWRXYXRjaCBMb2dzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5kZXNjcmliZSgnQ2xvdWRXYXRjaCBMb2dzIHNlY3VyaXR5JywgKCkgPT4ge1xuICB0ZXN0KCdsb2cgZ3JvdXAgaXMgZW5jcnlwdGVkIHdpdGggS01TJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMb2dzOjpMb2dHcm91cCcsIHtcbiAgICAgIExvZ0dyb3VwTmFtZTogJy9hd3MvYmF0Y2gvYXR4LXRyYW5zZm9ybScsXG4gICAgICBLbXNLZXlJZDogTWF0Y2guYW55VmFsdWUoKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnbG9nIGdyb3VwIGhhcyByZXRlbnRpb24gcG9saWN5IHNldCcsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TG9nczo6TG9nR3JvdXAnLCB7XG4gICAgICBMb2dHcm91cE5hbWU6ICcvYXdzL2JhdGNoL2F0eC10cmFuc2Zvcm0nLFxuICAgICAgUmV0ZW50aW9uSW5EYXlzOiAzMCxcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuLy8g4pSA4pSA4pSAIElBTSBSb2xlIFNlcGFyYXRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmRlc2NyaWJlKCdJQU0gcm9sZSBzZXBhcmF0aW9uIChsZWFzdCBwcml2aWxlZ2UpJywgKCkgPT4ge1xuICB0ZXN0KCdzdWJtaXQgcm9sZSBjYW5ub3QgdGVybWluYXRlIG9yIGRlc2NyaWJlIGpvYnMnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9sZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OklBTTo6UG9saWN5Jyk7XG4gICAgZm9yIChjb25zdCBbbG9naWNhbElkLCByZXNvdXJjZV0gb2YgT2JqZWN0LmVudHJpZXMocm9sZXMpKSB7XG4gICAgICBjb25zdCBzdGF0ZW1lbnRzID0gcmVzb3VyY2UuUHJvcGVydGllcz8uUG9saWN5RG9jdW1lbnQ/LlN0YXRlbWVudCBhcyBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4gfCB1bmRlZmluZWQ7XG4gICAgICBpZiAoIXN0YXRlbWVudHMpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBoYXNTdWJtaXRKb2IgPSBzdGF0ZW1lbnRzLnNvbWUoXG4gICAgICAgIChzKSA9PiBKU09OLnN0cmluZ2lmeShzLkFjdGlvbikuaW5jbHVkZXMoJ2JhdGNoOlN1Ym1pdEpvYicpLFxuICAgICAgKTtcbiAgICAgIGlmIChoYXNTdWJtaXRKb2IpIHtcbiAgICAgICAgY29uc3QgaGFzVGVybWluYXRlID0gc3RhdGVtZW50cy5zb21lKFxuICAgICAgICAgIChzKSA9PiBKU09OLnN0cmluZ2lmeShzLkFjdGlvbikuaW5jbHVkZXMoJ2JhdGNoOlRlcm1pbmF0ZUpvYicpLFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBoYXNEZXNjcmliZSA9IHN0YXRlbWVudHMuc29tZShcbiAgICAgICAgICAocykgPT4gSlNPTi5zdHJpbmdpZnkocy5BY3Rpb24pLmluY2x1ZGVzKCdiYXRjaDpEZXNjcmliZUpvYnMnKSxcbiAgICAgICAgKTtcbiAgICAgICAgZXhwZWN0KGhhc1Rlcm1pbmF0ZSkudG9CZShmYWxzZSk7XG4gICAgICAgIGV4cGVjdChoYXNEZXNjcmliZSkudG9CZShmYWxzZSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdzdGF0dXMgcm9sZSBjYW5ub3Qgc3VibWl0IG9yIHRlcm1pbmF0ZSBqb2JzJywgKCkgPT4ge1xuICAgIGNvbnN0IHBvbGljaWVzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpJQU06OlBvbGljeScpO1xuICAgIGZvciAoY29uc3QgWywgcmVzb3VyY2VdIG9mIE9iamVjdC5lbnRyaWVzKHBvbGljaWVzKSkge1xuICAgICAgY29uc3Qgc3RhdGVtZW50cyA9IHJlc291cmNlLlByb3BlcnRpZXM/LlBvbGljeURvY3VtZW50Py5TdGF0ZW1lbnQgYXMgQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKCFzdGF0ZW1lbnRzKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgaGFzTGlzdEpvYnMgPSBzdGF0ZW1lbnRzLnNvbWUoXG4gICAgICAgIChzKSA9PiBKU09OLnN0cmluZ2lmeShzLkFjdGlvbikuaW5jbHVkZXMoJ2JhdGNoOkxpc3RKb2JzJyksXG4gICAgICApO1xuICAgICAgY29uc3QgaGFzRGVzY3JpYmUgPSBzdGF0ZW1lbnRzLnNvbWUoXG4gICAgICAgIChzKSA9PiBKU09OLnN0cmluZ2lmeShzLkFjdGlvbikuaW5jbHVkZXMoJ2JhdGNoOkRlc2NyaWJlSm9icycpLFxuICAgICAgKTtcbiAgICAgIC8vIE9ubHkgY2hlY2sgcG9saWNpZXMgdGhhdCBsb29rIGxpa2UgdGhlIHN0YXR1cyByb2xlIChoYXMgTGlzdEpvYnMgKyBEZXNjcmliZUpvYnMgYnV0IG5vdCBUZXJtaW5hdGVKb2IpXG4gICAgICBpZiAoaGFzTGlzdEpvYnMgJiYgaGFzRGVzY3JpYmUpIHtcbiAgICAgICAgY29uc3QgaGFzU3VibWl0ID0gc3RhdGVtZW50cy5zb21lKFxuICAgICAgICAgIChzKSA9PiBKU09OLnN0cmluZ2lmeShzLkFjdGlvbikuaW5jbHVkZXMoJ2JhdGNoOlN1Ym1pdEpvYicpLFxuICAgICAgICApO1xuICAgICAgICBleHBlY3QoaGFzU3VibWl0KS50b0JlKGZhbHNlKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIHRlc3QoJ3Rlcm1pbmF0ZSByb2xlIGNhbm5vdCBzdWJtaXQgam9icycsICgpID0+IHtcbiAgICBjb25zdCBwb2xpY2llcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6SUFNOjpQb2xpY3knKTtcbiAgICBmb3IgKGNvbnN0IFssIHJlc291cmNlXSBvZiBPYmplY3QuZW50cmllcyhwb2xpY2llcykpIHtcbiAgICAgIGNvbnN0IHN0YXRlbWVudHMgPSByZXNvdXJjZS5Qcm9wZXJ0aWVzPy5Qb2xpY3lEb2N1bWVudD8uU3RhdGVtZW50IGFzIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICghc3RhdGVtZW50cykgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGhhc1Rlcm1pbmF0ZSA9IHN0YXRlbWVudHMuc29tZShcbiAgICAgICAgKHMpID0+IEpTT04uc3RyaW5naWZ5KHMuQWN0aW9uKS5pbmNsdWRlcygnYmF0Y2g6VGVybWluYXRlSm9iJyksXG4gICAgICApO1xuICAgICAgaWYgKGhhc1Rlcm1pbmF0ZSkge1xuICAgICAgICBjb25zdCBoYXNTdWJtaXQgPSBzdGF0ZW1lbnRzLnNvbWUoXG4gICAgICAgICAgKHMpID0+IEpTT04uc3RyaW5naWZ5KHMuQWN0aW9uKS5pbmNsdWRlcygnYmF0Y2g6U3VibWl0Sm9iJyksXG4gICAgICAgICk7XG4gICAgICAgIGV4cGVjdChoYXNTdWJtaXQpLnRvQmUoZmFsc2UpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgdGVzdCgnY29uZmlndXJlIHJvbGUgaGFzIG5vIEJhdGNoIHBlcm1pc3Npb25zJywgKCkgPT4ge1xuICAgIC8vIFRoZSBjb25maWd1cmUgcm9sZSBzaG91bGQgb25seSBoYXZlIFMzICsgS01TLCBubyBCYXRjaCBhY3Rpb25zXG4gICAgY29uc3Qgcm9sZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OklBTTo6Um9sZScsIHtcbiAgICAgIFByb3BlcnRpZXM6IHsgUm9sZU5hbWU6ICdBVFhMYW1iZGFDb25maWd1cmVSb2xlJyB9LFxuICAgIH0pO1xuICAgIGNvbnN0IGNvbmZpZ3VyZVJvbGVMb2dpY2FsID0gT2JqZWN0LmtleXMocm9sZXMpWzBdO1xuICAgIGV4cGVjdChjb25maWd1cmVSb2xlTG9naWNhbCkudG9CZURlZmluZWQoKTtcblxuICAgIGNvbnN0IHBvbGljaWVzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpJQU06OlBvbGljeScpO1xuICAgIGZvciAoY29uc3QgWywgcmVzb3VyY2VdIG9mIE9iamVjdC5lbnRyaWVzKHBvbGljaWVzKSkge1xuICAgICAgY29uc3QgYXR0YWNoZWRSb2xlcyA9IHJlc291cmNlLlByb3BlcnRpZXM/LlJvbGVzIGFzIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICghYXR0YWNoZWRSb2xlcykgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGlzQ29uZmlndXJlUG9saWN5ID0gSlNPTi5zdHJpbmdpZnkoYXR0YWNoZWRSb2xlcykuaW5jbHVkZXMoY29uZmlndXJlUm9sZUxvZ2ljYWwpO1xuICAgICAgaWYgKGlzQ29uZmlndXJlUG9saWN5KSB7XG4gICAgICAgIGNvbnN0IHN0YXRlbWVudHMgPSByZXNvdXJjZS5Qcm9wZXJ0aWVzPy5Qb2xpY3lEb2N1bWVudD8uU3RhdGVtZW50IGFzIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgICAgZm9yIChjb25zdCBzdG10IG9mIHN0YXRlbWVudHMpIHtcbiAgICAgICAgICBleHBlY3QoSlNPTi5zdHJpbmdpZnkoc3RtdC5BY3Rpb24pKS5ub3QudG9Db250YWluKCdiYXRjaDonKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgdGVzdCgnYmF0Y2ggam9iIHJvbGUgU2VjcmV0cyBNYW5hZ2VyIGFjY2VzcyBpcyBzY29wZWQgdG8gYXR4LyogcHJlZml4JywgKCkgPT4ge1xuICAgIGNvbnN0IHBvbGljaWVzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpJQU06OlBvbGljeScpO1xuICAgIGZvciAoY29uc3QgWywgcmVzb3VyY2VdIG9mIE9iamVjdC5lbnRyaWVzKHBvbGljaWVzKSkge1xuICAgICAgY29uc3Qgc3RhdGVtZW50cyA9IHJlc291cmNlLlByb3BlcnRpZXM/LlBvbGljeURvY3VtZW50Py5TdGF0ZW1lbnQgYXMgQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKCFzdGF0ZW1lbnRzKSBjb250aW51ZTtcblxuICAgICAgZm9yIChjb25zdCBzdG10IG9mIHN0YXRlbWVudHMpIHtcbiAgICAgICAgaWYgKEpTT04uc3RyaW5naWZ5KHN0bXQuQWN0aW9uKS5pbmNsdWRlcygnc2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWUnKSkge1xuICAgICAgICAgIGNvbnN0IHJlc291cmNlQXJuID0gSlNPTi5zdHJpbmdpZnkoc3RtdC5SZXNvdXJjZSk7XG4gICAgICAgICAgZXhwZWN0KHJlc291cmNlQXJuKS50b0NvbnRhaW4oJ3NlY3JldDphdHgvJyk7XG4gICAgICAgICAgLy8gRW5zdXJlIGl0J3Mgbm90IGEgYmxhbmtldCB3aWxkY2FyZFxuICAgICAgICAgIGV4cGVjdChyZXNvdXJjZUFybikubm90LnRvQmUoJ1wiKlwiJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufSk7XG5cbi8vIOKUgOKUgOKUgCBCYXRjaCBKb2IgRGVmaW5pdGlvbiBTZWN1cml0eSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZGVzY3JpYmUoJ0JhdGNoIGpvYiBkZWZpbml0aW9uIHNlY3VyaXR5JywgKCkgPT4ge1xuICB0ZXN0KCd1c2VzIEZhcmdhdGUgcGxhdGZvcm0gKG5vdCBFQzIpJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpCYXRjaDo6Sm9iRGVmaW5pdGlvbicsIHtcbiAgICAgIFBsYXRmb3JtQ2FwYWJpbGl0aWVzOiBbJ0ZBUkdBVEUnXSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnaGFzIGEgdGltZW91dCBjb25maWd1cmVkJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpCYXRjaDo6Sm9iRGVmaW5pdGlvbicsIHtcbiAgICAgIFRpbWVvdXQ6IHtcbiAgICAgICAgQXR0ZW1wdER1cmF0aW9uU2Vjb25kczogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2NvbnRhaW5lciB1c2VzIGF3c2xvZ3MgbG9nIGRyaXZlcicsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QmF0Y2g6OkpvYkRlZmluaXRpb24nLCB7XG4gICAgICBDb250YWluZXJQcm9wZXJ0aWVzOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgTG9nQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIExvZ0RyaXZlcjogJ2F3c2xvZ3MnLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbi8vIOKUgOKUgOKUgCBMYW1iZGEgRnVuY3Rpb24gU2VjdXJpdHkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmRlc2NyaWJlKCdMYW1iZGEgZnVuY3Rpb24gc2VjdXJpdHknLCAoKSA9PiB7XG4gIHRlc3QoJ2FsbCBMYW1iZGEgZnVuY3Rpb25zIHVzZSBOb2RlLmpzIDI0LnggcnVudGltZScsICgpID0+IHtcbiAgICBjb25zdCBmdW5jdGlvbnMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nKTtcbiAgICBmb3IgKGNvbnN0IFtsb2dpY2FsSWQsIHJlc291cmNlXSBvZiBPYmplY3QuZW50cmllcyhmdW5jdGlvbnMpKSB7XG4gICAgICBleHBlY3QocmVzb3VyY2UuUHJvcGVydGllcy5SdW50aW1lKS50b0JlKCdub2RlanMyNC54Jyk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdhbGwgTGFtYmRhIGZ1bmN0aW9ucyBoYXZlIGEgdGltZW91dCBjb25maWd1cmVkJywgKCkgPT4ge1xuICAgIGNvbnN0IGZ1bmN0aW9ucyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicpO1xuICAgIGZvciAoY29uc3QgW2xvZ2ljYWxJZCwgcmVzb3VyY2VdIG9mIE9iamVjdC5lbnRyaWVzKGZ1bmN0aW9ucykpIHtcbiAgICAgIGV4cGVjdChyZXNvdXJjZS5Qcm9wZXJ0aWVzLlRpbWVvdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QocmVzb3VyY2UuUHJvcGVydGllcy5UaW1lb3V0KS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICAvLyBObyBMYW1iZGEgc2hvdWxkIGhhdmUgdGhlIG1heCAxNS1taW4gdGltZW91dCBleGNlcHQgYmF0Y2ggdHJpZ2dlclxuICAgICAgaWYgKCFsb2dpY2FsSWQuaW5jbHVkZXMoJ1RyaWdnZXJCYXRjaEpvYnMnKSkge1xuICAgICAgICBleHBlY3QocmVzb3VyY2UuUHJvcGVydGllcy5UaW1lb3V0KS50b0JlTGVzc1RoYW5PckVxdWFsKDMwKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIHRlc3QoJ25vIExhbWJkYSBmdW5jdGlvbiBoYXMgYW4gb3BlbiBJQU0gcm9sZSAoaW5saW5lIHdpbGRjYXJkIGFsbG93LWFsbCknLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9sZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OklBTTo6Um9sZScpO1xuICAgIGZvciAoY29uc3QgWywgcmVzb3VyY2VdIG9mIE9iamVjdC5lbnRyaWVzKHJvbGVzKSkge1xuICAgICAgY29uc3QgcG9saWNpZXMgPSByZXNvdXJjZS5Qcm9wZXJ0aWVzPy5Qb2xpY2llcyBhcyBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4gfCB1bmRlZmluZWQ7XG4gICAgICBpZiAoIXBvbGljaWVzKSBjb250aW51ZTtcbiAgICAgIGZvciAoY29uc3QgcG9saWN5IG9mIHBvbGljaWVzKSB7XG4gICAgICAgIGNvbnN0IGRvYyA9IChwb2xpY3kgYXMgYW55KS5Qb2xpY3lEb2N1bWVudDtcbiAgICAgICAgaWYgKCFkb2M/LlN0YXRlbWVudCkgY29udGludWU7XG4gICAgICAgIGZvciAoY29uc3Qgc3RtdCBvZiBkb2MuU3RhdGVtZW50KSB7XG4gICAgICAgICAgaWYgKHN0bXQuRWZmZWN0ID09PSAnQWxsb3cnICYmIHN0bXQuQWN0aW9uID09PSAnKicgJiYgc3RtdC5SZXNvdXJjZSA9PT0gJyonKSB7XG4gICAgICAgICAgICBmYWlsKCdGb3VuZCBhbiBJQU0gcm9sZSB3aXRoIEFsbG93ICogb24gKiDigJQgdGhpcyBpcyBvdmVybHkgcGVybWlzc2l2ZScpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfSk7XG59KTtcbiJdfQ==