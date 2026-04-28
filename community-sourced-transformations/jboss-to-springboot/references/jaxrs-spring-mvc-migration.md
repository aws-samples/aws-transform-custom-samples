# JAX-RS → Spring MVC Migration Reference

## Table of Contents
1. [Complete Before/After Example](#complete-beforeafter-example)
2. [Pre-Migration: Locate @ApplicationPath](#pre-migration-locate-applicationpath)
3. [@ApplicationPath Folding](#applicationpath-folding)
4. [Annotation Mapping Table](#annotation-mapping-table)
5. [@QueryParam → @RequestParam Required=false](#queryparam--requestparam-requiredfalse)
6. [@FormParam → @RequestParam](#formparam--requestparam)
7. [Implicit Body Parameter → @RequestBody](#implicit-body-parameter--requestbody)
8. [Response → ResponseEntity Patterns](#response--responseentity-patterns)
9. [ResponseEntity.getStatusCode() Returns HttpStatusCode](#responseentitygetstatuscode-returns-httpstatuscode)
10. [Exception Entity-Body Loss with @ResponseStatus](#exception-entity-body-loss-with-responsestatus)
11. [UriBuilder → ServletUriComponentsBuilder](#uribuilder--servleturicomponentsbuilder)
12. [UriInfo Translation Table](#uriinfo-translation-table)
13. [MultivaluedMap → MultiValueMap](#multivaluedmap--multivaluemap)
14. [MultivaluedMap Class Hierarchy Rewrite](#multivaluedmap-class-hierarchy-rewrite)
15. [ExceptionMapper → @ControllerAdvice](#exceptionmapper--controlleradvice)
16. [ContainerRequestFilter / ContainerResponseFilter](#containerrequestfilter--containerresponsefilter)
17. [JAX-RS SSE → SseEmitter](#jax-rs-sse--sseemitter)
18. [MockMvc XML Accept Header for produces Endpoints](#mockmvc-xml-accept-header-for-produces-endpoints)
19. [Verification](#verification)

## Complete Before/After Example

Given `@ApplicationPath("/api")` on the JAX-RS Application subclass:

**Before (JBoss):**
```java
import javax.ws.rs.*;
import javax.ws.rs.core.Response;
import javax.inject.Inject;

@Path("/members")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class MemberResource {
    @Inject
    private MemberService memberService;

    @GET
    @Path("/{id}")
    public Response getMember(@PathParam("id") Long id) {
        Member member = memberService.findById(id);
        if (member == null) return Response.status(Response.Status.NOT_FOUND).build();
        return Response.ok(member).build();
    }

    @GET
    public Response search(@QueryParam("name") String name) {
        return Response.ok(memberService.search(name)).build();
    }
}
```

**After (Spring Boot):** (`@ApplicationPath("/api")` prefix folded into @RequestMapping)
```java
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/members")
public class MemberResource {
    private final MemberService memberService;

    public MemberResource(MemberService memberService) {
        this.memberService = memberService;
    }

    @GetMapping("/{id}")
    public ResponseEntity<Member> getMember(@PathVariable Long id) {
        Member member = memberService.findById(id);
        if (member == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(member);
    }

    @GetMapping
    public ResponseEntity<?> search(@RequestParam(value = "name", required = false) String name) {
        return ResponseEntity.ok(memberService.search(name));
    }
}
```

Key transformations:
- `@ApplicationPath("/api")` + `@Path("/members")` → `@RequestMapping("/api/members")`
- `@QueryParam("name")` → `@RequestParam(value="name", required=false)` (JAX-RS params always optional)
- `Response` → `ResponseEntity`, field injection → constructor injection

## Pre-Migration: Locate @ApplicationPath

Before converting any endpoint, find the JAX-RS Application subclass and extract its base path:

```bash
grep -rn '@ApplicationPath' src/main/java/
```

Example output:
```
src/main/java/com/example/JaxRsActivator.java:5:@ApplicationPath("/rest")
```

Record this value (e.g., `/rest`). It must be prepended to every `@RequestMapping` path.

## @ApplicationPath Folding

Spring Boot has no `@ApplicationPath` equivalent. The prefix must be folded into every controller's `@RequestMapping`.

Rules:
- Non-leading-slash `@Path` values get a leading slash: `@Path("members")` → `/rest/members`
- Empty `@ApplicationPath("")` or `@ApplicationPath("/")` → no prefix needed
- Nested `@Path` on methods: `@Path("{id}")` → `@GetMapping("/{id}")` (no @ApplicationPath prefix on method-level paths)
- If no `@ApplicationPath` class exists (possible in some apps that register via web.xml), check web.xml `<servlet-mapping>` for the JAX-RS url-pattern.

## Annotation Mapping Table

| JAX-RS | Spring MVC |
|--------|-----------|
| `@Path("/x")` (class) | `@RequestMapping("/prefix/x")` (with @ApplicationPath prefix) |
| `@Path("{id}")` (method) | part of `@GetMapping("/{id}")` |
| `@GET` | `@GetMapping` |
| `@POST` | `@PostMapping` |
| `@PUT` | `@PutMapping` |
| `@DELETE` | `@DeleteMapping` |
| `@PATCH` | `@PatchMapping` |
| `@PathParam("id")` | `@PathVariable("id")` (or just `@PathVariable` if name matches) |
| `@QueryParam("q")` | `@RequestParam(value="q", required=false)` |
| `@HeaderParam("h")` | `@RequestHeader("h")` |
| `@FormParam("f")` | `@RequestParam("f")` (with `@PostMapping`) |
| `@DefaultValue("v") @QueryParam("q")` | `@RequestParam(value="q", defaultValue="v")` |
| `@Produces(APPLICATION_JSON)` | `produces = MediaType.APPLICATION_JSON_VALUE` on mapping (usually implicit with @RestController) |
| `@Consumes(APPLICATION_JSON)` | `consumes = MediaType.APPLICATION_JSON_VALUE` on mapping (usually implicit) |
| `@Context HttpServletRequest` | `HttpServletRequest request` parameter (auto-injected) |
| `@Context UriInfo` | `ServletUriComponentsBuilder` (see UriInfo Translation Table below) |
| `@BeanParam` | `@ModelAttribute` (for form-backed objects) |

## @QueryParam → @RequestParam Required=false

JAX-RS `@QueryParam` parameters are always optional — when absent, the value is `null`. Spring MVC `@RequestParam` defaults to `required=true`, returning HTTP 400 when missing.

**Always add `required=false`** unless the endpoint explicitly required the parameter:

**Before:**
```java
@GET
public Response search(@QueryParam("name") String name,
                       @QueryParam("page") Integer page) {
    // name and page are null when absent
}
```

**After:**
```java
@GetMapping
public ResponseEntity<?> search(
        @RequestParam(value = "name", required = false) String name,
        @RequestParam(value = "page", required = false) Integer page) {
    // Preserves JAX-RS behavior: null when absent
}
```

Exception: If the original code had `@NotNull @QueryParam("id") Long id`, then `required=true` (the default) is correct.

## @FormParam → @RequestParam

JAX-RS `@FormParam` maps to Spring's `@RequestParam` on `@PostMapping` methods that consume form data:

**Before:**
```java
@POST
@Consumes(MediaType.APPLICATION_FORM_URLENCODED)
public Response login(@FormParam("username") String username,
                      @FormParam("password") String password) {
    return Response.ok(authService.authenticate(username, password)).build();
}
```

**After:**
```java
@PostMapping(consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
public ResponseEntity<?> login(@RequestParam("username") String username,
                               @RequestParam("password") String password) {
    return ResponseEntity.ok(authService.authenticate(username, password));
}
```

Note: For form data, `@RequestParam` is `required=true` by default, which is usually correct for form fields (unlike `@QueryParam` where optional is the norm).

## Implicit Body Parameter → @RequestBody

In JAX-RS, an unannotated parameter in a `@POST` or `@PUT` method with `@Consumes(APPLICATION_JSON)` is implicitly the request body. Spring MVC requires `@RequestBody` explicitly — omitting it results in a null parameter with no compile or runtime error.

**Before:**
```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(MemberDTO member) {  // implicit body
    return Response.ok(service.create(member)).build();
}
```

**After:**
```java
@PostMapping
public ResponseEntity<?> create(@RequestBody MemberDTO member) {
    return ResponseEntity.ok(service.create(member));
}
```

Detection: Look for `@POST`/`@PUT` methods with unannotated parameters whose type is a DTO/entity class (not `String`, `int`, `HttpServletRequest`, etc.).

## Response → ResponseEntity Patterns

| JAX-RS Pattern | Spring MVC Equivalent |
|---|---|
| `Response.ok(entity).build()` | `ResponseEntity.ok(entity)` |
| `Response.ok().build()` | `ResponseEntity.ok().build()` |
| `Response.status(NOT_FOUND).build()` | `ResponseEntity.notFound().build()` |
| `Response.status(CREATED).entity(e).build()` | `ResponseEntity.status(HttpStatus.CREATED).body(e)` |
| `Response.noContent().build()` | `ResponseEntity.noContent().build()` |
| `Response.status(BAD_REQUEST).entity(errors).build()` | `ResponseEntity.badRequest().body(errors)` |
| `Response.status(CONFLICT).entity(msg).build()` | `ResponseEntity.status(HttpStatus.CONFLICT).body(msg)` |
| `Response.accepted().build()` | `ResponseEntity.accepted().build()` |
| `Response.seeOther(uri).build()` | `ResponseEntity.status(HttpStatus.SEE_OTHER).location(uri).build()` |

For methods with mixed return types (e.g., 200 with entity OR 204 void), use `ResponseEntity<?>`.

## ResponseEntity.getStatusCode() Returns HttpStatusCode

**Spring 6 / Spring Boot 3.x change**: `ResponseEntity.getStatusCode()` returns `HttpStatusCode` (interface), not `HttpStatus` (enum) or `int`. Code migrated from JAX-RS (`Response.getStatus()` returns `int`) must use the correct comparison pattern.

**Two valid assertion patterns in tests:**
```java
// Pattern A: Compare with HttpStatus enum (recommended)
assertEquals(HttpStatus.OK, response.getStatusCode());

// Pattern B: Compare with int value
assertEquals(200, response.getStatusCode().value());
```

**DEPRECATED**: `getStatusCodeValue()` is deprecated in Spring Boot 3.x — use `getStatusCode().value()` instead.

**Common migration mistake**:
```java
// WRONG — int comparison with HttpStatusCode object
assertEquals(200, response.getStatusCode());  // Compile error or assertion failure

// CORRECT
assertEquals(HttpStatus.OK, response.getStatusCode());
```

## Exception Entity-Body Loss with @ResponseStatus

**Problem**: When migrating JAX-RS `ExceptionMapper` to Spring, using `@ResponseStatus` on exception classes drops the response body. JAX-RS `Response.status(BAD_REQUEST).entity(errors).build()` includes error details; `@ResponseStatus(HttpStatus.BAD_REQUEST)` returns only the status with an empty or generic body.

**Fix**: Use `ResponseEntity` in `@ExceptionHandler` instead of `@ResponseStatus` when the error body matters:

```java
// WRONG — body lost
@ResponseStatus(HttpStatus.BAD_REQUEST)
public class ValidationException extends RuntimeException { ... }

// CORRECT — preserves body
@ControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(ValidationException.class)
    public ResponseEntity<Map<String, String>> handleValidation(ValidationException e) {
        return ResponseEntity.badRequest().body(Map.of(
            "error", "VALIDATION_FAILED",
            "message", e.getMessage()
        ));
    }
}
```

## UriBuilder → ServletUriComponentsBuilder

**Before:**
```java
URI uri = UriBuilder.fromResource(MemberResource.class)
    .path("{id}")
    .build(member.getId());
return Response.created(uri).entity(member).build();
```

**After:**
```java
URI uri = ServletUriComponentsBuilder.fromCurrentRequest()
    .path("/{id}")
    .buildAndExpand(member.getId())
    .toUri();
return ResponseEntity.created(uri).body(member);
```

Import: `org.springframework.web.servlet.support.ServletUriComponentsBuilder`

**Note**: For client-side REST calls migrated from JAX-RS `Client`/`WebTarget`, prefer `RestTemplate` or `WebClient` with `UriComponentsBuilder`, `RestTemplateBuilder`, and `ParameterizedTypeReference`.

## UriInfo Translation Table

JAX-RS `@Context UriInfo` provides several methods. Each has a Spring MVC equivalent:

| JAX-RS (`UriInfo`) | Spring MVC Equivalent |
|---|---|
| `uriInfo.getAbsolutePathBuilder()` | `ServletUriComponentsBuilder.fromCurrentRequest()` |
| `uriInfo.getBaseUriBuilder()` | `ServletUriComponentsBuilder.fromCurrentContextPath()` |
| `uriInfo.getQueryParameters()` | `@RequestParam Map<String, String>` or `@RequestParam MultiValueMap<String, String>` |
| `uriInfo.getPathParameters()` | `@PathVariable Map<String, String>` |
| `uriInfo.getRequestUri()` | `HttpServletRequest.getRequestURL()` (inject `HttpServletRequest` as method parameter) |
| `uriInfo.getPath()` | `HttpServletRequest.getRequestURI()` |
| `uriInfo.getAbsolutePath()` | `ServletUriComponentsBuilder.fromCurrentRequest().build().toUri()` |

**Migration pattern**: Replace `@Context UriInfo uriInfo` field with method parameters or `ServletUriComponentsBuilder` calls at point of use. Spring MVC does not have a single UriInfo equivalent — each method maps individually.

## MultivaluedMap → MultiValueMap

If JAX-RS code uses `MultivaluedMap<String, String>` (e.g., for form parameters or query parameter maps), replace with Spring's `MultiValueMap<String, String>`:

```java
// Before (JAX-RS)
import javax.ws.rs.core.MultivaluedMap;

// After (Spring)
import org.springframework.util.MultiValueMap;
```

**Warning**: If a class extends `MultivaluedMap` or overrides its methods, verify that `MultiValueMap` has the same method signatures. See the class hierarchy rewrite section below.

## MultivaluedMap Class Hierarchy Rewrite

**Problem**: If the project defines classes extending `MultivaluedMap` or `AbstractMultivaluedMap`, the migration requires simultaneous changes to the base class and all subclasses.

**Key API differences**:
| `MultivaluedMap<K,V>` method | `MultiValueMap<K,V>` equivalent |
|---|---|
| `putSingle(K, V)` | `set(K, V)` |
| `getFirst(K)` | `getFirst(K)` (same) |
| `add(K, V)` | `add(K, V)` (same) |
| `equalsIgnoreValueOrder(MultivaluedMap)` | No equivalent — remove or implement custom |

**Fix**: Change extends/implements and update all overridden methods in the same pass:

```java
// Before
public class CustomParamMap extends AbstractMultivaluedMap<String, String> {
    @Override
    public void putSingle(String key, String value) { ... }
}

// After
public class CustomParamMap extends LinkedMultiValueMap<String, String> {
    public void set(String key, String value) {
        super.set(key, value);
    }
}
```

Compile immediately — any missed `@Override` produces a compile error.

## ExceptionMapper → @ControllerAdvice

JAX-RS `ExceptionMapper<T>` → Spring `@ControllerAdvice` + `@ExceptionHandler`. Preserve the HTTP status code and error body format for functional parity.

**Before:**
```java
@Provider
public class NotFoundMapper implements ExceptionMapper<NotFoundException> {
    @Override
    public Response toResponse(NotFoundException e) {
        return Response.status(NOT_FOUND)
            .entity(new ErrorResponse("NOT_FOUND", e.getMessage()))
            .build();
    }
}
```

**After:**
```java
@ControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(NotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(new ErrorResponse("NOT_FOUND", e.getMessage()));
    }
}
```

**Multiple ExceptionMapper classes**: Consolidate into a single `@ControllerAdvice` with multiple `@ExceptionHandler` methods. Each method preserves the original HTTP status code and JSON body structure.

Delete the `@Provider` class and its JAX-RS imports after migration.

## ContainerRequestFilter / ContainerResponseFilter

JAX-RS filters have different Spring equivalents depending on direction:

| JAX-RS | Spring Equivalent |
|--------|------------------|
| `ContainerRequestFilter` | `HandlerInterceptor.preHandle()` or `OncePerRequestFilter` |
| `ContainerResponseFilter` | `HandlerInterceptor.postHandle()` or `OncePerRequestFilter` wrapping response |

**CRITICAL**: In `ContainerResponseFilter` → `OncePerRequestFilter` migration, set ALL response headers BEFORE `chain.doFilter()`. Headers set after `doFilter()` are silently dropped on a committed response. This is the #1 cause of "CORS headers missing" bugs after migration.

**Before:**
```java
@Provider
public class CorsFilter implements ContainerResponseFilter {
    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        res.getHeaders().add("Access-Control-Allow-Origin", "*");
    }
}
```

**After:**
```java
@Component
public class CorsFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        // MUST set headers BEFORE doFilter
        response.setHeader("Access-Control-Allow-Origin", "*");
        chain.doFilter(request, response);
        // Headers set HERE are silently dropped if response is committed
    }
}
```

Register `HandlerInterceptor` in `WebMvcConfigurer.addInterceptors()`.

## JAX-RS SSE → SseEmitter

JAX-RS `SseEventSink`/`SseBroadcaster`/`OutboundSseEvent` → Spring's `SseEmitter`:

### Simple SSE Endpoint

**Before:**
```java
@GET
@Path("/events")
@Produces(MediaType.SERVER_SENT_EVENTS)
public void subscribe(@Context SseEventSink sink, @Context Sse sse) {
    sink.send(sse.newEvent("data"));
}
```

**After:**
```java
@GetMapping(path = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter subscribe() {
    SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);  // No timeout
    executor.execute(() -> {
        try {
            emitter.send(SseEmitter.event().data("data"));
            emitter.complete();
        } catch (IOException e) {
            emitter.completeWithError(e);
        }
    });
    return emitter;
}
```

### Broadcaster Pattern (Multiple Subscribers)

**Before (JAX-RS):**
```java
@Singleton
@Path("/sse")
public class SseResource {
    private SseBroadcaster broadcaster;

    @Context
    public void setSse(Sse sse) {
        this.broadcaster = sse.newBroadcaster();
    }

    @GET @Path("/subscribe")
    @Produces(MediaType.SERVER_SENT_EVENTS)
    public void subscribe(@Context SseEventSink sink) {
        broadcaster.register(sink);
    }

    public void broadcast(String data) {
        broadcaster.broadcast(sse.newEvent(data));
    }
}
```

**After (Spring):**
```java
@RestController
@RequestMapping("/sse")
public class SseController {
    private final ConcurrentHashMap<String, Set<SseEmitter>> subscribers = new ConcurrentHashMap<>();

    @GetMapping(path = "/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);
        Set<SseEmitter> emitters = subscribers.computeIfAbsent("default",
            k -> ConcurrentHashMap.newKeySet());
        emitters.add(emitter);

        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        return emitter;
    }

    public void broadcast(String data) {
        Set<SseEmitter> emitters = subscribers.getOrDefault("default", Set.of());
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().data(data));
            } catch (IOException e) {
                emitters.remove(emitter);  // Dead emitter
            }
        }
    }
}
```

**Key differences**:
- `SseEventSink` is a push sink; `SseEmitter` is a return value that Spring writes to
- `SseBroadcaster.register()` → manual `ConcurrentHashMap<String, Set<SseEmitter>>` subscriber management
- Dead emitters throw `IOException` on `send()` — catch and remove
- Always register `onCompletion` and `onTimeout` callbacks to clean up subscriber maps

## MockMvc XML Accept Header for produces Endpoints

Endpoints declaring `produces = MediaType.APPLICATION_XML_VALUE` require an explicit Accept header in MockMvc:

```java
mockMvc.perform(get("/api/orders/1")
        .accept(MediaType.APPLICATION_XML))
    .andExpect(status().isOk())
    .andExpect(content().contentType(MediaType.APPLICATION_XML));
```

Without `.accept(MediaType.APPLICATION_XML)`, MockMvc defaults to `*/*` which may trigger JSON serialization or `HttpMediaTypeNotAcceptableException`.

**MockMvc null/empty PathVariable equivalence**: `@PathVariable` with empty string `""` and with null behave differently in Spring MVC 6. In MockMvc tests, use `/api/items/` (trailing slash) to test empty path variable behavior rather than omitting the variable entirely. Spring MVC 6 is stricter about null path variables than Spring MVC 5.

## Verification

After migrating all controllers, verify:

```bash
# 1. No remaining JAX-RS annotations
grep -rn '@Path\|@GET\|@POST\|@PUT\|@DELETE\|@PathParam\|@QueryParam\|@HeaderParam\|@FormParam\|@Produces\|@Consumes\|@Provider' src/main/java/ || true

# 2. No remaining JAX-RS imports
grep -rn 'javax\.ws\.rs\|jakarta\.ws\.rs' src/ || true

# 3. All @RequestMapping paths include the @ApplicationPath prefix
# (manual review — verify no path is missing the prefix)

# 4. Build passes
mvn clean compile
```

The grep commands should return empty results. If any remain, complete the migration for those files.
