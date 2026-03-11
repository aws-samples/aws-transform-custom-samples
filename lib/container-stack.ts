import * as cdk from 'aws-cdk-lib';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import * as path from 'path';

export class ContainerStack extends cdk.Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Build and push Docker image from Dockerfile
    // CDK manages the ECR repository automatically via DockerImageAsset
    const dockerImage = new ecrAssets.DockerImageAsset(this, 'DockerImage', {
      directory: path.join(__dirname, '../container'),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    this.imageUri = dockerImage.imageUri;

    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      description: 'Container image URI',
      exportName: 'AtxContainerImageUri',
    });
  }
}
