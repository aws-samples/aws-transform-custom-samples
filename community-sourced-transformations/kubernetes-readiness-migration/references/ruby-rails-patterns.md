# Ruby/Rails Patterns Reference

Ruby and Rails-specific containerisation gotchas for Phase 2 transformation. Applies when `Gemfile` is present.

## Table of Contents

1. [ENV.fetch vs ENV[]](#envfetch-vs-env)
2. [IRSA present? Pattern](#irsa-present-pattern)
3. [ActiveStorage Dual-File Co-Dependency](#activestorage-dual-file-co-dependency)
4. [cable.yml ERB for ActionCable](#cableyml-erb-for-actioncable)
5. [ActionCable Redis Adapter NetworkPolicy](#actioncable-redis-adapter-networkpolicy)
6. [emptyDir Paths for Rails](#emptydir-paths-for-rails)
7. [stdout Sync for Logging](#stdout-sync-for-logging)
8. [Puma Configuration](#puma-configuration)
9. [Database.yml ERB Patterns](#databaseyml-erb-patterns)
10. [whenever Gem → Sidekiq-Cron Migration](#whenever-to-sidekiq-cron)
11. [ActiveStorage CleanupJob](#activestorage-cleanupjob)
12. [YAML+ERB Ternary Pattern](#yaml-erb-ternary)
13. [libvips42 for Image Processing](#libvips42-for-image-processing)
14. [retry_on for Transient Failures](#retry_on-for-transient-failures)
15. [ActionCable WebSocket Nginx Ingress Annotations](#actioncable-websocket-nginx-ingress)


## Pre-Docker Local Validation

**Purpose:** Verify Ruby source has no syntax errors, dependencies resolve, and basic tests pass — all BEFORE `docker build`.

### Commands
```bash
# 1. Syntax check all Ruby files (excluding vendor/)
find . -name '*.rb' -not -path '*/vendor/*' | xargs ruby -c 2>&1 | grep -v 'Syntax OK'
# Expected: empty output. Any output = FAIL.

# 2. Bundle check (verify deps installed)
bundle check 2>&1
# Expected: exit 0 ("The Gemfile's dependencies are satisfied")

# 3. If bundle check fails, attempt install
bundle install --jobs=4 2>&1
# Expected: exit 0

# 4. Unit tests (infrastructure-excluded)
bundle exec rspec --tag ~@integration --tag ~@db --fail-fast 2>&1 || true
# Exit 0 = PASS; infrastructure failures = CONDITIONAL PASS; syntax/import errors = FAIL
```

### Expected Output
- Step 1: Zero lines of output (all files pass `ruby -c`)
- Step 2: Exit 0
- Step 4: Exit 0 or infrastructure-only failures

### CONDITIONAL PASS Triggers
- `ruby` not installed and `mise install ruby` fails → CONDITIONAL PASS
- Ruby version mismatch (Gemfile constraint != host version) → CONDITIONAL PASS
- Native extension build failure (missing system libs) → CONDITIONAL PASS
- Bundler version mismatch → CONDITIONAL PASS (see §CONDITIONAL PASS for Ruby Bundler Version Mismatch)

### Toolchain Bootstrap via mise/rbenv
```bash
# Check Ruby availability
command -v ruby && ruby --version
# If absent or wrong version, try mise
RUBY_VER=$(grep -oP "^ruby ['"]?\K[0-9.]+" Gemfile 2>/dev/null || echo "")
if command -v mise >/dev/null 2>&1 && [ -n "$RUBY_VER" ]; then
  mise install ruby@$RUBY_VER 2>/dev/null
  export PATH=$HOME/.local/share/mise/shims:$PATH
fi
ruby --version
# Install bundler if missing
gem install bundler --no-document 2>/dev/null || true
```

### Validated Example Repositories
- NOT YET VALIDATED AGAINST REAL REPO — commands inferred from Ruby/Rails documentation. Mark as validated when a Ruby project passes through the pipeline.


## ENV.fetch vs ENV[]

```ruby
# ENV[] returns nil silently on missing key
host = ENV['DATABASE_HOST']  # nil if unset

# ENV.fetch raises KeyError on missing key (preferred for required vars)
host = ENV.fetch('DATABASE_HOST')
host = ENV.fetch('DATABASE_HOST', 'localhost')  # with default
```

**Migration pattern**:
```ruby
# Before:
config.host = 'db.internal.example.com'
# After:
config.host = ENV.fetch('DATABASE_HOST', 'localhost')
```

## IRSA present? Pattern

```ruby
credentials = if ENV['AWS_ACCESS_KEY_ID'].present? && ENV['AWS_SECRET_ACCESS_KEY'].present?
  Aws::Credentials.new(ENV['AWS_ACCESS_KEY_ID'], ENV['AWS_SECRET_ACCESS_KEY'])
end

s3_client = Aws::S3::Client.new(
  region: ENV.fetch('AWS_REGION', 'us-east-1'),
  credentials: credentials  # nil → SDK uses default provider chain (IRSA)
)
```

**Critical**: `.present?` checks both non-nil AND non-empty. Secret YAML must have active empty-string entries:
```yaml
stringData:
  AWS_ACCESS_KEY_ID: ""
  AWS_SECRET_ACCESS_KEY: ""
```

## ActiveStorage Dual-File Co-Dependency

ActiveStorage requires TWO files updated together:

```yaml
# config/storage.yml
amazon:
  service: S3
  access_key_id: <%= ENV['AWS_ACCESS_KEY_ID'] %>
  secret_access_key: <%= ENV['AWS_SECRET_ACCESS_KEY'] %>
  region: <%= ENV.fetch('AWS_REGION', 'us-east-1') %>
  bucket: <%= ENV.fetch('S3_BUCKET') %>
```

```ruby
# config/environments/production.rb
config.active_storage.service = :amazon
```

**Rule**: Both files MUST be updated atomically.

## cable.yml ERB for ActionCable

```yaml
production:
  adapter: redis
  url: <%= ENV.fetch('REDIS_URL', 'redis://localhost:6379/1') %>
  channel_prefix: <%= ENV.fetch('CABLE_CHANNEL_PREFIX', 'myapp_production') %>
```

**NetworkPolicy impact**: ActionCable adapter needs egress to Redis.

## ActionCable Redis Adapter NetworkPolicy

When ActionCable uses Redis adapter, the web Deployment needs Redis egress:

```yaml
# networkpolicy-web.yaml (egress section)
egress:
- to:
  - podSelector:
      matchLabels:
        app: redis
  ports:
  - port: 6379
    protocol: TCP
```

**Detection:**
```bash
grep -n 'adapter.*redis\|redis.*adapter' config/cable.yml
```

**Rule**: If `cable.yml` references Redis, the web workload's NetworkPolicy MUST include Redis egress — separate from any Sidekiq worker Redis egress.

## emptyDir Paths for Rails

Minimum emptyDir volumes for Rails with `readOnlyRootFilesystem: true`:

| Mount Path | Purpose |
|-----------|---------|
| `/tmp` | Ruby tempfiles, Puma state |
| `tmp/pids` | Puma/Sidekiq PID files |
| `tmp/cache` | Rails file cache (if used) |
| `tmp/sockets` | Unix sockets (if Puma uses them) |
| `log/` | Log fallback (some gems write here) |
| `storage/` | ActiveStorage local fallback (dev mode) |

**Note**: Rails convention uses `tmp/` relative to app root, not system `/tmp`. Mount both.

## stdout Sync for Logging

```ruby
$stdout.sync = true
config.logger = ActiveSupport::Logger.new($stdout)
config.log_level = ENV.fetch('LOG_LEVEL', 'info').to_sym
```

**Without `$stdout.sync = true`**: logs buffer and may be lost on SIGKILL.

## Puma Configuration

```ruby
workers ENV.fetch('WEB_CONCURRENCY', 2).to_i
threads_count = ENV.fetch('RAILS_MAX_THREADS', 5).to_i
threads threads_count, threads_count
port ENV.fetch('PORT', 3000)
preload_app!

on_worker_boot do
  ActiveRecord::Base.establish_connection
end
```

**Connection pool**: `RAILS_MAX_THREADS` must match `pool:` in `database.yml`. Total DB connections = `WEB_CONCURRENCY × RAILS_MAX_THREADS`.

## Database.yml ERB Patterns

```yaml
production:
  adapter: postgresql
  host: <%= ENV.fetch('DATABASE_HOST', 'localhost') %>
  port: <%= ENV.fetch('DATABASE_PORT', 5432) %>
  database: <%= ENV.fetch('DATABASE_NAME', 'myapp_production') %>
  username: <%= ENV.fetch('DATABASE_USERNAME', 'postgres') %>
  password: <%= ENV['DATABASE_PASSWORD'] %>
  pool: <%= ENV.fetch('RAILS_MAX_THREADS', 5) %>
```

**Rule**: Use `ENV.fetch` for required vars, `ENV['KEY']` only for passwords (nil-safe for IRSA pattern).

## whenever Gem → Sidekiq-Cron Migration

The `whenever` gem generates crontab entries that require a single always-running process. In Kubernetes, migrate to Sidekiq-Cron or Kubernetes CronJobs.

**Detection:**
```bash
grep -l 'whenever' Gemfile
cat config/schedule.rb
```

**Option A — Kubernetes CronJob (preferred for simple tasks):**
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cleanup-service
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: cleanup
            command: ["bundle", "exec", "rails", "runner", "CleanupService.perform"]
          restartPolicy: Never
```

**Option B — Sidekiq-Cron (for tasks needing Sidekiq infrastructure):**
```ruby
Sidekiq::Cron::Job.create(
  name: 'Cleanup Service - every hour',
  cron: '0 * * * *',
  class: 'CleanupWorker'
)
```

**Rule**: Remove `whenever` gem from Gemfile after migration.

## ActiveStorage CleanupJob

ActiveStorage creates orphaned blobs when attachments are replaced. Schedule cleanup:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: activestorage-cleanup
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: cleanup
            command: ["bundle", "exec", "rails", "runner", "ActiveStorage::Blob.unattached.where('active_storage_blobs.created_at < ?', 2.days.ago).find_each(&:purge_later)"]
          restartPolicy: Never
```

**Detection:** `grep -rn 'has_one_attached\|has_many_attached' app/models/`

## YAML+ERB Ternary Pattern

For Rails config files using ERB ternary with env vars:

```yaml
adapter: <%= ENV['CACHE_STORE'] == 'redis' ? 'redis' : 'file' %>
url: <%= ENV.fetch('REDIS_URL', 'redis://localhost:6379') if ENV['CACHE_STORE'] == 'redis' %>
```

**Trap**: ERB `nil` in YAML produces the literal string `""` (empty), not YAML null. Use explicit conditionals.

## libvips42 for Image Processing

Rails 7+ defaults to `vips` for ActiveStorage image variants:

```dockerfile
# Debian/Ubuntu
RUN apt-get update && apt-get install -y --no-install-recommends libvips42

# Alpine
RUN apk add --no-cache vips
```

**Detection:**
```bash
grep -n 'image_processing\|mini_magick\|vips' Gemfile
grep -n 'variant_processor' config/application.rb config/environments/*.rb
```

**Rule**: If `config.active_storage.variant_processor = :vips` (Rails 7 default), install `libvips42`.

## retry_on for Transient Failures

```ruby
class NotificationJob < ApplicationJob
  retry_on Net::OpenTimeout, wait: :exponentially_longer, attempts: 5
  retry_on Redis::ConnectionError, wait: 5.seconds, attempts: 3
  discard_on ActiveJob::DeserializationError
end
```

**Rule**: Add `retry_on` for network-dependent jobs. Add `discard_on` for permanent failures. Without these, jobs retry indefinitely.

**Kubernetes impact**: retry_on replaces external retry mechanisms — do NOT add restartPolicy-based retries for Jobs that already use retry_on.

## ENV.fetch Pre-Docker-Build Audit

**Trigger:** Before running `docker build` on any Rails application.

**Problem:** `ENV.fetch('KEY')` (without a second argument) raises `KeyError` if the env var is not set. During `docker build`, when `RUN bundle exec rake assets:precompile` runs in `RAILS_ENV=production` mode, class-level or config-file `ENV.fetch` calls execute — and if the key is not set in the Docker build environment, the build fails.

**Detection:**
```bash
# Find bare ENV.fetch calls (no default = no comma after first argument)
grep -rn 'ENV\.fetch' config/ app/ lib/ --include='*.rb' | grep -v 'ENV\.fetch([^,]*,'
```

**Fix — add dummy env vars to the RUN line in Dockerfile:**
```dockerfile
RUN SECRET_KEY_BASE=dummy RAILS_ENV=production \
    DATABASE_URL=postgres://dummy:dummy@localhost/dummy \
    REDIS_URL=redis://localhost:6379 \
    bundle exec rake assets:precompile
```

**Rules:**
1. Every bare `ENV.fetch` hit in code that runs during asset precompile requires a dummy var.
2. Common offenders: `SECRET_KEY_BASE`, `DATABASE_URL`, `REDIS_URL`, custom app secrets.
3. Dummy values MUST NOT be empty strings — some Rails code validates non-empty.
4. This audit is part of Sub-Phase §17b (Docker Build Verification) — run BEFORE `docker build`.

**Source:** Rails applications using `ENV.fetch` for required configuration — KeyError during asset precompile is a common Docker build failure (https://github.com/rails/rails/issues/48581).

---

## ActionCable WebSocket Nginx Ingress Annotations

**Trigger:** ActionCable uses Redis adapter in production AND the application is behind an nginx Ingress controller.

**Problem:** WebSocket connections are long-lived. Default nginx proxy timeouts (60s) disconnect WebSocket clients, causing constant reconnection storms.

**Solution — add Ingress annotations for WebSocket timeout:**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "7"
```

**Detection:**
```bash
# Check if ActionCable uses Redis in production
grep -A3 'production:' config/cable.yml | grep -q 'adapter.*redis' && echo "WebSocket + Redis detected"
```

**Rule**: When ActionCable uses Redis production adapter, add nginx Ingress annotations `proxy-read-timeout: 3600` and `proxy-send-timeout: 3600`. Without these, WebSocket connections drop every 60 seconds.

**Alternative for path-specific timeout** (if only `/cable` path needs long timeout):
```yaml
annotations:
  nginx.ingress.kubernetes.io/configuration-snippet: |
    location /cable {
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
    }
```

## Puma Adjacent-Items Checklist

**Trigger:** When externalising puma.rb configuration, audit ALL adjacent configuration items — not just the port.

**ENV.fetch checklist for puma.rb:**

| Config Item | ENV.fetch Call | Default | Purpose |
|---|---|---|---|
| Port | `ENV.fetch('PORT', 3000)` | 3000 | HTTP listen port |
| Threads | `ENV.fetch('RAILS_MAX_THREADS', 5).to_i` | 5 | Per-worker thread count |
| Workers | `ENV.fetch('WEB_CONCURRENCY', 2).to_i` | 2 | Process count (Puma cluster mode) |
| Worker timeout | `ENV.fetch('WORKER_TIMEOUT', 60).to_i` | 60 | Maximum request processing time |

**Detection — items still hardcoded after partial migration:**
```bash
grep -n 'workers\|threads\|port\|worker_timeout' config/puma.rb | grep -v 'ENV'
```

Any match indicates an item that was missed during configuration externalisation.

**Connection pool alignment rule:** `RAILS_MAX_THREADS` MUST match `pool:` in `config/database.yml`. Total DB connections = `WEB_CONCURRENCY × RAILS_MAX_THREADS`. Document this relationship in ENV_VARIABLES.md.

## ApplicationMailer Default From Externalisation

**Trigger:** `ApplicationMailer` (or any mailer) with a hardcoded `default from:` address.

**Before (hardcoded):**
```ruby
class ApplicationMailer < ActionMailer::Base
  default from: 'noreply@myapp.com'
end
```

**After (externalised):**
```ruby
class ApplicationMailer < ActionMailer::Base
  default from: ENV.fetch('MAILER_FROM_ADDRESS', 'noreply@example.com')
end
```

**Detection:**
```bash
grep -rn "default from:" app/mailers/ --include='*.rb' | grep -v 'ENV'
```

**ENV_VARIABLES.md entry:**
- `MAILER_FROM_ADDRESS` — Sender email address for outbound mail. K8s Scope: ConfigMap.

## ENV.fetch Full-Scope Audit

**Trigger:** After initial configuration externalisation, verify ALL `ENV.fetch` and `ENV[]` calls across the ENTIRE codebase — not just config/ directory.

**Problem:** `ENV.fetch` calls in initializers, middleware, and library files are easily missed during partial audits focused on config/ only.

**Full-scope detection:**
```bash
# All ENV access patterns across entire app
grep -rn 'ENV\.fetch\|ENV\[' app/ config/ lib/ --include='*.rb' | grep -v 'test\|spec' | sort
```

**Rule:** Run this audit AFTER initial externalisation to catch secondary ENV access points. Each match must have a corresponding entry in ENV_VARIABLES.md.

## ActionCable Two-Level Redis Fallback

**Trigger:** ActionCable with Redis adapter where the cable.yml ERB needs graceful degradation.

**Problem:** If `REDIS_URL` is unset AND no default provided, ActionCable crashes at boot. But hardcoding a default defeats externalisation.

**Pattern — two-level fallback with CABLE_REDIS_URL override:**
```yaml
# config/cable.yml
production:
  adapter: redis
  url: <%= ENV.fetch('CABLE_REDIS_URL', ENV.fetch('REDIS_URL', 'redis://localhost:6379/1')) %>
  channel_prefix: <%= ENV.fetch('CABLE_CHANNEL_PREFIX', 'app_production') %>
```

**Rule:** ActionCable MAY use a separate `CABLE_REDIS_URL` when cable traffic should go to a different Redis instance than the cache/session store. Document both `CABLE_REDIS_URL` (optional override) and `REDIS_URL` (primary) in ENV_VARIABLES.md. ConfigMap entry for CABLE_REDIS_URL is only needed when cable uses a dedicated Redis.

## action_mailer.default_url_options Externalisation

**Trigger:** Rails applications using ActionMailer with hardcoded host in `default_url_options`.

**Before (hardcoded):**
```ruby
# config/environments/production.rb
config.action_mailer.default_url_options = { host: 'www.myapp.com' }
```

**After (externalised):**
```ruby
config.action_mailer.default_url_options = { host: ENV.fetch('APP_HOST', 'localhost') }
```

**Detection:**
```bash
grep -rn 'default_url_options' config/ --include='*.rb' | grep -v 'ENV'
```

**Rule:** `default_url_options` host determines the domain in email links. Must be externalised to ConfigMap as `APP_HOST`. Failure to externalise causes emails to contain wrong/hardcoded domain in all deployment environments.

## Post-Externalisation Test Sync (Rails)

**Trigger:** After externalising configuration (Sub-Phase §3) or credentials (Sub-Phase §7) to `ENV.fetch('VAR')` without defaults.

**Problem:** `ENV.fetch('KEY')` raises `KeyError` if the env var is not set. During `rspec` runs and Dockerfile `asset:precompile`, missing env vars cause immediate failure.

**Procedure — spec/rails_helper.rb guards:**

Add ENV guards BEFORE `require_relative` in `spec/rails_helper.rb`:
```ruby
# spec/rails_helper.rb — add at TOP, before require_relative
ENV['DATABASE_URL'] ||= 'postgres://localhost/test'
ENV['REDIS_URL'] ||= 'redis://localhost:6379'
ENV['SECRET_KEY_BASE'] ||= 'test-secret-key-base-minimum-length-required'
# Add all ENV.fetch vars that lack defaults
```

**Procedure — Dockerfile precompile dummy-env block:**
```dockerfile
RUN SECRET_KEY_BASE=dummy \
    DATABASE_URL=postgres://dummy:dummy@localhost/dummy \
    REDIS_URL=redis://localhost:6379 \
    RAILS_ENV=production \
    bundle exec rake assets:precompile
```

**Detection — find all bare ENV.fetch that need guards:**
```bash
grep -rn 'ENV\.fetch' config/ app/ lib/ --include='*.rb' | grep -v 'ENV\.fetch([^,]*,' | grep -oP "ENV\.fetch\(['\"]([^'\"]+)" | sort -u
```

**Rule:** Every bare `ENV.fetch('KEY')` (no second argument) that runs during test setup or asset precompile MUST have a corresponding `ENV['KEY'] ||= 'safe-default'` in rails_helper.rb AND a matching dummy in the Dockerfile precompile RUN line. Complete within the same task scope as the externalisation — do not defer.

## Sidekiq SIDEKIQ_QUEUES Shell-Form Expansion

**Trigger:** Rails applications using Sidekiq where queue names are configured via environment variable.

**Problem:** When passing `SIDEKIQ_QUEUES` as a ConfigMap value (e.g., `"default,mailers,active_storage"`), the Deployment command must use shell form to expand it. Exec form passes the literal string `$SIDEKIQ_QUEUES` without expansion.

**WRONG (exec form — no expansion):**
```yaml
command: ["bundle", "exec", "sidekiq", "-q", "$SIDEKIQ_QUEUES"]
```

**CORRECT (shell form — expands env var):**
```yaml
command: ["/bin/sh", "-c", "bundle exec sidekiq -q ${SIDEKIQ_QUEUES}"]
```

**Alternative — multiple -q flags via envFrom:**
```yaml
# ConfigMap:
SIDEKIQ_QUEUES: "default,mailers,active_storage"
# Command uses shell split:
command: ["/bin/sh", "-c", "echo $SIDEKIQ_QUEUES | tr ',' '\\n' | xargs -I{} echo -q {} | xargs bundle exec sidekiq"]
```

**Rule:** Any Deployment command that references env vars for runtime configuration MUST use shell form (`/bin/sh -c`) for variable expansion. Exec form only works with literal values.

## Puma plugin :tmp_restart emptyDir

**Trigger:** Rails applications using Puma with the `plugin :tmp_restart` directive.

**Problem:** Puma's `tmp_restart` plugin watches `/app/tmp/restart.txt` for touch-triggered restarts. With `readOnlyRootFilesystem: true`, writing to `/app/tmp/` fails unless it's an emptyDir mount.

**Detection:**
```bash
grep -rn 'plugin :tmp_restart\|tmp/restart' config/puma.rb Procfile 2>/dev/null
```

**Rule:** When `plugin :tmp_restart` is active, mount a SINGLE emptyDir at `/app/tmp` — this covers both the restart.txt watch file and any other tmp operations. Do not mount separate subdirectories.

```yaml
volumeMounts:
- name: app-tmp
  mountPath: /app/tmp
volumes:
- name: app-tmp
  emptyDir: {}
```

## storage.yml ERB Mandatory ENV.fetch Audit

**Trigger:** Rails applications using ActiveStorage with `config/storage.yml`.

**Problem:** `storage.yml` uses ERB for env var interpolation. Any `ENV.fetch('KEY')` without a default causes `KeyError` during `rails credentials:edit` or any Rake task that loads the storage config — even if the storage service isn't active.

**Detection:**
```bash
grep -n 'ENV' config/storage.yml 2>/dev/null
```

**Rule:** ALL `ENV.fetch()` calls in `storage.yml` MUST have defaults OR be wrapped in conditional service blocks. Use `ENV.fetch('KEY', nil)` for optional services:

```yaml
# config/storage.yml
amazon:
  service: S3
  access_key_id: <%= ENV.fetch('AWS_ACCESS_KEY_ID', '') %>
  secret_access_key: <%= ENV.fetch('AWS_SECRET_ACCESS_KEY', '') %>
  region: <%= ENV.fetch('AWS_REGION', 'us-east-1') %>
  bucket: <%= ENV.fetch('S3_BUCKET', 'replace-with-bucket') %>
```

## ENV Grep Exclusion List for Ruby/Bundler Internals

**Trigger:** Running env var grep on Ruby/Rails projects.

**Problem:** Ruby and Bundler inject internal environment variables that should NOT appear in ENV_VARIABLES.md or ConfigMap/Secret manifests.

**Exclusion list:**
```bash
# Filter these from grep output — they are Ruby/Bundler internals:
grep -rhoP "ENV\[(['\"])([A-Z][A-Z0-9_]+)" . --include='*.rb' | \
  grep -oP "[A-Z][A-Z0-9_]+" | sort -u | \
  grep -vE '^(BUNDLE_|GEM_|RUBY_|RUBYOPT|RUBYLIB|LANG|LC_|HOME|USER|PATH|TERM|SHELL|RACK_ENV|NODE_ENV)' 
```

**Variables to ALWAYS exclude from K8s manifests:**
- `BUNDLE_*` (Bundler internals)
- `GEM_HOME`, `GEM_PATH` (Ruby gem paths)
- `RUBY_VERSION`, `RUBYOPT`, `RUBYLIB` (Ruby runtime)
- `HOME`, `USER`, `PATH`, `TERM`, `SHELL` (OS-level)
- `LANG`, `LC_*` (locale — set in Dockerfile if needed)

**Rule:** When running the source-authoritative env var grep for Ruby projects, pipe output through the exclusion filter above. Only application-specific env vars belong in ConfigMap/Secret.


## Rails 7.x Sprockets Asset Pipeline

**Trigger:** Rails 7.0+ applications with `assets:precompile` in the Dockerfile.

**Problem:** Rails 7.1 removed the implicit sprockets-rails dependency. Without explicit inclusion, `rake assets:precompile` fails with `Don't know how to build task 'assets:precompile'` or `Sprockets::Rails::Task` not found.

**Pre-Docker build gate checklist:**
```bash
# 1. Verify sprockets-rails gem is present
grep -q 'sprockets-rails' Gemfile && echo "OK" || echo "MISSING: add gem 'sprockets-rails' to Gemfile"

# 2. Verify manifest.js exists (required by Sprockets 4.x)
ls app/assets/config/manifest.js 2>/dev/null && echo "OK" || echo "MISSING: create app/assets/config/manifest.js"
```

**manifest.js minimal content** (if missing):
```javascript
//= link_tree ../images
//= link_directory ../stylesheets .css
```

**Rule:** Before running `docker build` on any Rails 7.x application that includes `assets:precompile`, verify both `sprockets-rails` gem AND `app/assets/config/manifest.js` exist.

## Gemfile Ruby Version Pin Relaxation

**Trigger:** Gemfile contains an exact Ruby version pin (`ruby '3.2.2'`) that conflicts with the Docker build environment.

**Problem:** Exact version pins cause `bundle install` failure when the host/Docker Ruby version differs even by patch level. The Dockerfile FROM pin (`FROM ruby:3.2.2-alpine`) enforces production version; the Gemfile constraint only needs to allow the build to proceed.

**Before (fails if host has 3.2.3):**
```ruby
ruby '3.2.2'
```

**After (permits any 3.2.x):**
```ruby
ruby '>= 3.2.0'
```

**Detection:**
```bash
grep -n "^ruby '" Gemfile | grep -v '>='
# Any match with exact version = potential build failure
```

**Rule:** During K8s migration, relax exact Ruby version pins to `>= X.Y.0` format. The Dockerfile FROM line is the authoritative version pin for production.

## Sidekiq-Cron Complete Removal Checklist

**Trigger:** Removing `sidekiq-cron` gem when migrating scheduled tasks to Kubernetes CronJobs.

**Problem:** Removing the gem from Gemfile without cleaning up all references causes `NameError: uninitialized constant Sidekiq::Cron` at runtime.

**Procedure:**
1. Remove from Gemfile: `sed -i "/sidekiq-cron/d" Gemfile`
2. Run `bundle install` (or manually remove from Gemfile.lock if bundler unavailable)
3. Remove initializer: `rm -f config/initializers/sidekiq_cron.rb` (or equivalent)
4. Grep for residual references:
```bash
grep -rn 'Sidekiq::Cron\|sidekiq-cron\|sidekiq_cron' . --include='*.rb' | grep -v vendor
# Must return zero matches
```
5. Remove schedule YAML if separate: `rm -f config/sidekiq_cron.yml config/schedule.yml`

**Gemfile.lock transitive dep removal** (when bundler unavailable):
1. Identify exclusive deps: grep each `sidekiq-cron` dependency name in the DEPENDENCIES section — only remove deps with no other parent.
2. Never remove shared gems: `globalid`, `activesupport`, `zeitwerk`, `redis` are commonly shared.
3. For multi-line block deletion: `sed -i '/^    sidekiq-cron/,/^$/d' Gemfile.lock`

**Verification:** `bundle check` (if bundler available) OR `grep -c 'sidekiq-cron' Gemfile.lock` = 0.

## ENV.fetch Block-Form False Positive

**Trigger:** Ruby ENV.fetch with a block form that looks like a bare call but has a fallback.

**Problem:** The Docker build gate scans for bare `ENV.fetch` calls (no second argument = KeyError if missing). Block-form calls like `ENV.fetch('KEY') { 'default' }` ARE safe but get flagged as false positives by the bare-call grep.

**Detection (refined grep excluding block form):**
```bash
# Bare calls only (no second arg, no block):
grep -rn 'ENV\.fetch' config/ app/ lib/ --include='*.rb' | grep -v 'ENV\.fetch([^,]*,' | grep -v 'ENV\.fetch([^)]*) {'
```

**Rule:** When auditing ENV.fetch calls before docker build, exclude the block form `ENV.fetch('X') { default }` from the "needs dummy var" list. Only truly bare `ENV.fetch('X')` (no second arg, no block) requires a dummy env var during asset precompile.

## NetworkPolicy SMTP Egress for CronJobs

**Trigger:** Rails application using ActionMailer with `deliver_now` (synchronous delivery) in code paths extracted to CronJobs.

**Problem:** `deliver_now` sends mail synchronously within the calling process. When the calling code runs in a CronJob pod, the CronJob's NetworkPolicy must include SMTP egress — adding it only to the web Deployment's NetworkPolicy is insufficient because the CronJob runs in a separate pod with its own NetworkPolicy.

**Detection:**
```bash
# Find synchronous mail delivery in code paths likely to become CronJobs
grep -rn 'deliver_now\|deliver_now!' app/jobs/ app/workers/ app/services/ lib/tasks/ --include='*.rb' 2>/dev/null
# Also check for mailer calls in scheduled task paths
grep -rn '\.deliver_now\|Mailer.*perform\|mailer.*deliver' . --include='*.rb' | grep -v 'spec/\|test/'
```

**Rule:** If `deliver_now` (or any synchronous mail-sending method) is found in code paths scheduled as CronJobs or background jobs, the CronJob's NetworkPolicy MUST include SMTP egress:

```yaml
# In the CronJob's NetworkPolicy egress section:
egress:
- ports:
  - port: 587
    protocol: TCP
  # ports-only pattern: no 'to:' field — allows egress to any SMTP relay
```

**Distinction from deliver_later:** `deliver_later` enqueues to Sidekiq/ActiveJob — the Sidekiq worker pod (not the CronJob) needs SMTP egress. `deliver_now` executes in the current process — whichever pod calls it needs the egress rule.

**General mail egress trigger rule:** Code-grep for mail-sending patterns (`deliver_now`, `deliver_later`, `ActionMailer`, `mail()`) even when no SMTP env var is present — DB-stored mailer config is common in CMS/ecommerce platforms. When found, ensure the workload pod that executes the send has SMTP egress in its NetworkPolicy.

## CONDITIONAL PASS for Ruby Bundler Version Mismatch

**Trigger:** Host Ruby version does not satisfy Gemfile `ruby` constraint, or Bundler version mismatch prevents `bundle install` from completing.

**Problem:** When the host Ruby version (e.g., 3.3.0) differs from the Gemfile constraint (e.g., `ruby '3.2.2'`), `bundle install` exits non-zero with a version mismatch error. This is an environmental constraint, not a transformation defect.

**Classification:**
- Host ruby version != Gemfile `ruby` constraint → `bundle install` exit non-zero → **CONDITIONAL PASS** (not hard failure)
- Bundler major version mismatch (e.g., host has Bundler 2.5, Gemfile.lock was generated with 1.x) → **CONDITIONAL PASS**

**Recording in TRANSFORMATION_SUMMARY.md:**
```
| Tier 1 | CONDITIONAL PASS | bundle install failed — host Ruby 3.3.0 != Gemfile constraint 3.2.2. Dockerfile FROM ruby:3.2.2 is correct for production. |
```

**Rule:** Ruby/Bundler version mismatches are NOT transformation failures. The Dockerfile `FROM ruby:X.Y.Z` pin is the authoritative version for production. Record as CONDITIONAL PASS with root cause explanation. The Gemfile version pin may be relaxed (see §Gemfile Ruby Version Pin Relaxation) but this is optional — CONDITIONAL PASS is acceptable.


## jsbundling/cssbundling Asset Stub Pre-Flight

**Trigger:** Rails applications using `jsbundling-rails` or `cssbundling-rails` gems.

**Detection:**
```bash
grep -E 'jsbundling-rails|cssbundling-rails' Gemfile
```

**Problem:** These gems expect a Node.js build step (e.g., `yarn build`, `npm run build`) to produce compiled assets in `app/assets/builds/` BEFORE `rake assets:precompile`. Without the Node.js step, precompile succeeds but produces empty/missing JavaScript/CSS — the application loads but is non-functional.

**Pre-flight check (before docker build):**
```bash
# Verify asset build command exists
grep -E '"build"' package.json
# Verify build output directory has content
ls app/assets/builds/ 2>/dev/null | head -5 || echo "WARNING: app/assets/builds/ empty or missing"
```

**Dockerfile pattern:**
```dockerfile
# Multi-stage: Node build stage precedes Ruby stage
FROM node:18 AS assets
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM ruby:3.2
COPY --from=assets /app/app/assets/builds/ /app/app/assets/builds/
RUN bundle exec rake assets:precompile
```

**Rule:** When jsbundling-rails or cssbundling-rails is detected, the Dockerfile MUST include a Node.js build stage that produces `app/assets/builds/` content before the Ruby asset precompile stage.

