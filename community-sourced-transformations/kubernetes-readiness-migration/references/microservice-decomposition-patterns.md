# Microservice Decomposition Patterns

Comprehensive guidance for decomposing monoliths into microservices during Kubernetes containerisation. This reference bridges Phase 1 analysis (identifying decomposition candidates) and Phase 2 execution (generating per-service manifests).

## Table of Contents

1. [Named Service Inventory Template](#named-service-inventory-template)
2. [Decomposition Complexity Rubric](#decomposition-complexity-rubric)
3. [Data Ownership Matrix](#data-ownership-matrix)
4. [First-Extraction Candidate Heuristics](#first-extraction-candidate-heuristics)
5. [AuthService Is Always Last](#authservice-is-always-last)
6. [Worker Specialisation Pattern](#worker-specialisation-pattern)
7. [Mode-Toggle Flag Detection](#mode-toggle-flag-detection)
8. [Shared-DB Remediation Ladder](#shared-db-remediation-ladder)
9. [Event Bus Migration Patterns](#event-bus-migration-patterns)
10. [Strangler Fig Pattern](#strangler-fig-pattern)
11. [HTTP+Consumer Co-Deployment Anti-Pattern](#httpconsumer-co-deployment-anti-pattern)
12. [Per-Service Docker Image Guidance](#per-service-docker-image-guidance)
13. [Technology-Specific Decomposition Triggers](#technology-specific-decomposition-triggers)
14. [HIPAA/Healthcare Boundary Decomposition](#hipaahealthcare-boundary-decomposition)
15. [Phase 2 Execution Rules](#phase-2-execution-rules)
16. [Output Templates](#output-templates)

---

## Named Service Inventory Template

Phase 1 MUST produce this table (not a generic visual diagram). Every row represents a named service candidate identified from source analysis.

**Mandatory columns:**

| ServiceName | DomainResponsibility | SourcePaths | OwnedTables | InboundAPIs | OutboundEvents | ScalingDriver | ExtractionOrder | Complexity | BlockingDependencies | DataOwnership |
|---|---|---|---|---|---|---|---|---|---|---|
| NotificationService | Email/SMS/push dispatch | `app/notifications/`, `app/mail/` | `notifications`, `email_log` | POST /notify | notification.sent | Queue depth | 1 | Low | None | exclusive-write |
| UploadService | File upload/download/presign | `app/storage/`, `app/uploads/` | `attachments` | POST /upload, GET /files/:id | file.uploaded | Request count | 2 | Low | S3 bucket | exclusive-write |
| SearchService | Full-text search indexing | `app/search/` | None (ES index) | GET /search | index.updated | Query volume | 3 | Low | Elasticsearch cluster | read-only |
| AuthService | Identity, login, JWT issuance | `app/auth/`, `app/users/` | `users`, `sessions`, `roles` | POST /login, GET /me | user.created | Login rate | LAST | High | All services adopt JWT | shared-write-BLOCKER |

**Enumeration algorithm** (how to discover candidates):
1. **Route-group analysis**: Group HTTP routes by URL prefix (`/api/uploads/*`, `/api/auth/*`, `/api/search/*`). Each group with ≥3 endpoints is a candidate.
2. **Package/namespace scan**: Each top-level package/namespace with its own models = candidate.
3. **Queue channel scan**: Each distinct queue name or topic = worker candidate.
4. **Scheduled task scan**: Each cron entry = CronJob candidate (already in spec).
5. **Mode-toggle scan**: Each env flag that gates behaviour = per-mode image candidate.

**DataOwnership column values:**
- `exclusive-write` — only this service writes; others may read → Low complexity
- `read-only` — this service only reads from tables another service owns → Low complexity
- `shared-write-BLOCKER` — multiple services write same tables → extraction blocked until remediated

---

## Decomposition Complexity Rubric

Apply to EVERY row in the Named Service Inventory:

### Low Complexity
- No shared-DB FK constraints with other service candidates
- Single external dependency already externalised (e.g., S3, SMTP, Elasticsearch)
- Independent scaling axis clear (queue depth, request count, connection count)
- Examples: NotificationService, FileStorageService, SearchService, CronJob extraction
- **Action in Phase 2**: Generate separate Deployment + Service + NetworkPolicy manifests immediately

### Medium Complexity
- Shared DB pool but no cross-service WRITES (reads from other domains acceptable via views)
- Requires package refactoring or config split (shared `config.py`, `application.yml`)
- 1–2 inter-service API dependencies to introduce
- Examples: CartService (reads ProductService tables), ShippingService, ReportingService
- **Action in Phase 2**: Document in INFRASTRUCTURE_REQUIREMENTS.md §0 with extraction prerequisites. Generate separate Dockerfile but shared DB connection for now.

### High Complexity
- Distributed transactions required across service boundaries
- Multiple cross-cutting FK constraints (e.g., `orders.user_id`, `sessions.user_id`, `payments.order_id`)
- Shared mutable state (in-process plugin coupling, shared static registries)
- Service mesh or API gateway prerequisite for traffic routing
- Examples: AuthService, OrderService (ecommerce), ObservationService (EHR)
- **Action in Phase 2**: Document extraction roadmap only. Do NOT generate separate manifests. Mark as "Decomposition Deferred" with blocking reasons.

---

## Data Ownership Matrix

Phase 1 MUST produce this for projects with ≥3 tables and ≥2 service candidates:

| Table/Collection | WrittenBy | ReadBy | FK Constraints | DecompositionBlocker |
|---|---|---|---|---|
| `users` | AuthService | ALL | `orders.user_id`, `posts.author_id` | YES — shared identity |
| `notifications` | NotificationService | ReportingService | None | No |
| `attachments` | UploadService | ContentService | `posts.attachment_id` | No — read-only FK |
| `orders` | OrderService | ShippingService, ReportingService | `order_items.order_id` | YES — distributed tx |

**Rules:**
- Any table with multiple services in WrittenBy = CRITICAL blocker
- Tables with only read-only FKs from other services = not blocked (use API or DB view)
- Apply table-to-bounded-context mapping: group tables that share FK relationships into same service

---

## First-Extraction Candidate Heuristics

These service types are consistently the lowest-risk, highest-value first extractions. Evaluate in this priority order:

### Priority 1: StorageService / UploadService / FileService
**Detection triggers:**
- `AWS_S3_BUCKET`, `STORAGE_PATH`, `UPLOAD_DIR` env vars
- S3 SDK imports (`boto3`, `aws-sdk`, `Aws\S3`)
- Existing module boundary (`app/storage/`, `services/upload/`)

**Why Low complexity:** No PostgreSQL/MySQL dependency for core operation; env vars exclusively scoped to storage; immediate IRSA security win (S3 IAM role scoped to this service only).

### Priority 2: NotificationService
**Detection triggers:**
- `SMTP_HOST`, `MAILGUN_SECRET`, `SENDGRID_API_KEY` env vars
- Inline `Mail::send()`, `send_mail()`, SMTP calls in controllers
- Queue job names containing "notification", "email", "sms"

**Why Low complexity:** Pure event consumer; SMTP credentials already isolated; zero shared-state dependencies. Extraction pattern: replace inline email dispatch with event emission → NotificationService is standalone consumer.

### Priority 3: SearchService / ElasticsearchService
**Detection triggers:**
- `ES_HOSTS`, `ELASTICSEARCH_URL`, `SEARCH_INDEX` env vars
- SQL `FULLTEXT` or `LIKE '%query%'` for product/content search
- `post_save` signals or observer hooks firing synchronously to update index

**Why Low complexity:** Read-only index consumer. **Prerequisite:** replace sync signals with async queue/event before extraction (sync index updates on the web request path = latency coupling).

### Priority 4: CronJob Extraction (already in core spec)
Scheduled tasks with independent logic → Kubernetes CronJob with separate image.

**Rule:** These candidates ALWAYS go before AuthService. Never attempt auth extraction first.

---

## AuthService Is Always Last

Auth/Identity is ALWAYS High complexity. Never a first-extraction candidate.

**Why:**
- Shared `users` table with FK references from nearly every other table
- In-process session validation coupled to every request middleware
- Password hashing, role checking, token issuance deeply embedded

**Prerequisites for full extraction:**
1. All other services adopt JWT validation (verify token signature, no DB call)
2. UserProjection sync pattern — downstream services maintain read-only user cache
3. Shared identity tables dropped from downstream service schemas
4. JWKS endpoint exposed by AuthService for public key rotation

**Immediate mitigations (apply during Phase 2 even without full extraction):**
- LDAP timeout cap: set `LDAP_TIMEOUT=5s` to prevent cascading failures
- Circuit breaker around SSO/OAuth providers
- Session TTL enforcement to prevent unbounded session table growth

---

## Worker Specialisation Pattern

**When:** A single queue worker handles jobs from multiple domains (notifications, exports, search indexing, file cleanup) via a single queue.

**Detection:**
```bash
# Celery
grep -rn 'app.task\|@shared_task' . --include='*.py' | grep -oP 'name=["\047]([^"]+)' | sort
# Laravel
grep -rn 'class.*implements ShouldQueue' . --include='*.php'
# BullMQ/Node
grep -rn 'queue.add\|Queue(' . --include='*.js' --include='*.ts'
```

**Decomposition pattern:**
1. Identify distinct job domains (notification jobs, export jobs, indexing jobs)
2. Assign each domain a dedicated queue channel:
   - Laravel: `--queue=notifications`, `--queue=exports`
   - Celery: `CELERY_QUEUES` with separate routing keys per domain
   - BullMQ: Separate `Queue('notifications')`, `Queue('exports')`
3. Each specialised worker → own Deployment with independent resource limits
4. Each worker gets its own Docker image OR shared image with different `command:`

**Kubernetes manifests (per worker):**
```yaml
# deployment-worker-notifications.yaml
spec:
  template:
    spec:
      containers:
      - name: worker-notifications
        command: ["celery", "-A", "app", "worker", "--queues=notifications", "--concurrency=2"]
        resources:
          limits: { memory: "256Mi", cpu: "200m" }
```

**This is LOW-complexity decomposition** — does not require DB schema split.

---

## Mode-Toggle Flag Detection

**Detection triggers** — these env vars indicate runtime mode selection:
- `CONSUMER_ONLY`, `DISABLE_SCHEDULER`, `WORKER_ONLY`, `APP_MODE`
- `ENABLE_WEB=false`, `ENABLE_WORKER=true`, `RUN_MODE=consumer`

**Rule:** Each mode-toggle flag MUST become its own Docker image with a fixed entry point. Mode-toggle env flags are decomposition indicators, NOT solutions.

**Before (anti-pattern):**
```yaml
# Single Deployment with mode flags
env:
- name: APP_MODE
  value: "worker"
- name: DISABLE_SCHEDULER
  value: "true"
```

**After (correct):**
```dockerfile
# Dockerfile.worker
FROM app-base AS worker
CMD ["python", "-m", "celery", "-A", "app", "worker"]

# Dockerfile.scheduler
FROM app-base AS scheduler
CMD ["python", "-m", "celery", "-A", "app", "beat"]

# Dockerfile.web
FROM app-base AS web
CMD ["gunicorn", "app:create_app()"]
```

**Shared modules** (config, models, storage) → shared library package:
- Python: `pip install -e ./common/` or `COPY common/ && pip install ./common/`
- Node.js: `COPY packages/shared/ && npm install ./packages/shared`
- Go: Shared module in go.work or internal/ package
- PHP: Composer path repository
- Java: Shared Maven module

---

## Shared-DB Remediation Ladder

When multiple service candidates share a single database, apply remediation steps in order (each step enables the next):

| Step | Pattern | Effort | Enables |
|------|---------|--------|---------|
| 1 | **Schema-per-domain prefixes** — `auth_users`, `notify_templates`, `order_items` | Low | Clear ownership visibility |
| 2 | **Read-only DB views per context** — `CREATE VIEW order_summary AS SELECT ...` | Low | Service reads via view, not raw table |
| 3 | **Per-service DB roles with table-level GRANT** — `GRANT SELECT ON auth_users TO order_svc` | Low | Enforce ownership at DB level |
| 4 | **Replace cross-service reads with API calls** — OrderService calls AuthService `/users/:id` | Medium | Removes direct DB coupling |
| 5 | **Event-driven CQRS projections** — AuthService publishes `user.updated`, OrderService maintains local projection | Medium-High | Removes synchronous coupling |
| 6 | **Database-per-service** — each service owns its own DB instance | High | Full independence |

**Phase 2 action:** Document current step and target step in INFRASTRUCTURE_REQUIREMENTS.md §0. Do NOT attempt step 6 during initial containerisation — steps 1–3 are achievable during Phase 2.

---

## Event Bus Migration Patterns

When decomposing, in-process events must become inter-service events:

| Source Pattern | Target Pattern | Broker |
|---|---|---|
| Django signals (`post_save`) | Celery task or Kafka message | Redis/RabbitMQ/Kafka |
| Laravel events (`Event::dispatch`) | Queue job with `ShouldQueue` | Redis/SQS |
| Spring `ApplicationEventPublisher` | Spring Cloud Stream or Kafka | Kafka/RabbitMQ |
| Node.js `EventEmitter` | BullMQ job or SNS message | Redis/SQS/SNS |
| Go channel sends | NATS or Kafka publish | NATS/Kafka |

**Key rule:** Synchronous in-process events on the request path (e.g., `post_save` updating search index) MUST become asynchronous BEFORE the service producing the event can be extracted. Otherwise, latency coupling defeats the purpose of decomposition.

---

## Strangler Fig Pattern

Incremental extraction via Kubernetes Ingress path-based routing:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /$2
spec:
  rules:
  - host: app.example.com
    http:
      paths:
      # Extracted services (specific paths first — longest match wins)
      - path: /api/uploads(/|$)(.*)
        pathType: ImplementationSpecific
        backend:
          service: { name: upload-service, port: { number: 8080 } }
      - path: /api/search(/|$)(.*)
        pathType: ImplementationSpecific
        backend:
          service: { name: search-service, port: { number: 8080 } }
      # Monolith catches everything else
      - path: /(.*)
        pathType: ImplementationSpecific
        backend:
          service: { name: monolith, port: { number: 8080 } }
```

**Rule:** Route extracted service paths BEFORE the monolith catch-all. Add paths incrementally as services are extracted.

---

## HTTP+Consumer Co-Deployment Anti-Pattern

**Detection:** A single Deployment runs both an HTTP API server AND a queue consumer (RabbitMQ, Celery, Kafka, SQS).

**Why this fails:**
- HTTP API needs CPU-based HPA (request latency sensitive)
- Queue consumer needs queue-depth-based HPA (KEDA) — CPU is near-zero while IO-waiting
- CPU HPA on combined deployment = queue consumer incorrectly scales with HTTP traffic

**Mandatory split:**
```yaml
# deployment-api.yaml
spec:
  template:
    spec:
      containers:
      - name: api
        command: ["gunicorn", "app:create_app()"]
  # HPA: cpu targetAverageUtilization: 70%

# deployment-consumer.yaml
spec:
  template:
    spec:
      containers:
      - name: consumer
        command: ["celery", "-A", "app", "worker"]
  # HPA: KEDA RabbitMQ queue-depth scaler
```

**Consumer Deployment specifics:**
- NetworkPolicy: deny-all ingress (no inbound traffic)
- readinessProbe: MAY omit with MIGRATION comment (pull-based worker)
- HPA: queue-depth via KEDA (`ScaledObject` targeting queue length)

**Validation failure:** CPU-based HPA on a combined HTTP+consumer Deployment is a decomposition failure that must be flagged.

---

## Per-Service Docker Image Guidance

Each extracted service gets its own Dockerfile:

| Service Type | Base Image | Size Target | Key Differences |
|---|---|---|---|
| Web API | language-slim | <200MB | Includes HTTP framework, no queue deps |
| Queue Worker | language-slim | <200MB | Excludes HTTP framework, includes queue client |
| CronJob | language-slim | <150MB | Minimal — only job logic + DB client |
| Search Indexer | language-slim | <150MB | ES client only, no web framework |

**Shared library pattern** (see Mode-Toggle Flag Detection §Shared modules):
```dockerfile
# Multi-stage shared base
FROM python:3.12-slim AS base
COPY common/ /build/common/
RUN pip install /build/common/

FROM base AS web
COPY web/ /app/
CMD ["gunicorn", "..."]

FROM base AS worker
COPY worker/ /app/
CMD ["celery", "..."]
```

---

## Technology-Specific Decomposition Triggers

### GraphQL (Apollo Server in package.json)
**Trigger:** `@apollo/server` or `apollo-server` in dependencies
**Pattern:** Apollo Federation v2 subgraph decomposition:
- Each resolver group (users, products, orders) → separate subgraph service
- Apollo Router as federated gateway
- `@key` directive identifies entity ownership across subgraphs

**Before:** Single monolithic GraphQL schema serving all types
**After:** Per-domain subgraph services behind Apollo Router

### Next.js (next in package.json)
**Trigger:** `next` in dependencies + API routes in `pages/api/` or `app/api/`
**Pattern:** API routes → named backend services; Next.js remains as BFF (Backend-for-Frontend)
- `NEXT_PUBLIC_*` vars = build-time (baked into client bundle)
- Non-prefixed vars = runtime server-side only
- Each `pages/api/<domain>/` directory = potential service extraction

### Ecommerce (opencart/magento/woocommerce in composer.json)
**Trigger:** `opencart`, `magento`, `woocommerce` in composer dependencies or directory structure
**Named service catalog:**
1. CatalogService (products, categories, attributes)
2. CartService (basket, pricing rules)
3. OrderService (checkout, order lifecycle)
4. PaymentService (gateway integration)
5. ShippingService (rates, tracking)
6. CustomerService (accounts, addresses)
7. NotificationService (email, SMS)
8. SearchService (product search, filters)
9. MediaService (product images, thumbnails)
10. AdminService (backoffice CRUD)
11. ReportingService (analytics, exports)
12. InventoryService (stock levels, reservations)

### WebSocket (socket.io in package.json)
**Trigger:** `socket.io` or `ws` in dependencies
**Pattern:** Extract RealtimeGatewayService:
- Separate Deployment scaled on connection count (not CPU)
- Redis adapter for cross-pod pub/sub (`@socket.io/redis-adapter`)
- Sticky sessions via Ingress annotation OR Redis-backed state
- HPA metric: WebSocket connection count

### Flask/Django Bounded Contexts
**Trigger:** `Flask` or `Django` in requirements.txt
**Pattern:**
- Flask: Each Blueprint with its own `models.py` = bounded context candidate
- Django: Each app (`INSTALLED_APPS`) with its own `models.py` = candidate
- SESSION_DRIVER=redis as decomposition BLOCKER (must migrate to JWT first)
- Per-service Redis namespace pattern: `REDIS_KEY_PREFIX=svc_name:`

---

## HIPAA/Healthcare Boundary Decomposition

**Trigger:** `openmrs`, `openemr`, medical/clinical domain keywords in source

**Primary splitting criterion:** HIPAA compliance boundary. Protected Health Information (PHI) data MUST be isolated from non-PHI services.

**Named clinical domain catalog:**
1. PatientService (demographics, PHI — HIPAA boundary)
2. ObservationService (vitals, lab results — HIPAA boundary)
3. OrderService (clinical orders, prescriptions — HIPAA boundary)
4. EncounterService (visits, notes — HIPAA boundary)
5. SchedulingService (appointments — partial PHI)
6. NotificationService (non-PHI alerts, reminders)
7. ReportingService (de-identified analytics)
8. AdminService (users, roles, configuration)
9. AuditService (access logs — HIPAA requirement)

**Rules:**
- Services 1–4 (HIPAA boundary) share a HIPAA-compliant DB with encryption at rest
- Non-PHI services (6–8) MUST NOT have direct DB access to PHI tables
- AuditService receives events from ALL services for HIPAA access logging
- PHI services = HIGH complexity extraction (shared patient FK everywhere)
- Non-PHI services (Notification, Reporting, Admin) = LOW complexity — extract first

---

## Phase 2 Execution Rules

### Execution Scope Constraint

**Execution scope ≠ Reporting scope.** The `decomposition_scope` parameter (SKILL.md Entry Criteria §5) controls what gets implemented:

- **`minimal` (default):** Only the Minimal Execution Set — the primary Deployment and required supporting resources. The full Named Service Inventory is documented in roadmaps but NOT generated as manifests.
- **`full`:** ALL Low and Medium complexity candidates get manifests (Deployment, Service, NetworkPolicy). High-complexity candidates remain documented only.

See `references/minimal-execution-set.md` for the resource classification table and how `full` mode changes it.

**In-scope for `minimal`:**
- ONE primary Deployment (web/API — owns the primary HTTP endpoint)
- ONE required background worker (only if app CANNOT function without it)
- ONE required migration Job (only if primary Deployment cannot start without it)
- Supporting resources: Namespace, ConfigMap, Secret, ServiceAccount, NetworkPolicy, Ingress

**Additional in-scope for `full`:**
- ALL Low-complexity service Deployments + Services + NetworkPolicies
- ALL Medium-complexity service Deployments + Services + NetworkPolicies (shared DB connection)
- CronJobs for in-scope services
- Per-service HPAs

**Always deferred (both modes):**
- High-complexity candidates (documented only)
- Multi-container sidecars, additional PVCs beyond primary need

### Sub-Phase §2: Decomposition Assessment

After Phase 1 produces the Named Service Inventory, Phase 2 MUST execute:

1. **Ingest** — Read the Named Service Inventory from the Phase 1 report
2. **Classify** — Apply the Complexity Rubric to each candidate (if not already rated)
3. **Identify primary Deployment** — Apply selection criteria: owns primary HTTP endpoint, fewest hard external dependencies, lowest ExtractionOrder
4. **Execute per decomposition_scope:**
   - **`minimal`**: Generate Dockerfile and manifests for primary Deployment only + required migration Job + required background worker. All other candidates → roadmap.
   - **`full`**: Generate Dockerfile and manifests for primary Deployment AND all Low/Medium candidates. Each gets Deployment + Service + NetworkPolicy. High → roadmap only.
5. **Document ALL candidates in roadmap:**
   - Low-complexity: INFRASTRUCTURE_REQUIREMENTS.md §0 as "Ready for extraction" (minimal) or "Extracted" (full)
   - Medium-complexity: INFRASTRUCTURE_REQUIREMENTS.md §0 with extraction prerequisites (minimal) or "Extracted with shared DB" (full)
   - High-complexity: INFRASTRUCTURE_REQUIREMENTS.md §0 with full blocking dependency list, marked "Decomposition Deferred"
6. **If NO candidates are Low-complexity:**
   - Document ALL candidates as "Decomposition Deferred" in TRANSFORMATION_SUMMARY.md
   - §Microservice Decomposition Roadmap section must explain WHY and list pre-requisites

### Decision: "Decomposition Deferred"

A service extraction is deferred when:
- Complexity is High AND no immediate mitigations available
- Shared-DB remediation ladder is at step 0 (no schema separation exists)
- Auth extraction attempted before other services adopt JWT

Document as:
```markdown
## Decomposition Deferred: AuthService
- **Complexity:** High
- **Blocking Dependencies:** All services use direct DB session lookup; JWT not adopted
- **Prerequisites:** (1) Implement JWT issuance, (2) All services validate JWT locally, (3) Remove direct users table access from OrderService, ShippingService
- **Target Extraction Phase:** Post-containerisation sprint 2
```

---

## Output Templates

### INFRASTRUCTURE_REQUIREMENTS.md §0 — Target Microservice Architecture

```markdown
## §0 Target Microservice Architecture

### Named Service Inventory

| Service | Responsibility | Complexity | ExtractionOrder | Status |
|---------|---------------|-----------|----------------|--------|
| NotificationService | Email/SMS dispatch | Low | 1 | Extracted (separate Deployment) |
| UploadService | File upload/presign | Low | 2 | Extracted (separate Deployment) |
| SearchService | Full-text search | Low | 3 | Deferred (async prerequisite) |
| AuthService | Identity/JWT | High | LAST | Deferred (JWT migration required) |

### Top-3 First-Extraction Candidates
1. **NotificationService** — pure event consumer, zero shared-state, SMTP isolated
2. **UploadService** — clean S3 module boundary, IRSA security win
3. **SearchService** — requires async signal decoupling first (Medium after that)

### Primary Blocking Anti-Patterns
- Shared `users` table with FK from 6 other tables → AuthService extraction blocked
- Single DATABASE_URL across all workloads → Step 1 remediation (schema prefixes) needed
- Synchronous Elasticsearch indexing on web request path → must async before SearchService extraction
```

### TRANSFORMATION_SUMMARY.md §Microservice Decomposition Roadmap

```markdown
## Microservice Decomposition Roadmap

### Scope Comparison: Minimal vs Full

| Service | Complexity | Minimal Scope Status | Full Scope Status | Effort (Full) | Prerequisites |
|---------|-----------|---------------------|-------------------|--------------|---------------|
| Primary (MonolithService) | N/A | ✅ Deployed | ✅ Deployed | — | None |
| NotificationService | Low | 📋 Documented only | ✅ Extracted | S | None |
| UploadService | Low | 📋 Documented only | ✅ Extracted | S | S3 bucket |
| SearchService | Medium | 📋 Documented only | ✅ Extracted (shared DB) | M | Async signal decoupling |
| AuthService | High | 📋 Documented only | 📋 Documented only | XL | JWT adoption across all services |

**Minimal scope total**: ~5-8 manifests (primary Deployment + supporting resources)
**Full scope total**: ~15-25 manifests (all Low/Medium candidates extracted)

### Extraction Status
| Service | Phase 2 Status | Manifests Generated | Notes |
|---------|---------------|--------------------|----|
| NotificationService | Extracted | deployment-notifications.yaml, service-notifications.yaml | Separate queue worker |
| UploadService | Extracted | deployment-uploads.yaml, service-uploads.yaml | IRSA-scoped S3 access |
| AuthService | Deferred | None | Requires JWT migration across all consumers |

### Blocking Anti-Patterns Addressed
- Replaced mode-toggle APP_MODE flag with per-workload Docker images
- Split HTTP+Consumer co-deployment into api + worker Deployments

### Remaining Extraction Prerequisites (post-containerisation)
- Adopt JWT validation in OrderService, ShippingService (currently direct DB session lookup)
- Implement event-driven user projection sync for downstream services
- Migrate from shared DATABASE_URL to per-service connection strings
```
