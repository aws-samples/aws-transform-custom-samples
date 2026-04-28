# Spring Batch 5 Migration Reference

## Table of Contents
1. [Chunk API Change](#chunk-api-change)
2. [@EnableBatchProcessing Must Be Omitted](#enablebatchprocessing-must-be-omitted)
3. [@StepScope for ALL Components Using jobParameters](#stepscope-for-all-components-using-jobparameters)
4. [Unique JobParameters for Scheduled Jobs](#unique-jobparameters-for-scheduled-jobs)
5. [Multi-Interface Listeners](#multi-interface-listeners)
6. [Preventing Auto-Run](#preventing-auto-run)
7. [@BatchProperty Migration](#batchproperty-migration)
8. [Job/Step Configuration Pattern](#jobstep-configuration-pattern)
9. [Testing @StepScope Beans Without spring-batch-test](#testing-stepscope-beans-without-spring-batch-test)
10. [Verification](#verification)

## Chunk API Change

Spring Batch 5 (Spring Boot 3) changed `ItemWriter.write(List<? extends T>)` to `write(Chunk<? extends T>)`. The old list-based signature causes a compile error.

**Before (Jakarta Batch / Spring Batch 4):**
```java
public class OrderWriter implements ItemWriter<Order> {
    @Override
    public void write(List<? extends Order> items) throws Exception {
        for (Order order : items) {
            repository.save(order);
        }
    }
}
```

**After (Spring Batch 5):**
```java
import org.springframework.batch.item.Chunk;

public class OrderWriter implements ItemWriter<Order> {
    @Override
    public void write(Chunk<? extends Order> chunk) throws Exception {
        for (Order order : chunk.getItems()) {
            repository.save(order);
        }
    }
}
```

Key: Use `chunk.getItems()` to access the underlying list. Import `org.springframework.batch.item.Chunk`.

## @EnableBatchProcessing Must Be Omitted

On Spring Boot 3 / Spring Batch 5, do NOT add `@EnableBatchProcessing`. This annotation disables `BatchAutoConfiguration`, breaking auto-configured `JobRepository`, `JobLauncher`, and schema initialization.

**Wrong:**
```java
@Configuration
@EnableBatchProcessing  // DO NOT USE on Spring Boot 3
public class BatchConfig { ... }
```

**Correct:**
```java
@Configuration
public class BatchConfig {
    @Bean
    public Job myJob(JobRepository jobRepository, Step step1) {
        return new JobBuilder("myJob", jobRepository)
            .start(step1)
            .build();
    }
}
```

## @StepScope for ALL Components Using jobParameters

**CRITICAL**: `@StepScope` must be applied to ANY Spring Batch component that uses `@Value("#{jobParameters['…']}")` — not just `ItemReader`. This includes `ItemWriter`, `ItemProcessor`, listeners, and tasklets.

Without `@StepScope`, the `@Value("#{jobParameters['…']}")` expression evaluates at application startup (before any job runs), resolving to `null`.

```java
@Bean
@StepScope
public ItemReader<Order> orderReader(
        @Value("#{jobParameters['inputFile']}") String inputFile) {
    return new OrderItemReader(inputFile);
}

@Bean
@StepScope  // ALSO needed here — uses jobParameters
public ItemWriter<Order> orderWriter(
        @Value("#{jobParameters['outputDir']}") String outputDir) {
    return new OrderItemWriter(outputDir);
}

@Bean
@StepScope  // ALSO needed here — uses jobParameters
public ItemProcessor<Order, Order> orderProcessor(
        @Value("#{jobParameters['filterDate']}") String filterDate) {
    return new OrderFilterProcessor(LocalDate.parse(filterDate));
}
```

**Rule of thumb**: Search for `jobParameters` in `@Value` expressions. Every `@Bean` method containing one needs `@StepScope`.

## Unique JobParameters for Scheduled Jobs

Each `JobLauncher.run()` invocation must include a unique parameter to avoid `JobInstanceAlreadyCompleteException`. This is critical for `@Scheduled` jobs that run repeatedly.

```java
@Scheduled(cron = "0 0 2 * * *")
public void runNightlyJob() {
    JobParameters params = new JobParametersBuilder()
        .addLong("run.id", System.currentTimeMillis())
        .toJobParameters();
    jobLauncher.run(nightlyJob, params);
}
```

## Multi-Interface Listeners

A class implementing both `SkipListener` and `StepExecutionListener` requires two separate `.listener()` calls with explicit casts in Spring Batch 5:

```java
@Bean
public Step step1(JobRepository jobRepository, PlatformTransactionManager txManager,
                  MyListener listener) {
    return new StepBuilder("step1", jobRepository)
        .<Input, Output>chunk(100, txManager)
        .reader(reader())
        .writer(writer())
        .listener((SkipListener<Input, Output>) listener)
        .listener((StepExecutionListener) listener)
        .build();
}
```

## Preventing Auto-Run

To prevent batch jobs from auto-running at startup, use:

```yaml
spring:
  batch:
    job:
      enabled: false
```

Do NOT use `spring.batch.job.name` with a non-existent job name — this silently suppresses all jobs without clear intent.

## @BatchProperty Migration

Jakarta Batch `@BatchProperty` → Spring `@Value` with jobParameters SpEL:

**Before:**
```java
@Inject @BatchProperty(name = "inputFile")
private String inputFile;
```

**After:**
```java
@Value("#{jobParameters['inputFile']}")
private String inputFile;
```

## Job/Step Configuration Pattern

Complete pattern for converting META-INF/batch-jobs/*.xml to Spring Batch @Configuration:

**Before (batch-jobs/import-job.xml):**
```xml
<job id="importJob">
  <step id="importStep">
    <chunk item-count="100">
      <reader ref="csvReader"/>
      <processor ref="validatingProcessor"/>
      <writer ref="dbWriter"/>
    </chunk>
  </step>
</job>
```

**After:**
```java
@Configuration
public class ImportJobConfig {
    @Bean
    public Job importJob(JobRepository jobRepository, Step importStep) {
        return new JobBuilder("importJob", jobRepository)
            .start(importStep)
            .build();
    }

    @Bean
    public Step importStep(JobRepository jobRepository,
                           PlatformTransactionManager txManager) {
        return new StepBuilder("importStep", jobRepository)
            .<InputType, OutputType>chunk(100, txManager)
            .reader(csvReader())
            .processor(validatingProcessor())
            .writer(dbWriter())
            .build();
    }
}
```

Delete META-INF/batch-jobs/ directory after conversion.

## Testing @StepScope Beans Without spring-batch-test

When testing `@StepScope` beans without `spring-batch-test` on the classpath, the StepScope is not active by default. Use `StepSynchronizationManager` to set up the step context manually:

```java
@SpringBootTest
class OrderReaderTest {

    @Autowired
    private ItemReader<Order> orderReader;

    @BeforeEach
    void setUp() {
        StepExecution stepExecution = new StepExecution("testStep",
            new JobExecution(new JobInstance(1L, "testJob"),
                new JobParametersBuilder()
                    .addString("inputFile", "test-orders.csv")
                    .toJobParameters()));
        StepSynchronizationManager.register(stepExecution);
    }

    @AfterEach
    void tearDown() {
        StepSynchronizationManager.close();
    }

    @Test
    void readsOrders() throws Exception {
        Order order = orderReader.read();
        assertNotNull(order);
    }
}
```

If `spring-batch-test` IS on the classpath, prefer `@SpringBatchTest` which auto-configures `JobLauncherTestUtils` and `StepScopeTestUtils`.

## Verification

```bash
# 1. No @EnableBatchProcessing
grep -rn '@EnableBatchProcessing' src/
# Expected: empty

# 2. No old ItemWriter.write(List) signature
grep -rn 'write(List<' src/main/java/
# Expected: empty (all should use Chunk)

# 3. No Jakarta Batch imports
grep -rn 'jakarta\.batch\.\|javax\.batch\.' src/
# Expected: empty

# 4. All @Value("#{jobParameters[…]}") beans have @StepScope
# Manual check: grep for jobParameters, verify each containing @Bean has @StepScope
grep -rn 'jobParameters' src/main/java/
# For each match, verify the enclosing @Bean method also has @StepScope

# 5. Build passes
mvn clean compile
```
