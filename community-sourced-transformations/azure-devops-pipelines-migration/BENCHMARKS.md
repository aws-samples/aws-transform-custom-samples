# Benchmark Results - Azure DevOps Pipelines Migration

## Executive Summary

| Metric | Result |
|--------|--------|
| Repository tested | `OfqualGovUK/ofqual-register-api` (real production repo, pinned) |
| Targets exercised | **both** - `github-actions` and `codepipeline`, same repo, same baseline |
| Transformation success rate | **2/2 COMPLETE** |
| **Source integrity** | **0 files modified outside `cicd-migration/` and the report, in both runs** |
| Azure macro syntax (`$(Build...)`) surviving in output | **0** in both runs |
| `task:` keys surviving in output | **0** in both runs |
| Unpinned `uses:` (GitHub target) | **0** |
| CloudFormation template lint (codepipeline target) | PASS - 4 stages (Source, StaticAnalysis, RunTests, BuildAndPackage), 4 CodeBuild projects, every stage has actions |
| Buildspecs with `phases` | 4/4 |
| Invented values (secrets, ARNs, account ids) | 0 - every external value is `TODO(migration)` |
| Report at root with `## Manual Action Items` | 2/2 (name pinned by the contract) |
| Em dash (U+2014) in emitted output | 0 (forbidden by the contract) |
| Agent minutes | 88.59 (44.61 + 43.98) |
| Estimated cost | ~US$ 3.10 (at US$ 0.035 / agent minute) |

### Methodology

The fixture is a **real production repository**, not a hand-written one, pinned:

| Repo | Licence | Commit |
|---|---|---|
| `OfqualGovUK/ofqual-register-api` | not declared in-repo (used for validation only) | `ea4df609e4ab3c812028798fdfdf6aeec4495269` |

It was chosen because its single `azure-pipelines.yml` exercises the constructs that break
naive conversions: a **variable group** (`Register-API-Dev-Variables` - values live in the
Azure DevOps Library), a **cron schedule** targeting a branch (a semantic GitHub Actions does
not have), **mixed pools** (ubuntu and windows), a **marketplace task with no cataloged
equivalent** (`SnykSecurityScan@1`), **multi-stage with `dependsOn`** and **stage/job
conditions** over `Build.Reason`.

Each run: commit baseline, then

```bash
atx custom def exec -n azure-devops-pipelines-migration -p . -x -t \
  --configuration file://cfg.json --limit 70
```

with `additionalPlanContext` carrying `target: github-actions` and `target: codepipeline`
respectively. Assertions are invariants (`assert_def_run.py` with
`OUT_DIR=cicd-migration`, plus the Phase 4 greps and the CloudFormation structural lint).

## At-a-Glance Results

| # | Target | Status | Files emitted | Source changed | Macros | Tasks | Agent Min | Cost |
|---|---|---|---|---|---|---|---|---|
| 1 | `github-actions` | COMPLETE | 1 workflow (`ci.yml`) | **0** | 0 | 0 | 44.61 | $1.56 |
| 2 | `codepipeline` | COMPLETE | 1 CFN template + 4 buildspecs | **0** | 0 | 0 | 43.98 | $1.54 |
| | **TOTALS** | **2/2** | **6** | **0** | **0** | **0** | **88.59** | **$3.10** |

## What the conversion got right (spot-checked)

1. **Variable group degraded correctly.** The GitHub workflow references the group as a
   `TODO(migration)` block that NAMES the two variables the pipeline actually consumes
   (`SNYK_ENDPOINT`, `SNYK_TOKEN`, discovered from the steps) and states that the rest of the
   group is unknowable from the repository. No invented value.
2. **Schedule semantics flagged, not silently changed.** Azure cron targeted the `master`
   branch; the emitted `on.schedule` carries a comment stating GitHub always runs schedules
   on the default branch.
3. **Conditions converted:** `ne(variables['Build.Reason'], 'Schedule')` became
   `if: github.event_name != 'schedule'` at the right jobs.
4. **Marketplace task degraded:** `SnykSecurityScan@1` is report-only with its raw inputs
   quoted and the closest candidate action named - not guessed.
5. **CodePipeline sequential-stage constraint respected:** Azure stage order preserved as
   Source → StaticAnalysis → RunTests → BuildAndPackage, one CodeBuild project per job,
   artifacts wired between stages.

## Exit Criteria Compliance (per SKILL.md)

| # | Exit criterion | github-actions | codepipeline |
|---|---|---|---|
| 1 | Every pipeline YAML in the inventory with per-construct classification | PASS | PASS |
| 2 | Originals byte-identical; output under `cicd-migration/`; report at root; nothing else at root | PASS | PASS |
| 3 | Zero `$(...)` macros and zero `task:` keys in output | PASS | PASS |
| 4 | Every variable group / service connection / environment has a report entry + TODO where referenced | PASS (6 TODOs paired) | PASS |
| 5 | YAML parses; `runs-on` + pinned `uses:` / CFN lints + buildspecs have `phases` | PASS | PASS |
| 6 | TODO(migration) paired with Manual Action Items, and vice versa | PASS | PASS |
| 7 | Report states the resolved target and why | PASS (explicit) | PASS (explicit) |

## Tooling note found while validating

Plain `yaml.safe_load` REJECTS a correct CloudFormation template: the short-form intrinsics
(`!Ref`, `!Sub`, `!GetAtt`) are valid YAML with custom tags the default loader does not know.
The validation lint registers a no-op multi-constructor for `!` before parsing - the same
family of false positive as Helm templates under a plain YAML parser.
