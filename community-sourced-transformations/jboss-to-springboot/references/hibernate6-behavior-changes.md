# Hibernate 6 Behavior Changes Reference

## Table of Contents
1. [@Embeddable Null Columns Return Null Object](#embeddable-null-columns-return-null-object)
2. [@Lob Multi-Dimensional Primitive Arrays](#lob-multi-dimensional-primitive-arrays)
3. [CriteriaQuery.getSelection() Returns Null](#criteriaquerygetselection-returns-null)
4. [CriteriaQuery Requires Explicit select(root)](#criteriaquery-requires-explicit-selectroot)
5. [H2 Reserved Keywords in @Embeddable Fields](#h2-reserved-keywords-in-embeddable-fields)
6. [@OneToOne Spurious UNIQUE Constraint](#onetoone-spurious-unique-constraint)
7. [PhysicalNamingStrategyStandardImpl Decision Rule](#physicalnaminingstrategystandard-decision-rule)
8. [sed Substitution Ordering for snake_case](#sed-substitution-ordering-for-snake_case)
9. [@UniqueConstraint columnNames Must Use snake_case](#uniqueconstraint-columnnames-must-use-snake_case)
10. [EAGER vs LAZY in Non-Transactional Tests](#eager-vs-lazy-in-non-transactional-tests)

## @Embeddable Null Columns Return Null Object

**Behavior change**: When all columns of an `@Embeddable` are NULL in the database, Hibernate 6 returns `null` for the embedded field. Hibernate 5 returned an empty (default-constructed) object.

This silently breaks code using the null-object pattern, where a "no value" sentinel was represented by an @Embeddable with all-null fields.

**Symptom**: `NullPointerException` when calling methods on an embedded field that was previously never null (e.g., `getNextExpectedActivity().getType()`).

**Detection**:
```bash
# Find all @Embeddable classes
grep -rn '@Embeddable' src/main/java/

# For each, check if any code accesses the embedded field without null checks
# Look for getter methods on embedded fields in entity classes
```

**Fix**: Add null-safe guards in getters that implement the null-object pattern:

**Before:**
```java
@Embedded
private HandlingActivity nextExpectedActivity;

public HandlingActivity getNextExpectedActivity() {
    return nextExpectedActivity;  // Was never null in Hibernate 5
}
```

**After:**
```java
@Embedded
private HandlingActivity nextExpectedActivity;

public HandlingActivity getNextExpectedActivity() {
    return nextExpectedActivity != null ? nextExpectedActivity : HandlingActivity.NONE;
}
```

Where `HandlingActivity.NONE` is the sentinel/null-object instance.

## @Lob Multi-Dimensional Primitive Arrays

**Behavior change**: `@Lob` on `long[][]` (or other multi-dimensional primitive arrays) causes `ClassCastException` in Hibernate 6.4.4 with H2 2.x at startup. This is extremely expensive to diagnose.

**Symptom**: `java.lang.ClassCastException` during SessionFactory initialization, referencing array type conversion.

**Detection**:
```bash
# Find @Lob annotations and check if any are on array fields
grep -rn '@Lob' src/main/java/ -A 2
# Look for field types like long[][], int[][], byte[][]
```

**Fix**: Replace `@Lob` with `@Convert` and a custom `AttributeConverter`. The `@Lob` annotation must be removed BEFORE adding `@Convert` — having both simultaneously can cause a different Hibernate error.

**Before:**
```java
@Lob
private long[][] seatMatrix;
```

**After:**
```java
@Convert(converter = Long2DArrayConverter.class)
@Column(columnDefinition = "BLOB")
private long[][] seatMatrix;
```

**Converter implementation:**
```java
@Converter
public class Long2DArrayConverter implements AttributeConverter<long[][], byte[]> {
    @Override
    public byte[] convertToDatabaseColumn(long[][] attribute) {
        if (attribute == null) return null;
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ObjectOutputStream oos = new ObjectOutputStream(baos)) {
            oos.writeObject(attribute);
            return baos.toByteArray();
        } catch (IOException e) {
            throw new RuntimeException("Failed to serialize long[][]", e);
        }
    }

    @Override
    public long[][] convertToEntityAttribute(byte[] dbData) {
        if (dbData == null) return null;
        try (ObjectInputStream ois = new ObjectInputStream(
                new ByteArrayInputStream(dbData))) {
            return (long[][]) ois.readObject();
        } catch (IOException | ClassNotFoundException e) {
            throw new RuntimeException("Failed to deserialize long[][]", e);
        }
    }
}
```

Do NOT attempt to fix this via hibernate.dialect settings or H2 version pinning — the root cause is in Hibernate 6's type system.

## CriteriaQuery.getSelection() Returns Null

**Behavior change**: In Hibernate 6, `CriteriaQuery.getSelection()` returns `null` when no explicit `.select()` has been called. Hibernate 5 returned a default selection. Passing this null to another query's `.select()` causes `IndexOutOfBoundsException`.

**Symptom**: `IndexOutOfBoundsException` or `NullPointerException` in criteria query construction code that copies selections between queries.

**Detection**:
```bash
grep -rn 'getSelection()' src/main/java/
```

**Fix**: Always call `.select(root)` explicitly on CriteriaQuery:

**Before:**
```java
CriteriaQuery<Long> countQuery = cb.createQuery(Long.class);
Root<Entity> countRoot = countQuery.from(Entity.class);
countQuery.select(cb.count(countRoot));
// Copy where clause from original query
countQuery.where(originalQuery.getRestriction());
// BUG: originalQuery.getSelection() returns null in Hibernate 6
```

**After:**
```java
CriteriaQuery<Entity> originalQuery = cb.createQuery(Entity.class);
Root<Entity> root = originalQuery.from(Entity.class);
originalQuery.select(root);  // ALWAYS set explicit selection
```

## CriteriaQuery Requires Explicit select(root)

**Behavior change**: Hibernate 6 requires `query.select(root)` to be called explicitly on every `CriteriaQuery`. Hibernate 5 inferred a default root selection.

**Symptom**: Queries return empty results or throw `IllegalArgumentException` at query execution.

**Detection**:
```bash
grep -rn 'createQuery(' src/main/java/ | grep 'CriteriaQuery'
```
For each match, verify a `.select(root)` call follows the `.from()` call.

**Fix**: Add `query.select(root)` after every `query.from(EntityClass.class)`:

```java
CriteriaQuery<Order> cq = cb.createQuery(Order.class);
Root<Order> root = cq.from(Order.class);
cq.select(root);  // REQUIRED in Hibernate 6
cq.where(cb.equal(root.get("status"), "ACTIVE"));
```

## H2 Reserved Keywords in @Embeddable Fields

**Behavior change**: H2 2.x (bundled with Spring Boot 3.x) has a stricter reserved keyword list than H2 1.x. Field names that are H2 reserved keywords cause silent DDL failures — the table is created but the column is missing or mangled.

**Common reserved keywords in Java field names**: `value`, `year`, `key`, `end`, `start`, `order`, `group`, `user`, `check`, `index`, `type`, `level`, `name`, `row`, `result`.

**Symptom**: Silent DDL failure, `JdbcSQLSyntaxErrorException` on INSERT, or column not found errors. Particularly insidious in `@Embeddable` classes where the error message may reference the parent entity.

**Detection**:
```bash
# Find potentially problematic column names
grep -rn '@Column\|@Embeddable' src/main/java/ -A 3 | grep -i 'value\|year\|key\|end\|start\|order\|group\|user\|check\|type'
```

**Fix**: Add `@Column(name = "non_reserved_name")` to escape the reserved keyword:

**Before:**
```java
@Embeddable
public class Measurement {
    private double value;  // H2 reserved keyword!
    private int year;      // H2 reserved keyword!
}
```

**After:**
```java
@Embeddable
public class Measurement {
    @Column(name = "measurement_value")
    private double value;
    @Column(name = "measurement_year")
    private int year;
}
```

## @OneToOne Spurious UNIQUE Constraint

**Behavior change**: Hibernate 6 validates `@OneToOne` FK columns more strictly, generating a UNIQUE constraint on the FK column. If the data actually allows multiple children per parent, INSERTs fail with unique constraint violations.

**Symptom**: `ConstraintViolationException` on INSERT when multiple rows share the same FK value.

**Detection**: Look for `@OneToOne` where the data model actually allows multiple children:
```bash
grep -rn '@OneToOne' src/main/java/ -A 5
```

**Fix**: If the FK allows multiple children, change `@OneToOne` to `@ManyToOne`:

**Before:**
```java
@OneToOne
@JoinColumn(name = "parent_id")
private Parent parent;
```

**After:**
```java
@ManyToOne
@JoinColumn(name = "parent_id")
private Parent parent;
```

Also update the inverse side from `@OneToOne(mappedBy=…)` to `@OneToMany(mappedBy=…)`.

## PhysicalNamingStrategyStandardImpl Decision Rule

**When to use**: Set `spring.jpa.hibernate.naming.physical-strategy=org.hibernate.boot.model.naming.PhysicalNamingStrategyStandardImpl` when:
- `data.sql` uses camelCase column names matching original WildFly/Hibernate 5 defaults
- The DB schema was created with Hibernate 5's default identity naming (camelCase = column name)

**When NOT to use**: If you are updating `data.sql` to snake_case (preferred approach), do NOT set this property — let Spring Boot's default `SpringPhysicalNamingStrategy` handle the camelCase→snake_case conversion.

**Symptom without correct strategy**: `JdbcSQLSyntaxErrorException: Column "FIRST_NAME" not found` when data.sql uses `firstName` and Spring applies snake_case.

## sed Substitution Ordering for snake_case

When converting data.sql or schema.sql from camelCase to snake_case using sed, **process longer table/column names before shorter prefix substrings**. sed applies substitutions in order — a short prefix match will corrupt a longer name.

**Wrong order** (corrupts `SectionAllocation`):
```bash
sed -i 's/Section/section/g' data.sql          # "Section" matched first
sed -i 's/SectionAllocation/section_allocation/g' data.sql  # Too late — already corrupted to "sectionAllocation"
```

**Correct order**:
```bash
sed -i 's/SectionAllocation/section_allocation/g' data.sql  # Longest first
sed -i 's/Section/section/g' data.sql                        # Shorter after
```

**General rule**: Sort substitution patterns by length (longest first). When in doubt, use word-boundary anchors or use a single pass with all patterns.

## @UniqueConstraint columnNames Must Use snake_case

When Spring Boot's default `SpringPhysicalNamingStrategy` is active (i.e., you did NOT set `PhysicalNamingStrategyStandardImpl`), the `columnNames` in `@UniqueConstraint` and `@Index` annotations must use the snake_case physical column names, not the Java field names.

**Before (worked with Hibernate 5 identity naming):**
```java
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"firstName", "lastName"}))
```

**After (Hibernate 6 + SpringPhysicalNamingStrategy):**
```java
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"first_name", "last_name"}))
```

**Symptom**: Schema validation error or constraint not created at all.

## EAGER vs LAZY in Non-Transactional Tests

**Behavior change**: `@OneToMany(fetch = FetchType.LAZY)` collections accessed outside a transaction throw `LazyInitializationException` in Hibernate 6 more aggressively than Hibernate 5, particularly in `@SpringBootTest` without `spring.jpa.open-in-view=true`.

**Symptom**: `LazyInitializationException: could not initialize proxy - no Session` in test methods.

**Context**: Ordered `@SpringBootTest` integration tests that share committed DB state across methods must omit class-level `@Transactional` (otherwise each method runs in a rolled-back transaction and subsequent methods see empty DB). But without `@Transactional`, there's no open session for lazy loading.

**Fixes** (choose based on context):

1. **Small always-loaded collections** → change `fetch = FetchType.LAZY` to `fetch = FetchType.EAGER`:
```java
@OneToMany(mappedBy = "parent", fetch = FetchType.EAGER)
private Set<Child> children;
```

2. **Large or conditionally-loaded collections** → use JOIN FETCH in JPQL:
```java
@Query("SELECT p FROM Parent p JOIN FETCH p.children WHERE p.id = :id")
Parent findByIdWithChildren(@Param("id") Long id);
```

3. **Test-only workaround** → use `@Transactional(readOnly = true)` on specific test methods (but NOT class-level if tests share committed state).
