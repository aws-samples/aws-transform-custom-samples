---
name: ecs-to-eks
description: >-
  Transforms Amazon ECS task definitions and services, whether declared in Terraform,
  CloudFormation, CDK output or raw JSON, into Kubernetes manifests for Amazon EKS.
  Converts task definitions to Deployments, Service Connect and Cloud Map names to
  Services, task roles to EKS Pod Identity, secrets to the Secrets Store CSI driver, and
  per-task security groups to the target's pod security group mechanism, then produces a
  migration report covering everything that cannot be automated safely.
  Trigger: ECS migration, ECS to EKS, task definition, Service Connect, Fargate to EKS.
type: custom
version: 0.2.3
---

# Amazon ECS to Amazon EKS

## Objective

Convert a repository that deploys workloads to Amazon ECS into Kubernetes manifests that apply
on Amazon EKS, and document in `MIGRATION_REPORT.md` everything the transformation cannot do
safely. This definition executes the change on **one** repository. It has no paired readiness
assessment yet, so deciding which services move, and in what order, stays with the operator.

## Scope

Transforms ECS workload definitions from any of these sources:

- **Terraform**: `aws_ecs_task_definition` (with `container_definitions` given as
  `jsonencode(...)`, `file(...)`, `templatefile(...)` or a heredoc) and `aws_ecs_service`,
  including resources declared once inside a module and instantiated per service
- **CloudFormation** `AWS::ECS::TaskDefinition` and `AWS::ECS::Service`, and CDK synthesized
  templates
- **Raw JSON** task and service definitions, as passed to `aws ecs register-task-definition` or
  kept alongside CI pipelines

Constructs covered: container definitions, task- and container-level cpu/memory, task role,
execution role, environment and secrets, health checks, port mappings, ECS Service Connect,
Cloud Map service registries, load balancer target groups, `awsvpc` security groups, and log
configuration. The classification of every construct is fixed in
`references/01-construct-mapping.md`.

**Non-Goals** - always reported, never transformed:

1. **Service Connect proxy behaviour.** Name and port resolution map to a Kubernetes `Service`.
   Retries, outlier detection, timeouts, Service Connect TLS and proxy telemetry come from the
   managed proxy and have no manifest equivalent without a service mesh or an application
   change. Reported per service.
2. **The execution role as a role.** Nothing in a pod assumes an execution role. Its permissions
   are redistributed (see the mapping); the role itself is not recreated.
3. **Application Auto Scaling policies** on ECS metrics (`ECSServiceAverageCPUUtilization`,
   `ECSServiceAverageMemoryUtilization`, ALB request count). Emits an `HPA` scaffold naming the
   source metric; never wires a metrics pipeline.
4. **Capacity providers and cluster Auto Scaling groups.** Node provisioning is a cluster
   decision. Emits a Karpenter `NodePool` scaffold only for `eks-standard`.
5. **`deploymentController: CODE_DEPLOY` blue/green.** Needs a progressive delivery controller
   the customer must choose. Emits an Argo Rollouts `Rollout` scaffold, marked incomplete.
6. **Placement constraints and strategies** (`distinctInstance`, `memberOf`, `binpack`,
   `spread`). Emits `affinity` / `topologySpreadConstraints` scaffolds with the original rule as
   a comment.
7. **ECS-only operational features**: EventBridge rules on ECS events, ECS Exec
   (`enable_execute_command`), Container Insights settings, ECS lifecycle events. Reported with
   the EKS equivalent to evaluate.
8. **Application code reading the ECS task metadata endpoint** (`ECS_CONTAINER_METADATA_URI*`,
   `169.254.170.2`). Flagged at the site, not rewritten.
9. **Supporting infrastructure**: VPC, databases, caches, queues, the ALB itself, IAM policy
   documents. Left untouched and referenced from the manifests by placeholder.
10. **Executing anything.** No `terraform plan`/`apply`, no AWS API calls, no `kubectl apply`
    against a cluster. This produces code.

## Constraints

### Correctness

- **Never delete a resource.** Transform in place, or leave it and report it.
- **Never evaluate an IaC expression.** `${var.x}`, `module.y.z`, `local.*`, `!Ref`, `!GetAtt`
  and `Fn::ImportValue` become a placeholder plus a `TODO(migration)` that quotes the original
  expression verbatim. Never invent an account id, Region, ARN, endpoint or secret name.
- **Choose the IAM mechanism from `migration_target`.** `eks-auto-mode` and `eks-standard` use
  EKS Pod Identity: a `ServiceAccount` with **no** `eks.amazonaws.com/role-arn` annotation, plus
  a Pod Identity association emitted under `eks/iam/`. Only `eks-fargate-profile` uses the IRSA
  annotation, because Pod Identity is not available on Fargate.
- **Secrets are never inlined.** Every ECS `secrets` entry becomes a `SecretProviderClass`
  reference (or an `ExternalSecret` for `eks-fargate-profile`, where ASCP is not supported).
- **Secret read permissions follow the secret.** On ECS the execution role reads secrets at task
  launch; on EKS the CSI provider reads them with the pod's own identity. Every
  `secretsmanager:GetSecretValue`, `ssm:GetParameters` and `kms:Decrypt` grant on the execution
  role must be added to that service's workload role, or the mount fails at pod start.
- **If a mapping is ambiguous, do not guess.** Add a `TODO(migration)` at the exact site and a
  report entry. A manifest that applies cleanly and behaves differently is worse than an
  annotated gap.
- **Never invent a mapping.** A construct with no equivalent is reported, not approximated.

### Source integrity

- **Additive, and that includes files at the repository root.** Originals untouched; converted
  output under `eks/`. **`MIGRATION_REPORT.md` goes at the repository ROOT.**
- **Never create or modify a file at the repository root** other than `MIGRATION_REPORT.md`.
- Stay on the current branch. Do not create, switch or checkout a branch.

### Exploration budget

- **Phase 1 reads infrastructure code only**: `*.tf`, CloudFormation/CDK templates, task
  definition JSON, and CI files that register task definitions or deploy services.
- Application source is touched only by a targeted search for the metadata endpoint (Non-Goal 8).
  Do not read application code, lock files, vendored dependencies, tests, docs or unrelated
  sample directories.

### Reporting

- **Write the report skeleton before transforming.** At the end of Phase 1, write
  `MIGRATION_REPORT.md` from `references/02-report-template.md` with the full inventory, then
  update it as each phase completes, so a run stopped by its budget still leaves a report.
- **The manual-action section of the report is named exactly `## Manual Action Items`.**
- Every automatic change and manual action item traceable to file and line (or JSON path).
- Risk per change (low / medium / high), never a flat list.
- **No em dash (U+2014) anywhere in emitted output** - use a hyphen.

## Workflow

```text
Phase 0: Read additionalPlanContext
├── migration_target: eks-auto-mode | eks-standard | eks-fargate-profile (default eks-auto-mode)
├── ingress_strategy: alb-ingress | gateway-api (default alb-ingress)
├── registry: optional ECR base URI; when absent, image references are left unchanged
└── namespace: target namespace (default: the Service Connect namespace name, else the ECS
    cluster name, else TODO(migration))

Phase 1: Inventory, then report skeleton
├── Locate every ECS task definition and service in the scoped IaC paths
├── Terraform modules: follow each module source; one module instantiation = one ECS service
├── Per service record: containers, cpu/memory, ports, Service Connect aliases, service
│   registries, load balancer bindings, security groups, task role, execution role, secrets
├── Classify each construct: MECHANICAL / SCAFFOLD / REPORT-ONLY (references/01-construct-mapping.md)
└── Write MIGRATION_REPORT.md (references/02-report-template.md) with the inventory BEFORE Phase 2

Phase 2: Transform the MECHANICAL set (one directory per service under eks/<service>/)
├── Task definition -> Deployment (replicas from desired_count; essential=false -> sidecar)
├── cpu / memory / memoryReservation -> resources.requests / resources.limits
├── environment -> env (one container) or ConfigMap (shared values)
├── secrets -> SecretProviderClass + CSI volume (+ secretObjects sync when consumed as env)
├── ECS healthCheck -> livenessProbe (+ startupProbe from startPeriod)
├── ECS healthCheck -> readinessProbe, ALWAYS: the load balancer target group health check when
│   one exists, otherwise the liveness check (never liveness without readiness)
├── Service Connect client alias / Cloud Map registry -> Service (ClusterIP)
├── Load balancer target group + listener rule -> Ingress (ALB) or HTTPRoute
├── Task role -> ServiceAccount + Pod Identity association (IRSA only on eks-fargate-profile)
└── Namespace manifest

Phase 3: Emit SCAFFOLDS for the partly-automatable set
├── Execution role -> permission redistribution (secret grants onto the workload role)
├── awsvpc security groups -> SecurityGroupPolicy (eks-standard, eks-fargate-profile) or
│   NodeClass podSecurityGroupSelectorTerms (eks-auto-mode, class-level: report the loss of
│   per-service granularity)
├── Application Auto Scaling -> HorizontalPodAutoscaler
├── Capacity provider -> Karpenter NodePool (eks-standard only)
├── CODE_DEPLOY -> Argo Rollouts Rollout
├── Placement -> affinity / topologySpreadConstraints
└── awslogs log groups -> log routing note for the cluster log agent

Phase 4: Validate what can be validated locally
├── every emitted YAML parses
├── kubectl apply --dry-run=client on core kinds; CRD-backed kinds (SecretProviderClass,
│   SecurityGroupPolicy, NodeClass, NodePool, Rollout, ExternalSecret) are parse-checked and
│   listed in the report with the CRD they require
├── terraform fmt -check on any emitted .tf
├── grep: no ECS-only field in emitted YAML; no role-arn annotation unless eks-fargate-profile;
│   no literal secret value
└── every Service Connect alias, Cloud Map registry and load balancer target has a Service

Phase 5: Finalize MIGRATION_REPORT.md
├── Inventory with the classification of every construct
├── Automatic changes, per service
├── IAM redistribution table (task role, execution role grants)
├── ## Manual Action Items, cross-referenced with every TODO(migration)
├── Risk per change
└── Residual blockers by name (Service Connect proxy features, CODE_DEPLOY, ECS Exec, EventBridge)
```

## Exit Criteria

1. Every construct in the Phase 1 inventory appears in the report with its classification.
   Nothing silently skipped.
2. Original IaC and definitions byte-identical; all output under `eks/`; `MIGRATION_REPORT.md`
   at the repository root; no other file created or modified at the root.
3. Zero ECS-only fields (`taskRoleArn`, `executionRoleArn`, `containerDefinitions`,
   `requiresCompatibilities`, `networkMode`) in emitted Kubernetes YAML.
4. Every emitted YAML parses; core kinds are clean under `--dry-run=client`; every CRD-backed
   kind is listed in the report with the CRD it requires.
5. Every ECS service has one `Deployment` and one `ServiceAccount`; every Service Connect client
   alias, Cloud Map registry and load balancer target has a matching `Service`.
6. The IAM mechanism matches `migration_target`: Pod Identity associations and no role-arn
   annotation for `eks-auto-mode` / `eks-standard`; IRSA only for `eks-fargate-profile`.
7. Every task role permission and every execution role secret grant is either on the workload
   role or in the report.
8. No secret value is inlined in emitted output.
9. Every `awsvpc` security group is carried by the target's mechanism or reported.
10. Every `TODO(migration)` has an entry in `## Manual Action Items`, and vice versa.
11. Every unresolved IaC expression is quoted verbatim in a `TODO(migration)`, never evaluated.
12. Every container with a health check has a `readinessProbe`.
13. Every emitted object uses an API group that exists on the target (`eks.amazonaws.com/v1`
    for `NodeClass` and `IngressClassParams` on `eks-auto-mode`), every required field is
    present (placeholders allowed; includes `NodeClass` selectors and `role`, and `NodePool`
    `requirements`), and every port name is at most 15 characters.
