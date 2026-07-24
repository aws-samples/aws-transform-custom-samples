# ACK Adoption Fields - Reference by Service

Reference table for the `services.k8s.aws/adoption-fields` annotation.

**Rule:** `adoption-fields` is only needed when the resource identifier lives in **status** (not spec).
If the identifier is in spec (e.g., `spec.name`, `spec.tableName`), the annotation is not required.

---

## Reference table

| Service | Kind | adoption-fields key | How to discover | Example |
|---------|------|---------------------|-----------------|---------|
| EKS | `Cluster` | Not needed (`spec.name`) | `aws eks list-clusters` | - |
| EC2 | `VPC` | `vpcID` | `aws ec2 describe-vpcs --query 'Vpcs[*].VpcId'` | `{"vpcID": "vpc-0abc123"}` |
| EC2 | `Subnet` | `subnetID` | `aws ec2 describe-subnets --query 'Subnets[*].SubnetId'` | `{"subnetID": "subnet-0abc123"}` |
| EC2 | `SecurityGroup` | `id` | `aws ec2 describe-security-groups --query 'SecurityGroups[*].GroupId'` | `{"id": "sg-0abc123"}` |
| EC2 | `RouteTable` | `routeTableID` | `aws ec2 describe-route-tables --query 'RouteTables[*].RouteTableId'` | `{"routeTableID": "rtb-0abc123"}` |
| EC2 | `InternetGateway` | `internetGatewayID` | `aws ec2 describe-internet-gateways --query 'InternetGateways[*].InternetGatewayId'` | `{"internetGatewayID": "igw-0abc123"}` |
| S3 | `Bucket` | Not needed (`spec.name`) | `aws s3api list-buckets --query 'Buckets[*].Name'` | - |
| DynamoDB | `Table` | Not needed (`spec.tableName`) | `aws dynamodb list-tables` | - |
| SQS | `Queue` | `queueURL` | `aws sqs list-queues` | `{"queueURL": "https://sqs.us-east-1.amazonaws.com/123/my-queue"}` |
| SNS | `Topic` | `arn` | `aws sns list-topics --query 'Topics[*].TopicArn'` | `{"arn": "arn:aws:sns:us-east-1:123:my-topic"}` |
| RDS | `DBInstance` | Not needed (`spec.dbInstanceIdentifier`) | `aws rds describe-db-instances --query 'DBInstances[*].DBInstanceIdentifier'` | - |
| RDS | `DBCluster` | Not needed (`spec.dbClusterIdentifier`) | `aws rds describe-db-clusters --query 'DBClusters[*].DBClusterIdentifier'` | - |
| ElastiCache | `ReplicationGroup` | Not needed (`spec.replicationGroupID`) | `aws elasticache describe-replication-groups --query 'ReplicationGroups[*].ReplicationGroupId'` | - |
| IAM | `Role` | Not needed (`spec.name`) | `aws iam list-roles --query 'Roles[*].RoleName'` | - |
| IAM | `Policy` | `arn` | `aws iam list-policies --scope Local --query 'Policies[*].Arn'` | `{"arn": "arn:aws:iam::123:policy/my-policy"}` |
| KMS | `Key` | `keyID` | `aws kms list-keys --query 'Keys[*].KeyId'` | `{"keyID": "mrk-abc123"}` |
| Lambda | `Function` | Not needed (`spec.functionName`) | `aws lambda list-functions --query 'Functions[*].FunctionName'` | - |
| ECR | `Repository` | Not needed (`spec.repositoryName`) | `aws ecr describe-repositories --query 'repositories[*].repositoryName'` | - |
| MSK | `Cluster` | `clusterARN` | `aws kafka list-clusters --query 'ClusterInfoList[*].ClusterArn'` | `{"clusterARN": "arn:aws:kafka:..."}` |
| OpenSearch | `Domain` | Not needed (`spec.name`) | `aws opensearch list-domain-names --query 'DomainNames[*].DomainName'` | - |
| Secrets Manager | `Secret` | Not needed (`spec.name`) | `aws secretsmanager list-secrets --query 'SecretList[*].Name'` | - |
| SSM | `Parameter` | Not needed (`spec.name`) | `aws ssm describe-parameters --query 'Parameters[*].Name'` | - |
| EventBridge | `EventBus` | Not needed (`spec.name`) | `aws events list-event-buses --query 'EventBuses[*].Name'` | - |
| CloudFront | `Distribution` | `id` | `aws cloudfront list-distributions --query 'DistributionList.Items[*].Id'` | `{"id": "EDFDVBD6EXAMPLE"}` |
| Route53 | `HostedZone` | `id` | `aws route53 list-hosted-zones --query 'HostedZones[*].Id'` | `{"id": "/hostedzone/Z1D633PJN98FT9"}` |

---

## Bulk discovery (multiple resources)

```bash
# All EKS clusters
aws eks list-clusters --output json | jq -r '.clusters[]'

# All VPCs with name tag
aws ec2 describe-vpcs \
  --query 'Vpcs[*].{ID:VpcId,CIDR:CidrBlock,Name:Tags[?Key==`Name`].Value|[0]}' \
  --output table

# All SQS queues
aws sqs list-queues --output json | jq -r '.QueueUrls[]'

# All S3 buckets
aws s3api list-buckets --query 'Buckets[*].Name' --output text

# All DynamoDB tables
aws dynamodb list-tables --output json | jq -r '.TableNames[]'

# All SNS topics
aws sns list-topics --query 'Topics[*].TopicArn' --output text

# All Lambda functions
aws lambda list-functions \
  --query 'Functions[*].{Name:FunctionName,Runtime:Runtime}' \
  --output table
```

---

## Notes

- Always use `--region` or `AWS_PROFILE` on discovery commands to target the correct region
- For multi-region resources, run discovery per region separately
- `adoption-fields` accepts inline JSON - use YAML block literal (`|`) to avoid quoting issues
- Official reference: https://aws-controllers-k8s.github.io/community/docs/user-docs/features/#resourceadoption
