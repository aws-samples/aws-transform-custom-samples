# Benchmark Results - Tanzu / Cloud Foundry to Amazon EKS

## Executive Summary

| Metric | Result |
|--------|--------|
| Repositories tested | 2 real upstream Cloud Foundry sample repos, pinned to a commit |
| Rounds | 3 - rounds 1 and 2 found 2 contract defects each, all fixed in `SKILL.md` and re-validated |
| Transformation success rate (round 3) | **2/2 COMPLETE** |
| **Source integrity** | **0 files modified outside `eks/` and the report, in both round-3 runs** |
| Files emitted (round 3) | 5 (`spring-music`) and 5 (`cf-sample-app-nodejs`) |
| `MIGRATION_REPORT.md` at repository ROOT | **2/2** |
| `.dockerignore` under `eks/`, never at the root | **2/2** |
| `## Manual Action Items` as the report section name | **2/2** (the round-2 variance - three names across three runs - is fixed) |
| Em dash (U+2014) in emitted output | **0 in both runs** (the round-2 variance is fixed) |
| `*.openshift.io` surviving in output | 0 in both runs |
| `TODO(migration)` markers in emitted files | 6 and 7, each paired 1:1 with a `## Manual Action Items` row |
| Invented credentials in stubs | 0 |
| `kubectl apply --dry-run=client` | clean in both runs |
| Total agent minutes (round 3) | 84.68 (43.40 + 41.28) |
| Total estimated cost (round 3) | ~US$ 2.96 (at US$ 0.035 / agent minute) |
| Cumulative across 3 rounds | ~264.04 agent minutes, ~US$ 9.24 |

### Methodology

The fixtures are **real public repositories**, not hand-written ones, pinned to a commit so the
result stays reproducible:

| Repo | Language | Commit |
|---|---|---|
| `cloudfoundry-samples/spring-music` | Java 17 / Spring Boot | `8f364e93a29eeb9d17e5682119de617b9fde32f0` |
| `cloudfoundry-samples/cf-sample-app-nodejs` | Node.js | `18cc56ed2f4cda9a987ff09a53724e42e1fa9d96` |

The pair covers the two dominant CF workload shapes: a JVM application (where the `memory` field
carries the HIGH-risk buildpack-derived JVM sizing) and a Node.js application (where the platform
supplied nearly everything, so most findings are about absence).

Each repo was committed as a baseline, then transformed via:

```bash
atx custom def exec -n tanzu-to-eks -p . -x -t \
  --configuration file://cfg.json --limit 70
```

with `additionalPlanContext` carrying `migration_target: eks-standard`,
`build_strategy: buildpacks`, a registry URI and a namespace.

Assertions are **invariants**, not expected findings, because a real repository has no answer key:
source integrity by `git diff` against the baseline, report at the root, no other file created or
modified at the root, zero OpenShift `apiVersion` leakage, YAML validity, `--dry-run=client`, and
`TODO`/report pairing. Validator: `assert_def_run.py`.

---

## At-a-Glance Results (round 3, 2026-08-30, `SKILL.md` v0.2.0)

| # | Repository | Status | Files emitted | Report at root | Root untouched | Source changed | TODOs | Wall clock | Agent Min | Cost |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `spring-music` | COMPLETE | 5 | PASS (11.8 KB) | PASS | **0** | 6 | 8m43s | 43.40 | $1.52 |
| 2 | `cf-sample-app-nodejs` | COMPLETE | 5 | PASS (10.3 KB) | PASS | **0** | 7 | 7m10s | 41.28 | $1.44 |
| | **TOTALS** | **2/2** | **10** | **2/2** | **2/2** | **0** | **13** | **15m53s** | **84.68** | **$2.96** |

Both runs emitted the same 5 files under `eks/`: `deployment.yaml`, `service.yaml`, `ingress.yaml`,
`project.toml`, `.dockerignore`, plus `MIGRATION_REPORT.md` at the repository root.

---

## Round history: 4 defects found, 4 fixed

Each round ran both repos, so every fix is validated on both workload shapes before the next
`SKILL.md` revision.

### Round 1 (2026-08-21, 90.62 agent minutes) to round 2

| # | Round-1 defect | Fix in SKILL.md | Round-2 evidence |
|---|---|---|---|
| 1 | `MIGRATION_REPORT.md` emitted inside `eks/` | "**`MIGRATION_REPORT.md` goes at the repository ROOT**, matching the convention of the other definitions in this collection" | Report at the root in 2/2 runs |
| 2 | `.dockerignore` created/modified at the repository root (`cf-sample-app-nodejs`) | "**Never create or modify a file at the repository root** other than `MIGRATION_REPORT.md`" - emit `eks/.dockerignore` + a report entry saying it must be moved before the first build | `eks/.dockerignore` + move instruction in 2/2 runs; root byte-identical |

An incidental defect in the `spring-music` run self-corrected: a `.DS_Store` was committed at the
root in Step 1 and removed by the run's own Step 2 fix - the final tree is clean and the source
integrity assertion passes against the baseline.

### Round 2 (2026-08-28, 88.74 agent minutes) to round 3

Round 2 passed every integrity assertion but left two report-cosmetic variances open, both of
which needed a contract decision rather than a validator change. `SKILL.md` v0.2.0 pinned both,
and round 3 confirms them closed:

| # | Round-2 variance | Fix in SKILL.md v0.2.0 | Round-3 evidence |
|---|---|---|---|
| 3 | The manual-action section name was not pinned, so three runs produced three names: `Manual Action`, `TODO(migration) Checklist`, `TODO(migration) Cross-Reference`. The pairing was correct every time, but a validator can only gate on a known name. | "**The manual-action section of the report is named exactly `## Manual Action Items`.**" plus exit criterion 6 reworded to name that section | `## Manual Action Items` in 2/2 runs, verbatim |
| 4 | Em dash (U+2014) used as a table separator in generated report prose. No definition in this collection forbade it; the surrounding ecosystem standard does. | "**No em dash (U+2014) anywhere in emitted output** - use a hyphen." | 0 occurrences of U+2014 in 2/2 reports |

Neither variance affected source integrity or the emitted manifests, which is why they were
batched into one `SKILL.md` revision and validated together instead of shipped as unmeasured
edits.

## Exit Criteria Compliance, round 3 (per `SKILL.md` v0.2.0)

| # | Exit criterion | spring-music | cf-sample-app-nodejs |
|---|---|---|---|
| 1 | Every manifest field, present or absent, in the report inventory | PASS | PASS |
| 2 | Originals byte-identical; output under `eks/`; report at root; no other root file | PASS | PASS |
| 3 | Secret stubs with empty values + `TODO(migration)` | PASS (no invented credential) | PASS |
| 4 | Emitted YAML parses; `--dry-run=client` clean | PASS (3 YAML) | PASS (3 YAML) |
| 5 | Every REPORT-ONLY construct has a report entry | PASS | PASS |
| 6 | Every `TODO(migration)` has an entry in `## Manual Action Items`, and vice versa | PASS (6/6 markers mapped to rows 1-6; rows 7-14 are report-only constructs) | PASS (7/7 markers mapped to rows 1-7; rows 8-10 are report-only constructs) |
| 7 | `memory` translation carries the HIGH-risk JVM note when a JVM language is detected | PASS (Java 17 detected, OOMKill-loop risk documented) | N/A (Node.js) |

## Measurement notes

- **Agent minutes** come from the `atx` CLI run summary (`Agent Minutes used: 43.40 / 70.00`).
  Cost is derived at US$ 0.035 per agent minute and is an estimate, not a billed figure.
- **Wall clock** is measured from the run log timestamps and is reported separately because it
  includes local fixture setup and is not the billing unit.
- The `atx` conversation log does not record per-run token counts, so token-level cost is not
  captured here.
