---
name: php-upgrade-secure-verify
description: >-
  Verify-only gate for PHP code already migrated to a supported PHP branch (for
  example by AWS/php-version-upgrade). Runs the repository in an isolated,
  network-less container on the official image of a PATCHED PHP release (8.2.35,
  8.3.36, 8.4.27 or 8.5.12 or newer, which carry the PHP2Shell fix for
  CVE-2026-109618 and CVE-2026-109619), lint-checks every file, runs the test
  suite or a static smoke check, and writes a PASS / FAIL / BLOCKED verdict with
  evidence. It NEVER modifies source. Trigger: PHP2Shell,
  verify PHP upgrade, patched runtime gate, CVE-2026-109618, CVE-2026-109619.
---
# PHP Upgrade Secure Verify

## Objective
Prove that PHP code already migrated to the 8.x branch runs clean on an interpreter
that actually carries the PHP2Shell patch. This transformation produces EVIDENCE,
not code changes. It closes a real gap: a migration is often tested on whatever PHP
happens to be on the machine (in one test run, PHP 8.5.3 on a host whose package
repository was pinned to a pre-patch release), so a migration that looks "green"
can have been checked on a vulnerable runtime.

The single question this TD answers: does the migrated code run clean on the
first patched release of its branch (8.2.35, 8.3.36, 8.4.27 or 8.5.12)?

## Scope and Non-Goals
IN SCOPE:
1. Running the repository inside a hardened, network-less container on the official
   image of a patched PHP release.
2. Asserting the container PHP version is at or above the patched floor.
3. Lint-checking every PHP file and running tests, or a static smoke check when the
   project has no test suite.
4. Recording the result: the script writes `verify-verdict.json`; the agent writes `VERIFY_REPORT.md`.

NON-GOALS (do NOT do these):
1. Transforming or modernizing code. That is `AWS/php-version-upgrade`'s job.
2. Patching production runtimes, or restarting PHP-FPM / Apache workers. Those are
   operator steps in the prescriptive guidance, outside this TD.
3. Deciding which framework-specific files to exclude. That belongs to the caller's
   own verify layer, not to this agnostic gate.

## Constraints
- CRITICAL: Do NOT modify, create, or delete any file in the repository EXCEPT
  `VERIFY_REPORT.md` and `verify-verdict.json` at the repository root.
- IMPORTANT: Keep every file you write ASCII-only (no accents, no typographic dashes or quotes).
- CRITICAL: Run repository code ONLY via `bash scripts/verify.sh "$REPO" "$TARGET"`.
  NEVER run `php` directly on the host. The container is the only isolation layer.
- CRITICAL: If Docker is unavailable or the patched image cannot be obtained, the
  verdict is `BLOCKED`. NEVER fall back to running PHP on the host.
- IMPORTANT: Treat a container PHP version below the patched floor as a GATE FAIL,
  even if lint and tests pass. A clean run on a vulnerable interpreter is NOT a pass.
- IMPORTANT: Do NOT infer PASS from the agent's own narrative. The verdict comes from
  the script exit code and `verify-verdict.json` only.

## Reference Documents
| Reference | When loaded | Description |
|---|---|---|
| references/verdict-contract.md | Always | The exact verdict levels, decision rules, and JSON schema |
| references/patched-versions.md | Always | The patched-version floors and why a branch alone is not enough |

## Workflow (3 phases)

### Phase 0: Preconditions (ALWAYS, abort cleanly on failure)
1. Confirm `docker` is runnable (`docker info` exits 0). If not, write a `BLOCKED`
   verdict and STOP.
2. Read the target branch from `additionalPlanContext` (`target=8.2`, `8.3`, `8.4`
   or `8.5`). If it is missing, use `8.4` and say so in the report. Any other value
   makes the script return `BLOCKED`.
3. The script pulls the official `php:<patched-release>-cli` image if it is missing.
   If it cannot, it writes a `BLOCKED` verdict. Do not work around that.

### Phase 1: Run the gate (ALWAYS)
1. Run `bash scripts/verify.sh "$REPO" "$TARGET"`. Capture its exit code and its
   final summary line verbatim.
2. The script performs, inside the container, in this order:
   a. version gate (PHP_VERSION must be >= the patched floor AND on the requested branch),
   b. `php -l` over every `*.php`, `*.phtml` and `*.inc` file outside `vendor/`
      (zero files found is `BLOCKED`, not a pass),
   c. the test suite if one exists AND its dependencies are installed (`vendor/`),
      and at least one test really runs (skipped tests do not count); otherwise a
      static smoke check with a note saying why no test was executed.
3. Do NOT retry on failure and do NOT modify the repo to make it pass. A failure is
   a finding to report.

### Phase 2: Record evidence (ALWAYS)
1. `verify-verdict.json` is written by the script (schema in `references/verdict-contract.md`).
   Do not edit it by hand.
2. Write `VERIFY_REPORT.md`: the verdict, the exact container PHP version, the gate
   results, and the script's summary line.
3. Confirm `git status --porcelain` shows no tracked file changed other than the two
   report files (`vendor/` is usually ignored).

## Configuration
`additionalPlanContext` carries free text. Recognized keys:
- `target=8.2`, `8.3`, `8.4` or `8.5` - which patched branch to verify against. Default `8.4`.

Extensions: the official `php:<version>-cli` image has only the core extensions. Code that
needs `pdo_mysql`, `mysqli`, `gd`, `intl`, `zip` or `bcmath` will fail or skip its tests there.
Build your own image from the patched base, install those extensions, and pass it as
`PHP_IMAGE=your-image` (the version and branch gates still apply to it).

Dependencies: the gate runs with no network, so `composer install` must have been run in
the checkout beforehand (by the operator's own pipeline). Without `vendor/` the gate can only
prove that every file parses (`static-smoke`).

## When run as a continuous modernization custom analysis
Report findings from the script result, one per failed or weak gate, never from narrative:
- version gate FAIL: severity high, the container PHP version versus the patched floor.
- lint gate FAIL: severity high, one finding per file with file:line and the parser message;
  when the cause is removed PHP syntax or functions, name `AWS/php-version-upgrade` as the fix.
- test gate FAIL: severity high, the failing tests as printed by the script.
- `STATIC-SMOKE`: severity low, "tests were not executed", with the note from `verify-verdict.json`
  and the recommendation to run `composer install` and verify again.
- BLOCKED: severity medium, "not verified", with the reason. Never report BLOCKED as clean.
A PASS with `executed-tests` needs no finding.

## Validation / Exit Criteria
1. `verify-verdict.json` exists at the repo root with `verdict` in {PASS, FAIL, BLOCKED}.
2. `verify-verdict.json.php_version` is present, and for a PASS it is >= the patched
   floor for the branch (>=8.2.35, >=8.3.36, >=8.4.27 or >=8.5.12) and on the requested branch.
3. The runtime gate exit code recorded in the report is 0 for a PASS.
4. No tracked file changed other than `VERIFY_REPORT.md` and `verify-verdict.json`.
5. `VERIFY_REPORT.md` exists and its verdict matches `verify-verdict.json`.

## DO NOT Rules
1. DO NOT modify, generate, or delete any repository file other than the two reports.
2. DO NOT run `php`, `composer`, or tests on the host. Only inside the container.
3. DO NOT issue PASS if the container PHP version is below the patched floor.
4. DO NOT issue PASS if `php -l` fails on any file, or if the test suite fails.
5. DO NOT claim a check passed without the script exit code proving it.
6. DO NOT use host networking in the container. The gate runs with `--network none`.

## Tips
- The patched floors and their rationale are in `references/patched-versions.md`.
- PHP's versioning policy keeps patch releases within a branch fix-only with no
  language changes, so code valid on any 8.4.x is expected to stay valid on 8.4.27;
  this gate turns that expectation into verified fact against the exact patched image.
