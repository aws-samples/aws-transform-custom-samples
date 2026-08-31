# Azure DevOps Pipelines Migration (to GitHub Actions or AWS CodePipeline)

Transforms Azure DevOps Pipelines (`azure-pipelines.yml` and template files) into the target CI/CD chosen at run time - **GitHub Actions workflows**, or **AWS CodePipeline with CodeBuild buildspecs**. Converts triggers, stages, jobs, steps, matrices, conditions and the common task catalog; scaffolds what depends on values that live in Azure DevOps (variable groups, service connections, environments); and reports every construct with no counterpart.

**Additive by design: the original files are never modified. Output lands under `cicd-migration/`.**

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [One Definition, Two Targets](#one-definition-two-targets)
- [What This Skill Does](#what-this-skill-does)
- [Getting Started](#getting-started)
- [Benchmarks](#benchmarks)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Repository Structure](#repository-structure)

## Overview

An Azure DevOps pipeline is only partly in the repository. The YAML carries the structure -
triggers, stages, jobs, steps, conditions - but the pipeline also consumes **variable groups**
(values in the Azure DevOps Library), **service connections** (credentials), **environments**
(approval gates) and **agent pools**, none of which exist in the repo. A conversion that
ignores that split produces workflows that are syntactically perfect and fail on first run in
ways that look like conversion bugs.

This transformation converts what maps mechanically, scaffolds every external dependency with
an explicit `TODO(migration)`, and reports what has no counterpart - each construct classified
in advance, not decided per run.

## The Problem

Three failure modes make a hand migration expensive:

1. **`$(Build.SourcesDirectory)` and friends are macro syntax the target never expands.** A
   missed predefined variable survives as a literal string and breaks paths at runtime, not
   at parse time.
2. **A variable group reference looks like a normal variable.** `variables: - group: X` pulls
   values from the Azure DevOps Library; converting it as an empty env var makes the job run
   with blanks - nothing fails until the deploy step.
3. **Stage `condition:` semantics narrow in translation.** `ne(variables['Build.Reason'],
   'Schedule')` has an equivalent (`github.event_name != 'schedule'`), but expressions over
   stage dependencies and output variables do not map one-to-one - converting them silently
   changes when jobs run.

## One Definition, Two Targets

The target is resolved from `additionalPlanContext` at run time:

| `target:` | Output |
|---|---|
| `github-actions` (default) | One workflow per pipeline under `cicd-migration/github-actions/` |
| `codepipeline` | A CloudFormation template (pipeline + one CodeBuild project per job) and one buildspec per job under `cicd-migration/codepipeline/` |

Discovery, inventory and classification are shared; only the emission phase differs.

## What This Skill Does

| Phase | Action |
|---|---|
| 0 | Reads `additionalPlanContext`: `target`, optional `default_branch` and `aws_region` |
| 1 | Finds every pipeline YAML and referenced template; inventories every construct AND every external dependency (variable groups, service connections, environments, pools); classifies **MECHANICAL / SCAFFOLD / REPORT-ONLY** |
| 2 | Converts the mechanical set: triggers, schedules, stages→jobs (`needs`), steps, the common task catalog, predefined variables, conditions, matrices |
| 3 | Emits scaffolds: variable-group references as secrets with `TODO(migration)`, OIDC credential skeletons for service connections, environment gates, reusable-workflow skeletons for templates |
| 4 | Validates: YAML parses, zero `$(...)` macro syntax and zero `task:` keys survive, every `uses:` pinned, buildspecs have `phases`, the CloudFormation template lints |
| 5 | Writes `MIGRATION_REPORT.md` at the repository root: inventory, external-dependency table, `## Manual Action Items`, TODO cross-reference |

Every emitted file carries a provenance header (`migrated-from: azure-pipelines.yml#<stage>/<job>`).

## Getting Started

```bash
atx custom def exec -n azure-devops-pipelines-migration -p . -x -t \
  --configuration file://config.json --limit 70
```

```json
{"additionalPlanContext": "target: github-actions"}
```

Use `--configuration file://` - a comma inside an inline `key=value` breaks the CLI parser.
Assert the artifact count after every run: a low `--limit` truncates the bundle silently.

## Benchmarks

Full evidence in [`BENCHMARKS.md`](BENCHMARKS.md): executed end-to-end via
`atx custom def exec` against a real production repository with a multi-stage pipeline
(variable group, cron schedule, mixed ubuntu/windows pools, marketplace task, stage
conditions), on **both targets**, with source integrity, macro-syntax and pinning assertions
per run.

## Known Limitations

- **Classic (GUI) pipelines are not in the repository** - the report gives export guidance.
- **Variable group VALUES cannot be read** - only the names are known; every value is a
  `TODO(migration)`.
- **Marketplace tasks without a cataloged equivalent** degrade to report-only with the raw
  inputs quoted (e.g. third-party security scanners).
- **Deployment strategies** (`runOnce`/`rolling`/`canary`) have no native equivalent in
  either target - converted as plain jobs with a report entry.
- **CodePipeline stages are strictly sequential** - parallel Azure stages become parallel
  actions inside one stage, noted in the report.
- **macOS pools** are report-only on the CodePipeline target.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid configuration format` before the run starts | A comma inside an inline `--configuration key=value` | Use `--configuration file://config.json` |
| Run completes but fewer artifacts than expected | Low `--limit` truncates the bundle silently | Re-run with `--limit 70`; always assert the artifact count |
| Converted workflow fails with a literal `$(Build...)` string | A predefined variable outside the catalog survived | Check the report's macro table; file the gap - the validation grep in Phase 4 should have caught it |
| Job runs with empty variable values | Variable group values live in Azure DevOps and were emitted as `TODO(migration)` secrets | Create the secrets/Secrets Manager entries listed in Manual Action Items before running |
| Workflow not triggering in GitHub | Files were emitted under `cicd-migration/github-actions/`, not `.github/workflows/` (additive contract) | Move them as instructed in the report after review |
| CloudFormation deploy fails on the CodeBuild role | `ServiceRole` is a `TODO(migration)` placeholder by design | Create the role with the policy sketched in the report |

## Repository Structure

```text
azure-devops-pipelines-migration/
├── README.md                             # this file
├── SKILL.md                              # orchestration spine (discovery → convert → scaffold → validate → report)
├── BENCHMARKS.md                         # validation evidence, both targets
└── references/
    ├── 01-tasks-and-variables.md         # task catalog, predefined variables, pools, conditions, GHA emission
    └── 02-codepipeline-target.md         # CodePipeline/CodeBuild emission rules + template lint
```
