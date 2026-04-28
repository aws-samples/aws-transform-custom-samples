# Common Pitfalls and Troubleshooting (Extended)

This is the full pitfalls reference. The most critical entries are also in SKILL.md.

## Table of Contents
1. [Build and Dependency Issues](#build-and-dependency-issues)
2. [Configuration Issues](#configuration-issues)
3. [Security Issues](#security-issues)
4. [Bean and DI Issues](#bean-and-di-issues)
5. [Legacy Library Issues](#legacy-library-issues)
6. [Hibernate 6 Issues](#hibernate-6-issues)
7. [UI and Static Resource Issues](#ui-and-static-resource-issues)
8. [Test Issues](#test-issues)
9. [Cleanup Issues](#cleanup-issues)
10. [JUL→SLF4J Quick Reference](#julslf4j-quick-reference)

## Build and Dependency Issues

- **"invalid flag: --release"**: Maven on Java 8 targeting Java 17 — add compiler fork profile.
- **Dependency conflicts**: Remove explicit versions managed by Spring Boot parent POM. Let the BOM manage versions.
- **ClassNotFoundException**: Ensure all deps declared with correct scope (compile, runtime, test).
- **Embedded Artemis ClassNotFoundException**: Use `org.apache.activemq:artemis-jakarta-server` (BOM-managed) for Spring Boot 3.2.x embedded mode. Do NOT use `artemis-jms-server` — that is the pre-Jakarta legacy artifact not in the Spring Boot 3.2.x BOM.
- **hibernate-jpamodelgen groupId**: Changed from `org.hibernate` to `org.hibernate.orm` in Hibernate 6 / Spring Boot 3.x. The Spring Boot BOM manages `org.hibernate.orm:hibernate-jpamodelgen`. Using the old groupId causes "artifact not found" or version mismatch.
- **TransactionTemplate not auto-configured**: `TransactionTemplate` is NOT auto-configured by Spring Boot. When migrating BMT (Bean-Managed Transactions) to `TransactionTemplate`, declare it as a `@Bean`:
  ```java
  @Bean
  public TransactionTemplate transactionTemplate(PlatformTransactionManager txManager) {
      return new TransactionTemplate(txManager);
  }
  ```
- **RestTemplate not auto-configured**: In Spring Boot 3.x, `RestTemplate` is NOT auto-configured as a bean. Inject `RestTemplateBuilder` and create explicitly:
  ```java
  @Bean
  public RestTemplate restTemplate(RestTemplateBuilder builder) {
      return builder.build();
  }
  ```
  Without this, `NoSuchBeanDefinitionException` for `RestTemplate` at startup.

## Configuration Issues

- **Datasource errors**: Verify spring.datasource.url, username, password, driver-class-name in application.yml.
- **"Not a managed type"**: Entities not in the @SpringBootApplication package tree. Add `@EntityScan("com.example.entities")`. For sibling root packages, list ALL packages in both `scanBasePackages` and `@EntityScan`.
- **H2 PARSEDATETIME errors**: Use lowercase `yyyy-MM-dd` (not `YYYY-MM-DD`) in date format strings.
- **Hibernate snake_case naming**: Spring Boot's default `SpringPhysicalNamingStrategy` converts camelCase to snake_case. Two options:
  - (A) Update data.sql to use snake_case column names (preferred)
  - (B) Add `spring.jpa.hibernate.naming.physical-strategy=org.hibernate.boot.model.naming.PhysicalNamingStrategyStandardImpl`
- **Missing SQL semicolons**: Spring Boot ScriptUtils requires semicolons to terminate statements.
- **data.sql runs before DDL**: Add `spring.jpa.defer-datasource-initialization=true` when using `ddl-auto=create/create-drop` with data.sql.
- **H2 not on classpath**: `spring-boot-starter-test` and `spring-boot-starter-data-jpa` do NOT include H2 transitively.
- **H2 scope decision**: Use `<scope>runtime</scope>` when H2 is the application's database (or when main application.yml has `jdbc:h2:` URL). Use `<scope>test</scope>` when a production driver exists. Using test scope with H2 in main yml causes `ClassNotFoundException` on `@SpringBootTest`.
- **JNDI datasource credentials absent**: When persistence.xml references a JNDI datasource, locate `*-ds.xml` or `standalone.xml` for JDBC URL/driver/credentials.
- **Session timeout unit trap**: web.xml `<session-timeout>` is in minutes; Spring Boot `server.servlet.session.timeout` defaults to seconds without suffix. Always use: `server.servlet.session.timeout: 30m`.

## Security Issues

- **All endpoints return 401**: Spring Security auto-configured when SECURITY_NEEDED was false — remove spring-boot-starter-security.
- **CORS errors**: Configure CORS in SecurityFilterChain or use `@CrossOrigin` on controllers.

## Bean and DI Issues

- **ConflictingBeanDefinitionException**: Two `@Controller` classes with same simple name — add explicit `@Controller("uniqueBeanName")` bean names. Detection: `find src/main/java -name '*.java' -exec basename {} \; | sort | uniq -d`.
- **@PostConstruct + @Transactional doesn't work**: Spring proxies aren't ready during @PostConstruct. Replace with `@EventListener(ApplicationReadyEvent.class)`.
- **@PersistenceContext is exempt from constructor injection**: `@PersistenceContext private EntityManager em` is the correct Spring idiom.
- **@InjectMocks silently skips field injection**: See `references/test-mockito-advanced.md` for fix.
- **package-info.java with @Vetoed**: Remove the annotation and its CDI import.
- **CDI @Produces Logger not converted**: Replace with `private static final Logger logger = LoggerFactory.getLogger(ClassName.class)`.
- **@ConditionalOnProperty complementary condition**: Default bean (`matchIfMissing=true`) and alternative (`matchIfMissing=false`) on same property.
- **@ConditionalOnProperty dependency chain**: Apply condition to every bean in the activation chain with side effects.
- **jakarta.inject.Qualifier compile error**: Use `org.springframework.beans.factory.annotation.Qualifier` (compile classpath), not `jakarta.inject.Qualifier`.
- **EJBTransactionRolledbackException → DataIntegrityViolationException catch ordering** (CRITICAL): When migrating EJB exception handling, `EJBTransactionRolledbackException` maps to Spring's `DataIntegrityViolationException` (or `DataAccessException` family). Catch blocks must preserve most-specific-first ordering. If the original code caught `EJBTransactionRolledbackException` before a generic `EJBException`, map to `DataIntegrityViolationException` before `DataAccessException`. Reversing the order causes the specific handler to be unreachable.
- **Vaadin @Component ScopeNotActiveException** (CRITICAL): Vaadin views annotated with `@Component` that previously relied on CDI `@SessionScoped` may throw `ScopeNotActiveException` if the Vaadin session is not active. Fix: use Vaadin's `@VaadinSessionScope` from `vaadin-spring` instead of Spring's `@SessionScope`, or use `@Scope(value = "prototype")` if session scoping is not essential.
- **JPA aggregate getSingleResult() null NPE in @PostConstruct / ApplicationReadyEvent** (CRITICAL): `TypedQuery.getSingleResult()` throws `NoResultException` when no row matches. In `@PostConstruct` or `@EventListener(ApplicationReadyEvent.class)` methods migrated from `@Startup @Singleton`, this can crash app startup if the DB is empty. Fix: use `getResultStream().findFirst()` or catch `NoResultException`. Also applies to aggregate queries (MIN, MAX, COUNT) on empty tables — these return null, not 0. Add null guards: `Long count = query.getSingleResult(); return count != null ? count : 0L;`.

## Legacy Library Issues

- **Jackson 1.x codehaus**: Replace `org.codehaus.jackson` with `com.fasterxml.jackson` annotations and imports.
- **Joda-Time**: Replace `org.joda.time.DateTime` with `java.time.LocalDateTime`.
- **C3P0/DBCP**: Remove deps and `hibernate.c3p0.*` properties — HikariCP is auto-configured.
- **Guava Optional**: Replace `Optional.fromNullable(x)` with `Optional.ofNullable(x)`.
- **JAXB javax.xml.bind**: Add jakarta.xml.bind-api + glassfish jaxb-runtime, replace `javax.xml.bind.*` with `jakarta.xml.bind.*` — do NOT delete JAXB marshalling tests.
- **JAXB + jackson-dataformat-xml coexistence**: `jackson-dataformat-xml` silently ignores `@XmlRootElement`. Add `@JacksonXmlRootElement(localName="<original name>")`.
- **JSON-B annotations lost**: Replace `@JsonbProperty` → `@JsonProperty`, `@JsonbDateFormat` → `@JsonFormat`, `@JsonbTransient` → `@JsonIgnore`.
- **Hibernate @URL validator**: Replace with `@Pattern(regexp="^(https?|ftp)://.*")`.
- **ObjectMapper missing modules**: `new ObjectMapper()` misses auto-registered modules. Inject from Spring context or use `.findAndRegisterModules()`.
- **JUL→SLF4J placeholder mismatch**: JUL uses `{0}`, `{1}` with `new Object[]{…}`; SLF4J uses positional `{}` as varargs. `{0}` prints literally at runtime.

## Hibernate 6 Issues

See also `references/hibernate6-behavior-changes.md` for detailed patterns.

- **@Embeddable returns null**: When all columns of an @Embeddable are NULL, Hibernate 6 returns null (not empty object). Add null-safe guards in getters.
- **@Lob long[][] ClassCastException**: Use `@Convert(converter=Long2DArrayConverter.class)` + `@Column(columnDefinition="BLOB")`.
- **@NotBlank on Collection**: `@NotBlank` is CharSequence-only. On Collection/array/Map, use `jakarta.validation.constraints.@NotEmpty`.

## UI and Static Resource Issues

- **Static resources 404**: Move from `webapp/` to `resources/static/`, add WebMvcConfigurer for directory index.
- **JSP pages blank/404**: Convert to Thymeleaf or static HTML — JSP not recommended in Spring Boot executable JARs.
- **SPA routing 404**: Forward non-API requests to index.html via a catch-all controller.
- **Subdirectory index.html**: Add `addViewController("/subdir/")` entries in WebMvcConfigurer.

## Test Issues

- **MockBean import**: `org.springframework.boot.test.mock.mockito.MockBean` (Spring Boot 3.2.x). In 3.4+: `org.springframework.test.context.bean.override.mockito.MockitoBean`.
- **LazyInitializationException**: Use JOIN FETCH or EAGER fetch for small collections.
- **Test application.yml not taking effect**: File fully replaces main — copy ALL config.
- **@SpringBootTest can't find configuration**: Specify `@SpringBootTest(classes = MainApp.class)`.
- **Ordered tests see empty DB**: Remove class-level `@Transactional` for ordered tests.
- **TestRestTemplate.delete() no status assertion**: Use `exchange(uri, DELETE, null, Void.class)`.
- **MockMvc ignores context-path**: Use paths relative to DispatcherServlet root.
- **@PersistenceContext in @WebMvcTest**: See `references/test-configuration-patterns.md`.

## Cleanup Issues

- **Legacy files left behind**: Delete ALL: persistence.xml, validation.xml, beans.xml, faces-config.xml, web.xml, logging.properties, JAAS configs, JSF message bundles, arquillian.xml, JBoss CLI scripts, and src/main/webapp/ if empty.
- **Editor .bak files**: Run `find . -name "*.bak" -not -path "*/target/*" -delete` TWICE, add `*.bak` to .gitignore. Verify: `find . -name "*.bak" -not -path "*/target/*"` must return empty.
- **Inline javax.* FQCNs missed**: `grep -r "javax\." src/ | grep -v "import "` catches inline FQCNs.

## JUL→SLF4J Quick Reference

High-volume mechanical conversion pattern. Use this section when migrating `java.util.logging.Logger` to `org.slf4j.Logger`.

### Import Replacement

| Before (JUL) | After (SLF4J) |
|---|---|
| `import java.util.logging.Logger;` | `import org.slf4j.Logger;` |
| `import java.util.logging.Level;` | `import org.slf4j.LoggerFactory;` |

Remove ALL `java.util.logging.*` imports. Add `org.slf4j.Logger` and `org.slf4j.LoggerFactory`.

### Logger Factory

**Before:** `Logger.getLogger(Foo.class.getName())` or `Logger.getLogger("com.example.Foo")`
**After:** `LoggerFactory.getLogger(Foo.class)` — drop `.getName()`.

### Level Mapping Table

| JUL Level | SLF4J Method |
|---|---|
| `Level.SEVERE` | `log.error(…)` |
| `Level.WARNING` | `log.warn(…)` |
| `Level.INFO` | `log.info(…)` |
| `Level.CONFIG` | `log.info(…)` |
| `Level.FINE` | `log.debug(…)` |
| `Level.FINER` | `log.trace(…)` |
| `Level.FINEST` | `log.trace(…)` |

### Invocation Pattern Conversion

**1. Simple message (identity):**
```java
// Before: LOG.info("Server started");
// After:  log.info("Server started");
```

**2. Message + Throwable:**
```java
// Before: LOG.log(Level.SEVERE, "Failed to process", exception);
// After:  log.error("Failed to process", exception);
```

**3. String concatenation + Throwable:**
```java
// Before: LOG.log(Level.WARNING, "Failed for user: " + userId, e);
// After:  log.warn("Failed for user: {}", userId, e);
```
SLF4J treats the last argument as Throwable if it is one — no special handling needed.

**4. Indexed placeholders {0}, {1}:**
```java
// Before: LOG.log(Level.INFO, "User {0} logged in from {1}", new Object[]{user, ip});
// After:  log.info("User {} logged in from {}", user, ip);
```
- Replace `{0}`, `{1}`, `{2}` etc. with `{}` (positional, in order)
- Unwrap `new Object[]{a, b}` to separate varargs: `a, b`

**5. isLoggable guard:**
```java
// Before: if (LOG.isLoggable(Level.FINE)) { LOG.fine("Detail: " + expensive()); }
// After:  log.debug("Detail: {}", expensive());
```
SLF4J defers string formatting until after the level check, so guards are usually unnecessary. Remove them unless `expensive()` has significant side effects.

### Verification

```bash
# No remaining JUL imports
grep -rn 'import java\.util\.logging\.' src/ || true
# Expected: empty
```
