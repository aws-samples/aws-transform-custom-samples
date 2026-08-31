---
name: azure-devops-pipelines-migration
description: >-
  Transforms Azure DevOps Pipelines (azure-pipelines.yml and template files) into the
  target CI/CD chosen at run time - GitHub Actions workflows, or AWS CodePipeline with
  CodeBuild buildspecs. Converts triggers, stages, jobs, steps, matrices, conditions and
  the common task catalog; scaffolds what depends on values that live in Azure DevOps
  (variable groups, service connections, environments); and reports every construct with
  no counterpart (classic GUI pipelines, task groups, gates, Boards integration).
  Trigger: Azure DevOps migration, azure-pipelines.yml, ADO to GitHub Actions,
  Azure Pipelines to CodePipeline, VSTS, TFS pipelines, CI/CD migration.
type: custom
version: 0.1.0
---

# Azure DevOps Pipelines Migration (to GitHub Actions or AWS CodePipeline)

## Objective

Convert the CI/CD definition an Azure DevOps repository **does** carry - the YAML pipeline
files - into the target platform, and report precisely what the pipeline consumes that lives
**outside the repository** (variable groups, service connections, environment approvals,
agent pools), because those are exactly the pieces that make a converted pipeline fail on
first run in ways that look like conversion bugs.

## One definition, two targets

The target is resolved in Phase 0 from `additionalPlanContext`:

| `target:` value | Output |
|---|---|
| `github-actions` (default) | One workflow file per pipeline under `cicd-migration/github-actions/` |
| `codepipeline` | A CloudFormation template for the pipeline plus one CodeBuild buildspec per job under `cicd-migration/codepipeline/` |

The discovery, inventory and classification phases are identical; only the emission phase
differs. Mapping tables: `references/01-tasks-and-variables.md` (shared catalog + GitHub
Actions target), `references/02-codepipeline-target.md` (CodePipeline emission rules).

## Scope

### MECHANICAL - converted

| Azure Pipelines construct | GitHub Actions | CodePipeline / CodeBuild |
|---|---|---|
| `trigger` (branches/paths) | `on.push.branches` / `paths` | pipeline source trigger + EventBridge note |
| `pr` | `on.pull_request` | report note (PR builds are a CodeBuild webhook filter) |
| `schedules` (cron) | `on.schedule` | EventBridge Scheduler rule in the template |
| `stages` / `dependsOn` | `jobs` + `needs` | pipeline `Stages` in declared order |
| `jobs` / `steps` | `jobs.<id>.steps` | one CodeBuild project + buildspec per job |
| `script` / `Bash@3` / `pwsh` | `run` with the right `shell` | buildspec `commands` |
| `pool.vmImage` | `runs-on` (ubuntu/windows/macos map) | CodeBuild image + `Type` (macOS unsupported: report) |
| Common task catalog (UseDotNet@2, DotNetCoreCLI@2, NodeTool@0, UsePythonVersion@0, Docker@2, ArchiveFiles@2, CopyFiles@2, PublishBuildArtifacts@1, DownloadBuildArtifacts@0, PublishTestResults@2) | setup-* actions / upload-download-artifact / run equivalents | buildspec phases + artifacts section |
| Inline `variables` | `env` | buildspec `env.variables` |
| Predefined variables (`$(Build.SourcesDirectory)`, `$(Build.BuildId)`, `$(Build.SourceBranchName)`, ...) | `${{ github.workspace }}`, `${{ github.run_id }}`, `${{ github.ref_name }}`, ... (full table in reference 01) | `CODEBUILD_SRC_DIR`, `CODEBUILD_BUILD_ID`, ... |
| `condition:` (succeeded/failed/always, `eq`/`ne` on variables) | `if:` expression | buildspec guard or stage condition, with a report note when semantics narrow |
| `strategy.matrix` | `strategy.matrix` | one project per matrix leg + report note |
| `timeoutInMinutes` / `continueOnError` | `timeout-minutes` / `continue-on-error` | project `TimeoutInMinutes` / report note |

### SCAFFOLD - emitted incomplete, clearly marked

1. **Variable groups (`variables: - group:`).** The VALUES live in the Azure DevOps Library
   and cannot be read from the repository. Emit the reference as `secrets.<NAME>` /
   Secrets Manager reference with `TODO(migration)` per variable group, and a report entry
   listing every consuming job. Never invent a value.
2. **Service connections** (AzureRM, AWS, container registries). Emit the OIDC skeleton
   (`aws-actions/configure-aws-credentials` with `role-to-assume: TODO(migration)`, or the
   CodeBuild service role placeholder) plus a report entry naming the connection.
3. **Environments + approvals.** GitHub `environment:` emitted on the job; the protection
   rules are repository SETTINGS, not YAML - report entry with the exact settings to create.
   CodePipeline: a manual approval action inserted where the environment gate was.
4. **Deployment jobs** (`deployment:` with runOnce/rolling/canary). Converted as a plain job
   plus a report entry: neither target has native in-YAML deployment strategies.
5. **Pipeline templates** (`extends`, `template:` includes with parameters). GitHub target:
   reusable workflow (`workflow_call`) skeleton with the parameter names carried over.

### REPORT-ONLY - never transformed

| Construct | Why |
|---|---|
| Classic (GUI) pipelines | Not in the repository; the report gives the export guidance |
| Marketplace tasks with no cataloged equivalent (e.g. `SnykSecurityScan@1`) | Vendor actions exist but version/config parity is a decision - named per occurrence with the closest candidate |
| Task groups, gates, manual intervention tasks | Live in Azure DevOps, not in YAML |
| `self-hosted` agent pools | Runner/fleet provisioning is infrastructure, not conversion |
| Azure Artifacts feeds | Feed migration (CodeArtifact / GitHub Packages) is its own project |
| Boards/work-item integration, service hooks | Platform features outside the pipeline |
| Any `task:` not in the catalog | Degrade to report-only with the raw inputs quoted - never guess an action name |

## Constraints

- **Additive, and that includes files at the repository root.** Originals untouched; ALL
  output under `cicd-migration/`. **`MIGRATION_REPORT.md` goes at the repository ROOT** -
  the only file allowed there. GitHub Actions workflows only run from `.github/workflows/`,
  and that is exactly why they are NOT emitted there: writing into `.github/` mutates the
  source tree and can collide with existing workflows. The report instructs the operator to
  move them - a safe artifact plus an instruction beats a mutation.
- **Never invent a secret value, a role ARN, an account id, a registry URL or a
  subscription id.** `TODO(migration)` + report entry, every time.
- **Every emitted workflow/buildspec names its source** (comment header
  `migrated-from: azure-pipelines.yml#<stage>/<job>`).
- **The manual-action section of the report is named exactly `## Manual Action Items`.**
- **No em dash (U+2014) anywhere in emitted output** - use a hyphen.
- Stay on the current branch; do not commit.

## Workflow

```text
Phase 0  Read additionalPlanContext: target (github-actions | codepipeline, default
         github-actions), plus optional default_branch and aws_region (codepipeline).
Phase 1  Discovery. Find every pipeline YAML (azure-pipelines*.yml, *.yml with the
         trigger/stages/jobs top-level shape, template files referenced by them).
         Inventory EVERY construct present AND the external dependencies consumed
         (variable groups, service connections, environments, pools). Classify
         MECHANICAL / SCAFFOLD / REPORT-ONLY.
Phase 2  Convert the MECHANICAL set for the resolved target.
Phase 3  Emit scaffolds (variable-group references, OIDC skeleton, environments,
         reusable-workflow skeletons for templates).
Phase 4  Validate: YAML parses; GitHub target - every job has runs-on and at least one
         step, every uses: pins a major version, zero $(...) Azure macro syntax survives;
         CodePipeline target - the CloudFormation template passes a structural lint
         (Resources present, every stage has actions) and every buildspec has phases.
Phase 5  MIGRATION_REPORT.md at the root: full inventory (present and absent), external
         dependency table (variable groups, connections, environments), per-construct
         classification, Manual Action Items, TODO(migration) cross-reference.
```

## Exit Criteria

1. Every pipeline YAML and template in the repository appears in the inventory with a
   classification per construct.
2. Originals byte-identical. All output under `cicd-migration/`; `MIGRATION_REPORT.md` at
   the repository root; no other file created or modified at the root.
3. Zero Azure Pipelines macro syntax (`$(Var)`) and zero `task:` keys survive in emitted
   output - each is either converted or quoted inside a report entry.
4. Every variable group, service connection and environment consumed by the pipeline has a
   report entry and, where referenced in output, a `TODO(migration)`.
5. Emitted YAML parses. GitHub target: every job has `runs-on`; every `uses:` carries a
   version. CodePipeline target: template lints, every buildspec has `phases`.
6. Every `TODO(migration)` has an entry in Manual Action Items, and vice versa.
7. The report states which target was resolved and why (explicit vs default).

## Non-Goals

1. Migrating repository hosting, branch policies, Boards, Artifacts feeds or wikis.
2. Provisioning runners, CodeBuild fleets or IAM roles - scaffolds and instructions only.
3. Classic (GUI) pipeline conversion - export guidance in the report.
4. Executing the migration or registering anything in GitHub/AWS.
