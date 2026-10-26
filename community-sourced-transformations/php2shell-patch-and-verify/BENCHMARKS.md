# Benchmark Results - PHP2Shell patch and verify

Measured from 2026-10-23 to 2026-10-26 on AWS Transform CLI 3.20.0, `us-east-1`, Amazon Linux 2023, Docker 25. Single runs (n=1); minutes vary.
Facts about the CVEs and patched releases change quickly; see the [README](README.md).

## Executive Summary

| Metric | Result |
|--------|--------|
| Fixture | `samples/legacy-php-app` (PHP 7.4 app, 13 files: 5 classes, 5 test files with 7 tests, deliberate PHP 8 breakages) |
| Rapid analysis (`rapid-techdebt-analysis`) | about 1 minute, 1 high finding (PHP 7.4 end of life, fix `AWS/php-version-upgrade`) |
| Comprehensive analysis (`tech-debt-comprehensive`) | about 7 minutes, 11 findings (3 high), including silent PHP 8 behavior changes |
| Managed upgrade (`AWS/php-version-upgrade`) | 35.6 agent minutes (about US$ 1.25). Code migration good; it wrote `"php": ">=8.5"`, kept `'abc' == 0` true, and ran its tests on PHP 8.5.3 (unpatched) |
| Verify gate, legacy code | **FAIL**, exit 2: `"php": ">=7.4"` allows unpatched PHP, and `src/Initials.php` does not parse |
| Verify gate, upgraded code as the transformation left it | **FAIL**, exit 2: `"php": ">=8.5"` allows 8.5.0 to 8.5.11, although 7 of 7 tests passed and 1,545 files parse |
| Verify gate, upgraded code with `"php": "^8.5.12"` | **PASS**, exit 0: 7 of 7 tests on PHP 8.5.12, 1,545 files linted (`vendor/` included) |
| Verify gate, same code on PHP 8.5.11 | **FAIL**, exit 2: runtime below the patched release |
| Verify gate test matrix | Linux (bash 5, Docker): 77 of 77 cases return the expected verdict, exit code and checked fields. macOS (bash 3.2, Docker Desktop): 74 pass and 3 are skipped, because that runtime does not enforce file permissions on mounts. Reproduce with `bash tests/verify-matrix.sh` |
| Realistic `vendor/` (Laravel 11, Symfony 7, PHPStan, PHP-CS-Fixer, PHP_CodeSniffer, PHPUnit 11) | 8,398 files linted in 65 s; 1 file (Symfony `polyfill-uuid/bootstrap85.php`) parses only on 8.5 and was accepted as version-guarded with a warning; 0 failures |
| Verify as a continuous modernization custom analysis | legacy: 3 findings (high manifest, high parse error naming `AWS/php-version-upgrade`, medium "no tests executed"); upgraded as left: 1 high manifest finding with the exact fix; fixed manifest: 0 findings |
| Verify run through the engine (target given as prose) | PASS; only the report files written; one commit "Step 1: Run PHP patched-runtime verify gate" |
| Agent minutes per verify run | 8.5 to 15.8 over 11 runs during development (about US$ 0.30 to 0.55); `verify.sh` alone costs nothing |
| Step 4 on Amazon Linux 2023, from `php8.4-fpm` 8.4.26 | The README commands, run verbatim in a container: worker on 8.4.27, `ALAS2023-2026-3303` installed, master started after the install, `session.upload_progress.enabled` Off in CLI and FPM |

Observation that motivated the gate: the managed upgrade ran its own tests on PHP 8.5.3, which is **below** the patched 8.5.12, and wrote a
`composer.json` constraint that still allows unpatched releases. A migration can look green on a vulnerable runtime, and be installable on one.

## Gate test matrix (`scripts/verify.sh`)

`tests/verify-matrix.sh` builds every case below in a temporary directory, runs the gate and checks the verdict and exit code (exit 0
only when all match). Each case is a small purpose-built repository with PHPUnit 11 unless stated. The official `php:<release>-cli` image was
used unless the case sets `PHP_IMAGE`. Unless stated, the manifest is `~8.2.35 || ~8.3.36 || ~8.4.27 || ^8.5.12` and one passing test exists.

| Case | Target | Exit | Verdict and reason |
|---|---|---|---|
| One passing test | 8.4 / 8.5 / 8.3 | 0 | PASS on 8.4.27 / 8.5.12 / 8.3.36; `patched_runtime_cves` filled |
| One passing test | 8.2 | 0 | PASS on 8.2.35, with the warning "PHP 8.2 reaches end of life on 2026-12-31" |
| No test suite | 8.4 | 5 | INCONCLUSIVE; `patched_runtime_cves` empty |
| `require.php` `>=8.4` | 8.4 | 2 | FAIL, allows unpatched or end-of-life PHP |
| `require.php` `>=8.4.27` | 8.4 | 2 | FAIL, also allows 8.5.0 to 8.5.11 |
| Safe `require.php`, `config.platform.php` `8.4` | 8.4 | 2 | FAIL, platform pins an unpatched release |
| Safe `require.php`, `config.platform.php` `8.4.27` | 8.4 | 0 | PASS |
| No `require.php` | 8.4 | 2 | FAIL, any PHP release is allowed |
| `require.php` `^8.5.12` on target 8.4 | 8.4 | 2 | FAIL, does not allow the verified runtime |
| Invalid JSON / invalid constraint | 8.4 | 2 | FAIL |
| No `composer.json` | 8.4 | 5 | INCONCLUSIVE: nothing stops an install on an unpatched PHP |
| `composer.json` is a symlink | 8.4 | 9 | BLOCKED |
| Parse error in `src/`, in a `.phtml` file, in a file name with spaces | 8.4 | 3 | FAIL |
| Parse error only under `vendor/` | 8.4 | 3 | FAIL; with `LINT_VENDOR=0`: INCONCLUSIVE (exit 5), never PASS |
| Directory or file the container user cannot read, or an unreadable `composer.json` | 8.4 | 9 | BLOCKED |
| Symlink pointing outside the repository | 8.4 | 9 | BLOCKED before any walk |
| Parse error in `B.PHP`, in a `.module` file, or in an extensionless `bin/console` with a php shebang (Debian and Alpine) | 8.4 | 3 | FAIL |
| `vendor/` file with PHP 8.5-only syntax (version-guarded polyfill) | 8.4 | 0 | PASS, with `vendor_files_needing_newer_php` 1 and a warning |
| `require.php` `~8.4.28 \|\| ^8.5.12` (newer than the image) | 8.4 | 0 | PASS, with a warning to verify on a release it allows |
| `composer.lock` platform does not match `require.php` | 8.4 | 0 | PASS, with a warning to run `composer update --lock` |
| PHPUnit config in `build/` (`PHPUNIT_CONFIG`), or `phpunit.dist.xml` at the root | 8.4 | 0 | PASS |
| Test fails because the checkout is read-only | 8.4 | 9 | BLOCKED, gate environment, not a test failure |
| Test output contains "Skipped: 5" | 8.4 | 0 | PASS with 1 test: only PHPUnit's summary line is parsed |
| Old `verify-verdict.json` present / run killed before it ends | 8.4 | 0 / - | Replaced / no verdict file left |
| Empty directory | 8.4 | 9 | BLOCKED, no PHP file |
| One failing test | 8.4 | 4 | FAIL |
| Every test skipped / incomplete / risky | 8.4 | 5 | INCONCLUSIVE, no test executed |
| Test sleeps 30 s, `TEST_TIMEOUT=5` | 8.4 | 9 | BLOCKED, did not finish |
| Test opens a TCP connection | 8.4 | 4 | FAIL (no network); tagged and `PHPUNIT_EXCLUDE_GROUP=network`: PASS |
| Test allocates 4 GB | 8.4 | 9 | BLOCKED, killed (out of memory) |
| `vendor/bin/phpunit` is a script that only prints `OK (1 test, 1 assertion)` | 8.4 | 5 | INCONCLUSIVE: no JUnit log of executed tests |
| `vendor/bin/phpunit` cannot start | 8.4 | 9 | BLOCKED, exit 127 is not reported as a test failure |
| PHPUnit 9, 10, 11: two passing tests / one skipped / one passing, one skipped, one incomplete | 8.4 | 0 / 5 / 0 | PASS with 2 / INCONCLUSIVE / PASS with 1; summary and JUnit counts agree |
| Unsafe manifest and a parse error | 8.4 | 2 | FAIL, summary lists both |
| `PHP_IMAGE=php:8.5.11-cli` | 8.5 | 2 | FAIL, below 8.5.12 |
| `PHP_IMAGE=php:8.5.12-cli` | 8.4 | 2 | FAIL, branch 8.5 is not 8.4 |
| `PHP_IMAGE=php:8.4.27-cli-alpine` | 8.4 | 0 | PASS, with the warning that a custom image's provenance is not verified |
| Custom image without a `timeout` command | 8.4 | 9 | BLOCKED, not a test failure |
| Unknown target / target with JSON characters / `PHP_IMAGE=-v` / `CONTAINER_CLI=foo` / Composer image unavailable | | 9 | BLOCKED |
| Git checkout, clean / with an uncommitted change | 8.4 | 0 | PASS with `git_commit` and `git_dirty` false / true plus a warning |
| `verify-verdict.json` is a symlink to another file | 8.4 | 0 | PASS; the other file is untouched and the symlink is replaced |

Also measured: `php -l` over the 1,534 files of `vendor/` in one install of the sample (PHPUnit 11.5 and its dependencies) found 0 parse errors and took 6 s with
4 workers. Composer's semver library (2.10.3) classified `>=8.4`, `>=8.5`, `>=8.4.27`, `^8.4.27` and `8.4.*` as allowing unpatched releases,
and `~8.4.27`, `^8.5.12` and `~8.4.27 || ^8.5.12` as safe. With a safe `require.php`, Composer's `platform_check.php` refused to boot on PHP
8.4.26 and booted on 8.4.27 and on 8.5.11, so it is a partial guard only.

## Known limitations

See [Known limitations in the README](README.md#known-limitations). In short: no network for tests, no pre-migration baseline, core extensions only
in the official image, the repository and its tests are trusted input, and only Docker was tested.

## How to repeat it

```bash
# The gate's test matrix (Docker, network for images and PHPUnit phars; about 15 minutes)
bash tests/verify-matrix.sh

# Gate on any PHP repository (no agent, no cost)
bash php-upgrade-secure-verify/scripts/verify.sh <repo> 8.4
echo "exit=$?"; cat <repo>/verify-verdict.json

# Sample: legacy, then upgraded with the recorded patch (copy it out of this repository first)
mkdir -p /tmp/repos && cp -R samples /tmp/repos/s && cd /tmp/repos/s
cp -R legacy-php-app ../legacy && git apply legacy-php-app.php85.patch && cp -R legacy-php-app ../upgraded
cd ../upgraded && docker run --rm --user "$(id -u):$(id -g)" -e COMPOSER_HOME=/tmp/c -v "$PWD":/app -w /app composer:2 install --no-scripts --no-plugins
bash <this-folder>/php-upgrade-secure-verify/scripts/verify.sh /tmp/repos/upgraded 8.5    # FAIL exit 2: ">=8.5"
```

Cost is US$ 0.035 per agent minute ([pricing](https://aws.amazon.com/transform/pricing/)).
