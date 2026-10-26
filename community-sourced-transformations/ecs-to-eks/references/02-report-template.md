# Migration Report Template

> Loaded at the end of Phase 1, when the skeleton is written, and again in Phase 5. The report
> is the deliverable for everything the transformation could not do.

The report **renders** the Phase 1 inventory and the Phase 2-3 outcomes. It never re-derives a
classification. Write the skeleton with the Inventory filled and every other section present
with `pending`, then replace `pending` as each phase finishes. A run stopped early must still
leave a report that says how far it got.

---

## Structure

```markdown
# Amazon ECS to Amazon EKS - Migration Report

**Repository:** <name>
**Transformed:** <ISO-8601 UTC>
**Status:** <complete | stopped after Phase N>
**Source format:** <Terraform | CloudFormation | CDK | JSON>
**Migration target:** <eks-auto-mode | eks-standard | eks-fargate-profile>
**Ingress strategy:** <alb-ingress | gateway-api>
**Namespace:** <name and where it came from>

## Inventory

Every ECS service and construct found. A construct absent from this table was not considered,
which is a defect.

| Service | Construct | Source (file:line) | Classification | Outcome |
|---|---|---|---|---|
| catalog | task definition | terraform/lib/ecs/service/ecs.tf:125 | MECHANICAL | converted |
| catalog | Service Connect alias `catalog:80` | terraform/lib/ecs/service/ecs.tf:151 | MECHANICAL | Service emitted |
| catalog | Service Connect proxy features | terraform/lib/ecs/service/ecs.tf:151 | REPORT-ONLY | see Manual Action Items |

## Summary

| | |
|---|---|
| ECS services found | <n> |
| Converted automatically | <n> constructs |
| Scaffolds emitted | <n> (incomplete by design) |
| Report-only | <n> |
| Manual action items | <n> |
| Files added under `eks/` | <n> |
| Original files modified | **0** |

## Automatic Changes

Grouped by construct, so a reviewer checking "did every service get a Service" reads one section.

### <construct> - <n> occurrences

| Service | Source | Emitted | Risk |
|---|---|---|---|

## IAM Redistribution

| Service | Task role grants | Execution role secret grants moved to the workload role | Identity mechanism |
|---|---|---|---|

## Scaffolds Emitted (incomplete by design)

### <path> - <what it covers>

**Complete:** <what is done>
**Missing:** <the decision the reader must make>
**Risk:** <low|medium|high>

## CRDs and Add-ons Required

| Kind or add-on | Needed by | Provided by |
|---|---|---|
| SecretProviderClass | <services> | Secrets Store CSI driver + AWS provider |

## Manual Action Items

One entry per REPORT-ONLY construct and per `TODO(migration)`. Ordered by risk.

### <construct> - <risk>

**Found in:** `<file>:<lines>`
**TODO(migration) sites:** `<emitted file>:<line>` (or none)
**Why it was not transformed:** <the specific reason>
**What breaks if ignored:** <concrete failure, and whether it is loud or silent>
**Recommended path:** <options with the trade-off named>

## Risk Assessment

| Change | Risk | Why |
|---|---|---|

## Validation

| Check | Result |
|---|---|
| YAML parse | |
| kubectl --dry-run=client (core kinds) | |
| terraform fmt -check (emitted .tf) | |
| No ECS-only fields in YAML | |
| No role-arn annotation (unless eks-fargate-profile) | |
| No literal secret values | |
| Every alias / registry / target has a Service | |
```

## Rules

- Use a hyphen, never an em dash.
- Every `TODO(migration)` in `eks/` appears under `## Manual Action Items`, and every Manual
  Action Item that has an emitted site lists it.
- Quote unresolved IaC expressions verbatim, in backticks.
- Do not paste secret values, account ids or ARNs found in the source into the report; refer to
  them by the expression or resource name.
