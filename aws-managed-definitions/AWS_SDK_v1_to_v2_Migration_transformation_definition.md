## Name
AWS SDK v1 to v2 Migration

## Objective
Convert Java/Kotlin applications that use AWS SDK v1 to use AWS SDK v2, ensuring all modules in multi-module projects are properly migrated to leverage AWS SDK v2's improved performance, non-blocking I/O, and reduced memory usage.

## Summary
This transformation migrates Java/Kotlin code from AWS SDK v1 to AWS SDK v2 by identifying all modules containing AWS SDK dependencies, updating build files across all modules, modifying imports, and converting client initialization patterns, API calls, and exception handling to match AWS SDK v2 patterns. The process includes comprehensive module discovery, systematic dependency updates, codebase modifications following consistent patterns, and thorough validation of each module to ensure complete migration.

## Entry Criteria
- The project contains Java/Kotlin code that uses AWS SDK v1 libraries (identified by imports from the `com.amazonaws` package).
- All modules in the project can be identified and analyzed for AWS SDK v1 dependencies.
- A complete inventory of all AWS services used in the project can be created.
- The project's build system (Maven, Gradle, etc.) is identifiable and accessible.
- The project can be successfully built in its current state with AWS SDK v1.

## Implementation Steps
- Update Dependencies: Replace v1 dependencies with v2 in all build files
- Update Imports: Change package imports from `com.amazonaws.*` to `software.amazon.awssdk.*`
- Client Creation: Use the builder pattern consistently
- Request/Response Objects: Use builder pattern for all requests
- Exception Handling: Update to use unchecked exceptions
- Pagination: Use paginators for better handling of paginated results
- Resource Cleanup: Use try-with-resources as v2 clients implement AutoCloseable
- Async Operations: Update to use CompletableFuture instead of callbacks

## Constraints and Guardrails
Strictly follow these rules at all times:
- Keep all tests enabled
- Ensure all plugins remain enabled
- Keep the original JDK version of the application the same
- Preserve all existing license information in its original form

## Validation / Exit Criteria
- All identified modules with AWS SDK v1 dependencies have been migrated to use AWS SDK v2.
- All references to `com.amazonaws` packages have been updated to `software.amazon.awssdk` packages.
- All build files in all modules have been updated to use AWS SDK v2 dependencies.
- The entire project successfully builds with the updated dependencies.
- Each migrated module compiles and functions correctly individually.