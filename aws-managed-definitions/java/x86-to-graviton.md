# Java x86 → AWS Graviton (ARM64) Migration

**Canonical location:** [`graviton-migration/java/`](../graviton-migration/java/transformation-definition_x86-to-graviton.md)

Validate and migrate Java applications to run on AWS Graviton (ARM64) processors. The transformation runs a 3-phase workflow:

1. **Static analysis** — scan source, dependencies, and native libraries for ARM64 compatibility
2. **Targeted fixes** — address only ARM64-blocking issues (no general modernization)
3. **ARM64 validation** — produce 7 structured reports under `graviton-validation/`

## Why this is in two places

The full transformation definition lives under [`graviton-migration/`](../graviton-migration/) — a cross-language category for AWS Graviton migrations. This stub exists in `java/` for discoverability when browsing Java-specific transformations.

See the [canonical TD](../graviton-migration/java/transformation-definition_x86-to-graviton.md) for the complete workflow, scope boundaries, and documentation standards.
