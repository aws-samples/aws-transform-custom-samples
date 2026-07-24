# kro Patterns for IaC Composition Units

How to translate IaC modules and nested stacks into kro `ResourceGraphDefinition`s (RGDs).
kro API: `kro.run/v1alpha1`, kind `ResourceGraphDefinition` (short name `rgd`, cluster-scoped).

> kro is an open-source project under active development (v1alpha1 API). Pin the kro version in the prerequisite checklist and validate RGDs against the installed version.

## When to Generate an RGD

| IaC Construct | kro Output |
|---|---|
| Terraform `module` block | 1 RGD (from the module source) + 1 instance CR per `module` block instantiation |
| CloudFormation `AWS::CloudFormation::Stack` (nested stack) | 1 RGD (from the child template) + 1 instance CR per nested stack reference |
| Pulumi `ComponentResource` subclass | 1 RGD (from the component class) + 1 instance CR per instantiation |
| Flat resources (no composition) | Plain ACK manifests - NEVER wrap single resources in kro |

## Translation Rules

### 1. Module inputs -> RGD schema

| IaC | kro schema field |
|---|---|
| TF `variable "queue_name" { type = string }` | `queueName: string` |
| TF `variable "max_receive_count" { type = number, default = 5 }` | `maxReceiveCount: integer \| default=5` |
| TF `variable "enabled" { type = bool, default = true }` | `enabled: boolean \| default=true` |
| CFN `Parameters: QueueName: { Type: String }` | `queueName: string` |
| CFN `Parameters: MaxReceive: { Type: Number, Default: 5 }` | `maxReceive: integer \| default=5` |

Naming: IaC snake_case variables become camelCase schema fields.

### 2. Internal references -> CEL expressions

| IaC Reference | kro CEL |
|---|---|
| TF `aws_vpc.main.id` | `${vpc.status.vpcID}` |
| TF `aws_sqs_queue.dlq.arn` | `${dlq.status.ackResourceMetadata.arn}` |
| TF `var.queue_name` | `${schema.spec.queueName}` |
| CFN `!Ref MyVPC` | `${vpc.status.vpcID}` (or the Kind's primary identifier) |
| CFN `!GetAtt MyQueue.Arn` | `${queue.status.ackResourceMetadata.arn}` |
| CFN `!Ref SomeParameter` | `${schema.spec.someParameter}` |

Rule of thumb: ARNs come from `status.ackResourceMetadata.arn`; service-specific IDs come from their status field (see `adoption-fields-ref.md` for which field holds the identifier per Kind).

### 3. Resource IDs

Each `resources[].id` in the RGD uses the IaC logical name, kebab-case-free camelCase (`aws_sqs_queue.dead_letter` -> `id: deadLetter`). IDs are how CEL references resolve - keep them stable and descriptive.

### 4. Adoption annotations INSIDE templates

Every ACK resource template inside an RGD carries the same safety annotations as flat manifests:

```yaml
metadata:
  annotations:
    services.k8s.aws/adoption-policy: "adopt-or-create"
    services.k8s.aws/deletion-policy: "retain"
```

This matters because kro instances create/reconcile the underlying ACK CRs - without adopt-or-create on the templates, instantiating the RGD against existing AWS resources would fail or duplicate them.

### 5. Instance CRs carry the per-instantiation values

For each `module` block / nested stack reference, generate one instance CR using the RGD's schema kind, populated with that instantiation's argument values:

```yaml
apiVersion: kro.run/v1alpha1
kind: QueueWithDLQ        # matches spec.schema.kind of the RGD
metadata:
  name: orders            # from the module instance label
spec:
  queueName: orders       # from the module arguments
  maxReceiveCount: 5
```

> Note: instance CRs use the API defined by the RGD schema (`kro.run/<schema.apiVersion>` + `schema.kind`). kro serves this API once the RGD is applied and ready.

## Full RGD Skeleton

```yaml
apiVersion: kro.run/v1alpha1
kind: ResourceGraphDefinition
metadata:
  name: <module-name-kebab>
spec:
  schema:
    apiVersion: v1alpha1
    kind: <ModuleNamePascal>
    spec:
      # module inputs with types and defaults
    status:
      # optional: surface useful child status fields
      # queueARN: ${queue.status.ackResourceMetadata.arn}
  resources:
    - id: <logicalNameCamel>
      template:
        # full ACK manifest with adoption annotations
```

## Apply Order for kro Outputs

1. kro controller installed and healthy (prerequisite, documented in report)
2. ACK controllers for every service used inside the RGD (prerequisite)
3. `kubectl apply` the RGD -> wait `state: Active`
4. `kubectl apply` the instance CRs -> ACK CRs are created, adoption happens per-resource
5. Validate: instance `Ready`, each child ACK CR shows `ACK.Adopted: True` / `ACK.ResourceSynced: True`

## Anti-Patterns

- Wrapping a single flat resource in an RGD (adds a CRD + controller hop for zero composition value)
- Leaking IaC syntax into templates (`${var.x}`, `!Ref`) - every reference must be CEL or a literal
- Omitting adoption annotations inside RGD templates (adoption safety is per-ACK-CR, not per-instance)
- Encoding per-instance values in the RGD instead of schema fields (breaks reusability - the whole point of the module translation)
