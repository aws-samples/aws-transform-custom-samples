# Amazon ECS to Amazon EKS

Transforms a repository that deploys to Amazon ECS into Kubernetes manifests for Amazon EKS -
converting task definitions to `Deployment`s, Service Connect and Cloud Map names to `Service`s,
task roles to EKS Pod Identity, secrets to the Secrets Store CSI driver, and per-task security
groups to the target's pod security group mechanism, and reporting every construct that has no
safe equivalent.

**Additive by design: the original IaC is never modified. Output lands under `eks/`.**

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [What This Skill Does](#what-this-skill-does)
- [Skill Architecture](#skill-architecture)
- [Paired Readiness Assessment](#paired-readiness-assessment)
- [Getting Started](#getting-started)
- [Benchmarks](#benchmarks)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Repository Structure](#repository-structure)

## Overview

An ECS repository is not a set of Kubernetes objects waiting to be renamed. Its workloads are
task definitions and services declared in Terraform, CloudFormation, CDK output or raw JSON,
usually through variables, module outputs and `jsonencode(...)` locals. Service-to-service calls
resolve through Service Connect or Cloud Map, each task can carry its own security group, and
two IAM roles split what a pod on EKS gets from one identity.

This transformation reads the task definitions and services wherever they are declared, converts
what maps deterministically, scaffolds what is partly automatable, and reports what cannot be
automated safely - each construct classified in advance, not decided per run.

## The Problem

Three failure modes make a hand migration expensive, and all three are silent:

1. **Per-task security groups collapse to the node's.** On ECS with `awsvpc`, every task of a
   service can carry its own security group, and an RDS or cache security group often allows
   only that group. On EKS, without Security Groups for Pods (or, on Auto Mode, a `NodeClass`
   with pod security groups), every pod uses the node's group. Nothing fails; the isolation is
   simply gone.
2. **Service Connect becomes a plain `Service` and loses its proxy.** Clients calling
   `http://catalog` keep working, so the migration looks correct. The retries, outlier detection
   and timeouts the Service Connect proxy applied are no longer there, and the first bad
   dependency shows it.
3. **`memory` and `memoryReservation` are mapped the wrong way round.** On ECS, `memory` is the
   hard limit and `memoryReservation` the soft reservation. Copying `memory` into
   `requests.memory`, or dropping the reservation, gives pods that schedule badly or are
   OOM-killed under a load the ECS task survived.

A transformation that guesses on any of these produces manifests that apply cleanly and are
wrong, which is worse than an annotated gap.

## What This Skill Does

| Phase | Action |
|---|---|
| 0 | Reads `additionalPlanContext`: `migration_target`, `ingress_strategy`, `registry`, `namespace` |
| 1 | Inventories every task definition and service in the IaC, classifies each construct **MECHANICAL / SCAFFOLD / REPORT-ONLY**, and writes the `MIGRATION_REPORT.md` skeleton before transforming anything |
| 2 | Converts the mechanical set: task definition → `Deployment`, cpu/memory → `resources`, `secrets` → `SecretProviderClass`, health checks → probes, Service Connect / Cloud Map → `Service`, load balancer → `Ingress` or `HTTPRoute`, task role → `ServiceAccount` + Pod Identity association |
| 3 | Emits scaffolds: execution-role secret grants moved to the workload role, `awsvpc` security groups → `SecurityGroupPolicy` or a `NodeClass`, Application Auto Scaling → `HPA`, capacity providers → Karpenter `NodePool`, `CODE_DEPLOY` → Argo Rollouts |
| 4 | Validates: YAML parses, `kubectl apply --dry-run=client` on core kinds, and asserts no ECS-only field, no literal secret and no stray IRSA annotation survives in the output |
| 5 | Finalizes `MIGRATION_REPORT.md` with the full inventory, the IAM redistribution, the risk per change, and every manual action item |

## Skill Architecture

Lean `SKILL.md` orchestration spine plus references loaded on demand:

```text
SKILL.md                            spine: scope, constraints, 6 phases, exit criteria
references/01-construct-mapping.md  every construct, its classification, and the mapping
references/02-report-template.md    the migration report structure
```

### Key Design Decisions

**IaC expressions are quoted, never evaluated.** `${var.x}`, `module.y.z` and `!GetAtt` become a
placeholder and a `TODO(migration)` that quotes the original expression. A resolved-looking ARN
or endpoint that is actually a guess fails later in a way that reads as an IAM or network
problem.

**The IAM mechanism follows the target.** `eks-auto-mode` and `eks-standard` get EKS Pod
Identity: a `ServiceAccount` with no role annotation plus an association. Only
`eks-fargate-profile` gets the IRSA annotation, because Pod Identity is not available on Fargate.

**Secret permissions follow the secret.** On ECS the execution role reads secrets at task launch;
on EKS the CSI provider reads them with the pod's own identity. The transformation moves those
grants onto the workload role, because leaving them on a role nothing assumes leaves the pod in
`ContainerCreating` with a mount error.

**Auto Mode is the default target, with its trade-off reported.** It is AWS's recommended
direction over Fargate profiles, but Security Groups for Pods is not supported there: pod
security groups apply per `NodeClass`, not per service. The report says so for every service
whose security group would be shared.

**The report is written first.** The skeleton lands at the end of Phase 1 and is updated after
each phase, so a run stopped by its agent-minute budget still leaves a report of how far it got.

## Paired Readiness Assessment

This definition transforms **one** repository. There is no companion readiness assessment for
ECS estates yet, so deciding which services move, in what order, and what blocks each stays with
the operator. The Phase 1 inventory in `MIGRATION_REPORT.md` is the closest substitute: it lists
every construct and its classification, and the REPORT-ONLY entries are the blockers.

## Getting Started

### Prerequisites

- AWS Transform Custom access and the `atx` CLI
- `kubectl` and `yq` for local validation (optional; the transformation degrades gracefully)
- To apply the output: an EKS cluster for the chosen target, the
  `aws-secrets-store-csi-driver-provider` add-on when services use secrets, and on
  `eks-standard` the `eks-pod-identity-agent` add-on (built into Auto Mode)

### Getting Started with AWS Transform Custom

Follow the AWS Transform Custom documentation to install and authenticate the `atx` CLI.

### Cloning the Repo and Publishing the Transformation

```bash
git clone <this-repo>
mkdir -p /tmp/ecs-to-eks-publish
cp -R community-sourced-transformations/ecs-to-eks/SKILL.md \
      community-sourced-transformations/ecs-to-eks/references /tmp/ecs-to-eks-publish/

atx custom def publish -n ecs-to-eks --sd /tmp/ecs-to-eks-publish
```

`publish` accepts `SKILL.md`, `references/` and `scripts/`. A `README.md` at the definition root
aborts the publish, so publish from a staged copy containing only those.

### Running the Transformation

Because the configuration has several keys, pass it as a file. **Commas separate `key=value`
pairs in the inline form**, so an inline value containing a comma is rejected:

```bash
cat > config.json <<'JSON'
{
  "additionalPlanContext": "migration_target: eks-auto-mode\ningress_strategy: alb-ingress\nnamespace: retail-store"
}
JSON

atx custom def exec -n ecs-to-eks -p . -x -t \
  --configuration file://config.json --limit 120
```

| Key | Values | Effect |
|---|---|---|
| `migration_target` | `eks-auto-mode` (default), `eks-standard`, `eks-fargate-profile` | Decides the IAM mechanism (Pod Identity vs IRSA), the pod security group mechanism, and whether a Karpenter `NodePool` is scaffolded |
| `ingress_strategy` | `alb-ingress` (default), `gateway-api` | Which object a load balancer target becomes. On Auto Mode the `IngressClass` uses `eks.amazonaws.com/alb` |
| `registry` | an ECR base URI | Optional. When set, image references are rewritten to it; otherwise they are left unchanged |
| `namespace` | a namespace name | Defaults to the Service Connect namespace, then the ECS cluster name |

### Expected Output

```text
eks/<service>/            Deployment, Service, ServiceAccount, SecretProviderClass, scaffolds
eks/iam/                  Pod Identity associations (Terraform sources)
MIGRATION_REPORT.md       inventory, IAM redistribution, scaffolds, manual actions, risk
<originals>               byte-identical
```

## Benchmarks

See [`BENCHMARKS.md`](BENCHMARKS.md). Summary: two runs of v0.2.0 against pinned public ECS
repositories (Terraform on `eks-auto-mode`, CloudFormation on `eks-standard`). Source integrity
perfect in both, zero ECS fields or IRSA annotations in the output, and zero `--dry-run=client`
failures on core kinds. The `retail-store-sample-app` output was then deployed on a live EKS
Auto Mode cluster: the defects that only a live API server catches were fixed through v0.2.3,
and with the v0.2.2 output all five services ran and a full purchase completed through the ALB.

## Known Limitations

1. **Service Connect proxy behaviour is not reproduced.** Names and ports become `Service`s;
   retries, outlier detection, timeouts, Service Connect TLS and proxy metrics are reported per
   service. Reproducing them needs a service mesh or application-level retries.
2. **`CODE_DEPLOY` blue/green is a scaffold, not a migration.** An Argo Rollouts `Rollout` is
   emitted with the traffic-shift settings as comments; choosing the progressive delivery
   controller is a human decision.
3. **Pod security groups on Auto Mode are per `NodeClass`.** Services that had distinct
   security groups on ECS share one set unless they are split across `NodeClass` / `NodePool`
   pairs. The report lists every service affected.
4. **Fargate profiles lose Pod Identity and the AWS secrets provider.** Under
   `eks-fargate-profile` the transformation emits IRSA annotations and an `ExternalSecret`
   (External Secrets Operator) instead, and reports the operator as a prerequisite.
5. **Supporting infrastructure is out of scope.** The VPC, databases, caches, queues, the ALB
   and IAM policy documents stay in the source IaC and are referenced by placeholder.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Invalid configuration format. Must be file:// URL, JSON string, or key=value pairs` | An inline `--configuration` value contained a comma, or a plain file path was passed. Use `file://config.json` |
| The run exits with code 2 and `Budget limit reached` | The agent-minute limit was hit. Resume with `atx --conversation-id <id> -t --limit <higher>`; the partial `MIGRATION_REPORT.md` shows how far it got |
| `kubectl apply --dry-run=client` fails on `SecretProviderClass`, `SecurityGroupPolicy` or `NodeClass` | Expected on a machine with no cluster: those kinds need their CRDs. The report lists each CRD and add-on required |
| Pods start without AWS credentials on `eks-standard` | The `eks-pod-identity-agent` add-on is not installed. It is built into Auto Mode, not into standard clusters |
| A secret mount fails with an access denied error | The workload role lacks the secret grants the execution role used to hold. Check the report's IAM Redistribution table |
| `FailedMount ... driver name secrets-store.csi.k8s.io not found` | The Secrets Store CSI driver is not installed; Auto Mode does not include it. Install the `aws-secrets-store-csi-driver-provider` EKS add-on. On a node that just joined, the same event appears briefly while the driver registers and then clears |
| Pods run, but not with the per-service security groups | Check that each `Deployment` selects the generated `NodePool` (`karpenter.sh/nodepool`) and that the `NodeClass` selectors match real security groups and subnets |

## Repository Structure

```text
ecs-to-eks/
├── README.md                          this file
├── SKILL.md                           the transformation definition
├── BENCHMARKS.md                      measured results
└── references/
    ├── 01-construct-mapping.md        classification and mapping for every construct
    └── 02-report-template.md          migration report structure
```
