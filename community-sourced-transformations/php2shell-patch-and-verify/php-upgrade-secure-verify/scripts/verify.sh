#!/usr/bin/env bash
# verify.sh - deterministic, verify-only gate for php-upgrade-secure-verify. It never edits source.
#
# Runs the repository in hardened, network-less containers on the official image of a PATCHED PHP release (by default)
# and checks:
#   version  the container PHP is at or above the patched release, on the requested branch
#   manifest composer.json allows the patched branch and no unpatched or end-of-life release (Composer's own semver library)
#   lint     every PHP source file parses, vendor/ included, and every file found on the host was linted in the container
#   tests    the test suite passes and at least one test executed (PHPUnit summary and JUnit log agree)
# and writes verify-verdict.json at the repository root. PHP source files: *.php *.phtml *.inc *.php5 *.php7 *.php8 *.module
# *.install *.theme *.engine *.profile (any case), plus executable files without an extension whose first line names php.
#
# Usage: verify.sh <REPO_PATH> [TARGET 8.2|8.3|8.4|8.5, default 8.4]
# Env:   PHP_IMAGE (default php:<floor>-cli)  COMPOSER_IMAGE (default composer:2)  CONTAINER_CLI (default docker)
#        TEST_TIMEOUT seconds (default 600)  TMP_SIZE (default 256m)  PHPUNIT_CONFIG=<path>  PHPUNIT_EXCLUDE_GROUP=a,b
#        LINT_VENDOR=0 skips vendor/ (diagnostic only: never PASS)
# Trust: the repository, its vendor/ and its tests are trusted input. A hostile repository can fake test output; the
#        containers limit what it can reach, they do not authenticate its results.
# Exit:  0 PASS | 2 version, branch or manifest FAIL | 3 lint FAIL | 4 test FAIL | 5 INCONCLUSIVE | 9 BLOCKED
set -uo pipefail

REPO_IN="${1:?usage: verify.sh <repo> [8.2|8.3|8.4|8.5]}"
TARGET_IN="${2:-8.4}"
TARGET="$(printf '%s' "$TARGET_IN" | tr -cd '0-9A-Za-z._-' | cut -c1-16)"   # only safe characters reach the JSON file
CLI="${CONTAINER_CLI:-docker}"
LINT_VENDOR="${LINT_VENDOR:-1}"; [ "$LINT_VENDOR" = 0 ] || LINT_VENDOR=1
TEST_TIMEOUT="$(printf '%s' "${TEST_TIMEOUT:-}" | tr -cd '0-9' | cut -c1-6)"; [ "${TEST_TIMEOUT:-0}" -gt 0 ] 2>/dev/null || TEST_TIMEOUT=600
TMP_SIZE="$(printf '%s' "${TMP_SIZE:-256m}" | tr -cd '0-9kmg' | cut -c1-8)"; TMP_SIZE="${TMP_SIZE:-256m}"
EXCL="$(printf '%s' "${PHPUNIT_EXCLUDE_GROUP:-}" | tr -cd 'A-Za-z0-9_,-' | cut -c1-200)"
PUCONF="$(printf '%s' "${PHPUNIT_CONFIG:-}" | tr -cd 'A-Za-z0-9._/-' | cut -c1-200)"
case "$PUCONF" in /*|*..*) PUCONF="INVALID";; esac
COMPOSER_IMAGE="${COMPOSER_IMAGE:-composer:2}"
NEWEST_BRANCH="8.5"; NEWEST_IMAGE="php:8.5.12-cli"   # only to tell "needs a newer PHP" apart from "broken", for vendor/ files

# Patched floors (PHP releases of 2026-10-21): the single source in this script. UNPATCHED is derived from it.
FLOORS="8.2.35 8.3.36 8.4.27 8.5.12"
FLOOR="?"; UNPATCHED=""
for f in $FLOORS; do
  b="${f%.*}"; [ "$b" = "$TARGET_IN" ] && FLOOR="$f"
  if [ -z "$UNPATCHED" ]; then UNPATCHED="<$f"; else UNPATCHED="$UNPATCHED || >=$b.0 <$f"; fi
done   # => <8.2.35 || >=8.3.0 <8.3.36 || >=8.4.0 <8.4.27 || >=8.5.0 <8.5.12 (everything unpatched or end of life)

# Verdict fields (globals, all sanitised before they reach JSON).
PHPVER=""; VGATE="SKIPPED"; MGATE="SKIPPED"; MREQ=""; MPLAT=""; MREASON=""; LGATE="SKIPPED"; LFILES=0; LFAILS=0
TGATE="SKIPPED"; TESTS=0; TSKIP=0; NOTE=""; WARN=(); IMG_ID=""; RUNIMG=""; VNEWER=0
GIT_COMMIT=""; GIT_BRANCH=""; GIT_DIRTY="null"

REPO="$(cd "$REPO_IN" 2>/dev/null && pwd -P)" || {
  echo "BLOCKED: repo path not found: $(printf '%s' "$REPO_IN" | tr -c '[:print:]' '?')" >&2; exit 9; }
rm -f "$REPO/verify-verdict.json"   # no stale verdict survives an aborted run: no file means no verdict

clean() { printf '%s' "$1" | tr -cd '0-9A-Za-z .,:;<>=|~^*()_/+-' | cut -c1-300; }
oneof() { case " $2 " in *" $1 "*) printf '%s' "$1";; *) printf '%s' "$3";; esac; }   # value whitelist
isnum() { case "$1" in ''|*[!0-9]*) return 1;; esac; }

finish() { # verdict exit summary
  local verdict="$1" code="$2" summary cves='[]' warn='[]' w evidence tmp
  summary="$(clean "$3")"
  [ "$verdict" = PASS ] && cves='["CVE-2026-109618", "CVE-2026-109619"]'
  case "$TGATE" in PASS) evidence="executed-tests";; *) evidence="static-only";; esac
  [ "$LGATE" = PASS ] || [ "$LGATE" = FAIL ] || evidence="not-run"
  if [ "${#WARN[@]}" -gt 0 ]; then warn="["; for w in "${WARN[@]}"; do warn="$warn\"$(clean "$w")\", "; done; warn="${warn%, }]"; fi
  rm -f "$REPO/verify-verdict.json"                        # a symlink is removed, never followed
  tmp="$(mktemp "$REPO/.verify-verdict.XXXXXX")" || { echo "BLOCKED: cannot write in the repository" >&2; exit 9; }
  cat > "$tmp" <<JSON || { rm -f "$tmp"; echo "BLOCKED: cannot write the verdict" >&2; exit 9; }
{
  "verdict": "$verdict",
  "target_branch": "$TARGET",
  "patched_floor": "$FLOOR",
  "php_image": "$(clean "$RUNIMG")",
  "php_image_id": "$(clean "$IMG_ID")",
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
  "vendor_files_needing_newer_php": $VNEWER,
  "test_gate": "$TGATE",
  "tests_ran": $TESTS,
  "tests_not_executed": $TSKIP,
  "excluded_groups": "$EXCL",
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

# Git metadata ties the verdict to a commit. Hooks and fsmonitor are disabled, and git takes no optional locks.
G() { GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$REPO" "$@"; }
if G rev-parse --git-dir >/dev/null 2>&1; then
  GIT_COMMIT="$(G rev-parse HEAD 2>/dev/null)"; GIT_BRANCH="$(G rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ -n "$(G status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    GIT_DIRTY=true; WARN+=("tracked files have uncommitted changes: the verdict may not match git_commit")
  else GIT_DIRTY=false; fi
  UNTR="$(G ls-files --others --exclude-standard 2>/dev/null | grep -v '^verify-verdict.json$' | grep -v '^VERIFY_REPORT.md$' | grep -c .)"
  [ "${UNTR:-0}" -gt 0 ] && WARN+=("$UNTR untracked file(s) were verified too but are not in git_commit")
fi

# --- Phase 0: preconditions -> BLOCKED ------------------------------------------------------------
[ "$FLOOR" != "?" ] || finish BLOCKED 9 "BLOCKED: unknown target '$TARGET' (use 8.2, 8.3, 8.4 or 8.5)"
[ "$PUCONF" != INVALID ] || finish BLOCKED 9 "BLOCKED: PHPUNIT_CONFIG must be a relative path inside the repository"
[ -z "$PUCONF" ] || [ -f "$REPO/$PUCONF" ] || finish BLOCKED 9 "BLOCKED: PHPUNIT_CONFIG file not found"
case "$REPO" in *,*|*\"*) finish BLOCKED 9 "BLOCKED: the repository path contains a comma or a quote; move it";; esac
[ "$TARGET_IN" = 8.2 ] && WARN+=("PHP 8.2 reaches end of life on 2026-12-31: prefer 8.4 or 8.5")
[ -n "$EXCL" ] && WARN+=("PHPUnit groups excluded: $EXCL")
case "$CLI" in docker|podman|finch|nerdctl) ;; *) finish BLOCKED 9 "BLOCKED: CONTAINER_CLI must be docker, podman, finch or nerdctl";; esac
"$CLI" info >/dev/null 2>&1 || finish BLOCKED 9 "BLOCKED: $CLI is not runnable"
RUNIMG="${PHP_IMAGE:-php:$FLOOR-cli}"
for img in "$RUNIMG" "$COMPOSER_IMAGE"; do
  case "$img" in -*|*[!A-Za-z0-9._/:@-]*|"") finish BLOCKED 9 "BLOCKED: invalid image name";; esac
done
getimg() { "$CLI" image inspect "$1" >/dev/null 2>&1 || "$CLI" pull -q "$1" >/dev/null 2>&1; }
getimg "$RUNIMG" || finish BLOCKED 9 "BLOCKED: cannot get the PHP image (check network or PHP_IMAGE)"
IMG_ID="$("$CLI" image inspect --format '{{.Id}}' "$RUNIMG" 2>/dev/null | head -1)"
[ -n "${PHP_IMAGE:-}" ] && WARN+=("custom PHP_IMAGE: provenance not verified, only the PHP version inside it")
[ -L "$REPO/composer.json" ] && finish BLOCKED 9 "BLOCKED: composer.json is a symlink"

# Symlinks must stay inside the repository (checked before any recursive walk, so a link to / is never followed).
while IFS= read -r -d '' l; do
  [ -e "$l" ] || continue                                                   # broken links are ignored by find -L too
  if [ -d "$l" ]; then d="$(cd -P "$l" 2>/dev/null && pwd -P)"; else
    t="$(readlink "$l")"; case "$t" in /*) ;; *) t="$(dirname "$l")/$t";; esac
    d="$(cd -P "$(dirname "$t")" 2>/dev/null && pwd -P)"; fi
  case "$d/" in "$REPO"/*) ;; *) finish BLOCKED 9 "BLOCKED: a symlink points outside the repository: $(printf '%s' "${l#"$REPO"/}" | tr -c '[:print:]' '?')";; esac
done < <(find "$REPO" -path "$REPO/.git" -prune -o -type l -print0 2>/dev/null)

# The file selection, identical on the host and in the container (POSIX find; shebang check for extensionless executables).
# shellcheck disable=SC2016
SELECT='LV="$1"; if [ "$LV" = 1 ]; then set -- -path ./.git; else set -- "(" -path ./.git -o -path ./vendor ")"; fi
find -L . "$@" -prune -o -type f "(" -iname "*.php" -o -iname "*.phtml" -o -iname "*.inc" -o -iname "*.php5" -o -iname "*.php7" -o -iname "*.php8" -o -iname "*.module" -o -iname "*.install" -o -iname "*.theme" -o -iname "*.engine" -o -iname "*.profile" ")" -print0
find -L . "$@" -prune -o -type f ! -name "*.*" -perm -0100 -exec sh -c "for f; do head -n 1 \"\$f\" 2>/dev/null | grep -q \"^#!.*php\" && printf \"%s\\0\" \"\$f\"; done" sh {} +'
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/verify.XXXXXX")" || finish BLOCKED 9 "BLOCKED: cannot create a temporary directory"
trap 'rm -f "$TMPD"/err "$TMPD"/list; rmdir "$TMPD" 2>/dev/null' EXIT
( cd "$REPO" && sh -c "$SELECT" sh "$LINT_VENDOR" ) >"$TMPD/list" 2>"$TMPD/err"
HOSTCOUNT="$(tr -cd '\000' <"$TMPD/list" | wc -c | tr -d ' ')"
isnum "$HOSTCOUNT" || finish BLOCKED 9 "BLOCKED: could not count the files to lint"
[ -s "$TMPD/err" ] && finish BLOCKED 9 "BLOCKED: some paths in the repository cannot be read or loop (fix permissions or symlinks)"

# --- Phase 1: version, lint and tests inside one hardened, network-less container -----------------
# POSIX sh only (works on Alpine images too). Values come in through -e; nothing from the host is spliced into the script.
# shellcheck disable=SC2016  # expanded inside the container, on purpose
INNER='
echo "PHPVER=$(php -r "echo PHP_VERSION;")"
echo "PHPBRANCH=$(php -r "echo PHP_MAJOR_VERSION.\".\".PHP_MINOR_VERSION;")"
php -r "exit(version_compare(PHP_VERSION, getenv(\"FLOOR\"), \">=\") ? 0 : 1);" && echo "VERSION_GATE=PASS" || echo "VERSION_GATE=FAIL"
sh -c "$SELECT" sh "$LV" >/tmp/files 2>/tmp/ferr
echo "LINT_FOUND=$(tr -cd "\000" </tmp/files | wc -c | tr -d " ")"
echo "FIND_ERRORS=$(wc -l </tmp/ferr | tr -d " ")"
xargs -0 -n 50 -P 4 sh -c "for f; do if [ ! -r \"\$f\" ]; then echo LINT_UNREADABLE; elif php -l \"\$f\" >/dev/null 2>&1; then echo LINT_OK; else echo \"LINT_FAIL=\$(printf %s \"\$f\" | tr -c \"[:print:]\" \"?\")\"; fi; done" sh </tmp/files >/tmp/lint.txt 2>&1
echo "LINT_DONE=$(grep -c "^LINT_" /tmp/lint.txt)"
echo "LINT_UNREAD=$(grep -c "^LINT_UNREADABLE" /tmp/lint.txt)"
echo "LINT_FAILS=$(grep -c "^LINT_FAIL=" /tmp/lint.txt)"
grep "^LINT_FAIL=" /tmp/lint.txt | head -50
CONF=""; for c in "$PUCONF" phpunit.xml phpunit.xml.dist phpunit.dist.xml; do [ -n "$c" ] && [ -f "$c" ] && { CONF="$c"; break; }; done
if [ -x vendor/bin/phpunit ] && { [ -n "$CONF" ] || [ -d tests ]; }; then
  if [ -n "$CONF" ]; then set -- --do-not-cache-result -c "$CONF"; else set -- --do-not-cache-result --no-configuration tests; fi
  [ -n "$EXCL" ] && set -- "$@" --exclude-group "$EXCL"
  if ! command -v timeout >/dev/null 2>&1; then echo "PU_RC=notimeout"
  else
    if timeout -k 1 1 true 2>/dev/null; then TO="timeout -k 10 $TT"; else TO="timeout $TT"; fi
    $TO vendor/bin/phpunit -d memory_limit=-1 --log-junit /tmp/junit.xml "$@" >/tmp/pu.txt 2>&1; echo "PU_RC=$?"
    # Second, independent count: non-skipped test cases in the JUnit log. A wrapper that only prints a summary has no log.
    echo "JUNIT=$(php -d memory_limit=-1 -r "if(!is_file(\"/tmp/junit.xml\")){echo \"missing\"; exit;} if(!function_exists(\"simplexml_load_file\")){echo \"unreadable\"; exit;} \$x=@simplexml_load_file(\"/tmp/junit.xml\"); if(!\$x){echo \"unreadable\"; exit;} \$n=0; foreach(\$x->xpath(\"//testcase\") as \$t){ if(!isset(\$t->skipped)) \$n++; } echo \$n;" 2>/dev/null)"
    # parse only PHPUnit summary lines: "OK (N tests, ...)" or "Tests: N, Assertions: M, Skipped: S, ..."
    grep -E "^(OK \([0-9]+ tests?, |Tests: [0-9]+, )" /tmp/pu.txt | tail -1 >/tmp/sum.txt
    N=$(grep -Eo "^OK \([0-9]+" /tmp/sum.txt | grep -Eo "[0-9]+"); [ -n "$N" ] || N=$(grep -Eo "^Tests: [0-9]+" /tmp/sum.txt | grep -Eo "[0-9]+")
    S=$(grep -Eo "Skipped: [0-9]+" /tmp/sum.txt | grep -Eo "[0-9]+")
    I=$(grep -Eo "Incomplete: [0-9]+" /tmp/sum.txt | grep -Eo "[0-9]+")
    K=$(grep -Eo "Risky: [0-9]+" /tmp/sum.txt | grep -Eo "[0-9]+")
    R=$(( ${N:-0} - ${S:-0} - ${I:-0} - ${K:-0} )); [ "$R" -lt 0 ] && R=0
    echo "TESTS_RAN=$R"; echo "TESTS_NOT_EXECUTED=$(( ${S:-0} + ${I:-0} + ${K:-0} ))"
    grep -q "No tests executed" /tmp/pu.txt && echo "NO_TESTS=1"
    grep -qiE "Read-only file system|No space left on device|failed to open stream: Permission denied" /tmp/pu.txt && echo "PU_ENV=1"
    tail -6 /tmp/pu.txt | tr -c "[:print:]\n" "?" | sed "s/^/PU: /"
  fi
else
  echo "PU_RC=none"
  if [ -d tests ] || [ -n "$CONF" ]; then echo "NOTE=tests exist but vendor/bin/phpunit is missing: run composer install first"
  else echo "NOTE=no test suite found"; fi
fi'
CRUN=(--rm --network none --read-only --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges
      --tmpfs "/tmp:rw,noexec,nosuid,size=$TMP_SIZE" --pids-limit 256 --cpus 2)
OUT="$("$CLI" run "${CRUN[@]}" --memory 2g \
  -e FLOOR="$FLOOR" -e LV="$LINT_VENDOR" -e TT="$TEST_TIMEOUT" -e EXCL="$EXCL" -e PUCONF="$PUCONF" -e SELECT="$SELECT" \
  --mount type=bind,source="$REPO",target=/app,readonly -w /app "$RUNIMG" sh -c "$INNER" 2>&1)"; CRC=$?
echo "$OUT"
val() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -1; }
num() { local v; v="$(val "$1")"; isnum "$v" || v=0; printf '%s' "$v" | cut -c1-9; }

PHPVER="$(val PHPVER | tr -cd '0-9A-Za-z.+~_-')"
BRANCH="$(val PHPBRANCH | tr -cd '0-9.')"
[ -n "$PHPVER" ] || finish BLOCKED 9 "BLOCKED: the container did not report a PHP version (exit $CRC; is php in the image?)"
case "$CRC" in 137) finish BLOCKED 9 "BLOCKED: the container was killed (out of memory?)";; 125|126|127) finish BLOCKED 9 "BLOCKED: the container could not start (exit $CRC)";; esac
VGATE="$(oneof "$(val VERSION_GATE)" "PASS FAIL" FAIL)"
[ "$VGATE" = PASS ] && [ "$BRANCH" != "$TARGET" ] && VGATE="BRANCH-MISMATCH"
LFOUND="$(num LINT_FOUND)"; LDONE="$(num LINT_DONE)"; LUNREAD="$(num LINT_UNREAD)"; LFAILS="$(num LINT_FAILS)"; FERR="$(num FIND_ERRORS)"

# vendor/ files that fail only because they use syntax of a newer PHP (loaded behind a version check, like Symfony's
# polyfill bootstrap85.php) are re-linted on the newest patched image. Fails there too: a real failure.
if [ "$LFAILS" -gt 0 ] && [ "$BRANCH" != "$NEWEST_BRANCH" ]; then
  VF="$(printf '%s\n' "$OUT" | sed -n 's/^LINT_FAIL=\.\/vendor\//vendor\//p' | grep -v '?')"
  if [ -n "$VF" ] && getimg "$NEWEST_IMAGE"; then
    # shellcheck disable=SC2016
    STILL="$(printf '%s\n' "$VF" | "$CLI" run "${CRUN[@]}" -i --memory 1g \
      --mount type=bind,source="$REPO",target=/app,readonly -w /app "$NEWEST_IMAGE" \
      sh -c 'n=0; while IFS= read -r f; do php -l "$f" >/dev/null 2>&1 || n=$((n+1)); done; echo "$n"' 2>/dev/null | tail -1)"
    if isnum "$STILL"; then
      VNEWER=$(( $(printf '%s\n' "$VF" | grep -c .) - STILL ))
      if [ "$VNEWER" -gt 0 ]; then LFAILS=$(( LFAILS - VNEWER ))
        WARN+=("$VNEWER vendor file(s) need a newer PHP to parse and were accepted as version-guarded; tests must load the code paths that matter"); fi
    fi
  fi
fi
LFILES="$LDONE"
if   [ "$HOSTCOUNT" -eq 0 ];  then LGATE="NO-FILES"
elif [ "$LFAILS" -gt 0 ];     then LGATE="FAIL"                 # a real parse error is definitive, even if coverage is short
elif [ "$FERR" -gt 0 ] || [ "$LUNREAD" -gt 0 ] || [ "$LFOUND" -ne "$HOSTCOUNT" ] || [ "$LDONE" -ne "$LFOUND" ]; then LGATE="COVERAGE-MISMATCH"
else LGATE="PASS"; fi

PURC="$(val PU_RC | tr -cd '0-9a-z')"; TESTS="$(num TESTS_RAN)"; TSKIP="$(num TESTS_NOT_EXECUTED)"; NOTE="$(val NOTE)"; JST="$(val JUNIT | tr -cd '0-9a-z')"
case "$PURC" in
  none)      TGATE="NOT-RUN";;
  notimeout) TGATE="NO-TIMEOUT"; NOTE="the PHP image has no timeout command, so tests cannot run under a time limit";;
  126|127)   TGATE="NO-START"; TESTS=0; NOTE="vendor/bin/phpunit could not start (exit $PURC)";;
  0)         case "$JST" in
               unreadable) TGATE="NO-JUNIT"; TESTS=0; NOTE="the PHPUnit JUnit log could not be read";;
               missing|'') TGATE="NOT-RUN"; TESTS=0; NOTE="phpunit reported success but wrote no JUnit log of executed tests";;
               *) isnum "$JST" && [ "$JST" -lt "$TESTS" ] && TESTS="$JST"            # trust the lower of the two counts
                  if [ "$TESTS" -ge 1 ] && [ -z "$(val NO_TESTS)" ]; then TGATE="PASS"
                  else TGATE="NOT-RUN"; TESTS=0; NOTE="phpunit executed no test (none found, or all skipped, incomplete or risky)"; fi;;
             esac;;
  124|143)   TGATE="TIMEOUT"; TESTS=0; NOTE="the test suite did not finish within ${TEST_TIMEOUT}s";;
  137)       TGATE="KILLED";  TESTS=0; NOTE="the test suite was killed (out of memory, or it ignored the timeout)";;
  *)         TESTS=0
             if [ -n "$(val NO_TESTS)" ]; then TGATE="NOT-RUN"; NOTE="phpunit found no test to execute"
             elif [ -n "$(val PU_ENV)" ]; then TGATE="ENVIRONMENT"; NOTE="tests failed on the gate environment (read-only checkout, full /tmp or a permission error), not necessarily on the code"
             else TGATE="FAIL"; fi;;
esac
[ "$TGATE" = PASS ] && [ "$TSKIP" -gt 0 ] && WARN+=("$TSKIP test(s) skipped, incomplete or risky were not counted as executed")

# --- Phase 2: manifest gate, exact, with Composer's semver library (also network-less, read-only) --------------------
if [ -f "$REPO/composer.json" ]; then
  if getimg "$COMPOSER_IMAGE"; then
    # shellcheck disable=SC2016  # PHP source, not shell
    MCODE='require "phar:///tmp/c.phar/vendor/autoload.php";
use Composer\Semver\VersionParser; use Composer\Semver\Intervals; use Composer\Semver\Semver;
$o = function ($k, $v) { echo $k, "=", preg_replace("/[^0-9A-Za-z .,:;<>=|~^*()_\/+-]/", "?", substr((string) $v, 0, 200)), "\n"; };
$raw = @file_get_contents("/m/composer.json");
if ($raw === false) { $o("MANIFEST_GATE", "ERROR"); $o("MANIFEST_REASON", "composer.json cannot be read by the gate"); exit(0); }
$j = json_decode($raw, true);
if (!is_array($j)) { $o("MANIFEST_GATE", "FAIL"); $o("MANIFEST_REASON", "composer.json is not valid JSON"); exit(0); }
$req = $j["require"]["php"] ?? null; $plat = $j["config"]["platform"]["php"] ?? null;
$o("MANIFEST_REQUIRE", is_string($req) ? $req : "none"); $o("MANIFEST_PLATFORM", is_string($plat) ? $plat : "none");
$p = new VersionParser(); $bad = $p->parseConstraints(getenv("UNPATCHED")); $why = [];
if (!is_string($req)) { $why[] = "require.php is missing, so any PHP release is allowed"; }
else { try { $c = $p->parseConstraints($req);
  if (Intervals::haveIntersections($c, $bad)) { $why[] = "require.php allows unpatched or end-of-life PHP"; }
  if (!Intervals::haveIntersections($c, $p->parseConstraints("~" . getenv("FLOOR")))) { $why[] = "require.php does not allow any patched " . getenv("BRANCH") . " release"; }
  elseif (!Semver::satisfies(getenv("RUNTIME"), $req)) { $o("MANIFEST_WARN", "require.php does not allow the verified runtime " . getenv("RUNTIME") . "; verify with a PHP_IMAGE it allows"); }
} catch (\Throwable $e) { $why[] = "require.php is not a valid Composer constraint"; } }
if (is_string($plat)) { try { if (Semver::satisfies($plat, getenv("UNPATCHED"))) { $why[] = "config.platform.php pins an unpatched release"; } }
  catch (\Throwable $e) { $why[] = "config.platform.php is not a valid version"; } }
$l = @json_decode((string) @file_get_contents("/m/composer.lock"), true);
if (is_array($l) && is_string($req) && ($l["platform"]["php"] ?? null) !== $req) { $o("MANIFEST_WARN", "composer.lock does not match require.php: run composer update --lock"); }
$o("MANIFEST_GATE", $why ? "FAIL" : "PASS"); $o("MANIFEST_REASON", implode("; ", $why));'
    LOCKMOUNT=(); [ -f "$REPO/composer.lock" ] && [ ! -L "$REPO/composer.lock" ] && LOCKMOUNT=(--mount "type=bind,source=$REPO/composer.lock,target=/m/composer.lock,readonly")
    # shellcheck disable=SC2016
    MOUT="$("$CLI" run "${CRUN[@]}" --memory 512m \
      -e UNPATCHED="$UNPATCHED" -e RUNTIME="$PHPVER" -e FLOOR="$FLOOR" -e BRANCH="$TARGET" -e MCODE="$MCODE" \
      --mount type=bind,source="$REPO/composer.json",target=/m/composer.json,readonly "${LOCKMOUNT[@]}" \
      --entrypoint sh "$COMPOSER_IMAGE" -c 'cp "$(command -v composer)" /tmp/c.phar && php -r "$MCODE"' 2>&1)"
    printf '%s\n' "$MOUT" | while IFS= read -r l; do printf 'MANIFEST: %s\n' "$l"; done
    MGATE="$(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_GATE=//p' | head -1)"
    MREQ="$(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_REQUIRE=//p' | head -1)"
    MPLAT="$(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_PLATFORM=//p' | head -1)"
    MREASON="$(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_REASON=//p' | head -1)"
    while IFS= read -r w; do [ -n "$w" ] && WARN+=("$w"); done < <(printf '%s\n' "$MOUT" | sed -n 's/^MANIFEST_WARN=//p' | head -3)
    MGATE="$(oneof "$MGATE" "PASS FAIL ERROR" ERROR)"
    [ "$MGATE" = ERROR ] && [ -z "$MREASON" ] && MREASON="the Composer check did not run"
  else MGATE="ERROR"; MREASON="cannot get the Composer image (check network or COMPOSER_IMAGE)"; fi
else
  MGATE="NO-MANIFEST"
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
[ "$MGATE" = ERROR ]                && finish BLOCKED 9 "BLOCKED: manifest not checked: $MREASON"
[ "$LGATE" = NO-FILES ]             && finish BLOCKED 9 "BLOCKED: no PHP file found to lint (wrong path?)"
[ "$LGATE" = COVERAGE-MISMATCH ]    && finish BLOCKED 9 "BLOCKED: the container could lint $(( LDONE - LUNREAD )) of $HOSTCOUNT files (files the container user cannot read)"
case "$TGATE" in TIMEOUT|KILLED|NO-TIMEOUT|NO-START|NO-JUNIT|ENVIRONMENT) finish BLOCKED 9 "BLOCKED: $NOTE";; esac
[ "$TGATE" = NOT-RUN ]              && finish INCONCLUSIVE 5 "INCONCLUSIVE: patched $PHPVER, manifest and lint clean, but no test executed ($NOTE)"
[ "$MGATE" = NO-MANIFEST ]          && finish INCONCLUSIVE 5 "INCONCLUSIVE: no composer.json, so nothing stops an install on an unpatched PHP (tests and lint clean on $PHPVER)"
[ "$LINT_VENDOR" = 1 ]              || finish INCONCLUSIVE 5 "INCONCLUSIVE: vendor/ was not linted (LINT_VENDOR=0); tests and the rest are clean on $PHPVER"
[ "$TGATE" = PASS ] || finish BLOCKED 9 "BLOCKED: unexpected test result"
finish PASS 0 "PASS: $TESTS test(s) executed and passed, manifest and lint clean, on patched $PHPVER"
