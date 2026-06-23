# Python Patterns Reference

Python-specific containerisation gotchas for Phase 2 transformation. Applies when `requirements.txt`, `setup.py`, `pyproject.toml`, or `Pipfile` is present.

## Table of Contents

1. [Python Test Execution Environment](#python-test-execution-environment)
2. [Tool Failure Recovery (General)](#tool-failure-recovery-general)
3. [botocore DataNotFoundError](#botocore-datanotfounderror)
4. [Python Environment Pre-flight](#python-environment-pre-flight)
5. [C Extension System Dependencies](#c-extension-system-dependencies)
6. [Dockerfile Non-Root User Ordering](#dockerfile-non-root-user-ordering)
7. [venv vs System Prefix Docker Builds](#venv-vs-system-prefix-docker-builds)
8. [Shared Library for Multi-Image Projects](#shared-library-for-multi-image-projects)
9. [BytesIO.fileno() Trap](#bytesiofileno-trap)
10. [Module-Level os.environ Reads](#module-level-osenviron-reads)
11. [SIGTERM Background+Wait Pattern](#sigterm-backgroundwait-pattern)
12. [Heredoc Quoting in Entrypoints](#heredoc-quoting-in-entrypoints)
13. [Health Check HTTP 4xx Handling](#health-check-http-4xx-handling)
14. [Celery Beat Writable Paths](#celery-beat-writable-paths)
15. [Celery Beat DB Egress](#celery-beat-db-egress)
16. [Celery config_from_object Ordering](#celery-config_from_object-ordering)
17. [Celery Fork-Safety](#celery-fork-safety)
18. [Flask Blueprint Probe Discovery](#flask-blueprint-probe-discovery)
19. [Flask-Session Init Order](#flask-session-init-order)
20. [Session Management Patterns](#session-management-patterns)
21. [Flask/Django Decomposition Heuristics](#flaskdjango-decomposition-heuristics)
22. [Pydantic-Settings BaseSettings](#pydantic-settings-basesettings)
23. [APScheduler Async Compatibility](#apscheduler-async-compatibility)
24. [Probe Path Authentication Bypass](#probe-path-authentication-bypass)
25. [Dockerfile Ordering Verification](#dockerfile-ordering-verification)
26. [pip install --no-deps Dependency Scan](#pip-install-no-deps-dependency-scan)
27. [Gunicorn preload_app Companion Rule](#gunicorn-preload_app-companion-rule)
28. [Two-Pass Env Var Discovery Mandate](#two-pass-env-var-discovery-mandate)
29. [Dockerfile Non-Root UID Pinning](#dockerfile-non-root-uid-pinning)
30. [Post-Migration Dead Config Key Removal](#post-migration-dead-config-key-removal)
31. [Lazy Import Detection in Function Bodies](#lazy-import-detection-in-function-bodies)
32. [Exec Probe sys.path.insert Pattern](#exec-probe-syspathinsert-pattern)
33. [pytest Configuration and Compatibility](#pytest-configuration-and-compatibility)
34. [DB Connector Secondary Config Reads](#db-connector-secondary-config-reads)
35. [WSGI Environ False-Positive Exclusion](#wsgi-environ-false-positive-exclusion)

---

## Pre-Docker Local Validation

**Purpose:** Verify Python source compiles without syntax errors, dependencies resolve, and imports succeed — all BEFORE `docker build`.

### Commands
```bash
# 1. Compile-check all Python files (excluding venv/site-packages)
find . -name '*.py' -not -path '*/.venv/*' -not -path '*/site-packages/*' -not -path '*/__pycache__/*' | xargs python3 -m py_compile 2>&1
# Expected: empty output (no errors). Any output = FAIL.

# 2. Dependency install (verify resolution)
pip install -r requirements.txt --dry-run 2>&1 || pip install -r requirements.txt 2>&1
# Expected: exit 0

# 3. Import check (verify main module loads)
python3 -c "import importlib; importlib.import_module('<main_package>')" 2>&1
# Expected: exit 0

# 4. Unit tests (infrastructure-excluded)
python3 -m pytest -m 'not integration and not db' -x --tb=short 2>&1 || true
# Exit 0 = PASS; infrastructure failures = CONDITIONAL PASS; import errors = FAIL
```

### Expected Output
- Step 1: Zero lines of output (all files compile)
- Step 2: Exit 0 with all packages resolved
- Step 3: Exit 0 (main module imports successfully)
- Step 4: Exit 0 or infrastructure-only failures

### CONDITIONAL PASS Triggers
- `python3` not installed and `mise install python` fails → CONDITIONAL PASS
- Python version mismatch (e.g., project requires 3.11, host has 3.9) → CONDITIONAL PASS
- C-extension build failure (missing system libs like `libpq-dev`) → CONDITIONAL PASS
- Network timeout on pip download (after 1 retry) → CONDITIONAL PASS

### Toolchain Bootstrap
```bash
# Check Python availability
command -v python3 && python3 --version
# If absent or wrong version, try mise
command -v mise && mise install python 2>/dev/null
export PATH=$HOME/.local/share/mise/shims:$PATH
python3 --version
# Verify pip
python3 -m pip --version || python3 -m ensurepip --upgrade
```

### Validated Example Repositories
- **Trac** (trac.edgewall.org): `py_compile` passes on all source files; multi-top-level-package structure (trac/, tracopt/, contrib/). Validated 2026-06.


## Python Test Execution Environment

Multi-Python environments (mise, pyenv, system Python coexisting) cause ABI mismatches when pytest loads C-extension modules compiled for a different Python version.

**Interpreter Discovery**:
```bash
pip3 show pytest | grep Location
```

**pip3/python3 interpreter split detection**: If `pip3` points to a different Python than `python3`, packages install to the wrong site-packages. Verify:
```bash
python3 -c "import sys; print(sys.executable)"
pip3 --version  # Check path matches
```

**Canonical invocation** (mise-managed Python):
```bash
mise exec python@3.10 -- python3 -m pytest tests/ -x
```

**sys.path contamination detection**:
```bash
python3 -c "import sys; [print(p) for p in sys.path if 'site-packages' in p]"
```

**Correction**: Set `PYTHONNOUSERSITE=1`:
```bash
PYTHONNOUSERSITE=1 mise exec python@3.10 -- python3 -m pytest tests/
```

## Tool Failure Recovery (General)

**HARD CAP**: If ANY tool (pytest, pip, boto3, celery, gunicorn, or any other) fails after **2 resolution attempts**, record `tool-blocked: <tool> — <error summary>` in the task report and proceed without that tool. Do NOT iterate further.

Resolution attempt = one of:
- Switching interpreter or tool version
- Setting environment variables (PYTHONNOUSERSITE, PATH, etc.)
- Reinstalling packages (`pip install --force-reinstall`)
- Adjusting PATH/PYTHONPATH/sys.path

**Specific patterns that trigger immediate fail-fast (no retry needed):**
- `botocore.exceptions.DataNotFoundError` → packaging error, not transient
- `ModuleNotFoundError` for packages that ARE in requirements.txt → ABI mismatch
- Docker daemon connection errors → infrastructure issue

## botocore DataNotFoundError

`botocore.exceptions.DataNotFoundError: Unable to load data for: endpoints` is a **botocore packaging error**, NOT a network/AWS connectivity problem.

**Diagnosis**:
```bash
python3 -c "import botocore; print(botocore.__file__)"
ls "$(python3 -c 'import botocore; import os; print(os.path.dirname(botocore.__file__))')/data/"
```

**Fix**:
```bash
pip install --force-reinstall botocore boto3
```

**HARD RULE: On DataNotFoundError, execute `exit 1` immediately — no sleep, no retry, no delay.** This is a local packaging issue (incorrect path calculation), not a transient error.

**Pre-flight gate** (run at task start for any Python project using AWS SDK):
```bash
python3 -c 'import botocore.data; print("botocore data OK")' || { echo 'FATAL: botocore DataNotFoundError — packaging error, non-transient'; exit 1; }
```

**Source:** https://stackoverflow.com/questions/71533781/botocore-exceptions-datanotfounderror-unable-to-load-data-for-sqs — "This unusual series of events is what triggers the DataNotFoundError exception because, indeed, botocore cannot load the service definition data (because it has calculated an incorrect path for it)."

## Python Environment Pre-flight

Run at the START of any Python project migration task:

```bash
# 1. Identify active Python
which python3 && python3 --version
# 2. Check for version manager
which mise && mise current python 2>/dev/null
which pyenv && pyenv version 2>/dev/null
# 3. Verify no sys.path contamination
python3 -c "import sys; mixed=[p for p in sys.path if 'site-packages' in p]; print('\n'.join(mixed))"
# 4. Verify boto3/botocore are loadable (if AWS SDK needed)
python3 -c "import boto3; print(boto3.__version__)" 2>&1 || echo "boto3 not available"
```

## C Extension System Dependencies

| Python Package | System Packages (Debian/Ubuntu) | Notes |
|---|---|---|
| `python-ldap` | `libldap2-dev`, `libsasl2-dev` | Also needs `gcc` |
| `psycopg2` | `libpq-dev` | Use `psycopg2-binary` to avoid |
| `mysqlclient` | `default-libmysqlclient-dev` | Also needs `gcc`, `pkg-config` |
| `Pillow` | `libjpeg-dev`, `libpng-dev`, `zlib1g-dev` | Optional: `libtiff-dev`, `libwebp-dev` |
| `lxml` | `libxml2-dev`, `libxslt1-dev` | |
| `cryptography` | `libssl-dev`, `libffi-dev` | Rust toolchain for some versions |
| `pylibmc` | `libmemcached-dev`, `zlib1g-dev` | |
| `cffi` | `libffi-dev` | Often pulled as transitive dep |
| `numpy` / `scipy` | `gfortran`, `libopenblas-dev` | Pre-built wheels usually avoid |
| `greenlet` | `gcc` | Transitive from SQLAlchemy |
| `grpcio` | `gcc`, `g++` | Can use pre-built wheel |
| `xmlsec` | `libxmlsec1-dev`, `pkg-config` | For SAML/SSO |

**Detection command:**
```bash
grep -iE '^(python-ldap|psycopg2|mysqlclient|Pillow|lxml|cryptography|pylibmc|cffi|numpy|scipy|greenlet|grpcio|xmlsec)' requirements.txt
```

## Dockerfile Non-Root User Ordering

**CRITICAL**: `RUN useradd` MUST appear BEFORE any `COPY --chown=<user>` directive.

```dockerfile
# CORRECT ordering:
FROM python:3.12-slim
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser
COPY --chown=appuser:appuser requirements.txt /app/
COPY --chown=appuser:appuser . /app/
USER appuser
```

**Alpine variant**: `RUN addgroup -S appuser && adduser -S -G appuser -h /app appuser`

## venv vs System Prefix Docker Builds

**Approach 1: venv (recommended for multi-stage)**
```dockerfile
FROM python:3.12-slim AS builder
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY . /app
```

## Shared Library for Multi-Image Projects

When multiple Docker images share config, models, storage modules:

```dockerfile
COPY common/ /build/common/
RUN pip install /build/common/
COPY web/ /app/
```

## BytesIO.fileno() Trap

`io.BytesIO` does NOT support `fileno()`:

```python
# BAD:
size = os.fstat(fd.fileno()).st_size
# GOOD:
size = len(data)  # or buffer.getbuffer().nbytes
```

## Module-Level os.environ Reads

Module-level assignments execute at import time — before runtime setup:

```python
# BAD in utility modules:
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///db.sqlite3')

# GOOD: lazy evaluation
def get_database_url():
    return os.environ.get('DATABASE_URL', 'sqlite:///db.sqlite3')
```

**Rule**: Module-level env reads are fine in settings entry point (Django `settings.py`). Problematic in utility modules imported before environment is configured.

## SIGTERM Background+Wait Pattern

```python
import signal, sys

def sigterm_handler(signum, frame):
    worker.stop()
    worker.join(timeout=25)
    sys.exit(0)

signal.signal(signal.SIGTERM, sigterm_handler)
```

**For gunicorn/uvicorn**: These handle SIGTERM natively — do NOT add custom handler. Configure `--graceful-timeout 25`.

**Exception clause**: If a task explicitly requires a SIGTERM handler despite gunicorn/uvicorn native handling (e.g., background thread cleanup, custom metrics flush), add the handler with a `# MIGRATION: custom SIGTERM alongside gunicorn post-fork override` comment explaining that gunicorn will still handle worker lifecycle but this handler covers application-level cleanup. Safe to include in both deployment modes.

## Heredoc Quoting in Entrypoints

```bash
# CORRECT: unquoted delimiter — variables expand at runtime
cat > /app/config.ini <<EOF
host = ${DB_HOST}
EOF

# WRONG for os.environ-reading embedded scripts — use QUOTED to prevent shell expansion:
cat > /app/run.py <<'EOF'
import os
host = os.environ.get('DB_HOST')
EOF
```

**Rule**: Use unquoted `<<EOF` when the heredoc content needs shell variable expansion. Use quoted `<<'EOF'` when the content is a script (Python, Ruby) that will read env vars itself at runtime — prevents the shell from expanding `$VAR` during write.

## Health Check HTTP 4xx Handling

```python
# Django — exempt health endpoint from auth middleware
urlpatterns = [path('healthz', health_check)]

def health_check(request):
    return JsonResponse({'status': 'ok'})
```

**Rule**: Health check endpoints MUST return 200 without authentication.

## Celery Beat Writable Paths

Celery Beat with `readOnlyRootFilesystem: true` requires writable paths for schedule and PID files:

```bash
# Always pass explicit paths to writable locations
celery -A app beat --schedule=/tmp/celerybeat-schedule --pidfile=/tmp/celerybeat.pid
```

**emptyDir requirements:**
| Path | Purpose |
|------|---------|
| `/tmp` | Schedule file (`celerybeat-schedule`), PID file |

**If `--pidfile` points outside `/tmp`** (e.g., `/var/run/celery/beat.pid`), mount a SECOND emptyDir at that path.

**Detection:**
```bash
grep -rn 'beat\|Beat\|CELERYBEAT' . --include='*.py' --include='*.cfg' --include='*.ini'
grep -rn 'pidfile\|schedule' . --include='*.py' | grep -i beat
```

**Kubernetes manifest:**
```yaml
containers:
- name: celery-beat
  command: ["celery", "-A", "app", "beat", "--schedule=/tmp/celerybeat-schedule", "--pidfile=/tmp/celerybeat.pid"]
  volumeMounts:
  - name: tmp
    mountPath: /tmp
```

## Celery Beat DB Egress

Celery Beat with `django_celery_beat` needs egress to BOTH broker AND database:

```yaml
egress:
- to: [{podSelector: {matchLabels: {app: redis}}}]
  ports: [{port: 6379}]
- to: [{podSelector: {matchLabels: {app: postgres}}}]
  ports: [{port: 5432}]
```

## Celery config_from_object Ordering

```python
# BAD: explicit override after config_from_object wins silently
app.config_from_object('django.conf:settings', namespace='CELERY')
app.conf.broker_url = 'redis://localhost:6379'  # Breaks env var config!

# GOOD: all Celery config in Django settings (prefixed CELERY_)
```

## Celery Fork-Safety

Celery workers using `prefork` pool MUST NOT create database connections or Redis clients at module import time:

```python
# BAD: connection created before fork — shared file descriptor across children
db = connect_to_db()

@app.task
def my_task():
    db.execute(...)  # Corrupted across forked processes!

# GOOD: connect inside task or use signal
from celery.signals import worker_process_init

@worker_process_init.connect
def init_worker(**kwargs):
    global db
    db = connect_to_db()  # Fresh connection per child
```

**Detection:**
```bash
grep -n 'connect\|create_engine\|Redis(' . --include='*.py' | grep -v 'def \|#\|@'
```

## Flask Blueprint Probe Discovery

Flask applications register health endpoints on Blueprints. Probe path must match the Blueprint URL prefix:

```python
# If health blueprint is registered as:
app.register_blueprint(health_bp, url_prefix='/api')
# Then probe path is /api/healthz, NOT /healthz
```

**Detection:**
```bash
grep -rn 'register_blueprint\|@.*route.*health\|@.*route.*ready' . --include='*.py'
```

## Flask-Session Init Order

Flask-Session 0.8.x requires session interface initialization AFTER app config is set:

```python
# CORRECT order:
app = Flask(__name__)
app.config['SESSION_TYPE'] = os.environ.get('SESSION_TYPE', 'redis')
app.config['SESSION_REDIS'] = redis.from_url(os.environ.get('REDIS_URL', 'redis://localhost:6379'))
Session(app)  # MUST be after config

# WRONG: Session() before config → falls back to NullSession
Session(app)
app.config['SESSION_TYPE'] = 'redis'  # Too late!
```

## Session Management Patterns

**Django:**
```python
# Check current session engine BEFORE adding Redis
# settings.py
SESSION_ENGINE = 'django.contrib.sessions.backends.db'  # Already DB-backed → Redis NOT needed
# OR
SESSION_ENGINE = 'django.contrib.sessions.backends.cache'  # Needs Redis
```

**Flask:**
```python
# Default Flask sessions are client-side signed cookies — already stateless!
# Only add server-side sessions if storing large session data
```

**Rule**: DB-backed sessions are already distributed (survive pod restart, work across replicas). Only migrate to Redis if: (1) session reads are a DB performance bottleneck, OR (2) sessions are file-based/in-memory.

## Flask/Django Decomposition Heuristics

### Flask Blueprint → Service Mapping
Each Blueprint with its own `models.py` is a bounded context candidate:
```bash
find . -name 'models.py' -path '*/blueprints/*' -o -name 'models.py' -path '*/modules/*'
```

### Django App → Service Mapping
Each app in `INSTALLED_APPS` with its own `models.py`:
```bash
grep -oP "'\K[^']+(?=')" project/settings.py | grep -v django | grep -v rest_framework
```

### SESSION_DRIVER=redis as Decomposition Blocker
If sessions use Redis with a shared keyspace, decomposition requires either:
1. Per-service Redis namespace: `REDIS_KEY_PREFIX=svc_name:`
2. JWT migration: Replace server-side sessions with stateless JWT tokens

### Django Signal Decoupling for Service Extraction
Before extracting SearchService, replace synchronous signals with async:
```python
# BEFORE (blocking):
@receiver(post_save, sender=Article)
def update_search_index(sender, instance, **kwargs):
    elasticsearch.index(instance)

# AFTER (async):
@receiver(post_save, sender=Article)
def queue_search_index(sender, instance, **kwargs):
    index_article.delay(instance.pk)
```

## Pydantic-Settings BaseSettings

**Problem**: pydantic-settings `BaseSettings` declares env vars as class field names, invisible to standard `os.environ`/`getenv` grep.

**Detection**:
```bash
grep -rn 'class.*BaseSettings' . --include='*.py'
```

**SettingsConfigDict kwargs exclusion**: When using `model_config = SettingsConfigDict(env_prefix='APP_', ...)`, the kwargs (`env_prefix`, `env_file`, `case_sensitive`, `env_nested_delimiter`, etc.) are NOT env var names. Exclude these from the inventory:
```bash
# WRONG — includes SettingsConfigDict kwargs as false env vars
grep -A50 'class.*BaseSettings' settings.py | grep -oP '^\s+([a-z][a-z0-9_]+)\s*[:=]'
# CORRECT — exclude model_config line and its kwargs
grep -A50 'class.*BaseSettings' settings.py | grep -v 'model_config\|SettingsConfigDict' | grep -oP '^\s+([a-z][a-z0-9_]+)\s*[:=]'
```

**Two-pass inventory**:
```bash
# Pass 1: Field names from BaseSettings subclass (these ARE env var names, uppercased)
grep -A50 'class.*BaseSettings' . --include='*.py' | grep -v 'model_config\|SettingsConfigDict\|class_validator\|field_validator' | grep -oP '^\s+([a-z][a-z0-9_]+)\s*[:=]' | tr -d ' :=' | tr '[:lower:]' '[:upper:]' | sort -u

# Pass 2: Usage grep for settings.FIELD_NAME
grep -rn 'settings\.\|config\.' . --include='*.py' | grep -oP '\.((?:[A-Z][A-Z0-9_]+|[a-z][a-z0-9_]+))' | sort -u
```

**Rule**: For pydantic-settings projects, field names (uppercased, with env_prefix if configured) ARE the env var names. Include these in ENV_VARIABLES.md even though no `os.environ.get()` call exists. Digit-inclusive pattern required: `[a-z][a-z0-9_]+`.

## APScheduler Async Compatibility

**BackgroundScheduler + async def → silent discard**: BackgroundScheduler runs jobs in a thread pool. Async functions are called but the coroutine is **never awaited** — jobs silently produce no effect.

**Fix**: Use `AsyncIOScheduler` for async job functions.

**Horizontal scaling trap**: Any in-process scheduler + HPA → N-fold job duplication. Extract to Kubernetes CronJob with `concurrencyPolicy: Forbid`.

**Detection**:
```bash
grep -rn 'BackgroundScheduler\|AsyncIOScheduler\|APScheduler' . --include='*.py'
```

## APScheduler Sub-Minute Interval CronJob Conversion

**Trigger:** APScheduler using `IntervalTrigger` with intervals less than 60 seconds (e.g., `IntervalTrigger(seconds=30)`).

**Problem:** Kubernetes CronJob minimum granularity is 1 minute (`* * * * *`). Sub-minute intervals cannot be expressed directly in `schedule:`.

**Solution — activeDeadlineSeconds approach:**
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: high-frequency-task
spec:
  schedule: "* * * * *"  # Every minute — K8s minimum granularity
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      activeDeadlineSeconds: 55  # Kill before next minute's job starts
      template:
        spec:
          containers:
          - name: worker
            command: ["python3", "-c", "from app.tasks import run_task; run_task()"]
```

**Alternative — loop-within-container for true sub-minute:**
```python
# CronJob entry point for 30-second intervals
import time, signal, sys

def handler(sig, frame): sys.exit(0)
signal.signal(signal.SIGTERM, handler)

while True:
    run_task()
    time.sleep(30)
    if time.time() % 60 > 55:  # Exit before next CronJob instance
        break
```

**Rule:** For sub-minute intervals, schedule CronJob at `* * * * *` with `activeDeadlineSeconds` set to less than 60 seconds. Document the original interval in a YAML comment: `# Original: APScheduler IntervalTrigger(seconds=30)`. Remove the APScheduler `add_job()` call from the primary Deployment source after extraction.

## Probe Path Authentication Bypass

**Problem:** Python web frameworks often apply auth middleware globally. Probe paths that require authentication return 401/403/500, causing pods to never become Ready.

**Django — exempt from LoginRequiredMiddleware:**
```python
from django.urls import path
from django.views.decorators.http import require_GET

@require_GET
def healthz(request):
    return JsonResponse({'status': 'ok'})

# In urls.py — place BEFORE any auth-catchall:
urlpatterns = [
    path('healthz', healthz),  # No login_required decorator
    # ... other paths
]
```

**Flask — before login manager:**
```python
@app.route('/healthz')
def healthz():
    return jsonify(status='ok')
# Ensure this route is registered BEFORE @login_required is applied globally
```

**Trac/WSGI — admin paths require auth:**
When using Trac or similar WSGI apps, do NOT use `/login` or any path that triggers auth middleware as a probe target. Use a static resource or dedicated health endpoint instead.

**Rule**: Always verify chosen probe path returns HTTP 2xx without credentials. Test with: `curl -s -o /dev/null -w '%{http_code}' http://localhost:PORT/healthz`

## Dockerfile Ordering Verification

When verifying Dockerfile instruction ordering, strip comments first to avoid MIGRATION comment false positives:

```bash
# GOOD: strip comments, then check ordering
grep -v '^\s*#' Dockerfile | grep -n '^FROM\|^RUN\|^COPY\|^USER'

# BAD: MIGRATION comments match instruction names
grep -n 'FROM\|RUN\|COPY\|USER' Dockerfile
```

**Rule**: When asserting instruction ordering (e.g., USER after COPY --chown), always filter through `grep -v '^\s*#'` first.

## pip install --no-deps Dependency Scan

**Trigger:** Dockerfile uses `pip install --no-deps` for the application package (common when building from setup.cfg/pyproject.toml to avoid re-downloading pinned deps).

**Problem:** `--no-deps` requires ALL `install_requires` / `[project] dependencies` to be pre-installed separately. Missing dependencies cause `ImportError` at container startup with no build-time signal.

**Detection:**
```bash
grep -n '\-\-no-deps' Dockerfile
```

**Pre-write scan — before writing the Dockerfile RUN pip install line:**
```bash
# For setup.cfg:
sed -n '/^\[options\]/,/^\[/{ /install_requires/,/^[^ ]/p }' setup.cfg | grep -v '^\[' | grep -v '^install_requires' | sed 's/[<>=!].*//' | tr -d ' '

# For pyproject.toml:
sed -n '/^\[project\]/,/^\[/{/^dependencies/,/^\]/p}' pyproject.toml | grep -v '^\[' | grep -v '^dependencies' | sed 's/[<>=!].*//' | tr -d ' "'
```

**Rule:** For each active (non-conditional, non-extra) dependency in the list that is NOT already in the explicit `pip install` pre-install line, add it. Missing deps cause `ImportError` at container startup.

**Verification:**
```bash
# After building, verify all deps resolve:
pip check 2>&1 | grep -v 'No broken requirements'
# Or inside container:
python3 -c "import pkg_resources; pkg_resources.require(open('setup.cfg').read())"
```

## Gunicorn preload_app Companion Rule

**Trigger:** Flask/Django applications using gunicorn with `preload_app = True` in `gunicorn.conf.py`.

**Problem:** When `preload_app = True` is set, gunicorn loads the app once in the master process before forking workers. If you remove or modify gunicorn.conf.py during migration (e.g., extracting APScheduler, changing worker class), but leave `preload_app = True`, the app loads at master-fork time with the OLD configuration — workers see stale module-level state.

**Companion steps when modifying gunicorn.conf.py:**
1. If removing a scheduler (APScheduler) from the app, verify gunicorn.conf.py `on_starting`/`post_fork` hooks do NOT reference the removed scheduler module.
2. If changing worker class (sync → gevent/uvicorn), verify `preload_app` is compatible with the new worker class.
3. After any gunicorn.conf.py modification, verify the app still starts: `gunicorn --check-config -c gunicorn.conf.py app:create_app()` (or equivalent).

**terminationGracePeriodSeconds alignment:**
```yaml
# gunicorn.conf.py
graceful_timeout = 120  # seconds gunicorn waits for workers to finish
timeout = 120

# kubernetes manifest
terminationGracePeriodSeconds: 125  # graceful_timeout + 5
```

**Rule:** `terminationGracePeriodSeconds = gunicorn graceful_timeout + 5`. The default ≥30s floor is a minimum — if gunicorn's graceful_timeout exceeds 25s, the K8s value must be higher.

**Detection:**
```bash
grep -n 'preload_app\|graceful_timeout\|timeout\|on_starting\|post_fork' gunicorn.conf.py gunicorn_config.py 2>/dev/null
```

**Dead import after extraction:** After extracting APScheduler or any module to a CronJob, grep gunicorn.conf.py for imports of the removed module — dead imports cause `ImportError` at gunicorn master startup.

## Two-Pass Env Var Discovery Mandate

**Trigger:** ALL Python projects during Sub-Phase §3 (Configuration Externalisation).

**Problem:** Single-pass grep misses env vars read through framework-specific mechanisms (pydantic-settings, Flask config objects, Django settings.py chains, click.option with envvar=).

**Mandatory two-pass procedure:**

**Pass 1 — Standard os.environ/os.getenv:**
```bash
grep -rhoP "os\.environ(?:\.get)?\(?['\"]([A-Za-z][A-Za-z0-9_]+)" . --include='*.py' | grep -oP '[A-Z][A-Za-z0-9_]+' | sort -u
```

**Pass 2 — Framework-specific:**
```bash
# pydantic-settings BaseSettings fields (uppercased = env var names)
grep -A50 'class.*BaseSettings' . --include='*.py' | grep -oP '^\s+([a-z][a-z0-9_]+)\s*[:=]' | tr -d ' :=' | tr '[:lower:]' '[:upper:]' | sort -u

# Flask config.from_envvar / app.config[]
grep -rn 'from_envvar\|config\[' . --include='*.py' | grep -oP '[A-Z][A-Z0-9_]+' | sort -u

# click.option(envvar=)
grep -rn "envvar=" . --include='*.py' | grep -oP "envvar=['\"]([A-Z][A-Z0-9_]+)" | grep -oP '[A-Z][A-Z0-9_]+' | sort -u
```

**Rule:** Both passes MUST run before writing ENV_VARIABLES.md. Diff results against ENV_VARIABLES.md within the same task — never defer.

## Dockerfile Non-Root UID Pinning

**Problem:** `useradd -r` (system account) or `adduser --system` allocates a dynamic UID in the 100-999 range. When the Kubernetes manifest specifies `runAsUser: 1000`, the container starts as a different user than the file owner — causing permission denied errors.

**WRONG:**
```dockerfile
RUN useradd -r appuser
```

**CORRECT:**
```dockerfile
RUN groupadd -r appgroup && useradd -r -g appgroup --uid 1000 appuser
```

**Alpine variant:**
```dockerfile
RUN addgroup -S appgroup && adduser -S -G appgroup -u 1000 appuser
```

**Pre-Dockerfile audit:**
```bash
grep -n 'useradd\|adduser' Dockerfile | grep -v -- '--uid\|-u 1000'
# Any match = UID mismatch risk
```

**Rule:** ALWAYS specify `--uid 1000` (or the exact UID matching `runAsUser` in the manifest). Never rely on system-allocated UIDs.

## Post-Migration Dead Config Key Removal

**Trigger:** After extracting a component (APScheduler, Celery, Redis sessions) to a separate CronJob or removing it entirely.

**Problem:** Config keys for the removed component remain in application config files (settings.py, .env, gunicorn.conf.py). These dead keys cause:
- `ImportError` if they trigger lazy imports of removed packages
- Misleading ENV_VARIABLES.md entries for variables no longer consumed
- Docker build failures if removed packages are no longer in requirements.txt

**Procedure:**
1. List all config keys associated with the removed component.
2. Grep source for each key: `grep -rn 'REMOVED_KEY' . --include='*.py' --include='*.cfg' --include='*.ini'`
3. For each match NOT in test files: remove or comment out.
4. Update ENV_VARIABLES.md: remove rows for keys no longer consumed by any source file.
5. Verify: `python3 -c "import app"` (or equivalent) — no ImportError.

**Detection:**
```bash
# After removing a package from requirements.txt, find residual references:
REMOVED_PKG="apscheduler"  # example
grep -rn "$REMOVED_PKG" . --include='*.py' --include='*.cfg' | grep -v 'requirements\|test'
```

## YAML Block Scalar + Heredoc Alignment

**Trigger:** Python entrypoint scripts or ConfigMap data values that use YAML block scalar (`|`) syntax containing heredoc-like content or multi-line commands.

**Problem:** YAML `|` (literal block scalar) preserves all newlines and indentation relative to the block's indentation level. If the heredoc delimiter inside the block scalar is not aligned correctly relative to the YAML indentation, the script fails with "unexpected end of file" or "here-document delimited by end-of-file".

**WRONG — misaligned delimiter:**
```yaml
data:
  entrypoint.sh: |
    #!/bin/bash
    cat > /app/config.ini <<EOF
    host = ${DB_HOST}
    port = ${DB_PORT}
EOF
```
The `EOF` terminator must be at column 0 of the heredoc, but YAML preserves leading spaces. The above renders as `    EOF` in the actual file (indented), which doesn't match the unindented `<<EOF` delimiter.

**CORRECT — use <<-EOF with tab indent, or dedent the delimiter:**
```yaml
data:
  entrypoint.sh: |
    #!/bin/bash
    cat > /app/config.ini <<EOF
    host = ${DB_HOST}
    port = ${DB_PORT}
    EOF
```
Here `EOF` is at the same indentation level as the heredoc content inside the YAML block scalar, so the rendered file has the delimiter aligned with the content.

**Alternative — avoid heredocs entirely:**
```yaml
data:
  entrypoint.sh: |
    #!/bin/bash
    printf '[app]\nhost = %s\nport = %s\n' "$DB_HOST" "$DB_PORT" > /app/config.ini
```

**Rule:** When embedding shell heredocs inside YAML `|` block scalars, ensure the terminating delimiter appears at exactly the indentation level the shell expects (typically column 0 of the heredoc, which means it should be at the same YAML indent as the heredoc content lines). Prefer `printf` or `envsubst` over heredocs in YAML-embedded scripts to avoid alignment issues.

**Detection:**
```bash
# Find YAML block scalars containing heredoc markers
grep -n '<<' kubernetes/*.yaml | grep -v '^\s*#'
```



## Lazy Import Detection in Function Bodies

**Problem:** Standard top-of-file grep (`grep -rn '^import\|^from.*import'`) misses imports inside function bodies. Python allows imports anywhere — lazy imports inside functions are invisible to top-level dependency analysis.

**When to run:** During dependency analysis (Sub-Phase §3) and env var enumeration.

**Detection — two-pass approach:**
```bash
# Pass 1: Top-level imports (standard)
grep -rn '^import \|^from .* import' . --include='*.py' | grep -v test | grep -v __pycache__

# Pass 2: Lazy imports inside function bodies (indented import statements)
grep -rn '^\s\+import \|^\s\+from .* import' . --include='*.py' | grep -v test | grep -v __pycache__
```

**Why it matters:**
- Lazy imports can pull in modules that read env vars at import time
- Dependency analysis for Dockerfile `pip install` completeness must include lazily-imported packages
- CronJob extraction may miss connection-eager modules imported lazily

**Common patterns:**
```python
def process_upload(file):
    import boto3  # Lazy import — only loaded when function is called
    s3 = boto3.client('s3')
    s3.upload_fileobj(file, os.environ['S3_BUCKET'], file.filename)
```

**Rule:** After the standard top-level import grep, always run the indented-import grep (Pass 2). Include all lazily-imported packages in requirements.txt and Dockerfile dependency analysis.

## Exec Probe sys.path.insert Pattern

**Purpose:** For Python applications that don't expose an HTTP endpoint (workers, CLI tools), provide an exec probe using `python -c` with `sys.path.insert` to verify the application module is importable.

**Probe configuration:**
```yaml
livenessProbe:
  exec:
    command:
      - python3
      - -c
      - "import sys; sys.path.insert(0, '/app'); import app; print('OK')"
  initialDelaySeconds: 10
  periodSeconds: 30
```

**When to use:**
- Worker Deployments without HTTP endpoints
- CronJob containers where HTTP probes are not applicable
- Any container where the primary health signal is "Python module imports successfully"

**Variations:**
```yaml
# Django management check
command: ["python3", "manage.py", "check", "--deploy"]

# Celery worker ping
command: ["celery", "-A", "app", "inspect", "ping", "-t", "5"]

# Generic module import
command: ["python3", "-c", "import sys; sys.path.insert(0, '/app'); from app.worker import main"]
```

**Rule:** For Python worker containers without HTTP, use exec probe with module import verification. The `sys.path.insert(0, '/app')` pattern handles cases where WORKDIR is not on `sys.path` (common with `COPY . /app` Dockerfiles).

## pytest Configuration and Compatibility

**Problem:** pytest configuration issues cause test failures that are unrelated to migration quality. Common issues: iniconfig version conflicts, test file discovery patterns, and fixture paths.

**iniconfig 2.x compatibility:**
```bash
# Check for iniconfig conflicts
pip show iniconfig | grep Version
# If < 2.0 and pytest >= 7.2, upgrade:
pip install 'iniconfig>=2.0'
```

**Test file discovery — python_files pattern:**
```ini
# pytest.ini or pyproject.toml [tool.pytest.ini_options]
python_files = [!_]*.py
# This EXCLUDES files starting with underscore (like __init__.py) from test collection
# Without this, pytest may try to collect __init__.py as a test module
```

**Common test-run failures and fixes:**

| Error | Cause | Fix |
|-------|-------|-----|
| `ModuleNotFoundError` during collection | sys.path doesn't include project root | Add `pythonpath = .` to pytest.ini |
| `fixture not found` | conftest.py not in test path | Verify conftest.py location matches rootdir |
| `iniconfig.IniConfig` import error | Version mismatch | `pip install --upgrade iniconfig` |
| `PytestUnknownMarkWarning` | Custom markers not registered | Add `markers =` section to pytest.ini |

**Amazon Linux / minimal containers — system Python lacks pip:**
```bash
# If pip3 is not available:
python3 -m ensurepip --upgrade 2>/dev/null || curl -sSL https://bootstrap.pypa.io/get-pip.py | python3
```

**Rule:** Before running pytest in migration validation, verify: (1) pytest is importable (`python3 -m pytest --version`), (2) iniconfig version is compatible, (3) `pythonpath` is configured. Document test infrastructure issues as CONDITIONAL PASS with root cause — they are not migration failures.

## DB Connector Secondary Config Reads

**Problem:** Database connectors often have secondary configuration paths (backup, dump, migrate commands) that bypass the primary env-var-based configuration. These reads create credential exposures that are invisible to the standard env var grep.

**Detection — find secondary config reads:**
```bash
# Look for backup/dump/migrate functions that may read credentials directly
grep -rn 'backup\|dump\|migrate\|pg_dump\|mysqldump\|mongodump' . --include='*.py' | \
  grep -v test | grep -v __pycache__ | grep -v node_modules

# Check management commands for direct config reads
grep -rn "get_connection\|connections\[" . --include='*.py' | grep -v test

# Django management command credential reads
grep -rn "settings\.DATABASES\|connection\.settings_dict" . --include='*.py'
```

**Common secondary read patterns:**

```python
# WRONG — backup command reads credentials directly from settings, not env
def backup_database():
    from django.conf import settings
    db = settings.DATABASES['default']
    cmd = f"pg_dump -h {db['HOST']} -U {db['USER']} {db['NAME']}"
    # Credentials baked into command string!

# CORRECT — use env vars consistently
def backup_database():
    cmd = f"pg_dump -h $DB_HOST -U $DB_USER $DB_NAME"
    env = {
        'PGPASSWORD': os.environ.get('DB_PASSWORD', ''),
    }
    subprocess.run(cmd, shell=True, env={**os.environ, **env})
```

**Rule:** After primary credential externalisation (Forms A–F), grep for backup/dump/migrate functions that construct connection strings or commands. These secondary paths must also read from env vars — not from Django settings or framework config objects that may retain hardcoded fallbacks.

## Bare Underscore Gettext Shadow

**Trigger:** Python files that use both tuple unpacking with `_` (throwaway variable) and `_()` for gettext/i18n translations.

**Problem:** When a function uses `_` as a throwaway variable in tuple unpacking (e.g., `_, value = some_func()`), Python's lexical scoping marks `_` as a local variable for the entire function scope. Subsequent calls to `_("translatable string")` fail with `UnboundLocalError: local variable '_' referenced before assignment` because the gettext `_` is shadowed.

**Detection:**
```bash
# Find files using both _ as throwaway AND _() for gettext
grep -rln 'from gettext import\|_ = gettext\|import gettext' . --include='*.py' | while read f; do
  grep -n '^\s.*,\s*_\s*=\|_,\s.*=' "$f" && echo "SHADOW RISK: $f"
done
```

**WRONG:**
```python
from gettext import gettext as _

def process():
    _, value = get_pair()  # _ is now a local variable
    return _("Success")   # UnboundLocalError!
```

**CORRECT:**
```python
from gettext import gettext as _

def process():
    _unused, value = get_pair()  # Use descriptive throwaway name
    return _("Success")          # gettext _ works correctly
```

**Rule:** In any function that calls `_()` for translations, NEVER use bare `_` as a throwaway variable. Use `_unused`, `_dummy`, or a descriptive name instead.

## mise Interpreter-Split Diagnosis

**Trigger:** pytest `ModuleNotFoundError` for packages confirmed in `requirements.txt`, in environments managed by `mise` (formerly `rtx`).

**Problem:** When `mise` manages Python versions, `pip3` and `python3` may resolve to DIFFERENT interpreters. Packages installed via `pip3` go to one site-packages while `python3 -m pytest` looks in another.

### Toolchain Bootstrap Fallback (Tier 2)

When `pip3 --version` and `python3 -c "import sys; print(sys.executable)"` show different paths (interpreter split), identify a Python binary that has both interpreter and pip available, consistent across the execution environment. Use that resolved binary path for all subsequent pip and pytest invocations to ensure consistent site-packages resolution.

**Detection:**
```bash
# Check if pip3 and python3 point to same interpreter
pip3 --version  # Shows which python and path
python3 -c "import sys; print(sys.executable)"
# If paths differ → interpreter split
```

**Fix:**
```bash
# Always use mise exec to ensure consistent interpreter
mise exec python@3.10 -- python3 -m pip install -r requirements.txt
mise exec python@3.10 -- python3 -m pytest tests/
```

**Rule:** When `mise` is detected (`command -v mise`), ALWAYS prefix Python commands with `mise exec python@<version> --`. Never use bare `pip3` or `python3` — they may resolve to system Python, not the mise-managed version.

## pip install Source-File COPY in Dockerfile

**Trigger:** Dockerfile using `pip install .` or `pip install -e .` to install the application package from `pyproject.toml` or `setup.cfg`.

**Problem:** `pip install .` reads the package metadata (pyproject.toml/setup.cfg) AND the source files listed in `packages` or auto-discovered via `find_packages()`. If source files are not yet COPY'd into the Docker build context, `pip install .` succeeds but installs an EMPTY package (no modules).

**WRONG — source files not yet copied:**
```dockerfile
COPY pyproject.toml .
RUN pip install .  # Installs empty package — no source!
COPY src/ ./src/   # Too late
```

**CORRECT — copy source before pip install:**
```dockerfile
COPY pyproject.toml .
COPY src/ ./src/
RUN pip install .  # Now finds source files
```

**Detection:**
```bash
grep -n 'pip install \.\|pip install -e \.' Dockerfile
# Check if COPY for source directory appears BEFORE this line
```

**Rule:** When using `pip install .` in a Dockerfile, COPY both the metadata file (pyproject.toml/setup.cfg) AND all source directories BEFORE the `pip install` command. The only exception is `pip install --no-deps -r requirements.txt` (which doesn't read source files).

## ChoiceOption Default Derivation

**Trigger:** Python CLI frameworks (Click, argparse) using choice/enum options where the default must be one of the valid choices.

**Problem:** When externalising a choice option's default to an env var, the env var value must be one of the allowed choices. If the env var contains a value not in the choices list, the framework raises a validation error at startup.

**Pattern:**
```python
# Click
@click.option('--log-level', type=click.Choice(['DEBUG', 'INFO', 'WARNING', 'ERROR']),
              default=lambda: os.environ.get('LOG_LEVEL', 'INFO'))

# argparse
parser.add_argument('--mode', choices=['development', 'production', 'testing'],
                    default=os.environ.get('APP_MODE', 'production'))
```

**Rule:** When externalising choice-based options:
1. The ENV_VARIABLES.md entry MUST document the valid choices
2. The ConfigMap default MUST be one of the valid choices (typically `choices[0]` or the most common production value)
3. Add a YAML comment listing valid values: `APP_MODE: "production"  # Valid: development, production, testing`


## Custom WSGI Route-Enumeration Heuristic

**Trigger:** Python WSGI applications (Flask, Django, FastAPI) being assessed for microservice decomposition.

**Problem:** Standard decomposition heuristics look for Blueprint/Router registration. Custom WSGI apps may define routes via decorators, dictionaries, or class-based views without standard registration patterns.

**Heuristic for route discovery:**
```bash
# Flask/FastAPI — decorator-based routes
grep -rn '@app\.\(get\|post\|put\|delete\|route\)' . --include='*.py' | grep -v test | grep -v venv

# Django — urls.py patterns
grep -rn 'path(\|url(' */urls.py --include='*.py'

# Custom WSGI dispatch table
grep -rn 'url_map\|route_table\|ROUTES\s*=' . --include='*.py' | grep -v test
```

**Rule:** When decomposition assessment finds no standard router patterns, search for the custom route-enumeration heuristic above. Group routes by URL prefix (e.g., `/api/users/*`, `/api/orders/*`) to identify bounded contexts for decomposition candidates.

## Module-Level Singleton Pool-Size Amplifier Warning

**Trigger:** Python applications with module-level database/Redis connection pool instantiation AND Kubernetes HPA.

**Problem:** When a module-level singleton creates a connection pool at import time (e.g., `pool = create_pool(max_connections=20)`), EVERY pod replica gets its own pool. With HPA scaling to N replicas, total connections = N × pool_size. This can exhaust database connection limits.

**Detection:**
```bash
grep -rn 'pool.*=.*Pool\|create_pool\|ConnectionPool\|max_connections' . --include='*.py' | grep -v test | grep -v venv
# Check if at module level (not inside a function)
```

**Rule:** Document connection pool sizes in INFRASTRUCTURE_REQUIREMENTS.md §1 with the formula: `total_max_connections = max_replicas × pool_size_per_pod`. Add a MIGRATION comment in the connection pool configuration noting this scaling relationship.

**Mitigation options:**
1. Use `pool_size = int(os.environ.get('DB_POOL_SIZE', '5'))` — make configurable via ConfigMap
2. Set total DB `max_connections` ≥ `maxReplicas × pool_size + overhead`
3. Use PgBouncer as connection multiplexer (document in INFRASTRUCTURE_REQUIREMENTS.md)

## @cached_property + Environment Variable Override Conflict

**Trigger:** Python applications using `@cached_property` (or `@functools.lru_cache`) for configuration values sourced from environment variables.

**Problem:** `@cached_property` caches the value on first access. If the env var is read inside a cached property, changing the env var at runtime (e.g., via ConfigMap update + pod restart) has no effect until the cache is invalidated — which for `@cached_property` means creating a new instance.

**Detection:**
```bash
grep -rn '@cached_property\|@lru_cache' . --include='*.py' | grep -v test | grep -v venv
# Cross-reference with os.environ reads:
grep -B5 'os\.environ\|os\.getenv' . --include='*.py' | grep -B5 'cached_property\|lru_cache'
```

**Rule:** Configuration values sourced from env vars should NOT be cached via `@cached_property` or `@lru_cache`. Either:
1. Read env vars once at module import and store in module-level constants (acceptable — pod restart refreshes)
2. Use pydantic-settings `BaseSettings` which handles env var reading at instantiation time
3. If `@cached_property` is used for expensive computation on config values, document that config changes require pod restart

**Example:**
```python
# PROBLEMATIC — cached_property masks env var updates:
class Config:
    @cached_property
    def db_host(self):
        return os.environ.get('DB_HOST', 'localhost')

# ACCEPTABLE — module-level read, pod restart refreshes:
DB_HOST = os.environ.get('DB_HOST', 'localhost')
```


## INI-Backed Config Dual-Path Naming

**Trigger:** Python applications using `configparser` (INI files) alongside environment variable overrides.

**Problem:** INI-backed config systems (like Trac's `trac.ini` or Mercurial's `hgrc`) use `section.option` naming with case-insensitive keys. When externalising to env vars, the mapping is not straightforward — `[database] host` could map to `DATABASE_HOST` or `TRAC_DATABASE_HOST` depending on the framework's env var bridge.

**Rule:** When an application reads config from BOTH an INI file AND environment variables:
1. Check if the framework provides an env var override mechanism (e.g., `TRAC_` prefix convention)
2. If yes: use the framework's naming convention for ENV_VARIABLES.md keys
3. If no: create an explicit bridge in the entrypoint script or application startup code
4. Document BOTH the INI path AND the env var name in ENV_VARIABLES.md

**Detection:**
```bash
grep -rn 'configparser\|ConfigParser\|SafeConfigParser\|RawConfigParser' . --include='*.py' | grep -v test
grep -rn '\.ini\|\.cfg\|trac\.ini\|setup\.cfg' . --include='*.py' | grep -v test
```

## Multi-Top-Level-Package Dockerfile COPY

**Trigger:** Python projects with multiple top-level packages (not a single `src/` directory).

**Problem:** The standard `COPY . .` pattern copies everything including dev files. When trying to COPY specific packages for a leaner image, missing a top-level package causes `ModuleNotFoundError` at runtime.

**Detection:**
```bash
# Find all top-level Python packages (directories with __init__.py)
find . -maxdepth 2 -name '__init__.py' -not -path '*/test*' -not -path '*/.venv/*' | sed 's|/[^/]*$||' | sort -u
```

**Rule:** When a Python project has multiple top-level packages, the Dockerfile MUST copy ALL of them. Use the detection command above to enumerate, then verify each package appears in a COPY instruction:
```dockerfile
# Example: project with trac/, tracopt/, contrib/ packages
COPY trac/ ./trac/
COPY tracopt/ ./tracopt/
COPY contrib/ ./contrib/
COPY setup.py setup.cfg ./
```

**Verification (post-Dockerfile-write):**
```bash
# Extract COPY destinations from Dockerfile, compare against discovered packages
grep '^COPY' Dockerfile | grep -v '\-\-from'
```

## ChoiceOption First-Element-as-Default Pattern

**Trigger:** Python applications using custom `Option` classes with `choices` parameter where the first element serves as the default value.

**Problem:** When externalising a `ChoiceOption` to an env var, the default value must be the first element of the choices list (framework convention). Setting an env var to a value not in the choices list causes a validation error at startup.

**Rule:** For config options with constrained choices:
1. Document the valid choices in ENV_VARIABLES.md description column
2. Set the ConfigMap default to the first element of the choices list (framework convention)
3. Add a YAML comment listing valid values

```yaml
# ConfigMap example:
data:
  LOG_LEVEL: "WARNING"  # Valid: DEBUG, INFO, WARNING, ERROR, CRITICAL
```


## Multi-Line os.environ.get() Split Calls

**Trigger:** Python code using `os.environ.get()` or `os.environ[]` split across multiple lines.

**Problem:** Standard single-line grep (`grep -rn 'os.environ.get'`) misses multi-line calls where the variable name is on the next line:

```python
# Missed by single-line grep:
db_host = os.environ.get(
    'DATABASE_HOST', 'localhost'
)
```

**Supplementary detection:**
```bash
# Find multi-line os.environ patterns (line ends with 'os.environ.get(' or 'os.environ[')
grep -rn 'os\.environ\.\(get\|setdefault\)\s*($' . --include='*.py' | grep -v 'venv\|site-packages'
# Then read the NEXT line to extract the variable name:
grep -A1 'os\.environ\.\(get\|setdefault\)\s*($' . --include='*.py' -r | grep -oP "['\"]([A-Z][A-Z0-9_]+)['\"]" | sort -u
```

**Rule:** For Python projects, after Pass 1/Pass 3, run the supplementary multi-line scan above. Any new variables found must be added to ENV_VARIABLES.md.

## Tuple-List Config-Mapping Loop Variables

**Trigger:** Python applications using tuple-list patterns to map config keys to env vars:

```python
CONFIG_MAP = [
    ('database.host', 'DB_HOST', 'localhost'),
    ('database.port', 'DB_PORT', '5432'),
    ('redis.url', 'REDIS_URL', 'redis://localhost:6379'),
]
for config_key, env_var, default in CONFIG_MAP:
    config[config_key] = os.environ.get(env_var, default)
```

**Problem:** Pass 1 grep for `os.environ.get` matches only the loop body (the generic pattern), not the individual variable names stored in the tuple list. The actual env var names are string literals in the data structure.

**Detection:**
```bash
# Find tuple-list config patterns
grep -B5 -A1 'os\.environ\.\(get\|setdefault\).*env_var\|os\.environ\.\(get\|setdefault\).*key' . -r --include='*.py' | grep -oP "['\"]([A-Z][A-Z0-9_]+)['\"]" | sort -u
# Also scan for uppercase string literals in list/tuple assignments near config code
grep -rn '\(.*[A-Z][A-Z0-9_]\{2,\}.*,.*[A-Z][A-Z0-9_]\{2,\}.*\)' . --include='*.py' | grep -v 'test\|venv'
```

**Rule:** When Python code uses data-driven config mapping (lists of tuples, dicts mapping config keys to env vars), extract variable names from the DATA STRUCTURE, not from the loop body. Each string matching `[A-Z][A-Z0-9_]+` in the tuple list is a candidate env var.

## Redis Triple-Role Pattern

**Trigger:** Python/Django applications using Redis for multiple purposes (cache + session + Celery broker) where the same `REDIS_URL` serves all three.

**Problem:** A single `REDIS_URL` env var may serve three distinct roles. When externalising, workers sometimes create three separate env vars (`CACHE_REDIS_URL`, `SESSION_REDIS_URL`, `CELERY_BROKER_URL`) even though the source code uses a single `REDIS_URL` for all three.

**Detection:**
```bash
# Check if single REDIS_URL serves multiple roles
grep -rn 'REDIS_URL\|REDIS_HOST' . --include='*.py' | grep -v 'test\|venv' | awk -F: '{print $1}' | sort -u | wc -l
# If referenced in 3+ distinct files (cache, session, celery config), it's triple-role
```

**Rule:** Follow source code — if the source uses ONE `REDIS_URL` for all three roles, the ConfigMap/Secret should contain ONE `REDIS_URL` entry (Secret-classified per Connection URL rule). Only create separate entries if the source code already reads from separate env vars. Document the triple-role in ENV_VARIABLES.md description: "Used for cache, sessions, and Celery broker."

## ProbeMiddleware Split-Entrypoint Caveat

**Trigger:** Python web applications where a health probe middleware (e.g., custom `/health` endpoint) is registered only in the web entrypoint, but Celery workers or management commands share the same codebase.

**Problem:** When extracting Celery workers or scheduled tasks to separate Deployments/CronJobs, the health probe middleware is not active (because the web server isn't running). Workers need exec probes (`kill -0 1`), not HTTP probes.

**Detection:**
```bash
# Find probe middleware registration
grep -rn 'health\|readiness\|liveness' . --include='*.py' | grep -i 'middleware\|urlpatterns\|app\.route\|app\.get'
# Check if it depends on web server running:
grep -rn 'urlpatterns\|@app.route.*health\|@app.get.*health' . --include='*.py'
```

**Rule:** When splitting a Python application into web + worker Deployments:
- Web Deployment: HTTP probes pointing to the health middleware path
- Worker/CronJob Deployment: exec probes only (`["/bin/sh", "-c", "kill -0 1"]`)
- Do NOT add HTTP probes to worker Deployments that don't run a web server


## pytest iniconfig 2.x + setup.cfg Indentation Issue

**Trigger:** Python projects using pytest >=9.x with `setup.cfg` containing `[options.extras_require]`.

**Problem:** `iniconfig` 2.x (used by pytest >=7.2) rejects indented continuation values in `setup.cfg`. Lines like:
```ini
[options.extras_require]
dev =
    pytest
    flake8
```
...fail with a parse error when `iniconfig` 2.x encounters the indented `pytest` line.

**Fix:** Remove leading whitespace from continuation values in `setup.cfg`:
```ini
[options.extras_require]
dev = pytest,flake8
```

**Detection:**
```bash
grep -A5 '\[options.extras_require\]' setup.cfg | grep '^\s\+[a-z]'
# Any match = potential iniconfig 2.x parse failure
```

**Rule:** If `setup.cfg` is present and pytest >=9.x is used, ensure `[options.extras_require]` entries have NO leading whitespace on continuation lines. This is a general Python containerisation pattern — not specific to any framework.

## Framework Test* Class Collection Conflict

**Trigger:** Python framework projects (Trac, Zope, Django) with non-test helper classes named `Test*` (e.g., `TestManager`, `TestEnvironment`, `TestCase` base classes).

**Problem:** pytest default `python_classes = Test*` collection pattern discovers these framework helper classes and attempts to run them as tests. This causes collection errors or spurious test execution.

**Fix — override in pytest.ini or pyproject.toml:**
```ini
# pytest.ini
[pytest]
python_classes = *TestCase *Tests
```

Or in `pyproject.toml`:
```toml
[tool.pytest.ini_options]
python_classes = ["*TestCase", "*Tests"]
```

**Detection:**
```bash
# Find non-test classes named Test* that pytest would collect
grep -rn '^class Test' . --include='*.py' | grep -v 'test_\|tests/\|_test\.py' | head -10
```

**Rule:** For framework projects with non-test `Test*` classes, override `python_classes` in pytest configuration to avoid false collection. This prevents test task failures that are unrelated to migration quality.

## SIGTERM + socketserver.serve_forever() Deadlock

**Trigger:** Python WSGI/HTTP servers using `socketserver.serve_forever()` (or `HTTPServer.serve_forever()`) in the main thread.

**Problem:** Calling `httpd.shutdown()` directly in a SIGTERM signal handler when `serve_forever()` runs in the same thread causes a deadlock. `shutdown()` tries to acquire the `_block_on_close` lock that `serve_forever()` already holds in the main thread.

**Fix — daemon-thread shutdown pattern:**
```python
import signal, sys, threading

_httpd_ref = [None]  # Mutable container for signal handler access

def sigterm_handler(signum, frame):
    httpd = _httpd_ref[0]
    if httpd:
        # Call shutdown() from a separate thread to avoid deadlock
        threading.Thread(target=httpd.shutdown, daemon=True).start()

signal.signal(signal.SIGTERM, sigterm_handler)

httpd = make_server('0.0.0.0', int(os.environ.get('PORT', '8080')), app)
_httpd_ref[0] = httpd
httpd.serve_forever()
sys.exit(0)
```

**Key points:**
1. Never call `httpd.shutdown()` directly in the signal handler — deadlock
2. Use a daemon thread to call `shutdown()` from outside the serve_forever() loop
3. The mutable container pattern (`_httpd_ref = [None]`) allows the signal handler to access the server reference without module-level assignment issues

**Detection:**
```bash
grep -rn 'serve_forever\|BaseHTTPServer\|socketserver' . --include='*.py' | grep -v test
```

## S3 Body Stream Non-Seekability

**Trigger:** Python code calling `s3.get_object()` and then attempting `.seek()` on the `Body` stream.

**Problem:** The `Body` returned by `boto3 s3.get_object()` is a `StreamingBody` — it is NOT seekable. Code that calls `body.seek(0)` after partial reads raises `io.UnsupportedOperation: seek`.

**Fix — wrap in io.BytesIO:**
```python
import io

response = s3.get_object(Bucket=bucket, Key=key)
body_bytes = response['Body'].read()
seekable_body = io.BytesIO(body_bytes)
# Now seekable_body.seek(0) works
```

**Also note:** Error codes differ:
- `s3.head_object()` on non-existent key raises `ClientError` with HTTP 404
- `s3.get_object()` on non-existent key raises `ClientError` with code `NoSuchKey`
- Check BOTH codes when handling "object not found" scenarios

**Detection:**
```bash
grep -rn 'get_object\|Body.*seek\|Body.*read' . --include='*.py' | grep -v test | grep -v venv
```

**Rule:** After any `get_object()` call, if the code path calls `.seek()` on the Body, wrap the read result in `io.BytesIO()` first. This applies to all S3-integrated Python code paths (file browsers, backup/restore, image processing).

## WSGI Middleware Ordering for Health Probes

**Trigger:** Python WSGI applications (Trac, custom WSGI) where authentication middleware wraps the entire application.

**Problem:** If the health probe endpoint is registered inside the WSGI application that is wrapped by auth middleware, the probe receives 401/403 — causing the pod to never become Ready.

**Fix — register health endpoint BEFORE auth middleware in the WSGI pipeline:**
```python
class HealthCheckMiddleware:
    def __init__(self, app):
        self.app = app
    def __call__(self, environ, start_response):
        if environ.get('PATH_INFO') == '/healthz':
            start_response('200 OK', [('Content-Type', 'text/plain')])
            return [b'ok']
        return self.app(environ, start_response)

# Apply BEFORE auth middleware in the pipeline:
app = HealthCheckMiddleware(auth_middleware(actual_app))
```

**Rule:** Health check middleware MUST be the outermost wrapper in the WSGI pipeline — before any authentication, session, or logging middleware. This ensures probes bypass all middleware that might reject unauthenticated requests.

## Logging stderr Migration — NullHandler Test Pattern

**Trigger:** After redirecting logging to stderr (§5), tests that capture stderr for assertion break.

**Problem:** Python test frameworks often capture `sys.stderr` using `io.StringIO()` to assert on log output. After migration redirects logging to stderr, these tests capture ALL log messages — including library noise — causing assertions on exact output to fail.

**Fix — use NullHandler in test fixtures:**
```python
# conftest.py
import logging

@pytest.fixture(autouse=True)
def suppress_logging():
    """Prevent log output from polluting test stderr captures."""
    root = logging.getLogger()
    root.handlers = [logging.NullHandler()]
    yield
    root.handlers = []
```

**Rule:** After stderr logging migration, if tests fail due to unexpected log output in stderr, add a NullHandler fixture. Document pre-existing test failures as CONDITIONAL PASS — they are not migration defects.

## INI Config Env-Var Bridge Pattern

**Trigger:** Python applications using `configparser` (INI files) where config values need to be overridable via environment variables at container runtime.

**Problem:** `configparser.get()` reads from the INI file only — it has no built-in env var override mechanism (unlike Spring's PropertySourcesPlaceholderConfigurer). Applications must implement their own bridge.

**Pattern — Section.get() interception with _ENV_VAR_ALIASES:**
```python
import os
import configparser

_ENV_VAR_ALIASES = {
    ('database', 'host'): 'DB_HOST',
    ('database', 'port'): 'DB_PORT',
    ('database', 'password'): 'DB_PASSWORD',
    ('logging', 'level'): 'LOG_LEVEL',
}

class EnvOverrideConfig(configparser.ConfigParser):
    def get(self, section, option, **kwargs):
        env_key = _ENV_VAR_ALIASES.get((section, option))
        if env_key and os.environ.get(env_key):
            return os.environ[env_key]
        return super().get(section, option, **kwargs)
```

**Rule:** For configparser-backed applications (Trac, Mercurial, Buildbot, custom apps):
1. Identify all config keys that need runtime override (database, credentials, URLs)
2. Create an `_ENV_VAR_ALIASES` mapping from `(section, option)` to env var name
3. Override `get()` to check env vars first
4. Document both the INI key path AND env var name in ENV_VARIABLES.md

**Detection:**
```bash
grep -rn 'configparser\|ConfigParser\|SafeConfigParser' . --include='*.py' | grep -v test | grep -v venv
```

## S3 Optional Backend with Safe-Import Guard

**Trigger:** Python applications adding S3 as an optional storage backend where `boto3` may not be installed in all environments (e.g., development without AWS).

**Pattern — try/except ImportError guard:**
```python
try:
    import boto3
    from botocore.exceptions import ClientError
    HAS_S3 = True
except ImportError:
    HAS_S3 = False

class S3Storage:
    def __init__(self):
        if not HAS_S3:
            raise RuntimeError("boto3 required for S3 storage. Install with: pip install boto3")
        self.client = boto3.client('s3',
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))
```

**_S3TempFile pattern for streaming uploads:**
```python
import tempfile, os

class _S3TempFile:
    """Write to local temp file, upload to S3 on close."""
    def __init__(self, bucket, key, client):
        self._fd, self._path = tempfile.mkstemp(dir='/tmp')
        self._file = os.fdopen(self._fd, 'wb')
        self._bucket, self._key, self._client = bucket, key, client

    def write(self, data):
        self._file.write(data)

    def close(self):
        self._file.close()
        self._client.upload_file(self._path, self._bucket, self._key)
        os.unlink(self._path)
```

**Rule:** When adding boto3 as an optional dependency:
1. Use try/except ImportError guard at module level
2. Set `HAS_S3 = True/False` flag for runtime checks
3. Temp files for upload MUST use `/tmp` (emptyDir-backed) — not application directories
4. Add `boto3` to requirements.txt with version pin

## Amazon Linux / Minimal Container Python Bootstrap

**Trigger:** Python projects being validated in Amazon Linux or minimal container environments where system Python lacks pip.

**Procedure:**
```bash
# Step 1: Verify Python3 exists
command -v python3 || { echo "Python3 not available"; exit 1; }

# Step 2: Bootstrap pip if missing
python3 -m pip --version 2>/dev/null || python3 -m ensurepip --upgrade 2>/dev/null || \
  curl -sSL https://bootstrap.pypa.io/get-pip.py | python3

# Step 3: Install project dependencies
python3 -m pip install -r requirements.txt --quiet

# Step 4: Verify imports
python3 -c "import <main_package>; print('OK')"
```

**Rule:** In minimal environments, always attempt `ensurepip` before falling back to `get-pip.py`. Record CONDITIONAL PASS only when Python3 itself is absent and mise install fails.

## WSGI Environ False-Positive Exclusion

**Trigger:** Python WSGI applications (Django, Flask, Pyramid, Bottle, Trac, or any app using `environ['KEY']` in request handlers).

**Problem:** WSGI apps access per-request data via `environ['KEY']` — using the same dictionary-access syntax as `os.environ['KEY']`. The 5-pass env var grep (Pass 2 data-structure literal scan) picks up WSGI environ keys as false-positive env var candidates. These are per-request HTTP metadata, not OS-level environment variables.

**RFC 3875 §4.1 CGI meta-variables to exclude:**
- `AUTH_TYPE`
- `CONTENT_LENGTH`
- `CONTENT_TYPE`
- `GATEWAY_INTERFACE`
- `PATH_INFO`
- `PATH_TRANSLATED`
- `QUERY_STRING`
- `REMOTE_ADDR`
- `REMOTE_HOST`
- `REMOTE_IDENT`
- `REMOTE_USER`
- `REQUEST_METHOD`
- `SCRIPT_NAME`
- `SERVER_NAME`
- `SERVER_PORT`
- `SERVER_PROTOCOL`
- `SERVER_SOFTWARE`
- All `HTTP_*` prefixed keys (e.g., `HTTP_HOST`, `HTTP_ACCEPT`, `HTTP_AUTHORIZATION`)

**Additionally exclude WSGI-specific keys:**
- `wsgi.input`, `wsgi.errors`, `wsgi.url_scheme`, `wsgi.multithread`, `wsgi.multiprocess`, `wsgi.run_once`

**Detection — distinguish WSGI environ from os.environ:**
```bash
# os.environ reads (TRUE env vars — include in ENV_VARIABLES.md):
grep -rn 'os\.environ\|os\.getenv' . --include='*.py' --exclude-dir=.venv --exclude-dir=tests

# WSGI environ reads (per-request — EXCLUDE from ENV_VARIABLES.md):
grep -rn "environ\['" . --include='*.py' | grep -v 'os\.environ' | grep -v vendor
# Also check for environ.get() without os. prefix:
grep -rn "environ\.get(" . --include='*.py' | grep -v 'os\.environ' | grep -v vendor
```

**Rule:** When a Python WSGI application uses `environ['KEY']` or `environ.get('KEY')` WITHOUT the `os.` prefix, and the key matches any RFC 3875 meta-variable name above, exclude it from ENV_VARIABLES.md. These are per-request HTTP context values, not operator-configurable OS environment variables.

**Source:** RFC 3875 — https://datatracker.ietf.org/doc/html/rfc3875 — "Meta-variables with names beginning with 'HTTP_' contain values read from the client request header fields."
