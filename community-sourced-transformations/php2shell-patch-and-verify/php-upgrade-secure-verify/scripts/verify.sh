#!/usr/bin/env bash
# verify.sh - deterministic verify-only gate for php-upgrade-secure-verify.
# Runs the migrated repo in a hardened, network-less container on the official PATCHED
# PHP image, asserts the patched-version floor and the target branch, lints every PHP
# file, runs tests or a static smoke, and writes verify-verdict.json. Never edits source.
#
# Usage: verify.sh <REPO_PATH> [TARGET 8.2|8.3|8.4|8.5]   (optional: PHP_IMAGE=your-image to use your own build)
# Exit:  0 PASS | 2 version/branch FAIL | 3 lint FAIL | 4 test FAIL | 9 BLOCKED
set -uo pipefail

REPO_IN="${1:?usage: verify.sh <repo> [8.2|8.3|8.4|8.5]}"
TARGET_IN="${2:-8.4}"
# Only [0-9A-Za-z._-] may reach the JSON file or the summary line.
TARGET="$(printf '%s' "$TARGET_IN" | tr -cd '0-9A-Za-z._-' | cut -c1-16)"
NOTE=""; TESTS=0

# First release of each branch that carries the PHP2Shell fix (2026-10-21).
case "$TARGET_IN" in
  8.2) FLOOR="8.2.35";; 8.3) FLOOR="8.3.36";; 8.4) FLOOR="8.4.27";; 8.5) FLOOR="8.5.12";;
  *)   FLOOR="?";;
esac

REPO="$(cd "$REPO_IN" 2>/dev/null && pwd -P)" || { echo "BLOCKED: repo path not found: $(printf '%s' "$REPO_IN" | tr -c '[:print:]' '?')" >&2; exit 9; }

write_verdict() { # verdict version version_gate lint test evidence exit summary
  local cve='[]' tmp
  [ "$1" = "PASS" ] && cve='["CVE-2026-109618", "CVE-2026-109619"]'
  rm -f "$REPO/verify-verdict.json"                      # drop a stale (or symlinked) verdict first
  tmp="$(mktemp "$REPO/.verify-verdict.XXXXXX")" || { echo "BLOCKED: cannot write in $REPO" >&2; exit 9; }
  cat > "$tmp" <<JSON || { rm -f "$tmp"; echo "BLOCKED: cannot write verdict" >&2; exit 9; }
{
  "verdict": "$1",
  "target_branch": "$TARGET",
  "patched_floor": "$FLOOR",
  "php_version": "$2",
  "version_gate": "$3",
  "lint_gate": "$4",
  "test_gate": "$5",
  "evidence_level": "$6",
  "cve_addressed": $cve,
  "gate_exit_code": $7,
  "tests_ran": $TESTS,
  "note": "$NOTE",
  "summary": "$8"
}
JSON
  chmod 644 "$tmp"; mv -f "$tmp" "$REPO/verify-verdict.json" || { rm -f "$tmp"; echo "BLOCKED: cannot write verdict" >&2; exit 9; }
  echo "$8"
}

# --- Phase 0: preconditions -> BLOCKED on failure --------------------------------
if [ "$FLOOR" = "?" ]; then
  write_verdict BLOCKED "" SKIPPED SKIPPED not-run not-run 9 "BLOCKED: unknown target '$TARGET' (use 8.2, 8.3, 8.4 or 8.5)"; exit 9
fi
if ! docker info >/dev/null 2>&1; then
  write_verdict BLOCKED "" SKIPPED SKIPPED not-run not-run 9 "BLOCKED: docker not runnable"; exit 9
fi
RUNIMG="${PHP_IMAGE:-php:$FLOOR-cli}"
case "$RUNIMG" in -*) write_verdict BLOCKED "" SKIPPED SKIPPED not-run not-run 9 "BLOCKED: invalid PHP_IMAGE"; exit 9;; esac
if ! docker image inspect "$RUNIMG" >/dev/null 2>&1; then
  docker pull -q "$RUNIMG" >/dev/null 2>&1 || {
    write_verdict BLOCKED "" SKIPPED SKIPPED not-run not-run 9 "BLOCKED: cannot get the PHP image (check network or PHP_IMAGE)"; exit 9; }
fi

# --- Run everything inside one hardened, network-less container ------------------
# The container prints machine-readable lines we parse below. Nothing runs on the host.
# POSIX sh only, so it also works on Alpine-based images. File names are sanitised before printing.
OUT="$(docker run --rm --network none --read-only \
  --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m --memory 2g --pids-limit 256 --cpus 2 \
  --mount type=bind,source="$REPO",target=/app,readonly -w /app "$RUNIMG" sh -c '
    echo "PHPVER=$(php -r "echo PHP_VERSION;")"
    echo "PHPBRANCH=$(php -r "echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;")"
    php -r "exit(version_compare(PHP_VERSION,\"'"$FLOOR"'\",\">=\")?0:1);" \
      && echo "VERSION_GATE=PASS" || echo "VERSION_GATE=FAIL"
    # lint every php/phtml/inc file outside vendor, following symlinked dirs, safe for spaces in names
    find -L . \( -name "*.php" -o -name "*.phtml" -o -name "*.inc" \) -type f -not -path "./vendor/*" \
      -exec sh -c '"'"'for f; do if php -l "$f" >/dev/null 2>&1; then echo "LINT_OK"; else echo "LINT_FAIL=$(printf "%s" "$f" | tr -c "[:print:]" "?")"; fi; done'"'"' sh {} + >/tmp/lint.txt 2>&1
    echo "LINT_COUNT=$(grep -c "^LINT_" /tmp/lint.txt)"
    grep "^LINT_FAIL=" /tmp/lint.txt | head -20
    if grep -q "^LINT_FAIL=" /tmp/lint.txt; then echo "LINT_GATE=FAIL"; else echo "LINT_GATE=PASS"; fi
    # tests if a usable suite exists, else static smoke. At least ONE test must really run (not be skipped).
    if [ -x vendor/bin/phpunit ] && { [ -f phpunit.xml ] || [ -f phpunit.xml.dist ] || [ -d tests ]; }; then
      if [ -f phpunit.xml ] || [ -f phpunit.xml.dist ]; then PUARGS="--do-not-cache-result"; else PUARGS="--do-not-cache-result --no-configuration tests"; fi
      if vendor/bin/phpunit $PUARGS >/tmp/pu.txt 2>&1; then
        N=$(grep -Eo "OK \([0-9]+ test" /tmp/pu.txt | grep -Eo "[0-9]+" | head -1)
        [ -n "$N" ] || N=$(grep -Eo "Tests: [0-9]+" /tmp/pu.txt | grep -Eo "[0-9]+" | head -1)
        S=$(grep -Eo "Skipped: [0-9]+" /tmp/pu.txt | grep -Eo "[0-9]+" | head -1)
        R=$(( ${N:-0} - ${S:-0} ))
        echo "TESTS_RAN=$R"
        if [ "$R" -ge 1 ]; then echo "TEST_GATE=PASS"; else echo "TEST_GATE=STATIC-SMOKE"; echo "NOTE=phpunit ran no test (zero found or all skipped)"; fi
      else echo "TEST_GATE=FAIL"; fi
      tail -4 /tmp/pu.txt | sed "s/^/PU: /"
    else
      echo "TEST_GATE=STATIC-SMOKE"
      if [ -d tests ] || [ -f phpunit.xml ] || [ -f phpunit.xml.dist ]; then
        echo "NOTE=tests exist but vendor/bin/phpunit is missing: run composer install first"
      else echo "NOTE=no test suite found"; fi
    fi
  ' 2>&1)"

echo "$OUT"

# Machine lines are anchored at the start of a line; file names were sanitised, so they cannot forge them.
PHPVER="$(printf '%s\n' "$OUT" | sed -n 's/^PHPVER=//p' | head -1 | tr -cd '0-9A-Za-z.+~_-')"
BRANCH="$(printf '%s\n' "$OUT" | sed -n 's/^PHPBRANCH=//p' | head -1 | tr -cd '0-9.')"
VGATE="$(printf '%s\n' "$OUT"  | sed -n 's/^VERSION_GATE=//p' | head -1)"
LGATE="$(printf '%s\n' "$OUT"  | sed -n 's/^LINT_GATE=//p' | head -1)"
LCOUNT="$(printf '%s\n' "$OUT" | sed -n 's/^LINT_COUNT=//p' | head -1 | tr -cd '0-9')"
TGATE="$(printf '%s\n' "$OUT"  | sed -n 's/^TEST_GATE=//p' | head -1)"
TESTS="$(printf '%s\n' "$OUT"  | sed -n 's/^TESTS_RAN=//p' | head -1 | tr -cd '0-9')"; TESTS="${TESTS:-0}"
NOTE="$(printf '%s\n' "$OUT"   | sed -n 's/^NOTE=//p' | head -1 | tr -cd '0-9A-Za-z .,:()_/-')"
VGATE="${VGATE:-FAIL}"; LGATE="${LGATE:-FAIL}"; TGATE="${TGATE:-FAIL}"; LCOUNT="${LCOUNT:-0}"

# --- Decision ---------------------------------------------------------------------
if [ -z "$PHPVER" ]; then
  write_verdict BLOCKED "" SKIPPED SKIPPED not-run not-run 9 "BLOCKED: the container did not report a PHP version (is php in the image?)"; exit 9
fi
if [ "$VGATE" != "PASS" ]; then
  write_verdict FAIL "$PHPVER" "$VGATE" "$LGATE" "$TGATE" not-run 2 \
    "FAIL: runtime $PHPVER is below patched floor $FLOOR (still vulnerable to PHP2Shell)"; exit 2
fi
if [ "$BRANCH" != "$TARGET" ]; then
  write_verdict FAIL "$PHPVER" "BRANCH-MISMATCH" "$LGATE" "$TGATE" not-run 2 \
    "FAIL: runtime $PHPVER is on branch $BRANCH, not the requested target $TARGET"; exit 2
fi
if [ "$LCOUNT" -eq 0 ]; then
  write_verdict BLOCKED "$PHPVER" "$VGATE" "NO-FILES" SKIPPED not-run 9 \
    "BLOCKED: no PHP file found to lint (wrong path, or everything is under vendor/)"; exit 9
fi
if [ "$LGATE" != "PASS" ]; then
  write_verdict FAIL "$PHPVER" "$VGATE" "$LGATE" "$TGATE" executed 3 \
    "FAIL: php -l reported a syntax error on patched $PHPVER"; exit 3
fi
if [ "$TGATE" = "FAIL" ]; then
  write_verdict FAIL "$PHPVER" "$VGATE" "$LGATE" "$TGATE" executed-tests 4 \
    "FAIL: test suite failed on patched $PHPVER"; exit 4
fi
if [ "$TGATE" = "STATIC-SMOKE" ]; then
  write_verdict PASS "$PHPVER" "$VGATE" "$LGATE" "STATIC-SMOKE" static-smoke 0 \
    "PASS (static-smoke): code lints clean on patched $PHPVER, but no test was executed ($NOTE)"; exit 0
fi
if [ "$TGATE" != "PASS" ]; then
  write_verdict BLOCKED "$PHPVER" "$VGATE" "$LGATE" "$TGATE" not-run 9 "BLOCKED: unexpected test gate result"; exit 9
fi
write_verdict PASS "$PHPVER" "$VGATE" "$LGATE" "$TGATE" executed-tests 0 \
  "PASS: migrated code runs clean (tests + lint) on patched $PHPVER"; exit 0
