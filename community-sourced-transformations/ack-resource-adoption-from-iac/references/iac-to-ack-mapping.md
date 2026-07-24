# IaC Resource Type -> ACK Mapping

Mapping table from CloudFormation, Terraform, and Pulumi resource types to ACK apiVersion/Kind.
Only resources with a GA or generally usable ACK controller are mapped - anything else is flagged in the report, never guessed.

## Mapping Table

| CloudFormation Type | Terraform Type | Pulumi Type (aws.) | ACK apiVersion | ACK Kind | adoption-fields |
|---|---|---|---|---|---|
| `AWS::EKS::Cluster` | `aws_eks_cluster` | `eks.Cluster` | `eks.services.k8s.aws/v1alpha1` | `Cluster` | Not needed (`spec.name`) |
| `AWS::EKS::Nodegroup` | `aws_eks_node_group` | `eks.NodeGroup` | `eks.services.k8s.aws/v1alpha1` | `Nodegroup` | Not needed (`spec.name` + `spec.clusterName`) |
| `AWS::EC2::VPC` | `aws_vpc` | `ec2.Vpc` | `ec2.services.k8s.aws/v1alpha1` | `VPC` | `{"vpcID": "vpc-..."}` |
| `AWS::EC2::Subnet` | `aws_subnet` | `ec2.Subnet` | `ec2.services.k8s.aws/v1alpha1` | `Subnet` | `{"subnetID": "subnet-..."}` |
| `AWS::EC2::SecurityGroup` | `aws_security_group` | `ec2.SecurityGroup` | `ec2.services.k8s.aws/v1alpha1` | `SecurityGroup` | `{"id": "sg-..."}` |
| `AWS::EC2::RouteTable` | `aws_route_table` | `ec2.RouteTable` | `ec2.services.k8s.aws/v1alpha1` | `RouteTable` | `{"routeTableID": "rtb-..."}` |
| `AWS::EC2::InternetGateway` | `aws_internet_gateway` | `ec2.InternetGateway` | `ec2.services.k8s.aws/v1alpha1` | `InternetGateway` | `{"internetGatewayID": "igw-..."}` |
| `AWS::S3::Bucket` | `aws_s3_bucket` | `s3.Bucket` / `s3.BucketV2` | `s3.services.k8s.aws/v1alpha1` | `Bucket` | Not needed (`spec.name`) |
| `AWS::DynamoDB::Table` | `aws_dynamodb_table` | `dynamodb.Table` | `dynamodb.services.k8s.aws/v1alpha1` | `Table` | Not needed (`spec.tableName`) |
| `AWS::SQS::Queue` | `aws_sqs_queue` | `sqs.Queue` | `sqs.services.k8s.aws/v1alpha1` | `Queue` | `{"queueURL": "https://sqs...."}` |
| `AWS::SNS::Topic` | `aws_sns_topic` | `sns.Topic` | `sns.services.k8s.aws/v1alpha1` | `Topic` | `{"arn": "arn:aws:sns:..."}` |
| `AWS::RDS::DBInstance` | `aws_db_instance` | `rds.Instance` | `rds.services.k8s.aws/v1alpha1` | `DBInstance` | Not needed (`spec.dbInstanceIdentifier`) |
| `AWS::RDS::DBCluster` | `aws_rds_cluster` | `rds.Cluster` | `rds.services.k8s.aws/v1alpha1` | `DBCluster` | Not needed (`spec.dbClusterIdentifier`) |
| `AWS::ElastiCache::ReplicationGroup` | `aws_elasticache_replication_group` | `elasticache.ReplicationGroup` | `elasticache.services.k8s.aws/v1alpha1` | `ReplicationGroup` | Not needed (`spec.replicationGroupID`) |
| `AWS::IAM::Role` | `aws_iam_role` | `iam.Role` | `iam.services.k8s.aws/v1alpha1` | `Role` | Not needed (`spec.name`) |
| `AWS::IAM::ManagedPolicy` | `aws_iam_policy` | `iam.Policy` | `iam.services.k8s.aws/v1alpha1` | `Policy` | `{"arn": "arn:aws:iam::..."}` |
| `AWS::KMS::Key` | `aws_kms_key` | `kms.Key` | `kms.services.k8s.aws/v1alpha1` | `Key` | `{"keyID": "..."}` |
| `AWS::Lambda::Function` | `aws_lambda_function` | `lambda.Function` | `lambda.services.k8s.aws/v1alpha1` | `Function` | Not needed (`spec.functionName`) |
| `AWS::ECR::Repository` | `aws_ecr_repository` | `ecr.Repository` | `ecr.services.k8s.aws/v1alpha1` | `Repository` | Not needed (`spec.repositoryName`) |
| `AWS::MSK::Cluster` | `aws_msk_cluster` | `msk.Cluster` | `kafka.services.k8s.aws/v1alpha1` | `Cluster` | `{"clusterARN": "arn:aws:kafka:..."}` |
| `AWS::OpenSearchService::Domain` | `aws_opensearch_domain` | `opensearch.Domain` | `opensearchservice.services.k8s.aws/v1alpha1` | `Domain` | Not needed (`spec.name`) |
| `AWS::SecretsManager::Secret` | `aws_secretsmanager_secret` | `secretsmanager.Secret` | `secretsmanager.services.k8s.aws/v1alpha1` | `Secret` | Not needed (`spec.name`) |
| `AWS::SSM::Parameter` | `aws_ssm_parameter` | `ssm.Parameter` | `ssm.services.k8s.aws/v1alpha1` | `Parameter` | Not needed (`spec.name`) |
| `AWS::Events::EventBus` | `aws_cloudwatch_event_bus` | `cloudwatch.EventBus` | `eventbridge.services.k8s.aws/v1alpha1` | `EventBus` | Not needed (`spec.name`) |
| `AWS::CloudFront::Distribution` | `aws_cloudfront_distribution` | `cloudfront.Distribution` | `cloudfront.services.k8s.aws/v1alpha1` | `Distribution` | `{"id": "E..."}` |
| `AWS::Route53::HostedZone` | `aws_route53_zone` | `route53.Zone` | `route53.services.k8s.aws/v1alpha1` | `HostedZone` | `{"id": "/hostedzone/Z..."}` |

## Commonly Found but NOT Mapped (flag in report)

| IaC Type | Why | Report Guidance |
|---|---|---|
| `aws_iam_role_policy_attachment` / `AWS::IAM::Policy` (inline) | Attachment is expressed inside the ACK Role spec (`policies` field), not a standalone Kind | Fold into the parent `Role` manifest's `spec.policies` |
| `aws_s3_bucket_policy`, `aws_s3_bucket_versioning`, etc. (TF split resources) | Terraform splits bucket sub-configs into separate resources; ACK `Bucket` holds them in one spec | Merge into the parent `Bucket` spec fields (`policy`, `versioning`) |
| `aws_security_group_rule` | Standalone rule resources fold into the parent SecurityGroup spec | Merge into parent `SecurityGroup` `spec.ingressRules`/`egressRules` |
| `AWS::CloudFormation::Stack` (nested stack) | Not a resource - a composition unit | Becomes a kro ResourceGraphDefinition (see `kro-patterns.md`) |
| `aws_autoscaling_group`, `aws_launch_template` | No GA ACK controller for classic ASG/LT standalone management | Keep in IaC; note EKS Nodegroup/Karpenter as the K8s-native alternative |
| `aws_cloudwatch_log_group` | CloudWatch Logs ACK controller not GA | Keep in IaC; monitor the ACK roadmap |
| Provider-specific/meta resources (`aws_caller_identity`, `random_*`, `null_resource`, data sources) | Not AWS-managed resources | Skip silently from manifests, list under "Not applicable" in report |

## Terraform Identifier Resolution Order

1. `.tfstate` file present in repo -> use `attributes` values (highest fidelity)
2. Literal values in HCL (`bucket = "acme-reports-prod"`)
3. Variable with `default` in `variables.tf` or value in `*.tfvars`
4. Anything else (computed, `depends_on` chains, remote state) -> `TODO(discovery)` + CLI command

## CloudFormation Identifier Resolution Order

1. Literal property values in the template
2. `Parameters` with `Default`
3. `!Ref`/`!GetAtt`/`!Sub` chains that cannot be statically resolved -> `TODO(discovery)` with `aws cloudformation describe-stack-resources --stack-name <stack>`
