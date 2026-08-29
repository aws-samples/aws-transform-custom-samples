# Benchmark Results - OpenShift to Amazon EKS

## Executive Summary

| Metric | Result |
|--------|--------|
| Repositories tested | 2 real upstream OpenShift sample repos, pinned to a commit |
| Transformation success rate | **2/2** |
| **Source integrity** | **0 files modified outside `eks/` and the report, in both runs** |
| Files emitted | 33 (`nodejs-ex`) and 17 (`cakephp-ex`) |
| Helm charts emitted | 4 and 3 - **all 7 render under `helm template`** |
| `*.openshift.io` surviving in output | **0** in both runs |
| `TODO(migration)` markers | 15 and 15, all covered by the report's Manual Action section |
| `MIGRATION_REPORT.md` | 12.6 KB and 11.6 KB |
| Total agent minutes | 141.67 |
| Total estimated cost | ~US$ 4.96 (at US$ 0.035 / agent minute) |

### Methodology

The fixtures are **real public repositories**, not hand-written ones, pinned to a commit so the
result stays reproducible:

| Repo | Licence | Commit |
|---|---|---|
| `sclorg/nodejs-ex` | Apache-2.0 | `5506d732f447c7c48dc89619af3b8ee8f125cf90` |
| `sclorg/cakephp-ex` | CC0-1.0 | `9573e973a9ffd5b6e1d2183643de2acbdfd02dd3` |

Real repositories were chosen deliberately over a hand-authored fixture. A fixture written by the
author of the mapping carries the author's bias: it contains the constructs the mapping already
knows about. A real repository contains what the world contains, including what the author did not
think of - and `nodejs-ex` proved the point by carrying its OpenShift constructs in **two** forms,
Template JSON *and* a Helm chart, exercising a path the hand-written fixture never touched.

Each repo was committed as a baseline, then transformed via:

```bash
atx custom def exec -n openshift-to-eks -p . -x -t \
  --configuration file://config.json --limit 70
```

Assertions are **invariants**, not expected findings, because a real repository has no answer key:
source integrity, output existence, zero OpenShift `apiVersion` leakage, YAML validity, chart
rendering, and `TODO`/report pairing.

---

## At-a-Glance Results

| # | Repository | Status | Files emitted | Charts | Source files changed | OCP leak | TODOs | Agent Min | Cost |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `sclorg/nodejs-ex` (45 files) | PASS | 33 | 4/4 render | **0** | 0 | 15 | 70.71 | $2.47 |
| 2 | `sclorg/cakephp-ex` (93 files) | PASS | 17 | 3/3 render | **0** | 0 | 15 | 70.96 | $2.48 |
| | **TOTALS** | **2/2** | **50** | **7/7** | **0** | **0** | **30** | **141.67** | **$4.96** |

---

## Exit Criteria Compliance (per SKILL.md)

| # | Exit criterion | nodejs-ex | cakephp-ex |
|---|---|---|---|
| 1 | Every construct in the inventory appears in the report with its classification | PASS | PASS |
| 2 | Originals byte-identical; all output under `eks/` | PASS | PASS |
| 3 | Zero `*.openshift.io` apiVersions in emitted output | PASS | PASS |
| 4 | Emitted YAML parses; charts render | PASS (30 YAML, 4 charts) | PASS (16 YAML, 3 charts) |
| 5 | Every REPORT-ONLY construct has a report entry | PASS | PASS |
| 6 | Every ambiguity carries a `TODO(migration)` and a report entry | PASS (15) | PASS (15) |
| 7 | Report cross-references the Lens question ids | PASS | PASS |

---

## What the first run got right, and what it cost to find out

The transformation passed on its first real execution. What did **not** pass on the first attempt
was the tooling around it, and both failures are recorded because they cost real time:

**1. The run failed before starting, twice, on a CLI parsing rule.** `--configuration` was passed
inline as
`additionalPlanContext=migration_target: eks-standard, ingress_strategy: gateway-api, registry: ...`
and rejected with `Invalid configuration format`. **Commas separate `key=value` pairs** in the
inline form, so `ingress_strategy: gateway-api` parsed as a key with no `=`. Zero agent minutes
were consumed - the CLI rejected the input up front - but the run produced no output and looked
like a transformation failure. The fix is `--configuration file://config.json`, and it is now the
documented invocation in the README.

**2. The assertion script reported 19 of 30 emitted YAML files as invalid.** They were **Helm
templates**: `{{ .Values.name | quote }}` is not valid standalone YAML by design, and
`helm template` rendered all 4 charts without error. The check was wrong, not the output. Files
under a chart's `templates/` directory containing `{{` are now validated with `helm template`
instead of a YAML parser.

**3. The assertion script reported 3 `TODO(migration)` markers with no report entry.** They were
documented - keyed on the **source** file (`nodeshift/route.yml`) rather than the emitted file
(`httproute.yaml`), which is the correct behaviour for a report describing what the original
contained. The check matched on the wrong basename.

Two of these three were false failures produced by the verifier. That is worth stating plainly:
a validator that cries wolf trains its reader to ignore it, so its own defects belong in the
benchmark alongside the definition's.

---

## Reproducing

```bash
# 1. fetch the pinned fixtures (asserts licence, commit, and construct presence)
./fetch-samples.sh

# 2. baseline
cd upstream/nodejs-ex && git init -q && git add -A && git commit -qm baseline

# 3. publish from a staged copy (SKILL.md + references/ only; a README at the
#    definition root aborts the publish)
atx custom def publish -n openshift-to-eks --sd <staged>

# 4. transform
atx custom def exec -n openshift-to-eks -p . -x -t \
  --configuration file://config.json --limit 70

# 5. assert the invariants
python3 assert_def_run.py <repo-dir>
```
