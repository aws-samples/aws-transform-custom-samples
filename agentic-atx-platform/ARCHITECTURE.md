# ATX Transform Platform - Architecture

## Overview

AI-powered code transformation platform built on Amazon Bedrock AgentCore and AWS Transform CLI. All operations flow through a single orchestrator agent that coordinates specialized sub-agents.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  UI (React + CloudFront)                                     │
│  Tabs: Transformations | Execute | Create Custom | CSV Batch | Jobs | Metrics | Knowledge | Chat │
└──────────────────────┬───────────────────────────────────────┘
                       │
              POST /orchestrate
              (submit + poll)
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  async_invoke_agent Lambda                                    │
│  ├── submit: fire-and-forget to AgentCore                    │
│  ├── poll: read result from S3                               │
│  └── direct: fast Batch/S3 calls (status, results, customs) │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Bedrock AgentCore Runtime                                    │
│                                                               │
│  Orchestrator Agent (Strands + Claude Sonnet 4)                  │
│  ├── find_transform_agent (sub-agent)                        │
│  │   ├── list_transformations (static catalog)               │
│  │   ├── search_transformations (keyword search)             │
│  │   └── list_published_custom (S3 lookup)                   │
│  ├── execute_transform_agent (sub-agent)                     │
│  │   ├── execute_transformation → Batch submit               │
│  │   ├── get_job_status → Batch describe                     │
│  │   └── list_job_results → S3 list                          │
│  └── create_transform_agent (direct tool calls)             │
│      ├── _submit_headless_create → Batch job:                │
│      │     clone → atx -x (headless generate) → S3 stage     │
│      │     → atx custom def publish (unless preview)         │
│      ├── publish_transformation → Batch publish job          │
│      └── list_registry_transformations → Batch list job      │
│                                                               │
│  Memory: ShortTermMemoryHook (AgentCore Memory)              │
└──────────────────────┬───────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
     Amazon S3    AWS Batch    Amazon Bedrock
   (definitions   (Fargate +   (Claude
    + results)    ATX CLI)     Sonnet 4)
```

## Data Flows

### Execute Transformation
```
UI → /orchestrate (submit) → Lambda (async) → AgentCore
  → Orchestrator → execute_transform_agent → execute_transformation
  → batch_client.submit_job() → Batch → ATX CLI container
  → Results to S3
UI → /orchestrate (poll) → Lambda → S3 → result with job_id
UI → /orchestrate (direct, status) → Lambda → Batch describe_jobs
UI → /orchestrate (direct, results) → Lambda → S3 list_objects
```

### Create Custom Transformation
```
UI → /orchestrate (submit) → Lambda (async) → AgentCore
  → Orchestrator → create_transform_agent

  Step 1: Extract parameters from natural language (Bedrock)
  Step 2: Submit ONE fire-and-forget Batch job (ATX CLI headless mode):
    → git clone <repo> (if source URL provided)
    → atx -x "<generation prompt>" -t
      (the ATX agent reads the repo off local disk, selects relevant files
       itself, and writes /tmp/skills/{name}/SKILL.md)
    → aws s3 cp SKILL.md s3://atx-source-code-{account}/custom-definitions/{name}/SKILL.md
    → atx custom def publish (skipped in preview / "Generate & Review" mode)
    → status.json written to S3 (generating|publishing → generated|published|failed)

  Without source repo: the headless prompt generates from requirements only

  The orchestrator returns immediately after submit_job; the UI tracks
  progress via check_publish (Batch describe_jobs → status.json update)

UI → /orchestrate (direct, list_custom) → Lambda → S3 list
UI → /orchestrate (direct, check_publish) → Lambda → Batch + S3 update
UI → /orchestrate (direct, get_file) → Lambda → S3 get (definition preview)
UI → /orchestrate (direct, put_file) → Lambda → S3 put (save user-edited SKILL.md
  before the review-flow publish; scoped to custom-definitions/<name>/SKILL.md)
```

### Design Decisions: Custom Transformation Creation

- **ATX headless mode vs custom Bedrock pipeline**: Skill generation is delegated to the ATX
  CLI itself (`atx -x "<prompt>" -t`), running inside the same Batch container used for
  transformations. The CLI reads the repo directly off local disk and always emits the
  SKILL.md format the registry validates — no repo snapshot in S3, no custom file-selection
  prompts, and no format drift between our generation code and the ATX registry rules.

- **Deterministic shell steps around the agent**: The headless prompt only asks ATX to write
  the SKILL.md to a known path. The S3 staging (`aws s3 cp`) and publish
  (`atx custom def publish`) run as explicit shell steps in the same job, so the artifacts
  and registry publish are not dependent on the agent following multi-step instructions.

- **Fire-and-forget Batch**: A full headless generation can run for many minutes, exceeding
  the Lambda/AgentCore invocation window. The tool returns the Batch job id immediately and
  the UI polls `check_publish`, which reconciles the Batch job state into status.json.

- **Prompt safety through the container's eval**: The Batch entrypoint `eval`s the command
  string, so user-controlled text (requirements, description) is base64-encoded in the
  submitted command and decoded inside the job; source URLs are validated against an
  allowlist pattern before interpolation.

- **One Bedrock call**: extract params from the natural-language request. Generation itself
  consumes ATX Agent Minutes instead of Bedrock tokens.

### CSV Batch
```
UI builds one prompt per row → sequential orchestrate() calls
Each row: submit → poll → extract job_id → add to Jobs tab
Rows with transformation specified: direct execute
Rows without transformation: orchestrator follows find → create → execute chain
  → find_transform_agent searches catalog
  → If no match: create_transform_agent generates + publishes custom transform
  → execute_transform_agent runs the transformation
```

### Metrics
```
UI Metrics tab → /orchestrate (direct, op: metrics) → Lambda metrics.py
  → CloudWatch ListMetrics + GetMetricData on AWS/TransformCustom namespace
  → Aggregates totals, byTransformation, byRepository, per-execution detail
  → Batch ListJobs for job-status counts
No AI/AgentCore involved — deterministic CloudWatch query. Ported from
scaled-execution-containers get_metrics.py. The dashboard (Chart.js) reads
type=all + type=transform_detail and derives execution status from the
TransformationExecutionCompleted metric (not the raw ExecutionStatus dimension).

Limitation — ~14-day window: metrics.py discovers which metrics/dimensions exist
via cloudwatch:ListMetrics, which only returns metrics that published data in the
last ~2 weeks. So the dashboard reflects only ~the last 14 days of activity
regardless of the selected range, and shows empty if nothing has run recently
(the underlying data points persist in CloudWatch but aren't rediscovered). The UI
range selector is capped at 14 days for this reason. Longer historical lookback
would require discovering metrics another way (e.g. cached dimension sets,
CloudWatch Metrics Insights, or a per-run metrics snapshot in DynamoDB/S3).
```

### Knowledge Items
```
UI Knowledge tab → /orchestrate (direct, op: knowledge_items) → Lambda knowledge_items.py
  Read (cache):   kiAction=get      → S3 cache (instant)
  Refresh:        kiAction=submit   → Batch job (atx custom def list-ki --json)
                  kiAction=poll     → scrape job logs → write S3 cache → return items
  Write:          kiAction=update-ki-status | delete-ki | update-ki-config | export-ki-markdown
                  → Batch job (atx custom def ...)
Knowledge items are generated DISABLED by ATX after a run; the UI lists them
cache-first and only triggers the Batch refresh on an explicit "Pull from registry".
```

### Authentication
```
Secure by default (EnableAuth=true).

UI (Cognito Hosted UI, OAuth2 auth-code + PKCE)
  → user signs in → app exchanges ?code= for an access token (sessionStorage)
  → authedFetch attaches Authorization: Bearer <token> to every /orchestrate call

API Gateway (raw ApiGatewayV2 + Cognito JWT authorizer)
  → EnableAuth=true: /orchestrate route requires a valid Cognito JWT; rejects
    unauthenticated/invalid tokens with 401 at the edge (Lambda not invoked)
  → EnableAuth=false: route is open (AuthorizationType NONE) for blog/demo mode

async_invoke_agent Lambda (auth.py) — defense-in-depth
  → trusts gateway-validated claims when present; otherwise re-verifies the JWT
    (JWKS signature, issuer, audience, expiry, token_use, client_id)
  → internal async self-invokes and CORS preflight bypass the gate

Note: raw ApiGatewayV2 resources are used (not SAM's HttpApi `Auth` shorthand) so
the JWT authorizer can be attached conditionally via !If on EnableAuth.
```

## Components

| Component | Path | Purpose |
|-----------|------|---------|
| Orchestrator | `orchestrator/agent.py` | AgentCore agent with 3 sub-agents |
| Find tool | `orchestrator/tools/findtransform.py` | Catalog search + custom listing |
| Execute tool | `orchestrator/tools/executetransform.py` | Batch submit + status + results |
| Create tool | `orchestrator/tools/createtransform.py` | Analyze source, generate definition, publish |
| Memory | `orchestrator/tools/memory_*.py` | AgentCore short-term memory |
| Async Lambda | `api/lambda/async_invoke_agent.py` | Submit/poll/direct bridge |
| Metrics | `api/lambda/metrics.py` | CloudWatch AWS/TransformCustom metrics (direct op) |
| Knowledge Items | `api/lambda/knowledge_items.py` | List/enable/disable/delete/export KIs (direct op) |
| Auth | `api/lambda/auth.py` | Cognito JWT verification (secure-by-default, fails closed) |
| UI | `ui/src/` | React app (8 tabs) |
| Infrastructure | `cdk/` | Batch, S3, VPC, CloudFront, AgentCore |
| SAM Layer | `sam/` | AgentCore deploy Lambda + API (Option A) |
| Container | `../scaled-execution-containers/container/` | ATX CLI Docker image (shared) |

## AWS Services

| Service | Purpose |
|---------|---------|
| Bedrock AgentCore | Orchestrator runtime |
| Bedrock (Claude Sonnet 4) | AI reasoning + YAML generation |
| AgentCore Memory | Conversation context |
| AWS Batch (Fargate) | ATX CLI execution |
| S3 | Definitions, repo snapshots, results, UI hosting, orchestrator results, job tracking |
| CloudFront | UI CDN |
| API Gateway v2 (HTTP) | Single /orchestrate endpoint |
| Lambda | Async bridge (submit/poll/direct) |
| DynamoDB | Job tracking (persisted across sessions) |
| Cognito (User Pool) | UI authentication — JWT verified in Lambda (when EnableAuth=true) |

## Project Structure

```
├── orchestrator/               # AgentCore orchestrator
│   ├── agent.py                # Main agent (3 sub-agents)
│   ├── tools/                  # find, execute, create, memory
│   ├── Dockerfile              # Container image for CDK deployment
│   └── requirements.txt
├── api/lambda/                 # Async bridge Lambda
│   ├── async_invoke_agent.py
│   ├── auth.py                 # Cognito JWT verification (secure by default)
│   ├── metrics.py              # CloudWatch metrics (op: metrics)
│   ├── knowledge_items.py      # Knowledge items (op: knowledge_items)
│   └── tests/                  # unittest suite (auth enforcement, no open endpoints)
├── ui/                         # React frontend (8 tabs)
│   └── src/components/         # TransformationList, Form, CreateCustom, CsvUpload, JobTracker, Metrics, KnowledgeItems, Chat
├── cdk/                        # CDK stacks (Container, Infrastructure, AgentCore, UI)
│   └── lib/
│       ├── container-stack.ts      # ECR + Docker image (builds from ../../../scaled-execution-containers/container/)
│       ├── infrastructure-stack.ts # Batch, S3, VPC, IAM
│       ├── agentcore-stack.ts      # AgentCore + Lambda + API (Option B, experimental)
│       └── ui-stack.ts             # S3 + CloudFront
├── sam/                        # SAM template for AgentCore + API (Option A)
│   ├── template.yaml
│   ├── deploy_agentcore.py
│   └── deploy.sh
├── deployment/                 # Configuration template (config.env.template) consumed by sam/cdk/orchestrator
└── docs/                       # Security + troubleshooting

# Shared with scaled-execution-containers/
# - container/  (ATX CLI Dockerfile and helper scripts)
```
