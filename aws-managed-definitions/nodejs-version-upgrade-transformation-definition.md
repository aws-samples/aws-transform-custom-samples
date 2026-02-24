# Node.js Version Upgrade Transformation

## Objective
Upgrade Node.js applications and AWS Lambda functions from older Node.js versions to Node.js target version, and upgrade all dependencies to their latest compatible versions, to leverage the latest language features, performance improvements, and security updates.

## Summary
This transformation systematically migrates Node.js applications and AWS Lambda functions to Node.js target version by updating version configuration files, modifying package dependencies for compatibility, refactoring code that uses deprecated APIs, updating infrastructure configurations (AWS SAM, AWS CDK, Terraform, etc.), and updating CI/CD configurations.

- For Lambda projects, execute steps annotated with **[Lambda-specific]** in addition to the other steps
- For non-Lambda projects, skip all **[Lambda-specific]** steps

## Entry Criteria
1. The repository must contain at least one Node.js application, module, or AWS Lambda function
2. The application/function must be using a Node.js version earlier than Node.js target version (as specified in package.json, .nvmrc, .node-version, Dockerfile, runtime configurations, etc.)
3. The repository must be able to run and build successfully in its current state with the existing Node.js version
4. Access to the repository's test suite or a way to verify application functionality must be available
5. Any required permissions to update dependencies and modify configuration files must be in place
6. For AWS Lambda projects: The repository contains at least one of the following:
   - AWS SAM template files (template.yaml, template.yml)
   - AWS CDK code (TypeScript/JavaScript)
   - Dockerfile for AWS Lambda container images
   - Terraform IaC defining AWS Lambda or related resources

## Implementation Steps

### 1. Processing & Partitioning
1. Identify project type and structure
   1. Locate all package.json files in the repository
   2. Determine if the repository is a monorepo with multiple Node.js modules/applications
   3. Map dependencies between modules in a monorepo configuration
   4. **[Lambda-specific]** Identify all AWS Lambda functions in the repository
      - Locate directories containing Lambda handlers
      - Identify deployment configuration files (SAM templates, CDK code, Terraform files)
2. For each identified Node.js project, determine:
   1. Current Node.js version in use
   2. Build and package management system (npm, yarn, pnpm)
   3. Testing frameworks in use
   4. **[Lambda-specific]** Lambda-specific deployment method (SAM, CDK, Serverless Framework, Terraform, container images)
3. Categorize configuration files
   1. Node.js version files (.nvmrc, .node-version, package.json engines field)
   2. CI/CD configuration files (.gitlab-ci.yml, .github/workflows/*.yml, azure-pipelines.yml, etc.)
   3. Docker images and Dockerfiles
   4. **[Lambda-specific]** Deployment templates (SAM/CloudFormation templates, CDK files, Terraform files)
4. Create a prioritized order for updating:
   1. For monorepos:
      - Start with shared/core libraries that other modules depend on
      - Proceed with modules that have fewer external dependencies
      - **[Lambda-specific]** Prioritize shared Lambda layers or common utilities
      - End with application entry points, services, and Lambda functions
   2. For single projects: Follow dependency order from infrastructure to application code

### 2. Run npm-check-updates Command
**BEFORE beginning static dependency analysis, run the npm-check-updates command to identify which dependencies need updates:**
```bash
npx -y npm-check-updates --format group --enginesNode --cooldown 7 --packageManager <npm|yarn|pnpm> --no-deprecated
```
This command MUST be executed before the plan is generated so that you know what dependencies need to be updated and can use that information to generate the plan. See document_references/npm-check-updates-command.md for full command details.

### 3. Static Dependency Analysis
1. Analyze Node.js version configuration files
   1. Identify all version specification files (.nvmrc, .node-version, package.json engines field)
   2. Locate Node.js version references in CI/CD configuration files
   3. Identify Docker images and Dockerfiles that specify Node.js versions
   4. **[Lambda-specific]** Document Lambda runtime specifications in SAM templates, CDK code, and Terraform files
   5. **[Lambda-specific]** Document Lambda container base images used in Dockerfiles
2. Analyze package dependencies
   1. Add/update the `engines` field in `package.json` to reflect the target version we are upgrading to
   2. Use the output from npm-check-updates (from step 2) to identify dependencies with known compatibility issues with Node.js target version
   3. Identify dependencies that have been deprecated or are no longer maintained and determine what their recommended alternatives are
   4. Identify transitive dependencies that may cause conflicts
   5. **[Lambda-specific]** Flag AWS SDK versions and Lambda-specific dependencies
   6. Create a list of all dependencies needing updates based on the npm-check-updates output and analysis done above in the order of priority. All dependencies identified by npm-check-updates should be upgraded to their latest compatible versions, not just the minimum needed for the Node.js target version to build.
      - Prioritize upgrades necessary for compatibility with the Node.js target version, then proceed with all remaining dependency upgrades to their latest versions
3. Identify potential code compatibility issues
   1. Scan for usage of deprecated or removed APIs in the Node.js target version or in upgraded dependencies
   2. Identify usage of APIs with changed behavior in the Node.js target version or in upgraded dependencies
   3. Find any native module dependencies that might need rebuilding
   4. Detect ES modules vs CommonJS usage and potential interoperability issues
   5. Identify syntax that may be affected by the V8 engine update
   6. Document changes in error handling behavior
   7. **[Lambda-specific]** Review handler signatures against best practices

### 4. Searching and Applying Specific Transformation Rules
1. Update Node.js version specifications
   1. Update .nvmrc and .node-version files to Node.js target version
   2. Update the engines field in package.json to require Node.js target version
   3. Update Docker base images to use Node.js target version (e.g., update alpine image tag and setup script URLs to target version)
   4. Update CI/CD configuration files to use Node.js target version for build and test steps
      - GitHub Actions: Update `node-version` matrix values in `.github/workflows/*.yml`
      - CircleCI: Update Docker image to target version
      - Travis CI: Update `node_js` field
      - Jenkins: Update nodejs tool version
      - AWS CodeBuild (buildspec.yml): Update `runtime-versions: nodejs` to target version
   5. **[Lambda-specific]** Update Dockerfile FROM statements to use Node.js target version Lambda base images
   6. Only add properties to package.json, .nvmrc, .node-version files that already exist there.
   7. Preserve all content that is generated by building the code base.
2. **[Lambda-specific]** Update AWS Lambda runtime configurations
   1. In SAM templates: Change `Runtime` attribute to Node.js target version in `Globals.Function.Runtime` or individual function definitions. Update runtime references even in commented code.
   2. In CDK code: Update runtime parameter to Node.js target version
   3. In Terraform files: Update `runtime` attribute in `aws_lambda_function` resources
   4. For container images: Update base image to Node.js target version
   5. For Serverless Framework: Update `provider.runtime` field in serverless.yml
3. Update package dependencies
   1. Update package.json dependencies based on the static dependency analysis in the previous step
   2. Replace deprecated packages with recommended alternatives
   3. Update development dependencies (testing frameworks, build tools, etc.)
   4. Resolve dependency conflicts through version adjustments
   5. **[Lambda-specific]** Update AWS SDK versions if needed for Node.js target version compatibility
4. Modernize code for Node.js target version and upgraded dependency compatibility
   1. Replace deprecated API usages with modern equivalents
   2. Update code affected by changes in Node.js target version and upgraded dependency behavior
   3. Fix any ESM/CommonJS interoperability issues

### 5. Apply Common Migration Patterns

Apply migration patterns based on the frameworks and technologies present in the repository. **Only apply patterns relevant to the project's technology stack as identified in Step 1.** Use the latest compatible versions available at the time of migration (do not hardcode specific version numbers — always check npm for the current latest).

**Consult `document_references/common-migration-patterns.md` for the full catalog of technology-specific migration patterns.** That document covers: testing frameworks, AWS SDK, Serverless Framework, Express, TypeScript & build tools, linting & formatting, git hooks, deprecated package replacements, database/ORM, and Lambda-specific patterns.

The following patterns require special attention because they involve counterintuitive or easily-missed fixes:

1. **Serverless Framework v4+ authentication**: After upgrading Serverless Framework to v4+, you must add `org: null` and `console: false` to serverless.yml to disable Dashboard authentication for local/CI use. Without this, all Serverless commands will fail with an authentication error. Create `.npmrc` with `legacy-peer-deps=true` if plugins have peer dependency conflicts.

2. **ESM-only dependencies in CommonJS/Jest**: Some packages drop CommonJS support in major upgrades (e.g., uuid, @middy/core). For Jest, add `transformIgnorePatterns: ['node_modules/(?!<package-name>)']` and a JS file transformation to the Jest config. Alternatively, downgrade to the last version that supports both CommonJS and ESM.

3. **aws-sam-webpack-plugin runtime support**: Older versions of aws-sam-webpack-plugin have hardcoded runtime checks that don't recognize newer Node.js Lambda runtimes. The build will fail with "Function has an unsupport Runtime." Upgrade the plugin to a version that supports the target runtime.

4. **Prettier + ESLint plugin compatibility**: When upgrading Prettier to a new major version, you **must** also upgrade `eslint-plugin-prettier` and `eslint-config-prettier`. Old versions of eslint-plugin-prettier call removed Prettier APIs (`prettier.resolveConfig.sync`), causing lint commands to fail.

5. **Packages with changed export patterns**: Some packages change from direct export to `.default` when migrating to ESM (e.g., `current-git-branch` returns an object instead of a function after upgrade). Access via `.default` or replace with a native Node.js implementation (e.g., `child_process.execSync('git branch --show-current')`).

### 6. Generating a sequence of fragments to be migrated based on the Dependency Analysis
1. Determine migration order
   1. Update base configuration files first (.nvmrc, .node-version, root package.json)
   2. **[Lambda-specific]** Update deployment templates and infrastructure code (SAM, CDK, Terraform)
   3. Update package.json and dependencies
   4. Update application code to fix compatibility issues
2. For monorepos, create migration sequence:
   1. Update shared configuration files first
   2. Proceed with core/shared libraries within the monorepo
   3. **[Lambda-specific]** Update Lambda layers and shared utilities
   4. Update application-specific modules in dependency order
   5. Complete with end-user facing applications and Lambda functions
3. **[Lambda-specific]** Create migration steps for each Lambda function
   1. Prepare function-specific migration plans
   2. Address unique requirements per function
   3. Prioritize shared components and libraries

### 7. Step-by-Step Migration & Iterative Validation

Use an incremental dependency update strategy: update dependencies in controlled batches based on semantic versioning or logical groups. This isolates potential issues, allows rollback, and makes debugging easier.

1. Update Node.js version specifications
   1. Update .nvmrc, .node-version, package.json `engines` field to Node.js target version
   2. Update CI/CD configuration files to Node.js target version
2. **[Lambda-specific]** Update runtime configurations
   1. SAM: Update `Runtime` attribute to target version
   2. CDK: Update runtime parameter to target version
   3. Terraform: Update `runtime` in `aws_lambda_function` resources
   4. Dockerfiles: Update FROM statement to target Lambda base image
   5. Serverless Framework: Update `provider.runtime` and `frameworkVersion`
3. Update dependencies in batches
   1. Configuration files first (serverless.yaml, package.json engines, CI/CD)
   2. Testing framework (Jest, Mocha) — verify tests pass
   3. **[Lambda-specific]** AWS SDK versions
   4. Application dependencies in batches, validating after each
   5. Deployment framework (Serverless) if applicable
   6. Deprecated packages — replace with alternatives
   7. Run `npm audit fix` and comprehensive validation after each step
4. Fix compatibility issues
   1. Update code using deprecated Node.js APIs
   2. Adjust code using dependencies with breaking changes
   3. Fix ESM/CommonJS interoperability issues
   4. **[Lambda-specific]** Update Lambda handler code for compatibility issues
5. Execute comprehensive testing
   1. Run tests with coverage reporting enabled
   2. Verify 100% test pass rate and coverage metrics maintained
6. Resolve security vulnerabilities
   1. Run `npm audit` to establish baseline; run `npm audit fix` after each batch
   2. Track vulnerability reduction; upgrade major framework versions to resolve transitive vulnerabilities
   3. Use npm `overrides` for transitive dependency vulnerabilities that `npm audit fix` cannot resolve
   4. Document any remaining low-severity advisories with justification
7. Fix any issues discovered during validation
   1. Resolve dependency conflicts or version constraints
   2. Address errors revealed by testing; fix test failures
   3. Update test code if affected by Node.js version changes
8. Update documentation
   1. Search for old Node.js version references in all documentation files
   2. Update installation instructions, code examples, deployment docs, and prerequisites
   3. Include version verification commands (e.g., `node --version`)

### 8. Known Debug Patterns & Troubleshooting

When issues arise during migration, consult `document_references/known-debug-patterns.md` for a catalog of known issues and fixes organized by category.

Key troubleshooting principles:

- **Pre-existing vs migration-induced failures**: Before attributing test failures to the migration, run tests with the original Node.js version to distinguish pre-existing failures
- **npm audit exit codes**: `npm audit` exits non-zero for any advisory, including informational ones (e.g., AWS SDK v2 EOL). Evaluate severity rather than treating all as blockers
- **Peer dependency resolution**: If `npm install` fails with `ERESOLVE`, retry with `--legacy-peer-deps`, then verify functionality through testing and document the reason
- **Corrupted lock files**: If `package-lock.json` becomes corrupted during incremental updates, remove `node_modules` + `package-lock.json` and perform a clean install
- **ESM-only packages in CommonJS projects**: Options are (a) downgrade to last dual-format version, (b) configure Jest/bundler to transform the package, (c) convert project to ESM

## Constraints and Guardrails

1. Keep all tests enabled and resolve failures through proper code fixes
2. Upgrade Node.js version consistently across all modules
3. Maintain or upgrade dependency versions from source baseline
4. Setup appropriate environment and install all necessary dependencies for validation
5. Preserve existing import structure and maintain consistent API usage patterns
6. Preserve all existing comments
7. If any temporary debugging code is introduced during the transformation, remove it at the end
8. Preserve original licensing information without any modifications, additions, or deletions
9. Run the appropriate package manager install command (npm install, yarn install, or pnpm install) to modify package.json instead of directly modifying package.json or lock files
10. You must run security audits using the appropriate package manager (npm audit/yarn audit/pnpm audit) any time you install packages and address any findings
11. You must avoid directly modifying the node_modules folder (this folder should only be modified through interactions with the appropriate package manager)
12. When using `--legacy-peer-deps`, document the reason and verify packages function correctly despite peer dependency warnings
13. Use npm `overrides` (or yarn `resolutions`) to fix transitive dependency vulnerabilities when `npm audit fix` cannot resolve them without breaking changes
14. Before final validation, perform a clean install (remove node_modules and package-lock.json, then `npm install`) to ensure the dependency tree is reproducible

## Validation / Exit Criteria

### General Criteria (All Projects)
1. All Node.js version specification files (.nvmrc, .node-version, package.json engines) successfully updated to Node.js target version
2. All CI/CD configuration files updated to use Node.js target version
3. All dependencies updated to their latest versions compatible with Node.js target version
4. Application successfully builds with Node.js target version without errors
5. All tests pass when run with Node.js target version
6. **[Lambda-specific]** All AWS Lambda runtime configurations (SAM templates, CDK code, Terraform files, Dockerfiles) are updated to use Node.js target version
7. Original documentation updated to reflect the new Node.js version requirement
8. **[Lambda-specific]** Deployment documentation updated with new runtime specifications
9. Security audit has been run and findings evaluated; any remaining low-severity advisories documented with justification
10. Test coverage metrics are maintained at pre-migration levels
