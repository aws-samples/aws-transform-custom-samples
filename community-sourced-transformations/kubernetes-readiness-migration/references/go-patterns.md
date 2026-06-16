# Go Patterns Reference

Go-specific operations for Kubernetes containerisation transformation. Applies when `go.mod` is present.

## Table of Contents

0. [Sandbox Go Bootstrap](#sandbox-go-bootstrap)
1. [go mod tidy Workflow](#go-mod-tidy-workflow)
2. [go.sum Hash Retrieval](#gosum-hash-retrieval)
3. [go vet vs go build](#go-vet-vs-go-build)
4. [viper.AutomaticEnv() Detection](#viper-automaticenv-detection)
5. [viper.SetEnvKeyReplacer Ordering](#viper-setenvkeyreplacer-ordering)
6. [Viper Test Isolation](#viper-test-isolation)
7. [Typed Env Helpers and Three-Pass Grep](#typed-env-helpers-and-three-pass-grep)
8. [Digit-Inclusive Regex for Env Var Names](#digit-inclusive-regex)
9. [aws-sdk-go v1 Type Traps](#aws-sdk-go-v1-type-traps)
10. [Middleware Factory Closures](#middleware-factory-closures)
11. [Credential Sweep Locations](#credential-sweep-locations)
12. [gRPC Health Probes](#grpc-health-probes)
13. [Fiber Logger Output Nil-Panic](#fiber-logger-output-nil-panic)
14. [Go Runtime Env Vars](#go-runtime-env-vars)
15. [S3 Mock Testing with httptest](#s3-mock-testing-with-httptest)
16. [go mod tidy Timing](#go-mod-tidy-timing)
17. [Code Removal Import Audit](#code-removal-import-audit)
18. [IRSA Empty-String Guard](#irsa-empty-string-guard)
19. [Route-Group-to-Bounded-Context Algorithm](#route-group-to-bounded-context-algorithm)
20. [Config Struct Domain Split](#config-struct-domain-split)
21. [Inline DB Migration → Job Extraction](#inline-db-migration-job-extraction)
22. [Viper AutomaticEnv Key-to-ConfigMap Alignment](#viper-automaticenv-key-to-configmap-alignment)
23. [Test-File Scoping for Removals](#test-file-scoping-for-removals)
24. [Gin/Chi/Fiber Health Probe Ordering](#ginchifiber-health-probe-ordering)


## Pre-Docker Local Validation

**Purpose:** Verify Go source compiles, passes vet, and basic tests run — all BEFORE `docker build`. This consolidates the existing Sandbox Go Bootstrap into a formal validation gate.

### Commands
```bash
# 1. Vet all packages (includes test files)
go vet ./...
# Expected: exit 0

# 2. Build all packages (production code only)
go build ./...
# Expected: exit 0

# 3. Unit tests (short mode, excludes long-running/integration)
go test ./... -short -count=1 2>&1
# Exit 0 = PASS; infrastructure failures = CONDITIONAL PASS

# 4. Verify binary at expected path (if applicable)
ls <expected-binary-path> 2>/dev/null || go build -o /tmp/app-binary ./cmd/...
```

### Expected Output
- Step 1: No output (exit 0 = all clean)
- Step 2: Exit 0
- Step 3: Exit 0 or infrastructure-only failures
- Step 4: Binary exists

### CONDITIONAL PASS Triggers
- `go` not installed and `mise install go` fails → CONDITIONAL PASS
- Go version mismatch (go.mod directive > host version) → CONDITIONAL PASS
- `go mod download` network failure (after 1 retry) → CONDITIONAL PASS

### Toolchain Bootstrap
See §Sandbox Go Bootstrap (above) and §Mise/asdf Toolchain Bootstrap for the full procedure.

### Validated Example Repositories
- NOT YET VALIDATED AGAINST REAL REPO — commands inferred from Go documentation and existing §Sandbox Go Bootstrap. Mark as validated when a Go project passes through the pipeline.


## Sandbox Go Bootstrap

```bash
# Step 1: Check if go is available
go version
# Step 2: If absent — try system path
export PATH=$PATH:/usr/local/go/bin && go version
# Step 3: Try mise shims
mise install golang && mise use go@latest && export PATH=$HOME/.local/share/mise/shims:$PATH
# Step 4: Install from go.dev (match go.mod directive)
GO_VERSION=1.22.4
curl -sL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar xz -C /usr/local
export PATH=$PATH:/usr/local/go/bin
```

If all steps fail, fall back to structural analysis only.

## go mod tidy Workflow

When removing a library:
1. Remove the `require` directive (direct dependency line only)
2. Run `go mod tidy` — removes transitive deps and updates `go.sum`
3. Never manually edit transitive dependency lines
4. If `go mod tidy` fails with "missing go.sum entry", run `go mod download` first

## go.sum Hash Retrieval

When Go toolchain is unavailable:
```bash
curl -s "https://sum.golang.org/lookup/<module>@<version>"
```

## go vet vs go build

| Command | Compiles _test.go? | Use When |
|---------|-------------------|----------|
| `go build ./...` | No | Verify production code |
| `go vet ./...` | Yes | Verify ALL code including tests |

## viper.AutomaticEnv() Detection

**If `AutomaticEnv()` IS present**: every config key is overridable via env var. Factor 3 compatible.

**If NOT present**: Factor 3 Blocker — must add `AutomaticEnv()` or explicit `BindEnv` calls.

```bash
grep -rn 'AutomaticEnv\|BindEnv' .
```

## viper.SetEnvKeyReplacer Ordering

Replacer MUST be set BEFORE `AutomaticEnv()` AND BEFORE `ReadInConfig()`:
```go
// CORRECT ORDER:
viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_", "-", "_"))
viper.AutomaticEnv()
viper.ReadInConfig()  // Must be AFTER AutomaticEnv + Replacer
```

Env var derivation: `section.sub-key` → `SECTION_SUB_KEY`.

**Common trap**: If `ReadInConfig()` is called before `AutomaticEnv()`, config-file values take precedence and env vars are ignored for those keys.

## Viper Test Isolation

Tests that modify viper global state MUST use `viper.Reset()` + `t.Cleanup`:

```go
func TestConfig(t *testing.T) {
    viper.Reset()
    t.Cleanup(func() { viper.Reset() })
    
    t.Setenv("DATABASE_HOST", "testhost")
    viper.AutomaticEnv()
    
    assert.Equal(t, "testhost", viper.GetString("DATABASE_HOST"))
}
```

**Rule**: Never rely on viper global state persisting between tests. Always reset before and cleanup after. `t.Setenv` marks test as `t.Parallel()`-incompatible — no manual cleanup needed for env vars.

## Typed Env Helpers and Three-Pass Grep

```go
func getEnvInt64OrDefault(key string, defaultVal int64) int64 {
    val := os.Getenv(key)
    if val == "" { return defaultVal }
    parsed, err := strconv.ParseInt(val, 10, 64)
    if err != nil { return defaultVal }
    return parsed
}
```

**Three-pass env var enumeration** — standard `os.Getenv` grep misses custom helpers and Viper keys:

```bash
# Pass 1: Standard os.Getenv
grep -rhoP 'os\.Getenv\("([A-Za-z][A-Za-z0-9_]+)"\)' . --include='*.go' | sort -u

# Pass 2: Custom helpers (getEnv, GetEnvOrDefault, envOr, etc.)
grep -rn 'getEnv\|GetEnv\|envOr\|EnvOr\|MustGetEnv' . --include='*.go' | grep -v '_test.go'

# Pass 3: Viper Get* calls — derive env var name via replacer rules
grep -rhoP 'viper\.Get\w+\("([^"]+)"\)' . --include='*.go' | \
  grep -oP '"[^"]+"' | tr -d '"' | \
  sed 's/[.-]/_/g' | tr '[:lower:]' '[:upper:]' | sort -u
```

**Pass 3 explanation**: When `viper.AutomaticEnv()` + `SetEnvKeyReplacer(strings.NewReplacer(".", "_", "-", "_"))` is active, every `viper.GetString("database.host")` call resolves to env var `DATABASE_HOST`. Pass 3 applies the replacer rules to viper keys to derive the expected env var names.

**Rule**: When enumerating env vars for ENV_VARIABLES.md in Go/Viper projects, always run ALL THREE passes. Custom helpers (Pass 2) and Viper keys (Pass 3) are invisible to Pass 1 alone.

## Digit-Inclusive Regex

When extracting env var names from Go source, the regex MUST be `[A-Za-z][A-Za-z0-9_]+` (digit-inclusive):

```bash
# CORRECT: catches S3_BUCKET_V2, PORT_8080, AWS_S3_BUCKET
grep -rhoP '[A-Za-z][A-Za-z0-9_]+' ...

# WRONG: misses vars with digits
grep -rhoP '[A-Z][A-Z_]+' ...
```

This applies to ALL language patterns, not just Go.

## aws-sdk-go v1 Type Traps

- `s3.PutObjectInput.Body` is `io.ReadSeeker` — `bytes.Buffer` does NOT satisfy. Use `bytes.NewReader(data)`.
- `*string`/`*int64` wrappers: use `aws.String()`, `aws.Int64()`.

## Middleware Factory Closures

```go
func AuthMiddleware(secret string) func(http.Handler) http.Handler {
    if secret == "" { panic("AUTH_SECRET must not be empty") }
    return func(next http.Handler) http.Handler { /* ... */ }
}
```

**Migration impact**: Startup-time validation in outer function fails if env var empty — correct behaviour for required config.

## Credential Sweep Locations

```bash
# (1) Config files
grep -rn 'password\|secret\|token\|apikey' . --include='*.yaml' --include='*.toml' --include='*.json'
# (2) Hardcoded string constants
grep -rn '".*password.*"\|".*secret.*"' . --include='*.go' | grep -v '_test.go'
# (3) viper.SetDefault with credentials (CRITICAL)
grep -rn 'SetDefault.*password\|SetDefault.*secret\|SetDefault.*token' . --include='*.go'
```

**Critical**: `viper.SetDefault("database.password", "secret123")` executes on every pod start if config file is missing — expected state in containers.

## gRPC Health Probes

**Dockerfile addition**:
```dockerfile
FROM golang:1.22 AS health-probe
RUN GOBIN=/out go install github.com/grpc-ecosystem/grpc-health-probe@latest

FROM <base>
COPY --from=health-probe /out/grpc_health_probe /usr/local/bin/
```

**Probe config**:
```yaml
livenessProbe:
  exec:
    command: ["grpc_health_probe", "-addr=:50051"]
```

**Pre-requisite**: gRPC server MUST register health service. Verify:
```bash
grep -rn 'RegisterHealthServer\|health\.NewServer' . --include='*.go'
```
If absent, add `health.RegisterHealthServer(grpcServer, health.NewServer())` — probes will fail without this.

## Fiber Logger Output Nil-Panic

Fiber's `logger.New()` panics if `Output` is explicitly set to `nil`:

```go
// BAD: panics at runtime
app.Use(logger.New(logger.Config{
    Output: nil,
}))

// GOOD: omit Output field (defaults to os.Stdout)
app.Use(logger.New(logger.Config{
    Format: "[${time}] ${status} - ${method} ${path}\n",
}))

// GOOD: explicit os.Stdout
app.Use(logger.New(logger.Config{
    Output: os.Stdout,
}))
```

**Detection**: `grep -rn 'logger\.New\|logger\.Config' . --include='*.go'`

## Go Runtime Env Vars

These env vars are consumed by the Go runtime itself and MUST be excluded from orphan-key checks in Criterion 10(C):

- `GOMAXPROCS`, `GOMEMLIMIT`, `GOGC`, `GODEBUG`
- `GOPATH`, `GOROOT`, `GOPROXY`, `GONOSUMCHECK`

**Criterion 10 rules**:
- **10(A)**: GOMEMLIMIT/GOMAXPROCS MUST have ConfigMap entries when set for container tuning.
- **10(C)**: Do NOT flag these as "orphaned ConfigMap keys" — consumed by Go runtime, invisible to `os.Getenv()` grep. Only the orphan check (C) is waived.

**Standard ConfigMap additions for Go projects**:
```yaml
data:
  GOMAXPROCS: "2"
  GOMEMLIMIT: "400MiB"
```

**Rule**: Do NOT flag these as "orphaned ConfigMap keys". They are consumed by the Go runtime, not by `os.Getenv()` calls in application code. They belong in ConfigMap IF explicitly set for container tuning.

## S3 Mock Testing with httptest

For unit tests that exercise S3 client code without network:

```go
func TestS3Upload(t *testing.T) {
    // Create fake S3 endpoint
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    }))
    defer server.Close()

    // Configure AWS SDK to use test server
    cfg, _ := config.LoadDefaultConfig(context.TODO(),
        config.WithEndpointResolverWithOptions(
            aws.EndpointResolverWithOptionsFunc(func(service, region string, opts ...interface{}) (aws.Endpoint, error) {
                return aws.Endpoint{URL: server.URL, SigningRegion: "us-east-1"}, nil
            }),
        ),
        config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("test", "test", "")),
    )
    client := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })
    // ... test with client
}
```

## go mod tidy Timing

**Critical ordering**: `go mod tidy` modifies the `go` directive in `go.mod` if dependencies require a newer Go version. This can break reproducible builds.

```bash
# SAFE sequence:
go get <new-dependency>
go mod tidy
go build ./...  # Verify after tidy

# DANGER: go get can bump the go directive
# Always check: git diff go.mod | grep '^+go '
```

**Rule**: Run `go mod tidy` AFTER all dependency additions/removals, but BEFORE `go build`. If `go mod tidy` bumps the `go` directive, verify the CI/CD toolchain supports that version.

## Code Removal Import Audit

```bash
# Verify no remaining usages before removing import
grep -rn '<package_alias>\.' . --include='*.go' | grep -v '^\s*//'
```

**Rule**: NEVER remove an import without confirming zero non-comment usages remain.

## IRSA Empty-String Guard

`viper.GetString()` returns `""` for unset keys, but passing `""` to AWS SDK does NOT fall through to IRSA:

```go
// BAD: empty string prevents IRSA fallback
accessKey := viper.GetString("aws.access_key_id")
cfg, _ := config.LoadDefaultConfig(ctx,
    config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
)

// GOOD: guard with non-empty check
accessKey := viper.GetString("aws.access_key_id")
secretKey := viper.GetString("aws.secret_access_key")
var opts []func(*config.LoadOptions) error
if accessKey != "" && secretKey != "" {
    opts = append(opts, config.WithCredentialsProvider(
        credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
    ))
}
cfg, _ := config.LoadDefaultConfig(ctx, opts...)
```

**Detection:**
```bash
grep -rn 'GetString.*access_key\|GetString.*secret_key\|NewStaticCredentials' . --include='*.go'
```

## Route-Group-to-Bounded-Context Algorithm

For Go HTTP projects using routers (gin, fiber, chi, mux), identify decomposition candidates by route groups:

**Step 1: Extract route registrations**
```bash
# Gin
grep -rn '\.GET\|\.POST\|\.PUT\|\.DELETE\|\.Group(' . --include='*.go' | grep -v '_test.go'
# Chi
grep -rn 'r\.Route\|r\.Get\|r\.Post\|r\.Mount(' . --include='*.go'
# Fiber
grep -rn 'app\.Get\|app\.Post\|app\.Group(' . --include='*.go'
```

**Step 2: Group by URL prefix**
Each `router.Group("/api/uploads")` or `r.Mount("/api/orders", ...)` is a bounded context.

**Step 3: Map groups to service candidates**
Each route group with ≥3 endpoints AND its own data model = decomposition candidate. Groups that only proxy to a shared handler are NOT independent candidates.

## Config Struct Domain Split

Go projects often have a single monolithic `Config` struct. For decomposition, split by domain:

**Before (monolith):**
```go
type Config struct {
    DBHost    string `mapstructure:"database.host"`
    S3Bucket  string `mapstructure:"s3.bucket"`
    SMTPHost  string `mapstructure:"smtp.host"`
}
```

**After (domain-split):**
```go
type DatabaseConfig struct { Host string `mapstructure:"database.host"` }
type StorageConfig struct { S3Bucket string `mapstructure:"s3.bucket"` }
type NotificationConfig struct { SMTPHost string `mapstructure:"smtp.host"` }
```

**Impact on ENV_VARIABLES.md:** Each domain config maps to a K8s Scope classification.

## Inline DB Migration → Job Extraction

Go projects often run DB migrations inline at startup:

```go
// BEFORE: blocks startup, runs on EVERY pod start
func main() {
    db := connectDB()
    migrate.Up(db, "migrations/")
    startHTTPServer()
}
```

**Extract to Kubernetes Job:**
```go
// cmd/migrate/main.go
func main() {
    db := connectDB()
    if err := migrate.Up(db, "migrations/"); err != nil { log.Fatal(err) }
}
```

**Rule:** DB migrations that run DDL MUST be extracted to a Job.

## Viper AutomaticEnv Key-to-ConfigMap Alignment

When viper uses `AutomaticEnv()` with a key replacer, ConfigMap keys must match the env var name that viper expects:

```go
viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_", "-", "_"))
viper.AutomaticEnv()
// Config key "database.host" → env var "DATABASE_HOST"
// Config key "redis-url" → env var "REDIS_URL"
```

**Alignment gate**: For every viper config key used in the application, compute the expected env var name using the replacer rules, then verify that exact key exists in the ConfigMap. Mismatches cause silent fallback to config-file or zero values.

```bash
# Find all viper.Get* calls and extract keys
grep -rhoP 'viper\.Get\w+\("([^"]+)"\)' . --include='*.go' | \
  sed 's/[.-]/_/g' | tr '[:lower:]' '[:upper:]' | sort -u > /tmp/viper_expected.txt
# Compare against ConfigMap keys
python3 -c "import yaml; d=yaml.safe_load(open('kubernetes/configmap.yaml')); [print(k) for k in sorted(d.get('data',{}).keys())]" > /tmp/cm_keys.txt
comm -23 /tmp/viper_expected.txt /tmp/cm_keys.txt
```

## Test-File Scoping for Removals

Before finalising any task that removes a struct field, type, or method:
```bash
grep -rn '<Name>' . --include='*_test.go'
```
If matches found, include those test files in the same task scope. Leaving `_test.go` with undefined references breaks `go vet ./...` across task boundaries.

## Gin/Chi/Fiber Health Probe Ordering

**Problem:** In Go HTTP frameworks, middleware registered with `router.Use()` applies only to routes registered AFTER the `Use()` call. Health/readiness probe endpoints registered AFTER global auth middleware receive 401/403 from K8s liveness/readiness checks, blocking pod readiness.

**Rule:** Health probe routes MUST be registered BEFORE any global auth middleware.

**Gin — CORRECT ordering:**
```go
router := gin.New()

// 1. Register health probes FIRST (no auth)
router.GET("/healthz", healthHandler)
router.GET("/readyz", readyHandler)

// 2. THEN apply auth middleware
router.Use(authMiddleware())

// 3. Register protected routes
api := router.Group("/api")
api.GET("/users", usersHandler)
```

**Gin — WRONG (probes receive 401):**
```go
router := gin.New()
router.Use(authMiddleware())     // Auth applied globally first
router.GET("/healthz", healthHandler) // Probe is AFTER auth — gets 401!
```

**Chi:**
```go
r := chi.NewRouter()
// Health routes BEFORE middleware stack
r.Get("/healthz", healthHandler)
r.Group(func(r chi.Router) {
    r.Use(authMiddleware)
    r.Get("/api/users", usersHandler)
})
```

**Fiber:**
```go
app := fiber.New()
app.Get("/healthz", healthHandler)  // Before Use()
app.Use(authMiddleware)
app.Get("/api/users", usersHandler)
```

**Detection:**
```bash
# Find where health routes are registered relative to Use() calls
grep -n '\.Use\|healthz\|readyz\|/health' . --include='*.go' -r | sort -t: -k2 -n
# If Use(auth...) line number < health route line number → potential issue
```

**Source:** Gin middleware applies only to subsequently registered routes (https://medium.techkoalainsights.com/5-advanced-gin-middleware-chaining-patterns-most-developers-get-wrong-performance-tips-and-eee719306a68).

## Mise/asdf Toolchain Bootstrap

**Trigger:** Go project with `.tool-versions` or `.mise.toml` in repo root.

**Problem:** The Go binary may not be available in PATH until mise/asdf activates the correct version. Build/test/vet commands fail with "go: command not found".

**Bootstrap procedure:**
```bash
# Check for mise config
if [ -f .tool-versions ] || [ -f .mise.toml ]; then
  mise install golang 2>/dev/null || mise install go 2>/dev/null
  export PATH=$HOME/.local/share/mise/shims:$PATH
fi
go version  # Verify
```

**Rule:** Before ANY `go build`, `go vet`, or `go test` command, check for mise/asdf config and activate. This applies to both Sub-Phase §17 (Dockerfile) and Sub-Phase §13 (test verification).

## Post-Externalisation Test Sync (Go)

**Trigger:** After adding `os.Getenv()` calls for configuration that previously had hardcoded values.

**Problem:** Go tests using `os.Getenv()` return empty string when the var isn't set in the test environment, causing test failures or unexpected behaviour.

**Fix — set env in test setup:**
```go
func TestMain(m *testing.M) {
    os.Setenv("DB_HOST", "localhost")
    os.Setenv("DB_PORT", "5432")
    code := m.Run()
    os.Exit(code)
}
```

**Rule:** After externalising any config to env var reads, verify test suite still passes. If tests fail due to empty env vars, add `os.Setenv()` in `TestMain` or test fixtures.

## IRSA-Scope-Only Service Category

**Trigger:** Go services that ONLY use AWS SDK (no HTTP endpoint, no database — pure S3/SQS worker).

**Problem:** For services that only interact with AWS and have no other backing services, the manifest requirements are minimal: ServiceAccount with IRSA annotation, no Redis/DB egress needed.

**Rule:** When a Go service's only external dependency is AWS (detected by `grep -rn 'aws-sdk-go' go.mod`), generate:
- ServiceAccount with `eks.amazonaws.com/role-arn` annotation
- NetworkPolicy with DNS + HTTPS (443) egress only
- No Redis/DB egress rules
- ConfigMap with AWS_DEFAULT_REGION only (credentials via IRSA)

