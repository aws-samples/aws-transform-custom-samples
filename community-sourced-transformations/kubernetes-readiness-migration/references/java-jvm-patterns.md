# Java/Maven/Gradle Patterns Reference (covers Maven AND Gradle)

Java, Maven, and Gradle-specific containerisation gotchas for Phase 2 transformation. Applies when `pom.xml` OR `build.gradle`/`build.gradle.kts` is present. **This file applies to ANY project with pom.xml OR build.gradle — not Maven-only.**

## ⚠ Host-Side Compilation Mandate

**Host-side compilation (`mvn package -DskipTests` or `./gradlew build -x test`) MUST succeed before `docker build` is attempted.** This is a hard prerequisite — not optional.

**Rationale:** Compilation errors caught at Step 0 (pre-Docker) provide faster feedback and clearer error messages than failures buried in a Docker build log. Compiling inside Docker (multi-stage) is acceptable for image correctness but does NOT replace the host-side verification gate.

**Commands:**
- Maven: `mvn package -DskipTests -B -q`
- Maven Wrapper: `./mvnw package -DskipTests -B`
- Gradle: `./gradlew build -x test --no-daemon`

**Verification:** Exit code 0 AND artifact exists:
```bash
# Maven:
ls target/*.jar target/*.war 2>/dev/null | head -1

# Gradle:
ls build/libs/*.jar 2>/dev/null | head -1
```

**If toolchain version mismatch prevents compilation** (e.g., project requires JDK 8 but host has JDK 21), record `CONDITIONAL PASS` with root cause — do NOT silently skip. See `references/docker-build-validation.md` §Step 0 for the full procedure.

**Maven offline mode limitation:** `mvn -o package` fails for any uncached artifact. If the local Maven cache (`~/.m2/repository`) does not contain all dependencies, online mode is required for the first build. Do NOT use `-o` for the host-side compilation gate unless you have confirmed all dependencies are cached.


## Java Toolchain Bootstrap via mise

**Purpose:** Resolve JDK version mismatches by installing the required version via mise before compilation.

### Procedure
```bash
# 1. Detect required Java version from pom.xml or build.gradle
JAVA_VER=$(grep -oP '(?:java\.version|maven\.compiler\.release|maven\.compiler\.source)>\K[^<]+' pom.xml 2>/dev/null | head -1)
[ -z "$JAVA_VER" ] && JAVA_VER=$(grep -oP 'sourceCompatibility\s*=\s*[\x27"]?\K[0-9]+' build.gradle 2>/dev/null)

# 2. Attempt mise install
if command -v mise >/dev/null 2>&1 && [ -n "$JAVA_VER" ]; then
  mise install java@corretto-$JAVA_VER 2>/dev/null || mise install java@temurin-$JAVA_VER 2>/dev/null
  export JAVA_HOME=$(mise where java 2>/dev/null)
  export PATH=$JAVA_HOME/bin:$PATH
fi

# 3. Verify
java -version 2>&1 | head -1
```

### When to Use
Before the Host-Side Compilation Mandate (above), when `java -version` shows a version mismatch with the project requirement. Always attempt before recording CONDITIONAL PASS.

### Validated Example Repositories
- **Shopizer** (github.com/shopizer-ecommerce/shopizer): JDK 21 via `mise install java@corretto-21`; `mvn package -DskipTests` exits 0, produces 193MB JAR. Validated 2026-06.
- **OpenMRS-core** (github.com/openmrs/openmrs-core): JDK 21 required; mise bootstrap resolves version mismatch. Validated 2026-06.


## Table of Contents

1. [Maven Offline Fallback](#maven-offline-fallback)
2. [Maven Wrapper Detection](#maven-wrapper-detection)
3. [Maven Compile Timeout Fallback](#maven-compile-timeout-fallback)
4. [Gradle Dispatch Condition](#gradle-dispatch-condition)
5. [Hibernate Property Placeholders](#hibernate-property-placeholders)
6. [Spring @Value Namespace Bridging](#spring-value-namespace-bridging)
7. [JDBC URL Segment Composition](#jdbc-url-segment-composition)
8. [Liquibase Startup Probe Timing](#liquibase-startup-probe-timing)
9. [Embedded Tomcat Scope Pitfall](#embedded-tomcat-scope-pitfall)
10. [env.getProperty Null Return](#envgetproperty-null-return)
11. [Spring Session Redis in Tests](#spring-session-redis-in-tests)
12. [Quartz Job Lifecycle](#quartz-job-lifecycle)
13. [Quartz JDBC Clustering](#quartz-jdbc-clustering)
14. [Multi-Module DDL Race](#multi-module-ddl-race)
15. [Spring Profile Default Preservation](#spring-profile-default-preservation)
16. [Multi-Profile SPRING_PROFILES_ACTIVE Composition](#multi-profile-composition)
17. [Commented-Out Property Detection and Activation](#commented-out-property-detection)
18. [Spring Auto-Config Exclusion for Standalone Jobs](#spring-auto-config-exclusion)
19. [Quartz DataSource Isolation](#quartz-datasource-isolation)
20. [Shared Maven Module Refactoring](#shared-maven-module-refactoring)
21. [Copy-Startup Init Container for readOnlyRootFilesystem](#copy-startup-init-container)
22. [WAR-Embedded Liquibase Job](#war-embedded-liquibase-job)
23. [Infinispan JGroups KUBE_PING](#infinispan-jgroups-kube-ping)
24. [Spring XML + Boot Hybrid Safety](#spring-xml-boot-hybrid)
25. [ReflectionTestUtils for @Value Fields](#reflectiontestutils)
26. [JdbcTemplate Varargs Mockito Stub](#jdbctemplate-varargs-mockito)
27. [H2/Dev Profile Exclusion](#h2-dev-profile-exclusion)
28. [Spring CronJob CommandLineRunner Bridge](#spring-cronjob-commandlinerunner-bridge)
29. [Criterion 10D Three-Pass Inventory](#criterion-10d-three-pass-inventory)
30. [Java Interface Default Method Override Rules](#java-interface-default-method-override-rules)
31. [Spring Session 4.x in Traditional WAR (non-Boot)](#spring-session-non-boot-war)
32. [Multi-Module Maven Dockerfile Build Context](#multi-module-maven-dockerfile)
33. [Alpine JRE HEALTHCHECK (wget not curl)](#alpine-jre-healthcheck)
34. [Spring Non-Boot Dependency Guard](#spring-non-boot-dependency-guard)
35. [Tomcat WAR emptyDir Inventory](#tomcat-war-emptydir-inventory)
36. [Liquibase 4.4+ searchPath](#liquibase-44-searchpath)
37. [camelCase @Value Env-Lowercasing Conflict](#camelcase-value-env-lowercasing)
38. [PropertiesFactoryBean Action Protocol](#propertiesfactorybean-action-protocol)
39. [WAR-to-JAR Packaging Check](#war-to-jar-packaging-check)
40. [Spring XML PPC + Boot PSPC Hybrid](#spring-xml-ppc-boot-pspc-hybrid)
41. [Factory-Method Singleton Refactor](#factory-method-singleton-refactor)
42. [ActiveProfiles Test Activation](#activeprofiles-test-activation)
43. [Required-Secret Test Shadow Rule](#required-secret-test-shadow-rule)
44. [Graceful Shutdown Check](#graceful-shutdown-check)
45. [Multi-Module Test Shadow](#multi-module-test-shadow)
46. [terminationGracePeriodSeconds Formula](#terminationgraceperiodseconds-formula)
47. [Quartz initialize-schema Restart Risk](#quartz-initialize-schema-restart-risk)
48. [Broadened IRSA Trigger](#broadened-irsa-trigger)
49. [Service-Specific IAM Policy Templates](#service-specific-iam-policy-templates)
50. [Mixed-Indent sed Fallback](#mixed-indent-sed-fallback)
51. [@ConfigurationProperties vs XML PPC](#configurationproperties-vs-xml-ppc)
52. [Startup-Script Write-Tracing](#startup-script-write-tracing)
53. [Tomcat /bin subPath Mount](#tomcat-bin-subpath-mount)
54. [mvn package vs mvn compile](#mvn-package-vs-mvn-compile)
55. [Java Version Pre-Migration Check](#java-version-pre-migration-check)
56. [SCREAMING_SNAKE_CASE Circular Placeholder](#screaming-snake-case-circular-placeholder)
57. [SPRING_PROFILES_ACTIVE Mandatory ConfigMap](#spring-profiles-active-mandatory-configmap)
58. [Infinispan !cloud Profile-Guard](#infinispan-cloud-profile-guard)
59. [@PropertySource Requirement for @ConfigurationProperties with XML PPC](#propertysource-requirement)
60. [Alpine Shebang Compatibility](#alpine-shebang-compatibility)
61. [JVM Flag Ordering in Entrypoint Scripts](#jvm-flag-ordering)
62. [Log4j2/Logback File-Only Logger Redirect](#log4j2-file-only-logger-redirect)
63. [S3 ListObjectsV2 Pagination](#s3-listobjectsv2-pagination)
64. [IAM Policy Two-Statement Split](#iam-policy-two-statement-split)

## Tomcat WAR Deployment (setenv.sh elimination)

**Trigger:** Traditional Tomcat WAR application using `setenv.sh` for JVM/CATALINA_OPTS configuration.

**Problem:** `setenv.sh` is sourced by `catalina.sh` at startup. With `readOnlyRootFilesystem: true`, runtime generation of `setenv.sh` fails. Furthermore, values baked into `setenv.sh` cannot be overridden via Kubernetes env vars.

**Solution — export CATALINA_OPTS/JAVA_OPTS via ConfigMap env vars:**
```yaml
# ConfigMap
data:
  CATALINA_OPTS: "-Xmx512m -Xms256m -Djava.io.tmpdir=/tmp"
  JAVA_OPTS: "-Dfile.encoding=UTF-8"
```

Tomcat's `catalina.sh` reads `CATALINA_OPTS` and `JAVA_OPTS` from the environment automatically — no `setenv.sh` needed.

**Detection:**
```bash
grep -rn 'setenv\.sh\|CATALINA_OPTS\|JAVA_OPTS' . --include='*.sh' --include='Dockerfile' | grep -v '#'
```

**Rule:** Remove all `setenv.sh` generation from entrypoint scripts. Replace with ConfigMap-injected env vars (`CATALINA_OPTS`, `JAVA_OPTS`). Document in ENV_VARIABLES.md.

### Infinispan JGroups Dual-Port NetworkPolicy

When Infinispan/JGroups KUBE_PING is configured (see §23), the NetworkPolicy MUST allow BOTH JGroups ports:

```yaml
# NetworkPolicy egress for Infinispan cluster communication
egress:
- ports:
  - port: 7800   # JGroups TCP transport
    protocol: TCP
  - port: 7801   # JGroups FD (failure detection)
    protocol: TCP
  to:
  - podSelector:
      matchLabels:
        app: <app-label>  # Same app — peer-to-peer
```

**Rule:** When Infinispan/JGroups is detected, add BOTH port 7800 (transport) and 7801 (failure detection) to the pod-to-pod NetworkPolicy egress. Missing port 7801 causes cluster split-brain under network jitter.

## HikariCP API Misuse Detection

**Trigger:** Spring Boot or raw HikariCP configuration in Java applications.

**Problem:** HikariCP methods have non-obvious semantics that cause connection pool exhaustion or silent misconfiguration:

| Method | Misuse | Correct Usage |
|---|---|---|
| `setIdleTimeout(0)` | Disables idle timeout → connections never returned | Use `setIdleTimeout(600000)` (10min) |
| `setMaxLifetime(0)` | Disables max lifetime → stale connections | Use `setMaxLifetime(1800000)` (30min, must be < DB wait_timeout) |
| `setConnectionTimeout(0)` | Infinite wait for connection → thread starvation | Use `setConnectionTimeout(30000)` (30s) |
| `setMinimumIdle(maxPoolSize)` | Pool never shrinks → waste under low load | Use `setMinimumIdle(2)` for variable load |

**Detection:**
```bash
grep -rn 'setIdleTimeout\|setConnectionTimeout\|setMaxLifetime\|setMinimumIdle' . --include='*.java' --include='*.properties' --include='*.yml' | grep -v test
```

**Rule:** Flag any `(0)` value for timeout/lifetime settings as a potential connection pool exhaustion bug. Document in INFRASTRUCTURE_REQUIREMENTS.md with recommended production values.

## Spring Boot jar Packaging — tomcat-embed-jasper scope

**Trigger:** Spring Boot JAR projects using JSP views that have `tomcat-embed-jasper` with `<scope>provided</scope>`.

**Problem:** Similar to `spring-boot-starter-tomcat` scope=provided, marking `tomcat-embed-jasper` as provided in a JAR-packaged application causes JSP rendering to fail silently (404 on all JSP views) because the JSP engine is excluded from the fat JAR.

**Detection:**
```bash
grep -B2 -A2 'provided' pom.xml | grep -i 'jasper\|tomcat-embed-jasper'
find . -name '*.jsp' | head -5  # Confirm JSPs exist
```

**Rule:** For `<packaging>jar</packaging>` with JSP views: remove `<scope>provided</scope>` from `tomcat-embed-jasper`. This is the same pattern as §spring-boot-starter-tomcat scope=provided but for the JSP engine specifically.

## Gradle Dispatch

**Trigger:** `build.gradle` or `build.gradle.kts` present (no pom.xml, or both present).

**Rule:** When `build.gradle` is present, use Gradle commands instead of Maven. This reference file applies to BOTH Maven and Gradle Java projects.

**Detection:**
```bash
ls build.gradle build.gradle.kts 2>/dev/null && echo "GRADLE" || echo "MAVEN"
```

**Key differences from Maven:**
| Concern | Maven | Gradle |
|---------|-------|--------|
| Build | `mvn package -DskipTests` | `./gradlew build -x test` |
| Test | `mvn test` | `./gradlew test` |
| Dependency list | `mvn dependency:tree` | `./gradlew dependencies` |
| Wrapper | `./mvnw` | `./gradlew` |
| Offline | `mvn -o` | `./gradlew --offline` |

**Dockerfile for Gradle:**
```dockerfile
FROM gradle:8-jdk21 AS builder
COPY --chown=gradle:gradle . /home/gradle/src
WORKDIR /home/gradle/src
RUN gradle build -x test --no-daemon

FROM eclipse-temurin:21-jre-alpine
COPY --from=builder /home/gradle/src/build/libs/*.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

## Graceful Shutdown Check

**Trigger:** Spring Boot applications deployed as Kubernetes Deployments.

**Problem:** Without `server.shutdown=graceful`, Spring Boot immediately closes all connections on SIGTERM — in-flight requests receive connection-reset errors.

**Detection:**
```bash
grep -rn 'server\.shutdown\|spring\.lifecycle' src/main/resources/ --include='*.properties' --include='*.yml' --include='*.yaml'
```

**Fix — add to application.properties (or ConfigMap):**
```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=25s
```

**Kubernetes manifest alignment:**
```yaml
terminationGracePeriodSeconds: 30  # Must be > timeout-per-shutdown-phase
```

**Rule:** ALL Spring Boot Deployments (not Jobs/CronJobs) MUST have `server.shutdown=graceful` configured. Without it, `terminationGracePeriodSeconds` is ineffective — Spring kills connections immediately regardless of the grace period.

## Quartz JDBC Clustering

**Trigger:** Quartz Scheduler with `org.quartz.jobStore.class = org.quartz.impl.jdbcjobstore.JobStoreTX` AND HPA replicas > 1.

**Problem:** Without JDBC clustering configuration, multiple pods fire the same scheduled jobs simultaneously. File-based or RAM JobStore does not coordinate across pods.

**Prerequisites:**
1. Quartz tables must exist in the database (schema DDL: `tables_postgres.sql` / `tables_mysql.sql` from Quartz distribution)
2. Dedicated DataSource for Quartz (see §Quartz DataSource Isolation)

**Required properties (ConfigMap or application.properties):**
```properties
org.quartz.jobStore.isClustered=true
org.quartz.jobStore.clusterCheckinInterval=20000
org.quartz.scheduler.instanceId=AUTO
org.quartz.jobStore.class=org.quartz.impl.jdbcjobstore.JobStoreTX
org.quartz.jobStore.driverDelegateClass=org.quartz.impl.jdbcjobstore.PostgreSQLDelegate
org.quartz.jobStore.dataSource=quartzDS
```

**Detection:**
```bash
grep -rn 'quartz\|JobStore\|@Scheduled\|CronTrigger' . --include='*.java' --include='*.properties' --include='*.xml' --include='*.yml'
```

**Rule:** If Quartz uses JDBC JobStore AND the Deployment has HPA (or replicas > 1), `isClustered=true` and `instanceId=AUTO` are MANDATORY. Document Quartz schema creation as a pre-deployment DBA action in INFRASTRUCTURE_REQUIREMENTS.md.

## Maven Offline Fallback

If `mvn` is unavailable or times out:
```bash
xmllint --noout pom.xml
grep -A3 '<dependency>' pom.xml | grep -E 'groupId|artifactId|version|scope'
grep -B2 -A2 'provided' pom.xml | grep -i tomcat
```

## Maven Wrapper Detection

```bash
find . -name mvnw -type f
```

If present, use `./mvnw` instead of `mvn`. If neither available, fall back to XML analysis.

## Maven Compile Timeout Fallback

When Maven compile times out (common in sandboxed environments):

```bash
# Step 1: Validate POM structure without downloading
xmllint --noout pom.xml && echo "POM valid"

# Step 2: Minimal validation with existing cache
mvn validate -o 2>/dev/null || echo "Offline validate failed — proceed with static analysis"

# Step 3: Static dependency analysis as substitute
grep -A5 '<dependency>' pom.xml | grep -oP '<artifactId>\K[^<]+'
```

**Rule**: If `mvn compile` fails after 2 attempts (timeout or network), fall back to `xmllint` + `bash -n` for structural validation. Do NOT block on Maven availability.

## Hibernate Property Placeholders

```xml
<property name="hibernate.connection.url">${DATABASE_URL}</property>
```

**Critical**: Hibernate passes literal `${VAR}` as connection string on unresolved placeholders.

## Spring @Value Namespace Bridging

```properties
# application.properties
spring.datasource.url=jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/${DB_NAME:app}
```

**Convention**: External env vars = SCREAMING_SNAKE. Spring properties = dot notation. Bridge in `application.properties`.

## System.getenv() Secondary Scan

The §15 source-authoritative env var grep for Java/Spring typically scans only `.properties`/`.yml` for Spring `${}` bridge syntax. This MISSES direct `System.getenv()` calls in `.java` source files.

**Mandatory two-command scan for Java projects:**

```bash
# Command 1: Spring bridge syntax in properties/yml (existing)
grep -rhoP '\$\{([A-Z][A-Z0-9_]+)[}:]' src/ --include='*.properties' --include='*.yml' | sort -u

# Command 2: Direct Java env reads (NEW — must also run)
grep -rhoP 'System\.getenv\("([A-Z][A-Z0-9_]+)"\)' src/ --include='*.java' | sort -u
```

Both outputs contribute to ENV_VARIABLES.md. Any var found by Command 2 but not by Command 1 is a direct env var read bypassing Spring property bridging — it still needs a ConfigMap/Secret entry.

## JDBC URL Segment Composition

When a startup script assembles JDBC URL at runtime, set ConfigMap default to empty string for the composed URL. For direct Spring usage:
```properties
spring.datasource.url=jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/${DB_NAME:app}
```

Each segment gets its own ConfigMap key.

## Liquibase Startup Probe Timing

```yaml
startupProbe:
  httpGet: { path: /actuator/health, port: 8080 }
  failureThreshold: 30
  periodSeconds: 10
  # Budget: 300s for initial migration
```

Rule: For Liquibase/Flyway apps, `startupProbe.failureThreshold × periodSeconds ≥ 300s`. This is an instance of the generalised first-boot init sizing rule in SKILL.md Criterion 8(d) — applies to any schema initialisation tool running at first pod start.

## Embedded Tomcat Scope Pitfall

```xml
<!-- BAD: breaks containers — silent startup exit -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-tomcat</artifactId>
    <scope>provided</scope>
</dependency>
```

**Detection**: `grep -B2 -A2 'provided' pom.xml | grep -i 'tomcat\|jetty\|undertow'`

**Phase 2 mandate:** If detected during Phase 1, removing `<scope>provided</scope>` from the embedded servlet container dependency is REQUIRED in Phase 2 §11 (Build/Release/Run). This is a silent runtime blocker — the container builds successfully but the application exits immediately on startup because Spring Boot cannot find an embedded servlet container. Fix BEFORE docker build. **Do NOT defer** — workers MUST NOT assess this as "non-blocking". For `<packaging>jar</packaging>`, ALWAYS remove `<scope>provided</scope>` from spring-boot-starter-tomcat. This is a known CrashLoopBackOff pattern.

## env.getProperty Null Return

```java
// BAD: NPE if key missing
String host = env.getProperty("database.host");
// GOOD:
String host = env.getProperty("database.host", "localhost");
```

## Spring Session Redis in Tests

After adding Redis for sessions, add to ALL test property files:
```properties
spring.session.store-type=none
management.health.redis.enabled=false
spring.data.redis.repositories.enabled=false
```

**Required-secret test shadow gate**: After externalising ANY property to `${VAR}` (no default), verify the corresponding test resource file exists. If missing, tests fail with `IllegalArgumentException: Could not resolve placeholder`. Run detection:
```bash
# Find properties with no default that were just added/changed
grep -rn '\${[A-Z_]*}' src/main/resources/*.properties src/main/resources/*.yml 2>/dev/null | grep -v ':'
# For each match, verify test shadow:
for f in $(grep -rl '\${[A-Z_]*}' src/main/resources/ 2>/dev/null); do
  BASENAME=$(basename "$f")
  [ -f "src/test/resources/$BASENAME" ] || echo "MISSING TEST SHADOW: src/test/resources/$BASENAME"
done
```

## Quartz Job Lifecycle

`SpringBeanJobFactory.autowireBean(job)` does NOT invoke `@PostConstruct`:

```java
// BAD: @PostConstruct never fires for Quartz jobs
// GOOD: initialise in execute() or use @Bean provider
```

**Quartz JDBC schema**: If using `JobStoreTX`, Quartz tables must exist before app starts. Document as pre-deployment DBA action.

## Quartz JDBC Clustering

**Trigger:** `spring-boot-starter-quartz` in dependencies AND Quartz configured with `JobStoreTX` (JDBC-backed job store).

**Problem:** When running multiple pod replicas with Quartz JDBC mode, Quartz uses database row-level locks for cluster coordination. Without proper configuration, jobs execute on ALL pods simultaneously (duplicate execution).

**Required properties for clustered Quartz:**
```properties
spring.quartz.job-store-type=jdbc
spring.quartz.properties.org.quartz.jobStore.isClustered=true
spring.quartz.properties.org.quartz.jobStore.clusterCheckinInterval=20000
spring.quartz.properties.org.quartz.scheduler.instanceId=AUTO
```

**Pre-deployment requirements:**
1. Quartz tables must exist in database (create via `tables_postgres.sql` / `tables_mysql_innodb.sql` from Quartz distribution)
2. Document as a Job manifest (Liquibase/Flyway migration) or DBA action in INFRASTRUCTURE_REQUIREMENTS.md
3. All pods must use the same database instance

**Detection:**
```bash
grep -rn 'quartz\|JobStore\|@Scheduled\|SchedulerFactoryBean' . --include='*.java' --include='*.properties' --include='*.yml'
```

**NetworkPolicy impact:** Quartz JDBC pods need egress to the database (TCP 5432/3306) for lock coordination — separate from application DB queries.

**CronJob extraction decision:** If Quartz is used purely for scheduling (not complex job state machines), prefer extracting to Kubernetes CronJob manifests with `concurrencyPolicy: Forbid` — eliminates the clustering complexity entirely.

## Multi-Module DDL Race

Multiple Spring Boot modules with `ddl-auto=update` sharing same DB → lock contention.

**Mitigation:**
1. Use Flyway/Liquibase in a dedicated migration Job
2. Set `ddl-auto=validate` in all application modules
3. Run migration Job before application Deployments

## Spring Profile Default Preservation

```properties
# application-prod.properties (AFTER migration)
spring.datasource.url=jdbc:mysql://${DB_HOST:prod-mysql}:${DB_PORT:3306}/${DB_NAME:appdb}
```

**Rule**: Each profile's default reflects its intended environment.

## Multi-Profile SPRING_PROFILES_ACTIVE Composition

For multi-module applications with multiple active profiles:

```yaml
# ConfigMap
SPRING_PROFILES_ACTIVE: "prod,cache,messaging"
```

**Rules:**
1. Never hardcode profile activation — always via env var
2. Profile composition order matters: later profiles override earlier ones
3. Each module may need different profile combinations → separate ConfigMap entries per workload
4. Detection: `grep -rn 'spring.profiles.active\|@Profile\|@ActiveProfiles' . --include='*.java' --include='*.properties' --include='*.yml'`

## Commented-Out Property Detection and Activation

Spring properties commented out in `application.properties` may be required for containerised deployment:

```bash
grep -n '^#.*\${\|^#.*localhost\|^#.*redis\|^#.*spring\.session' src/main/resources/application*.properties
```

**Common patterns requiring activation:**
```properties
# BEFORE (commented out in dev):
#spring.session.store-type=redis
# AFTER (activated for container deployment):
spring.session.store-type=redis
spring.redis.host=${REDIS_HOST:localhost}
```

## Spring Auto-Config Exclusion for Standalone Jobs

**Trigger:** Spring Boot application used as a standalone batch job or CronJob.

```java
@SpringBootApplication(exclude = {
    DataSourceAutoConfiguration.class,  // If job doesn't need DB
    WebMvcAutoConfiguration.class       // Always exclude for non-web jobs
})
public class BatchJobApplication {
    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(BatchJobApplication.class);
        app.setWebApplicationType(WebApplicationType.NONE);
        app.run(args);
    }
}
```

**Kubernetes impact:** Container with `--spring.main.web-application-type=none` → no HTTP port → probe type (c) (exec only).

## Quartz DataSource Isolation

**Problem:** Quartz JDBC JobStore shares the application DataSource. With PgBouncer in transaction mode, advisory locks break.

```java
@Bean
@QuartzDataSource
public DataSource quartzDataSource() {
    HikariDataSource ds = new HikariDataSource();
    ds.setJdbcUrl(System.getenv("QUARTZ_JDBC_URL"));
    ds.setMaximumPoolSize(5);
    return ds;
}
```

## Shared Maven Module Refactoring

**Trigger:** Multi-module Maven project where decomposition requires separate Docker images but modules share common code.

```dockerfile
FROM maven:3.9 AS builder
COPY pom.xml .
COPY common/ common/
COPY web/ web/
RUN mvn -pl common,web -am package -DskipTests

FROM eclipse-temurin:21-jre-alpine
COPY --from=builder web/target/web.jar /app/app.jar
```

**Rule:** The `common` module is built in EVERY image that needs it (via `-pl common,<target> -am`).

## Copy-Startup Init Container for readOnlyRootFilesystem

**Trigger:** Java/Tomcat applications requiring startup scripts that write to the filesystem.

**Solution — init container copies startup artifacts to emptyDir:**
```yaml
initContainers:
- name: copy-startup
  image: app-image:latest
  command: ['sh', '-c', 'cp -r /app/startup/* /startup/ && cp -r /app/webapps/* /webapps/']
  volumeMounts:
  - name: startup-scripts
    mountPath: /startup
  - name: webapps
    mountPath: /webapps
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    readOnlyRootFilesystem: true
    allowPrivilegeEscalation: false
    capabilities: { drop: ["ALL"] }
```

**Rule**: Any file written at startup (not runtime) should be prepared in an init container and shared via emptyDir.

## WAR-Embedded Liquibase Job

**Trigger:** WAR file containing Liquibase changelogs that must run as a pre-deployment Job.

**Solution — extract and run from WAR:**
```yaml
containers:
- name: liquibase-migrate
  image: app-image:latest
  command:
  - sh
  - -c
  - |
    cd /tmp
    jar xf /app/app.war WEB-INF/lib/ WEB-INF/classes/db/
    java -cp "WEB-INF/lib/*:WEB-INF/classes" \
      liquibase.integration.commandline.LiquibaseCommandLine \
      --url="jdbc:mysql://${DB_HOST}:${DB_PORT}/${DB_NAME}" \
      --username="${DB_USER}" --password="${DB_PASSWORD}" \
      --changeLogFile=db/changelog-master.xml \
      --searchPath=WEB-INF/classes update
```

## Infinispan JGroups KUBE_PING

**Trigger:** `infinispan` or `jgroups` in dependencies.

**Problem:** JGroups defaults to UDP multicast, blocked in Kubernetes.

**Solution — KUBE_PING discovery:**
```xml
<config xmlns="urn:org:jgroups">
  <jgroups>
    <TCP bind_addr="${jgroups.bind.address:SITE_LOCAL}" />
    <kubernetes.KUBE_PING port_range="0" namespace="${KUBE_NAMESPACE}" labels="app=${APP_LABEL}" />
  </jgroups>
  <cache-container name="app-cache">
    <transport cluster="${CLUSTER_NAME:app-cluster}" />
  </cache-container>
</config>
```

**Infinispan 15.x XML element ordering**: `<jgroups>` MUST appear before `<cache-container>`. Within `<cache-container>`, `<transport>` MUST be the first child.

**Detection:** `grep -rn 'jgroups\|infinispan\|JChannel\|KUBE_PING' . --include='*.java' --include='*.xml'`

## Spring XML + Boot Hybrid Safety

**Trigger:** `@ImportResource("classpath:applicationContext.xml")` with Spring Boot auto-configuration.

**Rules:**
1. Check for XML-defined DataSource conflicting with Boot's auto-configured one
2. If XML defines `<bean id="dataSource">`, either remove it OR add `spring.datasource.*` properties that align
3. Detection: `grep -rn 'ImportResource\|ClassPathXmlApplicationContext' . --include='*.java'`

## ReflectionTestUtils for @Value Fields

When testing classes with `@Value` injected fields:
```java
ReflectionTestUtils.setField(service, "databaseHost", "test-host");
```

## JdbcTemplate Varargs Mockito Stub

```java
// GOOD: Use any() for varargs
when(jdbcTemplate.query(anyString(), any(RowMapper.class), any())).thenReturn(results);
```

## H2/Dev Profile Exclusion

**Detection:** `grep -A3 'h2' pom.xml | grep -v 'scope.*test'`

**Fix:** Ensure H2 is `<scope>test</scope>` or in a dev-only profile.

## Spring CronJob CommandLineRunner Bridge

**Solution — CommandLineRunner that invokes job logic and exits**:
```java
@SpringBootApplication
public class CronJobRunner implements CommandLineRunner {
    @Autowired private MyJobLogic jobLogic;
    @Autowired private ApplicationContext applicationContext;
    @Override
    public void run(String... args) throws Exception {
        jobLogic.execute();
        SpringApplication.exit(applicationContext, () -> 0);
    }
}
```

**CronJob timing offset**: Schedule 10-15 minutes before intended fire time to account for Spring Boot startup.

**Javadoc cron anti-pattern**: Do NOT copy Javadoc cron expressions (Spring `*/N` format with seconds) directly into Kubernetes CronJob `schedule:` — Kubernetes uses standard 5-field cron syntax.

## Criterion 10D Three-Pass Inventory

For Java/Spring projects, env var enumeration requires three passes:
```bash
# Pass 1: ${VAR} with or without default
grep -rhoP '\$\{([A-Z][A-Z0-9_]+)[}:]' src/ | tr -d '{}:' | sort -u
# Pass 2: @Value annotations
grep -rhoP '@Value\("\$\{([A-Z][A-Z0-9_]+)' src/ | grep -oP '[A-Z][A-Z0-9_]+' | sort -u
# Pass 3: @PropertySource files → grep those property files
grep -rn '@PropertySource' src/ --include='*.java'
```

**Dual PropertyPlaceholderConfigurer**: Legacy Spring XML projects may have multiple `PropertyPlaceholderConfigurer` beans loading different `.properties` files — scan ALL referenced files.

## Java Interface Default Method Override Rules

Three rules that cause compilation failures if violated:

**Rule 1**: Cannot reduce access from public. Interface default methods are implicitly `public`.

**Rule 2**: Static class methods do NOT implement interface instance methods.

**Rule 3**: Overrides cannot add checked exceptions absent from interface signature. Wrap in unchecked or use try-catch internally.

**Detection:** `grep -rn 'default\s\+\w\+\s\+\w\+(.*)\s*{' . --include='*.java'`

## Spring Session 4.x in Traditional WAR (non-Boot)

**Trigger:** `<packaging>war</packaging>` AND no `spring-boot-starter-parent`.

**Critical rules:**
1. Use `@EnableRedisIndexedHttpSession` (not deprecated `@EnableRedisHttpSession`)
2. Do NOT extend `AbstractHttpSessionApplicationInitializer` — causes dual ContextLoaderListener conflict
3. Wire via web.xml `DelegatingFilterProxy` as FIRST filter
4. Dependencies: `spring-session-data-redis` + `lettuce-core` directly (NOT spring-boot-starter-data-redis)

**Detection:** `grep '<packaging>war</packaging>' pom.xml && grep -L 'spring-boot-starter-parent' pom.xml`

## Multi-Module Maven Dockerfile Build Context

**Trigger:** Multi-module Maven project where Dockerfiles live in sub-modules.

**Solution — project-root build context:**
```dockerfile
# MIGRATION: Build with: docker build -f shopizer-web/Dockerfile .
FROM maven:3.9-eclipse-temurin-21 AS builder
COPY pom.xml /build/pom.xml
COPY shopizer-core/ /build/shopizer-core/
COPY shopizer-web/ /build/shopizer-web/
WORKDIR /build
RUN mvn -pl shopizer-core,shopizer-web -am package -DskipTests
```

**Rule:** Always invoke `docker build -f <submodule>/Dockerfile .` from project root.

## Alpine JRE HEALTHCHECK (wget not curl)

Eclipse Temurin `*-jre-alpine` images do NOT include `curl`:
```dockerfile
# GOOD: use BusyBox wget
HEALTHCHECK CMD wget --spider -q http://localhost:8080/actuator/health || exit 1
```

**Detection:** `grep -n 'FROM.*alpine' Dockerfile | grep -i 'jre\|temurin'`

## Spring Non-Boot Dependency Guard

**Problem:** Using `spring-boot-starter-*` in non-Boot WAR causes auto-configuration failures.

**Rule:** In non-Boot WAR applications, NEVER use Boot starters. Use underlying libraries directly.

## Tomcat WAR emptyDir Inventory

**Trigger:** Tomcat-based WAR applications with `readOnlyRootFilesystem: true`.

Tomcat requires multiple writable paths at runtime:

| emptyDir Mount | Purpose |
|---|---|
| `/tmp` | Java temp files, session serialisation |
| `/usr/local/tomcat/webapps` | WAR extraction (if not pre-extracted) |
| `/usr/local/tomcat/logs` | Access/error log fallback |
| `/usr/local/tomcat/work` | JSP compilation, Servlet temp |
| `/usr/local/tomcat/temp` | Tomcat temp directory |
| `/usr/local/tomcat/conf/Catalina` | Auto-generated context XML |
| `/usr/local/tomcat/bin` | Conditional: if startup scripts write PID/lock files here |

**Detection:** `grep -rn 'tomcat\|catalina\|servlet' pom.xml Dockerfile | grep -iv 'test'`

**Init container pattern**: If WAR must be extracted at startup, use copy-startup init container to extract to webapps emptyDir before main container starts.

**chown-chmod scope invariant**: When the Dockerfile or init container runs both `chown -R UID` and `chmod -R g+rw` on Tomcat directories, the set of directories in the chown command MUST cover ALL directories in the chmod command. Mismatched scope causes "permission denied" at runtime when a chmod'd directory is owned by root.

## Liquibase 4.4+ searchPath

**Trigger:** Liquibase ≥4.4 with changelogs inside WAR/JAR `WEB-INF/classes/` directory.

**Problem:** Liquibase 4.4+ requires `--searchPath` for sub-changelog `<include>` resolution when run outside the WAR/JAR classloader (e.g., from an extracted Job container).

**Before (fails):**
```bash
java -cp "WEB-INF/lib/*:WEB-INF/classes" liquibase.integration.commandline.LiquibaseCommandLine \
  --changeLogFile=db/changelog-master.xml update
```

**After (works):**
```bash
java -cp "WEB-INF/lib/*:WEB-INF/classes" liquibase.integration.commandline.LiquibaseCommandLine \
  --changeLogFile=db/changelog-master.xml \
  --searchPath=WEB-INF/classes update
```

**Detection:** `grep -rn '<include\|<includeAll' src/main/resources/db/ | grep -v '^#'`

**Source:** Liquibase docs — "The search path is the list of base physical locations where given changelog paths can be found." (https://docs.liquibase.com/reference-guide/parameters/search-path)

## camelCase @Value Env-Lowercasing Conflict

**Trigger:** Startup scripts that lowercase env var names before passing to the application (e.g., `tr [:upper:] [:lower:]` for prefix stripping like `OMRS_EXTRA_`).

**Problem:** Lowercasing transforms `camelCase` Spring `@Value` property names into all-lowercase, breaking resolution. E.g., `autoCreateUser` becomes `autocreateuser` which Spring cannot match.

**Workaround — Secret-mounted `.properties` file:**
```yaml
# kubernetes/secret.yaml
stringData:
  spring-extra.properties: |
    autoCreateUser=true
    someProperty.nestedValue=example
```

```yaml
# In Deployment container spec:
volumeMounts:
- name: spring-extra
  mountPath: /config/spring-extra.properties
  subPath: spring-extra.properties
env:
- name: SPRING_CONFIG_ADDITIONAL_LOCATION
  value: "/config/"
```

**Detection:** `grep -rn 'tr.*upper.*lower\|sed.*y/A-Z/a-z/' entrypoint*.sh startup*.sh docker-entrypoint*.sh`

## PropertiesFactoryBean Action Protocol

**Trigger:** Spring XML-based applications loading properties via `PropertiesFactoryBean` or `util:properties`.

**Problem:** Properties loaded via `PropertiesFactoryBean` bypass `${VAR}` placeholder resolution — they return the literal string `${DB_HOST}` instead of resolving the env var.

**Detection:**
```bash
grep -rn 'PropertiesFactoryBean\|util:properties' . --include='*.xml' --include='*.java'
```

**Action Protocol:**
1. **Detect** — grep as above. If matches found, proceed.
2. **Do NOT** add `${VAR:default}` syntax to files loaded by PropertiesFactoryBean — it will be treated as a literal string, not resolved.
3. **Add MIGRATION comment** — `# MIGRATION: PropertiesFactoryBean loads literal values — env var placeholders are NOT resolved. Use PropertySourcesPlaceholderConfigurer or inject via @Value instead.`
4. **Document code fix path** — In INFRASTRUCTURE_REQUIREMENTS.md or TRANSFORMATION_SUMMARY.md, recommend: inject `Environment` bean and call `env.getProperty()`, or replace PFB with `@PropertySource` + `PropertySourcesPlaceholderConfigurer`.
5. **Document affected properties** in ENV_VARIABLES.md with note: "Requires code refactoring — PFB bypass".

**Circular Placeholder Pitfall:** The placeholder variable name MUST differ from the property key. `FOO=${FOO:default}` throws `IllegalArgumentException: Circular placeholder reference 'FOO'`. Use a distinct env var name:
```properties
# BAD — circular reference:
database.password=${database.password:secret}

# GOOD — distinct env var name:
database.password=${DB_PASSWORD:secret}
```

## WAR-to-JAR Packaging Check

**Trigger:** Converting traditional WAR application to executable Spring Boot JAR.

**Pre-migration checklist:**
```bash
# 1. Verify spring-boot-starter-tomcat is NOT scope=provided
grep -B2 -A2 'provided' pom.xml | grep -i 'tomcat\|jetty\|undertow'
# 2. Check for web.xml (must be migrated to Java config)
find . -name 'web.xml' -not -path '*/test/*'
# 3. Check for JSP (requires extra dependency for JAR packaging)
find . -name '*.jsp' | head -5
```

**Rule:** For packaging=jar: `spring-boot-starter-tomcat` must NOT have `<scope>provided</scope>`. If JSPs exist, add `tomcat-embed-jasper` dependency.

## Spring XML PPC + Boot PSPC Hybrid

**Trigger:** Application with BOTH `PropertyPlaceholderConfigurer` (PPC) in XML AND Spring Boot's `PropertySourcesPlaceholderConfigurer` (PSPC).

**Problem:** PPC and PSPC have different resolution order. When both are active, PPC may resolve a placeholder from a properties file while PSPC resolves the same placeholder from env vars — whichever runs first wins, leading to inconsistent behaviour.

**Solution:**
```xml
<!-- Add to XML config to make PPC defer to Boot PSPC -->
<bean class="org.springframework.beans.factory.config.PropertyPlaceholderConfigurer">
  <property name="ignoreUnresolvablePlaceholders" value="true"/>
  <property name="order" value="2"/>
  <!-- Boot PSPC has order=0 (highest priority) by default -->
</bean>
```

**Detection:** `grep -rn 'PropertyPlaceholderConfigurer\|PropertySourcesPlaceholderConfigurer' . --include='*.xml' --include='*.java'`

## Factory-Method Singleton Refactor

**Trigger:** Spring XML beans using `factory-method` for singleton creation (common in legacy apps).

**Problem:** `factory-method` singletons hold in-memory state that breaks under horizontal scaling.

**Detection:**
```bash
grep -rn 'factory-method\|factory-bean' . --include='*.xml'
```

**Assessment:** For each factory-method bean, determine if it holds mutable state:
- Stateless factory (creates config objects) → safe, no change needed
- Stateful factory (connection pools, caches, registries) → must externalise state or use distributed alternative

**Rule:** Flag factory-method beans that accumulate state as horizontal-scaling warnings. Document in INFRASTRUCTURE_REQUIREMENTS.md if distributed alternative is needed.

## ActiveProfiles Test Activation

**Trigger:** Spring test classes using `@ActiveProfiles` to activate specific configuration for tests.

**Problem:** After migration, test profiles may reference removed properties or missing beans.

**Detection:**
```bash
grep -rn '@ActiveProfiles' . --include='*.java' | grep -oP '"([^"]+)"' | sort -u
```

**Rule:** For each active profile referenced in tests:
1. Verify the corresponding `application-<profile>.properties/yml` exists
2. Verify env-var-backed properties have test defaults
3. Add `spring.session.store-type=none` if Redis is not available in test context

**Common test profile additions after migration:**
```properties
# application-test.properties
spring.session.store-type=none
spring.redis.host=localhost
management.health.redis.enabled=false
```

## Required-Secret Test Shadow Rule

**Trigger:** Properties files containing `${SECRET}` with no default value (colon separator absent) — these are production-required secrets that cause startup failures in test contexts.

**Problem:** When a properties file has `${DB_PASSWORD}` (no default), tests fail with `IllegalArgumentException: Could not resolve placeholder 'DB_PASSWORD'` unless the test environment provides the value.

**Detection:**
```bash
# Find all ${VAR} references without a :default
grep -rn '\${[A-Z_]*}' src/main/resources/*.properties src/main/resources/*.yml 2>/dev/null | grep -v ':'
```

**Rule:** For each match, verify a corresponding test resource exists:
```bash
# For each properties file with required secrets:
for f in $(grep -rl '\${[A-Z_]*}' src/main/resources/ | grep -v ':'); do
  BASENAME=$(basename "$f")
  if [ ! -f "src/test/resources/$BASENAME" ]; then
    echo "MISSING TEST SHADOW: src/test/resources/$BASENAME"
  fi
done
```

**Fix:** Create `src/test/resources/<same-filename>` with safe test defaults:
```properties
# src/test/resources/application.properties (test shadow)
db.password=${DB_PASSWORD:test-password}
api.secret=${API_SECRET:test-secret-value}
```

**Alternative — test profile override:**
```properties
# src/test/resources/application-test.properties
db.password=test-password
api.secret=test-secret-value
```
Activate via `@ActiveProfiles("test")` in test classes.

## Multi-Module Test Shadow

**Trigger:** Multi-module Maven/Gradle projects where dependent modules have `@SpringBootTest` classes that transitively load the parent module's context.

**Problem:** When you externalise a property in module A (e.g., `${DB_PASSWORD}` with no default), tests in module B that `@Import` or `@ContextConfiguration` module A's beans fail with `Could not resolve placeholder` — even if module B's own test resources have the property defined, the inherited context from module A does not.

**Detection:**
```bash
# Find all modules with @SpringBootTest that depend on the migrated module
grep -rn '@SpringBootTest\|@ContextConfiguration\|@Import' . --include='*.java' | \
  grep -v 'src/main' | awk -F: '{print $1}' | sed 's|/src/test.*||' | sort -u
```

**Rule:** After externalising ANY property to `${VAR}` (no default) in module A:
1. Identify ALL modules that transitively depend on A (check parent pom `<modules>` or Gradle `dependencies`)
2. For each dependent module with `@SpringBootTest`: verify `src/test/resources/application-test.properties` (or equivalent) provides the value
3. If missing: create the test shadow file OR add `@TestPropertySource(properties = {"VAR=test-value"})` to test classes

**Gradle multi-module variant:**
```bash
# Find test dependencies across subprojects
grep -rn "implementation project\|testImplementation project" . --include='*.gradle' --include='*.kts'
```

## terminationGracePeriodSeconds Formula

**Trigger:** Spring Boot Deployments with `server.shutdown=graceful` or custom `timeout-per-shutdown-phase`.

**Formula:** `terminationGracePeriodSeconds = max(graceful_shutdown_timeout + 10, 30)`

| Application Config | Value | terminationGracePeriodSeconds |
|---|---|---|
| `spring.lifecycle.timeout-per-shutdown-phase=25s` | 25 | 35 |
| `spring.lifecycle.timeout-per-shutdown-phase=60s` | 60 | 70 |
| `spring.lifecycle.timeout-per-shutdown-phase=120s` | 120 | 130 |
| Default (no config) | 30 | 40 |

**Detection:**
```bash
grep -rn 'timeout-per-shutdown-phase\|graceful-shutdown' src/main/resources/ --include='*.properties' --include='*.yml'
```

**Rule:** Workers MUST NOT set `terminationGracePeriodSeconds: 30` as a blanket default. Always derive from the application's actual graceful shutdown timeout. The +10s buffer accounts for SIGTERM delivery latency, container runtime overhead, and pre-stop hook execution, ensuring kubelet SIGKILL fires only AFTER the application's own graceful window expires.

## Quartz initialize-schema Restart Risk

**Trigger:** Spring Boot Quartz with `spring.quartz.jdbc.initialize-schema=always`.

**Problem:** `initialize-schema=always` runs Quartz DDL on EVERY pod start. In Kubernetes with rolling updates, two pods may run DDL simultaneously, causing table-already-exists or lock-contention errors that crash startup.

**WRONG:**
```properties
spring.quartz.jdbc.initialize-schema=always
```

**CORRECT:**
```properties
spring.quartz.jdbc.initialize-schema=never
# Handle schema creation via Flyway/Liquibase migration Job
```

**Detection:**
```bash
grep -rn 'initialize-schema' src/main/resources/ --include='*.properties' --include='*.yml'
```

**Rule:** For Kubernetes deployments, use `initialize-schema=never` and manage Quartz tables via a dedicated migration Job (Flyway/Liquibase). Document schema creation as a pre-deployment requirement in INFRASTRUCTURE_REQUIREMENTS.md.

## Broadened IRSA Trigger

**Trigger:** Source contains ANY AWS SDK client builder — not just S3.

**Detection (broadened from S3-only to all AWS services):**
```bash
grep -rn 'AmazonS3\|AmazonSQS\|AmazonSNS\|AmazonDynamoDB\|AmazonSES\|AWSClientBuilder\|spring-cloud-aws\|software\.amazon\.awssdk' . --include='*.java' --include='*.xml' --include='*.gradle' --include='*.kts' | grep -v 'src/test'
```

**Services requiring IRSA (identical pattern for all):**
- S3 (AmazonS3Client / S3Client)
- SQS (AmazonSQSClient / SqsClient)
- SNS (AmazonSNSClient / SnsClient)
- DynamoDB (AmazonDynamoDBClient / DynamoDbClient)
- SES (AmazonSimpleEmailServiceClient / SesClient)

**Rule:** If ANY AWS SDK client builder is found in source (excluding test files), apply the full IRSA pattern: ServiceAccount with role-arn annotation, empty-string Secret entries, conditional credential injection. The IRSA pattern is identical regardless of which AWS service is consumed.

**Test-file exclusion:** SDK usage appearing ONLY in `*Test.java`, `*IT.java`, or `src/test/` does NOT trigger IRSA.

## Service-Specific IAM Policy Templates

**S3 (file storage) — two-statement format (see §64 IAM Policy Two-Statement Split):**
```json
[
  {
    "Effect": "Allow",
    "Action": ["s3:ListBucket"],
    "Resource": "arn:aws:s3:::BUCKET_NAME"
  },
  {
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::BUCKET_NAME/*"
  }
]
```

**SQS (message queue):**
```json
{
  "Effect": "Allow",
  "Action": ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
  "Resource": "arn:aws:sqs:REGION:ACCOUNT:QUEUE_NAME"
}
```

**SNS (notifications):**
```json
{
  "Effect": "Allow",
  "Action": ["sns:Publish"],
  "Resource": "arn:aws:sns:REGION:ACCOUNT:TOPIC_NAME"
}
```

**DynamoDB (NoSQL):**
```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"],
  "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/TABLE_NAME"
}
```

**Rule:** Include the appropriate IAM policy template in INFRASTRUCTURE_REQUIREMENTS.md §4 based on which AWS services the application uses. Always use least-privilege (specific resource ARNs, not `*`).

## Mixed-Indent sed Fallback

**Problem:** `editor str_replace` and `sed -i` fail silently on files with mixed indentation (tabs + spaces) because the search string's whitespace does not match exactly.

**Detection:**
```bash
# Check for mixed indent in target file
grep -Pn '^\t' file.properties && grep -Pn '^ ' file.properties && echo "MIXED INDENT DETECTED"
```

**Fallback — Python str.replace():**
```bash
python3 -c "
f='FILE_PATH'
old='''OLD_TEXT'''
new='''NEW_TEXT'''
c=open(f).read()
assert old in c, f'Text not found in {f}'
c=c.replace(old, new, 1)
open(f,'w').write(c)
"
```

**Rule:** If `editor str_replace` reports "text not found" despite `grep` confirming the text exists, AND `cat -A file` reveals mixed tabs/spaces, fall back to Python `str.replace()`. Python handles mixed indentation, multi-byte Unicode, and multi-line replacements correctly. Use sed only for confirmed single-line ASCII-only substitutions.

## @ConfigurationProperties vs XML PPC

**Trigger:** Spring Boot application using `@ConfigurationProperties` alongside legacy XML-defined `PropertyPlaceholderConfigurer` (PPC).

**Problem:** `@ConfigurationProperties` binds properties via relaxed binding (camelCase, kebab-case, SCREAMING_SNAKE). But XML PPC resolves `${VAR}` placeholders literally — mixing both in the same application causes some properties to resolve from env vars (via Boot PSPC) and others to resolve from static files (via XML PPC), depending on which configurer processes them first.

**Detection:**
```bash
grep -rn '@ConfigurationProperties' . --include='*.java'
grep -rn 'PropertyPlaceholderConfigurer' . --include='*.xml'
# Both present = conflict risk
```

**Resolution:** 
1. If XML PPC exists, add `ignoreUnresolvablePlaceholders=true` and `order=2` (see §Spring XML PPC + Boot PSPC Hybrid).
2. For `@ConfigurationProperties` classes: verify env var binding works by confirming `@EnableConfigurationProperties` is present AND `AddEnvironmentVariables()` is in the configuration chain.
3. Document which properties are resolved via which mechanism in ENV_VARIABLES.md.

**Rule:** When both `@ConfigurationProperties` and XML PPC exist, the XML PPC MUST have `order=2` (lower priority) to let Boot's PSPC resolve env vars first. Without this, XML-defined defaults silently override env var injection.

## Maven Wrapper Version Guard

**Trigger:** Maven Wrapper (`./mvnw`) present with Maven < 3.6.1.

**Problem:** `--no-transfer-progress` flag was added in Maven 3.6.1. Using it with older wrapper versions causes `Unknown lifecycle phase "--no-transfer-progress"` error during Docker build.

**Detection:**
```bash
# Check wrapper version (in .mvn/wrapper/maven-wrapper.properties)
grep 'distributionUrl' .mvn/wrapper/maven-wrapper.properties 2>/dev/null | grep -oP '\d+\.\d+\.\d+'
```

**Rule:** If Maven version < 3.6.1, use `-B` (batch mode, suppresses download progress) instead of `--no-transfer-progress`:
```dockerfile
# Maven >= 3.6.1:
RUN ./mvnw package -DskipTests --no-transfer-progress

# Maven < 3.6.1:
RUN ./mvnw package -DskipTests -B
```


## Spring 6-Field to Kubernetes 5-Field Cron Conversion

**Trigger:** Spring `@Scheduled(cron="...")` or Quartz cron expressions being extracted to Kubernetes CronJob `schedule:` field.

**Problem:** Spring/Quartz uses 6-field cron syntax (seconds minutes hours day-of-month month day-of-week). Kubernetes uses standard 5-field cron (minutes hours day-of-month month day-of-week). Copying Spring cron directly into K8s CronJob produces invalid schedules.

**Conversion table:**

| Spring 6-field | Meaning | K8s 5-field | Notes |
|---|---|---|---|
| `0 0 */6 * * *` | Every 6 hours at :00:00 | `0 */6 * * *` | Drop leading `0` (seconds) |
| `0 30 2 * * *` | Daily at 02:30:00 | `30 2 * * *` | Drop leading `0` |
| `*/30 * * * * *` | Every 30 seconds | `* * * * *` | Sub-minute not supported; use `activeDeadlineSeconds: 30` |
| `0 0 0 * * MON-FRI` | Weekdays at midnight | `0 0 * * MON-FRI` | Drop leading `0` |
| `0 0/15 * * * ?` | Every 15 minutes | `*/15 * * * *` | Drop seconds, convert `0/15` to `*/15`, drop `?` |

**Rule:** Always drop the FIRST field (seconds) when converting Spring/Quartz cron to Kubernetes. Add a YAML comment in the CronJob manifest documenting the original Spring expression:
```yaml
spec:
  schedule: "0 */6 * * *"  # Converted from Spring: 0 0 */6 * * *
```

**Source:** Kubernetes CronJob uses standard 5-field cron: minute, hour, day-of-month, month, day-of-week (https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/).


## CronJob activeDeadlineSeconds Placement

**Trigger:** Kubernetes CronJob manifests using `activeDeadlineSeconds` for hang-detection (distroless exception or general timeout).

**Problem:** `activeDeadlineSeconds` placed at the CronJob `spec` root is rejected by kubeconform strict mode. It belongs in `jobTemplate.spec.activeDeadlineSeconds`.

**WRONG:**
```yaml
apiVersion: batch/v1
kind: CronJob
spec:
  schedule: "0 */6 * * *"
  activeDeadlineSeconds: 3600  # REJECTED by kubeconform strict
  jobTemplate:
    spec:
      template: ...
```

**CORRECT:**
```yaml
apiVersion: batch/v1
kind: CronJob
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      activeDeadlineSeconds: 3600  # Correct location
      template: ...
```

**Detection:**
```bash
# Find misplaced activeDeadlineSeconds in CronJob manifests
python3 -c "
import yaml
from pathlib import Path
for f in Path('kubernetes').glob('*cronjob*.yaml'):
    with open(f) as fh:
        for doc in yaml.safe_load_all(fh):
            if doc and doc.get('kind') == 'CronJob':
                if 'activeDeadlineSeconds' in doc.get('spec', {}):
                    print(f'MISPLACED: {f} — activeDeadlineSeconds at spec root')
"
```

**Rule:** For CronJob manifests, `activeDeadlineSeconds` MUST be at `spec.jobTemplate.spec.activeDeadlineSeconds`. This applies to ALL CronJob manifests regardless of whether probes are present.

**Source:** https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/ — "The .spec.jobTemplate defines a template for the Jobs that the CronJob creates [...] It has exactly the same schema as a Job, except that it is nested."


## Startup-Script Write-Tracing

**Trigger:** Startup/entrypoint scripts that write files at container boot — determines emptyDir requirements for `readOnlyRootFilesystem: true`.

**Pre-step** (run BEFORE deciding emptyDir mounts):
```bash
# Trace all writes performed by startup scripts
grep -nE 'cat\s*>|tee\s|echo.*>|cp\s|mv\s|sed\s+-i|install\s' entrypoint*.sh startup*.sh docker-entrypoint.sh 2>/dev/null | grep -v '^\s*#'
```

**Rule:** Every path written by a startup script must have either an emptyDir mount or a copy-startup init container. If the write target is under WORKDIR and not /tmp, use the init-container pattern from §21 (Copy-Startup Init Container).

**Decision tree:**
1. Writes to `/tmp` or `/var/run` → covered by standard emptyDir mounts
2. Writes to application directory (e.g., `./config/generated.xml`) → init-container pattern
3. Writes to `/usr/local/tomcat/bin` (PID/lock files) → subPath mount (see §53)

## Tomcat /bin subPath Mount

**Trigger:** Tomcat startup scripts writing PID or lock files to `/usr/local/tomcat/bin/`.

**Problem:** `readOnlyRootFilesystem: true` blocks writes to `/usr/local/tomcat/bin/` where `catalina.sh` writes `catalina.pid`. Mounting an emptyDir at `/usr/local/tomcat/bin` would hide the actual scripts.

**Solution — subPath mount for specific file:**
```yaml
volumeMounts:
- name: tomcat-run
  mountPath: /usr/local/tomcat/bin/catalina.pid
  subPath: catalina.pid
volumes:
- name: tomcat-run
  emptyDir: {}
```

**Detection:**
```bash
grep -rn 'CATALINA_PID\|catalina\.pid' entrypoint*.sh startup*.sh Dockerfile 2>/dev/null
```

**Rule:** Use subPath mount when only specific files need write access within a directory containing read-only binaries/scripts. Full emptyDir mount would hide existing directory content.

## mvn package vs mvn compile

**Trigger:** Multi-module Maven reactor builds in Docker.

**Problem:** `mvn compile` does NOT package artifacts or run plugins that produce JARs/WARs. Dependent modules referencing `<packaging>jar</packaging>` of sibling modules fail at link time if only compile phase ran.

**Rule:**
- Single-module project: `mvn package -DskipTests` produces the deployable artifact
- Multi-module project: `mvn -pl module-a,module-b -am package -DskipTests` builds target modules AND all required ancestors
- NEVER use `mvn compile` in Dockerfile — it does not produce target/*.jar

**Detection:**
```bash
grep -c '<module>' pom.xml  # >0 = multi-module
grep 'mvn compile' Dockerfile  # WRONG — should be mvn package
```

## Java Version Pre-Migration Check

**Trigger:** Before writing the Dockerfile FROM line for any Java project.

**Procedure:**
```bash
# Check pom.xml for Java version
grep -oP '(?:java\.version|maven\.compiler\.source|maven\.compiler\.target|release)>\K[^<]+' pom.xml | head -1
# Check Gradle
grep -oP 'sourceCompatibility\s*=\s*['\''"]?\K[0-9]+' build.gradle 2>/dev/null
```

**Rule:** The Dockerfile base image Java version MUST match the project's declared version. Mismatches cause compilation failures or runtime `UnsupportedClassVersionError`. Common mappings: `1.8`/`8` → `eclipse-temurin:8-jdk`, `11` → `eclipse-temurin:11-jdk`, `17` → `eclipse-temurin:17-jdk`, `21` → `eclipse-temurin:21-jdk`.

## SCREAMING_SNAKE_CASE Circular Placeholder

**Trigger:** Spring properties using `${SAME_NAME}` where the property key matches the env var name exactly.

**Problem:** `PropertySourcesPlaceholderConfigurer` resolves `${X}` by looking up property "X". If the property file defines `X=${X:default}`, the resolution is: property "X" → placeholder "${X}" → property "X" → circular reference → `IllegalArgumentException`.

**Before (circular):**
```properties
DB_PASSWORD=${DB_PASSWORD:secret}
```

**After (distinct names):**
```properties
# Use dot-notation property with SCREAMING_SNAKE env var
spring.datasource.password=${DB_PASSWORD:secret}
```

**Detection:**
```bash
grep -nP '^([A-Z][A-Z0-9_]+)\s*=\s*\$\{\1' src/main/resources/*.properties 2>/dev/null
```

**Rule:** The property key (left side of =) MUST differ from the placeholder variable name (inside ${}). Spring resolves environment variables first, so `spring.datasource.password=${DB_PASSWORD}` works because "DB_PASSWORD" is resolved from the environment, not from the same properties file.

## SPRING_PROFILES_ACTIVE Mandatory ConfigMap

**Trigger:** Multi-profile Spring applications (detected via `@Profile` annotations or multiple `application-*.properties` files).

**Detection:**
```bash
find src/main/resources -name 'application-*.properties' -o -name 'application-*.yml' | wc -l
grep -rn '@Profile' src/ --include='*.java' | wc -l
```

**Rule:** If the project has ≥2 profile-specific config files OR ≥1 `@Profile` annotation, `SPRING_PROFILES_ACTIVE` MUST appear in the ConfigMap. Without it, Spring activates the "default" profile — production-specific beans (cache, messaging, JDBC clustering) remain inactive.

**ConfigMap entry:**
```yaml
data:
  SPRING_PROFILES_ACTIVE: "prod"
```

**ENV_VARIABLES.md entry:** `SPRING_PROFILES_ACTIVE` — Active Spring profiles, comma-separated. K8s Scope: ConfigMap. Default: "prod".

## Infinispan !cloud Profile-Guard

**Trigger:** Infinispan/JGroups configuration with a `!cloud` (not-cloud) profile guard in Spring.

**Problem:** Legacy apps wrap Infinispan JGroups config under `@Profile("!cloud")` — meaning the cluster transport is disabled when the `cloud` profile is active. If `SPRING_PROFILES_ACTIVE` includes "cloud" or "prod,cloud", the Infinispan cache silently falls back to local-only mode (no clustering).

**Detection:**
```bash
grep -rn '@Profile.*!cloud\|spring\.profiles.*cloud' . --include='*.java' --include='*.xml' --include='*.properties'
```

**Resolution options:**
1. Remove the `!cloud` guard if Kubernetes deployment needs clustering (replace JGroups UDP with KUBE_PING — see §23)
2. Ensure `SPRING_PROFILES_ACTIVE` does NOT include "cloud" if the guard is intentional
3. Add a Kubernetes-specific profile (`@Profile("kubernetes")`) that activates KUBE_PING transport

**Rule:** Document the profile-guard in ENV_VARIABLES.md with a note explaining its impact on caching behaviour.

## @PropertySource Requirement for @ConfigurationProperties with XML PPC

**Trigger:** `@ConfigurationProperties` class that reads from a separate properties file loaded via XML `PropertyPlaceholderConfigurer` (PPC).

**Problem:** Spring Boot's `@ConfigurationProperties` binds ONLY from `PropertySource`s registered in the Spring `Environment`. XML PPC loads properties into its own resolver but does NOT register them as a `PropertySource` — so `@ConfigurationProperties` never sees them.

**Detection:**
```bash
# Find @ConfigurationProperties classes
grep -rn '@ConfigurationProperties' . --include='*.java'
# Find XML-only property loading
grep -rn 'PropertyPlaceholderConfigurer' . --include='*.xml' | grep -oP 'location="[^"]*"'
```

**Fix — add @PropertySource to the @Configuration class:**
```java
@Configuration
@PropertySource("classpath:custom.properties")
@ConfigurationProperties(prefix = "app")
public class AppConfig { ... }
```

**Rule:** When `@ConfigurationProperties` needs properties from a file loaded only by XML PPC, add an explicit `@PropertySource` annotation pointing to the same file. This registers the file in Spring's `Environment`, making its properties visible to the binder.

## Spring Profile Override Sweep

**Trigger:** After externalising base `application.properties`/`application.yml` properties, profile-specific override files may still contain hardcoded values that bypass the migration.

**Problem:** Spring loads properties in order: `application.properties` → `application-{profile}.properties`. Profile-specific files OVERRIDE base properties. If a profile file has a hardcoded value for a property you just externalised in the base file, the env var injection is silently nullified at runtime.

**Procedure — mandatory post-externalisation check:**
```bash
# Find all profile-specific config files
find src/main/resources -name 'application-*.properties' -o -name 'application-*.yml' | while read f; do
  # Check for non-placeholder values (lines without ${ that aren't comments)
  grep -n '^[a-z]' "$f" | grep -v '^\s*#' | grep -v '\${' | head -20
done
```

**Rule:** After externalising any property to `${ENV_VAR}` in the base config, grep ALL profile-specific files for the same property key. If found with a hardcoded value, either:
1. Remove the line (let base config win), OR
2. Replace with the same `${ENV_VAR:profile-specific-default}` pattern

**Example:**
```properties
# application.properties (base — correctly externalised):
spring.datasource.url=${DATABASE_URL}

# application-prod.properties (OVERRIDE — silently re-hardcodes!):
spring.datasource.url=jdbc:mysql://prod-db:3306/app  # BUG: overrides env var!
```

## Gradle Wrapper Two-COPY Dockerfile Pattern

**Trigger:** Gradle project with `gradlew` wrapper script.

**Problem:** `gradlew` requires both the wrapper script AND the `gradle/wrapper/` directory (containing `gradle-wrapper.jar` and `gradle-wrapper.properties`). A single `COPY . .` prevents Docker layer caching. The two-COPY pattern enables dependency caching.

**Dockerfile pattern:**
```dockerfile
FROM gradle:8-jdk21 AS builder
WORKDIR /app

# Layer 1: Gradle wrapper + dependency resolution (cached unless build files change)
COPY gradle ./gradle
COPY gradlew ./
COPY build.gradle settings.gradle ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon

# Layer 2: Source code (changes frequently)
COPY src ./src
RUN ./gradlew build -x test --no-daemon
```

**Rule:** For Gradle projects, ALWAYS use the two-COPY pattern:
1. First COPY: `gradle/` directory + `gradlew` + build files → `RUN ./gradlew dependencies`
2. Second COPY: `src/` → `RUN ./gradlew build`

**chmod requirement:** The `gradlew` script needs execute permission. Add `RUN chmod +x gradlew` after COPY if the file loses permissions during Docker COPY.

## Latin-1 Properties Encoding Guard

**Trigger:** Java `.properties` files containing non-ASCII characters (accents, CJK, etc.).

**Problem:** Java `.properties` files are loaded as ISO-8859-1 (Latin-1) by default. If a properties file was saved as UTF-8 and contains non-ASCII characters, they will be garbled at runtime. When modifying properties files during migration, preserve the original encoding.

**Detection:**
```bash
file -i src/main/resources/*.properties | grep -v 'iso-8859-1\|us-ascii\|utf-8'
# Any match = unexpected encoding — investigate
```

**Rule:** When writing to `.properties` files programmatically during migration:
1. Detect the original encoding: `file -i <file>`
2. If ISO-8859-1: use Python `open(f, 'w', encoding='latin-1')` or ensure only ASCII+Latin-1 characters
3. If UTF-8 with non-ASCII: preserve UTF-8 encoding but note that `ResourceBundle` will misread it unless `PropertyResourceBundle(Reader)` constructor is used (Java 9+)

**Safe migration approach:** Use Unicode escapes for non-ASCII in .properties:
```properties
# Instead of: greeting=Héllo
greeting=H\u00e9llo
```

## Azure Blob Connection String Externalisation

**Trigger:** Java/Spring project using Azure Blob Storage with connection strings.

**Problem:** Azure connection strings follow the pattern `DefaultEndpointsProtocol=https;AccountName=X;AccountKey=Y;EndpointSuffix=core.windows.net`. The variable NAME (e.g., `AZURE_STORAGE_CONNECTION_STRING`) does not contain credential keywords like "password" — but the VALUE embeds the `AccountKey` which IS a credential.

**Rule:** This is a canonical example of the **value-content-supersedes-name** rule. Classify as Secret regardless of variable name:

```yaml
# kubernetes/secret.yaml
stringData:
  AZURE_STORAGE_CONNECTION_STRING: "replace-with-azure-connection-string"
```

**Detection:**
```bash
grep -rn 'DefaultEndpointsProtocol\|AccountKey\|azure.*connection.*string' src/ config/ --include='*.properties' --include='*.yml' --include='*.yaml' --include='*.java'
```

**Spring property externalisation:**
```properties
# application.properties
azure.storage.connection-string=${AZURE_STORAGE_CONNECTION_STRING}
```

**ENV_VARIABLES.md entry:** `AZURE_STORAGE_CONNECTION_STRING` — Azure Storage connection string (contains AccountKey). K8s Scope: Secret.

## DB-Stored Runtime Configuration (Java)

**Trigger:** Java frameworks that persist settings in database tables (OpenMRS `GlobalProperty`, custom `app_settings` tables).

**Problem:** Workers may attempt to add ConfigMap/Secret keys for settings stored in database tables. These values are configured via the admin UI at runtime, not injected via environment variables.

**Rule:** Do NOT add ConfigMap/Secret keys for DB-stored configuration values. Document them in INFRASTRUCTURE_REQUIREMENTS.md §2 or §5b as "post-install admin configuration". Still add NetworkPolicy egress rules for relay hosts referenced by DB-stored config.

**Detection:**
```bash
grep -rn 'GlobalProperty\|app_settings\|system_setting\|config_property' . --include='*.java' --include='*.xml' | grep -v test
```

## Alpine Shebang Compatibility

**Trigger:** Entrypoint scripts (`entrypoint.sh`, `docker-entrypoint.sh`, `startup.sh`) used with `*-alpine` base images (e.g., `eclipse-temurin:21-jre-alpine`).

**Problem:** Alpine Linux uses BusyBox ash as `/bin/sh`. `/bin/bash` does not exist by default. Entrypoint scripts with `#!/bin/bash` fail with "exec format error" or "not found" at container startup.

**Detection:**
```bash
grep -n '#!/bin/bash' entrypoint*.sh docker-entrypoint.sh startup*.sh 2>/dev/null
grep -n 'FROM.*alpine' Dockerfile
# Both present = startup failure
```

**WRONG:**
```bash
#!/bin/bash
exec java -jar /app/app.jar
```

**CORRECT:**
```bash
#!/bin/sh
exec java -jar /app/app.jar
```

**Rule:** For `*-alpine` base images, ALL entrypoint scripts MUST use `#!/bin/sh`. No bash-specific syntax is allowed: no `[[ ]]`, no arrays, no process substitution `<()`, no `${var//pattern/replace}`. Use POSIX-compatible alternatives.

**Source:** Alpine Linux uses BusyBox ash — https://wiki.alpinelinux.org/wiki/Shell_management

## JVM Flag Ordering in Entrypoint Scripts

**Trigger:** Java entrypoint scripts that assemble `java` command with JVM tuning flags.

**Problem:** JVM flags (`-Xmx`, `-Xms`, `-XX:*`, `-D*`) placed AFTER `-jar` are silently treated as application arguments, not JVM options. The application ignores them without error.

**WRONG:**
```bash
#!/bin/sh
exec java -jar /app/app.jar -Xmx512m -Djava.io.tmpdir=/tmp
```

**CORRECT:**
```bash
#!/bin/sh
exec java -Xmx512m -Xms256m -Djava.io.tmpdir=/tmp -jar /app/app.jar
```

**Detection:**
```bash
grep -n '\-jar.*\-X\|\-jar.*\-D' entrypoint*.sh docker-entrypoint.sh startup*.sh Dockerfile 2>/dev/null
# Any match = flags after -jar (silently ineffective)
```

**Rule:** ALL `-X*` and `-D*` flags MUST precede the `-jar` argument. Pattern: `exec java [JVM_FLAGS] -jar /app/app.jar [APP_ARGS]`.

## Log4j2/Logback File-Only Logger Redirect

**Trigger:** Logging transformation (§5) removing `RollingFile` or `FileAppender` elements from `log4j2.xml` or `logback.xml`.

**Problem:** Named loggers with `additivity="false"` and exclusive file-appender references produce zero output after file appenders are removed. The logger silently drops all messages because it has no remaining appender.

**Detection (pre-removal audit):**
```bash
grep -B2 'AppenderRef' src/main/resources/log4j2.xml | grep -v Console
# For each match with additivity="false", check if Console is referenced:
grep -A5 'additivity="false"' src/main/resources/log4j2.xml | grep -c 'Console'
# If count = 0 for any logger, that logger needs Console added before removal
```

**Rule:** Before removing ANY `RollingFile`/`FileAppender` element, scan ALL named loggers for exclusive file-appender references (`additivity="false"` + no `<AppenderRef ref="Console"/>`). Add `<AppenderRef ref="Console"/>` to such loggers BEFORE removing file appenders.

## S3 ListObjectsV2 Pagination

**Trigger:** Java S3 SDK code that lists bucket contents (file browsers, backup verification, bulk operations).

**Problem:** `listObjectsV2` returns max 1000 keys per request. Without pagination, the application silently processes only the first page.

**CORRECT (do-while with isTruncated):**
```java
ListObjectsV2Request request = ListObjectsV2Request.builder()
    .bucket(bucket).prefix(prefix).build();
ListObjectsV2Response response;
do {
    response = s3Client.listObjectsV2(request);
    response.contents().forEach(obj -> process(obj));
    request = request.toBuilder()
        .continuationToken(response.nextContinuationToken()).build();
} while (response.isTruncated());
```

**Detection:**
```bash
grep -rn 'listObjects\|ListObjectsV2' . --include='*.java' | grep -v test
# Check if continuation/pagination logic exists nearby
```

**Rule:** Every `listObjectsV2` call MUST use the do-while pagination pattern with `isTruncated()` check. Single-call listing is a data-loss bug for buckets with >1000 objects.

## IAM Policy Two-Statement Split

**Trigger:** S3 IAM policies in INFRASTRUCTURE_REQUIREMENTS.md §4.

**Problem:** `s3:ListBucket` operates on the BUCKET ARN (`arn:aws:s3:::BUCKET`), while object operations (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`) operate on the OBJECT ARN (`arn:aws:s3:::BUCKET/*`). Combining them in one statement with `BUCKET/*` causes `AccessDenied` on `ListBucket`.

**WRONG (single statement):**
```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
  "Resource": "arn:aws:s3:::BUCKET_NAME/*"
}
```

**CORRECT (two statements):**
```json
[
  {
    "Effect": "Allow",
    "Action": ["s3:ListBucket"],
    "Resource": "arn:aws:s3:::BUCKET_NAME"
  },
  {
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::BUCKET_NAME/*"
  }
]
```

**Rule:** S3 IAM policies MUST split into two statements: `ListBucket` on bucket ARN, object operations on `bucket/*` ARN. This applies to all IAM policy templates in INFRASTRUCTURE_REQUIREMENTS.md §4.

## JDBC-Backed Scheduler Override Rule

**Trigger:** Quartz JDBC JobStore, ShedLock, or similar JDBC-based distributed scheduler already configured.

**Problem:** Workers may generate a Kubernetes CronJob for tasks managed by a JDBC-backed scheduler. Since the scheduler already provides distributed coordination (row-level locks prevent duplicate execution across pods), a CronJob would cause double execution.

**Rule:** If the scheduler uses `JobStoreTX`, ShedLock's `LockProvider`, or any JDBC-backed coordination mechanism, do NOT generate a separate CronJob manifest. Document the existing coordination mechanism in INFRASTRUCTURE_REQUIREMENTS.md and add NetworkPolicy egress for the scheduler's DB connection.

**Detection:**
```bash
grep -rn 'JobStoreTX\|ShedLock\|LockProvider\|net.javacrumbs' . --include='*.java' --include='*.properties' --include='*.xml'
```

## Tomcat WAR vs Spring Boot terminationGracePeriodSeconds

**Trigger:** Traditional Tomcat WAR deployment (non-Spring Boot) vs embedded Spring Boot application.

**Problem:** Tomcat WAR applications do NOT have `server.shutdown=graceful` — they rely on Tomcat's `unloadDelay` (default 2000ms). Spring Boot applications use `spring.lifecycle.timeout-per-shutdown-phase`.

| Deployment | Grace Period | terminationGracePeriodSeconds |
|---|---|---|
| Spring Boot (embedded Tomcat) | `timeout-per-shutdown-phase` + 10s | See §46 formula |
| Tomcat WAR (non-Boot) | `unloadDelay` (default 2s) + 10s buffer | 12 (minimum 30 per K8s floor) |
| Tomcat WAR with custom shutdown | Custom connector `closeDelay` + 10s | closeDelay + 10 |

**Rule:** For Tomcat WAR deployments, use a standardised `terminationGracePeriodSeconds: 30` (K8s minimum floor) unless a custom shutdown timeout is configured. The +10s buffer accounts for SIGTERM propagation and servlet context destroy hooks.

## Javadoc Wildcard Escaping

**Trigger:** Java Dockerfile or shell commands containing `*/` substring (e.g., `target/*/` glob, `src/main/*/`).

**Problem:** `*/` inside a Javadoc comment (`/** ... */`) is interpreted as the comment-closing sequence. If a file contains wildcard paths in Javadoc, the comment terminates prematurely causing compilation errors.

**Escape pattern:** Use `&#42;/` in Javadoc or avoid `*/` by using descriptive text:
```java
/**
 * Files matching target/&#42;/.jar are included.
 */
```

**Detection:** `grep -rn '\*/' src/ --include='*.java' | grep -v '^\s*\*/' | grep -v '^.*\*\*/'`

**Rule:** When generating MIGRATION comments containing glob patterns with `*/`, use single-line `//` comments instead of `/** */` blocks to avoid Javadoc parse errors.

## Multi-Module Test Shadow Rule for XML PPC

**Trigger:** Multi-module Maven project with PropertyPlaceholderConfigurer loading a shared properties file that was migrated to use `${VAR}` placeholders.

**Problem:** Test classes in dependent modules that load the XML context transitively pull in the PPC bean, which attempts to resolve `${VAR}` from the properties file. Without a test-specific properties file providing defaults, tests fail with `Could not resolve placeholder`.

**Detection:**
```bash
# Find XML context files loaded in tests
grep -rn 'ClassPathXmlApplicationContext\|@ContextConfiguration.*xml' src/test/ --include='*.java'
# Cross-reference with PPC-loaded properties files
grep -rn 'PropertyPlaceholderConfigurer' src/main/resources/*.xml | grep -oP 'location="[^"]*"'
```

**Rule:** After migrating any properties file loaded by XML PPC to use `${VAR}` placeholders, create a test shadow file at `src/test/resources/<same-path>` with safe defaults for ALL newly-introduced placeholders.

## Latin-1 Properties File Detection

**Trigger:** Java `.properties` files with non-ASCII characters that must be preserved during migration edits.

**Problem:** Java `Properties.load(InputStream)` reads ISO-8859-1 (Latin-1). If a worker writes to the file using UTF-8 encoding, non-ASCII characters (accents, umlauts) become garbled at runtime.

**Detection:**
```bash
file -i src/main/resources/*.properties 2>/dev/null | grep -v 'us-ascii'
```

**Rule:** When editing `.properties` files during migration, always preserve the original encoding. If the file is Latin-1, write replacements using Python with `encoding='latin-1'` or use only ASCII-safe characters (Unicode escapes for non-ASCII: `\u00e9` for é).

## Classic PPC No-Relaxed-Binding

**Trigger:** Legacy Spring XML `PropertyPlaceholderConfigurer` (not Spring Boot PSPC).

**Problem:** Classic PPC does NOT support Spring Boot's relaxed binding. `${db.password}` in a properties file resolves ONLY from a property named exactly `db.password` — NOT from `DB_PASSWORD` env var. Spring Boot's PSPC bridges these automatically, but classic PPC does not.

**Rule:** For applications using XML PPC without Spring Boot, env var injection requires explicit bridging in the properties file:
```properties
# Bridge env var to dotted property name for classic PPC:
db.password=${DB_PASSWORD:default}
```

Without this bridge line, setting `DB_PASSWORD` as an env var has no effect on the `db.password` placeholder.

**Detection:**
```bash
grep -rn 'PropertyPlaceholderConfigurer' . --include='*.xml' | grep -v 'test'
grep -L 'spring-boot\|SpringApplication' src/main/java/**/*.java 2>/dev/null | head -1
# Both present + no Boot = classic PPC project
```

## terminationGracePeriodSeconds Standard Buffer

**Rule:** When no explicit graceful shutdown timeout is configured by the application, use `terminationGracePeriodSeconds: 30` as the standard minimum. When an explicit timeout IS configured, add exactly 10 seconds as the buffer (not 5s):

| Scenario | Formula |
|---|---|
| No graceful shutdown config | 30 (K8s default floor) |
| Spring Boot `timeout-per-shutdown-phase=Ns` | N + 10 |
| PHP-FPM supervisord `stopwaitsecs=Ns` | N + 30 |
| Custom app shutdown handler | handler_timeout + 10 |

The 10s buffer (increased from 5s) accounts for SIGTERM delivery latency, container runtime overhead, and pre-stop hook execution.

## PPC Detection and Migration (Phase 1 Blocker)

**Trigger:** Legacy Spring XML application using `PropertyPlaceholderConfigurer` (PPC) without Spring Boot.

**Problem:** PPC does NOT support env var resolution natively. Unlike Spring Boot's PSPC which bridges `${DB_PASSWORD}` to the `DB_PASSWORD` env var automatically, classic PPC only resolves from its configured `.properties` file locations. This is a **Phase 1 Blocker** — env var externalisation cannot work without bridging.

**Detection:**
```bash
grep -rn 'PropertyPlaceholderConfigurer' . --include='*.xml' | grep -v test
grep -L 'SpringApplication\|@SpringBootApplication' src/main/java/**/*.java 2>/dev/null | head -1
# Both present + no Boot = classic PPC project needing migration
```

**Migration path (PPC → PSPC):**
1. Add Spring Boot dependency OR `PropertySourcesPlaceholderConfigurer` bean
2. For each `<property>` in PPC XML, add explicit bridge in properties file: `property.key=${ENV_VAR:default}`
3. Ensure `ignoreUnresolvablePlaceholders=true` on legacy PPC if keeping both

**Three injection paths for Classic Spring WAR (no-relaxed-binding):**
Classic PPC does NOT support Spring Boot's relaxed binding. `${db.password}` resolves ONLY from a property named exactly `db.password`, NOT from `DB_PASSWORD` env var.

| Injection Path | Mechanism | Env Var Works? |
|---|---|---|
| XML PPC `<property>` | Literal property file lookup | NO — needs explicit bridge line |
| `@Value("${prop.name}")` with PSPC | Spring Boot relaxed binding | YES (if PSPC active) |
| `Environment.getProperty()` | Spring Environment abstraction | YES (env vars are a PropertySource) |

**Rule:** For every `${dotted.name}` placeholder in a classic PPC project, add a bridge line in the properties file: `dotted.name=${SCREAMING_SNAKE_NAME:default}`. Without this, setting env vars has no effect.

## Spring Boot Flyway/Mail Job Autoconfigure Exclusion

**Trigger:** Spring Boot application with Flyway AND background jobs (Kafka consumers, mail senders) that fail on missing DataSource or MailSender beans.

**Problem:** Spring Boot auto-configures `FlywayAutoConfiguration` for ALL Spring contexts including standalone worker jobs that don't need database migration. Similarly, `MailSenderAutoConfiguration` fails if SMTP is not configured for workers that don't send mail.

**Detection:**
```bash
grep -rn 'spring-boot-starter-mail\|FlywayAutoConfiguration\|spring.flyway' . --include='*.java' --include='*.properties' --include='*.gradle'
```

**Fix — exclude in worker/job application class:**
```java
@SpringBootApplication(exclude = {
    FlywayAutoConfiguration.class,
    MailSenderAutoConfiguration.class
})
public class KafkaWorkerApplication { ... }
```

**Rule:** When a Spring Boot project has multiple entry points (web app + Kafka consumer + CronJob), each non-web entry point MUST exclude auto-configurations it doesn't need. Common exclusions for workers:
- `FlywayAutoConfiguration` — unless the worker runs migrations
- `MailSenderAutoConfiguration` — unless the worker sends mail
- `WebMvcAutoConfiguration` — always exclude for non-web (already in §18)

## Post-T2 Test Classpath Shadow Sync

**Trigger:** After Tier 2 (kubeconform) passes and before Final Review, verify test infrastructure still compiles.

**Problem:** Properties externalised during Sub-Phase §3/§7 (e.g., `${DB_PASSWORD}` with no default) cause test failures with `Could not resolve placeholder` when test resource files lack corresponding defaults.

**Procedure:**
```bash
# Find all ${VAR} references without defaults in main resources
grep -rn '\${[A-Z_]*}' src/main/resources/*.properties src/main/resources/*.yml 2>/dev/null | grep -v ':-\|:[^}]'
# For each match, diff against test resources
for f in $(grep -rl '\${[A-Z_]*}' src/main/resources/ 2>/dev/null | grep -v ':'); do
  BASENAME=$(basename "$f")
  if [ ! -f "src/test/resources/$BASENAME" ]; then
    echo "MISSING TEST SHADOW: src/test/resources/$BASENAME"
  else
    # Check if test shadow has defaults for the same keys
    grep -c ':-\|:[^}]' "src/test/resources/$BASENAME" || echo "TEST SHADOW MAY LACK DEFAULTS: $BASENAME"
  fi
done
```

**Fix:** Create or update `src/test/resources/<filename>` with safe defaults for ALL newly-introduced `${VAR}` placeholders:
```properties
# src/test/resources/application.properties
db.password=${DB_PASSWORD:test-password}
api.secret=${API_SECRET:test-secret}
```

**Rule:** This check is part of the Post-Externalisation Test Sync Gate. Run within the same task that introduces `${VAR}` (no default) — do not defer.


## PIPESTATUS for Maven Pipe Verification

**Trigger:** Maven/Gradle build commands piped through `tee` or `grep` for log capture.

**Problem:** When piping build output (`mvn package 2>&1 | tee build.log`), the exit code captured by `$?` is from the LAST command in the pipe (tee, which always exits 0). The build tool's actual exit code is lost.

**Correct pattern:**
```bash
mvn package -DskipTests 2>&1 | tee /tmp/build.log
BUILD_EXIT=${PIPESTATUS[0]}
[ "$BUILD_EXIT" -eq 0 ] && echo "BUILD OK" || echo "BUILD FAILED (exit $BUILD_EXIT)"
```

**Rule:** ALWAYS use `${PIPESTATUS[0]}` after piped Maven/Gradle commands. `$?` captures only the rightmost command's exit code.

## Mixed-Type Secret envFrom Prohibition

**Trigger:** Spring applications using Secret with `envFrom` bulk injection where some keys contain dots.

**Problem:** Kubernetes `envFrom.secretRef` injects ALL keys as environment variables. Keys containing dots (e.g., `spring.datasource.password`) are invalid as env var names on Linux — they are SILENTLY SKIPPED. The application never receives these values.

**Detection:**
```bash
python3 -c "
import yaml
with open('kubernetes/secret.yaml') as f:
    for doc in yaml.safe_load_all(f):
        if doc and doc.get('kind') == 'Secret':
            for k in list(doc.get('stringData', {}).keys()) + list(doc.get('data', {}).keys()):
                if '.' in k:
                    print(f'INCOMPATIBLE: {k} — dots prevent envFrom injection')
"
```

**Rule:** Secret keys used with `envFrom` MUST NOT contain dots, slashes, or other characters invalid in env var names. For dotted keys, use explicit `env[].valueFrom.secretKeyRef` with SCREAMING_SNAKE_CASE env var name and let Spring relaxed binding bridge them.

## S3 IAM Two-Statement Policy Template

**Trigger:** ANY S3 IAM policy in INFRASTRUCTURE_REQUIREMENTS.md §4.

**Rule:** S3 IAM policies MUST use two statements with different resource ARNs:
- Statement 1: `s3:ListBucket` on bucket ARN (`arn:aws:s3:::BUCKET_NAME`)
- Statement 2: `s3:GetObject/PutObject/DeleteObject` on object ARN (`arn:aws:s3:::BUCKET_NAME/*`)

Include `s3:CopyObject` (source read) when the application moves files between paths. Missing `s3:ListBucket` causes misleading `AccessDenied` on non-existent keys.

See §64 (IAM Policy Two-Statement Split) for the canonical template.

## Hibernate Dual-Load Properties Guard

**Trigger:** Hibernate properties file loaded by BOTH raw `Properties.load()` (Java IO) AND Spring `PropertySource`/`@PropertySource`.

**Problem:** Raw `Properties.load(InputStream)` does NOT resolve `${VAR}` placeholders — it passes the literal string `${DB_PASSWORD}` as the JDBC credential. Spring `PropertySource` DOES resolve them. When the same file is read via both paths (common in legacy Hibernate + Spring hybrid apps), adding `${VAR}` syntax breaks the raw-load path.

**Detection:**
```bash
# Find properties files loaded by raw Properties.load()
grep -rn 'Properties.*load\|getResourceAsStream.*properties' . --include='*.java' | grep -v test
# Cross-reference with Spring @PropertySource
grep -rn '@PropertySource\|PropertyPlaceholderConfigurer' . --include='*.java' --include='*.xml'
```

**Rule:** When a properties file is loaded by BOTH raw `Properties.load()` AND Spring, NEVER add `${VAR}` placeholders for credentials. Instead: clear credentials to empty strings and rely on startup-script injection or environment variable override at the Spring PropertySource level. Add a MIGRATION comment explaining the dual-load constraint.

**Before (WRONG — breaks raw Properties.load path):**
```properties
hibernate.connection.password=${DB_PASSWORD}
```

**After (CORRECT — empty string for raw path, Spring resolves from env separately):**
```properties
hibernate.connection.password=
# MIGRATION: Dual-load file — raw Properties.load() cannot resolve ${VAR}. Credential injected via Spring Environment overlay.
```

## Log4j2 RollingFileAppender createOnDemand

**Trigger:** Log4j2 configuration with `RollingFile` appenders being redirected to Console (§5 Logging Transformation).

**Problem:** When `readOnlyRootFilesystem: true` is set, Log4j2 `RollingFile` appenders fail at startup because they create the log file eagerly during `appender.start()`. Adding `createOnDemand="true"` defers file creation until the first log event — but if the logger is never triggered (common for error-only file loggers), no write occurs and no crash happens.

**Rule:** When converting logging to stdout/stderr, if a `RollingFile` appender cannot be removed (e.g., it's referenced by a named logger with `additivity="false"`), add `createOnDemand="true"` AND redirect the logger to Console as the primary fix:

```xml
<!-- Before: eager file creation (crashes with readOnlyRootFilesystem) -->
<RollingFile name="ErrorLog" fileName="/var/log/app/error.log" ...>

<!-- After: deferred creation + Console redirect -->
<RollingFile name="ErrorLog" fileName="/tmp/error.log" createOnDemand="true" ...>
```

**Source:** Log4j2 `createOnDemand` parameter — "configure to create the log file only when a log event passed to the appender" (https://stackoverflow.com/questions/2719845/how-do-i-make-log4j-create-log-files-on-demand-only).

## Tomcat setenv.sh Write Avoidance

**Trigger:** Tomcat-based applications where `catalina.sh` sources `${CATALINA_BASE}/bin/setenv.sh` at startup.

**Problem:** With `readOnlyRootFilesystem: true`, if the entrypoint attempts to write/generate `setenv.sh` at runtime (common pattern for injecting JVM opts from env vars), the write fails and Tomcat refuses to start.

**Detection:**
```bash
grep -rn 'setenv\.sh\|CATALINA_OPTS\|JAVA_OPTS' entrypoint*.sh docker-entrypoint*.sh Dockerfile 2>/dev/null
```

**Rule:** Do NOT write `setenv.sh` at container runtime. Instead:
1. Bake a static `setenv.sh` into the image at build time with env var references: `CATALINA_OPTS="${JAVA_OPTS:-} -Djava.io.tmpdir=/tmp"`
2. OR pass JVM opts via the `JAVA_OPTS` env var and configure the entrypoint to use `exec java $JAVA_OPTS -jar ...` (Spring Boot) or ensure `catalina.sh` reads `CATALINA_OPTS` from environment (default Tomcat behaviour).

## Infinispan Programmatic Injection Guard

**Trigger:** Infinispan/JGroups configured programmatically (not via XML) with `GlobalConfigurationBuilder`.

**Problem:** When Infinispan is configured programmatically and the cluster transport settings reference env vars at class-loading time (static initializers), the env vars must be available BEFORE Spring context starts. `@Value` injection is too late — the JGroups transport is initialized in a static block or constructor.

**Detection:**
```bash
grep -rn 'GlobalConfigurationBuilder\|DefaultCacheManager\|JGroupsTransport' . --include='*.java' | grep -v test
```

**Rule:** For programmatic Infinispan configuration, use `System.getenv()` directly (not Spring `@Value`) for transport-related settings (bind address, namespace, cluster name). Add these env vars to ConfigMap and document in ENV_VARIABLES.md:
- `JGROUPS_CLUSTER_NAME` — Infinispan cluster name
- `KUBE_NAMESPACE` — Kubernetes namespace for KUBE_PING discovery
- `JGROUPS_BIND_ADDRESS` — typically `SITE_LOCAL` or pod IP

## @KafkaListener Annotation EL Placeholders

**Trigger:** Spring Kafka applications using `@KafkaListener` annotations with Spring EL placeholders in `topics` or `groupId` attributes.

**Problem:** `@KafkaListener(topics = "${kafka.topic.name}")` resolves the topic name from Spring properties/env vars at runtime. Pass 1 env var grep scanning only `.properties`/`.yml` files misses these — the placeholder appears in a `.java` file annotation attribute.

**Detection:**
```bash
# Find @KafkaListener with EL placeholders
grep -rn '@KafkaListener' . --include='*.java' | grep '\${'
# Extract placeholder variable names
grep -rhoP '@KafkaListener.*?\$\{([A-Za-z_.]+)' . --include='*.java' | grep -oP '\$\{\K[A-Za-z_.]+'
```

**Rule:** Extend Pass 1 env var scan for Java/Spring projects to include `@KafkaListener` annotation attributes alongside `@Value`. Every `${placeholder}` in a `@KafkaListener` annotation needs either a Spring properties bridge (`kafka.topic.name=${KAFKA_TOPIC_NAME:default}`) or a direct env var entry.

**Common @KafkaListener placeholders requiring ConfigMap entries:**
- `${kafka.topic.name}` → `KAFKA_TOPIC_NAME` (ConfigMap)
- `${kafka.group.id}` → `KAFKA_GROUP_ID` (ConfigMap)
- `${kafka.consumer.concurrency}` → `KAFKA_CONSUMER_CONCURRENCY` (ConfigMap)

**ENV_VARIABLES.md entries:** All Kafka topic/group placeholders are ConfigMap-scoped (not Secret) — they are routing configuration, not credentials. Exception: `KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD` are credentials → Secret.

## Gradle Wrapper Stub Pattern

**Trigger:** Gradle projects where `gradlew` exists but `gradle/wrapper/gradle-wrapper.jar` is missing (e.g., `.gitignore` excludes JAR files).

**Problem:** `./gradlew build` fails immediately with "Could not find or load main class org.gradle.wrapper.GradleWrapperMain" when the wrapper JAR is absent from the repository.

**Detection:**
```bash
[ -f gradlew ] && [ ! -f gradle/wrapper/gradle-wrapper.jar ] && echo "WRAPPER STUB — JAR MISSING"
```

**Resolution options:**
1. Generate wrapper: `gradle wrapper` (requires system Gradle)
2. Use system Gradle directly: `gradle build -x test`
3. Use the Gradle Docker image in multi-stage build (bypass host-side gate): `FROM gradle:8-jdk21 AS builder`

**Rule:** When `gradlew` exists but `gradle-wrapper.jar` is absent, do NOT fail the build silently. Attempt resolution option 1, then 2, then 3. Record the method used in TRANSFORMATION_SUMMARY.md. If all options fail, record CONDITIONAL PASS with root cause.

## Spring Redis ENV Bridge (SPRING_REDIS_HOST vs REDIS_HOST)

**Trigger:** Spring Boot applications using Spring Data Redis where the source code reads `spring.redis.host` / `spring.data.redis.host` via property binding.

**Problem:** Workers create `REDIS_HOST` as the env var name, but Spring Data Redis expects `SPRING_REDIS_HOST` (or `SPRING_DATA_REDIS_HOST` in Spring Boot 3.x) for its auto-configuration. The application silently connects to `localhost` when the bridge is missing.

**Detection:**
```bash
grep -rn 'spring\.redis\|spring\.data\.redis' src/main/resources/ --include='*.properties' --include='*.yml'
```

**Rule:** For Spring Data Redis, the ConfigMap env var MUST match the Spring property naming convention:
```properties
# application.properties — bridge to env var:
spring.data.redis.host=${SPRING_DATA_REDIS_HOST:localhost}
spring.data.redis.port=${SPRING_DATA_REDIS_PORT:6379}
```

**ConfigMap entry:**
```yaml
data:
  SPRING_DATA_REDIS_HOST: "replace-with-redis-host"
  SPRING_DATA_REDIS_PORT: "6379"
```

Do NOT use bare `REDIS_HOST` unless the application explicitly reads it via `System.getenv("REDIS_HOST")`.

## Kafka Consumer HPA Sizing Formula

**Trigger:** Spring Kafka applications with `@KafkaListener` and HPA configured.

**Problem:** Kafka consumers are limited by partition count — more replicas than partitions means idle consumers that waste resources. The HPA `maxReplicas` must not exceed `floor(partition_count / concurrency)`.

**Formula:** `safe_max_replicas = floor(partition_count / concurrency_per_consumer)`

**Detection:**
```bash
grep -rn '@KafkaListener\|concurrency' . --include='*.java' --include='*.properties' --include='*.yml' | grep -i 'concurrency\|partitions'
```

**Rule:** When generating HPA for Kafka consumer Deployments:
1. Extract `concurrency` from `@KafkaListener(concurrency = "N")` or `spring.kafka.listener.concurrency`
2. Document `partition_count` as a prerequisite in INFRASTRUCTURE_REQUIREMENTS.md
3. Set `maxReplicas = floor(partition_count / concurrency)` with a MIGRATION comment:
```yaml
# MIGRATION: maxReplicas = floor(TOPIC_PARTITIONS / CONSUMER_CONCURRENCY)
# Update when partition count changes. Exceeding this wastes idle consumers.
maxReplicas: 3  # Assumes 9 partitions / 3 concurrency
```

## Gradle bootJar archiveVersion

**Trigger:** Spring Boot Gradle projects where the built JAR has a version suffix (e.g., `app-1.0.0.jar`).

**Problem:** Dockerfile `COPY build/libs/*.jar /app/app.jar` works for single-JAR output, but if `bootJar` produces `app-1.0.0.jar` alongside `app-1.0.0-plain.jar` (from the `jar` task), the glob copies both — Docker COPY with multiple sources requires a directory destination.

**Fix — disable plain jar and optionally strip version:**
```groovy
// build.gradle
jar {
    enabled = false  // Disable plain JAR — only bootJar output
}
bootJar {
    archiveVersion.set('')  // Produces app.jar instead of app-1.0.0.jar
}
```

**Detection:**
```bash
ls build/libs/*.jar 2>/dev/null | wc -l
# If >1 JAR → plain jar is being produced alongside bootJar
grep -n 'bootJar\|archiveVersion\|jar {' build.gradle build.gradle.kts 2>/dev/null
```

**Rule:** For Spring Boot Gradle projects, either set `archiveVersion.set('')` in `bootJar` OR disable the `jar` task. The Dockerfile COPY pattern must match exactly one JAR file.

## Gradle Wrapper JAR Regeneration

**Trigger:** Gradle project where `gradle/wrapper/gradle-wrapper.jar` is missing (common when `.gitignore` excludes `*.jar`).

**Problem:** `./gradlew` fails immediately with "Could not find or load main class org.gradle.wrapper.GradleWrapperMain" when the wrapper JAR is absent.

**Procedure:**
```bash
# Step 1: Check if wrapper JAR exists
[ -f gradle/wrapper/gradle-wrapper.jar ] && echo "OK" || echo "MISSING"

# Step 2: If missing, check if system Gradle is available
command -v gradle && gradle wrapper --gradle-version=$(grep distributionUrl gradle/wrapper/gradle-wrapper.properties 2>/dev/null | grep -oP '\d+\.\d+(\.\d+)?' || echo "8.5")

# Step 3: If no system Gradle, use Docker-based build (bypass host gate)
# In Dockerfile:
FROM gradle:8-jdk21 AS builder
COPY . /build
WORKDIR /build
RUN gradle build -x test --no-daemon
```

**Rule:** When wrapper JAR is absent, attempt regeneration before falling back to system Gradle or Docker-based build. Record which method succeeded in TRANSFORMATION_SUMMARY.md.


## Spring XML PPC Does Not Bridge SCREAMING_SNAKE_CASE

**Trigger:** Legacy Spring XML application using `PropertyPlaceholderConfigurer` (PPC) without Spring Boot.

**Problem:** Classic PPC does NOT perform the relaxed binding that Spring Boot's `PropertySourcesPlaceholderConfigurer` (PSPC) provides. Specifically:
- `${db.password}` in a properties file resolves ONLY from a property named exactly `db.password`
- Setting `DB_PASSWORD` as an environment variable has NO effect on `${db.password}` placeholders
- Spring Boot PSPC automatically bridges `DB_PASSWORD` → `db.password` but classic PPC does not

**Detection (is this a classic PPC project?):**
```bash
# Check for PPC in XML
grep -rn 'PropertyPlaceholderConfigurer' . --include='*.xml' | grep -v test
# Check for absence of Spring Boot
grep -rL 'SpringApplication\|@SpringBootApplication' src/main/java/**/*.java 2>/dev/null | head -1
# Both conditions true = classic PPC project needing explicit bridging
```

**Migration requirement — explicit bridge lines:**
```properties
# Add to application.properties for EACH dotted property that needs env var injection:
db.host=${DB_HOST:localhost}
db.port=${DB_PORT:3306}
db.password=${DB_PASSWORD:}
hibernate.connection.url=jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/${DB_NAME:appdb}
```

Without these bridge lines, setting environment variables in ConfigMap/Secret has zero effect on the application's resolved property values.

**ENV_VARIABLES.md impact:** Document each bridged property with a note: "Requires explicit bridge in .properties file (classic PPC — no relaxed binding)."

**Post-externalisation test sync:** After adding `${VAR}` bridge lines, verify test profiles also have corresponding defaults. Classic PPC projects often load `application-test.properties` which must mirror the bridge syntax with test-safe values.

## spring-boot-starter-tomcat scope=provided + packaging=jar P0 Blocker

**Trigger:** Spring Boot project with `<packaging>jar</packaging>` (or no packaging element, which defaults to JAR) AND `spring-boot-starter-tomcat` with `<scope>provided</scope>`.

**Problem:** This combination causes a SILENT CrashLoopBackOff:
1. `mvn package` succeeds (exit 0) — producing a JAR
2. `docker build` succeeds (exit 0) — image builds correctly
3. Container starts, Spring Boot prints banner, then IMMEDIATELY exits with code 0
4. Kubernetes restarts → CrashLoopBackOff
5. No error in logs — just "Completed initialization in X ms" followed by exit

The root cause: `scope=provided` excludes the embedded Tomcat from the fat JAR. Spring Boot finds no `ServletWebServerFactory` bean, determines it's not a web application, and shuts down gracefully.

**Detection:**
```bash
grep -B2 -A2 'provided' pom.xml | grep -i 'tomcat\|jetty\|undertow'
grep '<packaging>' pom.xml  # If absent or 'jar', this is the P0 combination
```

**Fix — remove scope=provided:**
```xml
<!-- BEFORE (BROKEN for jar packaging): -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-tomcat</artifactId>
    <scope>provided</scope>
</dependency>

<!-- AFTER (CORRECT for jar packaging): -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-tomcat</artifactId>
</dependency>
```

**Rule:** For `<packaging>jar</packaging>`, ALWAYS remove `<scope>provided</scope>` from the embedded servlet container dependency. This fix is REQUIRED in Phase 2 §11 (Build/Release/Run) — do NOT assess as "non-blocking" or defer.

## MIGRATION Comment Env Var Scanning Note

**Trigger:** Java projects where `// MIGRATION:` comments describe removed credential values.

**Problem:** `grep -rn 'getenv\|System.getenv'` misses env var NAMES that only appear inside MIGRATION comments. This is correct behaviour — MIGRATION comments document past state, not current env var reads. However, some workers see MIGRATION comments mentioning env var names and incorrectly add them to ENV_VARIABLES.md.

**Rule:** MIGRATION comments are NOT sources of env var reads. Do NOT add entries to ENV_VARIABLES.md based solely on variable names found in MIGRATION comments. Only actual `System.getenv("VAR")`, `@Value("${VAR}")`, or `${VAR}` placeholder references in active (non-commented) code count as env var reads.

## Latin-1 .properties File Encoding Detection

**Trigger:** Java `.properties` files with non-ASCII content (accents, CJK characters).

**Problem:** Java `Properties.load(InputStream)` reads ISO-8859-1 (Latin-1) by default. If a worker modifies a .properties file using UTF-8 encoding, non-ASCII characters become garbled at runtime.

**Detection:**
```bash
file -i src/main/resources/*.properties 2>/dev/null | grep -v 'us-ascii'
```

**Rule:** When editing `.properties` files during migration:
1. Run detection above to identify encoding
2. If Latin-1: use `python3 -c "open('f','w',encoding='latin-1').write(content)"` for writes
3. If UTF-8 non-ASCII is needed: use Unicode escapes (`\u00e9` for é)
4. Never change a file's encoding without explicit intent

## Post-Externalisation Test Sync for spring-session-data-redis

**Trigger:** After adding `spring-session-data-redis` or `spring-boot-starter-data-redis` to `pom.xml` for session externalisation.

**Problem:** Spring auto-configuration detects the Redis starter on the classpath and immediately attempts to connect to Redis during test context startup. Without a test-specific override, ALL `@SpringBootTest` classes fail with `RedisConnectionException`.

**Fix — add to ALL test resource files:**
```properties
# src/test/resources/application-test.properties (or application.properties in test resources)
spring.session.store-type=none
spring.data.redis.repositories.enabled=false
management.health.redis.enabled=false
```

**Detection (after adding redis starter):**
```bash
grep -rn 'spring-session-data-redis\|spring-boot-starter-data-redis' pom.xml build.gradle
# If match found, verify test shadow exists:
grep -rn 'store-type=none' src/test/resources/ || echo "MISSING: test shadow for Redis session"
```

**Rule:** Adding `spring-session-data-redis` to dependencies REQUIRES immediate test sync in the SAME task. Do NOT defer — tests will fail in all subsequent tasks.

---

## MIGRATION Comment Javadoc Wildcard Hazard

**Trigger:** MIGRATION comments placed inside `/** ... */` Javadoc blocks that contain URL path globs (e.g., `*/path/*`, `/**/`).

**Problem:** Path glob patterns inside Javadoc blocks are interpreted as closing the comment (`*/` terminates the block), which causes compilation errors in the surrounding class.

**Rule:** Place all MIGRATION comments as `//` single-line comments immediately above or below the relevant code, never inside `/** ... */` Javadoc blocks. If a MIGRATION comment must appear near a method with Javadoc, insert it as a `//` comment after the closing `*/` of the Javadoc block.

---

## Dual-Namespace Elasticsearch/OpenSearch Coexistence

**Trigger:** Project dependencies include both Elasticsearch and OpenSearch client libraries simultaneously (e.g., `spring-data-elasticsearch` + `opensearch-rest-client`).

**Problem:** The two clients use separate Spring property namespaces (`spring.elasticsearch.*` vs `spring.opensearch.*`). Scanning for one namespace misses the other, causing incomplete externalisation.

**Rule:** When both client types are detected in the dependency manifest, treat them as independent property sets. Discover and externalise both `spring.elasticsearch.*` and `spring.opensearch.*` property namespaces in the same credential/config externalisation task. Document both sets in ENV_VARIABLES.md with distinct rows and correct ConfigMap/Secret classifications for each.

---

## PropertyPlaceholderConfigurer Test Shadow Requirement

**Trigger:** XML `PropertyPlaceholderConfigurer` (PPC) loading a `.properties` file that has credentials or required values with hardcoded defaults being removed as part of credential externalisation.

**Problem:** When default values are removed from a PPC-loaded properties file, the corresponding test resource file (also loaded by PPC in test scope) no longer has those values. Tests fail with `IllegalArgumentException: Could not resolve placeholder` at startup.

**Rule:** Whenever a default value is removed from a PPC-loaded properties file during credential externalisation, immediately add a test placeholder to the corresponding PPC-loaded test resource file (typically `src/test/resources/`). The test placeholder value should be a non-empty stub (e.g., `replace-with-test-value`) sufficient to satisfy the application's null/empty guard. This forward action prevents test compilation failures that would otherwise be discovered only at the build gate.

## Dual-Use Directory Init-Container-Copy Pattern

**Trigger:** Dockerfile `WORKDIR` or `COPY` target path that receives BOTH image-baked content (copied at build time) AND runtime writes (logged, cached, or generated at container start).

**Detection:**
```bash
# Find directories that are both COPY targets and runtime-write targets
grep '^COPY' Dockerfile | grep -v '\-\-from=' | awk '{print $NF}' | sort -u > /tmp/copy_targets.txt
grep -nE 'mkdir|touch|cat >|tee|>>' entrypoint*.sh docker-entrypoint*.sh 2>/dev/null | grep -oP '[\w/.-]+' | sort -u > /tmp/write_targets.txt
comm -12 /tmp/copy_targets.txt /tmp/write_targets.txt
```

**Problem:** Mounting an emptyDir at a Dual-Use path hides the image-baked content. The init-container-copy pattern solves this by copying image content into the emptyDir before the main container starts.

**Pattern:**
```yaml
initContainers:
- name: copy-content
  image: same-as-main-container:tag
  command: ['sh', '-c', 'cp -a /original/path/. /shared/']
  volumeMounts:
  - name: dual-use-vol
    mountPath: /shared
containers:
- name: main
  volumeMounts:
  - name: dual-use-vol
    mountPath: /original/path
volumes:
- name: dual-use-vol
  emptyDir: {}
```

**fsGroup co-requirement:** When using init-container-copy with emptyDir, the pod-level `securityContext.fsGroup` MUST match `runAsUser` on both init and main containers. Otherwise the main container cannot write to files copied by the init container.

**Rule:** When a path appears in BOTH COPY-target and runtime-write-target lists, apply the init-container-copy pattern. Never mount a bare emptyDir at a path containing image-baked content — it hides everything.

## Spring XML PPC vs PropertiesFactoryBean Resolution Differences

**Trigger:** Spring XML projects using BOTH `PropertyPlaceholderConfigurer` (PPC) and `PropertiesFactoryBean` (PFB).

**Key difference:**
| Bean | Resolves `${VAR}`? | Reads from Environment? | Use Case |
|------|-------------------|------------------------|----------|
| PropertyPlaceholderConfigurer | YES | YES (via systemEnvironmentVariablesMode) | Bean property injection |
| PropertiesFactoryBean | NO | NO | Provides raw Properties map to consuming beans |

**Source:** https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/config/PropertyPlaceholderConfigurer.html — "The default implementation delegates to resolvePlaceholder (placeholder, props) before/after the system properties check."

**Detection:**
```bash
grep -rn 'PropertiesFactoryBean\|util:properties' . --include='*.xml' --include='*.java' | grep -v test
```

**Rule:** Properties loaded via PropertiesFactoryBean bypass placeholder resolution. Adding `${DB_HOST}` to a PFB-loaded file returns the literal string `${DB_HOST}`. For PFB-backed beans, inject `Environment` bean and call `env.getProperty()` instead of relying on placeholder syntax.

## Multi-Profile Spring Property Scan

**Trigger:** Spring applications with profile-specific configuration files under multiple subdirectories (e.g., `profiles/cloud/`, `profiles/mysql/`, `config/`).

**Rule:** Pass 1 env var scanning MUST run against ALL profile subdirectories independently, not just the primary `src/main/resources/`. Discover all profile directories first:
```bash
find . -name 'application-*.properties' -o -name 'application-*.yml' | sed 's|/[^/]*$||' | sort -u
```
Then run Pass 1 grep against each discovered directory.

## AcceptHeaderLocaleResolver + LocaleChangeInterceptor Incompatibility

**Trigger:** Spring MVC applications using both `AcceptHeaderLocaleResolver` and `LocaleChangeInterceptor`.

**Problem:** `AcceptHeaderLocaleResolver` is read-only — it derives the locale from the HTTP `Accept-Language` header. `LocaleChangeInterceptor` attempts to call `setLocale()` which throws `UnsupportedOperationException`.

**Detection:**
```bash
grep -rn 'AcceptHeaderLocaleResolver\|LocaleChangeInterceptor' . --include='*.java' --include='*.xml' | grep -v test
```

**Rule:** If both are present: either replace `AcceptHeaderLocaleResolver` with `SessionLocaleResolver` (which supports `setLocale()`), or remove `LocaleChangeInterceptor`. Document as a Phase 2 finding — do not fix in-scope unless the task touches locale configuration.

## JobRunr / ShedLock Distributed Scheduling

**Trigger:** `net.javacrumbs.shedlock` or `org.jobrunr` in dependencies.

**Detection:**
```bash
grep -rn 'shedlock\|jobrunr\|@SchedulerLock\|JobRunrAutoConfiguration' . --include='*.java' --include='*.xml' --include='*.gradle' --include='pom.xml' | grep -v test
```

**Rule:** When ShedLock or JobRunr is detected with JDBC-backed coordination:
1. Do NOT generate a separate CronJob manifest — the scheduler coordinates across pods via database locks
2. Document the existing coordination mechanism in INFRASTRUCTURE_REQUIREMENTS.md
3. Add NetworkPolicy egress for the scheduler's DB connection
4. The HPA can safely scale — lock coordination prevents duplicate execution

**ShedLock minimum lock duration:** Ensure `@SchedulerLock(lockAtLeastFor = "PT5M")` or similar prevents same-job re-entry during horizontal scaling events (pod startup overlap).

## Non-Boot Spring WAR Env-Var Lowercasing

**Trigger:** Traditional Spring WAR (no Spring Boot) where entrypoint scripts lowercase environment variable names before passing to the application.

**Detection heuristic:**
```bash
# Check for Spring Boot absence
grep -L 'spring-boot-starter-parent\|SpringApplication' pom.xml 2>/dev/null
# Check for lowercasing in entrypoint
grep -rn 'tr.*upper.*lower\|sed.*y/A-Z/a-z/' entrypoint*.sh startup*.sh docker-entrypoint*.sh 2>/dev/null
```

**Problem:** Lowercasing transforms `camelCase` Spring `@Value` property names into all-lowercase, breaking resolution (e.g., `autoCreateUser` becomes `autocreateuser`).

**Workaround:** Mount a `.properties` file via Secret for properties requiring mixed-case names. See §camelCase @Value Env-Lowercasing Conflict for full details.

## Surefire forkCount=0 for Host-Side Test Execution

**Trigger:** Running `mvn test` on the host for the Pre-Docker Local Validation gate in environments without Docker or with limited process capabilities.

**Problem:** Surefire's default `forkCount=1` spawns a new JVM process per test class, which may fail in restricted containers (e.g., ECS tasks) or when JAVA_HOME is inconsistent.

**Proactive step:** Add `-DforkCount=0` when running tests on the host:
```bash
mvn test -DforkCount=0 -Dtest='!*IntegrationTest,!*Integration' -B -q
```

**Trade-off:** `forkCount=0` runs all tests in the Maven process JVM. Tests with static state leakage may interfere with each other. Use only for the host-side validation gate — production CI should use default forkCount.

**Detection:** If `mvn test` fails with JVM fork errors (e.g., `Error occurred in starting fork`), retry with `-DforkCount=0`.

## SMTP Egress from pom.xml Dependencies

**Trigger:** Spring Boot or Java project with mail sending capability detected from Maven dependencies.

**Detection:**
```bash
grep -E 'javax\.mail|jakarta\.mail|spring-boot-starter-mail|commons-email' pom.xml
```

**Rule:** When ANY of the above dependencies are present in pom.xml, include SMTP egress ports (25, 465, 587) in the NetworkPolicy — even if no `SMTP_HOST` env var is found in source code. Java mail libraries may use DB-stored or properties-file SMTP configuration that bypasses env var detection.

```yaml
# NetworkPolicy egress for SMTP
- ports:
  - protocol: TCP
    port: 25
  - protocol: TCP
    port: 465
  - protocol: TCP
    port: 587
```

