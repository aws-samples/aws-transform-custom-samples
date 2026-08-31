---
name: eks-version-upgrade-readiness
description: >-
  Analyzes and transforms Kubernetes manifests, Helm charts, Kustomize
  overlays, Terraform, and AWS CDK code for Amazon EKS version upgrade
  compatibility. Detects removed and deprecated APIs, updates apiVersions
  and resource fields, validates addon compatibility, checks rollback
  readiness (N-1 compatibility and disruption controls), and generates a
  migration report with manual action items and a sequential upgrade path.
  Trigger: EKS upgrade, Kubernetes version upgrade, API deprecation,
  apiVersion migration, addon compatibility, EKS version rollback,
  rollback readiness.
---

# EKS Version Upgrade Readiness

## Objective

Prepare a customer's code (manifests, charts, IaC) for an Amazon EKS/Kubernetes version upgrade by detecting and transforming deprecated or removed APIs, EKS-specific breaking changes, and addon incompatibilities — producing a migration report that documents everything the worker cannot safely automate, including which changes would block an EKS Version Rollback.

## Scope

Analyzes and transforms:
- Kubernetes manifests (`.yaml`, `.yml`)
- Helm charts (`Chart.yaml`, `templates/`)
- Kustomize overlays (`kustomization.yaml`)
- Terraform files (`.tf` with `aws_eks_cluster`, `aws_eks_node_group`, and related resources)
- AWS CDK code (TypeScript/Python EKS constructs)

Supports upgrades between any EKS versions from 1.16 through 1.36+.

Rollback readiness analysis is scoped to EKS versions in standard or extended support, because a rollback requires both sides of the hop (N and N-1) to be supported versions.

**Non-Goals** (out of scope for this skill):
1. Executing the actual cluster upgrade (control plane / data plane) — follow the EKS cluster upgrade best practices (https://docs.aws.amazon.com/eks/latest/best-practices/cluster-upgrades.html) and validate with EKS Upgrade Insights before each sequential hop.
2. Executing or evaluating a rollback on a live cluster. The skill never calls `update-cluster-version`, `list-insights`, `describe-insight`, or `cancel-update`. It produces the code-side pre-flight; the rollback decision and execution belong to the cluster operator.
3. PodSecurityPolicy migration — removed entirely in Kubernetes 1.25. Requires a Pod Security Admission or third-party webhook design decision that cannot be automated safely. Always flagged in the report, never transformed.
4. Custom admission webhook business logic — only the `admissionregistration.k8s.io` API shape and required defaults are updated; webhook implementation logic is out of scope.
5. Non-EKS Kubernetes distributions — API removal mapping is upstream Kubernetes, but EKS-specific sections (AMI types, addon matrix, IAM requirements, rollback behavior) assume Amazon EKS.

## Constraints

### Correctness
- Never remove resources — only transform them in place.
- Preserve all comments, labels, and annotations.
- If a transformation is ambiguous, add a `TODO` comment in the code and document the ambiguity in `MIGRATION_REPORT.md` rather than guessing.

### Sequential Upgrade Awareness
- Amazon EKS requires upgrading one minor version at a time — skip-version upgrades are not supported.
- Terraform/CDK `cluster_version` / `KubernetesVersion` strings are set to the TARGET version in code (the code itself must be forward-compatible), but `MIGRATION_REPORT.md` must always list each intermediate sequential hop required to get there.
- `MIGRATION_REPORT.md` must include a section "Upgrade Execution Path" listing every hop and pointing to the official EKS upgrade guidance (cluster upgrade best practices + EKS Upgrade Insights) as the execution reference — this skill never executes the upgrade itself.

### Rollback Window Awareness
- EKS Version Rollback reverts the control plane one minor version (N to N-1) within 7 days of an in-place upgrade. During that window the deployed code must be valid on **both** versions, so forward compatibility alone is not sufficient.
- Every transformation carries an N-1 verdict: `safe on both` or `target-only (closes the rollback window)`. Classification rules are in `references/rollback-readiness.md`.
- A target-only change is still applied — the target version is what the customer asked for. It is annotated in the code and reported, never silently suppressed and never silently applied.
- Disruption controls found in the repository (NodePool disruption budgets, `karpenter.sh/do-not-disrupt` annotations, PodDisruptionBudgets) are reported with the EKS insight severity they map to: `ERROR` blocks a rollback, `WARNING` delays it. These same controls also throttle the data plane upgrade, so they are reported regardless of rollback intent.
- Rollback checks apply only when both the source and target versions are in EKS standard or extended support. Outside that range, state that rollback is not available rather than evaluating it.

### Helm-Specific
- Transform templates but preserve the `values.yaml` structure and keys.
- Only update addon image tags in values when the current tag is clearly below the minimum compatible version for the target EKS release (see addon compatibility matrix in `references/eks-specific-changes.md`).
- When the rollback window must stay open, the addon target is a cross-compatible **range** (N-1, N, N+1), not just the minimum floor for N.

### Reporting
- Every automatic change and every manual action item must be traceable to a specific file and line.
- Risk assessment (low/medium/high) is required per change — not just a flat list.

## Workflow

```text
Phase 0: Detect source and target versions
  ├── Read additionalPlanContext for explicit source/target versions
  ├── If source not specified, detect from existing cluster_version / apiVersion usage
  └── Determine whether the hop is rollback-eligible (both versions in support)

Phase 1: Scan
  ├── Identify all manifests, charts, Kustomize overlays, Terraform, CDK files
  └── Build an inventory of resource kinds and current apiVersions per file

Phase 2: Detect incompatibilities
  ├── Map every apiVersion against references/api-removals-by-version.md
  │     for each version between source and target (inclusive)
  ├── Map EKS-specific changes against references/eks-specific-changes.md
  ├── Check addon versions (VPC CNI, CoreDNS, kube-proxy, EBS/EFS CSI,
  │     AWS LB Controller, etc.) against the compatibility matrix
  └── Rollback pre-flight (references/rollback-readiness.md):
        ├── target-only APIs, fields and enum values that do not exist in N-1
        ├── disruption controls that block or delay node replacement
        └── Fargate profiles, which cannot roll back at all

Phase 3: Transform
  ├── Update apiVersion fields to the replacement API
  ├── Restructure fields that changed shape (see references/examples-before-after.md)
  ├── Add newly required fields with sensible defaults
  ├── Update Terraform ami_type (AL2 -> AL2023) for 1.33+ targets
  ├── Update Terraform/CDK cluster version strings to the target version
  └── Annotate every target-only change as rollback-blocking

Phase 4: Validate
  ├── kubectl apply --dry-run=client (if kubectl available)
  ├── helm template (if Helm available)
  └── terraform validate (if Terraform available)

Phase 5: Report
  └── Generate MIGRATION_REPORT.md:
        - Summary of automatic changes
        - Manual action items (e.g., PodSecurityPolicy migration)
        - Addon compatibility warnings with recommended versions
        - Risk assessment (low/medium/high) per change
        - Upgrade Execution Path (sequential hops + official EKS upgrade guidance)
        - Rollback Readiness (N-1 verdict per change, disruption blockers with
          insight severity, Fargate caveat, rollbackConfig support per IaC tool)
```

### Configuration

Source and target versions are provided via `additionalPlanContext`:
- `"Target EKS version 1.32. Upgrade from 1.28."`
- `"Upgrade to latest EKS version from 1.30."`

If the source version is not specified, detect it from existing manifests (`apiVersion` usage patterns) or IaC (`cluster_version` / `KubernetesVersion` fields).

## Worked Examples

### Example: Ingress (`extensions/v1beta1` -> `networking.k8s.io/v1`)

**Before (breaks on EKS 1.22+):**
```yaml
apiVersion: extensions/v1beta1
kind: Ingress
spec:
  rules:
    - http:
        paths:
          - path: /
            backend:
              serviceName: my-app-svc
              servicePort: 80
```

**After:**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
spec:
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-svc
                port:
                  number: 80
```

Full example set (12 transformations covering Ingress, PodDisruptionBudget, CronJob, HorizontalPodAutoscaler, FlowSchema, CustomResourceDefinition, Terraform node groups, admission webhooks, Karpenter NodePool disruption budgets, PDBs that stall node replacement, rollback-blocking API adoption, and non-canonical IP/CIDR values) is in `references/examples-before-after.md`.

## Reference Dispatch

Load reference files on demand based on what the scan finds:

| Signal | Reference File |
|---|---|
| Any `apiVersion` field in a manifest, chart template, or Kustomize resource | `references/api-removals-by-version.md` |
| `aws_eks_cluster`, `aws_eks_node_group`, `ami_type`, EKS CDK constructs, addon image tags | `references/eks-specific-changes.md` |
| Any detected incompatibility requiring a concrete before/after transformation | `references/examples-before-after.md` |
| The hop is rollback-eligible, or the repo contains `karpenter.sh/v1` NodePools, PodDisruptionBudgets, `karpenter.sh/do-not-disrupt` annotations, Fargate profiles, or APIs introduced in the target version | `references/rollback-readiness.md` |

## Validation / Exit Criteria

1. Every `apiVersion` used in the repository is valid for the target EKS version (no removed APIs remain).
2. Every automatic transformation preserves original comments, labels, and annotations.
3. No resource was deleted — only transformed.
4. Ambiguous transformations are marked with a `TODO` comment in code and documented in the report.
5. PodSecurityPolicy usage, if present, is flagged in the report and NOT auto-migrated.
6. `kubectl apply --dry-run=client`, `helm template`, and/or `terraform validate` pass for all transformed files (for whichever tools are available on the host).
7. `MIGRATION_REPORT.md` exists and contains: summary of changes, manual action items, addon compatibility warnings, risk assessment per change, an Upgrade Execution Path section, and a Rollback Readiness section.
8. The Upgrade Execution Path lists every sequential minor-version hop between source and target and references the official EKS cluster upgrade best practices as the execution guidance.
9. Every transformation in the report carries an explicit N-1 verdict (`safe on both` or `target-only`), and every target-only change is annotated in the code as rollback-blocking.
10. Every disruption control found in the repository is reported with its mapped insight severity, and no cluster API was called at any point.

## Tips

- EKS does not support skip-version cluster upgrades — always resolve the full source-to-target version range before scanning for API removals, even if you only need to report on the final target.
- AL2 AMIs stopped being released starting with EKS 1.33 — any node group or launch template still using `AL2_x86_64`/`AL2_ARM_64` targeting 1.33+ needs an `ami_type` update to AL2023 or Bottlerocket.
- An empty `policy/v1` PodDisruptionBudget selector (`{}`) selects ALL pods in the namespace — this is a behavior change from `policy/v1beta1` (which selected none) and must be called out explicitly in the report, not just transformed silently.
- EKS Rollback Readiness Insights only run after an upgrade and only for 7 days, and they cover EKS-managed add-ons only. This skill runs before the upgrade and reads self-managed addon manifests, so its rollback findings are additive to what EKS reports, not a duplicate of it.
- Not every `apiVersion` bump is rollback-safe. Moving to a GroupVersion that graduated in the target release (for example `storage.k8s.io/v1` VolumeAttributesClass in 1.34) is correct for the target and simultaneously closes the rollback window — apply it, then say so.
- `--force` on a rollback bypasses insight checks only. PodDisruptionBudgets, NodePool disruption budgets, and do-not-disrupt annotations are always honored, which is why they belong in the code-side report.
