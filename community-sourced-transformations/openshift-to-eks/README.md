# OpenShift to Amazon EKS

Transforms a Red Hat OpenShift application repository into portable Kubernetes for Amazon EKS - converting `DeploymentConfig`, `ImageStream` references, `Route` and OpenShift `Template`, scaffolding `SecurityContextConstraints` to Pod Security Admission, and reporting every construct that has no safe equivalent.

**Additive by design: the original manifests are never modified. Output lands under `eks/`.**

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

An OpenShift application repository is not portable Kubernetes. It carries objects that exist only
on OpenShift (`DeploymentConfig`, `Route`, `BuildConfig`, `ImageStream`,
`SecurityContextConstraints`), image references that resolve through an indirection layer with no
registry host, and node selectors pointing at labels EKS does not have.

This transformation converts what maps deterministically, scaffolds what is partly automatable,
and reports what cannot be automated safely - each construct classified in advance, not decided
per run.

## The Problem

Three failure modes make a hand migration expensive, and all three are silent:

1. **An `ImageStreamTag` reference carries no registry host.** `image: payments-api:latest` is
   valid on OpenShift and unresolvable anywhere else. It fails at pull time, which reads as a
   permissions problem.
2. **A `reencrypt` Route converted to `edge` drops in-cluster TLS.** Nothing fails. The endpoint
   still answers HTTPS. The property is simply gone.
3. **A `ClusterResourceQuota` replaced by per-namespace quotas looks like a faithful
   conversion** and is not: it produces a sum of maximums rather than a shared ceiling, so every
   namespace can reach its own limit simultaneously.

A transformation that guesses on any of these produces manifests that apply cleanly and are
wrong, which is worse than an annotated gap.

## What This Skill Does

| Phase | Action |
|---|---|
| 0 | Reads `additionalPlanContext`: `migration_target`, `ingress_strategy`, `registry`, `namespace` |
| 1 | Inventories every construct and classifies it **MECHANICAL / SCAFFOLD / REPORT-ONLY** before transforming anything |
| 2 | Converts the mechanical set: `DeploymentConfig` → `Deployment`, `ImageStreamTag` → a fully qualified registry URI, `Route` → `HTTPRoute` or `Ingress`, `Template` → Helm chart, PVC `storageClassName` → `gp3`/`efs` |
| 3 | Emits scaffolds: SCC → Pod Security Admission labels (plus Kyverno **only** for the residue PSA cannot express), `BuildConfig` → a build skeleton, `PerformanceProfile` → a Karpenter `NodePool` with the observed constraints as comments |
| 4 | Validates: YAML parses, `kubectl apply --dry-run`, `helm template`, and asserts zero `*.openshift.io` survives in the output |
| 5 | Writes `MIGRATION_REPORT.md` with the full inventory, the risk per change, and every manual action item |

## Skill Architecture

Lean `SKILL.md` orchestration spine plus references loaded on demand:

```text
SKILL.md                            spine: scope, constraints, 6 phases, exit criteria
references/01-construct-mapping.md  every construct, its classification, and the mapping
references/02-report-template.md    the migration report structure
```

### Key Design Decisions

**Classification is fixed in the reference, not decided per run.** Leaving it to judgement is what
produced inconsistent results in the paired assessment: the same repository resolved the same
question differently across runs. Every construct has one classification, written down.

**Additive output.** Originals stay byte-identical and everything lands under `eks/`, so the diff
is reviewable and a rejected migration costs nothing to revert.

**Never invent a mapping.** A construct with no equivalent is reported, never approximated. When
`registry` is not supplied, the transformation emits `TODO(migration)` rather than guessing an
account id - a fabricated ECR URI fails in a way that looks like an IAM problem.

**Three artifacts per gap.** An ambiguity produces a `TODO(migration)` at the site, a report
entry, and (where applicable) a scaffold. The code shows where, the report shows why.

**Pod Security Admission before a policy engine.** An SCC using only `anyuid` needs a namespace
label and nothing else. Mapping every SCC to Kyverno imports a platform component the customer
does not need.

## Paired Readiness Assessment

This definition transforms **one** repository. Deciding **which** repositories to run it on, in
what order, and what blocks each is a different question answered by a companion assessment that
scores a repository against 38 questions and assigns a migration readiness tier.

Use the assessment first on an estate; use this definition on the applications it clears.
`MIGRATION_REPORT.md` cross-references the assessment's question ids so the two join.

## Getting Started

### Prerequisites

- AWS Transform Custom access and the `atx` CLI
- `kubectl` and `helm` for local validation (optional; the transformation degrades gracefully)

### Getting Started with AWS Transform Custom

Follow the AWS Transform Custom documentation to install and authenticate the `atx` CLI.

### Cloning the Repo and Publishing the Transformation

```bash
git clone <this-repo>
cd community-sourced-transformations/openshift-to-eks

atx custom def publish -n openshift-to-eks --sd .
```

`publish` accepts `SKILL.md`, `references/` and `scripts/`. A `README.md` at the definition root
aborts the publish, so publish from a staged copy containing only those.

### Running the Transformation

Because the configuration has several keys, pass it as a file. **Commas separate `key=value`
pairs in the inline form**, so an inline value containing a comma is rejected:

```bash
cat > config.json <<'JSON'
{
  "additionalPlanContext": "migration_target: eks-standard\ningress_strategy: gateway-api\nregistry: 111122223333.dkr.ecr.us-east-1.amazonaws.com\nnamespace: payments-prod"
}
JSON

atx custom def exec -n openshift-to-eks -p . -x -t \
  --configuration file://config.json --limit 70
```

| Key | Values | Effect |
|---|---|---|
| `migration_target` | `eks-standard`, `eks-auto-mode`, `eks-hybrid` | Under Auto Mode, node customisation becomes REPORT-ONLY rather than a `NodePool` scaffold |
| `ingress_strategy` | `gateway-api` (default), `alb-ingress` | Which object a `Route` becomes |
| `registry` | an ECR base URI | Required to rewrite `ImageStreamTag` references. Omit it and every image reference gets a `TODO` |
| `namespace` | a namespace name | When the target differs from the OpenShift project |

### Expected Output

```text
eks/                      converted manifests, charts and scaffolds
MIGRATION_REPORT.md       inventory, automatic changes, scaffolds, manual actions, risk
<originals>               byte-identical
```

## Benchmarks

See [`BENCHMARKS.md`](BENCHMARKS.md). Summary: two runs against pinned upstream OpenShift sample
repositories, source integrity perfect in both, all emitted charts rendering under
`helm template`, zero `*.openshift.io` surviving in the output.

## Known Limitations

1. **`BuildConfig` with `sourceStrategy` (S2I) cannot be fully automated.** The build logic lives
   in the builder image's `assemble`/`run` contract, not in the repository. A `Dockerfile`
   skeleton is emitted with the S2I steps as comments; reproducing the builder behaviour is a
   human decision. `dockerStrategy` ports almost directly.
2. **`ClusterResourceQuota` is not converted at all.** No Kubernetes equivalent preserves a shared
   aggregate ceiling. The report ranks the options by whether they preserve the guarantee.
3. **SR-IOV, Multus, `PerformanceProfile` and `MachineConfig`** produce a `NodePool` scaffold with
   the constraints as comments, never as asserted equivalents. Under `eks-auto-mode` they become
   REPORT-ONLY, since the node cannot be customised.
4. **Operators are reported, not migrated.** Availability is per operator, in three buckets:
   community (a Helm chart exists), certified-with-upstream (validate parity), and OpenShift-only
   (genuinely blocking).
5. **`spec.host` on a Route** is usually an internal wildcard domain that will not exist on EKS.
   It becomes a DNS action item rather than an emitted hostname that cannot resolve.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Invalid configuration format. Must be file:// URL, JSON string, or key=value pairs` | An inline `--configuration` value contained a comma. Use `file://config.json` |
| Every image reference has a `TODO(migration)` | `registry` was not supplied in `additionalPlanContext` |
| Emitted Helm templates do not parse as YAML | Expected. Helm templates contain Go templating; validate with `helm template`, not a YAML parser |
| Report says a construct is REPORT-ONLY and you expected a conversion | Check its classification in `references/01-construct-mapping.md`. The classification is deliberate |

## Repository Structure

```text
openshift-to-eks/
├── README.md                          this file
├── SKILL.md                           the transformation definition
├── BENCHMARKS.md                      measured results
└── references/
    ├── 01-construct-mapping.md        classification and mapping for every construct
    └── 02-report-template.md          migration report structure
```
