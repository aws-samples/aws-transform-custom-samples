# Kubernetes API Removals by Version

Reference for the ATX Custom TD. Source: https://kubernetes.io/docs/reference/using-api/deprecation-guide/

## v1.32

| Resource | Removed API | Replacement API | Available Since |
|----------|-------------|-----------------|-----------------|
| FlowSchema | `flowcontrol.apiserver.k8s.io/v1beta3` | `flowcontrol.apiserver.k8s.io/v1` | v1.29 |
| PriorityLevelConfiguration | `flowcontrol.apiserver.k8s.io/v1beta3` | `flowcontrol.apiserver.k8s.io/v1` | v1.29 |

**Notable changes in v1:**
- `spec.limited.nominalConcurrencyShares` only defaults to 30 when unspecified; explicit 0 is NOT changed to 30

## v1.29

| Resource | Removed API | Replacement API | Available Since |
|----------|-------------|-----------------|-----------------|
| FlowSchema | `flowcontrol.apiserver.k8s.io/v1beta2` | `flowcontrol.apiserver.k8s.io/v1` | v1.29 |
| PriorityLevelConfiguration | `flowcontrol.apiserver.k8s.io/v1beta2` | `flowcontrol.apiserver.k8s.io/v1` | v1.29 |

**Notable changes:**
- `spec.limited.assuredConcurrencyShares` renamed to `spec.limited.nominalConcurrencyShares`

## v1.27

| Resource | Removed API | Replacement API | Available Since |
|----------|-------------|-----------------|-----------------|
| CSIStorageCapacity | `storage.k8s.io/v1beta1` | `storage.k8s.io/v1` | v1.24 |

## v1.26

| Resource | Removed API | Replacement API | Available Since |
|----------|-------------|-----------------|-----------------|
| FlowSchema | `flowcontrol.apiserver.k8s.io/v1beta1` | `flowcontrol.apiserver.k8s.io/v1beta2` | v1.23 |
| PriorityLevelConfiguration | `flowcontrol.apiserver.k8s.io/v1beta1` | `flowcontrol.apiserver.k8s.io/v1beta2` | v1.23 |
| HorizontalPodAutoscaler | `autoscaling/v2beta2` | `autoscaling/v2` | v1.23 |

**Notable HPA changes:**
- `targetAverageUtilization` replaced with `target.averageUtilization` + `target.type: Utilization`

## v1.25

| Resource | Removed API | Replacement API | Available Since |
|----------|-------------|-----------------|-----------------|
| CronJob | `batch/v1beta1` | `batch/v1` | v1.21 |
| EndpointSlice | `discovery.k8s.io/v1beta1` | `discovery.k8s.io/v1` | v1.21 |
| Event | `events.k8s.io/v1beta1` | `events.k8s.io/v1` | v1.19 |
| HorizontalPodAutoscaler | `autoscaling/v2beta1` | `autoscaling/v2` | v1.23 |
| PodDisruptionBudget | `policy/v1beta1` | `policy/v1` | v1.21 |
| PodSecurityPolicy | `policy/v1beta1` | Pod Security Admission | v1.25 |
| RuntimeClass | `node.k8s.io/v1beta1` | `node.k8s.io/v1` | v1.20 |

**Notable PDB changes in policy/v1:**
- Empty `spec.selector` (`{}`) selects ALL pods in namespace (v1beta1 selected none)

**PodSecurityPolicy:**
- REMOVED entirely. Migrate to Pod Security Admission or 3rd party webhook

## v1.22

| Resource | Removed API | Replacement API | Available Since |
|----------|-------------|-----------------|-----------------|
| MutatingWebhookConfiguration | `admissionregistration.k8s.io/v1beta1` | `admissionregistration.k8s.io/v1` | v1.16 |
| ValidatingWebhookConfiguration | `admissionregistration.k8s.io/v1beta1` | `admissionregistration.k8s.io/v1` | v1.16 |
| CustomResourceDefinition | `apiextensions.k8s.io/v1beta1` | `apiextensions.k8s.io/v1` | v1.16 |
| APIService | `apiregistration.k8s.io/v1beta1` | `apiregistration.k8s.io/v1` | v1.10 |
| TokenReview | `authentication.k8s.io/v1beta1` | `authentication.k8s.io/v1` | v1.6 |
| SubjectAccessReview | `authorization.k8s.io/v1beta1` | `authorization.k8s.io/v1` | v1.6 |
| CertificateSigningRequest | `certificates.k8s.io/v1beta1` | `certificates.k8s.io/v1` | v1.19 |
| Lease | `coordination.k8s.io/v1beta1` | `coordination.k8s.io/v1` | v1.14 |
| Ingress | `extensions/v1beta1`, `networking.k8s.io/v1beta1` | `networking.k8s.io/v1` | v1.19 |
| IngressClass | `networking.k8s.io/v1beta1` | `networking.k8s.io/v1` | v1.19 |
| ClusterRole/Binding | `rbac.authorization.k8s.io/v1beta1` | `rbac.authorization.k8s.io/v1` | v1.8 |
| Role/RoleBinding | `rbac.authorization.k8s.io/v1beta1` | `rbac.authorization.k8s.io/v1` | v1.8 |
| PriorityClass | `scheduling.k8s.io/v1beta1` | `scheduling.k8s.io/v1` | v1.14 |
| CSIDriver | `storage.k8s.io/v1beta1` | `storage.k8s.io/v1` | v1.19 |
| CSINode | `storage.k8s.io/v1beta1` | `storage.k8s.io/v1` | v1.17 |
| StorageClass | `storage.k8s.io/v1beta1` | `storage.k8s.io/v1` | v1.6 |
| VolumeAttachment | `storage.k8s.io/v1beta1` | `storage.k8s.io/v1` | v1.13 |

**Notable Ingress changes in networking.k8s.io/v1:**
- `spec.backend` renamed to `spec.defaultBackend`
- `serviceName` renamed to `service.name`
- Numeric `servicePort` renamed to `service.port.number`
- String `servicePort` renamed to `service.port.name`
- `pathType` is now REQUIRED (use `ImplementationSpecific` for old behavior)

**Notable CRD changes in apiextensions.k8s.io/v1:**
- `spec.version` removed; use `spec.versions`
- `spec.validation` removed; use `spec.versions[*].schema`
- `spec.subresources` removed; use `spec.versions[*].subresources`
- `openAPIV3Schema` is REQUIRED
- `spec.preserveUnknownFields: true` disallowed at top level

**Notable Webhook changes in admissionregistration.k8s.io/v1:**
- `failurePolicy` default changed from `Ignore` to `Fail`
- `matchPolicy` default changed from `Exact` to `Equivalent`
- `timeoutSeconds` default changed from `30s` to `10s`
- `sideEffects` is REQUIRED (only `None` and `NoneOnDryRun` allowed)
- `admissionReviewVersions` is REQUIRED

## v1.16

| Resource | Removed API | Replacement API | Available Since |
|----------|-------------|-----------------|-----------------|
| NetworkPolicy | `extensions/v1beta1` | `networking.k8s.io/v1` | v1.8 |
| DaemonSet | `extensions/v1beta1`, `apps/v1beta2` | `apps/v1` | v1.9 |
| Deployment | `extensions/v1beta1`, `apps/v1beta1`, `apps/v1beta2` | `apps/v1` | v1.9 |
| StatefulSet | `apps/v1beta1`, `apps/v1beta2` | `apps/v1` | v1.9 |
| ReplicaSet | `extensions/v1beta1`, `apps/v1beta1`, `apps/v1beta2` | `apps/v1` | v1.9 |

**Notable changes in apps/v1:**
- `spec.selector` is REQUIRED and IMMUTABLE after creation
- DaemonSet `updateStrategy.type` defaults to `RollingUpdate` (was `OnDelete`)
- Deployment `progressDeadlineSeconds` defaults to 600s (was no deadline)
- Deployment `revisionHistoryLimit` defaults to 10 (was 2 or unlimited)

---

## v1.34

| Resource | Removed/Changed | Details |
|----------|-----------------|----------|
| VolumeAttributesClass | `storage.k8s.io/v1beta1` -> `storage.k8s.io/v1` (GA) | Beta API still served on 1.31-1.33 with AWS-managed sidecars |
| AppArmor | DEPRECATED | Migrate to seccomp or Pod Security Standards |

**Notable:**
- Containerd updated to 2.1 (check release notes for breaking changes)
- No AL2 AMI released for 1.34+
- External JWT Signer for SA tokens promoted to Beta (token expiration behavior changes)
- Manual cgroup driver configuration deprecated

## v1.35

| Resource | Removed/Changed | Details |
|----------|-----------------|----------|
| cgroup v1 | REMOVED (kubelet refuses to start) | AL2023 uses cgroup v2 by default. Bottlerocket sets `failCgroupV1: false` |
| containerd 1.x | LAST VERSION supporting it | Must switch to containerd 2.0+ before next upgrade |
| Ingress NGINX | RETIRED upstream (March 2026) | No more security patches. Migrate to Gateway API |
| kubelet flag `--pod-infra-container-image` | REMOVED | Remove from bootstrap scripts/launch templates |
| IPVS mode (kube-proxy) | DEPRECATED | Will be removed in 1.36 |

## v1.36

| Resource | Removed/Changed | Details |
|----------|-----------------|----------|
| IPVS mode (kube-proxy) | REMOVED | Must use iptables or nftables mode |
| gogo protobuf dependency | REMOVED from K8s API types | Consumers of K8s Go types: update code-generator |

**Notable GA graduations in v1.36:**
- MutatingAdmissionPolicies (CEL-based, replaces webhooks for common cases)
- Volume Group Snapshots
- Fine-grained kubelet API authorization
- External ServiceAccount token signer
- DRA admin access + prioritized lists
- Declarative validation (`validation-gen`)

---

## Quick Lookup: "I'm upgrading from X to Y, what breaks?"

### From 1.28 to 1.29
- `flowcontrol.apiserver.k8s.io/v1beta2` FlowSchema/PriorityLevelConfiguration REMOVED

### From 1.29 to 1.30
- No API removals (but EKS-specific: gp2 StorageClass no longer default, ec2:DescribeAvailabilityZones required)

### From 1.30 to 1.31
- No API removals (but kubelet flag `--keep-terminated-pod-volumes` removed)

### From 1.31 to 1.32
- `flowcontrol.apiserver.k8s.io/v1beta3` FlowSchema/PriorityLevelConfiguration REMOVED
- Anonymous auth restricted to health endpoints only
- AL2 AMI deprecated (last version with AL2)

### From 1.32 to 1.33
- No API removals
- AL2 AMIs NO LONGER released (must use AL2023 or Bottlerocket)
- Endpoints API deprecated (warnings returned, migrate to EndpointSlices)

### From 1.33 to 1.34
- VolumeAttributesClass beta API migrated to GA (`storage.k8s.io/v1`)
- AppArmor deprecated
- Containerd updated to 2.1
- No AL2 AMI released

### From 1.34 to 1.35
- cgroup v1 support REMOVED (kubelet won't start)
- containerd 1.x LAST supported version
- Ingress NGINX RETIRED upstream
- kubelet `--pod-infra-container-image` flag REMOVED
- IPVS mode deprecated

### From 1.35 to 1.36
- IPVS mode REMOVED from kube-proxy
- gogo protobuf removed from K8s API types (affects Go clients)
