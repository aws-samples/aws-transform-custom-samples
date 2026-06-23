# Docker Build Validation

## Purpose

Validates that generated Dockerfiles produce runnable container images before any Kubernetes-level validation. Docker build tests fundamentally different things from kubeconform — it verifies COPY paths, package installs, compilation, user creation, and entrypoint execution. It is NOT a substitute for kubeconform (YAML schema), nor vice versa.

## When to Run

**Sub-Phase §17b** — after Dockerfile generation (§17), before Minikube/cluster validation (§18). This is Validation Tier 1.

## Preconditions

- Dockerfiles exist for all workloads in the Minimal Execution Set.
- Source code is present in the transformation directory.
- Docker daemon is accessible (`docker info` exits 0).

## Procedure

### Step 0: Native Compilation Verification (compiled languages only)

**Purpose:** For compiled languages, the language-native build tool MUST be invoked and exit 0 on the host BEFORE `docker build` is attempted. This verifies that the source code compiles correctly and the resulting artifact exists at the path the Dockerfile's COPY instruction expects. Compiling at container runtime is prohibited.

**When to run:** Before Step 0b (Interpreted Language Validation). This step applies to compiled languages only (Java, Go, C#, Rust, TypeScript). For interpreted languages, see Step 0b below.

**Detection — determine if project requires host-side compilation:**

| Build file present | Language | Compile required? |
|---|---|---|
| `pom.xml` | Java (Maven) | YES |
| `build.gradle` / `build.gradle.kts` | Java (Gradle) | YES |
| `go.mod` | Go | YES |
| `.csproj` / `.sln` | C# / .NET | YES |
| `Cargo.toml` | Rust | YES |
| `package.json` with `"build"` script | TypeScript / Node.js | YES |
| `composer.json` (PHP) | PHP | NO |
| `requirements.txt` / `pyproject.toml` | Python | NO |
| `Gemfile` | Ruby | NO |

**Per-language compilation commands:**

| Language | Command | Expected artifact path |
|---|---|---|
| Java (Maven) | `mvn package -DskipTests -B -q` | `target/*.jar` or `target/*.war` |
| Java (Gradle) | `./gradlew build -x test --no-daemon` | `build/libs/*.jar` |
| Go | `go build ./...` | Binary in current directory or `./cmd/*/` |
| C# / .NET | `dotnet publish -c Release` | `bin/Release/net*/publish/` |
| Rust | `cargo build --release` | `target/release/<binary>` |
| Node.js/TS (build script) | `npm ci && npm run build` | `dist/` or `build/` directory |

**Procedure:**

1. **Detect project type** from build files present in repository root.

2. **Check toolchain availability and version match:**
   ```bash
   # Java: verify JDK version matches project requirement
   java -version 2>&1 | head -1
   grep -oP '(?:java\.version|maven\.compiler\.source|maven\.compiler\.target|release)>\K[^<]+' pom.xml 2>/dev/null | head -1

   # Go: verify go version >= go.mod directive
   go version
   grep '^go ' go.mod

   # .NET: verify SDK version
   dotnet --version

   # Node.js: verify node version
   node --version
   ```

3. **Run the compilation command:**
   ```bash
   # Example: Java/Maven
   mvn package -DskipTests -B -q 2>&1 | tee /tmp/compile.log
   COMPILE_EXIT=${PIPESTATUS[0]}
   ```

4. **Assert exit 0:**
   ```bash
   [ "$COMPILE_EXIT" -eq 0 ] && echo "COMPILATION OK" || echo "COMPILATION FAILED (exit $COMPILE_EXIT)"
   ```

5. **Verify artifact exists at expected Dockerfile COPY path:**
   ```bash
   # Java/Maven:
   ls target/*.jar target/*.war 2>/dev/null | head -1 || echo "ARTIFACT MISSING"

   # Java/Gradle:
   ls build/libs/*.jar 2>/dev/null | head -1 || echo "ARTIFACT MISSING"

   # Go (check binary was produced):
   ls <expected-binary-path> 2>/dev/null || echo "ARTIFACT MISSING"

   # .NET:
   ls bin/Release/net*/publish/ 2>/dev/null || echo "ARTIFACT MISSING"

   # Node.js/TS:
   ls dist/ build/ 2>/dev/null || echo "ARTIFACT MISSING"
   ```

6. **Connection to Docker:** The Dockerfile COPY instruction references the artifact produced by this step. If artifact is absent, Docker build fails at COPY with `file not found`.

**Failure handling:**

| Failure type | Action |
|---|---|
| Toolchain not installed | Attempt `mise install <lang>@<version>`. If mise absent or install fails → record `CONDITIONAL PASS` with: "Toolchain unavailable — cannot verify compilation" |
| Version mismatch (e.g., JDK 8 required, JDK 21 installed) | Attempt `mise install java@corretto-<required-version>` and retry. If mise absent or install fails → record `CONDITIONAL PASS` with: "JDK version mismatch — project requires X, host has Y" |
| Compilation error (code bug) | FAIL — fix source before proceeding to Docker build |
| Network timeout (dependency download) | Retry once. If still fails, record `CONDITIONAL PASS` with root cause |

**Repeat-failure escalation:** If the native compile step fails in 2+ tasks for the same environmental reason (e.g., JDK version mismatch), the overall Criterion 13 result MUST be `CONDITIONAL PASS` — not `PASS`. Document root cause and affected tasks in the Three-Tier Validation table.

**Multi-stage Dockerfile note:** Multi-stage Dockerfiles that compile inside the builder stage (e.g., `FROM maven:3.9 AS builder ... RUN mvn package`) are acceptable for image correctness. However, the host-side Step 0 verification gate is ALWAYS attempted first — it catches compilation errors early (before a potentially slow Docker build) and provides faster feedback. The sequence is always: (1) host-side compile/validate → (2) docker build. The host-side gate is only recorded as CONDITIONAL PASS when the required toolchain is unavailable and `mise install` fails.

**Idempotence:** Running Step 0 twice produces the same artifact (build tools are idempotent for unchanged source). The second run is typically a no-op due to build caching.

**pom.xml invariant check (Java only):** Before running `mvn package`, verify pom.xml is well-formed: `xmllint --noout pom.xml`. A malformed POM causes a cryptic Maven error unrelated to the actual compilation.



### Step 0b: Interpreted Language Validation Gate

**Purpose:** For interpreted languages, run language-native syntax checks, dependency resolution, and import verification on the host BEFORE `docker build`. This catches errors faster than waiting for a Docker build to fail.

**When to run:** Before Step 1 (Docker Availability Check). This step applies to ALL projects with interpreted languages — multi-stage Dockerfiles do NOT exempt it.

**Detection — determine if project requires host-side validation:**

| Build file present | Language | Validation type |
|---|---|---|
| `composer.json` | PHP | VALIDATE |
| `requirements.txt` / `pyproject.toml` / `Pipfile` | Python | VALIDATE |
| `Gemfile` | Ruby | VALIDATE |
| `package.json` (NO `build` script) | Node.js | VALIDATE |

**Per-language validation commands:**

| Language | Commands | Expected result |
|---|---|---|
| PHP | `find . -name '*.php' -not -path '*/vendor/*' \| xargs -P4 php -l 2>&1 \| grep -v 'No syntax errors'` | Empty output (no errors) |
| PHP | `composer validate --no-check-publish 2>&1` | Exit 0 |
| Python | `find . -name '*.py' -not -path '*/.venv/*' -not -path '*/site-packages/*' \| xargs python3 -m py_compile 2>&1` | Empty output (no errors) |
| Python | `pip install -r requirements.txt --dry-run 2>&1` (if pip available) | Exit 0 |
| Ruby | `find . -name '*.rb' -not -path '*/vendor/*' \| xargs ruby -c 2>&1 \| grep -v 'Syntax OK'` | Empty output |
| Ruby | `bundle check` | Exit 0 (deps satisfied) |
| Node.js | `node --check <entry-point.js>` | Exit 0 |
| Node.js | `npm ci --dry-run 2>&1` (if package-lock.json present) | Exit 0 |

**Procedure:**

1. **Detect project type** from build files in repository root.
2. **Check interpreter availability:**
   ```bash
   command -v php && php --version
   command -v python3 && python3 --version
   command -v ruby && ruby --version
   command -v node && node --version
   ```
3. **If interpreter absent — attempt mise install:**
   ```bash
   command -v mise && mise install 2>/dev/null
   ```
   If mise installs the interpreter, retry. If mise is absent or fails, record CONDITIONAL PASS.

4. **Run the validation commands** (see per-language table above).

5. **Assert exit 0 / empty error output.** Any syntax error or unresolved dependency = FAIL.

**Failure handling:**

| Failure type | Action |
|---|---|
| Interpreter not installed, mise absent/fails | Record `CONDITIONAL PASS` with: "Interpreter unavailable — cannot verify syntax" |
| Version mismatch (e.g., Python 3.12 required, 3.9 installed) | Attempt `mise install python@<version>`. If fails, record `CONDITIONAL PASS` |
| Syntax error in source code | FAIL — fix source before proceeding to Docker build |
| Dependency resolution failure (missing package) | FAIL — fix dependencies before Docker build |
| Network timeout during dependency download | Retry once. If still fails, record `CONDITIONAL PASS` |

**Idempotence:** Running Step 0b twice produces the same result — syntax checks and dry-run installs are read-only operations.

**Relationship to Step 0:** Step 0 (compiled languages) and Step 0b (interpreted languages) are mutually exclusive per language — a project uses one or the other. For mixed-language projects (e.g., PHP + TypeScript asset build), BOTH steps apply to their respective languages.

### Step 1: Docker Availability Check

```bash
docker info > /dev/null 2>&1 && echo "DOCKER_AVAILABLE=true" || echo "DOCKER_AVAILABLE=false"
```

If Docker is unavailable, log an explicit warning:
```
WARNING: Docker not available — Tier 1 validation (docker build + smoke test) skipped.
Unverifiable assertions: COPY source paths, package install success, compilation,
entrypoint execution, non-root user creation. Proceeding to Tier 2 (kubeconform).
```
Then execute the **Static Verification Checklist** below, set build status to `SKIPPED`, and proceed to Tier 2. Do NOT attempt workarounds.

### Step 2: Docker Build (mandatory exit 0)

For each Dockerfile in the Minimal Execution Set:

```bash
# Single-stage or final-stage build
docker build -t <app-name>:local -f <Dockerfile-path> <build-context>

# Multi-stage with named target
docker build -t <app-name>:local --target <stage-name> -f <Dockerfile-path> <build-context>
```

**Exit 0 is mandatory.** If build fails, fix the Dockerfile before any further validation.

**Multi-module projects** (Java/Maven): Build context must be the project root:
```bash
docker build -t app:local -f submodule/Dockerfile .
```

### Step 3: Smoke Test (optional but recommended)

After successful build, verify the entrypoint starts without immediate crash:

```bash
docker run --rm -d --name smoke-test <app-name>:local
sleep 5
docker logs smoke-test 2>&1 | tail -20
docker inspect smoke-test --format='{{.State.Status}}'  # must be "running"
docker stop smoke-test
```

**Per-stack quick verification commands** (alternative to full startup):

| Stack | Smoke Command | Expected |
|-------|--------------|----------|
| Node.js | `docker run --rm <app>:local node -e 'process.exit(0)'` | Exit 0 |
| PHP | `docker run --rm <app>:local php -v` | Exit 0, version printed |
| Go | `docker run --rm <app>:local /app/<binary> --version` (or `--help`) | Exit 0 or 2 |
| Java/Spring | `docker run --rm <app>:local java -jar /app/app.jar --help` | Exit 0 or 1 (Spring help) |
| Python | `docker run --rm <app>:local python -c 'import app; print("OK")'` | Exit 0 |
| Ruby/Rails | `docker run --rm <app>:local ruby -e 'puts "OK"'` | Exit 0 |
| nginx | `docker run --rm <app>:local nginx -t` | "syntax is ok" |

**Note:** Full application startup may require database/Redis connectivity. The smoke test verifies the image is runnable, not that all backing services connect. Connection errors in logs are acceptable at this stage — crash loops or missing binaries are NOT.

### Step 4: Health Probe Path Verification (web services only)

For web services with HTTP probes configured:

```bash
docker run --rm -d -p 8080:8080 --name probe-test <app-name>:local
sleep 10
curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/healthz
# Expected: 200 (or configured probe path)
docker stop probe-test
```

If probe returns 4xx/5xx due to missing backing services, this is acceptable IF the container itself started (did not crash). Document as: "Probe path requires backing service — verified in Tier 3 (cluster validation)."

## Common Failure Patterns and Fixes

| Failure | Cause | Fix |
|---------|-------|-----|
| `COPY failed: file not found` | Wrong build context or path | Adjust `-f` and context; verify file exists relative to context root |
| `apt-get: package not found` | Wrong base image or package name | Check base image OS (Alpine vs Debian); use correct package manager |
| `Permission denied` on COPY --chown | USER directive before group/user creation | Move `RUN useradd/adduser` BEFORE `COPY --chown` |
| `exec format error` | Architecture mismatch (ARM vs x86) | Use `--platform linux/amd64` or matching base image |
| Go build fails: missing module | go.sum not copied | Add `COPY go.sum .` before `RUN go mod download` |
| Ruby `KeyError: key not found: "SECRET_KEY_BASE"` | `ENV.fetch` without default during asset precompile | Add dummy env vars to RUN line (see ruby-rails-patterns.md) |
| npm ERR! missing workspace | Monorepo workspace not copied | Copy all workspace directories before `npm install` |

## Ruby-Specific: ENV.fetch Audit Before Build

Before running `docker build` on a Rails application:

```bash
# Find bare ENV.fetch calls (no second argument = KeyError if missing)
grep -rn 'ENV\.fetch' config/ app/ lib/ --include='*.rb' | grep -v 'ENV\.fetch([^,]*,'
```

Each hit in class-level code or config/ERB that runs at build time (asset precompile) requires a dummy var in the Dockerfile RUN line:

```dockerfile
RUN SECRET_KEY_BASE=dummy RAILS_ENV=production \
    bundle exec rake assets:precompile
```

## Multi-Stage COPY Exemption

**Rule:** For each `COPY` instruction in a Dockerfile, check whether it contains `--from=`. If yes, skip host-path existence check entirely — the source path references a build-stage artifact or external image layer that does NOT exist on the local filesystem.

**Detection — filter to only host-filesystem COPYs requiring path validation:**
```bash
# List COPY instructions that reference LOCAL paths (require validation)
grep -v '^\s*#' Dockerfile | grep -P '^COPY(?!\s+--from)' | grep -v '\-\-from='

# List COPY instructions from build stages (NO validation needed)
grep -v '^\s*#' Dockerfile | grep '^COPY' | grep '\-\-from='
```

**Procedure:**
1. For each COPY line WITHOUT `--from=`: verify the source path exists relative to the build context root.
2. For each COPY line WITH `--from=<stage|image>`: document as EXPECTED — no path validation needed. These reference artifacts produced during earlier build stages or pulled from external images.

**Example:**
```dockerfile
# Stage 1: build
FROM golang:1.22 AS builder
COPY go.mod go.sum ./          # ← VALIDATE: go.mod, go.sum must exist in build context
RUN go build -o /app/server

# Stage 2: runtime
FROM gcr.io/distroless/static
COPY --from=builder /app/server /app/server  # ← EXEMPT: references builder stage artifact
```

**Static Verification Checklist integration:** When Docker is unavailable (Point 1 of the static checklist), apply this exemption before reporting MISSING COPY SOURCE errors. Only non-`--from=` COPY paths are validated.

## Verification

After all builds pass:
```bash
docker images | grep ':local'
# Each image in Minimal Execution Set should appear
```

**Idempotence check:** Running `docker build` again produces a cached result (exit 0, no layer rebuild unless source changed).

## Static Verification Checklist (Tier 1 Unavailable)

When Docker is NOT available, the worker MUST execute this five-point mandatory static checklist as a substitute for the actual build. This does NOT grant `PASSED` status — build remains `SKIPPED`.

### Point 1: Verify COPY Source Paths Exist

For every `COPY` instruction in each Dockerfile **that does NOT contain `--from=`**, confirm ALL source paths exist on disk. Multi-token COPY instructions (e.g., `COPY file1 file2 dir/ /dest/`) have multiple source tokens — validate ALL except the last (which is the destination):

```bash
# Extract COPY source paths (skip --from= lines, handle multi-token COPY, strip flags)
grep -v '^\s*#' Dockerfile | grep '^COPY' | grep -v '\-\-from=' | sed 's/COPY\s*//' | sed 's/--[^ ]* //g' | while read line; do
  # Split into tokens; all except last are sources
  tokens=($line)
  for ((i=0; i<${#tokens[@]}-1; i++)); do
    src="${tokens[$i]}"
    if [ ! -e "$src" ] && ! echo "$src" | grep -q '\*'; then
      echo "MISSING COPY SOURCE: $src"
    fi
  done
done
# Output should be empty — any match = potential build failure
```

**COPY flag-token exclusion rule**: Strip ALL tokens starting with `--` (e.g., `--chown=1000:1000`, `--chmod=755`) before extracting source/destination paths. These are COPY instruction flags, NOT source paths.

**COPY source path tokenization (Python — canonical implementation)**: When the bash read-loop produces false MISSING alerts (e.g., treating `COPY` keyword or `--flag` tokens as paths), use this Python tokenization as the authoritative implementation:
```python
import re
with open('Dockerfile') as f:
    for line in f:
        line = line.strip()
        if line.startswith('#') or not line.startswith('COPY'):
            continue
        if '--from=' in line:
            continue
        # Strip COPY keyword
        rest = re.sub(r'^COPY\s+', '', line)
        # Strip all --flag tokens
        rest = re.sub(r'--\S+\s*', '', rest)
        tokens = rest.split()
        # All except last = sources; last = destination
        sources = tokens[:-1]
        for src in sources:
            # Glob patterns (*) are valid — skip validation
            if '*' not in src:
                print(f"VALIDATE: {src}")
```

**PHP/Laravel configPath() pre-analysis step**: For PHP/Laravel projects, before writing or validating Dockerfile COPY instructions, check for non-standard config directory overrides:
```bash
grep -rn 'configPath\|useConfigPath' app/ bootstrap/ --include='*.php' 2>/dev/null | grep -v vendor
```
If a non-standard config path is found, ensure the Dockerfile COPYs that path in addition to the standard `config/` directory.

**Comment-stripping pre-filter**: ALL Dockerfile instruction checks MUST strip comment lines first (`grep -v '^\s*#'`). A MIGRATION comment mentioning COPY, FROM, or HEALTHCHECK is documentation, not an instruction.

**Note:** COPY instructions with `--from=` are EXEMPT — they reference build-stage artifacts not present on the host filesystem (see §Multi-Stage COPY Exemption above).

### Point 2: Verify Base Image Tag is Pinned (ARG-Aware)

```bash
# Step 1: Collect ARG defaults declared before first FROM
ARGS=$(grep -v '^\s*#' Dockerfile | sed -n '0,/^FROM/{ /^ARG /p }' | sed 's/ARG //' | tr '\n' ';')

# Step 2: Collect declared stage aliases (FROM ... AS <alias>)
ALIASES=$(grep -v '^\s*#' Dockerfile | grep -i '^FROM.*AS' | awk '{print $NF}' | tr '[:upper:]' '[:lower:]')

grep -v '^\s*#' Dockerfile | grep '^FROM' | while read line; do
  # Handle --platform= flag: image is last positional field before AS
  image=$(echo "$line" | sed 's/--[^ ]* //g' | awk '{print $2}')
  # Skip internal stage aliases (not external pulls)
  if echo "$ALIASES" | grep -qx "$(echo "$image" | tr '[:upper:]' '[:lower:]')"; then
    continue  # Internal alias — not an external image
  fi
  # ARG substitution: resolve $VAR or ${VAR} from collected ARGs
  if echo "$image" | grep -qE '\$'; then
    resolved="$image"
    echo "$ARGS" | tr ';' '\n' | while IFS='=' read k v; do
      resolved=$(echo "$resolved" | sed "s|\${$k}|$v|g; s|\$$k|$v|g")
    done
    image="$resolved"
  fi
  if echo "$image" | grep -qE ':latest$|^[^:]+$'; then
    echo "UNPINNED BASE IMAGE: $image (use specific version tag)"
  fi
done
```

**ARG-aware FROM tag pinning rule**: Collect all `ARG key=value` declarations before the first `FROM` instruction. Substitute `${VAR}` and `$VAR` references in FROM image tokens before evaluating pinning. Example: `ARG NODE_VERSION=18-alpine` + `FROM node:${NODE_VERSION}` → resolves to `node:18-alpine` (pinned, PASS).

**Multi-stage alias exception**: When a `FROM` line references a name declared as an alias by a previous `FROM ... AS <alias>` in the same Dockerfile, it is an internal stage reference — NOT an external image pull. Skip pinning validation for these.

**FROM --platform= parsing**: Lines like `FROM --platform=$BUILDPLATFORM golang:1.22 AS builder` — the image name is NOT `$2` (which is the flag). Strip `--flag value` pairs first, then extract the image name.

### Point 3: Verify Non-Root USER Instruction Present

```bash
if ! grep -v '^\s*#' Dockerfile | grep -q '^USER'; then
  echo "WARNING: No USER instruction — container runs as root"
fi
```

### Point 4: List Unverifiable Assertions

Document the following as unverifiable without Docker:
- Package install success (apt-get, apk, pip, npm, gem, nuget)
- Compilation/build step success
- Entrypoint binary execution
- Runtime file permissions

Add to task report:
```
UNVERIFIABLE (Docker unavailable):
- [ ] Package installs exit 0
- [ ] Application compiles successfully
- [ ] Entrypoint binary exists and is executable
- [ ] File permissions match runAsUser UID
```

### Point 5: Verify Compiled Artifact Presence (compiled languages only)

For projects detected by Step 0 as requiring compilation, verify the expected artifact exists on disk even when Docker is unavailable:

```bash
# Java/Maven:
ls target/*.jar target/*.war 2>/dev/null | head -1 || echo "COMPILED ARTIFACT MISSING — Step 0 may not have run"

# Java/Gradle:
ls build/libs/*.jar 2>/dev/null | head -1 || echo "COMPILED ARTIFACT MISSING"

# Go:
ls <expected-binary-path> 2>/dev/null || echo "COMPILED ARTIFACT MISSING"

# .NET:
ls bin/Release/net*/publish/ 2>/dev/null || echo "COMPILED ARTIFACT MISSING"

# Node.js/TS:
ls dist/ build/ 2>/dev/null || echo "COMPILED ARTIFACT MISSING"
```

If the artifact is missing AND Step 0 was not run (toolchain unavailable), document as: "Compiled artifact not verified — toolchain unavailable."

### Validation Result When Docker Unavailable

```json
{
  "container_build": "PASSED (skipped — tool unavailable)",
  "container_build_reason": "Docker unavailable — static verification only",
  "static_checklist": {
    "copy_paths_exist": true,
    "base_image_pinned": true,
    "user_instruction_present": true,
    "unverifiable_assertions_documented": true,
    "compiled_artifact_present": true
  },
  "basic_tests": "PASSED",
  "overall": "PASSED"
}
```

**Rules:**
1. Do NOT record `container_build: PASSED` (bare) when Docker was never executed — use `PASSED (skipped — tool unavailable)`.
2. Overall result is NOT degraded when Tier 1 was skipped due to tool absence. Tool absence ≠ failure.
3. Do NOT attempt to install Docker, start dockerd, or use alternative container runtimes.
4. Document in TRANSFORMATION_SUMMARY.md: "Docker build validation skipped — Docker unavailable in execution environment. Static verification checklist passed."

## Tier 3 Ask-Before-Skip Protocol

**Purpose:** Tier 3 cluster validation must never be silently skipped. The user must be informed and asked whether they want to run it.

**When to run:** During Sub-Phase §1 (Initial Setup), after determining execution preferences.

**Decision flow:**

1. Auto-detect cluster tools:
```bash
command -v minikube || command -v kind || command -v k3s || command -v kwokctl
```

2. If any tool detected → Tier 3 is available. Proceed to Tier 3 after Tier 1 passes (or immediately for KWOK — see §KWOK Tier 3 Independence below).

3. If NO tool detected → **attempt kwokctl download** (30-second timeout):
```bash
curl -Lo /tmp/kwokctl "https://github.com/kubernetes-sigs/kwok/releases/download/v0.7.0/kwokctl-linux-amd64"
chmod +x /tmp/kwokctl
```
If download succeeds, proceed with Tier 3 using `--runtime=binary`. If `/usr/local/bin` is writable, create symlink: `ln -sf /tmp/kwokctl /usr/local/bin/kwokctl`. Otherwise use `/tmp/kwokctl` directly. If download fails, prompt the user.

**CRITICAL: Download `kwokctl-linux-amd64` (NOT `kwok-linux-amd64`). These are SEPARATE binaries — kwok is the node simulator, kwokctl is the cluster manager. Do NOT symlink kwok as kwokctl.**

4. If download also failed → **prompt the user** (30-second timeout; no response = N):
```
Tier 3 cluster validation (Minikube/kind/k3s/KWOK) was not auto-detected.
Would you like to run Tier 3 cluster validation? [y/N]
```

5. If user responds **y**: attempt Tier 3 using the fallback chain below (Minikube → kind → k3s → KWOK).

6. If user responds **N** or no response / timeout (30s): skip Tier 3 and log:
```
DECISION: Tier 3 cluster validation skipped (user opted out / not available).
Status: PASSED (skipped — tool unavailable). Overall result unaffected.
```

6. **In fully automated (CI) mode** where no user prompt is possible: default to skip, emit a visible notice:
```
NOTICE: Tier 3 cluster validation skipped (non-interactive, no cluster tool detected).
Status: PASSED (skipped — tool unavailable). Overall result unaffected.
To run Tier 3 manually: kwokctl create cluster --runtime=binary && kubectl apply -f kubernetes/
```

7. **Record the decision** in both the task report AND TRANSFORMATION_SUMMARY.md Three-Tier Validation table. The table must show either `PASSED` (with tier reached), `SKIPPED (user opted out)`, or `SKIPPED (non-interactive, no cluster tool)` — never blank or ambiguous.

**Tier 3 fallback chain (ordered):** Minikube → kind → k3s → KWOK

**kwokctl kubectl passthrough warning**: Never use `kwokctl kubectl -- <args>` passthrough — it drops subcommand arguments and outputs kubectl help text. Always use the bundled kubectl binary directly with an explicit `--kubeconfig` flag.

## ECS/Restricted Container Fallback (Tier 3)

**Purpose:** When Tier 3 cluster validation is attempted in ECS tasks, restricted containers, or cgroup v1 environments, standard Minikube and k3s ≥v1.32 fail. This procedure documents the canonical fallback.

**When to run:** During Tier 3 validation attempts, when early-abort signals are detected.

**Early-abort signals (in order of detection):**

| Signal | Source | Action |
|--------|--------|--------|
| `unshare: operation not permitted` | Minikube start | Skip Minikube entirely → try k3s |
| `cgroup v1 support is unsupported` | k3s ≥v1.32 kubelet | Downgrade to k3s v1.28.15+k3s1 |
| Port 6443 `ServiceUnavailable` | k3s API server | Use port 6444 instead |
| `Minikube --driver=none` requires Docker even with conntrack/crictl | Minikube | Skip Minikube → use k3s |

**Canonical k3s v1.28 fallback procedure:**

```bash
# Install k3s v1.28.15+k3s1 (API-server-only, no agent)
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.28.15+k3s1 \
  INSTALL_K3S_EXEC='server --disable-agent --snapshotter=native --flannel-backend=none' sh -

# Wait for API server
sleep 10

# kubeconfig location
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# If port 6443 returns ServiceUnavailable, try 6444
kubectl get nodes --server=https://127.0.0.1:6444 2>/dev/null && \
  sed -i 's/6443/6444/' /etc/rancher/k3s/k3s.yaml

# Apply manifests — Namespace FIRST (MANDATORY)
kubectl apply -f kubernetes/namespace.yaml && sleep 2
kubectl apply -f kubernetes/
```

**Rules:**
1. Do NOT iterate on Minikube failures in ECS — skip directly to k3s.
2. k3s ≥v1.32 requires cgroup v2. In cgroup v1 environments, use v1.28.x.
3. `--disable-agent` prevents kubelet startup (which fails on cgroup v1).
4. `--snapshotter=native` avoids overlayfs requirements.
5. `--flannel-backend=none` skips CNI (not needed for API-server-only validation).
6. All kubectl commands must run in same shell invocation with K3S process.
7. If k3s v1.28 also fails, abort Tier 3 and fall back to Tier 2 (kubeconform). Tier 2 is sufficient.

**Source:** Kubernetes 1.31+ moved cgroup v1 to maintenance mode (https://kubernetes.io/blog/2024/08/14/kubernetes-1-31-moving-cgroup-v1-support-maintenance-mode/).

## k3s Restricted Container Bootstrap

**Purpose:** When Tier 3 is attempted inside ECS tasks or other restricted containers where standard k3s install fails (no systemd, overlayfs unavailable, cgroup v1), use this ready-to-paste bootstrap sequence.

**When to run:** During Tier 3 validation attempts in restricted environments, after overlayfs EPERM or standard k3s installer failure.

**Early-abort signals** (add to existing table):

| Signal | Source | Action |
|--------|--------|--------|
| `overlayfs: permission denied` | k3s data dir init | Use `--snapshotter=native` |
| `EPERM` on `/var/lib/rancher` overlay | k3s mount | Switch to native snapshotter |

**Preconditions:** curl available, /tmp writable, root or sudo available.

**Procedure (5 steps):**

**Step 1 — Create sudo passthrough stub** (when real sudo is unavailable):
```bash
printf '#!/bin/sh\nexec "$@"' > /usr/local/bin/sudo && chmod +x /usr/local/bin/sudo
```

**Step 2 — Create systemctl no-op stub** (k3s installer expects systemctl):
```bash
printf '#!/bin/sh\nexit 0' > /usr/local/bin/systemctl && chmod +x /usr/local/bin/systemctl
```

**Step 3 — Create /dev/kmsg FIFO** (kubelet writes kernel messages here):
```bash
rm -f /dev/kmsg && mkfifo /dev/kmsg
```

**Step 4 — Launch k3s API-server-only** (no agent, no overlayfs):
```bash
nohup setsid k3s server \
  --disable-agent \
  --snapshotter=native \
  --write-kubeconfig-mode 644 \
  --flannel-backend=none \
  > /tmp/k3s.log 2>&1 &
sleep 15  # API server bootstrap takes ~10-15s
```

**Step 5 — Patch kubeconfig port** (k3s may bind to 6444 instead of 6443):
```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes 2>/dev/null || \
  sed -i 's/127.0.0.1:6443/127.0.0.1:6444/' /etc/rancher/k3s/k3s.yaml
kubectl get nodes  # Should succeed now
```

**Verification:** `kubectl get nodes` returns a node in Ready or NotReady state (NotReady is expected with --disable-agent).

**Post-bootstrap manifest apply:**
```bash
kubectl apply -f kubernetes/namespace.yaml && sleep 2
kubectl apply -f kubernetes/
kubectl get all -n <namespace>
```

**Abort criteria:** If k3s also fails after these 5 steps (e.g., kernel too old, SELinux blocking), abort Tier 3 entirely. Tier 2 (kubeconform) is sufficient for validation.

**Idempotence:** Running the procedure twice is safe — k3s detects existing process. The stubs are idempotent file overwrites.

**Source:** k3s --disable-agent flag documentation (https://github.com/k3s-io/k3s/issues/5118); Kubernetes 1.31+ moved cgroup v1 to maintenance mode (https://kubernetes.io/blog/2024/08/14/kubernetes-1-31-moving-cgroup-v1-support-maintenance-mode/).

## KWOK Operational Checklist

Consolidated checklist for all KWOK cluster operations. Use this as the single reference for KWOK validation.

### Step 0: Stale-Cluster Cleanup (MANDATORY before every creation)
Before creating ANY new cluster, ALWAYS delete stale clusters to avoid hangs on version mismatch:
```bash
/tmp/kwokctl get clusters 2>/dev/null
# Delete the target cluster name if it already exists:
/tmp/kwokctl delete cluster --name validation 2>/dev/null || true
```
Run this unconditionally — it is a no-op if no stale cluster exists.

### Flag Syntax Note
Prefer space-separated `--name validation` over equals-form `--name=validation`. The equals form is unreliable in some subcommand contexts and with shell variable expansion.

### Cluster Existence and Reuse Check
Before creating a new cluster, check if one already exists and delete stale clusters:
```bash
/tmp/kwokctl get clusters 2>/dev/null
# If target cluster name appears, delete it (covered by Step 0 above):
/tmp/kwokctl delete cluster --name validation 2>/dev/null || true
```
If no stale cluster exists, proceed to create.

### Kubeconfig Paths by Runtime Mode
| Runtime Mode | Kubeconfig Location |
|---|---|
| `--runtime=binary` | `~/.kwok/clusters/<name>/kubeconfig.yaml` |
| `--runtime=docker` | `~/.kwok/clusters/<name>/kubeconfig.yaml` |
| `--runtime=kind` | Use `kind get kubeconfig --name <name>` |

### Cached Binary Discovery
Before downloading kwokctl or kubeconform from CDN, check for cached binaries from prior tasks:
```bash
find /tmp -name kwokctl -type f -executable 2>/dev/null | head -1
find /tmp -name kubeconform -type f -executable 2>/dev/null | head -1
```
If found, use the cached binary directly — skip the download step.

**kubeconform integrity check**: After locating a cached kubeconform binary, verify it produces sane output before trusting it: `<binary> --help 2>&1 | grep -q 'Usage'`. If this fails, the binary may be corrupt or a different tool — re-download.

### kwokctl v0.7.0 API Changes
- `kwokctl version` is NOT a valid subcommand — do not use. Available commands: config, create, delete, get, hack, logs, scale, snapshot, start, stop.
- **`kwokctl get kubeconfig-path` does NOT EXIST** — the correct command is `kwokctl get kubeconfig --name <cluster>` which prints kubeconfig YAML to stdout. Redirect to file: `kwokctl get kubeconfig --name <cluster> > /tmp/kwok.kubeconfig && export KUBECONFIG=/tmp/kwok.kubeconfig` (command substitution causes file-name-too-long error — always redirect).
- **FALLBACK when `kwokctl get kubeconfig` fails or produces empty output**: Use the fixed path directly: `export KUBECONFIG=~/.kwok/clusters/<name>/kubeconfig.yaml` — this file always exists after successful cluster creation.
- `--name` flag for `get kubeconfig`: use space-separated form `kwokctl get kubeconfig --name <cluster>` (not equals-form).
- Use `kwokctl get clusters` (or `command -v kwokctl`) for binary presence check.
- `kwokctl kubectl -- <args>` (double-dash separator) is NOT supported — drops arguments, outputs kubectl help, exits 0 as false success.
- The passthrough is unreliable — always use standalone kubectl with explicit `--kubeconfig`.
- **kubectl v1.33+ note**: `kubectl version --short` is removed. Use `kubectl version --client=true` to verify kubectl binary version without contacting a server.

### kwokctl --name Bug Workaround
The `--name` flag in `kwokctl kubectl` subcommands defaults to 'kwok' regardless of the specified cluster name. **NEVER use `kwokctl kubectl --name=<cluster>`** — it silently targets the wrong cluster.

**Workaround**: Use the embedded kubectl binary directly. The PRIMARY discovery method is `find`:
```bash
KWOK_KUBECTL=$(find $HOME/.kwok/cache -name kubectl -type f | head -1)
KUBECONFIG=$HOME/.kwok/clusters/<cluster-name>/kubeconfig.yaml
$KWOK_KUBECTL --kubeconfig=$KUBECONFIG <command>
```

**Warning**: Do NOT assume a fixed path like `~/.kwok/clusters/<name>/bin/kubectl` — the binary location varies by kwokctl version and platform. The `find` command is the only reliable discovery method.

If `find` returns empty, the cluster may not have finished downloading binaries — wait and retry.

### Namespace-First Apply (MANDATORY)
`kubectl apply -f kubernetes/` processes files alphabetically. Namespace must be applied first:
```bash
$KUBECTL --kubeconfig $KUBECONFIG apply -f kubernetes/namespace.yaml && sleep 2
$KUBECTL --kubeconfig $KUBECONFIG apply -f kubernetes/
```
If namespace.yaml does not exist, skip this step.

### 00-namespace.yaml Naming Convention

**Always name the Namespace manifest `00-namespace.yaml`** so it sorts first alphabetically when using `kubectl apply -f kubernetes/`. This prevents "namespace not found" errors caused by ConfigMap/Deployment manifests sorting before `namespace.yaml`.

**Source:** kubectl apply -f directory applies manifests in alphabetical order — https://kubernetes.io/docs/reference/kubectl/generated/kubectl/

**Two-step apply is STILL required for KWOK validation** (belt-and-suspenders):
```bash
kubectl apply -f kubernetes/00-namespace.yaml && sleep 2
kubectl apply -f kubernetes/
```

## Post-kubeconform Placement Assertions

**Purpose:** kubeconform validates schema structure but does NOT catch field misplacement or semantic errors that cause silent runtime failures.

**When to run:** Immediately after `kubeconform -strict` passes (Tier 2).

**Assertion 1 — CronJob activeDeadlineSeconds location:**
```python
import yaml
from pathlib import Path
for f in Path('kubernetes').glob('*.yaml'):
    with open(f) as fh:
        for doc in yaml.safe_load_all(fh):
            if doc and doc.get('kind') == 'CronJob':
                if 'activeDeadlineSeconds' in doc.get('spec', {}):
                    print(f'FAIL: {f} — activeDeadlineSeconds at spec root (must be spec.jobTemplate.spec)')
                jt_spec = doc.get('spec', {}).get('jobTemplate', {}).get('spec', {})
                if 'activeDeadlineSeconds' in jt_spec:
                    print(f'OK: {f} — activeDeadlineSeconds correctly placed')
```

**Assertion 2 — Secret keys with dots (envFrom incompatible):**
```python
import yaml
from pathlib import Path
for f in Path('kubernetes').glob('*.yaml'):
    with open(f) as fh:
        for doc in yaml.safe_load_all(fh):
            if doc and doc.get('kind') == 'Secret':
                for k in list(doc.get('stringData', {}).keys()) + list(doc.get('data', {}).keys()):
                    if '.' in k or '/' in k:
                        print(f'WARNING: {f} — key "{k}" contains dots/slashes, will be skipped by envFrom')
                        print(f'  → Use explicit env[].valueFrom.secretKeyRef with a SCREAMING_SNAKE name')
```

**Rule:** If Assertion 2 finds dotted keys, switch affected keys from envFrom bulk injection to per-key `valueFrom.secretKeyRef` with valid env var names (SCREAMING_SNAKE_CASE).

## KWOK Binary Runtime Fallback (Tier 3) — Canonical 5-Step Procedure

**Purpose:** When Minikube, kind, and k3s all fail (no container runtime, kernel too old, restricted environment), KWOK provides API-server-only validation using pre-compiled Kubernetes binaries without any container runtime.

**When to run:** During Tier 3 validation attempts, after k3s also fails. KWOK is the lightest option — Linux-only, no container runtime required.

**Tier 3 fallback chain (ordered):** Minikube → kind → k3s → KWOK

**Preconditions:** Linux environment, curl available, /tmp writable.

### KWOK Tier 3 Independence from Tier 1

The Tier 1 (Docker build) prerequisite for Tier 3 applies to Minikube/kind/k3s — which require a built container image. For KWOK `--runtime=binary`, Tier 3 can proceed **regardless of Tier 1 status** because KWOK validates only Kubernetes API acceptance (schema, selectors, resource relationships), not container execution. When Tier 1 is SKIPPED but KWOK is available, proceed directly to KWOK validation.

### Namespace Ordering (MANDATORY)

`kubectl apply -f kubernetes/` processes files alphabetically. Files like `configmap.yaml` or `deployment.yaml` sort before `namespace.yaml`, causing "namespace not found" errors when resources target a custom namespace.

**ALWAYS apply namespace.yaml FIRST in a separate kubectl command with sleep 2 before applying remaining manifests:**
```bash
$KUBECTL --kubeconfig $KUBECONFIG apply -f kubernetes/namespace.yaml && sleep 2
$KUBECTL --kubeconfig $KUBECONFIG apply -f kubernetes/
```

**If namespace.yaml does not exist** (all resources target pre-existing namespaces like `default`), skip this step.

**Alternative**: Rename the namespace file to `00-namespace.yaml` so it sorts first alphabetically. However, the two-step apply is the REQUIRED procedure for KWOK validation because it is guaranteed to work regardless of file naming.

**Source:** kubectl processes directory contents alphabetically (https://www.baeldung.com/ops/kubectl-entire-directory — "kubectl will recurse over each file in the directory").

### Anti-Patterns (DO NOT USE)

1. **DO NOT use `kwokctl kubectl --` passthrough** — it drops subcommand arguments, outputs kubectl help text, and exits 0 (false success). Always use standalone kubectl with explicit kubeconfig.
2. **DO NOT use `kwokctl version`** — this subcommand does not exist in v0.7.0 and produces unhelpful output.
3. **DO NOT rely on `kwokctl kubectl --name=<cluster>` subcommands** — the `--name` flag defaults to 'kwok' regardless of the specified cluster name (https://kwok.sigs.k8s.io/docs/generated/kwokctl/ — `--name string cluster name (default "kwok")`). Example: `kwokctl kubectl --name=validation get pods` silently targets the 'kwok' cluster, NOT 'validation'. Always use the bundled kubectl binary at `~/.kwok/clusters/<name>/bin/kubectl` with explicit `--kubeconfig` — never `kwokctl kubectl` subcommands.

### Canonical Procedure

```bash
# Step 1: Download kwokctl
curl -Lo /tmp/kwokctl "https://github.com/kubernetes-sigs/kwok/releases/download/v0.7.0/kwokctl-linux-amd64"
chmod +x /tmp/kwokctl

# Step 2: Create cluster with binary runtime (no Docker/containerd needed)
/tmp/kwokctl create cluster --name validation --runtime binary
sleep 3  # API server needs ~2-3s to become ready after cluster creation

# Step 3: Extract kubeconfig and locate bundled kubectl via find (PRIMARY method)
export KUBECONFIG=~/.kwok/clusters/validation/kubeconfig.yaml
KUBECTL=$(find $HOME/.kwok/cache -name kubectl -type f | head -1)
# If KUBECTL is empty, wait 5s and retry — cluster may still be downloading binaries
[ -z "$KUBECTL" ] && sleep 5 && KUBECTL=$(find $HOME/.kwok/cache -name kubectl -type f | head -1)

# Step 4: Apply manifests using standalone kubectl — Namespace FIRST (MANDATORY)
$KUBECTL --kubeconfig $KUBECONFIG apply -f kubernetes/namespace.yaml && sleep 2
$KUBECTL --kubeconfig $KUBECONFIG apply -f kubernetes/

# Step 5: Verify resources accepted by API server
$KUBECTL --kubeconfig $KUBECONFIG get all -n <namespace>
```

**Cluster name verification**: Before Step 3, confirm cluster was created:
```bash
/tmp/kwokctl get clusters
# Expected output includes "validation"
```

**What KWOK validates:** Kubernetes API server schema validation (equivalent to kubeconform but using the real API server), resource relationships (Service→Deployment selector resolution), RBAC, ConfigMap/Secret references. Pods will show as "Running" (KWOK simulates node/pod lifecycle) but NO actual containers execute.

**What KWOK does NOT validate:** Container image existence, Dockerfile correctness, actual application startup, volume mounts, network connectivity. These require Tier 1 (Docker build) which should have already passed.

**Abort criteria:** If kwokctl fails to create cluster (e.g., binary download fails, Linux version too old), abort Tier 3 entirely. Tier 2 (kubeconform) is sufficient.

**Cleanup:**
```bash
/tmp/kwokctl delete cluster --name validation
```

**Source:** https://kwok.sigs.k8s.io/docs/user/kwokctl-platform-specific-binaries/ — "When running kwokctl with binary runtime (kwokctl create cluster --runtime=binary), kwokctl will download Kubernetes binaries from dl.k8s.io and use them to create cluster. Only works on Linux."
