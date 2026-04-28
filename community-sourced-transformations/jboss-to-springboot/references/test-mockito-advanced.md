# Mockito Advanced Patterns for Spring Boot Test Migration

## Table of Contents
1. [@InjectMocks with @PersistenceContext Fields](#injectmocks-with-persistencecontext-fields)
2. [@InjectMocks with @Value Fields](#injectmocks-with-value-fields)
3. [MockitoExtension STRICT_STUBS vs Lenient](#mockitoextension-strict_stubs-vs-lenient)
4. [doAnswer / doReturn Re-Stub Pitfall](#doanswer--doreturn-re-stub-pitfall)
5. [@MockBean HandlerInterceptor Bypass](#mockbean-handlerinterceptor-bypass)
6. [@WebMvcTest vs MockitoExtension Mutual Exclusion](#webmvctest-vs-mockitoextension-mutual-exclusion)
7. [JmsTemplate.convertAndSend Overload Ambiguity](#jmstemplateconvertandsend-overload-ambiguity)
8. [ApplicationEventPublisher.publishEvent Overload with argThat](#applicationeventpublisherpublishevent-overload-with-argthat)

## @InjectMocks with @PersistenceContext Fields

**Problem**: Mockito `@InjectMocks` satisfies injection via the largest constructor. If a class has both a constructor (for service dependencies) AND a `@PersistenceContext EntityManager` field, Mockito injects via constructor and **never** field-injects EntityManager → NPE at runtime.

**Fix**: Use `ReflectionTestUtils.setField` in `@BeforeEach`:

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {
    @Mock private EntityManager entityManager;
    @Mock private InventoryService inventoryService;
    @InjectMocks private OrderService orderService;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(orderService, "entityManager", entityManager);
    }
}
```

**Alternative**: Construct manually without `@InjectMocks`:
```java
@BeforeEach
void setUp() {
    orderService = new OrderService(inventoryService);
    ReflectionTestUtils.setField(orderService, "entityManager", entityManager);
}
```

## @InjectMocks with @Value Fields

**Problem**: Same issue as `@PersistenceContext` — `@InjectMocks` uses constructor injection and silently ignores `@Value`-annotated fields. The field remains `null`, causing NPEs or unexpected default behavior.

**Fix**: Use `ReflectionTestUtils.setField()` in `@BeforeEach` for every `@Value` field:

```java
@ExtendWith(MockitoExtension.class)
class NotificationServiceTest {
    @Mock private EmailSender emailSender;
    @InjectMocks private NotificationService service;

    @BeforeEach
    void setUp() {
        // Populate @Value fields that @InjectMocks does not handle
        ReflectionTestUtils.setField(service, "maxRetries", 3);
        ReflectionTestUtils.setField(service, "senderAddress", "no-reply@test.com");
        ReflectionTestUtils.setField(service, "enabled", true);
    }
}
```

**Detection**: Grep for classes used with `@InjectMocks` that have `@Value` or `@PersistenceContext`:
```bash
# Find @Value fields in service classes
grep -rn '@Value' src/main/java/ | grep 'private ' || true
```

Then check whether the corresponding test uses `@InjectMocks`. If so, add `ReflectionTestUtils.setField()` calls.

## MockitoExtension STRICT_STUBS vs Lenient

**Problem**: Mockito 4+ (bundled with Spring Boot 3.x) defaults to `STRICT_STUBS` mode in `@ExtendWith(MockitoExtension.class)`. Stubs defined in `@BeforeEach` that are not consumed by every test method cause `UnnecessaryStubbingException`.

**Fix options** (in order of preference):

### 1. Remove unused stubs (best)
Delete `when()` calls that aren't exercised by every test method. Move test-specific stubs into the test methods that need them.

### 2. Lenient specific stubs
Wrap only the subset-specific stubs with `lenient()`:
```java
@BeforeEach
void setUp() {
    // Used by all tests — strict is fine
    when(mockRepo.findAll()).thenReturn(allItems);

    // Used only by some tests — mark lenient
    lenient().when(mockRepo.findById(1L)).thenReturn(Optional.of(item1));
}
```

### 3. Class-level lenient (last resort)
```java
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MyTest { ... }
```

**Do NOT** apply class-level LENIENT as a default practice — it hides genuine stubbing errors.

## doAnswer / doReturn Re-Stub Pitfall

**Problem**: Re-stubbing the same method with `when(mock.method()).thenReturn(…)` on a void method, or re-stubbing when the first stub throws, causes NPE or unexpected behavior because the `when()` form actually invokes the method.

**Fix**: Use the Stubber form (`doReturn`/`doThrow`/`doAnswer`) when:
- Stubbing void methods
- Re-stubbing a method that was already stubbed to throw
- Stubbing methods on spies

```java
// WRONG — second when() invokes the mock, which throws from first stub
when(service.process(any())).thenThrow(new IOException("fail"));
// Later in same test:
when(service.process(any())).thenReturn(result);  // NPE or IOException here!

// CORRECT — Stubber form does not invoke the method
doThrow(new IOException("fail")).when(service).process(any());
// Re-stub safely:
doReturn(result).when(service).process(any());
```

**For void methods**:
```java
// WRONG — cannot use when() on void
when(service.sendNotification(any())).thenReturn(void);  // compile error

// CORRECT
doNothing().when(service).sendNotification(any());
doThrow(new RuntimeException("fail")).when(service).sendNotification(any());
```

## @MockBean HandlerInterceptor Bypass

**Problem**: Custom `HandlerInterceptor` implementations (migrated from JAX-RS `ContainerRequestFilter`) often check authentication or authorization. In `@WebMvcTest` or `@SpringBootTest` + `@AutoConfigureMockMvc` tests, the interceptor runs before the controller and may reject requests even when `@WithMockUser` is present — because `@WithMockUser` populates `SecurityContextHolder` but custom interceptors may check different sources (headers, session attributes).

**Fix**: `@MockBean` the interceptor and stub `preHandle` to return `true`:

```java
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @Autowired private MockMvc mockMvc;
    @MockBean private OrderService orderService;
    @MockBean private AuthInterceptor authInterceptor;  // Bypass interceptor

    @BeforeEach
    void setUp() throws Exception {
        when(authInterceptor.preHandle(any(), any(), any())).thenReturn(true);
    }

    @Test
    @WithMockUser
    void testGetOrders() throws Exception {
        when(orderService.findAll()).thenReturn(List.of());
        mockMvc.perform(get("/api/orders"))
            .andExpect(status().isOk());
    }
}
```

**When NOT to mock the interceptor**: If the test specifically validates interceptor behavior (e.g., "unauthenticated requests get 401"), let the interceptor run and assert the expected status.

## @WebMvcTest vs MockitoExtension Mutual Exclusion

**Problem**: `@WebMvcTest` and `@ExtendWith(MockitoExtension.class)` are mutually exclusive. `@WebMvcTest` loads a Spring context with MockMvc; `MockitoExtension` creates mocks outside Spring context. Combining them causes `@MockBean` fields to be null or `@Autowired` MockMvc to fail.

**Rule**: Use `@MockBean` (not `@Mock`) inside `@WebMvcTest` tests. Use `@Mock` (not `@MockBean`) inside `@ExtendWith(MockitoExtension.class)` tests.

```java
// CORRECT — @WebMvcTest with @MockBean
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @Autowired private MockMvc mockMvc;
    @MockBean private OrderService orderService;  // Spring-managed mock
}

// CORRECT — MockitoExtension with @Mock (unit test, no Spring)
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {
    @Mock private OrderRepository orderRepo;  // Mockito-managed mock
    @InjectMocks private OrderService service;
}

// WRONG — mixing both
@WebMvcTest(OrderController.class)
@ExtendWith(MockitoExtension.class)  // DO NOT combine
class OrderControllerTest { ... }
```

## JmsTemplate.convertAndSend Overload Ambiguity

**Problem**: `JmsTemplate.convertAndSend()` has multiple overloads: `(String destination, Object message)`, `(Object message)`, and `(String destination, Object message, MessagePostProcessor postProcessor)`. When stubbing with Mockito, `verify(jmsTemplate).convertAndSend(anyString(), any())` may match the wrong overload.

**Fix**: Use explicit argument matchers with the correct types:
```java
// CORRECT — matches (String, Object) overload specifically
verify(jmsTemplate).convertAndSend(eq("OrderQueue"), any(OrderMessage.class));
```

**If ambiguity persists**: Use `ArgumentCaptor` and verify the captured arguments:
```java
ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
verify(jmsTemplate).convertAndSend(eq("OrderQueue"), captor.capture());
assertInstanceOf(OrderMessage.class, captor.getValue());
```

## ApplicationEventPublisher.publishEvent Overload with argThat

**Problem**: `ApplicationEventPublisher.publishEvent()` has two overloads: `publishEvent(Object event)` and `publishEvent(ApplicationEvent event)`. When using `argThat()` with a lambda, Mockito may fail to resolve the overload, especially when the event type extends `ApplicationEvent`.

**Fix**: Use `ArgumentCaptor` instead of `argThat()`:
```java
// FRAGILE — overload ambiguity
verify(publisher).publishEvent(argThat(e -> e instanceof OrderEvent));

// ROBUST — ArgumentCaptor
ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
verify(publisher).publishEvent(captor.capture());
assertInstanceOf(OrderEvent.class, captor.getValue());
```

## Verification

```bash
# 1. No @Mock in @WebMvcTest tests (should be @MockBean)
grep -rn '@WebMvcTest' src/test/java/ -l | xargs grep -l '@Mock[^B]' || true
# Expected: empty

# 2. No @MockBean in pure Mockito tests (should be @Mock)
grep -rn 'MockitoExtension' src/test/java/ -l | xargs grep -l '@MockBean' || true
# Expected: empty

# 3. All @InjectMocks classes with @Value/@PersistenceContext have ReflectionTestUtils
# Manual check: grep for @InjectMocks, inspect corresponding service for @Value/@PersistenceContext
grep -rn '@InjectMocks' src/test/java/ || true

# 4. Run tests
mvn clean test
```
