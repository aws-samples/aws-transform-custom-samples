# Minimal Execution Set

## Purpose

Defines the boundary between **execution scope** (resources actually generated, built, and validated in Phase 2) and **reporting scope** (resources documented in INFRASTRUCTURE_REQUIREMENTS.md and TRANSFORMATION_SUMMARY.md as a roadmap). The goal is to ensure the transformation succeeds by focusing on the minimum set of resources required to make the primary application build and run.

**Core principle:** Execution scope ≠ Reporting scope. The Phase 1 report and INFRASTRUCTURE_REQUIREMENTS.md §0 catalog ALL decomposition candidates. Phase 2 execution implements only what is required unless `decomposition_scope=full` is specified.

## Decomposition Scope Parameter

The `decomposition_scope` parameter (set in Entry Criteria §5) controls how much of the Named Service Inventory is implemented:

| Value | Behaviour |
|-------|-----------|
| `minimal` (default) | Generate manifests for the primary Deployment + required supporting resources only. All other candidates are documented in roadmap. |
| `full` | Generate manifests for ALL Low and Medium complexity candidates from the Named Service Inventory, in addition to the primary Deployment and required support resources. High-complexity candidates remain documented only. |

When `decomposition_scope` is absent or unset, apply `minimal`.

### How `full` Mode Changes the Resource Classification

When `decomposition_scope=full`:
- All **Low-complexity** candidates move from Deferred to **In-Scope** — generate Deployment, Service, NetworkPolicy, and (if needed) separate Dockerfile.
- All **Medium-complexity** candidates move from Deferred to **In-Scope** — generate Deployment, Service, NetworkPolicy with shared DB connection.
- **High-complexity** candidates remain Deferred (documented only).
- CronJobs for Low/Medium services move to In-Scope.
- Per-service HPAs move to In-Scope.

The `full` mode still requires each generated manifest to pass all validation (docker build, kubeconform, structural assertions).

## When to Apply

During Phase 2 Sub-Phase §2 (Decomposition Assessment) and §15 (Manifest Generation).

- When `decomposition_scope=minimal` (or absent): apply the Minimal Execution Set constraint — this document's classification table governs scope.
- When `decomposition_scope=full`: the classification table below shows the default; Low/Medium candidates are promoted to In-Scope per the rules above.

## Resource Classification Table (Minimal Mode)

| Resource Type | In Minimal Execution Set? | Condition |
|---|---|---|
| Namespace | ✅ Always | Required for all other resources |
| Primary Deployment (web/API) | ✅ Always | The main HTTP service — owns the primary ingress endpoint |
| Primary Service (ClusterIP) | ✅ Always | Exposes the primary Deployment |
| ConfigMap | ✅ Always | Required by Deployment env/envFrom |
| Secret | ✅ Always | Required by Deployment env/envFrom |
| ServiceAccount | ✅ Always (when IRSA) | Required for cloud credential injection |
| Required Background Worker | ✅ Conditional | Only if the primary Deployment CANNOT function without it (e.g., Sidekiq for Rails Action Mailer, Celery for async-mandatory workflows) |
| Required Migration Job | ✅ Conditional | Only if the primary Deployment CANNOT start without schema/data init (Flyway, Liquibase, EF Core, Alembic, Rails db:migrate) |
| Ingress | ✅ Conditional | Only if access pattern = browser-facing web app |
| Primary NetworkPolicy | ✅ Always | Ingress + egress for the primary Deployment |
| Nginx/Reverse Proxy Deployment | ✅ Conditional | Only if user confirmed reverse proxy is required |
| CronJobs | ❌ Deferred | Document schedule + command in roadmap |
| HPA | ❌ Deferred | Document scaling strategy in roadmap |
| Additional worker Deployments | ❌ Deferred | Document in §0 Microservice Architecture |
| NetworkPolicies for deferred workloads | ❌ Deferred | Generated only when workload is generated |
| PVCs (beyond primary) | ❌ Deferred | Document storage requirements only |
| Multi-container sidecars | ❌ Deferred | Document pattern in roadmap |

## Selection Criteria for Primary Deployment

When multiple Deployments are candidates, select the **primary** using this priority:

1. Owns the primary HTTP ingress endpoint (the URL users access).
2. Has the fewest hard external dependencies (can start independently).
3. Has the lowest ExtractionOrder in the Named Service Inventory.
4. If tied: prefer the monolith/main-app over extracted services.

## What "Deferred" Means

Deferred resources are:
- **Documented** in TRANSFORMATION_SUMMARY.md §Microservice Decomposition Roadmap.
- **Described** in INFRASTRUCTURE_REQUIREMENTS.md §0 with prerequisites.
- **NOT generated** as YAML manifests in `kubernetes/`.
- **NOT validated** by docker build, kubeconform, or cluster tests.

Manifest stubs for deferred resources MAY exist as comments or roadmap notes but are NOT the tested/validated output.

## Exceptions: When to Include More (Minimal Mode)

Include additional resources in the Minimal Execution Set ONLY when:
1. The primary Deployment literally cannot start without them (hard dependency at startup).
2. The user explicitly requested them in interactive mode.
3. A background worker is mandatory for the app to process its first request.

## Verification

After Phase 2 manifest generation, count resources:

```bash
# Count generated manifest files
ls kubernetes/*.yaml | wc -l

# Verify resource types present
for f in kubernetes/*.yaml; do
  grep '^kind:' "$f"
done | sort | uniq -c
```

**Expected resource kinds** for a typical minimal set:
- Namespace: 1
- Deployment: 1–2 (primary + optional required worker)
- Service: 1–2
- ConfigMap: 1
- Secret: 1
- NetworkPolicy: 1–2
- Job: 0–1 (migration only if required)
- Ingress: 0–1
- ServiceAccount: 0–1

**Red flag (minimal mode):** If >8 manifest files are generated for a single-service application, review whether deferred resources leaked into execution scope.

**Full mode:** Expect more manifests proportional to the number of Low/Medium candidates in the Named Service Inventory. Each additional service adds Deployment + Service + NetworkPolicy (minimum 3 files).

## Relationship to Phase 1 Report

| Document | Scope | Content |
|----------|-------|---------|
| Phase 1 Readiness Report | Full catalog | ALL service candidates, ALL findings, ALL decomposition recommendations |
| INFRASTRUCTURE_REQUIREMENTS.md §0 | Full catalog | ALL services with extraction prerequisites and blocking dependencies |
| TRANSFORMATION_SUMMARY.md §Roadmap | Full catalog | Extraction status of ALL candidates (Extracted / Deferred / N/A) |
| `kubernetes/` directory | **Execution scope** | Only resources within scope per `decomposition_scope` setting |
