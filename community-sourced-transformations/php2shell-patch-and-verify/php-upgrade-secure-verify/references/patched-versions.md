# Patched versions (PHP2Shell)

PHP2Shell is two critical remote code execution flaws in the PHP engine itself, fixed on 2026-10-21:
- CVE-2026-109618 (out-of-memory corruption)
- CVE-2026-109619 (stale global state between requests)
Both are CVSS v4.0 9.2 and unauthenticated. They affect PHP 5.4 through 8.5.11 (AWS Security Bulletin 2026-143-AWS).

## The floors this gate enforces
| Branch | First patched release |
|---|---|
| 8.5 | 8.5.12 |
| 8.4 | 8.4.27 |
| 8.3 | 8.3.36 |
| 8.2 | 8.2.35 |
PHP 8.1 and older have no upstream fix. Update this table when new branches are released.

## Why a branch alone is not enough
"On 8.5" does not mean patched: 8.5.0, 8.5.3 and 8.5.11 are all "8.5" and all vulnerable. The fix is the
specific release. The version trap: 8.5.3 is lower than 8.5.12 (the patch number is 12, not a decimal).
Package repositories can be pinned to an older release (Amazon Linux 2023 is pinned to the installed
release unless you use the release named in the advisory), so a plain install can give a pre-patch PHP.

## Why code migration alone does not close the CVE
The flaw is in the interpreter, not in application code. The chain is: migrate the code, install a patched
runtime, restart every worker. This gate verifies only that the migrated code runs clean on a patched runtime.

## Optional: pin the image by digest
The gate uses the official image `php:<release>-cli`. To pin it, set `PHP_IMAGE=php@sha256:<digest>`.
Digests seen on 2026-10-22 (they change when the image is rebuilt, so check them yourself):
- php:8.4.27-cli  sha256:a4ae1f57e22b89a0a69c5e085b3010ee727d094e1542d249e48a01bec3c44810
- php:8.5.12-cli  sha256:635a4b998025ab269194639a5549c6fdcd9b4f88ec8cd761b092de8653d40663
