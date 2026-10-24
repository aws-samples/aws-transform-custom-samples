# Benchmark Results - PHP2Shell patch and verify

Measured on 2026-10-23 and 2026-10-24. Facts about the CVEs and patched releases change quickly; see the [README](README.md).

## Executive Summary

| Metric | Result |
|--------|--------|
| Fixture | `samples/legacy-php-app` (PHP 7.4 app, 12 files, 7 tests, deliberate PHP 8 breakages) |
| Environment | AWS Transform CLI 3.20.0, `us-east-1`, Amazon Linux 2023, Docker 25 |
| Rapid analysis (`rapid-techdebt-analysis`) | about 1 minute, 1 high finding (PHP 7.4 end of life, fix `AWS/php-version-upgrade`) |
| Comprehensive analysis (`tech-debt-comprehensive`) | about 7 minutes, 11 findings (3 high), including silent PHP 8 behavior changes |
| Managed upgrade (`AWS/php-version-upgrade`) | 35.6 agent minutes, about US$ 1.25 at US$ 0.035 per agent minute |
| Verify gate on the legacy code | **FAIL** (exit 3): PHP 7.4-only syntax does not parse on PHP 8 |
| Verify gate on the upgraded code, dependencies installed | **PASS** (exit 0), 7 of 7 tests executed on PHP 8.5.12 |
| Verify gate with PHP 8.5.11 | **FAIL** (exit 2), even though lint and tests pass: the runtime is below the patched release |
| Verify run through the transformation engine | 10.76 agent minutes (about US$ 0.38) on the upgraded code: PASS, only the two report files written |
| Same, on a fixture with one failing test (run 2026-10-24) | 11.48 agent minutes (about US$ 0.40): FAIL (exit 4); report matches `verify-verdict.json` |
| Verify as a continuous modernization custom analysis | legacy code: 2 findings (high lint gate, names `AWS/php-version-upgrade`; low static smoke); upgraded code with dependencies: 0 findings |

Observation that motivated the gate: the managed upgrade ran its own tests on PHP 8.5.3 (it installed that version on the host), which is
**below** the patched 8.5.12. A migration can look green on a vulnerable runtime.

## Gate test matrix (`scripts/verify.sh`)

Each case ran `verify.sh <repo> <target>` against a small purpose-built repository. The official `php:<release>-cli` image was used unless the
case sets `PHP_IMAGE`. "Exit" is the script exit code.

| Case | Target | Exit | Verdict and evidence |
|---|---|---|---|
| Clean code, no tests | 8.4 | 0 | PASS, `static-smoke`, PHP 8.4.27 |
| Clean code, no tests | 8.5 | 0 | PASS, `static-smoke`, PHP 8.5.12 |
| Clean code, no tests | 8.2 | 0 | PASS, `static-smoke`, PHP 8.2.35 (file name with a space) |
| Syntax error in a `.php` file | 8.4 | 3 | FAIL, lint gate |
| Syntax error in a `.phtml` file | 8.4 | 3 | FAIL, lint gate |
| Syntax error in a file whose name has a space | 8.4 | 3 | FAIL, lint gate |
| Syntax error reachable only through a symlink inside the repo (`src/lib` to `vendor/pkg`) | 8.4 | 3 | FAIL, lint gate; the same repo without the symlink passes |
| Empty directory | 8.4 | 9 | BLOCKED, no PHP file found |
| PHP files only under `vendor/` | 8.4 | 9 | BLOCKED, no PHP file found |
| PHPUnit with one passing test | 8.4 | 0 | PASS, `executed-tests`, `tests_ran` 1 |
| PHPUnit where every test is skipped | 8.4 | 0 | PASS, `static-smoke` (no test executed), note says why |
| PHPUnit with one failing test | 8.4 | 4 | FAIL, test gate |
| `PHP_IMAGE=php:8.5.11-cli` | 8.5 | 2 | FAIL, version gate (below 8.5.12) |
| `PHP_IMAGE=php:8.5.12-cli` | 8.4 | 2 | FAIL, branch mismatch (8.5 is not 8.4) |
| Unknown target `9.9` | 9.9 | 9 | BLOCKED |
| Target with JSON and shell characters | `8.4","x":"y` | 9 | BLOCKED, the value cannot reach the JSON file |
| `PHP_IMAGE=-v` | 8.4 | 9 | BLOCKED, invalid image name |
| `verify-verdict.json` is a symlink to another file | 8.4 | 0 | The other file is left untouched; the symlink is replaced by a regular file |
| Repository path does not exist | 8.4 | 9 | BLOCKED |

Earlier run on the sample app (before the matrix above): legacy code FAIL (3); upgraded code without `vendor/` PASS `static-smoke`; upgraded
code with `vendor/` PASS `executed-tests` (7 tests); PHPUnit that found zero tests FAIL (4); PHP 8.5.11 FAIL (2); unknown target BLOCKED (9).

## Known limitations

- A symlink that points **outside** the repository is not visible inside the container, so what it points to is not linted.
- The official `php` image has only the core extensions. Code that needs others must be tested with your own image (`PHP_IMAGE`), or the tests
  fail or skip (a run where every test is skipped is reported as `static-smoke`).
- The gate has no network. Dependencies must be installed before the run; without `vendor/` it can only prove that every file parses.
- A hostile project can fake its own test results. The container reduces the impact of mistakes; it is not a boundary against a determined attacker.
- `PASS` means the code runs clean on a patched PHP, not that production is patched. Patching the runtime is [step 4](README.md#step-4-patch-the-runtime-and-restart-every-worker).

## How to repeat it

```bash
# Gate matrix: any PHP repository
bash php-upgrade-secure-verify/scripts/verify.sh <repo> 8.4
echo "exit=$?"; cat <repo>/verify-verdict.json

# Fixture: copy it out of this repository first (the analysis needs its own git repository)
mkdir -p /tmp/repos && cp -R samples/legacy-php-app /tmp/repos/legacy-php-app
git -C /tmp/repos/legacy-php-app init -q && git -C /tmp/repos/legacy-php-app add -A && git -C /tmp/repos/legacy-php-app commit -qm base
atx ct source add --name sample --provider local --path /tmp/repos
atx ct analysis run --type rapid-techdebt-analysis --source sample --wait
```

Cost is US$ 0.035 per agent minute ([pricing](https://aws.amazon.com/transform/pricing/)); the figures above are single runs (n=1) and vary.
