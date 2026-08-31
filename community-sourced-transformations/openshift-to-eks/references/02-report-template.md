# Migration Report Template

> Loaded in Phase 5. The report is the deliverable for everything the transformation could not
> do, and it is what a reviewer reads before accepting the diff.

The report **renders** the Phase 1 inventory and the Phase 2-3 outcomes. It never re-derives a
classification: if a construct was REPORT-ONLY in the inventory, it is REPORT-ONLY here.

---

## Structure

```markdown
# OpenShift to Amazon EKS - Migration Report

**Repository:** <name>
**Transformed:** <ISO-8601 UTC>
**Migration target:** <eks-standard | eks-auto-mode | eks-hybrid>
**Ingress strategy:** <gateway-api | alb-ingress>
**Registry:** <the ECR base URI, or NOT SET with the consequence stated>

## Inventory

Every construct found, with its classification. This table is the contract: a construct absent
from it was not considered, which is a defect.

| Construct | Count | Files | Classification | Outcome |
|---|---|---|---|---|
| DeploymentConfig | 2 | ... | MECHANICAL | converted |
| BuildConfig (sourceStrategy) | 1 | ... | SCAFFOLD | Dockerfile skeleton emitted |
| ClusterResourceQuota | 1 | ... | REPORT-ONLY | see Manual Actions |

## Summary

| | |
|---|---|
| Converted automatically | <n> constructs across <m> files |
| Scaffolds emitted | <n> (incomplete by design) |
| Report-only | <n> |
| Manual action items | <n> |
| Files added under `eks/` | <n> |
| Original files modified | **0** |

## Automatic Changes

<per file, what changed and why. Cite line ranges. Group by construct, not by file, so a
reviewer checking "did every Route convert" reads one section.>

### <construct> - <n> occurrences

| File | Before | After | Risk |
|---|---|---|---|

## Scaffolds Emitted (incomplete by design)

<one subsection per scaffold. Each MUST state what is missing and what decision the reader has
to make. A scaffold presented as finished is worse than no scaffold.>

### <path> - <what it covers>

**Complete:** <what is genuinely done>
**Missing:** <the decision the reader must make>
**Risk:** <low|medium|high>

## Manual Action Items

<one entry per REPORT-ONLY construct. Ordered by risk.>

### <construct> - <risk>

**Found in:** `<file>:<lines>`
**Why it was not transformed:** <the specific reason, not "not supported">
**What breaks if ignored:** <concrete failure mode, and whether it is loud or silent>
**Recommended path:** <the options, with the trade-off named>
**Lens question:** <the question id from openshift-to-eks-migration-readiness, so an estate
that ran the assessment can join the two>

## Risk Assessment

| Change | Risk | Why |
|---|---|---|

Risk is per change, never a single figure for the repository. `reencrypt` losing in-cluster TLS
is HIGH even in a repository where everything else converted cleanly.

## Validation Performed

| Check | Result |
|---|---|
| Original manifests byte-identical | PASS / FAIL |
| Emitted YAML parses | PASS / FAIL |
| `kubectl apply --dry-run=client` | PASS / FAIL / not available |
| `helm template` / `kustomize build` | PASS / FAIL / not applicable |
| Zero `*.openshift.io` in `eks/` | PASS / FAIL |

## Residual Blockers

<what still prevents this application running on EKS after the diff is merged. If the list is
empty, say so explicitly - "no residual blockers" is information.>
```

---

## Rules

1. **Never write "not supported".** State the specific reason. "ClusterResourceQuota has no
   Kubernetes equivalent; per-namespace quotas give a sum of maximums rather than a shared pool"
   is actionable. "Not supported" is not.
2. **Distinguish loud from silent failure** in every manual action item. A PVC referencing a
   missing StorageClass stays `Pending` (loud). A `reencrypt` Route downgraded to `edge` keeps
   answering HTTPS (silent). The reader triages differently.
3. **A scaffold always states what is missing.** The scaffold section exists to prevent a
   half-finished artifact being read as finished.
4. **Cross-reference the Lens question ids.** A customer who ran the assessment across 1.000
   apps needs to join this report to that one.
5. **No emoji.** Customer-facing.
6. **The inventory is complete or the report is wrong.** A construct found in Phase 1 and absent
   from the report table is a silent skip - the failure mode this template exists to prevent.
