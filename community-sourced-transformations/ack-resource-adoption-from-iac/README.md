# ACK Resource Adoption from IaC

Analyzes existing infrastructure-as-code (CloudFormation, Terraform, Pulumi) and generates ACK (AWS Controllers for Kubernetes) adoption manifests that bring the deployed AWS resources under Kubernetes/GitOps management - **without recreating, modifying, or deleting anything**. IaC modules and nested stacks are translated into kro `ResourceGraphDefinition`s, preserving reusable composition as first-class Kubernetes APIs.

**Supports CloudFormation · Terraform · Pulumi → ACK manifests · kro ResourceGraphDefinitions**

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [What This Transformation Does](#what-this-transformation-does)
- [Transformation Architecture](#transformation-architecture)
- [Why kro for Modules and Stacks](#why-kro-for-modules-and-stacks)
- [Getting Started](#getting-started)
- [Getting Started with AWS Transform Custom](#getting-started-with-aws-transform-custom)
- [Benchmarks](#benchmarks)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [Documentation & References](#documentation--references)
- [Repository Structure](#repository-structure)

## Overview

Teams adopting GitOps on EKS often have years of AWS resources managed by CloudFormation, Terraform, or Pulumi. ACK's `ResourceAdoption` feature gate (with the `adopt-or-create` policy) makes it possible to bring those resources under Kubernetes control by reading their current state directly from AWS - no recreation, no downtime, no import ceremony.

The hard part is generating correct adoption manifests at scale: mapping every IaC resource type to its ACK Kind, knowing which resources need the `adoption-fields` annotation (identifier in status vs spec), carrying the declared configuration into the spec with fidelity, and never, ever forgetting `deletion-policy: retain`. This transformation automates exactly that.

## The Problem

Migrating IaC-managed resources to ACK by hand means:

- **Manifest-by-manifest translation**: each `aws_*` / `AWS::*` resource type has a different ACK apiVersion, Kind, and spec shape.
- **The adoption-fields trap**: resources whose identifier lives in `status` (VPC, SQS, SNS, KMS, CloudFront, and others) silently fail adoption without the `services.k8s.aws/adoption-fields` annotation.
- **The deletion-policy trap**: a manifest without `deletion-policy: retain` means deleting the Kubernetes CR **deletes the real AWS resource**. One missed annotation can destroy production infrastructure.
- **Spec drift risk**: `adopt-or-create` reconciles the declared spec against AWS after adoption - a spec that does not match the deployed resource triggers unintended AWS updates.
- **Composition is lost**: Terraform modules and CloudFormation nested stacks encode reusable architecture. Flattening them into loose manifests throws that structure away.

## What This Transformation Does

1. **Scan** the repository for CloudFormation templates, Terraform files (including `.tfstate` when present), and Pulumi programs.
2. **Inventory** every AWS resource declaration, resolving identifiers from literals, variable defaults, tfvars, and state files - and marking what can only be resolved against the live account.
3. **Map** each resource to its ACK apiVersion/Kind, determining per-Kind `adoption-fields` requirements.
4. **Generate**:
   - One ACK adoption manifest per flat resource - always with `adoption-policy: adopt-or-create` + `deletion-policy: retain`
   - One kro `ResourceGraphDefinition` + instance CRs per Terraform module / CloudFormation nested stack / Pulumi component
   - `TODO(discovery)` comments with exact AWS CLI commands for identifiers that require runtime resolution
5. **Validate** every generated manifest (YAML parse + annotation audit + `kubectl apply --dry-run=client` when CRDs are available).
6. **Report** - generate `ADOPTION_REPORT.md` with the full inventory, skipped resources with reasons, prerequisite checklist, dependency-sorted apply order, and post-adoption IaC decommission guidance.

The source IaC is never modified - it remains the system of record until the customer decides to decommission it, following the guidance in the report.

## Transformation Architecture

```text
Input: Customer repo (CFN / Terraform / Pulumi) + options (via additionalPlanContext)
  |
  +-- 0. Detect     -> identify IaC flavor(s) present
  +-- 1. Inventory  -> parse resources, resolve identifiers, find composition units
  +-- 2. Map        -> IaC type -> ACK Kind + adoption-fields requirements
  +-- 3. Generate   -> ACK manifests (flat) + kro RGDs & instances (modules/stacks)
  +-- 4. Validate   -> YAML parse, annotation audit, dry-run where possible
  +-- 5. Report     -> ADOPTION_REPORT.md with apply order and decommission guidance
```

### Key Design Decisions

1. **Read-only on both sides.** The IaC is never edited; no AWS API or cluster is ever touched. Output is manifests + report, applied by the customer in the documented order.
2. **retain is non-negotiable.** Every generated manifest carries `deletion-policy: retain`. The transformation treats a missing retain annotation as a critical defect, not a style issue.
3. **Never guess identifiers.** Unresolvable identifiers produce a `TODO(discovery)` comment with the exact AWS CLI command - a wrong `adoption-fields` value is worse than an explicit gap.
4. **kro only where composition exists.** Single flat resources get plain ACK manifests. RGDs are generated exclusively for genuine module/stack units, exposing module inputs as schema fields.
5. **Unsupported types are flagged, not dropped.** Resources without a GA ACK controller stay in IaC and appear in the report with guidance - silence is not an option.

## Why kro for Modules and Stacks

A Terraform module or CloudFormation nested stack is an architectural statement: "these resources deploy and evolve as a unit, parameterized by these inputs." [kro](https://kro.run) preserves that statement in Kubernetes:

| IaC Concept | kro Equivalent |
|---|---|
| Module / nested stack definition | `ResourceGraphDefinition` (RGD) |
| Module inputs / stack Parameters | RGD `schema.spec` fields (typed, with defaults) |
| Module instantiation | Instance CR of the RGD-defined Kind |
| `!Ref` / `!GetAtt` / TF interpolation | CEL expressions (`${resource.status.field}`) |
| Module outputs | RGD `schema.status` fields |

The result: platform teams keep their reusable building blocks, now served as Kubernetes-native APIs, and each ACK resource inside the graph still adopts (not recreates) its existing AWS counterpart.

## Getting Started

### Prerequisites

| Tool | Purpose |
|---|---|
| AWS Transform CLI (`atx`) | Execute the transformation |
| `kubectl` (optional) | Manifest dry-run validation |
| ACK controllers + `ResourceAdoption` feature gate (on the target cluster, at apply time) | Actual adoption - documented in the report's prerequisite checklist |
| kro controller (on the target cluster, at apply time) | Only if RGDs were generated |

> The transformation itself needs none of the cluster-side tools - they matter when the customer applies the generated manifests. The `ResourceAdoption` feature gate is enabled by default with EKS Capabilities installs and disabled by default on self-managed Helm installs.

### Getting Started with AWS Transform Custom

To set up the AWS Transform CLI, configure authentication, and run your first transformation, see the [AWS Transform Custom Getting Started Guide](https://docs.aws.amazon.com/transform/latest/userguide/custom-get-started.html).

### Cloning the Repo and Publishing the Transformation

```bash
git clone https://github.com/aws-samples/aws-transform-custom-samples
cd aws-transform-custom-samples/community-sourced-transformations

atx custom def publish -n ack-resource-adoption-from-iac \
    --sd ack-resource-adoption-from-iac \
    --description "Generates ACK adoption manifests and kro ResourceGraphDefinitions from CloudFormation, Terraform, and Pulumi code"
```

### Running the Transformation

```bash
# Full run: adopt everything, kro for modules/stacks
atx custom def exec \
  -n ack-resource-adoption-from-iac \
  -p /path/to/customer-iac-repo \
  -x -t \
  --configuration 'additionalPlanContext=Adopt all resources.'

# Scope to a module, flat manifests only
atx custom def exec \
  -n ack-resource-adoption-from-iac \
  -p /path/to/customer-iac-repo \
  -x -t \
  --configuration 'additionalPlanContext=Adopt only the networking module. Skip kro, flat manifests only.'
```

### Expected Output

```text
ack-adoption/
├── <service>-<kind>-<name>.yaml     # one ACK adoption manifest per flat resource
├── rgd-<module-name>.yaml           # one kro RGD per module/nested stack
├── instance-<name>.yaml             # one instance CR per module instantiation
ADOPTION_REPORT.md                   # inventory, skips, discovery items, prerequisites,
                                     # apply order, IaC decommission guidance
```

### Applying the Output (customer-side, after review)

```bash
# 1. Resolve every TODO(discovery) item listed in ADOPTION_REPORT.md
# 2. Follow the report's dependency-sorted apply order, e.g.:
kubectl apply -f ack-adoption/rgd-messaging.yaml          # RGDs first (if any)
kubectl apply -f ack-adoption/iam-role-app.yaml           # then IAM/KMS
kubectl apply -f ack-adoption/vpc-app-vpc.yaml            # then network
kubectl apply -f ack-adoption/dynamodb-table-orders.yaml  # then data stores

# 3. Validate adoption per resource
kubectl describe table orders   # expect ACK.Adopted=True, ACK.ResourceSynced=True
```

## Benchmarks

End-to-end test results - repositories tested via `atx custom def exec`, what was detected, what was generated, and what passed/failed - are documented in [BENCHMARKS.md](BENCHMARKS.md).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `atx custom def publish` fails with authentication error | AWS Transform CLI not authenticated | Re-run the auth flow from the [Getting Started Guide](https://docs.aws.amazon.com/transform/latest/userguide/custom-get-started.html) |
| Generated manifest has `REPLACE_ME` in `adoption-fields` | Identifier only resolvable against the live account (computed value, runtime `!Ref`) | Run the AWS CLI command in the adjacent `TODO(discovery)` comment and replace the placeholder before applying |
| Applying a manifest creates a NEW resource instead of adopting | Spec identifier does not match the deployed resource (wrong name/ID), so `adopt-or-create` fell through to create | Delete the new CR (retain policy protects AWS), fix the identifier from the discovery command, re-apply |
| CR stuck with `ACK.Recoverable: True` | Controller lacks IAM permissions for the target service, or throttling | Check the IRSA/Pod Identity role against the report's prerequisite checklist |
| CR shows `ACK.Terminal: True` | A spec field is invalid or diverges incompatibly from the deployed resource | Compare the spec with the live resource (`aws <service> describe-*`) and align the field |
| Adoption never happens (CR created, no `ACK.Adopted` condition) | `ResourceAdoption` feature gate disabled (default on self-managed Helm installs) | `helm upgrade ... --set featureGates.ResourceAdoption=true` - or use EKS Capabilities where it is on by default |
| RGD applied but instance CR rejected | kro serves the instance API only after the RGD reaches `state: Active` | `kubectl get rgd <name>` and wait for Active before applying instances |
| ACK attempts unexpected AWS updates right after adoption | Generated spec diverges from the deployed state (`adopt-or-create` reconciles post-adoption) | Review the diff in the controller logs; align the spec with reality, or switch that resource to `adoption-policy: adopt` + `read-only: "true"` for observation-only |

## Known Limitations

| Limitation | Notes |
|---|---|
| Resources without a GA ACK controller | Flagged in the report with guidance, never guessed (e.g., CloudWatch Log Groups, classic ASGs) |
| Computed/runtime identifiers | Cannot be resolved from code alone - emitted as `TODO(discovery)` with the exact CLI command, listed in the report |
| Pulumi dynamic providers and heavy runtime logic | Only statically analyzable `@pulumi/aws` / `pulumi_aws` resource declarations are mapped |
| IaC decommissioning | Documented as manual post-adoption guidance (e.g., `terraform state rm`, CFN `DeletionPolicy: Retain` + stack delete) - never automated |
| Cross-repo module sources | Terraform registry/git module sources are resolved only when vendored in the repo; otherwise the module boundary is reported for manual RGD design |
| kro API stability | kro is under active development (`v1alpha1`) - pin the kro version and validate RGDs against your installed release |

## Documentation & References

| File | Description |
|---|---|
| [SKILL.md](SKILL.md) | Complete transformation definition - objective, scope, workflow, and exit criteria |
| [references/iac-to-ack-mapping.md](references/iac-to-ack-mapping.md) | CFN/Terraform/Pulumi -> ACK Kind mapping table, fold rules, identifier resolution order |
| [references/adoption-fields-ref.md](references/adoption-fields-ref.md) | Per-Kind `adoption-fields` requirements with discovery commands |
| [references/kro-patterns.md](references/kro-patterns.md) | Module/nested stack -> ResourceGraphDefinition translation rules and anti-patterns |
| [references/examples-iac-to-ack.md](references/examples-iac-to-ack.md) | 6 worked before/after examples covering all major patterns |
| [BENCHMARKS.md](BENCHMARKS.md) | End-to-end test results with real repositories |

**External documentation:**

- [ACK ResourceAdoption feature gate](https://aws-controllers-k8s.github.io/community/docs/user-docs/features/)
- [ACK deletion policy](https://aws-controllers-k8s.github.io/community/docs/user-docs/deletion-policy/)
- [kro documentation](https://kro.run/docs/overview)

## Repository Structure

```text
ack-resource-adoption-from-iac/
├── README.md                          # This file - overview, getting started, troubleshooting
├── SKILL.md                           # Transformation definition: objective, scope, workflow, exit criteria
├── BENCHMARKS.md                      # End-to-end test results with real repositories
└── references/
    ├── iac-to-ack-mapping.md          # IaC type -> ACK Kind mapping + fold rules
    ├── adoption-fields-ref.md         # Per-Kind adoption-fields reference with discovery commands
    ├── kro-patterns.md                # Module/stack -> kro RGD translation rules
    └── examples-iac-to-ack.md         # 6 worked before/after examples
```
