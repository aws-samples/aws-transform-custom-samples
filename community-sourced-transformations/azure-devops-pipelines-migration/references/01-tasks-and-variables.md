# Tasks, Variables and the GitHub Actions Target

The shared catalog (used by both targets) plus the GitHub Actions emission rules. The rule
that governs everything: **a `task:` not in this catalog degrades to report-only with its raw
inputs quoted - never guess an action name.**

## 1. Task catalog

| Azure task | GitHub Actions | Notes |
|---|---|---|
| `UseDotNet@2` | `actions/setup-dotnet@v4` | `version` → `dotnet-version` |
| `DotNetCoreCLI@2` | `run: dotnet <command>` | `projects` glob expands into the command; `publishWebProjects`/`zipAfterPublish` become explicit flags |
| `NodeTool@0` | `actions/setup-node@v4` | `versionSpec` → `node-version` |
| `UsePythonVersion@0` | `actions/setup-python@v5` | `versionSpec` → `python-version` |
| `Bash@3` | `run:` with `shell: bash` | `targetType: inline` → the script block; `filePath` → `run: ./<path>` |
| `PowerShell@2` / `pwsh` | `run:` with `shell: pwsh` | |
| `CmdLine@2` | `run:` | |
| `Docker@2` | `run: docker build/push` or `docker/build-push-action@v6` | registry login is a service connection → SCAFFOLD |
| `ArchiveFiles@2` | `run: zip -r ...` | `rootFolderOrFile` / `archiveFile` mapped into the command |
| `CopyFiles@2` | `run: cp -r ...` | |
| `PublishBuildArtifacts@1` / `PublishPipelineArtifact@1` | `actions/upload-artifact@v4` | `ArtifactName` → `name`, `PathtoPublish` → `path` |
| `DownloadBuildArtifacts@0` / `DownloadPipelineArtifact@2` | `actions/download-artifact@v4` | |
| `PublishTestResults@2` | report note + `if: always()` upload of the results file | GitHub has no native test-report ingestion; the report names the marketplace candidates |
| `checkout: self` | `actions/checkout@v4` | `submodules`, `fetchDepth` → same-named inputs |

## 2. Predefined variables

| Azure macro | GitHub Actions | CodeBuild |
|---|---|---|
| `$(Build.SourcesDirectory)` / `$(System.DefaultWorkingDirectory)` | `${{ github.workspace }}` | `$CODEBUILD_SRC_DIR` |
| `$(Build.BuildId)` | `${{ github.run_id }}` | `$CODEBUILD_BUILD_ID` |
| `$(Build.BuildNumber)` | `${{ github.run_number }}` | `$CODEBUILD_BUILD_NUMBER` |
| `$(Build.SourceBranchName)` | `${{ github.ref_name }}` | `$CODEBUILD_WEBHOOK_HEAD_REF` (trimmed) + note |
| `$(Build.SourceVersion)` | `${{ github.sha }}` | `$CODEBUILD_RESOLVED_SOURCE_VERSION` |
| `$(Build.Repository.Name)` | `${{ github.repository }}` | report note |
| `$(Build.ArtifactStagingDirectory)` | a job-local `mkdir` (e.g. `${{ runner.temp }}/staging`) | `artifacts.base-directory` |
| `$(Agent.OS)` | `${{ runner.os }}` | report note |
| `$(Build.Reason)` | `${{ github.event_name }}` with a mapping note (`Schedule` → `schedule`, `PullRequest` → `pull_request`, `IndividualCI` → `push`) | `$CODEBUILD_INITIATOR` + note |
| User variable `$(name)` | `${{ env.name }}` (inline) or `${{ secrets.NAME }}` / `${{ vars.NAME }}` (variable group → SCAFFOLD) | `env.variables` / Secrets Manager reference |

## 3. Pools

| `vmImage` | `runs-on` | CodeBuild |
|---|---|---|
| `ubuntu-latest` / `ubuntu-*` | same string | `aws/codebuild/standard:7.0` (Linux) |
| `windows-latest` / `windows-*` | same string | `aws/codebuild/windows-base:2019-3.0` + report note |
| `macOS-*` | same string | REPORT-ONLY (no CodeBuild macOS in most regions) |
| `pool: name:` (self-hosted) | `runs-on: [self-hosted]` + report entry | REPORT-ONLY (fleet provisioning) |

## 4. Conditions

| Azure | GitHub Actions |
|---|---|
| `succeeded()` (default) | omitted (`if: success()` is the default) |
| `always()` | `if: always()` |
| `failed()` | `if: failure()` |
| `eq(variables['X'], 'y')` / `ne(...)` | `if: env.X == 'y'` / `!=` |
| `ne(variables['Build.Reason'], 'Schedule')` | `if: github.event_name != 'schedule'` |
| Compound `and()`/`or()` | `&&` / `||`, converted recursively |
| Anything referencing stage-level `dependencies.*.outputs` | SCAFFOLD: `needs.<job>.outputs` requires the producing step to declare the output - both sides emitted with `TODO(migration)` |

## 5. Structure mapping (GitHub Actions target)

- One Azure **pipeline file** → one workflow file, kebab-cased from the pipeline file name
  (`azure-pipelines.yml` → `ci.yml`; `azure-pipelines-release.yml` → `release.yml`).
- **Stages flatten into jobs.** A stage's `dependsOn` becomes `needs` on every job of the
  stage. Stage-level `condition` is ANDed into each job's `if`.
- Job ids keep the Azure `job` name, kebab-cased; `displayName` → `name`.
- Every workflow starts with the provenance header comment:
  `# migrated-from: <pipeline file>#<stage>` and carries `permissions: contents: read`
  (least privilege by default; widened only when a converted step needs more, with a report
  entry).

## 6. Validation greps (Phase 4)

```bash
# zero Azure macro syntax in emitted output
grep -rE '\$\((Build|System|Agent|Pipeline)\.' cicd-migration/ && exit 1

# zero unconverted task keys
grep -rE '^\s*-?\s*task:' cicd-migration/ && exit 1

# every uses: pinned to a major version
grep -rE 'uses:.*@' cicd-migration/github-actions/ | grep -vE '@v[0-9]+' && exit 1
```
