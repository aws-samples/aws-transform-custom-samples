# Kubernetes Readiness Analysis and Migration Skill

Automated two-phase transformation that assesses any codebase for Kubernetes readiness and then transforms it for full containerised deployment — generating Kubernetes manifests, resolving 12-factor blockers, and producing microservice decomposition plans.

**Supports Go · Java/Maven/Gradle · Node.js · PHP · Python · Ruby/Rails · C#/.NET · and more**

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [What This Skill Does](#what-this-skill-does)
- [Skill Architecture](#skill-architecture)
- [Supported Languages & Frameworks](#supported-languages--frameworks)
- [Patterns Handled](#patterns-handled)
- [Edge Cases](#edge-cases)
- [Getting Started](#getting-started)
- [Getting Started with AWS Transform Custom](#getting-started-with-aws-transform-custom)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

## Overview

Assess and transform applications for containerised Kubernetes deployment in two phases. Phase 1 produces a comprehensive readiness report scored across 21 areas — covering all 12-factor app principles, Kubernetes compatibility, singleton risks, monolith decomposition, and security — including both Minimal and Full decomposition recommendations. Phase 2 consumes that report and systematically resolves every finding: externalising config and secrets, migrating persistent storage, redirecting logging, generating Kubernetes manifests, and validating via a three-tier pipeline (docker build → kubeconform → optional cluster validation).

## The Problem

Organisations migrating applications to Kubernetes face:

- **Hidden blockers**: Hardcoded config, local filesystem writes, and in-memory state are just some of the challenges faced when migrating to Kubernetes 
- **Monolith complexity**: No clear decomposition plan for which services to extract first and in what order
- **Secret sprawl**: Credentials embedded in config files, docker-compose overrides, and connection strings
- **Scaling failures**: Session state, singleton schedulers, rate limiters, and file-coordination code break under horizontal scaling
- **Slow feedback cycles**: Issues discovered at deploy time rather than before a line of manifest is written
- **Manual effort**: Kubernetes manifest generation, security hardening, and infrastructure documentation typically take days per application

## What This Skill Does

Given any application codebase, this skill:

**Phase 1 — Readiness Analysis**
1. Evaluates the codebase against all 12 factors of the 12-factor app methodology
2. Identifies containerisation blockers, warnings, and informational findings across 21 analysis areas
3. Detects singleton patterns that break horizontal scaling (schedulers, rate limiters, caches, WebSocket state)
4. Audits all credentials, API keys, secrets, and connection strings
5. Maps local filesystem usage and recommends object store or shared volume replacements
6. Produces a Named Service Inventory with Decomposition Complexity ratings and both Minimal and Full Decomposition Recommendations for monolith decomposition
7. Identifies startup order dependencies and in-memory state sharing between microservice candidates
8. Outputs a single consolidated report (HTML or Markdown) with visual scorecard, severity badges, and structured finding tables

**Phase 2 — Containerisation Transformation**
1. Resolves every Phase 1 blocker and warning with code changes
2. Externalises all hardcoded config to environment variables; generates ENV_VARIABLES.md
3. Migrates persistent storage to object store (S3/GCS/Azure Blob) or Kubernetes shared volumes
4. Redirects all file-based logging to stdout/stderr
5. Externalises sessions for horizontal scaling (only where not already DB-backed)
6. Extracts scheduled tasks to Kubernetes CronJob manifests
7. Generates Kubernetes manifests for the Minimal Execution Set (Namespace, Deployment, Service, ConfigMap, Secret, NetworkPolicy)
8. Hardens containers: non-root user, read-only root filesystem, dropped capabilities, resource limits, probes
9. Configures IRSA for AWS credential access; removes all hardcoded credentials
10. Validates via docker build, kubeconform strict mode, and optional Minikube deployment
11. Produces TRANSFORMATION_SUMMARY.md and INFRASTRUCTURE_REQUIREMENTS.md

## Skill Architecture

The skill runs as a two-phase sequential pipeline with on-demand reference dispatch. Before any analysis begins, the skill conducts an **Initial Entry Interview** (§0) to gather user preferences in two blocks:

- **Block A** (always asked): phase selection (Phase 1 only, or Phase 1 + 2), report output path, report format (Markdown or HTML), and detail level (full 21-area scorecard or executive summary).
- **Block B** (Phase 2 only): decomposition scope (`minimal` or `full`) and validation tooling (auto-detected, then confirmed).

In non-interactive / CI mode, defaults are applied automatically: Phase 1+2, Markdown, full detail, minimal scope, KWOK attempted if available.

```
Phase 1: Readiness Analysis
  ├── §0 Initial Entry Interview (Block A)
  ├── 12-factor evaluation (all 12 factors)
  ├── Kubernetes compatibility checks
  ├── Singleton & scaling risk analysis
  ├── Credential & secrets audit
  ├── Monolith decomposition assessment
  │     └── Named Service Inventory + Complexity ratings
  │         ├── Minimal Decomposition Recommendation
  │         └── Full Decomposition Recommendation
  └── Output: consolidated readiness report (HTML or Markdown)
        Visual scorecard (21 areas) · Severity badges · Finding tables

Phase 2: Containerisation Transformation
  ├── §0 Initial Entry Interview (Block B, if not already completed)
  ├── §1  Initial Setup — parse report, gather user preferences
  ├── §2  Decomposition Assessment — ingest Named Service Inventory,
  │         apply execution scope (minimal or full)
  ├── §3  Configuration Externalisation
  ├── §4  Session & Cache Externalisation
  ├── §5  Logging Transformation → stdout/stderr
  ├── §6  Filesystem → Object Store Migration
  ├── §7  Credentials & Secrets (IRSA, Kubernetes Secrets)
  ├── §8  Backing Services (replace hardcoded addresses)
  ├── §9  Scheduled Tasks → CronJob manifests
  ├── §10 Concurrency & Scaling
  ├── §11 Build/Release/Run separation
  ├── §12 Disposability & Startup Resilience (probes, terminationGracePeriodSeconds)
  ├── §13 Security Hardening (non-root, readOnlyRootFilesystem, capabilities)
  ├── §14 Database Connection Optimisation
  ├── §15 Kubernetes Manifest Generation (execution scope)
  ├── §16 Infrastructure Requirements Document
  ├── §17 Dockerfile Update (multi-stage, non-root)
  ├── §17b Docker Build Verification (Tier 1)
  ├── §18 kubeconform Validation (Tier 2) + optional cluster Tier 3
  └── §19 Final Review — TRANSFORMATION_SUMMARY.md + Decomposition Roadmap
```

### Minimal Execution Set

Phase 2 generates manifests only for the **primary Deployment + required supporting resources** — not every decomposition candidate. The full roadmap is documented but not generated, keeping the output focused and deployable from day one.

| Resource | Always Generated |
|---|---|
| Namespace | ✅ |
| Primary Deployment + Service | ✅ |
| ConfigMap + Secret | ✅ |
| NetworkPolicy | ✅ |
| Required Job / CronJob | Conditional |
| Secondary microservice Deployments | Roadmap only |

### Key Design Decisions

1. **Phase 1 before Phase 2.** The readiness report drives transformation scope. If Phase 1 output is unavailable (automated pipelines), Phase 2 derives blocker context directly from source files using the same analysis patterns.

2. **Minimal Execution Set.** Only the primary workload and its required dependencies are generated as manifests. Additional decomposition candidates go into the roadmap — preventing manifest sprawl and keeping Tier 1/2/3 validation tractable.

3. **Three-tier validation.** Docker build (Tier 1) → kubeconform strict mode (Tier 2) → optional Minikube (Tier 3). Tier 2 never runs until Tier 1 passes. Tier 3 is opt-in.

4. **No-defer rule for blockers.** Runtime startup blockers (e.g., root-privileged entrypoint ops after `USER nonroot`, `.bak` files, stale manifest references) are fixed in the same task scope they are discovered — never deferred.

5. **Source-authoritative env vars.** Before finalising ConfigMap/Secret keys, actual source files are grepped for env var read patterns (`os.environ`, `process.env`, `@Value`, `viper.Get`, etc.). Task-spec variable names are indicative only — source code is authoritative.

6. **Session verification gate.** Before adding Redis for session externalisation, the skill checks for DB-backed session patterns (Django `backends.db`, Rails `ActiveRecord::SessionStore`). DB-backed sessions do NOT get Redis.

## Supported Languages & Frameworks

| Language | Frameworks / Tooling |
|---|---|
| Go | Standard library, Fiber, Viper, gRPC |
| Java | Spring Boot, Maven, Gradle, Quartz, Spring Batch, Hibernate, Liquibase |
| Node.js | Express, NestJS, Next.js, Apollo Federation, Bull/BullMQ, node-cron, Socket.io |
| PHP | Laravel, PHP-FPM, Composer, supervisord |
| Python | Django, Flask, FastAPI, Celery, APScheduler, gunicorn, uvicorn, pydantic-settings |
| Ruby | Rails, Puma, Sidekiq, Sidekiq-Cron, ActionCable, ActionMailer, ActiveStorage |
| C#/.NET | ASP.NET Core, Entity Framework Core, SignalR, Kestrel |

## Patterns Handled

| Pattern | Transformation |
|---|---|
| Hardcoded IP/hostname/port | Replaced with env var reads; documented in ENV_VARIABLES.md |
| Hardcoded credentials in source | Removed; sourced from Kubernetes Secret + IRSA |
| docker-compose secret literals | Audited via Forms A–F; replaced with Secret refs |
| Connection URL with embedded creds | Externalised; URL reconstructed from env vars |
| Local filesystem writes (logs, uploads) | Redirected to stdout/stderr or migrated to object store (S3/GCS/Azure Blob) |
| File-based sessions | Externalised to Redis or left as-is if already DB-backed |
| In-process Quartz / APScheduler / cron / Laravel Kernel / node-cron | Extracted to Kubernetes CronJob manifests |
| Singleton rate limiters, sequence generators | Replaced with distributed alternatives |
| WebSocket state (in-memory) | Documented as scaling prerequisite; Redis backplane for Socket.io/ActionCable |
| WAR/EAR packaging (Java) | Converted to executable JAR / multi-stage Docker build |
| root-privileged entrypoint ops | Moved to build-time RUN or init-container; UID explicitly set |
| Dynamic UID (`useradd -r`) | Replaced with explicit `--uid 1000` to match `runAsUser` |
| readOnlyRootFilesystem violations | Writable paths audited; emptyDir mounts added for required runtime write paths |
| PVC with ReadWriteMany | `storageClassName: "replace-with-rwm-class"` placeholder added |
| HPA with local PVCs | `minReplicas: 1` with MIGRATION comment listing prerequisites |
| @PostConstruct + @Transactional (Spring) | Replaced with `@EventListener(ApplicationReadyEvent.class)` |
| Multi-module monolith | Named Service Inventory produced; extraction order and complexity rated |
| Startup order coupling | Documented; readiness/liveness probes + retry logic added |

## Edge Cases

| Scenario | How It's Handled |
|---|---|
| Phase 1 report unavailable (automated pipeline) | Phase 2 derives blocker context directly from source files |
| DB-backed sessions (Django, Rails ActiveRecord) | Redis NOT added; sessions already scalable |
| Quartz scheduler with `auto-startup=false` | CronJob NOT generated; treated as empty scheduler |
| Distroless base images | All probes omitted; `activeDeadlineSeconds` used instead |
| Official DB images (Postgres, MySQL) | `runAsUser: 0`, capabilities preserved, `readOnlyRootFilesystem: false` |
| nginx:alpine base image | `runAsUser: 101`, `runAsGroup: 101` |
| PHP-FPM / PHP-Apache (Debian) | `runAsUser: 33`, `runAsGroup: 33` |
| Spring XML + `@PropertySource` hybrid | `PropertiesFactoryBean` action protocol applied |
| Gunicorn `--graceful-timeout` | `terminationGracePeriodSeconds = graceful-timeout + 5` |
| Spring `timeout-per-shutdown-phase=25s` | `terminationGracePeriodSeconds = 30` |
| `$(VAR)` in command/args | Uses shell form for envFrom-sourced vars; direct env: list for same-container vars |
| NEXT_PUBLIC_* vars | Excluded from ConfigMap (build-time baked values, not runtime-injectable) |
| Multi-module Maven build | `Dockerfile` COPY uses correct build context; two-COPY Gradle wrapper pattern |
| Windows-only runtimes (.NET Framework, IIS, COM+) | Phase 1 Blocker flagged; Linux-compatible migration required before containerisation |

## Benchmark Results

### Full Manual Testing and Kubernetes Deployment

The following real-world open source applications have been fully transformed and validated through all three tiers — docker build, kubeconform, and local Kubernetes deployment:

| Application | Language / Stack | Description | Execution Time |
|---|---|---|---|
| [Bookstack](https://github.com/BookStackApp/BookStack) | PHP / Laravel | Documentation and wiki platform | 17m 31s |
| [OpenMRS Core](https://github.com/openmrs/openmrs-core) | Java / Spring | Open source electronic medical records system | 13m 24s |
| [Trac](https://trac.edgewall.org/) | Python | Project management and bug tracking tool | 11m 35s |
| [Shopizer](https://github.com/shopizer-ecommerce/shopizer) | Java / Spring Boot | E-commerce platform | 14m 40s |
| [OpenCart](https://github.com/opencart/opencart) | PHP | Open source online store management system | 15m 46s |

Each of these projects was taken from a non-containerised state through Phase 1 readiness analysis, full Phase 2 transformation, and confirmed running on a local Kubernetes cluster with all health probes passing.

### Automated Testing

In addition to the full end-to-end benchmarks above, the skill has been tested against a broad range of open source projects across the supported language ecosystem to validate readiness analysis accuracy, 12-factor coverage, credential detection, manifest generation, and kubeconform compliance:

| Language | Status |
|---|---|
| Java | ✅ Tested |
| Ruby | ✅ Tested |
| PHP | ✅ Tested |
| Python | ✅ Tested |
| Go | ✅ Tested |
| Node.js | ✅ Tested |

## Getting Started

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| AWS Transform CLI (atx) | Latest | Execute the skill |
| Docker | 20.10+ | Tier 1 build validation |
| kubeconform | 0.6+ | Tier 2 manifest validation |
| Minikube (optional) | 1.30+ | Tier 3 local deployment validation |
| kubectl | 1.26+ | Apply and verify manifests |

> **Note:** Docker, kubeconform, and any local Kubernetes tool (Minikube, Docker Desktop with Kubernetes enabled, or k3s/k3d) must be installed on the machine where the skill runs for the corresponding validation tiers to execute. If these tools are not present, the skill will skip those tiers and report them as unavailable. Installing them beforehand is recommended — Tier 3 in particular provides the most complete validation and is worth the setup cost.

### Getting Started with AWS Transform Custom

To set up the AWS Transform CLI, configure authentication, and run your first transformation, see the [AWS Transform Custom Getting Started Guide](https://docs.aws.amazon.com/transform/latest/userguide/custom-get-started.html).

### Cloning the Repo and Publishing the Transformation

```bash
git clone https://github.com/aws-samples/aws-transform-custom-samples
cd community-sourced-transformations

atx custom def publish -n kubernetes-readiness-migration \
    --sd kubernetes-readiness-migration \
    --description "Two-phase Kubernetes containerisation skill: assesses any codebase against 12-factor and Kubernetes requirements, then transforms it"
```

### Running the Transformation

```bash
atx custom def exec \
  -n kubernetes-readiness-migration \
  -p ./my-application \
    -t
```

### Validating the Output

The skill runs a three-tier validation pipeline internally. You can also run each tier manually:

```bash
# Tier 1: Docker build — one Dockerfile per workload in the Minimal Execution Set.
# Workload list is in TRANSFORMATION_SUMMARY.md under "Manifest Inventory".
docker build -f Dockerfile -t <primary-service>:<tag> .
docker build -f <worker-service>/Dockerfile -t <worker-service>:<tag> <worker-service>/

# Tier 2: Manifest validation (all manifests in one pass)
kubeconform -strict -summary kubernetes/

# Tier 3: Minikube (optional — requires Tier 1 and Tier 2 to pass first)
minikube start
kubectl apply -f kubernetes/
kubectl get pods -w
kubectl logs deployment/<primary-service>
```

#### Local Kubernetes validation

Running local Kubernetes validation at the end of the transformation is strongly recommended. Tier 1 (docker build) and Tier 2 (kubeconform) are static checks — they cannot catch probe misconfiguration, missing env vars at runtime, image pull failures, or networking issues between pods. A local cluster exercises the full deployment end-to-end and is the only tier that confirms the application actually starts and responds correctly.

The skill uses Minikube by default for Tier 3, but any of the following work equally well:

| Tool | Notes |
|---|---|
| **Minikube** | Default. Good general-purpose local cluster with broad platform support. |
| **Docker Desktop** | Enable Kubernetes in Docker Desktop settings — zero extra install if you're already using it. Single-node cluster, simplest setup on Mac and Windows. |
| **k3s / k3d** | Lightweight Kubernetes; k3d wraps k3s in Docker for fast startup. The skill includes a k3s fallback procedure in `references/docker-build-validation.md` for resource-constrained environments. |

When Tier 3 is selected during the transformation, the skill deploys to the local cluster, monitors pod startup, tails logs for errors, and iterates on any failures before declaring success. You can also trigger it after the fact by re-running the skill and confirming local validation when prompted, or by applying the manifests manually with `kubectl apply -f kubernetes/`.

### Requesting Further Decomposition

By default the skill generates manifests for the **Minimal Execution Set** — the primary Deployment plus any required supporting workloads — and documents the remaining microservice candidates in a decomposition roadmap in `TRANSFORMATION_SUMMARY.md`.

If you want to go further and extract additional services from the roadmap, tell the skill which candidates to promote:

> "Extract the `OrderService` and `NotificationWorker` from the roadmap and generate full Kubernetes manifests for each."

The skill will re-run Phase 2 §2 (Decomposition Assessment) for those candidates, apply the Minimal Execution Set rules to each, generate Deployments, Services, ConfigMaps, Secrets, and NetworkPolicies, and update `INFRASTRUCTURE_REQUIREMENTS.md` and `TRANSFORMATION_SUMMARY.md` accordingly. Each extracted service goes through the same three-tier validation as the primary workload.

### Expected Output

```
kubernetes/
  namespace.yaml
  deployment.yaml
  service.yaml
  configmap.yaml
  secret.yaml
  networkpolicy.yaml
  cronjob-<name>.yaml      # if scheduled tasks present
  ingress.yaml             # if browser-facing

ENV_VARIABLES.md           # all env vars with K8s scope, source, and classification
INFRASTRUCTURE_REQUIREMENTS.md   # databases, Redis, S3, IAM, networking to provision
TRANSFORMATION_SUMMARY.md        # executive summary, manifest inventory, per-finding changes
```

## Documentation & References

### Skill Definition

| File | Description |
|---|---|
| [SKILL.md](SKILL.md) | Complete skill definition — objective, scope, 20-phase transformation workflow, validation criteria, reference dispatch table, and exit criteria |

### Reference Documents

These are loaded on-demand by the agent when specific patterns are encountered:

| Reference | Trigger | Description |
|---|---|---|
| [skill-a-readiness-analysis.md](references/skill-a-readiness-analysis.md) | Phase 1 work | Full 101-step readiness analysis procedure, scoring rules, report formatting |
| [skill-b-containerisation-transformation.md](references/skill-b-containerisation-transformation.md) | Phase 2 work | Full 20-sub-phase transformation procedure, per-task hygiene gates, 8-point closure gate |
| [docker-build-validation.md](references/docker-build-validation.md) | §17b Docker build validation | Three-tier validation, smoke-test commands, common failure patterns, KWOK fallback |
| [minimal-execution-set.md](references/minimal-execution-set.md) | §2 decomposition and §15 manifest generation | Resource classification table defining execution vs reporting scope |
| [microservice-decomposition-patterns.md](references/microservice-decomposition-patterns.md) | Phase 1 decomposition; ≥2 service candidates | Named Service Inventory, Complexity Rubric, Data Ownership Matrix, extraction heuristics |
| [validation-patterns.md](references/validation-patterns.md) | Post-batch and post-migration sweeps | YAML structural checks, banned-phrase sweeps, ENV_VARIABLES.md audit, Secret validation |
| [credential-audit-patterns.md](references/credential-audit-patterns.md) | §7 credentials; docker-compose\*.yml present | Forms A–F credential audit, IRSA config, Secret classification, URL-embedded creds |
| [go-patterns.md](references/go-patterns.md) | go.mod present | Viper env helpers, gRPC probes, S3 mock testing, GOMEMLIMIT ConfigMap rules |
| [nodejs-patterns.md](references/nodejs-patterns.md) | package.json present | process.env timing, ioredis pub/sub, NestJS WebSocket, Bull/BullMQ graceful shutdown |
| [php-patterns.md](references/php-patterns.md) | composer.json present | Laravel queue routing, supervisord, PHP-FPM non-root, S3 ACL patterns |
| [java-maven-patterns.md](references/java-maven-patterns.md) | pom.xml or build.gradle present | Spring @Value bridging, Quartz JDBC clustering, Liquibase Job, EF efbundle |
| [python-patterns.md](references/python-patterns.md) | requirements.txt / setup.py / pyproject.toml | pydantic-settings, APScheduler, gunicorn preload_app, Celery Beat writable paths |
| [ruby-rails-patterns.md](references/ruby-rails-patterns.md) | Gemfile present | ActionCable Redis, ActiveStorage, whenever→Sidekiq-Cron, Puma graceful shutdown |
| [dotnet-patterns.md](references/dotnet-patterns.md) | .csproj / .sln present | IConfiguration bridge, EF Core efbundle Job, SignalR Redis backplane, Kestrel port config |

## Known Limitations

| Limitation | Severity | Notes |
|---|---|---|
| Windows-only runtimes (.NET Framework, IIS, COM+) | HIGH | Phase 1 Blocker — Linux-compatible migration required first |
| True 2PC / XA distributed transactions | MEDIUM | Replaced with separate TransactionManagers or Saga pattern recommendation |
| Complex stateful EJBs (JBoss-specific) | MEDIUM | Handled if combined with JBoss-to-Spring-Boot migration upstream |
| JSF / PrimeFaces frontends | MEDIUM | Decomposed to REST APIs or Thymeleaf; separate frontend rewrite may be needed |
| Applications >50K LOC | LOW | May hit context limits; consider running Phase 1 and Phase 2 separately |
| Minikube on resource-constrained machines | LOW | Tier 3 is optional; Tier 1 + Tier 2 are sufficient for CI validation |

## Troubleshooting

| Issue | Resolution |
|---|---|
| `docker build` fails with permission denied on entrypoint | Entrypoint script has root-only operations after `USER nonroot`. Move `chown`/`mkdir` to build-time `RUN` or add an init container. |
| kubeconform rejects integer ConfigMap values | Quote all numeric values: `PORT: "8080"`, `WORKERS: "4"`. Unquoted integers fail strict mode. |
| Pods crash with `read-only file system` | Runtime writes to non-emptyDir paths. Add `emptyDir` mount for the offending path (check `/tmp`, log dirs, PID dirs). |
| All requests blocked after deployment | Spring Security or similar auto-configured. Add `SecurityFilterChain` with `permitAll()` for public routes; or verify `NetworkPolicy` egress allows required backing services. |
| Session lost on pod restart | Session backend not externalised. Check `SESSION_ENGINE` (Django), `config/initializers/session_store.rb` (Rails), or PHP `session.save_handler`. |
| `CrashLoopBackOff` on CronJob | CronJob missing required env vars from ConfigMap/Secret. Verify `envFrom` or `env` refs match generated ConfigMap keys exactly. |
| kubeconform `unknown field` error | API version mismatch. Use `autoscaling/v2` for HPA (v2beta2 removed in K8s 1.26). |
| `runAsUser` mismatch at runtime | `useradd -r` allocated dynamic UID. Rebuild Dockerfile with `useradd --uid 1000 appuser` explicitly. |
| Probe returning 401 | Health endpoint protected by auth middleware. Move probe path to a public `/healthz` route. |
| `terminationGracePeriodSeconds` too short | Formula: `max(graceful_shutdown_timeout + 5, 30)`. For gunicorn `--graceful-timeout 120`, set to `125`. |

## Repository Structure

```
├── SKILL.md                                    # Skill definition (two-phase pipeline)
├── README.md                                   # This file
├── references/
│   ├── skill-a-readiness-analysis.md           # Phase 1: full 101-step analysis procedure
│   ├── skill-b-containerisation-transformation.md  # Phase 2: full transformation procedure
│   ├── docker-build-validation.md              # Three-tier validation: docker, kubeconform, Minikube
│   ├── minimal-execution-set.md               # Execution scope vs reporting scope classification
│   ├── microservice-decomposition-patterns.md # Named Service Inventory, Complexity Rubric
│   ├── validation-patterns.md                 # YAML checks, banned-phrase sweeps, ENV audit
│   ├── credential-audit-patterns.md           # Forms A–F, IRSA, Secret classification
│   ├── go-patterns.md                         # Go-specific patterns
│   ├── nodejs-patterns.md                     # Node.js-specific patterns
│   ├── php-patterns.md                        # PHP-specific patterns
│   ├── java-maven-patterns.md                 # Java/Maven/Gradle-specific patterns
│   ├── python-patterns.md                     # Python-specific patterns
│   ├── ruby-rails-patterns.md                 # Ruby/Rails-specific patterns
│   └── dotnet-patterns.md                     # C#/.NET-specific patterns
```
