# Test Configuration Patterns Reference

## Table of Contents
1. [Test application.yml with H2 Override](#test-applicationyml-with-h2-override)
2. [H2 Test Dependency](#h2-test-dependency)
3. [Library Module @SpringBootTest](#library-module-springboottest)
4. [Sibling Package Detection](#sibling-package-detection)
5. [Ordered Tests Without @Transactional](#ordered-tests-without-transactional)
6. [Ordered Integration Test — Complete Worked Example](#ordered-integration-test--complete-worked-example)
7. [@SessionScope Beans in Tests](#sessionscope-beans-in-tests)
8. [JUnit 4→5 Assertion Message Order — 2-arg vs 3-arg Rule](#junit-45-assertion-message-order--2-arg-vs-3-arg-rule)
9. [assertThrows Lambda Scoping](#assertthrows-lambda-scoping)
10. [@PersistenceContext in @WebMvcTest Slices](#persistencecontext-in-webmvctest-slices)
11. [@WebMvcTest Usage Rules](#webmvctest-usage-rules)
12. [ObjectMapper Module Registration](#objectmapper-module-registration)
13. [@Ignore → Do NOT Mechanically Convert to @Disabled](#ignore--do-not-mechanically-convert-to-disabled)
14. [TestRestTemplate.delete() Returns Void](#testrestttemplatedelete-returns-void)
15. [MockMvc and context-path](#mockmvc-and-context-path)
16. [MockMvc XML Accept Header](#mockmvc-xml-accept-header)
17. [javax→jakarta in Test Files](#javaxjakarta-in-test-files)
18. [@Lazy Double-Annotation for ${local.server.port}](#lazy-double-annotation-for-localserverport)
19. [data.sql INSERT Idempotency for File-Based H2](#datasql-insert-idempotency-for-file-based-h2)
20. [ApplicationReadyEvent Seeder Conflicts in Tests](#applicationreadyevent-seeder-conflicts-in-tests)
21. [spring.sql.init.enabled=false for Event-Seeded Data](#sqlinitenabled-false-for-event-seeded-data)
22. [*IT.java Surefire/Failsafe Include](#itjava-surefairesafe-include)
23. [@Aspect Testing with SpringExtension](#aspect-testing-with-springextension)
24. [CDI Events Mock Migration](#cdi-events-mock-migration)
25. [RANDOM_PORT Self-Calling Test Pattern](#random_port-self-calling-test-pattern)
26. [ClassPathXmlApplicationContext Test Migration](#classpathxmlapplicationcontext-test-migration)
27. [Static Entity Fixtures and Detached-Entity Trap](#static-entity-fixtures-and-detached-entity-trap)
28. [@Transactional Class-Level Isolation with @Sql](#transactional-class-level-isolation-with-sql)
29. [ImportsContextCustomizer Cascade Failure Diagnostic](#importscontextcustomizer-cascade-failure-diagnostic)
30. [Vacuous Test Passing Guards](#vacuous-test-passing-guards)
31. [@WebMvcTest Auto-Included Converter/Formatter Beans](#webmvctest-auto-included-converterformatter-beans)
32. [@PersistenceContext on Controller in @WebMvcTest](#persistencecontext-on-controller-in-webmvctest)
33. [Null/Empty-String Path Variable in Spring MVC 6](#nullempty-string-path-variable-in-spring-mvc-6)
34. [MockMvc Synchronous Execution Model](#mockmvc-synchronous-execution-model)
35. [@WebMvcTest + Custom SecurityConfig @Import](#webmvctest--custom-securityconfig-import)
36. [@Ignore Investigation Checklist](#ignore-investigation-checklist)
37. [Verification](#verification)

## Test application.yml with H2 Override

Always create `src/test/resources/application.yml` that overrides the production datasource to H2 for tests. This file **REPLACES** (does not merge with) the main `application.yml` on the test classpath — copy all non-datasource configuration verbatim from the main file. If the test yml defines any key within a `spring.*` section (e.g., any `spring.sql.init` key), it must repeat ALL keys in that section.

**Mandatory settings to copy from main application.yml**: `server.servlet.context-path`, `spring.jpa.hibernate.naming.physical-strategy`, `spring.jpa.defer-datasource-initialization`, `management.*` actuator settings, any custom application properties.

**Prerequisite**: `mkdir -p src/test/resources/` — directory may not exist in legacy projects.

**Template:**
```yaml
# src/test/resources/application.yml
spring:
  datasource:
    url: jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE
    driver-class-name: org.h2.Driver
    username: sa
    password:
  jpa:
    hibernate:
      ddl-auto: create-drop
    # Do NOT set spring.jpa.properties.hibernate.dialect
    # Hibernate 6 auto-detects from JDBC URL; explicit dialect triggers HHH90000025 deprecation
    defer-datasource-initialization: true
  # Copy ALL other spring.* config from main application.yml:
  # jms, batch, mail, etc.

server:
  # Copy server.* config from main application.yml
  servlet:
    context-path: /your-app

management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      probes:
        enabled: true
  info:
    env:
      enabled: true

# Copy any custom app properties from main application.yml
```

Only create this H2 override if the project uses JPA (JPA_NEEDED=true). Projects without JPA don't need a datasource override.

## H2 Test Dependency

`spring-boot-starter-test` does NOT include H2 transitively. Add it explicitly:

```xml
<dependency>
    <groupId>com.h2database</groupId>
    <artifactId>h2</artifactId>
    <scope>test</scope>
</dependency>
```

For modules that also use H2 at runtime (e.g., dev profile): use `<scope>runtime</scope>`.

## Library Module @SpringBootTest

Library modules without a `@SpringBootApplication` class need a test-local configuration:

```java
@SpringBootTest
class MyServiceTest {
    @SpringBootApplication(scanBasePackages = "com.example.mylib")
    @EntityScan("com.example.mylib")
    static class TestConfig {}

    @Autowired
    private MyService service;

    @Test
    void contextLoads() {
        assertNotNull(service);
    }
}
```

If the library has test-only entities (from ShrinkWrap archives), add them to `@EntityScan`.

## Sibling Package Detection

When `@SpringBootApplication` is in a different package subtree from the test classes, Spring Boot cannot auto-detect the `@SpringBootConfiguration`. Fix by specifying the main class explicitly:

**Symptom**: `Unable to find a @SpringBootConfiguration` error.

**Fix**:
```java
@SpringBootTest(classes = MyApplication.class)
class MyTest { ... }
```

## Ordered Tests Without @Transactional

When `@SpringBootTest` integration tests use `@TestMethodOrder(OrderAnnotation.class)` and share committed DB state across methods (e.g., method 1 inserts, method 2 queries), do NOT add class-level `@Transactional`.

**Why**: `@Transactional` on a test class causes each method to run in a rolled-back transaction. Subsequent ordered methods see an empty database. Each test method must commit so subsequent methods observe prior data.

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
// NO @Transactional here!
class OrderedIntegrationTest {
    @Test @Order(1)
    void createEntity() { /* This commit persists to DB */ }

    @Test @Order(2)
    void queryEntity() { /* Can see data from test 1 */ }
}
```

## Ordered Integration Test — Complete Worked Example

A full pattern for integration tests that depend on execution order, including data seeding with a mocked seeder:

```java
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@AutoConfigureMockMvc
// NO @Transactional — each test commits
class BookstoreIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private DataSeeder dataSeeder;  // Suppress production seeder

    @Test @Order(1)
    void createBook() throws Exception {
        mockMvc.perform(post("/api/books")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Test Book\",\"isbn\":\"1234567890\"}"))
            .andExpect(status().isCreated());
    }

    @Test @Order(2)
    void listBooks_containsCreatedBook() throws Exception {
        mockMvc.perform(get("/api/books"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].title").value("Test Book"));
    }

    @Test @Order(3)
    @Transactional  // OK on individual method for read-only assertions
    void verifyDatabaseState() {
        // direct repository assertions
    }
}
```

**Key points**: `@MockBean DataSeeder` prevents the production `@EventListener(ApplicationReadyEvent.class)` seeder from running and conflicting with test data. Individual methods can use `@Transactional` for read-only checks without affecting commit behavior of other methods.

## @SessionScope Beans in Tests

`@SessionScope` beans need an active HTTP session in tests. Three failure modes and fixes:

### 1. ScopeNotActiveException (no web context)
`WebEnvironment.NONE` tests have no web session. Use `WebEnvironment.RANDOM_PORT` or `WebEnvironment.MOCK`.

### 2. RequestContextHolder not set in @SpringBootTest
When using `WebEnvironment.MOCK`, manually set up the request context:

```java
@BeforeEach
void setUp() {
    RequestContextHolder.setRequestAttributes(
        new ServletRequestAttributes(new MockHttpServletRequest()));
}

@AfterEach
void tearDown() {
    RequestContextHolder.resetRequestAttributes();
}
```

Alternative: `@WebMvcTest` for controller tests avoids the need for manual setup.

### 3. @PostConstruct accesses scoped proxy before HTTP session exists
If a `@SessionScope` bean's `@PostConstruct` runs during app startup (no HTTP request yet), it throws `ScopeNotActiveException`. Fix: use `@Scope("prototype")` instead of `@SessionScope` for beans that initialize eagerly.

## JUnit 4→5 Assertion Message Order — 2-arg vs 3-arg Rule

**HIGH SEVERITY** — this compiles cleanly but produces wrong test semantics silently.

### The Core Rule: Count Arguments Before Reordering

| Args | JUnit 4 Signature | Action |
|------|-------------------|--------|
| 2-arg | `assertEquals("Widget", actual)` | **DO NOT REORDER** — `"Widget"` IS the expected value, not a message. |
| 3-arg | `assertEquals("failure msg", expected, actual)` | Move `"failure msg"` to LAST position. |
| 2-arg | `assertTrue("msg", condition)` | Move `"msg"` to LAST position. |
| 1-arg | `assertTrue(condition)` | No change (no message). |
| 2-arg | `assertFalse("msg", condition)` | Move `"msg"` to LAST position. |
| 1-arg | `assertFalse(condition)` | No change. |
| 2-arg | `assertNotNull("msg", obj)` | Move `"msg"` to LAST position. |
| 1-arg | `assertNotNull(obj)` | No change. |
| 2-arg | `assertNull("msg", obj)` | Move `"msg"` to LAST position. |
| 1-arg | `assertNull(obj)` | No change. |

### Detection
```bash
grep -rn 'assertEquals("[^"]*",' src/test/ | grep -v 'import ' || true
```
Manually inspect each: count total args to determine if the String is an expected value (2 total) or a message (3 total).

### Before/After Examples

**3-arg assertEquals (message needs moving):**
```java
// JUnit 4
assertEquals("Order total should be 100", 100, order.getTotal());
// JUnit 5
assertEquals(100, order.getTotal(), "Order total should be 100");
```

**2-arg assertEquals (String IS expected — NO reorder):**
```java
// JUnit 4
assertEquals("Widget", product.getName());
// JUnit 5 — SAME ORDER (just change import)
assertEquals("Widget", product.getName());
```

## assertThrows Lambda Scoping

When converting `@Test(expected = X.class)` to `assertThrows`, place ONLY the single throwing invocation inside the lambda. Mockito stubs and test setup must remain OUTSIDE.

**Before (JUnit 4):**
```java
@Test(expected = IllegalArgumentException.class)
public void testInvalidInput() {
    when(mockService.validate(any())).thenReturn(false);
    processor.process(invalidInput);
}
```

**After (JUnit 5 — CORRECT):**
```java
@Test
void testInvalidInput() {
    when(mockService.validate(any())).thenReturn(false);  // OUTSIDE lambda
    assertThrows(IllegalArgumentException.class,
        () -> processor.process(invalidInput));             // ONLY the throwing call
}
```

## @PersistenceContext in @WebMvcTest Slices

**Problem**: `@WebMvcTest` slices out JPA. If a controller's dependency chain includes `@PersistenceContext`, `NoSuchBeanDefinitionException` for `EntityManagerFactory`.

**Fix**: Use `@SpringBootTest` + `@AutoConfigureMockMvc` instead:
```java
@SpringBootTest
@AutoConfigureMockMvc
class OrderControllerTest {
    @Autowired private MockMvc mockMvc;
}
```

**Alternative**: Mock the service entirely with `@MockBean` in `@WebMvcTest`.

## @WebMvcTest Usage Rules

Rules to prevent common failures:

### 1. Never combine with @AutoConfigureMockMvc
`@WebMvcTest` already configures MockMvc. Adding `@AutoConfigureMockMvc` is redundant and can cause duplicate bean registration.

### 2. Mutually exclusive with MockitoExtension
Use `@MockBean` (not `@Mock`) inside `@WebMvcTest`. See `references/test-mockito-advanced.md`.

### 3. Sub-package auto-discovery — omit classes=
When the test class is in a sub-package of the `@SpringBootApplication` class, `@WebMvcTest(MyController.class)` discovers configuration automatically — no `classes=` attribute needed on `@SpringBootTest`. Only specify `classes=` when in a sibling or unrelated package.

### 4. Custom @EnableWebSecurity not auto-loaded
Custom `@EnableWebSecurity` configuration classes are NOT auto-loaded in `@WebMvcTest` slices. Without them, default Spring Security applies — CSRF protection blocks POST/PUT/DELETE, causing unexpected 403 errors. Fix: `@Import(SecurityConfig.class)` on the test class.

### 5. Auto-includes Converter/Formatter/GenericConverter beans
`@WebMvcTest` auto-includes any `@Component` that implements `Converter`, `Formatter`, or `GenericConverter`. If these beans have non-trivial dependency chains (e.g., inject a service or repository), context loading fails. Fix: `@MockBean` for the dependencies or exclude with `@WebMvcTest(excludeAutoConfiguration=...)`.

### 6. thenReturn() must match exact service return type
Mockito generic inference fails on type mismatch with `@MockBean`. Ensure `thenReturn()` stubs return exactly the type the service method declares.

## ObjectMapper Module Registration

`new ObjectMapper()` misses auto-registered modules (JavaTimeModule, etc.). In Spring context: inject `ObjectMapper`. In unit tests: `new ObjectMapper().findAndRegisterModules()`.

## @Ignore → Do NOT Mechanically Convert to @Disabled

JUnit 4 `@Ignore` should NOT be blindly converted to JUnit 5 `@Disabled`. Investigate the reason:
- **Arquillian-era reasons** (requires WildFly, persistent DB): Remove `@Ignore` and fix the test.
- **Known defect**: Keep as `@Disabled("Tracking in JIRA-123")` with the original reason.

See [@Ignore Investigation Checklist](#ignore-investigation-checklist) below for a systematic approach.

## TestRestTemplate.delete() Returns Void

`TestRestTemplate.delete()` returns `void`. Use `exchange()` instead:
```java
ResponseEntity<Void> response = testRestTemplate.exchange(
    "/api/items/{id}", HttpMethod.DELETE, null, Void.class, itemId);
assertEquals(HttpStatus.NO_CONTENT, response.getStatusCode());
```

## MockMvc and context-path

MockMvc bypasses `server.servlet.context-path`. Use paths relative to DispatcherServlet root:
```java
// If server.servlet.context-path=/myapp — Do NOT use /myapp prefix
mockMvc.perform(get("/api/items"))
```

## MockMvc XML Accept Header

Endpoints that declare `produces = MediaType.APPLICATION_XML_VALUE` require an explicit Accept header in MockMvc:

```java
mockMvc.perform(get("/api/orders/1")
        .accept(MediaType.APPLICATION_XML))
    .andExpect(status().isOk())
    .andExpect(content().contentType(MediaType.APPLICATION_XML));
```

Without `.accept(MediaType.APPLICATION_XML)`, MockMvc defaults to `*/*` which may trigger JSON serialization instead, causing content-type assertion failures or even `HttpMediaTypeNotAcceptableException` if only XML is configured.

## javax→jakarta in Test Files

Test files require the same `javax.*` → `jakarta.*` namespace migration as production code. Commonly missed:
- `javax.mail.*` → `jakarta.mail.*` (when HAS_JAVAMAIL)
- `javax.persistence.*` → `jakarta.persistence.*` in test helpers
- `javax.inject.*` → remove (use constructor injection or `@Autowired` in tests)
- `javax.validation.*` → `jakarta.validation.*` in custom validator tests

**Detection**:
```bash
grep -rn 'import javax\.' src/test/java/ | grep -v ':[[:space:]]*//' || true
```

## @Lazy Double-Annotation for ${local.server.port}

**Problem**: `@Value("${local.server.port}")` in `WebEnvironment.RANDOM_PORT` fails during bean creation.

**Fix**: Add `@Lazy`:
```java
@Lazy
@Value("${local.server.port}")
private int port;
```

**Alternative**: `@BeforeEach void setUp(@LocalServerPort int port) { ... }`

## data.sql INSERT Idempotency for File-Based H2

When using file-based H2 (`jdbc:h2:file:…`) or `DB_CLOSE_DELAY=-1`, use `MERGE INTO` instead of `INSERT INTO`:
```sql
MERGE INTO users (id, name) KEY(id) VALUES (1, 'Admin');
```
Not needed with in-memory H2 + `create-drop`.

## ApplicationReadyEvent Seeder Conflicts in Tests

Production `@EventListener(ApplicationReadyEvent.class)` seeders run during `@SpringBootTest` context setup. **Fix**: guard with `@Profile("!test")`, or `@MockBean` the seeder class, or use idempotent seeder logic.

## spring.sql.init.enabled=false for Event-Seeded Data

**Problem**: When a production app seeds data via `@EventListener(ApplicationReadyEvent.class)` instead of `data.sql`, the test `application.yml` may still have `spring.sql.init.mode: always` or `spring.sql.init.enabled: true` from boilerplate. This causes Spring to look for `data.sql` and fail or conflict.

**Fix**: In test `application.yml`, explicitly set:
```yaml
spring:
  sql:
    init:
      enabled: false
```

This disables SQL script initialization in tests. Data is seeded by the `@EventListener` (or a mocked version) instead.

## *IT.java Surefire/Failsafe Include

Integration test classes named `*IT.java` run via `maven-failsafe-plugin`, not `maven-surefire-plugin`. If the project doesn't have failsafe configured, these tests are silently skipped.

**Detection**: `find src/test -name '*IT.java'` — if results non-empty, verify failsafe is configured.

**Fix**: Add to pom.xml:
```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-failsafe-plugin</artifactId>
    <executions>
        <execution>
            <goals>
                <goal>integration-test</goal>
                <goal>verify</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

Or rename `*IT.java` to `*Test.java` if they don't need a separate execution phase.

## @Aspect Testing with SpringExtension

Testing `@Aspect` classes (migrated from CDI `@Interceptor`) requires a Spring context with AOP enabled — plain `MockitoExtension` does not trigger AOP proxying.

**Pattern**:
```java
@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = {
    LoggingAspect.class,        // The @Aspect under test
    OrderService.class,          // The advised bean
    AspectTestConfig.class
})
class LoggingAspectTest {

    @Autowired private OrderService orderService;

    @Test
    void aspectInterceptsServiceCall() {
        orderService.placeOrder(new OrderRequest());
        // Assert logging side-effect (e.g., via captured logs)
    }

    @Configuration
    @EnableAspectJAutoProxy
    static class AspectTestConfig {
        @Bean
        public InventoryService inventoryService() {
            return Mockito.mock(InventoryService.class);
        }
    }
}
```

**Key**: `@EnableAspectJAutoProxy` must be present in the test context. Without it, the `@Aspect` bean is loaded but never applied as a proxy.

## CDI Events Mock Migration

CDI `Event<T>.fire()` → Spring `ApplicationEventPublisher.publishEvent()`. In tests:

**Production code (after migration):**
```java
@Service
public class OrderService {
    private final ApplicationEventPublisher publisher;

    public OrderService(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    public void completeOrder(Order order) {
        publisher.publishEvent(new OrderCompletedEvent(order));
    }
}
```

**Test — verify event was published:**
```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {
    @Mock private ApplicationEventPublisher publisher;
    @InjectMocks private OrderService service;

    @Test
    void publishesEventOnCompletion() {
        Order order = new Order(1L, "Widget");
        service.completeOrder(order);

        ArgumentCaptor<OrderCompletedEvent> captor =
            ArgumentCaptor.forClass(OrderCompletedEvent.class);
        verify(publisher).publishEvent(captor.capture());
        assertEquals(1L, captor.getValue().getOrder().getId());
    }
}
```

**CDI qualifier-differentiated events**: If the original code used CDI qualifiers to distinguish event types, the migration uses static nested wrapper classes (see Step 6). Test the wrapper type in the `ArgumentCaptor`.

## RANDOM_PORT Self-Calling Test Pattern

**Problem**: Some integration tests call the application's own REST endpoints. With `RANDOM_PORT`, the port must be resolved at test time.

**Pattern**:
```java
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class SelfCallingIntegrationTest {

    @Autowired private TestRestTemplate restTemplate;  // Auto-configured with port

    @Test
    void callOwnEndpoint() {
        ResponseEntity<String> response = restTemplate.getForEntity("/api/orders", String.class);
        assertEquals(HttpStatus.OK, response.getStatusCode());
    }
}
```

**Note**: `TestRestTemplate` is auto-configured with the correct base URL when using `RANDOM_PORT`. Do NOT manually construct URLs with `@Value("${local.server.port}")` unless using `@Lazy` (see section above).

## ClassPathXmlApplicationContext Test Migration

**Problem**: When Spring XML context files are deleted in Step 4 (HAS_SPRING_XML), tests using `ClassPathXmlApplicationContext` fail with `FileNotFoundException`.

**Fix**: Replace with `@SpringBootTest` + `@TestConfiguration`:
```java
// Before
class LegacyServiceTest {
    @Test
    void testService() {
        var ctx = new ClassPathXmlApplicationContext("applicationContext.xml");
        var svc = ctx.getBean(MyService.class);
        // assertions
    }
}

// After
@SpringBootTest
class LegacyServiceTest {
    @Autowired private MyService svc;

    @Test
    void testService() {
        // same assertions
    }
}
```

## Static Entity Fixtures and Detached-Entity Trap

**Problem**: Test classes that define `static` entity fixtures (e.g., `static final Member MEMBER_1 = new Member(1L, "John")`) and pass them to `repository.save()` across multiple test contexts hit the "detached entity" trap. In Hibernate 6, `persist()` rejects entities with non-null IDs more strictly.

**Symptom**: `PersistenceException: detached entity passed to persist` or `org.hibernate.PersistentObjectException`.

**Fix — persistOrMerge pattern**: Use `EntityManager.merge()` for pre-identified entities, or make fixture IDs null and let the DB generate them:

```java
// Option A: Use merge instead of persist for pre-identified entities
@BeforeEach
void setUp() {
    member = entityManager.merge(new Member(1L, "John"));
}

// Option B: Let IDs be generated (preferred)
@BeforeEach
void setUp() {
    member = repository.save(new Member(null, "John"));
    // Use member.getId() for subsequent assertions
}
```

## @Transactional Class-Level Isolation with @Sql

When using `@Transactional` at the class level combined with `@Sql` for data setup, each test method sees the data loaded by `@Sql` but in a transaction that rolls back. However, if the `@Sql` script and the test execute in the same transaction, the data IS visible within the test.

**Gotcha**: Spring's `@Sql` default execution phase is `BEFORE_TEST_METHOD` and runs in the same transaction as the test when `@Transactional` is present. But context caching across test classes means `@Sql` data from class A may conflict with class B if they share a cached context.

**Fix**: Use `@Sql(executionPhase = BEFORE_TEST_METHOD)` explicitly and ensure `@DirtiesContext` or `@Transactional` rollback prevents cross-test interference.

## ImportsContextCustomizer Cascade Failure Diagnostic

**Symptom**: `@WebMvcTest` or `@SpringBootTest` with `@Import(...)` fails with cryptic errors about `ImportsContextCustomizer` or bean definition conflicts.

**Root cause**: The imported `@Configuration` class transitively imports another class that conflicts with auto-configuration (e.g., imports a `@ComponentScan` that pulls in unwanted beans).

**Diagnostic procedure**:
1. Check the `@Import` target class for `@ComponentScan`
2. Check for transitive `@Import` chains
3. Narrow the import: use `@Import(SpecificBean.class)` instead of `@Import(ConfigPackage.class)`
4. Use `@MockBean` for beans that the imported config transitively requires

## Vacuous Test Passing Guards

**Problem**: Tests that assert on a collection size or content may pass vacuously when the collection is empty (e.g., `assertEquals(expected, actual)` where both are empty lists, or a `forEach` loop that never executes).

**Fix**: Add explicit non-empty guards before content assertions:

```java
// WRONG — passes vacuously on empty collection
for (Order order : orders) {
    assertTrue(order.getTotal() > 0);
}

// CORRECT — fails on empty collection
assertFalse(orders.isEmpty(), "Orders collection must not be empty");
for (Order order : orders) {
    assertTrue(order.getTotal() > 0);
}
```

## @WebMvcTest Auto-Included Converter/Formatter Beans

**Problem**: `@WebMvcTest` auto-includes any `@Component` that implements `Converter<S,T>`, `Formatter<T>`, or `GenericConverter`. If these beans have non-trivial dependency chains (inject a `Service`, `Repository`, or `EntityManager`), context loading fails with `NoSuchBeanDefinitionException`.

**Symptom**: `@WebMvcTest` fails at context load with errors about missing service/repository beans that should not be in a web slice.

**Fix options**:
```java
// Option A: Mock the dependencies
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @MockBean private PetService petService;  // Dependency of StringToPetConverter
}

// Option B: Exclude the auto-configuration
@WebMvcTest(value = OrderController.class,
    excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE,
        classes = StringToPetConverter.class))
class OrderControllerTest { ... }
```

## @PersistenceContext on Controller in @WebMvcTest

**Problem**: Some controllers directly inject `@PersistenceContext EntityManager` (often migrated from JSF backing beans that queried the DB directly). `@WebMvcTest` does not load JPA infrastructure, so `PersistenceAnnotationBeanPostProcessor` fails to find `EntityManagerFactory`.

**Fix**: Add `@MockBean EntityManagerFactory`:
```java
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @MockBean private EntityManagerFactory entityManagerFactory;
    @MockBean private OrderService orderService;
}
```

Or better: refactor the controller to delegate DB access to a service/repository layer.

## Null/Empty-String Path Variable in Spring MVC 6

**Behavior change in Spring MVC 6**: Null and empty-string `@PathVariable` values are handled more strictly. A URL like `/api/items/` (trailing slash with no value) may not match `@GetMapping("/{id}")` — Spring MVC 6 does not treat empty string as a valid path variable by default.

**Impact on tests**: MockMvc tests that previously worked with empty path variables may start returning 404.

**Fix**: If the endpoint must handle empty path variables, use an explicit optional pattern:
```java
@GetMapping({"/{id}", "/"})
public ResponseEntity<?> getItem(@PathVariable(required = false) Long id) { ... }
```

## MockMvc Synchronous Execution Model

MockMvc executes requests synchronously on the test thread, not through a real HTTP connection. This means:
- Async controller methods (`@Async`, `CompletableFuture`) complete before MockMvc assertions run
- `OncePerRequestFilter` runs, but Servlet 3.0 async dispatch does NOT
- `@RequestScope` beans are available within the MockMvc request lifecycle

**Gotcha**: If a controller returns `DeferredResult` or `CompletableFuture`, use `asyncDispatch()`:
```java
MvcResult result = mockMvc.perform(get("/api/async"))
    .andExpect(request().asyncStarted())
    .andReturn();
mockMvc.perform(asyncDispatch(result))
    .andExpect(status().isOk());
```

## @WebMvcTest + Custom SecurityConfig @Import

When the application has a custom `@EnableWebSecurity` configuration, `@WebMvcTest` does NOT auto-load it. Instead, Spring Boot's default security auto-configuration applies, which enables CSRF protection and may require authentication for all endpoints.

**Symptoms**: POST/PUT/DELETE requests return 403 Forbidden; GET requests require authentication.

**Fix**: Import the custom security config:
```java
@WebMvcTest(OrderController.class)
@Import(SecurityConfig.class)
class OrderControllerTest {
    @MockBean private OrderService orderService;
    // ...
}
```

If the `SecurityConfig` has its own dependencies (e.g., `UserDetailsService`), mock those too:
```java
@WebMvcTest(OrderController.class)
@Import(SecurityConfig.class)
class OrderControllerTest {
    @MockBean private UserDetailsService userDetailsService;
    @MockBean private OrderService orderService;
}
```

## @Ignore Investigation Checklist

When encountering `@Ignore` on a JUnit 4 test, do NOT mechanically convert to `@Disabled`. Use this checklist:

1. **Check for Arquillian dependency**: Does the test use `@RunWith(Arquillian.class)` or `@Deployment`? If yes → Remove `@Ignore` and migrate to `@SpringBootTest`. The Arquillian-era reason is gone.

2. **Check for request-scope dependency**: Does the test inject `@RequestScoped` or `@SessionScoped` beans? If yes → Remove `@Ignore`, add `WebEnvironment.MOCK` and mock request context setup.

3. **Check for ID non-determinism**: Does the test assert on auto-generated IDs? If yes → Remove `@Ignore`, replace hard-coded IDs with runtime captures (`saved.getId()`).

4. **Check for external dependency**: Does the test connect to an external service or DB? If yes → Keep as `@Disabled("Requires external service X")` with the specific reason.

5. **Check for known defect**: Does the `@Ignore` message reference a bug tracker? If yes → Keep as `@Disabled("Tracking in JIRA-123")`.

6. **No clear reason**: Remove `@Ignore` and run the test. If it passes, remove permanently. If it fails, fix the root cause (most common: missing H2 test config, javax→jakarta, or missing dependency).

## Verification

```bash
# 1. Verify test resources directory exists
ls src/test/resources/application.yml

# 2. Verify H2 dependency in pom.xml
grep -A 3 'h2' pom.xml

# 3. Run tests
mvn clean test

# 4. Check no tests are @Disabled (added during migration)
grep -rn '@Disabled' src/test/java/ || true

# 5. Check for remaining javax imports in tests
grep -rn 'import javax\.' src/test/java/ | grep -v ':[[:space:]]*//' || true
# Expected: empty

# 6. Check *IT.java have failsafe configured (if present)
find src/test -name '*IT.java' | head -1 && grep -q 'maven-failsafe-plugin' pom.xml && echo "OK" || echo "MISSING failsafe"
```
