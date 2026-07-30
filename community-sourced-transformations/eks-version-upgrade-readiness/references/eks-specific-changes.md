# EKS-Specific Changes by Version

Changes that are Amazon EKS-specific (not upstream Kubernetes) and affect customer workloads/configs.

## EKS 1.33

- **AL2 AMIs discontinued** - Amazon Linux 2 AMIs no longer released. Must use AL2023 or Bottlerocket.
- Action: Update launch templates, Terraform `ami_type`, node group configs from `AL2_x86_64`/`AL2_ARM_64` to `AL2023_x86_64_STANDARD`/`AL2023_ARM_64_STANDARD`

## EKS 1.32

- **Anonymous auth restricted** - Only `/healthz`, `/livez`, `/readyz` accessible without auth. All other endpoints return 401 for `system:unauthenticated`.
- Action: Review RBAC policies granting access to `system:unauthenticated` group. Update health check configs if using non-standard endpoints.
- **AL2 AMI deprecation notice** - Last version with AL2 AMIs. Plan migration to AL2023.
- **ServiceAccount enforce-mountable-secrets deprecated** - `metadata.annotations[kubernetes.io/enforce-mountable-secrets]` deprecated.
- Action: Use separate namespaces to isolate access to mounted secrets instead.

## EKS 1.31

- **kubelet flag removed** - `--keep-terminated-pod-volumes` (deprecated since 2017) removed.
- Action: Remove from bootstrap scripts, launch templates, and user data.
- **VolumeAttributesClass beta enabled** - Requires EBS CSI Driver v1.35.0+ for ModifyVolume support.
- **AppArmor GA** - Migrate from annotations to `securityContext.appArmorProfile.type` field.

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

## EKS 1.35

- **cgroup v1 support removed** - Kubelet refuses to start on cgroup v1 nodes by default.
- Action: AL2023 already uses cgroup v2. If manually configured cgroup v1, set `failCgroupV1: false` or migrate to cgroup v2.
- **containerd 1.x last supported** - Must switch to containerd 2.0+ before upgrading to 1.36.
- Action: Update node AMIs and container runtime configs.
- **Ingress NGINX retired upstream** (March 2026) - No more security patches.
- Action: Migrate to Gateway API, AWS ALB Ingress Controller, or other alternatives.
- **kubelet flag `--pod-infra-container-image` removed** - Custom AMI users must remove from bootstrap scripts.
- **IPVS mode deprecated** - Will be removed in 1.36. Plan migration to iptables or nftables.
- **Windows Server 2025 support added**
- **In-Place Pod Resource Updates GA** - CPU/memory changes without Pod restart.

## EKS 1.36

- **IPVS mode removed from kube-proxy** - Must use iptables or nftables proxy mode.
- Action: Update kube-proxy ConfigMap `mode` field. Remove IPVS-related configs.
- **gogo protobuf removed from K8s API types** - Affects Go clients consuming K8s API types directly.
- Action: Update Go dependencies using `k8s.io/code-generator` instead of `gogo/protobuf`.

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
