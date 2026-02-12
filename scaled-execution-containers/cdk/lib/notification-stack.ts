import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';

export interface NotificationStackProps extends cdk.StackProps {
  jobQueueArn: string;
}

export class NotificationStack extends cdk.Stack {
  public readonly notificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationStackProps) {
    super(scope, id, props);

    // SNS Topic
    this.notificationTopic = new sns.Topic(this, 'JobNotificationTopic', {
      topicName: 'atx-job-notifications',
      displayName: 'AWS Transform Job Notifications',
    });

    // Lambda function to format notifications with proper line breaks
    const formatFunction = new lambda.Function(this, 'FormatNotificationFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'format-notification.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      environment: {
        TOPIC_ARN: this.notificationTopic.topicArn,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // Suppress cdk-nag findings for Lambda
    NagSuppressions.addResourceSuppressions(
      formatFunction,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Lambda uses AWS managed policy for basic execution role.',
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'Python 3.11 is the latest stable runtime.',
        },
      ],
      true
    );

    // Grant Lambda permission to publish to SNS
    this.notificationTopic.grantPublish(formatFunction);

    // EventBridge rules to trigger Lambda
    const successRule = new events.Rule(this, 'BatchJobSuccessRule', {
      ruleName: 'atx-batch-job-success',
      description: 'Notify when AWS Batch jobs succeed',
      eventPattern: {
        source: ['aws.batch'],
        detailType: ['Batch Job State Change'],
        detail: {
          status: ['SUCCEEDED'],
          jobQueue: [props.jobQueueArn],
        },
      },
    });

    const failureRule = new events.Rule(this, 'BatchJobFailureRule', {
      ruleName: 'atx-batch-job-failure',
      description: 'Notify when AWS Batch jobs fail',
      eventPattern: {
        source: ['aws.batch'],
        detailType: ['Batch Job State Change'],
        detail: {
          status: ['FAILED'],
          jobQueue: [props.jobQueueArn],
        },
      },
    });

    // Add Lambda as target for both rules
    successRule.addTarget(new targets.LambdaFunction(formatFunction));
    failureRule.addTarget(new targets.LambdaFunction(formatFunction));

    // Suppress cdk-nag findings
    NagSuppressions.addResourceSuppressions(
      this.notificationTopic,
      [
        {
          id: 'AwsSolutions-SNS2',
          reason: 'SNS topic encryption is optional for non-sensitive job status notifications.',
        },
        {
          id: 'AwsSolutions-SNS3',
          reason: 'DLQ is optional for notifications.',
        },
      ],
      true
    );

    // Outputs
    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: this.notificationTopic.topicArn,
      description: 'SNS topic ARN for job notifications',
      exportName: 'AtxNotificationTopicArn',
    });

    new cdk.CfnOutput(this, 'SubscribeCommand', {
      value: `aws sns subscribe --topic-arn ${this.notificationTopic.topicArn} --protocol email --notification-endpoint your-email@example.com`,
      description: 'Command to subscribe to notifications',
    });
  }
}
