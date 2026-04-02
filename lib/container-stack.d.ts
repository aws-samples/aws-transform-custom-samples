import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export declare class ContainerStack extends cdk.Stack {
    readonly imageUri: string;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
