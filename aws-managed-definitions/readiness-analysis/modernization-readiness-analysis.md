## Name

Modernization Readiness Analysis

## Objective

Evaluate the cloud architecture maturity, operational readiness, and modernization potential of a repository's infrastructure, application architecture, data platforms, security posture, and operational practices. This analysis identifies concrete modernization pathways and produces a scored gap analysis with actionable recommendations. It answers the question: how ready is this system for iterative modernization — whether that means containerizing workloads, decomposing monoliths, migrating to managed services, eliminating license costs, or adopting modern DevOps practices?

## Summary

This transformation performs a dedicated Modernization Readiness Analysis on a codebase. It scans all files in the repository to discover infrastructure-as-code, application source code, CI/CD definitions, API specifications, dependency manifests, configuration files, container definitions, Kubernetes manifests, and Helm charts. It then evaluates what it finds against 37 questions across 5 sections — Infrastructure (INF), Application Architecture (APP), Data Platform (DATA), Security (SEC), and Operations (OPS):

- **INF** — Infrastructure, Platform, and DevOps (11 questions)
- **APP** — Application Architecture (6 questions)
- **DATA** — Data Platform Modernization (4 questions)
- **SEC** — Security Baseline (7 questions)
- **OPS** — Operations & Observability (9 questions)

Each question is scored on a 1–4 scale:

| Score | Label | Meaning |
|-------|-------|---------|
| **4** | ✅ Mature | Fully meets the criterion. No gaps. Best-practice implementation. |
| **3** | 🟡 Partial | Partially meets the criterion. Minor gaps. Functional but improvable. |
| **2** | 🟠 Needs Work | Exists but significant gaps. Moderate effort needed. |
| **1** | ❌ Not Ready | Missing entirely or fundamentally inadequate. |

Category scores are calculated as the arithmetic mean of all non-N/A, non-Not-Evaluated question scores in that category. The overall score is the average of the 5 category scores (each category weighted equally regardless of question count). If all questions in a category are N/A or Not Evaluated for the detected repo_type and archetype, the category score is "N/A" and is excluded from the overall score average.

> **Design note — equal category weighting:** Categories have different question counts (INF: 11, OPS: 9, SEC: 7, APP: 6, DATA: 4). Equal category weighting is intentional: each modernization dimension contributes equally to the overall score regardless of how many questions probe it. This means individual DATA questions have ~2.5x the per-question impact on the overall score compared to individual OPS questions. This is acceptable because data platform modernization (fewer questions, each high-signal) is as important as operational maturity (more questions, individually lower-signal). Portfolio consumers comparing services should use category scores directly rather than relying on overall score alone.

**Not Evaluated (archetype-N/A)** — Questions that are archetype-calibrated (currently INF-Q3, INF-Q4, APP-Q3, APP-Q4) may resolve to "not applicable by design" for a specific archetype. When the archetype column indicates the question does not apply (e.g., "No multi-step workflows exist — not applicable by design" for `stateless-utility` on INF-Q3), record the question as **"Not Evaluated (archetype-N/A)"** and exclude it from both category and overall score averaging — same exclusion as N/A. This prevents artificial score inflation from archetype-correct-but-uninformative "Score 4 by default" entries. The rubric columns still describe what evaluation would look like; the Not-Evaluated status means no evaluation was performed for this repo.

The analysis evaluates 7 AWS Modernization Pathways, each with defined trigger conditions mapped to specific question IDs and contextual guards to prevent false positives. Most pathways use a **Primary + Supporting** trigger model — a pathway fires when its Primary condition is met; Supporting conditions strengthen the case and inform the detail section. Two pathways use **compound triggers** where multiple conditions must be true simultaneously (Move to Cloud Native requires primary AND at least one supporting; Move to Open Source requires primary AND commercial DB evidence). The Summary Table below captures each pathway's full trigger logic — Step 7 is authoritative on implementation details:

| Pathway | Primary Trigger | Supporting Triggers | Contextual Guard |
|---------|----------------|---------------------|------------------|
| **Move to Cloud Native** | APP-Q2 < 3 AND at least one of: INF-Q1 < 3, APP-Q3 < 3, APP-Q4 < 3 | (compound — primary required AND ≥1 supporting required) | — |
| **Move to Containers** | INF-Q1 < 3 AND no container definitions found | — | Must be EC2/VM-based; SHALL NOT trigger if compute is already Lambda/Fargate/ECS |
| **Move to Open Source** | DATA-Q4 < 3 AND commercial DB engines detected in INF-Q2 finding | (compound — both conditions required) | — |
| **Move to Managed Databases** | INF-Q2 < 3 | DATA-Q3 < 3 (strengthens, not required) | — |
| **Move to Managed Analytics** | INF-Q4 < 3 | Data source sprawl with no unified access layer (DATA-Q2 finding) | Evidence of data processing workloads must exist |
| **Move to Modern DevOps** | INF-Q10 < 3 OR INF-Q11 < 3 | OPS-Q5 < 3, OPS-Q6 < 3 (strengthen, not required) | — |
| **Move to AI** | No AI/agent frameworks, no vector DB, no RAG, no agent eval framework | — | Requires AI/agent/LLM intent in portfolio or service context |

Full trigger logic including severity interpretation, archetype calibration, and pathway detail content is defined in Step 7.1 through 7.7. This Summary table is a quick reference — Step 7 is authoritative.

All 7 pathways appear in the pathway summary table with status: **Triggered**, **Not Triggered**, or **Not Applicable** (for repo_types where the pathway does not apply).

When APP-Q2 (Monolith vs Microservices) scores less than 3, the report includes a **Decomposition Strategy** section with concrete approach options (strengthen as modular monolith, Strangler Fig parallel track, conditional/adaptive, and big-bang with recommendation against), pattern recommendations linked to AWS prescriptive guidance (Anti-corruption Layer, Saga, Event Sourcing, Hexagonal Architecture), and level-of-effort estimates per approach.

The output is a **four-artifact bundle** (per the Four-Artifact Output Contract below) containing:
- `{repo-name}-mod-report.md` — richest narrative report
- `{repo-name}-mod-report.json` — canonical machine-readable contract
- `{repo-name}-mod-report.html` — single self-contained HTML visualization
- `{repo-name}-mod-report.metadata.json` — version compatibility sidecar

The MD report contains:
- Metadata header (repo name, date, repo_type)
- Overall and category score table
- Top 5 gaps
- Pathway summary table (all 7 pathways)
- Pathway detail subsections (triggered pathways only)
- Decomposition strategy (conditional on APP-Q2 < 3)
- Detailed findings for all 37 questions (including N/A questions in N/A format)
- Learning materials mapped to triggered pathways
- Evidence index with file references

This analysis targets workloads running on AWS. On-premises and multi-cloud workloads are out of scope unless actively migrating to AWS.

This analysis does NOT cover:
- **Agentic Readiness** — Whether systems can serve as agent tools (API surface quality, agent identity and authorization, transactional integrity, human-in-the-loop controls, agent observability, discoverability). Those concerns use BLOCKER/RISK/INFO severity scoring, readiness profiles, conditional BLOCKERs based on agent_scope, and are covered in the Agentic Readiness Analysis.
- **Agent design** — Prompt engineering, model selection, agent behavioral testing.

## Entry Criteria

- The repository is accessible and readable at the specified path
- The repository contains files relevant to analysis (source code, IaC, API specs, CI/CD configs, dependency manifests, container definitions, Kubernetes manifests, Helm charts, or configuration files)
- Write permissions exist to create the output artifact bundle (MD, JSON, HTML, and metadata.json)
- The analysis operates in **read-only mode** — it will not modify any source code or configuration in the repository
- Stay on the current branch — this is an analysis-only task. Do not create, switch, or checkout any git branches. Remain on whatever branch is currently checked out.

## Implementation Steps

### Step 0: Read additionalPlanContext

Before beginning the discovery scan, read the analysis context from `additionalPlanContext` to determine the repo classification, framing context, and technology preferences that will shape the entire analysis.

#### 0.1 Read Analysis Context

Extract the following fields from `additionalPlanContext`:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `repo_type` | enum | No | `"application"` | Repository classification. One of: `application`, `infrastructure-only`, `deployment-config`, `monorepo`, `library`. Determines which questions are scored as N/A and which pathways are Not Applicable. |
| `context` | string | No | — | Free-text description of the repository (e.g., "Legacy PHP e-commerce app running on EC2 with MySQL"). Used to frame findings and recommendations throughout the report. |
| `priority` | enum | No | — | Repository priority within the portfolio. One of: `P0`, `P1`, `P2`. Recorded in report metadata. |
| `tags` | string[] | No | — | User-defined tags for categorization (e.g., `["monolith", "php", "payment-critical"]`). Recorded in report metadata. |
| `preferences` | object | No | — | Technology steering preferences with two arrays: `prefer` (technologies to favor in recommendations) and `avoid` (technologies to steer away from). Used to frame technology recommendations throughout the report. |
| `service_archetype` | enum | No | auto-detected | Service archetype for scoring calibration on architecture-sensitive questions. One of: `stateless-utility`, `stateful-crud`, `orchestrator`, `data-gateway`, `event-processor`. If not provided, auto-detected in Step 1.5. Only applies when `repo_type` is `application`. |

**Example `additionalPlanContext`:**

```yaml
additionalPlanContext: |
  repo_type: "application"
  context: "Legacy PHP e-commerce app running on EC2 with MySQL"
  priority: "P0"
  tags: ["monolith", "php", "payment-critical"]
  service_archetype: "stateful-crud"
  preferences:
    prefer: ["eks", "aurora", "graviton"]
    avoid: ["serverless", "dynamodb"]
```

#### 0.2 Apply Defaults

If a field is absent from `additionalPlanContext`, apply these defaults:

- **`repo_type`** → `"application"` — This is the most comprehensive analysis (no questions skipped, all pathways applicable). Defaulting to `application` ensures nothing is missed when classification is unknown.
- **`context`** → No default. If absent, findings and recommendations are written without additional framing.
- **`priority`** → No default. If absent, omitted from report metadata.
- **`tags`** → No default. If absent, omitted from report metadata.
- **`preferences`** → No default. If absent, technology recommendations use neutral language without favoring or avoiding specific technologies.
- **`service_archetype`** → Auto-detected in Step 1.5 based on repository analysis. If auto-detection is inconclusive, defaults to `"stateful-crud"` (the most conservative archetype — applies the strictest rubric on architecture-sensitive questions without false downgrades). Only applies when `repo_type` is `application`. For non-application repo types, this field is ignored.

If `repo_type` is present but not one of the 5 recognized values (`application`, `infrastructure-only`, `deployment-config`, `monorepo`, `library`), default to `"application"` and include a warning in the report metadata: **"Unrecognized repo_type '{value}', defaulting to application."**

#### 0.3 Fields NOT Read by This TD

The MOD TD does **not** read, validate, or apply the following fields from `additionalPlanContext`. If present, they are ignored:

- **`agent_scope`** — Not used by this TD. Agent scope governs agent-interaction safety decisions and is not relevant to modernization scoring.

#### 0.4 How Context Fields Are Used

Record the resolved values from Steps 0.1–0.2 in the analysis context. They will be used in subsequent steps as follows:

- **`repo_type`** → Used in the N/A Mapping to determine which questions are scored as N/A and which pathways are marked Not Applicable for the detected repo type. Included in the report metadata header.
- **`context`** → Used throughout the report to frame findings and recommendations with repository-specific context. For example, if context mentions "legacy PHP e-commerce", recommendations reference the specific technology stack and business domain. Also used by the Move to AI pathway (Step 7.7) as a contextual guard. The pathway only triggers when the context explicitly mentions AI/agent/LLM use cases. This prevents false-positive triggers on services where AI adoption is not a goal.
- **`priority`** → Recorded in the report metadata header. Used by the Portfolio MOD TD for service ordering within roadmap phases.
- **`tags`** → Recorded in the report metadata header.
- **`preferences`** → Used throughout the report to steer technology recommendations. When `prefer` contains values, recommendations favor those technologies where applicable (e.g., if `prefer: ["eks"]`, container recommendations reference EKS over ECS). When `avoid` contains values, recommendations steer away from those technologies (e.g., if `avoid: ["serverless"]`, recommendations do not suggest Lambda-based approaches). Preferences influence recommendation framing only — they do not change scores, N/A mappings, or pathway trigger logic.
- **`service_archetype`** → Used in Steps 2–3 to calibrate scoring on architecture-sensitive questions where the "correct" architectural choice depends on the kind of service being evaluated. Specifically, INF-Q3 (Workflow Orchestration), INF-Q4 (Async Messaging and Streaming), APP-Q3 (Async vs Sync Communication), and APP-Q4 (Long-Running Process Handling) use archetype-keyed rubrics so that services whose correct design is synchronous and stateless are not penalized for lacking async infrastructure they do not need. Calibration can both downgrade and upgrade a score relative to the default rubric — for example, a `stateless-utility` using only synchronous HTTP may score 4 on INF-Q4 (correct design), while the same evidence would score 1 for an `orchestrator`. Included in the report metadata header. Only applies when `repo_type` is `application`; for other repo types, archetype calibration is skipped and the default rubric applies.

### Step 1: Discovery — Static Scan

Scan the target repository to build a complete inventory of what exists before evaluating any questions. This discovery step feeds every subsequent evaluation step — questions reference specific file types, patterns, and technology signals identified here.

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

**CI/CD Configurations:**
- GitHub Actions (`.github/workflows/*.yml`)
- GitLab CI (`.gitlab-ci.yml`)
- Jenkins (`Jenkinsfile`)
- AWS CodeBuild (`buildspec.yml`)
- AWS CodeDeploy (`appspec.yml`)
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

**Kubernetes Manifests and Helm Charts:**

This category is particularly important for MOD — Kubernetes and Helm artifacts directly inform infrastructure maturity (INF-Q1), deployment strategy (OPS-Q5), service discovery (APP-Q6), and the Move to Containers pathway.

- Kubernetes manifests (`*.yaml` in `k8s/`, `manifests/`, `deploy/`, `kubernetes/` directories)
- Helm charts (`Chart.yaml`, `values.yaml`, `templates/` directory, `.helmignore`)
- Kustomize overlays (`kustomization.yaml`, `overlays/`, `bases/`)
- ArgoCD application definitions (`Application`, `ApplicationSet` resources)
- Flux CD configurations (`GitRepository`, `HelmRelease`, `Kustomization` resources)
- Service mesh configs (Istio `VirtualService`, `DestinationRule`)
- Kubernetes Operators and CRDs (Custom Resource Definitions)

**Database Configurations:**

Database artifacts inform Data Platform questions (DATA-Q1–Q4), Managed Databases pathway, and Open Source pathway triggers.

- Database engine definitions in IaC (`aws_rds_instance`, `aws_dynamodb_table`, `aws_docdb_cluster`, `aws_elasticache_*`)
- Database connection strings and driver configurations in source code and config files
- SQL migration files (`.sql` files, Flyway `V*.sql`, Liquibase `*.xml`/`*.yaml`)
- Stored procedures, triggers, and functions (`CREATE PROCEDURE`, `CREATE TRIGGER`, `CREATE FUNCTION`)
- ORM configurations (Hibernate, SQLAlchemy, Prisma, TypeORM, Entity Framework)
- Database engine version pins in IaC or Helm values

**Analytics and Streaming Infrastructure:**

Analytics artifacts inform the Move to Managed Analytics pathway and INF-Q4 (async messaging/streaming).

- Streaming infrastructure in IaC (`aws_kinesis_*`, `aws_msk_*`, Kafka configs)
- Data pipeline definitions (Step Functions, Airflow DAGs, Glue jobs)
- Data lake configurations (S3 bucket policies, Lake Formation, Athena queries)
- ETL/ELT scripts and configurations
- Self-managed Kafka or RabbitMQ in Docker Compose or Kubernetes manifests

**AI/Agent Frameworks:**

AI artifacts inform the Move to AI pathway trigger.

- AI/ML framework imports in source code (Bedrock SDK, LangChain, Strands, OpenAI, Spring AI, HuggingFace, SageMaker SDK)
- Vector database infrastructure (OpenSearch with vector engine, Pinecone, pgvector, Weaviate, Qdrant)
- RAG implementation patterns (embedding generation, vector store queries, retrieval chains)
- Agent evaluation frameworks (Ragas, DeepEval, custom eval harnesses)
- Model configuration files (Bedrock model IDs, endpoint configs, prompt templates)

**Configuration Files:**
- Application config (`*.yaml`, `*.yml`, `*.json`, `*.toml`, `*.properties`, `*.ini`)
- Environment files (`.env`, `.env.*`)
- Service mesh configs
- Feature flag configurations

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
- `.helm/` — Helm cache directories
- `charts/` — Downloaded Helm chart dependencies (when inside a chart's dependency cache, not user-authored charts)

#### 1.3 Build the File Inventory

After scanning, compile a structured inventory of what was found. This inventory is referenced throughout Steps 2–6 when evaluating individual questions. Record:

- **IaC files found** — Terraform, CloudFormation, CDK, Helm, Kustomize, and other IaC files with paths. Used by: INF-Q1 (managed compute), INF-Q2 (managed databases), INF-Q5 (network security), INF-Q7 (auto-scaling), INF-Q8 (backup/recovery), INF-Q9 (high availability), INF-Q10 (IaC coverage), SEC-Q1 (audit logging), SEC-Q2 (encryption at rest).
- **Source code files found** — Application source files by language. Used by: APP-Q1 (languages), APP-Q2 (monolith vs microservices), APP-Q3 (async vs sync), APP-Q4 (long-running processes), DATA-Q2 (data access layer), DATA-Q4 (stored procedures).
- **API spec files found** — OpenAPI, AsyncAPI, and GraphQL files. Used by: APP-Q5 (API versioning), APP-Q6 (service discovery).
- **CI/CD config files found** — Pipeline definitions. Used by: INF-Q11 (CI/CD automation), OPS-Q5 (deployment strategy), OPS-Q6 (integration testing), SEC-Q7 (security pipeline).
- **Container and Kubernetes files found** — Dockerfiles, compose files, Kubernetes manifests, Helm charts. Used by: INF-Q1 (managed compute), APP-Q2 (microservices detection), APP-Q6 (service discovery), OPS-Q5 (deployment strategy), Move to Containers pathway.
- **Dependency manifests found** — Package manifests by ecosystem. Used by: APP-Q1 (language detection), identifying frameworks and libraries across multiple questions.
- **Database artifacts found** — Database definitions in IaC, migration files, stored procedures, ORM configs, engine versions. Used by: INF-Q2 (managed databases), DATA-Q1–Q4, Move to Open Source pathway, Move to Managed Databases pathway.
- **Analytics and streaming artifacts found** — Streaming infrastructure, data pipelines, ETL configs. Used by: INF-Q4 (async messaging/streaming), Move to Managed Analytics pathway.
- **AI/agent artifacts found** — AI framework imports, vector DB configs, RAG patterns, eval frameworks. Used by: Move to AI pathway trigger.
- **Configuration files found** — Config files by type. Used by: SEC-Q5 (secrets management), OPS-Q9 (resource tagging).
- **Notable absences** — Record what was NOT found. Absence is evidence: if no IaC files exist, that informs INF-Q10. If no CI/CD configs exist, that informs INF-Q11. If no container files exist, that informs the Move to Containers pathway. If no AI/agent artifacts exist, that informs the Move to AI pathway. These absences are cited in evaluation steps.

#### 1.4 Read Discovered Files

Read all discovered files that are relevant to the analysis. Prioritize reading in this order:

1. **IaC files** — Reveal infrastructure architecture, compute model, database choices, network topology, and security configuration
2. **Kubernetes manifests and Helm charts** — Reveal container orchestration maturity, service mesh usage, deployment strategies, and scaling configuration
3. **CI/CD configuration files** — Reveal deployment automation, testing practices, and security scanning
4. **Dependency manifests** — Reveal technology stack, frameworks, AI/ML libraries, and database drivers
5. **Database artifacts** — Reveal database engine choices, version pins, stored procedure usage, and migration patterns
6. **Container definitions** — Reveal containerization state and runtime configuration
7. **Application source code** — Reveal architecture patterns (monolith vs microservices), communication patterns (sync vs async), data access patterns, and AI/agent framework usage
8. **Configuration files** — Reveal runtime settings, secrets management, and tagging practices

For large repositories, focus on files most relevant to the 37 evaluation questions. Not every source file needs to be read in full — prioritize IaC resources, Kubernetes manifests, database configurations, pipeline definitions, entry points, and inter-service communication patterns.

### Step 1.5: Service Archetype Detection

Service archetype classifies an application by its **runtime architectural role**, which determines what the "correct" design looks like for communication patterns, persistence, and orchestration. Architecture-sensitive questions in this TD (INF-Q3, INF-Q4, APP-Q3, APP-Q4) score the same evidence differently depending on archetype — synchronous HTTP is correct for a stateless utility and an anti-pattern for an orchestrator.

**This archetype model is owned by the MOD TD and is applied to MOD scoring only.** It is independent of any other transformation definition. If `service_archetype` was provided in `additionalPlanContext`, use that value directly and skip auto-detection. Otherwise, analyze the file inventory from Step 1.3 and the file contents from Step 1.4 to classify the archetype using the decision logic below.

Archetype detection applies only when `repo_type` is `application`. For `infrastructure-only`, `deployment-config`, and `library`, skip this step — there is no application runtime to classify. For `monorepo`, detect archetype per service.

#### Archetypes and Their Detection Signals

| Archetype | Description | Detection Signals |
|-----------|-------------|-------------------|
| **stateless-utility** | Pure-function services with no persistent state, no user-specific data, and no write operations. Correct design is synchronous request/response. | No database connections, no cache writes, no message queue producers. All API operations are read-only (GET endpoints, query RPCs). Data comes from static files, environment variables, or in-memory computation. No `user_id`, `session`, or user-specific context. Data is public or reference-grade. Examples: currency converter, feature flag reader, config service, health aggregator. |
| **stateful-crud** | Services that own persistent state and expose CRUD operations on business entities. | Database connections (SQL, NoSQL, Redis with writes, DynamoDB). Create/Update/Delete endpoints alongside Read. Entity lifecycle management (status fields, soft deletes). User-specific data (user_id, session). Examples: cart service, user profile service, order service, inventory service. |
| **orchestrator** | Services that coordinate multi-service workflows by calling other services. Correct design leans async with managed orchestration. | High fan-out — calls 3+ downstream services (HTTP clients, gRPC stubs, service addresses in env vars). Sequential or parallel service-call patterns. Minimal or no persistent state of its own. Transaction coordination (saga patterns, compensating actions). Examples: checkout service, order placement service, workflow coordinator. |
| **data-gateway** | Read-heavy data access layer — APIs over databases, search indexes, or data lakes. Synchronous reads are the primary and correct pattern. | Database queries dominate the logic (SQL, Elasticsearch, DynamoDB scans). Pagination, filtering, sorting parameters in API. Search endpoints. Minimal business logic — primarily data transformation and serialization. Read-heavy traffic (>80% reads). Examples: product search service, reporting API, analytics query service. |
| **event-processor** | Services that consume events/messages and process them asynchronously. Correct design has no or minimal synchronous API surface. | Message queue consumers (SQS, Kafka, SNS, EventBridge). Event handler functions (Lambda triggers, message listeners). No synchronous API surface, or minimal (health checks only). Batch processing patterns. Examples: notification service, ETL pipeline, audit log processor, email sender. |

#### Auto-Detection Decision Logic

Apply these checks in order. The first check that matches determines the archetype.

1. **Has message queue consumers with no (or minimal) synchronous API surface?** → `event-processor`
   - SQS/Kafka/SNS handlers, EventBridge rules, Lambda triggers on queue events
   - No HTTP routes, or only health-check routes

2. **Orchestrates multi-service workflows (calls 3+ downstream services AND coordinates multi-step sequences)?** → `orchestrator`
   - HTTP/gRPC clients to 3+ other services with sequential/conditional coordination logic
   - Saga patterns, compensating actions, or workflow state machines
   - Step Functions, Temporal, or equivalent orchestration frameworks
   - Important: simple fan-out (calling 3 services independently without coordination) is NOT sufficient — the service must coordinate a workflow. A CRUD service calling auth + DB + notifications independently is `stateful-crud`, not `orchestrator`.

3. **Has persistent state?** → go to 3a
   **No persistent state?** → go to 3b

   **3a. Has write endpoints or state mutations?**
   - **Yes** → `stateful-crud`
   - **No, primarily read queries with pagination/filtering and minimal business logic** → `data-gateway`

   **3b. Stateless, has write endpoints or state mutations?**
   - **No** → `stateless-utility`
   - **Yes** (writes but no owned persistent state — e.g., forwarder to another service) → `stateful-crud` (treat as conservative default)

4. **If the above signals are ambiguous or conflicting**, default to `stateful-crud`. This is the conservative choice — it applies the strictest rubric on architecture-sensitive questions without false downgrades, matching the behavior of the default (non-calibrated) rubric.

#### Archetype Recording

Record the detected archetype in the analysis context. Include it in the report metadata header:

```markdown
**Service Archetype**: <archetype> (auto-detected | user-provided)
```

If auto-detection was used, include a one- to two-sentence justification referencing the specific signals observed:

```markdown
**Archetype Justification**: <e.g., "No database connections or writes detected; all endpoints are GET operations reading from a static JSON file. Classified as stateless-utility.">
```

If archetype detection is skipped because `repo_type` is not `application`, omit these fields from the metadata header.

### Step 1.6: Target-System Surface Detection

Some MOD questions evaluate a system's maturity on a specific operational surface — a persistent data store, an at-rest-encryption surface, a multi-AZ surface. For repositories that **do not expose that surface at all** (e.g., a progress-bar library has no database, a build tool has no data at rest, a pure utility has no multi-AZ decision to make), scoring those questions with Score 1 ("no managed database" / "no encryption at rest") produces false positives and crowds out the genuine findings on repositories that *do* expose the surface.

This step records six surface flags that feed surface-gated calibration on a small number of INF, SEC, and OPS questions. Surface flags are derived from the Step 1 file inventory — no additional scanning is needed.

#### Flags

| Flag | True when |
|------|-----------|
| `has_persistent_data_store` | IaC defines a database resource (`aws_rds_*`, `aws_dynamodb_*`, `aws_docdb_*`, `aws_neptune_*`, `aws_timestreamwrite_*`, `aws_elasticache_*`), a self-managed database is declared in Docker Compose / Kubernetes manifests / Helm charts, or the source code imports a database driver (JDBC, SQLAlchemy, Mongoose, go-sql-driver, `pymongo`, `redis`, etc.) paired with connection/pool configuration. Libraries that provide a database *adapter* without themselves deploying a store are `false`. |
| `has_at_rest_data_surface` | Any of the following exists in IaC or detected at runtime: S3 buckets, RDS/Aurora/DynamoDB/DocumentDB/Neptune/Timestream/ElastiCache, EBS volumes attached to workloads, EFS file systems, managed block/object storage. `has_persistent_data_store=true` implies `has_at_rest_data_surface=true`. Source-code-only repositories with no deployment artifacts are `false`. |
| `has_deployed_workload` | IaC defines deployable compute (`aws_ecs_*`, `aws_eks_*`, `aws_lambda_*`, `aws_instance`, `aws_apprunner_*`, EKS/ECS task definitions, Lambda functions) OR a Dockerfile exists AND deployment manifests (Helm chart, Kubernetes manifests, CloudFormation / Terraform) reference it. Pure library repos (no Dockerfile, no IaC, published via NpmPrettyMuch/PyPI/Maven Central) are `false`. |
| `has_api_surface` | The codebase defines HTTP/gRPC/RPC endpoints (Express/FastAPI/Flask/Spring MVC/gRPC server bindings, API Gateway resources in IaC, ALB listeners, AppSync schemas). CLI tools, SDK libraries, and pure computation utilities are `false`. |
| `has_multi_instance_deployment` | The deployment model supports more than one running instance — ASG with desired>1, Kubernetes Deployment with replicas>1, ECS service with desired_count>1, Lambda (inherently multi-instance), serverless. Single-EC2 or single-container deployments are `false`. Used for INF-Q9 multi-AZ calibration. |
| `has_iac_provisioning_aws_resources` | The repository contains IaC (Terraform, CDK, CloudFormation, Pulumi, SAM) that provisions AWS resources — any `aws_*` Terraform resources, CloudFormation `AWS::*` resource types, CDK constructs that synthesize AWS resources, or SAM templates. Repositories with only Dockerfiles, Kubernetes manifests, Helm charts, or CI/CD pipeline definitions (without AWS resource provisioning) are `false`. Libraries and application repos with no IaC are `false`. This flag distinguishes repos that *own* AWS infrastructure from repos that are *deployed onto* infrastructure managed elsewhere. **Foundation vs Application IaC:** This flag is `true` for both foundation IaC (CloudTrail, AWS Config, VPC baselines, Organization SCPs) and application IaC (ECS tasks, RDS instances, Lambda functions). The SEC-Q1 gate additionally checks for account-level scope — see the SEC-Q1 gate row for details. |

#### Surface-flag gates on scoring

Questions marked with a surface gate below evaluate to **"Not Evaluated (archetype-N/A)"** when the required flag is `false`, rather than defaulting to Score 1.

| Question | Gate flag required | Behavior when flag is `false` |
|----------|-------------------|-------------------------------|
| **INF-Q2** (Managed Databases) | `has_persistent_data_store` | Not Evaluated (archetype-N/A). Finding: "This system does not deploy a database. INF-Q2 does not apply." |
| **SEC-Q2** (Encryption at Rest) | `has_at_rest_data_surface` | Not Evaluated (archetype-N/A). Finding: "This system has no deployed data-at-rest surface — no database, S3 bucket, EBS volume, or similar. SEC-Q2 does not apply." |
| **INF-Q8** (Backup/Recovery) | `has_persistent_data_store` OR `has_at_rest_data_surface` | Not Evaluated (archetype-N/A). Finding: "This system has no persistent state to back up. INF-Q8 does not apply." |
| **INF-Q9** (High Availability) | `has_deployed_workload` AND (`has_api_surface` OR `has_persistent_data_store`) | Not Evaluated (archetype-N/A). Finding: "This system has no deployed workload requiring HA evaluation. INF-Q9 does not apply." |
| **OPS-Q2** (SLOs) | `has_api_surface` OR `has_persistent_data_store` | Not Evaluated (archetype-N/A). Finding: "This system has no user-facing surface for which SLOs are meaningful. OPS-Q2 does not apply." |
| **SEC-Q1** (Audit Logging) | `has_iac_provisioning_aws_resources` AND evidence of account-level IaC scope | Not Evaluated (archetype-N/A). Finding: "Audit logging (CloudTrail) is an AWS account-level service provisioned once per account or organization — not per-application. This repo contains application-level IaC only (compute, databases, networking for this service) which is the correct scope for an application repo. CloudTrail evaluation belongs in the foundation/account-level infrastructure repo. Future: provide audit logging status via `additionalPlanContext`." |
| **OPS-Q5** (Deployment Strategy) | `has_deployed_workload` | Not Evaluated (archetype-N/A). Finding: "No deployed workload found in this repo — deployment strategy cannot be assessed from source code alone. Deployment orchestration may exist in a separate deployment-config or GitOps repo. Future: provide deployment strategy evidence via `additionalPlanContext`." |

When a flag is `true`, the question is evaluated normally against its rubric — surface flags never downgrade a real Score 1, they only prevent a false Score 1 on a system that does not expose the surface at all. Record the resolved surface flags in the report metadata:

**SEC-Q1 Account-Level Scope Determination:**

The SEC-Q1 gate requires both `has_iac_provisioning_aws_resources=true` AND evidence that the IaC operates at account/foundation level (not just application level). Evaluate SEC-Q1 only when the repo's IaC includes **account-level resources** such as:

- `aws_cloudtrail`, `aws_config_*`, `aws_guardduty_*`, `aws_securityhub_*`
- `aws_organizations_*`, `aws_iam_account_*`, Service Control Policies
- Account-wide VPC baselines, Transit Gateway, shared networking
- Centralized logging infrastructure (log archive buckets, log aggregation)

**Do NOT evaluate SEC-Q1** when the repo contains only application-level IaC:
- ECS/EKS/Lambda definitions for this service
- RDS/DynamoDB/S3 for this service's data
- Security groups, ALBs, API Gateways for this service
- Service-specific IAM roles and policies

**Rationale:** CloudTrail is provisioned once per AWS account or organization. An application repo that defines its own ECS service and RDS database is correctly scoped — it should not also define CloudTrail. Penalizing application IaC repos for lacking account-level resources produces false positives. Only repos whose explicit purpose is account/foundation infrastructure should be evaluated on SEC-Q1.

```markdown
**Surface Flags**: has_persistent_data_store=<true|false>, has_at_rest_data_surface=<true|false>, has_deployed_workload=<true|false>, has_api_surface=<true|false>, has_multi_instance_deployment=<true|false>, has_iac_provisioning_aws_resources=<true|false>
```

Surface flags apply to all `repo_type` values where the flag is meaningful. Libraries (`library` repo_type) already receive Not-Evaluated treatment for most INF questions via the N/A mapping; surface flags tighten the same pattern for `application` and `monorepo` repos that happen to lack specific surfaces.

## N/A Mapping — Repository Type Question and Pathway Applicability

Before evaluating any question or pathway, check the `repo_type` (resolved in Step 0) against the N/A mapping tables below. Questions and pathways mapped as N/A for the detected repo type are **not evaluated** — they are recorded directly in the N/A display format and excluded from scoring.

The MOD N/A Mapping has two dimensions:

1. **Question N/A Mappings** — Which of the 37 questions are scored as N/A per repo_type
2. **Pathway N/A Mappings** — Which of the 7 AWS Modernization Pathways are marked Not Applicable per repo_type

### N/A Question Mappings by Repo Type

| Repo Type | Questions Scored as N/A |
|-----------|------------------------|
| `application` | None — all 37 questions apply |
| `infrastructure-only` | APP-Q1 through APP-Q6, DATA-Q1 through DATA-Q2, DATA-Q4 |
| `deployment-config` | APP-Q1 through APP-Q6, DATA-Q1 through DATA-Q4, INF-Q1 through INF-Q4, INF-Q6 through INF-Q9 |
| `library` | INF-Q1 through INF-Q11, OPS-Q2 through OPS-Q9 |
| `monorepo` | None — all 37 questions apply (assessed per-service within the repo) |

**Rationale by repo type:**

- **`application`** — Full-stack repositories with source code, infrastructure, and deployment configuration. All 37 questions are relevant because the analysis evaluates the complete modernization surface: infrastructure maturity, application architecture, data platform, security baseline, and operational practices.
- **`infrastructure-only`** — Repositories containing only IaC provisioning (Terraform modules, CDK stacks, CloudFormation templates) with no application source code. Application Architecture questions (APP-Q1 through APP-Q6) do not apply because there is no application runtime to evaluate for language choice, monolith decomposition, communication patterns, or service discovery. Data questions DATA-Q1 (unstructured data storage) and DATA-Q2 (unified data access layer) do not apply because there is no application data access layer. DATA-Q4 (stored procedures) does not apply because there is no application-layer business logic to evaluate for database coupling. DATA-Q3 (database engine version) still applies because IaC defines database resources with engine versions. All INF, SEC, and OPS questions still apply because infrastructure repos define compute, networking, security, and operational configuration.
- **`deployment-config`** — Repositories containing only CI/CD pipelines, Kubernetes manifests, Helm charts, GitOps configs, or Ansible playbooks — no application source code. Application Architecture questions (APP-Q1 through APP-Q6) do not apply because there is no application to evaluate. All Data Platform questions (DATA-Q1 through DATA-Q4) do not apply because deployment config repos do not define data storage or access patterns. Infrastructure questions INF-Q1 through INF-Q4 (managed compute, managed databases, workflow orchestration, async messaging) do not apply because deployment config repos do not provision these resources — they configure how existing resources are deployed. INF-Q6 through INF-Q9 (API entry point, auto-scaling, backup/recovery, high availability) do not apply for the same reason. INF-Q5 (network security) still applies because deployment manifests may define network policies, security groups, or service mesh rules. INF-Q10 (IaC coverage) and INF-Q11 (CI/CD automation) still apply because they evaluate the deployment config repo's own governance. All SEC and OPS questions still apply because deployment repos define security scanning, secrets management, deployment strategies, and observability configuration.
- **`library`** — Package repositories with source code but no deployable entry point (no Dockerfile, no IaC, no main()). All INF questions (INF-Q1 through INF-Q11) are N/A because libraries have no infrastructure to provision, no compute to manage, no databases to configure, no networking to secure, no auto-scaling to tune, and no CI/CD deployment pipeline (they have build/publish pipelines, not deployment pipelines). OPS-Q2 through OPS-Q9 are N/A because libraries do not define SLOs, publish business metrics, configure anomaly detection, implement deployment strategies, run integration tests against live services, automate incident response, own observability dashboards, or manage resource tagging. OPS-Q1 (distributed tracing) still applies because libraries can instrument tracing that propagates through dependent applications. All APP, DATA, and SEC questions still apply because libraries contain application code, data access patterns, and security practices that affect consuming applications.
- **`monorepo`** — Repositories containing multiple independent services. All 37 questions apply, assessed per-service within the repo. Each service directory is evaluated independently against the full question set.

### N/A Pathway Mappings by Repo Type

| Repo Type | Pathways Marked as Not Applicable |
|-----------|-----------------------------------|
| `application` | None — all 7 pathways applicable |
| `infrastructure-only` | Move to Cloud Native, Move to Containers, Move to AI, Move to Managed Analytics |
| `deployment-config` | Move to Cloud Native, Move to Containers, Move to Open Source, Move to Managed Databases, Move to Managed Analytics, Move to AI (all except Move to Modern DevOps) |
| `library` | Move to Containers, Move to Modern DevOps, Move to Managed Databases, Move to Managed Analytics, Move to Cloud Native |
| `monorepo` | None — all 7 pathways applicable |

**Rationale by repo type:**

- **`application`** — All 7 pathways are potentially relevant for full-stack application repositories.
- **`infrastructure-only`** — Move to Cloud Native, Move to Containers, and Move to AI do not apply because there is no application to decompose, containerize, or add AI capabilities to. Move to Managed Analytics does not apply because infrastructure repos do not run data processing workloads. Move to Open Source, Move to Managed Databases, and Move to Modern DevOps still apply because IaC repos define database engines (which may be commercial), database management mode (self-managed vs managed), and deployment automation practices.
- **`deployment-config`** — Only Move to Modern DevOps applies because deployment config repos are fundamentally about DevOps practices (CI/CD, deployment strategies, IaC governance). All other pathways require application source code, database definitions, or compute infrastructure that deployment config repos do not contain.
- **`library`** — Move to Containers does not apply because libraries are not deployed as running services. Move to Modern DevOps does not apply because libraries use build/publish pipelines, not deployment pipelines. Move to Managed Databases and Move to Managed Analytics do not apply because libraries do not provision or manage database or analytics infrastructure. Move to Cloud Native does not apply because libraries are not independently deployable units. Move to Open Source and Move to AI still apply because libraries may contain commercial database drivers or lack AI capabilities that could enhance their functionality.
- **`monorepo`** — All 7 pathways are potentially relevant, evaluated per-service within the repo.

### N/A Display Format

When a question is N/A for the detected `repo_type`, record it as:

| Field | Value |
|-------|-------|
| **Score** | N/A |
| **Finding** | This is a `{repo_type}` repository. This question does not apply. |
| **Gap** | N/A |
| **Recommendation** | N/A |

Replace `{repo_type}` with the actual resolved repo type value (e.g., "This is a `infrastructure-only` repository. This question does not apply.").

### Not Evaluated (archetype-N/A) Display Format

When an archetype-calibrated question (INF-Q3, INF-Q4, APP-Q3, APP-Q4) resolves to "not applicable by design" for the detected archetype, record it as:

| Field | Value |
|-------|-------|
| **Score** | Not Evaluated (archetype-N/A) |
| **Finding** | This service is a `{archetype}`. {Question topic} is not applicable by design — {brief reason, e.g., "no multi-step workflows exist for a stateless utility"}. |
| **Gap** | N/A |
| **Recommendation** | N/A |

Not-Evaluated questions are **excluded from category and overall score averaging** — treated identically to N/A for scoring purposes.

When a pathway is N/A for the detected `repo_type`, record it in the pathway summary table as:

| Field | Value |
|-------|-------|
| **Status** | Not Applicable |
| **Reason** | This is a `{repo_type}` repository. This pathway does not apply. |

### N/A and Not-Evaluated Scoring Rules

N/A questions and Not-Evaluated (archetype-N/A) questions are **both excluded from the numerator and denominator** of category score averages:

1. **Category score calculation** — The category score is the arithmetic mean of only the non-N/A, non-Not-Evaluated question scores in that category. Both are excluded from the sum of scores (numerator) and the count of questions (denominator). For example, if a category has 6 questions, 1 is N/A for repo_type, and 1 is Not Evaluated (archetype-N/A), the category score = (sum of 4 remaining scores) / 4.
2. **All-exclusion category** — If **all** questions in a category are N/A or Not Evaluated, the category score is **"N/A"** and that category is excluded from the overall score average.
3. **Overall score calculation** — The overall score is the average of the non-N/A category scores. Each non-N/A category is weighted equally regardless of question count.
4. **Pathway exclusion** — N/A pathways are listed in the pathway summary table with status "Not Applicable" but do not affect the count of triggered vs not-triggered pathways.

> **Why Not-Evaluated matters:** A `stateless-utility` that correctly has no workflows (INF-Q3) should not score 4 "by design" — that inflates its infrastructure category above a `stateful-crud` with appropriate Step Functions coverage (realistic Score 3). Recording as Not Evaluated (archetype-N/A) keeps scores comparable across archetypes.

### N/A Inclusion Rule

All 37 questions **must appear** in the report output. N/A questions are listed in the detailed findings section using the N/A display format above — they are **not omitted** from the report. This ensures the report is a complete record of all 37 questions regardless of repo type, and makes it clear which questions were skipped and why.

All 7 pathways **must appear** in the pathway summary table. N/A pathways are listed with status "Not Applicable" — they are **not omitted** from the table.

### How to Apply the N/A Mapping

For each evaluation step (Steps 2–6), before evaluating a question:

1. Check whether the question ID appears in the N/A question mapping for the resolved `repo_type`.
2. If the question **is** in the N/A set: skip evaluation, record the question using the N/A display format, and move to the next question.
3. If the question **is not** in the N/A set: evaluate the question normally against the repository evidence.
4. If **all** questions in a section are N/A for the detected repo type, skip the section evaluation entirely but still list all questions from that section in the report using the N/A display format. Record the category score as "N/A".

For pathway evaluation:

1. Check whether the pathway appears in the N/A pathway mapping for the resolved `repo_type`.
2. If the pathway **is** in the N/A set: record it in the pathway summary table with status "Not Applicable" and the N/A reason. Do not evaluate trigger conditions.
3. If the pathway **is not** in the N/A set: evaluate the pathway's trigger conditions and contextual guards normally against the question scores and discovery evidence.


### Step 2: Infrastructure, Platform, and DevOps (INF-Q1 through INF-Q11)

These questions evaluate the compute, networking, platform services, and deployment practices underpinning the application. Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If the question is N/A, record it in the N/A display format and skip evaluation.

#### INF-Q1: Managed Compute

**Question:** What percentage of compute workloads use managed container orchestration (EKS, ECS, Fargate) or serverless (Lambda) vs raw EC2?

**Why it matters:** Managed compute provides elastic scaling, reduced operational overhead, and faster deployment cycles. EC2 requires manual scaling, patching, and capacity planning. Modernization starts with moving off self-managed compute.

| Score | Criteria |
|-------|----------|
| **4** | All primary workloads run on ECS/EKS/Lambda/Fargate. EC2 used only for edge cases (bastion hosts, license-locked software). Measured by service count: ≤1 EC2-based service remains. |
| **3** | Mix of managed and EC2, with managed compute for primary workloads. |
| **2** | Primarily EC2 with some containerization or Lambda for auxiliary functions. |
| **1** | All compute on raw EC2 or on-premises with no managed services. |

> **Look for:** Terraform `aws_ecs_*`, `aws_eks_*`, `aws_lambda_*` vs `aws_instance`; CloudFormation resource types; Dockerfile presence; Kubernetes manifests.

#### INF-Q2: Managed Databases

**Question:** Are databases fully managed (RDS/Aurora/DynamoDB/DocumentDB/Neptune/Timestream) vs self-managed?

**Why it matters:** Self-managed databases — regardless of where they run (EC2, containers, on-premises) — introduce maintenance windows, manual patching, and operational overhead. Migrating to managed services eliminates ops burden and enables automatic backups, failover, and scaling.

> **Note:** This question is **surface-gated** (Step 1.6). If `has_persistent_data_store` is `false` — the system does not deploy any database, managed or self-managed — record the question as **"Not Evaluated (archetype-N/A)"** and skip evaluation. A build tool, pure utility, or frontend-only application has no database and should not receive Score 1 for "no managed database."

| Score | Criteria |
|-------|----------|
| **4** | All databases are managed services with automated failover. |
| **3** | Main production databases managed; some auxiliary or secondary self-managed instances remain. |
| **2** | Main production databases are managed services but deployed single-AZ or without Multi-AZ failover enabled. OR: mix of managed and self-managed — at least one production database is self-hosted (e.g., MySQL on EC2, PostgreSQL in Docker). |
| **1** | All databases self-managed on EC2, containers, or on-premises. |

> **Look for:** Terraform `aws_rds_*`, `aws_dynamodb_*`, `aws_docdb_*`, `aws_neptune_*`, `aws_timestreamwrite_*` vs compute resources running database software; connection strings pointing to self-hosted instances; database engine installation in Dockerfiles or user-data scripts.

#### INF-Q3: Workflow Orchestration

**Question:** Are workflow orchestration services used (Step Functions, MWAA, Temporal, Camunda) or are workflows primarily implemented as hardcoded application logic?

**Why it matters:** Dedicated workflow orchestration provides visual workflow management, error handling, retry logic, and state management. Without it, all orchestration logic is buried in code — harder to maintain, debug, and evolve. However, not every service has workflows to orchestrate. A pure read-only utility or a simple CRUD service may have nothing multi-step to coordinate, and penalizing it for not adopting Step Functions would recommend complexity where none is warranted.

> **Note:** This question uses archetype-sensitive calibration. A `stateless-utility` with no multi-step workflows records as "Not Evaluated (archetype-N/A)" rather than defaulting to Score 4. See the archetype rubric below.

**Archetype Calibration:** This question is archetype-sensitive. Apply the rubric below that matches the detected `service_archetype`. If `repo_type` is not `application` (and therefore no archetype was detected), use the `stateful-crud` column as the default.

> **Not Evaluated (archetype-N/A) rule:** If the resolved archetype column indicates the question does not apply (the rubric cell says "not applicable by design" or equivalent — for INF-Q3 this is `stateless-utility` Score 4), record the question as **"Not Evaluated (archetype-N/A)"** in the report and exclude it from category and overall score averaging. Do not report a default Score 4. Use the Not-Evaluated display format defined in the N/A Mapping section above.

| Score | stateless-utility | data-gateway | stateful-crud | orchestrator | event-processor |
|-------|------------------|--------------|---------------|--------------|-----------------|
| **4** | No multi-step workflows exist — not applicable by design → **Not Evaluated (archetype-N/A)**. | No multi-step workflows exist in the read path; any background maintenance jobs use managed orchestration. | Dedicated workflow orchestration service in use for business-critical multi-step operations. | Step Functions, Temporal, or equivalent coordinates all multi-service workflows with error handling and retries. | Event pipeline uses managed orchestration (Step Functions, EventBridge Pipes) for multi-step processing. |
| **3** | — | Some background jobs orchestrated, others in code; minimal impact on read path. | Partial adoption — some workflows orchestrated, others still in code. | Partial adoption — primary workflow orchestrated, auxiliary flows still in code. | Primary pipeline orchestrated; some event chains still handled inline. |
| **2** | — | Background jobs are hardcoded state machines. | Simple state machines in code with some structure, but no dedicated service. | Fan-out coordination is in code with basic structure but no dedicated orchestrator. | Multi-step event processing is ad hoc in handler code. |
| **1** | Multi-step processes exist despite the utility framing and are entirely hardcoded (indicates archetype may be misclassified). | Multi-step orchestration buried in application code with no structure. | No orchestration — all workflow logic hardcoded in application code. | No orchestration despite fan-out — tight coupling and no retry/error strategy. This is an anti-pattern for this archetype. | Event chains are fully hardcoded with no orchestration primitives. |

When the score is 4 for `stateless-utility` or `data-gateway` because no workflows exist, the **Recommendation** field should state that dedicated workflow orchestration is not applicable for this archetype and does not represent a gap. When the score is 1 for `orchestrator`, explicitly call out that this is an anti-pattern for the archetype and elevate the recommendation priority.

> **Look for:** `aws_sfn_*` in Terraform; Temporal SDK imports; workflow YAML definitions; state machine patterns in code. For archetype detection cross-check: count of downstream service calls, presence of multi-step business operations.

#### INF-Q4: Async Messaging and Streaming

**Question:** Is there managed messaging or streaming infrastructure (SQS, SNS, EventBridge, MSK, Kinesis, Amazon MQ) vs self-managed Kafka/RabbitMQ, or no messaging at all?

**Why it matters:** Managed messaging and streaming enable event-driven architectures with reduced operational overhead. Self-managed message brokers require patching, scaling, and monitoring. However, async is not universally the right answer — synchronous HTTP or gRPC is the correct design for read-only utility services and read-heavy data gateways, and forcing async into those designs adds operational complexity without architectural benefit. This rubric calibrates expectations by archetype so that services scoring 4 reflect the correct design for their role, not a uniform "async everywhere" bar.

> **Note:** This question uses archetype-sensitive calibration. Synchronous HTTP is the correct design for stateless-utility and data-gateway services and scores 4. See the archetype rubric below.

**Archetype Calibration:** This question is archetype-sensitive. Apply the rubric below that matches the detected `service_archetype`. If `repo_type` is not `application` (and therefore no archetype was detected), use the `stateful-crud` column as the default.

| Score | stateless-utility | data-gateway | stateful-crud | orchestrator | event-processor |
|-------|------------------|--------------|---------------|--------------|-----------------|
| **4** | Synchronous HTTP/gRPC is the correct design and is in use; no messaging needed. Any outbound signals (e.g., telemetry) use managed services. | Synchronous reads dominate (correct); any write-back, cache invalidation, or indexing flows use managed messaging. | Managed messaging (SQS, SNS, EventBridge) for cross-service state changes and notifications; synchronous reads where appropriate. | Managed messaging and/or streaming (EventBridge, SQS, MSK, Kinesis) for fan-out and decoupling; Step Functions for coordination. | Managed event source (SQS, Kafka/MSK, Kinesis, EventBridge) with structured consumer patterns. |
| **3** | Sync dominates; a small amount of async exists and is on managed services. | Synchronous dominant with some managed async for auxiliary flows. | Managed messaging for key flows; synchronous HTTP for others where async would genuinely help but is not yet in place. | Managed messaging for some flows; synchronous HTTP or self-managed components for others. | Managed primary event source; some auxiliary flows are self-managed. |
| **2** | Any self-managed messaging is in use without clear need (suggests archetype may be misclassified). | Self-managed messaging for write-back or indexing flows. | Self-managed messaging (Kafka, RabbitMQ on EC2/containers) for cross-service flows. | Self-managed messaging for orchestration fan-out. | Self-managed event broker is primary source. |
| **1** | Self-managed broker used despite no real need — pure overhead. | No async where async would reduce read-path coupling, OR self-managed broker without justification. | No messaging where state changes cross service boundaries — tight synchronous coupling between services that should be decoupled. | Synchronous-only fan-out across 3+ services. This is an anti-pattern for this archetype — cascading failures and timeout amplification are structural risks. | Polling a REST endpoint instead of consuming events (wrong archetype) or no broker at all. |

When the score is 4 for `stateless-utility` or `data-gateway` because synchronous communication is the correct design, the **Finding** field should state that synchronous is appropriate for this archetype and the **Recommendation** should explicitly note that adopting async messaging is NOT recommended — it would add operational complexity without architectural benefit. When the score is 1 for `orchestrator` due to synchronous-only fan-out, flag it as an anti-pattern in the **Gap** field.

> **Look for:** `aws_sqs_*`, `aws_sns_*`, `aws_msk_*`, `aws_kinesis_*`, `aws_eventbridge_*`, `aws_mq_*` in IaC; SDK imports for messaging/streaming (boto3 SQS/SNS, `@aws-sdk/client-sqs`, Kafka/Kinesis clients, ActiveMQ/RabbitMQ clients); event-driven handler patterns; stream consumer patterns; for archetype cross-check: count of downstream service calls, presence of write endpoints, presence of event emission on state changes.

#### INF-Q5: Network Security

**Question:** Are services deployed in a VPC with private subnets, security groups, NACLs, and proper network segmentation?

**Why it matters:** Network segmentation limits blast radius of failures and security incidents. Services exposed directly to the internet without proper network controls are a security and operational risk.

| Score | Criteria |
|-------|----------|
| **4** | Services in private subnets, least-privilege security groups, proper segmentation, and managed networking services in use (VPC endpoints / PrivateLink, VPC Lattice, IPAM for address management, or zero-trust patterns). |
| **3** | Services in private subnets with least-privilege security groups and network segmentation present, but no managed networking services layered on top. |
| **2** | VPC with subnets but some overly permissive rules (0.0.0.0/0 in security groups) or missing segmentation between tiers. |
| **1** | Services deployed in the default VPC or to public subnets without isolation (e.g., public-facing EC2 with 0.0.0.0/0 ingress, no custom VPC). |

> **Look for:** `aws_vpc`, `aws_subnet`, `aws_security_group`; subnet tiers (public vs private); security group rules; overly permissive rules (0.0.0.0/0); default-VPC usage; managed networking signals — `aws_vpc_endpoint`, `aws_vpclattice_*`, `aws_vpc_ipam_*`, AWS PrivateLink configurations.

> **⚠️ Scoring limitation — external context dependency:** VPC, subnet, and security group configurations are often managed in a dedicated infrastructure or networking repository rather than in application repos. The absence of network security IaC in the scanned repository does not confirm that the application runs without network isolation — it may be deployed into a VPC managed elsewhere. A Score of 1 has a moderate false-positive rate for application repos that do not own their networking layer. When `additionalPlanContext` provides network security evidence, use that to override the code-scan result.

#### INF-Q6: API Entry Point

**Question:** Is there an API Gateway, AppSync, ALB, or CloudFront as the entry point vs direct service exposure?

**Why it matters:** A managed entry point provides throttling, authentication, request validation, and a single point of control. Direct service exposure lacks these protections and makes it harder to manage traffic patterns.

| Score | Criteria |
|-------|----------|
| **4** | API Gateway with throttling, auth, and request validation. |
| **3** | ALB or CloudFront with basic routing and health checks. |
| **2** | Load balancer present but minimal configuration (no auth, no throttling). |
| **1** | Services exposed directly with no gateway or load balancer. |

> **Look for:** `aws_api_gateway_*`, `aws_apigatewayv2_*`, `aws_appsync_*`, `aws_lb_*`, `aws_iot_*` in IaC; throttling and auth config on gateway; AppSync schema and resolver configurations; IoT Core topic rules.

#### INF-Q7: Auto-Scaling

**Question:** Are auto-scaling mechanisms configured for compute, database, and other workloads?

**Why it matters:** Without auto-scaling, workloads cannot respond to traffic spikes or scale down during low demand. This leads to either over-provisioning (cost waste) or under-provisioning (degraded experience). Auto-scaling applies beyond compute — DynamoDB capacity, Aurora replicas, ElastiCache shards, and other managed services also benefit from dynamic scaling.

| Score | Criteria |
|-------|----------|
| **4** | All scalable resource types have auto-scaling configured with appropriate min/max — compute (ECS/EKS/EC2 ASG/Lambda concurrency), data (DynamoDB capacity, Aurora replicas), and other managed services where applicable. Mature deployments also use business-metric-driven scaling policies (custom CloudWatch metrics on requests-in-flight, orders-per-second, queue depth) where purely technical metrics (CPU, memory) are insufficient signals of load. |
| **3** | Auto-scaling configured on primary workloads with workload-appropriate thresholds (custom target tracking or step policies) covering both compute and data layers. Auxiliary resources may use static capacity. |
| **2** | Auto-scaling exists but uses only default/out-of-box settings (e.g., default ECS target tracking without tuning), OR coverage is limited to compute with no scaling on data or other managed services. No custom scaling policies or scheduled scaling. |
| **1** | No auto-scaling — all capacity is statically provisioned. |

> **Look for:** `aws_autoscaling_*`, `aws_appautoscaling_*`; scaling policies; min/max capacity settings; Lambda concurrency limits; DynamoDB auto-scaling; Aurora auto-scaling configuration; ElastiCache shard scaling.

#### INF-Q8: Backup and Recovery

**Question:** Are automated backups configured for data stores with defined retention periods and tested restore procedures?

**Why it matters:** Without automated backups and tested restores, a data loss event can wipe application state and cause cascading failures. This is a foundational reliability requirement. (WAF: REL 9)

| Score | Criteria |
|-------|----------|
| **4** | All production data stores have automated backups with defined retention; PITR enabled where supported; restore procedures documented and tested; cross-region backup replication configured for critical data. |
| **3** | Automated backups configured but missing PITR or missing on some data stores; no documented restore testing. |
| **2** | Backups on main production database only; no backup plans for other data stores; no restore testing. |
| **1** | No backup configuration found; or backup_retention_period = 0. |

> **Look for:** `backup_retention_period` on RDS; `point_in_time_recovery` on DynamoDB; `aws_backup_plan` resources; S3 versioning; EBS snapshot lifecycle policies.

#### INF-Q9: High Availability and Fault Isolation

**Question:** Are production workloads deployed across multiple Availability Zones with fault isolation?

**Why it matters:** Single-AZ production deployments are one of the most common high-risk issues. An AZ failure takes down the entire workload with no automatic recovery. Multi-AZ ensures survivability without human intervention. (WAF: REL 10, REL 11)

| Score | Criteria |
|-------|----------|
| **4** | All production compute and data stores span 2+ AZs; load balancers with cross-zone enabled. |
| **3** | Main production database is Multi-AZ; stateful compute or caches are multi-AZ; stateless compute may be single-AZ if replaceable via ASG/service across AZs. |
| **2** | Main production database is single-AZ OR stateful compute is single-AZ; other compute spans multiple AZs but fault isolation is not explicit. |
| **1** | All resources in a single AZ; or no AZ configuration found. |

> **Look for:** `multi_az = true` on RDS; `availability_zones` spanning 2+ AZs in ASGs/ECS; subnet configurations across multiple AZs.

#### INF-Q10: Infrastructure as Code Coverage

**Question:** What percentage of infrastructure is defined in IaC vs manually created?

**Why it matters:** Low IaC coverage means infrastructure changes are manual, error-prone, and non-reproducible. IaC is the foundation for automated deployments, environment consistency, and disaster recovery.

| Score | Criteria |
|-------|----------|
| **4** | 90%+ of infrastructure defined in IaC (compute, networking, databases, messaging, and operational/DR resources — monitoring, alarms, backup plans, health checks). |
| **3** | 70-90% IaC coverage — primary resources covered, some auxiliary resources manual. |
| **2** | Partial IaC — some resources defined, but significant manual infrastructure. |
| **1** | No IaC — all infrastructure created manually (ClickOps). |

> **Look for:** Presence and coverage of .tf files, CDK stacks, CloudFormation templates, Helm charts. Check whether IaC covers compute, networking, databases, messaging, and operational resources (CloudWatch alarms, Route 53 health checks, Backup plans, and other DR-related resources).

> **⚠️ Scoring limitation — external context dependency:** Infrastructure as Code is sometimes maintained in a dedicated infrastructure repository (e.g., a Terraform monorepo or a platform team's CDK project) rather than alongside application source code. The absence of IaC files in the scanned repository does not always confirm that infrastructure is manually provisioned — it may be managed in a separate repo. A Score of 1 has a moderate false-positive rate for application repos in organizations that separate IaC from application code. When `additionalPlanContext` provides IaC evidence (e.g., referencing a companion infra repo), use that to override the code-scan result.

> **Scoring guidance for percentages:** The denominator is "infrastructure resources this service depends on" — compute, networking, databases, messaging, monitoring, DNS, and secrets. Count resource categories with IaC definitions vs those without. If only the repo's own resources are visible (no evidence of external infra), score based on what IS present: if all visible infrastructure has IaC definitions, score 3 (not 4, since unobservable resources may be manual) unless `additionalPlanContext` confirms full coverage.

#### INF-Q11: CI/CD Automation

**Question:** Are CI/CD pipelines automated with build, test, and deploy stages for both application code and infrastructure as code, or are deployments manual?

**Why it matters:** Manual deployments create bottlenecks, are error-prone, and prevent rapid iteration. Automated pipelines enable continuous delivery with consistent quality gates. CI/CD automation alone is not sufficient for modern agent-facing APIs — pipelines must also include security validation (SAST, DAST, dependency scanning). See **SEC-Q7** for the security-pipeline evaluation that pairs with INF-Q11's automation scoring.

| Score | Criteria |
|-------|----------|
| **4** | Full CI/CD automation covering both application code and infrastructure-as-code changes, with test, build, deploy, and automated rollback stages. |
| **3** | CI/CD pipelines exist for application code and IaC with build and deploy stages, but limited automated testing, OR automation on one track (application or IaC) with manual steps on the other. |
| **2** | Partial automation — build is automated but deployment is manual or semi-manual for application code and/or IaC changes. |
| **1** | No CI/CD — all application and infrastructure deployments are manual scripts or ClickOps. |

> **Look for:** .github/workflows/, buildspec.yml, appspec.yml, Jenkinsfile, CodePipeline definitions in IaC; pipeline stages with automated test, build, and deploy steps.


### Step 3: Application Architecture (APP-Q1 through APP-Q6)

These questions evaluate the application's structural maturity, decomposition readiness, and communication patterns. Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If the question is N/A, record it in the N/A display format and skip evaluation.

#### APP-Q1: Programming Languages

**Question:** What programming languages are used and how mature is their ecosystem for cloud-native development?

**Why it matters:** Language choice determines the breadth of AWS SDK support, the depth of cloud-native tooling, and the availability of modern framework ecosystems. Languages with first-class AWS SDK coverage and mature cloud-native libraries enable faster modernization; languages with narrower AWS tooling require more custom integration work to reach the same outcomes. Within a given language, the version/framework/SDK combination matters too — modern Java with a current Spring Boot and AWS SDK v2 is materially different from Java 8 with Spring Boot 2.1 and SDK v1, and modern .NET (Core/.NET 6+) is materially different from .NET Framework 4.x.

> **Two-axis calibration:** Score based on both (a) *language/runtime modernity* and (b) *framework/SDK modernity*. A modern language version with lagging framework/SDK lands in Score 3; compound regression across both axes lands in Score 2.

| Score | Criteria |
|-------|----------|
| **4** | Modern cloud-native language at a current version with matching modern framework and SDK. Examples: Python 3.10+, Node.js 18+ / TypeScript, Go 1.20+, Java 17+ / Kotlin with Spring Boot 3.x and AWS SDK v2; modern .NET (6/7/8/9/10) with current ASP.NET Core and AWS SDK for .NET v3. First-class AWS SDK coverage, broad cloud-native tooling, mature framework ecosystems. |
| **3** | Cloud-native language at a modern version but with **framework or SDK lag** — e.g., Java 17 on Spring Boot 2.7, Node.js 18+ on Express with AWS SDK v2 partial adoption, Python 3.10+ on an older web framework, or Rust (good AWS SDK coverage but narrower cloud-native tooling ecosystem). Language choice is not the blocker; modernization is an SDK/framework upgrade. |
| **2** | Compound legacy signals — **language version AND framework AND SDK all regressed**. Examples: Java 8 with Spring Boot 2.x and AWS SDK v1; .NET Framework 4.x with legacy ASP.NET (pre-Core) and AWS SDK for .NET v2 or older; Python 2.x; end-of-life Node.js with an unsupported framework. Also includes PHP, Ruby, or Perl — functional AWS SDK but limited cloud-native tooling depth regardless of version. These require a version upgrade in addition to framework/SDK modernization. |
| **1** | Languages with limited or no AWS SDK and effectively no cloud-native tooling (e.g., COBOL, VB6, Classic ASP, PowerBuilder) — requires custom integration or migration planning for cloud services. |

> **Look for:** File extensions; dependency manifests (package.json, requirements.txt, pom.xml/build.gradle, go.mod, *.csproj). Record the *version* alongside the language (e.g., `Java 8` vs `Java 17`, `.NET Framework 4.8` vs `.NET 8`), the framework version (Spring Boot 2.1 vs 3.x, ASP.NET Framework vs ASP.NET Core), and the AWS SDK major version (v1 vs v2 for Java/JS, v2 vs v3 for .NET) — all three axes drive the score.

#### APP-Q2: Monolith vs Microservices

**Question:** Is the application a single deployable unit or multiple independently deployable services?

**Why it matters:** Monoliths limit independent scaling, deployment, and team autonomy. Understanding the current decomposition state and coupling level determines the modernization strategy — containerize, migrate to serverless (Lambda), strangler fig extraction, or full decomposition.

| Score | Criteria |
|-------|----------|
| **4** | Microservices or modular monolith with well-defined module boundaries, no circular dependencies, clear interfaces. |
| **3** | Modular monolith with separate schemas per module (or per-service databases), clear module interfaces, no circular dependencies. OR: microservices that share a database instance but use separate schemas. |
| **2** | Monolith with identifiable modules but shared database schemas, direct cross-module data access, or circular call dependencies between modules. |
| **1** | Tightly-coupled monolith with no clear module boundaries, pervasive shared state. |

> **Look for:** Single deployable vs multiple service directories; Helm charts for multiple services; Docker Compose with multiple services; IaC for multiple ECS tasks or Lambda functions. For monoliths: package/module structure, dependency graphs, circular dependencies, shared mutable state, database coupling.

> **Scoring guidance for Score 2 vs 3 boundary:** The key differentiator is *database schema isolation*. Score 3 requires that modules/services own their data — either separate databases or separate schemas within the same instance where cross-schema access is via API, not direct table joins. Score 2 applies when modules share tables, use cross-module foreign keys, or access each other's data via direct SQL rather than through defined interfaces. If the evidence is ambiguous (single database but you cannot determine whether cross-module queries exist), default to Score 2.

#### APP-Q3: Async vs Sync Communication

**Question:** What percentage of inter-service communication is asynchronous vs synchronous HTTP?

**Why it matters:** Synchronous-only architectures create tight coupling, cascading failures, and timeout risks. Async patterns enable decoupling, resilience, and better handling of variable-latency operations. However, the correct async/sync ratio depends on what the service does. A pure utility or read-heavy data gateway has no inherent need for async communication — forcing it in would be complexity for its own sake. An orchestrator or event-processor with primarily synchronous coupling, in contrast, is an anti-pattern for its archetype.

> **Note:** This question uses archetype-sensitive calibration. A `stateless-utility` where sync is the correct design records as "Not Evaluated (archetype-N/A)" rather than defaulting to Score 4. See the archetype rubric below.

**Archetype Calibration:** This question is archetype-sensitive. Apply the rubric below that matches the detected `service_archetype`. If `repo_type` is not `application` (and therefore no archetype was detected), use the `stateful-crud` column as the default.

> **Not Evaluated (archetype-N/A) rule:** If the resolved archetype column indicates the question does not apply (for APP-Q3 this is `stateless-utility` Score 4: "Sync request/response is the correct design; async not needed"), record the question as **"Not Evaluated (archetype-N/A)"** and exclude it from category and overall score averaging. Do not report a default Score 4.

| Score | stateless-utility | data-gateway | stateful-crud | orchestrator | event-processor |
|-------|------------------|--------------|---------------|--------------|-----------------|
| **4** | Sync request/response is the correct design; async not needed → **Not Evaluated (archetype-N/A)**. | Sync reads are correct; any write-back, cache invalidation, or indexing uses async. | 50%+ async for cross-service state propagation, or async available for all long-running operations. | Async dominates for fan-out; sync reserved for reads and fast-returning calls. | Primary input is async (event/queue); any outbound calls are async where appropriate. |
| **3** | — | Sync-dominant with async available for auxiliary flows that need it. | Mix of async and sync with async for key workflows. | Mix of async and sync; primary workflows async, some fan-out still sync. | Async input; some sync outbound calls that could be async. |
| **2** | — | Sync-only with no async path for flows that would benefit (e.g., reindexing blocks read traffic). | Primarily synchronous with some async for background jobs. | Primarily synchronous fan-out with limited async. | Mixed input model with significant sync coupling. |
| **1** | Sync with no ability to add async where rare outbound signals would genuinely benefit. | Sync-only across all paths with visible queueing or timeout issues. | All communication synchronous HTTP with no async patterns. | Synchronous-only fan-out across 3+ services — cascading failure risk. Anti-pattern for this archetype. | Entirely synchronous (polling loops, sync RPCs) — archetype mismatch. |

When the score is 4 for `stateless-utility` or `data-gateway` because synchronous is the correct design, the **Finding** should state this explicitly and the **Recommendation** should NOT propose converting to async. When the score is 1 for `orchestrator` or `event-processor`, flag it as an archetype anti-pattern in the **Gap** field.

> **Look for:** HTTP client calls (axios, requests, RestTemplate, fetch, gRPC stubs) vs message publishing patterns; event-driven handlers; queue consumers; Lambda event source mappings. Cross-check: count of downstream calls and whether they are unary vs fire-and-forget.

#### APP-Q4: Long-Running Process Handling

**Question:** Are operations over 30 seconds handled asynchronously with status polling or callbacks?

**Why it matters:** Blocking calls for long-running operations create timeout risks, poor user experience, and resource waste. Async patterns with status tracking enable better resource utilization and user feedback. However, many services have no operations that exceed 30 seconds — a pure utility doing stateless computation or a data-gateway doing indexed reads has no long-running work to offload. In those cases, this question is not a gap and should not drive a recommendation.

> **Note:** This question uses archetype-sensitive calibration. A `stateless-utility` with no long-running operations records as "Not Evaluated (archetype-N/A)" rather than defaulting to Score 4. See the archetype rubric below.

**Archetype Calibration:** This question is archetype-sensitive. Apply the rubric below that matches the detected `service_archetype`. If `repo_type` is not `application` (and therefore no archetype was detected), use the `stateful-crud` column as the default.

> **Not Evaluated (archetype-N/A) rule:** If the resolved archetype column indicates the question does not apply (for APP-Q4 this is `stateless-utility` Score 4: "No operations exceed 30 seconds — not applicable by design"), record the question as **"Not Evaluated (archetype-N/A)"** and exclude it from category and overall score averaging. Do not report a default Score 4.

| Score | stateless-utility | data-gateway | stateful-crud | orchestrator | event-processor |
|-------|------------------|--------------|---------------|--------------|-----------------|
| **4** | No operations exceed 30 seconds — not applicable by design → **Not Evaluated (archetype-N/A)**. | No user-facing operations exceed 30 seconds; any heavy reindexing or export jobs are async with status polling. | All operations over 30 seconds implemented as async jobs with status polling or callbacks. | All long-running coordination uses Step Functions, polling, or callback patterns. | Event handlers are async by design; long-running processing within a handler uses checkpointing or sub-workflows. |
| **3** | — | Most heavy operations are async; a rarely-hit export path may still block. | Most long-running operations async; some blocking calls remain. | Most long-running coordination async; edge cases still block. | Most handlers safely bounded; a few may exceed timeout without checkpointing. |
| **2** | — | Some heavy reads are synchronous and risk timeout. | Some background job processing but inconsistent patterns. | Some long-running coordination still blocks with risk of timeout. | Handlers occasionally exceed timeout; retries cause duplicate side effects. |
| **1** | A synchronous operation exceeding 30 seconds exists, contradicting the utility framing (archetype likely misclassified). | Unbounded synchronous queries blocking the read path. | All operations synchronous regardless of duration. | All long-running coordination synchronous — caller must hold connection open. | Handlers routinely exceed timeout with no checkpointing — processing lost on retry. |

When the score is 4 for `stateless-utility` or `data-gateway` because no long-running operations exist, the **Finding** should state this and the **Recommendation** should note that async job infrastructure is not applicable for the current surface. This question should not trigger a pathway recommendation in that case.

> **Look for:** Background job frameworks (Celery, Bull, SQS workers); async/polling patterns; job status APIs; Lambda async invocations; Step Functions for long processes. Cross-check: existence of operations whose latency is data-volume or network-dependent (batch exports, bulk updates, external provider calls with variable SLA).

#### APP-Q5: API Versioning Strategy

**Question:** Is there a consistent API versioning strategy (URL paths, headers, query parameters)?

**Why it matters:** Without versioning, API changes break all consumers simultaneously. Versioning enables graceful migration and backward compatibility.

| Score | Criteria |
|-------|----------|
| **4** | Consistent versioning strategy with backward compatibility guarantees. |
| **3** | Versioning strategy exists and is applied to most endpoints (e.g., /v1/ paths, version headers), but some newer or internal endpoints don't follow the convention. |
| **2** | Versioning applied ad hoc — fewer than half of endpoints use versioning, or multiple conflicting versioning schemes coexist (e.g., some use URL paths, others use headers). |
| **1** | No versioning — breaking changes deployed directly. |

> **Look for:** /v1/, /v2/ URL patterns; Accept-Version headers; versioning annotations; changelog files.

#### APP-Q6: Service Discovery

**Question:** Is there a service registry, API catalog, or service mesh for service-to-service communication?

**Why it matters:** Hard-coded service endpoints create deployment coupling and make it difficult to scale, relocate, or replace services. Service discovery enables dynamic routing and decoupled deployments.

| Score | Criteria |
|-------|----------|
| **4** | Service discovery mechanism present; no hard-coded service endpoints. |
| **3** | Partial service discovery — some services use discovery, others use hard-coded endpoints. |
| **2** | Environment variables for endpoints but no dynamic discovery. |
| **1** | All service endpoints hard-coded in application code or configuration. |

> **Look for:** AWS Service Discovery, Istio, Consul; API Gateway as catalog; environment variables with hard-coded endpoints vs service discovery.


### Step 4: Data Platform Modernization (DATA-Q1 through DATA-Q4)

These questions evaluate the data layer's modernization state — managed services, schema health, and migration readiness. Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If the question is N/A, record it in the N/A display format and skip evaluation.

#### DATA-Q1: Unstructured Data Storage

**Question:** Are documents and unstructured data stored in managed object storage (S3) with parsing capabilities (Textract, Tika)?

**Why it matters:** Unstructured data locked in file systems, local storage, or legacy document management systems is inaccessible for modern workloads. S3 with parsing pipelines enables search, analytics, and AI integration. Assessing current access patterns (frequency, size, format) helps identify S3 adoption opportunities and migration paths.

| Score | Criteria |
|-------|----------|
| **4** | Unstructured data stored in S3 with parsing pipeline available. |
| **3** | Data in S3 but no automated parsing or extraction pipeline. |
| **2** | Data in managed storage but not S3 (EFS, EBS volumes) with limited accessibility. Note: Amazon S3 File Gateway (mountable S3 access) can bridge filesystem-dependent applications without data duplication. |
| **1** | Data on local file systems, legacy document management, or inaccessible storage. |

> **Look for:** `aws_s3_bucket`; Textract calls; document parsing libraries; PDF/image processing.

#### DATA-Q2: Unified Data Access Layer

**Question:** Is there a unified data access layer vs scattered database connections throughout the code?

**Why it matters:** Scattered data access means multiple integration points, inconsistent query patterns, and difficulty enforcing data contracts. A unified layer provides a single point of control for data access.

| Score | Criteria |
|-------|----------|
| **4** | Unified data access layer; single point of data contract. |
| **3** | Mostly centralized with some direct access in auxiliary code paths. |
| **2** | Repository/DAO pattern in some modules but inconsistent across the codebase. |
| **1** | Database imports and queries scattered across many modules with no pattern. |

> **Look for:** Centralized repository/DAO layer vs database imports spread across many modules; data access pattern consistency.

#### DATA-Q3: Database Engine Version and EOL

**Question:** Does IaC or deployment configuration specify the database engine version, and have any engines approaching or past end-of-life (EOL) been identified?

**Why it matters:** EOL database engines introduce security vulnerabilities and lack modern features. Unversioned or implicitly-latest configurations are also a risk signal. Engine version awareness is a prerequisite for migration planning.

| Score | Criteria |
|-------|----------|
| **4** | All database engine versions explicitly pinned in IaC; no engines at or past EOL; documented version-update procedure exists covering downtime windows, rollback, and risk acknowledgment. |
| **3** | Versions pinned but some approaching EOL within 12 months. |
| **2** | Some versions pinned, others implicit; EOL status unknown. |
| **1** | No version pinning; engines at or past EOL detected. |

> **Look for:** Engine version parameters in `aws_rds_instance`, `aws_docdb_cluster`, `aws_elasticache_*`; engine version strings in docker-compose or Helm values; absence of explicit version pinning.

#### DATA-Q4: Stored Procedures and Schema Complexity

**Question:** Does the application rely on stored procedures, triggers, or proprietary SQL constructs (e.g., T-SQL, PL/SQL)?

**Why it matters:** Stored procedures and proprietary SQL tightly couple business logic to the database engine, creating migration blockers. High stored procedure usage signals that database modernization will require significant effort beyond a lift-and-shift — logic extraction and schema refactoring become prerequisites.

| Score | Criteria |
|-------|----------|
| **4** | No stored procedures or proprietary SQL; all business logic in application layer. |
| **3** | Minimal stored procedures for performance-critical operations only. |
| **2** | Moderate stored procedure usage with some proprietary SQL constructs. |
| **1** | Heavy reliance on stored procedures, triggers, and proprietary SQL across the application. |

> **Look for:** `.sql` files containing `CREATE PROCEDURE`, `CREATE TRIGGER`, `CREATE FUNCTION`; ORM bypass patterns (raw SQL execution); references to proprietary SQL dialects in migration files.


### Step 5: Security Baseline (SEC-Q1 through SEC-Q7)

These questions evaluate the foundational security posture required for any modernization initiative. Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If the question is N/A, record it in the N/A display format and skip evaluation.

#### SEC-Q1: Audit Logging

**Question:** Is CloudTrail enabled with immutable logs?

**Why it matters:** Audit logging is a compliance and operational requirement for any production system. Immutable logs ensure that actions can be traced and forensic analysis is possible after incidents.

| Score | Criteria |
|-------|----------|
| **4** | CloudTrail enabled with log file validation and immutable storage (S3 Object Lock). |
| **3** | CloudTrail enabled but without immutable storage or log validation. |
| **2** | Partial logging — some services logged, others not. |
| **1** | No CloudTrail or equivalent audit logging. |

> **Note:** This question is **surface-gated** (Step 1.6). Evaluate SEC-Q1 only when the repo contains **account/foundation-level IaC** (CloudTrail, AWS Config, GuardDuty, Organization SCPs, centralized logging). Application-level IaC repos (ECS tasks, RDS instances, Lambda functions for a single service) are **Not Evaluated** — CloudTrail is an account-level concern that belongs in the foundation infrastructure repo, not in each application repo. See "SEC-Q1 Account-Level Scope Determination" in Step 1.6 for the full decision logic.

> **Look for:** `aws_cloudtrail` in IaC; CloudTrail log file validation enabled; S3 bucket with object lock for logs; CloudWatch log retention policies.

> **⚠️ Scoring limitation — external context dependency:** CloudTrail is an AWS account-level service typically configured once per account or organization, not per-application repository. This question is surface-gated — only repos with account/foundation-level IaC are evaluated (see gate note above). Even when evaluated, the absence of `aws_cloudtrail` in a foundation IaC repo may indicate it's managed at the organization level rather than per-account. When `additionalPlanContext` provides audit logging evidence (e.g., confirming account-level CloudTrail exists), use that to override the code-scan result.

#### SEC-Q2: Encryption at Rest

**Question:** Is KMS used for sensitive data at rest?

**Why it matters:** Encryption at rest is a baseline security requirement. Customer-managed KMS keys provide control over key rotation, access policies, and audit trails.

> **Note:** This question is **surface-gated** (Step 1.6). If `has_at_rest_data_surface` is `false` — the system has no deployed data-at-rest surface (no database, S3 bucket, EBS volume, EFS file system, or similar managed storage) — record the question as **"Not Evaluated (archetype-N/A)"** and skip evaluation. A library or CLI tool with no runtime state to encrypt should not receive Score 1 for "no encryption at rest."

| Score | Criteria |
|-------|----------|
| **4** | Customer-managed KMS keys for all sensitive data stores, with centralized key management and documented rotation policy. |
| **3** | Customer-managed KMS keys on most sensitive data stores, OR AWS-managed encryption enabled across all data stores. Rotation may not be defined. |
| **2** | Mix of encryption types with coverage gaps — some data stores have customer-managed keys, others use AWS-managed, and at least one sensitive data store has no encryption configured. |
| **1** | No encryption at rest configured. |

> **Look for:** `kms_key_id` on S3/RDS/DynamoDB/EBS; `aws_kms_key` resources; encryption config on data stores.

#### SEC-Q3: API Authentication

**Question:** Is there per-request authentication with OAuth2/JWT on all API endpoints?

**Why it matters:** Unauthenticated APIs are a security vulnerability. Per-request authentication ensures that every call is authorized and attributable.

| Score | Criteria |
|-------|----------|
| **4** | All API endpoints use token-based auth (OAuth2/JWT); intentionally public endpoints protected by API Gateway with throttling and validation. |
| **3** | Token-based auth (OAuth2/JWT) on all external endpoints. Internal/private-subnet endpoints may lack auth if network isolation is enforced (security groups, VPC endpoints). |
| **2** | API key or static credential authentication without token-based auth. OR: token-based auth on fewer than half of endpoints. |
| **1** | No API authentication — endpoints are open. |

> **Look for:** Auth middleware; API Gateway authorizers; Cognito user pools; OAuth2 flows; Bearer token validation; @Authenticated annotations.

#### SEC-Q4: Centralized Identity Integration

**Question:** Does the application integrate with a centralized identity provider (Cognito, Okta, Ping), or does it manage its own authentication independently?

**Why it matters:** Applications with their own auth systems create inconsistency and increase attack surface. Detecting whether the app integrates with a centralized IdP signals modernization maturity. Apps with standalone auth are harder to integrate into unified access policies.

| Score | Criteria |
|-------|----------|
| **4** | Application integrates with centralized IdP; SSO enabled. |
| **3** | Application uses centralized IdP for most flows; some legacy auth paths remain. |
| **2** | Application has its own auth but can federate with external IdPs. |
| **1** | Application manages its own authentication entirely with no external IdP integration. |

> **Look for:** `aws_cognito_*`; OIDC/SAML configuration; identity provider federation; SSO configuration.

#### SEC-Q5: Secrets Management

**Question:** Are secrets (database credentials, API keys, tokens) managed through a dedicated secrets management system (AWS Secrets Manager, HashiCorp Vault) with rotation, or are they hardcoded in code, environment variables, or configuration files?

**Why it matters:** Hardcoded secrets are a critical security vulnerability and a common finding in legacy applications. Secrets management with rotation and audit trails is a baseline security requirement for any production system, not just agentic workloads. The presence of plaintext credentials anywhere in the repository — source code, application configs, or version-controlled env files — is a materially different posture than a system that uses parameter store or env vars without rotation, even when some secrets are already in a managed store. Score 1 reflects any plaintext credential presence; Score 2 reflects no-plaintext but no-rotation; Score 3 reflects managed secrets with rotation.

| Score | Criteria |
|-------|----------|
| **4** | All secrets in Secrets Manager or Vault with automated rotation configured; no hardcoded credentials; no production credentials in environment variables or parameter store without encryption. |
| **3** | Secrets Manager or Vault used for all production credentials (database passwords, API keys, service tokens) with automated rotation configured on at least the highest-risk secrets. Some non-critical configs (feature flags, non-secret configuration) may still be in environment variables. No plaintext credentials in source. |
| **2** | No plaintext credentials in source or version control, but production credentials are kept in environment variables, parameter store without encryption, or CloudFormation `NoEcho` parameters. Rotation is not configured. Includes cases where *some* secrets are in Secrets Manager/Vault but at least one production credential is still in plain env vars or unencrypted parameter store. |
| **1** | Plaintext credentials present anywhere in the repository — source files, application configs, version-controlled env files (`.env`, `application.properties`, `application.yaml`), or connection strings in IaC without parameter/secret references. Score 1 applies even when a secrets manager exists elsewhere in the system, because any plaintext secret is a deployment-blocking issue. |

> **Look for:** `aws_secretsmanager_*` in IaC; Vault client imports; hardcoded patterns (`password=`, `secret=`, `api_key=`, `DB_PASSWORD=` values in code, YAML, `.env`, `.properties`); `.env` or `application.properties` files committed to git; connection strings with embedded credentials. For Score 2/3 differentiation, also check: whether parameter store usage references KMS-encrypted `SecureString` vs plain `String`; whether Secrets Manager resources have `rotation_lambda_arn` or `rotation_rules` attached; whether the `NoEcho` parameters in CloudFormation are backed by Secrets Manager at runtime.

#### SEC-Q6: Compute Hardening and Patching

**Question:** Are compute resources hardened with managed patching and vulnerability scanning?

**Why it matters:** Unpatched compute resources are high-value targets. Managed patching and vulnerability scanning are baseline security requirements. (WAF: SEC 6)

| Score | Criteria |
|-------|----------|
| **4** | SSM Patch Manager or equivalent configured; vulnerability scanning (Inspector/Snyk) enabled; hardened base images. |
| **3** | Some patching automation but not comprehensive; or vulnerability scanning present but not integrated into CI/CD. |
| **2** | Manual patching process; default AMIs with no hardening. |
| **1** | No evidence of patching strategy; no vulnerability scanning. |

> **Look for:** SSM Agent in user-data; `aws_ssm_patch_baseline`; AWS Inspector or Snyk; hardened AMI references (CIS, Bottlerocket); EC2 Image Builder pipelines.

#### SEC-Q7: Application Security Pipeline

**Question:** Are SAST, DAST, or dependency vulnerability scanning tools integrated into the CI/CD pipeline?

**Why it matters:** Without automated security scanning, vulnerabilities in dependencies or application code reach production undetected. Embedding security validation in the pipeline is a baseline practice. (WAF: SEC 11)

| Score | Criteria |
|-------|----------|
| **4** | SAST + dependency scanning in CI/CD with security gates blocking on critical findings; container scanning if applicable. |
| **3** | At least one scanning tool in CI/CD but missing container scanning or no blocking gate. |
| **2** | Dependency scanning configured (e.g., Dependabot, npm audit) and running, but no SAST tool. OR: SAST tool configured but only runs on-demand, not in every pipeline execution. |
| **1** | No security scanning tools configured — no Dependabot, no SAST, no container scanning. Pipeline has no security validation step. |

> **Look for:** SonarQube, Semgrep, CodeGuru Reviewer in CI/CD; Dependabot config; `npm audit` or `pip-audit` in pipeline; ECR image scanning; `.snyk` policy files.


### Step 6: Operations & Observability (OPS-Q1 through OPS-Q9)

These questions evaluate the operational maturity and observability practices that support reliable, evolvable systems. Before evaluating each question, check the N/A mapping for the resolved `repo_type`. If the question is N/A, record it in the N/A display format and skip evaluation.

#### OPS-Q1: Distributed Tracing

**Question:** Is distributed tracing (X-Ray, OpenTelemetry, or partner solution) instrumented with trace ID propagation across service boundaries?

**Why it matters:** Without end-to-end tracing, debugging failures across service boundaries is guesswork. Distributed tracing is foundational for understanding request flows, identifying bottlenecks, and diagnosing production issues in any distributed system.

| Score | Criteria |
|-------|----------|
| **4** | End-to-end distributed tracing with propagated trace IDs across all service boundaries. |
| **3** | Tracing on primary services; some gaps in propagation. |
| **2** | Basic tracing on individual services but no cross-service propagation. |
| **1** | No distributed tracing instrumented. |

> **Look for:** OpenTelemetry SDK in dependency manifests, X-Ray instrumentation, traceparent/X-Amzn-Trace-Id header propagation.

#### OPS-Q2: SLO Definitions

**Question:** Are SLOs defined for critical user journeys?

**Why it matters:** Without SLOs, you cannot measure whether the system is meeting user expectations or degrading over time. SLOs drive prioritization of operational improvements and modernization investments.

| Score | Criteria |
|-------|----------|
| **4** | SLOs defined and monitored for all critical user-facing journeys with error budgets. |
| **3** | SLOs defined for primary journeys; monitoring in place but no error budget tracking. |
| **2** | Basic availability/latency alarms but no formal SLO definitions. |
| **1** | No SLOs — no formal definition of acceptable service levels. |

> **Note:** This question is **surface-gated** (Step 1.6). If `has_api_surface` is `false` AND `has_persistent_data_store` is `false` — the system has no user-facing surface for which SLOs are meaningful — record the question as **"Not Evaluated (archetype-N/A)"** and skip evaluation.

> **Look for:** SLO definitions in code or config; CloudWatch alarms on p99/p95 latency; error budget tracking; SLO dashboards.

> **⚠️ Scoring limitation — external context dependency:** SLO definitions typically reside in external monitoring platforms (CloudWatch, Datadog, Grafana, PagerDuty) rather than in source code or IaC. A Score of 1 on this question indicates that no SLO evidence was found *in the repository being scanned* — it does not confirm that SLOs are absent from the operational environment. This question has a high false-positive rate for code-only analyses. When `additionalPlanContext` provides SLO evidence (e.g., via a future `external_observability` field), use that to override the code-scan result. This question is classified as **non-core (P2)** because the absence of in-repo SLO artifacts is not a reliable signal of operational immaturity.

> **Scoring guidance for code-only analyses:** Score 2 (not 1) when CloudWatch alarms on latency/error-rate exist in IaC even without formal SLO naming — the presence of threshold-based alarms implies implicit SLOs. Score 1 only when NO monitoring artifacts exist at all. This prevents systematic Score-1 inflation across portfolios where SLO tooling lives externally.

#### OPS-Q3: Business Metrics

**Question:** Are custom metrics published for business outcomes, not just infrastructure metrics?

**Why it matters:** Infrastructure metrics (CPU, memory) tell you if the system is running, not if it's delivering value. Business metrics (conversion rates, resolution times, error rates by feature) drive informed modernization decisions.

| Score | Criteria |
|-------|----------|
| **4** | Business outcome metrics published alongside infrastructure metrics with dashboards. |
| **3** | Some business metrics tracked but not systematically across all features. |
| **2** | Infrastructure metrics only with ad hoc business reporting. |
| **1** | No custom metrics — only default CloudWatch infrastructure metrics. |

> **Look for:** `cloudwatch.put_metric_data` for business events; custom dashboards; business KPI alarms.

#### OPS-Q4: Anomaly Detection and Alerting

**Question:** Is there anomaly detection or alerting on error rates and latency?

**Why it matters:** Static threshold-based alerting misses gradual degradation and novel failure modes. Anomaly detection catches unexpected behavior patterns that fixed thresholds cannot.

| Score | Criteria |
|-------|----------|
| **4** | Anomaly detection enabled on error rates and latency for all critical paths. |
| **3** | Anomaly detection on primary paths; static thresholds on secondary paths. |
| **2** | Static threshold alarms only (e.g., CPU > 80%, error rate > 5%). |
| **1** | No alerting configured. |

> **Look for:** CloudWatch anomaly detection; error rate alarms; latency p99 alarms; PagerDuty/OpsGenie integration; composite alarms.

#### OPS-Q5: Deployment Strategy

**Question:** Is the deployment strategy blue/green, canary, or straight to production?

**Why it matters:** Direct-to-production deployments with no staged rollout eliminate the window to catch regressions before they affect all users. Canary and blue/green deployments enable safe, incremental releases.

| Score | Criteria |
|-------|----------|
| **4** | Canary or blue/green deployments; no direct-to-production releases. |
| **3** | Blue/green for primary services; direct deployment for auxiliary services. |
| **2** | Rolling deployments with basic health checks but no traffic shifting. |
| **1** | Direct-to-production deployment with no staged rollout. |

> **Note:** This question is **surface-gated** (Step 1.6). If `has_deployed_workload` is `false` — the repo has no Dockerfile with deployment manifests, no IaC defining compute, and no deployment configuration — record the question as **"Not Evaluated (archetype-N/A)"** and skip evaluation. A source-code-only repo whose deployment is managed in a separate GitOps or deployment-config repo should not receive Score 1 for "no deployment strategy."

> **Look for:** CodeDeploy deployment config; Helm canary; Argo Rollouts; Lambda traffic shifting; ALB weighted target groups; feature flags.

> **⚠️ Scoring limitation — external context dependency:** Deployment strategies are frequently configured in external systems (AWS CodeDeploy, ArgoCD, Spinnaker, Flux CD) or in separate deployment/GitOps repositories rather than in the application source repo. This question is surface-gated by `has_deployed_workload` — repos without deployment artifacts are Not Evaluated. For repos that DO have deployment artifacts, the absence of canary/blue-green evidence does not confirm that deployments are direct-to-production — deployment orchestration may exist in a separate system. When `additionalPlanContext` provides deployment strategy evidence, use that to override the code-scan result.

#### OPS-Q6: Integration Testing

**Question:** Are there integration tests for critical workflows that run in the CI pipeline?

**Why it matters:** Unit tests alone don't catch integration failures — broken API contracts, database schema drift, or misconfigured infrastructure. Integration tests validate that the system works end-to-end.

| Score | Criteria |
|-------|----------|
| **4** | Integration test suites covering all critical workflows, run in CI pipeline. |
| **3** | Integration tests for primary workflows; some gaps in coverage. |
| **2** | Some integration tests but not run consistently in CI. |
| **1** | No integration tests — only unit tests or no automated tests at all. |

> **Look for:** Integration test directories; test containers; pytest-integration; API test suites (Postman/Newman); contract tests; end-to-end test pipelines in CI.

#### OPS-Q7: Incident Response Automation

**Question:** Are incident response workflows automated, and do runbooks exist in machine-readable or structured form?

**Why it matters:** Manual incident response is slow and error-prone. Automated runbooks and self-healing patterns reduce mean-time-to-recovery and free teams to focus on prevention rather than firefighting.

| Score | Criteria |
|-------|----------|
| **4** | Self-healing automation resolves a defined class of incidents without human intervention; runbooks are versioned and machine-readable. |
| **3** | Automated runbooks for common incidents; manual escalation for complex ones. |
| **2** | Runbooks exist as documentation but are not automated. |
| **1** | No runbooks — incident response is entirely ad hoc. |

> **Look for:** Runbook files (markdown, YAML, JSON); Systems Manager Automation documents; Lambda-based remediation; Step Functions for incident workflows; self-healing patterns.

#### OPS-Q8: Observability Ownership

**Question:** Does the application have defined observability ownership — service-level dashboards, alarms with named owners, and SLO definitions tied to specific teams?

**Why it matters:** Without clear ownership of observability assets, monitoring gaps emerge. Detecting whether the repo has CODEOWNERS for observability configs, named alarm owners, or team-specific dashboards signals operational maturity.

| Score | Criteria |
|-------|----------|
| **4** | Per-service dashboards and alarms with named owners; SLO definitions with team attribution. |
| **3** | Dashboards and alarms exist for most services; some gaps in ownership attribution. |
| **2** | Ad hoc observability — alarms exist but no clear ownership or team attribution. |
| **1** | No observability ownership — monitoring is reactive and fragmented. |

> **Look for:** SLO definition files with named owners; CODEOWNERS referencing observability assets; per-service dashboards and alarms; team tags on CloudWatch resources.

#### OPS-Q9: Resource Tagging Governance

**Question:** Are AWS resources consistently tagged for cost allocation, ownership, and environment identification?

**Why it matters:** Without consistent tagging, organizations cannot track costs per workload, identify resource ownership during incidents, or enforce budget controls. Tagging is foundational to cloud financial management and blast radius analysis. (WAF: COST 1-3)

| Score | Criteria |
|-------|----------|
| **4** | All resources tagged with consistent keys; tag enforcement via IaC (required tags in modules) combined with Tag Policies in AWS Organizations and AWS Config rules; cost allocation tags activated. |
| **3** | Most resources tagged but inconsistent key naming or missing on some resource types; no enforcement. |
| **2** | Some resources tagged but many untagged; no tagging standard. |
| **1** | No tags found on resources; or only Name tags with no cost/ownership attribution. |

> **Look for:** `default_tags` in Terraform provider; `tags` on resources; `required-tags` Config rules; Tag Policies in AWS Organizations. SCPs are generally not recommended for tag enforcement — per-service action variance and policy-size limits make them unreliable for tagging; reserve SCPs for security guardrails.


### Step 7: Evaluate AWS Modernization Pathways

After scoring all 37 questions in Steps 2–6, evaluate each of the 7 AWS Modernization Pathways. Each pathway has defined trigger conditions mapped to specific MOD question IDs and contextual guards that prevent false positives. Multiple pathways can be triggered simultaneously.

For each pathway, determine its status:

- **Triggered** — All trigger conditions are met AND the contextual guard does not prevent it.
- **Not Triggered** — One or more trigger conditions are not met, or the contextual guard prevents it.
- **Not Applicable** — The pathway is in the N/A pathway set for the detected `repo_type` (see N/A Pathway Mappings in the N/A Mapping section above).

#### 7.0 Check N/A Pathway Mappings

Before evaluating any pathway, check the `repo_type` against the N/A Pathway Mappings table. If a pathway is N/A for the detected repo_type, record it directly in the pathway summary table as:

| Field | Value |
|-------|-------|
| **Status** | Not Applicable |
| **Reason** | This is a `{repo_type}` repository. This pathway does not apply. |
| **Priority** | — |
| **Est. Effort** | — |

Do not evaluate trigger conditions for N/A pathways. Proceed to evaluate only the applicable pathways below.

#### 7.1 Move to Cloud Native

**Pathway:** Decompose monolith applications into loosely coupled distributed architectures using microservices, serverless, and event-driven patterns.

**Trigger Conditions:**

| Condition | Question ID | Threshold | Description |
|-----------|-------------|-----------|-------------|
| Primary | APP-Q2 | < 3 | Application is a monolith or tightly coupled — not yet decomposed into independently deployable services. |
| Supporting | INF-Q1 | < 3 | Compute is primarily EC2-based with limited managed container orchestration or serverless adoption. |
| Supporting | APP-Q3 | < 3 | Inter-service communication is primarily synchronous HTTP with limited async patterns. |
| Supporting | APP-Q4 | < 3 | Long-running operations are handled synchronously with no async job processing. |

**Trigger Logic:** Triggered when APP-Q2 < 3 (primary trigger) AND at least one supporting condition is also met (INF-Q1 < 3, APP-Q3 < 3, or APP-Q4 < 3).

**Contextual Guard:** None — if the application is a monolith with supporting infrastructure gaps, this pathway is relevant regardless of other factors. Note that with archetype calibration applied in Steps 3–4, APP-Q3 and APP-Q4 will not score below 3 purely because a service is synchronous-by-design (e.g., `stateless-utility`, `data-gateway`), so those supporting triggers naturally reflect genuine async-readiness gaps rather than archetype mismatches.

**Priority:** High — monolith decomposition is typically the highest-impact modernization initiative.
**Est. Effort:** High — decomposition requires architectural redesign, service boundary identification, data separation, and incremental migration.

**When Triggered, Include in Pathway Detail Section:**
- Current architecture state (monolith type, coupling level from APP-Q2 finding)
- Compute model gaps (from INF-Q1 finding)
- Communication pattern gaps (from APP-Q3, APP-Q4 findings)
- Recommended decomposition approach (link to Decomposition Strategy section if APP-Q2 < 3)
- Representative AWS services: Lambda, API Gateway, Step Functions, EventBridge, ECS/EKS
- Recommended patterns: Strangler Fig, Anti-corruption Layer, Event Sourcing, Saga
- Links to AWS prescriptive guidance for monolith decomposition

#### 7.2 Move to Containers

**Pathway:** Containerize existing workloads running on EC2/VMs and adopt fully managed container orchestration.

**Trigger Conditions:**

| Condition | Question ID | Threshold | Description |
|-----------|-------------|-----------|-------------|
| Primary | INF-Q1 | < 3 | Compute is primarily EC2/VM-based with no managed container orchestration or serverless. |
| Supporting | Discovery | No container definitions | No Dockerfile, docker-compose.yml, or Kubernetes manifests found during Step 1 discovery scan. |

**Trigger Logic:** Triggered when INF-Q1 < 3 AND no container definitions were found in the discovery scan.

**Contextual Guard:** This pathway SHALL NOT trigger if compute is already Lambda, Fargate, or ECS. Specifically:
- If INF-Q1 finding indicates compute is already running on ECS, EKS, Fargate, or Lambda, this pathway is **Not Triggered** even if INF-Q1 scores < 3 (e.g., a mix of managed and EC2 scoring a 2 would not trigger if the managed portion is already containerized).
- The guard prevents recommending containerization to workloads that have already moved beyond EC2/VM-based compute.

**Priority:** Medium — containerization is a foundational step that enables further modernization but is not as architecturally impactful as decomposition.
**Est. Effort:** Medium — requires creating Dockerfiles, container orchestration configs, and updating CI/CD pipelines, but does not require architectural redesign.

**When Triggered, Include in Pathway Detail Section:**
- Current compute model (from INF-Q1 finding — EC2 instance types, AMIs, auto-scaling groups)
- Container readiness indicators (application dependencies, port bindings, config externalization)
- Recommended container orchestration platform (respect `preferences` — e.g., if `prefer: ["eks"]`, recommend EKS; if `avoid: ["serverless"]`, do not recommend Fargate)
- Representative AWS services: ECS, EKS, Fargate, ECR, App Runner
- Migration approach: lift-and-containerize vs refactor-then-containerize
- Links to AWS container migration guidance

#### 7.3 Move to Open Source

**Pathway:** Migrate from commercial database engines and licensed software to open-source alternatives to reduce licensing costs and increase flexibility.

**Trigger Conditions:**

| Condition | Question ID | Threshold | Description |
|-----------|-------------|-----------|-------------|
| Primary | DATA-Q4 | < 3 | Application relies on stored procedures, triggers, or proprietary SQL constructs (T-SQL, PL/SQL) that couple business logic to a commercial database engine. |
| Supporting | INF-Q2 | Finding | INF-Q2 finding mentions commercial database engines — Oracle, SQL Server, or other licensed database products detected in IaC or connection strings. |

**Trigger Logic:** Triggered when DATA-Q4 < 3 AND commercial database engines are detected in the INF-Q2 finding or discovery scan.

**Contextual Guard:** None — if proprietary SQL and commercial engines are detected, migration to open source is relevant regardless of other factors.

**Priority:** Medium — licensing cost reduction is significant but migration complexity depends on stored procedure density and proprietary SQL usage.
**Est. Effort:** High — requires schema conversion (AWS SCT), stored procedure extraction to application layer, query rewriting, and thorough regression testing.

**When Triggered, Include in Pathway Detail Section:**
- Commercial engines detected (from INF-Q2 finding — Oracle, SQL Server, etc.)
- Stored procedure and proprietary SQL density (from DATA-Q4 finding)
- Database engine versions and EOL status (from DATA-Q3 finding)
- Recommended migration targets (respect `preferences` — e.g., if `prefer: ["aurora"]`, recommend Aurora PostgreSQL/MySQL)
- Representative AWS services: RDS PostgreSQL, RDS MySQL, RDS MariaDB, Aurora, Amazon Linux, EKS
- Migration tools: AWS Schema Conversion Tool (SCT), AWS Database Migration Service (DMS)
- Links to AWS database migration prescriptive guidance

#### 7.4 Move to Managed Databases

**Pathway:** Migrate from self-managed databases (on EC2, containers, or on-premises) to fully managed, purpose-built cloud-native database services.

**Trigger Conditions:**

| Condition | Question ID | Threshold | Description |
|-----------|-------------|-----------|-------------|
| Primary | INF-Q2 | < 3 | Databases are self-managed — running on EC2, in containers, or on-premises with manual patching, backup, and scaling. |
| Supporting | DATA-Q3 | < 3 | Database engine versions are unpinned, approaching EOL, or at EOL — indicating lack of lifecycle management. |

**Trigger Logic:** Triggered when INF-Q2 < 3 (self-managed databases detected). DATA-Q3 < 3 strengthens the case but is not required.

**Contextual Guard:** None — if databases are self-managed, migration to managed services is relevant regardless of other factors.

**Priority:** High — self-managed databases are a significant operational burden and a common source of incidents.
**Est. Effort:** Medium — managed database migration is well-tooled (DMS/SCT) but requires downtime planning, connection string updates, and validation.

**When Triggered, Include in Pathway Detail Section:**
- Current database topology (from INF-Q2 finding — self-managed engines, hosting model)
- Engine versions and EOL status (from DATA-Q3 finding)
- Data access patterns (from DATA-Q2 finding — centralized vs scattered)
- Recommended managed database targets (respect `preferences` — e.g., if `prefer: ["aurora"]`, recommend Aurora; if `avoid: ["dynamodb"]`, do not recommend DynamoDB)
- Representative AWS services: Aurora, RDS, DynamoDB, DocumentDB, ElastiCache, MemoryDB, OpenSearch Service
- Migration tools: AWS DMS, AWS SCT
- Links to AWS managed database migration guidance

#### 7.5 Move to Managed Analytics

**Pathway:** Migrate from self-managed streaming, ETL, and analytics infrastructure to fully managed, cost-optimized data lake and real-time analytics services.

**Trigger Conditions:**

| Condition | Question ID | Threshold | Description |
|-----------|-------------|-----------|-------------|
| Primary | INF-Q4 | < 3 | Messaging and streaming infrastructure is self-managed (Kafka on EC2, RabbitMQ in containers) or absent entirely. |
| Supporting | Discovery | Data source sprawl | Multiple data sources detected with no unified access layer (DATA-Q2 finding indicates scattered data access). |

**Trigger Logic:** Triggered when INF-Q4 < 3 AND evidence of data processing workloads exists in the discovery scan.

**Contextual Guard:** Evidence of data processing workloads MUST exist. This pathway SHALL NOT trigger if:
- No streaming, ETL, data pipeline, or analytics artifacts were found during discovery (Step 1).
- The application has no data processing responsibilities (e.g., a simple CRUD API with no analytics or streaming needs).
- The detected `service_archetype` is `stateless-utility` or `data-gateway` AND no streaming/ETL artifacts were found — these archetypes correctly score 4 on INF-Q4 when sync-only, and the low score does not indicate a modernization gap for them.

The guard prevents recommending managed analytics infrastructure to applications that do not process, transform, or analyze data at scale.

**Priority:** Medium — managed analytics reduces operational overhead for data-intensive workloads but is not relevant for all applications.
**Est. Effort:** Medium to High — depends on the complexity of existing streaming/ETL infrastructure and the volume of data pipelines to migrate.

**When Triggered, Include in Pathway Detail Section:**
- Current streaming/messaging infrastructure (from INF-Q4 finding — self-managed Kafka, RabbitMQ, etc.)
- Data access patterns and sprawl (from DATA-Q2 finding)
- Data processing workloads identified during discovery (ETL scripts, pipeline definitions, Glue jobs, Airflow DAGs)
- Recommended managed analytics targets (respect `preferences`)
- Representative AWS services: Redshift, Kinesis Data Streams, MSK Serverless, Athena, Lake Formation, Glue, QuickSight
- Links to AWS analytics modernization guidance

#### 7.6 Move to Modern DevOps

**Pathway:** Adopt modern development philosophies, practices, and tools for high-velocity, safe, and automated application delivery.

**Trigger Conditions:**

| Condition | Question ID | Threshold | Description |
|-----------|-------------|-----------|-------------|
| Primary | INF-Q10 | < 3 | Low IaC coverage — significant infrastructure is manually created (ClickOps). |
| Primary | INF-Q11 | < 3 | No CI/CD automation — deployments are manual or semi-manual. |
| Supporting | OPS-Q5 | < 3 | No canary or blue/green deployment strategy — direct-to-production releases. |
| Supporting | OPS-Q6 | < 3 | No integration tests in the CI pipeline. |

**Trigger Logic:** Triggered when at least one primary condition is met (INF-Q10 < 3 OR INF-Q11 < 3). Supporting conditions (OPS-Q5 < 3, OPS-Q6 < 3) strengthen the case and expand the scope of recommendations.

**Contextual Guard:** None — if IaC coverage or CI/CD automation is lacking, modern DevOps practices are universally relevant.

**Priority:** High — DevOps maturity is foundational to all other modernization pathways. Without automated pipelines and IaC, other modernization efforts are harder to execute safely.
**Est. Effort:** Medium — IaC adoption and CI/CD pipeline creation are well-understood practices with extensive tooling and guidance.

**When Triggered, Include in Pathway Detail Section:**
- Current IaC coverage (from INF-Q10 finding — percentage of infrastructure in code vs manual)
- Current CI/CD state (from INF-Q11 finding — pipeline stages, automation level)
- Deployment strategy gaps (from OPS-Q5 finding)
- Testing gaps (from OPS-Q6 finding)
- Recommended DevOps toolchain (respect `preferences`)
- Representative AWS services: CodeCommit, CodeBuild, CodePipeline, CodeDeploy, CloudFormation, CDK, Proton, X-Ray, CloudWatch
- Links to AWS DevOps prescriptive guidance

#### 7.7 Move to AI

**Pathway:** Leverage AWS AI services to transform applications with AI capabilities, bridging traditional modernization and AI-driven computing. This pathway evaluates whether the application has adopted AI/agent frameworks, vector databases, RAG patterns, or agent evaluation infrastructure.

**Trigger Conditions:**

| Condition | Source | Description |
|-----------|--------|-------------|
| Primary | Discovery (Step 1) | No AI/agent framework usage detected — no imports of Bedrock SDK, LangChain, Strands, OpenAI, Spring AI, HuggingFace, or SageMaker SDK in source code. |
| Supporting | Discovery (Step 1) | No vector database or embeddings infrastructure detected — no OpenSearch with vector engine, Pinecone, pgvector, Weaviate, or Qdrant. |
| Supporting | Discovery (Step 1) | No RAG implementation detected — no embedding generation, vector store queries, or retrieval chain patterns. |
| Supporting | Discovery (Step 1) | No agent evaluation framework detected — no Ragas, DeepEval, or custom eval harness. |

**Trigger Logic:** Triggered when the primary condition is met (no AI/agent frameworks detected). Supporting conditions strengthen the case and expand the scope of recommendations.

**Contextual Guard:** Requires explicit AI/agent/LLM intent in the portfolio or service context. Before evaluating primary trigger conditions, scan both the portfolio-level `context` and the service-level `context` (from `additionalPlanContext`) for AI-related signal terms.

**AI-Related Signal Terms (case-insensitive, whole-word match):**
"agentic", "LLM", "machine learning", "Bedrock", "generative AI", "GenAI", "RAG", "vector database", "vector store", "embedding", "copilot", "chatbot", "AI agent", "AI-powered", "large language model"

> **Note:** Generic terms like "AI", "agent", "ML", "assistant", and "autonomous" are excluded because they produce false matches in non-AI contexts (e.g., "autonomous scaling", "ML pipeline for fraud detection", "agent identity", "virtual assistant" for IVR). The retained terms are specific enough to indicate LLM/GenAI intent.

**Guard Logic:**

```
ai_signals = ["agentic", "LLM", "machine learning", "Bedrock", "generative AI", 
              "GenAI", "RAG", "vector database", "vector store", "embedding",
              "copilot", "chatbot", "AI agent", "AI-powered", "large language model"]

portfolio_context = additionalPlanContext.context  # portfolio-level
service_context = additionalPlanContext.context     # service-level (from repo config)

has_ai_intent = false
for signal in ai_signals:
    if signal in portfolio_context (case-insensitive) OR signal in service_context (case-insensitive):
        has_ai_intent = true
        break

if not has_ai_intent:
    pathway_status = "Not Triggered"
    reason = "No AI/agent intent detected in portfolio or service context."
else:
    # Proceed with primary trigger evaluation (no AI frameworks detected)
    evaluate_primary_triggers()
```

If neither the portfolio-level context nor the service-level context contains any of the AI-related signal terms, the pathway status is set to **Not Triggered** with reason: "No AI/agent intent detected in portfolio or service context." The primary trigger conditions are not evaluated. When at least one context string contains an AI-related signal and the primary trigger conditions are met, the pathway status is set to **Triggered**.

**Priority:** Medium — AI adoption is increasingly important but depends on the application's domain and use cases.
**Est. Effort:** Medium — initial AI integration (e.g., adding Bedrock for a single use case) is moderate effort, but building comprehensive AI infrastructure (vector DBs, RAG, eval frameworks) requires more investment.

**When Triggered, Include in Pathway Detail Section:**
- Current AI/agent infrastructure state (from discovery — what was and was not found)
- Application domain and potential AI use cases based on analysis findings
- Recommended AI services (respect `preferences`)
- Representative AWS services: Amazon Bedrock, Amazon Bedrock AgentCore, Amazon Q, SageMaker, OpenSearch Service (vector engine), Amazon Kendra
- Foundation requirements: what needs to be in place before AI integration (API surface, data access, observability)
- Links to AWS AI/ML prescriptive guidance

---

### Pathway Summary Table

After evaluating all 7 pathways, compile the results into a summary table. All 7 pathways MUST appear in this table regardless of status. This table appears in the report output before the pathway detail subsections.

| # | Pathway | Status | Priority | Est. Effort | Key Trigger Criteria |
|---|---------|--------|----------|-------------|---------------------|
| 1 | Move to Cloud Native | {Triggered / Not Triggered / Not Applicable} | {High / Medium / Low / —} | {High / Medium / Low / —} | {Question IDs and scores that triggered it, or reason for Not Triggered / Not Applicable} |
| 2 | Move to Containers | {Triggered / Not Triggered / Not Applicable} | {High / Medium / Low / —} | {High / Medium / Low / —} | {Question IDs and scores that triggered it, or reason for Not Triggered / Not Applicable} |
| 3 | Move to Open Source | {Triggered / Not Triggered / Not Applicable} | {High / Medium / Low / —} | {High / Medium / Low / —} | {Question IDs and scores that triggered it, or reason for Not Triggered / Not Applicable} |
| 4 | Move to Managed Databases | {Triggered / Not Triggered / Not Applicable} | {High / Medium / Low / —} | {High / Medium / Low / —} | {Question IDs and scores that triggered it, or reason for Not Triggered / Not Applicable} |
| 5 | Move to Managed Analytics | {Triggered / Not Triggered / Not Applicable} | {High / Medium / Low / —} | {High / Medium / Low / —} | {Question IDs and scores that triggered it, or reason for Not Triggered / Not Applicable} |
| 6 | Move to Modern DevOps | {Triggered / Not Triggered / Not Applicable} | {High / Medium / Low / —} | {High / Medium / Low / —} | {Question IDs and scores that triggered it, or reason for Not Triggered / Not Applicable} |
| 7 | Move to AI | {Triggered / Not Triggered / Not Applicable} | {High / Medium / Low / —} | {High / Medium / Low / —} | {Question IDs and scores that triggered it, or reason for Not Triggered / Not Applicable} |

**Status values:**
- **Triggered** — All trigger conditions met and contextual guard does not prevent it. Include priority, effort, and key trigger criteria.
- **Not Triggered** — One or more trigger conditions not met, or contextual guard prevents it. Set priority and effort to "—". Key trigger criteria should explain why it was not triggered (e.g., "INF-Q1 = 4 — compute already on managed services").
- **Not Applicable** — Pathway is N/A for the detected `repo_type`. Set priority and effort to "—". Key trigger criteria should state: "This is a `{repo_type}` repository. This pathway does not apply."

**Pathway Detail Subsections:**
After the summary table, include a detailed subsection for each **Triggered** pathway only. Each detail subsection should contain the content specified in the "When Triggered, Include in Pathway Detail Section" guidance for that pathway above. Do not include detail subsections for Not Triggered or Not Applicable pathways.


### Step 8: Decomposition Strategy (Conditional — APP-Q2 < 3)

This section is **conditional**. Include it in the report ONLY when APP-Q2 (Monolith vs Microservices) scores less than 3. If APP-Q2 >= 3, skip this section entirely — the application is already decomposed or has well-defined module boundaries, and decomposition guidance is not needed.

When APP-Q2 < 3, the application is a monolith or tightly coupled system that would benefit from decomposition. This section provides concrete approach options, pattern recommendations, and effort estimates to guide the modernization strategy.

#### 8.1 Decomposition Approach Options

Evaluate the monolith's characteristics (from APP-Q2 finding, DATA-Q2 finding, and discovery evidence) and recommend one of the following approaches:

| Approach | Description | When to Use | Level of Effort | Recommendation |
|----------|-------------|-------------|-----------------|----------------|
| **Strengthen as Modular Monolith** | Keep the application as a single deployable unit but enforce strict module boundaries: separate schemas per module, explicit inter-module APIs (no direct cross-module database access), clear ownership per module. | APP-Q2 = 2 and the team is < 3-4 squads, deployment cadence is acceptable, and the primary driver is code quality rather than independent scaling or team autonomy. | **Low** — 2-6 months of internal refactoring. No new infrastructure or deployment topology changes. | ✅ **Recommended when decomposition drivers are weak.** Not every monolith needs microservices. If the team is small, deployment frequency is adequate, and the primary issue is code coupling rather than operational independence, strengthening module boundaries is the correct outcome — not a stepping stone. |
| **Strangler Fig (Parallel Track)** | Incrementally extract services from the monolith while keeping the monolith running. New features are built as services; existing features are migrated over time. The monolith shrinks as services grow. | APP-Q2 = 2 (identifiable modules with coupling). The monolith has recognizable boundaries that can be extracted one at a time. Team can sustain parallel development. Strong drivers for decomposition exist (independent scaling, team autonomy, deployment independence). | **Medium to High** — 6-18 months depending on monolith size. Each extraction is a bounded effort. | ✅ **Recommended for most monoliths where decomposition is warranted.** Lowest risk, incremental value delivery, no big-bang cutover. |
| **Conditional / Adaptive** | Start with containerizing the monolith as-is (lift-and-containerize), then selectively extract high-value services based on business priority. Not all modules need to become services — some may remain in the monolith permanently. | APP-Q2 = 2 and the team has limited capacity for full decomposition. Business pressure requires quick wins before full architectural change. | **Low to Medium** — containerization in 2-4 weeks, selective extraction over 3-12 months. | ✅ **Recommended when capacity is constrained** or when only specific modules need independent scaling/deployment. |
| **Big-Bang Rewrite** | Rewrite the entire application as microservices from scratch, replacing the monolith in a single cutover. | Almost never. Only when the monolith is so degraded (APP-Q2 = 1, no identifiable modules, pervasive shared state) that incremental extraction is impossible. | **Very High** — 12-24+ months. High risk of scope creep, feature parity gaps, and failed cutover. | ⚠️ **Recommended against.** High risk of failure. If the monolith is functional, Strangler Fig or Conditional approaches are safer. Only consider if the monolith is truly unmaintainable. |

#### 8.2 Pattern Recommendations

When decomposing a monolith, apply these architectural patterns to manage the transition safely. Each pattern is linked to AWS prescriptive guidance:

| Pattern | Purpose | When to Apply | AWS Prescriptive Guidance |
|---------|---------|---------------|---------------------------|
| **Anti-corruption Layer (ACL)** | Isolate the new service from the monolith's data model and API contracts. Prevents the monolith's design decisions from leaking into new services. | Every extraction — place an ACL between the new service and the monolith to translate between their models. | [Strangler Fig pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html) |
| **Saga Pattern** | Manage distributed transactions across services that were previously handled by a single database transaction in the monolith. | When extracting modules that participate in multi-step business transactions (e.g., order → payment → inventory). | [Saga pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html) |
| **Event Sourcing** | Capture all changes as a sequence of events rather than storing only current state. Enables audit trails, temporal queries, and event-driven integration between services. | When the extracted service needs to maintain a history of state changes, or when multiple services need to react to the same business events. | [Event sourcing pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing.html) |
| **Hexagonal Architecture (Ports and Adapters)** | Structure each new service with clear boundaries between business logic (core), external interfaces (ports), and infrastructure adapters. | Every new service — ensures the service is testable, portable, and decoupled from specific infrastructure choices. | [Cloud Design Patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/introduction.html) |

#### 8.3 Effort Estimation Factors

The actual decomposition effort depends on these factors discovered during the analysis:

| Factor | Low Effort Signal | High Effort Signal | Source |
|--------|-------------------|-------------------|--------|
| Module boundaries | Clear package/module structure with minimal cross-dependencies | No clear boundaries, circular dependencies, pervasive shared state | APP-Q2 finding |
| Data coupling | Each module owns its data; minimal shared database tables | Single shared database with cross-module joins and shared mutable state | DATA-Q2 finding |
| Stored procedures | No stored procedures; all logic in application layer | Heavy stored procedure usage coupling logic to the database | DATA-Q4 finding |
| Communication patterns | Some async patterns already in place | All communication is synchronous HTTP | APP-Q3 finding |
| CI/CD maturity | Automated pipeline exists; can support multi-service deployment | Manual deployments; no pipeline to extend | INF-Q11 finding |
| Test coverage | Integration tests exist for critical workflows | No automated tests — regression risk during extraction | OPS-Q6 finding |

Use these factors to calibrate the effort estimate for the recommended approach. Include the calibrated estimate in the report.


### Step 9: AI/Agent Infrastructure Evaluation Logic

This section documents the evaluation logic that connects AI/agent discovery findings (from Step 1) to the Move to AI pathway (Step 7.7). The actual discovery scanning is performed in Step 1, and the Move to AI pathway evaluation is in Step 7.7. This section serves as a cross-reference explaining how AI/agent infrastructure signals flow through the analysis.

#### 9.1 AI/Agent Discovery Signals

During the discovery scan (Step 1), the following AI/agent infrastructure signals are identified and recorded in the file inventory:

| Signal Category | What to Look For | Discovery Evidence |
|-----------------|------------------|-------------------|
| **AI/Agent Frameworks** | Bedrock SDK imports, LangChain imports, Strands SDK imports, OpenAI SDK imports, Spring AI imports, HuggingFace imports, SageMaker SDK imports | Import statements in source code; framework dependencies in package manifests (e.g., `boto3` with `bedrock-runtime`, `langchain` in requirements.txt, `@aws-sdk/client-bedrock-runtime` in package.json, `spring-ai` in pom.xml) |
| **Vector Database Infrastructure** | OpenSearch with vector engine (`knn` plugin), Pinecone client imports, pgvector extension in PostgreSQL config, Weaviate client imports, Qdrant client imports | IaC resources for vector-capable databases; client library imports in source code; database configuration enabling vector extensions |
| **RAG Implementation** | Embedding generation calls, vector store query patterns, retrieval chain implementations, document chunking logic | Source code patterns: embedding API calls, similarity search queries, retrieval-augmented generation chains, document loaders and splitters |
| **Agent Evaluation Frameworks** | Ragas imports, DeepEval imports, custom evaluation harness patterns, LLM-as-judge implementations | Test files with evaluation framework imports; evaluation configuration files; benchmark datasets |

#### 9.2 How Discovery Signals Feed the Move to AI Pathway

The AI/agent discovery signals recorded in Step 1 are consumed by Step 7.7:

- The Move to AI pathway's primary trigger condition checks whether AI/agent frameworks were found during discovery.
- If **no** AI/agent framework imports are detected, the primary trigger is met.
- Supporting conditions check for absence of vector DB infrastructure, RAG implementation, and agent evaluation frameworks.
- The pathway is triggered when the primary condition is met (no AI/agent frameworks), regardless of supporting conditions.
- See Step 7.7 for the complete trigger logic and contextual guard.

The discovery scan (Step 1) is the single source of truth for what AI/agent artifacts exist. The Move to AI pathway (Step 7.7) consumes those findings through its trigger evaluation logic.

**Scope note:** The modernization analysis does NOT recommend specific agent use cases for the target system. That concern — where agents can add value to this system, given its foundations — belongs to the Agentic Readiness Analysis (ARA) and its downstream agentic-program recommendations. MOD's role is to identify modernization gaps; ARA's role is to identify agent integration opportunities.



## Report Template

The analysis emits a **four-artifact bundle** per the Four-Artifact Output Contract below: `{repo-name}-mod-report.md` (narrative), `{repo-name}-mod-report.json` (canonical JSON), `{repo-name}-mod-report.html` (self-contained HTML), and `{repo-name}-mod-report.metadata.json` (version sidecar). This section specifies the MD structure. The MD MUST contain all sections listed below in the specified order. Every section is required unless explicitly marked as conditional.

### Report Section Order

1. **Metadata Header**
2. **Overall and Category Score Table**
3. **Top 5 Gaps**
4. **Pathway Summary Table** (all 7 pathways)
5. **Pathway Detail Subsections** (triggered pathways only)
6. **Decomposition Strategy** (conditional — only when APP-Q2 < 3)
7. **Detailed Findings for All 37 Questions**
8. **Learning Materials**
9. **Evidence Index**

---

### Section 1: Metadata Header

```markdown
# Modernization Readiness Analysis Report

| Field | Value |
|-------|-------|
| **Repository** | {repo-name} |
| **Date** | {analysis-date} |
| **TD Version** | {version ID of the published TD that produced this report — resolve via `atx custom def get -n modernization-readiness-analysis`} |
| **Repo Type** | {repo_type} |
| **Service Archetype** | {archetype} ({auto-detected or user-provided}) — omit row if repo_type is not `application` |
| **Priority** | {priority or "—" if not provided} |
| **Tags** | {tags as comma-separated list or "—" if not provided} |
| **Context** | {context or "—" if not provided} |
| **Overall Score** | {overall-score} / 4.0 |
```

If `repo_type` was not provided and defaulted to `application`, include a note: "Repo type defaulted to `application` (not specified in analysis context)."

If `repo_type` was provided but unrecognized, include a warning: "Unrecognized repo_type '{value}', defaulted to `application`."

If `service_archetype` was auto-detected, include the one- to two-sentence justification produced in Step 1.5 immediately below the metadata table under the heading `**Archetype Justification**:`.

### Section 2: Overall and Category Score Table

```markdown
## Score Summary

| Category | Score | Rating |
|----------|-------|--------|
| Infrastructure, Platform, and DevOps (INF) | {score} / 4.0 | {rating} |
| Application Architecture (APP) | {score} / 4.0 | {rating} |
| Data Platform Modernization (DATA) | {score} / 4.0 | {rating} |
| Security Baseline (SEC) | {score} / 4.0 | {rating} |
| Operations & Observability (OPS) | {score} / 4.0 | {rating} |
| **Overall** | **{score} / 4.0** | **{rating}** |
```

**Rating labels:**

| Score Range | Rating |
|-------------|--------|
| 3.5 – 4.0 | ✅ Mature |
| 2.5 – 3.4 | 🟡 Partial |
| 1.5 – 2.4 | 🟠 Needs Work |
| < 1.5 | ❌ Not Ready |

If a category score is "N/A" (all questions in that category are N/A or Not Evaluated for the detected repo_type and archetype), display:

```markdown
| Application Architecture (APP) | N/A | N/A — all questions not applicable for {repo_type}/{archetype} |
```

**Scoring rules:**
- Category score = arithmetic mean of non-N/A, non-Not-Evaluated question scores in that category.
- Overall score = arithmetic mean of non-N/A category scores (each category weighted equally).
- Both N/A and Not-Evaluated (archetype-N/A) questions are excluded from numerator and denominator.
- If all questions in a category are N/A or Not Evaluated, category score = "N/A", excluded from overall average.

### Section 3: Top 5 Gaps

```markdown
## Top 5 Gaps

| # | Question | Score | Gap Summary | Impact |
|---|----------|-------|-------------|--------|
| 1 | {question-id}: {question-title} | {score} | {one-line gap description} | {impact on modernization} |
| 2 | ... | ... | ... | ... |
| 3 | ... | ... | ... | ... |
| 4 | ... | ... | ... | ... |
| 5 | ... | ... | ... | ... |
```

Select the 5 questions with the lowest scores (excluding N/A). Break ties by prioritizing questions that trigger pathways. If fewer than 5 non-N/A questions have gaps (score < 4), include only those with gaps.

### Section 4: Pathway Summary Table

```markdown
## AWS Modernization Pathways

| # | Pathway | Status | Priority | Est. Effort | Key Trigger Criteria |
|---|---------|--------|----------|-------------|---------------------|
| 1 | Move to Cloud Native | {status} | {priority} | {effort} | {criteria} |
| 2 | Move to Containers | {status} | {priority} | {effort} | {criteria} |
| 3 | Move to Open Source | {status} | {priority} | {effort} | {criteria} |
| 4 | Move to Managed Databases | {status} | {priority} | {effort} | {criteria} |
| 5 | Move to Managed Analytics | {status} | {priority} | {effort} | {criteria} |
| 6 | Move to Modern DevOps | {status} | {priority} | {effort} | {criteria} |
| 7 | Move to AI | {status} | {priority} | {effort} | {criteria} |
```

All 7 pathways MUST appear in this table. Status values: Triggered, Not Triggered, Not Applicable.

### Section 5: Pathway Detail Subsections

For each **Triggered** pathway, include a detail subsection with the content specified in Step 7 ("When Triggered, Include in Pathway Detail Section"). Do not include detail subsections for Not Triggered or Not Applicable pathways.

```markdown
### Pathway: {Pathway Name}

**Status:** Triggered
**Priority:** {High / Medium / Low}
**Estimated Effort:** {High / Medium / Low}

{Pathway-specific detail content as specified in Step 7}
```

### Section 6: Decomposition Strategy (Conditional)

**Include this section ONLY when APP-Q2 < 3.** If APP-Q2 >= 3, omit this section entirely.

```markdown
## Decomposition Strategy

{Content from Step 8 — approach options, pattern recommendations, effort estimation}
```

### Section 7: Detailed Findings for All 37 Questions

```markdown
## Detailed Findings

### Infrastructure, Platform, and DevOps

#### INF-Q1: Managed Compute

| Field | Value |
|-------|-------|
| **Score** | {1-4 or N/A} |
| **Finding** | {What was discovered — cite specific files and resources} |
| **Gap** | {What's missing or needs improvement, or N/A} |
| **Recommendation** | {Specific action to close the gap, or N/A} |
| **Evidence** | {File paths and resource names cited} |

{Repeat for all 37 questions across all 5 sections}
```

**All 37 questions MUST appear** in this section. N/A questions are listed using the N/A display format:

```markdown
| Field | Value |
|-------|-------|
| **Score** | N/A |
| **Finding** | This is a `{repo_type}` repository. This question does not apply. |
| **Gap** | N/A |
| **Recommendation** | N/A |
| **Evidence** | N/A |
```

Questions are grouped by section in the same order as the evaluation steps:
1. Infrastructure, Platform, and DevOps (INF-Q1 through INF-Q11)
2. Application Architecture (APP-Q1 through APP-Q6)
3. Data Platform Modernization (DATA-Q1 through DATA-Q4)
4. Security Baseline (SEC-Q1 through SEC-Q7)
5. Operations & Observability (OPS-Q1 through OPS-Q9)

### Section 8: Learning Materials

```markdown
## Learning Materials

Include relevant links based on triggered pathways. Only include learning materials for pathways with status "Triggered."
```

| Pathway | Learning Resources |
|---------|-------------------|
| **Move to Cloud Native** | [AWS Modernization Pathways: Move to Cloud Native Serverless](https://skillbuilder.aws/learning-plan/CMK2J48MVN) · [Cloud Design Patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/introduction.html) |
| **Move to Containers** | [Move to Containers with Amazon EKS](https://skillbuilder.aws/learning-plan/GNYBZ9X9EM) · [Move to Containers with Amazon ECS](https://skillbuilder.aws/learning-plan/CDA8Y4JRRR) · [EKS Workshop](https://www.eksworkshop.com/) |
| **Move to Open Source** | [Move to Managed Databases](https://skillbuilder.aws/learning-plan/VNJ8FZ3ZRC) (covers open source engine migration) |
| **Move to Managed Databases** | [Move to Managed Databases](https://skillbuilder.aws/learning-plan/VNJ8FZ3ZRC) · [AWS DMS Getting Started](https://skillbuilder.aws/learn/ND246G8Y3W) |
| **Move to Managed Analytics** | [Move to Managed Analytics](https://skillbuilder.aws/learning-plan/RWZA84NMVV) |
| **Move to Modern DevOps** | [Move to Modern DevOps](https://skillbuilder.aws/learning-plan/1FGEQKGPQD) · [Getting Started with DevOps on AWS](https://skillbuilder.aws/learn/R4B13K95YQ) |
| **Move to AI** | [Move to AI](https://skillbuilder.aws/learning-plan/VDFEE4ACCV) · [Amazon Bedrock Getting Started](https://skillbuilder.aws/learn/63KTRM86DQ) · [Introduction to Agentic AI on AWS](https://skillbuilder.aws/learn/DNBD5MT8ZD) |

If no pathways are triggered, include: "No pathways triggered — no pathway-specific learning materials applicable. Refer to the [AWS SkillBuilder](https://skillbuilder.aws/) catalog for general cloud architecture training."

### Section 9: Evidence Index

```markdown
## Evidence Index

| File Path | Referenced By | Context |
|-----------|--------------|---------|
| {relative/path/to/file} | {Question IDs that cite this file} | {Brief description of what this file evidences} |
| ... | ... | ... |
```

The evidence index compiles all file references cited across the detailed findings into a single lookup table. This enables reviewers to trace any finding back to the specific file that supports it.

Include every file path that appears in any finding's evidence field. Group by directory for readability if the list exceeds 20 entries.

### Next Steps — Engagement Programs (Portfolio-Level)

This per-repo report intentionally does NOT recommend AWS engagement programs (MAP, OLA, AppMod, EBA, VMCCO, etc.). Program eligibility depends on cross-repo scope, customer segment, ARR, on-prem/migration context, and partner relationships that a single-repo analysis does not have.

Engagement-level program recommendations are produced by the **Portfolio Modernization Readiness Analysis**, which aggregates all per-repo MOD reports and evaluates them against the shared AWS Program & GTM Library. Run the portfolio TD after all per-repo reports are generated.

Modernization guidance for this repo is captured in the pathway detail subsections, top gaps, and detailed findings above.


## Constraints and Guardrails

The following constraints govern the analysis execution and report generation. These are non-negotiable rules that the evaluating agent MUST follow.

### C1: Read-Only Analysis

This analysis operates in **read-only mode**. The evaluating agent SHALL NOT:
- Modify any source code, configuration files, or infrastructure definitions in the repository.
- Create, delete, or rename any files in the repository (except the output artifact bundle).
- Execute any commands that change repository state (no `git commit`, no `terraform apply`, no `npm install`).
- Create, switch, or checkout any git branches. Remain on whatever branch is currently checked out. This is an analysis-only task — do not create branches for runs.

The only write operations permitted are creating the output artifact bundle: `{repo-name}-mod-report.md`, `{repo-name}-mod-report.json`, `{repo-name}-mod-report.html`, and `{repo-name}-mod-report.metadata.json`.

### C2: All 37 Questions Must Appear in Report

Every one of the 37 questions MUST appear in the Detailed Findings section of the report, regardless of repo_type. Questions that are N/A for the detected repo_type are listed using the N/A display format — they are never omitted. This ensures the report is a complete record of all 37 evaluation criteria.

### C3: All 7 Pathways Must Appear in Pathway Table

Every one of the 7 AWS Modernization Pathways MUST appear in the Pathway Summary Table, regardless of status. Pathways that are Not Triggered or Not Applicable are listed with their respective status and reason — they are never omitted from the table.

### C4: Evidence-Based Findings

Every finding MUST cite specific evidence from the repository:
- **File paths** — Reference the specific files that support the finding (e.g., `terraform/main.tf`, `src/app/server.ts`, `.github/workflows/deploy.yml`).
- **Resource names** — Reference specific IaC resource names, service names, or configuration keys.
- **Absence is evidence** — If a search for specific artifacts finds nothing, that absence is itself a finding. State what was searched for and that it was not found (e.g., "No Dockerfile or container definitions found in the repository").

Do not make findings based on assumptions or general knowledge. Every score must be traceable to specific repository evidence or documented absence of evidence.

### C5: Honest Calibration

Scores MUST reflect genuine analysis of the repository evidence:
- **A score of 4 means genuinely mature** — the criterion is fully met with no gaps and best-practice implementation. Do not award a 4 for partial compliance or "good enough."
- **A score of 3 means partial** — the criterion is mostly met with minor gaps. This is the appropriate score when the capability exists but has room for improvement.
- **A score of 2 means needs work** — the capability exists but has significant gaps requiring moderate effort to address.
- **A score of 1 means not present** — the capability is missing entirely or fundamentally inadequate.

Avoid score inflation. A repository with basic infrastructure and no automation should not score above 2.0 overall. A repository with comprehensive, well-architected infrastructure should score 3.5+. The scores should meaningfully differentiate between mature and immature systems.

### C6: Preference Framing Only

When `preferences` (prefer/avoid arrays) are provided in additionalPlanContext:
- Preferences influence **recommendation framing only** — they steer which technologies are suggested in recommendations and pathway details.
- Preferences do NOT change scores, N/A mappings, pathway trigger logic, or any evaluation criteria.
- If `prefer: ["eks"]`, container recommendations should reference EKS over ECS where applicable.
- If `avoid: ["serverless"]`, recommendations should not suggest Lambda-based approaches.
- If no preferences are provided, recommendations use neutral technology language without favoring or avoiding specific technologies.

### C7: Ignored Fields

The following fields from `additionalPlanContext` are not used by this TD and are ignored if present: `goal`, `goal_context`, `agent_scope`.

---

## Unified Severity and Category Display Names

This TD emits findings in a unified severity vocabulary (High / Medium / Low) and canonical category display names so that MOD findings render in the same webapp tables, filters, and counters as ARA findings. The internal 1–4 score is preserved on every finding under `mod_metadata.internal_score` — it drives pathway triggers and Scoring Notes arithmetic.

#### Unified Severity Mapping

Every MOD finding carries a top-level `severity` field with a value from {High, Medium, Low}. The mapping from the internal 1–4 score is:

| Condition | Unified Severity |
|---|---|
| `internal_score == 1` AND `core_question == true` | High |
| `internal_score == 1` AND `core_question == false` | Medium |
| `internal_score == 2` | Medium |
| `internal_score == 3` | Low |
| `internal_score == 4` | (no finding — passing) |
| N/A / Not Evaluated | (no finding) |

A score of 4 is the "passing" score and MUST NOT emit a finding — the question is recorded only under `evaluations[]`. Similarly, N/A and Not Evaluated (archetype-N/A, extended-not-triggered) SHALL NOT emit findings. The question's 1–4 score still feeds Scoring Notes arithmetic and pathway trigger evaluation regardless of whether a finding was emitted.

The internal score is preserved verbatim in `mod_metadata.internal_score`, the core-question designation in `mod_metadata.core_question`, and the human-readable label ("Not Ready" / "Needs Work" / "Partial") in `mod_metadata.score_label`. See the `mod_metadata` subobject section below.

#### Category Display Names

Every MOD finding carries both a short `category_id` code (the rubric section prefix, used as `question_id` prefix) and a webapp-facing `category` display name. The canonical mapping:

| `category_id` | `category` display name |
|---|---|
| `INF` | Infrastructure & DevOps |
| `APP` | Application Architecture |
| `DATA` | Data Platform |
| `SEC` | Security Baseline |
| `OPS` | Operations & Observability |

Both `category_id` and `category` are REQUIRED fields on every MOD finding. MD and HTML section headers render the display name with the short code in parentheses where it adds clarity (e.g., "Infrastructure & DevOps (INF)"). The portfolio JSON `filter_vocab.categories[]` array carries display names only.

#### DATA-Q* Namespace Collision Note

The short code `DATA` is shared between MOD and the Agentic Readiness Analysis (ARA). MOD `DATA-Q1`..`DATA-Q4` and ARA `DATA-Q1`..`DATA-Q7` are DIFFERENT questions and MUST NOT be conflated. The unique join key across the two analysis types is `(analysis_type, question_id)` — never `question_id` alone. MOD `DATA` disambiguates to display name **"Data Platform"**; ARA `DATA` disambiguates to **"Data Accessibility"**. Every JSON artifact emits `analysis_type` at the root (values `"mod"`, `"ara"`, `"portfolio-mod"`, `"portfolio-ara"`) so the join key is always present.

---

### Unified Per-Finding Field Set and `mod_metadata` Subobject

This section defines the per-finding JSON shape for MOD. It mirrors the ARA TD's per-finding field set — the 12 base fields are identical across ARA and MOD so a single webapp can render both without per-analysis branching — with a MOD-specific `mod_metadata` subobject replacing ARA's `ara_metadata`.

#### Per-Finding Required Fields

Every MOD finding MUST carry these 12 fields:

| Field | Type | Description |
|---|---|---|
| `question_id` | string | MOD rubric question identifier (e.g., `"INF-Q1"`). |
| `category` | string | Webapp-facing category display name (e.g., `"Infrastructure & DevOps"`). |
| `category_id` | string | Rubric short code (e.g., `"INF"`). |
| `title` | string | Short finding title. |
| `description` | string | Finding description. |
| `gap` | string | What is missing or inadequate relative to the rubric. |
| `recommendation` | string | Remediation recommendation. |
| `severity` | enum | `"High"` / `"Medium"` / `"Low"` — unified severity per the table above. |
| `priority` | enum | `"P0"` / `"P1"` / `"P2"` / `"P3"` — static per-question priority. See table below. |
| `effort` | enum | `"High"` / `"Medium"` / `"Low"` — remediation effort estimate. |
| `phase` | integer | `1`–`4` — derived roadmap phase, default. |
| `evidence` | object or null | `{file, lines}` reference to the gap location in the repo, or `null` when no file-and-line reference applies. |

All 12 fields are REQUIRED on every emitted finding — missing any one fails the analysis and names the offending `question_id`. Findings are NEVER emitted for questions that resolve to pass (score 4), N/A, Not Evaluated (archetype-N/A), or Not Evaluated (extended-not-triggered); those questions appear only under `evaluations[]`.

#### MOD Metadata Subobject (`mod_metadata`)

Every MOD finding MUST carry a populated `mod_metadata` subobject (emitted as a sibling of the 12 required fields above) that preserves the scoring detail so the full MOD rubric depth stays visible:

| Field | Type | Description |
|---|---|---|
| `internal_score` | integer 1-3 | The 1–4 score that emitted this finding. Values of 1, 2, or 3 only — a score of 4 is the passing score and emits no finding. |
| `score_label` | enum | Human-readable label: `"Not Ready"` (score 1) / `"Needs Work"` (score 2) / `"Partial"` (score 3). Score 4 is "Mature" but does not emit a finding. |
| `archetype_calibrated` | boolean | `true` ONLY for INF-Q3, INF-Q4, APP-Q3, APP-Q4 when service archetype influenced the score. Always `false` on all other questions. When `true`, the MD artifact MUST include prose explaining how the archetype shaped the score. |
| `core_question` | boolean | Mirrors the MOD rubric's core-question designation (see "Core Question Designation Table" below). Drives the severity mapping rule that turns `internal_score == 1` on a core question into a High finding, and the same score on a non-core question into a Medium finding. |

#### Core Question Designation Table (authoritative)

Every MOD question has a static `core_question` value that does NOT change per-repo. This is the authoritative source for the `mod_metadata.core_question` field:

| Question | Core? | Question | Core? |
|---|---|---|---|
| INF-Q1 Managed Compute | ✅ core | DATA-Q1 Unstructured Data Storage | ✅ core |
| INF-Q2 Managed Databases | ✅ core | DATA-Q2 Unified Data Access Layer | non-core |
| INF-Q3 Workflow Orchestration | non-core | DATA-Q3 Database Engine Version and EOL | ✅ core |
| INF-Q4 Async Messaging and Streaming | non-core | DATA-Q4 Stored Procedures and Schema Complexity | ✅ core |
| INF-Q5 Network Security | ✅ core | SEC-Q1 Audit Logging | ✅ core |
| INF-Q6 API Entry Point | non-core | SEC-Q2 Encryption at Rest | ✅ core |
| INF-Q7 Auto-Scaling | non-core | SEC-Q3 API Authentication | non-core |
| INF-Q8 Backup and Recovery | non-core | SEC-Q4 Centralized Identity Integration | non-core |
| INF-Q9 High Availability and Fault Isolation | non-core | SEC-Q5 Secrets Management | ✅ core |
| INF-Q10 Infrastructure as Code Coverage | ✅ core | SEC-Q6 Compute Hardening and Patching | non-core |
| INF-Q11 CI/CD Automation | ✅ core | SEC-Q7 Application Security Pipeline | non-core |
| APP-Q1 Programming Languages | non-core | OPS-Q1 Distributed Tracing | non-core |
| APP-Q2 Monolith vs Microservices | ✅ core | OPS-Q2 SLO Definitions | non-core |
| APP-Q3 Async vs Sync Communication | non-core | OPS-Q3 Business Metrics | non-core |
| APP-Q4 Long-Running Process Handling | non-core | OPS-Q4 Anomaly Detection and Alerting | non-core |
| APP-Q5 API Versioning Strategy | non-core | OPS-Q5 Deployment Strategy | ✅ core |
| APP-Q6 Service Discovery | non-core | OPS-Q6 Integration Testing | ✅ core |
|  |  | OPS-Q7 Incident Response Automation | non-core |
|  |  | OPS-Q8 Observability Ownership | non-core |
|  |  | OPS-Q9 Resource Tagging Governance | non-core |

**Total: 14 core questions, 23 non-core questions** (37 total).

**Derivation rationale** (matches the per-question priority table above):
- All questions with `priority: P1` (the 14 P1 questions) are core.
- All questions with `priority: P2` are non-core.
- Core questions govern whether a score 1 creates a High-severity finding. Non-core questions at score 1 are Medium-severity.
- This table is static — it does NOT depend on per-repo context. The same `(analysis_type, question_id)` pair always yields the same `core_question` value.

**Worked severity mapping examples:**
- `INF-Q1` with score 1 → core=true → **High** finding
- `INF-Q3` with score 1 → core=false → **Medium** finding (non-core score 1 is not a High because INF-Q3 is archetype-calibrated and may score 1 correctly for some archetypes)
- `OPS-Q2` with score 1 → core=false → **Medium** finding (OPS-Q2 has `⚠️ Scoring limitation — external context dependency` noted in the rubric, which is why it's non-core)
- Any question with score 2 → **Medium** finding regardless of core_question

`mod_metadata` preserves scoring detail. The Score Summary table, Scoring Notes arithmetic, pathway trigger logic, and archetype-calibration prose all remain authoritative and unchanged — `mod_metadata` just surfaces the per-finding scoring reasoning in structured JSON so the webapp and the portfolio aggregator can consume it without re-parsing MD.

#### Evaluations Array (`evaluations[]`)

Questions that do NOT produce a finding (score 4 = pass, N/A, Not Evaluated) are recorded in `evaluations[]`. Every one of the 37 question IDs appears in EITHER `findings[]` OR `evaluations[]` — never both, never neither.

| Field | Type | Description |
|---|---|---|
| `question_id` | string | e.g., `"INF-Q1"` |
| `category_id` | string | e.g., `"INF"` |
| `title` | string | Question title (e.g., "Managed Compute") |
| `status` | enum | `"pass"` / `"na"` / `"not_evaluated_archetype"` / `"not_evaluated_surface_flag"` |
| `score` | integer or null | The internal 1-4 score (4 for pass, null for N/A/Not Evaluated) |
| `reason` | string | Why this status was assigned (e.g., "Score 4 — fully managed compute on EKS with Karpenter", "Library repo — INF questions are N/A") |

#### Explicit Forbid: No `pathway_triggers` Field on Findings

MOD findings MUST NOT carry a `pathway_triggers` field (or any equivalent pathway-trigger evidence field) under `mod_metadata` or at any other level of the finding. Pathway trigger evidence lives ONLY on `pathways[]` entries via the `triggering_questions[]` array — see the Per-Repo `pathways[]` Emission section below. This keeps the finding shape aligned with ARA and ensures that the portfolio MOD TD can consume pathway-trigger "why" evidence from a single authoritative location (`pathways[].contributing_repos[].triggering_questions[]`).

#### Per-Question Priority Table

The `priority` field on every MOD finding is STATIC per rubric question — it does not depend on per-repo context. Portfolio aggregation relies on this stability: the same `(analysis_type, question_id)` pair always yields the same `priority`.

**Authoritative source.** When `modernization-readiness-findings.csv` is present in the workspace, its per-question priority column is the authoritative source and overrides the defaults below. When the CSV is absent (current state of the workspace), the defaults in the table below are used.

**Default derivation.** Priority is derived mechanically from core/non-core designation: core questions default to P1, non-core questions default to P2, and the four archetype-calibrated questions (INF-Q3, INF-Q4, APP-Q3, APP-Q4) default to P2 because their scoring is archetype-sensitive rather than uniformly critical. Specifically:

- Core question → **P1**
- Non-core question → **P2**
- Archetype-calibrated question (INF-Q3, INF-Q4, APP-Q3, APP-Q4) → **P2**

Concrete per-question defaults for all 37 MOD questions:

| Question | Priority | Question | Priority |
|---|---|---|---|
| INF-Q1 | P1 | DATA-Q1 | P1 |
| INF-Q2 | P1 | DATA-Q2 | P2 |
| INF-Q3 | P2 | DATA-Q3 | P1 |
| INF-Q4 | P2 | DATA-Q4 | P1 |
| INF-Q5 | P1 | SEC-Q1 | P1 |
| INF-Q6 | P2 | SEC-Q2 | P1 |
| INF-Q7 | P2 | SEC-Q3 | P2 |
| INF-Q8 | P2 | SEC-Q4 | P2 |
| INF-Q9 | P2 | SEC-Q5 | P1 |
| INF-Q10 | P1 | SEC-Q6 | P2 |
| INF-Q11 | P1 | SEC-Q7 | P2 |
| APP-Q1 | P2 | OPS-Q1 | P2 |
| APP-Q2 | P1 | OPS-Q2 | P2 |
| APP-Q3 | P2 | OPS-Q3 | P2 |
| APP-Q4 | P2 | OPS-Q4 | P2 |
| APP-Q5 | P2 | OPS-Q5 | P1 |
| APP-Q6 | P2 | OPS-Q6 | P1 |
|  |  | OPS-Q7 | P2 |
|  |  | OPS-Q8 | P2 |
|  |  | OPS-Q9 | P2 |

(37 rows total — 11 INF + 6 APP + 4 DATA + 7 SEC + 9 OPS.) Per-finding `priority` is static per `question_id` and does not change per-repo, per-portfolio, or per-score. If `modernization-readiness-findings.csv` later lands in the workspace, the CSV's explicit per-question assignments replace these defaults wholesale.

#### Default Phase Mapping from Priority

The default `phase` assignment on a finding derives mechanically from `priority`:

| `priority` | Default `phase` |
|---|---|
| P0 | 1 |
| P1 | 1 |
| P2 | 2 or 3 |
| P3 | 3 or 4 |

Per-repo MOD MAY pin a specific phase within the allowed band based on local remediation dependencies; portfolio MOD MAY further adjust `phase` based on cross-cutting dependencies across the portfolio. The `priority` value itself does NOT change per-repo or per-portfolio — only `phase` may be re-pinned within its allowed band. When `phase` is re-pinned away from the default, the JSON artifact records both the per-repo-adjusted value (as `phase`) and, if applicable, the portfolio-adjusted value under a sibling field.

---

### Classification Rules (MOD) and Classification Consistency Check

The per-repo MOD classification assigns each assessed repository to exactly one of four tiers based on the unified High / Medium counts derived from the severity mapping above. MOD also emits a classification consistency check that ensures the score-based tier (derived from the `overall_score` band) and the count-based tier (derived from High / Medium counts) tell the same story.

MOD classification is deliberately SOFTER than ARA classification on "1 High." ARA gates on agent safety — a single High is a deployment blocker. MOD measures modernization maturity — a single High is typically one modernization gap rather than a deployment blocker. This is documented inline in the MD classification rationale block.

#### Classification Table

| High count | Medium count | Tier | `rule_matched` |
|---|---|---|---|
| 0 | ≤ 1 | Cloud-Native Ready | "0 High, ≤1 Medium → Cloud-Native Ready" |
| 0 | ≥ 2 | Pilot-Ready | "0 High, ≥2 Medium → Pilot-Ready" |
| 1 | any | Pilot-Ready | "1 High → Pilot-Ready" |
| 2–11 | any | Remediation Required | "2-11 High → Remediation Required" |
| ≥ 12 | any | Not Ready | "≥12 High → Not Ready" |

Tier values: {Cloud-Native Ready, Pilot-Ready, Remediation Required, Not Ready}. There is no sub-qualifier for MOD — the safety-concerns sub-qualifier is ARA-only.

The classification object emitted in per-repo MOD JSON:

```json
{
  "tier": "Remediation Required",
  "high_count": 6,
  "medium_count": 4,
  "low_count": 7,
  "rule_matched": "2-11 High → Remediation Required",
  "classification_consistency_check": "consistent"
}
```

#### Per-Category Emission: Three Coexisting Labels

Each entry in the per-repo MOD JSON `categories[]` array MUST carry ALL THREE of the following labels. They coexist — they do NOT replace one another:

| Field | Source | Values |
|---|---|---|
| `numeric_score` | Arithmetic mean of non-N/A non-Not-Evaluated question scores in that category | 1.00–4.00 (or `null` when every question in the category resolves to N/A or Not Evaluated) |
| `score_rating` | Numeric-score band, derived from `numeric_score` using: ≥ 3.5 → Mature, 2.5–3.4 → Partial, 1.5–2.4 → Needs Work, < 1.5 → Not Ready | `"Mature"` / `"Partial"` / `"Needs Work"` / `"Not Ready"` (or `null` when `numeric_score` is `null`) |
| `severity_status` | Severity-count-driven: High ≥ 1 → Critical; else Medium ≥ 1 → Needs Work; else Ready | `"Critical"` / `"Needs Work"` / `"Ready"` |

**Category-level divergence is ALLOWED**. Example: a category whose only finding is a Score-3 (Low-severity) finding has `numeric_score` 3.67, `score_rating` `"Mature"`, and `severity_status` `"Needs Work"`. That is EXPECTED — the numeric-score band still rounds to Mature while the unified severity count flags one Low-severity finding that needs attention. The JSON surfaces both honestly so consumers can reason about each lens independently. **Repo-level divergence between the score-based band and the count-based tier is NOT allowed** — see the consistency check below.

When every question in a category resolves to N/A or Not Evaluated, `numeric_score` and `score_rating` are `null`, `severity_status` is `"Ready"`, and the MD and JSON artifacts MUST include a note that the category was not evaluated.

#### MD-Rendered Classification Rationale

The per-repo MOD MD artifact MUST render a classification rationale paragraph immediately after the classification tier is first stated. The paragraph:

1. States the specific counts that drove the tier (e.g., "This repo has 6 High findings, 4 Medium findings, 7 Low findings.").
2. Names the matched rule (e.g., "2-11 High → Remediation Required").
3. States the MOD classification rule and explicitly contrasts it with the ARA classification rule: ARA's "1 High" is an agent-deployment gate; MOD's "1 High" is typically a single modernization gap and maps to Pilot-Ready instead of Remediation Required.

#### `classification_consistency_check`

Every MOD JSON `classification` object MUST include a `classification_consistency_check` field whose value is either:

- The string `"consistent"` when the score-based tier (derived from `overall_score` band) and the count-based tier (derived from High / Medium counts) tell the same story per the equivalence table below:
  - Score ≥ 3.5 (Mature band) ≡ Cloud-Native Ready
  - Score 2.5–3.4 (Partial band) ≡ Pilot-Ready
  - Score 1.5–2.4 (Needs Work band) ≡ Remediation Required
  - Score < 1.5 (Not Ready band) ≡ Not Ready

- A structured divergence object when the equivalence does NOT hold:
  ```json
  {
    "status": "divergent",
    "score_band": "Partial",
    "count_tier": "Remediation Required",
    "reason": "Score 2.8 yields Partial band but 4 High findings force Remediation Required tier. Surface gating review recommended on INF-Q2, INF-Q10, SEC-Q1, SEC-Q5."
  }
  ```

When `classification_consistency_check.status == "divergent"`, the MOD MD artifact MUST render a clearly-labeled warning block naming the divergence, the underlying score-based band, the count-based tier, and the reason. Repo-level divergence is a RELEASE BLOCKER and MUST be either (a) corrected by fixing surface-gating or scoring, or (b) documented in the divergence object and flagged for the maintainer. Silent divergence is not acceptable.

Category-level divergence between `score_rating` and `severity_status` (described above) is a different phenomenon — it is permitted and does NOT trigger the repo-level `classification_consistency_check` warning.

---

### Per-Repo `pathways[]` Emission

Every per-repo MOD JSON artifact MUST emit a `pathways[]` array with exactly 7 entries — one per canonical pathway. This surfaces the AWS Modernization Pathways Summary Table as a structured JSON surface that the portfolio MOD TD consumes.

#### The 7 Canonical Pathway IDs

Each per-repo MOD JSON MUST emit one `pathways[]` entry per pathway, using these exact `id` values:

- `move-to-cloud-native`
- `move-to-containers`
- `move-to-open-source`
- `move-to-managed-databases`
- `move-to-managed-analytics`
- `move-to-modern-devops`
- `move-to-ai`

The `name` field on each entry carries the human-readable label (e.g., `"Move to Cloud Native"`) matching the Pathway Summary Table in MD.

#### Per-Entry Shape

Every `pathways[]` entry carries:

| Field | Type | Description |
|---|---|---|
| `id` | enum | One of the 7 canonical IDs above. |
| `name` | string | Display name matching the pathway table. |
| `status` | enum | `"Triggered"` / `"Not Triggered"` / `"Not Applicable"`. |
| `priority` | enum or null | `"High"` / `"Medium"` / `"Low"` for Triggered pathways; `null` for Not Triggered or Not Applicable. |
| `effort` | enum or null | `"High"` / `"Medium"` / `"Low"` for Triggered pathways; `null` for Not Triggered or Not Applicable. |
| `key_trigger_criteria` | string | Prose describing the pathway's trigger condition from Step 7 (e.g., "APP-Q2 < 3 OR INF-Q1 < 3 OR APP-Q3 < 3 OR APP-Q4 < 3"). For Not Applicable pathways, this field states WHY the pathway does not apply to the repo's `repo_type`. |
| `triggering_questions[]` | array | Tuples of `{question_id, score, note?}` identifying the questions consulted. See rules below. |
| `detail` | object or null | Structured detail for Triggered pathways (AWS services, learning materials, immediate actions); `null` for Not Triggered or Not Applicable. |
| `not_triggered_reason` | string, optional | Prose explanation; present on Not Triggered pathways when `triggering_questions[]` alone does not convey the reason. |

#### Status Rules

- **`"Triggered"`** — At least one rubric question named in the pathway's trigger condition (Step 7 above) scored below its threshold after surface-gating and archetype-calibration were applied. The `triggering_questions[]` array MUST be non-empty and MUST contain ONLY `(question_id, score)` tuples whose `score < 3` AND whose `question_id` belongs to the pathway's trigger set (for pathways whose triggers are phrased as `"QUESTION < 3"`). This matches the Step 7 trigger condition exactly — the JSON surfaces the consulted questions as structured data without altering the trigger logic.

- **`"Not Triggered"`** — All rubric questions in the pathway's trigger set scored at or above their threshold (e.g., score ≥ 3), OR the contextual guard from the Pathway Summary Table blocked the trigger (e.g., "Must be EC2/VM-based" for Move to Containers when the workload is already on Lambda/Fargate/ECS). The `triggering_questions[]` array carries the consulted questions with a per-question `note` explaining why each did NOT fire (e.g., `{"question_id": "INF-Q1", "score": 3, "note": "INF-Q1 = 3 meets threshold; pathway not needed"}`). For guard-blocked pathways, a pathway-level `not_triggered_reason` field explains the guard (e.g., `"not_triggered_reason": "Workload already runs on Lambda/Fargate/ECS; container pathway does not apply"`).

- **`"Not Applicable"`** — The pathway does not apply to the repo's `repo_type` (e.g., "Move to Containers" is N/A for a `library` repo because there is no deployable workload). The `key_trigger_criteria` field MUST carry the prose reason (e.g., `"Not applicable — repo_type is 'library' and the pathway requires a deployable workload"`). The `triggering_questions[]` array MAY be empty.

For every pathway with `status == "Triggered"`, the per-repo MOD MD artifact MUST emit a Pathway Detail subsection containing the content specified in Step 7's "When Triggered, Include in Pathway Detail Section" guidance. The corresponding `pathways[].detail` JSON object carries the structured fields (triggered_questions, recommended AWS services, immediate actions, learning materials) so that the portfolio MOD TD can aggregate pathway detail content from JSON alone.

#### Surface-Gating Discipline

Surface flags (`has_persistent_data_store`, `has_at_rest_data_surface`, `has_deployed_workload`, `has_api_surface`, `has_multi_instance_deployment`, `has_iac_provisioning_aws_resources` — see Step 1.6) MUST be applied BEFORE pathway evaluation. If a surface flag is `false` for a question that would otherwise fire a pathway (e.g., DATA-Q3 < 3 would fire Move to Managed Databases, but `has_persistent_data_store == false` means DATA-Q3 was recorded as Not Evaluated), the question does NOT count toward pathway triggering. This prevents a pathway from firing on a question that was not actually evaluated.

#### Key Trigger Conditions Reference

The per-pathway trigger conditions used to populate `triggering_questions[]` come from the Pathway Summary Table (Step 7) unchanged. The canonical trigger logic is defined in Step 7.1 through 7.7 above; the table below is a quick reference:

| `id` | Primary Trigger | Supporting Triggers (strengthen, not required) | Contextual Guard |
|---|---|---|---|
| `move-to-cloud-native` | APP-Q2 < 3 | At least one of INF-Q1 < 3, APP-Q3 < 3, APP-Q4 < 3 must also be true | — |
| `move-to-containers` | INF-Q1 < 3 AND no container definitions found | — | SHALL NOT trigger if compute is already Lambda/Fargate/ECS |
| `move-to-open-source` | DATA-Q4 < 3 | Commercial DB engines detected in INF-Q2 finding | — |
| `move-to-managed-databases` | INF-Q2 < 3 | DATA-Q3 < 3 (strengthens, not required) | — |
| `move-to-managed-analytics` | INF-Q4 < 3 | Data source sprawl with no unified access layer (DATA-Q2 finding) | Evidence of data processing workloads must exist |
| `move-to-modern-devops` | INF-Q10 < 3 OR INF-Q11 < 3 | OPS-Q5 < 3, OPS-Q6 < 3 (strengthen, not required) | — |
| `move-to-ai` | No AI/agent frameworks, no vector DB, no RAG, no agent eval framework | — | Requires AI/agent/LLM intent in portfolio or service context |

**Primary vs Supporting:** The trigger logic (Step 7.1–7.7) uses a Primary + Supporting model. A pathway is Triggered ONLY when the Primary condition is met. Supporting conditions strengthen the case (inform the Pathway Detail section) but do NOT on their own trigger a pathway. The `triggering_questions[]` array MUST include the Primary question that triggered the pathway plus any Supporting questions whose scores also scored below threshold.

The `triggering_questions[]` array is the structured surface of the "which questions fired, at what scores, why" information that the Pathway Detail section describes in prose — this information must be visible every time a pathway appears (per-repo, per-repo roll-up in portfolio `repositories[].pathways_triggered[]`, and portfolio top-level `pathways[]`).

---

### MD Report Contents

#### MD Sections

The following content MUST be retained in every per-repo MOD MD report:

- **Overall Score line** rendered in the MD metadata block as `Overall Score: X.XX / 4.0` using the repo-level numeric score. Preserved as a first-class field in JSON under `overall_score`.
- **Score Summary table** — per-category numeric scores with the ✅ Mature / 🟡 Partial / 🟠 Needs Work / ❌ Not Ready emoji rating (the `score_rating` label). Rendered unchanged.
- **Scoring Notes** arithmetic breakdown (e.g., `"INF: (3+1+2+2+1+2+1+2+2+2+2) / 11 = 20/11 = 1.82"`) — preserved in MD. JSON does NOT need to carry Scoring Notes because the final numeric scores are already in `categories[].numeric_score`.
- **Top 5 Gaps** table — rendered in MD with columns `#`, `Question`, `Score`, `Gap`, `Impact`. JSON carries the same data under `top_gaps[]`.
- **Decomposition Strategy** conditional section (fires when APP-Q2 < 3) — rendered in MD including the four approach options (strengthen as modular monolith, Strangler Fig parallel track, conditional/adaptive, big-bang with recommendation against), pattern recommendations (Anti-corruption Layer, Saga, Event Sourcing, Hexagonal Architecture), and level-of-effort estimates. JSON carries a structured `decomposition_strategy` object when the condition fires, `null` otherwise.
- **Archetype Justification** prose — rendered in the MD metadata block. For the four archetype-calibrated questions (INF-Q3, INF-Q4, APP-Q3, APP-Q4), MD prose MUST explain how the detected or supplied archetype shaped the score whenever `mod_metadata.archetype_calibrated == true`.
- **AWS Modernization Pathways** Summary Table with status/priority/effort/Key Trigger Criteria columns, AND Pathway Detail subsections for each Triggered pathway. See the Per-Repo `pathways[]` Emission section for the JSON surface.
- **Aggregate Evidence Index** at the end of the report. JSON consumers can re-derive this section from the union of `findings[].evidence` across all findings.
- **Surface Flags block** with six boolean flags and rationale — rendered in the MD metadata block and in JSON under `metadata.surface_flags`.

The MD artifact renders the following inline annotations alongside the content above:

- Per-finding unified severity badges ("High" / "Medium" / "Low") next to the score label.
- Classification tier (Cloud-Native Ready / Pilot-Ready / Remediation Required / Not Ready) with the matched-rule annotation, rendered after the Overall Score line.
- Per-finding `priority`, `effort`, `phase` values in the finding header block.
- Category `severity_status` (Ready / Needs Work / Critical) in the Score Summary table as a new column alongside the `score_rating`.
- Classification-consistency warning block rendered immediately after the classification tier WHEN `classification_consistency_check.status == "divergent"`.

---

### Four-Artifact Output Contract (MOD)

Every per-repo MOD analysis emits four artifacts: three report artifacts plus a metadata sidecar. This mirrors the ARA four-artifact contract with MOD-specific filenames and a MOD-specific HTML visual contract.

#### Artifacts

| Artifact | Filename | Purpose |
|---|---|---|
| Markdown report | `{repo}-mod-report.md` | Richest-prose artifact. Renders every narrative section (Overall Score, Score Summary table, Scoring Notes arithmetic, Top 5 Gaps, Decomposition Strategy, Archetype Justification, AWS Modernization Pathways summary and detail subsections, aggregate Evidence Index). |
| JSON report | `{repo}-mod-report.json` | **Canonical machine-readable contract.** Consumed by the webapp and the portfolio MOD TD. Every semantic field (findings, classification, categories with all three of `numeric_score` / `score_rating` / `severity_status`, `pathways[]` covering all 7 pathways, `overall_score`, `top_gaps[]`, `decomposition_strategy`, `metadata` including surface flags and archetype justification) is present. |
| HTML report | `{repo}-mod-report.html` | Single self-contained HTML file (no external asset fetches at render time). Renders a subset of the JSON. Tab order: **stats → tech stack → findings → roadmap → programs**. Visual contract defined inline below. |
| Metadata sidecar | `{repo}-mod-report.metadata.json` | Tiny JSON file carrying version compatibility data. Read by downstream consumers before consuming the main JSON. |

The JSON artifact is the canonical contract. If any artifacts disagree on a field, JSON wins.

#### Metadata Sidecar Fields

The sidecar carries the minimum fields required for version compatibility checks:

```json
{
  "analysis_type": "mod",
  "analysis_date": "2026-04-30",
  "td_version": "modernization-readiness-analysis"
}
```

These same fields are redundantly embedded at the root of the main JSON under `metadata` so that consumers which skip the sidecar still have direct access.

#### HTML Visual Contract

The per-repo MOD HTML artifact is a single self-contained HTML file. The tab order matches the webapp and the ARA HTML: **stats → tech stack → findings → roadmap → programs**.

The full visual contract is defined inline below — do NOT reference external files. The HTML renders a subset of the JSON artifact.

- Header title (`{repo_name} - Modernization Readiness Analysis Report`) and subtitle line (`{date} · {language} · {loc} LOC · Portfolio: {portfolio_name}`).
- Executive Summary prose block with four subsections (Repository Status, Key Findings, Remediation Plan, Recommended Actions) and the emoji + tier mapping: 🟢 Cloud-Native Ready / 🟡 Pilot-Ready / 🟠 Remediation Required (rendered with the "Significant Modernization Required" prose label) / 🔴 Not Ready.
- Stats card row (4 cards): Total Findings, High Severity, Medium Severity, Low Severity. MOD KEEPS the Low Severity card (ARA omits Low per ARA convention).
- Technology Stack table with Language / Lines of Code / Framework / Priority rows.
- **Category-by-Category Breakdown table** with status values `Ready` (green), `Needs Work` (yellow/orange), `Critical` (red). This is the MOD convention — ARA uses `Ready` / `Needs Work` / `Blocked` instead.
- **Detailed Findings cards** — simpler than ARA. Each card has `{question_id}: {title}` with a severity badge (uppercase `HIGH` / `MEDIUM` / `LOW`), a `Category:` line, a `FINDING` subsection with the finding description, and a `RECOMMENDATION` subsection. There is NO `GAP` subsection on MOD cards (ARA has one; MOD's gap description is absorbed into the finding description). Findings are ordered severity-descending (High → Medium → Low) then by category order (INF → APP → DATA → SEC → OPS).
- Modernization Recommendation footer block (emoji-headlined with top-3 High-severity recommendations).
- Footer line (`Generated by AWS Transform · Modernization Readiness Analysis Report`).

> **Note on the "programs" tab / Recommended Actions:** In the per-repo MOD report these render modernization pathways (Move to X) and pathway-mapped learning materials only — NOT AWS engagement programs (MAP, OLA, AppMod, etc.). Engagement-program recommendations are produced exclusively by the Portfolio Modernization Readiness Analysis from the shared AWS Program & GTM Library. The per-repo `recommended_actions` content is limited to AWS Transform Custom (expand-analysis) plus a pointer to run the portfolio TD.

**HTML-escaping discipline.** Every data value rendered in HTML originates from the JSON artifact (MD prose is NOT part of the HTML round-trip contract). All attacker-controlled strings MUST be HTML-escaped before embedding: repo names, evidence file paths, finding titles, finding descriptions, recommendation text, pathway names, and any other string that originates from repository content or from free-text fields in `additionalPlanContext`. Escape `<`, `>`, `&`, `"`, `'` at render time. This is the same escaping discipline applied to the ARA HTML artifact.

#### Slug Derivation

The `{repo-name}` placeholder in artifact filenames refers to the **slug**, not the filesystem basename. The slug is derived as follows:

```
slug = lowercase(repo.name)
       with any character not in [a-z0-9_-] replaced by '-'
```

When this TD is invoked via the orchestrator, the slug source is the `name` field of the repository entry in `portfolio-config.yaml`. When invoked manually, the slug source is provided implicitly via the working directory's `additionalPlanContext` or, in absence, the repository's directory name normalized by the rule above. **Always derive from the configured name, not the on-disk basename** — they can mismatch (e.g., a `MonoToMicroLegacy` directory configured as `unishop-monolith`).

#### Artifact Layout

```
{portfolio-or-repo}/
└── services/
    └── {repo-name}/
        └── modernization-readiness-analysis/
            ├── {repo-name}-mod-report.md
            ├── {repo-name}-mod-report.json
            ├── {repo-name}-mod-report.html
            └── {repo-name}-mod-report.metadata.json
```

---

## Error Handling

The TD is explicit about failure modes — no defensive inference, no silent skips. Failures name the offending element (question_id, file path, field) so assessors can remediate.

### Required-Field Failure

IF any of the 12 required per-finding fields is absent from an emitted finding, THEN the analysis SHALL fail, naming:
- The `question_id` of the offending finding
- The specific missing field

Example failure message: `"Analysis failed: finding for INF-Q1 is missing required field 'recommendation'. All 12 per-finding fields are REQUIRED."`

### N/A / Not Evaluated Leak

IF a finding is emitted for a question whose resolution was N/A or Not Evaluated, THEN the analysis SHALL fail, naming the `question_id` and the resolution status that should have been recorded in `evaluations[]` instead.

Example: `"Analysis failed: finding emitted for INF-Q2 but the question resolved to Not Evaluated (no persistent data store, has_persistent_data_store=false). N/A / Not Evaluated resolutions MUST be recorded in evaluations[] only."`

### MOD Archetype Calibration Without Justification

IF a MOD finding carries `mod_metadata.archetype_calibrated: true` but the MD artifact does NOT contain prose explaining how the archetype shaped the score, THEN the analysis SHALL fail naming the `question_id`.

### MOD Classification Divergence

IF the repo-level score-based band (derived from `overall_score`) and the count-based classification tier (derived from High / Medium counts) diverge under the equivalence table in the Classification section, THEN the TD SHALL EITHER:
1. Correct the scoring by re-applying surface-gating and archetype-calibration rules to eliminate the divergence, OR
2. Emit `classification.classification_consistency_check` as a structured `{status: "divergent", score_band, count_tier, reason}` object AND render a clearly-labeled warning block in the MD artifact naming the divergence, score_band, count_tier, and reason.

Silent divergence is NOT acceptable — repo-level divergence is a release blocker unless explicitly documented.
