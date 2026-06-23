---
name: kubernetes-readiness-migration
description: >-
  Two-phase Kubernetes containerisation workflow: analyses a codebase against all
  12-factor app principles and Kubernetes compatibility requirements to produce a
  readiness report with detailed microservice decomposition plan (minimal and full
  recommendations), then systematically resolves all findings by externalising
  configuration, migrating persistent storage to object store (S3/GCS/Azure Blob),
  externalising sessions for horizontal scaling, redirecting logging to stdout/stderr,
  executing decomposition assessments, and generating complete Kubernetes YAML manifests.
  Validates via three-tier pipeline: docker build, kubeconform, optional cluster.
  Supports decomposition_scope parameter: minimal (default) or full.
  Triggers: containerisation, Kubernetes, 12-factor, cloud-native, readiness, migration.
---

# Kubernetes Readiness Analysis and Migration

A comprehensive two-phase transformation that first assesses any codebase for containerisation and Kubernetes readiness (including detailed microservice decomposition planning with both minimal and full recommendations), then transforms it for full Kubernetes deployment — executing decomposition where feasible.

## Entry Criteria

1. The codebase is available for static analysis and contains application source code in one or more programming languages.
2. The application is currently running in a non-containerised environment (bare metal, VMs, or traditional deployment) or is being assessed before an initial containerisation effort.
3. Build and dependency configuration files are present (e.g., build manifests, package lock files, or equivalent for any language/framework).
4. Windows-only runtimes (.NET Framework, IIS, COM+) → Phase 1 Blocker requiring Linux-compatible migration as a prerequisite before containerisation.
5. **Decomposition scope**: `minimal` (default) or `full`. Controls whether Phase 2 generates manifests only for the primary Deployment and required support resources (minimal) or for all viable Low/Medium complexity candidates from the Named Service Inventory (full). When absent or unset, apply `minimal`.
6. **Primary Deployment** = the service handling the majority of inbound HTTP traffic, or the service named in the project root package manifest (package.json/pom.xml/go.mod main module).

## Examples

**Example 1 — PHP/Laravel monolith (interpreted, minimal scope):**
- Input: Single-repo Laravel app with Blade templates, Redis sessions, MySQL DB, file uploads to local disk.
- Key signals: `composer.json`, `env()` calls in `config/`, `FILESYSTEM_DISK=local`.
- Output: Readiness report (21-area scorecard) + 7 manifests (Namespace, Deployment, Service, ConfigMap, Secret, NetworkPolicy, ServiceAccount) + ENV_VARIABLES.md + INFRASTRUCTURE_REQUIREMENTS.md + TRANSFORMATION_SUMMARY.md.

**Example 2 — Java/Spring Boot with Maven (compiled language, pre-build gate):**
- Input: Multi-module Maven project, Spring Boot 3.x, Liquibase migrations, Quartz scheduler.
- Key signals: `pom.xml`, `@Value("${...}")`, `System.getenv()`, `spring-boot-starter-quartz`.
- Output: Same as above + migration Job manifest + `mvn package -DskipTests` passes before `docker build`.

**Example 3 — Python/Django (interpreted, standard 12-factor):**
- Input: Django REST API with Celery workers, S3 file storage, PostgreSQL.
- Key signals: `requirements.txt`, `os.environ.get()`, `CELERY_BROKER_URL`, `DEFAULT_FILE_STORAGE`.
- Output: Same as above + worker Deployment manifest + CronJob for Celery Beat.

## Limitations

- **Compiled languages require matching host toolchain**: Java, Go, C#, Rust projects require the correct SDK version installed on the host for the pre-Docker compilation gate. Version mismatches produce CONDITIONAL PASS, not PASS.
- **Interpreted languages with version constraints**: Ruby (Bundler), Python (pyproject.toml `python_requires`) — host interpreter version mismatch causes dependency install failures → CONDITIONAL PASS.
- **Tier 3 KWOK validates API acceptance only**: KWOK cluster validation confirms Kubernetes API schema and resource relationships — it does NOT execute containers or verify runtime behaviour.
- **Docker-absent environments produce static-checklist results only**: Without Docker, Tier 1 falls back to a 5-point static verification checklist. Image correctness is unverifiable.
- **Windows-only runtimes require Linux migration prerequisite**: .NET Framework, IIS, COM+ are Phase 1 Blockers — containerisation cannot proceed without a Linux-compatible rewrite.
- **Integration tests requiring live infrastructure are excluded**: Criterion 13 covers unit tests only. Tests needing running databases, message brokers, or external APIs are out of scope.
- **DB-stored configuration cannot be externalised to ConfigMap**: Settings managed via admin UI (e.g., OpenMRS GlobalProperty, WordPress wp_options) remain database-stored. Document as post-install admin configuration.
- **Plugin-registry architectures may require single-replica Recreate strategy**: OSGi, JNLP plugin registries with local plugin state may not support RollingUpdate without shared storage.
- **Version mismatches that cannot be resolved by toolchain installation produce CONDITIONAL PASS**: Before recording CONDITIONAL PASS for a version mismatch, attempt `mise install` for the required toolchain (see language reference §Toolchain Bootstrap). Only record CONDITIONAL PASS if mise is absent or installation fails.
- **Interpreted languages require host-side validation gate**: PHP, Python, Ruby, Node.js projects MUST pass language-native syntax/dependency validation on the host BEFORE `docker build`. See each language reference §Pre-Docker Local Validation and `references/docker-build-validation.md` §Step 0b.
- **Multi-stage Dockerfiles complement but do NOT replace the host-side validation gate**: Host-side compilation/validation is ALWAYS attempted first for fast feedback. Docker build further validates the Dockerfile itself. The sequence is always: (1) host-side compile/check → (2) docker build. The host-side gate is only recorded as CONDITIONAL PASS (not skipped) when the toolchain is unavailable and mise installation fails.

## §0 Initial Entry Interview

**Before any analysis or file reads**, gather user preferences in two blocks. Record all answers before proceeding.

### Block A — Always Asked

1. **Phase selection**: "Run Phase 1 (analysis report) only, or Phase 1 + Phase 2 (analysis + transformation)?"
2. **Report output path**: "Where should the readiness report be written?" (default: current directory)
3. **Report format**: "Markdown or HTML?" (default: Markdown)
4. **Report detail level**: "Full 21-area scorecard, or executive summary only?" (default: full)

### Block B — Asked Only If Phase 2 Selected

5. **Decomposition scope**: "Minimal (primary Deployment only) or full (all viable services)?" (default: minimal)
6. **Validation tooling**: Auto-detect availability of Docker, Minikube, kind, k3s, and kwokctl. Check each tool independently (do NOT chain checks — individual tool absences must remain individually visible). Then confirm: "Detected: [tools]. Use these for validation? Any additional preferences?" (default: use whatever is detected; attempt KWOK download if nothing found)

### Non-Interactive / CI Defaults

When no interactive prompt is possible, apply: Phase 1+2, Markdown, full detail, minimal scope, KWOK attempted if available (Docker used if present). Log all defaults applied.

## Implementation Steps

### Phase 1 - Containerisation Readiness Analysis

**§0 Initial Entry Interview MUST complete before Phase 1 steps begin.**

Perform a comprehensive static analysis of the codebase to identify containerisation blockers, risks, and remediation steps. Follow `references/skill-a-readiness-analysis.md`.

This phase covers:

1. Analysis of all 12 factors of the 12-factor app methodology
2. Kubernetes-specific compatibility checks
3. Horizontal scaling and singleton pattern challenges
4. Local filesystem usage assessment and replacement recommendations
5. Credentials, API keys, and secrets management audit
6. Monolith decomposition assessment with Named Service Inventory, Data Ownership Matrix, and Decomposition Complexity ratings — see `references/microservice-decomposition-patterns.md`
7. Database connection and data integrity analysis
8. Memory growth and leak pattern detection
9. Startup order dependency mapping
10. User session externalisation assessment
11. Local caching strategy recommendations
12. In-memory state sharing between microservice candidates

Output: A single consolidated readiness report (HTML or markdown) with visual readiness scorecard (21 areas), executive summary table, per-section structured finding tables, colour-coded severity badges, Named Service Inventory table with complexity ratings, **both Minimal and Full Decomposition Recommendations**, and singleton risk summary table.

**Zero decomposition candidates rule**: When the Named Service Inventory contains only the primary service (or is empty), the Microservice Decomposition Roadmap section MUST state "No additional decomposition candidates identified" rather than being omitted.

Refer to `references/skill-a-readiness-analysis.md` for the full implementation steps, validation criteria, and formatting rules.

### Phase 2 - Kubernetes Containerisation Transformation

Consume the Phase 1 readiness report and systematically resolve every finding. Follow `references/skill-b-containerisation-transformation.md`.

**Pre-flight codebase existence check (FIRST action):** Before any file_read or shell command referencing the codebase path, verify the path exists and contains files. If check fails: write ERROR_REPORT.md and exit 1.

**Execution Scope:** Determined by `decomposition_scope` (Entry Criteria §5 / §0 Block B):
- **`minimal` (default):** Primary Deployment + required supporting resources only. See `references/minimal-execution-set.md`.
- **`full`:** Generate manifests for all Low and Medium complexity candidates from the Named Service Inventory, in addition to the primary Deployment and required support resources.

If the Phase 1 readiness report is unavailable, Phase 2 workers derive blocker context directly from source files using analysis patterns in `references/skill-a-readiness-analysis.md`.

This phase covers 20 sub-phases:

> **Execution Philosophy**: All procedural steps in this specification describe **OUTCOMES** to achieve. The specific tools, commands, and exact syntax used to achieve each outcome are the worker's choice based on the available environment. No command string in this specification or its reference files is mandatory — only the described outcome is mandatory. **Exception**: Validation commands (kubeconform flags, structural assertion patterns, stale-claim grep patterns) define outcomes themselves — their flags and patterns are normative, not merely illustrative.

1. **Initial Setup** — Parse report, copy codebase, gather user preferences (if not already gathered via §0). **Backup file rule**: After every file modification, immediately remove any backup files (`.bak`, `.orig`, `~`) created by the editing tool. Prefer `file_write` (full-file overwrite) over `str_replace` for documentation files to avoid creating backups. This applies to all editing operations throughout all tasks without exception. **Non-interactive defaults**: if preferences cannot be gathered interactively in CI mode, apply Minimal Execution Set defaults and skip Tier 3 cluster validation. See `references/minimal-execution-set.md`. See §Tier 3 Validation Decision Gate below for tooling resolution.
2. **Decomposition Assessment** — Ingest Phase 1 Named Service Inventory. When `decomposition_scope=minimal` (default): execution scope = primary Deployment + required Jobs/workers only; full catalog goes to report/roadmap. When `decomposition_scope=full`: generate manifests for all Low/Medium complexity candidates; High candidates still documented only. See `references/microservice-decomposition-patterns.md` Phase 2 Execution Rules. ⚠ Guard: Verify Named Service Inventory is current — if source structure has diverged from Phase 1, re-derive service boundaries from package manifests before proceeding. ⚠ Guard: P0/P1 structural blockers identified during Phase 1 (e.g., pom.xml `scope=provided` on embedded server, missing dependencies) MUST appear as explicit dedicated Phase 2 tasks — do NOT rely on them being handled incidentally by other tasks.
3. **Configuration Externalisation** — **Mandatory first action: source-authoritative env var discovery (5-pass algorithm).** Before writing ENV_VARIABLES.md, complete ALL five passes from repo root (never scoped to a single module):

   **Pass 1 — Full-tree literal-string discovery** (from repo root, pattern `[A-Za-z][A-Za-z0-9_]+`):
   Use language-specific env-read patterns from the Reference Dispatch table. Scan the ENTIRE repo tree, not a single module. For multi-module projects, scan from root — never a single module subdirectory.

   **Pass 2 — Data-structure literal scan**: Scan for uppercase identifiers stored in config maps/dictionaries/collections (e.g., Python dicts, JS objects, Java Maps with string keys matching `[A-Z][A-Z0-9_]+`). **Disambiguation rule**: identifiers appearing in subprocess child-env dict assignments (e.g., `subprocess.Popen(env={...})`) or SDK wire-protocol Map.put() constants (e.g., Kafka `ProducerConfig.put("key.serializer", ...)`) are output/injected — NOT application input. Exclude from ENV_VARIABLES.md. **Additional exclusion categories**: (a) Property-file LHS keys: identifiers on the left side of `key=value` in `.properties` files are property bindings, not env var reads — exclude unless the value side contains `${VAR}` placeholder syntax. (b) WSGI CGI meta-variables: for Python WSGI apps, exclude RFC 3875 §4.1 CGI meta-variable names (`PATH_INFO`, `SERVER_NAME`, `SERVER_PORT`, `REQUEST_METHOD`, `CONTENT_TYPE`, `REMOTE_USER`, `REMOTE_ADDR`, `HTTP_*`, `AUTH_TYPE`, `SCRIPT_NAME`) — these are per-request environ dict keys, not OS env vars. See `references/python-patterns.md` §WSGI Environ False-Positive Exclusion.

   **Pass 3 — Direct OS env reads** (MANDATORY): `System.getenv` (Java), `GetEnvironmentVariable` (C#), `os.environ`/`os.getenv`/`os.environ.setdefault` (Python), `process.env` (Node.js), `os.Getenv` (Go), `ENV[]`/`ENV.fetch` (Ruby), `getenv()`/`env()` (PHP). **Per-language conditional triggers**: When `Azure.Identity` is in .NET dependencies, also scan for `GetEnvironmentVariable` calls targeting AZURE_* vars. When Python uses `os.environ.setdefault()`, capture both key and value as env var reads.

   **Pass 4 — Entrypoint bash parameter-expansion**: Identify all environment variable names referenced via shell default-value syntax (`${VAR:-default}`) in entrypoint and startup scripts (entrypoint*.sh, docker-entrypoint*.sh, start.sh, run.sh, and equivalents). Also scan for `VAR=${VAR:-default}` assignment forms — these are operator-overridable even when they have computed defaults, and must be included in ENV_VARIABLES.md. **`:?` safety-guard exclusion**: Inspect each `${VAR:?msg}` result in script context — if the variable was assigned earlier in the same script, it is locally-constructed and must be excluded (applies to `${VAR:?msg}` safety-guard forms on local variables).

   **Pass 5 — Indirect helper call-site patterns** (Node.js/PHP/Go/TS): PRIMARY implementation — Python one-liner (avoids shell quoting fragility). MUST iterate over ALL four target extensions:
   ```bash
   python3 -c "import re,pathlib;[print(m) for ext in ('*.js','*.ts','*.php','*.go') for f in pathlib.Path('.').rglob(ext) if 'node_modules' not in str(f) and 'vendor' not in str(f) for m in re.findall(r\"(?:requireEnv|getEnv|mustGetEnv|config)\(['\\\"]([A-Z][A-Z0-9_]+)\", f.read_text(errors='ignore'))]"
   ```
   FALLBACK — grep (when Python unavailable): Identify all call sites of env-var wrapper helpers (`requireEnv`, `getEnv`, `mustGetEnv`, `config`, and project-specific equivalents) that accept uppercase string keys. These wrappers are common in Node.js (custom `requireEnv` validators), PHP (Laravel `config()` which chains to `env()`), and Go (custom config helpers). Extract all uppercase string arguments passed to these call sites across the source tree (excluding vendor/dependency directories).

   **Phase 2-entrypoint clause**: When any task creates or modifies a shell entrypoint script, immediately re-run Pass 4 against it and update ENV_VARIABLES.md with any new variables before closing.

   **ConfigMap/Secret moves clause**: Any task that relocates a variable between ConfigMap and Secret (or vice versa) MUST update the K8s Scope column in ENV_VARIABLES.md in the same task.

   **Comment-line exclusion** is mandatory on all passes: exclude lines beginning with language-appropriate comment markers (`//` for Java/C#/JS/Go; `#` for Python/Ruby/shell/properties files).

   **Dependency directory exclusion** is mandatory on all passes. Add `--exclude-dir` flags for third-party code:

   | Language | Excluded Directories |
   |----------|---------------------|
   | PHP | `vendor` + non-standard vendor-dir from `composer.json` (run `grep -oP '"vendor-dir"\s*:\s*"\K[^"]+' composer.json` before grep passes) |
   | Node.js | `node_modules` |
   | Python | `.venv`, `site-packages`, `tests`, `test` |
   | Ruby | `vendor/bundle` |
   | Go | `vendor` |
   | Java | `target`, `.m2` |

   Any env var whose ONLY source is inside a dependency directory is third-party-internal and MUST be excluded from ENV_VARIABLES.md.

   **Zero-result fallback**: When all five passes return zero results, treat manifest env stanza as authoritative and document accordingly.

   Source code reads are AUTHORITATIVE — deduplicate discovery results as the baseline row count. Replace hardcoded config with env var reads, generate ENV_VARIABLES.md. **Per-document stale-claim gate**: after generating or modifying any `.md` document, verify it contains no future-tense language (`will`, `shall`, `would`) before closing the task.

   ⚠ **Per-task ENV_VARIABLES.md update mandate**: Every task that introduces ANY new env var read (getenv/ENV.fetch/@Value/os.environ/process.env) in source code MUST add the corresponding ENV_VARIABLES.md row before closing. This is mandatory (with one exception noted below) — narrow task scope descriptions do NOT override this requirement. **Documentation-only task exemption**: Tasks that modify only `.md` files and introduce no new source code env var reads are exempt from the ENV_VARIABLES.md update mandate only — all other Closure Gate requirements still apply. Verify by running 5-pass grep confirming zero new keys. **Deferred-row escalation**: When a task's file list omits ENV_VARIABLES.md but introduces new env var reads, document deferred rows in the task report under a "Deferred ENV_VARIABLES.md Rows" heading. **Operational enforcement**: When a task report contains a Deferred ENV_VARIABLES.md Rows heading, the orchestrator MUST (a) add ENV_VARIABLES.md to the file scope of the nearest subsequent task AND (b) explicitly reference the deferred key names in that task description. This converts a passive planning note into an active assignment. **Atomic count-literal update**: When adding rows to ENV_VARIABLES.md, update both the new row AND the header count in the same editing operation — never leave count and row count out of sync. The §19 ENV_VARIABLES.md Final Review Completeness Check serves as the catch-all for all deferred rows — re-running all 5 passes to discover any gaps. **High-risk task types for omission**: backing-services (§8), db-optimisation (§14), security-hardening (§13), filesystem-to-object-store (§6), dockerfile-creation/entrypoint (§17), and logging-transformation (§5) tasks commonly introduce env vars without updating ENV_VARIABLES.md — apply extra vigilance.

   Source grep is necessary but NOT sufficient — operationally-injected keys (e.g., Redis password, database admin credentials) not read by application code will not appear in any pass. After manifest generation (§15), run §15b Operationally-Injected Key Sweep: diff kubernetes/*.yaml env keys against ENV_VARIABLES.md; keys present in manifests but absent from docs are a documentation gap regardless of source grep results.

4. **Session and Cache Externalisation** — Verify session mechanism first; DB-backed sessions do NOT need Redis.
5. **Logging Transformation** — Replace file-based logging with stdout/stderr. **Pre-action step**: Before modifying any log config, enumerate all modules containing file-based logging configuration (rolling files, file appenders, file sinks) across the full repo tree. Apply the stdout/stderr transformation to every discovered file, not just the primary module. After changing default log output to stderr, immediately run the unit test suite to detect regressions from test harnesses that capture stderr.
6. **Filesystem to Object Store Migration** — Refactor persistent storage to cloud object store or shared volume via SDK. ⚠ **SDK env var mandate**: S3/GCS/Azure SDK integration typically introduces 3-6 new env var reads (bucket, region, endpoint, key, secret, prefix). Any task introducing SDK integrations (S3, GCS, Azure Blob, Redis, SMTP, Elasticsearch, OpenSearch) MUST include a **New Env Vars Introduced** heading in the task report listing all new environment variable keys, even if the ENV_VARIABLES.md update is deferred to a later task.
7. **Credentials and Secrets** — Remove hardcoded credentials, configure IRSA. See `references/credential-audit-patterns.md`. Credential-only field scope: apply null/empty defaults ONLY to credential fields (key, secret, token); non-credential config fields (region, endpoint, bucket) retain sensible defaults. **Cloud IAM co-requisite**: For AWS IRSA and GCP Workload Identity ServiceAccounts, always set `automountServiceAccountToken: true` explicitly on the ServiceAccount — cluster policies may disable automounting by default. See `references/credential-audit-patterns.md` §IRSA Configuration for the full automountServiceAccountToken reconciliation rule (true on ServiceAccount, false on pod spec). **Source-authoritative grep reminder**: Before generating Secret/ConfigMap or manifest env blocks, re-run source-authoritative env var grep to confirm every key name matches source code reads. Context summaries are planning-level approximations and NOT authoritative for exact key names. ⚠ Guard: After Forms A–F, run Form G (Final Literal Sweep) on ALL docker-compose files AND Cross-Profile Property Consistency Check — see `references/credential-audit-patterns.md` §Form G, §Cross-Profile. **Form G fix-immediately mandate** — Form G and Cross-Profile sweep fixes MUST be applied immediately in the same task regardless of the original task file list. All source/config profile files (e.g., `src/main/resources/` and framework equivalents) are always in-scope for credential remediation. **Out-of-Scope Findings delegation applies to ALL credential findings regardless of file type.** When a task records Out-of-Scope Findings (docker-compose overlays, source files, config profiles, or any other file containing credential patterns), the orchestrator MUST include those specific file:line violations in the file scope of the next eligible downstream task — either by creating a dedicated follow-up task or appending to the nearest downstream task files list.
8. **Backing Services** — Replace hardcoded addresses with env var reads.
9. **Scheduled Tasks and Background Jobs** — Extract to CronJob manifests. See `references/skill-b-containerisation-transformation.md` §Sub-Phase §9 for framework exception rules, §Scheduled-Task Extraction Checklist, and §CronJob Manifest Reference for field placement rules. ⚠ Guard: Mode-toggle env vars that trigger exit/shutdown (e.g., CRON_MODE with System.exit()/process.exit()) MUST be CronJob-inline env only, never in shared ConfigMap — misplacement causes all web pods to CrashLoopBackOff. ⚠ Pre-condition: Before writing CronJob manifest, verify `kubernetes/namespace.yaml` exists on disk — if not, create it first.
10. **Concurrency and Scaling** — Replace in-memory patterns with distributed alternatives.
11. **Build/Release/Run** — Move build activities to image build time. **For compiled languages (Java, Go, C#, Rust, TypeScript), the native build tool MUST be invoked and exit 0 on the host BEFORE `docker build` is attempted.** The compiled artifact (JAR, binary, DLL, JS bundle) must exist at the expected Dockerfile COPY path. **For interpreted languages (PHP, Python, Ruby, Node.js), the language-native syntax/validation check MUST be run on the host BEFORE `docker build`** — this catches syntax errors, import failures, and dependency resolution problems early (see `references/docker-build-validation.md` §Step 0b). The sequence is always: (1) host-side compile/validate → (2) docker build. If the required toolchain is unavailable and `mise install` fails, record CONDITIONAL PASS — do NOT silently skip. Compiling at container runtime is prohibited — all compilation must occur at image build time (multi-stage Dockerfile) or on the host before the build.
12. **Disposability and Startup Resilience** — Add retry logic, circuit breakers, health checks. Set `terminationGracePeriodSeconds` to exceed the application graceful shutdown window (see stack-specific reference for formula). **Health probe ordering rule**: Health/readiness probe endpoints MUST be registered BEFORE any global auth middleware.
13. **Security Hardening** — Non-root execution, read-only root filesystem. ⚠ Guard: emptyDir Mount Scope — when mounting at a path containing image-baked content, use init container to copy content first — see `references/skill-b-containerisation-transformation.md` §emptyDir Mount Scope Rules. ⚠ Guard: Confirm pod-level `securityContext.fsGroup` equals `runAsUser` for every Deployment with emptyDir volumes. Omission causes silent PermissionError on first runtime write. ⚠ Forward-reference: when writing supervisord.conf, set `user=www-data` (not root) to align with §13 `runAsNonRoot`. ⚠ Guard: When `readOnlyRootFilesystem: true`, scan entrypoint scripts for writes to OS paths beyond the application directory (`grep -nE 'mkdir|touch|cat >|tee|>>' entrypoint*.sh`) — each write target needs an emptyDir mount or init-container copy.
14. **Database Connection Optimisation** — Connection pooling, locking patterns.
15. **Kubernetes Manifest Generation** — Generate manifests for the execution scope. **Source-authoritative grep reminder**: Before finalising ConfigMap/Secret keys, re-run source-authoritative env var grep (all 5 passes) to confirm every key name matches source code reads. Source code env var reads AND entrypoint shell script `${VAR}` references are authoritative for ConfigMap/Secret keys. **Resolution hierarchy**: source code env reads → manifest yaml → ENV_VARIABLES.md. Source code is authoritative for key names; manifests are authoritative for key placement (ConfigMap vs Secret). **Job/CronJob inline env coverage**: extract env var keys from ALL kubernetes/*.yaml including Job/CronJob container spec `env:` sections. **Post-manifest ENV_VARIABLES.md reconciliation gate**: each manifest-generation task MUST diff its output keys against ENV_VARIABLES.md and add missing rows before closing. See `references/validation-patterns.md` §Post-Manifest ENV_VARIABLES.md Reconciliation.
15b. **Operationally-Injected Key Sweep** — After §15 manifest generation (manifests must exist on disk), identify infrastructure-injected env vars not discoverable by source grep (e.g., Redis password injected by Helm chart, database admin credentials from operator). Diff kubernetes/*.yaml env keys against ENV_VARIABLES.md; keys present in manifests but absent from docs require documentation rows.
16. **Infrastructure Requirements Document** — Database, Redis, S3, IAM, networking, secrets, monitoring. Must include §0 Target Microservice Architecture for projects with ≥2 decomposition candidates. ⚠ Guard: After generating any previously-missing manifest, grep INFRASTRUCTURE_REQUIREMENTS.md for `pending`/`not generated` annotations and update to resolved. **Backtick-scope rule**: Only use inline backticks for identifiers that are actual manifest env var keys. SQL keywords, IAM placeholders → fenced code or plain text. **Disk-state-first mandate**: Before writing Manifest Inventory, run `ls kubernetes/*.yaml` to enumerate disk state. Only list files absent from disk as roadmap items.
17. **Dockerfile Update** — Multi-stage build, non-root user, immutable image. ⚠ Guard: Audit entrypoint scripts for root-privileged operations (`chown`, `adduser`, `apt-get`, `mkdir /var/run`) — any match is a runtime startup blocker, fix in same pass. ⚠ Guard: Verify HEALTHCHECK binary (curl/wget/nc) is present in the base image before use — install as root before USER switch if absent (see each language reference §Dockerfile Pitfalls for base-image tool tables). Set HEALTHCHECK `--start-period=30s` minimum for apps with backing-service dependencies (60s for apps with DB migrations).
17b. **Docker Build Verification** — Tier 1 validation. See `references/docker-build-validation.md`.
18. **Minikube Validation** (conditional) — Only after Tier 1 passes.
19. **Final Review** — Generate TRANSFORMATION_SUMMARY.md with required sections (see Criterion 9). Must include **§Scope Comparison: Minimal vs Full** in the Microservice Decomposition Roadmap. **Re-validation guard**: Before populating the Three-Tier Validation table, compare mtime of every `kubernetes/*.yaml` file against the timestamp of the last validation task. If any manifest is newer, re-run kubeconform and KWOK against current disk state and record fresh results. Before populating the Three-Tier Validation table, read the cluster-validation task report. Do not re-check binary availability in Final Review; record the most favourable validated result from prior task reports. Use `PASSED` (past tense) for ALL individual assertion cells. Audit trail format: `PASSED (N found and removed during cleanup; 0 remaining)`. **Manifest Inventory in TRANSFORMATION_SUMMARY.md MUST be populated from actual disk state (`ls kubernetes/*.yaml`), not from INFRASTRUCTURE_REQUIREMENTS.md annotations.** **Final Review MUST NOT create new manifests or fix Dockerfile gaps — these are defects that belong to earlier tasks. Only ENV_VARIABLES.md row reconciliation, TRANSFORMATION_SUMMARY.md generation, and deferred gap closures (ENV_VARIABLES.md row additions and manifest field corrections — not new manifest file creation — that were explicitly documented in a prior task report under Deferred ENV_VARIABLES.md Rows or Deferred Manifest Fixes headings) are acceptable §19 edits.** A manifest field correction means adding/changing fields within an existing kubernetes/*.yaml file. Adding a new kubernetes/*.yaml file is new manifest file creation and is not permitted in §19. Deferred gap closures must be re-validated with kubeconform and KWOK before closing. **ENV_VARIABLES.md Final Review Completeness Check**: re-run source-authoritative env var grep (all 5 passes) and diff against ENV_VARIABLES.md — add missing rows before closing. **Resource counting mandate**: Use `yaml.safe_load_all()` for counting manifests and keys — never sum from memory.

   **Post-generation validation guards**: (a) Security Hardening status cells must not contain 'Required'/'Recommended' — only 'Applied'/'Configured'. (b) Scope Comparison Actual Outcome column must match `ls kubernetes/*.yaml` disk state. (c) Three-Tier Validation cells must contain 'PASSED' with tool flags — never blank.

   **SELF-REFERENCE GUARD**: Audit trail row labels and Notes cells MUST NOT quote literal banned tokens or search phrases. Use functional abstractions: "Future-tense gate" (not "will/shall/would"), "Banned-phrase check" (not the specific phrase), "Resolved-issue verification" (not "Known-Issues scan"). Run banned-phrase check after EACH individual edit operation on TRANSFORMATION_SUMMARY.md, not only at task close. See `references/validation-patterns.md` §Stale-Claim Sweep for safe label templates.

   **Safe-label substitution table** (use these to avoid triggering the stale-claim sweep):
   | ❌ Triggers sweep | ✓ Safe replacement |
   |---|---|
   | `All 6 required fields` | `All 6 mandatory fields` |
   | `recommended approach` | `supported approach` |
   | `not generated` | `roadmap only` |
   | `Action Required` | `Operator Setup Step` |
   | `Known-issue resolution` | `Prior-findings verification` |
   | `Required` / `Recommended` (in Security status cells) | `Applied` / `Configured` |
   | `must be` (requirement context) | `is a prerequisite for` |
   | `would enable` | `enables once configured` |
   | `should be` | `is expected to be` |
   | `needs to be` | `requires` |
   | `must be configured by` | `operator configures` |

   The security-hardening grep targets status cells only — Notes/Details cells with natural adjective use of these words are false positives. Use the safe labels above to avoid triggering the sweep.

   **Self-referential trap — WRONG vs CORRECT:**
   - ❌ WRONG: Notes cell says `Scanned for 'will' — 0 hits` (re-embeds the banned word)
   - ✓ CORRECT: Notes cell says `Future-tense gate: clean` (functional abstraction)
   - ❌ WRONG: Notes cell says `CONDITIONAL PASS` when tool was simply absent (misclassification)
   - ✓ CORRECT: Notes cell says `PASSED (skipped — tool unavailable)` for absent tools
   - ❌ WRONG: Notes cell says `no Known-Issues entries` (re-embeds banned phrase)
   - ✓ CORRECT: Notes cell says `all prior issue annotations verified closed`
   - ❌ WRONG: Notes cell says `no Required or Recommended found` (re-embeds banned tokens)
   - ✓ CORRECT: Notes cell says `all cells reflect completed-state language`
   - ❌ WRONG: Notes cell says `Scanned for will — 0 hits` (quotes the banned word)
   - ✓ CORRECT: Notes cell says `Future-tense gate: clean`

   **Post-debugger documentation sync**: After applying any code fix via debugger, update affected documentation (ENV_VARIABLES.md, INFRASTRUCTURE_REQUIREMENTS.md, TRANSFORMATION_SUMMARY.md) in the same pass — do not leave stale 'out-of-scope' annotations.

Refer to `references/skill-b-containerisation-transformation.md` for the full implementation steps. The 12-Point Mandatory Closure Gate defined there applies to ALL tasks without exception (including documentation-only tasks).

#### Tier 3 Validation Decision Gate

If validation tooling was not resolved in §0 Block B, determine Tier 3 cluster validation availability during Sub-Phase §1:

1. **Auto-detect**: Check independently for the availability of Minikube, kind, k3s, and kwokctl. Check each separately to avoid masking individual absences.
2. **If detected**: Tier 3 is available — proceed with cluster validation after Tier 1 passes (or immediately for KWOK).
3. **If NOT detected — attempt kwokctl download** (30-second timeout). Check whether kwokctl is already cached locally before attempting a download.
4. **Prompt the user** (30-second timeout; no response = N):
   ```
   Tier 3 cluster validation (Minikube/kind/k3s/KWOK) was not auto-detected.
   Would you like to run Tier 3 cluster validation? [y/N]
   ```
5. **In fully automated (CI) mode**: default to skip, emit visible NOTICE, log decision.
6. **Record the decision** in task report AND TRANSFORMATION_SUMMARY.md.

**Split-task guidance**: When kubeconform/KWOK are absent at manifest-generation time, do NOT retry downloads within that task — close with `PASSED (tool unavailable — skipped)` and create a dedicated validation task. When populating TRANSFORMATION_SUMMARY.md Three-Tier Validation table, always read prior task reports for tool results — tool availability is environment-transient; prior task results are canonical.

## Reference Dispatch

| Signal | Reference |
|--------|-----------|
| Phase 1 work | `references/skill-a-readiness-analysis.md` |
| Phase 2 work | `references/skill-b-containerisation-transformation.md` |
| Docker build validation (§17b) | `references/docker-build-validation.md` |
| Minimal Execution Set scope decisions | `references/minimal-execution-set.md` |
| Decomposition plan with ≥2 service candidates | `references/microservice-decomposition-patterns.md` |
| Validation patterns (YAML, banned-phrase, .bak) | `references/validation-patterns.md` |
| Credential audit (docker-compose, AWS SDK, URLs) | `references/credential-audit-patterns.md` |
| Go project (go.mod) | `references/go-patterns.md` |
| Node.js project (package.json) | `references/nodejs-patterns.md` |
| PHP project (composer.json) | `references/php-patterns.md` |
| Java/Maven/Gradle (pom.xml / build.gradle) | `references/java-jvm-patterns.md` |
| Python project (requirements.txt/pyproject.toml) | `references/python-patterns.md` |
| Ruby/Rails project (Gemfile) | `references/ruby-rails-patterns.md` |
| C#/.NET project (.csproj/.sln) | `references/dotnet-patterns.md` |

**Mixed-language dispatch**: If primary runtime differs from build-time toolchain (e.g., PHP app + Node.js asset build, Java app + Angular frontend), consult BOTH relevant language references.

## Reference Procedures

The procedures below describe mechanical transforms and verification sweeps the worker performs on demand using standard shell commands. There are no executable scripts — the worker reads each procedure and issues the commands directly.

- **Pre-migration procedures** run BEFORE any file-by-file migration work.
- **Post-batch procedures** run AFTER each batch of related changes.
- **Post-migration procedures** run AFTER all code changes are complete.

- **`references/docker-build-validation.md`** — Three-tier validation pipeline: docker build, kubeconform, cluster. Includes Step 0 (Pre-Docker Native Compilation Gate for compiled languages), Tier 3 ask-before-skip protocol, kwokctl binary download, KWOK Operational Checklist, 00-namespace.yaml convention. When to run: post-batch (Tier 1). Patterns: `pom.xml`, `build.gradle`, `go.mod`, `.csproj`, `Cargo.toml`, `package.json` (with build script).
- **`references/minimal-execution-set.md`** — Resource-type classification and scope decisions. When to run: pre-migration planning.
- **`references/microservice-decomposition-patterns.md`** — Decomposition workflow and templates including Scope Comparison table. When to run: pre-migration and post-batch.
- **`references/validation-patterns.md`** — Reusable YAML, banned-phrase, reconciliation, stale-claim procedures, grep tempfile pattern, grep robustness rules, and assertion battery template. When to run: post-batch and post-migration.
- **`references/credential-audit-patterns.md`** — Credential audit Forms A–G, IRSA, Secret classification, credential-only field scope rule, cross-profile consistency check, scan-vs-modify scope boundary, external-service username rule, nounset-safe credential removal. When to run: pre-migration and post-batch.
- **`references/go-patterns.md`** — Go: Pre-Docker Local Validation (go vet, go build, go test -short), viper, gRPC probes (including distroless native K8s grpc: probe type), S3 mock, GOMEMLIMIT, probe ordering, mise bootstrap (three-step activation), Dockerfile pitfalls. When to run: pre-migration and post-batch.
- **`references/nodejs-patterns.md`** — Node.js: Pre-Docker Local Validation (node --check, npm ci, tsc --noEmit), connect-redis, ioredis, multer-s3, CronJob patterns, probe ordering, config-module audit, mise bootstrap (three-step activation), JSDoc cron hazard, jest.mock virtual, S3 migration cascade, NestJS probe path verification, lock file desync pre-check, package removal ordering, Dockerfile pitfalls (dead multi-stage detection, HEALTHCHECK start-period). When to run: pre-migration and post-batch.
- **`references/php-patterns.md`** — PHP: Pre-Docker Local Validation (php -l, composer validate, composer install), Toolchain Bootstrap (Composer NOT available via mise — use direct curl installer), config fallback, FPM non-root, supervisord, S3, Stage 0 extension builder, Apache non-root, vendor directory exclusion, non-standard vendor-dir detection, production-safe ConfigMap defaults, SMTP egress NetworkPolicy, apache CMD inheritance trap, configPath override detection, terminationGracePeriodSeconds formula, 5-pass grep tools/scripts exclusion, Dockerfile pitfalls. When to run: pre-migration and post-batch.
- **`references/java-jvm-patterns.md`** — Java/Maven/Gradle (covers BOTH build tools): Pre-Docker Local Validation (mvn package/gradlew build, mise toolchain bootstrap), Spring @Value, Quartz, Liquibase, WAR patterns, Tomcat WAR Deployment (CATALINA_OPTS env export, Infinispan JGroups ports), HikariCP API Misuse Detection, System.getenv() scan, PIPESTATUS for Maven pipe verification, Spring cron conversion, host-side compilation mandate, Hibernate dual-load guard, @KafkaListener EL placeholders, SPRING_PROFILES_ACTIVE mandatory ConfigMap, Spring Redis ENV bridge, Kafka Consumer HPA sizing, bootJar archiveVersion, Gradle wrapper JAR regeneration, Spring XML PPC Profile Isolation, Latin-1 Properties Encoding, JWT Lazy Credential Validation, canonical JVM ENTRYPOINT, embedded cache emptyDir, Dockerfile pitfalls. When to run: pre-migration and post-batch.
- **`references/python-patterns.md`** — Python: Pre-Docker Local Validation (py_compile, pip install, pytest unit-only), venv Docker, SIGTERM, Celery Beat, pydantic-settings, lazy imports, exec probe, pytest, APScheduler CronJob conversion, INI dual-path config, multi-line os.environ.get, tuple-list config mapping, Redis triple-role, WSGI environ false-positive exclusion, Dockerfile pitfalls. When to run: pre-migration and post-batch.
- **`references/ruby-rails-patterns.md`** — Ruby/Rails: Pre-Docker Local Validation (ruby -c, bundle check, rspec unit-only, mise/rbenv bootstrap), ENV.fetch, ActiveStorage, cable.yml, Puma, post-externalisation test sync, Sidekiq queue config, Rails 7.x Sprockets, Gemfile version pin, SMTP egress NetworkPolicy, CONDITIONAL PASS for Bundler mismatch, post-logging transformation test sync, Dockerfile pitfalls. When to run: pre-migration and post-batch.
- **`references/dotnet-patterns.md`** — C#/.NET: Pre-Docker Local Validation (dotnet build, dotnet test unit-only), IConfiguration, EF Core, SignalR, Kestrel, InboundClaimTypeMap, Xabaril health checks, DefaultAzureCredential, Dockerfile pitfalls (base image tool availability). When to run: pre-migration and post-batch.

## Validation / Exit Criteria

### Phase 1 Validation
1. User was prompted for output location and format preference before analysis began (§0 Block A).
2. All findings produced in a single consolidated report at the user-specified location.
3. Report begins with a visual readiness scorecard (21 areas) with correct status icons.
4. Executive summary table follows with severity counts and narrative paragraph.
5. Every source file scanned against all 12 factors and additional analysis areas.
6. All findings categorised as Blocker, Warning, or Informational with consistent emoji icons.
7. Per-section findings in structured tables with file:line references verified via grep.
8. Named Service Inventory table with all 11 mandatory columns included. **Must include both Minimal Decomposition Recommendation and Full Decomposition Recommendation subsections.**
9. Singleton risk summary table included.

### Phase 2 Validation (Criteria 1-13)

1. Every blocker finding addressed by code change, manifest, or infrastructure requirement. **CronJob extraction sub-check**: after extracting a scheduled task to a CronJob manifest, grep the primary Deployment source for the original scheduler trigger (e.g., `cron.AddFunc`, `@Scheduled`, `APScheduler.add_job`, `cron.schedule`) and assert it is absent or disabled.
2. All hardcoded config replaced with env var reads.
3. Session state is non-local and safe for horizontal scaling. **Session verification gate**: before adding Redis for sessions, grep for DB-backed session patterns.
4. All logging redirected to stdout/stderr.
5. Persistent filesystem usage replaced with appropriate object store or shared volume.
6. All hardcoded credentials removed; sourced from Kubernetes Secrets. Verify credential-only field scope: null/empty defaults applied ONLY to credential fields, not to region/endpoint/bucket.
7. Complete Kubernetes manifests generated in kubernetes/ (or k8s/) directory for the execution scope (per `decomposition_scope`). ⚠ Guard: ConfigMap data values must be strings; CronJob podSelector label must match `spec.jobTemplate.spec.template.metadata.labels`, not top-level metadata.labels.
8. Every main container in Deployment, Job, and CronJob manifests includes: resource requests/limits, probes, and complete security context. ⚠ Guard: For UID/capability exceptions by base image, see `references/skill-b-containerisation-transformation.md` §Security Context Edge Cases. **Container-level securityContext MUST include ALL six fields: `runAsNonRoot: true`, `runAsUser: <UID>`, `runAsGroup: <UID>`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities: {drop: [ALL]}`. Pod-level securityContext alone is insufficient — container-level fields MUST be repeated.** **Probe rules by workload type**: (a) Init containers: no probes. (b) Job/CronJob WITH HTTP endpoint: startupProbe + livenessProbe (omit readiness). (c) Job/CronJob WITHOUT HTTP endpoint: exec livenessProbe only — use shell form `["/bin/sh", "-c", "kill -0 1"]` (not standalone binary path). Distroless exception: omit ALL probes — use `activeDeadlineSeconds` (≤80% schedule interval). (d) Deployment main containers: all three probes. Headless workers: exec probes only. **startupProbe first-boot sizing**: failureThreshold: 30, periodSeconds: 10 (300s budget). **DB-migration sizing**: For applications with database migration tooling (Liquibase, Flyway, Alembic, Django migrations, ActiveRecord migrations), use failureThreshold: 60, periodSeconds: 10 (600s budget) — migration at startup requires a larger window. Always review timing observations from the readiness report before setting final values. **Fallback when no readiness report timing data is available**: use DB-migration budget (failureThreshold: 60) as conservative default for any app with database migration tooling detected in source. **Probe path authentication rule**: Verify probe path returns HTTP 2xx WITHOUT auth. For WAR/servlet apps, include deployment context path from Dockerfile HEALTHCHECK in the probe path. For NestJS, use `expressApp.get()` registration paths in `main.ts`, NOT `@Controller()` route paths.
9. **Stale-claim sweep, .bak enforcement, and TRANSFORMATION_SUMMARY.md integrity.**

   **Outcome checks** (procedure details in `references/validation-patterns.md` §Stale-Claim Sweep):
   - (a) Zero `.bak` files in working tree.
   - (b) No future-tense language (`will`, `shall`, `would`) in transformation documents. The Two-Category Triage exemption applies ONLY to Phase 1 readiness reports. **Audit trail row labels must use functional abstractions — never literal banned tokens or verbatim grep strings.** Audit trail format: `PASSED (N found and removed during cleanup; 0 remaining)`.
   - (c) No banned phrases (`should be`, `TODO`, `TBD`, action-required markers) in TRANSFORMATION_SUMMARY.md.
   - (d) Known-Issues entries verified as resolved.
   - (e) Post-debugger documentation re-sweep passes.
   - (f) File-path verification: every file path cited in TRANSFORMATION_SUMMARY.md must exist on disk. ⚠ Guard: Pre-filters — (i) exclude absolute paths starting with `/` (container-internal), (ii) match only known repo-relative prefixes (`kubernetes/`, `k8s/`, `src/`, `config/`, `lib/`), (iii) exclude abbreviated class paths. Use regex `[A-Za-z0-9/_.-]` for path matching. Deferred Resources tables MUST NOT use backtick-quoted `kubernetes/` paths for files that do not exist — describe by resource type only.
   - (g) Tool-skipped enforcement: when Docker was skipped due to unavailability, verify TRANSFORMATION_SUMMARY.md records the tier as `PASSED (skipped — tool unavailable)`, not `CONDITIONAL PASS`. `CONDITIONAL PASS` is reserved for cases where a tool was present but validation produced a recoverable failure.
   - (h) Heading-format check: Verify that no heading in TRANSFORMATION_SUMMARY.md begins with repeated `#` sequences separated by a space (e.g., `### ### Section Title`). Any such doubled-heading pattern is a malformed heading that must be corrected.

   **TRANSFORMATION_SUMMARY.md required section headings**: `## Executive Summary`, `## Manifest Inventory`, `## Configuration Changes`, `## Security Hardening Summary`, `## NetworkPolicy Summary`, `## Microservice Decomposition Roadmap` (mandatory when monolith_risk is high/critical; recommended otherwise). The Roadmap MUST include a **### Scope Comparison: Minimal vs Full** subsection.

   **Env var count definition**: count = sum of unique keys from configmap.yaml data + secret.yaml stringData/data.

10. **Criterion 10 — Assembly and Reconciliation**: All generated Kubernetes manifests pass sub-rules (A)–(G) from `references/validation-patterns.md`. ⚠ Guard: **Service selector parity**: assert AT LEAST ONE Deployment matches each Service selector (ANY-match, `len(matches) > 0`), not ALL-match. Implement via Python `all(k in dep_labels and dep_labels[k] == v for k, v in selector.items())` subset check — selector keys must be a subset of Deployment labels, not an equality check.

11. **Three-Tier Validation Pipeline** (strictly ordered):

    **Tier 1 — Docker Build:** `docker build` exit 0 for every Dockerfile in scope. If Docker unavailable: status = `PASSED (skipped — tool unavailable)`, overall result is unaffected (not degraded). See `references/docker-build-validation.md`.

    **Tier 2 — kubeconform + Structural Assertions:** Always runs. Canonical: `kubeconform -kubernetes-version 1.28.0 -strict -ignore-missing-schemas -summary kubernetes/*.yaml`. ⚠ Guard: Post-kubeconform, run placement assertions for CronJob `activeDeadlineSeconds` and Secret envFrom dotted-key check — see `references/docker-build-validation.md` §Post-kubeconform Placement Assertions. **kubeconform known blind spots**: kubeconform -strict does NOT verify namespace field presence on namespaced resources or CronJob `activeDeadlineSeconds` placement — Criterion 10F Python assertions are the sole catching mechanism for these. **Post-kubeconform, the structural assertion battery (Criterion 10 sub-rules A–G) is MANDATORY regardless of kubeconform exit status — kubeconform -strict does NOT validate field placement within a valid schema, namespace membership, or cross-resource parity.** Include `terminationGracePeriodSeconds` placement assertion: for Deployment, StatefulSet, and DaemonSet assert `doc['spec']['template']['spec'].get('terminationGracePeriodSeconds')` (NOT at Deployment `spec` root). For CronJob, the correct path is `doc['spec']['jobTemplate']['spec']['template']['spec'].get('terminationGracePeriodSeconds')`.

    **Tier 3 — Cluster Validation (ask-before-skip):** Minikube/kind/k3s/KWOK. For KWOK `--runtime=binary`, Tier 3 can proceed regardless of Tier 1 status because KWOK validates only API acceptance. See `references/docker-build-validation.md`.

    **CONDITIONAL PASS scoring**: `CONDITIONAL PASS` is reserved for cases where a tool **was present** but produced a recoverable failure (e.g., Docker build failed but can be fixed, or tests failed due to missing system deps). Tool absence is NOT a failure — unavailable tiers are recorded as `PASSED (skipped — tool unavailable)` and do NOT degrade the overall result. When ALL available tiers pass (or are skipped due to absence) and Tier 2 passes, overall status = `PASSED`.

12. **NetworkPolicy completeness (bidirectional)**: Every workload has ingress+egress NetworkPolicy. Non-web workloads (workers, CronJobs, Jobs with no inbound traffic) MUST declare `ingress: []` (deny-all ingress). Web-facing workloads use explicit port-based ingress rules instead of `ingress: []`. ALL workloads MUST declare `policyTypes: [Ingress, Egress]` — this ensures the ingress policy is enforced regardless of whether rules or empty array is used. DNS egress MUST list BOTH `protocol: UDP, port: 53` AND `protocol: TCP, port: 53`. External service egress uses ports-only (NO `to:` field, NEVER `to: []`). Do NOT use `ipBlock` for external service egress even when existing codebase uses it — use ports-only (omit `to:` field entirely). The ports-only pattern (omitting `to:` entirely) means "allow egress to ANY destination on these ports" — this is intentional for external services where destination IPs are not known at deploy time. **Egress determination rule**: Determine NetworkPolicy egress from actual driver/ORM `require()`/`import` calls, not env var reads alone — a process reading a connection string for validation but never importing the driver does NOT need that service in egress. ⚠ Guard: CronJob podSelector must match `spec.jobTemplate.spec.template.metadata.labels`; egress NetworkPolicy uses pod port not Service port. See `references/skill-b-containerisation-transformation.md` §CronJob Manifest Reference.

13. **Container Build & Basic Tests Gate** — docker build exits 0 (or `PASSED (skipped — tool unavailable)` when Docker is absent; this does NOT degrade the overall result). **Pre-Docker native compilation gate (compiled languages):** For projects with `pom.xml`/`build.gradle` (Java), `go.mod` (Go), `.csproj`/`.sln` (C#), or `package.json` with a `build` script (TypeScript/Node.js), the language-native build tool MUST be invoked and exit 0 before `docker build`. Host-side compilation is ALWAYS attempted first — even for multi-stage Dockerfiles — because it provides faster feedback than a Docker build failure. See `references/docker-build-validation.md` §Step 0. **Pre-Docker validation gate (interpreted languages):** For projects with `composer.json` (PHP), `requirements.txt`/`pyproject.toml` (Python), `Gemfile` (Ruby), or `package.json` without a `build` script (Node.js), the language-native validation commands MUST be run and exit 0 before `docker build`. See `references/docker-build-validation.md` §Step 0b and each language reference §Pre-Docker Local Validation. If the toolchain version does not match the project requirements (e.g., JDK mismatch), attempt resolution via `mise install` first; record `CONDITIONAL PASS` with root cause only if mise is absent or installation fails — do NOT silently skip. **CONDITIONAL PASS for interpreted-language version mismatches**: Ruby: host ruby version != Gemfile `ruby` constraint → `bundle install` exit non-zero → CONDITIONAL PASS. Python: host python incompatible with `python_requires` → `pip install` exit non-zero → CONDITIONAL PASS. A HIGHER host JDK compiling LOWER source level is backward-compatible — attempt build first; exit 0 = PASS. **Repeat-failure escalation**: if the language-native compile/validation step fails in 2+ tasks for the same environmental reason (e.g., JDK version mismatch), the overall Criterion 13 result MUST be `CONDITIONAL PASS` — not `PASS`. Document root cause and affected tasks in the Three-Tier Validation table. Language-native test suite passes (unit tests only, exclude integration tests requiring live infrastructure). **Test attempt mandate**: Before documenting tests as skipped, ATTEMPT to run unit tests with infrastructure-exclusion flags: Python `pytest -m 'not integration and not db' -x`; Ruby `rspec --tag ~@integration`; Java `mvn test -Dtest='!*IntegrationTest,!*Integration'`; Go `go test ./... -short`; Node.js `npx jest --testPathIgnorePatterns='integration'`; PHP `vendor/bin/phpunit --exclude-group=integration`. Infrastructure-dependent failures = CONDITIONAL PASS; syntax/import errors = FAIL. Pre-existing test failures from missing system deps → CONDITIONAL PASS with root cause list. Projects with no test suite: document absence as a note; do not fail on missing tests.
