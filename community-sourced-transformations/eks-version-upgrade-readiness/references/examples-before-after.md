# Examples: Before and After Transformations

## 1. Ingress (extensions/v1beta1 -> networking.k8s.io/v1)

### Before (breaks on EKS 1.22+)

```yaml
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: my-app
  annotations:
    kubernetes.io/ingress.class: alb
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            backend:
              serviceName: my-app-svc
              servicePort: 80
```

### After (compatible with all current EKS versions)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
spec:
  ingressClassName: alb
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-svc
                port:
                  number: 80
```

**Changes:**
- `apiVersion` updated
- `kubernetes.io/ingress.class` annotation replaced with `spec.ingressClassName`
- `backend.serviceName` -> `backend.service.name`
- `backend.servicePort` -> `backend.service.port.number`
- `pathType` added (REQUIRED in v1)

---

## 2. PodDisruptionBudget (policy/v1beta1 -> policy/v1)

### Before (breaks on EKS 1.25+)

```yaml
apiVersion: policy/v1beta1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: my-app
```

### After

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: my-app-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: my-app
```

**Changes:**
- `apiVersion` updated from `policy/v1beta1` to `policy/v1`
- WARNING: empty `spec.selector` (`{}`) now selects ALL pods (was none in v1beta1)

---

## 3. CronJob (batch/v1beta1 -> batch/v1)

### Before (breaks on EKS 1.25+)

```yaml
apiVersion: batch/v1beta1
kind: CronJob
metadata:
  name: cleanup
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: cleanup
              image: busybox
              command: ["/bin/sh", "-c", "echo cleanup"]
          restartPolicy: OnFailure
```

### After

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cleanup
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: cleanup
              image: busybox
              command: ["/bin/sh", "-c", "echo cleanup"]
          restartPolicy: OnFailure
```

**Changes:**
- `apiVersion` updated (no structural changes needed)

---

## 4. HorizontalPodAutoscaler (autoscaling/v2beta2 -> autoscaling/v2)

### Before (breaks on EKS 1.26+)

```yaml
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### After

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

**Changes:**
- `apiVersion` updated (structure is the same for v2beta2 -> v2)

---

## 5. FlowSchema (flowcontrol.apiserver.k8s.io/v1beta3 -> v1)

### Before (breaks on EKS 1.32+)

```yaml
apiVersion: flowcontrol.apiserver.k8s.io/v1beta3
kind: FlowSchema
metadata:
  name: my-flow
spec:
  priorityLevelConfiguration:
    name: my-priority
  matchingPrecedence: 1000
  rules:
    - subjects:
        - kind: ServiceAccount
          serviceAccount:
            name: my-sa
            namespace: default
      resourceRules:
        - verbs: ["get", "list"]
          apiGroups: [""]
          resources: ["pods"]
```

### After

```yaml
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: FlowSchema
metadata:
  name: my-flow
spec:
  priorityLevelConfiguration:
    name: my-priority
  matchingPrecedence: 1000
  rules:
    - subjects:
        - kind: ServiceAccount
          serviceAccount:
            name: my-sa
            namespace: default
      resourceRules:
        - verbs: ["get", "list"]
          apiGroups: [""]
          resources: ["pods"]
```

---

## 6. CustomResourceDefinition (apiextensions.k8s.io/v1beta1 -> v1)

### Before (breaks on EKS 1.22+)

```yaml
apiVersion: apiextensions.k8s.io/v1beta1
kind: CustomResourceDefinition
metadata:
  name: crontabs.stable.example.com
spec:
  group: stable.example.com
  version: v1
  scope: Namespaced
  names:
    plural: crontabs
    singular: crontab
    kind: CronTab
  validation:
    openAPIV3Schema:
      type: object
      properties:
        spec:
          type: object
```

### After

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: crontabs.stable.example.com
spec:
  group: stable.example.com
  names:
    plural: crontabs
    singular: crontab
    kind: CronTab
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
```

**Changes:**
- `spec.version` replaced with `spec.versions[]`
- `spec.validation` moved to `spec.versions[*].schema`
- `openAPIV3Schema` is REQUIRED
- Must be a structural schema

---

## 7. Terraform: Node Group AL2 -> AL2023

### Before (breaks on EKS 1.33+)

```hcl
resource "aws_eks_node_group" "workers" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "workers"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.private_subnets

  ami_type = "AL2_x86_64"

  scaling_config {
    desired_size = 3
    max_size     = 5
    min_size     = 1
  }
}
```

### After

```hcl
resource "aws_eks_node_group" "workers" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "workers"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.private_subnets

  ami_type = "AL2023_x86_64_STANDARD"

  scaling_config {
    desired_size = 3
    max_size     = 5
    min_size     = 1
  }
}
```

---

## 8. Webhook Configuration (admissionregistration.k8s.io/v1beta1 -> v1)

### Before (breaks on EKS 1.22+)

```yaml
apiVersion: admissionregistration.k8s.io/v1beta1
kind: ValidatingWebhookConfiguration
metadata:
  name: my-webhook
webhooks:
  - name: validate.example.com
    clientConfig:
      service:
        name: webhook-svc
        namespace: default
        path: /validate
    rules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE"]
        resources: ["pods"]
```

### After

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: my-webhook
webhooks:
  - name: validate.example.com
    admissionReviewVersions: ["v1", "v1beta1"]
    sideEffects: None
    failurePolicy: Fail
    timeoutSeconds: 10
    clientConfig:
      service:
        name: webhook-svc
        namespace: default
        path: /validate
    rules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE"]
        resources: ["pods"]
```

**Changes:**
- `admissionReviewVersions` is REQUIRED
- `sideEffects` is REQUIRED (only `None` or `NoneOnDryRun`)
- `failurePolicy` defaults to `Fail` (was `Ignore`)
- `timeoutSeconds` defaults to 10s (was 30s)
---

## 9. Karpenter NodePool: disruption budget that blocks rollback

A budget of `nodes: "0"` covering `Drifted` prevents drift-based node replacement. On an EKS Auto
Mode cluster this blocks the node rollback phase indefinitely and raises an `ERROR` rollback
readiness insight. It also throttles the data plane upgrade.

### Before (blocks node replacement)

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    budgets:
      - nodes: "0"
        reasons:
          - Drifted
```

### After

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    budgets:
      # TODO: confirm this rate with the workload owner. "0" blocked both the data plane
      # upgrade and any Auto Mode rollback (ERROR rollback readiness insight).
      - nodes: "10%"
        reasons:
          - Drifted
```

**Changes:**
- `nodes: "0"` replaced with a non-zero rate so drift can make progress
- `TODO` added: the concurrency rate is a workload availability decision, not a mechanical one
- Report as **high** risk when `nodes: "0"` covers `Drifted` or has no `reasons` filter (an
  unfiltered budget covers every disruption reason, including drift)

---

## 10. PodDisruptionBudget that stalls node replacement

`maxUnavailable: 0` never permits an eviction, so every node hosting a matching Pod waits out the
full termination grace period. This raises a `WARNING` insight — it does not block a rollback, but
on a large fleet it is the difference between minutes and days, and it can push node rollback past
the timeout.

### Before

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payments-pdb
spec:
  maxUnavailable: 0
  selector:
    matchLabels:
      app: payments
```

### After

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payments-pdb
spec:
  # TODO: maxUnavailable: 0 stalls every voluntary eviction, including upgrades and rollbacks.
  # Confirm the real availability requirement with the workload owner.
  maxUnavailable: 1
  selector:
    matchLabels:
      app: payments
```

**Changes:**
- `maxUnavailable: 0` flagged and replaced with a value that permits progress
- Equivalent pattern to detect: `minAvailable` equal to the Deployment/StatefulSet replica count
- The same finding applies to `karpenter.sh/do-not-disrupt: "true"` on a Pod template. On a **node**
  it is an `ERROR` instead of a `WARNING`, but node annotations are cluster state, not repository
  code, so they are report-only

---

## 11. VolumeAttributesClass: a transformation that closes the rollback window

Not every "update the apiVersion" is safe. `storage.k8s.io/v1` VolumeAttributesClass only exists
from 1.34; 1.33 serves the beta group version. Moving to the stable API is correct for the target
version and simultaneously makes the cluster unable to roll back until it is reverted.

### Before (target 1.34, source 1.33)

```yaml
apiVersion: storage.k8s.io/v1beta1
kind: VolumeAttributesClass
metadata:
  name: gp3-high-throughput
driverName: ebs.csi.aws.com
parameters:
  type: gp3
  throughput: "500"
```

### After

```yaml
# ROLLBACK IMPACT: storage.k8s.io/v1 does not exist on EKS 1.33. Applying this manifest
# closes the 7-day rollback window until it is reverted to v1beta1. Self-managed EBS CSI
# sidecars on pre-1.34 clusters must be pinned to a version that still speaks the beta API.
apiVersion: storage.k8s.io/v1
kind: VolumeAttributesClass
metadata:
  name: gp3-high-throughput
driverName: ebs.csi.aws.com
parameters:
  type: gp3
  throughput: "500"
```

**Changes:**
- `apiVersion` updated to the version that is valid on the target
- Annotated as a **rollback-blocking adoption**, not a neutral bump
- Report guidance: land this change **after** the rollback window closes, or accept that the
  window is closed while it is deployed. Same class of finding for `resource.k8s.io/v1` (DRA, GA in
  1.34), Pod-level `spec.resources` (1.34), and `trafficDistribution: PreferSameNode` (1.35)

---

## 12. Non-canonical IP/CIDR values (breaks on 1.36)

From 1.36 `StrictIPCIDRValidation` is on by default: IP values with extraneous leading zeros and
CIDRs with host bits set are rejected on create and update. Objects already stored survive via
validation ratcheting, so this only surfaces on the next apply — which is exactly what a GitOps
sync does. It does not apply to custom resource kinds.

### Before (rejected on 1.36)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-internal
spec:
  podSelector: {}
  ingress:
    - from:
        - ipBlock:
            cidr: 192.168.0.5/24
        - ipBlock:
            cidr: 010.000.010.000/24
```

### After

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-internal
spec:
  podSelector: {}
  ingress:
    - from:
        - ipBlock:
            # TODO: host bits were set (192.168.0.5/24). Confirm the intended network was
            # 192.168.0.0/24 and not a single-host rule (192.168.0.5/32).
            cidr: 192.168.0.0/24
        - ipBlock:
            cidr: 10.0.10.0/24
```

**Changes:**
- Leading zeros stripped to canonical form (`010.000.010.000` to `10.0.10.0`)
- Host bits masked off, with a `TODO` because `192.168.0.5/24` is genuinely ambiguous: the author
  may have meant the whole subnet or a single host. Never resolve that silently
- This is forward-only: it blocks the upgrade to 1.36 and is safe on a rollback
