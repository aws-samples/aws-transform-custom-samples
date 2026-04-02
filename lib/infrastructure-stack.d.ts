import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
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
export declare class InfrastructureStack extends cdk.Stack {
    readonly outputBucket: s3.IBucket;
    readonly sourceBucket: s3.IBucket;
    readonly encryptionKey: kms.IKey;
    readonly jobQueue: batch.CfnJobQueue;
    readonly jobDefinition: batch.CfnJobDefinition;
    readonly logGroup: logs.LogGroup;
    constructor(scope: Construct, id: string, props: InfrastructureStackProps);
}
