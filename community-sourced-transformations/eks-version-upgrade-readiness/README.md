# EKS Version Upgrade Readiness

Analyzes and transforms customer code (Kubernetes manifests, Helm charts, Kustomize overlays, Terraform, and CDK) for compatibility with a target Amazon EKS/Kubernetes version — detecting removed/deprecated APIs, updating `apiVersion` fields and resource structures, validating addon compatibility, checking rollback readiness, and producing a migration report with clear manual action items.

**Supports Kubernetes manifests · Helm charts · Kustomize overlays · Terraform · AWS CDK**

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [What This Skill Does](#what-this-skill-does)
- [Skill Architecture](#skill-architecture)
- [Code Readiness vs. Cluster Upgrade Execution](#code-readiness-vs-cluster-upgrade-execution)
- [Rollback Readiness](#rollback-readiness)
- [Getting Started](#getting-started)
- [Getting Started with AWS Transform Custom](#getting-started-with-aws-transform-custom)
- [Benchmarks](#benchmarks)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [Documentation & References](#documentation--references)
- [Repository Structure](#repository-structure)

## Overview

Amazon EKS requires sequential minor-version upgrades (one hop at a time), and each hop can remove Kubernetes APIs, deprecate EKS-specific behavior, or break addon compatibility. This skill focuses on the **code** side of that problem: the manifests, charts, and IaC that run on the cluster, not the cluster upgrade itself.

Given a target EKS version (and optionally a source version), the skill scans the repository, maps every deprecated or removed API against the upgrade path, transforms what it can automatically, and documents everything it cannot with a clear rationale and recommended action.

## The Problem

Teams preparing for an EKS version upgrade face:

- **Removed APIs breaking deploys**: `extensions/v1beta1` Ingress, `policy/v1beta1` PodDisruptionBudget, `batch/v1beta1` CronJob, and dozens of other GroupVersions removed across Kubernetes 1.16-1.36.
- **Structural, not just cosmetic, changes**: replacing `apiVersion` alone isn't enough — Ingress backend structure, CRD schema requirements, and webhook defaults all change shape between versions.
- **EKS-specific breakage not covered by upstream docs**: AL2 AMI discontinuation, StorageClass default annotation removal, new required IAM permissions, anonymous auth restrictions.
- **Addon version drift**: VPC CNI, CoreDNS, EBS CSI Driver, and other addons have minimum version requirements per EKS release that are easy to miss.
- **No single source of truth spanning the full upgrade path**: multi-hop upgrades (e.g., 1.28 -> 1.32) accumulate breaking changes from every intermediate version.
- **A rollback path that the code can silently invalidate**: with EKS Version Rollback, a change that is correct for the target version can be the reason a rollback is refused three days later.

## What This Skill Does

1. **Scan** the repository for Kubernetes manifests (`.yaml`/`.yml`), Helm charts (`Chart.yaml`, `templates/`), Kustomize overlays (`kustomization.yaml`), Terraform files (`.tf` with `aws_eks_*` resources), and CDK code (TypeScript/Python EKS constructs).
2. **Detect** incompatibilities for the source -> target version range:
   - Removed and soon-to-be-removed API versions
   - Structural field changes (renames, new required fields)
   - EKS-specific changes (AMI type deprecation, StorageClass defaults, IAM requirements)
   - Addon version incompatibilities (VPC CNI, EBS CSI, CoreDNS, kube-proxy, and others)
   - Rollback blockers: target-only APIs, fields and enum values that do not exist in N-1
   - Disruption controls that stall node replacement (NodePool disruption budgets, `karpenter.sh/do-not-disrupt`, PDBs with `maxUnavailable: 0`)
3. **Transform** automatically:
   - Update `apiVersion` fields to the replacement API
   - Restructure fields that changed shape (e.g., Ingress backend)
   - Add newly required fields with sensible defaults (e.g., `pathType: Prefix`)
   - Update Terraform `ami_type` from AL2 to AL2023 for 1.33+ targets
   - Update Terraform/CDK cluster version strings
   - Annotate every target-only change as rollback-blocking
4. **Validate** transformed output:
   - `kubectl apply --dry-run=client` on manifests (if kubectl is available)
   - `helm template` on charts (if Helm is available)
   - `terraform validate` on `.tf` files (if Terraform is available)
5. **Report** — generate `MIGRATION_REPORT.md` with:
   - Summary of automatic changes
   - Items requiring manual intervention (e.g., PodSecurityPolicy migration)
   - Addon compatibility warnings with recommended versions
   - Risk assessment (low/medium/high) per change
   - An **Upgrade Execution Path** section listing every sequential hop required, since EKS does not support skip-version upgrades
   - A **Rollback Readiness** section: N-1 verdict per change, disruption blockers with their mapped insight severity, the Fargate caveat, and `rollbackConfig` support per IaC tool

## Skill Architecture

```text
Input: Customer repo + target EKS version (via additionalPlanContext)
  |
  +-- 1. Scan    -> identify all manifests/charts/configs
  +-- 2. Detect  -> map deprecated/removed APIs across the full upgrade path
  +--               + rollback blockers and disruption controls
  +-- 3. Transform -> update apiVersions, fields, and configs automatically
  +-- 4. Validate  -> dry-run / helm template / terraform validate
  +-- 5. Report    -> MIGRATION_REPORT.md with manual action items
```

### Key Design Decisions

1. **Code readiness, not cluster upgrade.** This skill never touches the running cluster or executes an upgrade — it prepares the code that runs on it. Cluster upgrade orchestration is a separate concern (see below).
2. **Never remove, only transform.** Resources are never deleted. Ambiguous transformations are flagged with a TODO comment and documented in the report rather than guessed.
3. **PodSecurityPolicy is flag-only.** PSP removal (EKS 1.25+) requires a Pod Security Admission design decision that cannot be automated safely — it is always reported, never auto-migrated.
4. **Sequential-hop awareness.** EKS requires upgrading one minor version at a time. The skill always documents every intermediate hop in the target version string, even when transforming code directly to the final target.
5. **Rollback is a report dimension, never an action.** The skill classifies each change against N-1 and flags disruption blockers, but it never calls a cluster API and never decides whether to roll back. Rollback tables are also bounded to versions still in support, so the reference material self-prunes instead of growing without limit.

## Code Readiness vs. Cluster Upgrade Execution

Preparing for an EKS version upgrade has two distinct halves — this skill covers only the first:

| | Scope |
|---|---|
| **This skill** | The **code**: manifests, Helm charts, Terraform, CDK — everything that runs on the cluster |
| **Cluster upgrade execution** | The **cluster**: control plane + data plane version upgrades, staged rollouts, maintenance windows — see [EKS cluster upgrade best practices](https://docs.aws.amazon.com/eks/latest/best-practices/cluster-upgrades.html) and [EKS Upgrade Insights](https://docs.aws.amazon.com/eks/latest/userguide/cluster-insights.html) |

Used together they provide end-to-end upgrade readiness: code prepared ahead of time, then the cluster upgraded through a sequential, validated process. `MIGRATION_REPORT.md` documents the full sequential Upgrade Execution Path and points to the official EKS upgrade guidance as the execution reference.

## Rollback Readiness

[Amazon EKS Version Rollback](https://docs.aws.amazon.com/eks/latest/userguide/rollback-cluster.html) reverts the control plane one minor version (N to N-1) within 7 days of an in-place upgrade, gated by [`ROLLBACK_READINESS` cluster insights](https://docs.aws.amazon.com/eks/latest/userguide/cluster-insights.html). That makes backward compatibility a **code** requirement: during the window, what is deployed has to be valid on both versions.

Three reasons this belongs in a code-readiness skill:

| | |
|---|---|
| **Timing** | Rollback readiness insights only run **after** the upgrade, and only for 7 days. This skill runs **before**, so a blocker can be designed around instead of discovered during an incident. |
| **Coverage** | The insights check **EKS-managed add-ons only** (CoreDNS, VPC CNI, kube-proxy), and not even those when the version was overridden outside the add-on lifecycle. Karpenter, the AWS Load Balancer Controller, Istio, Argo CD and cluster-autoscaler are the customer's responsibility — and this skill already reads their manifests and Helm values. |
| **Surface** | Four of the EKS Auto Mode checks are plain YAML the skill already parses: NodePool disruption budgets, `karpenter.sh/do-not-disrupt` on pods, PodDisruptionBudgets, and node annotations. The same controls throttle the **data plane upgrade**, so the check pays off even when no rollback is planned. |

What the report adds:

- **An N-1 verdict per change** — `safe on both` or `target-only (closes the rollback window)`. Target-only changes are still applied; the target version is what was requested. They are annotated in the code, not silently suppressed.
- **Disruption blockers with the mapped insight severity** — a NodePool budget of `nodes: "0"` covering `Drifted` and a `karpenter.sh/do-not-disrupt` annotation on a node are `ERROR` (they block); a do-not-disrupt annotation on a pod and a PDB with `maxUnavailable: 0` are `WARNING` (they delay). Note that `--force` bypasses insight checks only — disruption controls are always honored.
- **The Fargate caveat** — Fargate worker nodes cannot roll back; Fargate pods trigger the kubelet skew insight as an `ERROR`.
- **`rollbackConfig` support per IaC tool** — CloudFormation supports it, CDK exposes it on the L1 `CfnCluster` only, and the Terraform AWS provider has no `rollback_config` argument at all (verified 2026-08-18), so there it is reported rather than transformed.
- **A staged sequence that preserves the window** — add-ons cross-compatible with N-1/N/N+1, then control plane, then a bake period, then data plane.

Scope boundary: the skill never calls `update-cluster-version`, `list-insights`, `describe-insight`, or `cancel-update`. Full detail, including the per-version table of what was **added** in each release, is in [references/rollback-readiness.md](references/rollback-readiness.md).

## Getting Started

### Prerequisites

| Tool | Purpose |
|---|---|
| AWS Transform CLI (`atx`) | Execute the skill |
| `kubectl` (optional) | Manifest dry-run validation |
| `helm` (optional) | Chart template validation |
| `terraform` (optional) | `.tf` validation |

> If `kubectl`, `helm`, or `terraform` are not installed on the machine running the skill, the corresponding validation step is skipped and reported as unavailable.

### Getting Started with AWS Transform Custom

To set up the AWS Transform CLI, configure authentication, and run your first transformation, see the [AWS Transform Custom Getting Started Guide](https://docs.aws.amazon.com/transform/latest/userguide/custom-get-started.html).

### Cloning the Repo and Publishing the Transformation

```bash
git clone https://github.com/aws-samples/aws-transform-custom-samples
cd aws-transform-custom-samples/community-sourced-transformations

atx custom def publish -n eks-version-upgrade-readiness \
    --sd eks-version-upgrade-readiness \
    --description "Analyzes and transforms Kubernetes manifests, Helm charts, Terraform, and CDK code for Amazon EKS version upgrade compatibility"
```

### Running the Transformation

```bash
# Full run: analysis + transform
atx custom def exec \
  -n eks-version-upgrade-readiness \
  -p /path/to/customer-repo \
  -x -t \
  --configuration 'additionalPlanContext=Target EKS version 1.32. Upgrade from 1.28.'

# Analysis only — no files modified, report only
atx custom def exec \
  -n eks-version-upgrade-readiness \
  -p /path/to/customer-repo \
  -x -t \
  --configuration 'additionalPlanContext=Target EKS version 1.32. Analysis only - do not modify files. Generate report.'
```

### Expected Output

```text
MIGRATION_REPORT.md   # summary, manual action items, addon warnings, risk assessment,
                       # Upgrade Execution Path (sequential hops), and Rollback Readiness
```

Plus the transformed manifests/charts/Terraform/CDK files in place, with ambiguous changes marked via `TODO` comments and rollback-blocking changes annotated.

## Benchmarks

End-to-end test results — repositories tested via `atx custom def exec`, what was detected, what was transformed, and what passed/failed — are documented in [BENCHMARKS.md](BENCHMARKS.md).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `atx custom def publish` fails with authentication error | AWS Transform CLI not authenticated | Re-run the auth flow from the [Getting Started Guide](https://docs.aws.amazon.com/transform/latest/userguide/custom-get-started.html) and confirm your builder ID / IAM Identity Center session is active |
| Transformation runs but no files are modified | `additionalPlanContext` contains "Analysis only" wording, or no incompatible APIs were found for the target version | Check `MIGRATION_REPORT.md` — if the detection table is empty, the repo is already compatible; otherwise remove the analysis-only instruction |
| Target version not respected (wrong APIs flagged) | Source/target versions missing or ambiguous in `additionalPlanContext` | Pass both explicitly: `additionalPlanContext=Target EKS version 1.32. Upgrade from 1.28.` |
| Validation steps reported as skipped | `kubectl`, `helm`, or `terraform` not installed on the machine running the transformation | Install the missing tool or accept the skip — validation is best-effort and the transform output is unaffected |
| Helm chart values not updated | By design — `values.yaml` structure and keys are preserved; only addon image tags below the minimum compatible version are bumped | Review the addon warnings section of `MIGRATION_REPORT.md` for manual value updates |
| PodSecurityPolicy still present after the run | By design — PSP migration requires a Pod Security Admission decision and is never automated | Follow the manual action item in `MIGRATION_REPORT.md` |
| Rollback Readiness section is empty or says "not applicable" | One or both versions of the hop are outside EKS standard/extended support, so a rollback is not available | Expected — confirm against the [EKS release calendar](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html) |
| A change is applied even though it is flagged as rollback-blocking | By design — the target version is what was requested; the finding is informational so the change can be scheduled after the 7-day window | Review the Rollback Readiness section and decide when to land those changes |

## Known Limitations

| Limitation | Notes |
|---|---|
| PodSecurityPolicy migration | Never auto-migrated (requires Pod Security Admission design decisions) — flagged in report only |
| Custom admission webhooks with non-standard defaults | Flagged for manual review, not transformed |
| Skip-version upgrades | Not supported by EKS itself; the skill always documents the full sequential path |
| Cluster-level upgrade execution | Out of scope — follow the [EKS cluster upgrade best practices](https://docs.aws.amazon.com/eks/latest/best-practices/cluster-upgrades.html) for orchestration |
| Rollback execution and live eligibility | Out of scope — no cluster API is ever called. The skill reports the code-side pre-flight only; actual eligibility comes from `ROLLBACK_READINESS` insights on the cluster |
| Rollback analysis outside the supported-version window | Deliberately not evaluated. A rollback needs both N and N-1 in standard or extended support, so the reference tables only cover that range and rows are removed as versions age out |
| Node-level rollback blockers | `karpenter.sh/do-not-disrupt` on a **node** is cluster state, not repository code — reported as guidance, not detected |
| Terraform `rollback_config` | The AWS provider has no such argument (verified 2026-08-18), so the rollback timeout cannot be expressed in Terraform — reported, not transformed |

## Documentation & References

| File | Description |
|---|---|
| [SKILL.md](SKILL.md) | Complete skill definition — objective, scope, workflow, and validation criteria |
| [references/api-removals-by-version.md](references/api-removals-by-version.md) | Complete table of Kubernetes API removals per version (1.16 through 1.36), plus a quick "upgrading from X to Y" lookup |
| [references/eks-specific-changes.md](references/eks-specific-changes.md) | EKS-specific changes per version, disruption controls, addon compatibility matrix, and Terraform/CDK/Helm update patterns |
| [references/rollback-readiness.md](references/rollback-readiness.md) | Inverse lookup of what was **added** per version, Auto Mode disruption blockers with insight severity, add-on cross-compatibility strategy, and `rollbackConfig` support per IaC tool |
| [references/examples-before-after.md](references/examples-before-after.md) | 12 concrete before/after transformation examples covering Ingress, PDB, CronJob, HPA, FlowSchema, CRDs, Terraform node groups, webhooks, NodePool disruption budgets, rollback-blocking API adoption, and IP/CIDR canonicalization |
| [BENCHMARKS.md](BENCHMARKS.md) | End-to-end test results: repositories tested, detections, transformations, and pass/fail outcomes |

## Repository Structure

```text
eks-version-upgrade-readiness/
├── README.md                              # This file — overview, getting started, troubleshooting
├── SKILL.md                               # Skill definition: objective, scope, workflow, exit criteria
├── BENCHMARKS.md                          # End-to-end test results with real repositories
└── references/
    ├── api-removals-by-version.md         # Kubernetes API removals per version (1.16–1.36)
    ├── eks-specific-changes.md            # EKS-specific changes, disruption controls, addon matrix
    ├── rollback-readiness.md              # What was ADDED per version, Auto Mode blockers, rollbackConfig
    └── examples-before-after.md           # 12 before/after transformation examples
```
