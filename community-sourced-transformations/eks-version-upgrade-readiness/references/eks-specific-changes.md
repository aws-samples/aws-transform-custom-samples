# EKS-Specific Changes by Version

Changes that are Amazon EKS-specific (not upstream Kubernetes) and affect customer workloads/configs.

Sections are ordered newest first. For the inverse question — "what did I adopt in N that does
not exist in N-1, and therefore blocks a rollback" — see `rollback-readiness.md`.

## EKS 1.36

- **IPVS mode removed from kube-proxy** - Must use iptables or nftables proxy mode.
- Action: Update kube-proxy ConfigMap `mode` field. Remove IPVS-related configs.
- **gogo protobuf removed from K8s API types** - Affects Go clients consuming K8s API types directly.
- Action: Update Go dependencies using `k8s.io/code-generator` instead of `gogo/protobuf`.
- **`gitRepo` volume permanently disabled** - The API still accepts Pods with `gitRepo` volumes, but the kubelet refuses to run them and returns an error. Cannot be re-enabled.
- Action: Migrate to an init container or a git-sync sidecar container before upgrading.
- **Strict IP/CIDR validation on by default** - `StrictIPCIDRValidation` rejects IP values with extraneous leading zeros (`010.000.000.005`) and CIDRs with ambiguous semantics (`192.168.0.5/24` instead of `192.168.0.0/24`) on create and update. Existing stored objects survive via validation ratcheting. Does not apply to custom resource kinds.
- Action: Scan manifests, Helm charts, and automation for non-canonical IP/CIDR notation and normalize it. This is a pure text pattern and is one of the cheapest high-confidence detections in the whole skill.
- **SELinux volume labeling GA** - Faster labeling now defaults to all volumes using `mount -o context` instead of recursive relabeling. Sharing a volume between privileged and unprivileged Pods on the same node may break.
- Action: On SELinux-enforcing systems, audit `seLinuxChangePolicy` and volume labels on Pods before upgrading.
- **User Namespaces stable** - `spec.hostUsers` maps container root to an unprivileged host user.
- **Service `spec.externalIPs` deprecated** - Deprecation warnings on create/update. Removal planned for 1.43.
- Action: Plan migration to LoadBalancer Services, NodePort, or Gateway API.

## EKS 1.35

- **cgroup v1 support removed** - Kubelet refuses to start on cgroup v1 nodes by default.
- Action: AL2023 already uses cgroup v2. If manually configured cgroup v1, set `failCgroupV1: false` or migrate to cgroup v2. Bottlerocket 1.35 sets `failCgroupV1: false` for backward compatibility. Fargate continues on cgroup v1.
- **containerd 1.x last supported** - Must switch to containerd 2.0+ before upgrading to 1.36.
- Action: Update node AMIs and container runtime configs.
- **Ingress NGINX retired upstream** (March 2026) - No more security patches.
- Action: Migrate to Gateway API, AWS ALB Ingress Controller, or other alternatives.
- **kubelet flag `--pod-infra-container-image` removed** - Custom AMI users must remove from bootstrap scripts.
- **IPVS mode deprecated** - Will be removed in 1.36. Plan migration to iptables or nftables.
- **Windows Server 2025 support added**
- **In-Place Pod Resource Updates GA** - CPU/memory changes without Pod restart.
- **Service `trafficDistribution: PreferSameNode` (stable)** - New enum value that strictly prefers endpoints on the local node, falling back to remote. Does not exist in 1.34.
- **StatefulSet `maxUnavailable` (beta)** - `spec.updateStrategy.rollingUpdate.maxUnavailable` allows parallel Pod updates instead of strictly one at a time.

## EKS 1.34

- **AL2 AMIs not released** - No EKS-optimized Amazon Linux 2 AMI for 1.34.
- Action: Migrate node groups to AL2023 or Bottlerocket.
- **containerd updated to 2.1** at launch.
- Action: Review the containerd 2.1 release notes if node behavior changes after the upgrade.
- **AppArmor deprecated** - Recommendation is to migrate to seccomp or Pod Security Standards.
- **VolumeAttributesClass GA** - Migrates from `storage.k8s.io/v1beta1` to `storage.k8s.io/v1`.
- Action: If you self-manage CSI sidecar containers, you may need to pin older sidecars to keep VAC working on pre-1.34 clusters. AWS patched its managed sidecars for the beta API only through the end of 1.33 standard support (2026-07-29).
- **Dynamic Resource Allocation core APIs GA** - `resource.k8s.io/v1`.
- **Pod-level resource requests and limits (beta)** - Pod `spec.resources` creates a shared pool for multi-container Pods. New field, absent in 1.33.
- **Projected ServiceAccount tokens for kubelet image pulls (beta)** - Short-lived credentials instead of long-lived pull secrets.
- **Mutable CSI Node Allocatable Count (beta)** - `MutableCSINodeAllocatableCount` on by default; CSINode max attachable volume count becomes dynamic.
- **External JWT signer for ServiceAccount tokens (beta)** - When using an external signer, `--service-account-extend-token-expiration` is no longer fully respected; the API server enforces the lower of the desired extension and the signer's limit.
- **Deprecation notice - manual cgroup driver configuration** - Moving to automatic detection.
- Action: Plan to remove `--cgroup-driver` from kubelet configuration in bootstrap scripts and custom AMIs.

## EKS 1.33

- **AL2 AMIs discontinued** - Amazon Linux 2 AMIs no longer released. Must use AL2023 or Bottlerocket.
- Action: Update launch templates, Terraform `ami_type`, node group configs from `AL2_x86_64`/`AL2_ARM_64` to `AL2023_x86_64_STANDARD`/`AL2023_ARM_64_STANDARD`
- **Dynamic Resource Allocation beta API enabled** - `resource.k8s.io/v1beta1`. Not enabled on EKS 1.32.
- **In-Place Pod Resource Resize (beta)** - CPU/memory updates on existing Pods without restart.
- **Sidecar containers stable** - Init containers with `restartPolicy: Always`.
- **Endpoints API deprecated** - Returns warnings. Migrate to EndpointSlices.
- **EFA traffic allowed in the default cluster security group** - New outbound rule permitting EFA traffic to the same security group.

## EKS 1.32

- **Anonymous auth restricted** - Only `/healthz`, `/livez`, `/readyz` accessible without auth. All other endpoints return 401 for `system:unauthenticated`.
- Action: Review RBAC policies granting access to `system:unauthenticated` group. Update health check configs if using non-standard endpoints.
- **AL2 AMI deprecation notice** - Last version with AL2 AMIs. Plan migration to AL2023.
- **ServiceAccount enforce-mountable-secrets deprecated** - `metadata.annotations[kubernetes.io/enforce-mountable-secrets]` deprecated.
- Action: Use separate namespaces to isolate access to mounted secrets instead.
- **`flowcontrol.apiserver.k8s.io/v1beta3` removed** - FlowSchema and PriorityLevelConfiguration must move to `v1`.
- **Custom Resource Field Selector** - CRDs gain `spec.versions[].selectableFields`. Pruned by 1.31.
- **StatefulSet PVC automatic cleanup** - Orphaned PVCs from StatefulSets are deleted automatically while preserving data across updates and node maintenance.
- **Memory Manager GA** - More predictable memory allocation for workloads with specific memory requirements.

## EKS 1.31

- **kubelet flag removed** - `--keep-terminated-pod-volumes` (deprecated since 2017) removed.
- Action: Remove from bootstrap scripts, launch templates, and user data.
- **VolumeAttributesClass beta enabled** - Requires EBS CSI Driver v1.35.0+ for ModifyVolume support.
- **AppArmor GA** - Migrate from annotations to `securityContext.appArmorProfile.type` field.
- **PersistentVolume last phase transition time GA** - New `.status.lastTransitionTime` on PersistentVolumeStatus.

## EKS 1.30

- **Default StorageClass annotation removed** - New clusters don't have `default` annotation on `gp2` StorageClass.
- Action: Reference StorageClass by name `gp2` explicitly, or deploy EBS CSI default SC with `defaultStorageClass.enabled=true`.
- **AL2023 default for new managed node groups** - New MNGs default to AL2023 (existing unchanged).
- **AZ ID label added** - `topology.k8s.aws/zone-id` label on worker nodes.
- **IAM policy change** - `ec2:DescribeAvailabilityZones` now REQUIRED in cluster IAM role.
- Action: Update cluster IAM role policy.

## EKS 1.29

- **Extended support pricing** - Versions entering extended support incur additional cost.
- **EKS Pod Identity GA** - Recommended over IRSA for new workloads.

## EKS 1.28

- **Metrics changes** - Several kube-scheduler and kube-controller-manager metrics renamed/removed.
- **kubectl events subcommand GA** - `kubectl events` replaces `kubectl get events`.

---

## Disruption Controls (affect both upgrade and rollback)

These live in customer manifests and Helm templates, and they throttle **node replacement** —
which is what both a data plane upgrade and an Auto Mode rollback depend on. Historically they
were invisible to upgrade tooling; EKS now surfaces them as rollback readiness insights.

| Pattern | Where | Effect |
|---|---|---|
| `nodes: "0"` in a NodePool disruption budget covering `Drifted` | `karpenter.sh/v1` NodePool | Blocks drift-based node replacement indefinitely (ERROR insight) |
| `karpenter.sh/do-not-disrupt: "true"` on a node | Node metadata | Node is never replaced (ERROR insight) |
| `karpenter.sh/do-not-disrupt: "true"` on a pod | Pod/Deployment template metadata | Delays disruption up to the termination grace period (WARNING) |
| `maxUnavailable: 0` on a PodDisruptionBudget | `policy/v1` PDB | Delays eviction; slows node replacement significantly (WARNING) |
| `minAvailable` equal to the replica count | `policy/v1` PDB | Equivalent to `maxUnavailable: 0` in practice |

Note that `--force` on the rollback bypasses insight checks only. Disruption budgets, PDBs, and
do-not-disrupt annotations are always honored. The only way to speed up node replacement is to
change these values.

Full severity mapping and examples: `rollback-readiness.md`.

---

## Addon Compatibility Matrix (common addons)

When upgrading EKS, addon versions must also be compatible:

| Addon | Min version for EKS 1.30+ | Min version for EKS 1.32+ |
|-------|---------------------------|---------------------------|
| VPC CNI | v1.16.0+ | v1.18.0+ |
| CoreDNS | v1.11.1+ | v1.11.3+ |
| kube-proxy | Match cluster version | Match cluster version |
| EBS CSI Driver | v1.28.0+ | v1.35.0+ |
| EFS CSI Driver | v2.0.0+ | v2.1.0+ |
| AWS LB Controller | v2.7.0+ | v2.8.0+ |
| Cert-Manager | v1.14.0+ | v1.15.0+ |
| Ingress-NGINX | v1.10.0+ | v1.11.0+ |
| ArgoCD | v2.10.0+ | v2.12.0+ |
| Karpenter | v0.35.0+ | v1.0.0+ |
| Istio | v1.20+ | v1.22+ |

**Note:** Always verify exact compatibility in addon release notes. This table is approximate guidance.

### Reading the matrix when a rollback window matters

A minimum floor is sufficient for a one-way upgrade. If the rollback window must stay open, the
selected version has to satisfy a **range**: compatible with N-1, N and N+1 simultaneously. Pick
the highest floor across those three versions and confirm it against the addon's own support
statement for the oldest of them.

Two consequences worth reporting explicitly:

1. **Upgrade add-ons first**, before the control plane, so they are never the blocking factor in
   either direction.
2. **Rollback readiness insights only cover EKS-managed add-ons** (CoreDNS, VPC CNI, kube-proxy),
   and not even those if the version was overridden outside the EKS add-on lifecycle. Everything
   else in this table — LB Controller, Karpenter, Istio, ArgoCD, cert-manager, cluster-autoscaler —
   is validated by nobody unless this skill flags it.

---

## Terraform/CDK/Pulumi Patterns to Update

### Terraform aws_eks_cluster

```hcl
# Before (pinned old version)
resource "aws_eks_cluster" "main" {
  version = "1.28"
}

# After (target version)
resource "aws_eks_cluster" "main" {
  version = "1.32"
}
```

### Terraform aws_eks_node_group (AL2 to AL2023)

```hcl
# Before
resource "aws_eks_node_group" "workers" {
  ami_type = "AL2_x86_64"
}

# After (required for 1.33+)
resource "aws_eks_node_group" "workers" {
  ami_type = "AL2023_x86_64_STANDARD"
}
```

### CDK EKS Cluster

```typescript
// Before
new eks.Cluster(this, 'Cluster', {
  version: eks.KubernetesVersion.V1_28,
});

// After
new eks.Cluster(this, 'Cluster', {
  version: eks.KubernetesVersion.V1_32,
});
```

### Helm values (addon versions)

```yaml
# Before
aws-load-balancer-controller:
  image:
    tag: v2.6.2

# After (compatible with 1.32)
aws-load-balancer-controller:
  image:
    tag: v2.8.1
```

### Rollback timeout in IaC

`rollbackConfig.timeoutMinutes` (120 to 10080, default 720) aligns the EKS rollback duration with
the IaC tool's own timeout. Support is uneven:

```yaml
# CloudFormation - supported
Resources:
  Cluster:
    Type: AWS::EKS::Cluster
    Properties:
      Version: "1.33"
      RollbackConfig:
        TimeoutMinutes: 1440
```

- **CDK:** only on the L1 `CfnCluster` (`RollbackConfigProperty`), not on the L2 `eks.Cluster`.
  Reach it with an escape hatch.
- **Terraform:** `aws_eks_cluster` has **no** `rollback_config` argument (verified 2026-08-18).
  Report it and initiate the rollback through the CLI or API instead.
- Neither CloudFormation nor Terraform supports `CancelUpdate`.
