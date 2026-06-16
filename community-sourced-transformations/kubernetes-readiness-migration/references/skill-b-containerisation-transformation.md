# Kubernetes Containerisation Transformation

## Objective

Read an existing containerisation readiness report and transform the codebase for Kubernetes deployment: generate manifests, externalise state and storage, configure backing services, execute microservice decomposition for viable candidates (per `decomposition_scope`), and produce supporting documentation.

## Summary

This transformation consumes a containerisation readiness report, prompts for user preferences, then systematically resolves all findings. It ingests the Phase 1 Named Service Inventory and applies execution scope constraints: when `decomposition_scope=minimal` (default), only the primary Deployment and required supporting resources are generated; when `decomposition_scope=full`, manifests are generated for all Low/Medium complexity candidates. It generates Kubernetes YAML manifests, validates via docker build + kubeconform, and produces infrastructure documentation including §0 Target Microservice Architecture.

## Entry Criteria

1. A containerisation readiness report exists and is accessible.
2. The application source code is available for reading.
3. The user can provide a target transformation directory path.

## Per-Task Hygiene (Mandatory)

**Task-Boundary Enforcement Rule:** Each worker is assigned exactly ONE sub-phase via its injected task context. Reading SKILL.md is for reference guidance only — it does NOT authorise performing a different or additional sub-phase. If injected context conflicts with codebase state, complete the assigned task and report the discrepancy in the task report.

**Worker Fast-Fail Rule:** If the first tool result is a system error (DataNotFoundError, ToolError, platform error, or any non-content response), immediately write a task report with status: failure containing the verbatim error and exit — DO NOT issue sleep/retry/wait commands. Platform-level errors are not recoverable within the task.

Every task MUST execute:

- **Step-0 (start of task):** `find . -name '*.bak' -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/vendor/*' -delete`
- **After EVERY str_replace or pattern_replace call:** immediately run `rm -f <path>.bak`. Do NOT defer to end of task.
- **Before any str_replace/insert/file-patching command:** always `file_read` the CURRENT state of the target file. Never assume it matches the original codebase snapshot or a pre-batch context summary.

**12-Point Mandatory Closure Gate** — before closing ANY task:

0. **.bak sweep = 0** (HARD GATE — FIRST CHECK): `find <repo> -name '*.bak' -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/vendor/*' -delete && [ $(find <repo> -name '*.bak' -not -path '*/.git/*' | wc -l) -eq 0 ]`. If count ≠ 0, FAIL gate. **Prefer `sed -i` for simple substitutions — it avoids .bak creation entirely on Linux.**
1. **Stale-claim sweep** on all modified `.md` files (see `references/validation-patterns.md`)
2. **ENV_VARIABLES.md updated** for any new/removed env var. **Mandatory (with one exception)**: Any task that introduces new env var reads in source files (getenv/ENV.fetch/@Value/os.environ/process.env) MUST add corresponding ENV_VARIABLES.md rows before closing — narrow task scope descriptions do NOT override this requirement. **Documentation-only task exemption**: Tasks that modify only `.md` files and introduce no new source code env var reads are exempt from the ENV_VARIABLES.md update mandate only — all other Closure Gate requirements still apply. **Explicit diff check**: `grep -rhoP '\$\{\K[A-Z][A-Z0-9_]+' --include='*.properties' --include='*.yml' --include='*.yaml' .` and diff against ENV_VARIABLES.md. Any var in modified files but not in ENV_VARIABLES.md = FAIL — add missing rows before closing. **Sub-Phase 6 amplification**: S3/storage migration tasks typically introduce 3-6 new env vars (bucket, region, endpoint, key, secret) — run targeted grep on modified files after each S3 integration change. **Archetype callout**: Narrowly-scoped tasks like backing-services externalisation almost always introduce DB_HOST/PORT/USER/PASSWORD/NAME reads — update ENV_VARIABLES.md in same task.
3. **Count-literals verified** — numeric literals in docs match actual output
4. **Manifest reconciliation** — for manifest-generation tasks, run Criterion 10 A-C
5. **New env var assertion** — grep source for new env var reads; assert matching docs row
6. **Repair task double .bak sweep** — pre-edit AND post-edit
7. **Post-rename callsite verification** — after ANY rename, grep full source tree for old name
8. **Post-extraction orphaned reference cleanup** — after removing an export from any module OR extracting a class/module to a standalone process, `grep -rn REMOVED_EXPORT` across ALL source files. Importers retaining the removed name hold dead code — delete orphaned `require()`/`import` lines. After extracting a scheduled-task daemon, audit the entrypoint script for daemon-setup steps (cp crontab, chmod, touch cron.log) and remove them.
9. **Sync→async contract propagation** — after any sync→async conversion, parameter rename, or return-type change, `grep -rn functionName` across ALL source files. Every call site must be updated (add await, make caller async) or tagged with a MIGRATION comment.
10. **Post-extraction scheduler removal verification** — after creating a CronJob manifest for a scheduled task, grep the primary Deployment source for the original scheduler trigger and assert it is absent or disabled.
11. **ENV_VARIABLES.md mechanical diff gate** — run 4-pass grep on all modified files in this task; diff new `${VAR}` placeholders against ENV_VARIABLES.md; add any missing rows — zero undocumented vars at close.

## Task Ordering Constraints

1. Manifest generation is not final — at least one validation pass MUST follow.
2. Criterion 10 repair tasks MUST complete BEFORE TRANSFORMATION_SUMMARY.md writing.
3. validation-result.json is advisory only — re-derive from disk state.
4. CronJob/Job NetworkPolicy co-location: same task scope.
5. MIGRATION comment pre-scan before generating Part B resources.
6. **The task plan MUST always include a dedicated Final Review task as the highest-numbered task solely responsible for generating TRANSFORMATION_SUMMARY.md. This task MUST NOT be merged with the validation task.** If the current worker is last in the plan AND TRANSFORMATION_SUMMARY.md does not yet exist, generate it before writing the task report.
7. **Source-verification rule**: Before writing any cloud-SDK claim (S3, IRSA, SQS) in TRANSFORMATION_SUMMARY.md, verify the SDK is actually present in source dependencies (grep package manifest). Do not inherit claims from task descriptions without verification.

## Post-Externalisation Test Sync Gate

**When to run:** After adding `${VAR}` keys to production config (Sub-Phase §3) or after credential externalisation (Sub-Phase §7).

After externalising configuration or credentials, verify that test infrastructure remains functional:

| Stack | Action |
|-------|--------|
| Java/Spring | Diff production `.properties` against `src/test/resources/*.properties` — add safe test defaults for all new keys |
| Ruby/Rails | Add `ENV['VAR'] \|\|= '<default>'` guards in `spec/rails_helper.rb` BEFORE `require_relative`; add matching dummy values to Dockerfile `RUN ... asset:precompile` block |
| Python/Django | Add corresponding `os.environ.setdefault()` in `conftest.py` fixture |
| Node.js/Jest | Add env vars to `jest.setup.js` or inline in test invocation |

**Rule:** After any Sub-Phase §3 or §7 task that introduces `${VAR}` (no default) in production config, verify the test suite still passes (or document known pre-existing failures). Do NOT defer test sync to a separate task — complete within the same scope.

## Implementation Steps

### Sub-Phase §1: Initial Setup

**Task-Start Protocol (context budget management)**: For tasks scoped to ≤5 source files, workers MUST read ONLY the task-specific language reference — NOT full SKILL.md, NOT docker-build-validation.md, NOT all reference files. Read additional references only when the task explicitly requires validation, Docker build, or cross-cutting concerns. This prevents context budget exhaustion before productive output.

**Pre-flight codebase existence check (MANDATORY FIRST ACTION)**:
```bash
ls <codebase_path> && test $(find <codebase_path> -maxdepth 1 -type f | wc -l) -gt 0
```
If fails → write ERROR_REPORT.md and exit 1.

**Phase 1 Report Cross-Verification** (when available):
1. Confirm dependencies via source manifest grep.
2. Extract blocker counts from executive summary narrative only.
3. Service names from Phase 1 Container Decomposition Plan table, not generic templates.

Steps:
1. Prompt for readiness report path, validate, parse findings.
2. Prompt for target transformation directory. Copy source.
3. Ask access pattern (web/API/internal/mixed), detect HTTP server, ask about reverse proxy.

   **Non-interactive defaults**: Access pattern: `backend-api`; Reverse proxy: `no` (unless nginx.conf/.htaccess found); Ports: derive from source grep; Execution scope: per `decomposition_scope` parameter.

4. **Tier 3 validation decision gate**: See SKILL.md §Tier 3 Validation Decision Gate for the full protocol. Auto-detect cluster tools, attempt kwokctl download if absent, prompt user, record decision. In non-interactive/CI mode, default to skip but emit NOTICE. See also `references/docker-build-validation.md` §Tier 3 Ask-Before-Skip Protocol.
5. Parse scorecard, build prioritised work plan (Blockers first).

### Sub-Phase §2: Decomposition Assessment

Reads Phase 1 Named Service Inventory and translates into execution decisions. See `references/microservice-decomposition-patterns.md` §Phase 2 Execution Rules.

**Scope constraint by parameter:**
- When `decomposition_scope=minimal` (default): execution scope is limited to the Minimal Execution Set (see `references/minimal-execution-set.md`). Only primary Deployment + required Jobs/workers get manifests. All other candidates go to roadmap.
- When `decomposition_scope=full`: generate manifests for ALL Low and Medium complexity candidates. High-complexity candidates remain documented only.

6. **Ingest decomposition plan**: Extract Named Service Inventory from Phase 1 report. If absent or <2 rows, document "No decomposition candidates" and proceed to §3. If NSI table lacks 11 columns, re-run enumeration algorithm.

7. **Validate complexity ratings** against rubric (Low/Medium/High).

8. **Identify primary Deployment** — per `references/minimal-execution-set.md` selection criteria.

9. **Document ALL candidates in roadmap** — INFRASTRUCTURE_REQUIREMENTS.md §0 and TRANSFORMATION_SUMMARY.md §Roadmap.

10. **Generate manifests per scope:**
    - `minimal`: primary Deployment + required support only. Low-complexity → "Ready for extraction" in roadmap.
    - `full`: primary Deployment + ALL Low/Medium candidates get Deployment, Service, NetworkPolicy. High → documented only.

11. **Detect decomposition anti-patterns** (for in-scope services):
    - Mode-toggle flags → per-mode Docker images (§17)
    - HTTP+Consumer co-deployment → separate api + worker Deployments
    - Single queue worker multi-domain → Worker Specialisation split

### Sub-Phase §3: Configuration Externalisation (Factor 3)

**Mandatory first action — source-authoritative env var grep**: Before writing ENV_VARIABLES.md, grep ALL source files for env var read patterns using the framework-specific patterns from §Sub-Phase §15. Use `set()` deduplication. The grep result is the authoritative baseline for row count — task descriptions carry planning-level names that may differ.

**Entrypoint script secondary grep** (mandatory for ALL projects): After the language-specific grep, scan entrypoint/startup scripts for bash parameter-expansion variables:
```bash
grep -oP '\$\{\K[A-Z][A-Z0-9_]+(?=:-)' entrypoint*.sh docker-entrypoint*.sh start.sh run.sh 2>/dev/null | sort -u
```
Add results to ENV_VARIABLES.md under an "Entrypoint/Operational" subsection. These variables are language-agnostic and are missed by source-code-only greps.

**Files in scope**: Application config, docker-compose*.yml (all overlays), entrypoint scripts, infrastructure config (nginx.conf, supervisord.conf, crontab).

12. Replace hardcoded config with env var reads.
13. Refactor environment-specific config files.
14. Create ENV_VARIABLES.md (name, description, example, required/optional, K8s Scope). Source code is authoritative for var names.
15. Grep profile/override config files for hardcoded overrides.
16. PHP type safety: `filter_var` for booleans, `(int)` for integers.
17. Configuration bypass patterns: inspect commented-out keys; grep direct config accessor calls.

**Post-config-module patch sweep**: After patching any config module, grep ALL non-config source files for surviving call-site fallback expressions (e.g., `process.env.X || "localhost"`, `os.environ.get('X', 'localhost')`). Config-module-level fix alone is insufficient when application files read env vars directly bypassing the config module.

**Per-document stale-claim gate**: After generating or modifying ENV_VARIABLES.md or any other `.md` document, immediately run `grep -niE 'will|shall|would' <file>` — do not defer to Final Review.

### Sub-Phase §4: Session and Cache Externalisation (Factor 6)

18. **Session verification gate**: Before adding Redis, grep for DB-backed patterns (Django `SESSION_ENGINE=...db`, Rails `ActiveRecord::SessionStore`, PHP `session.save_handler=user`). DB-backed → Redis NOT required.
19. Replace file-based caching with distributed cache (retain pod-local for staleness-tolerant data).
20. Configure connections via env vars.

### Sub-Phase §5: Logging Transformation (Factor 11)

**Pre-action step (MANDATORY):** Before modifying any log config file, run from repo root:
```bash
grep -rl 'RollingFile\|FileAppender\|DailyRollingFileAppender' --include='*.xml' --include='*.properties' --include='*.yml' .
```
Apply transformation to EVERY discovered file — not just the first one found. Multi-module projects commonly have 2-5 separate logging config files.

**Guard:** Before removing non-file appenders (e.g., SocketAppender, JMXAppender), check if they are read programmatically (in-memory appenders backing UI features like admin log viewers). Only remove file-path-writing appenders.

**Downstream test impact:** After changing default log output to stderr, immediately run the unit test suite. Test harnesses that capture stderr to BytesIO/StringIO buffers will see unexpected output. Document regressions in the task report for subsequent test tasks.

21. Refactor file-based logging to stdout/stderr.
22. Remove log rotation/archival.
23. Retain constructor params for API compat.

### Sub-Phase §5b: SMTP Relay Configuration

When email sending detected, externalise SMTP config. Standard vars: SMTP_HOST, SMTP_PORT (ConfigMap); SMTP_PASSWORD (Secret); MAILER_FROM_ADDRESS (ConfigMap). Include all three port variants (25, 465, 587) in NetworkPolicy egress.

### Sub-Phase §6: Local Filesystem to S3 Migration

24-30. Refactor persistent data to S3 via SDK. User uploads: stream immediately. Images: S3 + pre-signed URLs. Downloads: S3 GetObject. Backups: document external CronJob. Temp/cache: emptyDir volumes. Audit health endpoint handlers for local FS checks.

### Sub-Phase §7: Credentials and Secrets Remediation

See `references/credential-audit-patterns.md` for the complete procedure (Forms A–F, IRSA, Secret classification).

31. docker-compose*.yml credential audit FIRST.
32. Remove entrypoint scripts that write credentials.
33. AWS SDK: remove hardcoded keys, use default credential provider chain (IRSA).
34. IRSA conditional: only set credentials when BOTH access-key and secret-key are non-empty.
35. Apply IRSA to EVERY SDK entry point.
36. AWS keys must be exactly `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.

### Sub-Phase §8: Backing Services Configuration (Factor 4)

37. Replace hardcoded service addresses with env var reads.
38. Separate env vars for distinct concerns sharing same backing service.

### Sub-Phase §9: Scheduled Tasks and Background Jobs (Factor 8)

39. Extract scheduled tasks. **Pre-extraction check**: Confirm tasks are actually registered (empty scheduler → skip). **Framework scheduler exception**: For frameworks with built-in scheduler entrypoints (Laravel Kernel, Rails schedule.rb, Django/Celery beat, Quartz Spring, APScheduler, node-cron), always generate CronJob regardless of registered task count — operators add tasks dynamically. **Disabled-scheduler carve-out**: If scheduler class exists but is explicitly disabled (e.g., `spring.quartz.auto-startup=false`), treat as empty — do not generate CronJob.
40. CronJob manifests with concurrencyPolicy: Forbid. Add `app.kubernetes.io/role: cronjob` label for NetworkPolicy targeting.
41. Worker Deployment for event-driven jobs with distributed locking.
42. Extraction checklist: remove scheduler entry, grep consumers of removed exports, Node.js require.main guard.

### Scheduled-Task Extraction Checklist

After creating a CronJob manifest for any scheduled task, complete ALL items:

1. **Grep for scheduler trigger in primary source**: `grep -rn 'cron.AddFunc\|@Scheduled\|APScheduler.add_job\|cron.schedule\|whenever' src/` — identify the in-process scheduler call.
2. **Remove or disable the scheduler from primary binary**: Delete the in-process scheduler registration (the code that triggers the task on a timer). The Kubernetes CronJob schedule replaces it.
3. **Convert cron format (Spring 6-field → K8s 5-field)**: Spring `@Scheduled(cron="0 0 */6 * * *")` has 6 fields (seconds first) — drop the leading seconds field for Kubernetes: `"0 */6 * * *"`. Add a YAML comment documenting the conversion.
4. **Sub-minute intervals**: For intervals <60s (e.g., APScheduler `IntervalTrigger(seconds=30)`), use the shortest valid K8s schedule (`"* * * * *"` = every minute) with `activeDeadlineSeconds` < 60 on the CronJob spec.
5. **Assert scheduler trigger absent post-task**: `grep -rn '<trigger_pattern>' src/` — must return zero matches (or matches only in test/docs).

### Sub-Phase §10: Concurrency and Horizontal Scaling

43. Replace in-memory event buses, rate limiters, sequence generators.
44. Document resource sizing in infrastructure requirements.

### Sub-Phase §11: Build, Release, Run Separation (Factor 5)

45-47. Move build activities to Dockerfile. Produce immutable image.

### Sub-Phase §12: Disposability and Startup Resilience (Factor 9)

48. Add exponential backoff retry for database/Redis. Circuit breakers for non-critical deps.
49. Extract heavy first-boot init to K8s Job. Set `terminationGracePeriodSeconds` to exceed application graceful shutdown window. Stack-specific references are authoritative when present (java-jvm-patterns.md, php-patterns.md override the generic formula).
50. Remove runtime chown — set ownership at build time.

### Sub-Phase §13: Security Hardening

51. Non-root user in Dockerfile. Remove runtime root operations.
52. Configurable temp directory for tmpfs mount.
53. nginx: listen 8080, Service routes 80→8080. Sidecar: fastcgi_pass localhost:9000.

**Writable Path Discovery**: After setting `readOnlyRootFilesystem: true`, identify all paths the application writes to at runtime (logs, cache, tmp, sessions, upload buffers, pid files). Add emptyDir volumes for each writable path. Common paths by stack:
- PHP-FPM: `/tmp`, `/var/run/php`, `/var/log`, session path
- nginx: `/var/cache/nginx`, `/var/run`, `/tmp`
- Java: `/tmp`
- Python: framework-specific (Celery Beat: schedule DB path; gunicorn: worker tmp)
- Node.js: `/tmp`, upload buffer path

### Sub-Phase §14: Database Connection Optimisation

54. Connection pooler requirements, fix global settings, proper locking.

### Sub-Phase §15: Kubernetes Manifest Generation

55. Generate manifests in kubernetes/ for the execution scope (per `decomposition_scope`):
    - `minimal`: Namespace, primary Deployment, Service, ConfigMap, Secret, NetworkPolicy, optional required Job/worker.
    - `full`: All of the above PLUS Deployment+Service+NetworkPolicy for each Low/Medium candidate.

    **For complex projects** (>3 workloads or >20 env vars): split into two tasks: (a) core resources, (b) policy/scaling + validation.

    **Manifest generation MUST NOT be the final task.** At least one validation/repair pass follows.

    **Blocker-fix ConfigMap override**: When Phase 1 identifies a blocker whose fix is a specific ConfigMap override (e.g., a hardcoded default that must be overridden at runtime), manifest generation MUST apply that override in the ConfigMap and cite the blocker ID in a YAML comment (e.g., `# Blocker F3: override source-code default`).

    **Post-manifest ENV_VARIABLES.md reconciliation**: Run `references/validation-patterns.md` §Post-Manifest ENV_VARIABLES.md Reconciliation within same task scope.

55b. **Source-authoritative env var gate (mandatory pre-manifest)**: Before finalising ConfigMap/Secret keys, grep actual source files for env var read patterns. Source code is authoritative — not task descriptions.

    **Framework-specific grep patterns:**

    | Framework | Grep Pattern |
    |-----------|-------------|
    | Ruby | `grep -rhoP "ENV(?:\.fetch\|\[)[('\"]([A-Za-z][A-Za-z0-9_]+)" . --include='*.rb'` |
    | Node.js | `grep -rhoP 'process\.env\.([A-Z][A-Za-z0-9_]+)' src/ --include='*.js' --include='*.ts' --exclude-dir=node_modules` |
    | Python | `grep -rhoP "os\.environ\.get\(['\"]([A-Za-z][A-Za-z0-9_]+)" . --include='*.py'` |
    | Java/Spring | `grep -rhoP '\$\{([A-Z][A-Z0-9_]+)[}:]' src/ --include='*.properties' --include='*.yml'` |
    | Go | `grep -rhoP 'os\.Getenv\("([A-Za-z][A-Za-z0-9_]+)"\)\|viper\.Get.*\("([a-zA-Z][a-zA-Z0-9_.]+)"\)' . --include='*.go'` |
    | PHP | `grep -rhoP "(?:getenv\|env)\(['\"]([A-Za-z][A-Za-z0-9_]+)" . --include='*.php'` |

    Cross-reference grep output against task-spec. If spec says `DB_PASSWORD` but source says `OMRS_DB_PASSWORD`, use source name.

56-67. Generate all resource types per access pattern and scope:
- Namespace, Deployments (include only in-scope services), Services, ConfigMap, Secret, PVCs, CronJobs, Jobs, Ingress, NetworkPolicies, HPAs.
- **HPA rule**: use `apiVersion: autoscaling/v2`. When `minReplicas > 1`, verify PVCs use ReadWriteMany.
- **HPA emptyDir-only rule**: When all volumes are emptyDir, set `minReplicas: 1` with MIGRATION comment listing prerequisites before scaling.
- **PVC RWM storageClassName**: Always include `storageClassName: "replace-with-rwm-class"` placeholder.
- **RFC 1123 placeholder constraint**: ALL host/storageClassName placeholders MUST be lowercase.
- **PVC mount-scope rule**: Mount ENTIRE data root on RWM PVC when app writes runtime config into subdirectories. Exception: 12-factor entrypoints regenerating config → emptyDir at root + PVC inner-mount.
- **ConfigMap data values must be strings**: quote all numerics.
- **File-upload Ingress annotation**: `nginx.ingress.kubernetes.io/proxy-body-size: <limit>`.
- **$(VAR) command expansion**: resolves ONLY from same container's env: list. Use shell form for envFrom-sourced vars.
- **Job/CronJob inline env**: Extract keys from ALL kubernetes/*.yaml including Job/CronJob container spec `env:`.

### Sub-Phase §16: Infrastructure Requirements Document

68-77. Generate INFRASTRUCTURE_REQUIREMENTS.md:
- §0 Target Microservice Architecture (mandatory for ≥2 candidates)
- §1 Database, §2 Redis/Cache, §3 S3, §4 IAM (include CopyObject for moves), §5 Networking, §5b SMTP, §6 Secrets, §7 Monitoring

**Pending-annotation cleanup gate**: After generating previously-missing manifests, grep for `pending`/`not generated` annotations and update.

**Backtick-scope rule**: Only backtick actual env var keys. SQL keywords, IAM placeholders → fenced code or plain text.

### Sub-Phase §17: Dockerfile Update

77-79b. Multi-stage build, non-root user, immutable image. Per-service Dockerfiles for in-scope services needing separate images.

**Entrypoint root-ops audit**: After USER non-root, grep entrypoint scripts for `chown`, `adduser`, `apt-get`, `mkdir /var/run`, `mkdir /run`, `usermod`, `crontab`. Any match → runtime startup blocker, fix in same pass.

### Sub-Phase §17b: Docker Build Verification

See `references/docker-build-validation.md`. Tier 1 — must pass before Tier 2/3.

### Sub-Phase §18: Minikube Validation (Conditional)

84-94. Only if Tier 1 passed. Deploy, monitor, diagnose, validate.

### Sub-Phase §19: Final Review

95-97. Generate TRANSFORMATION_SUMMARY.md with:
- **Required section headings**: `## Executive Summary`, `## Manifest Inventory`, `## Configuration Changes`, `## Security Hardening Summary`, `## NetworkPolicy Summary`, `## Microservice Decomposition Roadmap` (mandatory for monolith_risk high/critical; recommended otherwise).
- Per-file changes, validation results (state which tier was reached).
- §Microservice Decomposition Roadmap: Extraction Status table, Blocking Anti-Patterns Addressed, Remaining Prerequisites, Deferred Resources.

**Configuration Changes key-accuracy gate**: After writing the Configuration Changes table, diff variable names against actual configmap.yaml `data:` keys + secret.yaml `stringData:` keys. Any mismatch is a documentation error — fix before closing.

## Security Context Edge Cases

| # | Workload Pattern | runAsUser | readOnlyRootFilesystem | capabilities |
|---|---|---|---|---|
| 1 | Official DB images (postgres, mysql, mongo) | 0 | false | add CHOWN/DAC_OVERRIDE/FOWNER/SETGID/SETUID |
| 2 | Minimal init containers | 1000 | true | drop ALL |
| 3 | Multi-UID sidecars | per-container | true | omit fsGroup |
| 4 | Init containers using DB images | same as 1 | false | same as 1 |
| 5 | nginx:alpine | 101 | true | drop ALL |
| 6 | Process-manager containers (supervisord) | 0 | false | — |
| 7 | curlimages/curl | 100 | true | drop ALL |
| 8/8b | PHP-FPM/PHP-Apache on Debian | 33 | true | drop ALL |

**Multi-UID workloads rule**: When a Job/CronJob or Deployment has containers with DIFFERENT UIDs (e.g., init container UID 0 + main container UID 1000, or PHP-FPM UID 33 + nginx UID 101), do NOT set `runAsUser` at pod level — set per-container in each container's `securityContext`. Keep `runAsNonRoot: true` and `fsGroup` at pod level.

**UID mismatch anti-pattern**: `useradd -r` / `adduser --system` allocates dynamic UID. ALWAYS specify explicit UID: `useradd -r -g appgroup --uid 1000 appuser`.

**Container-level securityContext must include ALL six fields**: `runAsNonRoot`, `runAsUser`, `runAsGroup`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation`, `capabilities` — even when pod-level sets some of them.

**Pod-level fsGroup**: When `runAsUser` is non-zero AND pod mounts ANY volume, add `spec.securityContext.fsGroup` matching `runAsUser`.

## Probe Rules by Workload Type

| Workload | Probes Required |
|----------|----------------|
| Deployment main containers | All three (startup, readiness, liveness) |
| Headless workers (no Service) | Exec probes only |
| Init containers | No probes |
| Job/CronJob WITH HTTP endpoint | startupProbe + livenessProbe (omit readiness) |
| Job/CronJob WITHOUT HTTP endpoint | exec livenessProbe only (`kill -0 1`) |
| Distroless containers | Omit ALL probes — use `activeDeadlineSeconds` (≤80% schedule interval) |

**CronJob placement**: `activeDeadlineSeconds` in `jobTemplate.spec.activeDeadlineSeconds`, NOT spec root.

**startupProbe first-boot sizing**: failureThreshold: 30, periodSeconds: 10 (300s budget).

**Probe path authentication**: Verify probe path returns HTTP 2xx WITHOUT auth.

### ⚠ CronJob/Job Probe + NetworkPolicy Completeness Mandate

Before closing any manifest-generation task, enumerate ALL pod-creating resources:

```bash
grep -rl 'kind: Deployment\|kind: Job\|kind: CronJob' kubernetes/ | sort
```

For EACH resource found, assert:
1. **Liveness probe exists** — Deployment: httpGet or exec; Job/CronJob without HTTP: `exec ["sh", "-c", "kill -0 1"]` with initialDelaySeconds:10, periodSeconds:30.
2. **NetworkPolicy exists** — a NetworkPolicy whose podSelector matches the resource's pod labels. One-shot Jobs and CronJobs are the most commonly omitted — verify them explicitly.
3. **Distroless exception**: omit probes, use `activeDeadlineSeconds` at `jobTemplate.spec.activeDeadlineSeconds`.

**Verification (post-manifest):**
```bash
# Count pod-creating resources vs NetworkPolicies
WORKLOADS=$(grep -rl 'kind: Deployment\|kind: Job\|kind: CronJob' kubernetes/ | wc -l)
NETPOLS=$(grep -c 'kind: NetworkPolicy' kubernetes/*.yaml 2>/dev/null || echo 0)
echo "Workloads: $WORKLOADS, NetworkPolicies: $NETPOLS"
# NETPOLS must be >= WORKLOADS (each workload needs its own policy)
```

## NetworkPolicy Egress Trigger-Table

| Env Var / Pattern | Egress Ports |
|---|---|
| MAIL_HOST / SMTP_HOST env var present | TCP 25, 465, 587 |
| No SMTP env var BUT code-grep finds mail-sending patterns (smtp, mail(), SwiftMailer, PHPMailer, ActionMailer, nodemailer, etc.) | TCP 25, 465, 587 |
| Rails ActionMailer (no env var, part of Rails core): check `config/environments/production.rb` for `action_mailer.delivery_method` AND `app/mailers/` for .rb files | TCP 25, 465, 587 |
| CMS/eCommerce DB-stored SMTP config (no env var): add SMTP egress when admin UI configures mail relay | TCP 25, 465, 587 |
| DB_HOST (PostgreSQL) | TCP 5432 |
| DB_HOST (MySQL) | TCP 3306 |
| REDIS_HOST | TCP 6379 |
| S3_ENDPOINT / external APIs | ports-only, NO `to:` field |
| Startup-eager connections | egress even without env var prefix |
| Pre-configured optional backends (S3 keys present but disabled, Redis starter in pom.xml) | Include egress port with comment `# conditional — backend pre-configured` |
| Spring auto-configuration triggers: `spring-session-data-redis` or `spring-boot-starter-data-redis` in pom.xml | TCP 6379 (auto-config connects at startup, no explicit import to grep) |

**Rules**: External service egress uses ports-only — NO `to:` field. NEVER use `to: []`. Egress nesting: `namespaceSelector`/`podSelector` go INSIDE `to:` entries. ALL workloads MUST declare `policyTypes: [Ingress, Egress]`. Non-web workloads (workers, CronJobs, Jobs with no inbound traffic) use `ingress: []` (deny-all). Web workloads use explicit port-based ingress rules (e.g., allow from ingress controller on port 8080). CronJob podSelector must match `spec.jobTemplate.spec.template.metadata.labels`.

**Egress NetworkPolicy port rule**: Use the POD port (containerPort), not the Service port. CNI policy enforcement operates post-DNAT, so the packet's destination port is the pod's listening port, not the Service's published port.

## CronJob Manifest Reference

Consolidates all CronJob edge cases that cause silent failures or kubeconform rejections.

### activeDeadlineSeconds Placement

`activeDeadlineSeconds` belongs at `spec.jobTemplate.spec.activeDeadlineSeconds`, NOT at the CronJob spec root. Root-level placement is silently ignored by Kubernetes but rejected by `kubeconform -strict`.

```yaml
# CORRECT:
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      activeDeadlineSeconds: 3600  # ← HERE
      template:
        spec:
          containers: [...]

# WRONG (silently ignored):
spec:
  schedule: "0 */6 * * *"
  activeDeadlineSeconds: 3600  # ← WRONG LEVEL
  jobTemplate: ...
```

### Per-CronJob Task-Selector Env Vars

Env vars that select WHICH task a CronJob runs (e.g., `TASK=send-reminders`) MUST be in the manifest's `env:` stanza, NOT in the shared ConfigMap. Different CronJobs need different selector values — ConfigMap is shared across all workloads.

```yaml
# CORRECT — inline env for task selection:
containers:
- name: cron-worker
  env:
  - name: TASK
    value: "send-reminders"
  envFrom:
  - configMapRef:
      name: app-config  # shared config
```

### CronJob podSelector for NetworkPolicy

CronJob NetworkPolicy `podSelector` must match labels at `spec.jobTemplate.spec.template.metadata.labels` — NOT top-level CronJob `metadata.labels`. The NetworkPolicy targets the Pod, not the CronJob resource.

### Two-Label Selector Precision Guard

When CronJob and Deployment share the primary app label (e.g., `app: myapp`), add a discriminator label to prevent NetworkPolicy collision:
- Deployment pod template: `app.kubernetes.io/component: web`
- CronJob pod template: `app.kubernetes.io/component: cron`
- Service and web-ingress NetworkPolicy selectors: include `app.kubernetes.io/component: web`

Without the discriminator, a NetworkPolicy allowing ingress on port 8080 for the web Deployment also inadvertently applies to CronJob pods that share the `app: myapp` label.

### Egress NetworkPolicy Port Selection

Use the pod port (containerPort) in egress NetworkPolicy rules, not the Service port. CNI enforcement operates post-DNAT — the destination port in the packet is the pod's listening port.

### kubeconform Assertion Limitation

`kubeconform -strict` validates schema structure but does NOT catch:
- `activeDeadlineSeconds` at wrong nesting level (silently ignored)
- Secret keys with dots used via `envFrom` (silently skipped)

Post-kubeconform, run placement assertions — see `references/docker-build-validation.md` §Post-kubeconform Placement Assertions.

## emptyDir Mount Scope Rules

### Rule A: emptyDir at path containing image-baked content

When a path needs emptyDir for writability AND contains image-baked content (e.g., `/app/public` has static assets baked into the image), mounting emptyDir at that path HIDES all image content. Use an init container to copy content first:

```yaml
initContainers:
- name: copy-content
  image: same-app-image:tag
  command: ['sh', '-c', 'cp -r /app/public/* /mnt/public/']
  volumeMounts:
  - name: public-writable
    mountPath: /mnt/public
containers:
- name: app
  volumeMounts:
  - name: public-writable
    mountPath: /app/public
volumes:
- name: public-writable
  emptyDir: {}
```

**Source:** Kubernetes volumeMount at a path shadows all image-baked content — https://stackoverflow.com/questions/58128591/kubernetes-mount-volume-on-existing-directory-with-files-inside-the-container

### Rule B: Parent vs child directory writability

When mounting subdirectories for writability (e.g., `/app/storage/logs`, `/app/storage/cache`), verify the parent directory (`/app/storage/`) doesn't ALSO need writes. If the parent needs writes (e.g., framework creates directories dynamically), prefer a SINGLE parent-level emptyDir over multiple child mounts.

**Decision tree:**
1. Only specific subdirectories need writes → mount each child path individually
2. Parent directory itself needs writes OR framework creates new subdirectories → mount at parent level + init container for image-baked content

### Rule C: Recreate strategy for destructive startup with RWO PVC

When a workload mounts an RWO (ReadWriteOnce) PVC AND the startup process is destructive (deletes/recreates content), use `strategy.type: Recreate` instead of RollingUpdate. RollingUpdate with RWO PVC causes the new pod to hang waiting for the PVC to be released by the old pod.

```yaml
spec:
  strategy:
    type: Recreate  # Required for destructive startup + RWO PVC
```

## File State Verification Protocol

### Rule 1: After failed str_replace

After a failed `str_replace` (old_str not found), run:
```bash
grep -n '<expected_new_content>' <file>
```
If found, a prior task already applied the change. This is an idempotent signal, not a defect — no action needed.

### Rule 2: Verify live state before trusting context

Before using any prior task's claimed file state, verify with:
```bash
grep -n '<expected_pattern>' <file>
```
Task context summaries describe intent, not guaranteed disk state.

### Rule 3: ENV_VARIABLES.md row claims

Before asserting a row exists based on prior context:
```bash
grep -c 'KEY_NAME' ENV_VARIABLES.md
```

## HPA MIGRATION Comment Precision

Before writing a MIGRATION comment listing outstanding prerequisites for scaling:
1. Read actual driver/adapter values from ConfigMap and source files
2. Only list a prerequisite as outstanding if genuinely ABSENT from the current state
3. For WebSocket apps, distinguish session store (connect-redis) from adapter (@socket.io/redis-adapter or cable.yml adapter) — missing adapter forces `minReplicas: 1`

## Validation / Exit Criteria

1. User prompted for all preferences. Original codebase unmodified.
2. Source copied to transformation directory.
3. Every blocker addressed.
4. All hardcoded config replaced with env var reads.
5. Sessions distributed. Caching appropriate.
6. Logging → stdout/stderr.
7. Persistent storage → S3.
8. All credentials removed from source.
9. Scheduled tasks extracted to CronJobs.
10. Dockerfile builds (Tier 1). Non-root user.
11. Complete kubernetes/ directory with in-scope resources.
12. Deployments include resources, probes, security context, env refs, volumes.
13. ENV_VARIABLES.md exists.
14. INFRASTRUCTURE_REQUIREMENTS.md with §0 Target Microservice Architecture.
15. TRANSFORMATION_SUMMARY.md with §Microservice Decomposition Roadmap.
16. All manifests valid YAML (Tier 2 passes).
17. Startup resilience implemented.
18. Decomposition Assessment executed per `decomposition_scope`.
19-22. Minikube criteria (if opted in AND Tier 1 passed).

## Library-Specific Traps

### Go
- **pgxpool lazy connection**: Wrap `pool.Ping(ctx)` in retry-with-backoff.
- **viper AutomaticEnv()**: must call AND `SetEnvKeyReplacer` for nested keys.

### Node.js
- **connect-redis**: v7: `require('connect-redis').default`; v9+: `const { RedisStore } = require('connect-redis')`.
- **ioredis middleware**: `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`.

### Python / Celery
- **config_from_object ordering**: explicit overrides after win silently.
- **Celery Beat DB egress**: needs NetworkPolicy to database, not just broker.

### Java / Spring
- **env.getProperty() null**: returns null silently on missing key.
- **Tomcat provided scope**: excludes from fat JAR — silent startup failure.

### PHP
- **filter_var boolean**: string 'false' is truthy. Use FILTER_VALIDATE_BOOLEAN.
- **env() literal default**: makes IRSA guard always truthy. Default must be `''`.

### Ruby
- **ENV.fetch bare calls**: Causes KeyError during asset precompile. Audit before docker build.
