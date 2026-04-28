# Worked Examples: Conditional Phase Patterns

These examples cover migration patterns for conditional phases (JMS, Security) that only apply when the corresponding feature flags are detected.

## Table of Contents
1. [Example 3: @MessageDriven MDB → Spring @JmsListener](#example-3-messagedriven-mdb--spring-jmslistener)
2. [Example 4: JBoss Security → Spring Security](#example-4-jboss-security--spring-security)

## Example 3: @MessageDriven MDB → Spring @JmsListener

**Before (JBoss):**
```java
import javax.ejb.MessageDriven;
import javax.ejb.ActivationConfigProperty;
import javax.jms.Message;
import javax.jms.MessageListener;
import javax.jms.TextMessage;

@MessageDriven(activationConfig = {
    @ActivationConfigProperty(propertyName = "destinationType",
                              propertyValue = "javax.jms.Queue"),
    @ActivationConfigProperty(propertyName = "destination",
                              propertyValue = "java:/jms/queue/OrderQueue")
})
public class OrderMessageHandler implements MessageListener {
    public void onMessage(Message message) {
        TextMessage textMessage = (TextMessage) message;
        // process order
    }
}
```

**After (Spring Boot):**
```java
import org.springframework.jms.annotation.JmsListener;
import org.springframework.stereotype.Component;

@Component
public class OrderMessageHandler {

    @JmsListener(destination = "OrderQueue")
    public void onMessage(String message) {
        // process order
    }
}
```

Key points:
- Strip JNDI prefix (`java:/jms/queue/`) from destination name.
- Spring Boot auto-converts JMS TextMessage to String when parameter type is String.
- For durable topic subscriptions, create a `JmsListenerContainerFactory` bean.
- Configure `spring.artemis.mode=embedded` for embedded broker or `spring.artemis.mode=native` + `broker-url` for external.

## Example 4: JBoss Security → Spring Security

**Before (web.xml):**
```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>admin</role-name>
    </auth-constraint>
</security-constraint>
<login-config>
    <auth-method>FORM</auth-method>
    <form-login-config>
        <form-login-page>/login.html</form-login-page>
        <form-error-page>/error.html</form-error-page>
    </form-login-config>
</login-config>
```

**After (Spring Boot):**
```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/admin/**").hasRole("admin")
                .anyRequest().permitAll()
            )
            .formLogin(form -> form
                .loginPage("/login.html")
                .failureUrl("/error.html")
            );
        return http.build();
    }
}
```

Key points:
- `url-pattern="/admin/*"` → `requestMatchers("/admin/**")` (note: `**` for Spring, `*` for servlet).
- Use `@EnableMethodSecurity` if converting `@RolesAllowed` → `@PreAuthorize`.
- For BASIC auth: replace `formLogin()` with `httpBasic()`.
- `SessionContext.getCallerPrincipal()` → `SecurityContextHolder.getContext().getAuthentication()`.
- Only add spring-boot-starter-security when SECURITY_NEEDED=true.
