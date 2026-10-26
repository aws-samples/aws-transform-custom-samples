#!/usr/bin/env bash
# verify-matrix.sh - runs php-upgrade-secure-verify/scripts/verify.sh against purpose-built repositories and checks
# each verdict and exit code. Needs Docker, network (images and PHPUnit phars) and python3. Writes only under a temp dir.
#
# Usage: bash tests/verify-matrix.sh            (from the php2shell-patch-and-verify folder)
# Exit:  0 when every case matches, 1 otherwise.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
V="$HERE/php-upgrade-secure-verify/scripts/verify.sh"
[ -f "$V" ] || { echo "verify.sh not found at $V" >&2; exit 1; }
B="$(mktemp -d "${TMPDIR:-/tmp}/verify-matrix.XXXXXX")"; cd "$B" || exit 1
echo "work dir: $B"
phar() { local f="$B/phpunit$1.phar"; [ -s "$f" ] || curl -fsSL "https://phar.phpunit.de/phpunit-$1.phar" -o "$f"; printf '%s' "$f"; }
P11="$(phar 11)"
GOOD='{"name":"x/y","require":{"php":"~8.2.35 || ~8.3.36 || ~8.4.27 || ^8.5.12"}}'
src() { mkdir -p "$1/src"; echo '<?php function a(){return 1;}' > "$1/src/a.php"; }
man() { printf '%s\n' "$2" > "$1/composer.json"; }
tst() { # repo method-body [annotation] [phar]
  mkdir -p "$1/vendor/bin" "$1/tests"; cp "${4:-$P11}" "$1/vendor/bin/phpunit"; chmod +x "$1/vendor/bin/phpunit"
  printf '<?php\nuse PHPUnit\\Framework\\TestCase;\nclass ATest extends TestCase {\n %s\n public function testX(): void { %s }\n}\n' "${3:-}" "$2" > "$1/tests/ATest.php"; }
good() { src "$1"; man "$1" "$GOOD"; tst "$1" '$this->assertTrue(true);'; }

good pass; good pass85; good pass82; good pass83; good alpine; good custom
src notests; man notests "$GOOD"
good m84;     man m84 '{"require":{"php":">=8.4"}}'
good m8427;   man m8427 '{"require":{"php":">=8.4.27"}}'
good mplat;   man mplat '{"require":{"php":"~8.4.27 || ^8.5.12"},"config":{"platform":{"php":"8.4"}}}'
good mplatok; man mplatok '{"require":{"php":"~8.4.27 || ^8.5.12"},"config":{"platform":{"php":"8.4.27"}}}'
good mnoreq;  man mnoreq '{"name":"x/y"}'
good mexcl;   man mexcl '{"require":{"php":"^8.5.12"}}'
good mjson;   man mjson '{"require":'
good mbad;    man mbad '{"require":{"php":"not a constraint"}}'
good nomanifest; rm nomanifest/composer.json
good mlink; rm mlink/composer.json; printf '%s\n' "$GOOD" > "$B/real-composer.json"; ln -s "$B/real-composer.json" mlink/composer.json
good lint;  echo '<?php function (' > lint/src/b.php
good vlint; mkdir -p vlint/vendor/pkg; echo '<?php if (' > vlint/vendor/pkg/old.php; cp -R vlint vlint0
good phtml; echo '<?php if (' > phtml/src/v.phtml
good space; mkdir -p "space/my dir"; echo '<?php if (' > "space/my dir/x y.php"
good unread; mkdir -p unread/src/secret; echo '<?php echo 1;' > unread/src/secret/s.php; chmod 700 unread/src/secret
mkdir -p "$B/outside"; echo '<?php echo 1;' > "$B/outside/o.php"; good symout; ln -s "$B/outside" symout/src/ext
mkdir empty
src tfail;  man tfail "$GOOD";  tst tfail '$this->assertTrue(false);'
src tskip;  man tskip "$GOOD";  tst tskip '$this->markTestSkipped("x");'
src tinc;   man tinc "$GOOD";   tst tinc '$this->markTestIncomplete("x");'
src trisky; man trisky "$GOOD"; tst trisky '$x = 1;'
src tslow;  man tslow "$GOOD";  tst tslow 'sleep(30); $this->assertTrue(true);'
src tnet;   man tnet "$GOOD";   tst tnet '$s = @fsockopen("tcp://10.255.255.1", 80, $e, $m, 1); $this->assertNotFalse($s);'
src tnetg;  man tnetg "$GOOD";  tst tnetg '$s = @fsockopen("tcp://10.255.255.1", 80, $e, $m, 1); $this->assertNotFalse($s);' '#[\PHPUnit\Framework\Attributes\Group("network")]'
printf '<?php\nuse PHPUnit\\Framework\\TestCase;\nclass BTest extends TestCase { public function testY(): void { $this->assertTrue(true); } }\n' > tnetg/tests/BTest.php
src toom;   man toom "$GOOD";   tst toom 'ini_set("memory_limit","-1"); $a=[]; for($i=0;$i<40;$i++){ $a[] = str_repeat("x", 100*1024*1024); } $this->assertTrue(true);'
good both; man both '{"require":{"php":">=7.4"}}'; echo '<?php function (' > both/src/b.php
good gitc; (cd gitc && git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -qm base)
cp -R gitc gitd; echo '<?php function b(){return 2;}' > gitd/src/a.php
good sym; echo KEEP > "$B/victim"; ln -s "$B/victim" sym/verify-verdict.json
good fake; printf '#!/bin/sh\nprintf "OK (1 test, 1 assertion)\\n"\nexit 0\n' > fake/vendor/bin/phpunit; chmod +x fake/vendor/bin/phpunit
good nostart; printf '#!/nonexistent/interpreter\n' > nostart/vendor/bin/phpunit; chmod +x nostart/vendor/bin/phpunit
printf 'FROM php:8.4.27-cli\nRUN rm -f /usr/bin/timeout\n' > "$B/Dockerfile.nt"
docker build -q -t verify-matrix-notimeout:8.4.27 -f "$B/Dockerfile.nt" "$B" >/dev/null 2>&1 || echo "warning: could not build the no-timeout image"
for v in 9 10 11; do
  for k in pass skip mixed; do
    r="pu$v$k"; src "$r"; man "$r" "$GOOD"; tst "$r" '$this->assertTrue(true);' '' "$(phar "$v")"
    case $k in
      pass)  b='public function testA(): void { $this->assertTrue(true); } public function testB(): void { $this->assertTrue(true); }';;
      skip)  b='public function testA(): void { $this->markTestSkipped("x"); }';;
      mixed) b='public function testA(): void { $this->assertTrue(true); } public function testB(): void { $this->markTestSkipped("x"); } public function testC(): void { $this->markTestIncomplete("x"); }';;
    esac
    printf '<?php\nuse PHPUnit\\Framework\\TestCase;\nclass ATest extends TestCase { %s }\n' "$b" > "$r/tests/ATest.php"
  done
done

N=0; BAD=0
run() { # name want-verdict want-exit repo target [env...]
  local n=$1 ev=$2 ex=$3 r=$4 t=$5; shift 5
  env "$@" bash "$V" "$B/$r" "$t" > "$B/$n.out" 2>&1; local rc=$?
  local got; got=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['verdict'])" "$B/$r/verify-verdict.json" 2>/dev/null || echo NONE)
  N=$((N+1)); local st=OK; { [ "$got" = "$ev" ] && [ "$rc" = "$ex" ]; } || { st=MISMATCH; BAD=$((BAD+1)); }
  printf '%-8s %-16s want %-12s %-2s got %-12s %-2s | %s\n' "$st" "$n" "$ev" "$ex" "$got" "$rc" "$(tail -1 "$B/$n.out" | cut -c1-120)"
}
run pass-8.4        PASS 0 pass 8.4 X=1
run pass-8.5        PASS 0 pass85 8.5 X=1
run pass-8.2-eol    PASS 0 pass82 8.2 X=1
run pass-8.3        PASS 0 pass83 8.3 X=1
run no-tests        INCONCLUSIVE 5 notests 8.4 X=1
run man-ge84        FAIL 2 m84 8.4 X=1
run man-ge8427      FAIL 2 m8427 8.4 X=1
run man-platform    FAIL 2 mplat 8.4 X=1
run man-platform-ok PASS 0 mplatok 8.4 X=1
run man-no-require  FAIL 2 mnoreq 8.4 X=1
run man-excludes    FAIL 2 mexcl 8.4 X=1
run man-bad-json    FAIL 2 mjson 8.4 X=1
run man-bad-constr  FAIL 2 mbad 8.4 X=1
run no-manifest     INCONCLUSIVE 5 nomanifest 8.4 X=1
run man-symlink     BLOCKED 9 mlink 8.4 X=1
run lint-src        FAIL 3 lint 8.4 X=1
run lint-vendor     FAIL 3 vlint 8.4 X=1
run lint-vendor-off INCONCLUSIVE 5 vlint0 8.4 LINT_VENDOR=0
run lint-phtml      FAIL 3 phtml 8.4 X=1
run lint-space      FAIL 3 space 8.4 X=1
run unreadable      BLOCKED 9 unread 8.4 X=1
run symlink-out     BLOCKED 9 symout 8.4 X=1
run empty           BLOCKED 9 empty 8.4 X=1
run test-fail       FAIL 4 tfail 8.4 X=1
run test-skipped    INCONCLUSIVE 5 tskip 8.4 X=1
run test-incomplete INCONCLUSIVE 5 tinc 8.4 X=1
run test-risky      INCONCLUSIVE 5 trisky 8.4 X=1
run test-timeout    BLOCKED 9 tslow 8.4 TEST_TIMEOUT=5
run test-network    FAIL 4 tnet 8.4 X=1
run test-net-excl   PASS 0 tnetg 8.4 PHPUNIT_EXCLUDE_GROUP=network
run test-oom        BLOCKED 9 toom 8.4 X=1
run fake-phpunit    INCONCLUSIVE 5 fake 8.4 X=1
run phpunit-nostart BLOCKED 9 nostart 8.4 X=1
run fail-both       FAIL 2 both 8.4 X=1
run img-8.5.11      FAIL 2 pass85 8.5 PHP_IMAGE=php:8.5.11-cli
run img-branch      FAIL 2 pass 8.4 PHP_IMAGE=php:8.5.12-cli
run img-alpine      PASS 0 alpine 8.4 PHP_IMAGE=php:8.4.27-cli-alpine
run img-no-timeout  BLOCKED 9 custom 8.4 PHP_IMAGE=verify-matrix-notimeout:8.4.27
run bad-target      BLOCKED 9 pass 9.9 X=1
run inject-target   BLOCKED 9 pass '8.4","x":"y' X=1
run bad-image       BLOCKED 9 pass 8.4 PHP_IMAGE=-v
run bad-cli         BLOCKED 9 pass 8.4 CONTAINER_CLI=foo
run no-composer-img BLOCKED 9 pass 8.4 COMPOSER_IMAGE=example.invalid/nope:1
run git-clean       PASS 0 gitc 8.4 X=1
run git-dirty       PASS 0 gitd 8.4 X=1
run verdict-symlink PASS 0 sym 8.4 X=1
for v in 9 10 11; do
  run "phpunit$v-pass"  PASS 0 "pu${v}pass" 8.4 X=1
  run "phpunit$v-skip"  INCONCLUSIVE 5 "pu${v}skip" 8.4 X=1
  run "phpunit$v-mixed" PASS 0 "pu${v}mixed" 8.4 X=1
done
[ "$(cat "$B/victim")" = KEEP ] || { echo "MISMATCH verdict-symlink: the symlink target was overwritten"; BAD=$((BAD+1)); }
chmod 755 "$B/unread/src/secret" 2>/dev/null
echo "cases: $N, mismatches: $BAD"
[ "$BAD" -eq 0 ]
