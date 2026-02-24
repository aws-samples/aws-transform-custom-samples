# Task: Java Application Modernization with Java Version Upgrade and Dependency Updates

## Objective
Modernize Java applications by upgrading to a newer Java version and updating dependencies to their compatible versions, enhancing security, performance, and maintainability while ensuring the application remains buildable at each step.

## Summary
This transformation follows a constraint-based approach organized into logical groups. Each group must be completed successfully before proceeding to the next group. The focus is on maintaining buildable states and proper dependency sequencing rather than prescriptive step-by-step instructions.

## Entry Criteria
- Project builds successfully with current Java version (build command must pass)
- Maven or Gradle build system present with accessible configuration files
- Maven version compatibility verified (Maven 3.6.0+ required for Java 17+, Maven 3.9.0+ required for compiler plugin 3.13+)
- Complete inventory of dependencies with their versions is available (pom.xml, build.gradle, etc.)
- Application's test suite or validation methods are accessible to verify successful migration
- Source code is accessible and in a version control system to track changes and allow rollback if needed
- Development environment can support both current and target Java versions during transition period
- Sufficient permissions to update dependencies and modify configuration files are in place

## Pre-flight Validation
Before starting transformation, verify:
- Maven version compatibility (`mvn --version` check)
- Build baseline establishment
- Required tool versions available

## Implementation Approach

### Transformation Groups (Complete each group before next)
**Principle**: Consolidate related dependencies into atomic operations while preserving critical sequencing

**Approach**: Generate only the transformation steps needed based on what's actually present in the codebase

### Group 1: Build System Readiness
**Goal**: Prepare build system for newer Java version compatibility

**Consolidation Strategy**: Separate changes only for different failure modes

**Requirements**: Make atomic changes to satisfy ALL of the following:
1. Establish build baseline (run build command with source Java version)
2. Update build tools atomically (Gradle wrapper + compiler plugin + Lombok to versions specified in Mandatory Dependency Versions)
3. Update Java version in all POMs/build files + verify compilation

**Success Criteria**: Must build successfully with the newer Java version

### Group 2: Jakarta EE Migration
**Goal**: Complete javax → jakarta namespace migration as single atomic operation

**Consolidation Strategy**: ALL Jakarta changes in one coordinated operation

**Requirements**: Make atomic changes to satisfy ALL of the following:
1. Complete Jakarta Migration Atomically
  - Update ALL Jakarta dependencies together (validation, servlet, persistence, annotation, mail, activation, xml.bind, xml.ws, jws) to versions specified in Mandatory Dependency Versions
  - Update ALL import statements together across entire codebase
  - Update web.xml and persistence.xml schemas to Jakarta namespaces
2. Verify Jakarta migration completeness and fix edge cases (if needed)

**Success Criteria**: No javax.* imports remain (except javax.xml, javax.swing), project builds successfully

### Group 3: Database & ORM Modernization
**Goal**: Update database ecosystem as coordinated group

**Consolidation Strategy**: All database-related dependencies together

**Requirements**: Make atomic changes to satisfy ALL of the following:
- Database Ecosystem Update
  - Database drivers: MySQL, PostgreSQL, H2 (update to compatible versions)
  - ORM frameworks: Hibernate, MyBatis-Plus (update to compatible versions)
  - Connection pooling: Druid, HikariCP (update to latest compatible versions)
  - Update JPA repository methods (getOne() to getReferenceById())
  - Update pagination libraries: PageHelper (update to compatible version)

**Success Criteria**: Database connectivity verified, ORM operations work

### Group 4: Core Dependencies
**Goal**: Update foundational libraries as coordinated groups

**Consolidation Strategy**: Group by dependency relationships

**Requirements**: Make atomic changes to satisfy ALL of the following:
1. Apache Commons & Utility Libraries
  - Apache Commons: commons-lang3, commons-io, commons-collections4, commons-fileupload (update to compatible versions)
  - Utility libraries: Netty, Freemarker, Jedis (update to compatible versions)
  - HTTP libraries: HttpClient, OkHttp (update to compatible versions)
2. Serialization & Processing Libraries
  - Jackson (update to version specified in Mandatory Dependency Versions), FastJSON, Gson (update to compatible versions)
  - XML processing: Xerces, Saxon, XMLBeans (update to compatible versions)
  - Workflow engines: Flowable (update to compatible version)

**Success Criteria**: Core functionality remains stable, project builds successfully

### Group 5: Spring Ecosystem Modernization
**Goal**: Modernize Spring framework as coordinated unit

**Consolidation Strategy**: Maintain critical sequencing within consolidated operations

**Requirements**: Make atomic changes to satisfy ALL of the following:
1. Spring Security Configuration Update (if present)
  - Update Spring Security configuration for newer version API changes BEFORE Spring Boot upgrade
  - Update authentication/authorization patterns
2. Complete Spring Ecosystem Update
  - Update Spring Boot (to version specified in Mandatory Dependency Versions) + all Spring dependencies
  - Migrate Swagger to SpringDoc OpenAPI (update to compatible version)
  - Update application.properties/yml for Spring Boot compatibility
  - Update caching frameworks: Ehcache (update to compatible version if present)

**Success Criteria**: Spring Boot application starts and functions correctly

### Group 6: Final Integration & Testing
**Goal**: Ensure complete system integration and compatibility

**Requirements**: Make atomic changes to satisfy ALL of the following:
1. Newer Java Version Language Compatibility & Plugin Updates
  - Fix remaining target Java version language compatibility issues
  - Update build system plugins to target Java version compatible versions
  - Address deprecated API usage
2. Complete Integration Verification
  - Run complete test suite
  - Verify end-to-end functionality
  - Document changes in validation summary

**Success Criteria**: Full application functionality verified

## Critical Sequencing Constraints

### MUST Complete Before Next Group:
- Group 1: Build tools updated, newer Java version compilation successful
- Group 2: All Jakarta migrations complete, no javax.* imports remain
- Group 3: Database connectivity verified
- Group 4: Core libraries functional, no dependency conflicts
- Group 5: Spring Boot application starts successfully
- Group 6: Full functionality verified

### MUST Group Together (Atomic Operations):
- Jakarta dependencies + import statements (single coordinated change)
- Database drivers + ORM + utilities (database ecosystem together)
- Spring Security config + Spring Boot upgrade (Spring ecosystem together)

### MUST Sequence Correctly:
- Build tools → Java version changes
- Lombok compatibility → Java version changes
- Jakarta migration complete → Spring Boot upgrade
- Spring Security configuration → Spring Boot upgrade

## Mandatory Dependency Versions
- Gradle wrapper: 8.11+
- Maven compiler plugin: 3.0.5 (compatible with older Maven versions) OR check Maven version first and use 3.13.0+ only if Maven 3.9.0+
- Lombok: 1.18.36+
- Jackson: 2.15.2 (LTS)
- Spring Boot: 3.2.12 (LTS)
- Jakarta validation-api: 3.0.2
- Jakarta servlet-api: 6.0.0
- Jakarta persistence-api: 3.1.0
- Jakarta annotation-api: 2.1.1

## Runtime Environment Management

### Java Runtime Switching
Use appropriate Java version based on transformation stage:

```bash
# For baseline establishment - use source Java version
# Example: mvn clean install (using system default or source-appropriate Java)
<build_command_with_source_java>

# For target Java version validation - use target Java version
# Example: JAVA_HOME=/path/to/target/java mvn clean install  
<build_command_with_target_java>
```

Where build commands should use the Java version appropriate for the current transformation stage.

## Group Completion Validation

### Required Validation After Each Group
Each group MUST end with:
- Successful build: build command passes without errors
- Basic functionality test: Application starts without errors (where applicable)
- Dependency verification: No conflicting or missing dependencies

### Failure Recovery
If any group validation fails:
1. Revert to previous group completion state
2. Identify and fix the specific issue
3. Re-attempt the failed group
4. Document the issue and resolution

## SEG Implementation Guidance

### Transformation Plan Generation Rules
- **Adaptive Length**: Generate only the transformation operations needed based on codebase analysis
- **Consolidation Priority**: Group related dependencies into atomic operations
- **Atomic Operation Definition**: Dependencies that must change together to maintain buildability OR serve the same functional purpose
- **Complexity Guidelines**: 
  - Simple applications (Java version upgrade only, minimal dependencies): 6-10 operations
  - Medium applications (Jakarta migration, database drivers, utility libraries): 10-15 operations  
  - Complex applications (Spring Boot ecosystem, multiple frameworks, enterprise features): 15-25 operations

### Functional Grouping Examples
When generating transformation plans, group dependencies by these functional categories:

**Example 1: Serialization Libraries Operation**
```
Title: "Update Serialization Libraries"
Components: Jackson + Gson + XStream + Protobuf (update to compatible versions)
Rationale: Data serialization libraries often interact and should be tested together
```

**Example 2: Core Utility Libraries Operation**  
```
Title: "Update Core Utility Libraries"
Components: Apache Commons (lang3, io, codec, collections4) + Guava + Netty (update to compatible versions)
Rationale: Foundational utilities with minimal interdependencies
```

### Consolidation Priority Guidelines

#### Jakarta Migration (MUST consolidate - Priority 1)
- **Anti-pattern**: Separate operations for each Jakarta dependency (servlet, persistence, mail, etc.)
- **Correct pattern**: Single atomic operation updating ALL Jakarta dependencies + imports + schemas together
- **Rationale**: Partial Jakarta migration breaks buildability

#### Functional Library Groups (SHOULD consolidate - Priority 2)
**Serialization Libraries** (consolidate together):
- Jackson, Gson, XStream, Protobuf - these often interact in data processing pipelines

**Core Utility Libraries** (consolidate together):
- Apache Commons (lang3, io, codec, collections4), Guava, Netty - foundational utilities

**Database Ecosystem** (consolidate together):  
- Database drivers + ORM frameworks + connection pooling + pagination libraries
- **Example**: MySQL driver + Hibernate + HikariCP + PageHelper in one operation
- **Rationale**: Database components are typically tested together

#### Build System Components (DO NOT consolidate - Priority 3)
- **Keep separate**: Build wrapper, compiler plugin, Java version changes
- **Rationale**: Different failure modes require individual validation

### Required Elements SEG Must Include
- Baseline establishment operation (run build command and capture baseline)
- Gradle wrapper update operation (if applicable)
- Lombok update before Java version changes
- Jakarta migration as coordinated operation (not fragmented)
- Database-related dependencies grouped together
- Spring Security configuration before Spring Boot upgrade

### Version Requirements SEG Must Use
- Use exact versions specified in Mandatory Dependency Versions section
- Prioritize LTS versions where available
- Ensure compatibility between related dependencies

## Constraints and Guardrails
1. Keep all tests enabled and resolve failures through proper code fixes
2. Upgrade Java version consistently across all modules
3. Maintain or upgrade dependency versions from source baseline
4. Focus modifications exclusively on target Java version compatibility requirements
5. Setup appropriate environment and install all necessary dependencies for validation
6. Upgrade APIs only when required for version compatibility
7. Preserve existing import structure and maintain consistent API usage patterns
8. Preserve all existing comments
9. If any temporary debugging code is introduced during the transformation, remove it at the end
10. Preserve original licensing information without any modifications, additions, or deletions
11. **CRITICAL**: Baseline establishment (Group 1, Step 1) must use source Java version, not target Java version

## Validation / Exit Criteria

- Build command completes without errors with the target Java version
- All tests pass with same or better success rate than baseline
- No javax.* imports remain (except javax.xml, javax.swing)
- All mandatory dependency versions are updated as specified
- Any incompatible updates that were skipped are documented with reasons

