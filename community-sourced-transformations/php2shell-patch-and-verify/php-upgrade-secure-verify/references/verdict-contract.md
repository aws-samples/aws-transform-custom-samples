# Verdict contract

The gate emits exactly one verdict. It comes from the script exit code and the JSON below, never from narrative.

## Verdict levels and exit codes
| Verdict | Exit | Meaning |
|---|---|---|
| `PASS` | 0 | Patched runtime on the requested branch, manifest allows only patched releases, every file parses, and at least one test executed and passed |
| `FAIL` | 2 | Runtime below the patched floor, wrong branch, or `composer.json` allows an unpatched PHP |
| `FAIL` | 3 | `php -l` failed on at least one file |
| `FAIL` | 4 | The test suite failed |
| `INCONCLUSIVE` | 5 | Everything checked is clean, but something was not checked: no test executed (no suite, dependencies missing, every test skipped, incomplete or risky, or no JUnit log), no `composer.json`, or `vendor/` skipped with `LINT_VENDOR=0`. Not verified |
| `BLOCKED` | 9 | The gate could not decide: no container runtime, image unavailable, unknown target, no PHP file, unreadable files, a symlink leaving the repository, manifest not checked, PHPUnit could not start (126, 127), no `timeout` in the image, unreadable JUnit log, tests failing on the gate environment, test timeout or kill, verdict not writable |

When several checks fail, the exit code is the first in this order: version, branch, manifest (2), lint (3), tests (4).
The summary lists every failure. Order of precedence: FAIL, then BLOCKED, then INCONCLUSIVE, then PASS.
`BLOCKED` and `INCONCLUSIVE` are never a pass. Never turn them into one by running PHP on the host.

## Decision rules
- **version**: `PHP_VERSION >= floor` (8.2.35, 8.3.36, 8.4.27, 8.5.12) and the container is on the requested branch.
- **manifest**: with Composer's own semver library, inside a network-less container:
  `require.php` must exist, must not intersect any unpatched or end-of-life release, and must allow at least one patched
  release of the target branch (if it does not allow the verified runtime itself, that is a warning: verify with a release
  it allows); `config.platform.php`, if present, must not be an unpatched release. No `composer.json` at all is `INCONCLUSIVE`
  (nothing stops an install on an unpatched PHP). A symlinked `composer.json` is `BLOCKED`.
- **lint**: `php -l` on every PHP source file (`.php .phtml .inc .php5 .php7 .php8 .module .install .theme .engine .profile`, any
  case, plus executable files without an extension whose first line names `php`), `vendor/` included (`LINT_VENDOR=0` skips it for diagnosis;
  the verdict is then at best `INCONCLUSIVE`). The number of files the container linted must equal the number found on the host, and every file must be readable by
  the container user; otherwise `BLOCKED`. A symlink that leaves the repository is `BLOCKED` before any walk. A `vendor/` file
  that fails only on the target branch and parses on PHP 8.5.12 is accepted as version-guarded, with a warning. A real
  parse error is `FAIL` even if coverage is also short.
- **tests**: run when `vendor/bin/phpunit` exists with `phpunit.xml(.dist)` or `tests/`, under a timeout
  (`TEST_TIMEOUT`, default 600 s). Executed = total minus skipped, incomplete and risky, from PHPUnit's summary; the gate also counts non-skipped test cases in PHPUnit's
  JUnit log (`--log-junit`) and keeps the lower count. At least one must remain.
  Timeout (124, 143) or kill (137) is `BLOCKED`, not a test failure; so is a failing run whose output shows the gate
  environment as the cause (read-only checkout, full `/tmp`, permission denied). `PHPUNIT_CONFIG` selects a configuration
  file; otherwise `phpunit.xml`, `phpunit.xml.dist` or `phpunit.dist.xml` at the root, else `tests/`. `PHPUNIT_EXCLUDE_GROUP` excludes groups, for
  example tests that need the network.

## JSON schema - verify-verdict.json
```json
{
  "verdict": "PASS | FAIL | INCONCLUSIVE | BLOCKED",
  "target_branch": "8.2 | 8.3 | 8.4 | 8.5",
  "patched_floor": "8.2.35 | 8.3.36 | 8.4.27 | 8.5.12",
  "php_image": "<image reference used>",
  "php_image_id": "<local image ID>",
  "php_version": "<PHP_VERSION reported by the container>",
  "version_gate": "PASS | FAIL | BRANCH-MISMATCH | SKIPPED",
  "manifest_gate": "PASS | FAIL | ERROR | NO-MANIFEST | SKIPPED",
  "manifest_require_php": "<require.php, or none>",
  "manifest_platform_php": "<config.platform.php, or none>",
  "manifest_reason": "<why the manifest failed>",
  "lint_gate": "PASS | FAIL | NO-FILES | COVERAGE-MISMATCH | SKIPPED",
  "lint_files": 0,
  "lint_failures": 0,
  "vendor_linted": true,
  "vendor_files_needing_newer_php": 0,
  "test_gate": "PASS | FAIL | NOT-RUN | TIMEOUT | KILLED | NO-START | NO-TIMEOUT | NO-JUNIT | ENVIRONMENT | SKIPPED",
  "tests_ran": 0,
  "tests_not_executed": 0,
  "excluded_groups": "<PHPUNIT_EXCLUDE_GROUP>",
  "evidence_level": "executed-tests | static-only | not-run",
  "patched_runtime_cves": ["CVE-2026-109618", "CVE-2026-109619"],
  "gate_exit_code": 0,
  "git_commit": "<HEAD, or empty>",
  "git_branch": "<branch, or empty>",
  "git_dirty": false,
  "generated_at": "<UTC timestamp>",
  "warnings": ["<for example: PHP 8.2 reaches end of life on 2026-12-31>"],
  "note": "<why no test executed, if so>",
  "summary": "<the script's final summary line>"
}
```
`patched_runtime_cves` is filled only on `PASS`, otherwise `[]`. `git_dirty` is `null` outside a git checkout. The script deletes
any existing `verify-verdict.json` when it starts, so a missing file means no verdict, never an old one.

## Honesty rules
- `patched_runtime_cves` means "this code was verified on a runtime that carries the fix for these CVEs". The code
  itself never fixes them. The production runtime and the worker restart are operator steps, outside this TD.
- Trust boundary: the repository, its `vendor/` and its tests are trusted input. The JUnit cross-check stops a wrapper that only prints a
  summary; it does not stop a project that fakes both. Do not present the gate as proof against a hostile repository.
- `INCONCLUSIVE` must be reported as "not verified". `php -l` finds parse errors only: removed functions such as
  `each()` or `create_function()`, and silent behavior changes, are found only by executed tests.
