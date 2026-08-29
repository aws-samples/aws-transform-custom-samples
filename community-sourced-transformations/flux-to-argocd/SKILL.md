---
name: flux-to-argocd
description: >-
  Transforms a Flux CD (v2) GitOps repository into Argo CD equivalents - converting
  Kustomization and HelmRelease to Application, joining GitRepository / HelmRepository /
  OCIRepository sources into each Application's source block, scaffolding the cluster
  entry-point as an app-of-apps root, and reporting every Flux capability that Argo CD
  does not have (postBuild substitution, valuesFrom, image automation, SOPS decryption).
  Trigger: Flux to Argo, FluxCD migration, Kustomization to Application, HelmRelease to
  Application, GitOps tool migration, flux2.
type: custom
version: 0.1.0
---

# Flux CD to Argo CD

## Objective

Convert what maps mechanically between the two GitOps models, scaffold what needs a human
decision, and report precisely which Flux behaviours have **no Argo CD counterpart** - because
the two tools disagree on where reconciliation logic lives. Flux composes small controllers
driven by CRs in the cluster; Argo CD centralizes around the `Application` and reads only from
the source repository.

## Why this is not a field rename

Three structural differences make a naive conversion wrong in ways that apply cleanly:

1. **Flux resolves sources as separate objects; Argo embeds them.** A `GitRepository` is one CR
   referenced by many `Kustomization`s. The conversion must JOIN the source into every
   `Application` - and if the source object is missing from the repository (created by
   bootstrap), the join fails and must be reported, never guessed.
2. **Flux `postBuild.substitute` rewrites manifests with cluster-side variables.** Vanilla
   kustomize (what Argo runs) has no substitution step. Manifests that depend on it produce
   `${VAR}` literals after a "successful" Argo sync - the property is silently gone.
3. **Flux `dependsOn` is an explicit DAG across Kustomizations.** Argo sync-waves order
   resources INSIDE one Application; ordering ACROSS Applications needs the app-of-apps
   pattern plus waves on the child Application manifests. Same word, different scope -
   converting one to the other changes semantics and is therefore a SCAFFOLD, not MECHANICAL.

## Scope

### MECHANICAL - converted

| Flux construct | Argo CD output |
|---|---|
| `Kustomization` (kustomize.toolkit.fluxcd.io) | `Application` - `spec.source.path` from `spec.path`, `destination.namespace` from `targetNamespace` |
| `Kustomization.spec.sourceRef` → `GitRepository` | `Application.spec.source.repoURL` + `targetRevision` (branch/tag/semver from the `ref` block) |
| `Kustomization.spec.prune: true` | `syncPolicy.automated.prune: true` |
| `Kustomization.spec.patches` | `spec.source.kustomize.patches` (Argo CD >= 2.5) |
| `Kustomization.spec.retryInterval` | `syncPolicy.retry` (limit + backoff), with a report note that the semantics are attempt-based, not interval-based |
| `HelmRelease` + `HelmRepository` (HTTP) | `Application` with a Helm source - `repoURL` from the `HelmRepository.spec.url`, `chart` and `targetRevision` from `HelmRelease.spec.chart.spec` |
| `HelmRelease.spec.values` (inline) | `spec.source.helm.valuesObject` |
| `HelmRelease` + `HelmRepository` `type: oci` / `OCIRepository` as a **Helm chart** source | `Application` Helm source with the `oci://` registry as `repoURL` |
| `Kustomization.spec.suspend: true` | annotation to skip automated sync (`syncPolicy` omitted) + report entry - suspended state is a decision the operator must re-take |
| `interval` | dropped, with ONE report note: Argo reconciliation cadence is a global controller setting (`timeout.reconciliation`), not per-Application |

### SCAFFOLD - emitted incomplete, clearly marked

1. **Cluster entry-point.** The `clusters/<env>/*.yaml` Flux Kustomizations become an
   **app-of-apps root `Application`** per environment, pointing at a generated
   `argocd/<env>/` directory that contains the child Applications. Emitted with
   `TODO(migration)` on `destination.server` - the cluster URL is an operational value the
   repository does not carry.
2. **`dependsOn` ordering.** Child Applications receive `argocd.argoproj.io/sync-wave`
   annotations that PRESERVE the Flux DAG's topological order, plus a report entry stating
   the semantic difference (waves order syncs; they do not gate on health the way
   `dependsOn` + `healthChecks` did - Argo health gating needs the root app sync policy
   reviewed by a human).
3. **Multi-tenancy.** When a Flux `Kustomization` carries `serviceAccountName`, emit an
   `AppProject` stub restricting destinations and source repos, with empty allow-lists and
   `TODO(migration)` - the tenancy boundary is a security decision.

### REPORT-ONLY - never transformed

| Construct | Why |
|---|---|
| `postBuild.substitute` / `substituteFrom` | No Argo equivalent in vanilla kustomize. Manifests depending on it BREAK SILENTLY (literal `${VAR}` applied). Each variable and consuming file is listed |
| `HelmRelease.spec.valuesFrom` (ConfigMap/Secret) | Argo CD cannot read Helm values from cluster objects. Needs a repo-side values file or a plugin - a design decision |
| `OCIRepository` consumed as a **kustomize/manifest artifact** (non-Helm), incl. `ArtifactGenerator` | Argo CD sources are git, Helm repos and OCI Helm charts. Arbitrary OCI artifacts as manifest sources have no counterpart |
| `flux-system/` bootstrap (`gotk-components.yaml`, `gotk-sync.yaml`) | That is the PLATFORM, not an application. Its Argo counterpart is installing Argo CD itself, which this definition never does |
| Image automation (`ImageRepository`, `ImagePolicy`, `ImageUpdateAutomation`) | Argo CD Image Updater is a separate optional component with different config |
| Notification stack (`Alert`, `Provider`, `Receiver`) | Argo CD Notifications exists but is configured via ConfigMap/triggers - a re-design, not a translation |
| `Kustomization.spec.decryption` (SOPS) | Argo CD has no native SOPS. Secrets management strategy must be re-decided (e.g. External Secrets) |
| `healthChecks` / `wait` | Argo has built-in health assessment; custom checks become Lua in `argocd-cm` - global config, not per-app |
| Any `kind` not in the mapping reference | Degrade to report-only guidance, never invent an Argo equivalent - same rule as the other definitions in this collection |

## Constraints

- **Additive, and that includes files at the repository root.** Originals untouched; converted
  output under `argocd/`. **`MIGRATION_REPORT.md` goes at the repository ROOT**, matching the
  convention of the other definitions in this collection - not inside `argocd/`.
- **Never create or modify a file at the repository root** other than `MIGRATION_REPORT.md`.
- **Never invent a cluster URL, a repo URL, a credential or a version.** If the value is not in
  the repository, emit the field with `TODO(migration)` plus a report entry.
- **Every emitted `Application` must name the Flux CR it came from** (annotation
  `migration.flux/source: <kind>/<namespace>/<name>`), so the operator can diff tool-by-tool
  during the cutover window.
- **The report must state the cutover risk explicitly:** running both tools against the same
  namespaces causes fight-over-ownership; the report lists which namespaces each emitted
  Application will manage, so the operator can suspend the corresponding Flux Kustomizations
  first.
- **The manual-action section of the report is named exactly `## Manual Action Items`.**
- **No em dash (U+2014) anywhere in emitted output** - use a hyphen.
- Stay on the current branch; do not commit.

## Workflow

```text
Phase 0  Read additionalPlanContext: destination_server (optional), argocd_namespace
         (default argocd), project (default default).
Phase 1  Discovery. Inventory every *.toolkit.fluxcd.io document: Kustomizations, sources,
         HelmReleases, image/notification CRs. Build the sourceRef JOIN table and the
         dependsOn DAG. Classify every construct MECHANICAL / SCAFFOLD / REPORT-ONLY.
Phase 2  Convert the MECHANICAL set. One Application per Flux Kustomization / HelmRelease,
         under argocd/<env-or-path>/, each carrying the migration.flux/source annotation.
Phase 3  Emit scaffolds: app-of-apps root per cluster entry-point, sync-wave ordering from
         the DAG, AppProject stubs where tenancy was present.
Phase 4  Validate: YAML parses, kubectl apply --dry-run=client with the Application CRD
         schema unavailable locally is acceptable (validate=false), assert zero
         *.toolkit.fluxcd.io apiVersion in argocd/, assert every Application has repoURL +
         path|chart + destination, assert no ${VAR} literal survived into emitted manifests.
Phase 5  MIGRATION_REPORT.md at the root: inventory (present AND absent), the JOIN table,
         the DAG and its wave mapping, every REPORT-ONLY construct with reason and path,
         Manual Action Items, TODO(migration) cross-reference.
```

## Exit Criteria

1. Every `*.toolkit.fluxcd.io` document appears in the report inventory with a classification.
2. Originals byte-identical. All converted output under `argocd/`; `MIGRATION_REPORT.md` at the
   repository root; no other file created or modified at the root.
3. Every emitted `Application` resolves to a concrete `repoURL` + (`path` or `chart`) +
   `destination`, or carries `TODO(migration)` on the missing field plus a report entry.
4. Emitted YAML parses. Zero `*.toolkit.fluxcd.io` apiVersions under `argocd/`. Zero
   unresolved `${...}` substitution literals in emitted manifests.
5. Every REPORT-ONLY construct has a report entry naming the construct, the reason and the path.
6. Every `TODO(migration)` has an entry in the report's Manual Action Items, and vice versa.
7. The report contains the namespace-ownership table for the cutover.

## Non-Goals

1. Installing or configuring Argo CD. This produces manifests, never platform components.
2. Migrating the Flux bootstrap. `flux-system/` is reported, not converted.
3. Image automation and notifications - flagged with guidance, never translated.
4. Executing the migration or applying to a cluster.
