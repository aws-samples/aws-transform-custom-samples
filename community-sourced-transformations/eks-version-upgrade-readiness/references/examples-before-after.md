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
