---
name: tanzu-to-eks
description: >-
  Transforms a Cloud Foundry application - VMware Tanzu Application Service (TAS), Pivotal
  Cloud Foundry (PCF) or open-source Cloud Foundry - into Kubernetes manifests for Amazon EKS.
  Converts the manifest.yml fields that map mechanically, scaffolds the container build and the
  credential injection, and reports every part of the platform contract that cannot be
  reconstructed from the repository. Not for Tanzu Kubernetes Grid (TKG).
  Trigger: Cloud Foundry migration, TAS to EKS, PCF to EKS, manifest.yml, VCAP_SERVICES, cf push.
type: custom
version: 0.2.0
---

# Tanzu / Cloud Foundry to Amazon EKS

## Objective

Convert what a Cloud Foundry repository **does** contain into Kubernetes, and report precisely
what it does **not** contain because the platform supplied it. The paired Lens
`tanzu-to-eks-migration-readiness` decides which applications to run this on.

## Why the scope is deliberately narrow

`manifest.yml` is thin. Most of what Kubernetes needs was never in the repository: the buildpack
built the container, `VCAP_SERVICES` injected credentials, the platform created the route, and
ephemeral disk meant there was no volume. So this definition is **mostly a scaffolder and a
reporter**, and only a small part of it is a translator.

That is a design decision, not a limitation. Generating a plausible `Dockerfile` from a buildpack
contract, or a Secret from a service binding that was never described in the repository, produces
manifests that apply cleanly and are wrong - the worst outcome. This is the same rule that made
`ack-resource-adoption-from-iac` degrade an unmapped CloudFormation type to report-only rather
than invent a Kind.

## Scope

### MECHANICAL - converted

| `manifest.yml` field | Kubernetes output |
|---|---|
| `name` | `metadata.name`, and the label set |
| `instances` | `spec.replicas` |
| `memory` | `resources.requests.memory` **and** `limits.memory`, with a report note (see below) |
| `disk_quota` | an `emptyDir` `sizeLimit`, plus a report note that CF disk was ephemeral |
| `env` | `env[]`, and any value that looks like a credential goes to a Secret stub instead |
| `command` | `command`/`args` |
| `routes` / `domain` + `host` | `Service` + `HTTPRoute` (or `Ingress`), plus a DNS action item |
| `health-check-type: http` + endpoint | `readinessProbe` and `livenessProbe` with that path |
| `health-check-type: port` (or absent) | a TCP `readinessProbe` on `containerPort`, marked as a **reconstruction** of the platform default |
| `Procfile` non-web process types | one additional `Deployment` per process type |
| `.cfignore` | `.dockerignore` |

**`memory` is not a faithful copy.** On Cloud Foundry that value also drove the buildpack's JVM
memory calculation. Emit it as both request and limit, and emit a HIGH-risk report entry stating
that a JVM workload needs its heap settings re-derived - copying the number verbatim is the most
common cause of an OOMKill loop after a CF migration.

### SCAFFOLD - emitted incomplete, clearly marked

1. **Container build.** A `project.toml` for Paketo / Cloud Native Buildpacks when
   `build_strategy: buildpacks` (closest to the source, since Paketo descends from the CF
   buildpacks), or a `Dockerfile` skeleton when `build_strategy: dockerfile`. Either way the
   language and version detected from the repository go in as **comments**, never as asserted
   values.
2. **Credential injection.** For every entry in `services:`, a Secret **stub** with the key names
   the application is likely to read and **no values**, plus a `TODO(migration)` and a report
   entry naming the AWS service that has to be provisioned. Never invent a connection string.
3. **`VCAP_SERVICES` shim.** When the application parses `VCAP_SERVICES`, emit a documented option
   set (adapt the code to read individual env vars, or project a `VCAP_SERVICES`-shaped value from
   a Secret as a bridge) and mark it a **code change**, not a manifest change.

### REPORT-ONLY - never transformed

| Construct | Why |
|---|---|
| Bound service provisioning | Each binding is a provisioning decision with cost, version and networking implications. Naming an RDS instance as "the equivalent" of a `p-mysql` plan hides a version and failover difference |
| Route services (`cf bind-route-service`) | Rate limiting, auth or WAF that is invisible in the application code and would silently disappear |
| Tasks (`cf run-task`) | Defined outside the manifest, in automation or a scheduler service. The most commonly lost part of a CF migration |
| Application Security Groups | Central egress control the repository does not describe. Downstream partners may allow-list the foundation's NAT address |
| Org / space role model | `SpaceDeveloper` and friends have no direct RBAC counterpart |
| Blue-green scripts | They encode verification steps between the swap that a plain RollingUpdate does not have |
| Application code reading `VCAP_*` | Flagged with every call site, never rewritten |

## Constraints

- **Additive, and that includes files at the repository root.** Originals untouched; converted
  output under `eks/`. **`MIGRATION_REPORT.md` goes at the repository ROOT**, matching the
  convention of the other definitions in this collection - not inside `eks/`.
- **Never create or modify a file at the repository root** other than `MIGRATION_REPORT.md`.
  This includes build-context files: a `.dockerignore` belongs at the build context root to be
  useful, but writing it there **modifies the source tree**, and a repository that already has one
  would be overwritten. Emit it as `eks/.dockerignore` with a report entry stating it must be moved
  to the build context root before the first image build. A useless-but-safe artifact plus an
  instruction beats a useful artifact that mutated the source.
- **Never invent a credential, a connection string, an image tag or a hostname.** Emit a stub plus
  `TODO(migration)` plus a report entry. Three artifacts for one gap, on purpose: the code shows
  where, the TODO shows what, the report shows why.
- **Absence is reported, not filled.** If the repository has no health check, no CPU value and no
  Dockerfile, say so for each - do not quietly supply defaults that look like decisions someone made.
- **The manual-action section of the report is named exactly `## Manual Action Items`.**
- **No em dash (U+2014) anywhere in emitted output** - use a hyphen.
- Stay on the current branch; do not commit.

## Workflow

```text
Phase 0  Read additionalPlanContext: migration_target, build_strategy, registry, namespace
Phase 1  Parse every manifest.yml / manifest-*.yml and vars-*.yml. Inventory EVERY field
         present AND every field absent. Classify MECHANICAL / SCAFFOLD / REPORT-ONLY.
Phase 2  Convert the MECHANICAL set (table above). One Deployment per application entry,
         one more per non-web Procfile process type.
Phase 3  Emit scaffolds: build (project.toml or Dockerfile), Secret stubs, VCAP shim options.
Phase 4  Validate: YAML parses, kubectl apply --dry-run=client, helm template if a chart was
         emitted, and assert no invented credential value survives (grep for placeholder
         markers, and that every Secret stub has empty values).
Phase 5  MIGRATION_REPORT.md, cross-referenced to the Lens question ids.
```

## Exit Criteria

1. Every manifest field, present or absent, appears in the report inventory with a classification.
2. Originals byte-identical. All converted output under `eks/`; `MIGRATION_REPORT.md` at the
   repository root. **No other file created or modified at the root** - a `.dockerignore` at
   the root is a defect even though that is where it would be useful.
3. Every Secret stub has **empty values** and a `TODO(migration)`. A stub with a fabricated value
   is a defect, not a convenience.
4. Emitted YAML parses; `--dry-run=client` clean; charts render under `helm template`.
5. Every REPORT-ONLY construct has a report entry naming the construct, the reason, and the path.
6. Every `TODO(migration)` has an entry in the report's `## Manual Action Items`, and vice versa.
7. The `memory` translation carries its HIGH-risk JVM note whenever a JVM language is detected.

## Non-Goals

1. Provisioning AWS services. This produces manifests, never infrastructure.
2. Rewriting application code. `VCAP_SERVICES` call sites are located and reported.
3. **Tanzu Kubernetes Grid.** Already Kubernetes; a cluster migration with a different shape.
4. Executing the migration or applying to a cluster.
