---
name: ack-resource-adoption-from-iac
description: >-
  Analyzes CloudFormation, Terraform, and Pulumi code to generate ACK
  (AWS Controllers for Kubernetes) adoption manifests that bring existing
  AWS resources under Kubernetes/GitOps management without recreating them.
  Uses the ACK ResourceAdoption feature gate with adopt-or-create policy,
  and generates kro ResourceGraphDefinitions for reusable modules and
  stacked/nested components. Trigger: ACK adoption, adopt-or-create,
  migrate IaC to Kubernetes, CloudFormation to ACK, Terraform to ACK,
  GitOps migration, kro ResourceGraphDefinition.
---

# ACK Resource Adoption from IaC

## Objective

Convert existing IaC-managed AWS resources (CloudFormation, Terraform, Pulumi) into ACK adoption manifests so the resources come under Kubernetes/GitOps control **without being recreated, modified, or deleted**. Where the IaC uses reusable modules or nested/stacked structures, generate kro `ResourceGraphDefinition`s that preserve that composition as a first-class Kubernetes API.

## Scope

Analyzes:
- CloudFormation templates (`.yaml`, `.yml`, `.json` with `AWSTemplateFormatVersion` or `Resources:` top-level key), including nested stacks (`AWS::CloudFormation::Stack`)
- Terraform files (`.tf`, `.tf.json`), including local and registry modules (`module` blocks)
- Pulumi programs (TypeScript/Python with `@pulumi/aws` or `pulumi_aws` imports)

Generates:
- One ACK adoption manifest per supported AWS resource, with `adoption-policy: adopt-or-create`, `deletion-policy: retain`, and `adoption-fields` when the identifier lives in status
- kro `ResourceGraphDefinition`s (`kro.run/v1alpha1`) for IaC modules/nested stacks that instantiate more than one resource, exposing module inputs as schema fields
- `ADOPTION_REPORT.md` documenting every mapped resource, every skipped resource (with reason), discovery commands, and the recommended apply order

Supported ACK services (initial mapping table in `references/iac-to-ack-mapping.md`): EKS, EC2 (VPC, Subnet, SecurityGroup, RouteTable, InternetGateway), S3, DynamoDB, SQS, SNS, RDS, ElastiCache, IAM (Role, Policy), KMS, Lambda, ECR, MSK, OpenSearch, Secrets Manager, SSM, EventBridge, CloudFront, Route53.

**Non-Goals** (out of scope for this transformation):
1. Executing `kubectl apply` or touching any live cluster or AWS account - this transformation generates manifests and a report; the customer applies them following the documented order.
2. Removing or altering the source IaC - the CloudFormation/Terraform/Pulumi code is read-only input. Decommissioning the old IaC (e.g., `terraform state rm`, CloudFormation stack deletion with retain policies) is documented as a manual post-adoption step in the report, never automated.
3. Resources without a GA ACK controller - flagged in the report with the closest alternative (stay in IaC, or ACK controller roadmap link), never guessed.
4. Installing ACK controllers or kro - prerequisites are documented in the report; installation is the customer's platform decision (EKS Capabilities vs Helm).

## Constraints

### Safety (non-negotiable)
- EVERY generated manifest MUST carry `services.k8s.aws/deletion-policy: "retain"`. A missing retain policy can cause real AWS resource deletion when a CR is removed - this is the single most dangerous failure mode of this transformation.
- EVERY generated manifest MUST use `services.k8s.aws/adoption-policy: "adopt-or-create"` so applying it never fails on an existing resource and never duplicates it.
- Never generate a manifest with placeholder/guessed identifiers. If the resource identifier cannot be resolved from the IaC (e.g., a Terraform computed value or a CloudFormation `!Ref` chain that requires runtime state), emit the manifest with an explicit `# TODO(discovery):` comment containing the exact AWS CLI discovery command, and list it in the report's "Requires Discovery" section.
- The source IaC files are never modified.

### Fidelity
- The generated `spec` must reflect the resource configuration declared in the IaC (adopt-or-create reconciles spec against AWS after adoption - a spec that diverges from reality causes unintended updates). When an IaC attribute has no ACK spec equivalent, document it in the report rather than dropping it silently.
- Preserve resource naming: the Kubernetes object name derives from the IaC logical name (kebab-cased), and the AWS-facing name field keeps the exact deployed value.
- Tags declared in IaC are carried into the ACK spec `tags` field when the controller supports it.

### kro Generation Rules
- Generate a `ResourceGraphDefinition` ONLY when the IaC has a module/nested-stack instantiated as a unit (a Terraform `module` block, a CloudFormation nested stack, or a Pulumi ComponentResource). One-off flat resources get plain ACK manifests - do not wrap single resources in kro.
- Module input variables become kro `spec.schema.spec` fields with types and defaults mapped from the IaC variable definitions.
- Cross-resource references inside the module (e.g., subnet referencing VPC ID) become kro CEL expressions (`${resource.status.field}`), replacing the IaC-native references (`!Ref`, `!GetAtt`, Terraform interpolation).
- Each kro resource template inside the RGD still carries the adoption + retain annotations - adoption safety applies inside graphs exactly as it does for flat manifests.
- For module instances (multiple instantiations of the same module), generate ONE RGD plus one instance CR per instantiation, with the per-instance values.

### Reporting
- `ADOPTION_REPORT.md` must contain: inventory table (IaC resource -> ACK Kind -> manifest file -> adoption-fields needed), skipped resources with reasons, discovery commands for unresolved identifiers, prerequisite checklist (controllers, feature gate, IRSA/Pod Identity permissions per service), recommended apply order (dependency-sorted: IAM/KMS -> network -> data stores -> compute), and post-adoption IaC decommission guidance.
- Every generated file must be listed with its source IaC file and line reference.

## Workflow

```text
Phase 0: Detect IaC flavor(s)
  ├── CloudFormation: AWSTemplateFormatVersion / Resources: top-level key
  ├── Terraform: .tf files, module blocks, terraform-provider-aws resources
  └── Pulumi: @pulumi/aws (TS) or pulumi_aws (Python) imports

Phase 1: Inventory
  ├── Parse every resource declaration into (type, logical name, properties, references)
  ├── Resolve identifiers: literal values, variable defaults, tfvars files
  ├── Mark unresolvable identifiers (computed values, runtime refs) for discovery
  └── Detect composition units: TF modules, CFN nested stacks, Pulumi components

Phase 2: Map to ACK
  ├── Map each IaC resource type to its ACK apiVersion/Kind
  │     (references/iac-to-ack-mapping.md)
  ├── Determine adoption-fields requirement per Kind
  │     (references/adoption-fields-ref.md)
  └── Flag unsupported types (no GA ACK controller) for the report

Phase 3: Generate manifests
  ├── Flat resources -> ACK manifests with adopt-or-create + retain
  ├── Composition units -> kro ResourceGraphDefinition + instance CRs
  │     (references/kro-patterns.md)
  └── Unresolved identifiers -> TODO(discovery) comments + CLI commands

Phase 4: Validate
  ├── YAML syntax validation on every generated manifest
  ├── kubectl apply --dry-run=client (if kubectl available; needs CRDs - skip gracefully)
  └── Annotation audit: 100% of generated manifests carry retain + adopt-or-create

Phase 5: Report
  └── Generate ADOPTION_REPORT.md (inventory, skips, discovery, prerequisites,
        apply order, post-adoption IaC decommission guidance)
```

### Configuration

Options are provided via `additionalPlanContext`:
- `"Adopt all resources."` - full repository scan
- `"Adopt only the networking module."` - scope to a specific module/stack
- `"Skip kro, flat manifests only."` - disable RGD generation
- `"Output directory: ack-adoption/"` - override the default output location (`ack-adoption/` at repo root)

## Worked Examples

### Example 1: Terraform S3 bucket -> ACK adoption manifest

**Input (`storage.tf`):**
```hcl
resource "aws_s3_bucket" "reports" {
  bucket = "acme-reports-prod"
  tags = {
    Team = "analytics"
  }
}
```

**Output (`ack-adoption/s3-bucket-reports.yaml`):**
```yaml
apiVersion: s3.services.k8s.aws/v1alpha1
kind: Bucket
metadata:
  name: reports
  annotations:
    services.k8s.aws/adoption-policy: "adopt-or-create"
    services.k8s.aws/deletion-policy: "retain"
spec:
  name: acme-reports-prod
  tagging:
    tagSet:
      - key: Team
        value: analytics
```

### Example 2: Terraform module -> kro ResourceGraphDefinition

**Input (`main.tf`):**
```hcl
module "queue_with_dlq" {
  source     = "./modules/queue-with-dlq"
  queue_name = "orders"
  max_receive_count = 5
}
```

Where the module declares an `aws_sqs_queue` main queue plus an `aws_sqs_queue` DLQ wired via `redrive_policy`.

**Output (`ack-adoption/rgd-queue-with-dlq.yaml`):**
```yaml
apiVersion: kro.run/v1alpha1
kind: ResourceGraphDefinition
metadata:
  name: queue-with-dlq
spec:
  schema:
    apiVersion: v1alpha1
    kind: QueueWithDLQ
    spec:
      queueName: string
      maxReceiveCount: integer | default=5
  resources:
    - id: dlq
      template:
        apiVersion: sqs.services.k8s.aws/v1alpha1
        kind: Queue
        metadata:
          name: ${schema.spec.queueName}-dlq
          annotations:
            services.k8s.aws/adoption-policy: "adopt-or-create"
            services.k8s.aws/deletion-policy: "retain"
        spec:
          queueName: ${schema.spec.queueName}-dlq
    - id: queue
      template:
        apiVersion: sqs.services.k8s.aws/v1alpha1
        kind: Queue
        metadata:
          name: ${schema.spec.queueName}
          annotations:
            services.k8s.aws/adoption-policy: "adopt-or-create"
            services.k8s.aws/deletion-policy: "retain"
        spec:
          queueName: ${schema.spec.queueName}
          redrivePolicy: '{"deadLetterTargetArn":"${dlq.status.ackResourceMetadata.arn}","maxReceiveCount":${schema.spec.maxReceiveCount}}'
```

**Plus the instance CR (`ack-adoption/instance-orders-queue.yaml`):**
```yaml
apiVersion: kro.run/v1alpha1
kind: QueueWithDLQ
metadata:
  name: orders
spec:
  queueName: orders
  maxReceiveCount: 5
```

Full example set (CloudFormation nested stack -> RGD, VPC with adoption-fields, DynamoDB, IAM Role, unresolved-identifier TODO pattern) is in `references/examples-iac-to-ack.md`.

## Reference Dispatch

Load reference files on demand based on what the scan finds:

| Signal | Reference File |
|---|---|
| Any supported AWS resource type in the IaC | `references/iac-to-ack-mapping.md` |
| A mapped Kind whose identifier lives in status (VPC, SQS, SNS, KMS, CloudFront, Route53, MSK, IAM Policy, EC2 network resources) | `references/adoption-fields-ref.md` |
| Terraform `module` block, CloudFormation `AWS::CloudFormation::Stack`, or Pulumi ComponentResource | `references/kro-patterns.md` |
| Any resource requiring a concrete before/after example | `references/examples-iac-to-ack.md` |

## Validation / Exit Criteria

1. Every supported IaC resource has exactly one generated ACK manifest (or one kro RGD slot) - no duplicates, no silent drops.
2. 100% of generated manifests (including templates inside RGDs) carry both `services.k8s.aws/adoption-policy: "adopt-or-create"` and `services.k8s.aws/deletion-policy: "retain"`.
3. Every Kind requiring `adoption-fields` has the annotation populated with a resolved identifier, OR carries a `TODO(discovery)` comment with the exact AWS CLI command and appears in the report's "Requires Discovery" section.
4. kro RGDs are generated only for genuine composition units; every RGD has at least one instance CR; internal references use CEL expressions, not IaC syntax remnants.
5. No generated file contains IaC-native syntax (`!Ref`, `!GetAtt`, `${var.`, `${module.`, Pulumi interpolations).
6. All generated YAML parses cleanly; `kubectl apply --dry-run=client` passes where CRDs are available (skipped gracefully otherwise).
7. Source IaC files are byte-identical to their pre-run state.
8. `ADOPTION_REPORT.md` exists and contains: inventory table, skipped resources with reasons, discovery commands, prerequisite checklist (controller + feature gate + IAM permissions per service), dependency-sorted apply order, and post-adoption IaC decommission guidance.

## Tips

- `ResourceAdoption` feature gate is enabled by default when ACK controllers are installed via EKS Capabilities, but disabled by default on self-managed Helm installs - the prerequisite checklist in the report must state both paths explicitly.
- adopt-or-create reconciles the declared spec against AWS after adoption. A spec field that differs from the deployed resource triggers a real AWS update - fidelity between IaC properties and generated spec is a correctness requirement, not cosmetics.
- Terraform state files (`.tfstate`) are the highest-fidelity identifier source when present in the repo - prefer state values over HCL interpolation resolution, but never require state to be present.
- CloudFormation `!Ref` on a resource usually resolves to the physical ID at runtime - when the template alone cannot resolve it, the discovery command in the TODO should query by stack: `aws cloudformation describe-stack-resources --stack-name <stack>`.
- An empty or partial spec is safer than a wrong spec for adopt-or-create: prefer the minimal find+create field set and let ACK populate the rest from AWS state after adoption.
