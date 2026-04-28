---
name: jboss-to-spring-boot
description: >-
  Migrates Java EE/Jakarta EE enterprise applications from JBoss EAP/WildFly
  to Spring Boot 3.2.x standalone JARs. Covers EJB→Spring beans, JAX-RS→Spring
  MVC, CDI→Spring DI, JPA javax→jakarta, JMS→Spring JMS, JSF→Thymeleaf,
  security, batch, testing, containerization. Uses conditional pipeline: Phase 0
  detects features, subsequent phases run only when needed. Trigger: JBoss,
  WildFly, Java EE, Jakarta EE, Spring Boot migration, EJB, JAX-RS, CDI.
---

# JBoss-to-Spring-Boot Migration

## Objective

Migrate Java EE/Jakarta EE applications on JBoss EAP/WildFly to Spring Boot 3.2.x, eliminating application server dependencies and modernizing to cloud-native containerized deployment.

## Scope

Converts JBoss/WildFly-based enterprise Java apps into standalone Spring Boot JARs with embedded servers. Phase 0 scans the project to determine which migration phases are needed; only required phases execute.

**Non-Goals** (require separate handling):
1. EJB Remote Interfaces over IIOP/CORBA — redesign to REST, gRPC, or messaging
2. JCA Resource Adapters — replace with Spring Integration or vendor client libraries
3. EJB 2.x Entity Beans (CMP/BMP) — manually convert to JPA entities first
4. Proprietary JBoss Clustering (JGroups/Infinispan) — use Spring Session with Redis/Hazelcast
5. Vaadin UI — version-specific upgrade (Vaadin 8→24 Flow with vaadin-spring-boot-starter)
6. Complex Arquillian @Deployment data init — migrate to @Sql/@TestConfiguration/@BeforeEach
7. JAXB Marshalling Tests — migrate to jakarta.xml.bind equivalents, never delete
8. Uncommon Hibernate validators (@SafeHtml, @ScriptAssert, etc.) — custom ConstraintValidator
9. XA/JTA Distributed Transactions — per-datasource @Transactional or JtaTransactionManager

## Constraints

### API & Functional Parity
- Preserve all public class names, method signatures, REST endpoint paths, HTTP methods, request/response formats, and status codes.
- Business logic must remain unchanged — only framework/infrastructure code is modified.
- Transaction boundaries and isolation levels must be preserved.
- Preserve Javadoc comments and code documentation throughout the migration.

### Test Integrity
- Do NOT mark tests @Disabled or delete tests as a migration shortcut.
- Migrate Arquillian tests to @SpringBootTest equivalents preserving all assertions.
- JAXB tests → migrate to jakarta.xml.bind or Jackson equivalents.

### Security
- CRITICAL: Only add spring-boot-starter-security if SECURITY_NEEDED=true.
- Never hardcode credentials in source code.

### Code Quality
- Constructor injection throughout. Exceptions:
  1. `@PersistenceContext EntityManager` — correct Spring idiom for JPA EntityManager; exempt from constructor injection.
  2. `@Value` on scalar-property fields in `@Component` configuration POJOs — simple config holders, not collaborator dependencies.
  3. Fields with public setters mandated by an implemented interface (e.g., framework callback interfaces requiring setter injection).
- **Abstract base class refactoring**: enumerate ALL concrete subclasses first, update ALL in the same pass with `super(…)` calls. Incomplete passes leave half the hierarchy on field injection.
- **@SessionScope Serializable beans**: non-serializable dependencies (HttpServletRequest, JmsTemplate) — use constructor injection + `private transient` field. Transient prevents serialization errors but does NOT exempt from constructor injection rule.
- Follow Spring Boot conventions. Remove unused imports and dead code.

### Incremental Migration
- Verify build passes after each phase before proceeding. Commit after each successful phase.

## Worked Examples

### Example 1: @Stateless EJB → Spring @Service

**Before (JBoss):**
```java
import javax.ejb.Stateless;
import javax.ejb.EJB;
import javax.ejb.TransactionAttribute;
import javax.ejb.TransactionAttributeType;

@Stateless
public class OrderService {
    @EJB
    private InventoryService inventoryService;

    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public Order placeOrder(OrderRequest request) {
        inventoryService.reserve(request.getItemId(), request.getQuantity());
        return createOrder(request);
    }
}
```

**After (Spring Boot):**
```java
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

@Service
@Transactional
public class OrderService {
    private final InventoryService inventoryService;

    public OrderService(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Order placeOrder(OrderRequest request) {
        inventoryService.reserve(request.getItemId(), request.getQuantity());
        return createOrder(request);
    }
}
```

### Example 2: JAX-RS Resource → Spring MVC Controller

See `references/jaxrs-spring-mvc-migration.md` for a complete before/after JAX-RS→Spring MVC example with `@ApplicationPath` folding, `@QueryParam` → `@RequestParam(required=false)`, and `Response` → `ResponseEntity`.

> Additional worked examples (MDB→@JmsListener, JBoss Security→Spring Security) in `references/worked-examples-conditional.md`.

## Workflow

### Pipeline Architecture

```
Phase 0: Scanner → Phase 1: Build & Config → Phase 2: Business Logic
  │                 (ALWAYS)                   (ALWAYS)
  ├→ Phase 3: Security & Messaging (if SECURITY_NEEDED or JMS_NEEDED)
  ├→ Phase 4: Testing & UI (ALWAYS, scope varies)
  └→ Phase 5: Deployment & Verification (ALWAYS)
```

### Phase 0: Project Analysis

Scan the project and set feature flags to determine which phases execute.

**Core feature flags** (determine phase execution):

| Flag | Detection Rule |
|------|---------------|
| SECURITY_NEEDED | `<security-constraint>` in web.xml, `@RolesAllowed`, `@DeclareRoles`, or `<security-domain>` in jboss-web.xml |
| JMS_NEEDED | `@MessageDriven`, `@JMSDestinationDefinition`, `javax.jms.*`/`jakarta.jms.*` imports |
| JSF_NEEDED | `.xhtml` in src/main/webapp/, or `javax.faces.*`/`jakarta.faces.*` imports |
| BATCH_NEEDED | `jakarta.batch.*`/`javax.batch.*` imports, or META-INF/batch-jobs/ directory |
| WEBSOCKET_NEEDED | `@ServerEndpoint` or `jakarta.websocket.*` imports |
| JPA_NEEDED | pom.xml contains `spring-boot-starter-data-jpa` (post-Step 2) OR any Java file imports `javax.persistence.*`/`jakarta.persistence.*` |
| STATIC_UI_EXISTS | .html/.css/.js/.jsp/image files in src/main/webapp/ |
| ARQUILLIAN_TESTS | `@RunWith(Arquillian`, `@Deployment`, or arquillian.xml |
| IS_MULTI_MODULE | pom.xml `<modules>` or packaged as EAR |

**Library flags** — full detection rules in `references/phase0-detection-flags.md`:

| Flag | Detection Rule |
|------|---------------|
| HAS_JODA_TIME | pom.xml contains `joda-time` dependency |
| HAS_JACKSON_V1 | pom.xml contains `org.codehaus.jackson`, OR imports `org.codehaus.jackson` |
| HAS_C3P0 | pom.xml contains `c3p0`, OR persistence.xml has `hibernate.c3p0` properties |
| HAS_GUAVA | pom.xml contains `com.google.guava` **AND** any Java file imports `com.google.common.base.Optional` (both required) |
| HAS_LOMBOK | pom.xml contains `org.projectlombok` dependency |
| HAS_SPRING_XML | Any XML in src/main/resources/ or src/main/webapp/WEB-INF/ contains `<beans xmlns="http://www.springframework.org/schema/beans"` |
| HAS_LOG4J | src/main/resources/ contains `log4j.xml` or `log4j.properties` |
| JAX_WS_NEEDED | `@WebService`, `@WebMethod`, or `javax.xml.ws.*`/`jakarta.xml.ws.*` imports |
| HAS_JAXB | Imports `javax.xml.bind.*`/`jakarta.xml.bind.*`, OR pom.xml contains `jaxb-api` |
| HAS_JSONB | Imports `jakarta.json.bind.*`/`javax.json.bind.*`, OR pom.xml contains `jakarta.json.bind-api` |
| HAS_EJB_TIMERS | `@Schedule`, `@Timeout`, or `TimerService` from `javax.ejb`/`jakarta.ejb` |
| HAS_JAVAMAIL | Imports `javax.mail.*`/`jakarta.mail.*`, OR pom.xml contains javax.mail/jakarta.mail |
| HAS_SERVLET_FILTERS | `@WebFilter` or `@WebListener` annotations |
| HAS_MULTI_DATASOURCE | persistence.xml contains multiple `<persistence-unit>` elements, OR standalone.xml defines multiple datasource subsystems. Fallback: `grep -c '<jta-data-source>' src/main/resources/META-INF/persistence.xml` with count >1. |
| SUREFIRE_DISABLED | pom.xml `<skip>true</skip>` or `<skipTests>true</skipTests>` under maven-surefire-plugin. **Fix**: remove `<skip>true</skip>` or set to `false`; verify with `mvn help:effective-pom | grep -A5 surefire`. |
| HAS_CDI_INTERCEPTORS | Any Java file contains `@Interceptor` or `@InterceptorBinding` → add `spring-boot-starter-aop` in Step 2. |
| HAS_JSONP | Any Java file imports `javax.json.*` (JSON-P, not JSON-B) → migrate to Jackson `ObjectMapper`. |
| LOC_ESTIMATE | `find src/main/java -name '*.java' \| xargs wc -l` |

**Complexity**: GREEN (<5K LOC, simple) → YELLOW (5–20K, moderate) → ORANGE (20–50K, multi-module/JSF: break into sub-phases per module, validate independently, allocate 1.5× estimated time) → RED (>50K, EAR+JSF+JMS+Batch). RED projects: budget 2× estimated time and review Phase 0 scan results before starting.

**Mixed servlet API detection**: if BOTH `javax.servlet` and `jakarta.servlet` exist in imports, flag as a pre-migration blocker — resolve to a single namespace before proceeding.

**Phase execution**: Phases 1, 2, 5 ALWAYS run. Phase 3 runs if SECURITY_NEEDED or JMS_NEEDED. Phase 4 always runs but scope varies by flags. Log scan results and phase plan for traceability.

### Phase 1: Build Foundation, Configuration & Persistence

Exit: `mvn clean compile -Dmaven.test.skip=true` passes.

**Step 1** (if IS_MULTI_MODULE): Consolidate multi-module (EJB+WAR+EAR) into single Spring Boot module. After consolidation: (a) verify only ONE src/main/java tree exists — dual source trees cause edits to the wrong tree to have zero effect; (b) remove stale legacy module directories; (c) delete any `build-helper-maven-plugin` executions that referenced old module paths — Maven silently ignores dead source paths.

**Step 2**: Create Spring Boot project foundation.
- Replace parent POM with spring-boot-starter-parent (3.2.x+), change WAR→JAR, add spring-boot-maven-plugin.
- Add starters: web, data-jpa, actuator, validation, test.
- Conditional starters: security (if SECURITY_NEEDED), artemis (if JMS_NEEDED), batch (if BATCH_NEEDED), websocket (if WEBSOCKET_NEEDED), mail (if HAS_JAVAMAIL), thymeleaf (if JSF_NEEDED), aop (if HAS_CDI_INTERCEPTORS).
- If JMS_NEEDED with embedded broker: add `org.apache.activemq:artemis-jakarta-server` (BOM-managed). Do NOT use `artemis-jms-server` — it is NOT in the Spring Boot 3.2.x BOM.
- If JAX_WS_NEEDED and preserving SOAP: add `spring-boot-starter-web-services` AND `wsdl4j:wsdl4j` explicitly (Spring-WS 4.x drops wsdl4j as transitive).
- If HAS_JAXB: add jakarta.xml.bind-api + glassfish jaxb-runtime. If both HAS_JAXB and jackson-dataformat-xml are present, add `@JacksonXmlRootElement(localName=<original @XmlRootElement name>)` to every XML-serialized DTO — jackson-dataformat-xml silently ignores `@XmlRootElement`.
- `hibernate-jpamodelgen`: if present, change groupId from `org.hibernate` to `org.hibernate.orm` (Hibernate 6 / Spring Boot 3.x rename). The Spring Boot BOM manages `org.hibernate.orm:hibernate-jpamodelgen`.
- **Maven-plugin dual-listing**: before removing plugins from `<build><plugins>`, grep `<dependencies>` for `<type>maven-plugin</type>` entries (e.g., maven-war-plugin, wildfly-maven-plugin). Remove both locations in same pass.
- Remove JBoss BOMs, repositories, plugins.

**Step 3**: Migrate dependencies — remove individual Spring/Hibernate deps (managed by starters). Remove legacy libs (joda-time, codehaus jackson, c3p0, javax.inject). Keep lombok with provided scope. Replace javax.xml.bind.* imports with jakarta.xml.bind.* (do NOT delete JAXB tests).

**Step 4**: Create @SpringBootApplication class and configuration.
- Create application.yml: server.servlet.context-path, spring.datasource.*, spring.jpa.*, management.endpoints.*.
- **Session timeout**: web.xml `<session-timeout>` is in MINUTES; Spring Boot `server.servlet.session.timeout` without suffix defaults to SECONDS. Always use explicit `m` suffix: `server.servlet.session.timeout: 30m` (not `30`).
- **Before deleting persistence.xml**: extract datasource JNDI names, any multiple persistence-unit entries, and custom Hibernate properties — these must be replicated in application.yml. If datasource is JNDI (`<jta-data-source>java:jboss/…</jta-data-source>`), locate `*-ds.xml` or `standalone.xml` datasource subsystem for JDBC URL/driver/credentials. If absent, check pom.xml for available JDBC drivers and choose replacement. Add a MIGRATION comment naming the original JNDI reference.
- If using `ddl-auto=create` or `create-drop` with data.sql: add `spring.jpa.defer-datasource-initialization=true` (without this, data.sql runs before DDL and INSERTs fail with "table not found").
- **H2 scope decision**: If JPA_NEEDED=true and no production database driver is in pom.xml, add `com.h2database:h2` with `<scope>runtime</scope>`. WARNING: If main application.yml contains `jdbc:h2:` URL, H2 MUST be `<scope>runtime</scope>` — using test scope causes `ClassNotFoundException` on `@SpringBootTest` while `@DataJpaTest` slices pass silently. Only use test scope when a separate production DB driver exists AND H2 URL is exclusively in `src/test/resources/application.yml`.
- If @SpringBootApplication is NOT in the root package of all entities/components: add `@EntityScan("com.example.root")` and `scanBasePackages` on @SpringBootApplication. For sibling root packages (e.g., `org.eclipse.pathfinder` vs `org.eclipse.cargotracker`), include BOTH in scanBasePackages AND @EntityScan.
- **YAML merge rule**: application.yml sections are NOT merged across profiles — a profile-specific file REPLACES matching top-level keys entirely. If a profile defines any key within a section, it must repeat ALL keys in that section.
- Delete: jboss-web.xml, jboss-ejb3.xml, jboss-deployment-structure.xml, persistence.xml, beans.xml, web.xml.
- If HAS_SPRING_XML: convert to @Configuration + @Bean. If HAS_LOG4J: convert to logback-spring.xml.

**Step 5**: Migrate JPA entities and persistence.
- Replace all `javax.persistence` → `jakarta.persistence` imports.
- **Project-wide inline FQCN sweep**: `grep -rn "javax\." src/ | grep -v "^.*import "` at the start of Step 5 to record ALL non-import javax.* occurrences (catch blocks, DTOs, instanceof, return types) as explicit migration targets.
- Remove unitName from @PersistenceContext.
- Validation annotation mapping:
  - `@Length` → `@Size`
  - `@NotEmpty` → `@NotBlank` **for String/CharSequence fields ONLY**; for Collection/array/Map fields use `jakarta.validation.constraints.@NotEmpty` (change only the import). Applying `@NotBlank` to a collection causes ConstraintDeclarationException at startup.
  - `@URL` → `@Pattern(regexp="^(https?|ftp)://.*")`
  - `@Range(min, max)` → `@Min(min)` + `@Max(max)`
  - `@Email` (hibernate) → `@Email` (jakarta.validation)
  - `@SafeHtml` → remove (no equivalent). `@ScriptAssert` → custom ConstraintValidator.
- If HAS_JACKSON_V1: codehaus→fasterxml. If HAS_JODA_TIME: joda→java.time. If HAS_JSONB: JSON-B→Jackson annotations.

### Phase 2: Business Logic & Presentation

Exit: `mvn clean compile` passes.

> ⚠ **MIGRATION COMMENT RULE** — Scope: applies to ALL comment text (Javadoc, inline, block, `{@code}`) in MIGRATION-labeled lines, in ALL file types (Java, test, Thymeleaf, HTML). Regular Javadoc describing annotations (e.g., `/** Uses @Transactional for... */`) is NOT subject to this rule — only MIGRATION-labeled comments.
>
> **Precedence**: This rule TAKES PRECEDENCE over the MINIMIZE CHANGES principle. Always reword MIGRATION comments to avoid annotation tokens, even when quoting the original annotation would be shorter.
>
> **Rule**: MIGRATION comments must NOT contain `@AnnotationName` tokens. Write plain English instead.
>
> **Per-task self-check**: Before marking ANY task complete, delete .bak files then verify: `find . -name "*.bak" -not -path "*/target/*" -delete && grep -rn "MIGRATION.*@[A-Z]" <files modified by this task>` — must return empty. Fix immediately if not.
>
> | ❌ Wrong | ✅ Correct |
> |---|---|
> | `// MIGRATION: Removed @ApplicationException` | `// MIGRATION: Replaced EJB app exception with Spring ResponseStatus` |
> | `// MIGRATION: @Autowired removed` | `// MIGRATION: Replaced field injection with constructor injection` |
> | `// MIGRATION: @Stateless converted` | `// MIGRATION: Converted stateless session bean to Spring service` |
> | `// MIGRATION: @Scheduled replaces timer` | `// MIGRATION: Converted EJB timer to Spring scheduled task` |
> | `// MIGRATION: @Ignore removed` | `// MIGRATION: Re-enabled test after Arquillian removal` |
> | `// MIGRATION: @InjectMocks added` | `// MIGRATION: Added Mockito injection for unit test` |
> | `// MIGRATION: @EnableBatchProcessing removed` | `// MIGRATION: Removed batch annotation that disables auto-config` |
> | `// MIGRATION: @Async added` | `// MIGRATION: Made event listener asynchronous` |
>
> See `references/verify-legacy-imports.md` for the full verification procedure.

**Step 6**: Migrate EJBs and CDI to Spring beans.
- `@Stateless` → `@Service` + `@Transactional` **ONLY when the service performs persistence operations** (EntityManager, repository calls). Prerequisite: `spring-boot-starter-data-jpa` (includes spring-tx). For pure-computation services with no persistence, omit `@Transactional`. If a class has both `@Stateless` and `@Path`, produce a single `@RestController` (not `@Service` + `@RestController`) — see Step 9.
- `@Singleton` → `@Service`/`@Component` (`@Startup` → CommandLineRunner or `@EventListener(ApplicationReadyEvent.class)`). Remove `implements Serializable` and `serialVersionUID` from singleton beans. Do NOT add `@Scope("singleton")` — it is the Spring default.
- `@Stateful` → `@Service` + `@SessionScope`. **WARNING**: (a) `@SessionScope` requires the bean to be `Serializable` for HTTP session serialization. (b) If `@PostConstruct` accesses the scoped proxy before an HTTP session exists (e.g., during app startup), use `@Scope("prototype")` instead. (c) CDI `@Produces @SessionScoped` factory methods → `@Bean @SessionScope` in a `@Configuration` class. See `references/test-configuration-patterns.md` for test setup.
- Remove `@LocalBean`, `@Local`, `@Remote`. Replace `@EJB`/`@Inject` → constructor injection.
- **CDI no-arg constructor removal**: CDI requires public no-arg constructors for proxy generation. Spring single-constructor injection does not — remove no-arg constructors that exist only for CDI compliance. Keep them only if the class is serialized or has framework-mandated no-arg requirements.
- `@PersistenceContext EntityManager`: replace `@Inject EntityManager` with `@PersistenceContext private EntityManager em`. This is exempt from the constructor injection rule.
- CDI `@Produces Logger` → `private static final Logger logger = LoggerFactory.getLogger(ClassName.class)`. Delete the LoggerProducer class.
- CDI scopes: `@ApplicationScoped` → `@Component`, `@RequestScoped` → `@Component` + `@RequestScope`, `@Model` → `@Controller` + `@RequestScope`.
- CDI events: `Event<T>.fire()` → `ApplicationEventPublisher.publishEvent()`, `Event<T>.fireAsync()` → `ApplicationEventPublisher.publishEvent()` + `@Async` on the `@EventListener`. **CRITICAL structural difference**: `@Observes` is a PARAMETER annotation; `@EventListener` is a METHOD annotation — move annotation to method, parameter becomes plain type. **Cross-file**: `@EnableAsync` must be present on any `@Configuration` or `@SpringBootApplication` when `@Async @EventListener` exists — absence causes silent synchronous execution. **CompletionStage cleanup**: remove entire `CompletionStage` variable and `.exceptionally()` lambda from `fireAsync()` callers — `publishEvent()` returns void. **Payload type verification**: `grep publishEvent()` call sites to confirm actual payload type matches listener parameter type. **CDI qualifier-differentiated events**: define static nested wrapper classes per qualifier, use `publishEvent(new QualifierEvent(payload))`.
- CDI interceptors/decorators → `@Aspect` + `@Around`. **@Around advice methods MUST declare `throws Throwable`** — without it, checked exceptions from the intercepted method are wrapped in UndeclaredThrowableException.
- CDI `@Alternative` → `@ConditionalOnProperty`. **COMPLEMENTARY CONDITION RULE**: the default bean gets `matchIfMissing=true` and the alternative gets `matchIfMissing=false` on the same property. **DEPENDENCY CHAIN RULE**: apply the same condition to every bean in the activation chain that has side effects in its constructor.
- For custom CDI qualifier `@interface` files: import `org.springframework.beans.factory.annotation.Qualifier` (compile classpath) — NOT `jakarta.inject.Qualifier` (runtime only via hibernate-core, causes compile error).
- Scan all `package-info.java` for `@Vetoed` — remove the annotation and its CDI import.
- **EJB lifecycle annotations**: `@PostActivate` / `@PrePassivate` — DELETE the annotation AND the method body (no Spring equivalent for stateful passivation). `@PostConstruct` / `@PreDestroy` (JSR-250) — RETAIN as-is (Spring supports them natively).
- **⚠ STOP**: Before deleting JaxRsActivator.java / JAX-RS Application subclass, **record its `@ApplicationPath` value**. This prefix must be prepended to EVERY `@RequestMapping` in Step 9. Losing it causes 404 on ALL REST endpoints. Delete Resources.java (CDI @Produces EntityManager).
- **EJB exception hierarchy**: `EJBTransactionRolledbackException` → catch as `DataIntegrityViolationException`. Maintain most-specific-first catch ordering.
- **@Schedules (plural)**: split into separate `@Scheduled` methods, one per cron expression, each delegating to a shared private method. Drop `persistent=false` (no Spring equivalent).
- Replace `java.util.logging.Logger` → `org.slf4j.Logger`. See `references/common-pitfalls-extended.md` § JUL→SLF4J Quick Reference for the complete level mapping, placeholder conversion, and import replacement. Key rules: severe→error, warning→warn, fine→debug, config→info; `{0}`,`{1}` → `{}`,`{}`; unwrap `new Object[]{a,b}` to varargs; drop `.getName()` from `LoggerFactory.getLogger()`.
- **javax→jakarta completeness**: when migrating a file, ALL `javax.*` namespaces in that file must be updated in the same pass. Mixed-namespace files cause Step 17 failures.
- If HAS_EJB_TIMERS: `@Schedule` → `@Scheduled(cron=…)`, `@Timeout` → `@Scheduled(fixedDelay=…)`, add `@EnableScheduling`. `@EnableScheduling`/`@EnableAsync` can be on any `@Component` subtype including `@Service` — does not require the main class. **Note**: `fixedDelay`/`fixedRate` values must be compile-time constants — replace `TimeUnit.SECONDS.toMillis(3)` with `3000L` or use `fixedDelayString="${app.timer.delay}"`. For dynamic timer lifecycle (`timerService.createIntervalTimer()`/`timer.cancel()`), use an active-flag pattern: `volatile boolean active`; `@Scheduled` method checks `if (!active) return;` start/stop toggle the flag.
- If HAS_SERVLET_FILTERS: `@WebFilter` → `OncePerRequestFilter` + `@Component`. `@WebListener` → `@Component`.
- If HAS_JAVAMAIL: manual Session/Transport → `JavaMailSender`, configure `spring.mail.*`.
- If HAS_GUAVA: `Optional.fromNullable` → `Optional.ofNullable`.
- If HAS_JSONP: replace `javax.json.Json`, `JsonObject`, `JsonArray` with Jackson `ObjectMapper`, `ObjectNode`, `ArrayNode`.

**Step 7**: Replace JNDI lookups — `@Resource(lookup=…)` → `@Value`/`@ConfigurationProperties`, `InitialContext.lookup()` → Spring DI.

**Step 8**: Replace container-managed transactions — REQUIRED→`@Transactional`, REQUIRES_NEW→`Propagation.REQUIRES_NEW`, NOT_SUPPORTED→`Propagation.NOT_SUPPORTED`, BMT→`TransactionTemplate`. When using `TransactionTemplate`, declare it as a `@Bean` — it is NOT auto-configured by Spring Boot. `@RolesAllowed` → `@PreAuthorize` (if SECURITY_NEEDED, else remove).

**Step 8b** (if multi-datasource): Define separate DataSource/EntityManagerFactory/TransactionManager beans per datasource, or use JTA with `me.snowdrop:narayana-spring-boot-starter` (NOT `spring-boot-starter-jta-narayana`, which does not exist for Boot 3.x). Narayana requires explicit version — it is NOT managed by the Spring Boot BOM. Check [Maven Central](https://central.sonatype.com/artifact/me.snowdrop/narayana-spring-boot-starter) for the latest 3.x-compatible release. Note: `spring-boot-starter-jta-atomikos` was also removed from Boot 3.x. Hibernate Envers @Audited works as-is after javax→jakarta import migration.

**Step 9**: Migrate JAX-RS to Spring MVC. See `references/jaxrs-spring-mvc-migration.md` for detailed patterns.
- **@ApplicationPath folding** (CRITICAL): Locate the JAX-RS Application subclass (deleted in Step 6) and note its `@ApplicationPath` value. Prepend this to EVERY `@RequestMapping` path. Spring Boot has no `@ApplicationPath` equivalent. `@ApplicationPath("/rest")` + `@Path("/members")` → `@RequestMapping("/rest/members")`. Empty `@ApplicationPath("")` or `@ApplicationPath("/")` → no prefix needed.
- `@Path` → `@RestController` + `@RequestMapping`. `@GET/@POST/@PUT/@DELETE` → `@GetMapping/@PostMapping/@PutMapping/@DeleteMapping`.
- `@PathParam` → `@PathVariable`. `@QueryParam("name") Type param` → `@RequestParam(value="name", required=false) Type param` — JAX-RS query params are always optional; omitting `required=false` returns HTTP 400 for missing params.
- `@HeaderParam` → `@RequestHeader`. `@FormParam` → `@RequestParam` (with `@PostMapping`).
- Unannotated parameter in `@POST`/`@PUT` method with `@Consumes` → add `@RequestBody`. Spring MVC requires this explicitly; omitting it silently results in null.
- `Response` → `ResponseEntity`. JAX-RS ExceptionMapper → `@ControllerAdvice` + `@ExceptionHandler` (preserve HTTP status codes and error body format). **Note**: `@ResponseStatus` drops the body — use `ResponseEntity.badRequest().body(errors)` when error bodies are needed.
- `@Context UriInfo` → `ServletUriComponentsBuilder`. See `references/jaxrs-spring-mvc-migration.md` § UriInfo Translation Table for the full mapping. Replace field injection with constructor injection.
- JAX-RS `ContainerRequestFilter` → `HandlerInterceptor` or `OncePerRequestFilter`. `ContainerResponseFilter` → `HandlerInterceptor.postHandle()` or `OncePerRequestFilter`. **CRITICAL**: set ALL response headers BEFORE `chain.doFilter()` — headers set after `doFilter()` are silently dropped on a committed response.

**Step 9b** (if JAX_WS_NEEDED): See `references/jaxws-websocket-migration.md` for JAX-WS SOAP migration.

**Step 9c** (if WEBSOCKET_NEEDED): See `references/jaxws-websocket-migration.md` for WebSocket migration. **For JAX-RS SSE** (`SseEventSink`/`SseBroadcaster`): see `references/jaxrs-spring-mvc-migration.md` § JAX-RS SSE → SseEmitter.

### Phase 3: Security & Messaging (CONDITIONAL)

SKIP if SECURITY_NEEDED=false AND JMS_NEEDED=false. Exit: `mvn clean compile`.

**Step 10** (if SECURITY_NEEDED): Create SecurityConfig with `@EnableWebSecurity` + `SecurityFilterChain` bean. Map web.xml constraints to `authorizeHttpRequests()`. **Actuator ordering**: `.requestMatchers("/actuator/**").permitAll()` must be the FIRST rule in `authorizeHttpRequests` chain — later rules can shadow it. `@RolesAllowed` → `@PreAuthorize` + `@EnableMethodSecurity`. Configure formLogin/httpBasic. `SessionContext.getCallerPrincipal()` → `SecurityContextHolder.getContext().getAuthentication()`.

**Step 11** (if JMS_NEEDED): `@MessageDriven` → `@Component` + `@JmsListener`. `MessageProducer` → `JmsTemplate`. Embedded Artemis: `spring.artemis.mode=embedded`, add `artemis-jakarta-server` dependency. External broker: `spring.artemis.mode=native` + `broker-url`.

**Step 11b** (if BATCH_NEEDED): Convert META-INF/batch-jobs/*.xml → @Configuration with Job/Step beans. See `references/spring-batch5-migration.md` for Spring Batch 5 specifics.
- `ItemWriter.write(List<? extends T>)` → `write(Chunk<? extends T>)`. Use `chunk.getItems()` for the list.
- Do NOT add `@EnableBatchProcessing` — it disables BatchAutoConfiguration on Spring Boot 3.
- `@BatchProperty` → `@Value("#{jobParameters['paramName']}")`. Annotate ANY component using `@Value("#{jobParameters[…]}")` with `@StepScope` — not just ItemReader.
- Scheduled jobs: include `run.id=System.currentTimeMillis()` in JobParameters to avoid JobInstanceAlreadyCompleteException.

### Phase 4: Testing & UI

Exit: `mvn clean test` passes.

**Step 12**: Migrate tests. See `references/test-configuration-patterns.md` for core patterns and `references/test-mockito-advanced.md` for Mockito-specific patterns.
- Ensure `src/test/resources/` directory exists: `mkdir -p src/test/resources/`.
- Add @SpringBootTest context-loads test + @WebMvcTest/MockMvc controller tests.
- Create `src/test/resources/application.yml` with H2 override: `jdbc:h2:mem:testdb`, `ddl-auto=create-drop`. This file REPLACES (not merges with) main application.yml — copy ALL non-datasource config verbatim, including: `server.servlet.context-path`, `spring.jpa.hibernate.naming.physical-strategy`, `spring.jpa.defer-datasource-initialization`, `management.*` actuator settings. Do NOT set explicit `spring.jpa.properties.hibernate.dialect` — Hibernate 6 auto-detects from JDBC URL; explicit dialect triggers HHH90000025 deprecation. Only create this H2 override if JPA_NEEDED=true.
- If @SpringBootApplication is in a different package subtree from tests: use `@SpringBootTest(classes = MainApp.class)`.
- If ARQUILLIAN_TESTS: remove @RunWith(Arquillian), @Deployment, ShrinkWrap → @SpringBootTest + @AutoConfigureMockMvc. Preserve all test methods/assertions. Migrate data setup to @TestConfiguration, @Sql, or @BeforeEach. Delete arquillian.xml, test-ds.xml.
- If SECURITY_NEEDED: add spring-security-test; use `@WithMockUser` in controller tests. `@MockBean` the `HandlerInterceptor` if it requires authentication context — see `references/test-mockito-advanced.md`.
- JUnit 4→5: `@RunWith` → `@ExtendWith`, `Assert` → `Assertions`. **CRITICAL — count args before reordering**: 2-arg `assertEquals("Widget", actual)` — the String IS the expected value, do NOT reorder. Only 3-arg `assertEquals("msg", expected, actual)` needs the message moved to last. **Message-last applies to ALL assertion methods**: `assertTrue("msg", cond)` → `assertTrue(cond, "msg")`; `assertFalse("msg", cond)` → `assertFalse(cond, "msg")`; `assertNotNull("msg", obj)` → `assertNotNull(obj, "msg")`; `assertNull("msg", obj)` → `assertNull(obj, "msg")`. See `references/test-configuration-patterns.md` for full rule.
- `@Test(expected=X.class)` → `assertThrows(X.class, () -> { ... })`. Place ONLY the throwing call inside the lambda — never Mockito stubs or setup.
- Do NOT mechanically convert `@Ignore` to `@Disabled`. Investigate WHY the test was ignored — Arquillian-era reasons often don't apply in Spring Boot + H2.
- Do NOT @Disable tests. Ordered tests sharing committed DB state: omit class-level @Transactional — each method must commit so subsequent methods observe prior data.
- **javax→jakarta in test files**: test files need the same `javax.*` → `jakarta.*` migration as production code.
- **@WebMvcTest rules**: (a) never combine with `@AutoConfigureMockMvc` (redundant); (b) mutually exclusive with `@ExtendWith(MockitoExtension.class)` — use `@MockBean` instead; (c) omit `classes=` when test is in `@SpringBootApplication` package subtree (auto-discovered); (d) custom `@EnableWebSecurity` configs are NOT auto-loaded — add `@Import(SecurityConfig.class)` to avoid CSRF 403 errors; (e) auto-includes any `@Component` implementing `Converter`/`Formatter`/`GenericConverter` — add `@MockBean` for non-trivial dependency chains; (f) `@PersistenceContext` on controller → add `@MockBean EntityManagerFactory` (PersistenceAnnotationBeanPostProcessor is active in MVC slice); (g) `thenReturn()` stubs must match exact service return type — Mockito generic inference fails on type mismatch.
- **@InjectMocks does NOT populate `@PersistenceContext` or `@Value` fields** — use `ReflectionTestUtils.setField()` in `@BeforeEach`. See `references/test-mockito-advanced.md`.
- **UnnecessaryStubbingException under MockitoExtension**: wrap subset-only `@BeforeEach` stubs with `lenient().when()`. Do NOT apply class-level LENIENT strictness. See `references/test-mockito-advanced.md`.
- **XML produces endpoints**: chain `.accept(MediaType.APPLICATION_XML)` in MockMvc for endpoints with `produces=APPLICATION_XML_VALUE`.
- **`*IT.java` integration tests**: run via `maven-failsafe-plugin`, not surefire. Add failsafe include if needed — see `references/test-configuration-patterns.md`.
- **`@Lazy @Value("${local.server.port}")`**: use `@Lazy` or inject via `@LocalServerPort` in `@BeforeEach`. See `references/test-configuration-patterns.md`.
- If BATCH_NEEDED: align test call sites with Spring Batch 5 API (Chunk, SkipListener rename, checkpoint/restart test removal).
- **Smoke test package**: place in the root test package matching `@SpringBootApplication` package.
- **ClassPathXmlApplicationContext in tests**: if backing XML was deleted in Step 4, migrate to `@SpringBootTest` + `@TestConfiguration`.

**Step 13**: Migrate UI and static resources.
- If JSF_NEEDED: convert .xhtml → Thymeleaf templates (src/main/resources/templates/). See `references/jsf-backing-bean-migration.md` for backing bean → @Controller patterns.
  - `spring-boot-starter-thymeleaf` does NOT include Layout Dialect — do NOT use `layout:decorate`. Use built-in `th:fragment` parameterized fragments.
  - Thymeleaf URL preprocessing for dynamic base URLs: `@{__${url}__(page=${n})}`.
  - Pre-encoded URL values: bypass `@{}` to avoid double-encoding — use `${#request.contextPath + '/path?p=' + val}`.
- If the application uses BRMS/Drools/KIE: preserve the KIE/Drools runtime and wire via a `@Configuration` class producing `KieContainer @Bean` instead of CDI `@Produces`. See `references/phase0-detection-flags.md` for HAS_DROOLS flag.
- If STATIC_UI_EXISTS: move resources from webapp/ → resources/static/. Create WebMvcConfigurer for directory index.
- Delete src/main/webapp/ after migration. Delete faces-config.xml.

### Phase 5: Deployment & Verification

Exit: `mvn clean verify` passes + all 20 exit criteria met.

**Step 14**: Configure Actuator — expose health/info/metrics, enable liveness/readiness probes. Custom health checks → HealthIndicator. **Mandatory YAML for standalone mode** (probes NOT auto-enabled):

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  endpoint:
    health:
      probes:
        enabled: true
  info:
    env:
      enabled: true
```

**Step 15**: Containerize with multi-stage Dockerfile. Use this template (choose Java 17 or 21 based on pom.xml `java.version`):

```dockerfile
# -- Build stage --
FROM maven:3.9-amazoncorretto-17 AS build
# For Java 21: maven:3.9-amazoncorretto-21
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn clean package -DskipTests -B

# -- Runtime stage --
FROM amazoncorretto:17-alpine
# For Java 21: amazoncorretto:21-alpine
# Fallback if amazoncorretto unavailable: eclipse-temurin:17-jre-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
RUN chown appuser:appgroup app.jar
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", \
  "-XX:+UseContainerSupport", \
  "-XX:MaxRAMPercentage=75.0", \
  "-jar", "app.jar"]
```

**Variants**: (a) **Multi-module**: `COPY <module>/target/<finalName>.jar app.jar`; COPY all referenced pom.xml files before `dependency:go-offline`. (b) **Local/proprietary artifacts** (KJar, custom libs): `COPY libs/ .` + `RUN mvn install:install-file …` before `dependency:go-offline`. (c) **Non-Alpine images** (amazoncorretto non-alpine, eclipse-temurin non-alpine): use `groupadd -r` / `useradd -r -g`, NOT `addgroup -S` / `adduser -S` — Alpine BusyBox syntax crashes Debian-based images.

Spring Boot 3.x JarLauncher path is `org.springframework.boot.loader.launch.JarLauncher` (NOT `.loader.JarLauncher`). Create `.dockerignore`.

**Step 16**: Cleanup — update README.md, .gitignore. Delete remaining JBoss configs and legacy directories. Clean up editor backup files — run TWICE (second pass catches backups created during first pass):
```bash
find . -name "*.bak" -not -path "*/target/*" -delete
find . -name "*.bak" -not -path "*/target/*" -delete
```
Add `*.bak` to .gitignore. **Post-delete verification**: `find . -name "*.bak" -not -path "*/target/*"` — must return empty.

**Step 17**: Final verification scan. See `references/verify-legacy-imports.md` for full procedure with copy-paste-ready grep commands. Run each grep INDEPENDENTLY — never chain with `&&` (grep returns exit code 1 on zero matches, silently skipping later checks).
- **PRE-GREP PROTOCOL**: ALWAYS run `find . -name "*.bak" -not -path "*/target/*" -delete` before ANY grep verification scan. .bak files contain stale pre-migration content that causes false positives.
- Legacy imports: grep for javax.ws.rs, javax.ejb, javax.persistence, etc. — must be ZERO. Filter comments and Javadoc.
- Inline FQCNs: `grep -r "javax\." src/main/java/ | grep -v "import " | ...` — filter comments and Javadoc lines.
- Legacy annotations: grep for @Stateless, @Stateful, @MessageDriven, @EJB, @Path (JAX-RS), @TransactionAttribute — must be ZERO.
- Constructor injection: grep for `@Autowired` on field declarations in src/main/java/ — must be ZERO. `@PersistenceContext` on EntityManager fields is acceptable.
- Dependency tree: `mvn dependency:tree | grep 'jboss\|wildfly\|jersey\|javax.ws.rs'` — only jboss-logging acceptable.
- Test integrity: verify no @Disabled added during migration.
- **MIGRATION comment rule**: `grep -rn "MIGRATION.*@[A-Z]" src/` — must return empty.
- **Unconditional .bak sweep** — run as the LAST action before `mvn clean verify`, regardless of whether a Debugger phase ran. Debugger tools and multi-worker tasks create .bak files at any point:
  ```bash
  find . -name "*.bak" -not -path "*/target/*" -delete
  find . -name "*.bak" -not -path "*/target/*"  # must return empty
  ```
- Run `mvn clean verify`.

## Reference Dispatch

Load reference files on demand when the worker encounters these signals:

| Signal in Source Code | Reference File |
|---|---|
| Phase 0 library flag detection, pom.xml dep scanning | `references/phase0-detection-flags.md` |
| `@Path`, `@ApplicationPath`, `@QueryParam`, JAX-RS `Response`, SSE `SseEventSink` | `references/jaxrs-spring-mvc-migration.md` |
| `@WebService`, `@ServerEndpoint`, `@OnMessage` | `references/jaxws-websocket-migration.md` |
| `jakarta.batch`, `META-INF/batch-jobs/`, `ItemWriter` | `references/spring-batch5-migration.md` |
| `@Embeddable`, `@Lob` on array fields, Hibernate 6 nulls, CriteriaQuery | `references/hibernate6-behavior-changes.md` |
| Arquillian, test context, H2, JUnit 4→5, `*IT.java` | `references/test-configuration-patterns.md` |
| `@InjectMocks`, Mockito, `STRICT_STUBS`, `@MockBean` | `references/test-mockito-advanced.md` |
| `.xhtml`, `@ViewScoped`, `@FlowScoped`, JSF backing beans | `references/jsf-backing-bean-migration.md` |
| Build errors, runtime exceptions, configuration problems, JUL→SLF4J | `references/common-pitfalls-extended.md` |
| MDB→@JmsListener, Security worked examples | `references/worked-examples-conditional.md` |

## Reference Procedures

The procedures below describe mechanical transforms and verification sweeps the worker performs on demand using standard shell commands. There are no executable scripts — the worker reads each procedure and issues the commands directly.

- **Pre-migration procedures** run BEFORE any file-by-file migration work.
- **Post-batch procedures** run AFTER each batch of related changes.
- **Post-migration procedures** run AFTER all code changes are complete.

- **`references/jaxrs-spring-mvc-migration.md`** — Detailed JAX-RS → Spring MVC mapping rules including @ApplicationPath folding, @QueryParam required=false, @FormParam→@RequestParam, implicit @RequestBody, UriBuilder, Response patterns, MultivaluedMap hierarchy, ExceptionMapper→@ControllerAdvice, SSE→SseEmitter, UriInfo translation. Patterns: `@ApplicationPath`, `@Path`, `@QueryParam`, `@FormParam`, `Response.ok`, `SseEventSink`. When to run: during Phase 2 Step 9 (post-batch per controller).

- **`references/verify-legacy-imports.md`** — Checks for leftover legacy javax.* and org.hibernate.validator imports with corrected grep pipelines. Also verifies MIGRATION comment naming and mixed servlet API. Includes PRE-GREP .bak deletion protocol. Patterns: `javax.persistence`, `javax.ejb`, `javax.ws.rs`, `org.hibernate.validator.constraints`. When to run: after all migration work (post-migration). Worker fails the migration if any verification grep returns non-empty.

## Validation / Exit Criteria

All 20 must be met:

1. App starts as standalone Spring Boot JAR without JBoss/WildFly.
2. All EJBs replaced with Spring beans; no javax.ejb/jakarta.ejb imports.
3. No JNDI lookups remain.
4. All JBoss config files removed, settings in application.yml/@Configuration.
5. All JAX-RS annotations replaced with Spring MVC equivalents.
6. All javax.persistence → jakarta.persistence.
7. Security uses Spring Security (if SECURITY_NEEDED); absent otherwise.
8. Spring @Transactional throughout; no EJB transaction annotations.
9. REST endpoints return same responses/status codes (functional parity).
10. All tests pass; new @SpringBootTest/MockMvc tests added.
11. /actuator/health returns healthy; liveness/readiness probes work.
12. Startup <30s, idle heap <512MB.
13. Builds as executable JAR and/or Docker image.
14. No legacy JBoss/Java EE deps in dependency tree (jboss-logging OK).
15. No legacy imports (javax.ws.rs, javax.ejb, javax.persistence, etc.).
16. Constructor injection throughout — no @Autowired field declarations. `@PersistenceContext` on EntityManager is exempt.
17. Metrics/health checks migrated to Actuator/Micrometer.
18. Static resources accessible at original URLs.
19. Web UI pages load and navigate correctly.
20. Directory index (welcome files) behavior preserved.

## Common Pitfalls

See `references/common-pitfalls-extended.md` for the full troubleshooting reference covering build errors, startup failures, configuration issues, JUL→SLF4J migration, and legacy library traps.

## Tips

- [2026-04] `@PostConstruct` + `@Transactional` does not work — Spring proxies aren't ready. Use `@EventListener(ApplicationReadyEvent.class)`.
- [2026-04] Never use `new ObjectMapper()` directly — it misses auto-registered modules (JavaTimeModule). Inject from Spring context or use `new ObjectMapper().findAndRegisterModules()` in unit tests.
- [2026-04] JUL→SLF4J: always convert `{0}`,`{1}` indexed placeholders to `{}`,`{}` positional — `{0}` compiles but prints literally at runtime.
