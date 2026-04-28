# JSF Backing Bean Migration Reference

## Table of Contents
1. [Pre-Migration: Duplicate Class Name Scan](#pre-migration-duplicate-class-name-scan)
2. [@ViewScoped → @Controller + @SessionAttributes](#viewscoped--controller--sessionattributes)
3. [@FlowScoped → @Controller + @SessionScope](#flowscoped--controller--sessionscope)
4. [JSF @PostConstruct → @ModelAttribute](#jsf-postconstruct--modelattribute)
5. [PrimeFaces Component Mapping](#primefaces-component-mapping)
6. [PrimeFaces Dialogs → Standalone Pages](#primefaces-dialogs--standalone-pages)
7. [SelectItem → Record/POJO](#selectitem--recordpojo)
8. [DualListModel → Two List Fields](#duallistmodel--two-list-fields)
9. [FacesMessage.Severity → Enum](#facesmessageseverity--enum)
10. [Session-Scoped Controllers and Form Binding](#session-scoped-controllers-and-form-binding)
11. [JSF Converter → Spring Converter](#jsf-converter--spring-converter)
12. [FacesContext.isPostback() Removal](#facescontextispostback-removal)
13. [MessageProvider Dual-Constructor Backward Compatibility](#messageprovider-dual-constructor-backward-compatibility)
14. [Half-Migration Completeness Check](#half-migration-completeness-check)
15. [Thymeleaf Bean Access with SpEL](#thymeleaf-bean-access-with-spel)
16. [Thymeleaf Parameterized Fragments (Layouts)](#thymeleaf-parameterized-fragments-layouts)
17. [Thymeleaf Layout Dialect NOT Included](#thymeleaf-layout-dialect-not-included)
18. [Thymeleaf URL Preprocessing for Dynamic URLs](#thymeleaf-url-preprocessing-for-dynamic-urls)
19. [Thymeleaf Double-Encoding Avoidance](#thymeleaf-double-encoding-avoidance)
20. [CSS Files with JSF EL Expressions](#css-files-with-jsf-el-expressions)
21. [Non-Static Inner Class Jackson Serialization](#non-static-inner-class-jackson-serialization)
22. [faces-config.xml Resource Bundles](#faces-configxml-resource-bundles)
23. [Verification](#verification)

## Pre-Migration: Duplicate Class Name Scan

Before migrating JSF backing beans to Spring controllers, scan for duplicate simple class names across the project. Spring registers beans by simple class name by default — two classes with the same simple name in different packages cause `ConflictingBeanDefinitionException`.

```bash
find src/main/java -name '*.java' -exec basename {} \; | sort | uniq -d
```

If duplicates exist, plan to add explicit bean names: `@Controller("packageA.MyBean")` and `@Controller("packageB.MyBean")`.

## @ViewScoped → @Controller + @SessionAttributes

JSF `@ViewScoped` beans hold state for the duration of a view. In Spring MVC, approximate this with `@Controller` + `@SessionAttributes` and a form-backing inner class.

**Before (JSF):**
```java
@Named
@ViewScoped
public class OrderBean implements Serializable {
    private String customerName;
    private List<OrderItem> items = new ArrayList<>();

    @PostConstruct
    public void init() {
        // Load reference data
    }

    public String submit() {
        orderService.create(customerName, items);
        return "confirmation?faces-redirect=true";
    }
}
```

**After (Spring MVC):**
```java
@Controller
@SessionAttributes("orderForm")
public class OrderController {
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @ModelAttribute("orderForm")
    public OrderForm createForm() {
        return new OrderForm();
    }

    @GetMapping("/orders/new")
    public String showForm() {
        return "orders/new";
    }

    @PostMapping("/orders")
    public String submit(@ModelAttribute("orderForm") OrderForm form,
                         SessionStatus status) {
        orderService.create(form.getCustomerName(), form.getItems());
        status.setComplete();  // Clear session attribute
        return "redirect:/orders/confirmation";
    }

    public static class OrderForm implements Serializable {
        private String customerName;
        private List<OrderItem> items = new ArrayList<>();
        // getters and setters
    }
}
```

## @FlowScoped → @Controller + @SessionScope

JSF `@FlowScoped` beans span multiple pages within a flow. Use `@SessionScope` on a Spring `@Controller`:

```java
@Controller
@SessionScope
public class WizardController {
    private WizardState state = new WizardState();

    @GetMapping("/wizard/step1")
    public String step1(Model model) {
        model.addAttribute("state", state);
        return "wizard/step1";
    }

    @PostMapping("/wizard/step2")
    public String step2(@RequestParam String name) {
        state.setName(name);
        return "wizard/step2";
    }

    @PostMapping("/wizard/complete")
    public String complete() {
        service.process(state);
        state = new WizardState();  // Reset for next flow
        return "redirect:/wizard/done";
    }
}
```

## JSF @PostConstruct → @ModelAttribute

JSF backing beans commonly use `@PostConstruct` to load per-request reference data (dropdowns, lists). In Spring MVC:

- **Per-request data loading** → `@ModelAttribute` method:
```java
@ModelAttribute("countries")
public List<Country> loadCountries() {
    return countryService.findAll();
}
```

- **One-time initialization** → keep `@PostConstruct` (it works on Spring beans too).

## PrimeFaces Component Mapping

| PrimeFaces Component | HTML5/Thymeleaf Equivalent |
|---|---|
| `p:dataTable` | `<table>` with `th:each` + optional DataTables.js |
| `p:commandButton` | `<button type="submit">` or `<a>` with `th:href` |
| `p:inputText` | `<input type="text" th:field="*{name}">` |
| `p:calendar` | `<input type="date">` or flatpickr.js |
| `p:selectOneMenu` | `<select th:field="*{type}">` + `th:each` on `<option>` |
| `p:dialog` | Bootstrap modal or standalone page (see below) |
| `p:growl` / `p:messages` | `<div th:if="${message}" class="alert">` |
| `p:fileUpload` | `<input type="file">` + Spring `MultipartFile` |
| `p:chart` | Chart.js or similar JavaScript library |
| `p:autoComplete` | `<input>` + jQuery UI Autocomplete or similar |
| `p:tabView` | Bootstrap Tabs |
| `p:panel` | Bootstrap Card or `<div>` with CSS |

## PrimeFaces Dialogs → Standalone Pages

PrimeFaces `p:dialog` with `RequestContext.closeDialog()` → standalone form page with redirect:

```java
// After (Spring MVC)
@PostMapping("/items/save")
public String save(@ModelAttribute ItemForm form) {
    service.save(form.toEntity());
    return "redirect:/items";
}
```

## SelectItem → Record/POJO

JSF `javax.faces.model.SelectItem` for dropdowns → Java record or simple POJO:

```java
// Before: javax.faces.model.SelectItem
// After:
public record SelectOption(String value, String label) {}
```

In Thymeleaf:
```html
<select th:field="*{country}">
    <option th:each="opt : ${countries}"
            th:value="${opt.value}"
            th:text="${opt.label}">
    </option>
</select>
```

**When migrating `List<SelectItem>`** parameters or return types, replace with `List<SelectOption>` and update all callers. If `SelectItem` was subclassed, convert the subclass to a record with additional fields.

## DualListModel → Two List Fields

PrimeFaces `DualListModel<T>` (used in `p:pickList`) has no Spring equivalent. Replace with two separate `List<T>` fields:

**Before (JSF):**
```java
private DualListModel<City> cities;

@PostConstruct
public void init() {
    List<City> source = cityService.findAll();
    List<City> target = new ArrayList<>();
    cities = new DualListModel<>(source, target);
}
```

**After (Spring MVC):**
```java
// In form object
private List<Long> selectedCityIds = new ArrayList<>();

// In controller
@GetMapping("/cities/pick")
public String showPicker(Model model) {
    model.addAttribute("allCities", cityService.findAll());
    return "cities/picker";
}

@PostMapping("/cities/pick")
public String savePicks(@RequestParam("selectedCityIds") List<Long> ids) {
    cityService.assignCities(ids);
    return "redirect:/cities";
}
```

In Thymeleaf, use a multi-select `<select multiple>` or a JavaScript-driven dual-list component.

## FacesMessage.Severity → Enum

JSF `FacesMessage.Severity` constants (`SEVERITY_INFO`, `SEVERITY_WARN`, `SEVERITY_ERROR`) → Spring MVC flash attributes or a custom enum:

**Before (JSF):**
```java
FacesContext.getCurrentInstance().addMessage(null,
    new FacesMessage(FacesMessage.SEVERITY_ERROR, "Save failed", detail));
```

**After (Spring MVC):**
```java
public enum FlashSeverity { INFO, WARN, ERROR }

@PostMapping("/save")
public String save(RedirectAttributes redirectAttrs) {
    try {
        service.save(entity);
        redirectAttrs.addFlashAttribute("severity", FlashSeverity.INFO);
        redirectAttrs.addFlashAttribute("message", "Saved successfully");
    } catch (Exception e) {
        redirectAttrs.addFlashAttribute("severity", FlashSeverity.ERROR);
        redirectAttrs.addFlashAttribute("message", "Save failed: " + e.getMessage());
    }
    return "redirect:/items";
}
```

In Thymeleaf:
```html
<div th:if="${message}" th:classappend="${severity == 'ERROR' ? 'alert-danger' : 'alert-success'}"
     class="alert" th:text="${message}">
</div>
```

## Session-Scoped Controllers and Form Binding

Session-scoped `@Controller` beans do NOT auto-populate from form submissions. Handler methods must explicitly declare `@RequestParam` or `@ModelAttribute` to receive form data.

## JSF Converter → Spring Converter

JSF `Converter<T>` (`jakarta.faces.convert`) and Spring `Converter<S,T>` (`org.springframework.core.convert.converter`) share the same short class name but have entirely different interfaces.

**Before (JSF):**
```java
import jakarta.faces.convert.Converter;
import jakarta.faces.convert.FacesConverter;
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;

@FacesConverter(forClass = Pet.class)
public class PetConverter implements Converter<Pet> {
    @Override
    public Pet getAsObject(FacesContext ctx, UIComponent comp, String value) {
        return petService.findById(Long.parseLong(value));
    }

    @Override
    public String getAsString(FacesContext ctx, UIComponent comp, Pet pet) {
        return String.valueOf(pet.getId());
    }
}
```

**After (Spring):**
```java
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

@Component
public class StringToPetConverter implements Converter<String, Pet> {
    private final PetService petService;

    public StringToPetConverter(PetService petService) {
        this.petService = petService;
    }

    @Override
    public Pet convert(String source) {
        return petService.findById(Long.parseLong(source));
    }
}
```

Key differences:
- JSF: single interface `Converter<T>` with two methods (`getAsObject`, `getAsString`).
- Spring: one-way `Converter<S, T>` with a single `convert(S)` method. Register for form binding via `WebMvcConfigurer.addFormatters()` or `@Component`.
- If both directions are needed (e.g., for `@PathVariable` binding AND display), create two `Converter` beans or implement `Formatter<T>` (which has both `parse` and `print`).

## FacesContext.isPostback() Removal

`FacesContext.getCurrentInstance().isPostback()` has no Spring MVC equivalent. In Spring MVC, GET and POST are separate handler methods:

```java
// After: Simply load data in the GET handler
@GetMapping("/orders")
public String list(Model model) {
    model.addAttribute("orders", loadData());
    return "orders/list";
}
```

Remove all `FacesContext` references — they compile-fail without the JSF API.

## MessageProvider Dual-Constructor Backward Compatibility

When a JSF backing bean has a `MessageProvider` or `ResourceBundleHelper` injected via CDI and also has a no-arg constructor for JSF, maintain backward compatibility during migration:

**Before (JSF):**
```java
@Named @RequestScoped
public class FormBean {
    @Inject private MessageProvider messages;

    public FormBean() {} // JSF requires no-arg

    public String getLabel(String key) {
        return messages.get(key);
    }
}
```

**After (Spring MVC):**
```java
@Controller @RequestScope
public class FormController {
    private final MessageSource messages;

    public FormController(MessageSource messages) {
        this.messages = messages;
    }

    @ModelAttribute("label")
    public Function<String, String> labelResolver(Locale locale) {
        return key -> messages.getMessage(key, null, locale);
    }
}
```

**Key**: Spring's `MessageSource` replaces JSF's custom `MessageProvider`. If the `MessageProvider` had additional features (parameter substitution, default values), replicate them using `MessageSource.getMessage(key, args, defaultMessage, locale)`.

## Half-Migration Completeness Check

A JSF backing bean migration is **complete ONLY when BOTH** conditions are met:
1. CDI/EJB annotations replaced with Spring equivalents (`@Controller`, `@Service`, etc.)
2. Spring MVC routing annotations (`@RequestMapping`, `@GetMapping`, `@PostMapping`) with Thymeleaf view returns added

**Incomplete migration symptom**: `@Controller @SessionScope` with JSF navigation strings (e.g., `return "orderList?faces-redirect=true"`) and NO `@RequestMapping` → produces 404 on all URLs.

**Detection**:
```bash
# Find controllers without any @RequestMapping/@GetMapping/@PostMapping
grep -rn '@Controller' src/main/java/ -l | while read f; do
    grep -q '@\(Request\|Get\|Post\|Put\|Delete\)Mapping' "$f" || echo "INCOMPLETE: $f"
done
```

**Fix**: Every `@Controller` must have at least one `@RequestMapping` or `@GetMapping`/`@PostMapping` method. JSF navigation strings must be replaced with Thymeleaf template paths (e.g., `return "orders/list"`) and redirect strings (e.g., `return "redirect:/orders"`).

## Thymeleaf Bean Access with SpEL

Access Spring beans in Thymeleaf templates using `@beanName` syntax with SpEL null-safe navigation:
```html
<span th:text="${@configService.getSetting('siteName')}">Site</span>
<span th:text="${@userService.getCurrentUser()?.getName()}">User</span>
```

## Thymeleaf Parameterized Fragments (Layouts)

JSF `ui:composition` / `ui:define` layout pattern → Thymeleaf parameterized fragments:

**Layout (templates/layouts/admin.html):**
```html
<html th:fragment="layout(content)">
<body>
    <nav><!-- shared nav --></nav>
    <div th:replace="${content}">Placeholder</div>
</body>
</html>
```

**Page (templates/orders/list.html):**
```html
<html th:replace="~{layouts/admin :: layout(~{::main})}">
<body>
    <main>
        <h1>Orders</h1>
    </main>
</body>
</html>
```

## Thymeleaf Layout Dialect NOT Included

`spring-boot-starter-thymeleaf` does NOT include the Thymeleaf Layout Dialect. Do NOT use `layout:decorate` or `layout:fragment` — use built-in parameterized fragments (shown above).

## Thymeleaf URL Preprocessing for Dynamic URLs

When the URL base path comes from a variable, use preprocessing `__${...}__` inside `@{...}`:
```html
<a th:href="@{__${baseUrl}__(page=${pageNum})}">Next</a>
```

## Thymeleaf Double-Encoding Avoidance

`@{...}` applies URL encoding. For pre-encoded values, bypass it:
```html
<a th:href="${#request.getContextPath() + preEncodedUrl}">Link</a>
```

## CSS Files with JSF EL Expressions

Replace JSF EL resource references with relative paths:
```css
/* Before: background-image: url("#{resource['images:bg.png']}"); */
/* After: */ background-image: url("../images/bg.png");
```

## Non-Static Inner Class Jackson Serialization

Non-static inner classes used as DTOs cause `StackOverflowError` during Jackson serialization. Fix: change to `static` nested class.

## faces-config.xml Resource Bundles

If `faces-config.xml` defines `<resource-bundle>` with a `<base-name>`, move property files to classpath root or configure `spring.messages.basename=com.example.i18n.Messages` in application.yml. For non-root paths, the `spring.messages.basename` property is REQUIRED.

## Verification

```bash
# 1. No remaining JSF imports
grep -rn 'javax\.faces\.\|jakarta\.faces\.' src/main/java/

# 2. No remaining .xhtml files
find src/ -name '*.xhtml'

# 3. No faces-config.xml
find src/ -name 'faces-config.xml'

# 4. No FacesContext references
grep -rn 'FacesContext' src/main/java/

# 5. Check for duplicate simple class names
find src/main/java -name '*.java' -exec basename {} \; | sort | uniq -d

# 6. Half-migration check: controllers without routing
grep -rn '@Controller' src/main/java/ -l | while read f; do
    grep -q '@\(Request\|Get\|Post\|Put\|Delete\)Mapping' "$f" || echo "INCOMPLETE: $f"
done

# 7. All templates compile
mvn clean compile
```
