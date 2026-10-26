# Construct Mapping: Amazon ECS to Amazon EKS

> Loaded in Phase 1. Every construct found in the repository resolves to exactly one of three
> classifications. **The classification is fixed here, not decided per run.**

| Classification | Meaning | What the transformation does |
|---|---|---|
| **MECHANICAL** | A faithful equivalent exists and the conversion is deterministic | Convert it |
| **SCAFFOLD** | Partly automatable; the remainder is a design decision | Emit an incomplete artifact, clearly marked, plus a report item |
| **REPORT-ONLY** | No equivalent, or the substitute changes the guarantee | Do not touch. Report with the recommended path |

---

## Locating ECS definitions

| Source | What to find | Notes |
|---|---|---|
| Terraform | `aws_ecs_task_definition`, `aws_ecs_service` | `container_definitions` is usually `jsonencode(local.x)`, `file()` or `templatefile()`. Read the local or template the argument points at. When the resources live in a module, each `module` block that calls it is one ECS service: resolve per-service values from that block's arguments |
| CloudFormation / CDK | `AWS::ECS::TaskDefinition`, `AWS::ECS::Service` | CDK: read the synthesized template under `cdk.out/` if present; otherwise the construct code |
| JSON | files with `containerDefinitions` and `family` | Often next to a CI pipeline calling `register-task-definition` |

**Never evaluate an expression.** A value that is a variable, module output, local, `!Ref` or
`!GetAtt` becomes a placeholder (`REPLACE_ME_<NAME>`) plus a `TODO(migration)` quoting the
original expression. The one exception is a literal default in the same module
(`variable "x" { default = 3 }`), which may be used and must be cited in the report.

---

## MECHANICAL

### Task definition -> `apps/v1 Deployment`

| ECS | Kubernetes | Notes |
|---|---|---|
| `family` / Terraform module name | `metadata.name`, label `app.kubernetes.io/name` | Lowercase, DNS-1123 |
| `aws_ecs_service.desired_count` | `spec.replicas` | If Application Auto Scaling exists, also scaffold an HPA |
| `containerDefinitions[]` | `spec.template.spec.containers[]` | `name`, `image`, `command` -> `args`, `entryPoint` -> `command` |
| `essential: false` container | additional container in the same pod | Log routers (`firelens`) and OpenTelemetry collectors are reported, not copied (see REPORT-ONLY) |
| `dependsOn` (`START`, `HEALTHY`) | init container or native sidecar ordering | `COMPLETE`/`SUCCESS` on a short-lived container -> init container. Anything else -> `TODO(migration)` |
| `portMappings[].containerPort` | `ports[].containerPort` | Keep `name` so Services can target it. A Kubernetes port name is at most **15 characters** (IANA_SVC_NAME: lowercase alphanumerics and `-`). ECS allows longer names (`checkout-service` is 16), so shorten any longer name (`http` for the only port, otherwise a truncated name) and use the same name in the `Service` `targetPort`; record the rename in the report |
| `readonlyRootFilesystem`, `user`, `privileged` | `securityContext` | `privileged: true` -> report as a Pod Security Admission blocker |
| `ulimits`, `linuxParameters` | none | Report |
| `stopTimeout` | `terminationGracePeriodSeconds` | |

### cpu and memory -> `resources`

ECS allocates **1024 CPU units per vCPU**. `memory` is a hard limit (the container is killed
above it); `memoryReservation` is a soft reservation.

| ECS container field | Kubernetes |
|---|---|
| `cpu` | `requests.cpu` = units / 1024 (e.g. `512` -> `500m`) |
| `memory` | `limits.memory` (MiB -> `Mi`) |
| `memoryReservation` | `requests.memory` |
| `memory` only | `requests.memory` = `limits.memory` |

**Task-level only** (common on Fargate): with one essential container, assign the task-level
values to it. With several containers and no container-level values, split nothing: emit
`TODO(migration)` and a report entry, because any split is a guess.

### `environment` -> `env` / `ConfigMap`

Literal values become `env` entries. Values shared by more than one service move to a
`ConfigMap`. A value that is an IaC expression is a placeholder plus `TODO(migration)`.
Values that are clearly endpoints of dependencies (database host, cache URL, queue broker)
are never hardcoded: placeholder plus report entry.

### `secrets` -> `SecretProviderClass`

Each ECS `secrets[].valueFrom` is a Secrets Manager ARN (optionally with a `:json-key::`
suffix) or a Parameter Store ARN/name.

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
spec:
  provider: aws
  parameters:
    usePodIdentity: "true"      # omit on eks-fargate-profile (see below)
    objects: |
      - objectName: "REPLACE_ME_SECRET_ARN"   # TODO(migration): <original valueFrom expression>
        objectType: "secretsmanager"
        jmesPath:
          - path: password
            objectAlias: DB_PASSWORD
  secretObjects:                 # only when the app reads the value as an env var
    - secretName: <service>-secrets
      type: Opaque
      data:
        - objectName: DB_PASSWORD
          key: DB_PASSWORD
```

- A `:json-key::` suffix becomes a `jmesPath` entry.
- `secretObjects` sync requires the CSI volume to be mounted in the pod; mount it even when
  the app only reads env vars.
- **`eks-fargate-profile`**: the AWS provider (ASCP) does not support Fargate. Emit an
  `ExternalSecret` (External Secrets Operator) instead and report the operator as a
  prerequisite.

### ECS `healthCheck` -> probes

| ECS | Kubernetes |
|---|---|
| `command: ["CMD-SHELL", "..."]` | `livenessProbe.exec.command: ["sh", "-c", "..."]` |
| `command: ["CMD", ...]` | `livenessProbe.exec.command: [...]` |
| `interval`, `timeout`, `retries` | `periodSeconds`, `timeoutSeconds`, `failureThreshold` |
| `startPeriod` | `startupProbe` with the same check, `failureThreshold * periodSeconds >= startPeriod` |

A `CMD-SHELL` check calling `curl localhost:<port>/<path>` may be rewritten as `httpGet` on
that port and path; cite the original in the report.

**Every container with a `healthCheck` gets a `readinessProbe`. This is not optional.** Its
source, in order:

1. The load balancer target group `health_check` (path, port, matcher), when the service has one.
2. Otherwise, the same check as the `livenessProbe`, with the same `periodSeconds`,
   `timeoutSeconds` and `failureThreshold`. Record it in the report as low risk.

Do not emit a `livenessProbe` without a `readinessProbe`. On ECS, a task that fails its health
check stops receiving traffic; on Kubernetes, only a failing readiness probe removes a pod from
its `Service` endpoints. With liveness alone, a pod whose dependency is down keeps receiving
requests until liveness restarts it. Services reached only through Service Connect or Cloud Map
have no target group, so they always take the second source.

### Service Connect and Cloud Map -> `Service`

| ECS | Kubernetes |
|---|---|
| `service_connect_configuration.service[].client_alias.dns_name` (or `discovery_name`, or the `port_name`) | `Service.metadata.name` |
| `client_alias.port` | `Service.spec.ports[].port` |
| the named `portMappings` entry | `targetPort` (by name) |
| Service Connect `namespace` | Kubernetes namespace (Phase 0 default) |
| `service_registries` (Cloud Map DNS) | `Service` named after the registry service |

Clients calling `http://catalog` or `http://catalog:80` keep working when the `Service` has the
same short name in the same namespace. A `dns_name` containing dots, or a Cloud Map namespace
shared across clusters, cannot be reproduced by name: `TODO(migration)` and report.
Services with `client_alias` absent (client-only Service Connect) get no `Service`.

**Every** alias, registry and load balancer target gets a `Service`. A Deployment without the
Service its clients resolve is the most common silent gap.

### Load balancer -> `Ingress` or `HTTPRoute`

Driven by `ingress_strategy` (default `alb-ingress`).

| ECS / ELB | `alb-ingress` | `gateway-api` |
|---|---|---|
| `load_balancer { target_group_arn, container_name, container_port }` | `Ingress` backend -> the `Service` | `HTTPRoute` backendRef -> the `Service` |
| listener rule path / host conditions | `rules[].http.paths` / `host` | `matches[]` |
| internet-facing / internal scheme | `alb.ingress.kubernetes.io/scheme` | Gateway listener, reported |
| target group health check | `alb.ingress.kubernetes.io/healthcheck-path` + readinessProbe | readinessProbe |

`ingressClassName`: `alb` for the AWS Load Balancer Controller on `eks-standard`; on
`eks-auto-mode` the class must use controller `eks.amazonaws.com/alb`: emit that
`IngressClass` plus an `IngressClassParams` in API group **`eks.amazonaws.com/v1`**, referenced
by `spec.parameters` (`apiGroup: eks.amazonaws.com`, `kind: IngressClassParams`). The
`elbv2.k8s.aws/v1beta1` group belongs to the self-managed Load Balancer Controller and does
not exist on an Auto Mode cluster. Set the scheme on the `IngressClassParams`
(`scheme: internet-facing` or `internal`, from the source load balancer); a params object the
`IngressClass` does not reference is ignored. Certificates, WAF and
listener TLS policy are placeholders plus report entries; the ALB, its listeners and security
groups stay in the source IaC and are not recreated.

### Task role -> `ServiceAccount` + identity

| `migration_target` | Emit |
|---|---|
| `eks-auto-mode`, `eks-standard` | `ServiceAccount` with **no** role annotation, plus `eks/iam/pod-identity.tf` (Terraform sources) or a report table (other sources) with one `aws_eks_pod_identity_association` per service |
| `eks-fargate-profile` | `ServiceAccount` with `eks.amazonaws.com/role-arn` (IRSA), because Pod Identity is not available on Fargate |

The workload role's trust policy changes: Pod Identity trusts the service principal
`pods.eks.amazonaws.com` with `sts:AssumeRole` and `sts:TagSession`. The task role trusted
`ecs-tasks.amazonaws.com`. Report the trust-policy change; never edit the source role.
`eks-standard` also needs the `eks-pod-identity-agent` add-on (built into Auto Mode): report it.

---

## SCAFFOLD

### Execution role -> permission redistribution

Nothing in a pod assumes an execution role. Split its permissions by who needs them on EKS:

| Execution role permission | On EKS it belongs to | Action |
|---|---|---|
| ECR pull (`AmazonECSTaskExecutionRolePolicy`, `ecr:*`) | the node role | Report (usually already present) |
| CloudWatch Logs (`logs:CreateLogStream`, `logs:PutLogEvents`) | the log agent's role | Report |
| `secretsmanager:GetSecretValue`, `ssm:GetParameters`, `kms:Decrypt` for the task's secrets | **the workload's own role** (the CSI provider uses the pod identity) | Add to the emitted Pod Identity role policy, or report with the exact statements |

Missing the third row is a silent failure: the pod stays in `ContainerCreating` with a
mount error.

### `awsvpc` security groups -> pod security groups

| `migration_target` | Emit | Guarantee change |
|---|---|---|
| `eks-standard` | `SecurityGroupPolicy` (`vpcresources.k8s.aws/v1beta1`) per service, `podSelector` on the service label; report `ENABLE_POD_ENI=true` on the VPC CNI and supported instance types | Per-service, same as ECS |
| `eks-fargate-profile` | `SecurityGroupPolicy` per service; the list must include the cluster security group | Per-service |
| `eks-auto-mode` | `NodeClass` (`eks.amazonaws.com/v1`) with `podSecurityGroupSelectorTerms` + `podSubnetSelectorTerms` and a `NodePool` (`karpenter.sh/v1`, `spec.template.spec.nodeClassRef` group `eks.amazonaws.com`, kind `NodeClass`) per distinct security-group set. The `NodeClass` MUST also set `role`, `subnetSelectorTerms` and `securityGroupSelectorTerms` (placeholders when unknown), and the `NodePool` MUST set `spec.template.spec.requirements` (the same baseline as the built-in `general-purpose` pool: `karpenter.sh/capacity-type In [on-demand]`, `eks.amazonaws.com/instance-category In [c, m, r]`, `eks.amazonaws.com/instance-generation Gt 4`, `kubernetes.io/arch In [amd64]`, `kubernetes.io/os In [linux]`): the API server rejects either without them. Workloads MUST select the pool (`nodeSelector: karpenter.sh/nodepool: <name>`), or they land on the built-in `general-purpose` pool and never get the pod security groups | **Class-level**: all pods on the NodeClass share the groups. Security Groups for Pods is not supported on Auto Mode. Report the granularity loss and suggest NetworkPolicies for pod-to-pod rules |

Security group ids are placeholders quoting the source expression. Rules that only allow
traffic from other ECS tasks' groups must be re-expressed; report each one.

### Application Auto Scaling -> `HorizontalPodAutoscaler`

`ECSServiceAverageCPUUtilization` target -> `metrics[].resource.cpu.target.averageUtilization`
(requires `requests.cpu`). Memory likewise. ALB request count or custom CloudWatch metrics ->
`TODO(migration)`; report KEDA or an external metrics adapter as the options. `min_capacity`
/ `max_capacity` -> `minReplicas` / `maxReplicas`.

### Capacity providers -> Karpenter `NodePool`

Only for `eks-standard`. `FARGATE_SPOT` weights -> `karpenter.sh/capacity-type: spot`
requirement as a comment-annotated scaffold. On Auto Mode, report that capacity is managed and
the built-in `general-purpose` NodePool may suffice.

### `CODE_DEPLOY` -> Argo Rollouts `Rollout`

Blue/green with the traffic-shift settings copied as comments. Marked incomplete.

### Placement -> scheduling

`spread` on `attribute:ecs.availability-zone` -> `topologySpreadConstraints` on
`topology.kubernetes.io/zone`. `distinctInstance` -> pod anti-affinity on
`kubernetes.io/hostname`. `memberOf` expressions and `binpack` -> `TODO(migration)`.

### `awslogs` -> log routing note

The log group name and stream prefix are recorded per service so the cluster log agent
(CloudWatch Observability add-on or Fluent Bit) can route to the same destination. No
manifest is emitted per service.

---

## REPORT-ONLY

| Construct | Why | Recommended path |
|---|---|---|
| Service Connect retries, outlier detection, timeouts, TLS, proxy metrics | Managed proxy features with no manifest equivalent | Accept, move to application-level retries, or adopt a service mesh (Istio add-on) |
| `firelens` log router container | ECS-specific log driver | Cluster log agent |
| OpenTelemetry / X-Ray sidecar | Usually cluster-wide on EKS | ADOT or CloudWatch Observability add-on |
| EventBridge rules on ECS task/service events | ECS-emitted events | Kubernetes events, Argo/Flux notifications, or CloudWatch Container Insights |
| ECS Exec | ECS control plane feature | `kubectl exec` with RBAC |
| Container Insights setting | Cluster setting on ECS | CloudWatch Observability add-on |
| `bridge` / `host` network mode | Dynamic host ports have no equivalent | `hostNetwork` only with a design review |
| Task metadata endpoint usage in code | Different contract | Downward API |
| EFS / bind-mount volumes | Storage design decision | EFS CSI driver `PersistentVolume`, scaffold on request |
| `privileged`, `linuxParameters.capabilities`, `ulimits` | Pod Security Admission impact | Namespace PSA level decision |
