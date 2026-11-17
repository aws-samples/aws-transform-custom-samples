# Spring Boot Version Upgrade (3.x → 4.x)

## Name
Spring Boot Version Upgrade

## Objective
Migrate Spring Boot 3.x applications (Maven or Gradle) to Spring Boot 4.x (targeting 4.1.0 GA), upgrading the full Spring ecosystem — core framework, security, observability, testing, Jackson, Spring Cloud, Spring AI, Spring Batch, Spring Kafka, Spring AMQP, gRPC, Native/AOT, and third-party integrations — while keeping the project buildable and all tests passing after each step.

## Summary
This transformation uses an 18-step conditional pipeline. A router TD (the entry point) first generates a code intelligence report, then detects the Spring Boot version, build system, Java version, security/observability/AI/batch/messaging dependencies, and other ecosystem signals. It produces a `migration-plan.json` that lists only the transformation definitions (TDs) needed for this project. The pipeline then executes those TDs in order: core migration always runs, extension TDs (security/testing, observability, Spring AI, batch, messaging, cloud, gRPC, etc.) run only when their signal is detected, and a verification TD always runs last.

## Entry Criteria
- Project builds successfully on its current Spring Boot 3.x version (Maven: `mvn clean verify`; Gradle: `./gradlew build`).
- `pom.xml` or `build.gradle*` is present and accessible.
- Java 17+ runtime is available in the environment (Java 21 is preferred and will be targeted when present; falls back to 17 if 21 is unavailable).
- Source code is accessible under version control so changes can be reviewed and reverted.

## What Gets Migrated

| Area | Changes |
|---|---|
| **Core** | Spring Boot parent/BOM version bump; starter coordinate renames; property key renames; package relocations |
| **Jackson 3** | Upgrade from Jackson 2 to Jackson 3; migrate `com.fasterxml.jackson.*` coordinates and any custom serializers |
| **Security** | Spring Security 7 configuration DSL (`SecurityFilterChain` / lambda style); removal of `WebSecurityConfigurerAdapter` |
| **Testing** | `@MockBean` / `@SpyBean` removal (Mockito-based replacements); Testcontainers alignment |
| **Observability** | Micrometer / OpenTelemetry / Actuator module consolidation and package relocations |
| **Spring AI** | Spring AI 1.x → 2.0 migration (BOM, starter renames, MCP coordinate updates) |
| **Spring Batch** | Spring Batch 6 Chunk API, `@StepScope`, `@BatchProperty` → `@Value` |
| **Spring Kafka** | Kafka client and Spring Kafka version alignment for Boot 4 |
| **Spring AMQP** | RabbitMQ / AMQP starter and API updates |
| **Spring Cloud** | Upgrade to Spring Cloud 2025.1 (Oakwood), the Boot 4-compatible release train |
| **gRPC** | Spring gRPC 1.1+ (the official `org.springframework.grpc` starter), server/client property layout changes |
| **Native/AOT** | GraalVM native-maven-plugin or Gradle native plugin alignment; RuntimeHints updates |
| **Jersey** | Jersey 4 alignment under Spring Boot 4 |
| **Embedded servers** | Undertow / Jetty starter swap if the project opted out of the default Tomcat |
| **SpringDoc / SBA** | SpringDoc OpenAPI 3.x (Boot 4 line) and Spring Boot Admin 4.x |
| **Third-party compat** | JHipster, Camel, Resilience4j, Redisson, Shiro, Druid, AWS Serverless container coordinate/config updates |
| **JSpecify** | Nullability annotation migration (Kotlin projects, SpotBugs / NullAway, legacy `org.springframework.lang.*` imports) |

## Constraints and Guardrails
Strictly follow these rules at all times:
- Never delete or disable existing tests — a failing test means the migration must be fixed, not the test.
- Never downgrade a version that is already above the target.
- Do not modify source files during the router (assessment) phase; changes begin only after `migration-plan.json` is written.
- If Spring Boot is already on 4.x and no residual Boot-3 patterns remain, the TD aborts cleanly without making changes.
- Known blockers (dead ecosystems with no Boot 4 release: `net.devh:grpc-*`, `com.graphql-java:graphql-spring-boot-starter`, `io.github.jhipster:*`) are reported and the migration stops — no fake-green output.

## Validation / Exit Criteria
- `mvn clean verify` (or `./gradlew build`) passes with zero compilation errors and zero test failures on the target Spring Boot 4.x version.
- No residual Boot-3 patterns remain: no `javax.` Jakarta-EE imports that should be `jakarta.*`, no removed Security APIs (`WebSecurityConfigurerAdapter`, `antMatchers`, legacy `.and()` DSL), no Jackson 2 coordinates.
- Spring Boot version in all build files is 4.x.
- Java version is 21 (or 17 if the environment is constrained to JDK 17).
- Actuator `/actuator/health` responds 200 OK after a local start.

## Getting Started

This is an AWS-managed transformation available out-of-box in AWS Transform. To run it:

```bash
# Install / update the AWS Transform CLI
pip install awstransformcli --upgrade

# Run the transformation against your repository
atx transform run \
  -n "AWS/spring-boot-version-upgrade" \
  -p ./my-spring-boot-app \
  -c "mvn clean verify" \
  -x -t
```

For Gradle projects, replace the build command:

```bash
atx transform run \
  -n "AWS/spring-boot-version-upgrade" \
  -p ./my-spring-boot-app \
  -c "./gradlew build" \
  -x -t
```

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| AWS Transform CLI (`atx`) | Latest | Execute the transformation |
| Java | 17+ (21 preferred) | Compile Spring Boot 4.x projects |
| Maven | 3.9+ or Gradle 8.14+ | Build Spring Boot 4.x projects |
| Git | Any | Version control (required for rollback) |

### Expected Output

- `migration-plan.json` at the project root documenting detections and selected TDs.
- `migration-results.yaml` after the pipeline completes, summarising each TD's outcome.
- Updated `pom.xml` / `build.gradle*` with Spring Boot 4.x versions.
- Source changes for security DSL, Jackson 3, package relocations, and any extension areas detected.
- Project builds and tests pass on Spring Boot 4.x.

## Known Limitations

| Limitation | Severity | Notes |
|---|---|---|
| `net.devh:grpc-spring-boot-starter` | BLOCKER | No Boot 4-compatible release. Use the official `org.springframework.grpc` starter instead. |
| `com.graphql-java:graphql-spring-boot-starter` | BLOCKER | Dead Boot-2 ecosystem. Migrate to `spring-boot-starter-graphql` manually (different programming model). |
| `io.github.jhipster:jhipster-*` (pre-JHipster-7 groupId) | BLOCKER | Abandoned; no Boot 3/4 release. The successor is `tech.jhipster:*`. |
| Spring Boot < 3.0 | FLAG | Projects on Boot 2.x are accepted but flagged `red-xlarge` (javax→jakarta sweep + Boot 2 property renames required on top of the standard 3→4 checklist). |
| Projects > 50K LOC | RISK | May approach ATX agent context limits. Consider splitting into modules. |

## References

- [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- [Spring Framework 7.0 What's New](https://github.com/spring-projects/spring-framework/wiki/What's-New-in-Spring-Framework-7.x)
- [Spring Security 7 Migration Guide](https://docs.spring.io/spring-security/reference/migration/index.html)
- [Spring Cloud 2025.1 (Oakwood) Release Notes](https://spring.io/projects/spring-cloud)
- [Jackson 3 Migration Notes](https://github.com/FasterXML/jackson/wiki/Jackson-Release-3.0)
