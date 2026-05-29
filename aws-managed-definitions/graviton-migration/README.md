# Graviton Migration Transformation Definitions

Transformation definitions for migrating applications from x86 to AWS Graviton (ARM64) architecture.

## Available Definitions

| Language | Transformation | Description |
|----------|---------------|-------------|
| Java | [x86 → Graviton](java/transformation-definition_x86-to-graviton.md) | Validate and migrate Java applications to AWS Graviton (ARM64) architecture |

## What These TDs Do

Graviton migration TDs validate application compatibility with ARM64 architecture and make only the minimum changes required for ARM64 support. They do **not** perform general modernization, security updates, or version upgrades.

### 3-Phase Workflow
1. **Static Analysis** — Scans for native `.so` libraries, x86-only dependencies, and architecture-specific code patterns
2. **Targeted Fixes** — Upgrades only ARM64-blocking dependencies, adds `aarch64` code paths, applies Graviton JVM flags
3. **Validation** — Builds and tests on ARM64, classifies failures, validates container/startup behavior

### Output
Each transformation produces a structured `graviton-validation/` folder with 7 reports covering project assessment, native libraries, dependencies, code scan, JVM config, build/test results, and an executive summary.

## Directory Structure

```
graviton-migration/
└── java/
    ├── transformation-definition_x86-to-graviton.md
    └── document_references/
        ├── agent-scope-boundaries.md
        └── documentation-standards.md
```

## Reference Documents

Each language TD includes reference documents in `document_references/`:

- **agent-scope-boundaries.md** — Strict scope rules with decision trees ensuring only ARM64-blocking issues are addressed
- **documentation-standards.md** — Canonical output folder structure and required report templates
