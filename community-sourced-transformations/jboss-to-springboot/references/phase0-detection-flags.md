# Phase 0: Library Detection Flag Rules

These flags are set during the Phase 0 Project Analysis scan. Each flag
controls conditional behavior in later phases (dependency selection, import
migration, annotation replacement, etc.). The worker MUST evaluate every rule
below against the project before starting Phase 1.

## Detection Rules

| Flag | Detection Rule |
|------|---------------|
| HAS_JODA_TIME | pom.xml contains `joda-time` dependency (groupId `joda-time`) |
| HAS_JACKSON_V1 | pom.xml contains `org.codehaus.jackson` dependency, OR any Java file imports `org.codehaus.jackson` |
| HAS_C3P0 | pom.xml contains `c3p0` dependency (groupId `com.mchange`), OR persistence.xml contains `hibernate.c3p0` properties |
| HAS_GUAVA | pom.xml contains `com.google.guava` dependency **AND** any Java file imports `com.google.common.base.Optional` — both conditions must be true |
| HAS_LOMBOK | pom.xml contains `org.projectlombok` dependency |
| HAS_SPRING_XML | Any `.xml` file in `src/main/resources/` **or** `src/main/webapp/WEB-INF/` contains `<beans xmlns="http://www.springframework.org/schema/beans"` |
| HAS_LOG4J | `src/main/resources/` contains a file named `log4j.xml` or `log4j.properties` |
| JAX_WS_NEEDED | Any Java file contains `@WebService`, `@WebMethod`, or imports `javax.xml.ws.*` / `jakarta.xml.ws.*` |
| HAS_JAXB | Any Java file imports `javax.xml.bind.*` or `jakarta.xml.bind.*`, OR pom.xml contains `jaxb-api` dependency |
| HAS_JSONB | Any Java file imports `jakarta.json.bind.*` or `javax.json.bind.*`, OR pom.xml contains `jakarta.json.bind-api` |
| HAS_EJB_TIMERS | Any Java file contains `@Schedule`, `@Timeout`, or imports `TimerService` from `javax.ejb` / `jakarta.ejb` — must be EJB timer annotations, not Spring `@Scheduled` |
| HAS_JAVAMAIL | Any Java file imports `javax.mail.*` or `jakarta.mail.*`, OR pom.xml contains javax.mail/jakarta.mail |
| HAS_SERVLET_FILTERS | Any Java file contains `@WebFilter` or `@WebListener` annotations |
| HAS_MULTI_DATASOURCE | persistence.xml contains multiple `<persistence-unit>` elements, OR standalone.xml defines multiple datasource subsystems. Fallback: `grep -c '<jta-data-source>' src/main/resources/META-INF/persistence.xml` — if count >1, set flag. |
| SUREFIRE_DISABLED | pom.xml contains `<skip>true</skip>` or `<skipTests>true</skipTests>` under maven-surefire-plugin configuration. **Action**: Remove `<skip>true</skip>` or set to `false`. Verify fix: `mvn help:effective-pom | grep -A5 surefire`. Skipped surefire masks ALL test failures — builds appear green while tests silently don't run. |
| HAS_CDI_INTERCEPTORS | Any Java file contains `@Interceptor` or `@InterceptorBinding` import/annotation. **Action**: Add `spring-boot-starter-aop` in Step 2. |
| HAS_JSONP | Any Java file imports `javax.json.*` (JSON Processing API, NOT JSON-B `javax.json.bind.*`). **Action**: Migrate `JsonObject`/`JsonArray`/`JsonBuilder` to Jackson `ObjectMapper`/`ObjectNode`/`ArrayNode`. |
| HAS_LOB_COMPLEX_TYPES | Any `@Lob` annotation on a multi-dimensional array field (`long[][]`, `int[][]`, `byte[][]`). **Action**: In Step 5, replace `@Lob` with `@Convert(converter=…)` + `@Column(columnDefinition="BLOB")`. See `references/hibernate6-behavior-changes.md`. |
| HAS_DROOLS | pom.xml contains `org.kie` or `org.drools` dependencies, OR any Java file imports `org.kie.*` / `org.drools.*`. **Action**: In Step 13, wire KIE/Drools via `@Configuration` class producing `KieContainer @Bean` instead of CDI `@Produces`. Preserve rules and .drl files as-is. |
| HAS_JCACHE | Any Java file imports `javax.cache.annotation.*` (e.g., `@CacheResult`, `@CacheRemove`). **Action**: In Step 6, add `spring-boot-starter-cache` + `caffeine` dependency. Map: `@CacheResult` → `@Cacheable`, `@CacheRemove` → `@CacheEvict`, `@CacheRemoveAll` → `@CacheEvict(allEntries=true)`, `@CachePut` → `@CachePut`. Add `@EnableCaching` on a `@Configuration` class. |
| HAS_MICROPROFILE_CONFIG | Any Java file imports `org.eclipse.microprofile.config.inject.ConfigProperty`. **Action**: In Step 6, replace `@ConfigProperty(name="x")` → `@Value("${x}")`. Replace `@ConfigProperty(name="x", defaultValue="y")` → `@Value("${x:y}")`. Migrate `ConfigProvider.getConfig()` programmatic access to `Environment.getProperty()`. |
| JPA_NEEDED | pom.xml contains `spring-boot-starter-data-jpa` (post-Step 2) OR any Java file imports `javax.persistence.*` / `jakarta.persistence.*`. **Action**: determines whether H2 test dependency is added (Step 4) and whether test application.yml needs H2 override (Step 12). |
| LOC_ESTIMATE | Approximate lines of Java code in `src/main/java/` — use `find src/main/java -name '*.java' | xargs wc -l` |

## Detection Commands

Quick grep commands for flags that are commonly missed:

```bash
# SUREFIRE_DISABLED
grep -A 5 'maven-surefire-plugin' pom.xml | grep -i 'skip'

# HAS_CDI_INTERCEPTORS
grep -rn '@Interceptor\|@InterceptorBinding' src/main/java/

# HAS_JSONP (exclude JSON-B)
grep -rn 'import javax\.json\.' src/main/java/ | grep -v 'javax\.json\.bind'

# HAS_MULTI_DATASOURCE (when standalone.xml absent)
grep -c '<jta-data-source>' src/main/resources/META-INF/persistence.xml 2>/dev/null || echo "0"

# HAS_LOB_COMPLEX_TYPES
grep -rn '@Lob' src/main/java/ -A 2 | grep '\[\]\[\]'

# HAS_DROOLS / HAS_KIE
grep -rn 'org\.kie\.\|org\.drools\.' src/main/java/ | head -3

# HAS_JCACHE
grep -rn 'javax\.cache\.annotation' src/main/java/ | head -3

# HAS_MICROPROFILE_CONFIG
grep -rn 'microprofile\.config' src/main/java/ | head -3

# JPA_NEEDED (pre-migration check)
grep -rn 'import javax\.persistence\.\|import jakarta\.persistence\.' src/main/java/ | head -3

# Mixed servlet API detection (pre-migration blocker)
grep -rn 'import javax\.servlet' src/main/java/ | head -1 && grep -rn 'import jakarta\.servlet' src/main/java/ | head -1 && echo "⚠ MIXED SERVLET API — resolve before proceeding"
```

## Notes

- **HAS_GUAVA dual condition**: Specifically tracks Guava's `Optional` usage. Projects using Guava only for collections/caching do not set this flag.
- **HAS_SPRING_XML namespace match**: Match exact string `http://www.springframework.org/schema/beans` in `xmlns`. Scan both `src/main/resources/` and `src/main/webapp/WEB-INF/`.
- **HAS_EJB_TIMERS vs Spring @Scheduled**: Only EJB timer annotations set this flag.
- **HAS_MULTI_DATASOURCE**: Check persistence.xml for multiple `<persistence-unit>` elements. When standalone.xml is absent, use `grep -c '<jta-data-source>'` as fallback — count >1 triggers Step 8b.
- **SUREFIRE_DISABLED**: Silent killer — build reports SUCCESS while zero tests run. Must be detected in Phase 0 and fixed before Phase 4.
- **HAS_LOB_COMPLEX_TYPES**: Hibernate 6.4.4 + H2 2.x causes `ClassCastException` on multi-dimensional array `@Lob` fields. Detect early to prevent expensive debugging.
- **HAS_DROOLS**: KIE/Drools runtime is preserved — only the CDI wiring changes to Spring `@Bean` configuration. Do NOT attempt to replace Drools rules with Spring equivalents.
- **HAS_JCACHE**: JCache (JSR-107) annotations map cleanly to Spring Cache annotations. The cache provider changes from whatever the app server provided to Caffeine (embedded).
- **HAS_MICROPROFILE_CONFIG**: MicroProfile Config `@ConfigProperty` maps directly to Spring `@Value`. The main difference is that MicroProfile uses `@ConfigProperty(name=…)` while Spring uses `@Value("${…}")` with property expressions.
- **Mixed servlet API**: If both `javax.servlet` and `jakarta.servlet` imports exist in the same codebase, the app was partially migrated. Resolve to a single namespace before starting the JBoss→Spring Boot migration — mixed namespaces cause ClassCastExceptions at runtime.
- **LOC_ESTIMATE** is used for complexity classification (GREEN/YELLOW/ORANGE/RED) and is not a boolean flag.
- **JPA_NEEDED**: Determines whether to add H2 dependency (Step 4) and whether to create test application.yml with H2 override (Step 12). After Step 2, check for `spring-boot-starter-data-jpa` in pom.xml as the canonical signal.
