---
name: eks-version-upgrade-readiness
description: >-
  Analyzes and transforms Kubernetes manifests, Helm charts, Kustomize
  overlays, Terraform, and AWS CDK code for Amazon EKS version upgrade
  compatibility. Detects removed and deprecated APIs, updates apiVersions
  and resource fields, validates addon compatibility, and generates a
  migration report with manual action items and a sequential upgrade path.
  Trigger: EKS upgrade, Kubernetes version upgrade, API deprecation,
  apiVersion migration, addon compatibility.
---

# EKS Version Upgrade Readiness

## Objective

Prepare a customer's code (manifests, charts, IaC) for an Amazon EKS/Kubernetes version upgrade by detecting and transforming deprecated or removed APIs, EKS-specific breaking changes, and addon incompatibilities — producing a migration report that documents everything the worker cannot safely automate.

## Scope

Analyzes and transforms:
- Kubernetes manifests (`.yaml`, `.yml`)
- Helm charts (`Chart.yaml`, `templates/`)
- Kustomize overlays (`kustomization.yaml`)
- Terraform files (`.tf` with `aws_eks_cluster`, `aws_eks_node_group`, and related resources)
- AWS CDK code (TypeScript/Python EKS constructs)

Supports upgrades between any EKS versions from 1.16 through 1.36+.

**Non-Goals** (out of scope for this skill):
1. Executing the actual cluster upgrade (control plane / data plane) — use the Upgrade Controller for Amazon EKS (https://gitlab.aws.dev/brunemat/eks-upgrade-controller) for automated sequential upgrades with maintenance windows, staged rollouts, and EKS Upgrade Insights validation.
2. PodSecurityPolicy migration — removed entirely in Kubernetes 1.25. Requires a Pod Security Admission or third-party webhook design decision that cannot be automated safely. Always flagged in the report, never transformed.
3. Custom admission webhook business logic — only the `admissionregistration.k8s.io` API shape and required defaults are updated; webhook implementation logic is out of scope.
4. Non-EKS Kubernetes distributions — API removal mapping is upstream Kubernetes, but EKS-specific sections (AMI types, addon matrix, IAM requirements) assume Amazon EKS.

## Constraints

### Correctness
- Never remove resources — only transform them in place.
- Preserve all comments, labels, and annotations.
- If a transformation is ambiguous, add a `TODO` comment in the code and document the ambiguity in `MIGRATION_REPORT.md` rather than guessing.

### Sequential Upgrade Awareness
- Amazon EKS requires upgrading one minor version at a time — skip-version upgrades are not supported.
- Terraform/CDK `cluster_version` / `KubernetesVersion` strings are set to the TARGET version in code (the code itself must be forward-compatible), but `MIGRATION_REPORT.md` must always list each intermediate sequential hop required to get there.
- `MIGRATION_REPORT.md` must include a section "Upgrade Execution Path" listing every hop and recommending the Upgrade Controller for Amazon EKS as the execution mechanism — this skill never executes the upgrade itself.

### Helm-Specific
- Transform templates but preserve the `values.yaml` structure and keys.
- Only update addon image tags in values when the current tag is clearly below the minimum compatible version for the target EKS release (see addon compatibility matrix in `references/eks-specific-changes.md`).

### Reporting
- Every automatic change and every manual action item must be traceable to a specific file and line.
- Risk assessment (low/medium/high) is required per change in the report — not just a flat list.

## Workflow

```text
Phase 0: Detect source and target versions
  ├── Read additionalPlanContext for explicit source/target versions
  └── If source not specified, detect from existing cluster_version / apiVersion usage

Phase 1: Scan
  ├── Identify all manifests, charts, Kustomize overlays, Terraform, CDK files
  └── Build an inventory of resource kinds and current apiVersions per file

Phase 2: Detect incompatibilities
  ├── Map every apiVersion against references/api-removals-by-version.md
  │     for each version between source and target (inclusive)
  ├── Map EKS-specific changes against references/eks-specific-changes.md
  └── Check addon versions (VPC CNI, CoreDNS, kube-proxy, EBS/EFS CSI,
        AWS LB Controller, etc.) against the compatibility matrix

Phase 3: Transform
  ├── Update apiVersion fields to the replacement API
  ├── Restructure fields that changed shape (see references/examples-before-after.md)
  ├── Add newly required fields with sensible defaults
  ├── Update Terraform ami_type (AL2 -> AL2023) for 1.33+ targets
  └── Update Terraform/CDK cluster version strings to the target version

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
        - Upgrade Execution Path (sequential hops + Upgrade Controller recommendation)
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

Full example set (8 transformations covering Ingress, PodDisruptionBudget, CronJob, HorizontalPodAutoscaler, FlowSchema, CustomResourceDefinition, Terraform node groups, and admission webhooks) is in `references/examples-before-after.md`.

## Reference Dispatch

Load reference files on demand based on what the scan finds:

| Signal | Reference File |
|---|---|
| Any `apiVersion` field in a manifest, chart template, or Kustomize resource | `references/api-removals-by-version.md` |
| `aws_eks_cluster`, `aws_eks_node_group`, `ami_type`, EKS CDK constructs, addon image tags | `references/eks-specific-changes.md` |
| Any detected incompatibility requiring a concrete before/after transformation | `references/examples-before-after.md` |

## Validation / Exit Criteria

1. Every `apiVersion` used in the repository is valid for the target EKS version (no removed APIs remain).
2. Every automatic transformation preserves original comments, labels, and annotations.
3. No resource was deleted — only transformed.
4. Ambiguous transformations are marked with a `TODO` comment in code and documented in the report.
5. PodSecurityPolicy usage, if present, is flagged in the report and NOT auto-migrated.
6. `kubectl apply --dry-run=client`, `helm template`, and/or `terraform validate` pass for all transformed files (for whichever tools are available on the host).
7. `MIGRATION_REPORT.md` exists and contains: summary of changes, manual action items, addon compatibility warnings, risk assessment per change, and an Upgrade Execution Path section.
8. The Upgrade Execution Path lists every sequential minor-version hop between source and target and recommends the Upgrade Controller for Amazon EKS as the execution mechanism.

## Tips

- EKS does not support skip-version cluster upgrades — always resolve the full source-to-target version range before scanning for API removals, even if you only need to report on the final target.
- AL2 AMIs stopped being released starting with EKS 1.33 — any node group or launch template still using `AL2_x86_64`/`AL2_ARM_64` targeting 1.33+ needs an `ami_type` update to AL2023 or Bottlerocket.
- An empty `policy/v1` PodDisruptionBudget selector (`{}`) selects ALL pods in the namespace — this is a behavior change from `policy/v1beta1` (which selected none) and must be called out explicitly in the report, not just transformed silently.
