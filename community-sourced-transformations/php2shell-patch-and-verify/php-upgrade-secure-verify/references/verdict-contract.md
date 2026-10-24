# Verdict contract

The gate emits exactly one verdict. The verdict comes from the script exit code and
the JSON below, never from narrative.

## Verdict levels
- `PASS` - container PHP version is at or above the patched floor AND `php -l` is
  clean on every file AND (tests pass, or a no-test project passes the static smoke).
- `FAIL` - the gate ran but at least one check failed: version below the floor, a
  lint error, or a failing test.
- `BLOCKED` - the gate could not run (Docker unavailable, image missing, unknown target,
  no PHP file found to lint, verdict file not writable). This
  is NOT a pass and NOT a fail; it means "not verified". Never downgrade a BLOCKED to
  PASS by running on the host.

## Decision rules
- version gate: `PHP_VERSION >= floor` where floor is `8.2.35`, `8.3.36`, `8.4.27` or
  `8.5.12` for the target branch. A version below the floor is `FAIL` even if everything
  else is clean, because the interpreter is still vulnerable to PHP2Shell. The container
  must also be on the requested branch (`BRANCH-MISMATCH` is a `FAIL`).
- lint gate: any `php -l` non-zero on any `*.php`, `*.phtml` or `*.inc` file (outside
  `vendor/`) is `FAIL`. Zero files found is `BLOCKED`.
- test gate: if the repo has a usable `vendor/bin/phpunit` plus `phpunit.xml(.dist)`
  or a `tests/` dir, the suite must exit 0 and run at least one test (PHPUnit exits
  non-zero when it finds no tests, which is a FAIL; a run where every test is skipped
  counts as no test executed and falls back to the static smoke). If dependencies are
  not installed or there is no suite, fall back to the static smoke (version gate + lint clean),
  label the evidence `static-smoke`, and say why in `note`.

## JSON schema - verify-verdict.json
```json
{
  "verdict": "PASS | FAIL | BLOCKED",
  "target_branch": "8.2 | 8.3 | 8.4 | 8.5",
  "patched_floor": "8.2.35 | 8.3.36 | 8.4.27 | 8.5.12",
  "php_version": "<exact PHP_VERSION reported by the container>",
  "version_gate": "PASS | FAIL | BRANCH-MISMATCH | SKIPPED",
  "lint_gate": "PASS | FAIL | NO-FILES | SKIPPED",
  "test_gate": "PASS | FAIL | STATIC-SMOKE",
  "evidence_level": "executed-tests | static-smoke | not-run",
  "cve_addressed": ["CVE-2026-109618", "CVE-2026-109619"],   (only on PASS, otherwise [])
  "gate_exit_code": 0,
  "tests_ran": 0,
  "note": "<why tests were not executed, if so>",
  "summary": "<the script's final summary line, verbatim>"
}
```

## Honesty rules
- `cve_addressed` means "the runtime this code was verified against carries the fix",
  NOT "the production runtime is patched". The production runtime and the worker
  restart are operator steps covered by the prescriptive guidance, outside this TD.
- A `static-smoke` PASS (no test suite) is weaker evidence than `executed-tests`. Say
  so in `VERIFY_REPORT.md`; do not present it as a full behavioral pass.
