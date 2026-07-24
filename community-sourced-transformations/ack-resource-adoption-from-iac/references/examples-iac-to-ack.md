# Worked Examples - IaC to ACK Adoption

Concrete before/after examples for each major transformation pattern.

---

## Example 1: Terraform DynamoDB table (identifier in spec - no adoption-fields)

**Before (`database.tf`):**
```hcl
resource "aws_dynamodb_table" "orders" {
  name         = "orders-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "orderId"

  attribute {
    name = "orderId"
    type = "S"
  }

  tags = {
    Environment = "production"
  }
}
```

**After (`ack-adoption/dynamodb-table-orders.yaml`):**
```yaml
# Source: database.tf (resource "aws_dynamodb_table" "orders")
apiVersion: dynamodb.services.k8s.aws/v1alpha1
kind: Table
metadata:
  name: orders
  annotations:
    services.k8s.aws/adoption-policy: "adopt-or-create"
    services.k8s.aws/deletion-policy: "retain"
spec:
  tableName: orders-prod
  billingMode: PAY_PER_REQUEST
  keySchema:
    - attributeName: orderId
      keyType: HASH
  attributeDefinitions:
    - attributeName: orderId
      attributeType: S
  tags:
    - key: Environment
      value: production
```

---

## Example 2: CloudFormation VPC (identifier in status - adoption-fields REQUIRED, unresolvable from template)

**Before (`network.template.yaml`):**
```yaml
Resources:
  AppVPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.42.0.0/16
      EnableDnsSupport: true
      EnableDnsHostnames: true
      Tags:
        - Key: Name
          Value: app-vpc
```

**After (`ack-adoption/vpc-app-vpc.yaml`):**
```yaml
# Source: network.template.yaml (AppVPC)
apiVersion: ec2.services.k8s.aws/v1alpha1
kind: VPC
metadata:
  name: app-vpc
  annotations:
    services.k8s.aws/adoption-policy: "adopt-or-create"
    services.k8s.aws/deletion-policy: "retain"
    # TODO(discovery): the VPC ID is assigned at deploy time and cannot be read from the template.
    # Resolve it with:
    #   aws cloudformation describe-stack-resources --stack-name <stack-name> \
    #     --logical-resource-id AppVPC --query 'StackResources[0].PhysicalResourceId' --output text
    # Then replace REPLACE_ME below before applying.
    services.k8s.aws/adoption-fields: |
      {"vpcID": "REPLACE_ME"}
spec:
  cidrBlocks:
    - "10.42.0.0/16"
  enableDNSSupport: true
  enableDNSHostnames: true
  tags:
    - key: Name
      value: app-vpc
```

> This manifest is also listed in `ADOPTION_REPORT.md` under "Requires Discovery" - it must not be applied until the TODO is resolved.

---

## Example 3: Terraform IAM Role with attachment folding

**Before (`iam.tf`):**
```hcl
resource "aws_iam_role" "app" {
  name               = "app-runtime-role"
  assume_role_policy = data.aws_iam_policy_document.app_assume.json
}

resource "aws_iam_role_policy_attachment" "app_s3" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
}
```

**After (`ack-adoption/iam-role-app.yaml`)** - the attachment resource folds into the Role spec:
```yaml
# Source: iam.tf (aws_iam_role.app + aws_iam_role_policy_attachment.app_s3)
apiVersion: iam.services.k8s.aws/v1alpha1
kind: Role
metadata:
  name: app
  annotations:
    services.k8s.aws/adoption-policy: "adopt-or-create"
    services.k8s.aws/deletion-policy: "retain"
spec:
  name: app-runtime-role
  policies:
    - arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
  # TODO(discovery): assume_role_policy uses a data source (computed at plan time).
  # Resolve the deployed trust policy with:
  #   aws iam get-role --role-name app-runtime-role --query 'Role.AssumeRolePolicyDocument'
  # and paste it into assumeRolePolicyDocument before applying.
```

---

## Example 4: CloudFormation nested stack -> kro ResourceGraphDefinition

**Before (parent `main.template.yaml`):**
```yaml
Resources:
  MessagingStack:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: ./messaging.template.yaml
      Parameters:
        TopicName: order-events
        QueueName: order-processor
```

**Child (`messaging.template.yaml`):** declares an SNS Topic, an SQS Queue, and a subscription wiring them.

**After - one RGD (`ack-adoption/rgd-messaging.yaml`):**
```yaml
# Source: messaging.template.yaml (nested stack unit)
apiVersion: kro.run/v1alpha1
kind: ResourceGraphDefinition
metadata:
  name: messaging
spec:
  schema:
    apiVersion: v1alpha1
    kind: Messaging
    spec:
      topicName: string
      queueName: string
    status:
      topicARN: ${topic.status.ackResourceMetadata.arn}
  resources:
    - id: topic
      template:
        apiVersion: sns.services.k8s.aws/v1alpha1
        kind: Topic
        metadata:
          name: ${schema.spec.topicName}
          annotations:
            services.k8s.aws/adoption-policy: "adopt-or-create"
            services.k8s.aws/deletion-policy: "retain"
            # TODO(discovery): SNS adoption requires the topic ARN (status field).
            # aws sns list-topics --query "Topics[?contains(TopicArn,'order-events')].TopicArn"
        spec:
          name: ${schema.spec.topicName}
    - id: queue
      template:
        apiVersion: sqs.services.k8s.aws/v1alpha1
        kind: Queue
        metadata:
          name: ${schema.spec.queueName}
          annotations:
            services.k8s.aws/adoption-policy: "adopt-or-create"
            services.k8s.aws/deletion-policy: "retain"
            # TODO(discovery): SQS adoption requires the queue URL (status field).
            # aws sqs get-queue-url --queue-name order-processor
        spec:
          queueName: ${schema.spec.queueName}
    - id: subscription
      template:
        apiVersion: sns.services.k8s.aws/v1alpha1
        kind: Subscription
        metadata:
          name: ${schema.spec.queueName}-sub
          annotations:
            services.k8s.aws/adoption-policy: "adopt-or-create"
            services.k8s.aws/deletion-policy: "retain"
        spec:
          topicARN: ${topic.status.ackResourceMetadata.arn}
          protocol: sqs
          endpoint: ${queue.status.ackResourceMetadata.arn}
```

**Plus the instance CR (`ack-adoption/instance-messaging.yaml`):**
```yaml
# Source: main.template.yaml (MessagingStack)
apiVersion: kro.run/v1alpha1
kind: Messaging
metadata:
  name: messaging
spec:
  topicName: order-events
  queueName: order-processor
```

Note how `!Ref`/`!GetAtt` wiring in the child template became CEL (`${topic.status.ackResourceMetadata.arn}`), and stack Parameters became schema fields.

---

## Example 5: Terraform split resources folding (S3)

**Before (`storage.tf`):**
```hcl
resource "aws_s3_bucket" "assets" {
  bucket = "acme-assets-prod"
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

**After (`ack-adoption/s3-bucket-assets.yaml`)** - two TF resources, ONE manifest:
```yaml
# Source: storage.tf (aws_s3_bucket.assets + aws_s3_bucket_versioning.assets)
apiVersion: s3.services.k8s.aws/v1alpha1
kind: Bucket
metadata:
  name: assets
  annotations:
    services.k8s.aws/adoption-policy: "adopt-or-create"
    services.k8s.aws/deletion-policy: "retain"
spec:
  name: acme-assets-prod
  versioning:
    status: Enabled
```

---

## Example 6: Unsupported resource (report-only)

**Before (`observability.tf`):**
```hcl
resource "aws_cloudwatch_log_group" "app" {
  name              = "/app/prod"
  retention_in_days = 30
}
```

**Output:** NO manifest generated. `ADOPTION_REPORT.md` gets:

| Resource | Reason Skipped | Guidance |
|---|---|---|
| `aws_cloudwatch_log_group.app` (`/app/prod`) | No GA ACK controller for CloudWatch Logs | Keep under Terraform management; track the ACK controller roadmap at https://github.com/orgs/aws-controllers-k8s/projects/1 |
