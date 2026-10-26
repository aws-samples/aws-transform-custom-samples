---
name: php-upgrade-secure-verify
description: >-
  Verify-only gate for PHP code already migrated to a supported PHP branch (for
  example by AWS/php-version-upgrade). Runs the repository in isolated,
  network-less containers on the official image of a PATCHED PHP release (8.2.35,
  8.3.36, 8.4.27 or 8.5.12 or newer, which carry the PHP2Shell fix for
  CVE-2026-109618 and CVE-2026-109619). Checks the runtime version, that
  composer.json cannot install on an unpatched PHP, that every PHP file parses,
  and that tests execute and pass. Writes a PASS / FAIL / INCONCLUSIVE / BLOCKED
  verdict with evidence. It NEVER modifies source. Trigger: PHP2Shell, verify PHP
  upgrade, patched runtime gate, CVE-2026-109618, CVE-2026-109619.
---
# PHP Upgrade Secure Verify

## Objective
Prove that PHP code already migrated to the 8.x branch runs clean on an interpreter
that actually carries the PHP2Shell patch, and that its manifest does not let it be
installed on one that does not. This transformation produces EVIDENCE, not code changes.

It closes two real gaps:
1. A migration is often tested on whatever PHP happens to be on the machine (in test runs,
   PHP 8.5.3 and 8.4.26, both unpatched), so a migration that looks green can have been
   checked on a vulnerable runtime.
2. A migration commonly writes `"php": ">=8.4"` or `">=8.5"` into `composer.json`. Both
   still allow unpatched releases (8.4.0 to 8.4.26, 8.5.0 to 8.5.11).

## Scope and Non-Goals
IN SCOPE:
1. Running the repository inside hardened, network-less containers on the official image
   of a patched PHP release.
2. Asserting the container PHP version is at or above the patched floor, on the requested branch.
3. Checking `composer.json` (`require.php`, `config.platform.php`) with Composer's own
   semver library.
4. Lint-checking every PHP file, `vendor/` included, and running the test suite.
5. Recording the result: the script writes `verify-verdict.json`; the agent writes `VERIFY_REPORT.md`.

NON-GOALS (do NOT do these):
1. Transforming or modernizing code, or editing `composer.json`. A failed check is a finding.
2. Patching production runtimes, or restarting PHP-FPM / Apache workers. Those are
   operator steps in the prescriptive guidance, outside this TD.
3. Proving identical behavior. Tests cover what they cover.

## Constraints
- CRITICAL: Do NOT modify, create, or delete any file in the repository EXCEPT
  `VERIFY_REPORT.md` (and `verify-verdict.json`, which only the script writes).
- CRITICAL: Run repository code ONLY via `bash scripts/verify.sh "$REPO" "$TARGET"`.
  NEVER run `php` or `composer` directly on the host. The container is the only isolation layer.
- CRITICAL: If the container runtime is unavailable or an image cannot be obtained, the
  verdict is `BLOCKED`. NEVER fall back to running PHP on the host.
- CRITICAL: The verdict and exit code come from the script and `verify-verdict.json` only.
  Never infer or upgrade a verdict from your own reading of the code.
- IMPORTANT: Keep every file you write ASCII-only (no accents, no typographic dashes or quotes).

## Reference Documents
| Reference | When loaded | Description |
|---|---|---|
| references/verdict-contract.md | Always | Verdict levels, exit codes, decision order, JSON schema |
| references/patched-versions.md | Always | Patched floors, end-of-life dates, safe `composer.json` constraints |

## Workflow (3 phases)

### Phase 0: Preconditions
1. Confirm the container runtime works (`docker info`, or the CLI named in `CONTAINER_CLI`).
   If not, run the script anyway: it writes the `BLOCKED` verdict. Then STOP.
2. Read the target branch from `additionalPlanContext`. Accept `target=8.4` or text that
   names the version, such as "The target PHP version is 8.4": use the first `8.2`, `8.3`,
   `8.4` or `8.5` it contains. If none is given, use `8.4` and say so in the report.

### Phase 1: Run the gate
1. Run `bash scripts/verify.sh "$REPO" "$TARGET"`. Capture its exit code and its final
   summary line verbatim.
2. Do NOT retry on failure and do NOT modify the repository to make it pass.

### Phase 2: Record evidence
1. Read `verify-verdict.json` (written by the script). Do not edit it.
2. Write `VERIFY_REPORT.md` with: the verdict and exit code, the container PHP version, each
   gate result, the manifest constraint and reason, lint files and failures, tests executed,
   warnings, `git_commit`, and the script's summary line verbatim.
3. For a manifest FAIL, use this recommendation text exactly, filling in the two values from the
   table in `references/patched-versions.md` for the target branch, and add nothing about other
   constraints (comparisons between constraints are easy to get wrong):
   `Set require.php to "<safe constraint>". If composer.json sets config.platform.php, set it to "<floor>". Then run composer update --lock.`
4. For `INCONCLUSIVE`, state plainly what was not checked (the `summary`: no test executed, no
   `composer.json`, or `vendor/` not linted) and that `php -l` only catches parse errors, not removed
   functions or changed behavior.
5. Confirm that no tracked file changed other than the report files.

## When run as a continuous modernization custom analysis
Report findings from `verify-verdict.json`, one per failed or weak gate, never from narrative:
- `version_gate` FAIL or BRANCH-MISMATCH: severity high, the container PHP version versus the patched floor.
- `manifest_gate` FAIL: severity high, `manifest_reason` and the current constraint. The recommendation
  is the exact text from Phase 2, item 3, and nothing else.
- `lint_gate` FAIL: severity high, one finding per failing file as printed by the script; when the
  cause is removed PHP syntax or functions, name `AWS/php-version-upgrade` as the fix.
- `test_gate` FAIL: severity high, the failing tests as printed by the script.
- `INCONCLUSIVE`: severity medium, "not verified", with the `summary` and the matching recommendation: install
  dependencies or add tests; add a `composer.json` with a safe `require.php`; or run without `LINT_VENDOR=0`.
- `BLOCKED`: severity medium, "not verified", with the reason. Never report BLOCKED as clean.
- Each entry in `warnings`: severity low.
A PASS needs no finding beyond its warnings.

## Validation / Exit Criteria
1. `verify-verdict.json` exists at the repository root with `verdict` in {PASS, FAIL, INCONCLUSIVE, BLOCKED}
   and `gate_exit_code` equal to the script exit code (0, 2, 3, 4, 5 or 9).
2. `VERIFY_REPORT.md` exists and its verdict and exit code match `verify-verdict.json`.
3. No tracked file changed other than the report files.

## DO NOT Rules
1. DO NOT modify, generate, or delete any repository file other than `VERIFY_REPORT.md`.
2. DO NOT run `php`, `composer`, or tests on the host. Only inside the container.
3. DO NOT report PASS unless `verify-verdict.json` says PASS.
4. DO NOT describe INCONCLUSIVE as a pass, or BLOCKED as clean.
5. DO NOT edit `composer.json` to fix a manifest FAIL. Report the fix.
6. DO NOT use host networking in the container. The gate runs with `--network none`.

## Tips
- Patch releases within a branch are fix-only, so code valid on 8.4.x is expected to stay valid
  on 8.4.27; this gate turns that expectation into a verified fact on the exact patched image.
- The official image has core extensions only. A project that needs others is verified with
  `PHP_IMAGE=<your image on the patched base>`; the version and branch gates still apply.
