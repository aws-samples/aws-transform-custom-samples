# Java Application AWS Graviton (ARM64) Compatibility Validation

## Objective
Validate and ensure Java application compatibility with AWS Graviton (ARM64) architecture by identifying incompatibilities, verifying native library support, and testing on ARM64 container images. This transformation focuses exclusively on ARM64 compatibility validation and does NOT manage Java version upgrades or general dependency modernization.

## Summary
This transformation validates a Java application's readiness to run on AWS Graviton instances by identifying architecture-specific incompatibilities, analyzing native library dependencies, verifying ARM64 support in critical dependencies, and testing the application on ARM64 container images. The process includes comprehensive compatibility checks, native library validation with a tiered failure policy, and performance verification on ARM64 architecture.

## Entry Criteria
1. Java application currently running on x86 architecture
2. Source code and build scripts must be available and accessible
3. Current Java version documented (must be compatible with ARM64 - typically JDK 8+)
4. Build and deployment configurations (Maven/Gradle files, Dockerfiles if containerized, CI/CD pipelines)
5. Access to ARM64 build/test environment (Graviton EC2 instances) or ARM64 container images
6. Complete dependency list with current versions for ARM64 compatibility analysis
7. Existing test suite that can be executed on ARM64 architecture

## Implementation Steps

**CRITICAL:** Java version changes are not in scope for this transformation process. Refer the user to AWS Transform Java version upgrade Transformation Definitions if a version change is required for any reason.

**CRITICAL:** It is out of scope to perform code refactoring.

**CRITICAL:** .gitignore and .dockerignore files must not be created or changed. Our purpose is to leave application code original.

**IMPORTANT:** Executing build commands and unit tests requires Arm64 execution environment. If the execution environment is on x86, we can identify compatibility issues but cannot fully test the package. Users should execute the Transformation on a Graviton instance or alternate Arm64 environment for best results.

### Documentation Setup

**IMPORTANT:** Before beginning Phase 1, create the standard output folder structure. All transformation documentation MUST follow the canonical structure defined in `documentation-standards.md`. Refer to that document for required sections and content templates for each file.

```bash
mkdir -p graviton-validation/raw
```

The following files will be produced during this transformation:

| File | Created During | Purpose |
|------|---------------|---------|
| `graviton-validation/01-project-assessment.md` | Phase 1.1, 1.5 | Project structure, deployment type, Java environment |
| `graviton-validation/02-native-library-report.md` | Phase 1.2, updated 2.1 | Native library scan results and resolutions |
| `graviton-validation/03-dependency-compatibility-report.md` | Phase 1.3, updated 2.2 | Per-dependency ARM64 compatibility verdicts |
| `graviton-validation/04-code-scan-findings.md` | Phase 1.4, updated 2.3 | Architecture-specific code patterns |
| `graviton-validation/05-jvm-configuration.md` | Phase 2.5 | Graviton JVM flags and validation |
| `graviton-validation/06-build-test-results.md` | Phase 3.0–3.3 | Build attempts, test results, startup checks |
| `graviton-validation/raw/dependency-tree-full.txt` | Phase 1.1 | Raw dependency tree output |
| `graviton-validation/raw/dependency-tree-native.txt` | Phase 1.3 | Filtered native-artifact tree |
| `graviton-validation/00-summary.md` | End of Phase 3 | Executive summary and exit criteria checklist |

### Phase 1: Static Compatibility Analysis

#### 1.1 Project Structure Analysis

> **Output → `graviton-validation/01-project-assessment.md`** (Deployment Type, Project Structure, Component Risk sections)
> **Output → `graviton-validation/raw/dependency-tree-full.txt`**

1. **Determine Deployment Type:**
   - Check for Dockerfile or container configuration → **Containerized deployment**
   - Check for systemd/init scripts or direct JAR/WAR deployment → **Host-based deployment**
   - Document deployment type to guide validation approach in Phase 3
   - Note: Some applications may support both deployment types

2. **Detect Multi-Module Project Structure:**
   - Check for multi-module Maven project (parent POM with `<modules>` section)
   - Check for multi-module Gradle project (`settings.gradle` or `settings.gradle.kts` with `include` directives)
   - If multi-module: enumerate all submodules and analyze each independently
   - Generate the full dependency tree to capture transitive dependencies:
     ```bash
     # Maven - full dependency tree across all modules
     mvn dependency:tree -DoutputType=text > graviton-validation/raw/dependency-tree-full.txt

     # Gradle - dependencies for all subprojects
     ./gradlew dependencies --configuration runtimeClasspath > graviton-validation/raw/dependency-tree-full.txt
     # Or for a specific subproject:
     # ./gradlew :submodule-name:dependencies --configuration runtimeClasspath
     ```
   - Native libraries and architecture-sensitive code may reside in child modules; do NOT limit analysis to the root build file alone

3. Identify key components requiring ARM64 validation:
   - Java source code files with architecture-specific logic
   - Build configuration files (Maven/Gradle) — including all submodule build files
   - Native libraries and JNI components
   - Deployment scripts and container configurations
   - Architecture-specific code blocks

4. Categorize components by ARM64 compatibility risk:
   - **CRITICAL**: Native code (JNI/JNA), .so files, architecture-specific optimizations
   - **HIGH**: Dependencies with known x86-only versions, crypto libraries
   - **MEDIUM**: Build configurations, deployment scripts, architecture detection code
   - **LOW**: Pure Java code without architecture dependencies

#### 1.2 Native Library Validation (.so File Analysis)

> **Output → `graviton-validation/02-native-library-report.md`** (Statically Bundled, Runtime-Extracted, Resolution Details sections)

Native libraries that are incompatible with ARM64 can exist in two forms: **statically bundled** inside JAR files, and **dynamically extracted at runtime** by libraries such as JNA, Netty, or JNR. Both forms must be validated.

##### 1.2.1 Statically Bundled .so File Scanning

1. Scan all JAR files for native libraries, including nested JARs inside fat/uber JARs:
   ```bash
   # Create a temporary working directory for safe extraction
   tmpdir=$(mktemp -d)
   trap "rm -rf $tmpdir" EXIT

   # For standard JARs
   for jar in $(find . -name "*.jar" -not -path "*/build/*" -not -path "*/target/*"); do
     echo "=== Scanning: $jar ==="
     unzip -l "$jar" 2>/dev/null | grep "\.so$"
   done

   # For Spring Boot fat JARs (nested JARs inside BOOT-INF/lib/)
   for jar in $(find . -name "*.jar" -not -path "*/build/*" -not -path "*/target/*"); do
     nested=$(unzip -l "$jar" 2>/dev/null | grep "BOOT-INF/lib/.*\.jar$" | awk '{print $NF}')
     if [ -n "$nested" ]; then
       echo "=== Fat JAR detected: $jar ==="
       unzip -q "$jar" -d "$tmpdir/fatjar" 2>/dev/null
       for nested_jar in $(find "$tmpdir/fatjar/BOOT-INF/lib" -name "*.jar" 2>/dev/null); do
         so_files=$(unzip -l "$nested_jar" 2>/dev/null | grep "\.so$")
         if [ -n "$so_files" ]; then
           echo "--- Nested JAR: $(basename $nested_jar) ---"
           echo "$so_files"
         fi
       done
       rm -rf "$tmpdir/fatjar"
     fi
   done

   # For Maven Shade plugin uber JARs - scan the JAR directly
   # (shaded JARs flatten everything into a single JAR, so the standard scan above covers them)

   # Validate architecture of any discovered .so files
   for jar in $(find . -name "*.jar" -not -path "*/build/*" -not -path "*/target/*"); do
     unzip -q "$jar" -d "$tmpdir/extract" 2>/dev/null
     find "$tmpdir/extract" -name "*.so" -exec file {} \;
     rm -rf "$tmpdir/extract"
   done
   ```

   **Fat/Uber JAR Types to Handle:**
   - **Spring Boot fat JARs:** Native libs in nested JARs under `BOOT-INF/lib/`
   - **Maven Shade plugin:** Flattened into single JAR; standard scan is sufficient
   - **Gradle Shadow plugin:** Same as Maven Shade — flattened structure
   - **WAR files:** Check `WEB-INF/lib/` for nested JARs containing native code

##### 1.2.2 Runtime-Extracted Native Library Detection

Some libraries do not bundle `.so` files in their JARs but instead extract or download architecture-specific native code at runtime. These must be identified through code and dependency analysis.

1. Scan source code and dependencies for runtime native extraction patterns:
   ```bash
   # Search for runtime native library loading patterns in source code
   grep -rn "Native.load\|Native.loadLibrary\|System.loadLibrary\|System.load(" \
     --include="*.java" src/ || true

   # Search for JNR (Java Native Runtime) usage
   grep -rn "jnr\.\|LibraryLoader" --include="*.java" src/ || true

   # Check build files for dependencies known to extract native code at runtime
   grep -n "netty-transport-native\|netty-tcnative\|io.grpc.*netty\|conscrypt\|jnr-ffi\|jnr-posix\|leveldbjni\|rocksdbjni\|sqlite-jdbc\|lz4-java\|zstd-jni\|snappy-java" \
     pom.xml build.gradle build.gradle.kts 2>/dev/null || true
   ```

2. **Common libraries that extract native code at runtime:**
   - **Netty** (`netty-transport-native-epoll`, `netty-tcnative`): Extracts `.so` from JAR at runtime based on `os.arch`
   - **Conscrypt:** TLS provider that loads native crypto libraries at runtime
   - **RocksDB** (`rocksdbjni`): Extracts platform-specific `.so` at first use
   - **SQLite JDBC** (`sqlite-jdbc`): Bundles and extracts native SQLite library
   - **LZ4/Zstd/Snappy** (`lz4-java`, `zstd-jni`, `snappy-java`): Compression libraries with native accelerators
   - **LevelDB** (`leveldbjni`): Native key-value store bindings

3. For each runtime-extracting dependency identified:
   - Check if the current version includes ARM64/aarch64 native binaries in its published JAR
   - If ARM64 binaries are missing: flag as MUST UPGRADE in Phase 1.3
   - If a pure Java fallback exists (e.g., Netty's NIO transport vs. native epoll): document the fallback option
   - If no fallback and no ARM64 support: flag as blocking

##### 1.2.3 Tiered Validation Policy

2. Implement tiered validation policy for .so files (both bundled and runtime-extracted):

   **FAIL immediately if:**
   - .so file shows "x86-64" or "x86_64" architecture only
   - AND no ARM64 version exists in the JAR (no aarch64/arm64 directory)
   - AND source code is not available in the project
   - AND user cannot provide ARM64-compatible version
   
   **WARN but allow to proceed if:**
   - Multi-architecture JAR contains both x86 and ARM64 .so files
   - Pure Java fallback implementation exists for the native functionality
   - .so file source code is available for ARM64 recompilation
   
   **PASS if:**
   - .so file shows "ARM aarch64" architecture
   - JAR contains .so files in both `/linux/amd64/` and `/linux/aarch64/` directories

3. For each x86-only .so file requiring resolution:
   - Check if source code exists in project repository
   - If source available: Document recompilation requirements
   - If source unavailable: Prompt user for ARM64-compatible version
   - Validate any provided .so file is ARM64 architecture:
     ```bash
     file libname.so  # Must show "ARM aarch64"
     ```

#### 1.3 Dependency ARM64 Compatibility Analysis

> **Output → `graviton-validation/03-dependency-compatibility-report.md`** (all sections)
> **Output → `graviton-validation/raw/dependency-tree-native.txt`**

**IMPORTANT: Transitive Dependency Analysis**

ARM64-incompatible native code can be introduced through transitive dependencies — a direct dependency that is pure Java may pull in a transitive dependency containing native code. The analysis must cover the full dependency tree, not just direct dependencies.

1. Generate and inspect the full transitive dependency tree, saving the filtered output:
   ```bash
   # Maven - filter for known native-code artifacts
   mvn dependency:tree -Dincludes=net.java.dev.jna,io.netty,org.xerial.snappy,org.lz4,com.github.luben,org.rocksdb,org.xerial,org.conscrypt,com.google.protobuf \
     > graviton-validation/raw/dependency-tree-native.txt

   # Gradle - search runtime classpath for native artifacts
   ./gradlew dependencies --configuration runtimeClasspath | grep -E "jna|netty-transport-native|snappy|lz4|zstd|rocksdb|sqlite|conscrypt|protobuf|jnr|leveldbjni" \
     > graviton-validation/raw/dependency-tree-native.txt
   ```

2. Analyze each dependency (direct AND transitive) for ARM64 compatibility (NOT general version upgrades):
   - Identify current version in use
   - Check if current version supports ARM64/aarch64
   - Identify first version with ARM64 support (if current lacks it)
   - Flag dependencies with known ARM64 issues in current version
   - For transitive dependencies: identify which direct dependency pulls it in, as the resolution may require updating the parent dependency

3. Create compatibility report with three categories:
   
   **MUST UPGRADE (Blocking):**
   - Current version < first ARM64-compatible version
   - Dependency contains x86-only native code (direct or transitive)
   - Known critical ARM64 bugs in current version
   
   **RECOMMENDED UPGRADE (Non-blocking):**
   - Current version has ARM64 support but with known performance issues
   - Newer version has ARM64-specific optimizations
   - Newer version has ARM64 bug fixes
   
   **COMPATIBLE (No action needed):**
   - Current version fully supports ARM64
   - No known ARM64 issues
   - Pure Java dependency with no architecture dependencies (direct or transitive)

4. Document findings:
   ```
   Dependency: net.java.dev.jna:jna
   Current Version: 5.6.0
   Status: MUST UPGRADE
   Reason: Version 5.6.0 lacks ARM64 native libraries
   Minimum ARM64 Version: 5.8.0
   Recommended Version: 5.14.0 (includes ARM64 optimizations)

   Dependency: org.xerial.snappy:snappy-java (transitive via org.apache.kafka:kafka-clients)
   Current Version: 1.1.7.3
   Status: MUST UPGRADE
   Reason: Version 1.1.7.3 lacks linux-aarch64 native binary
   Minimum ARM64 Version: 1.1.8.1
   Resolution: Update snappy-java version via dependency management or exclusion+re-add
   ```

#### 1.4 Architecture-Specific Code Detection

> **Output → `graviton-validation/04-code-scan-findings.md`** (Architecture Detection Patterns, JNI/JNA Usage sections)

1. Scan source code for architecture detection patterns:
   ```java
   System.getProperty("os.arch")
   System.getProperty("os.name")
   Native.load()
   System.loadLibrary()
   ```

2. Identify code blocks that:
   - Check for "amd64" or "x86_64" without "aarch64" handling
   - Load native libraries without architecture-aware paths
   - Contain x86-specific optimizations or assumptions

3. Flag JNI/JNA usage requiring ARM64 validation

#### 1.5 Java Version Compatibility Check

> **Output → `graviton-validation/01-project-assessment.md`** (Java Environment section)

1. Document current Java version in use
2. Document current JDK distribution (e.g., OpenJDK, Eclipse Temurin, Amazon Corretto, Azul Zulu, etc.)
3. Verify Java version has ARM64 support:
   - JDK 8: Supported (with limitations)
   - JDK 11+: Fully supported and recommended
4. Flag if current version has known Graviton compatibility issues
5. **CRITICAL:** Document both the current Java VERSION and JDK DISTRIBUTION (e.g., "OpenJDK 21", "Corretto 17", "Temurin 11")
6. **DO NOT change the JDK distribution** - if using OpenJDK, keep OpenJDK; if using Temurin, keep Temurin, etc.
7. **DO NOT change the Java version** (no upgrades or downgrades) - maintain the exact major version currently in use
8. All major JDK distributions support ARM64 for Java 8+, so distribution changes are NOT required for ARM64 compatibility

### Phase 2: Compatibility Resolution

#### 2.1 Native Library Resolution

> **Output → update `graviton-validation/02-native-library-report.md`** (Resolution Details, Pure Java Fallbacks sections)

1. For each x86-only .so file identified in Phase 1:
   
   **If source code available:**
   - Set up ARM64 build environment
   - Compile for ARM64/aarch64:
     ```bash
     # Cross-compilation
     CC=aarch64-linux-gnu-gcc make
     
     # Or on ARM64 machine
     make CFLAGS="-march=armv8-a"
     ```
   - Verify compiled library:
     ```bash
     file libname.so  # Should show "ARM aarch64"
     ```
   - Place in appropriate project location
   
   **If source code unavailable:**
   - Prompt user: "The shared library [name.so] is compiled for x86 and source is not available. Please provide ARM64-compatible version or confirm pure Java fallback exists."
   - Validate provided .so file architecture
   - Document if pure Java fallback will be used

2. Update native library loading logic:
   ```java
   // Add ARM64 support to existing x86 code
   String arch = System.getProperty("os.arch");
   String libName;
   
   if ("aarch64".equals(arch)) {
       libName = "libchatbot-arm64.so";
   } else if ("amd64".equals(arch) || "x86_64".equals(arch)) {
       libName = "libchatbot-amd64.so";
   } else {
       throw new UnsupportedOperationException("Unsupported architecture: " + arch);
   }
   
   try {
       nativeLib = (NativeLib) Native.load(libName, NativeLib.class);
   } catch (UnsatisfiedLinkError e) {
       logger.warn("Native library not available, using Java fallback", e);
       // Use pure Java implementation
   }
   ```

#### 2.2 Dependency Compatibility Updates

> **Output → update `graviton-validation/03-dependency-compatibility-report.md`** (Applied Version column in MUST UPGRADE table, Transitive Dependency Resolutions section)

1. Update ONLY dependencies flagged as "MUST UPGRADE" in Phase 1:
   ```xml
   <!-- Example: Update JNA for ARM64 support -->
   <dependency>
       <groupId>net.java.dev.jna</groupId>
       <artifactId>jna</artifactId>
       <version>5.14.0</version> <!-- Minimum 5.8.0 for ARM64 -->
   </dependency>
   ```

2. For transitive dependencies requiring ARM64-compatibility updates:
   ```xml
   <!-- Option A: Override transitive version via dependencyManagement -->
   <dependencyManagement>
       <dependencies>
           <dependency>
               <groupId>org.xerial.snappy</groupId>
               <artifactId>snappy-java</artifactId>
               <version>1.1.10.5</version> <!-- ARM64-compatible version -->
           </dependency>
       </dependencies>
   </dependencyManagement>

   <!-- Option B: Exclude and re-add with ARM64-compatible version -->
   <dependency>
       <groupId>org.apache.kafka</groupId>
       <artifactId>kafka-clients</artifactId>
       <version>${kafka.version}</version>
       <exclusions>
           <exclusion>
               <groupId>org.xerial.snappy</groupId>
               <artifactId>snappy-java</artifactId>
           </exclusion>
       </exclusions>
   </dependency>
   <dependency>
       <groupId>org.xerial.snappy</groupId>
       <artifactId>snappy-java</artifactId>
       <version>1.1.10.5</version>
   </dependency>
   ```

   For Gradle projects:
   ```groovy
   // Force a specific version of a transitive dependency
   configurations.all {
       resolutionStrategy {
           force 'org.xerial.snappy:snappy-java:1.1.10.5'
       }
   }
   ```

3. For dependencies without ARM64 support:
   - Identify pure Java alternatives
   - Document replacement options
   - Implement alternative if feasible

4. **DO NOT upgrade** dependencies that are already ARM64-compatible

#### 2.3 Architecture Detection Code Updates

> **Output → update `graviton-validation/04-code-scan-findings.md`** (Changes Applied section)

1. Update architecture checks to handle ARM64:
   ```java
   // Before
   if (System.getProperty("os.arch").equals("amd64")) {
       // x86-specific code
   }
   
   // After
   String arch = System.getProperty("os.arch");
   if ("aarch64".equals(arch)) {
       // ARM64-specific code path
   } else if ("amd64".equals(arch) || "x86_64".equals(arch)) {
       // x86-specific code
   } else {
       // Generic fallback
   }
   ```

2. Ensure all architecture-dependent code paths include ARM64 handling

#### 2.4 Build Configuration Updates
1. Update Maven/Gradle for ARM64 support:
   ```xml
   <!-- Add ARM64 profile -->
   <profiles>
       <profile>
           <id>arm64</id>
           <activation>
               <os><arch>aarch64</arch></os>
           </activation>
           <properties>
               <native.arch>aarch64</native.arch>
           </properties>
       </profile>
   </profiles>
   ```

2. **For containerized deployments:** Update Dockerfile for ARM64 multi-architecture support:

   **Single-stage Dockerfiles:**
   ```dockerfile
   # IMPORTANT: Maintain the current base image and Java version if base image has no cpu architecture tags as it is multi-arch
   FROM --platform=$BUILDPLATFORM <current-base-image>:<current-version>
   
   # Example: If currently using openjdk:21, keep it:
   # FROM --platform=$BUILDPLATFORM openjdk:21
   # 
   # Example: If currently using eclipse-temurin:17, keep it:
   # FROM --platform=$BUILDPLATFORM eclipse-temurin:17
   
   # Install architecture-specific packages
   RUN apt-get update -y && \
       apt-get install -y package-name
   ```

   **Multi-stage Dockerfiles:**
   
   Many Java applications use multi-stage Docker builds (builder stage + runtime stage). Each stage requires correct platform annotation:
   ```dockerfile
   # Builder stage: uses BUILDPLATFORM so build tools run natively on the host
   FROM --platform=$BUILDPLATFORM <current-builder-image>:<current-version> AS builder

   # Example: If currently using maven:3.9-eclipse-temurin-17, keep it:
   # FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-17 AS builder

   WORKDIR /app
   COPY . .
   RUN mvn clean package -DskipTests

   # Runtime stage: uses TARGETPLATFORM so the final image runs on ARM64
   FROM --platform=$TARGETPLATFORM <current-runtime-image>:<current-version>

   # Example: If currently using eclipse-temurin:17-jre, keep it:
   # FROM --platform=$TARGETPLATFORM eclipse-temurin:17-jre

   COPY --from=builder /app/target/*.jar app.jar
   ENTRYPOINT ["java", "-jar", "app.jar"]
   ```

   **Key distinction for multi-stage builds:**
   - **Builder stage** (`AS builder`): Use `--platform=$BUILDPLATFORM` — the build tools (Maven/Gradle, javac) should run natively on the host architecture for speed
   - **Runtime stage** (final `FROM`): Use `--platform=$TARGETPLATFORM` — the final image must target ARM64
   - If the original Dockerfile has no `--platform` annotations on any stage, add them following this pattern
   - If the original Dockerfile is single-stage, use `--platform=$BUILDPLATFORM` as shown above

   **Base Image Selection:** 
   - **PRESERVE the current JDK distribution and version** (e.g., openjdk:21, eclipse-temurin:17, etc.)
   - Do NOT change the JDK distribution or version unless specifically required for ARM64 compatibility
   - Amazon Corretto MAY be suggested as an optional consideration for new deployments due to AWS-specific optimizations and Graviton testing, but is NOT required
   - All major JDK distributions (OpenJDK, Eclipse Temurin, Amazon Corretto, etc.) support ARM64 for Java 8+

3. **For host-based deployments:** Skip Docker configuration steps

4. Configure CI/CD for ARM64 builds:
   - Add ARM64 build agents or use emulation (for containerized deployments)
   - Update build scripts to handle architecture parameter
   - Configure artifact publishing for both architectures

#### 2.5 Graviton-Specific JVM Optimizations

> **Output → `graviton-validation/05-jvm-configuration.md`** (all sections)

Apply Graviton-optimized JVM flags based on the application's Java version. Not all flags are valid across all JDK versions; applying an unsupported flag will cause JVM startup failures.

**JDK 11 on Graviton:**
```bash
# For workloads with moderate lock contention
-XX:-TieredCompilation
-XX:ReservedCodeCacheSize=64M
-XX:InitialCodeCacheSize=64M

# For cryptographic workloads
-XX:+UnlockDiagnosticVMOptions
-XX:+UseAESCTRIntrinsics

# For multi-threaded applications (reduce stack size from 2MB default)
-Xss1m
```

**JDK 17 on Graviton:**
```bash
# Compiler tuning for Graviton
-XX:CICompilerCount=2
-XX:CompilationMode=high-only

# For workloads with moderate lock contention
-XX:-TieredCompilation
-XX:ReservedCodeCacheSize=64M
-XX:InitialCodeCacheSize=64M

# For cryptographic workloads
-XX:+UnlockDiagnosticVMOptions
-XX:+UseAESCTRIntrinsics

# For multi-threaded applications
-Xss1m
```

**JDK 21+ on Graviton:**
```bash
# For workloads with moderate lock contention
-XX:-TieredCompilation
-XX:ReservedCodeCacheSize=64M
-XX:InitialCodeCacheSize=64M

# For multi-threaded applications
-Xss1m

# NOTE: -XX:+UseAESCTRIntrinsics is enabled by default in JDK 21+ and does not need
# to be set explicitly. Setting it with -XX:+UnlockDiagnosticVMOptions is harmless but unnecessary.
# NOTE: -XX:CompilationMode was removed in some JDK 21+ builds. Test before applying.
```

**IMPORTANT:** Always verify flags are accepted by the target JVM before committing them:
```bash
# Test that all flags are valid (will exit with error if any flag is unrecognized)
java <flags> -version
```

2. Document JVM flag changes and expected performance impact

3. Create configuration profiles for different workload types

### Phase 3: ARM64 Validation & Testing

#### 3.0 Build Environment Preparation

> **Output → `graviton-validation/06-build-test-results.md`** (Build Environment, Build Environment Notes sections)

**Note:** Supported Platforms are 
* Linux - Full support for all Linux distributions
* macOS - Full support for macOS systems
* Windows Subsystem for Linux (WSL) - Full support when running under WSL

**CRITICAL: Java Runtime Alignment for Build Tooling Compatibility**

Before executing build commands, verify that the active Java runtime is compatible with build-time tooling (annotation processors, compiler plugins, etc.) to avoid version-specific compatibility issues.

**Background:**
- Build-time tools (e.g., Lombok, annotation processors) may not support the latest Java compiler versions
- Runtime compatibility (ability to run bytecode) ≠ Compile-time tooling compatibility
- Example: Lombok 1.18.34 works with Java 17-21 but fails with Java 25 compiler internals
- This is environment management, NOT a code or dependency change

**Common Annotation Processors with Java Version Sensitivities:**
- **Lombok:** Versions before 1.18.36 don't support Java 25
- **MapStruct:** Versions before 1.5.0 may have issues with Java 17+
- **Dagger:** Versions before 2.40 may have Java 16+ issues
- **Auto-value:** Generally compatible but check version for Java 21+

**If build fails with annotation processor errors:**
1. Identify the processor: Check `<annotationProcessorPaths>` in pom.xml or `annotationProcessor` in build.gradle
2. Check processor version compatibility with current Java runtime
3. Apply Java version alignment from this section using compatible runtime
4. Document the specific processor and version requiring aligned runtime

**Detection and Temporary Adjustment:**

1. **Check current Java runtime:**
   ```bash
   java -version
   ```

2. **Detect project target version:**
   ```bash
   # Maven projects
   PROJECT_TARGET=$(grep -oP '(?<=<release>)[0-9]+' pom.xml 2>/dev/null || \
                    grep -oP '(?<=<target>)[0-9]+' pom.xml 2>/dev/null || \
                    grep -oP '(?<=<java.version>)[0-9]+' pom.xml 2>/dev/null)
   
   # Gradle projects - check multiple formats and files
   if [ -z "$PROJECT_TARGET" ]; then
     # Check build.gradle (Groovy DSL)
     PROJECT_TARGET=$(grep -oP 'sourceCompatibility\s*[=:]\s*['\''"]?\K[0-9]+' build.gradle 2>/dev/null || \
                      grep -oP 'targetCompatibility\s*[=:]\s*['\''"]?\K[0-9]+' build.gradle 2>/dev/null || \
                      grep -oP 'JavaVersion\.VERSION_\K[0-9]+' build.gradle 2>/dev/null)
     
     # Check build.gradle.kts (Kotlin DSL) - including toolchain API
     if [ -z "$PROJECT_TARGET" ]; then
       PROJECT_TARGET=$(grep -oP 'sourceCompatibility\s*=\s*JavaVersion\.VERSION_\K[0-9]+' build.gradle.kts 2>/dev/null || \
                        grep -oP 'targetCompatibility\s*=\s*JavaVersion\.VERSION_\K[0-9]+' build.gradle.kts 2>/dev/null || \
                        grep -oP 'jvmToolchain\(\K[0-9]+' build.gradle.kts 2>/dev/null || \
                        grep -oP 'languageVersion\.set\(JavaLanguageVersion\.of\(\K[0-9]+' build.gradle.kts 2>/dev/null)
     fi

     # Check build.gradle (Groovy DSL) - toolchain API
     if [ -z "$PROJECT_TARGET" ]; then
       PROJECT_TARGET=$(grep -oP 'jvmToolchain\s*\(\s*\K[0-9]+' build.gradle 2>/dev/null || \
                        grep -oP 'languageVersion\s*=\s*JavaLanguageVersion\.of\(\K[0-9]+' build.gradle 2>/dev/null || \
                        grep -oP "languageVersion\.set\s*\(\s*JavaLanguageVersion\.of\s*\(\s*\K[0-9]+" build.gradle 2>/dev/null)
     fi
     
     # Check gradle.properties
     if [ -z "$PROJECT_TARGET" ]; then
       PROJECT_TARGET=$(grep -oP 'javaVersion\s*=\s*\K[0-9]+' gradle.properties 2>/dev/null)
     fi

     # Fallback: query Gradle directly (most reliable but requires Gradle wrapper)
     if [ -z "$PROJECT_TARGET" ] && [ -f "./gradlew" ]; then
       PROJECT_TARGET=$(./gradlew -q properties 2>/dev/null | grep -oP 'targetCompatibility:\s*\K[0-9]+' || true)
     fi
   fi
   
   echo "Project targets Java: $PROJECT_TARGET"
   ```

3. **If runtime version significantly exceeds target (e.g., Java 25 runtime with Java 17 target):**

   **macOS Systems:**
   ```bash
   # List available Java versions
   /usr/libexec/java_home -V
   
   # Switch to appropriate version for build session only (SAFE - session-scoped)
   # Use subshell to isolate environment change
   (
     export JAVA_HOME=$(/usr/libexec/java_home -v 21)
     java -version  # Verify switch
     ${BUILD_CMD} clean install  # Execute build using detected build command
   )
   # JAVA_HOME change does NOT persist after subshell exits
   ```

   **Linux Systems:**
   ```bash
   # List available Java versions
   update-alternatives --list java 2>/dev/null || \
   ls -1 /usr/lib/jvm/ 2>/dev/null || \
   ls -1 /usr/java/ 2>/dev/null
   
   # Find appropriate Java version path
   JAVA_21_HOME=$(find /usr/lib/jvm /usr/java -maxdepth 1 -type d -name "*java-21*" -o -name "*jdk-21*" -o -name "*corretto-21*" 2>/dev/null | head -1)
   JAVA_17_HOME=$(find /usr/lib/jvm /usr/java -maxdepth 1 -type d -name "*java-17*" -o -name "*jdk-17*" -o -name "*corretto-17*" 2>/dev/null | head -1)
   JAVA_11_HOME=$(find /usr/lib/jvm /usr/java -maxdepth 1 -type d -name "*java-11*" -o -name "*jdk-11*" -o -name "*corretto-11*" 2>/dev/null | head -1)
   
   # Use subshell for session-scoped change
   (
     if [ -n "$JAVA_21_HOME" ]; then
       export JAVA_HOME="$JAVA_21_HOME"
       echo "✓ Using Java 21: $JAVA_21_HOME"
     elif [ -n "$JAVA_17_HOME" ]; then
       export JAVA_HOME="$JAVA_17_HOME"
       echo "✓ Using Java 17: $JAVA_17_HOME"
     elif [ -n "$JAVA_11_HOME" ]; then
       export JAVA_HOME="$JAVA_11_HOME"
       echo "✓ Using Java 11: $JAVA_11_HOME"
     else
       echo "⚠️  No compatible Java LTS version found (11, 17, or 21)"
       echo "Using current Java: $(java -version 2>&1 | head -1)"
     fi
     export PATH="$JAVA_HOME/bin:$PATH"
     java -version  # Verify switch
     ${BUILD_CMD} clean install  # Execute build using detected build command
   )
   ```

   **SDKMAN (if installed - works on macOS and Linux):**
   ```bash
   # Check if SDKMAN is installed
   if [ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]; then
     source "$HOME/.sdkman/bin/sdkman-init.sh"
     
     # List available versions
     sdk list java
     
     # Use SDKMAN for session-scoped change
     (
       sdk use java 21.0.9-amzn  # Adjust version identifier as needed
       java -version
       ${BUILD_CMD} clean install
     )
   fi
   ```

   **WSL (Windows Subsystem for Linux):**
   ```bash
   # WSL uses standard Linux commands - same as Linux section above
   # List available Java versions
   update-alternatives --list java 2>/dev/null || \
   ls -1 /usr/lib/jvm/ 2>/dev/null
   
   # Find and use appropriate Java version (same as Linux)
   JAVA_21_HOME=$(find /usr/lib/jvm -maxdepth 1 -type d -name "*java-21*" -o -name "*jdk-21*" -o -name "*corretto-21*" 2>/dev/null | head -1)
   
   # Use subshell for session-scoped change
   (
     export JAVA_HOME="$JAVA_21_HOME"
     export PATH="$JAVA_HOME/bin:$PATH"
     java -version
     ${BUILD_CMD} clean install
   )
   ```
   
   **Note:** WSL2 provides full Linux environment. If running on Windows, use WSL2 for ARM64 compatibility validation rather than native Windows tools.

4. **Alternative safe approaches (works on all Unix-like systems):**
   ```bash
   # Single-command scope (also safe - works everywhere)
   JAVA_HOME=/path/to/java-21 ${BUILD_CMD} clean install
   
   # Temporary script (also safe)
   bash -c "export JAVA_HOME=/path/to/java-21; export PATH=\$JAVA_HOME/bin:\$PATH; ${BUILD_CMD} clean install"
   ```

**Safety Requirements:**

✅ **ALLOWED (Session-scoped only):**
- `export JAVA_HOME=...` within subshells `()`
- Single-command environment: `JAVA_HOME=... mvn build`
- Temporary shell scripts with `bash -c '...'`
- SDKMAN's `sdk use` command (session-scoped by design)

❌ **FORBIDDEN (Persistent changes):**
- Writing to user profile files: `~/.zshrc`, `~/.bash_profile`, `~/.bashrc`, `~/.profile`
- Modifying system defaults: `update-alternatives --set`, `alternatives --set`
- Any changes that survive beyond the transformation session
- Using SDKMAN's `sdk default` (makes permanent changes)

**Verification:**
After transformation completes, user's default `java -version` must match their pre-transformation environment.

**Recommended Java Version Selection:**
- Prefer Java 21 (latest LTS) for builds if available
- Fall back to Java 17 (prior LTS) if 21 unavailable
- Fall back to Java 11 (older LTS) if 17 unavailable
- Match project target version if within 1-2 major versions of latest LTS
- Avoid Java 22+ non-LTS versions unless specifically required

**If No Compatible Java Version Found:**
- Document the requirement: "Build requires Java [version] or Java 21/17/11 to avoid tooling compatibility issues"
- Provide installation commands for the target platform:
  ```bash
  # Amazon Corretto (recommended for Graviton)
  # macOS:
  brew install --cask corretto@21
  
  # Amazon Linux 2023 / RHEL / CentOS:
  sudo yum install java-21-amazon-corretto-devel
  
  # Ubuntu / Debian:
  wget -O- https://apt.corretto.aws/corretto.key | sudo apt-key add -
  sudo add-apt-repository 'deb https://apt.corretto.aws stable main'
  sudo apt-get update
  sudo apt-get install -y java-21-amazon-corretto-jdk
  ```
- Do NOT attempt to install Java automatically - prompt user and exit transformation

#### 3.1 ARM64 Build Validation

> **Output → `graviton-validation/06-build-test-results.md`** (Build Attempts, Test Failure Classification, Final Build sections)

**Prerequisites:** Java runtime environment aligned per Section 3.0 above

##### Build Validation Strategy

1. **First attempt**: Run full build with tests
   - Gradle: `./gradlew clean build`
   - Maven: `mvn clean install`

2. **If tests fail**, analyze root cause and classify:
   - `INFRA` - Infrastructure/environment dependency (missing DB, Docker, env vars)
   - `ARM64` - Architecture-related failure
   - `PRE-EXISTING` - Existed before migration

3. **If failures are INFRA or PRE-EXISTING** (not ARM64-related):
   - Document the test failures and root cause
   - Run build again without tests to validate compilation:
     - Gradle: `./gradlew clean build -x test`
     - Maven: `mvn clean install -DskipTests`
   - This becomes the **final build** for validation purposes

4. **If failures are ARM64-related**:
   - Do NOT skip tests
   - The build fails and requires resolution

**IMPORTANT:** The final build command in the conversation log determines the build score. If test failures are infrastructure-related, the final build should be the compilation-only build (`-x test` or `-DskipTests`).

##### Build Artifact Verification

1. Verify build artifacts:
   - All dependencies resolved successfully
   - Native libraries loaded correctly
   - No architecture-related build errors

2. **For containerized deployments:** Validate container image on ARM64:
      **IMPORTANT: Docker ENTRYPOINT Handling**

   Many Java application Dockerfiles use `ENTRYPOINT ["java", "-jar", "app.jar"]`. When running 
   validation commands like `java -version` or `./gradlew test`, you MUST override the entrypoint,
   otherwise your command arguments get appended to the entrypoint instead of replacing it.

   - ❌ Wrong: `docker run app:arm64 java -version` → runs `java -jar app.jar java -version`
   - ✅ Correct: `docker run --entrypoint java app:arm64 -version` → runs `java -version`

   Always use `--entrypoint <command>` when running validation commands against containers 
   that have an ENTRYPOINT defined.
   
   ```bash
   # Build for ARM64 architecture
   docker buildx build --platform linux/arm64 -t app:arm64 .
   # Or on ARM64 instance
   docker build -t app:arm64 .
   
   # Validate Java version and architecture
   # NOTE: Use --entrypoint to override Dockerfile ENTRYPOINT and run java directly
   docker run --rm --platform linux/arm64 --entrypoint java app:arm64 -version
   # Verify the output shows the SAME JDK distribution and version as the original application
   # Examples of valid outputs:
   #   - OpenJDK Runtime Environment (build 21.x.x)
   #   - OpenJDK Runtime Environment Corretto-17.x.x

   docker run --rm --platform linux/arm64 --entrypoint java app:arm64 -XshowSettings:properties -version 2>&1 | grep os.arch
   # Should show: os.arch = aarch64
   ```

3. **For host-based deployments:** Validate on ARM64 Graviton EC2 instance:
   ```bash
   # Verify Java installation
   java -version
   # Verify the output shows the SAME JDK distribution and version as the original application
   # Examples of valid outputs:
   #   - OpenJDK Runtime Environment (build 21.x.x)
   #   - OpenJDK Runtime Environment Corretto-17.x.x
   
   # Verify ARM64 architecture
   java -XshowSettings:properties -version | grep os.arch
   # Should show: os.arch = aarch64
   
   # Build application on ARM64 host
   ./gradlew build
   # or
   mvn clean package
   ```

#### 3.2 Functional Testing on ARM64

> **Output → update `graviton-validation/06-build-test-results.md`** (Test Failure Classification, Final Build sections)

1. **For containerized deployments:** Execute test suite in ARM64 container:
   ```bash
   # NOTE: Use --entrypoint to override Dockerfile ENTRYPOINT and run build tools directly
   docker run --rm --platform linux/arm64 --entrypoint ./gradlew app:arm64 test
   # or
   docker run --rm --platform linux/arm64 --entrypoint mvn app:arm64 test
   ```

2. **For host-based deployments:** Execute test suite on ARM64 Graviton EC2 instance:
   ```bash
   # Run tests with Gradle
   ./gradlew test

   # or with Maven
   mvn test
   ```

3. Verify test results:
   - Document all test results
   - If tests fail, classify by root cause (INFRA, ARM64, PRE-EXISTING)
   - ARM64-related failures are blocking
   - Infrastructure and pre-existing failures are non-blocking but must be documented

4. Test architecture-specific functionality:
   - Native library loading and execution
   - Cryptographic operations
   - File I/O and system calls
   - Multi-threading behavior

5. **Final build for scoring purposes:**
   - If all tests pass: The test build is the final build
   - If tests fail due to infrastructure/pre-existing issues: 
     - Gradle: Run `./gradlew clean build -x test` as the final build
     - Maven: Run `mvn clean install -DskipTests` as the final build
   - If tests fail due to ARM64 issues: Do not skip tests; the failing build is the final build

#### 3.3 Startup Validation

> **Output → update `graviton-validation/06-build-test-results.md`** (Startup Validation, Container Validation sections)

1. Verify application stability on ARM64:
   - Application starts without errors
   - JVM flags are accepted without errors
   - No immediate runtime crashes

2. Recommend to user for independent performance testing:
   - Conduct performance benchmarking based on their specific requirements
   - Compare against their baseline metrics if available
   - Test at production-like load levels
   - Measure response times, throughput, and resource utilization using their tools

### Phase 3 Completion: Write Summary

> **Output → `graviton-validation/00-summary.md`**

After all phases are complete, write the transformation summary. This file consolidates exit criteria status and references (not duplicates) the detail in files 01–06. See `documentation-standards.md` for the required template.

## Validation / Exit Criteria

### Critical Success Criteria (Must Pass)
1. ✅ Application successfully compiles on ARM64 architecture without errors
2. ✅ All native libraries load correctly on ARM64 or appropriate fallbacks function
3. ✅ All dependencies flagged as "MUST UPGRADE" have been updated to ARM64-compatible versions
4. ✅ No ARM64-specific runtime errors during build or test execution
5. ✅ Container images successfully build on ARM64 architecture (if containerized)

### Test Criteria
6. ✅ Test suite executes on ARM64
7. ✅ Test failures (if any) are classified by root cause:
   - `INFRA` - Infrastructure/environment dependency (non-blocking)
   - `ARM64` - Architecture-related failure (blocking)
   - `PRE-EXISTING` - Existed before migration (non-blocking)
8. ✅ No ARM64-related test failures

**Note:** Infrastructure test failures (missing databases, Docker, environment variables, external services) do not fail the transformation. These should be documented but are non-blocking.

### Startup Criteria
9. ✅ Application starts successfully on ARM64 without crashes
10. ✅ JVM flags are accepted without errors

### Documentation Criteria
All documentation MUST use the canonical filenames defined in `documentation-standards.md` and reside in the `graviton-validation/` folder.

11. ✅ `graviton-validation/00-summary.md` — Transformation summary with exit criteria checklist
12. ✅ `graviton-validation/01-project-assessment.md` — Project structure, deployment type, Java environment
13. ✅ `graviton-validation/02-native-library-report.md` — Native library findings and resolutions
14. ✅ `graviton-validation/03-dependency-compatibility-report.md` — Dependency compatibility report (including transitive dependencies)
15. ✅ `graviton-validation/04-code-scan-findings.md` — Architecture-specific code scan results
16. ✅ `graviton-validation/05-jvm-configuration.md` — JVM flag configuration and validation
17. ✅ `graviton-validation/06-build-test-results.md` — Build attempts, test results, failure classification, startup validation
18. ✅ `graviton-validation/raw/dependency-tree-full.txt` — Full dependency tree
19. ✅ `graviton-validation/raw/dependency-tree-native.txt` — Filtered native-artifact dependency tree

### User Responsibility (Out of Scope for This Transformation)
The following should be performed by the user independently after transformation:
- Performance benchmarking and load testing
- Memory leak detection and extended stability testing
- Integration testing with external services (databases, APIs, message queues)
- CI/CD pipeline configuration for ARM64 builds

## Out of Scope
The following are explicitly OUT OF SCOPE for this transformation:
- ❌ JDK distribution changes (e.g., OpenJDK to Corretto, Temurin to OpenJDK, etc.)
- ❌ Java version changes (upgrades OR downgrades) - maintain current Java version
- ❌ General dependency modernization or security updates
- ❌ Application refactoring or code quality improvements
- ❌ Performance optimization beyond Graviton-specific JVM flags
- ❌ Infrastructure migration or deployment automation
- ❌ Cost optimization analysis (beyond ARM64 compatibility validation)

## Notes
- This transformation focuses exclusively on ARM64 compatibility validation
- All transformation documentation MUST follow `documentation-standards.md` and reside in `graviton-validation/`
- Maintain the current JDK distribution and version - do not change unless specifically required for ARM64 compatibility
- All major JDK distributions (OpenJDK, Eclipse Temurin, Amazon Corretto, Azul Zulu, etc.) support ARM64 for Java 8+
- Amazon Corretto may be mentioned as an option for consideration in new deployments, but existing distributions should be preserved
- Dependency updates are limited to ARM64 compatibility requirements only — this includes transitive dependencies with native code
- The tiered .so file validation policy prevents automatic failures while ensuring compatibility
- Both statically bundled and runtime-extracted native libraries must be validated for ARM64 compatibility
- Multi-module projects require analysis of all submodules and the full transitive dependency tree
- Testing on actual ARM64 hardware/containers is critical for validation
- Graviton instances perform best at higher CPU utilization (70%+ recommended for testing)
