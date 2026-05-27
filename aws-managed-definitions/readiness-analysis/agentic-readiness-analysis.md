## Name

Agentic Readiness Analysis

## Objective

Evaluate whether a repository's systems — infrastructure, applications, data, security controls, and operational practices — are safe, operable, and integrable for autonomous AI agent integration. This analysis targets the environment that agents will call or consume, not the agent itself. It answers the question: are the systems agents will interact with ready to be called safely?

The analysis serves two purposes: (1) portfolio-level telemetry — a snapshot of which systems are agent-ready, which need remediation, and where systemic gaps exist; and (2) use-case-level dependency checking — given a specific agent workflow, which target systems are blockers?

ARA is a design-time architecture review — it evaluates whether controls exist in code and configuration, not whether they are effective at runtime. It is not a penetration test or runtime security scan.

## Summary

This transformation performs a dedicated Agentic Readiness Analysis on a codebase. It scans all files in the repository to discover infrastructure-as-code, application source code, CI/CD definitions, API specifications, dependency manifests, configuration files, and container definitions. It then evaluates what it finds against 43 questions across 8 sections:

- **API** — API Surface and Interface Design (8 questions: 4 core + 4 extended)
- **AUTH** — Authentication, Authorization, and Identity (7 questions: all core)
- **STATE** — State Management and Transactional Integrity (7 questions: 3 core + 4 extended)
- **HITL** — Human-in-the-Loop and Approval Workflows (3 questions: 1 core + 2 extended)
- **DATA** — Data Accessibility and Quality (7 questions: 4 core + 3 extended)
- **DISC** — Discoverability and Semantic Readiness (3 questions: 1 core + 2 extended)
- **OBS** — Observability of Target Systems (3 questions: 2 core + 1 extended)
- **ENG** — Engineering and Deployment Maturity (5 questions: 3 core + 2 extended)

### Evaluation Tiers

Not all 43 questions are evaluated for every service. Questions are organized into two tiers:

**Core (25 questions)** — Always evaluated for applicable repo types. These directly determine whether an agent can safely call this service:

| Section | Core Questions | Why Core |
|---------|---------------|----------|
| AUTH | Q1, Q2, Q3, Q4, Q5, Q6, Q7 (all 7) | Identity is always critical for agent safety |
| API | Q1, Q2, Q3, Q4 | Minimum viable integration surface |
| STATE | Q1, Q5, Q6 | Write safety and rate protection |
| DATA | Q1, Q2, Q4, Q6 | Data classification, residency, input validation, PII protection |
| OBS | Q1, Q2 | Debuggability of agent-initiated requests |
| ENG | Q1, Q2, Q3 | Infrastructure governance and deployment safety |
| HITL | Q3 | Agent testing environment |
| DISC | Q1 | Schema stability for agent tool bindings |

**Extended (18 questions)** — Evaluated only when triggered by service characteristics (archetype, scope, or detected patterns). When not triggered, recorded as "Not Evaluated (extended)" and excluded from scoring.

| Question | Trigger Condition |
|----------|------------------|
| API-Q5 | Always evaluated as INFO |
| API-Q6 | Service has operations >30s OR long-running workflows |
| API-Q7 | Service has state changes (stateful-crud, orchestrator) |
| API-Q8 | Always evaluated as INFO |
| STATE-Q2 | Service has persistent state (stateful-crud, data-gateway, orchestrator) |
| STATE-Q3 | agent_scope is write-enabled AND service has persistent state |
| STATE-Q4 | Service has external dependencies (calls other services or external APIs) |
| STATE-Q7 | Service is P0 priority OR is on the critical path |
| HITL-Q1 | agent_scope is write-enabled |
| HITL-Q2 | agent_scope is write-enabled |
| DATA-Q3 | Service has list/query endpoints with potentially unbounded results |
| DATA-Q5 | Service has persistent state (stateful-crud, data-gateway, orchestrator) |
| DATA-Q7 | Always evaluated as INFO |
| DISC-Q2 | Always evaluated as INFO |
| DISC-Q3 | Always evaluated as INFO |
| OBS-Q3 | Always evaluated as INFO |
| ENG-Q4 | Always evaluated (but INFO for stateless-utility) |
| ENG-Q5 | Service has persistent data stores |

### Evaluation Tier by Repo Type and Archetype

| Configuration | N/A | Core | Extended Triggered | Total Evaluated |
|--------------|-----|------|--------------------|-----------------|
| application / stateless-utility / read-only | 0 | 25 | ~3 (INFOs only) | ~28 |
| application / stateless-utility / write-enabled | 0 | 25 | ~5 | ~30 |
| application / stateful-crud / read-only | 0 | 25 | ~10 | ~35 |
| application / stateful-crud / write-enabled | 0 | 25 | ~14 | ~39 |
| application / orchestrator / read-only | 0 | 25 | ~8 | ~33 |
| application / orchestrator / write-enabled | 0 | 25 | ~11 | ~36 |
| application / data-gateway / read-only | 0 | 25 | ~7 | ~32 |
| application / event-processor / read-only | 0 | 25 | ~4 | ~29 |
| infrastructure-only | 29 | 14 | 0 | 14 |
| deployment-config | 35 | 8 | 0 | 8 |
| library | 5 | 25 | ~8 | ~33 |
| monorepo | per-service | per-service | per-service | per-service |

Each question is scored using a severity model:

| Severity | Meaning | Implication |
|----------|---------|-------------|
| **BLOCKER** | Must resolve before any agent deployment. | Creates compliance exposure, data integrity risk, or failure-at-scale risk. |
| **RISK-SAFETY** | Affects agent safety — unaddressed could cause the agent to cause harm. | Determines readiness profile. Must address for safe agent operation. |
| **RISK-QUALITY** | Affects agent effectiveness, not safety. | No profile impact — informational for prioritization. Address as capacity allows. |
| **INFO** | No immediate gating impact. Shapes architecture decisions. | Feeds agent design and orchestration decisions. Not a deployment gate. |

Five questions are **conditional BLOCKERs** (⚡) — their severity depends on context (typically `agent_scope` write-enabled vs read-only): API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, and DATA-Q2. DATA-Q1 additionally uses a tiered sub-check model (see its section for B1/B2/B3 evaluation).

### Unified Severity and Category Display Names

A unified severity vocabulary and canonical category display names are emitted on every finding so that a single webapp and portfolio aggregator can consume ARA and MOD findings side-by-side.

#### Unified Severity Mapping

Every finding carries a unified severity tag alongside its native ARA severity:

| Native ARA Severity | Unified Severity | `ara_metadata.safety_impact` |
|---|---|---|
| BLOCKER (unconditional) | High | true if agent-safety hazard, else false |
| BLOCKER (conditional, resolved as BLOCKER) | High | per conditional-resolution reasoning |
| RISK-SAFETY | Medium | true (always) |
| RISK-QUALITY | Medium | false (always) |
| INFO (when finding emitted) | Low | false |
| Passing question | (no finding) | n/a |
| N/A / Not Evaluated | (no finding, recorded in `evaluations[]`) | n/a |

The unified severity is emitted as the top-level `severity` field on each finding. The native ARA severity is preserved in `ara_metadata.native_severity`.

#### Category Display Names

Every finding carries both a short `category_id` code (the rubric section identifier, used as question_id prefix) and a webapp-facing `category` display name. The canonical mapping:

| `category_id` (short code) | `category` (display name) |
|---|---|
| `API` | API Surface |
| `AUTH` | Authentication & Authorization |
| `STATE` | State Management |
| `HITL` | Human-in-the-Loop |
| `DATA` | Data Accessibility |
| `DISC` | Discovery & Documentation |
| `OBS` | Observability |
| `ENG` | Engineering Maturity |

Both `category_id` and `category` are REQUIRED fields on every finding. Consumers (webapp filter chips, portfolio aggregation) use the display name directly.

#### DATA-Q* Namespace Collision

The short code `DATA` is shared between ARA and the Modernization analysis (MOD). ARA `DATA-Q1`..`DATA-Q7` and MOD `DATA-Q1`..`DATA-Q4` are DIFFERENT questions and MUST NOT be conflated. The unique join key across analysis types is `(analysis_type, question_id)`, never `question_id` alone. ARA `DATA` disambiguates to display name "Data Accessibility"; MOD `DATA` disambiguates to "Data Platform".

### RISK Tier Assignment

Each RISK-severity question is assigned to exactly one tier. The assignment is static — it does not depend on service characteristics. Scope-calibrated RISK questions (HITL-Q1, HITL-Q2, STATE-Q3, STATE-Q6) only count toward totals when agent_scope is write-enabled (they downgrade to INFO under read-only scope).

**RISK-SAFETY (16 questions):**

| Question ID | Topic | Safety Rationale |
|-------------|-------|------------------|
| AUTH-Q2 | Scoped permissions | Overly broad agent permissions create blast radius risk |
| AUTH-Q3 | Action-level authorization | Agent could delete when only read is intended |
| AUTH-Q4 | Identity propagation | Agent-on-behalf-of-user privilege escalation risk |
| AUTH-Q5 | Credential management | Hardcoded/unrotated credentials exposable via prompt injection |
| AUTH-Q6 | Audit logging | No audit trail for agent actions = undetectable harm |
| AUTH-Q7 | Identity suspension | Cannot revoke a compromised agent identity |
| STATE-Q1 | Compensation/rollback | Agent-initiated writes cannot be undone |
| STATE-Q3 | Concurrency controls | Race conditions from concurrent agent instances corrupt state |
| STATE-Q4 | Circuit breakers | Runaway agent loops cascade through dependencies |
| STATE-Q5 | Rate limiting | Agent traffic storms overwhelm services |
| STATE-Q6 | Blast radius limits | Agent error blast radius unbounded without transaction limits |
| DATA-Q1 | Sensitive data scoping | Agent-facing APIs leak sensitive fields (B1 read-only, or B2 access differentiation missing) |
| DATA-Q2 | Data residency | Agent moves data across compliance boundaries |
| DATA-Q6 | PII in logs | Agent actions leak PII into observable surfaces |
| HITL-Q1 | Draft/pending state | No draft state for reversible agent-proposed writes |
| HITL-Q2 | Approval gates | No human approval option for high-risk agent actions |

**RISK-QUALITY (17 questions):**

| Question ID | Topic | Quality Rationale |
|-------------|-------|-------------------|
| API-Q2 | Machine-readable spec | Agent tool generation requires manual work |
| API-Q3 | Structured errors | Agent cannot distinguish retriable vs terminal errors |
| API-Q6 | Async operation support | Long-running ops fail against agent timeouts |
| STATE-Q2 | Queryable current state | Agent cannot inspect state before action |
| STATE-Q7 | Degradation signaling | Agent reasons on stale/degraded data without awareness |
| DATA-Q3 | Pagination | Agent gets unbounded result sets |
| DATA-Q4 | Input validation | Agent sends malformed payloads without rejection |
| DATA-Q5 | Temporal metadata | Agent cannot reason about data freshness |
| DISC-Q1 | Schema versioning | Agent tool bindings break silently |
| OBS-Q1 | Tracing | Cannot debug agent-initiated requests |
| OBS-Q2 | Alerting | No alerts for agent anomalies |
| ENG-Q1 | Infra governance | No IaC = manual, error-prone changes |
| ENG-Q2 | CI/CD + contracts | Agent tool breakage not caught in pipeline |
| ENG-Q3 | Rollback | Cannot roll back agent-breaking deployments |
| ENG-Q4 | Test coverage | Insufficient test coverage for agent paths |
| ENG-Q5 | Encryption at rest | Data at rest unencrypted |
| HITL-Q3 | Sandbox/staging | No safe environment to test agent behavior |

Note: The 5 conditional BLOCKER questions (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2) resolve to different severities based on `agent_scope`. When the conditional resolves to RISK (read-only scope), their *base* severity is RISK-SAFETY — so STATE-Q1, AUTH-Q6, and DATA-Q2 appear in the RISK-SAFETY tier table above. When the conditional resolves to BLOCKER (write-enabled scope), they are counted as BLOCKERs, not RISK-SAFETY. The tier label applies only when the resolved severity is RISK. DATA-Q1 is additionally tiered: B1 resolves to BLOCKER (write-enabled) or RISK-SAFETY (read-only), B2 resolves to RISK-SAFETY when triggered, B3 resolves to INFO when triggered; the overall DATA-Q1 severity is the highest sub-check that fires. AUTH-Q7 is NOT a conditional BLOCKER — it is an unconditional RISK-SAFETY.

### Service Archetype Classification

Beyond `repo_type` (which determines N/A questions for non-application repos), this analysis classifies application repositories by **service archetype** — a characterization of runtime behavior that determines which extended questions are triggered.

| Archetype | Description | Detection Signals |
|-----------|-------------|-------------------|
| **stateless-utility** | Pure-function services with no persistent state, no user-specific data, and no write operations. | No database connections, no cache writes. All operations read-only and deterministic. Data is public or reference-grade. |
| **stateful-crud** | Services that own persistent state and expose CRUD operations on business entities. | Database connections. Create/Update/Delete endpoints. Entity lifecycle management. User-specific data. |
| **orchestrator** | Services that coordinate multi-service workflows by calling other services. | High fan-out (calls 3+ downstream services). Saga/workflow patterns. |
| **data-gateway** | Read-heavy data access layer — APIs over databases, search indexes, or data lakes. | Database queries dominate logic. Pagination, filtering, sorting. Read-heavy traffic. |
| **event-processor** | Services that consume events/messages and process them asynchronously. | Message queue consumers (SQS, Kafka, SNS). No synchronous API surface (or minimal). |

If the archetype cannot be determined with confidence, default to `stateful-crud` (the most conservative — triggers the most extended questions).

The output is a **four-artifact bundle** (per the Four-Artifact Output Contract below) containing:
- `{repo-name}-ara-report.md` — richest narrative
- `{repo-name}-ara-report.json` — canonical machine-readable contract
- `{repo-name}-ara-report.html` — single self-contained HTML visualization
- `{repo-name}-ara-report.metadata.json` — version compatibility sidecar

The MD report contains:
- Metadata header (repo name, date, repo_type, agent_scope)
- Readiness profile (Agent-Ready, Pilot-Ready, Pilot-Ready (Safety Concerns), Remediation Required, or Not Agent-Integrable)
- BLOCKER/RISK-SAFETY/RISK-QUALITY/INFO summary counts (excluding N/A questions)
- BLOCKERs section with remediation guidance
- RISKs section grouped by tier (RISK-SAFETY first, then RISK-QUALITY) with compensating control options
- INFOs section
- Detailed findings for all 43 questions (including N/A questions in N/A format)
- Evidence index with file references
- Prioritized remediation guidance per BLOCKER and RISK finding

Controls evaluated here may exist at the application layer, the platform layer (API Gateway, service mesh, IAM), or the agent architecture layer. ARA checks end-to-end presence — where a control is implemented is an architecture decision, not a scoring factor.

The readiness profile is determined by BLOCKER count and RISK-SAFETY count only. RISK-QUALITY has no effect on profile assignment:

| Readiness Profile | BLOCKERs | RISK-SAFETY | RISK-QUALITY | Recommendation |
|-------------------|----------|-------------|--------------|----------------|
| **Agent-Ready** | 0 | 0 | Any | Broad deployment |
| **Pilot-Ready** | 0 | 1–2 | Any | Narrow pilot |
| **Pilot-Ready (Safety Concerns)** | 0 | 3+ | Any | Supervised pilot, prioritize safety remediation |
| **Remediation Required** | 1–2 | Any | Any | Remediate BLOCKERs first |
| **Not Agent-Integrable** | 3+ | Any | Any | Deferred or descoped |

This analysis does NOT cover agent architecture (orchestration design, prompt engineering, model selection, RAG pipelines, MCP servers), agent-level AI governance (model policy, prompt-injection defense, safety evaluation), or general cloud modernization (managed compute, monolith decomposition, deployment strategies, DevOps maturity). Those concerns belong in the Modernization Readiness Analysis or agent-side governance reviews.

## Entry Criteria

- The repository is accessible and readable at the specified path
- The repository contains files relevant to analysis (source code, IaC, API specs, CI/CD configs, dependency manifests, container definitions, or configuration files)
- Write permissions exist to create the output artifact bundle (MD, JSON, HTML, and metadata.json)
- The analysis operates in **read-only mode** — it will not modify any source code or configuration in the repository
- Stay on the current branch — this is an analysis-only task. Do not create, switch, or checkout any git branches. Remain on whatever branch is currently checked out.

## Implementation Steps

### Step 0: Read additionalPlanContext

Before beginning the discovery scan, read the analysis context from `additionalPlanContext` to determine the repo classification, agent scope, and framing context that will shape the entire analysis.

#### 0.1 Read Analysis Context

Extract the following fields from `additionalPlanContext`:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `repo_type` | enum | No | `"application"` | Repository classification. One of: `application`, `infrastructure-only`, `deployment-config`, `monorepo`, `library`. Determines which questions are scored as N/A. |
| `agent_scope` | enum | No | `"read-only"` | The intended agent access level. One of: `read-only`, `write-enabled`. Determines severity of conditional BLOCKER (⚡) questions. |
| `service_archetype` | enum | No | auto-detected | Service archetype for severity calibration. One of: `stateless-utility`, `stateful-crud`, `orchestrator`, `data-gateway`, `event-processor`. If not provided, auto-detected in Step 1.6. Only applies when `repo_type` is `application`. |
| `context` | string | No | — | Free-text description of the repository (e.g., "Legacy PHP e-commerce app running on EC2 with MySQL"). Used to frame findings and recommendations throughout the report. |
| `priority` | enum | No | — | Repository priority within the portfolio. One of: `P0`, `P1`, `P2`. Recorded in report metadata. |
| `tags` | string[] | No | — | User-defined tags for categorization (e.g., `["monolith", "php", "payment-critical"]`). Recorded in report metadata. |

**Example `additionalPlanContext`:**

```yaml
additionalPlanContext: |
  repo_type: "application"
  agent_scope: "write-enabled"
  context: "Legacy PHP e-commerce app running on EC2 with MySQL"
  priority: "P0"
  tags: ["monolith", "php", "payment-critical"]
```

#### 0.2 Apply Defaults

If a field is absent from `additionalPlanContext`, apply these defaults:

- **`repo_type`** → `"application"` — This is the most comprehensive analysis (no questions skipped). Defaulting to `application` ensures nothing is missed when classification is unknown.
- **`agent_scope`** → `"read-only"` — This is the safer default. Conditional BLOCKER questions (⚡) are evaluated as INFO or RISK-SAFETY rather than BLOCKER, avoiding false escalation when the agent use case has not been scoped.
- **`service_archetype`** → Auto-detected in Step 1.6 based on repository analysis. If auto-detection is inconclusive, defaults to `"stateful-crud"` (the most conservative archetype — no severity downgrades beyond standard scope calibration). Only applies when `repo_type` is `application`.
- **`context`** → No default. If absent, findings and recommendations are written without additional framing.
- **`priority`** → No default. If absent, omitted from report metadata.
- **`tags`** → No default. If absent, omitted from report metadata.

If `repo_type` is present but not one of the 5 recognized values (`application`, `infrastructure-only`, `deployment-config`, `monorepo`, `library`), default to `"application"` and include a warning in the report metadata: **"Unrecognized repo_type '{value}', defaulting to application."**

#### 0.3 How Context Fields Are Used

Record the resolved values from Steps 0.1–0.2 in the analysis context. They will be used in subsequent steps as follows:

- **`repo_type`** → Used in the N/A Mapping (Step 1) to determine which questions are scored as N/A for the detected repo type. Included in the report metadata header.
- **`agent_scope`** → Used in Steps 2–9 (Evaluation) to determine the severity of conditional BLOCKER (⚡) questions: API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, and DATA-Q2. When `agent_scope` is `"write-enabled"`, these are evaluated as BLOCKERs. When `"read-only"`, they are evaluated as INFO or RISK-SAFETY. Also used to calibrate scope-sensitive RISK questions: HITL-Q1, HITL-Q2, STATE-Q3, and STATE-Q6 — these evaluate as RISK when `"write-enabled"` and downgrade to INFO when `"read-only"`. Included in the report metadata header.
- **`service_archetype`** → Used in Steps 2–9 (Evaluation) to calibrate severity for archetype-sensitive questions. When a question is calibrated to INFO for the detected archetype, it is recorded as INFO (not RISK) and does not count toward the RISK total. Calibration only downgrades severity — it never upgrades. Included in the report metadata header. Only applies when `repo_type` is `application`.
- **`context`** → Used throughout the report to frame findings and recommendations with repository-specific context.
- **`priority`** → Recorded in the report metadata header.
- **`tags`** → Recorded in the report metadata header.

### Step 1: Discovery — Static Scan

Scan the target repository to build a complete inventory of what exists before evaluating any questions. This discovery step feeds every subsequent evaluation step — questions reference specific file types and patterns identified here.

#### 1.1 Scan the Repository

Get the full directory tree and identify all file types present. For each category below, locate and read all relevant files:

**Infrastructure as Code (IaC):**
- Terraform files (`.tf`, `.tfvars`)
- CloudFormation templates (`template.yaml`, `template.json`, `*.cfn.yaml`, `*.cfn.json`)
- CDK stacks (CDK app entry points, `cdk.json`, construct files)
- Helm charts (`Chart.yaml`, `values.yaml`, templates directory)
- Kustomize (`kustomization.yaml`, overlays, bases)
- ACK and KRO resource definitions
- Ansible playbooks (`.yml`, `.yaml` in playbook directories)

**Source Code:**
- Application source files (`.py`, `.java`, `.js`, `.ts`, `.go`, `.cs`, `.rb`, `.php`, `.rs`, `.kt`, `.scala`)
- Entry points (`main()`, `server.listen()`, `if __name__ == "__main__"`, `@SpringBootApplication`, `func main()`)
- Package manifests (`package.json`, `requirements.txt`, `pom.xml`, `build.gradle`, `go.mod`, `*.csproj`, `Cargo.toml`, `Gemfile`)

**API Specifications:**
- OpenAPI / Swagger files (`openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json`)
- AsyncAPI specifications
- GraphQL schema files (`.graphql`, `.gql`)
- Smithy models (`.smithy`)

**CI/CD Configurations:**
- GitHub Actions (`.github/workflows/*.yml`)
- GitLab CI (`.gitlab-ci.yml`)
- Jenkins (`Jenkinsfile`)
- AWS CodeBuild (`buildspec.yml`)
- AWS CodePipeline definitions in IaC
- Other pipeline definitions

**Container Definitions:**
- Dockerfiles (`Dockerfile`, `Dockerfile.*`)
- Docker Compose (`docker-compose.yml`, `docker-compose.*.yml`)
- Container image references in IaC or Kubernetes manifests

**Dependency Manifests:**
- Node.js (`package.json`, `package-lock.json`, `yarn.lock`)
- Python (`requirements.txt`, `Pipfile`, `pyproject.toml`, `setup.py`, `setup.cfg`)
- Java (`pom.xml`, `build.gradle`, `build.gradle.kts`)
- Go (`go.mod`, `go.sum`)
- .NET (`*.csproj`, `*.sln`, `packages.config`)
- Rust (`Cargo.toml`, `Cargo.lock`)
- Ruby (`Gemfile`, `Gemfile.lock`)

**Configuration Files:**
- Application config (`*.yaml`, `*.yml`, `*.json`, `*.toml`, `*.properties`, `*.ini`)
- Environment files (`.env`, `.env.*`)
- Kubernetes manifests (`*.yaml` in k8s/, manifests/, or deploy/ directories)
- Service mesh configs (Istio)

#### 1.2 Directories to Ignore

Skip the following directories during scanning — they contain installed dependencies, build artifacts, or version control internals that are not relevant to the analysis:

- `node_modules/` — Installed Node.js dependencies
- `target/` — Java/Maven build output
- `build/` — General build output directories
- `.git/` — Git version control internals
- `dist/` — Distribution / compiled output
- `vendor/` — Vendored dependencies (Go, PHP, Ruby)
- `.terraform/` — Terraform provider cache
- `__pycache__/` — Python bytecode cache
- `.venv/`, `venv/`, `env/` — Python virtual environments
- `bin/` — Compiled binaries (when clearly build output)

#### 1.3 Build the File Inventory

After scanning, compile a structured inventory of what was found. This inventory is referenced throughout Steps 2–9 when evaluating individual questions. Record:

- **IaC files found** — List of Terraform, CloudFormation, CDK, Helm, Kustomize, and other IaC files with their paths. Used by: AUTH-Q1 (IAM/auth config), AUTH-Q5 (secrets in IaC), AUTH-Q6 (CloudTrail config), ENG-Q1 (IaC governance), ENG-Q5 (encryption at rest), STATE-Q5 (rate limiting in API Gateway), and others.
- **Source code files found** — List of application source files by language. Used by: API-Q1 (API endpoints in code), API-Q3 (error handling), API-Q4 (idempotency patterns), AUTH-Q2 (permission checks), STATE-Q3 (concurrency controls), STATE-Q4 (resilience patterns), and others.
- **API spec files found** — List of OpenAPI, AsyncAPI, GraphQL, and Smithy files. Used by: API-Q1 (documented interface), API-Q2 (machine-readable spec), DISC-Q1 (schema documentation).
- **CI/CD config files found** — List of pipeline definitions. Used by: ENG-Q2 (CI/CD with contract testing), ENG-Q3 (rollback capability), ENG-Q4 (API test coverage).
- **Container files found** — List of Dockerfiles and compose files. Used by: multiple infrastructure and deployment questions.
- **Dependency manifests found** — List of package manifests by ecosystem. Used by: identifying frameworks, libraries, and technology stack across multiple questions.
- **Configuration files found** — List of config files by type. Used by: AUTH-Q6 (hardcoded secrets), DATA-Q2 (data residency config), and others.
- **Notable absences** — Record what was NOT found. Absence is evidence: if no API spec files exist, that is a finding for API-Q2. If no IaC files exist, that is a finding for ENG-Q1. These absences are cited in evaluation steps.

#### 1.4 Read Discovered Files

Read all discovered files that are relevant to the analysis. Prioritize reading in this order:

1. **IaC files** — These reveal infrastructure architecture, security configuration, and deployment topology
2. **API specification files** — These reveal the integration surface agents will consume
3. **CI/CD configuration files** — These reveal deployment maturity and testing practices
4. **Dependency manifests** — These reveal technology stack, frameworks, and library choices
5. **Container definitions** — These reveal deployment packaging and runtime configuration
6. **Application source code** — These reveal implementation patterns, error handling, auth logic, and data access
7. **Configuration files** — These reveal runtime settings, environment configuration, and connection details

For large repositories, focus on files most relevant to the 43 evaluation questions. Not every source file needs to be read in full — prioritize entry points, API route definitions, authentication middleware, data access layers, and error handling patterns.

### Step 1.5: Target-System Surface Detection

Before evaluating any question, classify what agent-accessible surfaces this target system actually exposes. The severity of many ARA questions depends on whether the relevant surface exists at all — a build tool that never handles user data should not score BLOCKER for "no PII classification"; a library with no HTTP server should not score RISK-QUALITY for "no machine-readable API spec." This step records the surfaces so downstream evaluation can downgrade or N/A questions that do not apply.

Record each surface flag as `true`, `false`, or `unknown`. When `unknown`, the question evaluates normally (do not use `unknown` as a free pass — use it only when evidence is insufficient to decide).

#### Surface Flags

**`has_persistent_data_store`** — The system reads from or writes to a persistent data store that holds user or business data.

- `true` signals: database connections (SQL/NoSQL/ORM imports), DynamoDB/RDS/DocumentDB/Neptune/Timestream clients with CRUD operations, S3 buckets used for user content (not build artifacts), Redis with writes, Elasticsearch with indexing, stateful caches with user data
- `false` signals: library publishes no storage dependency, build tools only read source files, CLI/SDK wraps remote APIs without owning a data store, in-memory-only computations, reference/static data only (exchange rates, feature flags)
- Used by: DATA-Q1, DATA-Q2, DATA-Q5, DATA-Q6

**`has_http_rpc_surface`** — The system exposes an HTTP, gRPC, or GraphQL server that accepts inbound requests.

- `true` signals: Express/Koa/Fastify/Hapi routes, Flask/FastAPI/Django URL configs, Spring `@RestController`, Go `http.HandleFunc` / gin routes, gRPC service definitions, GraphQL resolvers bound to server, AppSync resolvers, Lambda event handlers for API Gateway/ALB
- `false` signals: library only exports functions, CLI-only tool, build-time processor, event consumer with no external surface, desktop/browser-only code
- Used by: API-Q1 through API-Q8, DISC-Q1

**`has_auth_surface`** — The system has authentication or authorization enforcement points (either issues identity, validates tokens, or enforces scoped access).

- `true` signals: login/logout/token endpoints, JWT/OAuth middleware, IAM role assumption code, Cognito/Okta integration, API Gateway authorizers, route-level auth decorators, permission checks before data access
- `false` signals: library delegates auth to caller, pass-through proxy, pure computation with no access control, utility that does not touch identity
- Used by: AUTH-Q1, AUTH-Q2, AUTH-Q3, AUTH-Q4, AUTH-Q6, AUTH-Q7

**`has_write_operations`** — The system exposes or performs write operations that mutate persistent state or trigger side effects.

- `true` signals: POST/PUT/PATCH/DELETE endpoints, state-mutating RPC methods, database writes behind the API surface, message publishing on state change, file system writes to user-owned paths
- `false` signals: read-only API, query-only GraphQL schema, library produces a value without side effects, formatter/parser with no persistence
- Used by: STATE-Q1, STATE-Q2, STATE-Q3, STATE-Q5, STATE-Q6

**`has_logging_of_user_data`** — The system logs request/response data, user identifiers, or business-entity content that could contain PII if upstream callers pass PII in.

- `true` signals: request-body logging middleware, access logs with user_id/email/customer fields, structured logs emitting entity payloads, error handlers printing full request context, telemetry that forwards user data
- `false` signals: library only emits internal diagnostic logs (no user fields), logs are build-time only, structured logging explicitly excludes user fields via allowlist
- Used by: DATA-Q6

#### Outputs

Record the five surface flags in the report metadata header alongside `repo_type` and `service_archetype`:

```
- **Surface flags**:
  - has_persistent_data_store: true | false | unknown
  - has_http_rpc_surface: true | false | unknown
  - has_auth_surface: true | false | unknown
  - has_write_operations: true | false | unknown
  - has_logging_of_user_data: true | false | unknown
```

These flags feed the N/A / INFO downgrade decisions in Steps 2–9. When a question's evaluation block states "if `has_X_surface` is `false`, record as INFO and skip," obey that instruction.

#### Archetype Override for Dev-Library-Applications

Some repositories classify as `application` (have source + entry point) but function as libraries, CLIs, build tools, or frontend scaffolds — examples: build orchestration tools, SDK mocks, CLI utilities, Angular/React admin templates, IaC framework plugins. For these, the N/A mapping of `application` (all 43 questions apply) produces false-positive findings because the repo does not hold data, does not expose an API, and does not execute agent-invoked operations.

When `service_archetype` is detected or declared as `stateless-utility` AND at least three of the five surface flags above are `false`, treat the repo as a **dev-library-application** for N/A and scoring purposes: apply the `library` N/A mapping from Step 1 (only ENG-Q1 through ENG-Q5 are non-N/A) as the baseline, then continue with the surface-flag downgrades for the questions that remain.

This override affects scoring only; it does not change the recorded `repo_type`. The original `repo_type` value is preserved in the report metadata, and the override with its rationale is recorded as an INFO note in the report preamble.

### Step 1.6: Service Archetype Detection

If `service_archetype` was provided in `additionalPlanContext`, use that value directly and skip auto-detection. Otherwise, analyze the file inventory from Step 1.3 and the file contents from Step 1.4 to classify the service archetype.

#### Auto-Detection Decision Tree

```
🔍 Analyze Repository
    │
    ▼
┌─────────────────────────────────┐
│ service_archetype in config?     │
│  YES → Use config value          │
│  NO  → Continue ▼                │
└─────────┬───────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│ Has message queue consumers?     │
│ (SQS, Kafka, SNS handlers,      │
│  event bridge rules, no/minimal  │
│  synchronous API surface)        │
│                                  │
│  YES → event-processor           │
│  NO  → Continue ▼                │
└─────────┬───────────────────────┘
          │
          ▼
┌──────────────────────────────────────┐
│ Orchestrates multi-service           │
│ workflows?                           │
│ (Calls 3+ downstream services        │
│  AND coordinates multi-step          │
│  sequences: saga patterns,           │
│  compensating actions, workflow      │
│  state machines, Step Functions,     │
│  or sequential service calls         │
│  with error/rollback handling)       │
│                                      │
│  YES → orchestrator                  │
│  NO  → Continue ▼                    │
└─────────┬────────────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│ Has persistent state?            │
│ (Database connections, Redis     │
│  writes, DynamoDB, SQL, ORM)     │
│                                  │
│  NO  → ▼ (stateless path)       │
│  YES → ▼ (stateful path)        │
└──┬──────────────┬───────────────┘
   │              │
   ▼              ▼
STATELESS       STATEFUL
   │              │
   ▼              ▼
┌──────────┐  ┌──────────────────┐
│ Has write │  │ Primarily read   │
│ endpoints │  │ queries with     │
│ or state  │  │ pagination/      │
│ mutations?│  │ filtering?       │
│           │  │ Minimal business │
│ NO →      │  │ logic?           │
│ stateless │  │                  │
│ -utility  │  │ YES →            │
│           │  │ data-gateway     │
│ YES →     │  │                  │
│ stateful  │  │ NO →             │
│ -crud     │  │ stateful-crud    │
└──────────┘  └──────────────────┘
```

#### Detection Signals by Archetype

**stateless-utility:**
- No database connections, no cache writes, no message queue producers
- All API operations are read-only (GET endpoints, query RPCs)
- Data comes from static files, environment variables, or in-memory computation
- No `user_id`, `session`, or user-specific context in request schemas
- Data is public or reference-grade (exchange rates, product catalogs, configuration)
- Examples: currency converter, feature flag service, configuration service, health check aggregator

**stateful-crud:**
- Database connections (SQL, NoSQL, Redis with writes, DynamoDB)
- Create/Update/Delete endpoints alongside Read
- Entity lifecycle management (status fields, soft deletes)
- User-specific data (user_id in requests, session management)
- Examples: cart service, user profile service, order service, inventory service

**orchestrator:**
- Calls 3+ downstream services (HTTP clients, gRPC stubs, service addresses in env vars)
- Sequential or parallel service call patterns
- Minimal or no persistent state of its own
- Transaction coordination (saga patterns, compensating actions)
- Examples: checkout service, order placement service, workflow coordinator

**data-gateway:**
- Database queries dominate the logic (SQL, Elasticsearch, DynamoDB scans)
- Pagination, filtering, sorting parameters in API
- Search endpoints
- Minimal business logic — primarily data transformation and serialization
- Read-heavy traffic pattern (>80% reads)
- Examples: product search service, reporting API, analytics query service

**event-processor:**
- Message queue consumers (SQS, Kafka, SNS, EventBridge)
- Event handler functions (Lambda triggers, message listeners)
- No synchronous API surface (or minimal — health checks only)
- Batch processing patterns
- May produce events for downstream consumers
- Examples: notification service, ETL pipeline, audit log processor, email sender

#### Archetype Recording

Record the detected archetype in the analysis context. Include it in the report metadata:

```markdown
**Service Archetype**: <archetype> (auto-detected | user-provided)
```

If auto-detection was used, include a brief justification:
```markdown
**Archetype Justification**: <1-2 sentence explanation of why this archetype was selected>
```

## N/A Mapping — Repository Type Question Applicability

Before evaluating any question, check the `repo_type` (resolved in Step 0) against the N/A mapping table below. Questions mapped as N/A for the detected repo type are **not evaluated** — they are recorded directly in the N/A display format and excluded from scoring.

### N/A Question Mappings by Repo Type

| Repo Type | Questions Scored as N/A |
|-----------|------------------------|
| `application` | None — all 43 questions apply |
| `infrastructure-only` | API-Q1 through API-Q8, AUTH-Q4, STATE-Q1 through STATE-Q7, HITL-Q1 through HITL-Q3, DATA-Q1 through DATA-Q7, DISC-Q1 through DISC-Q3 |
| `deployment-config` | All questions N/A **except** ENG-Q1 through ENG-Q5 and AUTH-Q1 through AUTH-Q3 |
| `library` | ENG-Q1 through ENG-Q5 |
| `monorepo` | None — all 43 questions apply (assessed per-service within the repo) |

**Rationale by repo type:**

- **`application`** — Full-stack repositories with source code, APIs, data access, and deployment infrastructure. All 43 questions are relevant because agents will interact with the application's APIs, data, auth, and operational surface. Severity is further calibrated by `service_archetype`.
- **`infrastructure-only`** — Repositories containing only IaC provisioning (Terraform modules, CDK stacks, CloudFormation templates) with no application source code. API, most application-level auth (identity propagation), state management, human-in-the-loop, data accessibility, and discoverability questions do not apply because there is no application runtime to evaluate. Auth questions AUTH-Q1 through AUTH-Q3 and AUTH-Q5 through AUTH-Q7 still apply (machine identity, scoped permissions, action-level auth, credential management, audit logging, agent suspension) because IaC defines IAM roles, policies, and security controls. OBS and ENG questions still apply because infrastructure repos define observability and deployment maturity.
- **`deployment-config`** — Repositories containing only CI/CD pipelines, Kubernetes manifests, Helm charts, GitOps configs, or Ansible playbooks — no application source code. Only engineering maturity (ENG-Q1 through ENG-Q5) and foundational auth (AUTH-Q1 through AUTH-Q3) apply.
- **`library`** — Package repositories with source code but no deployable entry point (no Dockerfile, no IaC, no main()). ENG-Q1 through ENG-Q5 are N/A because libraries have no deployment infrastructure, no CI/CD deployment pipeline, no rollback capability, and no encryption-at-rest configuration. All other questions apply because libraries expose APIs, handle auth, manage state, and process data that agents may consume through dependent applications.
- **`monorepo`** — Repositories containing multiple independent services. All 43 questions apply, assessed per-service within the repo. Each service directory is evaluated independently against the full question set.

### N/A Display Format

When a question is N/A for the detected `repo_type`, record it as:

| Field | Value |
|-------|-------|
| **Severity** | N/A |
| **Finding** | This is a `{repo_type}` repository. This question does not apply. |
| **Gap** | N/A |
| **Recommendation** | N/A |

Replace `{repo_type}` with the actual resolved repo type value (e.g., "This is a `infrastructure-only` repository. This question does not apply.").

### N/A Exclusion Rules

N/A questions are **excluded** from the following:

1. **BLOCKER count** — N/A questions do not count as BLOCKERs, even if the question's default severity is BLOCKER.
2. **RISK-SAFETY count** — N/A questions do not count as RISK-SAFETY.
3. **RISK-QUALITY count** — N/A questions do not count as RISK-QUALITY.
4. **INFO count** — N/A questions do not count as INFOs.
5. **Readiness profile determination** — Only non-N/A questions with BLOCKER or RISK-SAFETY severity are used to determine the readiness profile (Agent-Ready, Pilot-Ready, Pilot-Ready (Safety Concerns), Remediation Required, Not Agent-Integrable). N/A questions have no effect on the profile.

### N/A Inclusion Rule

All 43 questions **must appear** in the report output. N/A questions are listed in the detailed findings section using the N/A display format above — they are **not omitted** from the report. Extended questions that were not triggered are listed using the "Not Evaluated" display format:

```markdown
#### <question_id>: <question topic>
- **Severity**: Not Evaluated (extended)
- **Finding**: Extended question not triggered for this service. Archetype: `<archetype>`, agent_scope: `<scope>`.
- **Trigger**: <trigger condition from the extended questions table>
- **Gap**: Not evaluated
- **Recommendation**: Not evaluated
- **Evidence**: Not evaluated
```

This ensures the report is a complete record of all 43 questions regardless of repo type or archetype, and makes it clear which questions were evaluated, skipped (N/A), or not triggered (extended).

### How to Apply the N/A Mapping

For each evaluation step (Steps 2–9), before evaluating a question:

1. Check whether the question ID appears in the N/A mapping for the resolved `repo_type`.
2. If the question **is** in the N/A set: skip evaluation, record the question using the N/A display format, and move to the next question.
3. If the question **is not** in the N/A set: evaluate the question normally against the repository evidence.
4. If **all** questions in a section are N/A for the detected repo type, skip the section evaluation entirely but still list all questions from that section in the report using the N/A display format.


### Step 2: API Surface and Interface Design (8 questions)

Evaluate the application's API surface — the integration layer that agents will call. APIs are the minimum viable integration surface for agent tools. This section assesses whether the APIs are documented, machine-readable, well-structured, versioned, and operationally ready for autonomous consumption.

When MCP-native integration is the target, the findings here inform what an MCP server wrapping this system will need to expose.

Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If a question is N/A, record it in the N/A display format and skip evaluation.

---

#### API-Q1: Documented API Interface — BLOCKER

**Question:** Does the application expose a documented REST, GraphQL, or AsyncAPI interface, or does integration require direct database access, file-based exchange, or UI automation?

**Why it matters:** Agent tools must bind to stable, predictable interfaces. Direct database or file-based integration creates brittle, non-auditable coupling. UI automation (RPA) is fragile and unscalable. An API is the minimum viable integration surface.

**Look for:**
- REST endpoints in code (Express routes, Flask/FastAPI routes, Spring `@RestController`)
- GraphQL schema files
- AsyncAPI specs
- Direct database connection strings in client-facing code
- File-based data exchange patterns
- Selenium/Puppeteer/RPA scripts

---

#### API-Q2: Machine-Readable API Specification — RISK-QUALITY

**Question:** Is there an OpenAPI, AsyncAPI, GraphQL schema, or equivalent machine-readable specification available and kept current with the implementation?

**Why it matters:** Agent frameworks use machine-readable specs to generate tool definitions automatically. Without one, every integration requires manual tool authoring that drifts from actual behavior. Classified as RISK-QUALITY (not BLOCKER) because GraphQL schemas, Smithy models, and well-documented SDKs serve the same purpose — the real blocker is no machine-readable interface at all (API-Q1).

**Surface-flag calibration:** If `has_http_rpc_surface` is `false`, the system exposes no callable API surface — there is nothing for a machine-readable spec to describe. Record as INFO with the rationale `"No HTTP/RPC surface — machine-readable spec is not applicable."` If the repo was classified as `dev-library-application` via Step 1.5, record as INFO. For libraries, API contracts are expressed via package manifests and typed exports (TypeScript declarations, Python type hints, Go interfaces), which DISC-Q1 evaluates — not as OpenAPI specs.

**Look for:**
- OpenAPI/Swagger files (`openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json`)
- AsyncAPI specifications
- GraphQL schema files (`.graphql`, `.gql`)
- Smithy models (`.smithy`)
- Check: Is the spec auto-generated from annotations (preferred) or manually maintained? When was it last updated relative to the last API change?

---

#### API-Q3: Structured Error Responses — RISK-QUALITY

**Question:** Do API responses include structured error codes and machine-readable error bodies — not just HTTP status codes?

**Why it matters:** Agents need to distinguish retriable errors (timeout, rate limit) from terminal errors (invalid input, permission denied). A 500 with no body forces agents to guess.

**Surface-flag calibration:** If `has_http_rpc_surface` is `false`, there are no API responses to structure — record as INFO with the rationale `"No HTTP/RPC surface — structured error responses are not applicable."` If the repo was classified as `dev-library-application` via Step 1.5, record as INFO. Libraries communicate failure via typed exceptions, error-return conventions, or Result types — which DISC-Q1 evaluates.

**Look for:**
- Error response structures in code (error code, error message, retryable boolean or category)
- Consistent error response format across endpoints
- Minimum: error code, error message, and a retryable boolean or category

**Cross-reference — input validation:** Input validation and schema enforcement is evaluated as a dedicated question in DATA-Q4. When evaluating API-Q3, note whether validation *error responses* are structured (field name, constraint violated, accepted format) — that evidence feeds both API-Q3 (error structure quality) and DATA-Q4 (whether validation exists at all). See DATA-Q4 for the full evaluation criteria.

---

#### API-Q4: Idempotent Write Operations — BLOCKER ⚡ (Conditional)

**Question:** Are write API endpoints idempotent?

**⚡ Conditional BLOCKER:**
- **When `agent_scope` is `"write-enabled"`:** Evaluate as **BLOCKER**. Agents retry on failure. LLM non-determinism can cause duplicate tool calls. A non-idempotent write endpoint will duplicate orders, payments, or records on retry. Data integrity risk at machine speed.
- **When `agent_scope` is `"read-only"`:** Evaluate as **INFO**. Read-only agents do not execute write operations, so idempotency is informational only.

**Why it matters:** Agents retry on failure. LLM non-determinism can cause duplicate tool calls. A non-idempotent write endpoint will duplicate orders, payments, or records on retry. Data integrity risk at machine speed.

**Look for:**
- Idempotency key support in write endpoints
- Check: Does POST /orders with the same idempotency key create one record or two?
- Idempotency middleware or decorators
- Unique constraint enforcement on business keys

---

#### API-Q5: Structured Response Format — INFO

**Question:** What is the response format from service APIs? Structured JSON? XML? Binary?

**Why it matters:** LLMs consume text-based formats effectively. Complex XML or binary formats require extra parsing logic. Well-documented JSON APIs can be exposed as agent tools with minimal adaptation.

**Look for:**
- Response serialization in code
- Content-type headers
- Protobuf/Thrift definitions
- XML marshaling
- JSON serialization libraries

---

#### API-Q6: Asynchronous Operation Support — RISK-QUALITY

**Question:** Does the application support async patterns for long-running tasks (job submission, polling endpoint, or webhook callback)?

**Why it matters:** Agents operating synchronously against long-running operations will hit timeout limits and create orphaned processes. Async patterns are required for any operation exceeding 30 seconds.

**Look for:**
- Background job frameworks (Celery, Bull, SQS workers)
- Async/polling patterns
- Job status APIs
- Lambda async invocations
- Step Functions for long processes
- Webhook callback endpoints

---

#### API-Q7: Event Emission for State Changes — INFO

**Question:** Can the system emit events or webhooks for meaningful state changes that agents may need to react to — such as record updates, status transitions, or completion of long-running operations?

**Why it matters:** Request/response agents are reactive. Event-driven patterns unlock proactive agents that respond to real-world changes without polling. Classified as INFO because most agent deployments are request-driven; teams targeting event-reactive agents on time-sensitive use cases should treat this as a stronger signal when scoring.

**Look for:**
- Webhook endpoints
- SNS/EventBridge/SQS integration
- Kafka topics
- CDC pipelines

---

#### API-Q8: Rate Limit Documentation and Headers — INFO

**Question:** Are API rate limits documented, and does the application return rate limit headers (X-RateLimit-Remaining, Retry-After)?

**Why it matters:** Agents call endpoints at machine speed without rate limit awareness. Undocumented limits cause unpredictable failures. Rate limit headers allow agents to self-throttle.

**Look for:**
- API Gateway throttle settings
- WAF rate rules
- Rate limiting middleware
- `X-RateLimit-Remaining` headers in response code
- `aws_api_gateway_usage_plan` in IaC

---

### Step 3: Authentication, Authorization, and Identity (7 questions)

Evaluate the application's authentication, authorization, and identity controls — the security layer that determines who (or what) can call the system and what they can do. Agents cannot use human credentials, so the system must support machine identity, scoped permissions, and immutable audit trails.

Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If a question is N/A, record it in the N/A display format and skip evaluation.

---

#### AUTH-Q1: Machine Identity Authentication — BLOCKER

**Question:** Does the application support service account or machine identity authentication (client credentials OAuth 2.0, API key with principal attribution, or mTLS), and can the authenticated principal be attributed in audit logs?

**Why it matters:** Agents cannot use human credentials. The application must distinguish which agent made a call — a generic service account with no attribution is insufficient for audit and forensics. Because ARA is a design-time review, this question evaluates whether the machine-identity *mechanism* exists in code and configuration, not whether it is continuously effective at runtime — and because machine identity sits at the control layer, weak attribution here invalidates every downstream authorization decision (AUTH-Q2, AUTH-Q3, AUTH-Q6).

**Look for:**
- OAuth2 client credentials flow
- API key authentication with principal attribution
- mTLS configuration
- Service account definitions
- Cognito app clients
- Bedrock AgentCore Identity configurations
- API Gateway authorizers
- Check audit logs for agent identity fields

---

#### AUTH-Q2: Scoped Permissions (Least Privilege) — RISK-SAFETY

**Question:** Does the authorization model support scoped permissions — an agent identity can be granted read-only access to specific resources without inheriting broader privileges?

**Why it matters:** Agents under overly broad permissions create blast radius risk. Without scoped permissions, the system cannot scope down agent access per capability — every agent identity inherits the same broad surface. Least-privilege is critical, though enforcement can happen at the platform layer (API Gateway, IAM policies) if the app itself is coarse-grained.

**Look for:**
- IAM policies with specific actions per resource vs wildcards (`Action: "*"`, `Resource: "*"`)
- Role-per-service vs shared roles
- API Gateway resource policies
- Condition keys in IAM policies

**Evaluation threshold:** The system passes if it supports creating scoped permissions for a caller identity — i.e., the authorization model allows differentiating access levels (not all callers get the same permissions). It does NOT require that every policy in the repo is perfectly scoped. Evidence of wildcard policies on non-production or internal-only roles does not fail this question if production-facing roles demonstrate scope differentiation. Fail if ALL authorization is coarse-grained (single shared role, no mechanism to scope down).

---

#### AUTH-Q3: Action-Level Authorization — RISK-SAFETY

**Question:** Can the application enforce action-level authorization — allowing an agent to read records but not delete them, even within the same resource type?

**Why it matters:** Action-level authorization (ABAC or fine-grained RBAC) is required for agents executing multi-step workflows with mixed read/write operations.

**Look for:**
- ABAC policies
- Fine-grained RBAC definitions
- Permission matrices in code
- Action-level checks in middleware (`canRead`, `canWrite`, `canDelete`)
- API Gateway method-level authorization

---

#### AUTH-Q4: Identity Propagation and Delegation — RISK-SAFETY

**Question:** Does the system support identity propagation through service calls (JWT/OAuth token exchange, on-behalf-of flows), and can it distinguish between an agent acting under its own service identity vs. acting on behalf of a specific human user?

**Why it matters:** Without identity propagation, the system either trusts all internal calls equally or requires each service to re-authenticate — both are problematic. Additionally, an agent acting as itself should have tightly scoped permissions, while an agent acting on behalf of a user should be bounded by that user's permissions. Conflating the two is a common source of privilege escalation. The user is the subject (whose data and permissions apply); the agent is the actor (executing the operation). The system must distinguish both dimensions. This question serves ARA's dual purpose: portfolio telemetry (which systems can carry propagated identity) and use-case-level dependency checking (whether a specific on-behalf-of agent workflow is blocked).

When the target system serves multiple tenants, weak identity propagation compounds with data-layer risks — see DATA-Q2 (data residency) and DATA-Q6 (PII in logs). Treat these as a cluster when planning remediation.

**Archetype calibration:** For `stateless-utility` and `data-gateway` archetypes, downgrade to INFO — stateless services returning public/reference data are not affected by caller identity, and data gateways typically serve as read-only query layers where identity context has minimal security impact.

**Look for:**
- JWT parsing middleware
- OAuth2 on-behalf-of flows
- Token exchange patterns
- Cognito/Okta integration
- User context headers (`X-User-Id`, `Authorization Bearer`) passed through service calls
- Separate IAM roles or API keys for agent-as-self vs agent-on-behalf-of-user
- Different auth flows for service-to-service vs user-delegated calls
- Audit log fields distinguishing the two modes

---

#### AUTH-Q5: Credential Management — RISK-SAFETY

**Question:** Are credentials managed through a secrets management system (AWS Secrets Manager, HashiCorp Vault) with rotation, or are they embedded in code, environment variables, or configuration files?

**Why it matters:** Hardcoded credentials are a security vulnerability — a prompt injection attack or agent bug could leak them. Assess whether secret rotation breaks agent continuity.

**Look for:**
- `aws_secretsmanager_*` in IaC
- Vault client imports
- Hardcoded patterns (`password=`, `secret=`, `api_key=` in code)
- `.env` files committed to git
- Environment variables with credential values in docker-compose or task definitions

---

#### AUTH-Q6: Immutable Audit Logging — BLOCKER ⚡ (Conditional)

**Question:** Does the application log the authenticated principal for every write operation, and is that log immutable and tamper-evident?

**⚡ Conditional BLOCKER:**
- **When `agent_scope` is `"write-enabled"`:** Evaluate as **BLOCKER**. For regulated data contexts (EU AI Act, HIPAA, SOX), immutable audit trails are a compliance requirement. Write-enabled agents must have full audit attribution.
- **When `agent_scope` is `"read-only"`:** Evaluate as **RISK-SAFETY**. Audit logging is still important for read-only agents but is not a deployment blocker.

**Why it matters:** Audit trails must identify whether an action was taken by a human or an agent, and which specific agent instance. Without immutable logs, you cannot prove compliance or conduct forensics.

**Surface-flag calibration:** The conditional above determines severity only when the system has an agent-invocable surface. If the repo was classified as `dev-library-application` via Step 1.5, or if `has_auth_surface` is `false` AND `has_write_operations` is `false`, record as INFO with the rationale `"System does not execute agent-invoked write operations — audit logging is a consumer responsibility. The library/utility is called by applications that own the audit context."`

**Look for:**
- `aws_cloudtrail` in IaC
- CloudTrail log file validation enabled
- S3 bucket with object lock for logs
- CloudWatch log retention policies
- Immutable log storage configuration

---

#### AUTH-Q7: Agent Identity Suspension — RISK-SAFETY

**Question:** Can individual agent identities be suspended or revoked immediately if anomalous behavior is detected, without taking down the broader platform?

**Why it matters:** The ability to isolate a misbehaving agent without disrupting other agents or users is a fundamental operational requirement.

**Surface-flag calibration:** If the repo was classified as `dev-library-application` via Step 1.5, or if `has_auth_surface` is `false`, record as INFO with the rationale `"System does not issue or enforce agent identities — suspension is a consumer responsibility. Libraries and utilities are invoked by applications that own identity lifecycle."`

**Look for:**
- API key revocation endpoints
- IAM role deactivation procedures
- Service account disable mechanisms
- Cognito user pool user disable
- API Gateway API key deletion


### Step 4: State Management and Transactional Integrity (7 questions)

Evaluate the application's state management and transactional integrity — the controls that ensure data consistency, safe concurrent access, and resilience when agents execute multi-step workflows. Agents retry on failure, operate concurrently, and call endpoints at machine speed — the system must handle all of this safely.

Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If a question is N/A, record it in the N/A display format and skip evaluation.

---

#### STATE-Q1: Compensation and Rollback — BLOCKER ⚡ (Conditional)

**Question:** Does the application support compensation or rollback for multi-step operations that fail mid-sequence?

**⚡ Conditional BLOCKER:**
- **When `agent_scope` is `"write-enabled"`:** Evaluate as **BLOCKER**. Agents executing write-enabled multi-step workflows may succeed on steps 1–4 and fail on step 5. Without rollback or compensation logic, the application is left in a partial state.
- **When `agent_scope` is `"read-only"`:** Evaluate as **RISK-SAFETY**. Read-only agents do not execute write workflows, but compensation capability is still relevant for system maturity.

**Why it matters:** Agents executing a 5-step workflow may succeed on steps 1–4 and fail on step 5. Without rollback or compensation logic, the application is left in a partial state.

**Surface-flag calibration:** If `has_write_operations` is `false` AND `has_http_rpc_surface` is `false`, the system has no write path that would need compensation — record as INFO with the rationale `"System exposes no write operations — compensation logic is not applicable."` If the repo was classified as `dev-library-application` via Step 1.5, record as INFO. The conditional BLOCKER severity above applies only when the system actually has multi-step write workflows.

**Archetype calibration:** For `stateless-utility` archetype, record as INFO — stateless utilities have no multi-step write sequences.

**Look for:**
- Saga pattern
- Two-phase commit
- Explicit undo endpoints
- Compensating transactions
- Step Functions with error handling and rollback states

---

#### STATE-Q2: Queryable Current State — RISK-QUALITY

**Question:** Does the application expose its current state in a queryable form that an agent can inspect before taking action?

**Why it matters:** Agents need to read current state before deciding next steps. Write-only or event-only interfaces force agents to maintain external state, introducing synchronization risk.

**Look for:**
- GET endpoints for resource state
- Status query APIs
- Read-before-write patterns in code
- State machine status fields in database schemas

---

#### STATE-Q3: Concurrency Controls — RISK-SAFETY ⚡ (Scope-Calibrated)

**Question:** Does the application support optimistic locking or concurrency controls to prevent race conditions when multiple agent instances operate simultaneously?

**⚡ Scope-Calibrated:**
- **When `agent_scope` is `"write-enabled"`:** Evaluate as **RISK**. Multiple write-enabled agent instances may attempt concurrent writes. Without concurrency controls, data integrity is at risk.
- **When `agent_scope` is `"read-only"`:** Evaluate as **INFO**. Read-only agents do not perform writes, so concurrency controls for write operations are informational only — relevant for future scope expansion planning.

**Why it matters:** Multiple agent instances may attempt concurrent writes. Without concurrency controls (optimistic locking, ETags, version fields), data integrity is at risk.

**Look for:**
- Optimistic locking (version fields, ETags, `If-Match` headers)
- Pessimistic locking (`SELECT FOR UPDATE`)
- DynamoDB conditional writes
- Conflict resolution logic

---

#### STATE-Q4: Circuit Breakers and Resilience — RISK-SAFETY

**Question:** Does the target system implement circuit breakers, retry logic, and timeout configurations for its own external dependency calls?

**Why it matters:** When an agent calls the target system, that request may trigger cascading calls to the system's own dependencies. Circuit breakers prevent the target system from becoming a bottleneck that cascades failures back to the agent.

**Look for:**
- Resilience4j, Polly, retry decorators
- Exponential backoff
- `@CircuitBreaker` annotations
- Timeout configurations on HTTP clients

---

#### STATE-Q5: Rate Limiting and Throttling — RISK-SAFETY

**Question:** Are rate limits enforced at the API layer to prevent runaway agent loops from overwhelming the application?

**Why it matters:** A runaway agent loop can DDoS your own services at machine speed. Rate limiting prevents agent bugs from taking down production.

**Surface-flag calibration:** If `has_http_rpc_surface` is `false`, there is no API layer to enforce rate limits at — record as INFO with the rationale `"System exposes no HTTP/RPC surface — API-layer rate limiting is not applicable."` If the repo was classified as `dev-library-application` via Step 1.5, record as INFO. Libraries invoked by consuming applications inherit the consumer's rate limiting, not their own.

**Archetype calibration:** For `stateless-utility` archetype without a persistent API surface, record as INFO.

**Look for:**
- API Gateway throttling config
- WAF rate rules
- Application-level rate limiting middleware (`express-rate-limit`, `django-ratelimit`)
- `aws_api_gateway_usage_plan` in IaC

---

#### STATE-Q6: Blast Radius and Transaction Limits — RISK-SAFETY ⚡ (Scope-Calibrated)

**Question:** Can the system enforce configurable limits on agent-initiated actions — such as maximum records modified per run, maximum spend per hour, or maximum delete operations per session — independently of general rate limits?

**⚡ Scope-Calibrated:**
- **When `agent_scope` is `"write-enabled"`:** Evaluate as **RISK**. Write-enabled agents can execute correct-but-catastrophic logic at machine speed. Transaction limits define the maximum blast radius of an agent error.
- **When `agent_scope` is `"read-only"`:** Evaluate as **INFO**. Read-only agents cannot modify records, trigger spend, or delete data. Transaction limits for write operations are informational only — relevant for future scope expansion planning.

**Why it matters:** Rate limits (STATE-Q5) protect the system from traffic overload. Transaction limits protect the business from the consequences of an agent executing correct-but-catastrophic logic — deleting 10,000 records instead of 100, or issuing $50,000 in refunds in a loop. These limits define the maximum blast radius of an agent error.

**Look for:**
- Configurable transaction limits per agent identity
- Examples: `max_refunds_per_hour=50`, `max_records_per_bulk_operation=500`, `max_spend_per_session=$1000`
- Configurable per agent identity, not just per API endpoint

**Evaluation threshold:** This question evaluates whether the system can limit the *business impact* of agent operations beyond API-layer rate limiting (STATE-Q5). Pass if ANY of the following exist: (a) configurable per-caller business transaction limits, (b) bulk operation size caps (e.g., batch delete limited to N records), (c) spend/cost thresholds per session or caller identity. These need not be agent-specific — general per-caller business limits satisfy this question. Fail if the only protection is API-level throttling (requests/second) with no business-domain caps on operation scope.

---

#### STATE-Q7: Graceful Degradation Signaling — RISK-QUALITY

**Question:** Does the system signal degraded mode to callers via machine-readable indicators — so an agent can detect when it is receiving stale, partial, or fallback responses rather than authoritative data?

**Why it matters:** Agents making autonomous decisions on degraded data produce incorrect outcomes at machine speed. If the system fails over to a stale cache, returns partial results from a degraded dependency, or operates in read-only mode, agents need a machine-readable signal to adjust behavior (e.g., defer decisions, request human review, retry later). Without this, agents treat degraded responses as authoritative.

**Look for:**
- Health endpoints returning granular states (healthy / degraded / read-only / partial)
- `X-Degraded: true` or `X-Data-Freshness: stale` response headers
- `Retry-After` headers on 503 responses
- Circuit breaker configs with fallback responses that include degradation metadata
- `Cache-Control` headers with `stale-while-revalidate` or `must-revalidate`
- Response envelope fields like `{ "data_status": "cached", "cached_at": "..." }`
- Feature flag states exposed in response metadata


### Step 5: Human-in-the-Loop and Approval Workflows (3 questions)

Evaluate whether the application supports human oversight for high-stakes agent operations. Agents should not commit irreversible actions autonomously for high-risk operations — draft states, approval gates, and sandbox environments provide defense in depth.

ARA measures whether a target system can *support* human-in-the-loop patterns, not whether HITL is mandatory. HITL is a valuable safety mechanism for high-stakes operations and a confidence-building step during initial agent deployments.

Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If a question is N/A, record it in the N/A display format and skip evaluation.

---

#### HITL-Q1: Draft/Pending State — RISK-SAFETY ⚡ (Scope-Calibrated)

**Question:** Does the application have the concept of a pending or draft state that an agent can write to before a human approves and commits?

**⚡ Scope-Calibrated:**
- **When `agent_scope` is `"write-enabled"`:** Evaluate as **RISK**. Write-enabled agents should not commit irreversible actions autonomously for high-stakes operations. Draft states let agents propose and humans confirm.
- **When `agent_scope` is `"read-only"`:** Evaluate as **INFO**. Read-only agents do not make state changes, so draft/pending states are informational only — relevant for future scope expansion planning.

**Why it matters:** Agents should not commit irreversible actions autonomously for high-stakes operations. Draft states let agents propose and humans confirm. ARA measures whether the target system can *support* human-in-the-loop patterns, not whether HITL is mandatory — HITL is a valuable safety mechanism for high-stakes operations and a confidence-building step during initial agent deployments.

**Look for:**
- Draft/pending status fields in database schemas
- Approval workflow endpoints
- Two-step commit patterns (create-then-confirm)
- Status-based state machines

**Evaluation threshold:** Pass if the system has ANY mechanism where a state change can be proposed without being immediately committed — allowing a human (or supervisory process) to review before finalization. This includes: status enums with PENDING/DRAFT/PROPOSED states, two-step APIs (create-then-confirm), or explicit approval workflow endpoints. Pre-existing business workflow states count IF they can be repurposed for agent-initiated proposals (e.g., an order with status=PENDING_REVIEW). Fail only if all write operations are immediately committed with no reviewable intermediate state.

---

#### HITL-Q2: Configurable Approval Gates — RISK-SAFETY ⚡ (Scope-Calibrated)

**Question:** Can specific operations be configured to require a human approval step before the application executes them — configurable by operation type?

**⚡ Scope-Calibrated:**
- **When `agent_scope` is `"write-enabled"`:** Evaluate as **RISK**. Write-enabled agents executing high-risk operations benefit from human-in-the-loop approval at the application layer as defense in depth.
- **When `agent_scope` is `"read-only"`:** Evaluate as **INFO**. Read-only agents do not execute write operations, so approval gates are informational only — relevant for future scope expansion planning.

**Why it matters:** High-risk actions benefit from human-in-the-loop approval at the application layer as defense in depth, even when orchestration-layer gates exist.

**Look for:**
- Approval API endpoints
- Status-based workflows requiring explicit confirmation
- Configurable operation-level flags
- Step Functions with human approval tasks (`waitForTaskToken`)

---

#### HITL-Q3: Sandbox/Staging Environment — RISK-QUALITY

**Question:** Is there a sandbox or staging environment with production-equivalent data shape that agents can use for testing without risk to live systems?

**Why it matters:** Agents must be testable against realistic conditions before production promotion. Without a staging environment, the first time you discover an agent bug is in production.

**Surface-flag calibration:** If the repo was classified as `dev-library-application` via Step 1.5, or if `has_http_rpc_surface` is `false` AND `has_persistent_data_store` is `false`, record as INFO. Libraries, CLIs, and scaffolds do not own staging environments — their consumers do. Requiring a library to maintain its own staging is a category error.

**Look for:**
- Separate environment configurations (staging, sandbox)
- Docker-compose for local testing
- Seed data scripts
- Synthetic data generators
- Environment-specific IaC


### Step 6: Data Accessibility and Quality (7 questions)

Evaluate the data layer that agents will access — classification, residency, query capabilities, quality, and privacy controls. Agents process data at machine speed, so unclassified sensitive data, unbounded queries, and PII leakage into logs create regulatory and operational risk at scale.

Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If a question is N/A, record it in the N/A display format and skip evaluation.

---

#### DATA-Q1: Sensitive Data Classification — BLOCKER ⚡ (Conditional, Tiered)

**Question:** Does this system store, process, or transmit sensitive data (PII, PHI, financial records, credentials), and if so, are agent-facing API responses scoped to exclude sensitive fields that the agent has no business retrieving?

**Why it matters:** Unscoped data access is a regulatory and reputational risk. The critical question is not whether a formal classification schema exists (most applications do not have one), but whether agent-facing APIs actually filter out sensitive fields. An agent calling `GET /users` should not receive password hashes, and an agent reading order history should not receive full credit card numbers. Access control differentiation (different scopes for sensitive vs non-sensitive) provides the second layer. Formal classification metadata is aspirational but not a deployment gate — most real-world applications (including well-engineered ones) lack field-level classification schemas yet still protect data correctly through API-level filtering.

**Two-stage evaluation:**

**Stage A — Scope gate: does this system handle sensitive data?**

Answer Yes if any of the following is true:
- `has_persistent_data_store` is `true` AND the stored data includes user-specific fields (user_id, email, phone, address, account details), health or medical records, financial instruments (cards, accounts, balances, transactions), or credentials (passwords, tokens, API keys persisted beyond their request lifecycle)
- `has_logging_of_user_data` is `true` AND logs capture request/response bodies that may contain user-submitted PII
- The system's stated purpose involves regulated data domains (healthcare/FHIR, payments/PCI, identity/IAM, telecom CPNI, finance)

Answer No if the system is clearly not a data-handling target. Representative No cases:
- Build tools and compilers (webpack, gulp, rollup) that read source files but never hold user data
- CLI utilities that invoke remote services without persisting user input (aws-cli wrappers, deployment tools)
- Pure computation libraries (date/time, math, formatting) with no persistence
- SDK mocks and test doubles
- Frontend scaffolds and starter templates with no backend
- Progress bars and instrumentation libraries that transmit only user-provided label strings

**If Stage A = No:** Record the question as INFO with the rationale `"Not a data-handling target — no PII/PHI/financial/credential data is stored, processed, or logged."` Skip Stage B entirely. Do not flag absence of classification controls as a finding — this is expected for non-data-handling systems.

**If Stage A = Yes:** Proceed to Stage B.

**Archetype calibration:** For `stateless-utility` archetype (regardless of Stage A result): record as INFO. Stateless utilities operate on transient or public/reference data by definition; if they appear to handle sensitive data, the archetype classification should be revisited — recommend reclassifying before flagging DATA-Q1.

**Dev-library-application override:** If the repo was classified as `dev-library-application` via the Step 1.5 override, skip directly to INFO without evaluating Stage A or Stage B. Libraries, CLIs, and scaffolds do not own the data that consuming applications store.

**Stage B — Tiered evaluation (only if Stage A = Yes):**

Evaluate three layers of data protection for agent-facing access. Each layer has independent severity; the overall DATA-Q1 severity is the highest severity that fires.

**B1: Agent-facing API response scoping — BLOCKER (conditional on `agent_scope`)**

Does the application exclude sensitive fields from API responses that an agent would consume? Look for:
- Password/secret fields excluded from serialization (e.g., `@JsonIgnore`, `exclude_fields`, `hidden` attributes, `write_only=True` in serializers)
- Different response DTOs for internal vs external/agent consumers
- GraphQL field-level authorization or field filtering
- Explicit `select` projections in API handlers that omit sensitive columns
- Sensitive data returned ONLY via dedicated, separately-authorized endpoints (not mixed into general-purpose list/detail responses)

Severity logic for B1:
- If `agent_scope` is `write-enabled` AND sensitive fields are returned in general API responses → **BLOCKER**
- If `agent_scope` is `read-only` AND sensitive fields are returned in general API responses → **RISK-SAFETY**
- If sensitive fields are properly excluded from API responses OR only accessible via separately-scoped endpoints → B1 contributes no finding (CLEAR)

**B2: Access control differentiation — RISK-SAFETY**

Do access controls distinguish between sensitive and non-sensitive data access? Look for:
- OAuth scopes that separate data domains (e.g., `read:profile` vs `read:payment`)
- Role-based access with granularity below "full admin vs no access"
- API key permissions that limit which endpoints/fields are accessible
- Row-level or column-level security in the database access layer

Severity logic for B2:
- If no differentiation exists (a single permission grants access to everything sensitive) → **RISK-SAFETY**
- If differentiation exists → B2 contributes no finding (CLEAR)

**B3: Formal classification metadata — INFO**

Does the system have explicit, machine-readable data classification? Look for:
- Data classification tags in IaC (S3 bucket tags, DynamoDB table tags with sensitivity labels)
- Field-level sensitivity annotations in code (decorators, attributes)
- PII detection tooling integrated (Macie, Presidio)
- Data catalog entries with classification levels
- Documented classification policies

Severity logic for B3:
- If absent → **INFO** (aspirational, not a deployment gate)
- If present → Acknowledge as mature practice; contributes no finding

**Overall DATA-Q1 severity:**
- If B1 fires as BLOCKER → DATA-Q1 = BLOCKER
- Else if B1 fires as RISK-SAFETY or B2 fires → DATA-Q1 = RISK-SAFETY
- Else if only B3 is absent → DATA-Q1 = INFO
- If all three are clear → DATA-Q1 = no finding

**Look for (Stage B):**
- B1 indicators: `@JsonIgnore`, `serialize: false`, `hidden_fields`, `write_only=True`, password exclusion in serializers, separate DTOs for API responses, field-level `@Authorize` in GraphQL, explicit column `select()` in query builders
- B2 indicators: OAuth scope definitions with data-domain granularity, RBAC with more than two roles, API key permission matrices, row-level security policies
- B3 indicators: Classification tags in IaC, field decorators (`@PII`, `@Sensitive`, `@Classified`), Macie/Presidio integration, data catalog references

---

#### DATA-Q2: Data Residency and Sovereignty — BLOCKER ⚡ (Conditional)

**Question:** Is the data subject to residency or sovereignty requirements that would restrict an agent from transmitting it to an LLM provider in a different region or jurisdiction?

**⚡ Conditional BLOCKER:**
- **When `agent_scope` is `"write-enabled"`:** Evaluate as **BLOCKER**. For regulated data (GDPR, LGPD, HIPAA, sector-specific), an agent sending regulated data to an LLM endpoint in another region may create a legal violation.
- **When `agent_scope` is `"read-only"`:** Evaluate as **RISK-SAFETY**. Data residency is still relevant for read-only agents but the risk profile is lower when no data modification occurs.

**Why it matters:** An agent sending regulated data to an LLM endpoint in another region may create a legal violation. The data residency constraints are properties of the data the system holds.

**Surface-flag calibration:** If `has_persistent_data_store` is `false` AND `has_logging_of_user_data` is `false`, the system holds no data subject to residency constraints — record as INFO with the rationale `"No persistent data store and no user-data logging — residency requirements do not apply."` If the repo was classified as `dev-library-application` via Step 1.5, record as INFO. The conditional BLOCKER severity above applies only when at least one of those surface flags is `true`.

**Archetype calibration:** For `stateless-utility` archetype, record as INFO — stateless utilities handle transient or public/reference data by archetype definition.

**Look for:**
- Data residency requirements in documentation
- GDPR/LGPD compliance references
- Region-specific data storage configurations
- Cross-region replication settings
- Data sovereignty policies

---

#### DATA-Q3: Selective Query Support — RISK-QUALITY

**Question:** Can data be queried with filters, pagination, and sorting that limit result set size to what an agent actually needs?

**Why it matters:** Agents retrieving unbounded result sets exhaust LLM context windows and increase cost.

**Look for:**
- Pagination parameters in API endpoints (`limit`, `offset`, `cursor`)
- Filter query parameters
- Sorting options
- GraphQL field selection
- Result size limits in API documentation

---

#### DATA-Q4: Input Validation and Schema Enforcement — RISK-QUALITY

**Question:** Does the system validate and reject malformed inputs at the API boundary with structured error responses that identify which field failed and why?

**Why it matters:** LLMs constructing API calls produce malformed payloads — partial JSON, special characters, oversized strings, out-of-range values, or injection-like fragments. Target systems that accept garbage inputs silently corrupt state. Systems that crash on unexpected input create cascading failures. Systems that return generic 400 errors without field-level detail force agents into blind retry loops. The target system must validate inputs and return structured rejection signals that enable agents to self-correct.

**Look for:**
- Request validation libraries (joi, zod, yup, pydantic, javax.validation, class-validator, marshmallow)
- OpenAPI request body schema validation middleware
- API Gateway request validators
- Parameterized queries (protection against injection)
- Input sanitization middleware
- Request size limits (`max_body_size`, payload limits)
- Type-safe request parsing (TypeScript interfaces, Rust serde, Go struct tags)
- Structured validation error responses with field-level detail (e.g., `{ "errors": [{ "field": "email", "constraint": "format", "message": "..." }] }`)

**Evaluation threshold:** Pass if the system has ANY systematic input validation at the API boundary — either framework-level (validation annotations, middleware) or explicit (manual checks with structured error responses). Presence of parameterized queries alone is insufficient (that prevents injection but doesn't validate business rules). Fail if endpoints accept arbitrary input shapes without validation, or if validation errors return unstructured 400/500 responses with no field identification.

---

#### DATA-Q5: Temporal Metadata and Freshness — RISK-QUALITY

**Question:** Does the data include reliable timestamps (creation, last update, source event time) with timezone normalization, and can the system signal whether data returned to an agent is current, stale, cached, or eventually consistent?

**Why it matters:** Agents performing time-sensitive reasoning depend on accurate temporal data. Missing timestamps cause silent errors. If the system cannot signal that data is cached or eventually consistent, the agent has no way to know whether it is reasoning on the current state. Both concerns — temporal accuracy and freshness signaling — serve the same purpose: ensuring agents reason on trustworthy temporal data.

**Archetype calibration:** For `stateless-utility` archetypes, downgrade to INFO — stateless services with static/reference data have fixed temporal characteristics that don't change at runtime.

**Look for:**
- `created_at`, `updated_at`, `event_time` fields in database schemas
- Timezone handling (UTC storage)
- Timestamp format consistency
- `Cache-Control` headers
- `X-Data-Age` or `last_refreshed` headers
- `consistency_level` field (strong / eventual / cached)
- NTP synchronization configuration

---

#### DATA-Q6: PII Redaction in Logs — RISK-SAFETY

**Question:** Is PII redacted from logs, error messages, and observability data?

**Why it matters:** Agents process customer PII. If PII leaks into logs or LLM prompt/response pairs, it becomes a compliance violation.

**Surface-flag calibration:** If `has_logging_of_user_data` is `false` AND `has_persistent_data_store` is `false`, the system has no pipeline where user PII could enter logs — record as INFO with the rationale `"System does not log user data and holds no user data — PII-in-logs risk is not applicable."` If the repo was classified as `dev-library-application` via Step 1.5, record as INFO. Libraries and utilities whose only logging is internal diagnostic output (no user-submitted content) fall in the INFO bucket.

**Archetype calibration:** For `stateless-utility` archetype, record as INFO — stateless utilities do not handle user PII.

**Look for:**
- Log scrubbing middleware
- PII masking libraries
- CloudWatch log filters
- Amazon Macie integration
- Regex patterns for PII in logging utilities

---

#### DATA-Q7: Data Quality Awareness — INFO

**Question:** Is there a known data quality score or completeness metric for this dataset?

**Why it matters:** Agents acting on incomplete or stale data propagate errors faster than human workflows. Planning input, not a deployment blocker.

**Look for:**
- Data quality dashboards
- Data profiling reports
- Null rate monitoring
- Duplicate detection logic
- Data freshness SLAs
- Data quality metrics in observability


### Step 7: Discoverability and Semantic Readiness (3 questions)

Evaluate whether the system's data and APIs are discoverable and semantically meaningful — can an agent (or the team building agent tools) understand what data exists, what it means, and where it came from? This section accelerates tool definition and improves agent reasoning quality.

Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If a question is N/A, record it in the N/A display format and skip evaluation.

---

#### DISC-Q1: Schema Versioning and API Contracts — RISK-QUALITY

**Question:** Are data schemas and API contracts documented, versioned, and accessible — with breaking change detection in CI?

**Why it matters:** Agents need to understand data structures, and agent tool schemas break silently when APIs change without notice. Schema changes without versioning break agent queries silently. Every breaking change requires updating tool definitions and revalidating agent behavior. This question covers both schema documentation (the discoverability concern) and API versioning (the stability concern) because they serve the same purpose: ensuring agents can reliably bind to and consume the system's interfaces.

**Look for:**
- JSON Schema files, Avro/Protobuf schemas
- Database migration files
- Schema registry
- OpenAPI schema definitions
- `/v1/`, `/v2/` URL patterns or versioned proto packages
- `Accept-Version` headers
- Changelog files, deprecation notices
- Breaking change detection tools (`buf breaking`, OpenAPI diff)
- Consumer-driven contract tests (Pact)

---

#### DISC-Q2: Semantically Meaningful Field Names — INFO

**Question:** Are field names and identifiers human-readable and semantically meaningful, or are they legacy codes requiring a data dictionary?

**Why it matters:** Agents using LLM-based reasoning need interpretable field names. `CUST_TYP_CD` requires a lookup. `CustomerTypeCode` does not.

**Look for:**
- Field naming conventions in database schemas and API responses
- Legacy abbreviations (`CUST_TYP_CD` vs `CustomerTypeCode`)
- Data dictionary files
- Naming convention documentation

---

#### DISC-Q3: Data Catalog / Metadata Layer — INFO

**Question:** Is there a data catalog or metadata layer describing what data the target system holds and what it means semantically?

**Why it matters:** Accelerates tool definition when building agent tools against this system.

**Look for:**
- AWS Glue Data Catalog
- Collibra, Alation, DataHub
- Metadata files
- Data dictionaries
- Schema documentation
- API catalogs

---

### Step 8: Observability of Target Systems (3 questions)

Evaluate the observability of the target systems that agents will call — distributed tracing, alerting, and business outcome metrics. When an agent-initiated request fails, the target system's observability determines whether you can diagnose the problem or are flying blind.

Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If a question is N/A, record it in the N/A display format and skip evaluation.

---

#### OBS-Q1: Distributed Tracing and Structured Logging — RISK-QUALITY

**Question:** Does the application support distributed tracing (X-Ray, OpenTelemetry) with trace ID propagation, and are logs structured (JSON) with correlation IDs linking all entries for a single request?

**Why it matters:** These two controls serve the same diagnostic purpose — reconstructing what happened inside the target system when an agent-initiated request fails. Both must be present to make agent-initiated failures debuggable.

**Surface-flag calibration:** If the repo was classified as `dev-library-application` via Step 1.5, or if `has_http_rpc_surface` is `false` AND there is no agent-initiated request path to trace, record as INFO with the rationale `"Library/utility — tracing and correlation are consumer concerns. The library's obligation is to propagate trace context if provided, which DISC-Q1 evaluates."` Libraries that ship OpenTelemetry hooks or accept a logger instance satisfy the instrumentation concern without owning the trace pipeline.

**Look for:**
- OpenTelemetry SDK
- X-Ray instrumentation
- `traceparent` header propagation
- JSON logs
- `request_id` or `correlation_id` field

---

#### OBS-Q2: Alerting on Error Rates and Latency — RISK-QUALITY

**Question:** Are there alerting thresholds configured for error rates and latency on the APIs agents will consume?

**Why it matters:** Target system degradation is felt immediately by agents. Alerting lets you detect problems before agents start cascading failures.

**Surface-flag calibration:** If the repo was classified as `dev-library-application` via Step 1.5, or if `has_http_rpc_surface` is `false`, record as INFO with the rationale `"Library/utility — alerting on error rates and latency is a consumer concern. Libraries expose error and timing signals via return values, exceptions, or structured metrics; consumers decide the alert thresholds."`

**Look for:**
- CloudWatch alarms on error rates and latency
- Anomaly detection configuration
- PagerDuty/OpsGenie integration
- Composite alarms
- SLO-based alerting

---

#### OBS-Q3: Business Outcome Metrics — INFO

**Question:** Are custom metrics published for business outcomes, not just infrastructure metrics?

**Why it matters:** When agents consume the system, business metrics become the primary signal for whether agent interactions produce good outcomes.

**Look for:**
- `cloudwatch.put_metric_data` for business events
- Custom dashboards tracking resolution rates, conversion, satisfaction
- Business KPI alarms


### Step 9: Engineering and Deployment Maturity (5 questions)

Evaluate the engineering and deployment maturity of the target system — infrastructure governance, CI/CD with contract testing, rollback capability, test coverage, encryption, and network policies. These controls determine whether the system can be safely and reliably operated as an agent integration surface.

Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If a question is N/A, record it in the N/A display format and skip evaluation.

---

#### ENG-Q1: Infrastructure Governance for Agent-Facing Surface — RISK-QUALITY

**Question:** Is the infrastructure exposing the target system to agents — API gateways, IAM roles, secrets, network configurations — defined as code, subject to peer review before changes, and monitored for drift?

**Why it matters:** The integration surface is a high-value attack surface. All three controls — IaC definition, change review, and drift detection — must be present together for this surface to be trustworthy.

**Surface-flag calibration:** If the repo was classified as `dev-library-application` via Step 1.5, or if `has_http_rpc_surface` is `false` AND `has_auth_surface` is `false`, record as INFO. Libraries, CLIs, and formatters do not own the IaC for API gateways, IAM roles, or networking — their consumers do. The library's engineering governance is its own build/release pipeline, which ENG-Q2/Q3 cover.

**Look for:**
- Sub-checks: (1) Integration surface defined as IaC? (2) Changes subject to automated plan review + peer review? (3) Drift detection active?
- Terraform, CloudFormation, or CDK definitions for API Gateway, IAM, secrets, networking
- PR/CR review requirements on IaC changes
- AWS Config rules or drift detection configuration

---

#### ENG-Q2: CI/CD with API Contract Testing — RISK-QUALITY

**Question:** Does the target system have a CI/CD pipeline that includes automated testing of agent-facing APIs and the ability to detect API-breaking changes before production?

**Why it matters:** The agentic concern is not "does CI/CD exist" but "can API contract changes be caught before agents are affected."

**Surface-flag calibration:** If `has_http_rpc_surface` is `false`, there are no APIs to contract-test — record as INFO with the rationale `"No HTTP/RPC surface — API contract testing is not applicable. Library contract stability is evaluated by DISC-Q1 (schema/typed-export versioning)."` If the repo was classified as `dev-library-application` via Step 1.5, record as INFO — library build pipelines validate package contracts (semver, typed exports), not API contracts.

**Look for:**
- API contract tests in CI pipeline
- Consumer-driven contract testing (Pact)
- OpenAPI spec validation in build
- Schema comparison tools
- Breaking change detection

---

#### ENG-Q3: Rollback Capability — RISK-QUALITY

**Question:** Can the target system's deployment be rolled back to the previous known-good state if a change breaks agent-facing APIs? (Target: within 15–30 minutes.)

**Why it matters:** A broken API that agents depend on leaves agents unable to function. The intent — fast, reliable rollback — matters more than the exact time threshold. Organizations with canary + circuit breaker patterns achieve safe recovery.

**Surface-flag calibration:** If `has_http_rpc_surface` is `false`, there is no deployed surface to roll back — record as INFO with the rationale `"No deployed HTTP/RPC surface — deployment rollback is a consumer concern. Library rollback is handled via package version pinning by consumers."` If the repo was classified as `dev-library-application` via Step 1.5, record as INFO.

**Look for:**
- Blue/green deployment config
- CodeDeploy rollback triggers
- Helm rollback
- Feature flags
- Canary deployment with automatic rollback
- Traffic shifting at API Gateway or ALB

---

#### ENG-Q4: API Test Coverage — RISK-QUALITY

**Question:** Are there automated tests for the APIs agents will consume — validating input handling, output format, error responses, and edge cases — running in CI?

**Why it matters:** APIs are the contract between agent and target system. If behavior changes without test coverage catching it, agents reason incorrectly.

**Look for:**
- API test suites (Postman/Newman collections, pytest API tests, REST Assured)
- Contract tests
- Integration test directories
- API test steps in CI pipeline configuration

---

#### ENG-Q5: Encryption at Rest for Agent-Accessible Data — RISK-QUALITY

**Question:** Is data encrypted at rest (KMS) for sensitive information that agents will access?

**Why it matters:** Agents access data stores containing PII and business-sensitive information. Unencrypted data at rest means a breach exposes everything the agent can access.

**Look for:**
- `kms_key_id` on S3/RDS/DynamoDB/EBS
- Customer-managed KMS keys
- Encryption config in IaC

---

## Report Template

After evaluating all 43 questions across Steps 2–9, compile the findings into the **four-artifact bundle** defined in the Four-Artifact Output Contract below: `{repo-name}-ara-report.md` (narrative), `{repo-name}-ara-report.json` (canonical JSON), `{repo-name}-ara-report.html` (self-contained HTML), and `{repo-name}-ara-report.metadata.json` (version sidecar). This section specifies the MD structure; the JSON and HTML render subsets of the same data per the contract.

Create the report file with exactly this structure. Every section is required. All 43 questions must appear in the detailed findings — N/A questions are listed using the N/A display format, not omitted.

### Report Metadata Header

```markdown
# Agentic Readiness Analysis Report
**Target**: <repository path>
**Date**: <date>
**Analyzed by**: AWS Transform Custom — Agentic Readiness Analysis
**TD Version**: <resolved from `atx custom def get -n agentic-readiness-analysis` — the version ID of the published TD that produced this report, e.g., "3g1ef0edkgh173d9yafo0lio">
**Repository Type**: <resolved repo_type>
**Service Archetype**: <resolved service_archetype> (auto-detected | user-provided)
**Agent Scope**: <resolved agent_scope>
**Priority**: <priority if provided, otherwise omit this line>
**Tags**: <tags if provided, otherwise omit this line>
**Context**: <context if provided, otherwise omit this line>
```

If `service_archetype` was auto-detected, include:
```markdown
**Archetype Justification**: <1-2 sentence explanation>
```

If `repo_type` was defaulted due to an unrecognized value, include a warning line:
```markdown
**Warning**: Unrecognized repo_type '<original value>', defaulted to 'application'.
```

---

### Readiness Profile Determination

Determine the readiness profile using the BLOCKER and RISK-SAFETY counts from non-N/A, non-"Not Evaluated (extended)" questions only. N/A questions and Not Evaluated (extended) questions are excluded from all counts and have no effect on the profile. RISK-QUALITY count has no effect on profile assignment.

| Readiness Profile | BLOCKERs | RISK-SAFETY | RISK-QUALITY | Recommendation | Deployment Gate |
|-------------------|----------|-------------|--------------|----------------|-----------------|
| **Agent-Ready** | 0 | 0 | Any | Broad deployment | Cleared for autonomous operation. Instrument observability. Define scope explicitly. Run controlled pilot first. |
| **Pilot-Ready** | 0 | 1–2 | Any | Narrow pilot | Supervised pilot with: (1) human approval gates on irreversible actions, (2) agent limited to low-blast-radius operations, (3) compensating controls for each open RISK-SAFETY, (4) remediation timeline before expanding scope. |
| **Pilot-Ready (Safety Concerns)** | 0 | 3+ | Any | Supervised pilot, prioritize safety remediation | Supervised pilot with elevated safety oversight: (1) all Pilot-Ready controls apply, (2) prioritize RISK-SAFETY remediation before expanding agent scope, (3) dedicated safety review cadence, (4) agent restricted to lowest-blast-radius operations until RISK-SAFETY count drops below 3. |
| **Remediation Required** | 1–2 | Any | Any | Remediate BLOCKERs first | Resolve all blockers before any agent deployment — including pilots. Estimated runway: 60–180 days. |
| **Not Agent-Integrable** | 3+ | Any | Any | Deferred or descoped | Exclude from agent toolset or plan major remediation before re-evaluation. |

**Rules:**
1. Count only non-N/A, non-"Not Evaluated (extended)" questions with severity BLOCKER → `blocker_count`.
2. Count only non-N/A, non-"Not Evaluated (extended)" questions with severity RISK-SAFETY → `risk_safety_count`.
3. RISK-QUALITY count is not used in profile determination.
4. If `blocker_count >= 3` → **Not Agent-Integrable**.
5. If `blocker_count` is 1 or 2 → **Remediation Required** (RISK-SAFETY count is irrelevant).
6. If `blocker_count == 0` and `risk_safety_count >= 3` → **Pilot-Ready (Safety Concerns)**.
7. If `blocker_count == 0` and `risk_safety_count` is 1 or 2 → **Pilot-Ready**.
8. If `blocker_count == 0` and `risk_safety_count == 0` → **Agent-Ready**.

Display the readiness profile in the report:

```markdown
---

## Readiness Profile: <profile name>

**BLOCKERs**: <blocker_count> | **RISK-SAFETY**: <risk_safety_count> | **RISK-QUALITY**: <risk_quality_count> | **INFOs**: <info_count>

<Deployment gate description from the table above.>
```

---

### Summary Counts

Display the severity distribution for all non-N/A questions. N/A questions are excluded from these counts entirely.

```markdown
## Summary

| Severity | Count |
|----------|-------|
| BLOCKER | <count> |
| RISK-SAFETY | <count> |
| RISK-QUALITY | <count> |
| INFO | <count> |
| N/A | <count> |
| Not Evaluated (extended) | <count> |
| **Total** | **43** |

**Core Questions Evaluated**: 25 (or fewer if repo_type N/A applies)
**Extended Questions Triggered**: <count>
**Extended Questions Not Triggered**: <count>
**Questions N/A (repo_type: <repo_type>)**: <N/A count>
**Service Archetype**: <archetype> (auto-detected | user-provided)
```

---

### BLOCKERs Section

List all questions that received a BLOCKER severity (including conditional BLOCKERs that resolved to BLOCKER based on `agent_scope`). For each BLOCKER, include remediation guidance.

If there are no BLOCKERs, display: "No BLOCKERs identified."

```markdown
## BLOCKERs — Must Resolve Before Agent Deployment

### <question_id>: <question topic>

- **Severity**: BLOCKER
- **Finding**: <what was observed, with specific file and resource references>
- **Gap**: <what is missing or non-compliant>
- **Remediation**:
  - **Immediate**: <first concrete step to resolve this blocker>
  - **Target State**: <what "resolved" looks like>
  - **Estimated Effort**: <Low / Medium / High>
  - **Dependencies**: <other blockers or risks that interact with this one, or "None">
- **Evidence**: <specific files cited>

<Repeat for each BLOCKER question.>
```

**Remediation Prioritization Guidance:**

There is no universal remediation order — it depends on the use case, the blockers found, and the organization's constraints. However, the following principles apply:

- **Resolve BLOCKERs first.** No agent deployment (including pilots) should proceed with open BLOCKERs. Start with whichever blocker is fastest to resolve to unblock a scoped pilot.
- **Identity before data access.** If both identity (AUTH-Q1) and data classification (DATA-Q1) are blockers, fix identity first — you cannot enforce data access controls without knowing who is calling.
- **Read-only before write-enabled.** If write-operation blockers (API-Q4, STATE-Q1) are present, consider scoping the initial agent to read-only operations while remediating write safety. This unblocks value faster.

---

### RISKs Section

List all questions that received a RISK-SAFETY or RISK-QUALITY severity, grouped by tier. RISK-SAFETY findings are listed first, followed by RISK-QUALITY findings. For each RISK, include compensating control options that allow a scoped pilot to proceed while the risk is remediated.

If there are no RISKs (neither RISK-SAFETY nor RISK-QUALITY), display: "No RISKs identified."

```markdown
## RISKs

### RISK-SAFETY — Must Address for Agent Safety

#### <question_id>: <question topic> — RISK-SAFETY

- **Severity**: RISK-SAFETY
- **Finding**: <what was observed, with specific file and resource references>
- **Gap**: <what is missing or incomplete>
- **Compensating Controls**:
  - <option 1: a control that mitigates this risk for a scoped pilot>
  - <option 2: an alternative mitigation approach>
- **Remediation Timeline**: <suggested timeline to fully resolve — e.g., "30–60 days">
- **Recommendation**: <specific next step to remediate>
- **Evidence**: <specific files cited>

<Repeat for each RISK-SAFETY question.>

### RISK-QUALITY — Address as Capacity Allows

#### <question_id>: <question topic> — RISK-QUALITY

- **Severity**: RISK-QUALITY
- **Finding**: <what was observed, with specific file and resource references>
- **Gap**: <what is missing or incomplete>
- **Compensating Controls**:
  - <option 1: a control that mitigates this risk for a scoped pilot>
  - <option 2: an alternative mitigation approach>
- **Remediation Timeline**: <suggested timeline to fully resolve — e.g., "30–60 days">
- **Recommendation**: <specific next step to remediate>
- **Evidence**: <specific files cited>

<Repeat for each RISK-QUALITY question.>
```

**RISK Prioritization Guidance:**

- RISK-SAFETY findings take priority over RISK-QUALITY findings. Address safety risks first — they affect the readiness profile and determine whether the agent can operate safely.
- RISK-QUALITY findings do not affect the readiness profile. They indicate areas where agent effectiveness is reduced, not where safety is compromised. Address as capacity allows.
- Compensating controls buy time, not exemptions. A RISK mitigated by a compensating control (e.g., human-in-the-loop gate) is acceptable for a pilot but must be remediated before expanding scope.

---

### INFOs Section

List all questions that received an INFO severity. INFOs are not deployment gates — they shape architecture decisions and agent design.

If there are no INFOs, display: "No INFOs identified."

```markdown
## INFOs — Architecture and Design Inputs

### <question_id>: <question topic>

- **Severity**: INFO
- **Finding**: <what was observed, with specific file and resource references>
- **Implication**: <how this shapes agent design or architecture decisions>
- **Recommendation**: <optional improvement or consideration>
- **Evidence**: <specific files cited>

<Repeat for each INFO question.>
```

---

### Detailed Findings — All 43 Questions

List every question from all 8 sections in order (API-Q1 through ENG-Q5). This section is the complete record of the analysis. All 43 questions must appear — including N/A questions.

```markdown
## Detailed Findings

### 01 — API Surface and Interface Design

#### API-Q1: Documented API Interface
- **Severity**: <BLOCKER / RISK-SAFETY / RISK-QUALITY / INFO / N/A>
- **Finding**: <what was observed, with specific file and resource references>
- **Gap**: <what is missing, or "N/A">
- **Recommendation**: <specific next step, or "N/A">
- **Evidence**: <files cited, or "N/A">

#### API-Q2: Machine-Readable API Specification
- **Severity**: <BLOCKER / RISK-SAFETY / RISK-QUALITY / INFO / N/A>
- **Finding**: <what was observed>
- **Gap**: <what is missing, or "N/A">
- **Recommendation**: <specific next step, or "N/A">
- **Evidence**: <files cited, or "N/A">

<Continue for API-Q3 through API-Q8>

### 02 — Authentication, Authorization, and Identity

#### AUTH-Q1: Machine Identity Authentication
- **Severity**: <BLOCKER / RISK-SAFETY / RISK-QUALITY / INFO / N/A>
- **Finding**: <what was observed>
- **Gap**: <what is missing, or "N/A">
- **Recommendation**: <specific next step, or "N/A">
- **Evidence**: <files cited, or "N/A">

<Continue for AUTH-Q2 through AUTH-Q7>

### 03 — State Management and Transactional Integrity

<STATE-Q1 through STATE-Q7 in the same format>

### 04 — Human-in-the-Loop and Approval Workflows

<HITL-Q1 through HITL-Q3 in the same format>

### 05 — Data Accessibility and Quality

<DATA-Q1 through DATA-Q7 in the same format>

### 06 — Discoverability and Semantic Readiness

<DISC-Q1 through DISC-Q3 in the same format>

### 07 — Observability of Target Systems

<OBS-Q1 through OBS-Q3 in the same format>

### 08 — Engineering and Deployment Maturity

<ENG-Q1 through ENG-Q5 in the same format>
```

**For N/A questions**, use the N/A display format defined in the N/A Mapping section:

```markdown
#### <question_id>: <question topic>
- **Severity**: N/A
- **Finding**: This is a `<repo_type>` repository. This question does not apply.
- **Gap**: N/A
- **Recommendation**: N/A
- **Evidence**: N/A
```

**For conditional BLOCKER (⚡) questions** (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2), include the resolved severity based on `agent_scope`:

```markdown
#### <question_id>: <question topic> ⚡
- **Severity**: <BLOCKER if write-enabled / INFO or RISK-SAFETY if read-only>
- **Conditional**: agent_scope is "<agent_scope>" — evaluated as <resolved severity>
- **Finding**: <what was observed>
- **Gap**: <what is missing>
- **Recommendation**: <specific next step>
- **Evidence**: <files cited>
```

**For scope-calibrated RISK (⚡) questions** (HITL-Q1, HITL-Q2, STATE-Q3, STATE-Q6), include the resolved severity based on `agent_scope`:

```markdown
#### <question_id>: <question topic> ⚡
- **Severity**: <RISK if write-enabled / INFO if read-only>
- **Scope-Calibrated**: agent_scope is "<agent_scope>" — evaluated as <resolved severity>
- **Finding**: <what was observed>
- **Gap**: <what is missing>
- **Recommendation**: <specific next step>
- **Evidence**: <files cited>
```

---

### Evidence Index

Compile a complete index of all files cited as evidence across the analysis. Group by file type for easy reference.

```markdown
## Evidence Index

### Infrastructure as Code
| File | Questions Referenced |
|------|---------------------|
| <file path> | <question IDs that cited this file> |

### Source Code
| File | Questions Referenced |
|------|---------------------|
| <file path> | <question IDs that cited this file> |

### API Specifications
| File | Questions Referenced |
|------|---------------------|
| <file path> | <question IDs that cited this file> |

### CI/CD Configurations
| File | Questions Referenced |
|------|---------------------|
| <file path> | <question IDs that cited this file> |

### Container Definitions
| File | Questions Referenced |
|------|---------------------|
| <file path> | <question IDs that cited this file> |

### Dependency Manifests
| File | Questions Referenced |
|------|---------------------|
| <file path> | <question IDs that cited this file> |

### Configuration Files
| File | Questions Referenced |
|------|---------------------|
| <file path> | <question IDs that cited this file> |
```

If no files were found for a category, omit that category from the evidence index.

**Evidence Rules:**
- Every finding must cite at least one file or explicitly state "No evidence found — absence is itself a finding."
- File paths must be relative to the repository root.
- The same file may appear in multiple categories if it serves multiple purposes (e.g., a `docker-compose.yml` may be cited for both container definitions and configuration).

---

### Table of Contents

The complete report structure, for reference:

```markdown
# Agentic Readiness Analysis Report

1. Readiness Profile
2. Summary
3. BLOCKERs — Must Resolve Before Agent Deployment
4. RISKs
   - RISK-SAFETY — Must Address for Agent Safety
   - RISK-QUALITY — Address as Capacity Allows
5. INFOs — Architecture and Design Inputs
6. Detailed Findings
   - 01 — API Surface and Interface Design (API-Q1 through API-Q8)
   - 02 — Authentication, Authorization, and Identity (AUTH-Q1 through AUTH-Q7)
   - 03 — State Management and Transactional Integrity (STATE-Q1 through STATE-Q7)
   - 04 — Human-in-the-Loop and Approval Workflows (HITL-Q1 through HITL-Q3)
   - 05 — Data Accessibility and Quality (DATA-Q1 through DATA-Q7)
   - 06 — Discoverability and Semantic Readiness (DISC-Q1 through DISC-Q3)
   - 07 — Observability of Target Systems (OBS-Q1 through OBS-Q3)
   - 08 — Engineering and Deployment Maturity (ENG-Q1 through ENG-Q5)
7. Evidence Index
```


## Constraints and Guardrails

Strictly follow these rules at all times:

- **Read-only analysis**: Do not modify any source code, configuration, or infrastructure in the repository. Only create the output artifact bundle (md + json + html + metadata.json).
- **Stay on the current branch**: This is an analysis-only task. Do not create, switch, or checkout any git branches. Remain on whatever branch is currently checked out and perform all work there.
- **Be specific — cite evidence**: Always reference actual file names, resource names, and patterns found. Never write "there may be..." — state what was found or what was not found.
- **Absence is evidence**: If a search for a specific artifact finds nothing (e.g., no OpenAPI spec, no IaC files, no audit logging configuration), that absence is itself a finding. State it clearly and score accordingly.
- **Search completeness for absence claims**: Before declaring an artifact absent, search using ALL detection patterns listed in the question's "Look for" section. At minimum: (1) scan file names matching common conventions (e.g., `openapi.*`, `swagger.*`, `*.tf`, `*.smithy`), (2) grep source files for framework-specific imports or annotations listed in "Look for", (3) check the dependency manifest (package.json, pom.xml, requirements.txt, go.mod) for relevant libraries. If the repo has >500 files, focus on directories most likely to contain the artifact (e.g., `/api`, `/docs`, `/infra`, `/config`, root-level config files). Declare absence only after all detection patterns return zero results. State which patterns were searched in the evidence field.
- **Read before judging**: Do not score a question without actually reading relevant files. If relevant files have not been found yet, keep searching.
- **IaC is ground truth**: Trust IaC definitions over README descriptions. What is deployed is what is defined in the IaC.
- **Do not skip questions**: All 43 questions must appear in the report. Questions that are N/A for the detected `repo_type` use the N/A display format. Extended questions that are not triggered use the "Not Evaluated (extended)" display format. Both are listed, not omitted.
- **N/A scoring rules**: Questions scored as N/A are excluded from BLOCKER, RISK-SAFETY, RISK-QUALITY, and INFO counts and from readiness profile determination.
- **Extended question scoring rules**: Extended questions that are "Not Evaluated" are excluded from all counts and from readiness profile determination — same as N/A. Extended questions that ARE triggered are scored normally (BLOCKER/RISK-SAFETY/RISK-QUALITY/INFO) and count toward the readiness profile.
- **Conditional BLOCKER rules**: The 5 conditional BLOCKER questions (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2) must be evaluated at the severity determined by `agent_scope`. Do not override the conditional logic.
- **Evaluation tier rules**: Core questions are always evaluated (unless N/A by repo_type). Extended questions are evaluated only when their trigger condition is met. Use the Evaluation Tier tables in the Summary section to determine which extended questions to trigger based on archetype, scope, and service characteristics.
- **Archetype classification**: Use the `service_archetype` from `additionalPlanContext` if provided. Otherwise, auto-detect in Step 1.6. If auto-detection is inconclusive, default to `stateful-crud`. The archetype determines which extended questions are triggered — it does NOT override severity of core questions.
- **Repo type classification**: Use the `repo_type` from `additionalPlanContext`. If not provided, default to `application`. Apply the N/A mapping table exactly as defined.
- **Report completeness**: The output report must contain all required sections: metadata header (including service archetype), readiness profile, summary counts (including extended question counts), BLOCKERs with remediation, RISKs with compensating controls, INFOs, detailed findings for all 43 questions, and evidence index.


## Unified Per-Finding Field Set and `ara_metadata` Subobject

Every ARA finding carries a unified per-finding field set plus a required `ara_metadata` subobject so that ARA JSON can be consumed side-by-side with MOD JSON by a single webapp and portfolio aggregator.

### Per-Finding Required Fields

Every ARA finding MUST carry these 12 fields:

| Field | Type | Description |
|---|---|---|
| `question_id` | string | Rubric question identifier (e.g., `"AUTH-Q1"`). |
| `category` | string | Webapp-facing category display name (e.g., `"Authentication & Authorization"`). |
| `category_id` | string | Rubric short code (e.g., `"AUTH"`). |
| `title` | string | Short finding title. |
| `description` | string | Finding description. |
| `gap` | string | What's missing or incorrect. |
| `recommendation` | string | Remediation recommendation. |
| `severity` | enum | `"High"` / `"Medium"` / `"Low"` — unified severity. |
| `priority` | enum | `"P0"` / `"P1"` / `"P2"` / `"P3"` — per-question priority. See table below. |
| `effort` | enum | `"High"` / `"Medium"` / `"Low"` — remediation effort estimate. |
| `phase` | integer | `1`–`4` — derived roadmap phase. |
| `evidence` | object or null | `{file: string, lines: string}` reference to the gap location (e.g., `{"file": "src/auth.ts", "lines": "42-58"}`), or `null` when no specific file location applies. `lines` is a string range like `"12-15"` or single line like `"42"`. |

All 12 fields are REQUIRED on every emitted finding — missing any one fails the analysis and names the offending `question_id`. Findings are never emitted for questions that resolve to pass, N/A, Not Evaluated (extended), or any other non-finding outcome; those questions appear only under `evaluations[]`.

### ARA Metadata Subobject (`ara_metadata`)

Every ARA finding MUST carry a populated `ara_metadata` subobject that preserves the rubric depth and the conditional-resolution reasoning produced in Steps 2–9. The subobject is emitted as a sibling field to the 12 required fields above.

| Field | Type | Presence | Description |
|---|---|---|---|
| `native_severity` | enum | always | `"BLOCKER"` / `"RISK-SAFETY"` / `"RISK-QUALITY"` / `"INFO"` — the native ARA severity. |
| `safety_impact` | boolean | always | `true` for RISK-SAFETY findings and BLOCKERs that are agent-safety hazards; `false` for RISK-QUALITY and INFO. |
| `conditional_resolution` | string | conditional BLOCKERs only | Prose reasoning that resolved the conditional severity for this repo. |
| `agent_scope` | enum | conditional BLOCKERs only | `"read-only"` / `"write-enabled"` — the scope value that drove the resolution. |
| `resolution_reasoning` | string | conditional BLOCKERs only | Prose explaining why the finding was gated under this scope. |
| `remediation_timeline` | string | optional (RISK findings) | e.g., `"60–90 days"`. |
| `compensating_controls` | string[] | optional | Compensating-controls list. |
| `blocker_remediation` | object | optional (BLOCKER findings) | `{immediate, target_state, estimated_effort, dependencies[]}`. |
| `data_q1_subchecks` | object | only when `question_id == "DATA-Q1"` | B1/B2/B3 sub-check reasoning. |

The five conditional BLOCKER questions (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2) MUST carry the `conditional_resolution`, `agent_scope`, and `resolution_reasoning` trio. DATA-Q1 additionally carries `data_q1_subchecks` with `{b1, b2, b3}`, each having `{fired, severity, reasoning}`. The overall DATA-Q1 `severity` is the unified mapping of the highest sub-check that fires.

`ara_metadata` preserves rubric detail. The classification tier and count rules in the Summary and Report Template sections remain authoritative. `native_severity` is the join key back to BLOCKER / RISK-SAFETY / RISK-QUALITY / INFO counts.

### Evaluations Array (`evaluations[]`)

Questions that do NOT produce a finding (pass, N/A, Not Evaluated) are recorded in `evaluations[]`. Every one of the 43 question IDs appears in EITHER `findings[]` OR `evaluations[]` — never both, never neither.

| Field | Type | Description |
|---|---|---|
| `question_id` | string | e.g., `"AUTH-Q1"` |
| `category_id` | string | e.g., `"AUTH"` |
| `title` | string | Question title (e.g., "Machine Identity Authentication") |
| `status` | enum | `"pass"` / `"na"` / `"not_evaluated_extended"` / `"not_evaluated_archetype"` |
| `reason` | string | Why this status was assigned (e.g., "Infrastructure-only repo — API questions are N/A", "Extended question not triggered — no persistent state") |

### Remediation Roadmap (`remediation_roadmap`)

| Field | Type | Description |
|---|---|---|
| `phases` | integer[] | `[1, 2, 3]` — the phases used in this report |
| `items[]` | object[] | Per-phase remediation items |
| `items[].phase` | integer | 1, 2, or 3 |
| `items[].phase_name` | string | "Blockers", "Safety", or "Quality" |
| `items[].findings` | string[] | Array of `question_id` values in this phase |
| `items[].summary` | string | 1-2 sentence description of the phase focus |

### Recommended Actions (`recommended_actions[]`)

| Field | Type | Description |
|---|---|---|
| `action` | string | Short action title (e.g., "Deploy centralized identity provider") |
| `question_ids` | string[] | Related finding question IDs |
| `priority` | enum | `"P0"` / `"P1"` / `"P2"` / `"P3"` |
| `effort` | enum | `"High"` / `"Medium"` / `"Low"` |
| `rationale` | string | Why this action is recommended |

### Per-Question Priority Table

The `priority` field on every finding is STATIC per rubric question — it does not depend on per-repo context. Portfolio aggregation relies on this stability: the same `(analysis_type, question_id)` pair always yields the same `priority`. The native severity tier provides a baseline, but individual question priorities are hand-tuned to reflect operational impact (e.g., scope-calibrated questions that resolve to INFO under read-only scope receive lower priority than their tier baseline; questions with high remediation dependency on other findings may be elevated). The concrete per-question table below is authoritative — use it directly rather than deriving from severity tier:

| ARA native severity tier | Default per-question priority |
|---|---|
| Unconditional BLOCKER | P0 |
| Conditional BLOCKER (resolves as BLOCKER under write-enabled scope) | P0 |
| RISK-SAFETY | P1 |
| RISK-QUALITY | P2 |
| INFO | P3 |

Concrete per-question assignments for all 43 ARA questions:

| Question | Priority | Question | Priority |
|---|---|---|---|
| API-Q1 | P0 | DATA-Q1 | P0 |
| API-Q2 | P2 | DATA-Q2 | P1 |
| API-Q3 | P2 | DATA-Q3 | P2 |
| API-Q4 | P1 | DATA-Q4 | P2 |
| API-Q5 | P3 | DATA-Q5 | P2 |
| API-Q6 | P2 | DATA-Q6 | P1 |
| API-Q7 | P2 | DATA-Q7 | P3 |
| API-Q8 | P3 | DISC-Q1 | P2 |
| AUTH-Q1 | P0 | DISC-Q2 | P3 |
| AUTH-Q2 | P1 | DISC-Q3 | P3 |
| AUTH-Q3 | P1 | OBS-Q1 | P2 |
| AUTH-Q4 | P2 | OBS-Q2 | P2 |
| AUTH-Q5 | P2 | OBS-Q3 | P3 |
| AUTH-Q6 | P1 | ENG-Q1 | P2 |
| AUTH-Q7 | P1 | ENG-Q2 | P2 |
| STATE-Q1 | P0 | ENG-Q3 | P2 |
| STATE-Q2 | P2 | ENG-Q4 | P3 |
| STATE-Q3 | P1 | ENG-Q5 | P2 |
| STATE-Q4 | P1 | HITL-Q1 | P1 |
| STATE-Q5 | P1 | HITL-Q2 | P1 |
| STATE-Q6 | P2 | HITL-Q3 | P2 |
| STATE-Q7 | P2 | | |

The conditional BLOCKERs are distributed across P0 and P1 in the table above (DATA-Q1 and STATE-Q1 at P0; API-Q4, AUTH-Q6, DATA-Q2 at P1). Per-finding `priority` is static per `question_id` — the ARA native tier still drives classification counts through `ara_metadata.native_severity`; `priority` is a separate, static-per-question field that does not change with `agent_scope` or per-repo resolution.

The default `phase` assignment derives mechanically from `priority`: P0 → Phase 1, P1 → Phase 1, P2 → Phase 2 or 3, P3 → Phase 3 or 4. Per-repo ARA MAY pin a specific phase within the allowed band based on remediation dependencies; portfolio TDs MAY further adjust `phase` based on cross-cutting dependencies across the portfolio. The `priority` value itself does not change per-repo or per-portfolio.

## Classification Rules

The per-repo ARA classification is a named roll-up of the Readiness Profile (Summary section, "Readiness Profile Determination" in the Report Template). The classification uses `blocker_count` and `risk_safety_count` derived from the severity counts — it does NOT use `medium_count`. This guarantees that the Readiness Profile and the classification tier always agree on the same repo.

### Classification Table

| `blocker_count` | `risk_safety_count` | Tier | Sub-qualifier | Readiness Profile | `rule_matched` |
|---|---|---|---|---|---|
| 0 | 0 | Agent-Ready | none | Agent-Ready | "0 BLOCKER, 0 RISK-SAFETY → Agent-Ready" |
| 0 | 1 or 2 | Pilot-Ready | none | Pilot-Ready | "0 BLOCKER, 1-2 RISK-SAFETY → Pilot-Ready" |
| 0 | ≥ 3 | Pilot-Ready | "Pilot-Ready (Safety Concerns)" | Pilot-Ready (Safety Concerns) | "0 BLOCKER, ≥3 RISK-SAFETY → Pilot-Ready (Safety Concerns)" |
| 1 or 2 | any | Remediation Required | none | Remediation Required | "1-2 BLOCKER → Remediation Required" |
| ≥ 3 | any | Not Agent-Integrable | none | Not Agent-Integrable | "≥3 BLOCKER → Not Agent-Integrable" |

Tier values: {Agent-Ready, Pilot-Ready, Remediation Required, Not Agent-Integrable}. Sub-qualifier is ONLY "Pilot-Ready (Safety Concerns)" and ONLY applied when tier is Pilot-Ready AND `risk_safety_count` ≥ 3. RISK-QUALITY count has no effect on classification — it is reported but does not change the tier.

The classification object emitted in JSON:

```json
{
  "tier": "Pilot-Ready",
  "sub_qualifier": "Pilot-Ready (Safety Concerns)",
  "blocker_count": 0,
  "risk_safety_count": 5,
  "risk_quality_count": 7,
  "info_count": 3,
  "high_count": 0,
  "medium_count": 12,
  "low_count": 3,
  "rule_matched": "0 BLOCKER, ≥3 RISK-SAFETY → Pilot-Ready (Safety Concerns)"
}
```

The `high_count`, `medium_count`, and `low_count` fields represent the unified severity counts (BLOCKER→High, RISK-SAFETY+RISK-QUALITY→Medium, INFO→Low when emitted). They are informational — they feed the webapp filter chips — but do NOT drive classification. Only `blocker_count` and `risk_safety_count` do.

### MD-Rendered Classification Rationale

The per-repo ARA MD artifact MUST render a classification rationale paragraph immediately after the classification tier is first stated. The paragraph:
1. States the specific counts that drove the tier (e.g., "This repo has 0 BLOCKER findings and 5 RISK-SAFETY findings").
2. Names the matched rule (e.g., "0 BLOCKER, ≥3 RISK-SAFETY → Pilot-Ready (Safety Concerns)") — the exact string from the `rule_matched` column of the classification table.
3. States the classification tier alongside the Readiness Profile (they are a named roll-up of the same severity counts).

### Conditional BLOCKER Preservation

The five conditional BLOCKER questions (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2) use conditional-severity resolution. The `ara_metadata.conditional_resolution`, `ara_metadata.agent_scope`, and `ara_metadata.resolution_reasoning` fields surface the reasoning in JSON:

- `conditional_resolution`: Free-text prose that describes which native severity was assigned (e.g., "Resolved to BLOCKER: agent_scope=write-enabled AND no transaction scope").
- `agent_scope`: The `read-only` or `write-enabled` value that drove the resolution (sourced from `additionalPlanContext.agent_scope`).
- `resolution_reasoning`: Free-text prose explaining WHY the resolution was applied to this repo (e.g., "DATA-Q1 B1 fired because agent-facing APIs return credentials unmasked in HostConfigResource.cs").

The conditional-BLOCKER resolution logic is defined in Steps 2–9 of the analysis process; the JSON fields above surface that reasoning in a structured form.

## Four-Artifact Output Contract

Every per-repo ARA analysis emits four artifacts: three report artifacts plus a metadata sidecar.

### Artifacts

| Artifact | Filename | Purpose |
|---|---|---|
| Markdown report | `{repo}-ara-report.md` | Richest-prose artifact. Carries every rubric narrative (rubric quotes, compensating-control discussion, BLOCKER Remediation blocks, Archetype Justification, etc.). |
| JSON report | `{repo}-ara-report.json` | **Canonical machine-readable contract.** Consumed by webapp and portfolio TD. Every semantic field (findings, classification, categories, metadata, surface flags) is present. |
| HTML report | `{repo}-ara-report.html` | Single self-contained HTML file. Renders a subset of JSON. Tab order: stats → tech stack → findings → roadmap → programs. Visual contract defined inline below. |
| Metadata sidecar | `{repo}-ara-report.metadata.json` | Tiny JSON file carrying version compatibility data. Read by downstream consumers before consuming the main JSON. |

The JSON artifact is the canonical contract. If any artifacts disagree on a field, JSON wins.

### Metadata Sidecar Fields

The sidecar carries minimum fields for version compatibility checks:

```json
{
  "analysis_type": "ara",
  "analysis_date": "2026-04-30",
  "td_version": "agentic-readiness-analysis"
}
```

These same fields are redundantly embedded at the root of the main JSON under `metadata` (so consumers that skip the sidecar still have access).

### HTML Visual Contract

The per-repo ARA HTML artifact is a single self-contained HTML file (no external asset fetches at render time). The tab order matches the webapp: **stats → tech stack → findings → roadmap → programs**.

The full visual contract is defined inline below — do NOT reference external files. Every field rendered in HTML originates from the JSON artifact; MD prose is NOT part of the HTML round-trip contract. All attacker-controlled strings (repo names, evidence file paths, finding titles, descriptions, pathway names) MUST be HTML-escaped before embedding.

#### HTML Structure and Layout

**Header:**
- Title: `{repo_name} - Agentic Readiness Analysis Report`
- Subtitle line: `{date} · {language} · {loc} LOC · Portfolio: {portfolio_name}`

**Executive Summary:**

Prose paragraph: what the report evaluates, which eight dimensions are examined (API Surface, Authentication & Authorization, State Management, Human-in-the-Loop, Data Accessibility, Discovery & Documentation, Observability, Engineering Maturity).

**Overall Analysis:** `{emoji} {tier_label}` — classification tier with emoji mapping:
- 🟢 Agent-Ready
- 🟡 Pilot-Ready
- 🟠 Remediation Required (rendered as "Significant Remediation Required")
- 🚫 Not Agent-Integrable (rendered as "Not Agent-Integrable - Defer or Descope")

**Quick Stats:** Total Findings: N, By Severity: X High, Y Medium, Z Low, Estimated Remediation: {window}

**Stats Card Row** (4 cards):

| Card | Value source | Subtitle |
|---|---|---|
| Total Findings | `counts.total` | Across all dimensions |
| High Severity | `counts.high` | Critical findings |
| Medium Severity | `counts.medium` | Important findings |
| Low Severity | `counts.low` | Minor findings |

**Repository Details — Technology Stack table:**

| Attribute | Value |
|---|---|
| Language | `metadata.tech_stack.language` |
| Lines of Code | `metadata.tech_stack.loc` |
| Framework | `metadata.tech_stack.framework` |
| Architecture | `metadata.tech_stack.architecture` |

**Findings by Dimension table:**

| Dimension | Total Findings | High Severity | Medium Severity | Low Severity | Status |
|---|---|---|---|---|---|
| API Surface | N | X | Y | Z | Blocked / Needs Work / Ready |
| Authentication & Authorization | N | X | Y | Z | status |
| State Management | N | X | Y | Z | status |
| Human-in-the-Loop | N | X | Y | Z | status |
| Data Accessibility | N | X | Y | Z | status |
| Discovery & Documentation | N | X | Y | Z | status |
| Observability | N | X | Y | Z | status |
| Engineering Maturity | N | X | Y | Z | status |

Status values: `Ready` (green), `Needs Work` (yellow), `Blocked` (red). The dimension order matches the 8-section rubric order from the Summary section (API → AUTH → STATE → HITL → DATA → DISC → OBS → ENG).

**Detailed Findings** — per-finding card structure:

```
{question_id}: {title}          [severity badge]
Section: {section_short_code}

FINDING
{finding_description}

GAP
{gap}

RECOMMENDATION
{recommendation}

Effort: {effort} ({timeline_window})
File: {evidence.file}
Lines: {evidence.lines}
```

Ordered by severity (High → Medium → Low) then by section order (AUTH → API → STATE → DATA → OBS → ENG).

**Remediation Roadmap table:**

| Phase | Category | Modernization Pathway | Findings |
|---|---|---|---|
| 1 | Authentication Foundation | Machine Identity | N |

Source: `remediation_roadmap.items[]`

**Recommended Actions:**
- Custom Transformation row (always present)
- AWS Programs subsection: EBA, MAP

**Agent Deployment Recommendation** (footer block):

```
{emoji} {tier_label}

This repository has {n} blocker(s) that must be resolved before any agent deployment.
Focus on the High severity findings above.
```

**Footer:**
- `Generated by AWS Transform · Agentic Readiness Analysis Report`
- `© {year} Amazon Web Services, Inc. All rights reserved.`

#### Data Sourcing (JSON → HTML mapping)

| Visual location | JSON source |
|---|---|
| Header | `metadata.{portfolio_name, analysis_date, language, loc}` + `repo_name` |
| Overall Analysis | `classification.tier` + `classification.sub_qualifier` |
| Stats cards | `counts.{high, medium, low, total}` |
| Technology Stack | `metadata.tech_stack.*` |
| Findings by Dimension | Per-category counts from `findings[]` + `severity_status` |
| Detailed Findings | `findings[]` (all 12 fields) |
| Remediation Roadmap | `remediation_roadmap.items[]` |
| Recommended Actions | `recommended_actions[]` |
| Deployment Recommendation | `classification.tier` → emoji mapping |

**Content NOT in HTML** (MD-only): Rubric quotes, compensating-control discussion, BLOCKER Remediation blocks, conditional-resolution reasoning, DATA-Q1 sub-checks.

### Slug Derivation

The `{repo-name}` placeholder in artifact filenames refers to the **slug**, not the filesystem basename. The slug is derived as follows:

```
slug = lowercase(repo.name)
       with any character not in [a-z0-9_-] replaced by '-'
```

When this TD is invoked via the orchestrator, the slug source is the `name` field of the repository entry in `portfolio-config.yaml`. When invoked manually, the slug source is provided implicitly via the working directory's `additionalPlanContext` or, in absence, the repository's directory name normalized by the rule above. **Always derive from the configured name, not the on-disk basename** — they can mismatch (e.g., a `MonoToMicroLegacy` directory configured as `unishop-monolith`).

### Artifact Layout

```
{portfolio-or-repo}/
└── services/
    └── {repo-name}/
        └── agentic-readiness-analysis/
            ├── {repo-name}-ara-report.md
            ├── {repo-name}-ara-report.json
            ├── {repo-name}-ara-report.html
            └── {repo-name}-ara-report.metadata.json
```


---

## Error Handling

The TD is explicit about failure modes — no defensive inference, no silent skips. Failures name the offending element (question_id, file path, field) so assessors can remediate.

### Required-Field Failure

IF any of the 12 required per-finding fields is absent from an emitted finding, THEN the analysis SHALL fail, naming:
- The `question_id` of the offending finding
- The specific missing field

Example failure message: `"Analysis failed: finding for AUTH-Q1 is missing required field 'recommendation'. All 12 per-finding fields are REQUIRED."`

### N/A / Not Evaluated Leak

IF a finding is emitted for a question whose resolution was N/A or Not Evaluated, THEN the analysis SHALL fail, naming the `question_id` and the resolution status that should have been recorded in `evaluations[]` instead.

Example: `"Analysis failed: finding emitted for DATA-Q5 but the question resolved to N/A (no persistent data store). N/A / Not Evaluated resolutions MUST be recorded in evaluations[] only."`
