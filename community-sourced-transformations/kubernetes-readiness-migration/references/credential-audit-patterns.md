# Credential Audit Patterns Reference

Complete credential audit procedure for Phase 2 Sub-Phase §7 (Credentials and Secrets Remediation). Covers all mandatory scan locations, docker-compose forms, IRSA configuration, Secret classification, and connection URL rules.

## Table of Contents

1. [Credential-Only Field Scope Rule (Global)](#credential-only-field-scope-rule-global)
2. [Docker-Compose Credential Scan](#docker-compose-credential-scan)
3. [Source Code Credential Scan](#source-code-credential-scan)
4. [Cross-Profile Property Consistency Check](#cross-profile-property-consistency-check)
5. [IRSA Configuration](#irsa-configuration)
6. [Secret Classification Guards](#secret-classification-guards)
7. [Connection URL Secret Classification](#connection-url-secret-classification)
8. [URL-Embedded Credential Detection (Form F)](#url-embedded-credential-detection-form-f)
9. [Final Literal Sweep (Form G)](#final-literal-sweep-form-g)
10. [Dotted Secret Key Workaround](#dotted-secret-key-workaround)
11. [Framework-Internal Mandatory Secrets](#framework-internal-mandatory-secrets)
12. [Multi-Profile Credential Scan](#multi-profile-credential-scan)
13. [Nounset-Safe Credential Default Removal](#nounset-safe-credential-default-removal)

---

## Credential-Only Field Scope Rule (Global)

**This rule is GLOBAL — applies to every credential externalisation task regardless of whether IRSA is involved.**

Apply null/empty defaults ONLY to credential fields (key, secret, token). Non-credential config fields (region, endpoint, bucket) retain sensible defaults:
```yaml
# CORRECT — credential fields get empty string (for IRSA) or placeholder:
AWS_ACCESS_KEY_ID: ""
AWS_SECRET_ACCESS_KEY: ""
DB_PASSWORD: "replace-with-db-password"
# CORRECT — config fields retain useful defaults:
AWS_DEFAULT_REGION: "us-east-1"
S3_ENDPOINT: "https://s3.amazonaws.com"
S3_BUCKET: "replace-with-bucket-name"
DB_HOST: "replace-with-db-host"
```

**Cross-profile credential default scan** (run after ANY credential externalisation task):
```bash
grep -rn '\${[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD):[^}]+}' --include='*.properties' --include='*.yml' --include='*.yaml' .
```
Any match with a non-empty default for a credential field = violation. Credential fields must use bare `${VAR}` (no fallback) or `${VAR:-}` (empty fallback).

**Scope of this rule:**
- Applies in §7 (Credentials and Secrets), §3 (Config Externalisation), and §15 (Manifest Generation)
- Applies to ALL frameworks and languages — not only AWS/IRSA scenarios
- Any task that adds `${VAR}` placeholders to credential-like fields must verify the default is empty

---

## Docker-Compose Credential Scan

**Scope mandate**: Credential audit ALWAYS covers ALL files matching `docker-compose*.yml` via `find . -name 'docker-compose*.yml' -not -path '*/.git/*'`. Task descriptions naming individual docker-compose files are indicative only — overlay/variant files (docker-compose.grafana.yml, docker-compose.prod.yml, docker-compose.override.yml) are ALWAYS in scope.

**Scan-vs-Modify scope boundary**: All `docker-compose*.yml` files are "in scope for SCANNING" (inspect for credential patterns, report findings). Only files explicitly listed in the task assignment are "in scope for MODIFICATION". Findings in scan-only files MUST be recorded under "Out-of-Scope Findings" in the task report for future remediation — never silently skipped. **Source-file credential findings**: Out-of-scope delegation applies to ALL credential findings regardless of file type — docker-compose overlays AND source files (e.g., `application-prod.properties` found during scanning but not in task file list). Any task recording Out-of-Scope Findings MUST set status to OPEN in the Security Hardening Summary for unremediated items until a downstream task resolves them.

**Cross-profile blocking gate**: Credential sweep MUST cover base AND all profile-specific override files in the same pass:
```bash
grep -r 'SECRET_KEY:.*[0-9]\|JWT_SECRET:.*[a-z]\|PASSWORD:.*[a-z]' --include='*.properties' --include='*.yml' --include='*.yaml' .
# Must return zero matches before task closure
```

**Scan ordering**: docker-compose*.yml FIRST (before src/).

**Absence guard**: `ls docker-compose*.yml 2>/dev/null || echo 'No docker-compose files — skip Forms A-E scan'`

### Five Forms

**(A)** Bash-expansion defaults:
```bash
grep -nE '\$\{[A-Z_]+:-[a-zA-Z0-9]+\}' docker-compose*.yml
# Extended: also catch quoted defaults like ${VAR:-"literal"} or ${VAR:-'literal'}
grep -nE '\$\{[A-Z_]+:-['\''"]?[a-zA-Z0-9]+' docker-compose*.yml
```

**(B)** YAML mapping with credential keywords:
```bash
grep -nE '^\s+[A-Z_]+:\s+[a-zA-Z0-9]' docker-compose*.yml | grep -iE 'pass|secret|key|token|user|host|port'
```

**(C)** List-form environment entries:
```bash
grep -nE '^\s+-\s+[A-Z_]+=\S' docker-compose*.yml | grep -iE 'pass|secret|key|token|user'
```

**(D)** URL-embedded defaults:
```bash
grep -nE ':-[a-zA-Z0-9_.~%@:/+-]+' docker-compose*.yml | grep -iE 'pass|secret|key|token|user'
```

**(E)** Post-fix canonical check:
```bash
grep -E '\$\{[A-Z_]+:-[^}]+\}' docker-compose*.yml
```
Any remaining match = lingering default; production credentials use bare `${VAR}` with NO fallback literal.

**(A')** Hibernate/Spring single-colon variant (for .properties files):
```bash
grep -rE '\$\{[A-Z_]+:[^-][^}]*\}' . --include='*.properties' --include='*.yml' --include='*.yaml' | grep -iE 'pass|secret|key|token'
```
This catches `${VAR:literal}` (Spring/Hibernate default syntax using single colon, NOT bash double-colon `:-`). Each match with a non-placeholder literal is a credential exposure.

**Scope**: Scan ALL service blocks including infrastructure (postgres, redis, mysql). Placeholder URLs (e.g., `https://auth.example.com/...`) → classify as Required env vars in ENV_VARIABLES.md.

**Overlay scoping note**: Dev/monitoring-only docker-compose overlays (e.g., `docker-compose.dev.yml`, `docker-compose.monitoring.yml`) should be scanned for credential patterns but env vars found ONLY in overlays labelled "dev" or "test" may be classified as optional.

## Source Code Credential Scan

The credential audit covers four mandatory locations:

**(a)** Config files — grep application config (`.env`, `config/*.yml`, `application.properties`, etc.) for hardcoded values.

**(b)** Hardcoded string constants and fallback DSN constructions — search for inline connection strings:
```bash
grep -rn 'password\|secret\|api_key\|token' src/ --include='*.py' --include='*.js' --include='*.java' --include='*.php' --include='*.rb' --include='*.go' | grep -v 'test\|spec\|mock' | grep -v '^\s*#\|^\s*//'
```

**(c)** Framework SetDefault/fallback calls:
- Go: `viper.SetDefault("key", "literal")`
- Python: `os.Getenv("KEY", "literal")` fallback args
- Spring: `@Value("${VAR:literal-default}")` defaults
- PHP: `env('KEY', 'literal-default')` literal defaults
- Node.js: `process.env.KEY || 'literal-default'`

**(d)** Startup/entrypoint shell scripts AND docker-compose*.yml:
```bash
grep -E '\$\{[A-Z_]*(PASSWORD|SECRET|KEY|TOKEN)[A-Z_]*:-[^}]+\}' startup*.sh entrypoint*.sh docker-entrypoint.sh docker-compose*.yml
```

**Bash nounset compatibility**: Before removing a hardcoded literal from `${VAR:-literal}`, inspect the script shebang/set flags. If `set -u` or `#!/bin/bash -u` is present, use `${VAR:-}` (empty default) rather than bare `${VAR}` — bare references cause nounset failures.

**Post-transformation src/ tree sweep**: After removing config-module fallbacks, grep entire src/ for the same env var name to detect secondary direct reads (e.g., `process.env.X` reads that bypass the config module).

**Boolean-value filter**: Exclude credential-scan matches where the default value is in the boolean set {true, false, 0, 1, yes, no} or is <= 4 characters. Variables with `_LOCKED`, `_ENABLED`, `_ACTIVE`, `_DISABLED` suffixes are typically boolean toggles, not credentials — they are NOT credentials regardless of name pattern. Reclassify as ConfigMap. **Port exclusion**: values matching common infrastructure ports (2181, 3306, 5432, 6379, 8080, 9092, 27017) are not credentials.

## Cross-Profile Property Consistency Check

**Purpose:** For any property externalised as a required secret (no-default, bare `${VAR}`) in ANY named Spring/framework profile, verify the base/default profile also uses the no-default form. A hardcoded fallback in the base profile creates a silent credential bypass when the env var is absent at runtime.

**When to run:** After credential remediation on any Spring/multi-profile project (Sub-Phase §7, post-batch).

**Preconditions:** Application uses Spring profiles (application-{profile}.properties/yml) or equivalent framework-specific profile configuration.

**Procedure:**

1. Identify all property keys that were externalised as secrets (no-default form):
```bash
# Find all bare ${VAR} patterns in named profile files
grep -rn '\${[A-Z_]*}' --include='application-*.properties' --include='application-*.yml' . | \
  grep -v ':-' | grep -v ':[^}]' | sed 's/.*\${\([A-Z_]*\)}.*/\1/' | sort -u > /tmp/secret_vars.txt
```

2. For each variable, check that the base/default profile also uses the no-default form:
```bash
while read VAR; do
  # Check base profile for residual fallback
  grep -rn "${VAR}" application.properties application.yml 2>/dev/null | grep -E ':-|:[^}]' && \
    echo "RESIDUAL FALLBACK: ${VAR} has default in base profile"
done < /tmp/secret_vars.txt
```

3. Any match with a `:-fallback` or `:fallback` in the base profile is a residual credential exposure — replace with bare `${VAR}`.

**Verification:** Re-run step 2. Zero matches expected.

**Example:**
```properties
# BEFORE (base profile — WRONG, has fallback):
encryption.secret.key=${ENCRYPTION_SECRET_KEY:defaultSecret}

# AFTER (base profile — CORRECT, no fallback):
encryption.secret.key=${ENCRYPTION_SECRET_KEY}
```

**Rationale:** Spring Boot loads profile-specific properties that override base properties. But when a named profile is NOT active (e.g., production uses only `application.properties`), the base profile fallback value is used — silently bypassing the intended credential externalisation.

**Source:** https://docs.spring.io/spring-boot/reference/features/profiles.html — "Profile-specific variants of both application.properties and files referenced through @ConfigurationProperties are considered as files and loaded."

## IRSA Configuration

### Trigger Condition

Apply when source contains ANY AWS SDK client instantiation — not just pre-existing credential env reads. **Trigger is SDK client constructor presence, regardless of whether source already reads credential vars.** Trigger list: `boto3.client`, `boto3.resource`, `new S3Client`, `new SQSClient`, `new SNSClient`, `new DynamoDBClient`, `aws-sdk` client builders, `spring-cloud-aws`, `AWSSDK.S3`, `AWSSDK.SQS`, `AWSClientBuilder`.

**Test-file exclusion**: SDK usage appearing ONLY in test files (`*_test.go`, `*.test.js`, `*Test.java`, `test_*.py`) does NOT trigger IRSA.

### Empty-String Guard

AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY MUST be active non-commented empty-string entries in Secret for IRSA. Commented-out YAML keys are invisible to envFrom.

### Credential-Only Field Scope

See §Credential-Only Field Scope Rule (Global) above — this rule applies globally, not just in IRSA contexts.

### Idempotency Check Before Applying

Before applying the IRSA empty-string pattern, check if the code already uses `|| ""` or `|| null` on AWS credential vars. If already-compliant, record as compliant and skip to avoid unnecessary edits.

### Healthcheck.test Co-Update (Form B)

After parameterising any identity env var (POSTGRES_USER, DB_USER, MYSQL_USER) in docker-compose, grep `healthcheck.test` CMD-SHELL entries for the same literal. If found, update to `${VAR:-default}` interpolation:
```yaml
# BEFORE:
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U admin"]
# AFTER:
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-admin}"]
```

### Cross-Task Dependency

AWS credential env vars MUST use `process.env.X || ""` or `os.environ.get('X', '')` (NOT requireEnv/ENV.fetch without default) — requireEnv treats empty string as falsy and crashes in IRSA mode where values are intentionally empty.

### SDK kwargs Empty-String Guard

`if key and secret: kwargs.update(...)` — passing any non-None value (including empty string) for credential params prevents SDK provider chain activation.

### ServiceAccount Manifest

When IRSA is triggered, generate a ServiceAccount manifest with `eks.amazonaws.com/role-arn: REPLACE-WITH-ROLE-ARN` annotation and reference it in Deployment `spec.serviceAccountName`. If IRSA triggered in §6, ServiceAccount is in-scope regardless of other scoping rules.

**automountServiceAccountToken reconciliation rule**: Set `automountServiceAccountToken: true` on the ServiceAccount resource (ensures IRSA token projected into the pod) and `automountServiceAccountToken: false` on the Deployment pod spec (prevents default token mount, scopes to IRSA only). While `true` is the Kubernetes default on ServiceAccount, some cluster policies or Pod Security Standards disable it — explicit declaration is required:
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-service-account
  annotations:
    eks.amazonaws.com/role-arn: "REPLACE-WITH-ROLE-ARN"
automountServiceAccountToken: true
```

Deployment pod spec:
```yaml
spec:
  template:
    spec:
      serviceAccountName: app-service-account
      automountServiceAccountToken: false
      containers:
      - name: app
        securityContext:
          runAsNonRoot: true
          runAsUser: 1000
          runAsGroup: 1000
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
          capabilities:
            drop: [ALL]
```

### Co-Located SDK Client Rule

When applying the IRSA conditional guard to any AWS SDK client, grep the same module for ALL other AWS SDK client builders (S3, SES, SNS, SQS, DynamoDB) and apply the same guard to each in the same task — regardless of task file list scope. A partially-guarded module causes credential resolution inconsistency where one client uses IRSA and another attempts static credentials.

**Detection (run after applying guard to any one client):**
```bash
grep -rn 'AmazonS3\|AmazonSQS\|AmazonSNS\|AmazonDynamoDB\|AmazonSES\|S3Client\|SqsClient\|SnsClient\|SesClient\|DynamoDbClient' $(dirname <file-just-modified>) --include='*.java' --include='*.py' --include='*.js' --include='*.go' --include='*.php' --include='*.rb'
```

**Rule:** If additional SDK clients are found in the same module/directory, apply the IRSA empty-string guard to ALL of them before closing the task.

### Secret Key Naming

When activating commented-out AWS credential entries, verify keys are UPPERCASE canonical form — envFrom injects key name verbatim; lowercase stubs must be renamed.

### IAM Policy

Must include s3:ListBucket on bucket ARN (not wildcard /*) alongside s3:PutObject/GetObject/DeleteObject; missing s3:ListBucket causes misleading AccessDenied on non-existent keys.

### Non-Standard Credential Names

Applications may use custom AWS credential env var names (e.g., `S3_KEY`, `STORAGE_KEY`). Grep storage/filesystem config files for ALL credential-like values.

## Secret Classification Guards

1. **DB field separation**: DB_USERNAME, DB_HOST, DB_PORT, DB_DATABASE → always ConfigMap; only DB_PASSWORD, DB_CONNECTION_STRING → Secret.
2. **Routing keys**: vars ending in `_ROUTING_KEY` (e.g., AMQP RABBITMQ_ROUTING_KEY) are non-credential ConfigMap values.
3. **Placeholder convention**: ALL values in Secret stringData must use `replace-with-*` placeholder convention.
   - **Exception A**: IRSA credential vars (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) use `""` (empty string activates IRSA provider chain).
   - **Exception B**: Optional override fields where empty string triggers fallback (detect via `grep -E 'if \[ -z "\$\{VAR:-\}" \]'` in entrypoint scripts) use empty string with YAML comment explaining purpose.
4. **Value-content-supersedes-name rule**: Variables whose VALUES embed credentials (JDBC URLs with `?user=X&password=Y`, connection strings with `:password@` syntax) MUST be classified as Secret regardless of variable name.

## Connection URL Secret Classification

Variables whose names match `*_URL` or `*_DSN` and whose values follow a connection URL scheme MUST be placed in Secret regardless of whether the current dev value contains credentials.

**Covered schemes**: `redis://`, `amqp://`, `mongodb://`, `postgres://`, `mysql://`, `sqlserver://`

**Override rule**: Any `*_URL`/`*_DSN` variable whose value matches one of the covered schemes MUST be classified as Secret per this rule, regardless of task-pattern classification or variable name lacking credential keywords. This rule supersedes any ConfigMap classification made by other heuristics.

**Rationale**: Connection URLs can embed credentials in production; classified as Secret proactively.

**YAML comment template**:
```yaml
stringData:
  REDIS_URL: "replace-with-redis-url"  # URL can embed credentials in production; classified as Secret proactively
  CELERY_BROKER_URL: "replace-with-broker-url"
```

**Detection**:
```bash
grep -rn '_URL\|_DSN' ENV_VARIABLES.md | grep -iE 'redis|amqp|mongo|postgres|mysql|sqlserver' | grep -i 'ConfigMap'
# Any match = misclassification — must be Secret
```

## URL-Embedded Credential Detection (Form F)

**Problem:** Forms A–E catch variable-name-based credential patterns, but connection URLs embedding `user:password@host` are missed when the variable NAME lacks credential keywords (e.g., `CELERY_BROKER_URL`, `DATABASE_URL`, `REDIS_URL`).

**Form F — URL-embedded credentials:**
```bash
grep -nE '://[^$][^@]*@' docker-compose*.yml
```

This catches patterns like:
- `amqp://guest:guest@rabbitmq:5672/`
- `redis://:mypassword@redis:6379/0`
- `postgres://user:pass@db:5432/mydb`
- `mongodb://admin:secret@mongo:27017/`

**Rule:** Any URL containing `user:password@host` or `:password@host` embeds credentials regardless of variable name. These MUST be externalised — the entire URL goes to Secret (per Connection URL Secret Classification above).

**Form F workflow:**
1. Run the grep above on all docker-compose*.yml files.
2. For each match, extract the variable name from context (line above or inline assignment).
3. Classify the variable as Secret.
4. Replace the hardcoded URL with a placeholder: `replace-with-<service>-url`.

**Detection of missed URL-embedded credentials (post-transformation check):**
```bash
# Verify no URL-embedded credentials remain in source after migration
grep -rnE '://[a-zA-Z0-9_]+:[a-zA-Z0-9_]+@' src/ config/ --include='*.yml' --include='*.yaml' --include='*.env' --include='*.properties' 2>/dev/null | grep -v 'example\|placeholder\|replace-with'
# Any match = credential not yet externalised
```

## Final Literal Sweep (Form G)

**Purpose:** After Forms A–F, catch any remaining bare literals in docker-compose environment sections that were missed by credential-name-based patterns.

**When to run:** After Forms A–F remediation, as the final docker-compose pass.

**YAML-format detection (MANDATORY pre-check):** Before running Form G grep, determine the docker-compose environment format:
```bash
# Detect YAML mapping format (KEY: VALUE) vs list format (- KEY=VALUE)
grep -A2 'environment:' docker-compose*.yml | grep -q '^\s\+[A-Z_]\+:' && echo "MAPPING_FORMAT" || echo "LIST_FORMAT"
```
- **List format** (`- KEY=VALUE`): Use Form G grep below.
- **YAML mapping format** (`KEY: VALUE`): Form G grep does NOT match this format — substitute Form B (docker-compose credential scan from §2) which uses YAML-aware key extraction. Any mapping-format environment section with non-placeholder values is a violation.

**Form G — Final Literal Sweep (list format):**
```bash
grep -nE '^\s+-\s+[A-Za-z0-9_]+=\S' docker-compose*.yml | grep -v '\${' | grep -v '^\s*#'
```

**Additional scan location — healthcheck.test**: docker-compose `healthcheck.test` fields often contain embedded credentials (e.g., `mysql -p<password>`). Scan these separately:
```bash
grep -A5 'healthcheck:' docker-compose*.yml | grep -E '(test:|test:.*\[)' | grep -iE '(password|pass|secret|token|key)' | grep -v '\${'
```
Any match with a bare literal credential = violation.

**Rule:** Any remaining bare literal assignment (not using `${VAR}` substitution) must be evaluated. Parameterise all hits that are NOT:
- Boolean flags (`true`, `false`, `0`, `1`, `yes`, `no`)
- Standard ports (`80`, `443`, `3306`, `5432`, `6379`, `8080`, `9092`, `27017`)
- Docker-internal hostnames matching service names in the same compose file
- Composite service:port values (e.g., `kafka:9092`, `redis:6379`) — these are docker-internal references, NOT credentials

**Keyword-extension note**: Variables containing `USERNAME` or `USER` in their names (e.g., `MAIL_USERNAME`, `DB_USER`) require cross-reference against the Non-Credential Classification Table. If the variable is an identity field (not a credential), classify as ConfigMap. If it serves as an authentication credential (e.g., SMTP auth username), classify as Secret. **SMTP_USERNAME rule**: `SMTP_USERNAME`, `MAIL_USERNAME`, and `MAILER_USERNAME` are ALWAYS Secret-classified — they serve as authentication identity for external mail providers.

**Fix-immediately mandate**: Form G and Cross-Profile sweep MUST apply fixes immediately regardless of original task file list. All source/config profile files under `src/main/resources` (or framework equivalent) are in-scope for credential remediation whenever the task touches that module. **Out-of-Scope Findings delegation applies to ALL credential findings regardless of file type.** When a task records Out-of-Scope Findings (docker-compose overlays, source files, config profiles, or any other file containing credential patterns), the orchestrator MUST include those specific file:line violations in the file scope of the next eligible downstream task — either by creating a dedicated follow-up task or appending to the nearest downstream task files list.

**Workflow:**
1. Run the grep above.
2. For each match, determine if the value is a boolean/port/service-name (exempt) or a configuration value (must parameterise).
3. Parameterise non-exempt values as `${VAR_NAME}` with corresponding ENV_VARIABLES.md entry.

**Verification:**
```bash
# Re-run after remediation — only exempt values should remain
grep -nE '^\s+-\s+[A-Za-z0-9_]+=\S' docker-compose*.yml | grep -v '\${' | grep -v '^\s*#' | \
  grep -vE '=(true|false|0|1|yes|no|80|443|3306|5432|6379|8080|9092|27017)$' | \
  grep -vE '=[a-z][-a-z0-9]*:[0-9]+$'
# Expected: zero matches (or only docker-internal hostnames)
```

## Dotted Secret Key Workaround

**Problem**: Keys containing dots (e.g., `spring.datasource.password`) are silently skipped by `envFrom.secretRef` bulk injection. Kubernetes envFrom injects keys as environment variables, but dots are invalid in env var names on most systems — the key is simply ignored.

**Fix**: Inject dotted-key secrets via explicit `env[].valueFrom.secretKeyRef` with SCREAMING_SNAKE_CASE env var names:

```yaml
# WRONG — silently skipped:
envFrom:
- secretRef:
    name: app-secret
# Where app-secret has key: spring.datasource.password

# CORRECT — explicit injection with valid env var name:
env:
- name: SPRING_DATASOURCE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: app-secret
      key: spring.datasource.password
```

**Detection**:
```bash
python3 -c "
import yaml
with open('kubernetes/secret.yaml') as f:
    for doc in yaml.safe_load_all(f):
        if doc and doc.get('kind') == 'Secret':
            for k in list(doc.get('stringData', {}).keys()) + list(doc.get('data', {}).keys()):
                if '.' in k:
                    print(f'DOTTED KEY: {k} — will be skipped by envFrom')
"
```

## Framework-Internal Mandatory Secrets

These MUST always appear in Secret manifest regardless of grep output:

| Framework | Variable | Purpose |
|-----------|----------|---------|
| Rails | `SECRET_KEY_BASE` | Cookie signing, session encryption |
| Django | `SECRET_KEY` | CSRF tokens, session signing |
| Laravel | `APP_KEY` | Encryption, cookie signing |
| Spring Boot | `JASYPT_ENCRYPTOR_PASSWORD` | Property encryption (if Jasypt present) |
| Node.js/Express | `SESSION_SECRET` | Session cookie signing (if express-session) |

**Rule**: Even if the application does not currently read these from env vars (hardcoded or generated), they MUST be externalised to Secret during migration.

## Non-Credential Classification Table

Variables that contain "password", "key", or "secret" substrings in their names but are NOT credentials:

| Category | Examples | Classification | Rationale |
|----------|----------|---------------|-----------|
| SMTP auth identity | SMTP_USERNAME, MAIL_USERNAME, MAILER_USERNAME | Secret | Authentication credential for mail providers — always Secret |
| External-service auth identity | KAFKA_SASL_USERNAME, RABBITMQ_USER, LDAP_BIND_DN | Secret | Username authenticating to EXTERNAL services (Kafka, AMQP, LDAP) — always Secret |
| Usernames | DB_USERNAME, MYSQL_USER, POSTGRES_USER | ConfigMap | Not secret material |
| Database names | DB_DATABASE, DB_NAME, MYSQL_DATABASE | ConfigMap | Not secret material |
| Hostnames | DB_HOST, REDIS_HOST, SMTP_HOST | ConfigMap | Network config, not secret |
| Ports | DB_PORT, REDIS_PORT, SMTP_PORT | ConfigMap | Numeric config |
| Boolean flags | *_LOCKED, *_ENABLED, *_ACTIVE | ConfigMap | Feature toggles |
| Routing keys | *_ROUTING_KEY, *_QUEUE_NAME, *_EXCHANGE_NAME | ConfigMap | AMQP routing labels |
| Public certificates | JWT_PUBLIC_KEY, TLS_PUBLIC_CERT | ConfigMap | Public by definition |

**Rule**: Only passwords, API keys, tokens, secrets, and connection strings (which may embed credentials) require default removal and Secret classification.

## Post-Form-C .env Gap Fill

**Problem**: After converting docker-compose `${VAR:-literal}` to bare `${VAR}`, running `docker-compose config --quiet` fails if the variable is absent from `.env`. Development environments need placeholder values to remain functional.

**Procedure**: After removing credential defaults (Form C remediation):
1. Run `docker-compose config --quiet 2>&1 | grep 'variable is not set'`
2. For each missing variable, add a dev-safe placeholder to `.env.example` (NOT `.env`):
   ```
   DB_PASSWORD=replace-with-db-password
   ```
3. Document in ENV_VARIABLES.md that `.env.example` contains template values.

**IRSA null-default side-effects**: After applying IRSA empty-string pattern, grep test directories for assertions that check non-empty values of AWS credential vars:
```bash
grep -rn 'assertNotEmpty.*AWS\|assertNotNull.*AWS\|expect.*AWS.*not.*empty' tests/ __tests__/ spec/ 2>/dev/null
```
If found and tests are out of scope, document as residual item in TRANSFORMATION_SUMMARY.md.

## Read-Before-Write Rule for .env Sanitisation

**Trigger:** Credential sanitisation task (Sub-Phase §7) modifying `.env` or shared config files that were already modified by prior tasks (e.g., session driver, logging channel).

**Problem:** If the credential sanitisation task reads a stale cached version of `.env` (or any shared config file) and writes the full file with placeholder replacements, it silently reverts values correctly set by prior tasks (e.g., `SESSION_DRIVER=redis` reverted to `SESSION_DRIVER=file`, `LOG_CHANNEL=stack` reverted to `LOG_CHANNEL=daily`).

**Rule — read-before-write:** Before sanitising `.env` or any shared config file with credential placeholders:
1. Read the file's CURRENT contents in full (`cat .env` or `file_read`)
2. Only replace literal credential values — NEVER revert previously-correct env var values set by prior transformation tasks
3. Preserve all non-credential values as-is

**Detection of cross-task clobber:**
```bash
# After credential sanitisation, verify key values weren't reverted:
grep -E 'SESSION_DRIVER|LOG_CHANNEL|CACHE_DRIVER|QUEUE_CONNECTION' .env
# Expected: values from prior tasks (redis, stack, redis, redis) — not original defaults (file, daily, file, sync)
```

**Prevention pattern:**
```python
# Read current state
content = open('.env').read()
lines = content.splitlines()
new_lines = []
# Only replace lines containing actual credentials
credential_patterns = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN']
for line in lines:
    key = line.split('=')[0] if '=' in line else ''
    if any(p in key.upper() for p in credential_patterns):
        # Replace value with placeholder
        new_lines.append(f"{key}=replace-with-{key.lower()}")
    else:
        new_lines.append(line)  # Preserve existing value
open('.env', 'w').write('\n'.join(new_lines) + '\n')
```

**Rule:** This is a cross-task hygiene rule applicable to ANY task that modifies shared config files. Always read current disk state before writing — never operate on cached or assumed contents.

## Middleware/Handler Fallback Literal Scan

**Purpose:** After clearing credential fields in config modules, detect hardcoded fallback literals in middleware/handler functions that bypass the config module.

**When to run:** After Forms A–F remediation, as part of the source-code credential scan.

**Problem:** Config-module-level remediation (removing defaults from env() or getenv() in config files) is insufficient when middleware or handler functions have their OWN hardcoded fallback literals that bypass the config module entirely.

**Procedure:**
```bash
# Scan application code (not config modules) for hardcoded credential fallbacks
grep -rn "password\|secret\|api_key\|token" src/ app/ lib/ handlers/ middleware/ --include='*.js' --include='*.ts' --include='*.go' --include='*.py' --include='*.php' --include='*.rb' | \
  grep -v 'test\|spec\|mock\|node_modules' | \
  grep -v '^\s*#\|^\s*//' | \
  grep -E "'\S{4,}'|\"[^\"]{4,}\"|`[^`]{4,}`"
```

**What to look for:**
- `|| 'hardcoded-secret'` fallback patterns in handlers
- `default: 'my-api-key'` in middleware config objects
- String literals matching credential patterns in auth middleware

**Rule:** After config-module credential remediation, run this scan on ALL non-config source directories. Any match containing a non-placeholder literal (not `replace-with-*`, not empty string) is a credential exposure requiring the same treatment as Form C (config fallback removal).

## npm_* Environment Variable Exclusion

**Purpose:** Filter npm-injected environment variables from `process.env` grep output during credential and env var audits.

**Problem:** Running `node -e 'console.log(Object.keys(process.env))'` or `grep -rn 'process.env' .` captures npm-injected lifecycle variables that are NOT Kubernetes-relevant env vars:
- `npm_package_version`
- `npm_lifecycle_event`
- `npm_package_name`
- `npm_config_*`

These variables are injected by npm during `npm run` commands and do NOT exist in container runtime.

**Rule:** Exclude ALL `npm_*` prefixed variables from:
1. ENV_VARIABLES.md (do NOT document them)
2. ConfigMap/Secret manifests (do NOT include them)
3. Credential audit results (do NOT flag them)

**Exclusion grep filter:**
```bash
grep -rhoP 'process\.env\.([A-Za-z][A-Za-z0-9_]+)' . --include='*.js' --include='*.ts' | \
  grep -v 'node_modules' | grep -v '^npm_' | sort -u
```

**Also exclude:** `NODE_ENV` (set by container runtime/Dockerfile, not ConfigMap — document but do NOT add to ConfigMap unless explicitly read for feature switching).

## Multi-Profile Credential Scan

**Purpose:** Detect non-empty credential defaults that survive in profile-specific or module-specific configuration files after primary credential externalisation. Workers typically grep only the primary config file (e.g., `application.properties`) and miss credentials in profile variants (`application-dev.properties`), module-specific resources (`module/src/main/resources/application.yml`), and environment-specific files (`config/environments/production.rb`).

**When to run:** After ANY credential externalisation task (Sub-Phase §7, post-batch) on multi-profile or multi-module projects. Also run at Final Review (§19) as a catch-all.

**Preconditions:** At least one credential has been externalised (bare `${VAR}` or `${VAR:-}` form applied).

**Procedure:**

1. **Scan all config files recursively for credential variables with non-empty defaults:**
```bash
grep -rn '\${[A-Z_]*\(KEY\|SECRET\|TOKEN\|PASSWORD\)[A-Z_]*:[^}]*[a-zA-Z0-9]}' \
  --include='*.properties' --include='*.yml' --include='*.yaml' --include='*.xml' \
  --include='*.env' --include='*.rb' --include='*.php' . | grep -v 'node_modules\|vendor\|target/'
```

   **Explanation:** This matches `${VAR_NAME_WITH_CREDENTIAL_KEYWORD:non-empty-default}` across all config file types.

2. **For Spring/Java projects — also scan single-colon defaults (Spring syntax):**
```bash
grep -rn '\${[A-Z_]*\(KEY\|SECRET\|TOKEN\|PASSWORD\)[A-Z_]*:[^-][^}]*}' \
  --include='*.properties' --include='*.yml' --include='*.yaml' . | grep -v 'target/'
```

   This catches `${DB_PASSWORD:mysecret}` (Spring single-colon default syntax).

3. **For Ruby/Rails projects — scan ENV.fetch with fallback:**
```bash
grep -rn "ENV.fetch(['\"][A-Z_]*\(KEY\|SECRET\|TOKEN\|PASSWORD\)" \
  --include='*.rb' . | grep -v 'spec/\|test/'
```

4. **Evaluate each match:**
   - If the default value is a real credential (non-placeholder, non-empty, not `replace-with-*`): **violation** — replace with bare `${VAR}` or `${VAR:-}`.
   - If the default value is already a placeholder (`replace-with-*`): acceptable.
   - If the default is empty string (`:-}`): acceptable.

5. **Fix violations:** Replace non-empty credential defaults with bare `${VAR}` or `${VAR:-}` (see §13 Nounset-Safe Credential Default Removal for choosing between these forms).

**Verification:** Re-run step 1. Zero matches with real (non-placeholder) credential defaults expected.

**Idempotence:** Running the scan on already-clean files returns zero matches and requires no action.

**Classification update:** Any credential field found with `USERNAME` or `USER` in name that serves as an authentication identity (e.g., `SMTP_USERNAME`, `MAIL_USERNAME`) MUST be classified as Secret, not ConfigMap. Authentication identity fields grant access to external services and are secret material.

---

## MIGRATION Comment Authoring Rule

**Purpose:** Prevent MIGRATION comments from re-triggering credential sweep grep assertions by quoting removed literal values.

**Rule:** MIGRATION comments MUST NOT quote removed literal credential values — use generic functional description instead. Quoting the literal re-embeds a formerly-live key and re-triggers grep assertions that check for credential patterns.

**Before (WRONG — re-triggers grep):**
```java
// MIGRATION: Removed hardcoded password "superSecret123" from connection string
```

**After (CORRECT — functional description):**
```java
// MIGRATION: Hardcoded insecure default removed; now sourced from Secret via env var
```

**Rule applies to:** All languages. When describing pre-migration state in code comments, never reproduce the removed literal. Use descriptions like "Hardcoded default removed", "Inline credential externalised", "Literal connection string replaced with env var".

## Form G Recursive-From-Root Mandate

**Rule:** Form G Final Literal Sweep MUST use recursive-from-root grep (`grep -rn` from the project root or `src/main/resources/` equivalent), NEVER named-directory enumeration. Named enumeration silently misses unlisted profiles, modules, and config variants.

**Correct:**
```bash
grep -rn '\${[A-Z_]*(PASSWORD|SECRET|KEY|TOKEN)[A-Z_]*:-[a-zA-Z0-9]' \
  --include='*.properties' --include='*.yml' --include='*.yaml' --include='*.xml' . | \
  grep -v 'node_modules\|vendor\|target/'
```

**Wrong — named directory enumeration misses unlisted profiles:**
```bash
# WRONG: Only checks known directories
grep -n 'PASSWORD' src/main/resources/application.properties src/main/resources/application-dev.properties
# Misses: application-cloud.properties, application-mysql.properties, module-b/src/main/resources/...
```

## Nounset-Safe Credential Default Removal

**Purpose:** When removing hardcoded credential defaults from shell scripts, ensure the replacement form is compatible with the script's error handling mode. Bare `${VAR}` (no default) crashes containers that use `set -u` (nounset), causing CrashLoopBackOff on startup when the variable is unset.

**When to run:** During credential remediation (Sub-Phase §7) — specifically when modifying entrypoint or startup shell scripts. Also applies when modifying any shell script referenced by a Dockerfile CMD or ENTRYPOINT.

**Preconditions:** The script being modified is an entrypoint/startup script that runs in the container at boot time.

**Procedure:**

1. **Detect nounset mode in the target script:**
```bash
grep -E '(set -[aeioux]*u|set -o nounset)' entrypoint*.sh docker-entrypoint*.sh start.sh run.sh 2>/dev/null
```

   Also check the shebang line:
```bash
head -1 entrypoint*.sh docker-entrypoint*.sh start.sh run.sh 2>/dev/null | grep -E '(bash|sh) -[a-z]*u'
```

   If either grep returns a match → nounset is active → use `${VAR:-}` form.

2. **Choose the correct replacement form:**

   | Nounset active? | Correct form | Incorrect form (causes crash) |
   |-----------------|-------------|-------------------------------|
   | Yes (`set -u`) | `${VAR:-}` (empty default) | `${VAR}` (bare — crashes) |
   | No | `${VAR}` (bare) or `${VAR:-}` | Either works |

   **Rule:** When in doubt, always use `${VAR:-}` — it is safe in all contexts.

3. **Apply the transformation:**

   **BEFORE** (hardcoded credential default):
   ```bash
   DB_PASSWORD=${DB_PASSWORD:-superSecretPassword123}
   REDIS_AUTH=${REDIS_AUTH:-myRedisToken}
   ```

   **WRONG** (bare removal — crashes with `set -u`):
   ```bash
   DB_PASSWORD=${DB_PASSWORD}
   REDIS_AUTH=${REDIS_AUTH}
   ```

   **CORRECT** (empty-default removal — safe with `set -u`):
   ```bash
   DB_PASSWORD=${DB_PASSWORD:-}
   REDIS_AUTH=${REDIS_AUTH:-}
   ```

4. **For complex expansion patterns** (`${VAR:+...}` conditional), preserve the expansion operator and only remove the literal:
   ```bash
   # BEFORE:
   EXTRA_OPTS="${DB_PASSWORD:+--password=secretval}"
   # CORRECT:
   EXTRA_OPTS="${DB_PASSWORD:+--password=${DB_PASSWORD:-}}"
   ```

**Verification:**

1. Confirm no hardcoded credential literals remain:
```bash
grep -E '\$\{[A-Z_]*(PASSWORD|SECRET|KEY|TOKEN)[A-Z_]*:-[a-zA-Z0-9]' \
  entrypoint*.sh docker-entrypoint*.sh start.sh run.sh 2>/dev/null
```
   Expected: zero matches (only `:-}` empty defaults should remain).

2. If nounset is active, confirm no bare credential references:
```bash
grep -E '\$\{[A-Z_]*(PASSWORD|SECRET|KEY|TOKEN)[A-Z_]*\}' \
  entrypoint*.sh docker-entrypoint*.sh start.sh run.sh 2>/dev/null | grep -v ':-'
```
   Expected: zero matches (all credential vars use `:-` form).

**Idempotence:** Running the verification on already-fixed scripts returns zero matches and requires no action.

**Rationale:** `set -u` (aka `set -o nounset`) causes bash to exit immediately with "unbound variable" when any unset variable is referenced. In Kubernetes, this manifests as CrashLoopBackOff when a Secret is not yet mounted or when an optional credential env var is deliberately empty (e.g., IRSA mode with empty AWS_ACCESS_KEY_ID). The `${VAR:-}` form provides an empty string default, satisfying nounset while still allowing the Kubernetes Secret to inject the real value.

**Critical CrashLoopBackOff pattern**: If a container enters CrashLoopBackOff immediately after credential externalisation and the entrypoint uses `set -u` or `set -euo pipefail`, the root cause is almost always a bare `${VAR}` reference where `${VAR:-}` is needed. Check entrypoint nounset mode FIRST when debugging post-migration startup failures.

---

## IRSA Empty-String Guard (Cross-Language)

**Purpose:** AWS SDKs require specific handling when IRSA (IAM Roles for Service Accounts) is active — credential env vars must be present but empty, and application code must guard against passing empty strings to SDK constructors.

**Rule:** The Secret MUST declare `AWS_ACCESS_KEY_ID: ""` and `AWS_SECRET_ACCESS_KEY: ""` (empty-string values, not absent keys). SDK-specific guard patterns prevent the empty strings from being passed as explicit credentials, allowing the SDK provider chain to fall through to IRSA.

### Per-Language Guard Patterns

**PHP:**
```php
$key = env('AWS_ACCESS_KEY_ID');
$secret = env('AWS_SECRET_ACCESS_KEY');
if ($key && $secret) {
    $config['credentials'] = ['key' => $key, 'secret' => $secret];
}
```

**Java (AWS SDK v1):**
```java
String accessKey = System.getenv("AWS_ACCESS_KEY_ID");
String secretKey = System.getenv("AWS_SECRET_ACCESS_KEY");
AmazonS3ClientBuilder builder = AmazonS3ClientBuilder.standard()
    .withRegion(System.getenv("AWS_DEFAULT_REGION"));
if (!StringUtils.isBlank(accessKey) && !StringUtils.isBlank(secretKey)) {
    builder.withCredentials(new AWSStaticCredentialsProvider(
        new BasicAWSCredentials(accessKey, secretKey)));
}
// When both blank, builder uses DefaultAWSCredentialsProviderChain (IRSA)
return builder.build();
```

**Java (AWS SDK v2):**
```java
S3ClientBuilder builder = S3Client.builder()
    .region(Region.of(System.getenv("AWS_DEFAULT_REGION")));
String accessKey = System.getenv("AWS_ACCESS_KEY_ID");
String secretKey = System.getenv("AWS_SECRET_ACCESS_KEY");
if (accessKey != null && !accessKey.isBlank() && secretKey != null && !secretKey.isBlank()) {
    builder.credentialsProvider(StaticCredentialsProvider.create(
        AwsBasicCredentials.create(accessKey, secretKey)));
}
return builder.build();
```

**Python:**
```python
import os
access_key = os.getenv("AWS_ACCESS_KEY_ID", "")
secret_key = os.getenv("AWS_SECRET_ACCESS_KEY", "")
kwargs = {"region_name": os.getenv("AWS_DEFAULT_REGION", "us-east-1")}
if access_key and secret_key:
    kwargs["aws_access_key_id"] = access_key
    kwargs["aws_secret_access_key"] = secret_key
# When both empty, boto3 uses default provider chain (IRSA)
client = boto3.client("s3", **kwargs)
```

**Node.js:**
```javascript
const config = { region: process.env.AWS_REGION || 'us-east-1' };
const accessKey = process.env.AWS_ACCESS_KEY_ID || undefined;
const secretKey = process.env.AWS_SECRET_ACCESS_KEY || undefined;
if (accessKey && secretKey) {
    config.credentials = { accessKeyId: accessKey, secretAccessKey: secretKey };
}
const s3 = new S3Client(config);
```

**Go:**
```go
accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")
var opts []func(*config.LoadOptions) error
if accessKey != "" && secretKey != "" {
    opts = append(opts, config.WithCredentialsProvider(
        credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")))
}
cfg, _ := config.LoadDefaultConfig(ctx, opts...)
```

### Critical Rules

1. AWS SDK v1 (Java) `EnvironmentVariableCredentialsProvider` throws on empty-string credentials — do NOT call `builder.withCredentials()` when both keys are blank.
2. The `|| undefined` pattern in Node.js converts empty string to undefined, preventing SDK from treating empty strings as explicit credentials.
3. Python `os.getenv("X", "")` returns empty string (falsy in Python) — the `if access_key and secret_key:` guard prevents passing empty strings to boto3.
4. PHP `env()` with no second argument returns null for unset vars — use `if ($key && $secret)` which rejects both null and empty string.

**Source:** AWS SDK for Java 1.x EnvironmentVariableCredentialsProvider loads credentials from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables — https://docs.aws.amazon.com/AWSJavaSDK/latest/javadoc/com/amazonaws/auth/EnvironmentVariableCredentialsProvider.html

---

## SSL Suffix Classification Rule

**Purpose:** Classify variables with SSL-related suffixes correctly as Secret or ConfigMap.

| Suffix | Content Type | Classification | Rationale |
|--------|-------------|---------------|-----------|
| `_KEY` (when SSL context) | Private key PEM | Secret | Private key material |
| `_CERT` | Client certificate | Secret | Authentication material |
| `_CA` / `_CA_CERT` | CA certificate (public) | ConfigMap | Public trust anchor |
| `_KEYSTORE_PASSWORD` | Keystore unlock | Secret | Credential |
| `_TRUSTSTORE_PATH` | File path | ConfigMap | Non-secret path |

**Detection:**
```bash
grep -rn '_KEY\|_CERT\|_CA\|_SSL\|_TLS' ENV_VARIABLES.md | grep -i 'ConfigMap' | grep -ivE '_CA[^_]|_CA$'
# Any _KEY or _CERT match classified as ConfigMap = potential misclassification
```

**Rule:** When variable names end in `_KEY` and the context is SSL/TLS (determined by adjacent `_CERT` or `_CA` variables, or by the variable description mentioning PEM/certificate), classify as Secret. The generic `_KEY` suffix heuristic (which triggers credential scan) is CORRECT for SSL keys — they are private material.

---

## Colon-Delimited Connection String Classification

**Purpose:** Variables whose values use colon-delimited or URL-format connection strings that can embed credentials must be classified as Secret.

**Covered patterns:**
- `HOST:PORT:DB:USER:PASSWORD` (PostgreSQL `.pgpass` format)
- `redis://[:password@]host:port/db`
- `amqp://user:pass@host:port/vhost`
- Semicolon-delimited: `Server=host;Database=db;User=u;Password=p`

**Variables that ALWAYS require Secret classification (regardless of current value):**

| Variable Pattern | Reason |
|-----------------|--------|
| `REDIS_SERVERS`, `REDIS_URL` | Can embed `:password@` |
| `DATABASE_URL`, `DB_URL` | Can embed `user:password@` |
| `MONGO_URI`, `MONGODB_URL` | Can embed credentials |
| `RABBITMQ_URL`, `AMQP_URL` | Can embed `user:pass@` |
| `CELERY_BROKER_URL` | Wraps AMQP/Redis URL |
| `*_CONNECTION_STRING` | Semicolon format embeds Password= |

**Detection:**
```bash
grep -iE '(REDIS_SERVERS|DATABASE_URL|DB_URL|MONGO_URI|MONGODB_URL|RABBITMQ_URL|AMQP_URL|CELERY_BROKER_URL|_CONNECTION_STRING)' ENV_VARIABLES.md | grep -i 'ConfigMap'
# Any match = misclassification — must be Secret
```

**Rule:** Any variable whose value CAN embed credentials in production (even if the current dev value does not) MUST be classified as Secret. This supersedes name-based heuristics that might place these in ConfigMap.

---

## DB Root/Admin Credential Scope Exclusion

**Purpose:** Database root/admin credentials (used for database initialisation, backup, schema creation) MUST NOT appear in the application pod's `envFrom` Secret. They belong in a separate Secret consumed only by the database service or migration Job.

**Rule:** When `DB_ROOT_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `POSTGRES_SUPERUSER_PASSWORD`, or similar admin-level credentials are discovered:
1. Classify as Secret (correct)
2. Place in a SEPARATE Secret manifest (e.g., `db-admin-secret.yaml`)
3. Reference ONLY from database StatefulSet/Deployment or migration Job — NOT from the application Deployment's `envFrom`
4. Document separation in ENV_VARIABLES.md with note: "Admin-only — not consumed by application pods"

---

## Compound Shebang Nounset Detection

**Purpose:** Standard nounset detection (`grep -E 'set -[aeioux]*u'`) misses compound shebang flags like `#!/bin/bash -aeu` where nounset (`u`) is embedded in the shebang line flags.

**Two-step detection procedure (BOTH steps REQUIRED):**

```bash
# Step 1: Body check — catches set -u, set -eu, set -euo pipefail, set -o nounset
grep -E '(set -[aeioux]*u|set -o nounset)' entrypoint*.sh docker-entrypoint*.sh start.sh run.sh 2>/dev/null

# Step 2: Shebang check — catches #!/bin/bash -aeu, #!/bin/bash -eu, etc.
head -1 entrypoint*.sh docker-entrypoint*.sh start.sh run.sh 2>/dev/null | grep -E '(bash|sh) -[a-z]*u'
```

**Rule:** If EITHER step matches, all credential vars in that script must use `${VAR:-}` form (not bare `${VAR}`). The shebang `-aeu` flag activates nounset for the entire script without any `set` command in the body.

## Placeholder String IRSA Block

**Purpose:** Detect literal placeholder strings used as `env()`/`getenv()`/`System.getenv()` fallback arguments that prevent AWS/GCP SDK default credential provider chains from activating. When a non-empty literal (e.g., `your-key`, `YOUR_KEY`, `placeholder`, `changeme`) is passed as the fallback, the SDK receives that literal as a credential value and never falls through to IRSA/Workload Identity.

**Detection:**
```bash
# Scan for common placeholder patterns as fallback arguments
grep -rnE "(getenv|env|System\.getenv)\(['\"][A-Z_]*(KEY|SECRET|TOKEN)['\"],?\s*['\"]*(your-|YOUR_|placeholder|changeme|replace)" \
  . --include='*.php' --include='*.java' --include='*.py' --include='*.js' --include='*.go' | grep -v 'vendor\|node_modules\|target/'
```

**Examples of IRSA-blocking placeholders:**
```php
// WRONG — literal placeholder blocks IRSA provider chain:
$key = env('AWS_ACCESS_KEY_ID', 'your-access-key-id');
$secret = env('AWS_SECRET_ACCESS_KEY', 'your-secret-access-key');

// CORRECT — null/empty allows IRSA fallback:
$key = env('AWS_ACCESS_KEY_ID');
$secret = env('AWS_SECRET_ACCESS_KEY');
```

**Rule:** Any `env()`/`getenv()`/`System.getenv()` call for AWS/GCP credential fields that passes a non-empty literal string as the default value is an IRSA blocker. Replace with null/empty-string default (see per-language IRSA guard patterns in §IRSA Empty-String Guard).
