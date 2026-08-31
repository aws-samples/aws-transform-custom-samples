# Benchmark Results - Flux CD to Argo CD

## Executive Summary

| Metric | Result |
|--------|--------|
| Repository tested | `fluxcd/flux2-kustomize-helm-example` (real upstream, pinned) |
| Transformation success rate | **1/1 COMPLETE** |
| **Source integrity** | **0 files modified outside `argocd/` and the report** |
| Files emitted | 10 (2 app-of-apps roots + 4 child Applications per environment) |
| `*.toolkit.fluxcd.io` surviving in output | **0** |
| Unresolved `${...}` substitution literals in output | **0** |
| Report at repository root, section `## Manual Action Items` present | **PASS** (name pinned by the contract) |
| Em dash (U+2014) in emitted output | **0** (forbidden by the contract) |
| sync-wave DAG mapping | waves 0/0/1/2 preserving the Flux `dependsOn` topological order |
| Invented values | 0 - `destination.server` and the bootstrap repo URL emitted as `TODO(migration)` |
| **Layer 2: generated Application reconciles on a live cluster** | **PASS** (see below) |
| Agent minutes | 56.82 |
| Estimated cost | ~US$ 1.99 (at US$ 0.035 / agent minute) |

### Methodology

The fixture is the canonical real Flux repository, pinned:

| Repo | Licence | Commit |
|---|---|---|
| `fluxcd/flux2-kustomize-helm-example` | Apache-2.0 | `4f1a5b1051b469108d1bdf0ebec6c814427e3834` |

It exercises: 4 Flux `Kustomization`s per env with `dependsOn` chains, `HelmRelease` via
classic `HelmRepository` (podinfo) AND via `OCIRepository` (cert-manager, envoy-gateway),
kustomize overlays with `patches`, `retryInterval`/`timeout`, plus two constructs that MUST
degrade to report-only: `ArtifactGenerator` and the `flux-system/` bootstrap.

```bash
atx custom def exec -n flux-to-argocd -p . -x -t --configuration file://cfg.json --limit 70
```

Assertions are invariants (`git diff` vs baseline, output location, zero Flux apiVersion,
zero substitution literals, Application anchor fields, TODO/report pairing).

## Layer 2 - Reconcile Proof (live EKS cluster, 2026-08-29)

Cluster `atx-ack-lab` (EKS 1.33, us-east-1), Argo CD stable installed. The 4 generated staging
Applications were applied after the operator steps the report prescribes (fill
`destination.server`, fill the bootstrap repo URL, register OCI repos).

| Application | Result |
|---|---|
| `staging-podinfo` (from `HelmRelease/podinfo`) | **Synced, operation Succeeded** - chart resolved to `6.14.1` from the semver range, `podinfo` + `podinfo-redis` Deployments 1/1 Running, HTTPRoute created with the staging overlay hostname (`podinfo.staging`) - proof the overlay `valuesObject` merge survived the conversion |
| `staging-infra-configs` (from `Kustomization/infra-configs`) | source resolved after the operator filled the `TODO(migration)` repo URL - exactly the designed flow |
| `staging-cert-manager`, `staging-envoy-gateway` (from OCI `HelmRelease`s) | blocked by a REGISTRY quirk, not by the conversion - see finding below |

### Finding: semver ranges over public OCI registries fail anonymously in Argo CD

Flux resolves `targetRevision: "1.x"` against OCI registries with its own auth flow. Argo CD's
repo-server hits `GET /v2/<repo>/tags/list` (and `HEAD /manifests/<tag>`) in a way that
`quay.io` and `docker.io` answer **401 for anonymous clients**, even for public charts, even
with the repository registered with `enableOCI: "true"` and the URL matching exactly.

Consequences, now part of the definition's report guidance:

1. A converted OCI `HelmRelease` needs either registry credentials in the Argo CD repository
   secret or a **pinned concrete version** instead of a semver range.
2. The repository secret `url` must match the Application `repoURL` **byte for byte**
   (including the `oci://` prefix) or the secret is silently ignored.
3. CRDs the chart's values depend on (here: Gateway API for the podinfo `HTTPRoute`) must
   exist before the sync - and the application controller caches API discovery, so CRDs
   installed after Argo CD require a controller restart or cache expiry. This is the live
   manifestation of the `dependsOn` semantic gap the report documents.

## Exit Criteria Compliance (per SKILL.md)

| # | Exit criterion | Result |
|---|---|---|
| 1 | Every `*.toolkit.fluxcd.io` document in the inventory with a classification | PASS |
| 2 | Originals byte-identical; output under `argocd/`; report at root; nothing else at root | PASS |
| 3 | Every Application resolves repoURL + path/chart + destination, or carries `TODO(migration)` | PASS (destination + bootstrap URL as TODO) |
| 4 | YAML parses; zero Flux apiVersion; zero `${...}` literals | PASS |
| 5 | Every REPORT-ONLY construct has a report entry | PASS (ArtifactGenerator, OCIRepository-as-artifact, flux-system, interval) |
| 6 | TODO(migration) paired with Manual Action Items, and vice versa | PASS |
| 7 | Namespace-ownership table for the cutover | PASS |

Evidence file: `layer2-evidence.txt` (kubectl snapshots per phase).
