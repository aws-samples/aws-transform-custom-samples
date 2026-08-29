---
name: openshift-to-eks
description: >-
  Transforms Red Hat OpenShift application manifests, Helm charts, Kustomize overlays
  and Templates into portable Kubernetes suitable for Amazon EKS. Converts
  DeploymentConfig, ImageStream references, Routes and OpenShift Templates, resolves
  SecurityContextConstraints to Pod Security Admission, and produces a migration report
  covering everything that cannot be automated safely.
  Trigger: OpenShift migration, OpenShift to EKS, DeploymentConfig, Route, SCC, BuildConfig.
type: custom
version: 0.1.0
---

# OpenShift to Amazon EKS

## Objective

Convert a repository built for Red Hat OpenShift into portable Kubernetes that applies on
Amazon EKS, and document in `MIGRATION_REPORT.md` everything the transformation cannot do
safely. The paired assessment `openshift-to-eks-migration-readiness` decides **which** repos to
run this on and what blocks them; this definition executes the change on **one** repo.

## Scope

Transforms:

- OpenShift manifests (`apps.openshift.io`, `image.openshift.io`, `route.openshift.io`,
  `template.openshift.io`)
- Helm charts whose templates emit OpenShift kinds
- Kustomize overlays referencing OpenShift kinds
- OpenShift `Template` objects (`objects:` + `parameters:`)

**Non-Goals** - always reported, never transformed:

1. **BuildConfig and S2I.** There is no in-cluster build on EKS by default. Converting a build
   pipeline requires choosing a target (CodeBuild, GitHub Actions, Kaniko, Buildpacks) and an
   S2I `assemble`/`run` contract cannot be mechanically turned into a `Dockerfile` without
   inventing behaviour. Emits a scaffold plus a report item.
2. **ClusterResourceQuota.** No Kubernetes equivalent exists. Per-namespace quotas are a
   different guarantee (sum of maximums, not a shared pool) and substituting them silently would
   remove a control the customer believes they still have.
3. **SR-IOV, Multus, PerformanceProfile, MachineConfig, Tuned.** Node and hardware coupling.
   Emits a Karpenter `NodePool` scaffold with the observed constraints as comments; never
   asserts equivalence.
4. **Operators and OLM.** Availability has to be checked per operator. Reported by bucket.
5. **EgressIP and EgressFirewall.** Deterministic egress is a VPC and firewall design decision,
   not a manifest translation.
6. **Application code.** Anything reading `VCAP_SERVICES`-style platform env, or the OpenShift
   OAuth proxy, is flagged, not rewritten.
7. **Executing the migration.** This produces code. It never applies to a cluster.

## Constraints

### Correctness

- **Never delete a resource.** Transform in place, or leave it and report it.
- **Preserve every comment, label and annotation** that is not OpenShift-specific. An annotation
  that only OpenShift consumes (`haproxy.router.openshift.io/*`) moves into the report so its
  intent is not lost.
- **If a transformation is ambiguous, do not guess.** Add a `TODO(migration)` comment at the
  exact site and a report entry. A wrong manifest is worse than an annotated gap, because it
  applies cleanly and fails later.
- **Never invent a mapping.** A construct with no equivalent is reported, not approximated.
  This is the same rule that made `ack-resource-adoption-from-iac` degrade an unmapped
  CloudFormation type to report-only instead of fabricating a Kind.

### Source integrity

- The original OpenShift manifests are **left in place**, untouched. Converted output is written
  alongside under `eks/`, so the diff is additive and reviewable.
- Stay on the current branch. Do not create, switch or checkout a branch.

### Reporting

- Every automatic change and every manual action item traceable to file and line.
- Risk per change (low / medium / high), never a flat list.
- The report states what was **not** converted and why, by construct.

## Workflow

```text
Phase 0: Read additionalPlanContext
  ├── migration_target: eks-standard | eks-auto-mode | eks-hybrid   (default eks-standard)
  ├── ingress_strategy: gateway-api | alb-ingress                   (default gateway-api)
  ├── registry: the ECR registry base URI to rewrite images to      (required for APP mappings)
  └── namespace: target namespace if it differs from the OpenShift project

Phase 1: Inventory
  ├── Every manifest, chart, overlay and Template, with its kinds and apiVersions
  ├── Classify each: MECHANICAL / SCAFFOLD / REPORT-ONLY (see references/01-construct-mapping.md)
  └── Record the inventory in the report BEFORE transforming, so nothing is silently skipped

Phase 2: Transform the MECHANICAL set
  ├── DeploymentConfig -> Deployment (lifecycle hooks -> report + TODO)
  ├── ImageStreamTag reference -> fully qualified registry URI
  ├── Route -> HTTPRoute + Gateway, or Ingress + ALB annotations
  ├── Template -> Helm chart (values from parameters) or Kustomize
  ├── PVC storageClassName -> gp3, or efs when accessModes includes ReadWriteMany
  └── OpenShift-only node labels -> the target NodePool's labels

Phase 3: Emit SCAFFOLDS for the partly-automatable set
  ├── SCC -> Pod Security Admission namespace labels, plus a Kyverno policy ONLY for the
  │     capabilities PSA cannot express (never a blanket policy engine dependency)
  ├── BuildConfig -> a buildspec or Dockerfile skeleton, clearly marked incomplete
  └── PerformanceProfile / MachineConfig -> Karpenter NodePool with observed constraints
        as comments

Phase 4: Validate what can be validated locally
  ├── every emitted YAML parses
  ├── kubectl apply --dry-run=client (server-side if a cluster is reachable)
  ├── helm template / kustomize build when charts or overlays were emitted
  └── no OpenShift apiVersion survives in eks/ (grep assertion)

Phase 5: MIGRATION_REPORT.md
  ├── Inventory with the classification of every construct found
  ├── Automatic changes, per file
  ├── Manual action items, per construct, with the reason it could not be automated
  ├── Risk per change
  └── Residual blockers, cross-referenced to the readiness Lens question ids
```

## Exit Criteria

1. Every construct in the Phase 1 inventory appears in the report with its classification.
   Nothing silently skipped.
2. Original OpenShift manifests byte-identical; all output under `eks/`.
3. Zero `*.openshift.io` apiVersions in the emitted output.
4. Every emitted YAML parses; `--dry-run=client` clean.
5. Every REPORT-ONLY construct has a report entry naming the construct, the reason, and the
   recommended path.
6. Every ambiguity carries a `TODO(migration)` at the site **and** a report entry. One without
   the other is a defect.
7. `MIGRATION_REPORT.md` cross-references the Lens question ids, so an estate that ran the
   assessment can join the two.
