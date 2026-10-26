#!/usr/bin/env bash
# verify.sh - deterministic, verify-only gate for php-upgrade-secure-verify. It never edits source.
#
# Runs the repository in hardened, network-less containers on the official image of a PATCHED PHP release and checks:
#   version  the container PHP is at or above the patched release, on the requested branch
#   manifest composer.json does not allow an unpatched PHP (exact check with Composer's own semver library)
#   lint     every .php/.phtml/.inc file parses (vendor/ included), and every file on disk was linted
#   tests    the test suite passes and at least one test really executed
# and writes verify-verdict.json at the repository root.
#
# Usage: verify.sh <REPO_PATH> [TARGET 8.2|8.3|8.4|8.5, default 8.4]
# Env:   PHP_IMAGE (default php:<floor>-cli)   COMPOSER_IMAGE (default composer:2)   CONTAINER_CLI (default docker)
#        LINT_VENDOR=0 skips vendor/           TEST_TIMEOUT seconds (default 600)    PHPUNIT_EXCLUDE_GROUP=network,...
# Exit:  0 PASS | 2 version, branch or manifest FAIL | 3 lint FAIL | 4 test FAIL | 5 INCONCLUSIVE (no test executed) | 9 BLOCKED
set -uo pipefail

REPO_IN="${1:?usage: verify.sh <repo> [8.2|8.3|8.4|8.5]}"
TARGET_IN="${2:-8.4}"
TARGET="$(printf '%s' "$TARGET_IN" | tr -cd '0-9A-Za-z._-' | cut -c1-16)"   # only safe characters reach the JSON file
CLI="${CONTAINER_CLI:-docker}"
LINT_VENDOR="${LINT_VENDOR:-1}"; [ "$LINT_VENDOR" = 0 ] || LINT_VENDOR=1
TEST_TIMEOUT="$(printf '%s' "${TEST_TIMEOUT:-600}" | tr -cd '0-9' | cut -c1-6)"; TEST_TIMEOUT="${TEST_TIMEOUT:-600}"
EXCL="$(printf '%s' "${PHPUNIT_EXCLUDE_GROUP:-}" | tr -cd 'A-Za-z0-9_,-' | cut -c1-200)"
COMPOSER_IMAGE="${COMPOSER_IMAGE:-composer:2}"

# Patched floors (PHP releases of 2026-10-21). This table and UNPATCHED are the single source of truth.
case "$TARGET_IN" in
  8.2) FLOOR="8.2.35";; 8.3) FLOOR="8.3.36";; 8.4) FLOOR="8.4.27";; 8.5) FLOOR="8.5.12";;
  *)   FLOOR="?";;
esac
UNPATCHED='<8.2.35 || >=8.3.0 <8.3.36 || >=8.4.0 <8.4.27 || >=8.5.0 <8.5.12'   # every release that is unpatched or end of life

# Verdict fields (globals, all sanitised before they reach JSON).
PHPVER=""; VGATE="SKIPPED"; MGATE="SKIPPED"; MREQ=""; MPLAT=""; MREASON=""; LGATE="SKIPPED"; LFILES=0; LFAILS=0
TGATE="SKIPPED"; TESTS=0; NOTE=""; WARN=()
GIT_COMMIT=""; GIT_BRANCH=""; GIT_DIRTY="null"

REPO="$(cd "$REPO_IN" 2>/dev/null && pwd -P)" || {
  echo "BLOCKED: repo path not found: $(printf '%s' "$REPO_IN" | tr -c '[:print:]' '?')" >&2; exit 9; }

clean() { printf '%s' "$1" | tr -cd '0-9A-Za-z .,:;<>=|~^*()_/+-' | cut -c1-300; }
oneof() { case " $2 " in *" $1 "*) printf '%s' "$1";; *) printf '%s' "$3";; esac; }   # value whitelist

finish() { # verdict exit summary
  local verdict="$1" code="$2" summary cves='[]' warn='[]' w evidence tmp
  summary="$(clean "$3")"
  [ "$verdict" = PASS ] && cves='["CVE-2026-109618", "CVE-2026-109619"]'
  case "$TGATE" in PASS) evidence="executed-tests";; *) evidence="static-only";; esac
  [ "$LGATE" = PASS ] || [ "$LGATE" = FAIL ] || evidence="not-run"
  if [ "${#WARN[@]}" -gt 0 ]; then warn="["; for w in "${WARN[@]}"; do warn="$warn\"$(clean "$w")\", "; done; warn="${warn%, }]"; fi
  rm -f "$REPO/verify-verdict.json"                        # drop a stale (or symlinked) verdict first
  tmp="$(mktemp "$REPO/.verify-verdict.XXXXXX")" || { echo "BLOCKED: cannot write in the repository" >&2; exit 9; }
  cat > "$tmp" <<JSON || { rm -f "$tmp"; echo "BLOCKED: cannot write the verdict" >&2; exit 9; }
{
  "verdict": "$verdict",
  "target_branch": "$TARGET",
  "patched_floor": "$FLOOR",
  "php_version": "$(clean "$PHPVER")",
  "version_gate": "$VGATE",
  "manifest_gate": "$MGATE",
  "manifest_require_php": "$(clean "$MREQ")",
  "manifest_platform_php": "$(clean "$MPLAT")",
  "manifest_reason": "$(clean "$MREASON")",
  "lint_gate": "$LGATE",
  "lint_files": $LFILES,
  "lint_failures": $LFAILS,
  "vendor_linted": $([ "$LINT_VENDOR" = 1 ] && echo true || echo false),
  "test_gate": "$TGATE",
  "tests_ran": $TESTS,
  "evidence_level": "$evidence",
  "patched_runtime_cves": $cves,
  "gate_exit_code": $code,
  "git_commit": "$(clean "$GIT_COMMIT")",
  "git_branch": "$(clean "$GIT_BRANCH")",
  "git_dirty": $GIT_DIRTY,
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "warnings": $warn,
  "note": "$(clean "$NOTE")",
  "summary": "$summary"
}
JSON
  chmod 644 "$tmp"; mv -f "$tmp" "$REPO/verify-verdict.json" || { rm -f "$tmp"; echo "BLOCKED: cannot write the verdict" >&2; exit 9; }
  echo "$summary"; exit "$code"
}

# Git metadata ties the verdict to a commit (empty when the path is not a git checkout).
if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  GIT_COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)"
  GIT_BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    GIT_DIRTY=true; WARN+=("tracked files have uncommitted changes: the verdict may not match git_commit")
  else GIT_DIRTY=false; fi
fi

# --- Phase 0: preconditions -> BLOCKED ------------------------------------------------------------
[ "$FLOOR" != "?" ] || finish BLOCKED 9 "BLOCKED: unknown target '$TARGET' (use 8.2, 8.3, 8.4 or 8.5)"
[ "$TARGET_IN" = 8.2 ] && WARN+=("PHP 8.2 reaches end of life on 2026-12-31: prefer 8.4 or 8.5")
[ "$LINT_VENDOR" = 1 ] || WARN+=("vendor/ was not linted (LINT_VENDOR=0)")
case "$CLI" in docker|podman|finch|nerdctl) ;; *) finish BLOCKED 9 "BLOCKED: CONTAINER_CLI must be docker, podman, finch or nerdctl";; esac
"$CLI" info >/dev/null 2>&1 || finish BLOCKED 9 "BLOCKED: $CLI is not runnable"
RUNIMG="${PHP_IMAGE:-php:$FLOOR-cli}"
for img in "$RUNIMG" "$COMPOSER_IMAGE"; do
  case "$img" in -*|*[!A-Za-z0-9._/:@-]*|"") finish BLOCKED 9 "BLOCKED: invalid image name";; esac
done
getimg() { "$CLI" image inspect "$1" >/dev/null 2>&1 || "$CLI" pull -q "$1" >/dev/null 2>&1; }
getimg "$RUNIMG" || finish BLOCKED 9 "BLOCKED: cannot get the PHP image (check network or PHP_IMAGE)"
if [ -L "$REPO/composer.json" ]; then finish BLOCKED 9 "BLOCKED: composer.json is a symlink"; fi

# Count on the host the files the container must lint; any find error (permissions, loops) means we cannot know coverage.
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/verify.XXXXXX")" || finish BLOCKED 9 "BLOCKED: cannot create a temporary directory"
trap 'rm -f "$TMPD"/err "$TMPD"/list; rmdir "$TMPD" 2>/dev/null' EXIT
if [ "$LINT_VENDOR" = 1 ]; then PRUNE=(-path ./.git); else PRUNE=( \( -path ./.git -o -path ./vendor \) ); fi
( cd "$REPO" && find -L . "${PRUNE[@]}" -prune -o \( -name '*.php' -o -name '*.phtml' -o -name '*.inc' \) -type f -print0 ) \
  >"$TMPD/list" 2>"$TMPD/err"
HOSTCOUNT="$(tr -cd '\000' <"$TMPD/list" | wc -c | tr -d ' ')"
[ -s "$TMPD/err" ] && finish BLOCKED 9 "BLOCKED: some paths in the repository cannot be read or loop (fix permissions or symlinks)"

# --- Phase 1: version, lint and tests inside one hardened, network-less container -----------------
# POSIX sh only (works on Alpine images too). Values come in through -e; nothing from the host is spliced into the script.
# shellcheck disable=SC2016  # expanded inside the container, on purpose
INNER='
echo "PHPVER=$(php -r "echo PHP_VERSION;")"
echo "PHPBRANCH=$(php -r "echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;")"
php -r "exit(version_compare(PHP_VERSION, getenv(\"FLOOR\"), \">=\") ? 0 : 1);" && echo "VERSION_GATE=PASS" || echo "VERSION_GATE=FAIL"
if [ "$LV" = 1 ]; then
  find -L . -path ./.git -prune -o \( -name "*.php" -o -name "*.phtml" -o -name "*.inc" \) -type f -print0 >/tmp/files 2>/tmp/ferr
else
  find -L . \( -path ./.git -o -path ./vendor \) -prune -o \( -name "*.php" -o -name "*.phtml" -o -name "*.inc" \) -type f -print0 >/tmp/files 2>/tmp/ferr
fi
echo "LINT_FOUND=$(tr -cd "\000" </tmp/files | wc -c | tr -d " ")"
echo "FIND_ERRORS=$(wc -l </tmp/ferr | tr -d " ")"
xargs -0 -n 50 -P 4 sh -c "for f; do if php -l \"\$f\" >/dev/null 2>&1; then echo LINT_OK; else echo \"LINT_FAIL=\$(printf %s \"\$f\" | tr -c \"[:print:]\" \"?\")\"; fi; done" sh </tmp/files >/tmp/lint.txt 2>&1
echo "LINT_DONE=$(grep -c "^LINT_" /tmp/lint.txt)"
echo "LINT_FAILS=$(grep -c "^LINT_FAIL=" /tmp/lint.txt)"
grep "^LINT_FAIL=" /tmp/lint.txt | head -20
if [ -x vendor/bin/phpunit ] && { [ -f phpunit.xml ] || [ -f phpunit.xml.dist ] || [ -d tests ]; }; then
  if [ -f phpunit.xml ] || [ -f phpunit.xml.dist ]; then set -- --do-not-cache-result; else set -- --do-not-cache-result --no-configuration tests; fi
  [ -n "$EXCL" ] && set -- "$@" --exclude-group "$EXCL"
  if timeout -k 1 1 true 2>/dev/null; then TO="timeout -k 10 $TT"; else TO="timeout $TT"; fi
  $TO vendor/bin/phpunit "$@" >/tmp/pu.txt 2>&1; echo "PU_RC=$?"
  N=$(grep -Eo "OK \([0-9]+ test" /tmp/pu.txt | grep -Eo "[0-9]+" | head -1)
  [ -n "$N" ] || N=$(grep -Eo "Tests: [0-9]+" /tmp/pu.txt | grep -Eo "[0-9]+" | tail -1)
  S=$(grep -Eo "Skipped: [0-9]+" /tmp/pu.txt | grep -Eo "[0-9]+" | tail -1)
  I=$(grep -Eo "Incomplete: [0-9]+" /tmp/pu.txt | grep -Eo "[0-9]+" | tail -1)
  K=$(grep -Eo "Risky: [0-9]+" /tmp/pu.txt | grep -Eo "[0-9]+" | tail -1)
  echo "TESTS_RAN=$(( ${N:-0} - ${S:-0} - ${I:-0} - ${K:-0} ))"
  grep -q "No tests executed" /tmp/pu.txt && echo "NO_TESTS=1"
  tail -6 /tmp/pu.txt | tr -c "[:print:]\n" "?" | sed "s/^/PU: /"
else
  echo "PU_RC=none"
  if [ -d tests ] || [ -f phpunit.xml ] || [ -f phpunit.xml.dist ]; then
    echo "NOTE=tests exist but vendor/bin/phpunit is missing: run composer install first"
  else echo "NOTE=no test suite found"; fi
fi'
OUT="$("$CLI" run --rm --network none --read-only \
  --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m --memory 2g --pids-limit 256 --cpus 2 \
  -e FLOOR="$FLOOR" -e LV="$LINT_VENDOR" -e TT="$TEST_TIMEOUT" -e EXCL="$EXCL" \
  --mount type=bind,source="$REPO",target=/app,readonly -w /app "$RUNIMG" sh -c "$INNER" 2>&1)"; CRC=$?
echo "$OUT"
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -1; }
num() { local v; v="$(val "$1" | tr -cd '0-9' | cut -c1-9)"; printf '%s' "${v:-0}"; }

PHPVER="$(val PHPVER | tr -cd '0-9A-Za-z.+~_-')"
BRANCH="$(val PHPBRANCH | tr -cd '0-9.')"
[ -n "$PHPVER" ] || finish BLOCKED 9 "BLOCKED: the container did not report a PHP version (exit $CRC; is php in the image?)"
case "$CRC" in 137) finish BLOCKED 9 "BLOCKED: the container was killed (out of memory?)";; 125|126|127) finish BLOCKED 9 "BLOCKED: the container could not start (exit $CRC)";; esac
VGATE="$(oneof "$(val VERSION_GATE)" "PASS FAIL" FAIL)"
[ "$VGATE" = PASS ] && [ "$BRANCH" != "$TARGET" ] && VGATE="BRANCH-MISMATCH"
LFOUND="$(num LINT_FOUND)"; LDONE="$(num LINT_DONE)"; LFAILS="$(num LINT_FAILS)"; FERR="$(num FIND_ERRORS)"; LFILES="$LDONE"
if   [ "$HOSTCOUNT" -eq 0 ];  then LGATE="NO-FILES"
elif [ "$LFAILS" -gt 0 ];     then LGATE="FAIL"                 # a real parse error is definitive, even if coverage is short
elif [ "$FERR" -gt 0 ] || [ "$LFOUND" -ne "$HOSTCOUNT" ] || [ "$LDONE" -ne "$LFOUND" ]; then LGATE="COVERAGE-MISMATCH"
else LGATE="PASS"; fi
PURC="$(val PU_RC | tr -cd '0-9a-z')"; TESTS="$(num TESTS_RAN)"; NOTE="$(val NOTE)"
case "$PURC" in
  none)    TGATE="NOT-RUN";;
  0)       if [ "$TESTS" -ge 1 ] && [ -z "$(val NO_TESTS)" ]; then TGATE="PASS"
           else TGATE="NOT-RUN"; TESTS=0; NOTE="phpunit executed no test (none found, or all skipped, incomplete or risky)"; fi;;
  124|143) TGATE="TIMEOUT"; TESTS=0; NOTE="the test suite did not finish within ${TEST_TIMEOUT}s";;
  137)     TGATE="KILLED";  TESTS=0; NOTE="the test suite was killed (out of memory, or it ignored the timeout)";;
  *)       if [ -n "$(val NO_TESTS)" ]; then TGATE="NOT-RUN"; NOTE="phpunit found no test to execute"; else TGATE="FAIL"; fi; TESTS=0;;
esac

# --- Phase 2: manifest gate, exact, with Composer's semver library (also network-less, read-only) --------------------
if [ -f "$REPO/composer.json" ]; then
  if getimg "$COMPOSER_IMAGE"; then
    # shellcheck disable=SC2016  # PHP source, not shell
    MCODE='require "phar:///tmp/c.phar/vendor/autoload.php";
use Composer\Semver\VersionParser; use Composer\Semver\Intervals; use Composer\Semver\Semver;
$o = function ($k, $v) { echo $k, "=", preg_replace("/[^0-9A-Za-z .,:;<>=|~^*()_\/+-]/", "?", substr((string) $v, 0, 200)), "\n"; };
$j = json_decode((string) @file_get_contents("/m/composer.json"), true);
if (!is_array($j)) { $o("MANIFEST_GATE", "FAIL"); $o("MANIFEST_REASON", "composer.json is not valid JSON"); exit(0); }
$req = $j["require"]["php"] ?? null; $plat = $j["config"]["platform"]["php"] ?? null;
$o("MANIFEST_REQUIRE", is_string($req) ? $req : "none"); $o("MANIFEST_PLATFORM", is_string($plat) ? $plat : "none");
$p = new VersionParser(); $bad = $p->parseConstraints(getenv("UNPATCHED")); $why = [];
if (!is_string($req)) { $why[] = "require.php is missing, so any PHP release is allowed"; }
else { try { $c = $p->parseConstraints($req);
  if (Intervals::haveIntersections($c, $bad)) { $why[] = "require.php allows unpatched or end-of-life PHP"; }
  if (!Semver::satisfies(getenv("RUNTIME"), $req)) { $why[] = "require.php does not allow the verified runtime " . getenv("RUNTIME"); }
} catch (\Throwable $e) { $why[] = "require.php is not a valid Composer constraint"; } }
if (is_string($plat)) { try { if (Semver::satisfies($plat, getenv("UNPATCHED"))) { $why[] = "config.platform.php pins an unpatched release"; } }
  catch (\Throwable $e) { $why[] = "config.platform.php is not a valid version"; } }
$o("MANIFEST_GATE", $why ? "FAIL" : "PASS"); $o("MANIFEST_REASON", implode("; ", $why));'
    # shellcheck disable=SC2016
    MOUT="$("$CLI" run --rm --network none --read-only \
      --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges \
      --tmpfs /tmp:rw,noexec,nosuid,size=64m --memory 512m --pids-limit 64 \
      -e UNPATCHED="$UNPATCHED" -e RUNTIME="$PHPVER" -e MCODE="$MCODE" \
      --mount type=bind,source="$REPO/composer.json",target=/m/composer.json,readonly \
      --entrypoint sh "$COMPOSER_IMAGE" -c 'cp "$(command -v composer)" /tmp/c.phar && php -r "$MCODE"' 2>&1)"
    printf '%s\n' "$MOUT" | while IFS= read -r l; do printf 'MANIFEST: %s\n' "$l"; done
    MGATE="$(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_GATE=//p' | head -1)"
    MREQ="$(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_REQUIRE=//p' | head -1)"
    MPLAT="$(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_PLATFORM=//p' | head -1)"
    MREASON="$(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_REASON=//p' | head -1)"
    MGATE="$(oneof "$MGATE" "PASS FAIL" ERROR)"
  else MGATE="ERROR"; MREASON="cannot get the Composer image (check network or COMPOSER_IMAGE)"; fi
else
  MGATE="NO-MANIFEST"; WARN+=("no composer.json: nothing declares which PHP releases the code allows")
fi

# --- Decision: FAIL beats BLOCKED beats INCONCLUSIVE beats PASS ----------------------------------------------------
F=(); FCODE=0
add() { F+=("$2"); [ "$FCODE" -eq 0 ] && FCODE="$1"; }
[ "$VGATE" = FAIL ]            && add 2 "runtime $PHPVER is below the patched release $FLOOR"
[ "$VGATE" = BRANCH-MISMATCH ] && add 2 "runtime $PHPVER is on branch $BRANCH, not $TARGET"
[ "$MGATE" = FAIL ]            && add 2 "composer.json: $MREASON"
[ "$LGATE" = FAIL ]            && add 3 "php -l failed on $LFAILS file(s)"
[ "$TGATE" = FAIL ]            && add 4 "the test suite failed"
if [ "${#F[@]}" -gt 0 ]; then S="FAIL: ${F[0]}"; for x in "${F[@]:1}"; do S="$S; $x"; done; finish FAIL "$FCODE" "$S on patched $PHPVER"; fi
[ "$MGATE" = ERROR ]                && finish BLOCKED 9 "BLOCKED: manifest not checked: ${MREASON:-the Composer check did not run}"
[ "$LGATE" = NO-FILES ]             && finish BLOCKED 9 "BLOCKED: no PHP file found to lint (wrong path?)"
[ "$LGATE" = COVERAGE-MISMATCH ]    && finish BLOCKED 9 "BLOCKED: the container linted $LDONE of $HOSTCOUNT files (unreadable paths, or symlinks that leave the repository)"
case "$TGATE" in TIMEOUT|KILLED) finish BLOCKED 9 "BLOCKED: $NOTE";; esac
[ "$TGATE" = NOT-RUN ]              && finish INCONCLUSIVE 5 "INCONCLUSIVE: patched $PHPVER, manifest and lint clean, but no test executed ($NOTE)"
[ "$TGATE" = PASS ] || finish BLOCKED 9 "BLOCKED: unexpected test result"
finish PASS 0 "PASS: $TESTS test(s) executed and passed, manifest and lint clean, on patched $PHPVER"
