---
name: containerisation-readiness-analysis
description: >-
  Analyses a codebase across any language or framework to assess containerisation
  and Kubernetes readiness. Evaluates all 12-factor app principles, identifies
  stateful patterns, singleton risks, hardcoded config, memory leaks, database
  connection issues, and monolith decomposition opportunities. Produces a styled
  HTML or markdown report with visual scorecard, severity badges, Named Service
  Inventory with decomposition complexity ratings, and structured finding tables.
  Triggers: containerisation, Kubernetes, 12-factor, cloud-native, readiness
  assessment, migration analysis, microservice decomposition.
---

# Containerisation Readiness Analysis - 12 Factor App and Kubernetes Compatibility

## Objective

Analyse a codebase across any language or framework to assess its suitability for containerisation and deployment on Kubernetes, identifying violations of the 12-factor app principles and patterns that would cause failures or degraded behaviour in a containerised, orchestrated environment. Before performing the analysis, prompt the for preferences: the output directory or file path where the report should be stored. The output format should be both markdown and HTML. Always produce a single consolidated report file. Produce the report according to these preferences.
## Summary

This transformation performs a comprehensive static analysis of a codebase to identify containerisation blockers, risks, and remediation steps. Before beginning the analysis, the transformation prompts the user for two configuration preferences: the desired output location (directory or file path) and whether the output should be in markdown or HTML format. It always produces a single consolidated report file containing all analysis sections. It then evaluates the code against all twelve factors of the 12-factor app methodology, flags patterns that would break or behave unpredictably on Kubernetes, and produces the readiness report in the chosen format at the specified location. All results are assembled into one unified document with clearly delineated sections. When HTML format is selected, the report uses full HTML formatting with styled severity badges, collapsible sections, and a styled scorecard, rather than markdown syntax. Special attention is given to service discovery hardcoding, stateful patterns, logging anti-patterns, shared dependency management, concurrency safety issues under horizontal scaling, singleton pattern challenges that would cause failures when running multiple containers behind a load balancer, and hardcoded configuration values. Additionally, the analysis identifies startup order dependencies between services, detects in-memory state sharing between microservice candidates, recommends how to decompose monolithic modules into separate containers with a **Named Service Inventory table and Decomposition Complexity ratings**, flags local filesystem usage for replacement with object stores or shared filesystems, ensures user sessions are externalised while local caching is leveraged where appropriate, detects memory growth and leak patterns, identifies hardcoded IPs, ports, embedded credentials and API keys that must be moved to a secrets manager, and analyses database connection patterns for race conditions or ACID compliance risks.

## Entry Criteria

1. The codebase is available for static analysis and contains application source code in one or more programming languages.
2. The application is currently running in a non-containerised environment (bare metal, VMs, or traditional deployment) or is being assessed before an initial containerisation effort.
3. Build and dependency configuration files are present (e.g., pom.xml, package.json, requirements.txt, go.mod, .csproj, Gemfile, or equivalent).

## Implementation Steps

### User Configuration Prompts

Before performing any analysis, prompt the user for the following two preferences:

1. Ask the user for the output location where the report should be stored. This can be a directory path (in which case default file names will be used) or a full file path. If the user provides a directory, ensure it exists or create it. If no location is provided, default to the current working directory.
2. Ask the user whether the output format should be markdown (.md) or HTML (.html). If HTML is selected, produce a fully styled HTML document with proper CSS styling for severity badges (coloured background spans), collapsible/expandable sections for each analysis area, a styled readiness scorecard table, and properly formatted finding tables. If markdown is selected, use standard markdown syntax with emoji icons as described in the formatting steps below.

Always produce a single consolidated report file containing all analysis sections at the specified output location. Store these two preferences and apply them consistently across all output generation steps that follow.

### Factor 1: Codebase (One codebase tracked in revision control, many deploys)

1. Check for the presence of version control configuration (e.g., .git directory).
2. Identify if multiple distinct applications are bundled in a single repository without clear module separation, which complicates independent container builds and deployments.
3. Flag any environment-specific code branches or conditional compilation that ties the codebase to a single deployment target.

### Factor 2: Dependencies (Explicitly declare and isolate dependencies)

4. Locate all dependency manifest files (pom.xml, package.json, requirements.txt, go.mod, .csproj, Gemfile, build.gradle, etc.) and verify dependencies are explicitly declared with pinned or locked versions.
5. Identify shared libraries or modules that are referenced across multiple application modules via local file paths, relative references, or symlinks rather than through a package registry or artifact repository. Flag these as containerisation blockers since each container must be independently buildable.
6. Detect any reliance on system-level packages, globally installed tools, or OS-specific binaries that are assumed to exist on the host but would not be present in a minimal container image.
7. Flag any vendored or copied-in dependency code that is not managed through the standard dependency tooling for that language.

### Factor 3: Config (Store config in the environment)

8. Search for hardcoded configuration values across all source files, including but not limited to: IP addresses, hostnames, port numbers, database connection strings, API URLs, file system paths, credentials, licence keys, and feature flags.
9. Identify configuration files (e.g., application.properties, appsettings.json, .env files, YAML configs) that contain environment-specific values baked directly into the source tree rather than being injected at runtime.
10. Check whether the application reads configuration from environment variables or external configuration sources (e.g., config servers, Kubernetes ConfigMaps, Secrets). Flag any absence of this pattern.
11. Flag any configuration that is written to or modified at runtime and stored on the local filesystem, as this will not survive container restarts.

### Factor 4: Backing Services (Treat backing services as attached resources)

12. Identify all connections to external services such as databases, message queues, caches, SMTP servers, and third-party APIs.
13. Flag any backing service connections that use hardcoded addresses, hostnames, or connection strings rather than being configurable via environment variables or service discovery mechanisms.
14. Check for service discovery patterns. Flag any hardcoded service endpoints, static host lists, or DNS entries that assume a fixed network topology. In Kubernetes, services are discovered via internal DNS (service-name.namespace.svc.cluster.local) or environment variables, so any hardcoded addresses will break.

### Factor 5: Build, Release, Run (Strictly separate build and run stages)

15. Identify any patterns where the application compiles, downloads dependencies, or performs build-time activities during startup or at runtime.
16. Flag any runtime code generation or dynamic compilation that would require build tools to be present in the production container image.

### Factor 6: Processes (Execute the app as one or more stateless processes)

17. Scan for in-memory state storage patterns including but not limited to: in-memory session stores, application-level caches that are not backed by an external service, static mutable variables used to share state across requests, and singleton patterns that accumulate state.
18. Flag any use of sticky sessions or session affinity mechanisms, as these break when Kubernetes reschedules pods or scales horizontally behind a load balancer.
19. Identify any local file system writes that are used for storing application state, user uploads, temporary processing data, or inter-process communication. In Kubernetes, container filesystems are ephemeral and data will be lost on pod restart.
20. Flag any reliance on the application running as a single instance, such as locking mechanisms that assume a single process, scheduled tasks that would duplicate if multiple pods run, or in-memory queues.

#### User Session Externalisation

21. Identify all user session management mechanisms in the codebase, including HTTP session objects, server-side session stores, and any framework-specific session handling (e.g., HttpSession in Java, express-session in Node.js, Flask sessions in Python).
22. Flag any user sessions stored in-memory (e.g., in-process session stores, default framework session handlers that use server memory). These must be replaced with an external session store such as Redis, Memcached, DynamoDB, or a database-backed session provider to survive pod restarts and support horizontal scaling.
23. Identify any session data that is being serialised to local disk as a persistence mechanism, as this will not survive container replacement.

#### Local Caching Strategy

24. While in-memory session state must be externalised, identify opportunities where local in-memory caching should be retained or introduced for performance. This includes: read-heavy reference data, configuration lookups, frequently accessed static content, and computed values that are expensive to regenerate.
25. Flag any local caches that store user-specific mutable state or data that must be consistent across multiple pod instances. These require a distributed cache (e.g., Redis, Memcached) rather than a local in-memory cache.
26. Recommend a caching strategy that distinguishes between data suitable for local in-memory caching (tolerant of staleness, pod-local, and read-heavy) versus data requiring a distributed external cache (user state, shared mutable data, session data).

#### In-Memory State Sharing Between Microservice Candidates

27. Analyse the codebase for shared mutable state between what appear to be distinct modules, bounded contexts, or logical services within the monolith. This includes static variables, shared singletons, shared data structures in memory, or global registries that multiple modules read from and write to.
28. Flag any patterns where one module or service directly modifies in-memory state that another module depends on, as this coupling will break when these modules are decomposed into separate containers with separate memory spaces.
29. Recommend replacement patterns for shared in-memory state: event-driven communication via a message broker, shared external cache, or API calls between services.

### Factor 7: Port Binding (Export services via port binding)

30. Check that the application binds to a configurable port rather than a hardcoded one. In Kubernetes, the port must be configurable to work with Service and Pod definitions.
31. Flag any reliance on specific port numbers below 1024 that would require elevated container privileges.
32. Search the entire codebase for any hardcoded IP addresses (e.g., 10.x.x.x, 192.168.x.x, 172.x.x.x, or any public IPs), fixed port numbers in connection strings, socket bindings, or client configurations. These must be replaced with configurable values injected via environment variables or Kubernetes ConfigMaps.
33. Flag any use of fixed hostnames or IP addresses in inter-service communication, load balancer configurations, health check endpoints, or monitoring agent configurations.

### Factor 8: Concurrency (Scale out via the process model)

34. Analyse the codebase for patterns that would break under horizontal scaling when multiple copies of the same module run behind a Kubernetes load balancer. This includes: leader election assumptions, singleton resource locks, in-memory rate limiters, sequence generators, and non-distributed cron or scheduler implementations.
35. Flag any use of local file-based locking or inter-process communication mechanisms (e.g., named pipes, shared memory, file locks) that assume processes are co-located on the same host.
36. Identify any thread-local or process-local state that is assumed to persist across multiple requests from the same client.

#### Memory Growth and Memory Leak Detection

37. Analyse the codebase for patterns known to cause memory growth or memory leaks, including: unbounded caches or collections that grow without eviction policies, event listener or callback registrations that are never removed, connection pools that are opened but never closed or returned, large object allocations in request-scoped code that may not be garbage collected promptly, and static collections that accumulate entries over the application lifetime.
38. Flag any patterns where objects are added to long-lived data structures (e.g., static maps, lists, or sets) without corresponding removal logic, bounded size limits, or TTL-based eviction.
39. Identify any use of finalizers, weak references, or manual memory management patterns that may behave unexpectedly under container memory limits where the JVM, runtime, or garbage collector may be killed by the OOM killer before cleanup logic executes.
40. Flag any absence of container-aware memory configuration. Multi-runtime examples: JVM `-XX:MaxRAMPercentage`; Python K8s `resources.limits.memory` + gunicorn `--max-requests` + Celery `--max-tasks-per-child`; Node.js `--max-old-space-size`; Go `GOMEMLIMIT`; .NET `DOTNET_GCConserveMemory` / `DOTNET_GCHeapHardLimit`; PHP `PHP_MEMORY_LIMIT` = 0.8 × K8s pod memory limit via ConfigMap, set `pm.max_requests` in FPM pool config. Trace memory settings through the full shell init-script chain (Dockerfile ENTRYPOINT → startup.sh → inner scripts) to find the authoritative default. **Severity assignment**: Warning for JVM/Node.js/PHP (OOM kill risk under container limits); Info for Go (GOMEMLIMIT is advisory, Go GC is container-aware by default since Go 1.19).

### Horizontal Scaling and Singleton Pattern Challenges

41–51. (Unchanged — see previous iteration for full text of steps 41-51 covering singleton patterns, scheduled tasks, event buses, rate limiters, sequence generators, resource managers, leader election, cache warming, file coordination, WebSocket state, and singleton risk summary table.)

### Factor 9: Disposability (Maximise robustness with fast startup and graceful shutdown)

52–54. (Unchanged — graceful shutdown, long startup, cleanup hooks.)

#### Startup Order Dependencies

55–58. (Unchanged — dependency graph, circular deps, crash-on-missing, retry patterns.)

### Factor 10: Dev/Prod Parity

59–60. (Unchanged — environment-specific code, in-memory substitutes.)

### Factor 11: Logs

61–63. (Unchanged — file appenders, log rotation, stdout/stderr.)

### Factor 12: Admin Processes

64. (Unchanged — embedded admin tasks.)

### Kubernetes-Specific Analysis

65–71. (Unchanged — fixed paths, localhost, timeouts, OS-specific, multicast, root filesystem, root user.)

#### Probe Exception Table

When assessing readiness for Kubernetes probe requirements, the following workload types have special severity treatment:

| Workload Pattern | readinessProbe Absence | Severity | Rationale |
|---|---|---|---|
| HTTP API/web server | Warning | Required for traffic routing |
| Pull-based queue worker (Sidekiq, Celery, BullMQ — no Service, no inbound traffic) | Note (Informational) | readinessProbe is optional for pull-based workers; add a `# MIGRATION: readinessProbe omitted — pull-based worker` YAML comment in Phase 2 |
| CronJob / Job main container | Not applicable | K8s API does not support readinessProbe on Jobs |

This table aligns Phase 1 findings with Phase 2 probe exception rules (SKILL.md criterion 8d).

### Local Filesystem Usage Replacement

72–77. (Unchanged — categorise usage, object store, shared filesystem, uploads, temp, hardcoded paths.)

### Credentials, API Keys, and Secrets Management

78–82. (Unchanged — embedded secrets, plaintext, filesystem paths, env vars, CLI args.)

### Monolith Decomposition Recommendations

83. Analyse the codebase structure to identify distinct modules, bounded contexts, or logical services that are candidates for decomposition into separate containers. Use the following **enumeration algorithm**:
    - **Route-group analysis**: Group HTTP routes by URL prefix (`/api/uploads/*`, `/api/auth/*`). Each group with ≥3 endpoints is a candidate.
    - **Package/namespace scan**: Each top-level package/namespace with its own models = candidate.
    - **Queue channel scan**: Each distinct queue name or worker topic = worker candidate.
    - **Scheduled task scan**: Each cron entry = CronJob candidate.
    - **Mode-toggle scan**: Each env flag gating behaviour (CONSUMER_ONLY, WORKER_ONLY, APP_MODE) = per-mode image candidate.

84. For each identified microservice candidate, produce a row in the **Named Service Inventory table** with these MANDATORY columns:
    - **ServiceName** — a concrete name (e.g., NotificationService, UploadService), NOT generic "Service A"
    - **DomainResponsibility** — what business function it owns
    - **SourcePaths** — directories/files constituting this service
    - **OwnedTables** — database tables/collections this service exclusively writes
    - **InboundAPIs** — HTTP/gRPC endpoints this service exposes
    - **OutboundEvents** — events/messages this service publishes
    - **ScalingDriver** — what metric drives independent scaling (CPU, queue depth, connections)
    - **ExtractionOrder** — numeric priority (1 = first to extract, LAST = AuthService)
    - **Complexity** — Low / Medium / High per the Decomposition Complexity Rubric in `references/microservice-decomposition-patterns.md`
    - **BlockingDependencies** — what must be resolved before extraction
    - **DataOwnership** — exclusive-write / read-only / shared-write-BLOCKER

85. Produce a **Data Ownership Matrix** table mapping each database table/collection to:
    - Which service(s) WRITE to it
    - Which service(s) READ from it
    - FK constraints referencing it from other domains
    - Whether it is a decomposition blocker (shared-write = YES)

86. Classify each service candidate's infrastructure concerns vs domain responsibility:
    - **Infrastructure concerns** (logging, monitoring, config, secrets) → remain cross-cutting, NOT separate services
    - **Domain services** (notifications, uploads, search, auth, orders) → decomposition candidates
    - Flag any candidate that is purely an infrastructure concern mistakenly listed as a domain service

87. For each recommended microservice, specify: startup dependencies on other services, communication mechanism (REST, gRPC, message queue, event bus), shared data concerns that need Shared-DB Remediation Ladder steps, and whether it requires a separate Docker image or can share with mode-toggle removal.

### Database Connection and Data Integrity Analysis

88–93. (Unchanged — connection patterns, race conditions, transactions, advisory locks, stale cache, pool sizing.)

### Output Consolidation and Visual Formatting

94. Compile all findings from every analysis step above into a single consolidated report file at the specified output location.

#### Visual Readiness Scorecard

95. At the very top of the report, include a visual readiness scorecard with exactly 21 rows:
1. Factor 1 – Codebase  2. Factor 2 – Dependencies  3. Factor 3 – Config  4. Factor 4 – Backing Services  5. Factor 5 – Build, Release, Run  6. Factor 6 – Processes  7. Factor 7 – Port Binding  8. Factor 8 – Concurrency  9. Horizontal Scaling & Singleton Challenges  10. Factor 9 – Disposability  11. Factor 10 – Dev/Prod Parity  12. Factor 11 – Logs  13. Factor 12 – Admin Processes  14. Kubernetes-Specific  15. Local Filesystem Usage  16. Credentials & Secrets  17. Session & Caching Strategy  18. Memory Analysis  19. Startup Dependencies  20. Monolith Decomposition  21. Database Connections

**Totals Derivation Rule:** The TOTALS row MUST be derived by summing the current values from all individual area rows. Delta arithmetic is prohibited.

**Count Synchronisation Rule:** After any modification that changes B/W/I counts, perform a full-report sync across: (1) per-row badge counts (authoritative), (2) scorecard TOTALS, (3) executive summary totals + narrative, (4) footer paragraph.

**Mandatory Python Sum-Verification:** After writing all per-section tables and the TOTALS row, verify arithmetic with:
```bash
python3 -c "
# Extract per-row B/W/I counts and verify TOTALS
# IMPORTANT: Count ONLY F-prefixed finding rows to avoid prose/remediation text inflation
# Use EMOJI-ONLY matching (not disjunction with text labels) to prevent double-counting
import re, sys
content = open(sys.argv[1]).read()
# Filter to finding rows only (lines starting with | F followed by a digit)
finding_lines = [l for l in content.splitlines() if re.match(r'\|\s*F\d+', l.strip())]
# Deduplicate by finding ID to prevent summary-table replication
seen_ids = set()
unique_lines = []
for l in finding_lines:
    fid = re.match(r'\|\s*(F\d+)', l.strip())
    if fid and fid.group(1) not in seen_ids:
        seen_ids.add(fid.group(1))
        unique_lines.append(l)
finding_text = '\n'.join(unique_lines)
# Use emoji-only matching (NOT disjunction like '🔴|Blocker')
blockers = finding_text.count('🔴')
warnings = finding_text.count('🟡')
infos = finding_text.count('🔵')
print(f'Computed from F-rows: B={blockers} W={warnings} I={infos}')
# Compare against TOTALS row — manual verification step
" report.md
```
Mental arithmetic errors are most common in the Info column. Always verify TOTALS programmatically rather than counting manually. **F-prefixed row guard**: The script counts ONLY lines matching `| F\d+` (finding rows) — this prevents remediation text, section headings, and legend entries from inflating counts. **Per-finding-ID deduplication**: Each F-ID is counted only once even if it appears in multiple tables.

**PROHIBITION: Summary table replication**: Do NOT add a "Summary of All Findings" table that replicates F-prefixed finding rows from per-section tables. Per-section finding tables are the sole authoritative location for findings. Any summary using F-row IDs causes double-counting in the verification script. Cross-reference in verification as a pre-run check: assert no F-row ID appears more than once across all tables.

**F-ID uniqueness and format rule**: Each F-ID MUST appear in exactly ONE section table — never duplicated across tables. Use sequential non-dotted IDs (F1, F2, F3, ...) — do NOT use hierarchical dotted IDs (F3.1, F3.2) as these break the sum-verification regex `r'\|\s*F\d+'`. If a section has multiple findings, assign each a unique sequential F-number.

**Icon Derivation Rule:** Always derive the status icon from finalised per-section finding counts.

#### Section Heading Icons

96. Each major section must include a descriptive category emoji icon.

**Common confusions:** ☸ U+2638 (WHEEL OF DHARMA) is correct for Kubernetes — NOT ⎈ U+2388 (HELM SYMBOL); 🗄 U+1F5C4 (FILE CABINET) is correct for Database — NOT 🗃 U+1F5C3 (CARD BOX).

#### Severity Icons

97. Use red circle emoji + "Blocker", yellow circle + "Warning", blue circle + "Info" consistently everywhere.

#### Per-Section Finding Tables

98. Within each section, present findings in structured markdown tables with columns: number, severity icon+label, file:line location, description, principle violated, remediation.

**No-Issues / Findings Table Mutual Exclusivity:** Display EITHER green check + "No issues found" OR the findings table — never both.

**Line-Reference Verification:** Obtain exact line numbers via `grep -n`. Confirm with `sed -n <line>p`.

**Cross-Report Propagation:** When correcting any reference, grep the full report for ALL occurrences and update.

**All-File-Type Coverage:** Line references mandatory for ALL file types including XML, YAML, Dockerfile, shell scripts.

#### Executive Summary Table

99. Include executive summary section after scorecard with severity counts per area, totals row derived by summing, and 2-4 sentence narrative.

#### Colour-Coded Severity Badges

100. HTML format: inline span elements with background colour. Canonical CSS: `badge badge-blocker`, `badge badge-warning`, `badge badge-info`. Non-finding tables use `badge-sum-*` variants.

**PROHIBITED: `badge badge-*` inside `<summary>` elements.** Use `badge-sum-*` classes for aggregate display.

#### Monolith Decomposition Visual Plan and Named Service Inventory

101. In the monolith decomposition section, include:
    (a) The **Named Service Inventory table** (step 84 format) — this is the PRIMARY output consumed by Phase 2 sub-phase §2. It replaces the generic visual diagram from previous iterations.
    (b) The **Data Ownership Matrix** (step 85 format) showing table-to-service mapping.
    (c) A **communication diagram** (text-based) showing arrows between services with protocol labels.
    (d) The **extraction sequencing** showing which services extract first (Low → Medium → High, Auth always LAST).
    (e) For each service, the **Decomposition Complexity** rating with justification referencing the rubric from `references/microservice-decomposition-patterns.md`.

    **Pre-write gate (mandatory)**: Before finalising the Monolith Decomposition section, verify the Named Service Inventory table is present with all 11 mandatory column headers:
    ```bash
    grep -c 'ServiceName.*DomainResponsibility\|DomainResponsibility.*SourcePaths' report.html report.md 2>/dev/null
    ```
    If the table is absent or incomplete, do NOT write the section summary — add the table first.

#### Minimal Decomposition Recommendation

102. After the Named Service Inventory table, include a **### Minimal Decomposition Recommendation** subsection containing:
    - The primary Deployment only (the service that owns the primary HTTP endpoint)
    - Required supporting resources (migration Job if startup depends on it, required background worker if app cannot process requests without it)
    - Total manifest count expected under minimal scope
    - Prerequisites that must be resolved before the primary Deployment can run independently
    - Rationale for why this is the minimum viable Kubernetes deployment

#### Full Decomposition Recommendation

103. Immediately after the Minimal recommendation, include a **### Full Decomposition Recommendation** subsection containing:
    - ALL Low and Medium complexity candidates from the Named Service Inventory with extraction order
    - Per-service effort estimate (story points or T-shirt size) based on complexity rating
    - Per-service prerequisites (shared-DB remediation steps, async signal decoupling, etc.)
    - Total manifest count expected under full scope
    - Risk assessment: what could go wrong with full extraction vs the incremental minimal approach
    - Recommended extraction sequence (Low-complexity first, then Medium, High deferred)

## Validation / Exit Criteria

1. User prompted for output location and format. Report respects both.
2. All findings in single consolidated report. No separate per-factor files.
3. Report uses chosen format (HTML or markdown with appropriate styling).
4. Every source file scanned against all 12 factors and additional areas.
5. Report begins with 21-row visual readiness scorecard with correct status icons.
6. Executive summary table with totals derived by summing per-row values.
7. All findings categorised as Blocker/Warning/Info with consistent emoji icons.
8. All severity classifications use correct emoji icons throughout.
9. HTML format includes colour-coded badges with canonical CSS class names.
10. Section headings include category emoji icons.
11. Findings in structured tables (number, severity, location, description, principle, remediation).
12. Sections with no findings show ONLY green check. Sections with findings show ONLY the table.
13. All hardcoded config identified.
14. All stateful patterns identified with file:line.
15. Session mechanisms identified (in-memory flagged as blockers).
16. Caching strategy documented (local vs distributed).
17. Logging anti-patterns identified.
18. Shared dependencies identified.
19. Horizontal scaling risks identified.
20. Singleton risk summary table complete.
21. Filesystem usage catalogued with replacement recommendations.
22. File upload mechanisms reviewed.
23. All credentials/secrets identified.
24. Startup dependency graph produced.
25. Memory growth risks identified.
26. Database connection patterns analysed.
27. **Named Service Inventory table** produced with ALL mandatory columns (ServiceName, DomainResponsibility, SourcePaths, OwnedTables, InboundAPIs, OutboundEvents, ScalingDriver, ExtractionOrder, Complexity, BlockingDependencies, DataOwnership).
28. **Data Ownership Matrix** produced for projects with ≥3 tables and ≥2 candidates.
29. Every `file:line` reference verified via `grep -n`.
30. Scorecard icons consistent with counts. Totals correct.
31. Build verification command is a valid shell expression.
32. **Minimal Decomposition Recommendation** subsection present with primary Deployment identification, manifest count, and prerequisites.
33. **Full Decomposition Recommendation** subsection present with all Low/Medium candidates, effort estimates, and extraction sequence.
