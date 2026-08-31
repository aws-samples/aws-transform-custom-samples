# Benchmark Results - Tanzu / Cloud Foundry to Amazon EKS

## Executive Summary

| Metric | Result |
|--------|--------|
| Repositories tested | 2 real upstream Cloud Foundry sample repos, pinned to a commit |
| Rounds | 2 - round 1 found 2 defects, both fixed in `SKILL.md` and re-validated in round 2 |
| Transformation success rate (round 2) | **2/2 COMPLETE** |
| **Source integrity** | **0 files modified outside `eks/` and the report, in both round-2 runs** |
| Files emitted (round 2) | 5 (`spring-music`) and 5 (`cf-sample-app-nodejs`) |
| `MIGRATION_REPORT.md` at repository ROOT | **2/2** (the round-1 defect - report inside `eks/` - is fixed) |
| `.dockerignore` under `eks/`, never at the root | **2/2** (the round-1 defect - root `.dockerignore` - is fixed) |
| `*.openshift.io` surviving in output | 0 in both runs |
| `TODO(migration)` markers | 4 and 5, all paired with report entries |
| Invented credentials in stubs | 0 |
| `kubectl apply --dry-run=client` | clean in both runs |
| Total agent minutes (round 2) | 88.74 (47.85 + 40.89) |
| Total estimated cost (round 2) | ~US$ 3.11 (at US$ 0.035 / agent minute) |
| Cumulative incl. round 1 | ~179.36 agent minutes, ~US$ 6.28 |

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

## At-a-Glance Results (round 2, 2026-08-28)

| # | Repository | Status | Files emitted | Report at root | Root untouched | Source changed | TODOs | Agent Min | Cost |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `spring-music` | COMPLETE | 5 (294 lines) | PASS (11.1 KB) | PASS | **0** | 4 | 47.85 | $1.67 |
| 2 | `cf-sample-app-nodejs` | COMPLETE | 5 | PASS (8.4 KB) | PASS | **0** | 5 | 40.89 | $1.43 |
| | **TOTALS** | **2/2** | **10** | **2/2** | **2/2** | **0** | **9** | **88.74** | **$3.11** |

---

## Round 1 → Round 2: the two defects and their fixes

Round 1 (2026-08-21, 90.62 agent minutes across the same two repos) surfaced two contract
violations, both fixed in `SKILL.md` and re-validated in round 2 on both repos:

| # | Round-1 defect | Fix in SKILL.md | Round-2 evidence |
|---|---|---|---|
| 1 | `MIGRATION_REPORT.md` emitted inside `eks/` | "**`MIGRATION_REPORT.md` goes at the repository ROOT**, matching the convention of the other definitions in this collection" | Report at the root in 2/2 runs |
| 2 | `.dockerignore` created/modified at the repository root (`cf-sample-app-nodejs`) | "**Never create or modify a file at the repository root** other than `MIGRATION_REPORT.md`" - emit `eks/.dockerignore` + a report entry saying it must be moved before the first build | `eks/.dockerignore` + move instruction in 2/2 runs; root byte-identical |

An incidental defect in the `spring-music` run self-corrected: a `.DS_Store` was committed at the
root in Step 1 and removed by the run's own Step 2 fix - the final tree is clean and the source
integrity assertion passes against the baseline.

## Exit Criteria Compliance (per SKILL.md)

| # | Exit criterion | spring-music | cf-sample-app-nodejs |
|---|---|---|---|
| 1 | Every manifest field, present or absent, in the report inventory | PASS | PASS |
| 2 | Originals byte-identical; output under `eks/`; report at root; no other root file | PASS | PASS |
| 3 | Secret stubs with empty values + `TODO(migration)` | PASS (no invented credential) | PASS |
| 4 | Emitted YAML parses; `--dry-run=client` clean | PASS (2 YAML) | PASS (3 YAML) |
| 5 | Every REPORT-ONLY construct has a report entry | PASS | PASS |
| 6 | Every `TODO(migration)` paired with a report entry, and vice versa | PASS (4/4, `TODO(migration) Checklist` section) | PASS (5/5, `TODO(migration) Cross-Reference` table) |
| 7 | `memory` translation carries the HIGH-risk JVM note when a JVM language is detected | PASS (Java 17 detected, OOMKill-loop risk documented) | N/A (Node.js) |

## Known variance (open, needs a SKILL.md decision before the next publish)

1. **The manual-action section name is not pinned by the contract.** Three runs produced three
   names: `Manual Action` (round 1), `TODO(migration) Checklist` (spring-music round 2),
   `TODO(migration) Cross-Reference` (cf round 2). The pairing was correct every time, but
   `assert_def_run.py` can only gate on a known name - it currently accepts the first two and
   flags the third. Fix belongs in `SKILL.md` (pin one name), NOT in loosening the validator.
2. **Em dashes in generated report prose.** The cf round-2 report uses the em dash character
   (U+2014) as a table separator. No definition in this collection currently forbids it; the
   ecosystem standard does. Same
   decision point: add the constraint to `SKILL.md` and re-validate.

Both are report-cosmetic - neither affects source integrity nor the emitted manifests - and both
require a republish, so they are batched for the next SKILL.md revision rather than shipped as
an unvalidated edit.
