# Patched versions (PHP2Shell)

PHP2Shell is two critical remote code execution flaws in the PHP engine itself, fixed on 2026-10-21:
- CVE-2026-109618 (out-of-memory corruption)
- CVE-2026-109619 (stale global state between requests)
Both are CVSS v4.0 9.2 and unauthenticated. They affect PHP 5.4 through 8.5.11 (AWS Security Bulletin 2026-143-AWS).
`scripts/verify.sh` holds the floors as code (`FLOOR`, `UNPATCHED`); this page explains them.

## Floors, end of life and safe constraints
| Branch | First patched release | Security support ends (php.net) | Safe `require.php` for this branch or newer |
|---|---|---|---|
| 8.5 | 8.5.12 | 2029-12-31 | `^8.5.12` |
| 8.4 | 8.4.27 | 2028-12-31 | `~8.4.27 \|\| ^8.5.12` |
| 8.3 | 8.3.36 | 2027-12-31 | `~8.3.36 \|\| ~8.4.27 \|\| ^8.5.12` |
| 8.2 | 8.2.35 | 2026-12-31 | `~8.2.35 \|\| ~8.3.36 \|\| ~8.4.27 \|\| ^8.5.12` |

PHP 8.1 and older receive no release. PHP published minimal source backports for 7.4, 8.0 and 8.1 for people who build
from source (php.net, 2026-10-21); they are a stopgap, not a supported release. Prefer 8.4 or 8.5 as a migration
target: 8.2 leaves an application unsupported two months after the fix.

If `composer.json` sets `config.platform.php`, set it to the floor too (for example `"8.4.27"`). A platform pin below
the floor contradicts a safe `require.php`, and `composer install` fails to resolve. After editing, run
`composer update --lock` so that `composer.lock` matches.

## Why `>=8.4.27` is not enough
`>=8.4.27` and `^8.4.27` also allow 8.5.0 to 8.5.11, which are unpatched. Checked with Composer's semver library
(Composer 2.10.3): `>=8.4`, `>=8.5`, `>=8.4.27`, `^8.4.27` and `8.4.*` allow an unpatched release; `~8.4.27`,
`^8.5.12` and `~8.4.27 || ^8.5.12` do not.

A safe `require.php` stops `composer install` on an older PHP, and Composer's generated `platform_check.php` refuses to
boot below the lowest bound (8.4.27 here). It does not refuse 8.5.0 to 8.5.11, so the runtime patch (guide step 4)
remains the fix.

## Why a branch alone is not enough
"On 8.5" does not mean patched: 8.5.0, 8.5.3 and 8.5.11 are all 8.5 and all vulnerable. The version trap: 8.5.3 is lower
than 8.5.12 (the patch number is 12, not a decimal). Amazon Linux 2023 repositories stay on the release you installed
unless you name the one in the advisory, so a plain install can give a pre-patch PHP.

## Optional: pin the image by digest
The gate uses the official image `php:<release>-cli`; the version gate checks the PHP version inside it whatever the tag
says. To pin it, set `PHP_IMAGE=php@sha256:<digest>`. Digests change when the image is rebuilt; look them up yourself.
