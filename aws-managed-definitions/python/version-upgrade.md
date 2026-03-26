Migrate Python applications from older versions (3.8 or 3.9) to newer versions (3.11, 3.12, or 3.13) while ensuring compatibility with critical dependencies and maintaining application functionality and performance.

## Summary

This transformation involves analyzing the Python codebase for version-specific features, identifying compatibility issues with dependencies, updating syntax to leverage new language features, and ensuring that deprecated functionalities are properly replaced. The process includes code scanning, dependency analysis, syntax modernization, performance optimization, and thorough testing to validate the migration's success.

## Entry Criteria

1. The Python application must be compatible with either Python 3.8 or Python 3.9.
2. The target Python version (3.11, 3.12, or 3.13) must be clearly specified.
3. A complete inventory of dependencies with their versions must be available (e.g., requirements.txt, setup.py, Pipfile, poetry.lock).
4. The application's test suite or validation methods must be accessible to verify successful migration.
5. Source code must be accessible and in a version control system to track changes and allow rollback if needed.
6. Python environment management tools (virtualenv, conda, etc.) should be available to create isolated environments for testing.

## Implementation Steps

### 1. Processing & Partitioning

1. Create a comprehensive inventory of the Python codebase:
   - List all Python source files (.py) in the project
   - Group files by modules, packages, or functional components
   - Identify entry points (main scripts, services, APIs)
   - Document the project structure and organization

2. Analyze codebase complexity:
   - Calculate lines of code and module dependencies
   - Identify highly complex or critical code sections
   - Document custom abstractions and design patterns
   - List third-party package usage patterns

3. Partition the codebase into logical migration units:
   - Core application code
   - Third-party dependencies and integrations
   - Test suites and validation scripts
   - Configuration and deployment scripts

### 2. Static Dependency Analysis

1. Analyze direct dependencies:
   - Extract and document all import statements
   - Create a dependency graph showing relationships
   - Map dependencies to their current versions
   - Identify dependencies with potential version conflicts

2. Analyze dependency requirements:
   - Parse requirements.txt, setup.py, or equivalent
   - Document version constraints and pinned versions
   - Check for transitive dependency issues
   - Create a complete dependency tree

3. Check compatibility with target Python versions:
   - Research compatibility of dependencies (e.g., NumPy, TensorFlow, Pandas, Cython, SQLAlchemy, Pillow, Django, Matplotlib, and AWS Lambda)
   - Document known breaking changes or deprecations
   - Identify dependencies that need version updates
   - Check for dependencies that don't support target Python version
   - Make sure to update dependencies to a version that officially supports the target Python version

4. Document special handling requirements:
   - List dependencies requiring specific upgrade steps
   - Document cases requiring version pinning
   - Identify alternative packages if needed
   - Note build dependencies that may need updates (e.g., Cython)

### 3. Searching and Applying Specific Transformation Rules

1. Identify Python version-specific syntax changes:
   - Check for removed or deprecated functions and methods
   - Identify new syntax features available in target version
   - Document changes to standard library APIs
   - Note changes to exception handling or context managers

2. Apply syntax and language feature migrations:
   - Update type hints for new typing features (3.11+)
   - Refactor exception handling to use new features (e.g., exception groups in 3.11+)
   - Update to new string formatting and f-string features
   - Utilize pattern matching improvements (3.10+)

3. Apply library-specific transformations:
   - Update NumPy code to leverage new APIs and deprecations
   - Adapt TensorFlow code for compatibility
   - Upgrade Pandas code for new DataFrame operations
   - Update SQLAlchemy syntax for newer versions
   - Adjust Django code for compatibility with newer versions

4. Apply runtime optimization transformations:
   - Update code to utilize performance improvements in Python 3.11+
   - Use new standard library features (e.g., tomllib in 3.11+)
   - Optimize for faster startup and runtime
   - Update Cython code to leverage new Python version features

### 4. Generating a Sequence of Fragments to be Migrated

1. Prioritize migration sequence based on dependencies:
   - Start with core modules with fewest dependencies
   - Identify the critical path for migration
   - Group related modules for concurrent migration
   - Document the planned migration order

2. Create migration units with clear boundaries:
   - Define unit entry and exit points
   - Ensure each unit can be tested independently
   - Document unit interfaces and assumptions
   - Map dependencies between units

3. Document migration prerequisites for each unit:
   - List required environment configuration
   - Specify dependency versions needed
   - Document expected state before migration
   - Note validation criteria for each unit

### 5. Step-by-Step Migration & Iterative Validation

1. Set up validation environment:
   - Create virtual environment for target Python version in /tmp directory using venv
   - Install validation libraries in the virtual environment
   - Install pytest in the virtual environment
   - Install all project dependencies in the virtual environment of the target Python version
   - Set up environment for unit test validation

2. Execute migration by units:
   - Update Python version requirements in project files
   - Update dependency specifications to compatible versions. Make sure to validate that updated dependencies can be installed in virtual environment
   - Refactor code using identified transformation rules
   - Apply package-specific migration steps

3. Perform incremental validation:
   - Run validation command installed in virtual environment for the target Python version to validate for syntax issues
   - Run unit tests after each module migration using pytest
   - Validate integration points between modules
   - Check for runtime deprecation warnings
   - As a final validation check, execute ALL UNIT TESTS using pytest

4. Handle specific library migrations:
   - NumPy: Update array handling and numeric operations
   - TensorFlow: Adjust model definitions and APIs
   - Pandas: Update DataFrame operations and indexing
   - Cython: Rebuild extensions with new Python version
   - SQLAlchemy: Update ORM patterns and connection handling
   - Pillow: Verify image processing compatibility
   - Django: Update template syntax and ORM operations
   - Matplotlib: Check visualization API compatibility
   - AWS Lambda: Update runtime configurations and dependencies

5. Document migration results:
   - Record successful transformations
   - Document any remaining issues or workarounds
   - Create a reference for future migrations
   - Update project documentation to reflect changes

## Constraints and Guardrails
  - Only run validation command that is installed in the virtual environment for the target Python version
  - Only run validation command on the root folder of the project directory
  - Fix the underlying issues when unit tests fail rather than disabling them
  - Make sure to install all dependencies specified in the dependency configuration file in the target Python version for installation validation
  - Keep logger statements limited to those present in the original code


## Validation / Exit Criteria

1. All code runs successfully on the target Python version (3.11, 3.12, or 3.13 as specified) without syntax errors.
2. If there are unit tests, they should pass with the same or better success rate compared to the original Python version.
3. All dependencies are compatible with the target Python version and correctly installed.
4. If there are documentation, they should be updated to reflect the new Python version requirements and any API changes.
5. If there are deployment scripts, they should be updated to use the target Python version.
