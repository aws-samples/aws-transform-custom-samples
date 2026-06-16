# PHP Patterns Reference

PHP-specific containerisation gotchas for Phase 2 transformation. Applies when `composer.json` is present or PHP source files are detected.

## Table of Contents

1. [Three-Tier Config Fallback Pattern](#three-tier-config-fallback)
2. [filter_var Boolean Trap](#filter_var-boolean-trap)
3. [Logging — php://stdout vs error_log](#logging-streams)
4. [realpath() Failure in S3/emptyDir Mode](#realpath-failure)
5. [Undefined Constant Guards](#undefined-constant-guards)
6. [APP_KEY Generation (Laravel)](#app-key-generation)
7. [nginx Non-Root with PHP-FPM](#nginx-non-root)
8. [PHP-FPM Non-Root PID Directory](#php-fpm-non-root-pid-directory)
9. [Laravel Writable Paths](#laravel-writable-paths)
10. [env() Default Argument and IRSA](#env-default-argument-and-irsa)
11. [Laravel Queue Channel Routing](#laravel-queue-channel-routing)
12. [Storage/Fonts/DomPDF emptyDir](#storagefontsdompdff-emptydir)
13. [PHPStan Memory Limit](#phpstan-memory-limit)
14. [Tab-Indented str_replace Workaround](#tab-indented-str_replace-workaround)
15. [GD/S3 Temp-File Pattern](#gd-s3-temp-file-pattern)
16. [Logging Config Key Mismatch](#logging-config-key-mismatch)
17. [Laravel Framework-Consumed Env Vars](#laravel-framework-consumed-env-vars)
18. [Ecommerce Decomposition Triggers](#ecommerce-decomposition-triggers)
19. [PHP Env Var Grep Pattern (Mixed-Case)](#php-env-var-grep-pattern)
20. [Bespoke Installer Config Overwrite](#bespoke-installer-config-overwrite)
21. [Laravel IRSA Null vs Empty-String](#laravel-irsa-null-vs-empty-string)
22. [Supervisord readOnlyRootFilesystem](#supervisord-readonlyrootfilesystem)
23. [Supervisord PHP-FPM Graceful Shutdown](#supervisord-php-fpm-graceful-shutdown)
24. [Nginx PID Override for readOnlyRootFilesystem](#nginx-pid-override)
25. [S3 ACL Modern AWS Accounts](#s3-acl-modern-aws)
26. [Config Load-Order Override Trap](#config-load-order-trap)
27. [Apache Non-Root Port Binding](#apache-non-root-port-binding)
28. [Apache /var/log/apache2 emptyDir Conditional](#apache-log-emptydir-conditional)
29. [www-data UID 33 Coverage (FPM and Apache)](#www-data-uid-33-coverage)
30. [Bespoke-Installer Lock-File Pattern](#bespoke-installer-lock-file-pattern)
31. [php:*-apache CMD Inheritance Trap](#php-apache-cmd-inheritance-trap)
32. [Pre-Dockerfile configPath() Override Detection](#pre-dockerfile-configpath-override-detection)
33. [terminationGracePeriodSeconds — Direct Apache PID 1](#terminationgraceperiodseconds-direct-apache-pid-1)
34. [5-Pass Grep Exclusions — tools/ and scripts/](#5-pass-grep-exclusions-tools-and-scripts)
35. [Undefined Constants Detection Before Three-Tier Fallback](#undefined-constants-detection-before-three-tier-fallback)

## Classification Authority Banner

> **Classification examples in this file are illustrative. SKILL.md Criterion 6 Secret classification guards are authoritative when in conflict.** In particular: DB_USERNAME, DB_HOST, DB_PORT, DB_DATABASE → always ConfigMap; only DB_PASSWORD, DB_CONNECTION_STRING → Secret.


## Pre-Docker Local Validation

**Purpose:** Verify PHP source compiles without syntax errors, dependencies resolve, and the application can bootstrap — all BEFORE `docker build`.

### Commands
```bash
# 1. Syntax check all PHP files (excluding vendor/ and Blade templates)
find . -name '*.php' -not -path '*/vendor/*' -not -path '*/resources/views/*' | xargs -P4 php -l 2>&1 | grep -v 'No syntax errors' | grep -i 'error'
# Expected: empty output. Any output = FAIL.
# IMPORTANT: Do NOT use bare 'grep syntax error' — the success message
# 'No syntax errors detected' contains that substring, causing false positives.

# 2. Composer validate (checks composer.json structure)
composer validate --no-check-publish
# Expected: exit 0

# 3. Dependency install (dry-run if possible, otherwise full)
composer install --no-interaction --no-scripts --prefer-dist 2>&1
# Expected: exit 0
```

### Expected Output
- Step 1: Zero lines of output (all files pass `php -l`)
- Step 2: "./composer.json is valid"
- Step 3: Exit 0 with packages resolved

### CONDITIONAL PASS Triggers
- `php` not installed and `mise install php` fails → CONDITIONAL PASS
- PHP version mismatch (e.g., project requires 8.2, host has 7.4) and mise fails → CONDITIONAL PASS
- Network timeout on Composer dependency download (after 1 retry) → CONDITIONAL PASS

### Toolchain Bootstrap

⚠ **Composer is NOT available via mise.** Do NOT attempt `mise install composer` — it fails with "not found in mise tool registry".

**Install Composer directly:**
```bash
# Check PHP availability first
command -v php && php --version
# If PHP absent, try mise for PHP only
command -v mise && mise install php 2>/dev/null

# Install Composer via official installer (requires PHP + curl)
curl -sSL https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Verify
composer --version
```

**If `/usr/local/bin` is not writable:**
```bash
curl -sSL https://getcomposer.org/installer | php -- --install-dir=/tmp --filename=composer
export PATH="/tmp:$PATH"
composer --version
```

**Custom vendor-dir detection** — run BEFORE §3 env var grep passes:
```bash
# Check for non-standard vendor directory in composer.json
grep -oP '"vendor-dir"\s*:\s*"\K[^"]+' composer.json 2>/dev/null
# Discover all vendor directories (add to --exclude-dir flags)
find . -type d -name vendor -not -path './.git/*' 2>/dev/null
```
Add ALL discovered vendor directories to grep `--exclude-dir` alongside standard `vendor`.

### Validated Example Repositories
- **BookStack** (github.com/BookStackApp/BookStack): `php -l` passes on all 400+ files; `composer validate` passes. Validated 2026-06.
- **OpenCart** (github.com/opencart/opencart): `php -l` passes on 11 modified files; vendor exclusion critical (nested vendor dirs at `upload/system/storage/vendor/`). Validated 2026-06.


## Three-Tier Config Fallback

```php
// GOOD: env var → constant → hardcoded default
define('DB_HOSTNAME', getenv('DB_HOST') ?: 'localhost');
```

Rule: Always use ternary-with-fallback. `getenv()` returns `false` on missing vars.

## filter_var Boolean Trap

`getenv('FLAG')` returns string `'false'` which is **truthy**:

```php
// BAD: string 'false' is truthy!
$debug = getenv('APP_DEBUG') ?: false;

// GOOD:
$debug = filter_var(getenv('APP_DEBUG') ?: 'false', FILTER_VALIDATE_BOOLEAN);
```

Integer: `$port = (int)(getenv('DB_PORT') ?: '3306');`

## Logging Streams

```php
ini_set('error_log', 'php://stderr');
fwrite(STDOUT, json_encode($logEntry) . "\n");
// Or Monolog:
$handler = new \Monolog\Handler\StreamHandler('php://stdout', Logger::INFO);
```

## realpath() Failure

`realpath()` returns `false` for non-existent paths:

```php
// BAD: crashes when path doesn't exist
$path = realpath($uploadDir . '/' . $filename);  // false!

// GOOD:
$path = $uploadDir . '/' . $filename;
if (file_exists($path)) { $resolved = realpath($path); }
```

## Undefined Constant Guards

```php
$prefix = (defined('CACHE_PREFIX') ? CACHE_PREFIX : 'app') . '_' . $key;
```

## APP_KEY Generation

Runtime: Set `APP_KEY` in Kubernetes Secret. Laravel reads from env automatically.

## nginx Non-Root

```nginx
server {
    listen 8080;  # not 80
    fastcgi_pass 127.0.0.1:9000;
}
```

Update Service: `port: 80, targetPort: 8080`. Mount emptyDir at `/var/cache/nginx` and `/var/run`.

## PHP-FPM Non-Root PID Directory

When running as non-root with `readOnlyRootFilesystem: true`:

```ini
[global]
pid = /tmp/php-fpm.pid
```

**Alternative — build-time directory creation:**
```dockerfile
RUN mkdir -p /usr/local/var/run && chown www-data:www-data /usr/local/var/run
USER www-data
```

## Laravel Writable Paths

| Mount Path | Purpose |
|-----------|---------|
| `/tmp` | PHP temp files |
| `storage/framework/sessions` | Session files |
| `storage/framework/cache` | File cache |
| `storage/framework/views` | Compiled Blade templates |
| `storage/logs` | Log fallback |
| `bootstrap/cache` | Compiled config, routes, services |
| `/var/cache/nginx` | nginx proxy temp (if sidecar) |
| `/var/run` | nginx PID file (if sidecar) |
| `/usr/local/var/run` | PHP-FPM PID file |
| `storage/fonts` | DomPDF font cache (if used) |

**www-data UID**: PHP-FPM runs as UID 82 (Alpine) or 33 (Debian). Match `runAsUser` in manifest.

## env() Default Argument and IRSA

```php
// For IRSA, the correct default is null (not empty string).
// See §21 (Laravel IRSA Null vs Empty-String) for the authoritative pattern.
$key = env('AWS_ACCESS_KEY_ID');        // null if unset → SDK uses IRSA
$secret = env('AWS_SECRET_ACCESS_KEY'); // null if unset → SDK uses IRSA
if ($key && $secret) {
    $config['credentials'] = ['key' => $key, 'secret' => $secret];
}
```

**Rule**: For IRSA credential guards, use `null` default (omit second argument to `env()`). See §21 for the full explanation.

## Laravel Queue Channel Routing

**Detection:**
```bash
grep -rn 'class.*implements ShouldQueue' app/ --include='*.php' | grep -oP 'class \K\w+' | sort
```

**Per-queue Deployment:**
```yaml
containers:
- name: worker-notifications
  command: ["php", "artisan", "queue:work", "--queue=notifications", "--tries=3"]
```

**Rule:** Each `--queue=<name>` gets its own Deployment with independently sized resources.

## Storage/Fonts/DomPDF emptyDir

PHP apps using DomPDF write font cache to `storage/fonts/`:

```yaml
volumeMounts:
- name: font-cache
  mountPath: /app/storage/fonts
```

**Detection:** `grep -rn 'dompdf\|barryvdh/laravel-dompdf' composer.json composer.lock`

## PHPStan Memory Limit

```bash
php -d memory_limit=512M vendor/bin/phpstan analyse src/ --level=5
```

**Rule**: Always pass `--memory-limit=512M` when running PHPStan.

## Tab-Indented str_replace Workaround

PHP files (WordPress/OpenCart) use tab indentation. The `editor str_replace` tool may fail when search string contains tabs.

**Workaround:**
```bash
sed -i 's/old_pattern/new_pattern/' path/to/file.php
# Or Python:
python3 -c "
content = open('path/to/file.php').read()
content = content.replace('old_text', 'new_text')
open('path/to/file.php', 'w').write(content)
"
```

## GD/S3 Temp-File Pattern

```php
// GOOD: use /tmp (emptyDir) for GD processing before S3 upload
$tmpPath = tempnam('/tmp', 'img_');
imagepng($gdImage, $tmpPath);
$s3->putObject(['Bucket' => env('S3_BUCKET'), 'Key' => $key, 'SourceFile' => $tmpPath]);
unlink($tmpPath);
```

**Rule**: All GD/Imagick temp files MUST go to `/tmp` (emptyDir-backed).

## Logging Config Key Mismatch

Laravel `config/logging.php` channel names must match the env var value:

```php
'channels' => [
    'stack' => ['driver' => 'stack', 'channels' => ['stdout']],
    'stdout' => ['driver' => 'monolog', 'handler' => StreamHandler::class, 'with' => ['stream' => 'php://stdout']],
]
```

**ConfigMap:** `LOG_CHANNEL: "stack"` — must match a key in `channels` array.

## Laravel Framework-Consumed Env Vars

Laravel reads these env vars internally without explicit `getenv()` in application code:

| Env Var | Purpose | K8s Scope |
|---------|---------|-----------|
| `APP_KEY` | Encryption key | Secret |
| `APP_ENV` | Environment name | ConfigMap |
| `APP_DEBUG` | Debug mode | ConfigMap |
| `APP_URL` | Application URL | ConfigMap |
| `LOG_CHANNEL` | Logging channel | ConfigMap |
| `DB_CONNECTION` | Database driver | ConfigMap |
| `DB_HOST` | Database host | ConfigMap |
| `DB_PORT` | Database port | ConfigMap |
| `DB_DATABASE` | Database name | ConfigMap |
| `DB_USERNAME` | Database user | ConfigMap |
| `DB_PASSWORD` | Database password | Secret |
| `CACHE_DRIVER` | Cache backend | ConfigMap |
| `SESSION_DRIVER` | Session backend | ConfigMap |
| `QUEUE_CONNECTION` | Queue backend | ConfigMap |

**Detection**: `grep -rn "env(" config/ --include='*.php' | grep -oP "env\(['\"]([A-Za-z][A-Za-z0-9_]+)" | sort -u`

## Ecommerce Decomposition Triggers

**Detection triggers:**
```bash
grep -l 'opencart' composer.json system/config/default.php 2>/dev/null
grep -l 'woocommerce' composer.json wp-content/plugins/ 2>/dev/null
grep -l 'magento' composer.json 2>/dev/null
```

**Named service catalog for ecommerce monoliths:**

| Service | Responsibility | Complexity | ExtractionOrder |
|---------|---------------|-----------|----------------|
| CatalogService | Products, categories, attributes | Medium | 3 |
| CartService | Basket, pricing rules, coupons | Medium | 4 |
| OrderService | Checkout, order lifecycle | High | 7 |
| PaymentService | Gateway integration | High | 8 |
| ShippingService | Rates, tracking | Medium | 5 |
| CustomerService | Accounts, addresses | High (shared users) | LAST |
| NotificationService | Order emails, SMS | Low | 1 |
| SearchService | Product search, filters | Low | 2 |
| MediaService | Product images, thumbnails | Low | 2 |
| AdminService | Backoffice CRUD | Medium | 6 |
| ReportingService | Analytics, CSV exports | Low | 3 |
| InventoryService | Stock levels, reservations | Medium | 5 |

**First extractions** (always Low): NotificationService, SearchService, MediaService.

## PHP Env Var Grep Pattern (Mixed-Case)

**Vendor directory exclusion** — ALWAYS add `--exclude-dir=vendor` to ALL PHP env var grep passes. The `vendor/` directory contains third-party Composer packages whose `getenv()`/`env()` calls are internal to those packages, not operator-configurable env vars for the application. Without exclusion, vendor code produces 10-20+ false positives per project.

```bash
# GOOD: catches mixed-case vars, excludes vendor
grep -rhoP "getenv\(['\"]([A-Za-z][A-Za-z0-9_]+)" . --include='*.php' --exclude-dir=vendor | \
  grep -oP "[A-Za-z][A-Za-z0-9_]+" | sort -u

# Also catch env() helper:
grep -rhoP "env\(['\"]([A-Za-z][A-Za-z0-9_]+)" . --include='*.php' --exclude-dir=vendor | \
  grep -oP "[A-Za-z][A-Za-z0-9_]+" | sort -u
```

**Nested vendor directories**: Some PHP frameworks bundle vendor inside subdirectories (e.g., `upload/system/storage/vendor/`, `system/vendor/`). Add additional `--exclude-dir` flags for nested vendor paths found via `find . -type d -name vendor -not -path './.git/*'`.

## Bespoke Installer Config Overwrite

**Trigger:** PHP frameworks with CLI installers (OpenCart `cli_install.php`, WordPress `wp-cli`) that overwrite config files.

**Detection:**
```bash
grep -rn 'file_put_contents.*config\|fwrite.*config' . --include='*.php' | grep -v vendor
```

**Rule:** Patch the installer to generate env-var-backed config, OR document that installer must NOT be run post-migration.

## Laravel IRSA Null vs Empty-String

**Problem:** `env('AWS_ACCESS_KEY_ID', null)` is correct for IRSA. Using `env('AWS_ACCESS_KEY_ID', '')` (empty string) prevents IRSA fallback because `''` is falsy but non-null — SDK interprets it as "credentials provided but empty" rather than "use default provider chain".

**Disambiguation — framework adapter vs raw SDK constructor:**
- **Use empty-string in Secret manifest** (`""`) — envFrom requires the key to exist for the `if ($key && $secret)` guard to work at runtime.
- **Use null default in application code** when `env()` feeds a framework S3 adapter (Laravel Flysystem, which internally uses the SDK kwargs guard pattern).
- **Use null/omit in application code** when passed directly to raw SDK constructor (`new S3Client`), because any non-null value (including `''`) passed as credential parameter blocks the provider chain.
- **Resolution:** The Secret manifest always has `""`. The application code always uses `env('AWS_ACCESS_KEY_ID')` (no second argument = null default). The `if ($key && $secret)` guard in the adapter config ensures credentials are only passed when non-empty.

```php
// GOOD — null default allows IRSA fallback:
'key' => env('AWS_ACCESS_KEY_ID'),        // returns null if unset
'secret' => env('AWS_SECRET_ACCESS_KEY'), // returns null if unset

// BAD — empty string blocks IRSA:
'key' => env('AWS_ACCESS_KEY_ID', ''),
```

**Guard pattern with null check:**
```php
$config = ['region' => env('AWS_DEFAULT_REGION', 'us-east-1')];
if (env('AWS_ACCESS_KEY_ID') && env('AWS_SECRET_ACCESS_KEY')) {
    $config['credentials'] = [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
    ];
}
// When credentials key is absent, SDK uses IRSA/instance profile
```

**Detection:** `grep -rn "env.*AWS_ACCESS_KEY_ID\|env.*AWS_SECRET" config/ --include='*.php'`

**Secret YAML for IRSA:** Keys must be present but empty (envFrom requires the key to exist):
```yaml
stringData:
  AWS_ACCESS_KEY_ID: ""
  AWS_SECRET_ACCESS_KEY: ""
```

## Supervisord readOnlyRootFilesystem

**Trigger:** PHP applications using supervisord to manage PHP-FPM + nginx (or other multi-process setups) with `readOnlyRootFilesystem: true`.

**Problem:** Supervisord requires BOTH a PID file AND a Unix socket for process control. Default paths (`/var/run/supervisor.sock`, `/var/run/supervisord.pid`) are not writable.

**Solution — move BOTH to /tmp:**
```ini
; /etc/supervisor/supervisord.conf
[unix_http_server]
file=/tmp/supervisor.sock

[supervisord]
pidfile=/tmp/supervisord.pid
logfile=/dev/stdout
logfile_maxbytes=0

[supervisorctl]
serverurl=unix:///tmp/supervisor.sock
```

**emptyDir mount:** `/tmp` covers both files. No additional mount needed if `/tmp` is already an emptyDir.

**Detection:** `grep -rn 'supervisord\|supervisor' Dockerfile docker-compose* | grep -v '#'`

## Supervisord PHP-FPM Graceful Shutdown

**Trigger:** PHP-FPM managed by supervisord in a Kubernetes pod. Without explicit configuration, supervisord sends SIGTERM to PHP-FPM which causes immediate hard-kill of worker processes — in-flight requests are dropped.

**Problem:** Kubernetes sends SIGTERM to PID 1 (supervisord) during pod termination. Supervisord then forwards SIGTERM to child processes. PHP-FPM requires SIGQUIT for graceful shutdown — SIGTERM causes immediate worker termination without finishing active requests. `terminationGracePeriodSeconds` is ineffective without the correct stop signal.

**Solution — supervisord config:**
```ini
[program:php-fpm]
command=php-fpm --nodaemonize
stopsignal=QUIT
stopwaitsecs=30
```

**Kubernetes manifest:**
```yaml
spec:
  terminationGracePeriodSeconds: 60  # must be >= stopwaitsecs + 30s overhead
  containers:
  - name: app
    # ...
```

**Rules:**
1. `stopsignal=QUIT` in the `[program:php-fpm]` supervisord block — sends SIGQUIT instead of SIGTERM
2. `stopwaitsecs=30` — time supervisord waits for PHP-FPM to finish active requests
3. `terminationGracePeriodSeconds` in K8s manifest ≥ `stopwaitsecs + 30s` overhead (60s recommended)
4. Both settings must be present — `terminationGracePeriodSeconds` alone is ineffective if supervisord sends SIGTERM

**Detection:**
```bash
grep -rn 'supervisord\|supervisor' Dockerfile docker-compose* | grep -v '#'
```

**Verification:**
```bash
# Confirm stopsignal is set in supervisord conf
grep -rn 'stopsignal' /etc/supervisor/ supervisord.conf conf.d/ 2>/dev/null
# Expected: stopsignal=QUIT in php-fpm program block
```

**Source:** supervisord forwards SIGTERM by default; PHP-FPM requires SIGQUIT for graceful shutdown (https://stackoverflow.com/questions/66010871/supervisord-graceful-shutdown-issue-in-kubernetes).

## Nginx PID Override for readOnlyRootFilesystem

**Trigger:** nginx as a sidecar or standalone with `readOnlyRootFilesystem: true`.

**Problem:** nginx writes its PID to `/run/nginx.pid` (or `/var/run/nginx.pid`) by default, which fails on read-only filesystem.

**Solution — CMD flag override (no config file change needed):**
```dockerfile
CMD ["nginx", "-g", "pid /tmp/nginx.pid; daemon off;"]
```

**Alternative — nginx.conf directive:**
```nginx
pid /tmp/nginx.pid;
```

**Required emptyDir mounts for nginx:**
| Path | Purpose |
|------|---------|
| `/tmp` | PID file, fastcgi temp |
| `/var/cache/nginx` | Proxy/fastcgi cache |
| `/var/run` | Legacy PID location (if not overridden) |

**Detection:** `grep -rn 'nginx' Dockerfile | grep -v '#'`

## S3 ACL Modern AWS Accounts

**Problem:** S3 `'ACL' => 'public-read'` is blocked by default on AWS accounts created after April 2023. The `PutObject` call fails with `AccessControlListNotSupported`.

**Solution — omit ACL parameter entirely:**
```php
// BAD (fails on modern AWS accounts):
$s3->putObject([
    'Bucket' => env('S3_BUCKET'),
    'Key' => $key,
    'SourceFile' => $tmpPath,
    'ACL' => 'public-read',  // BLOCKED
]);

// GOOD (use bucket policy for public access instead):
$s3->putObject([
    'Bucket' => env('S3_BUCKET'),
    'Key' => $key,
    'SourceFile' => $tmpPath,
]);
```

**Detection:** `grep -rn "ACL.*public\|'ACL'" . --include='*.php' | grep -v vendor`

**Infrastructure note:** Document in INFRASTRUCTURE_REQUIREMENTS.md that bucket policy (not object ACL) controls public access on modern AWS accounts.

## Config Load-Order Override Trap

**Trigger:** PHP applications with multi-file config loading where per-app config files silently overwrite values from `default.php` or base config.

**Problem:** Some frameworks load config files in sequence (e.g., `default.php` → `app.php` → `local.php`). A per-app config file with hardcoded values silently overwrites env-var-backed defaults established in the base config.

**Before (overwritten):**
```php
// config/default.php (migrated to use env vars):
'db_host' => getenv('DB_HOST') ?: 'localhost',

// config/app.php (loaded AFTER default.php — OVERWRITES):
'db_host' => 'production-db.internal',  // Hardcoded, wins over env var!
```

**After (fixed):**
```php
// config/app.php (use env var too, or remove the override):
'db_host' => getenv('DB_HOST') ?: 'localhost',
```

**Detection:**
```bash
# Find all config files that might override base config
find . -path '*/config/*.php' -not -path '*/vendor/*' | sort
# Check for hardcoded values in override files
grep -n "=>\s*['\"][a-zA-Z0-9]" config/*.php | grep -v 'getenv\|env(\|true\|false\|null'
```

**Rule:** After migrating base config to env vars, scan ALL override config files for the same keys with hardcoded values. Fix or remove overrides that would negate the env-var migration.

## Entrypoint-Script Env Var Grep

**Trigger:** PHP applications with shell entrypoint scripts (`docker-entrypoint.sh`, `startup.sh`) that read env vars via bash parameter expansion.

**Problem:** Standard PHP env grep (`getenv`/`env()`) misses env vars consumed by entrypoint scripts. These vars are equally important for ENV_VARIABLES.md and ConfigMap/Secret generation.

**Additional grep pass for entrypoint scripts:**
```bash
# Extract env vars from bash parameter expansion in entrypoint scripts
grep -oP '\$\{\K[A-Z][A-Z0-9_]+(?=:-)' entrypoint*.sh startup*.sh docker-entrypoint.sh 2>/dev/null | sort -u
# Also catch direct $VAR references
grep -oP '\$[A-Z][A-Z0-9_]+' entrypoint*.sh startup*.sh docker-entrypoint.sh 2>/dev/null | tr -d '$' | sort -u
```

**Vendor directory exclusion** — ALWAYS exclude vendor/ from PHP env grep:
```bash
grep -rhoP "(?:getenv|env)\(['\"]([A-Za-z][A-Za-z0-9_]+)" . --include='*.php' --exclude-dir=vendor | sort -u
```

**Rule:** When enumerating env vars for PHP projects, run THREE passes: (1) `getenv()`/`env()` in PHP source (excluding vendor/), (2) entrypoint shell scripts, (3) framework-consumed vars (see §17 Laravel Framework-Consumed Env Vars).

## Apache + readOnlyRootFilesystem emptyDir Paths

**Trigger:** PHP applications using Apache (`php:*-apache` image) with `readOnlyRootFilesystem: true`.

**Problem:** Apache requires multiple runtime-writable paths for PID files, lock files, and logs. With `readOnlyRootFilesystem: true`, Apache fails to start with "Permission denied" or "unable to open logs".

**Mandatory emptyDir mounts for Apache:**

| Path | Purpose |
|------|---------|
| `/var/run/apache2` | PID file, graceful restart socket |
| `/var/log/apache2` | Access/error logs (or redirect to /dev/stdout, /dev/stderr) |
| `/var/lock/apache2` | Lock file for accept mutex |
| `/tmp` | PHP temp files, session files |

**Distinction from app-level paths**: These are Apache infrastructure paths. App-level paths (e.g., `storage/`, `bootstrap/cache/`) are listed separately in §9 Laravel Writable Paths.

**Log redirect alternative** — eliminate `/var/log/apache2` emptyDir:
```apache
# In apache2.conf or via sed in Dockerfile:
ErrorLog /dev/stderr
CustomLog /dev/stdout combined
```

**Detection:**
```bash
grep -rn 'apache\|httpd' Dockerfile | grep -iv 'test\|#'
grep -rn 'FROM.*php.*apache' Dockerfile
```

**Dockerfile fix (build-time directory ownership):**
```dockerfile
RUN mkdir -p /var/run/apache2 /var/lock/apache2 && \
    chown -R www-data:www-data /var/run/apache2 /var/lock/apache2
```

**UID note:** Apache on Debian (`php:*-apache`) runs as www-data UID 33. Match with `runAsUser: 33`, `runAsGroup: 33` in security context.

**Total emptyDir count for Laravel/Apache K8s**: A typical Laravel + Apache deployment with `readOnlyRootFilesystem: true` requires 7-9 emptyDir mounts total: 4 Apache infrastructure paths (above) + 3-5 Laravel app paths (`storage/framework/sessions`, `storage/framework/views`, `storage/framework/cache`, `storage/logs`, `bootstrap/cache`). Count ALL before generating the manifest.

## getenv() !== false Guard for Non-IRSA Credentials

**Trigger:** PHP applications using direct AWS credential injection (non-IRSA) where `getenv()` returns `false` for missing vars.

**Problem:** PHP `getenv()` returns `false` (not null or empty string) when a variable is not set. Code using `if ($key)` treats `false` as falsy but `''` (empty string from Secret) as falsy too — both prevent SDK provider chain activation identically.

**Correct guard pattern:**
```php
// GOOD: explicit false check preserves IRSA fallback
$key = getenv('AWS_ACCESS_KEY_ID');
$secret = getenv('AWS_SECRET_ACCESS_KEY');
if ($key !== false && $secret !== false && $key !== '' && $secret !== '') {
    $config['credentials'] = ['key' => $key, 'secret' => $secret];
}
// When both are false OR empty string, SDK uses IRSA
```

**Detection:** `grep -rn "getenv.*AWS" . --include='*.php' | grep -v vendor`

## Apache Non-Root Port Binding

**Trigger:** PHP applications using `php:*-apache` image with `runAsNonRoot: true`.

**Problem:** Apache default config listens on port 80, which requires root to bind. Non-root containers must use port 8080+.

**Fix — sed in Dockerfile to change port binding:**
```dockerfile
# Change Apache to listen on 8080
RUN sed -i 's/Listen 80/Listen 8080/' /etc/apache2/ports.conf && \
    sed -i 's/<VirtualHost \*:80>/<VirtualHost *:8080>/' /etc/apache2/sites-available/000-default.conf

USER www-data
EXPOSE 8080
```

**Kubernetes Service alignment:**
```yaml
spec:
  ports:
  - port: 80
    targetPort: 8080
```

**Detection:**
```bash
grep -rn 'FROM.*php.*apache' Dockerfile
grep -n 'Listen 80' /etc/apache2/ports.conf 2>/dev/null
```

**Rule:** ALL `php:*-apache` images with `runAsNonRoot: true` MUST have ports.conf and VirtualHost changed to 8080. The Kubernetes Service maps external port 80 → container port 8080.

## Apache /var/log/apache2 emptyDir Conditional

**Trigger:** PHP-Apache containers with `readOnlyRootFilesystem: true`.

**Problem:** Apache writes access/error logs to `/var/log/apache2/` by default. Two approaches:

**Option A — Redirect logs to stdout/stderr (preferred, eliminates emptyDir):**
```dockerfile
RUN ln -sf /dev/stdout /var/log/apache2/access.log && \
    ln -sf /dev/stderr /var/log/apache2/error.log
```
Or in apache2.conf:
```apache
ErrorLog /dev/stderr
CustomLog /dev/stdout combined
```

**Option B — emptyDir mount (when log redirection is not feasible):**
```yaml
volumeMounts:
- name: apache-logs
  mountPath: /var/log/apache2
```

**Rule:** If the Dockerfile already redirects Apache logs to /dev/stdout and /dev/stderr (via symlinks or config directives), `/var/log/apache2` emptyDir is NOT required. Check with: `grep -n '/dev/std\|/proc/self/fd' Dockerfile` — any match means log redirect is in place.

## www-data UID 33 Coverage (FPM and Apache)

**Trigger:** ANY Debian-based PHP image (`php:*-fpm`, `php:*-apache`, `php:*-cli` on Debian).

**Problem:** The www-data user is UID 33 on ALL Debian-based PHP images (not just FPM). The Security Context Edge Case (8) in SKILL.md applies equally to `php:*-apache` variants.

**Coverage table:**

| Image Pattern | UID | runAsUser | runAsGroup |
|---|---|---|---|
| `php:*-fpm` (Debian) | 33 | 33 | 33 |
| `php:*-apache` (Debian) | 33 | 33 | 33 |
| `php:*-fpm-alpine` | 82 | 82 | 82 |
| `php:*-cli` (when USER www-data) | 33 | 33 | 33 |

**Detection:**
```bash
grep -n 'FROM.*php:' Dockerfile | grep -iv alpine
# If match: UID = 33
grep -n 'FROM.*php:' Dockerfile | grep -i alpine
# If match: UID = 82
```

**Rule:** Always check the base image variant to determine the correct UID. Do NOT assume UID 1000 for PHP containers.

## Bespoke-Installer Lock-File Pattern

**Trigger:** PHP frameworks with installer scripts (OpenCart `cli_install.php`, custom setup wizards) that write a lock file to indicate installation is complete.

**Problem:** Installers typically write a lock file (e.g., `config/install.lock`, `.installed`) to prevent re-running. With `readOnlyRootFilesystem: true`, this write fails — causing the app to enter install mode on every pod restart.

**Solution A — Pre-seed lock file in Dockerfile:**
```dockerfile
# Create the lock file at build time
RUN touch /app/config/install.lock
```

**Solution B — emptyDir + init container:**
```yaml
initContainers:
- name: create-lock
  image: busybox
  command: ['sh', '-c', 'touch /app-config/install.lock']
  volumeMounts:
  - name: app-config
    mountPath: /app-config
```

**Solution C — RWM PVC (when installer writes config AND lock together):**
If the installer writes both a config file and a lock file to the same directory, use an RWM PVC mounted at that directory path.

**Detection:**
```bash
grep -rn 'install.*lock\|\.installed\|setup_complete' . --include='*.php' | grep -v vendor
grep -rn 'file_exists.*lock\|is_file.*install' . --include='*.php' | grep -v vendor
```

**Rule:** Identify the lock-file path and mechanism before migration. The chosen solution depends on whether the lock is the ONLY file written (Solution A/B) or part of a larger config-write operation (Solution C).

## Cross-Task PHP-FPM error_log Handoff

**Trigger:** PHP-FPM applications where logging transformation (§5) and PHP-FPM non-root configuration (§13) are handled in separate tasks.

**Problem:** PHP-FPM has two separate logging paths: (1) `error_log` in `php.ini` (PHP runtime errors), and (2) FPM worker `access.log`/`error_log` in `www.conf` (pool-level). When §5 redirects application logging to stdout but a later task configures PHP-FPM non-root, the FPM `error_log` path may still point to a non-writable location.

**Checklist — pair these together in same task scope:**
1. `php.ini`: `error_log = /proc/self/fd/2` (stderr)
2. `www.conf`: `php_admin_value[error_log] = /proc/self/fd/2`
3. `www.conf`: `access.log = /proc/self/fd/2` (or `/dev/stderr`)
4. FPM master: `error_log = /proc/self/fd/2` (in `[global]` section)

**Detection:**
```bash
grep -rn 'error_log\|access.log' . --include='*.ini' --include='*.conf' --include='php-fpm*' | grep -v vendor
```

**Rule:** When transforming PHP-FPM logging to stdout/stderr, configure ALL four logging paths in the same pass. A partial handoff (app logging fixed, FPM logging deferred) causes runtime errors when `readOnlyRootFilesystem: true` is applied in a later security hardening task.

## DB-Stored Runtime Configuration

**Trigger:** PHP frameworks that persist settings in database tables (OpenCart `oc_setting`, WordPress `wp_options`, Magento `core_config_data`).

**Problem:** Workers may attempt to add ConfigMap/Secret keys for settings stored in database tables. These values are configured via the admin UI at runtime, not injected via environment variables.

**Rule:** Do NOT add ConfigMap/Secret keys for DB-stored configuration values. Document them in INFRASTRUCTURE_REQUIREMENTS.md §2 or §5b as "post-install admin configuration":
```
## Post-Install Admin Configuration
The following settings are managed via the application's admin interface and stored
in the database. They do NOT require ConfigMap/Secret entries:
- SMTP relay settings (oc_setting table, group: mail)
- Store URL and name (oc_setting table, group: config)
```

**Still required:** NetworkPolicy egress rules for services referenced by DB-stored config (e.g., SMTP relay host requires TCP 25/465/587 egress even though the host value is in the database, not an env var).

**Detection:**
```bash
grep -rn 'oc_setting\|wp_options\|core_config_data\|GlobalProperty' . --include='*.php' --include='*.java' --include='*.sql' | grep -v vendor | grep -v test
```

## Python Bulk Replacement for Log::channel Patterns

**Trigger:** Laravel logging transformation (§5) replacing `Log::channel('...')` calls across ≥3 files.

**Problem:** `editor str_replace` is unreliable for bulk multi-file PHP replacements — partial edits get lost, requiring repair tasks. For ≥3 files with the same pattern, use Python regex in-place substitution from the start.

**Procedure:**
```bash
# Step 1: Preview matches
grep -rln "Log::channel(" app/ --include='*.php' | wc -l
# If count ≥ 3, use Python bulk replacement:

# Step 2: Dry-run (preview changes without writing)
python3 -c "
import re, glob
pattern = re.compile(r'Log::channel\(['\''\"]\w+['\''\"\])\s*->')
for f in glob.glob('app/**/*.php', recursive=True):
    content = open(f).read()
    if pattern.search(content):
        print(f'MATCH: {f}')
        # Show first match context
        for m in pattern.finditer(content):
            print(f'  {m.group(0)} → Log::')
"

# Step 3: Apply replacement
python3 -c "
import re, glob
pattern = re.compile(r'Log::channel\(['\''\"]\w+['\''\"]\)\s*->')
for f in glob.glob('app/**/*.php', recursive=True):
    content = open(f).read()
    new_content = pattern.sub('Log::', content)
    if new_content != content:
        open(f, 'w').write(new_content)
        print(f'UPDATED: {f}')
"
```

**Rule:** When replacing `Log::channel('X')->` patterns across ≥3 files, use Python regex in-place substitution — do NOT use `editor str_replace` for each file individually.

## composer.lock Glob Wildcard Dockerfile COPY

**Trigger:** PHP Dockerfile with `COPY composer.json composer.lock ./` but `composer.lock` is absent from the repository.

**Problem:** `COPY composer.json composer.lock ./` fails with "file not found" when `composer.lock` doesn't exist in the build context (common in some Laravel/Symfony projects that .gitignore the lock file).

**Detection:**
```bash
test -f composer.lock && echo "EXISTS" || echo "MISSING"
grep -n 'COPY.*composer.lock' Dockerfile
```

**WRONG (fails if lock missing):**
```dockerfile
COPY composer.json composer.lock ./
```

**CORRECT (glob wildcard tolerates missing lock):**
```dockerfile
COPY composer.json composer.lock* ./
```

**Rule:** Before writing the Stage 1 COPY in a PHP Dockerfile, check `test -f composer.lock`. If missing, use `COPY composer.json composer.lock* ./` with the glob wildcard so the COPY succeeds regardless.

## Multi-Line env() Grep for config/session.php

**Trigger:** Verifying session driver configuration in Laravel's `config/session.php`.

**Problem:** Laravel's `config/session.php` often splits the `env()` call across multiple lines, causing single-line grep to miss the pattern:
```php
'driver' => env(
    'SESSION_DRIVER',
    'file'
),
```

**Detection (multi-line aware):**
```bash
# Single-line check (catches inline form):
grep -n "env.*SESSION_DRIVER" config/session.php

# Multi-line check (catches split form):
python3 -c "
content = open('config/session.php').read()
import re
m = re.search(r\"'driver'\s*=>\s*env\(\s*['\\\"]SESSION_DRIVER['\\\"]\", content, re.DOTALL)
if m:
    print(f'FOUND at offset {m.start()}')
    print(content[m.start():m.start()+80])
else:
    print('NOT FOUND — session driver may be hardcoded')
"
```

**Rule:** When auditing Laravel config files for `env()` usage, always use the multi-line Python check as a fallback when single-line grep returns no results. PHP config files commonly split function calls across lines.

## Dev-Only Dockerfile Detection

**Trigger:** PHP projects with multiple Dockerfiles where one is intended for development only.

**Detection markers (any one = dev-only):**
- `RUN pecl install xdebug`
- `RUN composer install` (without `--no-dev`)
- `VOLUME` directives for code mounts
- `FROM php:*-fpm` with no multi-stage production build

```bash
grep -lE 'xdebug|composer install[^-]|VOLUME.*\/app' Dockerfile* 2>/dev/null
```

**Rule:** Dev-only Dockerfiles MUST NOT be used for production image builds in Tier 1 validation. If found, generate a separate production Dockerfile (multi-stage, `--no-dev`, no xdebug).

## Multi-Stage ARG Global Scope

**Trigger:** PHP multi-stage Dockerfiles using `ARG` for version pinning.

**Problem:** `ARG` declarations are scoped to the build stage they appear in. An `ARG` before the first `FROM` is available only in `FROM` lines. To use it inside a stage, re-declare it (without default):

```dockerfile
# Global scope — available in FROM lines only:
ARG PHP_VERSION=8.2

FROM php:${PHP_VERSION}-fpm AS builder
# Re-declare to use inside this stage:
ARG PHP_VERSION
RUN echo "Building with PHP ${PHP_VERSION}"
```

**Detection:** `grep -n '^ARG' Dockerfile | head -5` — check if any ARG appears before first FROM.

## Stage 0 — PHP Extension Builder

**Trigger:** PHP applications requiring compiled extensions (gd, intl, zip, bcmath, opcache, etc.) that need `-dev` packages for compilation.

**Problem:** Installing both `-dev` packages and compiling extensions in the runtime stage bloats the final image. Using a separate builder stage compiles extensions against the same ABI as runtime.

**CRITICAL:** The extension builder stage MUST use the SAME `php:<version>-<variant>` tag as the runtime stage for binary ABI compatibility. Mixing tags (e.g., building on php:8.2-fpm then running on php:8.2-apache) causes "undefined symbol" crashes.

**Pattern (3-4 stage build):**
```dockerfile
# Stage 0: Extension builder (same base as runtime for ABI)
ARG PHP_VERSION=8.2
FROM php:${PHP_VERSION}-apache AS php-ext-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
    libzip-dev libicu-dev libonig-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) gd zip intl mbstring opcache bcmath

# Stage 1: Composer dependencies
FROM composer:2 AS composer
COPY composer.json composer.lock* ./
RUN composer install --no-dev --no-scripts --ignore-platform-reqs --prefer-dist

# Stage 2: Runtime (copy compiled extensions + vendor)
FROM php:${PHP_VERSION}-apache
# Copy compiled .so files and .ini configs from builder
COPY --from=php-ext-builder /usr/local/lib/php/extensions/ /usr/local/lib/php/extensions/
COPY --from=php-ext-builder /usr/local/etc/php/conf.d/ /usr/local/etc/php/conf.d/
# Install ONLY runtime shared libraries (not -dev)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng16-16 libjpeg62-turbo libfreetype6 \
    libzip4 libicu72 libonig5 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer /app/vendor vendor/
COPY . /var/www/html/
```

**Detection:** `grep -rn 'docker-php-ext-install\|pecl install' Dockerfile`

**Rules:**
1. Extension builder and runtime MUST share the exact same `php:<version>-<variant>` tag
2. `--ignore-platform-reqs` on composer install in the composer stage (avoids needing extensions there)
3. Install only runtime shared libs (no `-dev` suffix) in the final stage
4. Update guidance: PHP Dockerfiles use "3-4 stages depending on compiled extensions"

## Apache AllowOverride None After sed

**Trigger:** PHP-Apache containers where the Dockerfile uses `sed` to modify Apache config for non-root operation.

**Problem:** After `sed -i` operations on Apache config files, `.htaccess` processing may be disabled if `AllowOverride` was set to `None` in the modified VirtualHost. Many PHP frameworks (Laravel, WordPress, OpenCart) rely on `.htaccess` for routing.

**Detection:**
```bash
grep -rn 'AllowOverride' /etc/apache2/ 2>/dev/null
# If 'AllowOverride None' appears in the document root directory block, .htaccess is disabled
```

**Fix — ensure AllowOverride All for document root:**
```dockerfile
RUN sed -i '/<Directory \/var\/www\/html>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' \
    /etc/apache2/apache2.conf
```

**Rule:** After ANY `sed` modification to Apache config, verify `AllowOverride All` is set for the document root directory. Without it, framework routing breaks silently (all routes return 404 except index).

## CAP_DAC_OVERRIDE Entrypoint Audit

**Trigger:** PHP containers with entrypoint scripts that perform file operations on volumes.

**Problem:** Entrypoint scripts that `chown`, `chmod`, or create directories at startup may need `CAP_DAC_OVERRIDE` capability if running as non-root but writing to volume paths owned by different UIDs (e.g., shared emptyDir between init container and main container).

**Detection:**
```bash
grep -nE 'chown|chmod|mkdir -p' entrypoint*.sh docker-entrypoint*.sh 2>/dev/null
```

**Decision:**
1. If the chown/chmod targets build-time paths → move to Dockerfile (preferred, no capability needed)
2. If the chown/chmod targets volume paths at runtime → either:
   - Use init container with matching UID (preferred), OR
   - Add `CAP_DAC_OVERRIDE` to capabilities (last resort)

**Rule:** Audit ALL entrypoint scripts for file-ownership operations before setting `capabilities: { drop: ["ALL"] }`. Operations that can be moved to build time MUST be moved. Only add capabilities as a documented last resort with explanation.

## Inline Hash Comments in RUN Blocks

**Trigger:** PHP Dockerfiles with multi-line `RUN` instructions containing inline `#` comments.

**Problem:** Inline `#` comments in shell commands within Docker `RUN` instructions can cause unexpected behavior when the comment follows a `\` line continuation:

```dockerfile
# WRONG — comment breaks continuation:
RUN apt-get install -y \
    libpng-dev \  # for GD
    libzip-dev    # for zip

# CORRECT — comments on separate lines or removed:
RUN apt-get install -y \
    libpng-dev \
    libzip-dev
```

**Rule:** Never place `#` comments on the same line as a package in a multi-line `RUN apt-get install`. The shell interprets everything after `#` as a comment, potentially swallowing the line continuation or subsequent packages.

## CMD Omission for php:*-apache Images

**Trigger:** Dockerfiles using `php:*-apache` base image.

**Problem:** The `php:*-apache` base image already has a correct `CMD` (`apache2-foreground`) defined in its parent layers. Adding an explicit `CMD` or `ENTRYPOINT` without understanding the base image's entrypoint chain can break the Apache startup sequence.

**Rule:** For `php:*-apache` images, omit `CMD` unless you need a custom entrypoint. The base image's built-in CMD is sufficient:
```dockerfile
FROM php:8.2-apache
# ... extensions, config, COPY ...
# NO CMD needed — base image provides apache2-foreground
EXPOSE 8080
USER www-data
```

**Exception:** If you need a custom entrypoint for config generation:
```dockerfile
COPY docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["apache2-foreground"]  # Must explicitly restore base CMD when overriding ENTRYPOINT
```

## PHP Multi-Stage Runtime System Libraries

**Trigger:** PHP multi-stage builds where the runtime stage needs shared libraries installed during build.

**Common runtime libraries needed (Debian):**
```dockerfile
# Runtime stage — install ONLY what's needed at runtime:
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng16-16 libjpeg62-turbo libfreetype6 \
    libzip4 libicu72 libonig5 \
    && rm -rf /var/lib/apt/lists/*
```

**Rule:** Never install `-dev` packages in the runtime stage. Use the library package (e.g., `libpng16-16` not `libpng-dev`). The build stage compiles extensions against `-dev` packages; the runtime stage only needs the shared libraries.

**Detection:** `grep -n 'apt-get install' Dockerfile | grep -v 'AS builder' | grep -i dev`

## Nginx Sidecar Init-Copy-Code Pattern

**Trigger:** PHP-FPM + nginx sidecar pattern where nginx needs access to static files from the PHP application.

**Problem:** With `readOnlyRootFilesystem: true`, nginx cannot serve static files from the PHP image unless they are shared via a volume.

**Solution — init container copies static assets:**
```yaml
initContainers:
- name: copy-static
  image: app-image:latest
  command: ['sh', '-c', 'cp -r /app/public/* /static/']
  volumeMounts:
  - name: static-files
    mountPath: /static
containers:
- name: nginx
  image: nginx:alpine
  volumeMounts:
  - name: static-files
    mountPath: /app/public
    readOnly: true
- name: php-fpm
  image: app-image:latest
  # PHP-FPM serves dynamic requests; nginx proxies to 127.0.0.1:9000
```

**Detection:** `grep -rn 'fastcgi_pass\|php-fpm' nginx.conf Dockerfile docker-compose* 2>/dev/null`

## Common Package Writable Paths (DomPDF Expanded)

**Trigger:** PHP applications using DomPDF that write font cache files to a subdirectory of storage/fonts.

**Problem:** DomPDF writes generated font metrics to `storage/fonts/dompdf/` at runtime. With `readOnlyRootFilesystem: true`, this fails silently (PDFs render without custom fonts).

**Solution — emptyDir at the dompdf font cache path:**
```yaml
volumeMounts:
- name: dompdf-fonts
  mountPath: /app/storage/fonts/dompdf
volumes:
- name: dompdf-fonts
  emptyDir: {}
```

**Detection:** `grep -rn 'dompdf\|DOMPDF_FONT_DIR' . --include='*.php' | grep -v vendor`

## Supervisord readOnlyRootFilesystem — All Three Paths

When using supervisord with `readOnlyRootFilesystem: true`, ALL three paths must be writable:

| Path | File | supervisord.conf Directive |
|------|------|---------------------------|
| `/tmp/supervisor.sock` | Unix socket | `[unix_http_server] file=` |
| `/tmp/supervisord.pid` | PID file | `[supervisord] pidfile=` |
| `/tmp/supervisor.sock` | Client socket | `[supervisorctl] serverurl=unix:///tmp/supervisor.sock` |

All three are covered by a single `/tmp` emptyDir mount. Ensure the supervisord.conf points all three to `/tmp`. See §22 (Supervisord readOnlyRootFilesystem) for the full config snippet.


## Production-Safe ConfigMap Defaults (Laravel/PHP)

**Trigger:** Laravel or PHP applications generating ConfigMap manifests with default values from `.env`.

**Problem:** Generated ConfigMaps often mirror the application's `.env` development defaults (SESSION_DRIVER=file, CACHE_DRIVER=file, LOG_CHANNEL=stack). These file-based drivers are incompatible with Kubernetes (ephemeral filesystem, horizontal scaling). Workers deploy manifests with dev defaults, requiring repair cycles.

**Mandatory overrides for ANY Laravel/PHP ConfigMap:**

| Key | Required Value | Why |
|-----|---------------|-----|
| `SESSION_DRIVER` | `redis` (or `database`) | File sessions lost on pod restart/scale |
| `CACHE_DRIVER` | `redis` | File cache not shared across pods |
| `LOG_CHANNEL` | `stderr` | File logs invisible to `kubectl logs` |
| `QUEUE_CONNECTION` | `redis` (or `database`) | Sync/file queues block and don't survive restarts |
| `FILESYSTEM_DISK` | `s3` | Local disk is ephemeral |

**Rule:** File-based drivers (`file`, `single`, `daily`, `local`) are explicitly PROHIBITED in generated ConfigMap manifests for production Kubernetes workloads. Always override with distributed alternatives regardless of what `.env` contains.

**Detection (post-manifest check):**
```bash
grep -E 'SESSION_DRIVER.*file|CACHE_DRIVER.*file|LOG_CHANNEL.*(daily|single|stack)|QUEUE_CONNECTION.*sync' kubernetes/configmap.yaml
# Any match = violation — fix immediately
```

## Config Directory Discovery Pre-Step

**Trigger:** Any PHP/Laravel project before running env var grep passes.

**Problem:** PHP frameworks store config in various locations (`config/`, `app/config/`, `includes/configure.php`, `admin/includes/configure.php`). Missing a config directory during the grep pass causes env var omissions requiring later repair.

**Procedure (run BEFORE §3 grep passes):**
```bash
# Discover all config directories/files
find . -type f \( -name '*.php' -o -name '*.env*' \) -path '*/config*' | head -20
find . -name 'configure.php' -o -name '.env*' -o -name 'config.php' | grep -v vendor
```

**Rule:** Use the discovery output to scope grep passes. Include ALL found config paths in the grep scope — not just the framework-standard `config/` directory.

## APP_KEY Null-Default Enforcement (Laravel)

**Trigger:** Laravel applications with `APP_KEY` in the ConfigMap or `.env`.

**Problem:** Laravel's `APP_KEY` is used for encryption (passwords, cookies, sessions). A non-null placeholder in ConfigMap (e.g., `base64:placeholder...`) would be used verbatim — producing predictable encryption keys across environments.

**Rule:** `APP_KEY` MUST be classified as Secret with an empty-string default. The deployment procedure must generate a unique key per environment (`php artisan key:generate`). Document as a post-deployment action in INFRASTRUCTURE_REQUIREMENTS.md.

```yaml
# kubernetes/secret.yaml
stringData:
  APP_KEY: ""  # MUST be generated per-environment via: php artisan key:generate --show
```

**Detection:**
```bash
grep -n 'APP_KEY' kubernetes/configmap.yaml 2>/dev/null
# Any match = misclassification — move to Secret with empty default
```


## NetworkPolicy SMTP Egress for PHP Mail-Sending Workloads

**Trigger:** PHP application using mail-sending libraries (PHPMailer, SwiftMailer, Symfony Mailer, Laravel Mail) in code paths extracted to CronJobs or scheduled tasks.

**Problem:** When PHP scheduled tasks (e.g., Laravel `schedule:run`, custom cron scripts) send mail synchronously, the CronJob pod needs SMTP egress in its NetworkPolicy. This is commonly missed because SMTP config is often database-stored (admin UI settings) rather than appearing in env vars.

**Detection:**
```bash
# Find mail-sending patterns in PHP code
grep -rn 'PHPMailer\|SwiftMailer\|Transport::fromDsn\|Mail::send\|Mail::to\|mail(' . --include='*.php' | grep -v 'vendor/' | grep -v 'test'
```

**Rule:** If mail-sending code is found in any code path that runs as a CronJob or scheduled task, the CronJob's NetworkPolicy MUST include SMTP egress:

```yaml
egress:
- ports:
  - port: 587
    protocol: TCP
  # ports-only: no 'to:' field — allows egress to any SMTP relay
```

**Additional trigger:** Even when no SMTP env var is present in the codebase, platforms with admin-UI-configurable SMTP (OpenCart, WordPress, BookStack) still need SMTP egress if the scheduled task code path calls mail functions. Grep for the function call, not the env var.


## Non-Standard Vendor Directory Discovery

**Trigger:** PHP projects where `composer.json` specifies a custom `vendor-dir` (e.g., OpenCart uses `upload/system/storage/vendor/`).

**Problem:** Standard `--exclude-dir=vendor` in grep passes misses the custom vendor directory, producing 10-20+ false positives from third-party code.

**Pre-flight discovery step (run BEFORE §3 grep passes):**
```bash
# Check for custom vendor-dir in composer.json
grep -oP '"vendor-dir"\s*:\s*"\K[^"]+' composer.json 2>/dev/null
# Discover all vendor directories
find . -type d -name vendor -not -path './.git/*' 2>/dev/null
```

**Rule:** Add ALL discovered vendor directories to grep `--exclude-dir` flags alongside standard `vendor`. Example:
```bash
grep -rhoP "getenv\(['\"]([A-Za-z][A-Za-z0-9_]+)" . --include='*.php' \
  --exclude-dir=vendor --exclude-dir=upload/system/storage/vendor
```

## Nginx Non-Root user Directive Removal

**Trigger:** PHP-FPM + nginx sidecar where nginx runs as non-root.

**Problem:** The default `/etc/nginx/nginx.conf` contains `user nginx;` directive. When the container runs as non-root (UID 101 for nginx:alpine), the `user` directive causes: "nginx: [emerg] getpwnam('nginx') failed" because the process can't change users.

**Fix — remove the user directive:**
```dockerfile
RUN sed -i '/^user /d' /etc/nginx/nginx.conf
```

**Detection:**
```bash
grep -n '^user ' /etc/nginx/nginx.conf 2>/dev/null
```

**Rule:** When deploying nginx as non-root (runAsUser: 101), remove the `user` directive from nginx.conf. The process runs as whatever UID the container is started with.

## httpd:2.4-alpine www-data User Creation

**Trigger:** PHP applications using `httpd:2.4-alpine` (Apache) base image.

**Problem:** `httpd:2.4-alpine` does NOT include a `www-data` user by default (unlike Debian-based Apache images). PHP-FPM configuration that references `www-data` fails.

**Fix — create user in Dockerfile:**
```dockerfile
FROM httpd:2.4-alpine
RUN addgroup -S www-data && adduser -S -G www-data -u 33 www-data
```

**Rule:** When using `httpd:2.4-alpine` with PHP-FPM (where FPM runs as www-data), explicitly create the www-data user in the Dockerfile.

## Composer getcomposer.org Fallback Installation

**Trigger:** Docker build environment where `composer` binary is not available.

**Problem:** Some base images (e.g., `php:8.x-apache`) don't include Composer. The multi-stage pattern uses `FROM composer:2 AS composer` but for single-stage builds, Composer must be installed.

**Canonical installation (single-stage):**
```dockerfile
RUN curl -sSL https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
```

**Alternative — COPY from composer image:**
```dockerfile
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
```

**Rule:** Prefer `COPY --from=composer:2` for reproducibility. Use curl fallback only when multi-stage is not feasible.

## False-Sentinel Exception for Credential Audit

**Trigger:** PHP applications using sentinel values (e.g., `'changeme'`, `'null'`, `'disabled'`) as explicit "not configured" markers.

**Problem:** Credential scan Forms A-C flag these as hardcoded credentials. However, some frameworks use sentinel string values to detect unconfigured state — removing them breaks the detection logic.

**Example:**
```php
// OpenCart pattern — sentinel marks "unconfigured"
define('DB_PASSWORD', 'changeme');
// Application checks:
if (DB_PASSWORD === 'changeme') {
    redirect('/install');
}
```

**Rule:** When a hardcoded value serves as a feature-detection sentinel (code explicitly compares against it), it is NOT a credential exposure. Document as "false-sentinel — application uses value as unconfigured marker" in task report. Replace with `env('VAR', '')` where the empty-string default serves the same detection purpose:
```php
define('DB_PASSWORD', getenv('DB_PASSWORD') ?: '');
if (empty(DB_PASSWORD)) {
    redirect('/install');
}
```

---

## getenv() Credential Presence Guard

**Trigger:** PHP credential fields read via `getenv()` where the application must distinguish between a variable being absent vs intentionally set to empty string.

**Problem:** The common PHP idiom `getenv('VAR') ?: 'default'` treats both `getenv()` returning `false` (variable absent) and returning `""` (variable set to empty) as falsy, and substitutes the default for both cases. For credential fields, an intentionally empty string (activating a fallback auth mechanism like IRSA) would incorrectly receive the hardcoded default.

**Rule:** For credential fields, use `getenv('VAR') !== false ? getenv('VAR') : null` (or equivalent) rather than the `?:` operator. This preserves intentionally empty string values and only substitutes when the variable is truly absent.

**Applies to:** AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and any credential field where empty string has semantic meaning (e.g., activating provider chain).

---

## PHP CLI Entry Point: $_GET/$_SERVER Routing in CronJobs

**Trigger:** PHP scripts extracted to CronJob manifests that use `$_GET` or `$_SERVER['REQUEST_URI']` for execution-path routing, originally designed for both web and CLI invocation.

**Problem:** `$_GET` is empty and `$_SERVER['REQUEST_URI']` is unset in CLI context. Scripts relying on these for routing silently take a default/no-op path when run as a CronJob, producing no work and no error.

**Rule:** Before extracting a PHP script to a CronJob, check for `$_GET`/`$_SERVER['REQUEST_URI']` routing logic. If present, introduce a `APP_MODE` environment variable (or equivalent CLI argument) to explicitly select the execution path, and update the CronJob container `env:` section accordingly. Document the routing mechanism in the task report.

---

## exec() Orphan Process in Containerised CronJobs

**Trigger:** PHP CronJob scripts that use `exec()`, `shell_exec()`, or `popen()` to spawn background sub-processes.

**Problem:** Background processes spawned via `exec()` in a container run as orphans — they are not managed by the container runtime. When the PHP process exits, the container exits, potentially before the background process completes. The orphan process may also prevent clean container shutdown.

**Rule:** Audit all PHP CronJob entry points for `exec()`/`shell_exec()`/`popen()` calls. Convert background work to direct PHP function calls within the same process, or use a supervisor-managed process (e.g., supervisord) if background execution is genuinely required. Document any retained `exec()` calls and their rationale in the task report.

---

## www-data UID by Base Image Variant

**Trigger:** PHP application container setting `runAsUser` in the Kubernetes security context.

**Problem:** The `www-data` user has different UIDs depending on the base image:
- `php:*-apache` — UID 33
- `php:*-fpm` — UID 82  
- `ubuntu`/`debian`-based custom images — UID 33

**Rule:** Do not assume a fixed UID for `www-data`. Determine the actual UID from the base image by inspecting the image's `/etc/passwd` or the upstream Dockerfile before setting `runAsUser`. Set `runAsUser` to the detected value, and document the base image variant and its UID in the task report.

## Alpine httpd Missing www-data User

**Trigger:** PHP applications using `httpd:2.4-alpine` (Alpine-based Apache) as the base image.

**Problem:** `httpd:2.4-alpine` does NOT include a `www-data` user by default — unlike Debian-based images where www-data (UID 33) exists. PHP-FPM configuration referencing `www-data` fails at startup with "user not found".

**Fix — create user in Dockerfile with correct flags:**
```dockerfile
FROM httpd:2.4-alpine
# -S = system user, -G = group, -u = explicit UID, -H = no home dir
RUN addgroup -S www-data && adduser -S -H -G www-data -u 33 www-data
```

**Detection:**
```bash
grep -n 'FROM.*httpd.*alpine' Dockerfile
grep -rn 'www-data' Dockerfile | grep -v '#'
# Both present without adduser/addgroup = startup failure
```

**Rule:** When using `httpd:2.4-alpine`, ALWAYS create www-data user explicitly. The `-H` flag prevents creation of a home directory (not needed for service users). Use UID 33 for consistency with Debian-based PHP images.

## DB-Driven HTTP Cron Dispatcher Pattern

**Trigger:** Ecommerce applications (OpenCart, Magento, WooCommerce) where scheduled tasks are dispatched by an HTTP-triggered cron controller that reads task definitions from the database.

**Problem:** Unlike simple cron scripts that can be extracted to individual CronJob manifests, HTTP-dispatched cron uses a single URL endpoint (e.g., `/admin/cron/run`) that iterates over DB-registered tasks. Each task is not a standalone script — it's a class invoked by the dispatcher framework.

**Solution — single CronJob for the HTTP dispatcher:**
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cron-dispatcher
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: cron
            image: app-image:tag
            command: ["php", "cli_cron.php"]
            # OR for HTTP-gated dispatchers:
            # command: ["curl", "-s", "http://localhost:8080/cron/run?token=${CRON_TOKEN}"]
```

**Rule:** For DB-driven cron dispatchers, generate ONE CronJob manifest that invokes the dispatcher endpoint/CLI — do NOT attempt to extract individual tasks into separate CronJobs. The task registry lives in the database and cannot be enumerated statically.

**Auth-gated dispatcher note:** If the cron endpoint requires authentication, add a `CRON_TOKEN` or `CRON_SECRET` to the Secret manifest and pass it in the CronJob env.

## exec() Background Process Anti-Pattern

**Trigger:** PHP code using `exec()`, `shell_exec()`, or `popen()` to spawn background processes (often with `&` or `nohup`).

**Problem:** Background processes spawned via `exec()` in a container:
1. Are not managed by the container runtime — they become orphans when PHP exits
2. May prevent clean container shutdown (SIGTERM not forwarded)
3. In CronJobs, the container exits (job completes) while the background process is still running

**Detection:**
```bash
grep -rn 'exec(\|shell_exec(\|popen(' . --include='*.php' | grep -v vendor | grep -v test | grep -E '&|nohup|background'
```

**Rule:** Convert `exec()`-based background work to:
1. **Dedicated worker Deployment** — for long-running processes (e.g., video encoding, report generation)
2. **Queue job** — push to Redis/database queue, process in a worker pod
3. **Direct function call** — if the work is short, call it synchronously within the same process

## Supervisord/Cron OS-Level emptyDir Paths

**Trigger:** PHP applications using supervisord or cron daemon with `readOnlyRootFilesystem: true`.

**Required emptyDir mounts for supervisord + cron:**

| Path | Purpose |
|------|---------|
| `/tmp` | supervisor.sock, supervisord.pid |
| `/etc/cron.d` | Crontab files (if using cron daemon) |
| `/var/log` | Cron/supervisor log fallback |
| `/var/run` | PID files, sockets |
| `/var/run/supervisor` | Alternative supervisor socket path |
| `/var/spool/cron` | Alternative crontab location |

**Detection:**
```bash
grep -rn 'supervisord\|cron' Dockerfile docker-compose* | grep -v '#'
grep -rn '/etc/cron\|/var/spool/cron\|/var/log' entrypoint*.sh docker-entrypoint*.sh 2>/dev/null
```

**Rule:** When supervisord OR cron daemon is used, enumerate ALL paths written by scanning entrypoint scripts and supervisor config. Each writable path needs an emptyDir mount.

## DomPDF storage/fonts Mapping Confirmation

**Trigger:** PHP applications with `barryvdh/laravel-dompdf` or `dompdf/dompdf` in dependencies.

**Detection:**
```bash
grep -rn 'dompdf\|barryvdh/laravel-dompdf' composer.json composer.lock 2>/dev/null
grep -rn 'DOMPDF_FONT\|font_dir\|fontDir' . --include='*.php' | grep -v vendor
```

**Confirm writable path:** DomPDF caches generated font metrics at runtime. The default path is `storage/fonts/` (Laravel) or configured via `DOMPDF_FONT_DIR`. Mount as emptyDir:
```yaml
volumeMounts:
- name: dompdf-fonts
  mountPath: /app/storage/fonts
```

**Rule:** When DomPDF is in dependencies, confirm the font cache directory exists as an emptyDir mount. Without it, PDF generation with custom fonts fails silently (renders with default font).

## Large-Codebase Syntax Check Fallback

**Trigger:** PHP projects with >2000 `.php` files where `find . -name '*.php' | xargs php -l` takes excessive time (>5 minutes).

**Problem:** The Pre-Docker Local Validation gate requires syntax checking all PHP files, but in large codebases this can exceed task time budgets.

**Fallback procedure** (use ONLY when full-tree check exceeds 5 minutes):
```bash
# Count PHP files (excluding vendor)
PHP_COUNT=$(find . -name '*.php' -not -path '*/vendor/*' | wc -l)

if [ "$PHP_COUNT" -gt 2000 ]; then
  echo "Large codebase ($PHP_COUNT files) — using sampled syntax check"
  # Check all modified/new files first
  find . -name '*.php' -not -path '*/vendor/*' -newer composer.json | xargs -P4 php -l 2>&1 | grep -v 'No syntax errors'
  # Then random sample of 500 files
  find . -name '*.php' -not -path '*/vendor/*' | shuf -n 500 | xargs -P4 php -l 2>&1 | grep -v 'No syntax errors'
else
  find . -name '*.php' -not -path '*/vendor/*' | xargs -P4 php -l 2>&1 | grep -v 'No syntax errors'
fi
```

**Rule:** Record result as `PASS (sampled — N/M files checked)` when using the fallback. Full-tree check is always preferred when time permits.

## php:*-apache CMD Inheritance Trap

**Trigger:** Dockerfiles using `php:*-apache` base image with a custom entrypoint script that uses `$# -gt 0` guard.

**Problem:** The `php:*-apache` base image sets `CMD ["apache2-foreground"]`. When you add `ENTRYPOINT ["docker-entrypoint.sh"]`, Docker passes the CMD as arguments to the entrypoint. Inside the entrypoint, `$# -gt 0` is ALWAYS true (because `apache2-foreground` is passed as $1), causing the guard to always fire — typically exec-ing the CMD and skipping all entrypoint setup logic.

**Before (broken):**
```bash
#!/bin/bash
# docker-entrypoint.sh
if [ "$#" -gt 0 ]; then
    exec "$@"  # Always fires! Skips all setup below.
fi
# Setup logic never runs...
```

**After (fixed):**
```bash
#!/bin/bash
# docker-entrypoint.sh
# Perform setup unconditionally
php artisan config:cache 2>/dev/null || true
php artisan route:cache 2>/dev/null || true

# Then exec the CMD (apache2-foreground)
exec "$@"
```

**Detection:**
```bash
grep -n '\$#.*-gt 0\|\$#.*-ge 1' entrypoint*.sh docker-entrypoint*.sh 2>/dev/null
grep -n 'FROM.*php.*apache' Dockerfile
# Both present = potential CMD inheritance trap
```

**Rule:** For `php:*-apache` images, NEVER use `$# -gt 0` as a conditional guard in the entrypoint. Always perform setup logic unconditionally and end with `exec "$@"`.

## Pre-Dockerfile configPath() Override Detection

**Trigger:** PHP/Laravel projects where the application overrides framework-default config directory paths.

**Problem:** Laravel's `configPath()` helper or custom `$app->useConfigPath()` calls can redirect config loading to a non-standard directory. If the Dockerfile COPYs only the standard `config/` directory, the actual config files may be missing at runtime.

**Detection (run BEFORE writing Dockerfile COPY instructions):**
```bash
grep -rn 'configPath\|useConfigPath\|config_path' app/ bootstrap/ --include='*.php' | grep -v vendor
grep -rn "basePath.*config\|configurationIsCached" bootstrap/ --include='*.php' | grep -v vendor
```

**Rule:** Before writing any Dockerfile COPY instruction for PHP config files, run this detection step. If a non-standard config path is found, ensure the Dockerfile COPYs that path instead of (or in addition to) the standard `config/` directory. Document the override in the task report.

## terminationGracePeriodSeconds — Direct Apache PID 1

**Trigger:** PHP applications using Apache as PID 1 (no supervisord wrapper) — i.e., `php:*-apache` image with default CMD.

**Formula:** `terminationGracePeriodSeconds` = Apache `Timeout` directive value + 30s buffer.

**Default:** Apache `Timeout` defaults to 60s → `terminationGracePeriodSeconds: 90`.

**Detection:**
```bash
# Check if Apache is PID 1 (no supervisord)
grep -n 'supervisord\|supervisor' Dockerfile | grep -v '#'
# If empty: Apache is PID 1

# Check custom Timeout value
grep -rn 'Timeout ' /etc/apache2/ apache2.conf 2>/dev/null | grep -v '#'
# If empty: use default 60s
```

**Manifest:**
```yaml
spec:
  terminationGracePeriodSeconds: 90  # Apache Timeout 60s + 30s buffer
```

**Rule:** When Apache is PID 1 (no supervisord), set `terminationGracePeriodSeconds` to `Apache Timeout + 30s`. If supervisord wraps Apache, use the supervisord formula (stopwaitsecs + 30s) from §23 instead.

## 5-Pass Grep Exclusions — tools/ and scripts/

**Trigger:** PHP projects containing `tools/`, `scripts/`, or `bin/` subdirectories with utility/migration PHP scripts not part of the runtime application.

**Problem:** PHP files in `tools/`, `scripts/`, and `bin/` often contain admin utilities, data migration scripts, or CI helpers that reference env vars not relevant to the production deployment. Including them inflates ENV_VARIABLES.md with non-operational vars.

**Detection:**
```bash
find . -type d \( -name tools -o -name scripts -o -name bin \) -not -path '*/vendor/*' 2>/dev/null
```

**Rule:** Add `--exclude-dir=tools --exclude-dir=scripts` to all 5-pass grep commands when these directories contain non-runtime utility scripts. Inspect first: if `tools/` contains code that runs in production (e.g., cron scripts), include it. If it contains one-off migration/setup scripts, exclude it.

**Verification:** After excluding, confirm no production-critical env vars were dropped by cross-referencing against `config/` directory env() calls.

## Undefined Constants Detection Before Three-Tier Fallback

**Trigger:** PHP applications using `define()` constants for configuration, where the three-tier fallback (`getenv() ?: CONSTANT ?: default`) references constants that may not be defined in all execution contexts.

**Problem:** When migrating from `define('DB_HOST', 'localhost')` to `getenv('DB_HOST') ?: DB_HOST`, the constant `DB_HOST` may not exist in CLI/CronJob context (where the config file defining it isn't loaded), causing a fatal "undefined constant" error.

**Detection (run BEFORE applying three-tier fallback):**
```bash
# Find all define() constants in config files
grep -rhoP "define\(['\"]([A-Z][A-Z0-9_]+)" . --include='*.php' --exclude-dir=vendor | sort -u > /tmp/defined_constants.txt

# Find all bare constant references in the target file
grep -oP '\b[A-Z][A-Z0-9_]{2,}\b' target_file.php | sort -u > /tmp/used_constants.txt

# Check which used constants are NOT defined in any scanned file
comm -23 /tmp/used_constants.txt /tmp/defined_constants.txt
```

**Rule:** Before applying the three-tier fallback pattern to any constant, verify the constant is defined in ALL execution contexts (web, CLI, CronJob). If not, use `defined('CONST') ? CONST : 'default'` as the second tier, or skip the constant tier entirely and use `getenv('VAR') ?: 'default'` (two-tier).

**Safe two-tier pattern (when constant may not exist):**
```php
$dbHost = getenv('DB_HOST') ?: 'localhost';
// NOT: getenv('DB_HOST') ?: DB_HOST ?: 'localhost'  (fatal if DB_HOST undefined)
```

