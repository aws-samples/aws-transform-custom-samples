# Flux CD to Argo CD

Transforms a Flux CD (v2) GitOps repository into Argo CD equivalents - converting `Kustomization` and `HelmRelease` to `Application`, joining `GitRepository` / `HelmRepository` / `OCIRepository` sources into each Application, scaffolding the cluster entry-point as an app-of-apps root with sync-wave ordering, and reporting every Flux capability Argo CD does not have.

**Additive by design: the original manifests are never modified. Output lands under `argocd/`.**

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [What This Skill Does](#what-this-skill-does)
- [Getting Started](#getting-started)
- [Benchmarks](#benchmarks)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Repository Structure](#repository-structure)

## Overview

Flux and Argo CD disagree on where reconciliation logic lives. Flux composes small controllers
driven by CRs in the cluster - sources are standalone objects, ordering is an explicit
`dependsOn` DAG, and `postBuild` rewrites manifests with cluster-side variables. Argo CD
centralizes around the `Application`, reads only from the repository, and orders with
sync-waves inside one Application tree.

This transformation converts what maps mechanically, scaffolds what needs a human decision,
and reports what has no counterpart - each construct classified in advance, not decided per run.

## The Problem

Three failure modes make a naive conversion wrong in ways that **apply cleanly**:

1. **Flux resolves sources by reference; Argo embeds them.** A `GitRepository` referenced by
   many `Kustomization`s must be JOINed into every `Application` - and if the source object
   lives only in the bootstrap, the join has no value to copy and must surface as a TODO.
2. **`postBuild.substitute` has no Argo equivalent.** Manifests that depend on it sync
   "successfully" with literal `${VAR}` strings applied to the cluster. Nothing fails.
3. **`dependsOn` is a DAG across Kustomizations; sync-waves order inside one Application.**
   Same word, different scope - and waves do not gate on health the way `dependsOn` +
   `healthChecks` did.

## What This Skill Does

| Phase | Action |
|---|---|
| 0 | Reads `additionalPlanContext`: `argocd_namespace`, `project`, optional `destination_server` |
| 1 | Inventories every `*.toolkit.fluxcd.io` document, builds the sourceRef JOIN table and the `dependsOn` DAG, classifies **MECHANICAL / SCAFFOLD / REPORT-ONLY** |
| 2 | Converts the mechanical set: `Kustomization` → `Application` (path, targetNamespace, prune, patches, retry), `HelmRelease` + repo source → Helm `Application` (chart, semver, `valuesObject`) |
| 3 | Emits scaffolds: app-of-apps root per cluster entry-point, sync-wave annotations preserving the DAG order, `AppProject` stubs where tenancy was present |
| 4 | Validates: YAML parses, zero Flux `apiVersion` in output, zero unresolved `${...}` literals, every Application has repoURL + path/chart + destination |
| 5 | Writes `MIGRATION_REPORT.md` at the repository root: inventory, JOIN table, DAG/wave mapping, namespace-ownership table for the cutover, `## Manual Action Items` |

Every emitted `Application` carries `migration.flux/source: <Kind>/<ns>/<name>` so the operator
can diff tool-by-tool during the cutover window.

## Getting Started

```bash
atx custom def exec -n flux-to-argocd -p . -x -t \
  --configuration file://config.json --limit 70
```

```json
{"additionalPlanContext": "argocd_namespace: argocd\nproject: default"}
```

Use `--configuration file://` - a comma inside an inline `key=value` breaks the CLI parser.
Assert the artifact count after every run: a low `--limit` truncates the bundle silently.

## Benchmarks

Full evidence in [`BENCHMARKS.md`](BENCHMARKS.md). Summary: validated on the canonical real
repository `fluxcd/flux2-kustomize-helm-example` (pinned commit) - source integrity 0 files
changed, 10 Applications emitted, zero Flux apiVersion leakage, zero substitution literals,
DAG preserved as waves 0/0/1/2. **Layer 2:** the generated `staging-podinfo` Application was
applied to a live EKS cluster running Argo CD and reconciled to Running workloads
(`podinfo` + `podinfo-redis` Deployments 1/1, HTTPRoute with the staging overlay hostname),
proving the conversion end to end, not just structurally.

## Known Limitations

- **`postBuild.substitute` / `substituteFrom`** - report-only. No Argo equivalent; listed per
  variable and consuming file.
- **`HelmRelease.spec.valuesFrom`** - report-only. Argo cannot read values from in-cluster
  objects.
- **OCI manifests (`OCIRepository` as artifact, `ArtifactGenerator`)** - report-only. Argo
  sources are git, Helm repos and OCI Helm charts.
- **Semver ranges over public OCI registries** fail anonymously in Argo CD (`tags/list` 401 on
  quay.io/docker.io) - converted OCI HelmReleases need registry credentials or a pinned
  version. Documented in the report's Manual Action Items.
- **Image automation and notifications** - separate Argo components with different config;
  flagged with guidance, never translated.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid configuration format` before the run starts | A comma inside an inline `--configuration key=value` | Use `--configuration file://config.json` |
| Run completes but fewer artifacts than expected | Low `--limit` truncates the bundle silently | Re-run with `--limit 70`; always assert the artifact count |
| Applied Application stuck `Unknown` with `ComparisonError ... tags/list ... 401` | Semver range over a public OCI registry - Argo CD's anonymous tag listing is refused by quay.io/docker.io | Pin a concrete chart version, or add registry credentials to the Argo CD repository secret |
| OCI repository secret seems ignored | Secret `url` does not match the Application `repoURL` byte for byte | Include the `oci://` prefix in the secret `url` |
| Sync fails `failed to discover server resources for group version ...` for a CRD that exists | The application controller caches API discovery; the CRD was installed after Argo CD | Restart `argocd-application-controller` (or wait for the cache to expire), then sync again |
| `destination.server: TODO(migration)` rejected on apply | The cluster URL is an operational value the repository does not carry - emitted as TODO by design | Fill it per environment before applying (in-cluster: `https://kubernetes.default.svc`) |
| Manifests apply with literal `${VAR}` strings | The source repo used Flux `postBuild.substitute`, which has no Argo equivalent | See the report's REPORT-ONLY section - the variables must move into overlays or a plugin |

## Repository Structure

```text
flux-to-argocd/
├── README.md                       # this file
├── SKILL.md                        # orchestration spine (discovery → convert → scaffold → validate → report)
├── BENCHMARKS.md                   # validation evidence (structural + live reconcile)
└── references/
    └── 01-construct-mapping.md     # before/after YAML per mapping + field table + validation greps
```
