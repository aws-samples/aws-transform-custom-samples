import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';

export interface UiStackProps extends cdk.StackProps {
  apiEndpoint?: string;
}

export class UiStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly websiteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: UiStackProps) {
    super(scope, id, props);

    // S3 bucket for static website hosting
    this.websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `atx-transform-ui-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
    });

    // CloudFront Origin Access Identity
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'ATX Transform UI OAI',
    });

    this.websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [this.websiteBucket.arnForObjects('*')],
      principals: [oai.grantPrincipal],
    }));

    // CloudFront access logs bucket
    const logBucket = new s3.Bucket(this, 'CloudFrontLogBucket', {
      bucketName: `atx-transform-ui-logs-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'ATX Transform UI',
      defaultBehavior: {
        origin: new origins.S3Origin(this.websiteBucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      enableLogging: true,
      logBucket: logBucket,
      logFilePrefix: 'cloudfront/',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Deploy built UI assets to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../ui/dist'))],
      destinationBucket: this.websiteBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressions(this.websiteBucket, [
      { id: 'AwsSolutions-S1', reason: 'Website bucket access is logged via CloudFront access logs, not S3 access logs.' },
    ], true);

    NagSuppressions.addResourceSuppressions(logBucket, [
      { id: 'AwsSolutions-S1', reason: 'This IS the log bucket. Enabling access logs on it would create an infinite loop.' },
    ], true);

    NagSuppressions.addResourceSuppressions(this.distribution, [
      { id: 'AwsSolutions-CFR1', reason: 'Geo restrictions not required for internal tool.' },
      { id: 'AwsSolutions-CFR2', reason: 'WAF not required for static website serving internal tool.' },
      { id: 'AwsSolutions-CFR4', reason: 'Using TLS 1.2 minimum protocol version which is secure.' },
      { id: 'AwsSolutions-CFR7', reason: 'Using OAI for S3 origin access. OAC migration planned for future release.' },
    ], true);

    // Suppress cdk-nag for CDK-managed BucketDeployment construct (not our code)
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', reason: 'BucketDeployment Lambda uses AWSLambdaBasicExecutionRole (CDK-managed construct).' },
      { id: 'AwsSolutions-IAM5', reason: 'BucketDeployment Lambda requires S3 wildcard permissions for sync (CDK-managed construct).' },
      { id: 'AwsSolutions-L1', reason: 'BucketDeployment Lambda runtime is managed by CDK, not user-configurable.' },
    ]);

    // Outputs
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
      exportName: 'AtxUiDomain',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: this.websiteBucket.bucketName,
      description: 'S3 bucket for UI assets',
    });

    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Website URL',
      exportName: 'AtxUiUrl',
    });
  }
}
