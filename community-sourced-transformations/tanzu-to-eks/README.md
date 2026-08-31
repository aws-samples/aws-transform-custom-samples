# Tanzu / Cloud Foundry to Amazon EKS

Transforms a Cloud Foundry application - **VMware Tanzu Application Service (TAS)**, **Pivotal Cloud Foundry (PCF)** or **open-source Cloud Foundry** - into Kubernetes manifests for Amazon EKS. Converts the `manifest.yml` fields that map deterministically, scaffolds the container build and the credential injection, and reports every part of the platform contract that cannot be reconstructed from the repository.

**Not for Tanzu Kubernetes Grid (TKG)** - TKG is already Kubernetes, so moving it to EKS is a cluster migration with a different shape.

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

The three products share the one thing that matters here: the **Cloud Foundry application
contract**. `manifest.yml`, buildpacks, `VCAP_SERVICES` and the org/space model are identical
across TAS, PCF and open-source CF, which is why one definition covers all three.

## The Problem

`manifest.yml` is **thin** - name, memory, instances, buildpack, routes, services, env. The
Kubernetes equivalent is not a translation of those fields, it is a **reconstruction of what the
platform did implicitly**:

- the **buildpack** built the container, so there is no `Dockerfile` to carry over
- **`VCAP_SERVICES`** injected credentials as JSON the application parses at startup, so making it
  work on Kubernetes is a **code change**, not a manifest change
- the **route** was created by the platform from a shared domain that will not exist on EKS
- **ephemeral disk** was the only storage, so there is no volume to migrate because there never was one
- **CPU** was derived from the memory allocation, so the repository contains no CPU information at all

So most findings are about **absence**: the artifact Kubernetes needs is missing because the
platform supplied it. That is the opposite shape from an OpenShift migration, where the artifact
exists and has the wrong `apiVersion`.

This is why the definition is deliberately **mostly a scaffolder and a reporter**, and only a small
part of it is a translator. Generating a plausible `Dockerfile` from a buildpack contract, or a
Secret from a binding the repository never described, produces manifests that apply cleanly and are
wrong - the worst possible outcome.

## What This Skill Does

| Phase | Action |
|---|---|
| 0 | Reads `additionalPlanContext`: `migration_target`, `build_strategy`, `registry`, `namespace` |
| 1 | Parses every `manifest.yml`, `manifest-*.yml` and `vars-*.yml`, inventorying every field **present and absent**, each classified MECHANICAL / SCAFFOLD / REPORT-ONLY |
| 2 | Converts the mechanical set: one `Deployment` per `applications[]` entry, one more per non-web `Procfile` process type, plus Service, route object, probes and resources |
| 3 | Emits scaffolds: a `project.toml` (Paketo) or `Dockerfile` skeleton, Secret **stubs with empty values**, and a documented `VCAP_SERVICES` option set |
| 4 | Validates: YAML parses, `kubectl apply --dry-run`, `helm template`, and asserts **no fabricated credential value** survives |
| 5 | Writes `MIGRATION_REPORT.md`, cross-referenced to the assessment's question ids |

## Skill Architecture

```text
SKILL.md                            spine: scope, constraints, 6 phases, exit criteria
references/01-manifest-mapping.md   every manifest field, its classification, and what absence means
```

### Key Design Decisions

**Absence is a first-class case.** On Cloud Foundry an omitted field meant a platform default
applied. Kubernetes has no such default, so an absent `health-check-type` is a finding, not a
non-event. Each mapping row states what absence means.

**Secret stubs carry no values.** A stub with a fabricated connection string is a defect, not a
convenience: it applies cleanly and fails at runtime looking like a networking problem.

**Three artifacts per gap.** An ambiguity produces a `TODO(migration)` at the site, a report entry,
and where applicable a scaffold. The code shows where, the report shows why.

**Paketo is the default build path.** It descends from the Cloud Foundry buildpacks and detects the
same language signals, so runtime behaviour changes least. A hand-authored `Dockerfile` gives more
control and carries more behavioural risk - JVM memory calculation, entrypoint and signal handling
all become yours.

**`memory` carries a mandatory risk note for JVM workloads.** On CF that value also drove the
buildpack's JVM heap sizing. Copying it verbatim into `limits.memory` is the most common cause of
an OOMKill loop after a CF migration, and it looks like a faithful translation.

## Paired Readiness Assessment

This definition transforms **one** application. Deciding **which** applications move, in what
order, and what blocks each is answered by a companion assessment scoring a repository against 31
questions across the buildpack contract, service bindings, routing, credentials and operations.

For a 1.000-application estate the assessment comes first: it produces the waves. This definition
runs on the applications those waves clear.

## Getting Started

### Prerequisites

- AWS Transform Custom access and the `atx` CLI
- `kubectl` and `helm` for local validation (optional)

### Getting Started with AWS Transform Custom

Follow the AWS Transform Custom documentation to install and authenticate the `atx` CLI.

### Cloning the Repo and Publishing the Transformation

```bash
git clone <this-repo>
cd community-sourced-transformations/tanzu-to-eks

atx custom def publish -n tanzu-to-eks --sd .
```

`publish` accepts `SKILL.md`, `references/` and `scripts/`. A `README.md` at the definition root
aborts the publish, so publish from a staged copy containing only those.

### Running the Transformation

Pass the configuration as a file - **commas separate `key=value` pairs** in the inline form, so an
inline value containing a comma is rejected:

```bash
cat > config.json <<'JSON'
{
  "additionalPlanContext": "migration_target: eks-standard\nbuild_strategy: buildpacks\nregistry: 111122223333.dkr.ecr.us-east-1.amazonaws.com\nnamespace: music"
}
JSON

atx custom def exec -n tanzu-to-eks -p . -x -t \
  --configuration file://config.json --limit 70
```

| Key | Values | Effect |
|---|---|---|
| `migration_target` | `eks-standard`, `eks-auto-mode`, `eks-fargate` | Fargate rounds to fixed CPU/memory combinations, so an arbitrary `memory: 1200M` becomes a stated rounding decision |
| `build_strategy` | `buildpacks` (default), `dockerfile` | Which build scaffold is emitted |
| `registry` | an ECR base URI | Where the built image will live. Omit it and the image reference gets a `TODO` |
| `namespace` | a namespace name | Usually derived from the CF space |

### Expected Output

```text
eks/                      Deployments, Services, route objects, Secret stubs, build scaffold
MIGRATION_REPORT.md       inventory (present AND absent fields), scaffolds, manual actions, risk
<originals>               byte-identical
```

## Benchmarks

See [`BENCHMARKS.md`](BENCHMARKS.md). Summary: three rounds against two real Cloud Foundry sample
repositories (`cloudfoundry-samples/spring-music`, `cloudfoundry-samples/cf-sample-app-nodejs`),
both pinned. Round 1 surfaced 2 contract defects and round 2 surfaced 2 report-cosmetic variances;
all 4 are fixed in `SKILL.md` and re-validated on both repos before publishing. Round 3, on
`SKILL.md` v0.2.0: 2/2 COMPLETE, source integrity 0 files modified outside `eks/` and the report,
`MIGRATION_REPORT.md` at the repository root in 2/2 runs, `kubectl apply --dry-run=client` clean,
`## Manual Action Items` as the report section name in 2/2, zero em dash in emitted output, and
every `TODO(migration)` paired 1:1 with a row in that section.

The paired assessment has been validated separately against the same two repositories:
31/31 question coverage, counts reconciled, read-only verified, and every cited evidence file
confirmed to exist.

## Known Limitations

1. **The container build cannot be fully automated.** There is no `Dockerfile` and no image in a
   buildpack-built application. A `project.toml` or `Dockerfile` skeleton is emitted with the
   detected language as comments; choosing and validating the builder is a human decision.
2. **`VCAP_SERVICES` is a code change.** Every call site is located and reported, and an option set
   is documented, but application logic is never rewritten.
3. **Bound services are not provisioned.** Each binding is a cost, version and networking decision.
   The likely AWS counterpart is named and explicitly **not** asserted as equivalent.
4. **Tasks and route services are reported, not converted.** Both live outside the manifest, which
   is why they are the most commonly lost parts of a CF migration.
5. **No CPU value exists to migrate.** CF derived CPU from memory. The emitted request carries a
   `TODO` pointing at observed production usage - a guess would be worse than the marker.
6. **Tanzu Kubernetes Grid is out of scope.** Already Kubernetes.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Invalid configuration format. Must be file:// URL, JSON string, or key=value pairs` | An inline `--configuration` value contained a comma. Use `file://config.json` |
| Secret stubs have no values | Intentional. A fabricated connection string applies cleanly and fails at runtime |
| A `Procfile` worker process produced a second Deployment you did not expect | Correct: each non-web process type is its own workload. Losing it is the failure mode |
| Report flags `memory` as HIGH risk on a Java app | Intentional. The CF value drove the JVM heap calculation; the heap has to be re-derived |

## Repository Structure

```text
tanzu-to-eks/
├── README.md                          this file
├── SKILL.md                           the transformation definition
├── BENCHMARKS.md                      measured results
└── references/
    └── 01-manifest-mapping.md         every field, its classification, and what absence means
```
