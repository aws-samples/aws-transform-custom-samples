## Name

Portfolio Agentic Readiness Analysis

## Objective

Aggregate individual repository Agentic Readiness Analysis (ARA) reports into a portfolio-level analysis that identifies cross-cutting blockers, shared risks, service dependency patterns, and portfolio-wide remediation guidance — enabling coordinated agentic readiness across the entire service estate.

## Summary

This transformation consumes multiple individual ARA report JSON artifacts (`*-ara-report.json` files) from different repositories and produces a comprehensive portfolio-level view focused exclusively on agentic readiness. It performs intelligent discovery and parsing of ARA report JSONs, identifies cross-cutting BLOCKERs and RISKs that appear across multiple services, constructs a service dependency map from portfolio configuration, generates portfolio-level remediation guidance, recommends agentic enablement programs, and produces a service-by-service summary.

The transformation follows a 9-step pipeline:
1. **Read Context** (Step 0): Parse additionalPlanContext for portfolio framing
2. **Discovery** (Step 1): Locate all ARA report files in the directory structure
3. **Parsing** (Step 2): Extract readiness profiles, severity counts, and per-question findings from each report
4. **Executive Dashboard** (Step 3): Build readiness distribution across the portfolio
5. **Cross-Cutting BLOCKERs** (Step 4): Identify BLOCKERs appearing in 2+ repos
6. **Cross-Cutting RISKs** (Step 4b): Identify RISKs meeting the scaling threshold (max(3, 33% of applicable repos)), split by RISK-SAFETY and RISK-QUALITY tiers
7. **Dependency Mapping** (Step 5): Construct service dependency map from dependency_overrides
8. **Remediation Guidance** (Step 6): Generate portfolio-level remediation for cross-cutting BLOCKERs
9. **Agentic Programs** (Step 7): Recommend AI DLC, AXE, Innovation EBA, and programs from the shared AWS Program & GTM Library (`references/program-library.md`) where triggered
10. **Portfolio-Level Questions** (Step 8): Evaluate PORT-ARA-Q1 through PORT-ARA-Q5 — capabilities only visible across multiple repos

The output is a **four-artifact bundle** containing:
- `{portfolio_name}-portfolio-ara-report.md` — richest narrative
- `{portfolio_name}-portfolio-ara-report.json` — canonical machine-readable contract
- `{portfolio_name}-portfolio-ara-report.html` — single self-contained HTML visualization
- `{portfolio_name}-portfolio-ara-report.metadata.json` — version compatibility sidecar

The MD report contains:
- Executive dashboard with readiness distribution by profile
- Blocker heatmap by section (which dimensions block the most repos)
- Readiness snapshot (structured, machine-parseable metrics for dashboard consumption)
- Cross-cutting BLOCKERs (same blocker question in 2+ repos)
- Cross-cutting RISKs (same risk question appearing in max(3, 33% of applicable repos))
- Service dependency map from dependency_overrides
- Portfolio-level remediation guidance for cross-cutting blockers
- Agentic program recommendations (AI DLC, AXE, Innovation EBA, plus relevant AWS Program & GTM Library programs)
- Service-by-service summary (repo name, profile, blocker count, risk count)

This portfolio TD focuses exclusively on cross-cutting BLOCKER/RISK identification across multiple ARA reports. It does not include modernization pathways, roadmap phases, numeric scores, technology preferences, or resource allocation recommendations.

## Entry Criteria

- At least 2 individual ARA report JSON artifacts exist in repository directories
- ARA report JSONs follow the expected schema: `analysis_type == "ara"`, `classification` object, `findings[]` array with per-finding 12-field shape
- Reports are accessible at specified paths or in a common directory structure
- Write permissions exist to create the output directory and portfolio artifact bundle (MD, JSON, HTML, and metadata.json)

## Implementation Steps

### Step 0: Read additionalPlanContext

Before beginning discovery, read the portfolio analysis context from `additionalPlanContext` to extract framing information and service configuration.

#### 0.1 Read Portfolio Context

Extract the following fields from `additionalPlanContext`:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `portfolio_name` | string | Yes | — | Identifier for the portfolio. Used to name the output bundle (`{portfolio_name}-portfolio-ara-report.{md,json,html,metadata.json}`) and to populate report headers and metadata. If absent, terminate with `"Portfolio analysis failed: portfolio_name is required in additionalPlanContext."` |
| `context` | string | No | — | Free-text description of the portfolio (e.g., "E-commerce platform with 5 microservices migrating to agentic integration"). Used to frame portfolio-level remediation guidance and recommendations. |
| `service_inventory` | object[] | No | — | List of services in the portfolio with metadata (name, path, priority, repo_type, agent_scope, tags). Used to enrich the service-by-service summary and cross-reference with discovered reports. |
| `dependency_overrides` | object[] | No | — | Explicit service dependency declarations. Each entry has: `source` (service name), `target` (service name), `type` (sync, async, shared_db, shared_infra), and `description`. Used to build the service dependency map in Step 5. |

**Example `additionalPlanContext`:**

```yaml
additionalPlanContext: |
  context: "E-commerce platform with 5 microservices evaluating agentic readiness for customer support automation"
  service_inventory:
    - name: "order-service"
      path: "../order-service"
      priority: "P0"
      repo_type: "application"
      agent_scope: "write-enabled"
    - name: "catalog-service"
      path: "../catalog-service"
      priority: "P1"
      repo_type: "application"
      agent_scope: "read-only"
    - name: "infra-modules"
      path: "../infra-modules"
      priority: "P2"
      repo_type: "infrastructure-only"
      agent_scope: "read-only"
  dependency_overrides:
    - source: "order-service"
      target: "catalog-service"
      type: "sync"
      description: "REST API call to look up product details"
    - source: "order-service"
      target: "payment-service"
      type: "sync"
      description: "Payment processing via REST"
```

#### 0.2 Apply Defaults

- **`context`** → No default. If absent, portfolio-level recommendations are written without additional framing.
- **`service_inventory`** → No default. If absent, service metadata is derived solely from discovered reports.
- **`dependency_overrides`** → No default. If absent, the service dependency map section notes that no dependency information was provided and recommends the user supply it for richer analysis.

### Step 1: Discovery — Locate ARA Reports

Scan the target directory structure to find all individual ARA report JSON artifacts.

#### 1.1 Discovery Process

- Recursively search for files matching the pattern `*-ara-report.json` in the directory tree
- For each report found, extract the project/service name from the filename (the prefix before `-ara-report.json`)
- Extract the repository path (parent directory or grandparent directory of the report file)
- Create an inventory of all services assessed with their JSON file locations
- Validate minimum requirement: at least 2 reports must be discovered

**Input Options:**
- A parent directory containing multiple repository folders, each with an ARA report, OR
- A list of explicit paths to ARA report JSON files (from `service_inventory` paths)

#### 1.2 Validation

- Verify each discovered file exists and is readable
- Verify each file is a valid JSON document
- Verify each file is the expected ARA report shape:
  - Has `analysis_type == "ara"` at the root
  - Has a `classification` object with `tier`, `blocker_count`, `risk_safety_count`
  - Has a `findings[]` array with question IDs (API-Q1 through ENG-Q5) and the 12 per-finding fields
  - Has a `metadata` object with `analysis_type` and `td_version`
- Exclude files that don't match the expected shape — log a warning for each excluded file
- Log warnings for inaccessible or malformed files
- **Terminate with a clear error if fewer than 2 valid ARA reports are found**

#### 1.3 Build Report Inventory

After discovery, compile a structured inventory:

| Field | Source |
|-------|--------|
| Service name | Extracted from filename prefix (or `metadata.repo_name` if present) |
| Report file path | Full path to the `*-ara-report.json` file |
| Repository path | Parent directory of the report |
| Priority | From `service_inventory` if available, otherwise from `metadata.priority` in the JSON if present |
| Repo type | From `metadata.repo_type` in the JSON |
| Agent scope | From `metadata.agent_scope` in the JSON |

Cross-reference discovered reports with `service_inventory` (if provided) to enrich metadata. If a service appears in `service_inventory` but no report is found, log a warning: "Service '{name}' listed in service_inventory but no ARA report found at expected path."

### Step 2: Parse Individual ARA Reports

For each ARA report JSON found, extract the data needed for portfolio-level analysis.

#### 2.1 Service Metadata

Extract from the JSON `metadata` object at the root:

- **Service/repository name** — from `metadata.repo_name` (or derive from the filename)
- **Analysis date** — from `metadata.analysis_date` (validate YYYY-MM-DD format)
- **Repo type** — from `metadata.repo_type` (one of: `application`, `infrastructure-only`, `deployment-config`, `monorepo`, `library`). If absent, assume `application`.
- **Agent scope** — from `metadata.agent_scope` (one of: `read-only`, `write-enabled`). If absent, assume `read-only`.

#### 2.2 Readiness Profile

Extract the classification from the JSON `classification` object at the root:

- **Profile** — from `classification.tier` (+ `classification.sub_qualifier` when present). One of: `Agent-Ready`, `Pilot-Ready`, `Pilot-Ready (Safety Concerns)`, `Remediation Required`, `Not Agent-Integrable`
- **Blocker count** — from `classification.blocker_count`
- **Risk-safety count** — from `classification.risk_safety_count`
- **Risk-quality count** — from `classification.risk_quality_count`
- **Info count** — from `classification.info_count`

#### 2.3 Detailed Findings (Per-Question)

From the JSON `findings[]` array, extract for each entry:

- **Question ID** — `findings[i].question_id` (e.g., API-Q1, AUTH-Q7, ENG-Q3)
- **Native severity** — `findings[i].ara_metadata.native_severity` (BLOCKER / RISK-SAFETY / RISK-QUALITY / INFO)
- **Unified severity** — `findings[i].severity` (High / Medium / Low)
- **Finding description** — `findings[i].description`
- **Gap** — `findings[i].gap`
- **Recommendation** — `findings[i].recommendation`
- **Evidence** — `findings[i].evidence` ({file, lines} or null)
- **Safety impact** — `findings[i].safety_impact` (boolean)

From the JSON `evaluations[]` array (if present), extract entries for questions that resolved to N/A, Not Evaluated (extended), or passing — these do NOT appear in `findings[]`.

**N/A Handling During Parsing:**

When a question is in `evaluations[]` with status `N/A`:
- Record it as N/A for this service
- **Do NOT treat N/A as a gap** — a question that is N/A for a service does not count as a BLOCKER or RISK for that service in cross-cutting analysis
- Track which questions are N/A per service for use in cross-cutting analysis (Steps 4 and 4b)

#### 2.4 Conditional BLOCKER Tracking

For the 5 conditional BLOCKER questions (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2), record:
- The resolved severity (BLOCKER, RISK-SAFETY, RISK-QUALITY, or INFO — depending on the service's agent_scope and, for DATA-Q1, which of the B1/B2/B3 sub-checks fired)
- The agent_scope that determined the resolution
- For DATA-Q1: which sub-checks (B1 API response scoping, B2 access control differentiation, B3 formal classification metadata) contributed to the resolved severity

This is used in cross-cutting analysis to distinguish between services where a conditional question resolved as BLOCKER vs. those where it resolved as INFO/RISK. DATA-Q1 resolves to BLOCKER, RISK-SAFETY, or INFO for data-handling applications based on which sub-checks fire — aggregation logic must treat its tiered resolutions accordingly rather than assuming any DATA-Q1 flag equals a BLOCKER.

#### 2.5 Error Handling

- Log warnings for missing sections (use defaults where possible)
- Log warnings for malformed severity values (exclude from aggregations)
- Handle duplicate service names with disambiguation using repository path
- If a report is missing the readiness profile section, attempt to derive it from blocker/risk counts. If counts are also missing, exclude the report from portfolio analysis and log a warning.

### Step 3: Build Executive Dashboard

Aggregate the parsed data into a portfolio-level executive dashboard.

#### 3.1 Readiness Distribution

Count and calculate the percentage of services in each readiness profile:

| Profile | Count | Percentage |
|---------|-------|------------|
| Agent-Ready | N | X% |
| Pilot-Ready | N | X% |
| Pilot-Ready (Safety Concerns) | N | X% |
| Remediation Required | N | X% |
| Not Agent-Integrable | N | X% |

**Calculation:**
- For each profile, count the number of services with that profile
- Percentage = (count / total services) × 100, rounded to nearest integer
- Total must equal the number of assessed services

#### 3.2 Portfolio Summary Metrics

Calculate portfolio-wide summary metrics:

| Metric | Calculation |
|--------|-------------|
| Total services assessed | Count of valid ARA reports parsed |
| Services ready for agents (Agent-Ready + Pilot-Ready) | Count and percentage |
| Total unique BLOCKERs across portfolio | Count of distinct question IDs that appear as BLOCKER in any service |
| Total unique RISKs across portfolio | Count of distinct question IDs that appear as RISK in any service |
| Cross-cutting BLOCKERs | Count of question IDs that appear as BLOCKER in 2+ services (from Step 4) |
| Cross-cutting RISKs | Count of question IDs that appear as RISK at-or-above the scaling threshold, max(3, 33% of applicable repos) (from Step 4b) |
| Services with write-enabled agent scope | Count and percentage |
| Services with read-only agent scope | Count and percentage |

#### 3.3 Repo Type Distribution

Count services by repo type:

| Repo Type | Count | Percentage |
|-----------|-------|------------|
| application | N | X% |
| infrastructure-only | N | X% |
| deployment-config | N | X% |
| monorepo | N | X% |
| library | N | X% |

#### 3.4 Blocker Heatmap by Section

Aggregate BLOCKER counts by ARA section to surface which dimensions are blocking the most repos. This is the key metric for identifying platform-level investments vs. individual service fixes.

For each of the 8 ARA sections (API, AUTH, STATE, HITL, DATA, DISC, OBS, ENG):

1. Count the number of repos that have at least one BLOCKER in that section (excluding N/A questions)
2. Calculate the percentage of applicable repos blocked by that section
3. List the top blocker question IDs in that section

**Calculation:**

```
for each section in [API, AUTH, STATE, HITL, DATA, DISC, OBS, ENG]:
    repos_blocked = 0
    applicable_repos = 0
    blocker_questions = set()
    
    for each service in portfolio:
        has_applicable_question = false
        has_blocker = false
        
        for each question_id in section:
            severity = service.findings[question_id].severity
            if severity != "N/A":
                has_applicable_question = true
                if severity == "BLOCKER":
                    has_blocker = true
                    blocker_questions.add(question_id)
        
        if has_applicable_question:
            applicable_repos += 1
            if has_blocker:
                repos_blocked += 1
    
    record: section, repos_blocked, applicable_repos, percentage, top blocker_questions
```

Order sections by repos_blocked descending — the section blocking the most repos is the highest priority platform investment.

#### 3.5 Readiness Snapshot

Produce a structured, machine-parseable summary block containing the key portfolio metrics. This block is designed for consumption by dashboard and tracking systems that build time-series views across multiple analysis runs.

The snapshot captures the state of the portfolio at analysis time. Delta calculations (blockers resolved, profile changes, velocity) are the responsibility of the consuming system, not this TD.

Fields:

| Field | Type | Source |
|-------|------|--------|
| `analysis_date` | string (YYYY-MM-DD) | Report date |
| `total_services` | integer | Count of assessed services |
| `agent_ready` | integer | Count with Agent-Ready profile |
| `pilot_ready` | integer | Count with Pilot-Ready profile |
| `pilot_ready_safety_concerns` | integer | Count with Pilot-Ready (Safety Concerns) profile |
| `remediation_required` | integer | Count with Remediation Required profile |
| `not_integrable` | integer | Count with Not Agent-Integrable profile |
| `total_blockers` | integer | Sum of BLOCKER counts across all services |
| `total_risks` | integer | Sum of RISK counts across all services (RISK-SAFETY + RISK-QUALITY combined) |
| `total_risk_safety` | integer | Sum of RISK-SAFETY counts across all services |
| `total_risk_quality` | integer | Sum of RISK-QUALITY counts across all services |
| `total_infos` | integer | Sum of INFO counts across all services |
| `cross_cutting_blockers` | integer | Count of question IDs that are BLOCKER in 2+ repos |
| `cross_cutting_risks` | integer | Count of question IDs that are RISK at-or-above scaling threshold (RISK-SAFETY + RISK-QUALITY combined) |
| `cross_cutting_risk_safety` | integer | Count of RISK-SAFETY questions at-or-above scaling threshold |
| `cross_cutting_risk_quality` | integer | Count of RISK-QUALITY questions at-or-above scaling threshold |
| `portfolio_level_blockers` | integer | Count of portfolio-level questions (PORT-ARA-Q1–Q5) scored as BLOCKER |
| `portfolio_level_risks` | integer | Count of portfolio-level questions (PORT-ARA-Q1–Q5) scored as RISK |
| `write_enabled_services` | integer | Count with write-enabled agent scope |
| `read_only_services` | integer | Count with read-only agent scope |

### Step 4: Identify Cross-Cutting BLOCKERs

Identify BLOCKER questions that appear across multiple services. These represent portfolio-wide agentic readiness gaps that should be addressed with coordinated remediation.

#### 4.1 Cross-Cutting BLOCKER Identification

For each of the 43 ARA question IDs:

1. Collect the severity for that question across all services
2. **Exclude services where the question is N/A** — a question that is N/A for a service does not count as a BLOCKER for that service
3. Count the number of services where the question has severity = BLOCKER
4. **If the count is 2 or more**, flag the question as a cross-cutting BLOCKER

**Fan-in escalation rule:** Additionally, a BLOCKER in a single service is escalated to cross-cutting status (annotated as "Single-service BLOCKER with portfolio-wide blast radius") when ANY of the following are true:
- The service has fan-in ≥ 3 in `dependency_overrides` (3+ other services depend on it)
- The service is marked P0 priority in `service_inventory`
- The service is on the critical path (appears as a transitive dependency for 50%+ of the portfolio)

This ensures that a critical gateway service with a BLOCKER is not invisible simply because the gap is unique to that service.

**Algorithm:**

```
for each question_id in all_43_questions:
    blocker_services = []
    applicable_services = []
    
    for each service in portfolio:
        severity = service.findings[question_id].severity
        if severity == "N/A":
            continue  # Skip — N/A is not a gap
        applicable_services.append(service)
        if severity == "BLOCKER":
            blocker_services.append(service)
    
    if len(blocker_services) >= 2:
        flag as cross-cutting BLOCKER
        record: question_id, blocker_services, applicable_services count
```

#### 4.2 Cross-Cutting BLOCKER Output

For each cross-cutting BLOCKER, record:

- **Question ID** — e.g., AUTH-Q1
- **Question topic** — e.g., "Machine Identity Authentication"
- **Affected services** — List of service names where this is a BLOCKER
- **Applicable services** — Count of services where this question is not N/A
- **Impact** — X of Y applicable services have this BLOCKER
- **Common findings** — Summarize the findings across affected services (look for patterns)
- **Portfolio-level remediation** — A coordinated remediation recommendation that addresses all affected services (generated in Step 6)

#### 4.3 Conditional BLOCKER Handling in Cross-Cutting Analysis

For conditional BLOCKER questions (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2):
- Only count a service as having a BLOCKER if the conditional resolved to BLOCKER for that service (i.e., agent_scope was "write-enabled" or, for DATA-Q1, B1 fired under write-enabled/data-export-enabled scope)
- Services where the conditional resolved to INFO or RISK (agent_scope was "read-only", or for DATA-Q1 only B2/B3 fired) do NOT count toward the cross-cutting BLOCKER threshold
- Count these services under the cross-cutting RISK analysis instead (Step 4b)
- Note in the output which services have write-enabled scope (and thus BLOCKER) vs. read-only scope (and thus INFO/RISK) for these questions. For DATA-Q1, also note which sub-check (B1/B2/B3) drove the resolved severity.

### Step 4b: Identify Cross-Cutting RISKs

Identify RISK questions that appear across multiple services. These represent portfolio-wide patterns that warrant coordinated attention. Cross-cutting RISKs are aggregated separately for RISK-SAFETY and RISK-QUALITY tiers.

#### 4b.1 Cross-Cutting RISK Identification

For each of the 43 ARA question IDs, determine the question's RISK tier (RISK-SAFETY or RISK-QUALITY) and run the aggregation algorithm separately per tier:

1. Determine the RISK tier for the question (RISK-SAFETY or RISK-QUALITY)
2. Collect the severity for that question across all services
3. **Exclude services where the question is N/A** — a question that is N/A for a service does not count as a RISK for that service
4. Count the number of services where the question has severity matching the specific tier (RISK-SAFETY or RISK-QUALITY)
5. **If the count meets the threshold** — max(3, 33% of applicable repos), with a floor of 2 for portfolios with fewer than 4 applicable repos — flag the question as a cross-cutting finding for that tier

**Algorithm:**

```
for each question_id in all_43_questions:
    tier = get_risk_tier(question_id)  # RISK-SAFETY or RISK-QUALITY
    
    risk_services = []
    applicable_services = []
    
    for each service in portfolio:
        severity = service.findings[question_id].severity
        if severity == "N/A":
            continue  # Skip — N/A is not a gap
        applicable_services.append(service)
        if severity == tier:  # Match the specific tier
            risk_services.append(service)
    
    risk_threshold = max(3, ceil(len(applicable_services) * 0.33))
    if len(applicable_services) < 4:
        risk_threshold = 2  # Small portfolio accommodation
    if len(risk_services) >= risk_threshold:
        flag as cross-cutting {tier} finding
        record: question_id, tier, risk_services, applicable_services count
```

**RISK-SAFETY questions (16):** AUTH-Q2, AUTH-Q3, AUTH-Q4, AUTH-Q5, AUTH-Q6, AUTH-Q7, STATE-Q1, STATE-Q3, STATE-Q4, STATE-Q5, STATE-Q6, DATA-Q1, DATA-Q2, DATA-Q6, HITL-Q1, HITL-Q2

**RISK-QUALITY questions (17):** API-Q2, API-Q3, API-Q6, STATE-Q2, STATE-Q7, DATA-Q3, DATA-Q4, DATA-Q5, DISC-Q1, OBS-Q1, OBS-Q2, ENG-Q1, ENG-Q2, ENG-Q3, ENG-Q4, ENG-Q5, HITL-Q3

Note: AUTH-Q6, STATE-Q1, DATA-Q1, and DATA-Q2 are conditional BLOCKER questions. When the conditional resolves to RISK (read-only scope, or for DATA-Q1 when only B2 fires), they resolve to RISK-SAFETY. Only count services where the resolved severity matches RISK-SAFETY for these questions.

#### 4b.2 Cross-Cutting RISK Output

Cross-cutting RISKs are split into two subsections: RISK-SAFETY findings first, then RISK-QUALITY findings.

For each cross-cutting RISK, record:

- **Question ID** — e.g., AUTH-Q2
- **Tier** — RISK-SAFETY or RISK-QUALITY
- **Question topic** — e.g., "Scoped Permissions"
- **Affected services** — List of service names where this is a RISK at the matching tier
- **Applicable services** — Count of services where this question is not N/A
- **Impact** — X of Y applicable services have this RISK
- **Common findings** — Summarize the findings across affected services
- **Portfolio-level recommendation** — A coordinated recommendation that addresses all affected services

### Step 5: Build Service Dependency Map

Construct a service dependency map using the `dependency_overrides` from `additionalPlanContext`.

#### 5.1 Dependency Graph Construction

If `dependency_overrides` is provided:

- Create a directed graph with services as nodes and dependencies as edges
- For each dependency override entry:
  - Add an edge from `source` to `target`
  - Label the edge with `type` (sync, async, shared_db, shared_infra) and `description`
- Cross-reference with discovered services — log a warning if a dependency references a service not found in the report inventory

**Dependency Types:**

| Type | Description | Implication for Agentic Readiness |
|------|-------------|-----------------------------------|
| `sync` | Synchronous REST/gRPC call | Agent calling source service may transitively depend on target service availability and auth |
| `async` | Message queue, event bus, pub/sub | Agent actions on source may trigger async effects on target — audit trail must span both |
| `shared_db` | Multiple services access same database | Agent write operations on one service may affect data visible to another — data integrity risk |
| `shared_infra` | Common API gateway, auth system, load balancer | Shared infrastructure blockers (e.g., no machine identity) affect all dependent services |

#### 5.2 Dependency Analysis

For each service, calculate:

- **Fan-in** — Count of services that depend on this service (number of edges pointing to it)
- **Fan-out** — Count of services this service depends on (number of edges pointing from it)
- **Foundation services** — Services with fan-in >= 3 AND fan-out <= 1 (many depend on them, they depend on few)
- **Leaf services** — Services with fan-in <= 1 AND fan-out >= 2 (few depend on them, they depend on many)

#### 5.3 Dependency-Aware Readiness Insights

Combine dependency information with readiness profiles to identify high-risk patterns:

- **High-risk foundation services** — Foundation services (high fan-in) with readiness profile "Remediation Required" or "Not Agent-Integrable". These are critical because many services depend on them, and their blockers may cascade.
- **Shared infrastructure blockers** — If a `shared_infra` dependency target has BLOCKERs (e.g., AUTH-Q1: no machine identity on the shared auth system), all services using that shared infrastructure are affected.
- **Transitive blocker propagation** — If Service A depends synchronously on Service B, and Service B is "Not Agent-Integrable", then Service A's agent integration is also blocked regardless of its own readiness profile.

#### 5.4 No Dependency Information

If `dependency_overrides` is not provided:

**Infer dependencies from individual ARA reports.** Rather than skipping dependency analysis entirely, extract dependency information from the individual report findings:

1. **Scan individual report findings** for evidence of inter-service communication:
   - Look for mentions of gRPC/REST calls to other services in the portfolio (e.g., "calls cartservice via gRPC", "depends on productcatalogservice")
   - Look for shared data store references (e.g., "Redis backing store shared with...")
   - Look for service names mentioned in context fields, findings, or evidence sections
   - Look for import/client references to other services in the codebase (e.g., `NewCheckoutServiceClient`, `CartServiceClient`)

2. **Construct an inferred dependency graph** using the same structure as explicit `dependency_overrides`:
   - Set `type` based on communication pattern: `sync` for REST/gRPC calls, `async` for message queue/event references, `shared_db` for shared data store references, `shared_infra` for shared infrastructure references
   - Set `description` from the evidence found in the report
   - Mark all inferred dependencies as `"inferred": true` to distinguish from explicit overrides

3. **Apply Steps 5.1–5.3 normally** using the inferred dependency graph — calculate fan-in/fan-out, identify foundation services, and perform transitive blocker propagation analysis

4. **Add a note in the service dependency map section:**

> Dependencies were inferred from individual ARA report findings (not explicitly provided via `dependency_overrides`). Inferred dependencies may be incomplete — they reflect only what was observable in the assessed code and report context. For authoritative dependency data, add `dependency_overrides` to the portfolio config.

If no dependencies can be inferred from the reports, display a note that no dependency information was available and produce the service-by-service summary without dependency enrichment.

### Step 6: Generate Portfolio-Level Remediation Guidance

For each cross-cutting BLOCKER identified in Step 4, generate coordinated remediation guidance that addresses the gap across all affected services.

#### 6.1 Remediation Guidance Structure

For each cross-cutting BLOCKER:

- **Question ID and topic** — e.g., AUTH-Q1: Machine Identity Authentication
- **Portfolio impact** — X of Y applicable services affected
- **Root cause pattern** — Identify the common root cause across affected services (e.g., "No service accounts configured — all services use shared credentials or human credentials")
- **Coordinated remediation approach** — A portfolio-level solution that addresses all affected services:
  - **Platform-level fix** — If the blocker can be resolved at the platform/infrastructure level (e.g., deploying a centralized identity provider), describe the shared solution
  - **Per-service fix** — If each service needs individual remediation, describe the common pattern and estimate effort per service
  - **Hybrid approach** — If both platform and per-service work is needed, describe the split
- **Estimated effort** — High / Medium / Low for the portfolio-level remediation
- **Priority** — Based on the number of affected services and the severity of the gap:
  - **Critical** — Affects all or nearly all services, or affects foundation services with high fan-in
  - **High** — Affects majority of services
  - **Medium** — Affects a subset of services
- **Dependencies** — Other cross-cutting BLOCKERs that should be resolved first (e.g., "Resolve AUTH-Q1 before AUTH-Q6 — you need machine identity before you can audit agent actions")

#### 6.2 Remediation Prioritization

Order the cross-cutting BLOCKERs by remediation priority:

1. **Identity and access BLOCKERs first** (AUTH section) — You cannot enforce any other security control without identity
2. **Data integrity BLOCKERs second** (STATE, DATA sections) — Protect data before enabling agent writes
3. **API surface BLOCKERs third** (API section) — Ensure stable integration surface
4. **Remaining BLOCKERs** — Ordered by number of affected services (most affected first)

If `context` was provided in additionalPlanContext, use it to tailor the remediation guidance to the portfolio's specific situation.

### Step 7: Recommend Agentic Programs

Based on the portfolio-wide analysis findings, recommend relevant agentic enablement programs and AWS GTM programs from the shared **AWS Program & GTM Library** in `references/program-library.md`. Load that file when evaluating recommendations — it is the authoritative catalog and contains the full agent instructions (signal patterns, exclusions, qualification criteria, prioritization, grouping, status filtering, and a reasoning checklist), including the three ARA agentic anchor programs (AI DLC, AXE, Innovation EBA). Include a program only if its trigger condition is met. If no programs are triggered, include the brief note in 7.2 instead.

#### 7.1 Evaluating the Library from ARA Findings

Use the `[ARA-anchor]`, `[ARA]`, and `[ARA+MOD]`-tagged programs in the library and map ARA's vocabulary as described in the library's "Mapping findings to triggers" section:

- **Agentic anchor programs** (AI DLC, AXE, Innovation EBA) — defined in the library's "Agentic Enablement Programs (ARA Anchors)" section with their own signal patterns and evaluation logic. These are ARA-only and group under Engagement Models.
- **"3+ High-severity findings across any dimension"** → count unified `High` findings (cross-cutting BLOCKERs from Step 4, plus conditional BLOCKERs resolved as High) across the portfolio.
- **Readiness profiles** → use the exact ARA profile names: `Agent-Ready`, `Pilot-Ready`, `Pilot-Ready (Safety Concerns)`, `Remediation Required`, `Not Agent-Integrable`. Use the profile distribution from the executive dashboard (Step 3).
- **A dimension "showing problems"** → that ARA category has 2+ `Medium`/`High` findings (e.g., Well-Architected Review when `Engineering Maturity` or `Observability` has 2+ Medium+ findings).
- **Customer segment** (Enterprise / SMB / ISV / Startup / WWPS) → infer from the portfolio `context` and `service_inventory`.

Apply the library's selection rules: cap recommendations at **3–5**, prioritize by direct finding match → segment fit → entry-point-before-follow-on, group as **Funded Programs → Engagement Models**, sequence logically (Assessment → Funding → Execution → Optimization, and for the anchor programs AI DLC → AXE → Innovation EBA), and never recommend `Retiring` or not-yet-imminent `Launching` programs. Run the library's reasoning checklist before finalizing.

#### 7.2 Program Recommendations Output

For each triggered program:

- **Program name** — e.g., AI DLC, AXE, Innovation EBA, or any library program (MAP, AI Assessment, ACP, etc.)
- **Relevance** — Why this program is recommended based on portfolio findings
- **Trigger findings** — Specific portfolio metrics that triggered the recommendation (using ARA profile/severity language)
- **What it provides** — Brief description of the program's value
- **Suggested timing** — When to run relative to other programs or analysis phases
- **Next step** — Recommended action (e.g., "Request engagement via AWS Solutions Architect")

Group the rendered output under **Funded Programs → Engagement Models** (the three agentic anchor programs are Engagement Models). Cap at 3–5 total. Do not expose any internal numeric maturity score.

If no programs are triggered, include a brief note: "No specific agentic program recommendations based on current findings. As the portfolio's agentic readiness improves, re-assess to identify program eligibility."


### Step 8: Evaluate Portfolio-Level Questions

Evaluate questions that can only be answered by looking across multiple repos. These are distinct from cross-cutting analysis (Step 4) which aggregates individual findings — portfolio-level questions assess capabilities that no individual repo analysis can see.

Individual report findings are never overridden. Where a portfolio-level finding provides context for an individual blocker, annotate it with "potentially mitigated — verify" but do not change individual counts.

#### 8.1 Portfolio-Level Questions (5)

| ID | Question | Severity | How to Evaluate |
|----|----------|----------|-----------------|
| PORT-ARA-Q1 | **Centralized Identity Plane** — Is there a shared identity provider that all services use for agent M2M authentication? | BLOCKER if no shared IdP detected across any repo; RISK if shared IdP exists but not all services are integrated | Scan all repos for Cognito User Pools, Cognito Identity Pools, Okta configs, or shared auth middleware. Check if the same IdP resource (by ARN, name, or config reference) appears in 2+ repos. Cross-reference with `shared_infra` dependencies. If a shared IdP is found in an infra repo but application repos don't reference it, score as RISK with annotation "shared IdP exists in {repo} but integration not confirmed in {services}." |
| PORT-ARA-Q2 | **Cross-Service Audit Correlation** — Can audit logs be correlated across services for end-to-end agent action tracing? | RISK if no shared trace ID propagation or centralized audit trail detected | Check for: (1) shared CloudTrail trail covering multiple services, (2) consistent trace ID headers (X-Amzn-Trace-Id, traceparent) across repos, (3) centralized log aggregation (CloudWatch Log Groups with shared retention, S3 audit bucket). If individual repos log independently with no correlation mechanism, score as RISK. |
| PORT-ARA-Q3 | **Portfolio-Level Rate Limiting** — Is there a shared API gateway or WAF protecting the portfolio perimeter from agent traffic storms? | RISK if no shared WAF or API gateway detected; INFO if each service has its own rate limiting | Check for: (1) shared WAF WebACL referenced across repos, (2) shared API Gateway with usage plans, (3) portfolio-level rate limiting rules. If rate limiting exists only at individual service level, score as INFO with note that portfolio-level protection is recommended for agent-at-scale scenarios. |
| PORT-ARA-Q4 | **Transitive Dependency Safety** — Do dependency chains create transitive agent safety risks? | BLOCKER if a service with profile Agent-Ready or Pilot-Ready depends (sync) on a service with profile Not Agent-Integrable; RISK if depends on Remediation Required | Using the dependency graph from Step 5 and readiness profiles from Step 3, trace sync dependency chains. If Service A (Agent-Ready) synchronously depends on Service B (Not Agent-Integrable), Service A's agent integration is effectively blocked regardless of its own profile. Flag as BLOCKER. Async dependencies are RISK (eventual consistency issues but not hard blocks). |
| PORT-ARA-Q5 | **Agent Identity Governance** — Is there a centralized mechanism to suspend or revoke agent identities across all services simultaneously? | RISK if no portfolio-wide agent identity registry or centralized revocation mechanism detected | Check for: (1) shared Cognito app client registry, (2) centralized API key management, (3) portfolio-level agent identity documentation. If each service manages agent identities independently with no centralized kill switch, score as RISK. |

#### 8.2 Contextual Annotations

When a portfolio-level finding provides context for individual cross-cutting BLOCKERs, add an annotation to the cross-cutting BLOCKER section:

```markdown
> **Portfolio Context**: <portfolio-level question ID> found that <finding>.
> This may mitigate this blocker for <services> — **verify** that <specific check>.
```

Example:
```markdown
> **Portfolio Context**: PORT-ARA-Q1 found a shared Cognito User Pool in eks-saas-gitops
> (terraform/cognito.tf). This may mitigate AUTH-Q1 for services deployed on this
> cluster — **verify** that each service's API Gateway has a Cognito authorizer attached.
```

Do NOT change individual blocker counts or readiness profiles based on portfolio-level findings. The annotation is informational — human verification is required.

#### 8.3 Portfolio-Level Findings Output

Record portfolio-level question results in a dedicated section of the report, separate from cross-cutting analysis. Include:

- **Question ID and topic**
- **Severity** (BLOCKER / RISK / INFO)
- **Finding** — what was observed across the portfolio
- **Evidence** — specific repos, files, or configurations that informed the finding
- **Recommendation** — portfolio-level action to address the gap
- **Affected Services** — which services are impacted
- **Contextual Annotations** — any individual blockers this finding provides context for


## Report Template

The portfolio ARA TD emits a **four-artifact bundle**: `{portfolio_name}-portfolio-ara-report.md` (narrative), `.json` (canonical), `.html` (self-contained), `.metadata.json` (sidecar). This section specifies the MD structure; the JSON and HTML render subsets of the same data.

---

### Report Header

```markdown
# Portfolio Agentic Readiness Analysis Report

**Date**: <YYYY-MM-DD>
**Services Analyzed**: <count>
**Portfolio Context**: <context from additionalPlanContext, or "Not provided">
```

---

### Executive Dashboard

```markdown
## Executive Dashboard

### Readiness Distribution

| Profile | Services | Percentage | Description |
|---------|----------|------------|-------------|
| ✅ Agent-Ready | N | X% | 0 blockers, 0 RISK-SAFETY — broad agent deployment |
| 🟡 Pilot-Ready | N | X% | 0 blockers, 1–2 RISK-SAFETY — narrow pilot |
| 🟡 Pilot-Ready (Safety Concerns) | N | X% | 0 blockers, 3+ RISK-SAFETY — supervised pilot, prioritize safety |
| 🟠 Remediation Required | N | X% | 1–2 blockers — remediate before any agent deployment |
| ❌ Not Agent-Integrable | N | X% | 3+ blockers — deferred or descoped |

### Portfolio Summary

| Metric | Value |
|--------|-------|
| Total Services Analyzed | N |
| Services Ready for Agents (Agent-Ready + Pilot-Ready) | N (X%) |
| Services Requiring Remediation | N (X%) |
| Cross-Cutting BLOCKERs (same blocker in 2+ repos) | N |
| Cross-Cutting RISKs (same risk at-or-above scaling threshold) | N |
| Services with Write-Enabled Agent Scope | N (X%) |
| Services with Read-Only Agent Scope | N (X%) |

### Repo Type Distribution

| Repo Type | Count | Percentage |
|-----------|-------|------------|
| application | N | X% |
| infrastructure-only | N | X% |
| deployment-config | N | X% |
| monorepo | N | X% |
| library | N | X% |

### Blocker Heatmap by Section

| Section | Repos Blocked | % of Applicable Repos | Top Blockers |
|---------|--------------|----------------------|--------------|
| <section> | N | X% | <question IDs> |
| <repeat for each of the 8 sections, ordered by repos blocked descending> |

### Readiness Snapshot

| Metric | Value |
|--------|-------|
| analysis_date | <YYYY-MM-DD> |
| total_services | <N> |
| agent_ready | <N> |
| pilot_ready | <N> |
| pilot_ready_safety_concerns | <N> |
| remediation_required | <N> |
| not_integrable | <N> |
| total_blockers | <N> |
| total_risks | <N> |
| total_risk_safety | <N> |
| total_risk_quality | <N> |
| total_infos | <N> |
| cross_cutting_blockers | <N> |
| cross_cutting_risks | <N> |
| cross_cutting_risk_safety | <N> |
| cross_cutting_risk_quality | <N> |
| portfolio_level_blockers | <N> |
| portfolio_level_risks | <N> |
| write_enabled_services | <N> |
| read_only_services | <N> |
```

---

### Cross-Cutting BLOCKERs

```markdown
## Cross-Cutting BLOCKERs — Same Blocker in 2+ Repos

> These are BLOCKER-severity questions that appear in 2 or more repositories.
> They represent portfolio-wide agentic readiness gaps requiring coordinated remediation.
> Questions scored as N/A for a service do not count as gaps for that service.

### <question_id>: <question topic>

- **Severity**: BLOCKER in <N> of <M applicable> services
- **Cross-cutting basis**: <"BLOCKER in 2+ repos" OR "Single-service BLOCKER with portfolio-wide blast radius (fan-in ≥ 3 / P0 priority / critical path)" — populate only when escalation rule applies>
- **Affected Services**: <comma-separated service names>
- **Common Finding**: <summarized finding pattern across affected services>
- **Root Cause Pattern**: <common root cause identified across services>
- **Portfolio-Level Remediation**:
  - **Approach**: <platform-level fix, per-service fix, or hybrid>
  - **Immediate Action**: <first concrete step>
  - **Target State**: <what "resolved" looks like across the portfolio>
  - **Estimated Effort**: High / Medium / Low
  - **Priority**: Critical / High / Medium
  - **Dependencies**: <other cross-cutting BLOCKERs to resolve first, or "None">

<Repeat for each cross-cutting BLOCKER, ordered by remediation priority:
1. Identity/access BLOCKERs (AUTH section) first
2. Data integrity BLOCKERs (STATE, DATA sections) second
3. API surface BLOCKERs (API section) third
4. Remaining BLOCKERs by number of affected services>
```

If no cross-cutting BLOCKERs are identified:

```markdown
## Cross-Cutting BLOCKERs — Same Blocker in 2+ Repos

No BLOCKER-severity questions appear in 2 or more repositories. Individual service BLOCKERs (if any) are listed in the service-by-service summary below.
```

---

### Cross-Cutting RISKs

```markdown
## Cross-Cutting RISKs

### Cross-Cutting RISK-SAFETY — Recurring Safety Risks Across Portfolio

> These are RISK-SAFETY questions that appear in at least **max(3, 33% of applicable repos)** (floor of 2 for portfolios with fewer than 4 applicable repos for the question).
> They represent portfolio-wide agent safety gaps requiring coordinated attention.
> Questions scored as N/A for a service do not count as gaps for that service.

#### <question_id>: <question topic>

- **Severity**: RISK-SAFETY in <N> of <M applicable> services
- **Affected Services**: <comma-separated service names>
- **Common Finding**: <summarized finding pattern across affected services>
- **Compensating Controls**: <portfolio-level compensating controls that can be applied across services>
- **Portfolio-Level Recommendation**: <coordinated recommendation addressing all affected services>
- **Estimated Effort**: High / Medium / Low

<Repeat for each cross-cutting RISK-SAFETY, ordered by number of affected services (most affected first).>

<If no cross-cutting RISK-SAFETY findings are identified:>

No RISK-SAFETY questions meet the cross-cutting scaling threshold.

### Cross-Cutting RISK-QUALITY — Recurring Quality Risks Across Portfolio

> These are RISK-QUALITY questions that appear in at least **max(3, 33% of applicable repos)** (floor of 2 for portfolios with fewer than 4 applicable repos for the question).
> They represent portfolio-wide quality patterns to address as capacity allows.
> Questions scored as N/A for a service do not count as gaps for that service.

#### <question_id>: <question topic>

- **Severity**: RISK-QUALITY in <N> of <M applicable> services
- **Affected Services**: <comma-separated service names>
- **Common Finding**: <summarized finding pattern across affected services>
- **Compensating Controls**: <portfolio-level compensating controls that can be applied across services>
- **Portfolio-Level Recommendation**: <coordinated recommendation addressing all affected services>
- **Estimated Effort**: High / Medium / Low

<Repeat for each cross-cutting RISK-QUALITY, ordered by number of affected services (most affected first).>

<If no cross-cutting RISK-QUALITY findings are identified:>

No RISK-QUALITY questions meet the cross-cutting scaling threshold.
```

If no cross-cutting RISKs are identified in either tier:

```markdown
## Cross-Cutting RISKs

### Cross-Cutting RISK-SAFETY — Recurring Safety Risks Across Portfolio

No RISK-SAFETY questions meet the cross-cutting scaling threshold.

### Cross-Cutting RISK-QUALITY — Recurring Quality Risks Across Portfolio

No RISK-QUALITY questions meet the cross-cutting scaling threshold. Individual service RISKs are listed in the service-by-service summary below.
```

---

### Service Dependency Map

```markdown
## Service Dependency Map

<If dependency_overrides were provided:>

### Dependency Overview

| Source Service | Target Service | Type | Description |
|---------------|---------------|------|-------------|
| <source> | <target> | sync / async / shared_db / shared_infra | <description> |
| <repeat for each dependency> |

### Service Dependency Metrics

| Service | Fan-In | Fan-Out | Role | Readiness Profile |
|---------|--------|---------|------|-------------------|
| <service name> | N | N | Foundation / Leaf / Internal | <profile> |
| <repeat for each service> |

### High-Risk Dependency Patterns

<List dependency-aware readiness insights:>

1. **<pattern name>**: <description>
   - **Affected Services**: <list>
   - **Risk**: <explain the risk>
   - **Recommendation**: <what to do>

<If no dependency_overrides were provided:>

> No dependency information was provided in the portfolio configuration. To enable
> dependency-aware analysis — including identification of high-risk foundation services,
> transitive blocker propagation, and shared infrastructure impacts — add
> `dependency_overrides` to the portfolio config.
```

---

### Remediation Guidance

```markdown
## Portfolio Remediation Guidance

<If context was provided, frame the guidance:>
> Portfolio context: <context from additionalPlanContext>

### Remediation Priority Order

Remediation of cross-cutting BLOCKERs should follow this general priority:

1. **Identity and Access** — Resolve AUTH-section BLOCKERs first. You cannot enforce any other security control without machine identity and scoped permissions.
2. **Data Integrity** — Resolve STATE and DATA-section BLOCKERs second. Protect data before enabling agent write operations.
3. **API Surface** — Resolve API-section BLOCKERs third. Ensure a stable, documented integration surface for agent tools.
4. **Remaining BLOCKERs** — Address in order of affected service count (most affected first).

### Coordinated Remediation Plan

<For each cross-cutting BLOCKER, summarize the remediation approach from Step 6.
Group related BLOCKERs that can be addressed together.>

#### <Group name — e.g., "Identity Foundation">

**BLOCKERs addressed**: <question IDs>
**Services affected**: <service names>

- **What to do**: <coordinated remediation steps>
- **Expected outcome**: <what changes when this is resolved>
- **Effort**: High / Medium / Low

<Repeat for each remediation group.>
```

---

### Agentic Programs

```markdown
## Recommended Actions

### Agentic Program Recommendations

> These are engagement-level recommendations based on the portfolio's agentic readiness
> profile. Discuss with your AWS Solutions Architect to determine eligibility and timing.
> Recommendations are capped at 3–5 and grouped by type. (No internal maturity scores are exposed.)

#### Funded Programs

| Program | Relevance | Trigger Findings | Suggested Timing | Next Step |
|---------|-----------|-----------------|------------------|-----------|
| <Program name> | <Why recommended> | <Specific metrics> | <When to run> | <Action> |

#### Engagement Models

| Program | Relevance | Trigger Findings | Suggested Timing | Next Step |
|---------|-----------|-----------------|------------------|-----------|
| <Program name> | <Why recommended> | <Specific metrics> | <When to run> | <Action> |

<Omit any group heading that has no triggered programs.>

### Program Details

#### <Program Name>

- **Why triggered**: <Portfolio metrics that triggered this recommendation>
- **What it provides**: <Brief description of the program's value>
- **Suggested timing**: <When to run relative to other programs>
- **Recommended scope**: <Which services or areas to focus on>
- **Next step**: <Recommended action>

<Repeat for each triggered program.>

<If no programs are triggered:>
> No specific agentic program recommendations based on current findings. As the
> portfolio's agentic readiness improves, re-assess to identify program eligibility.
```

---

### Portfolio-Level Findings

```markdown
## Portfolio-Level Findings

> These questions evaluate capabilities that can only be assessed by looking across
> multiple repos. They are distinct from cross-cutting analysis (which aggregates
> individual findings). Individual report findings are never overridden.

### <question_id>: <question topic>

- **Severity**: BLOCKER / RISK / INFO
- **Finding**: <what was observed across the portfolio>
- **Evidence**: <specific repos, files, or configurations>
- **Recommendation**: <portfolio-level action>
- **Affected Services**: <which services are impacted>
- **Contextual Annotations**: <any individual blockers this provides context for, with "verify" instructions>

<Repeat for each of the 5 portfolio-level questions (PORT-ARA-Q1 through PORT-ARA-Q5).>
```

---

### Service-by-Service Summary

```markdown
## Service-by-Service Summary

| Service | Repo Type | Agent Scope | Readiness Profile | BLOCKERs | RISKs | INFOs | N/A |
|---------|-----------|-------------|-------------------|----------|-------|-------|-----|
| <service name> | <repo_type> | <agent_scope> | <profile> | N | N | N | N |
| <repeat for each service> |

### Individual Service Details

#### <Service Name>

- **Readiness Profile**: <profile>
- **Repo Type**: <repo_type>
- **Agent Scope**: <agent_scope>
- **Priority**: <P0/P1/P2 or "Not set">
- **BLOCKERs** (N):
  - <question_id>: <brief finding summary>
  - <repeat for each BLOCKER>
- **RISKs** (N):
  - <question_id>: <brief finding summary>
  - <repeat for each RISK>
- **Key Recommendations**:
  - <top 1-3 recommendations for this service>

<If dependency information is available:>
- **Depends On**: <list of services this service depends on>
- **Depended On By**: <list of services that depend on this service>

<Repeat for each service, ordered by: Readiness Profile severity (Not Agent-Integrable first, then Remediation Required, then Pilot-Ready, then Agent-Ready), then by priority (P0 first).>
```

---

### Analysis Inventory

```markdown
## Analysis Inventory

| # | Service | Report File | Analysis Date | Repo Type | Agent Scope |
|---|---------|-------------|-----------------|-----------|-------------|
| 1 | <service name> | <file path> | <date> | <repo_type> | <agent_scope> |
| <repeat for each service> |
```

---

### Table of Contents

The complete report structure, for reference:

```markdown
# Portfolio Agentic Readiness Analysis Report

1. Executive Dashboard
   - Readiness Distribution
   - Portfolio Summary
   - Repo Type Distribution
   - Blocker Heatmap by Section
   - Readiness Snapshot
2. Cross-Cutting BLOCKERs — Same Blocker in 2+ Repos
3. Cross-Cutting RISKs
   - Cross-Cutting RISK-SAFETY — Recurring Safety Risks Across Portfolio
   - Cross-Cutting RISK-QUALITY — Recurring Quality Risks Across Portfolio
4. Service Dependency Map
5. Portfolio Remediation Guidance
6. Recommended Actions (Agentic Program Recommendations)
7. Portfolio-Level Findings
8. Service-by-Service Summary
9. Analysis Inventory
```

## Constraints and Guardrails

Strictly follow these rules at all times:

- **Read-only analysis**: Do not modify any source code, configuration, or infrastructure. Only create the output portfolio artifact bundle (MD, JSON, HTML, and metadata.json).
- **Stay on the current branch**: This is an analysis-only task. Do not create, switch, or checkout any git branches. Remain on whatever branch is currently checked out and perform all work there.
- **Minimum 2 reports**: The portfolio analysis requires at least 2 valid ARA reports. Terminate with a clear error if fewer than 2 are found.
- **N/A exclusion**: Questions scored as N/A for a service do NOT count as gaps for that service in cross-cutting analysis. A question that is N/A for a service is excluded from BLOCKER and RISK counts for cross-cutting identification.
- **Cross-cutting thresholds**: BLOCKERs require 2+ repos. RISKs require max(3, 33% of applicable repos) with a floor of 2 for portfolios with fewer than 4 applicable repos. Do not lower these thresholds.
- **Evidence-based**: All cross-cutting findings must reference specific question IDs and service names. Do not make vague claims — state which services are affected and which questions triggered the finding.
- **Conditional BLOCKER accuracy**: When counting cross-cutting BLOCKERs for conditional questions (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2), only count services where the conditional resolved to BLOCKER (write-enabled scope, or for DATA-Q1 when B1 fires under write-enabled scope). Do not count services where it resolved to INFO/RISK (read-only scope, or for DATA-Q1 when only B2/B3 fired).
- **Report completeness**: The output report must contain all required sections: executive dashboard, cross-cutting BLOCKERs, cross-cutting RISKs, service dependency map, remediation guidance, agentic program recommendations, portfolio-level findings (PORT-ARA-Q1 through PORT-ARA-Q5), service-by-service summary, and analysis inventory.

---

### Four-Artifact Output Contract (Portfolio ARA)

Every portfolio ARA analysis emits four artifacts: three report artifacts plus a metadata sidecar. All four files use the same base name derived from the portfolio name.

| Artifact | Filename | Purpose |
|---|---|---|
| Markdown report | `{portfolio-name}-portfolio-ara-report.md` | Richest-prose artifact. Contains Executive Dashboard, Cross-Cutting Analysis, Dependency Map, Agentic Program Recommendations, Readiness Profiles, and Service-by-Service Summary. |
| JSON report | `{portfolio-name}-portfolio-ara-report.json` | **Canonical machine-readable contract.** Consumed by the webapp dashboard. Every semantic field defined in the Top-Level JSON Keys section below MUST be present. |
| HTML report | `{portfolio-name}-portfolio-ara-report.html` | **Single self-contained HTML file** (no external asset fetches at render time). Renders a subset of the JSON per the Portfolio ARA HTML Visual Contract below. MUST be emitted alongside the MD and JSON — it is NOT optional. |
| Metadata sidecar | `{portfolio-name}-portfolio-ara-report.metadata.json` | Tiny JSON file carrying version compatibility data. |

The JSON artifact is the canonical contract. If any artifacts disagree on a field, JSON wins.

#### Artifact Layout

The four-artifact bundle is emitted at the **portfolio root** under the `agentic-readiness-analysis/` directory:

```
{portfolio-root}/
└── agentic-readiness-analysis/
    ├── {portfolio-name}-portfolio-ara-report.md
    ├── {portfolio-name}-portfolio-ara-report.json
    ├── {portfolio-name}-portfolio-ara-report.html
    └── {portfolio-name}-portfolio-ara-report.metadata.json
```

The directory `agentic-readiness-analysis/` is the same canonical location used for per-repo ARA reports (which live one level deeper, under `services/{repo-name}/agentic-readiness-analysis/`). Per-repo and portfolio reports are distinguished by the filename prefix: per-repo uses `{repo-name}`, portfolio uses `{portfolio-name}-portfolio`.

#### Metadata Sidecar Fields

```json
{
  "analysis_type": "portfolio-ara",
  "analysis_date": "YYYY-MM-DD",
  "td_version": "portfolio-agentic-readiness"
}
```

---

### Top-Level JSON Keys

The Portfolio ARA JSON artifact MUST emit these top-level keys in the order shown:

| Key | Description |
|---|---|
| `analysis_type` | Literal `"portfolio-ara"` |
| `metadata` | Version, analysis date, portfolio name, TD version, services_analyzed, consumed_per_repo_json_files count |
| `summary` | 5 KPI counts: repositories_analyzed, total_findings, high_severity_findings, medium_severity_findings, low_severity_findings |
| `filter_vocab` | Filter-eligible values for webapp UI chips |
| `executive_dashboard` | Readiness distribution, portfolio summary, repo-type distribution, blocker heatmap |
| `repositories[]` | Per-repo roll-up |
| `findings[]` | Per-repo findings propagated up. Each entry is a 12-field per-repo finding plus `repo_name`. One entry per (repo × question_id). Used by webapp Findings tab. |
| `cross_cutting_findings[]` | Portfolio-aggregated findings where the same question_id fires at the same tier across 2+ repos (BLOCKER) or meets the scaling threshold (RISK, max(3, 33% of applicable repos)). One entry per question_id. Used by webapp Cross-Cutting view. |
| `remediation_roadmap` | See §"Remediation Roadmap" below |
| `recommended_actions[]` | Agentic anchor programs (AI DLC, AXE, Innovation EBA) plus triggered AWS Program & GTM Library programs, grouped Funded → Engagement |
| `portfolio_level_findings[]` | PORT-ARA-Q* cross-portfolio findings |
| `dependency_map` | Dependency map |

Canonical shape is fully defined by the Top-Level JSON Keys table above. All required keys, types, and nesting are specified inline in this TD.

#### `filter_vocab`

Contains ONLY values actually present in the run, so the webapp renders filter chips without extra network calls:

```json
{
  "severities": ["High", "Medium", "Low"],
  "categories": ["API Surface", "Authentication & Authorization", "State Management", "Human-in-the-Loop", "Data Accessibility", "Discovery & Documentation", "Observability", "Engineering Maturity"],
  "efforts": ["High", "Medium", "Low"],
  "priorities": ["P0", "P1", "P2", "P3"],
  "phases": [1, 2, 3],
  "classifications": ["Agent-Ready", "Pilot-Ready", "Pilot-Ready (Safety Concerns)", "Remediation Required", "Not Agent-Integrable"],
  "safety_impact": [true, false],
  "native_severities": ["BLOCKER", "RISK-SAFETY", "RISK-QUALITY", "INFO"]
}
```

`filter_vocab.categories[]` carries display names only — NOT short codes.

#### `findings[]` vs `cross_cutting_findings[]` — two distinct arrays

The Portfolio ARA JSON emits **two separate finding arrays**, each with its own schema and purpose:

1. **`findings[]`** — per-repo findings propagated up from the consumed per-repo ARA JSONs. One entry per (repo × question_id) with a `repo_name` field so the webapp can filter by repo. Each entry uses the same 12-field shape as per-repo findings plus `repo_name`. Used by the webapp's Findings tab.

2. **`cross_cutting_findings[]`** — portfolio-aggregated findings where the same question_id appears as BLOCKER in 2+ repos or RISK meeting the scaling threshold (max(3, 33% of applicable repos); see Step 4 and Step 4b). One entry per question_id with aggregated metadata (`affected_repos_count`, `applicable_repos_count`, `affected_services[]`, `cross_cutting_type`). Used by the webapp's Cross-Cutting Concerns view.

Both arrays coexist — `findings[]` answers "what's wrong per-repo?" and `cross_cutting_findings[]` answers "what's wrong across the portfolio?". A single question_id may appear in both arrays: once per repo in `findings[]`, and once aggregated in `cross_cutting_findings[]`.

#### `findings[]` entry shape (per-repo propagation)

Each entry mirrors the per-repo ARA 12-field finding shape, plus `repo_name`:

| Field | Type | Description |
|---|---|---|
| `question_id` | string | Rubric question identifier (e.g., `"AUTH-Q1"`). |
| `repo_name` | string | Source repository name (matches `repositories[].repo_name`). |
| `category` | string | Webapp-facing category display name (e.g., `"Authentication & Authorization"`). |
| `category_id` | string | Rubric short code (e.g., `"AUTH"`). |
| `title` | string | Short finding title. |
| `description` | string | Finding description. |
| `gap` | string | What's missing or incorrect. |
| `recommendation` | string | Remediation recommendation. |
| `severity` | enum | `"High"` / `"Medium"` / `"Low"` — unified severity. |
| `native_severity` | enum | `"BLOCKER"` / `"RISK-SAFETY"` / `"RISK-QUALITY"` / `"INFO"` — ARA native severity for portfolio grouping. |
| `safety_impact` | boolean | `true` for RISK-SAFETY findings and BLOCKERs flagged as agent-safety hazards. |
| `priority` | enum | `"P0"` / `"P1"` / `"P2"` / `"P3"` — per-question priority (static per question_id). |
| `effort` | enum | `"High"` / `"Medium"` / `"Low"` — remediation effort estimate. |
| `phase` | integer | `1`–`3` — derived roadmap phase (Phase 1 = blockers, Phase 2 = safety, Phase 3 = quality). |
| `evidence` | object or null | `{file, lines}` reference or `null`. |

Findings are sourced from each consumed per-repo ARA JSON's `findings[]` array; the portfolio TD adds `repo_name` and emits them into a flat array. Ordering: severity descending, then repo_name, then category display order (API → AUTH → STATE → HITL → DATA → DISC → OBS → ENG).

Findings are NEVER emitted for questions that resolve to pass, N/A, or Not Evaluated at the per-repo level — the portfolio `findings[]` array only contains rows for which the source per-repo ARA JSON emitted a finding.

#### `cross_cutting_findings[]` entry shape (portfolio aggregation)

Each entry aggregates the same question_id across multiple repos where it fires at the same tier:

| Field | Type | Description |
|---|---|---|
| `question_id` | string | Rubric question identifier. |
| `category` | string | Webapp-facing category display name. |
| `category_id` | string | Rubric short code. |
| `title` | string | Short finding title (shared across affected repos). |
| `severity` | enum | `"High"` / `"Medium"` / `"Low"` — unified severity of the aggregated tier. |
| `native_severity` | enum | `"BLOCKER"` / `"RISK-SAFETY"` / `"RISK-QUALITY"` / `"INFO"` — native severity. |
| `cross_cutting_type` | enum | `"blocker"` / `"risk_safety"` / `"risk_quality"` — the tier that triggered this cross-cutting entry. |
| `affected_repos_count` | integer | Number of repos where this question fires at this tier. |
| `applicable_repos_count` | integer | Number of repos where this question is not N/A (denominator). |
| `affected_services` | string[] | Repo names where this question fires at this tier. |
| `common_finding_summary` | string | Prose summary of the finding pattern across affected repos. |
| `root_cause_pattern` | string | Common root cause identified across repos. |
| `portfolio_remediation` | object | `{approach, immediate_action, target_state, estimated_effort, priority, dependencies[]}` per Step 6.1. |

Cross-cutting entries are generated per Step 4 (BLOCKER threshold: 2+ repos OR fan-in escalation) and Step 4b (RISK threshold: max(3, 33% of applicable repos)). Step 6 populates `portfolio_remediation` for each entry.

---

### Remediation Roadmap

The Portfolio ARA JSON emits `remediation_roadmap` with `grouping: "phase_category"`. Each `items[]` entry carries:

```json
{
  "phase": 1,
  "category": "Machine Identity Authentication",
  "category_question_id": "AUTH-Q1",
  "native_severity": "BLOCKER",
  "severity": "High",
  "safety_impact": true,
  "common_finding_summary": "…",
  "root_cause_pattern": "…",
  "remediation": "Implement OAuth2 client credentials or per-agent API keys with principal attribution",
  "remediation_detail": {
    "approach": "per_service_fix",
    "immediate_action": "…",
    "target_state": "…",
    "dependencies": []
  },
  "affected_repos_count": 11,
  "applicable_repos_count": 34,
  "effort": "Medium",
  "priority": "P0",
  "affected_services": [
    {
      "repo_name": "Lidarr--Lidarr",
      "per_repo_evidence": { "file": "src/…/HostConfigResource.cs", "lines": "10-45" },
      "agent_scope": "read-only",
      "resolution_reasoning": "…",
      "conditional_resolution": "…"
    }
  ],
  "also_affected_at_lower_severity": [
    { "repo_name": "FlowiseAI--Flowise", "resolved_severity": "RISK-SAFETY", "reason": "B2 — framework-hook defaults" }
  ]
}
```

#### Sources for item fields (JSON-only consumption)

- `per_repo_evidence` sourced from per-repo ARA JSON `findings[].evidence`. NEVER parsed from per-repo MD.
- `conditional_resolution` and `agent_scope` sourced from per-repo ARA JSON `findings[].ara_metadata.{conditional_resolution, agent_scope}` for the five conditional BLOCKERs (API-Q4, STATE-Q1, AUTH-Q6, DATA-Q1, DATA-Q2).
- `also_affected_at_lower_severity[]` populated for DATA-Q1 items when different repos' B1/B2/B3 sub-checks fire at different severity tiers. Sourced from per-repo `findings[].ara_metadata.data_q1_subchecks`.

#### MD rendering

The Portfolio ARA MD artifact renders these items under an H2 heading **"## Remediation Roadmap"** that matches the webapp tab label. Each item is rendered as an H3 subsection with:
- Title: `"Phase {N} — {category}"`
- Table of `{affected_services, per_repo_evidence, agent_scope, resolution_reasoning}`
- Cross-Cutting narratives (BLOCKER Remediation blocks, Cross-Cutting RISK-SAFETY prose, Cross-Cutting RISK-QUALITY prose) are retained verbatim within the item.

The ARA execution-sequencing narrative (Phase 1 BLOCKER resolution, Phase 2 RISK-SAFETY hardening, Phase 3 RISK-QUALITY improvements) is preserved in MD prose.

---

### Recommended Actions

The Portfolio ARA JSON emits `recommended_actions[]` as an array of program entries. Entries come from two sources: the three ARA-specific agentic anchor programs, and triggered programs from the AWS Program & GTM Library (`references/program-library.md`). The anchor programs always appear (with their resolved `status`); library programs appear only when triggered.

Anchor program coverage:

| `id` | `name` | `acronym` | `type` | `group` |
|---|---|---|---|---|
| `ai-dlc` | AI Driven Development Lifecycle | AI DLC | workshop | Engagement Models |
| `axe` | Agent Experience Engagement | AXE | program | Engagement Models |
| `innovation-eba` | Innovation EBA | Innovation EBA | program | Engagement Models |

Each entry carries:

```json
{
  "id": "axe",
  "name": "Agent Experience Engagement",
  "acronym": "AXE",
  "type": "program",
  "group": "Engagement Models",
  "status": "Triggered",
  "trigger_reason": "19 BLOCKERs across authentication and data classification; structured implementation engagement recommended.",
  "suggested_timing": "After initial triage",
  "duration": "4-week engagement",
  "what_it_provides": "Hands-on agent-integration engagement with AWS Solutions Architects."
}
```

`group` ∈ {Funded Programs, Engagement Models}. `status` ∈ {Triggered, Applicable, Not Triggered}. `trigger_reason` is non-empty prose explaining why the program fires (using ARA profile/severity language, never an internal numeric score). The total triggered set is capped at 3–5 per the library's selection rules; library entries carry `acronym: null` where the program has no acronym.

The MD artifact renders this under an H2 heading **"## Recommended Actions"**, grouped Funded Programs → Engagement Models. The "## Agentic Program Recommendations" label is retained as an H3 subheading under that H2 to preserve rich program prose without creating duplicate H2s.

---

### Portfolio ARA HTML Visual Contract

The portfolio ARA HTML artifact is a single self-contained file rendering a subset of the portfolio JSON. The full visual contract is inlined below — do NOT reference external files.

#### HTML Structure and Layout

**Header:**
- Title: `Agentic Readiness - {portfolio_name}`
- Subtitle line: `{date} · {N} repositories · agent_scope: {agent_scope}`

**Executive Summary** (top section, above the tab bar):

Prose intro: "This Agentic Readiness Analysis evaluates whether your {N} repositories can safely integrate with autonomous AI agents. The analysis examines eight key dimensions (API Surface, Authentication & Authorization, State Management, Human-in-the-Loop, Data Accessibility, Discovery & Documentation, Observability, Engineering Maturity)..."

Subsections:
1. **Portfolio Status** — "Out of {N} repositories analyzed, {A} are agent-ready and can integrate with AI agents immediately, {B} are pilot-ready for read-only operations, and {C} require remediation before agent deployment. The analysis identified {H} high severity findings (blockers) and {M} medium severity findings (risks)."
2. **Key Findings** — Top 3 cross-cutting high severity areas as bullet list with repo counts
3. **Remediation Plan** — 3-phase numbered list with finding counts and timelines
4. **Recommended Actions** — Bullet list of triggered programs (agentic anchors AI DLC/AXE/Innovation EBA plus any triggered AWS Program & GTM Library programs) with reasons

**Stats Card Row** (4 cards):

| Card | Value source | Subtitle |
|---|---|---|
| Total Findings | `summary.total_findings` | Across {M} repositories |
| High Severity | `summary.high_severity_findings` | Blockers that must be fixed |
| Medium Severity | `summary.medium_severity_findings` | Safety and quality risks |
| Agent-Ready | `executive_dashboard.readiness_distribution.agent_ready.count` | Ready for integration |

(ARA swaps "Low Severity" for "Agent-Ready" — this is ARA-specific.)

**Charts Row** (3 visualizations):
- **Portfolio Distribution** — pie/donut chart from `executive_dashboard.readiness_distribution`
- **Severity by Repository** — stacked bar chart from per-repo counts in `repositories[]`
- **Section Heatmap** — grid heatmap from `executive_dashboard.blocker_heatmap_by_section[]` (ARA-only)

**Tab bar order:** Repositories → Findings → Remediation → AWS Programs. NO Pathways tab — pathways are MOD-only.

#### Repositories Tab

Table columns: `Name`, `Language`, `LOC`, `Total Findings`, `High Severity`, `Medium Severity`, `Agentic Readiness`

- Source: `repositories[]`
- Agentic Readiness = `classification.tier` (potentially with `sub_qualifier`)
- Ordered by High count descending, then alphabetical
- ARA **omits** the `Low Severity` column (MOD includes it)

#### Findings Tab

Download CSV control in header.

Table columns: `Category`, `Repository`, `Finding Description`, `Remediation`, `Severity`, `Effort`

- Source: `findings[]`
- Finding Description = title (bold) + one-liner description
- Ordered by severity (High first), then repo name, then category

#### Remediation Roadmap Tab

3-phase table:

| Phase | Focus Area | Findings | Timeline | Key Actions |
|---|---|---|---|---|
| Phase 1 | Blockers — Must Fix Before Agent Deployment | N | 3-6 weeks | Machine Identity Auth, Data Classification, API Documentation |
| Phase 2 | Safety Risks — Required for Production | N | 2-4 weeks | Audit Logging, Rollback, Rate Limiting, Authorization |
| Phase 3 | Quality Risks — Recommended for Operations | N | 2-4 weeks | Distributed Tracing, Schema Versioning, Error Handling, API Testing |

Source: `remediation_roadmap.items[]` grouped by phase

#### Recommended AWS Programs Tab

Table columns: `Program`, `Group`, `Description`, `Why Recommended`, `Duration`

- Source: `recommended_actions[]` filtered to `status == "Triggered"`
- Group values: `Funded Programs`, `Engagement Models` — render as grouped sections in that order (or a Group column), omitting any group with no triggered programs
- The triggered set can include ANY `[ARA]` / `[ARA+MOD]` / `[ARA-anchor]` program from the AWS Program & GTM Library — not just the agentic anchors. Examples that may appear from ARA findings: MAP / MAP for AI Modernization (Funded), AI Assessment Program (Funded), SHIP (Funded — only for infrastructure security gaps like missing CloudTrail/encryption/secrets management, NOT for app-layer agent auth), Well-Architected Review (Funded), AI DLC / AXE / Innovation EBA / ACP / GenAI Innovation Center (Engagement Models), AgentStorming Workshop (Engagement Models)
- Capped at 3–5 total per the library's selection rules. Do not display any internal numeric maturity score.

#### Footer

- `Generated by AWS Transform · Portfolio Agentic Readiness Analysis Report`
- `© {year} Amazon Web Services, Inc. All rights reserved.`

#### Data Sourcing (JSON → HTML mapping)

| Visual location | JSON source |
|---|---|
| Header | `metadata.{portfolio_name, analysis_date, services_analyzed}` + agent_scope |
| Executive Summary | `summary.*` + `executive_dashboard.*` + `recommended_actions[]` |
| Stats cards | `summary.*` + `executive_dashboard.readiness_distribution.agent_ready.count` |
| Portfolio Distribution chart | `executive_dashboard.readiness_distribution` |
| Severity by Repository chart | Per-repo counts from `repositories[]` |
| Section Heatmap chart | `executive_dashboard.blocker_heatmap_by_section[]` |
| Repositories table | `repositories[]` |
| Findings table | `findings[]` |
| Remediation Roadmap | `remediation_roadmap.items[]` grouped by phase |
| AWS Programs table | `recommended_actions[]` |

**Content NOT in HTML** (MD-only): Sequencing Principles, per-service steps, Parallel Execution Tracks, Portfolio Risk Register, DATA-Q1 sub-check reasoning, conditional-resolution reasoning, root cause patterns.

**HTML-escaping discipline** applies to every attacker-controlled string (repo names, evidence file paths, finding titles, finding descriptions, prose fields).

---

## Error Handling

The portfolio TD consumes ONLY per-repo JSON. Failure modes are explicit, loud, and actionable.

### Missing Per-Repo JSON

IF any per-repo JSON listed in the portfolio configuration is missing from the consumed corpus, THEN the portfolio analysis SHALL fail with a message listing ALL missing files at once (not one at a time).

Example: `"Portfolio analysis failed: 3 per-repo JSON artifacts missing: services/foo--bar/agentic-readiness-analysis/foo--bar-ara-report.json, services/baz--qux/agentic-readiness-analysis/baz--qux-ara-report.json, services/wat--wub/agentic-readiness-analysis/wat--wub-ara-report.json."`

### Dangling Cross-Reference

IF a `question_id` or `repo_name` referenced in portfolio JSON does not resolve into at least one consumed per-repo JSON of the matching `analysis_type`, THEN the portfolio analysis SHALL fail naming the dangling reference.

Example: `"Portfolio analysis failed: findings[3].question_id='AUTH-Q9' does not match any rubric question in consumed ARA per-repo JSONs."`

### No Silent Fallback

The portfolio TD SHALL NOT fall back to parsing per-repo MD or HTML. If per-repo JSON is unavailable, unreadable, or invalid, the analysis fails. The TD consumes JSON-only.
