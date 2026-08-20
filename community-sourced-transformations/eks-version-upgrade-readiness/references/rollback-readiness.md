# Rollback Readiness

Amazon EKS Version Rollback lets a cluster administrator revert the control plane by **one**
minor version (N to N-1) within **7 days** of an in-place upgrade. EKS evaluates
`ROLLBACK_READINESS` cluster insights before allowing it.

**Why this matters for code:** forward-compatible is no longer sufficient. During the rollback
window, the code deployed on the cluster must be valid on **both** N and N-1. AWS states it
plainly: if you adopt new APIs or features from the newer version, you must revert those
changes before rolling back.

**Why this skill matters:** Rollback Readiness Insights only exist **after** the upgrade, and
only for 7 days. This skill runs **before** the upgrade, so it can surface the same class of
blocker while there is still time to design around it — and it covers self-managed add-ons,
which the insights explicitly do not check.

---

## Maintenance rule: supported-version window

A rollback requires **both** N and N-1 to be EKS-supported versions. A row for a version
outside support can therefore never be used. So the additions table below covers **only
versions currently in standard or extended support**.

- When a version leaves extended support, **delete its row**.
- Do **not** backfill versions older than the window. That is unbounded maintenance for
  scenarios the API rejects anyway.
- This is the opposite of `api-removals-by-version.md`, which is deliberately historical
  (1.16+) because a customer can be sitting on very old manifests today.

**Window at last review: 2026-08-18 — EKS 1.31 through 1.36.**

| Version | Support status | End of standard | End of extended |
|---|---|---|---|
| 1.36 | Standard | 2027-08-02 | 2028-08-02 |
| 1.35 | Standard | 2027-03-27 | 2028-03-27 |
| 1.34 | Standard | 2026-12-02 | 2027-12-02 |
| 1.33 | Extended | 2026-07-29 | 2027-07-29 |
| 1.32 | Extended | 2026-03-23 | 2027-03-23 |
| 1.31 | Extended | 2025-11-26 | 2026-11-26 |

Re-check against the [EKS Kubernetes release calendar](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)
when updating this file, and update the review date above.

---

## Rollback rules that constrain code

| Rule | Consequence for the repository |
|---|---|
| One minor version only (N to N-1) | There is no "roll back two hops". Code only needs dual validity across a single boundary |
| 7-day window from upgrade completion | Anything adopting target-only APIs should be gated behind a change that lands **after** the window closes |
| Only clusters upgraded **in-place** can roll back | A cluster created at N cannot roll back to N-1 — blue/green migrations have no rollback path |
| Rollback to an extended-support version resumes extended-support charges | Cost note for the report, not a code change |
| Insights with `ERROR` or `UNKNOWN` block the rollback; `WARNING` is advisory | Drives the severity assigned to each finding |
| `--force` bypasses insight checks only | It does **not** override PDBs, NodePool budgets, or do-not-disrupt annotations |
| Insights check EKS-managed add-ons only (CoreDNS, VPC CNI, kube-proxy) | Self-managed add-ons, and managed add-ons whose version was overridden outside the add-on lifecycle, are the customer's responsibility — this skill's addon check is the only pre-flight for them |

---

## Severity: quoted for the cluster, rated by this skill

`ERROR` and `WARNING` in this file are **EKS cluster insight** severities, and they are only
meaningful for findings EKS actually evaluates: the disruption controls in the data plane section
below, and EKS-managed add-ons. In those rows the severity is *quoted* from the Auto Mode rollback
documentation, not chosen here.

Everything in the additions tables works differently. A target-only API adoption has **no
corresponding insight** — EKS does not read the repository — so the `Impact` column (High / Medium /
Low) is this skill's own risk *rating*. Report it that way in `MIGRATION_REPORT.md`: a
rollback-blocking change with a risk rating, and no insight severity attached. Writing "insight
severity: ERROR" beside a manifest finding implies EKS will surface it, which it will not, and sends
the reader hunting for an insight that never appears.

---

## Additions by version (inverse lookup)

What exists in N but **not** in N-1. Adopting any of these closes the rollback door until it
is reverted.

`Kind` legend: **resource** = GroupVersion/kind absent in N-1 · **field** = field absent or
pruned in N-1 · **enum** = new allowed value on an existing field · **gated** = field exists
in N-1 but the feature gate is off, so the value is silently ignored · **behavior** = no
manifest surface.

### Added in 1.36 (blocks rollback to 1.35)

| Item | Kind | Impact | Detect in code |
|---|---|---|---|
| DRA Partitionable Devices, Consumable Capacity, Device Binding Conditions (Beta, on by default) | field | **High** — new fields on `resource.k8s.io` objects | `DeviceClass`/`ResourceClaim`/`ResourceSlice` using partition, consumable-capacity, or binding-condition fields |
| Resource Health Status (Beta) | behavior | Low — Pod `status` only, not authored | n/a |
| User Namespaces (Stable) | gated | Low — `spec.hostUsers` exists since 1.25 and is beta from 1.30 | `hostUsers: false` in Pod specs |

### Added in 1.35 (blocks rollback to 1.34)

| Item | Kind | Impact | Detect in code |
|---|---|---|---|
| Service `spec.trafficDistribution: PreferSameNode` (Stable) | **enum** | **High** — the value does not exist in 1.34; the Service is rejected or the field pruned | `trafficDistribution: PreferSameNode` in Service manifests |
| StatefulSet `spec.updateStrategy.rollingUpdate.maxUnavailable` (Beta) | gated | Medium — silently ignored after rollback, updates revert to one Pod at a time | `maxUnavailable` under a StatefulSet `rollingUpdate` |
| In-Place Pod Resource Updates (Stable) | gated | Low — `resizePolicy` predates 1.35 | `resizePolicy` in container specs |

### Added in 1.34 (blocks rollback to 1.33)

| Item | Kind | Impact | Detect in code |
|---|---|---|---|
| `storage.k8s.io/v1` VolumeAttributesClass (GA) | **resource** | **High** — 1.33 only serves `storage.k8s.io/v1beta1`. Also requires pinning older EBS CSI sidecars on pre-1.34 clusters | `apiVersion: storage.k8s.io/v1` + `kind: VolumeAttributesClass` |
| `resource.k8s.io/v1` DRA core APIs (GA) | **resource** | **High** — 1.33 serves the beta group version only | `apiVersion: resource.k8s.io/v1` on any DRA kind |
| Pod-level resource requests and limits (Beta) | **field** | **High** — Pod `spec.resources` does not exist in 1.33 | `spec.resources` at Pod level (not `spec.containers[].resources`) |
| Mutable CSI Node Allocatable Count (Beta) | behavior | Low — CSINode status, driver-side | n/a |
| External JWT signer for SA tokens (Beta) | behavior | Low — cluster configuration, not repo code | n/a |

### Added in 1.33 (blocks rollback to 1.32)

| Item | Kind | Impact | Detect in code |
|---|---|---|---|
| DRA beta API enabled (`resource.k8s.io/v1beta1`) | **resource** | **High** — not enabled on EKS 1.32, so the objects stop being served after rollback | `apiVersion: resource.k8s.io/v1beta1` (`ResourceClaim`, `ResourceClaimTemplate`, `DeviceClass`, `ResourceSlice`) |
| In-Place Pod Resource Resize (Beta) | gated | Medium — resize requests are ignored after rollback | `resizePolicy` in container specs |
| Sidecar containers (Stable) | gated | Low — available since 1.29 | `initContainers[].restartPolicy: Always` |
| Endpoints API deprecation | behavior | Low — warning only, still served | `kind: Endpoints` |

### Added in 1.32 (blocks rollback to 1.31)

| Item | Kind | Impact | Detect in code |
|---|---|---|---|
| Custom Resource Field Selector (`spec.versions[].selectableFields`) | **field** | **High** — pruned by 1.31, so any consumer filtering on that field breaks | `selectableFields` in a CRD |
| StatefulSet automatic PVC cleanup (GA) | gated | Low — `persistentVolumeClaimRetentionPolicy` is served and enabled well before 1.32 | `persistentVolumeClaimRetentionPolicy` in StatefulSets |
| Memory Manager (GA) | behavior | Low — kubelet-side | n/a |

### Forward-only blockers (upgrade, not rollback)

These break the **upgrade** and are safe on the way back down. They belong in the upgrade
findings, not the rollback section, and must not be reported as rollback blockers.

| Item | Introduced | Effect |
|---|---|---|
| `StrictIPCIDRValidation` on by default | 1.36 | IP/CIDR values with leading zeros (`010.000.000.005`) or ambiguous CIDRs (`192.168.0.5/24`) are rejected on create/update. Stored objects survive via validation ratcheting |
| `gitRepo` volume permanently disabled | 1.36 | The API still accepts the Pod; the kubelet refuses to run it. Migrate to an init container or git-sync sidecar |
| SELinux volume labeling GA | 1.36 | Defaults to `mount -o context` for all volumes. Sharing a volume between privileged and unprivileged Pods can break |
| Service `spec.externalIPs` deprecated | 1.36 | Deprecation warning now, removal planned for 1.43 |

---

## Data plane blockers (EKS Auto Mode)

Auto Mode rolls the **nodes back first**, then the control plane, using Karpenter drift. Every
disruption control the customer authored in the repository is honored — including under
`--force`. These four checks are the highest-value addition to this skill, because they all
live in YAML the skill already reads, and the same controls also throttle the **upgrade**.

| Finding | Insight severity | Effect |
|---|---|---|
| NodePool disruption budget with `nodes: "0"` covering `Drifted` | **ERROR** (blocks) | Rollback never makes progress |
| `karpenter.sh/do-not-disrupt` annotation on a **node** | **ERROR** (blocks) | That node is never replaced; must be removed first |
| `karpenter.sh/do-not-disrupt` annotation on a **pod** | WARNING | Delays node disruption up to the termination grace period |
| PodDisruptionBudget with `maxUnavailable: 0` (or an equivalent `minAvailable`) | WARNING | Delays eviction; does not permanently block |

A restrictive-but-nonzero budget (`nodes: "1"`) is legal and makes forward progress, but on a
large fleet it can push node rollback past the timeout. Report it as a duration risk.

```yaml
# Blocks rollback indefinitely - ERROR insight
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  disruption:
    budgets:
      - nodes: "0"
        reasons:
          - Drifted
```

```yaml
# Allows drift-based replacement to proceed
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  disruption:
    budgets:
      - nodes: "10%"
        reasons:
          - Drifted
```

**Non-Auto-Mode data plane:** Managed Node Groups roll back via `UpdateNodegroupVersion`.
Self-managed and hybrid nodes are fully manual. **Fargate cannot roll back at all** — Fargate
pods running the pre-rollback version trigger the kubelet skew insight as an `ERROR`, so the
pods must be deleted first or the insight bypassed with `--force`. Detect Fargate usage from
`aws_eks_fargate_profile` in Terraform, `FargateProfile` in CDK, or workloads scheduled by a
Fargate profile selector.

---

## Add-on strategy that preserves the rollback window

The rollback window only stays open if the add-ons are compatible with **both** versions.
Upgrade add-ons to a version cross-compatible with N-1, N and N+1 **before** the control
plane, so they are never the blocking factor in either direction.

This inverts how the add-on matrix in `eks-specific-changes.md` is used: a minimum floor is
enough for a one-way upgrade, but a rollback needs a **range** that covers N-1 as well.

Known interaction: to keep VolumeAttributesClass working on EKS 1.31 to 1.33 (beta API),
self-managed EBS CSI sidecars must be pinned to a version that still speaks the beta API.
AWS patched its own managed sidecars for this only through the end of 1.33 standard support
(2026-07-29), which has now passed.

---

## IaC support for `rollbackConfig`

`rollbackConfig.timeoutMinutes` bounds how long EKS attempts the rollback: 120 to 10080
minutes, default 720 (12 hours). It exists because a 7-day rollback collides with IaC
timeouts (CloudFormation 36 hours per resource, Terraform Cloud/Enterprise around 24 hours).

| Tool | `rollbackConfig` support | What to do |
|---|---|---|
| AWS CLI / API | Yes — `--rollback-config timeoutMinutes=N` | Preferred path when disruption budgets are restrictive |
| CloudFormation | Yes — `AWS::EKS::Cluster` `RollbackConfig` | Set `TimeoutMinutes` under the stack's own timeout |
| AWS CDK | L1 only — `CfnCluster.RollbackConfigProperty`. Not exposed on the L2 `eks.Cluster` | Use an escape hatch on the L1 construct |
| Terraform (`hashicorp/aws`) | **No** — `aws_eks_cluster` has no `rollback_config` argument (verified 2026-08-18) | Report only. Initiate the rollback via CLI/API |

Neither CloudFormation nor Terraform supports the `CancelUpdate` API. If an IaC run times out
mid-rollback, the API must be called directly. CloudFormation treats its own timeout as a
no-op, which leaves the template drifted from the real cluster version.

---

## Staged sequence that preserves the window

The window is only useful if the control plane and data plane are not advanced in the same
continuous run. Once a node's kubelet has moved to N, rolling the control plane back to N-1
requires rolling the data plane back first.

```text
1. Add-ons  -> upgrade to a version cross-compatible with N-1 / N / N+1
2. Control plane -> upgrade to N, then BAKE (~1 week per environment)
3. Data plane -> recycle nodes to N only after the bake period
```

Regression response during or after step 3:

- Data plane only: roll nodes back to N-1 kubelet, leave the control plane at N.
- Both: roll the data plane back first, then the control plane.

Trade-off to state in the report: this lengthens a full upgrade cycle, but it keeps the
rollback window open during the riskiest period and lets control plane versions advance
quickly across a fleet (which reduces extended-support cost exposure).

---

## Out of scope for this skill

This skill reads and transforms code. It never touches a cluster. It does **not**:

- call `update-cluster-version`, `list-insights`, `describe-insight`, or `cancel-update`
- assess the live rollback eligibility of a real cluster
- decide whether a rollback should happen

It produces the **pre-flight**: which findings in the repository would become rollback
blockers, so the decision is informed before the upgrade rather than during an incident.
