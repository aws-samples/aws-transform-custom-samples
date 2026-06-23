# C#/.NET Patterns Reference

C# and .NET-specific containerisation gotchas for Phase 2 transformation. Applies when `.csproj` or `.sln` is present.

## Table of Contents

1. [Environment Variable Enumeration](#environment-variable-enumeration)
2. [IConfiguration Bridge Pattern](#iconfiguration-bridge-pattern)
3. [AWSSDK.S3 DI with IRSA](#awssdk-s3-di-with-irsa)
4. [appsettings.json Env Var Override](#appsettingsjson-env-var-override)
5. [Non-Root Dockerfile](#non-root-dockerfile)
6. [Kestrel Port Configuration](#kestrel-port-configuration)
7. [Health Check Registration](#health-check-registration)
8. [EF Core efbundle Migration Job](#ef-core-efbundle-migration-job)
9. [SignalR Redis Backplane](#signalr-redis-backplane)
10. [CRONJOB_MODE Toggle Pattern](#cronjob-mode-toggle-pattern)
11. [Startup-Eager ConnectionMultiplexer](#startup-eager-connectionmultiplexer)


## Pre-Docker Local Validation

**Purpose:** Verify .NET source compiles, tests pass, and the application publishes — all BEFORE `docker build`.

### Commands
```bash
# 1. Restore + Build (excludes test projects)
dotnet build --no-restore -c Release 2>&1 || dotnet build -c Release 2>&1
# Expected: exit 0

# 2. Unit tests (exclude integration)
dotnet test --filter "Category!=Integration&Category!=Database" --no-build 2>&1
# Expected: exit 0 or no test projects found

# 3. Publish (verify artifact)
dotnet publish -c Release -o /tmp/dotnet-publish 2>&1
# Expected: exit 0 with DLL in output dir
```

### Expected Output
- Step 1: "Build succeeded" + exit 0
- Step 2: Exit 0 (tests pass) or "No test projects found"
- Step 3: Exit 0 with published output

### CONDITIONAL PASS Triggers
- `dotnet` not installed and `mise install dotnet` fails → CONDITIONAL PASS
- SDK version mismatch (global.json requires X, host has Y) → CONDITIONAL PASS
- NuGet restore failure (network timeout after 1 retry) → CONDITIONAL PASS

### Toolchain Bootstrap
```bash
# Check .NET availability
command -v dotnet && dotnet --version
# If absent, try mise
command -v mise && mise install dotnet 2>/dev/null
export DOTNET_ROOT=$HOME/.local/share/mise/installs/dotnet/$(ls $HOME/.local/share/mise/installs/dotnet/ 2>/dev/null | sort -V | tail -1)
export PATH=$DOTNET_ROOT:$PATH
dotnet --version
```

### Validated Example Repositories
- NOT YET VALIDATED AGAINST REAL REPO — commands inferred from .NET documentation. Mark as validated when a .NET project passes through the pipeline.


## Environment Variable Enumeration

### Toolchain Bootstrap Fallback (.NET / mise)

When `dotnet` is absent from PATH after `mise install`:
```bash
export DOTNET_ROOT=$HOME/.local/share/mise/installs/dotnet/$(ls $HOME/.local/share/mise/installs/dotnet/ 2>/dev/null | sort -V | tail -1)
export PATH=$DOTNET_ROOT:$PATH
dotnet --version  # Verify
```

**Rule:** After `mise install` or `mise use`, always export `DOTNET_ROOT` and prepend it to `PATH`. Without this, `dotnet` commands resolve to the wrong SDK or fail silently.

```bash
# Primary: GetEnvironmentVariable calls
grep -rhoP 'GetEnvironmentVariable\("([A-Za-z][A-Za-z0-9_]+)"\)' . --include='*.cs' | sort -u

# Secondary: IConfiguration indexer access
grep -rhoP 'Configuration\["([A-Za-z][A-Za-z0-9_:]+)"\]' . --include='*.cs' | sort -u

# Tertiary: appsettings.json keys (these become env vars via __ separator)
python3 -c "
import json
def flatten(obj, prefix=''):
    for k,v in obj.items():
        key = f'{prefix}__{k}' if prefix else k
        if isinstance(v, dict): yield from flatten(v, key)
        else: yield key
d = json.load(open('appsettings.json'))
for k in sorted(flatten(d)): print(k)
"
```

**Convention**: .NET maps `Section:Key` in appsettings to env var `Section__Key` (double underscore). Both forms resolve to the same IConfiguration key.

## IConfiguration Bridge Pattern

```csharp
// Program.cs / Startup.cs
builder.Configuration
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables();  // MUST be last — highest priority

// Service DI
builder.Services.Configure<DatabaseOptions>(
    builder.Configuration.GetSection("Database"));
```

**Rule**: `AddEnvironmentVariables()` MUST be the last configuration source. Environment variables override all JSON/XML config files. Without this call, env vars are ignored entirely.

## AWSSDK.S3 DI with IRSA

```csharp
// IRSA-compatible S3 client registration
builder.Services.AddSingleton<IAmazonS3>(sp =>
{
    var accessKey = Environment.GetEnvironmentVariable("AWS_ACCESS_KEY_ID") ?? "";
    var secretKey = Environment.GetEnvironmentVariable("AWS_SECRET_ACCESS_KEY") ?? "";

    var config = new AmazonS3Config
    {
        RegionEndpoint = RegionEndpoint.GetBySystemName(
            Environment.GetEnvironmentVariable("AWS_REGION") ?? "us-east-1")
    };

    if (!string.IsNullOrEmpty(accessKey) && !string.IsNullOrEmpty(secretKey))
    {
        return new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), config);
    }
    // Falls through to IRSA/instance profile when keys are empty
    return new AmazonS3Client(config);
});
```

**Detection**: `grep -rn 'AWSSDK\|AmazonS3\|IAmazonS3' . --include='*.cs' --include='*.csproj'`

## appsettings.json Env Var Override

.NET Core maps hierarchical JSON keys to environment variables with `__` separator:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost;..."
  },
  "Logging": {
    "LogLevel": { "Default": "Information" }
  }
}
```

**Env var overrides:**
```yaml
# ConfigMap
ConnectionStrings__DefaultConnection: ""
Logging__LogLevel__Default: "Warning"
```

**Rule**: Every appsettings.json value that differs between environments MUST have a corresponding ConfigMap/Secret entry using `__` notation.

## Non-Root Dockerfile

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
WORKDIR /app
COPY --from=build /app/publish .
USER appuser
ENTRYPOINT ["dotnet", "MyApp.dll"]
```

**Alpine variant** (mcr.microsoft.com/dotnet/aspnet:8.0-alpine):
```dockerfile
RUN addgroup -S appgroup && adduser -S -G appgroup appuser
```

**Kubernetes manifest**: `runAsUser: 65534, runAsGroup: 65534` (or match UID/GID from Dockerfile). Full container securityContext:
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 65534
  runAsGroup: 65534
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
```

## Kestrel Port Configuration

```csharp
// Program.cs
builder.WebHost.ConfigureKestrel(opts =>
{
    var port = int.Parse(Environment.GetEnvironmentVariable("PORT") ?? "8080");
    opts.ListenAnyIP(port);
});
```

**Alternative — ASPNETCORE_URLS env var:**
```yaml
# ConfigMap
ASPNETCORE_URLS: "http://+:8080"
```

**Rule**: Use `ASPNETCORE_URLS` (preferred) or explicit Kestrel configuration. Default port 5000/5001 (HTTP/HTTPS) requires TLS certificates — switch to plain HTTP behind reverse proxy in Kubernetes.

## Health Check Registration

```csharp
// Program.cs
builder.Services.AddHealthChecks()
    .AddNpgSql(builder.Configuration.GetConnectionString("DefaultConnection")!)
    .AddRedis(builder.Configuration["Redis:ConnectionString"]!);

app.MapHealthChecks("/healthz");
app.MapHealthChecks("/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
});
```

**Probe mapping:**
```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
readinessProbe:
  httpGet: { path: /ready, port: 8080 }
```

## EF Core efbundle Migration Job

**Trigger:** Entity Framework Core migrations that must run before application startup.

**Problem:** Running `dotnet ef database update` requires the .NET SDK in production. `efbundle` creates a standalone executable.

**Build-time bundle generation:**
```bash
dotnet ef migrations bundle --self-contained -r linux-x64 -o efbundle
```

**Kubernetes Job manifest:**
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
spec:
  template:
    spec:
      containers:
      - name: migrate
        image: app-image:latest
        command: ["./efbundle", "--connection", "$(ConnectionStrings__DefaultConnection)"]
        env:
        - name: ConnectionStrings__DefaultConnection
          valueFrom:
            secretKeyRef:
              name: app-secret
              key: ConnectionStrings__DefaultConnection
      restartPolicy: Never
  backoffLimit: 3
```

**Rule:** Run migration Job BEFORE application Deployment. Use `initContainers` or Job ordering (annotations/Helm hooks) to ensure migration completes first.

**Detection:** `grep -rn 'DbContext\|OnModelCreating\|Migration' . --include='*.cs' | head -5`

## SignalR Redis Backplane

**Trigger:** ASP.NET Core SignalR with multiple replicas (HPA minReplicas > 1).

**Problem:** SignalR maintains in-memory connection mappings. Without a backplane, messages from one pod do not reach clients connected to other pods.

**Solution — Redis backplane:**
```csharp
// Program.cs
builder.Services.AddSignalR()
    .AddStackExchangeRedis(Environment.GetEnvironmentVariable("REDIS_URL") ?? "localhost:6379", options =>
    {
        options.Configuration.ChannelPrefix = RedisChannel.Literal("MyApp");
    });
```

**Dependencies (add to .csproj):**
```xml
<PackageReference Include="Microsoft.AspNetCore.SignalR.StackExchangeRedis" Version="8.0.*" />
```

**NetworkPolicy:** Web Deployment needs egress to Redis (TCP 6379).

**Detection:** `grep -rn 'MapHub\|AddSignalR\|HubConnection' . --include='*.cs'`

**Rule:** If SignalR is detected AND HPA minReplicas > 1, add Redis backplane. Without it, real-time features break across multiple pods.

## SignalR Nginx Ingress Annotations

**Trigger:** SignalR hub behind nginx Ingress controller.

**Problem:** SignalR WebSocket connections are long-lived. Default nginx proxy timeouts (60s) drop the WebSocket transport, forcing fallback to Long Polling (higher latency, more server load).

**Solution — add annotations to Ingress:**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "7"
    # Enable WebSocket upgrade
    nginx.ingress.kubernetes.io/websocket-services: "app-service"
```

**Detection:**
```bash
grep -rn 'MapHub\|UseSignalR\|AddSignalR' . --include='*.cs' && echo "SignalR detected — add WS Ingress annotations"
```

**Rule:** When SignalR is detected AND Ingress uses nginx controller, add `proxy-read-timeout: 3600` and `proxy-send-timeout: 3600`. Without these, WebSocket transport fails silently and clients fall back to Long Polling.

**Nginx Ingress annotations for SignalR WebSocket:**

When SignalR is behind an nginx Ingress controller, default proxy timeouts (60s) disconnect WebSocket clients, causing constant reconnection storms.

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

**Rule:** When SignalR uses WebSocket transport AND the application is behind nginx Ingress, add `proxy-read-timeout: 3600` and `proxy-send-timeout: 3600` annotations. Without these, WebSocket connections drop every 60 seconds.

## CRONJOB_MODE Toggle Pattern

**Trigger:** .NET application that runs both as a web API and as periodic background jobs, with a mode toggle to select behaviour at runtime.

**Problem:** Using a single Docker image with an env var toggle (`CRONJOB_MODE=true`) to switch between web and job mode is a decomposition anti-pattern.

**Solution — separate entry points via Dockerfile targets:**
```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
COPY --from=build /app/publish .

FROM base AS web
ENTRYPOINT ["dotnet", "MyApp.dll"]

FROM base AS worker
ENTRYPOINT ["dotnet", "MyApp.dll", "--run-job", "cleanup"]
```

**Kubernetes manifests:**
```yaml
# deployment-web.yaml
containers:
- name: web
  image: app:latest  # targets 'web' stage
  
# cronjob-cleanup.yaml
containers:
- name: cleanup
  image: app:latest  # targets 'worker' stage
  command: ["dotnet", "MyApp.dll", "--run-job", "cleanup"]
```

**Detection:** `grep -rn 'CRONJOB_MODE\|RUN_MODE\|JOB_MODE' . --include='*.cs' --include='*.json'`

**Rule:** Replace mode-toggle env vars with separate Dockerfile targets and distinct Kubernetes workload manifests (Deployment vs CronJob).

## Startup-Eager ConnectionMultiplexer

**Trigger:** StackExchange.Redis `ConnectionMultiplexer.Connect()` called during DI registration or app startup.

**Problem:** `ConnectionMultiplexer.Connect()` opens a TCP connection to Redis immediately at startup — before the first request arrives. If the NetworkPolicy egress to Redis is missing, the pod hangs at startup or crashes with a timeout.

```csharp
// This runs at DI registration time — connection opens IMMEDIATELY
builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
    ConnectionMultiplexer.Connect(
        Environment.GetEnvironmentVariable("REDIS_URL") ?? "localhost:6379"
    )
);
```

**NetworkPolicy impact:** The web Deployment's egress NetworkPolicy MUST include Redis (TCP 6379) even if the primary use of Redis appears to be "on-demand" (sessions, caching). The connection opens at startup.

**Egress trigger:** This is a startup-eager connection. Add Redis egress rule to the workload's NetworkPolicy even if no explicit `REDIS_HOST` env var exists — the connection string may be embedded in `appsettings.json` or a composite connection string.

**Detection:**
```bash
grep -rn 'ConnectionMultiplexer\.Connect\|AddStackExchangeRedis\|GetDatabase()' . --include='*.cs'
```

**Startup resilience:** Wrap in retry logic to handle Redis unavailability at startup:
```csharp
builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
{
    var config = ConfigurationOptions.Parse(
        Environment.GetEnvironmentVariable("REDIS_URL") ?? "localhost:6379");
    config.AbortOnConnectFail = false;  // Don't crash on startup if Redis is slow
    config.ConnectRetry = 3;
    return ConnectionMultiplexer.Connect(config);
});
```

## InboundClaimTypeMap.Clear() for JWT Auth

**Trigger:** .NET applications using JWT bearer authentication with `Microsoft.AspNetCore.Authentication.JwtBearer`.

**Problem:** By default, `JwtSecurityTokenHandler` maps standard JWT claim types to long XML namespace URIs (e.g., `sub` → `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`). This breaks claim-based authorization policies that check for `sub`, `email`, etc.

**Detection:**
```bash
grep -rn 'AddJwtBearer\|JwtBearerDefaults' . --include='*.cs' | grep -v 'test\|Test'
grep -rn 'InboundClaimTypeMap' . --include='*.cs'
```

**Rule:** If JWT auth is configured AND `InboundClaimTypeMap.Clear()` is NOT present, add it in the auth configuration:
```csharp
// Program.cs — BEFORE AddAuthentication
JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();
```

Without this, `User.FindFirst("sub")` returns null even when the JWT contains the `sub` claim. This is a silent auth failure that manifests as 403 responses in production.

## Xabaril Health Check Packages

**Trigger:** .NET applications using `AspNetCore.HealthChecks.*` packages (Xabaril ecosystem) for health check endpoints.

**Problem:** The main package `AspNetCore.HealthChecks.UI` and infrastructure-specific packages (`*.SqlServer`, `*.Redis`, `*.NpgSql`) must match versions. Version mismatches cause `MissingMethodException` at startup.

**Detection:**
```bash
grep -rn 'AspNetCore.HealthChecks\|AddHealthChecks\|MapHealthChecks' . --include='*.cs' --include='*.csproj'
```

**Common packages requiring version alignment:**
- `AspNetCore.HealthChecks.SqlServer`
- `AspNetCore.HealthChecks.NpgSql`
- `AspNetCore.HealthChecks.Redis`
- `AspNetCore.HealthChecks.UI`

**Rule:** When migrating health check configuration, verify all `AspNetCore.HealthChecks.*` packages in `.csproj` use the same major.minor version. Add the health check endpoint to probe configuration:
```csharp
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => true });
```

## DefaultAzureCredential OS Bypass

**Trigger:** .NET applications using `Azure.Identity.DefaultAzureCredential` for Azure service authentication.

**Problem:** `DefaultAzureCredential` reads `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` via `System.Environment.GetEnvironmentVariable()` — bypassing `IConfiguration` entirely. These variables do NOT appear in `appsettings.json` or through the `IConfiguration` indexer pattern. Pass 1 grep on `*.json`/configuration files misses them.

**Detection:**
```bash
grep -rn 'DefaultAzureCredential\|Azure\.Identity' . --include='*.cs' --include='*.csproj' | grep -v 'test\|Test'
```

**Rule:** When `Azure.Identity` is present in dependencies:
1. Pass 3 (Direct OS env reads) is MANDATORY — these vars bypass IConfiguration
2. Add to ENV_VARIABLES.md: `AZURE_TENANT_ID` (ConfigMap), `AZURE_CLIENT_ID` (ConfigMap), `AZURE_CLIENT_SECRET` (Secret)
3. For Kubernetes with Workload Identity (AKS equivalent of IRSA): `AZURE_CLIENT_SECRET` uses empty-string Secret pattern, ServiceAccount gets `azure.workload.identity/client-id` annotation

## Tests/ Compile Inclusion Exclusion

**Trigger:** .NET solution with `Tests/` or `*.Tests` project in the solution file.

**Problem:** During Docker multi-stage build, if the solution file references test projects and test project dependencies are not restored, `dotnet build` fails with missing reference errors. Test projects typically reference `xunit`, `NUnit`, or `MSTest` packages not needed in production.

**Detection:**
```bash
grep -n '\.Tests\|\.Test\|\.IntegrationTests' *.sln 2>/dev/null
```

**Fix — exclude test projects in Dockerfile:**
```dockerfile
# Option A: Build specific project only (preferred)
RUN dotnet publish src/MyApp/MyApp.csproj -c Release -o /app/publish

# Option B: If solution-level build is required, remove test projects first
RUN dotnet sln remove tests/MyApp.Tests/MyApp.Tests.csproj && \
    dotnet publish -c Release -o /app/publish
```

**Rule:** Production Dockerfiles MUST either target a specific non-test project with `dotnet publish <project>.csproj` or remove test projects from the solution before building. Never rely on `dotnet build` of the entire solution in a production Docker image.

## SignalR Method-Level Auth

**Trigger:** ASP.NET Core SignalR hubs with `[Authorize]` attributes on individual hub methods rather than the hub class.

**Problem:** Method-level `[Authorize]` on SignalR hub methods does NOT prevent unauthenticated WebSocket connections — it only prevents method invocation AFTER connection. The health/readiness probe's WebSocket handshake path is NOT affected, but auth middleware ordering matters.

**Detection:**
```bash
grep -rn '\[Authorize\]' . --include='*.cs' | grep -i 'Hub'
```

**Rule:** When SignalR uses auth:
1. Apply `[Authorize]` at hub CLASS level (not just method level) for consistent behavior
2. Ensure probe paths are OUTSIDE the SignalR hub route group
3. Map health check before auth middleware: `app.MapHealthChecks("/health")` must precede `app.UseAuthorization()`

## Dotted-Key ConfigMap envFrom Limitation

**Trigger:** .NET appsettings.json keys using the `Section:Key` convention mapped to `Section__Key` env vars when using envFrom bulk injection.

**Problem:** While .NET uses `__` (double underscore) as the section separator for env vars, some configurations use dotted keys directly in ConfigMap (e.g., `Logging:LogLevel:Default`). These work with explicit `env[]` injection but are silently skipped by `envFrom` because `:` is invalid in env var names.

**Detection:**
```bash
python3 -c "
import yaml
with open('kubernetes/configmap.yaml') as f:
    for doc in yaml.safe_load_all(f):
        if doc and doc.get('kind') == 'ConfigMap':
            for k in doc.get('data', {}).keys():
                if ':' in k or '.' in k:
                    print(f'INCOMPATIBLE KEY: {k} — skipped by envFrom')
"
```

**Rule:** All .NET ConfigMap keys used with `envFrom` MUST use the double-underscore convention (`Section__Key`), NOT colon or dot separators. For keys that must contain special characters, use explicit `env[].valueFrom.configMapKeyRef`.

