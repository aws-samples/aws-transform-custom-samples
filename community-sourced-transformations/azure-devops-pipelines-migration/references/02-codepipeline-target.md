# CodePipeline Target - Emission Rules

Selected with `additionalPlanContext: "target: codepipeline"`. Discovery and classification
are identical to the GitHub Actions target; this reference covers only what is emitted.

## Output layout

```text
cicd-migration/codepipeline/
├── pipeline.yaml            # CloudFormation: the CodePipeline + one CodeBuild project per job
└── buildspecs/
    └── <stage>-<job>.yml    # one buildspec per Azure job
```

## Structure mapping

| Azure construct | CodePipeline emission |
|---|---|
| Pipeline | one `AWS::CodePipeline::Pipeline` resource |
| `stages` (ordered by `dependsOn`) | pipeline `Stages`, topologically sorted - CodePipeline stages are strictly sequential, so parallel Azure stages become parallel ACTIONS inside one stage, with a report note |
| `job` | one `AWS::CodeBuild::Project` + one buildspec |
| `steps` | buildspec `phases.build.commands` (setup tasks land in `phases.install`) |
| `trigger` branches | the pipeline source action's branch config; extra branches → report note (one pipeline per branch or a trigger filter) |
| `schedules` cron | `AWS::Scheduler::Schedule` targeting the pipeline, cron translated (Azure cron is 5-field UTC; EventBridge is 6-field - the conversion appends `?`/year and states the assumption) |
| `pr:` | report note: PR validation in CodeBuild is a webhook `FILTER_GROUPS` config on the project, emitted commented |
| environment approvals | a Manual Approval action inserted before the deploy stage |
| `strategy.matrix` | one CodeBuild project per matrix leg, suffixed with the leg name |

## Buildspec shape

```yaml
# migrated-from: azure-pipelines.yml#BuildAndPackage/Build
version: 0.2
env:
  variables:
    dotnetVersion: "8.x"        # from inline variables
  secrets-manager: {}            # variable groups land here as TODO(migration) entries
phases:
  install:
    commands:
      - echo "setup tasks (UseDotNet@2 -> runtime image or install commands)"
  build:
    commands:
      - dotnet restore
      - dotnet build --configuration Release
artifacts:
  base-directory: out            # from Build.ArtifactStagingDirectory usage
  files: ["**/*"]
```

Rules:

- Setup tasks (`UseDotNet@2`, `NodeTool@0`, `UsePythonVersion@0`) prefer selecting a CodeBuild
  image that ships the runtime; when the version is not in any standard image, emit install
  commands with a report note.
- `PublishBuildArtifacts@1` → the buildspec `artifacts` section + pipeline artifact wiring
  between stages (`InputArtifacts`/`OutputArtifacts`).
- Variable groups → `env.secrets-manager` keys with `TODO(migration): create the secret and
  set the ARN` - never a fabricated ARN.
- Service connections → the CodeBuild project `ServiceRole` placeholder
  `TODO(migration): role ARN` plus a report entry describing the minimum policy.
- Windows jobs get `Type: WINDOWS_SERVER_2019_CONTAINER` and a report note on image parity;
  macOS jobs are REPORT-ONLY.

## Template lint (Phase 4, codepipeline target)

```bash
python3 - <<'PY'
import yaml, sys
# CloudFormation short-form (!Ref, !Sub) is valid YAML with custom tags - register a
# no-op constructor, plain safe_load would reject a correct template.
class L(yaml.SafeLoader): pass
L.add_multi_constructor("!", lambda l, s, n: None)
t = yaml.load(open("cicd-migration/codepipeline/pipeline.yaml"), Loader=L)
assert "Resources" in t, "no Resources"
pipes = [r for r in t["Resources"].values() if r.get("Type") == "AWS::CodePipeline::Pipeline"]
assert pipes, "no pipeline resource"
for p in pipes:
    for s in p["Properties"]["Stages"]:
        assert s.get("Actions"), f"stage {s.get('Name')} has no actions"
PY
```

Every buildspec must parse and contain `phases`; every `secrets-manager` value that is not a
real ARN must carry `TODO(migration)` on the same line.
