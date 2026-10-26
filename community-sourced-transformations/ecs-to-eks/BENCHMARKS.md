# Benchmark Results - Amazon ECS to Amazon EKS

## Executive Summary

| Metric | Result |
|--------|--------|
| Repositories tested | 2 real public ECS repositories, pinned to a commit |
| IaC formats covered | Terraform (modules + `jsonencode` locals) and CloudFormation |
| Migration targets covered | `eks-auto-mode` and `eks-standard` |
| Transformation outputs complete | **2/2** (`MIGRATION_REPORT.md` status `complete` in both) |
| **Source integrity** | **0 files modified outside `eks/` and the report, in both runs** |
| Files emitted | 23 (`retail-store-sample-app`) and 12 (`ecs-refarch-cloudformation`) |
| YAML parse failures | **0** of 34 |
| `kubectl apply --dry-run=client` on core kinds | **0 failures** |
| ECS-only fields surviving in emitted YAML | **0** in both runs |
| `eks.amazonaws.com/role-arn` annotations (IRSA) | **0** in both runs (Pod Identity targets) |
| `TODO(migration)` markers | 26 and 17, every emitting file referenced in the report |
| `MIGRATION_REPORT.md` | 25.8 KB and 18.3 KB |
| Total agent minutes | 140.70 |
| Total estimated cost | ~US$ 4.92 (at US$ 0.035 / agent minute) |

Both runs reached the 70 agent-minute cap passed with `--limit 70` and exited with code 2
after their work was written: each run's worklog records the final file list and a passing
validation before the cap. The measurements below are taken from the emitted files, not
from the agent's own summary.

### Methodology

The fixtures are **real public repositories**, not hand-written ones, pinned to a commit so the
result stays reproducible:

| Repo | Licence | Commit | IaC | Target |
|---|---|---|---|---|
| `aws-containers/retail-store-sample-app` | MIT-0 | `d7a380b843e0759e58754f74188ea18252a51415` | Terraform | `eks-auto-mode` |
| `aws-samples/ecs-refarch-cloudformation` | Apache-2.0 | `a257e226b33bd9d2a721e5afd9d7e8b66dbacfdc` | CloudFormation | `eks-standard` |

`ecs-refarch-cloudformation` is archived upstream. It is used because it is an AWS-published
CloudFormation ECS layout on EC2 capacity with `bridge` networking, which exercises paths the
Terraform fixture does not.

Real repositories were chosen over a hand-authored fixture for the same reason as the other
community samples: a fixture written by the author of the mapping contains only the constructs
the mapping already knows. `retail-store-sample-app` declares its five services once, in a
shared Terraform module instantiated per service, with container definitions built by
`jsonencode(...)` and Service Connect for service-to-service calls. `ecs-refarch-cloudformation`
uses nested CloudFormation stacks wired through `!Ref` / `!GetAtt` outputs and Application
Auto Scaling.

Each repository was cloned at the pinned commit, then transformed with a plan context that only
sets the target and gives no ECS-specific hints:

```bash
atx custom def exec -n ecs-to-eks -p . -x -t \
  --configuration file://config.json --limit 70
```

```text
retail-store-sample-app:     migration_target: eks-auto-mode, ingress_strategy: alb-ingress, namespace: retail-store
ecs-refarch-cloudformation:  migration_target: eks-standard,  ingress_strategy: alb-ingress, namespace: ecs-refarch
```

The build command was an external, deterministic gate the agent does not author: `eks/` exists,
every YAML parses, no ECS-only field survives outside comments, and the report exists.

Assertions are **invariants**, not expected findings, because a real repository has no answer
key: source integrity, output existence, zero ECS field leakage, YAML validity, client dry-run
on core kinds, the IAM mechanism matching the target, `TODO`/report pairing, the exact
`## Manual Action Items` heading, and no em dash.

---

## At-a-Glance Results

| # | Repository | Status | Files emitted | Source files changed | ECS leak | IRSA annotations | Dry-run failures | TODOs | Agent Min | Cost |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `retail-store-sample-app` (716 files) | PASS | 23 | **0** | 0 | 0 | 0 / 17 | 26 | 70.34 | $2.46 |
| 2 | `ecs-refarch-cloudformation` (30 files) | PASS | 12 | **0** | 0 | 0 | 0 / 9 | 17 | 70.36 | $2.46 |
| | **TOTALS** | **2/2** | **35** | **0** | **0** | **0** | **0** | **43** | **140.70** | **$4.92** |

Kinds emitted:

| Kind | retail-store | ecs-refarch |
|---|---|---|
| `Namespace` | 1 | 1 |
| `Deployment` | 5 | 2 |
| `Service` | 5 | 2 |
| `ServiceAccount` (no role annotation) | 5 | 2 |
| `Ingress` | 1 | 1 |
| `IngressClass` + `IngressClassParams` (`eks.amazonaws.com/alb`) | 1 + 1 | - |
| `SecretProviderClass` (`usePodIdentity: "true"`) | 2 | - |
| `NodeClass` with `podSecurityGroupSelectorTerms` / `NodePool` | 1 / 1 | - |
| `SecurityGroupPolicy` | - | 2 |
| `HorizontalPodAutoscaler` | - | 1 |
| Karpenter `NodePool` + `EC2NodeClass` | - | 1 + 1 |
| `eks/iam/pod-identity.tf` (`aws_eks_pod_identity_association` x5) | 1 | - |

---

## Exit Criteria Compliance (per SKILL.md)

| # | Exit criterion | retail-store | ecs-refarch |
|---|---|---|---|
| 1 | Every Phase 1 construct appears in the report with its classification | PASS (63 inventory rows) | PASS (38 inventory rows) |
| 2 | Originals byte-identical; output under `eks/`; report at root; nothing else at root | PASS | PASS |
| 3 | Zero ECS-only fields in emitted Kubernetes YAML | PASS | PASS |
| 4 | YAML parses; core kinds clean under `--dry-run=client`; CRD kinds listed with their CRD | PASS | PASS |
| 5 | One `Deployment` + `ServiceAccount` per service; a `Service` per alias / registry / target | PASS (5 / 5 / 5) | PASS (2 / 2 / 2) |
| 6 | IAM mechanism matches the target (Pod Identity, no role-arn annotation) | PASS | PASS |
| 7 | Task role and execution-role secret grants on the workload role or in the report | PASS (catalog, orders) | PASS (no task or execution role in source; reported) |
| 8 | No secret value inlined | PASS | PASS (no secrets in source) |
| 9 | Every `awsvpc` security group carried by the target mechanism or reported | PASS (`NodeClass`, class-level, reported) | PASS (`SecurityGroupPolicy` per service) |
| 10 | Every `TODO(migration)` in `## Manual Action Items`, and vice versa | PASS (11 items) | PASS (8 items) |
| 11 | Unresolved IaC expressions quoted verbatim, never evaluated | PASS | PASS |

The emitted Terraform (`eks/iam/pod-identity.tf`) passes `terraform fmt -check`. The report
text and all emitted files contain no em dash.

---

## What the Runs Showed

**The Terraform module layout resolved without hints.** The v0.1.0 development run was given the
module path in its plan context. In this round the plan context carried no ECS-specific
guidance, and the run still followed `terraform/lib/ecs/service` through each of the five
`module` instantiations, resolving per-service values from each block's arguments.

**Service Connect split exactly as classified.** Each of the five aliases became a `Service`
with the same short name and `port: 80 -> targetPort` by port name, so clients calling
`http://catalog` keep resolving. Each service also received a REPORT-ONLY entry for the proxy
features (retries, outlier detection, timeouts) the `Service` does not reproduce.

**Execution-role secret grants moved to the workload identity.** `catalog` and `orders` read
database and broker credentials through the execution role on ECS. Both `SecretProviderClass`
objects use `usePodIdentity: "true"`, and `pod-identity.tf` plus the report's IAM
Redistribution table carry the `secretsmanager:GetSecretValue` / `kms:Decrypt` grants onto the
workload roles.

**The two targets took different security-group paths.** On `eks-auto-mode` the run emitted a
`NodeClass` with `podSecurityGroupSelectorTerms` and reported that the groups become
class-level. On `eks-standard` it emitted one `SecurityGroupPolicy` per service and reported the
`ENABLE_POD_ENI=true` prerequisite on the VPC CNI.

**`bridge` networking was reported, not approximated.** `ecs-refarch-cloudformation` runs on EC2
with `bridge` mode and dynamic host ports. The run converted the containers and reported the
network mode as a medium-risk manual action rather than emitting `hostPort`s.

**Literal values were copied, not invented.** The CloudFormation fixture hardcodes its image URIs
in the template. With no `registry` set, the run left those references as they are in the
source.

### Known cost

Both runs used their full 70 agent-minute budget, about the same as the `openshift-to-eks`
round (~71 per repository). Because the report skeleton is written first and updated as each
phase completes, the report was already complete when the cap was reached. For larger estates,
raise `--limit`, or resume with `atx --conversation-id <id> -t --limit <higher>`.

---

## Live Deployment on EKS Auto Mode

The offline invariants above say the output is well formed. They do not say it runs. So the
`retail-store-sample-app` output was deployed to a throwaway cluster and used.

### Setup

| Item | Value |
|---|---|
| Cluster | EKS 1.34, Auto Mode, created with `eksctl --enable-auto-mode`, us-east-1 |
| Backing services | The repository's own `terraform/lib/dependencies` module: Aurora MySQL, Aurora PostgreSQL, DynamoDB, ElastiCache Redis, Amazon MQ (RabbitMQ), OpenSearch |
| Operator-supplied, per the report | Values for every `REPLACE_ME_*` placeholder; the four Secrets Manager secrets in the same JSON shape the ECS module used; one IAM role per service trusting `pods.eks.amazonaws.com`, with the DynamoDB policy on `carts` and `checkout` and secret read on `catalog` and `orders`; the `aws-secrets-store-csi-driver-provider` add-on |
| Pod Identity associations | The generated `eks/iam/pod-identity.tf`, with only its `role_arn` placeholders set |

### Round 1: v0.2.0 output found five defects

A server-side dry run on the live cluster rejected, or silently mis-applied, objects that pass
every offline check:

| Defect | Live result |
|---|---|
| `IngressClassParams` in `elbv2.k8s.aws/v1beta1` | Rejected: that group only exists with the self-managed Load Balancer Controller |
| `IngressClass` did not reference its `IngressClassParams` | Accepted, params ignored |
| Port name `checkout-service` (16 characters) | Rejected: the limit is 15 |
| `NodeClass` without `role`, `subnetSelectorTerms`, `securityGroupSelectorTerms` | Rejected |
| `NodePool` scaffold not selected by any workload | Pods ran on `general-purpose`; pod security groups never applied |

With those worked around by hand, all five services ran and the storefront answered through
the ALB. Each defect was then fixed in the definition (v0.2.2).

### Round 2: v0.2.2 output, deployed as generated

v0.2.2 was run on a fresh clone at the same commit (92.31 agent minutes against a 90-minute
cap, report `complete`, 0 source files changed, 0 ECS fields, 0 IRSA annotations). A
server-side dry run on the live cluster rejected **1 of 23** objects: the `NodePool` had no
`spec.template.spec.requirements`, a required field. That was the only change made by hand,
and it is fixed in the definition as v0.2.3. Everything else was applied exactly as generated.

| Check | Result |
|---|---|
| Pods | **5/5 Running and ready, 0 restarts**, all on the generated `retail-store-sg` NodePool |
| Pod security groups | Applied through the generated `NodeClass` `podSecurityGroupSelectorTerms` |
| ALB | Provisioned by Auto Mode from the generated `IngressClass` + `IngressClassParams` (`internet-facing`) |
| `GET /`, `/catalog`, `/cart`, `/checkout`, `/topology` | **HTTP 200** through the ALB |
| Secrets | Synced by the CSI driver with Pod Identity: 5 keys for `catalog`, 6 for `orders` |
| `catalog` | Migrated MySQL, connected to OpenSearch, indexed 12 products |
| `orders` | Ran its PostgreSQL migration, connected to RabbitMQ |
| **Purchase flow** | Browse, add to cart, address, delivery, payment: **"Order placed"** with an order ID. `GET /orders` on the `orders` service returns the order; the round 1 order is also still there after round 2 replaced every pod, so it is persisted in Aurora PostgreSQL |

The Service Connect names (`http://catalog`, `http://carts`, ...) resolved as Kubernetes
`Service` names with no application change, which is the MECHANICAL half of the Service
Connect mapping. The proxy features (retries, outlier detection) were not exercised.

The cluster and backing services were test-only and are torn down after the run.
