# Construct Mapping - Flux CD v2 to Argo CD

Concrete before/after pairs for every MECHANICAL and SCAFFOLD mapping. The rule that governs
all of them: **if the value is not in the repository, it becomes `TODO(migration)` + a report
entry - never a guess.**

## 1. Kustomization + GitRepository → Application (the JOIN)

Flux (two objects, source shared by reference):

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: flux-system
  namespace: flux-system
spec:
  url: https://github.com/org/repo
  ref:
    branch: main
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: apps
  namespace: flux-system
spec:
  interval: 10m
  path: ./apps/staging
  prune: true
  sourceRef:
    kind: GitRepository
    name: flux-system
  targetNamespace: podinfo
```

Argo CD (one object, source embedded - the JOIN happened at conversion time):

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: apps
  namespace: argocd
  annotations:
    migration.flux/source: Kustomization/flux-system/apps
spec:
  project: default
  source:
    repoURL: https://github.com/org/repo   # joined from GitRepository flux-system
    targetRevision: main                   # from GitRepository .spec.ref.branch
    path: apps/staging
  destination:
    server: https://kubernetes.default.svc  # TODO(migration) if multi-cluster
    namespace: podinfo                      # from targetNamespace
  syncPolicy:
    automated:
      prune: true        # from prune: true
      selfHeal: true     # Flux always self-heals; keep parity
```

`ref` variants: `branch` and `tag` map to `targetRevision` verbatim; `semver` maps to Argo's
semver constraint syntax for Helm sources only - for a git source, semver has no Argo
counterpart and becomes `TODO(migration)` + report entry.

## 2. HelmRelease + HelmRepository → Application (Helm source)

Flux:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: podinfo
spec:
  url: https://stefanprodan.github.io/podinfo
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: podinfo
spec:
  chart:
    spec:
      chart: podinfo
      version: ">=6.0.0 <7.0.0"
      sourceRef:
        kind: HelmRepository
        name: podinfo
  values:
    replicaCount: 2
```

Argo CD:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: podinfo
  namespace: argocd
  annotations:
    migration.flux/source: HelmRelease/podinfo/podinfo
spec:
  project: default
  source:
    repoURL: https://stefanprodan.github.io/podinfo  # joined from HelmRepository
    chart: podinfo
    targetRevision: ">=6.0.0 <7.0.0"   # Argo accepts semver ranges for Helm
    helm:
      valuesObject:                     # from HelmRelease .spec.values, verbatim
        replicaCount: 2
  destination:
    server: https://kubernetes.default.svc
    namespace: podinfo
```

`HelmRepository` with `type: oci`: `repoURL` becomes the `oci://...` registry path, same join.

**`valuesFrom` is REPORT-ONLY.** Argo cannot read values from in-cluster ConfigMaps/Secrets.
The report lists each `valuesFrom` entry with the two viable strategies (commit the values file
to the repo, or a config-management plugin) - choosing one is a design decision.

## 3. dependsOn DAG → sync-waves (SCAFFOLD)

Flux orders ACROSS Kustomizations:

```yaml
spec:
  dependsOn:
    - name: infra-controllers
```

Argo orders by wave INSIDE one Application tree. Under app-of-apps, annotate the CHILD
Application manifests with waves that preserve the topological order of the Flux DAG:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "0"   # infra-controllers (no dependencies)
---
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "1"   # infra-configs (dependsOn: infra-controllers)
---
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "2"   # apps (dependsOn: infra-configs)
```

Report entry is mandatory: waves order sync start; they do NOT gate on the health checks that
Flux `dependsOn` + `healthChecks` enforced. The operator must review whether the root app uses
automated sync with health-based progression.

## 4. Cluster entry-point → app-of-apps root (SCAFFOLD)

Flux layout `clusters/staging/{infrastructure.yaml,apps.yaml}` (Kustomizations applied by
bootstrap) becomes one root Application per environment:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: staging-root
  namespace: argocd
spec:
  project: default
  source:
    repoURL: <same repo>
    targetRevision: main
    path: argocd/staging          # the generated directory with child Applications
  destination:
    server: https://kubernetes.default.svc  # TODO(migration): staging cluster URL
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

## 5. Field-by-field quick table

| Flux field | Argo CD field | Class |
|---|---|---|
| `Kustomization.spec.path` | `source.path` (strip leading `./`) | MECHANICAL |
| `Kustomization.spec.targetNamespace` | `destination.namespace` | MECHANICAL |
| `Kustomization.spec.prune` | `syncPolicy.automated.prune` | MECHANICAL |
| `Kustomization.spec.patches` | `source.kustomize.patches` | MECHANICAL |
| `Kustomization.spec.retryInterval` | `syncPolicy.retry.backoff` | MECHANICAL + note |
| `Kustomization.spec.interval` | dropped + single report note | MECHANICAL |
| `Kustomization.spec.suspend` | omit syncPolicy + report entry | MECHANICAL + note |
| `Kustomization.spec.dependsOn` | sync-wave annotations on children | SCAFFOLD |
| `Kustomization.spec.serviceAccountName` | `AppProject` stub | SCAFFOLD |
| `Kustomization.spec.postBuild.*` | none | REPORT-ONLY |
| `Kustomization.spec.decryption` | none | REPORT-ONLY |
| `Kustomization.spec.healthChecks` / `wait` | built-in health / Lua in argocd-cm | REPORT-ONLY |
| `HelmRelease.spec.values` | `source.helm.valuesObject` | MECHANICAL |
| `HelmRelease.spec.valuesFrom` | none | REPORT-ONLY |
| `HelmRelease.spec.chart.spec.version` | `source.targetRevision` | MECHANICAL |
| `HelmRelease` install/upgrade `remediation` | `syncPolicy.retry` (partial) | SCAFFOLD |
| `GitRepository.spec.url` / `ref` | `source.repoURL` / `targetRevision` | MECHANICAL (join) |
| `HelmRepository.spec.url` (http/oci) | `source.repoURL` | MECHANICAL (join) |
| `OCIRepository` as Helm chart | `source.repoURL: oci://` | MECHANICAL (join) |
| `OCIRepository` as manifest artifact / `ArtifactGenerator` | none | REPORT-ONLY |
| `ImageRepository` / `ImagePolicy` / `ImageUpdateAutomation` | Argo CD Image Updater (separate tool) | REPORT-ONLY |
| `Alert` / `Provider` / `Receiver` | Argo CD Notifications (re-design) | REPORT-ONLY |
| `flux-system/gotk-*.yaml` | platform bootstrap, out of scope | REPORT-ONLY |

## 6. Validation greps (Phase 4)

```bash
# zero Flux apiVersion under argocd/
grep -rE "apiVersion:\s*\S+\.toolkit\.fluxcd\.io" argocd/ && exit 1

# zero unresolved substitution literal
grep -rE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' argocd/ && exit 1

# every Application has the three anchors
python3 - <<'EOF'
import yaml, glob, sys
bad = []
for f in glob.glob("argocd/**/*.yaml", recursive=True):
    for d in yaml.safe_load_all(open(f)):
        if not d or d.get("kind") != "Application":
            continue
        src, dst = d["spec"].get("source", {}), d["spec"].get("destination", {})
        if not src.get("repoURL") or not (src.get("path") or src.get("chart")) or not dst:
            bad.append(f)
sys.exit(1 if bad else 0)
EOF
```
