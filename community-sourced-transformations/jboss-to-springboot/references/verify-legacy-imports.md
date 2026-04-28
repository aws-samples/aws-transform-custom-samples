# Verify Legacy Imports Procedure

## Purpose

Checks for leftover legacy `javax.*` and `org.hibernate.validator` references in both import statements and inline fully-qualified class names (FQCNs). Also verifies no tests were improperly @Disabled, MIGRATION comments follow naming rules, and no mixed servlet API exists. Provides copy-paste-ready grep commands with corrected filter pipelines.

## When to Run

After all migration work (post-migration) — this is the final verification before declaring the migration complete. Corresponds to Step 17 in the workflow.

## Preconditions

- All Phase 1–5 migration steps have been completed.
- Code compiles successfully (`mvn clean compile` passes).

## Procedure

**IMPORTANT**: Run each grep command INDEPENDENTLY. Never chain with `&&` — grep returns exit code 1 on zero matches, which silently skips subsequent commands in a chain.

### Step 0: PRE-GREP PROTOCOL — Delete .bak files

**ALWAYS** run this before ANY grep verification scan — both mid-task and at Steps 16/17. .bak files contain stale pre-migration content that causes false-positive legacy-import and MIGRATION comment grep failures.

```bash
find . -name "*.bak" -not -path "*/target/*" -delete
```

**Verification**: `find . -name "*.bak" -not -path "*/target/*"` — must return empty.

**Why this matters**: Debugger tools, multi-worker tasks, and editor auto-saves create .bak files at any point during migration. These files contain pre-migration code with `javax.*` imports that grep will match, producing false positives that waste investigation time.

### Step 1: Scan for legacy import statements

```bash
grep -rn 'import javax\.ws\.rs\.\|import javax\.ejb\.\|import javax\.persistence\.\|import javax\.servlet\.\|import javax\.inject\.\|import javax\.enterprise\.\|import javax\.faces\.\|import javax\.xml\.bind\.\|import javax\.xml\.ws\.\|import org\.hibernate\.validator\.constraints\.\|import org\.codehaus\.jackson\.' src/ \
  | grep -v ':[[:space:]]*//' \
  | grep -v ':[[:space:]]*/\*' \
  | grep -v '^[^:]*:[0-9]*:[[:space:]]*\*' \
  | grep -v 'MIGRATION' \
  || true
```

**Expected output**: Empty (no matches).

**Filter explanation**:
- `grep -v ':[[:space:]]*//'` — excludes line comments (handles `filename:linenum:` prefix from `grep -rn`).
- `grep -v ':[[:space:]]*/\*'` — excludes block comment starts.
- `grep -v '^[^:]*:[0-9]*:[[:space:]]*\*'` — excludes Javadoc continuation lines.
- `grep -v 'MIGRATION'` — excludes MIGRATION comments (validated separately in Step 8).

### Step 2: Scan for inline FQCNs (beyond import lines)

```bash
grep -rn 'javax\.' src/main/java/ \
  | grep -v 'import ' \
  | grep -v ':[[:space:]]*//' \
  | grep -v ':[[:space:]]*/\*' \
  | grep -v '^[^:]*:[0-9]*:[[:space:]]*\*' \
  | grep -v 'MIGRATION' \
  || true
```

**Expected output**: Empty.

Common inline FQCN locations: catch blocks, instanceof, return types, annotation string values, DTO utility classes.

### Step 3: Scan test code separately

```bash
grep -rn 'javax\.' src/test/java/ \
  | grep -v 'import ' \
  | grep -v ':[[:space:]]*//' \
  | grep -v ':[[:space:]]*/\*' \
  | grep -v '^[^:]*:[0-9]*:[[:space:]]*\*' \
  | grep -v 'MIGRATION' \
  || true
```

**Expected output**: Empty. Test code also needs inline FQCN updates.

### Step 4: Scan for legacy annotations

```bash
grep -rn '@Stateless\|@Stateful\|@MessageDriven\|@EJB\b\|@TransactionAttribute\|@WebService\b' src/main/java/ \
  | grep -v ':[[:space:]]*//' \
  | grep -v ':[[:space:]]*/\*' \
  | grep -v '^[^:]*:[0-9]*:[[:space:]]*\*' \
  | grep -v 'MIGRATION' \
  || true
```

**Expected output**: Empty.

Also check for `@Path` (JAX-RS, not filesystem):
```bash
grep -rn 'javax\.ws\.rs\.Path\|import javax\.ws\.rs' src/main/java/ \
  | grep -v ':[[:space:]]*//' \
  | grep -v '^[^:]*:[0-9]*:[[:space:]]*\*' \
  || true
```

### Step 5: Check constructor injection compliance

```bash
grep -rn '@Autowired' src/main/java/ | grep -E '(private|protected|public) ' || true
```

**Expected output**: Empty. `@PersistenceContext` on EntityManager fields is acceptable.

### Step 6: Dependency tree scan

```bash
mvn dependency:tree | grep -i 'jboss\|wildfly\|jersey\|javax\.ws\.rs\|javax\.inject' || true
```

**Expected output**: Only `org.jboss.logging:jboss-logging` is acceptable.

### Step 7: Test integrity — @Disabled check

```bash
grep -rn '@Disabled' src/test/java/ || true
```

**Expected output**: Empty or only pre-existing @Disabled.

```bash
git diff HEAD~1 -- '*.java' | grep '^+.*@Disabled' || true
```

### Step 8: MIGRATION comment naming rule

MIGRATION comments must NOT contain ANY `@AnnotationName` token — this includes both EJB/CDI annotations AND Spring annotations. The rule applies to ALL file types: Java, test, Thymeleaf, Javadoc.

**Scan multi-line comment blocks**: the `@AnnotationName` token may be on a different line within a `/* … */` block or Javadoc comment. The grep below catches the most common pattern (annotation on same line as MIGRATION):

```bash
grep -rn 'MIGRATION.*@[A-Z]' src/ \
  | grep -v ':[[:space:]]*/\*' \
  | grep -v '^[^:]*:[0-9]*:[[:space:]]*\*' \
  || true
```

**Expected output**: Empty.

**Examples — both EJB/CDI and Spring annotations are banned**:

| ❌ Wrong | ✅ Correct |
|---|---|
| `// MIGRATION: Removed @ApplicationException` | `// MIGRATION: Replaced EJB application exception with Spring ResponseStatus` |
| `// MIGRATION: @Autowired removed` | `// MIGRATION: Replaced field injection with constructor injection` |
| `// MIGRATION: @Stateless converted to @Service` | `// MIGRATION: Converted stateless session bean to Spring service` |
| `// MIGRATION: @EJB replaced with DI` | `// MIGRATION: Replaced EJB injection with constructor injection` |
| `// MIGRATION: Replaced @Schedule` | `// MIGRATION: Converted EJB timer to Spring scheduled task` |
| `// MIGRATION: Removed @WebFilter` | `// MIGRATION: Converted servlet filter to Spring OncePerRequestFilter` |
| `// MIGRATION: @Scheduled replaces timer` | `// MIGRATION: Converted EJB timer to Spring scheduled task` |
| `// MIGRATION: @Ignore removed` | `// MIGRATION: Re-enabled test after removing Arquillian dependency` |
| `// MIGRATION: Changed @Produces` | `// MIGRATION: Converted CDI producer to Spring bean factory` |
| `// MIGRATION: @InjectMocks added` | `// MIGRATION: Added Mockito injection for unit test` |
| `// MIGRATION: @EnableBatchProcessing removed` | `// MIGRATION: Removed batch annotation that disables auto-config` |
| `// MIGRATION: @Async added` | `// MIGRATION: Made event listener asynchronous` |

**Per-task self-check**: Workers SHOULD run this command proactively during Steps 6–12 after writing any MIGRATION comment:
```bash
find . -name "*.bak" -not -path "*/target/*" -delete
grep -rn "MIGRATION.*@[A-Z]" <files modified by this task>
```
Must return empty. Fix immediately if not.

### Step 9: Mixed servlet API detection

```bash
JAVAX_COUNT=$(grep -rn 'import javax\.servlet' src/ | wc -l)
JAKARTA_COUNT=$(grep -rn 'import jakarta\.servlet' src/ | wc -l)
if [ "$JAVAX_COUNT" -gt 0 ] && [ "$JAKARTA_COUNT" -gt 0 ]; then
    echo "⚠ MIXED SERVLET API: $JAVAX_COUNT javax.servlet + $JAKARTA_COUNT jakarta.servlet"
    echo "Resolve all to jakarta.servlet before proceeding"
fi
```

**Expected output**: No warning. All servlet imports should be `jakarta.servlet.*` after migration.

## Verification

Re-run Steps 0–9. All scans return empty results (except the jboss-logging exception in Step 6). If any scan returns matches, the migration is not complete.

## Idempotence

Running this procedure multiple times has no effect — it only reads files (and deletes .bak files, which is itself idempotent), never modifies source code.
