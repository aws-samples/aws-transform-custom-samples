# ATX Transform Platform - Architecture

## Overview

AI-powered code transformation platform built on Amazon Bedrock AgentCore and AWS Transform CLI. All operations flow through a single orchestrator agent that coordinates specialized sub-agents.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  UI (React + CloudFront)                                     │
│  Tabs: Transformations | Execute | Create Custom | CSV Batch | Jobs │
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
│      ├── upload_repo_to_s3 → Batch clone + S3 sync           │
│      ├── list_repo_files → S3 list (file tree)               │
│      ├── read_repo_file → S3 get (individual files)          │
│      ├── generate_transformation_definition → Bedrock + S3   │
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
  Step 2: Upload repo to S3 (if source URL provided)
    → Batch job: git clone → aws s3 sync (full repo) → poll until done
    → Files stored at s3://atx-source-code-{account}/repo-snapshots/{name}/

  Step 3: Smart file selection
    → list_repo_files: S3 list all files with sizes
    → If total source size < 400K chars: read ALL source files (small repo)
    → If total source size >= 400K chars: AI selects most relevant files
      based on transformation requirements (budget-aware file count)

  Step 4: Read selected files from S3 (up to 400K chars / ~100K tokens)
  Step 5: Generate definition (Bedrock with full source code context)
    → Uploads transformation_definition.md to S3
  Step 6: Publish (Batch job: atx custom def publish)
    → status.json written to S3

  Without source repo: skips steps 2-4, generates from requirements only

UI → /orchestrate (direct, list_custom) → Lambda → S3 list
UI → /orchestrate (direct, check_publish) → Lambda → Batch + S3 update
UI → /orchestrate (direct, get_file) → Lambda → S3 get (definition preview)
```

### Design Decisions: Custom Transformation Creation

- **Full repo upload vs summary extraction**: The full repo is uploaded to S3 so the AI can
  selectively read files based on the transformation requirements. This produces higher quality
  definitions than a fixed shell-based summary because the AI chooses what's relevant.

- **Smart file selection**: For small repos (< 400K chars of source code), all files are read
  without an AI selection step — saves one Bedrock call. For large repos, AI picks files with
  a budget-aware max count calculated from average file size vs the 400K context budget.

- **400K character context limit**: ~100K tokens, leaving headroom in Claude Sonnet 4's 200K
  token context window for the system prompt, requirements, and output generation (8K tokens).

- **Direct tool calls vs nested agent**: The create_transform_agent uses direct Bedrock API
  calls and sequential tool invocations instead of a nested Strands agent. This avoids a
  streaming type bug in the Strands SDK and gives more predictable execution.

- **Three Bedrock calls** (with source): extract params → select files (large repos only) → generate definition.
  Two Bedrock calls for small repos (extract params → generate definition).

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

## Components

| Component | Path | Purpose |
|-----------|------|---------|
| Orchestrator | `orchestrator/agent.py` | AgentCore agent with 3 sub-agents |
| Find tool | `orchestrator/tools/findtransform.py` | Catalog search + custom listing |
| Execute tool | `orchestrator/tools/executetransform.py` | Batch submit + status + results |
| Create tool | `orchestrator/tools/createtransform.py` | Analyze source, generate definition, publish |
| Memory | `orchestrator/tools/memory_*.py` | AgentCore short-term memory |
| Async Lambda | `api/lambda/async_invoke_agent.py` | Submit/poll/direct bridge |
| UI | `ui/src/` | React app (5 tabs) |
| Infrastructure | `cdk/` | Batch, S3, VPC, CloudFront, AgentCore |
| SAM Layer | `sam/` | AgentCore deploy Lambda + API (Option A) |
| Container | `container/` | ATX CLI Docker image |

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

## Project Structure

```
├── orchestrator/               # AgentCore orchestrator
│   ├── agent.py                # Main agent (3 sub-agents)
│   ├── tools/                  # find, execute, create, memory
│   ├── Dockerfile              # Container image for CDK deployment
│   └── requirements.txt
├── api/lambda/                 # Async bridge Lambda
│   └── async_invoke_agent.py
├── ui/                         # React frontend (5 tabs)
│   └── src/components/         # TransformationList, Form, CreateCustom, CsvUpload, JobTracker
├── cdk/                        # CDK stacks (Container, Infrastructure, AgentCore, UI)
│   └── lib/
│       ├── container-stack.ts      # ECR + Docker image
│       ├── infrastructure-stack.ts # Batch, S3, VPC, IAM
│       ├── agentcore-stack.ts      # AgentCore + Lambda + API (Option B, experimental)
│       └── ui-stack.ts             # S3 + CloudFront
├── sam/                        # SAM template for AgentCore + API (Option A)
│   ├── template.yaml
│   ├── deploy_agentcore.py
│   └── deploy.sh
├── container/                  # ATX CLI Docker image
├── deployment/                 # Infrastructure scripts + config
└── docs/                       # Security + troubleshooting
```
