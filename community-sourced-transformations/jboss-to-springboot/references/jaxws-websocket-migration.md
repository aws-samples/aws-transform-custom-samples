# JAX-WS and WebSocket/SSE Migration Reference

These migrations apply only when JAX_WS_NEEDED=true or WEBSOCKET_NEEDED=true.

## Table of Contents
1. [JAX-WS / SOAP Services](#jax-ws--soap-services-if-jax_ws_neededtrue)
2. [Spring-WS 4.x Breaking Changes](#spring-ws-4x-breaking-changes)
3. [WebSocket Migration](#websocket-migration-if-websocket_neededtrue)
4. [SSE (Server-Sent Events)](#sse-server-sent-events)

## JAX-WS / SOAP Services (if JAX_WS_NEEDED=true)

### SOAP-to-REST Modernization (preferred)

| JAX-WS | Spring MVC |
|--------|-----------|
| `@WebService` | `@RestController` |
| `@WebMethod` | `@PostMapping` |
| SOAP Handler chains | `HandlerInterceptor` |
| `@WebServiceRef` | Constructor injection of `RestTemplate`/`WebClient` |

Remove all `jakarta.xml.ws.*` / `javax.xml.ws.*` imports after conversion.

### Preserving SOAP (Spring-WS)

If the SOAP contract must be preserved:
- Add `spring-boot-starter-web-services`
- `@WebService` → `@Endpoint` + `@PayloadRoot(namespace="...", localPart="...")`
- `@WebMethod` → `@PayloadRoot`-annotated methods with `@RequestPayload`/`@ResponsePayload`
- SOAP Handler chains → Spring-WS `EndpointInterceptor`
- Configure `MessageDispatcherServlet` in a @Configuration class

**Before:**
```java
@WebService
public class OrderWebService {
    @WebMethod
    public OrderResponse getOrder(OrderRequest request) {
        return orderService.findOrder(request.getId());
    }
}
```

**After (REST modernization):**
```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping("/get")
    public ResponseEntity<OrderResponse> getOrder(@RequestBody OrderRequest request) {
        return ResponseEntity.ok(orderService.findOrder(request.getId()));
    }
}
```

## Spring-WS 4.x Breaking Changes

When preserving SOAP with Spring-WS 4.x (Spring Boot 3.x):

### 1. wsdl4j not transitive
Spring-WS 4.x drops `wsdl4j` as a transitive dependency. Add it explicitly:
```xml
<dependency>
    <groupId>wsdl4j</groupId>
    <artifactId>wsdl4j</artifactId>
</dependency>
```
Without this, WSDL generation at runtime fails with `ClassNotFoundException: javax.wsdl.Definition`.

### 2. setRequestSuffix("") rejected
`DefaultWsdl11Definition.setRequestSuffix("")` throws `IllegalArgumentException` (Spring's `Assert.hasText()` fails on empty string) in Spring-WS 4.x. This worked in 3.x.

**Fix**: Omit the `setRequestSuffix("")` call entirely — use the default suffix or set a non-empty value:
```java
@Bean
public DefaultWsdl11Definition orders(XsdSchema schema) {
    DefaultWsdl11Definition def = new DefaultWsdl11Definition();
    def.setPortTypeName("OrdersPort");
    def.setSchema(schema);
    // Do NOT call: def.setRequestSuffix("");
    return def;
}
```

Both issues only surface at Spring context startup, not at compile time.

## WebSocket Migration (if WEBSOCKET_NEEDED=true)

### Standard WebSocket

| Jakarta WebSocket | Spring WebSocket |
|---|---|
| `@ServerEndpoint("/ws")` | `WebSocketHandler` + `WebSocketConfigurer` |
| `@OnOpen` | `afterConnectionEstablished(WebSocketSession)` |
| `@OnMessage` | `handleTextMessage(WebSocketSession, TextMessage)` |
| `@OnClose` | `afterConnectionClosed(WebSocketSession, CloseStatus)` |
| `@OnError` | `handleTransportError(WebSocketSession, Throwable)` |

**Before:**
```java
@ServerEndpoint("/ws/chat")
public class ChatEndpoint {
    @OnOpen
    public void onOpen(Session session) { ... }

    @OnMessage
    public void onMessage(String message, Session session) { ... }

    @OnClose
    public void onClose(Session session) { ... }
}
```

**After:**
```java
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {
    @Override
    public void afterConnectionEstablished(WebSocketSession session) { ... }

    @Override
    protected void handleTextMessage(WebSocketSession session,
                                     TextMessage message) { ... }

    @Override
    public void afterConnectionClosed(WebSocketSession session,
                                      CloseStatus status) { ... }
}

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(new ChatWebSocketHandler(), "/ws/chat");
    }
}
```

### STOMP-Based Messaging (alternative)

For pub/sub patterns, use STOMP over WebSocket:
- Add `@EnableWebSocketMessageBroker`
- `@OnMessage` → `@MessageMapping("/chat")`
- Configure `configureMessageBroker()` with `/topic` prefix

### SSE (Server-Sent Events)

JAX-RS `SseEventSink`/`OutboundSseEvent` → Spring's `SseEmitter`:

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
    SseEmitter emitter = new SseEmitter();
    // Send events asynchronously
    executor.execute(() -> {
        emitter.send(SseEmitter.event().data("data"));
        emitter.complete();
    });
    return emitter;
}
```
