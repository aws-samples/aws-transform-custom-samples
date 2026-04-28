# JBoss-to-Spring-Boot Migration Skill

Automated migration of JBoss EAP / WildFly Java EE applications to standalone Spring Boot 3.2.x using an AI agent skill with conditional pipeline architecture.

**24/24 benchmark repositories migrated · 540+ tests passing · 0 failures · 20/20 exit criteria on all projects · 40+ Java EE patterns handled · ~$1.94 avg cost per app**

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [What This Skill Does](#what-this-skill-does)
- [Skill Architecture](#skill-architecture)
- [Patterns Handled (40+)](#patterns-handled)
- [Edge Cases](#edge-cases)
- [Getting Started](#getting-started)
- [Getting Started with AWS Transform Custom](#getting-started-with-aws-transform-custom)
- [Benchmark Results](#benchmark-results)
- [Documentation & References](#documentation--references)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

## Overview

Automate the migration of enterprise Java applications from JBoss EAP / WildFly application servers to standalone Spring Boot 3.2.x applications. This skill eliminates application server dependencies, modernizes to cloud-native containerized deployments, and reduces operational overhead — converting what typically takes weeks of manual effort per application into an automated, repeatable process.

## The Problem

Organizations running Java EE applications on JBoss EAP or WildFly face:

- **Operational overhead**: Managing and patching application servers across environments
- **Slow deployment cycles**: WAR/EAR packaging, server restarts, and complex deployment descriptors
- **Vendor lock-in**: Tight coupling to JBoss-specific APIs (EJBs, JNDI, JBoss Security Realms, proprietary XML configs)
- **Cloud-unfriendly**: WAR/EAR deployment model doesn't fit container orchestration (Kubernetes, ECS)
- **Talent scarcity**: Fewer developers with EJB/JBoss expertise; Spring Boot is the dominant Java framework
- **Manual migration is error-prone**: Requires deep knowledge of both frameworks, typically 2-6 weeks per application

## What This Skill Does

Given a JBoss/WildFly Java EE application, this skill automatically:

1. Converts WAR/EAR packaging to standalone executable JAR with embedded Tomcat
2. Replaces EJBs (@Stateless, @Stateful, @Singleton, @MessageDriven) with Spring @Service/@Component beans
3. Eliminates JNDI lookups in favor of Spring dependency injection
4. Migrates JAX-RS REST endpoints to Spring MVC @RestController
5. Converts JBoss XML configs (jboss-web.xml, persistence.xml, beans.xml) to application.yml
6. Migrates javax.persistence to jakarta.persistence namespace
7. Replaces container-managed transactions with Spring @Transactional
8. Migrates JBoss Security to Spring Security (when applicable)
9. Converts Arquillian tests to @SpringBootTest
10. Adds Spring Boot Actuator for health checks, metrics, and observability
11. Creates production-ready Dockerfile with multi-stage build
12. Updates documentation with Spring Boot build/run instructions

## Skill Architecture

The skill uses a 6-phase conditional pipeline. Phase 0 scans the project and sets feature flags, then only the required phases execute:

```
Phase 0: Scanner ──→ Phase 1: Build & Config ──→ Phase 2: Business Logic
  Analyze project,     pom.xml, deps, JAR,        EJBs→@Service, JNDI→DI,
  detect features,     javax→jakarta,              JAX-RS→Spring MVC,
  set phase flags      application.yml             CDI→Spring
  │                    ALWAYS runs                 ALWAYS runs
  │
  ├──→ Phase 3: Security & Messaging (CONDITIONAL)
  │      JBoss Security→Spring Security, JMS→Spring JMS
  │      ONLY if SECURITY_NEEDED or JMS_NEEDED
  │
  ├──→ Phase 4: Testing & UI (CONDITIONAL parts)
  │      Arquillian→@SpringBootTest (if ARQUILLIAN_TESTS)
  │      JSF→Thymeleaf/REST (if JSF_NEEDED)
  │      ALWAYS runs, but scope varies
  │
  └──→ Phase 5: Deployment & Verification
         Dockerfile, Actuator, README, 20-point validation
         ALWAYS runs
```

### Key Design Decisions

1. **Conditional phase execution.** Phase 0 scans the project and sets flags (SECURITY_NEEDED, JMS_NEEDED, JSF_NEEDED, etc.). Phase 3 is skipped entirely when not needed, preventing Spring Security from auto-blocking requests on apps without security. This reduces agent time and risk.

2. **Risk-based complexity assessment.** Before migration, the skill scans for HIGH-risk patterns (EAR 3+ modules, JSF, Stateful EJBs with @Remove, XA transactions) and classifies complexity as GREEN/YELLOW/ORANGE/RED.

3. **20-point exit criteria validation.** Every transformation is validated against 20 criteria covering functional parity, code quality, security, performance, and deployment readiness. All 24 projects achieve 20/20.

4. **On-demand reference dispatch.** 11 reference documents are loaded only when the agent encounters specific patterns (e.g., JAX-RS endpoints trigger `jaxrs-spring-mvc-migration.md`), keeping context focused.

5. **Continual learning.** 20 knowledge items discovered across migrations are encoded back into the skill, improving success on subsequent runs.

## Edge Cases

| Scenario | How It's Handled |
|---|---|
| Multi-module EAR (3+ modules) | Consolidated into single Spring Boot JAR; source trees merged in dependency order |
| JSF/PrimeFaces UI (.xhtml) | Converted to REST APIs or Thymeleaf templates (no native Spring Boot support) |
| @Stateful EJB with @Remove/@PreDestroy | Converted to @Service + @SessionScope; @Remove becomes regular cleanup method |
| XA/JTA distributed transactions | Replaced with separate Spring TransactionManagers per datasource |
| Vaadin 8 (javax.servlet dependency) | Migrated to Vaadin 24 Flow with Spring Boot 3.2.5 |
| BRMS/Drools KIE engine | Preserved with community KIE dependencies; javax.inject transitive accepted |
| Jackson 1.x (codehaus) annotations | Migrated to fasterxml; codehaus dependencies removed |
| Joda-Time DateTime fields | Replaced with java.time.LocalDateTime across entities |
| C3P0/DBCP connection pools | Removed; HikariCP auto-configured by Spring Boot |
| CDI @Produces EntityManager (Resources.java) | Deleted entirely; Spring Boot auto-configures EntityManager |
| Spring XML config (applicationContext.xml) | Converted to @Configuration + @Value; XML deleted |
| log4j.xml logging config | Converted to logback-spring.xml |
| JSP pages | Converted to static HTML or Thymeleaf templates |
| @RolesAllowed annotations | Replaced with @PreAuthorize + @EnableMethodSecurity |
| Custom JBoss Valve/Interceptor | Mapped to Spring MVC HandlerInterceptor or OncePerRequestFilter |
| @PostConstruct + @Transactional | Replaced with @EventListener(ApplicationReadyEvent.class) |
| Duplicate @Controller class names | Resolved with explicit bean names |
| LazyInitializationException (open-in-view=false) | Fixed with JOIN FETCH in JPQL queries |
| H2 v2.x date format incompatibility | Uses lowercase yyyy-MM-dd in PARSEDATETIME() |
| Hibernate snake_case naming strategy | SQL in data.sql uses snake_case column names |
| Embedded Artemis missing server classes | Adds artemis-server + artemis-jms-server dependencies explicitly |
| No security in original app | Spring Security NOT added (prevents auto-blocking all requests) |

## Patterns Handled

| Java EE / JBoss Pattern | Spring Boot Equivalent | Validated In |
|---|---|---|
| @Stateless EJB | @Service + @Transactional | All 24 projects |
| @Singleton @Startup | @Component + CommandLineRunner | project1, project4, project5, project7–10 |
| @MessageDriven (MDB) | @Component + @JmsListener | project2, cdbookstore, cargotracker, thread-racing |
| @Stateful EJB | @Service + @SessionScope | project1, clusterbench, brms-coolstore |
| JNDI @Resource(lookup) | @Value / @ConfigurationProperties | project1–3, project5–6 |
| JAX-RS (@Path, @GET, @POST) | @RestController, @GetMapping, @PostMapping | All 24 projects |
| JBoss Security Realm / JAAS / Elytron | Spring Security SecurityFilterChain | project3, project6, project13 |
| FORM authentication (j_security_check) | Spring Security formLogin() | project13 |
| Container-Managed Transactions (CMT) | Spring @Transactional | All 24 projects |
| Bean-Managed Transactions (BMT) | TransactionTemplate | project6 |
| CDI @Inject / @Produces | Constructor injection / @Bean | All 24 projects |
| CDI Events (Event\<T\>.fire / @Observes) | ApplicationEventPublisher / @EventListener | project6, project8, cargotracker, ticket-monster, brms-coolstore |
| CDI Interceptors (@AroundInvoke) | Spring AOP @Aspect | project4, project11, cdbookstore |
| CDI @Decorator | Spring AOP @Aspect with @Around | project7 |
| CDI @Alternative | @ConditionalOnProperty | project7 |
| CDI @SessionScoped | Spring @SessionScope | clusterbench, brms-coolstore |
| CDI @ApplicationScoped | @Service / @Component | eap8-with-postgres |
| EJB @Schedule / @Timeout / TimerService | @Scheduled / ScheduledExecutorService | project4 |
| EJB @Lock(READ/WRITE) | ReentrantReadWriteLock | project4 |
| JSR-352 Jakarta Batch | Spring Batch | project7, cargotracker |
| JAX-WS SOAP (@WebService) | Spring MVC REST (protocol modernization) | project5 |
| JSF / PrimeFaces (.xhtml) | REST APIs or Thymeleaf templates | petstore, cdbookstore, cargotracker, clusterbench |
| Vaadin 8 CDI (@CDIUI, @UIScoped) | Vaadin 24 Flow (@Route, @UIScope) | brms-coolstore |
| BRMS / Drools / KIE rules engine | Preserved with community KIE dependencies | brms-coolstore |
| @WebServlet + HttpServlet | @Controller with @RequestMapping | project3, clusterbench |
| JAX-RS ContainerRequestFilter | HandlerInterceptor / OncePerRequestFilter | project8, project10, project11 |
| JAX-RS @NameBinding filter | Custom annotation + HandlerInterceptor | project10 |
| JAX-RS ExceptionMapper (@Provider) | @ControllerAdvice + @ExceptionHandler | project10 |
| JAX-RS SSE (SseBroadcaster) | Spring SseEmitter | project8, cargotracker |
| WebSocket (@ServerEndpoint) | Preserved with ServerEndpointExporter | project8 |
| XA/JTA distributed transactions | Separate Spring TransactionManagers per datasource | project12 |
| Hibernate Envers (@Audited) | Preserved (Spring Boot auto-configures) | project12 |
| Infinispan distributed cache | Spring Cache / ConcurrentHashMap | project13 |
| JavaMail | Spring JavaMailSender | project12 |
| Servlet Filter / Listener | OncePerRequestFilter / @EventListener | project12 |
| JSON-B serialization | Jackson (Spring Boot default) | project9 |
| Bean Validation (Hibernate validators) | Jakarta Validation (@Size, @NotBlank) | project1, project11, petstore, ticket-monster |
| javax.persistence namespace | jakarta.persistence namespace | All 24 projects |
| JBoss XML configs (jboss-web.xml, etc.) | application.yml + @Configuration | All 24 projects |
| Multi-module EAR/EJB/WAR packaging | Single executable JAR (module consolidation) | clusterbench, cdbookstore, insurance_master |
| Arquillian tests | @SpringBootTest + MockMvc | petstore, cdbookstore, ticket-monster, brms-coolstore, cargotracker, thread-racing |
| WAR packaging | Executable JAR with embedded Tomcat | All 24 projects |

## Getting Started


### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| AWS Transform CLI (atx) | Latest | Execute skills |
| Java | 17+ | Compile Spring Boot 3.x projects |
| Maven | 3.9+ | Build Maven projects |
| Git | Any | Version control |

### Getting Started with AWS Transform Custom

To set up the AWS Transform CLI, configure authentication, and run your first transformation, see the [AWS Transform Custom Getting Started Guide](https://docs.aws.amazon.com/transform/latest/userguide/custom-get-started.html).

### Cloning the Repo and Publishing the Transformation

```bash
git clone https://github.com/aws-samples/aws-transform-custom-samples
cd community-sourced-transformations

atx custom def publish -n jboss-to-springboot \
    --sd jboss-to-springboot \
    --description "Migrates Java EE/Jakarta EE applications from JBoss EAP/WildFly to Spring Boot 3.2.x standalone JARs. Covers EJB to Spring beans, JAX-RS to Spring MVC, CDI to Spring DI, JPA javax to jakarta, JMS, JSF, security, batch, testing, and containerization."
```

### Cloning the repo and publishing the transformation


### Running the Migration

```bash
# Execute the skill
atx custom def exec \
  -n jboss-to-springboot \
  -p ./my-jboss-app \
  -c "mvn clean package -DskipTests" \
  -x -t

# Or with test validation
atx custom def exec \
  -n jboss-to-springboot \
  -p ./my-jboss-app \
  -c "mvn clean test" \
  -x -t
```

### Validating the Output

```bash
# Build
mvn clean package

# Run
java -jar target/<app-name>.jar

# Health check
curl http://localhost:8080/<context-path>/actuator/health

# Tests
mvn clean test

# Legacy import scan (should return zero matches)
grep -rn "javax.ws.rs\|javax.ejb\|javax.persistence" src/main/java/

# Legacy dependency scan
mvn dependency:tree | grep -iE "jboss|wildfly|jersey|javax.ws.rs|javax.inject"
```

### Expected Output

- Standalone executable JAR (50-80 MB)
- Startup time: 8-13 seconds
- All REST endpoints preserved at original paths
- Spring Boot Actuator with health, metrics, and liveness/readiness probes
- Production-ready Dockerfile with multi-stage build
- Updated README with Spring Boot instructions


## Benchmark Results

Complexity tiers are assessed before migration based on LOC, module count, and risk patterns:

| Tier | Criteria | Risk Level |
|---|---|---|
| 🟢 GREEN | Single WAR, <5K LOC, no JSF, no Stateful EJBs, no XA | Low — straightforward migration |
| 🟡 YELLOW | Single WAR, <20K LOC, minor risks (security migration, protocol change, caching) | Moderate — some complexity |
| 🟠 ORANGE | Multi-module or 20-50K LOC, JSF, 20+ EJBs, batch processing, Vaadin | High — significant complexity |
| 🔴 RED | EAR 4+ modules, >50K LOC, JSF + JMS + Batch + DDD combined | Very high — most complex |

| # | Repository | Tier | LOC | Build | Tests | Exit Criteria | Agent Min | Cost |
|---|---|---|---|---|---|---|---|---|
| 1 | project1-ejb-cmt-jpa | GREEN | ~500 | ✅ | 30/30 | 20/20 | 57 | $2.00 |
| 2 | project2-jms-mdb | GREEN | ~388 | ✅ | 13/13 | 20/20 | 37 | $1.30 |
| 3 | project3-jaas-security | GREEN | <5K | ✅ | 17/17 | 20/20 | 41 | $1.44 |
| 4 | project4-timer-singleton | GREEN | ~375 | ✅ | 16/16 | 20/20 | 39 | $1.37 |
| 5 | project5-jaxws-soap | GREEN | <5K | ✅ | 20/20 | 20/20 | 47 | $1.65 |
| 6 | project6-travel-booking | GREEN | ~1.8K | ✅ | 20/20 | 20/20 | 53 | $1.86 |
| 7 | project7-document-vault | GREEN | <10K | ✅ | 19/19 | 20/20 | 49 | $1.72 |
| 8 | project8-inventory-hub | GREEN | ~668 | ✅ | 14/14 | 20/20 | 38 | $1.33 |
| 9 | project9-workflow-engine | GREEN | ~616 | ✅ | 13/13 | 20/20 | 45 | $1.58 |
| 10 | project10-api-gateway | GREEN | ~779 | ✅ | 27/27 | 20/20 | 54 | $1.89 |
| 11 | project11-healthcare | YELLOW | ~8.6K | ✅ | 129/129 | 20/20 | 81 | $2.84 |
| 12 | project12-xa-envers | GREEN | ~1.1K | ✅ | 21/21 | 20/20 | 47 | $1.65 |
| 13 | project13-form-auth-cache | GREEN | ~793 | ✅ | 31/31 | 20/20 | 44 | $1.54 |
| 14 | [cargotracker](https://github.com/eclipse-ee4j/cargotracker) | YELLOW | ~7K | ✅ | 30/30¹ | 20/20 | 114 | $3.99 |
| 15 | [cdbookstore-ee7](https://github.com/agoncal/agoncal-application-cdbookstore) | ORANGE | ~10K | ✅ | 25/25 | 20/20 | 91 | $3.19 |
| 16 | [clusterbench](https://github.com/clusterbench/clusterbench) | ORANGE | ~5K | ✅ | 8/8 | 20/20 | 54 | $1.89 |
| 17 | [eap8-postgres](https://github.com/wildfly/quickstart) | GREEN | ~194 | ✅ | 4/4 | 20/20 | 31 | $1.09 |
| 18 | [petstore-ee7](https://github.com/agoncal/agoncal-application-petstore-ee7) | ORANGE | ~10K | ✅ | 52/52 | 20/20 | 67 | $2.35 |
| 19 | [ticket-monster](https://github.com/jboss-developer/ticket-monster) | YELLOW | ~15K | ✅ | 16/16² | 20/20 | 81 | $2.84 |
| 20 | [brms-coolstore](https://github.com/jbossdemocentral/brms-coolstore-demo) | GREEN | ~1.4K | ✅ | 10/10 | 20/20 | 73 | $2.56 |
| 21 | project14-kitchen-sink | YELLOW | <5K | ✅ | 23/23 | 20/20 | 62 | $2.17 |
| 22 | [thread-racing](https://github.com/wildfly/quickstart) | GREEN | ~2K | ✅ | 1/1 | 20/20 | 52 | $1.82 |
| 23 | [insurance_master](https://github.com/damianskolasa/insurance) | ORANGE | ~2.2K | ✅ | 3/3 | 20/20 | 40 | $1.41 |
| 24 | cmt | GREEN | ~483 | ✅ | 6/6 | 20/20 | 31 | $1.08 |
| | **TOTALS** | | | **24/24** | **540+** | **20/20 all** | **~1,328** | **~$46.56** |

¹ 5 tests skipped (@Disabled for data init), 25 pass, 0 failures
² 1 pre-existing @Disabled test

See [BENCHMARKS.md](BENCHMARKS.md) for detailed per-repository results including patterns covered, code quality observations, knowledge items, and fixes applied.

## Documentation & References

### Skill Definition

| File | Description |
|---|---|
| [SKILL.md](SKILL.md) | Complete skill definition — objective, scope, constraints, workflow (6-phase conditional pipeline), validation criteria, worked examples, and tips |
| [BENCHMARKS.md](BENCHMARKS.md) | Per-repository execution details: build results, tests, patterns, code quality, timing, cost |

### Reference Documents

These are loaded on-demand by the agent when specific patterns are encountered during migration:

| Reference | Trigger Patterns | Description |
|---|---|---|
| [phase0-detection-flags.md](References/phase0-detection-flags.md) | Phase 0 library flag detection, pom.xml scanning | Full detection rules for all library flags (HAS_JODA_TIME, HAS_JACKSON_V1, HAS_C3P0, etc.) |
| [jaxrs-spring-mvc-migration.md](References/jaxrs-spring-mvc-migration.md) | @Path, @ApplicationPath, @QueryParam, JAX-RS Response, SSE | Detailed JAX-RS → Spring MVC mapping: @ApplicationPath folding, @QueryParam required=false, UriInfo translation, ExceptionMapper→@ControllerAdvice, SSE→SseEmitter |
| [jaxws-websocket-migration.md](References/jaxws-websocket-migration.md) | @WebService, @ServerEndpoint, @OnMessage | JAX-WS SOAP and WebSocket migration patterns |
| [spring-batch5-migration.md](References/spring-batch5-migration.md) | jakarta.batch, META-INF/batch-jobs/, ItemWriter | Spring Batch 5 specifics: Chunk API, @StepScope, @BatchProperty→@Value |
| [hibernate6-behavior-changes.md](References/hibernate6-behavior-changes.md) | @Embeddable, @Lob on array fields, CriteriaQuery | Hibernate 6 nulls handling, behavior changes, CriteriaQuery updates |
| [test-configuration-patterns.md](References/test-configuration-patterns.md) | Arquillian, test context, H2, JUnit 4→5, *IT.java | Core test migration patterns: @SpringBootTest setup, H2 config, JUnit 5 assertion reordering, failsafe integration |
| [test-mockito-advanced.md](References/test-mockito-advanced.md) | @InjectMocks, Mockito, STRICT_STUBS, @MockBean | Advanced Mockito patterns: ReflectionTestUtils for @PersistenceContext/@Value, UnnecessaryStubbingException, lenient stubs |
| [jsf-backing-bean-migration.md](References/jsf-backing-bean-migration.md) | .xhtml, @ViewScoped, @FlowScoped, JSF backing beans | JSF backing bean → Spring @Controller patterns, Thymeleaf template conversion |
| [common-pitfalls-extended.md](References/common-pitfalls-extended.md) | Build errors, runtime exceptions, JUL→SLF4J | Full troubleshooting reference: build errors, startup failures, configuration issues, JUL→SLF4J migration |
| [worked-examples-conditional.md](References/worked-examples-conditional.md) | MDB→@JmsListener, JBoss Security examples | Worked before/after examples for conditional phases (JMS, Security) |
| [verify-legacy-imports.md](References/verify-legacy-imports.md) | Post-migration verification | Legacy import verification procedure with copy-paste-ready grep commands, MIGRATION comment validation |

## Known Limitations

| Limitation | Severity | Workaround |
|---|---|---|
| JSF/PrimeFaces UI | HIGH | Converted to REST APIs or Thymeleaf. Complex JSF apps may need separate frontend rewrite. |
| Vaadin 8 | LOW | Migrated to Vaadin 24 Flow + Spring Boot 3.2.5. |
| XA/Distributed Transactions | MEDIUM | Replaced with separate TransactionManagers. True 2PC requires Saga pattern. |
| EAR with 4+ modules | MEDIUM | Consolidation works but complex classloading isolation may need manual review. |
| Custom JBoss Valves/Modules | LOW | Mapped to Spring interceptors/filters. Complex custom modules may need review. |
| Applications >50K LOC | LOW | May exceed context limits. Consider splitting migration into phases. |

## Troubleshooting

| Issue | Resolution |
|---|---|
| All endpoints return 401 Unauthorized | Spring Security auto-configured. Create SecurityFilterChain with permitAll() for public endpoints. |
| LazyInitializationException on REST endpoints | Use JOIN FETCH in JPQL queries, or set spring.jpa.open-in-view=true (not recommended for production). |
| "Not a managed type" JPA error | Ensure entities are in a package under @SpringBootApplication, or add @EntityScan. |
| Static resources return 404 | Move from src/main/webapp/ to src/main/resources/static/. Add WebMvcConfigurer for directory index. |
| @PostConstruct + @Transactional doesn't work | Replace with @EventListener(ApplicationReadyEvent.class). |
| ConflictingBeanDefinitionException | Two @Controller classes with same simple name. Add explicit bean names. |
| Embedded Artemis ClassNotFoundException | Add artemis-server and artemis-jms-server dependencies alongside spring-boot-starter-artemis. |
| H2 PARSEDATETIME "Unparseable date" | Use lowercase yyyy-MM-dd (not YYYY-MM-DD) in data.sql. |
| Build fails with "invalid flag: --release" | Maven on Java 8 targeting Java 17. Add compiler fork profile or use Maven Wrapper. |
| Dependency conflicts after migration | Remove explicit versions managed by Spring Boot parent POM. Run mvn dependency:tree. |

See [References/common-pitfalls-extended.md](References/common-pitfalls-extended.md) for the full troubleshooting reference.

## Repository Structure

```
├── SKILL.md                        # Skill definition (6-phase conditional pipeline)
├── README.md                       # This file — overview, architecture, getting started, benchmarks
├── BENCHMARKS.md                   # Detailed benchmark results (24 repos)
├── References/                     # On-demand reference documents (11 files)
│   ├── phase0-detection-flags.md   # Phase 0 library flag detection rules
│   ├── jaxrs-spring-mvc-migration.md   # JAX-RS → Spring MVC mapping
│   ├── jaxws-websocket-migration.md    # JAX-WS SOAP & WebSocket migration
│   ├── spring-batch5-migration.md      # Spring Batch 5 specifics
│   ├── hibernate6-behavior-changes.md  # Hibernate 6 behavior changes
│   ├── test-configuration-patterns.md  # Test migration patterns
│   ├── test-mockito-advanced.md        # Advanced Mockito patterns
│   ├── jsf-backing-bean-migration.md   # JSF → Thymeleaf/Controller patterns
│   ├── common-pitfalls-extended.md     # Full troubleshooting reference
│   ├── worked-examples-conditional.md  # Worked examples for JMS & Security
│   └── verify-legacy-imports.md        # Post-migration verification procedure
```
