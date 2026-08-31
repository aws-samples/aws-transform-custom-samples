# Benchmark Results - EKS Version Upgrade Readiness

## Executive Summary

| Metric | Result |
|--------|--------|
| Total repositories tested | 4 (Kubernetes manifests, Terraform, Helm chart, mixed rollback-readiness fixture) |
| Transformation success rate | 100% (4/4) |
| Deprecated APIs detected | 9/9 planted incompatibilities detected (100%) |
| Automatic transformations | 19/19 applied correctly |
| Flag-only items (PSP) | 2/2 correctly flagged, NOT auto-migrated |
| Control resources (already compatible) | 0 modified (correct - no false positives) |
| Rollback findings (run 4) | 6/6 reported with the correct classification |
| Validation | `terraform validate` PASS, `helm template` PASS, YAML parse PASS, `kubeconform` PASS against both 1.34 and 1.33 schemas, `kubectl apply --dry-run=server` PASS against a live EKS 1.35 cluster (6/6 transformed resources accepted) |
| `MIGRATION_REPORT.md` generated | 4/4 runs |
| Total agent minutes | ~156.4 |
| Total estimated cost | ~$5.47 (at $0.035/agent-minute) |

### Methodology

Each test repository was seeded with **known deprecated APIs** (documented per run below), committed to git as a baseline, then transformed via:

```bash
atx custom def exec -n eks-version-upgrade-readiness -p <repo> -x -t \
  --configuration 'additionalPlanContext=Target EKS version <target>. Upgrade from <source>.'
```

Results were verified against the git diff (what changed), the exit criteria in [SKILL.md](SKILL.md) (what must hold), and external validators (`terraform validate`, `helm template`, YAML parsing).

### Pricing Note

Agent minutes = active agent work (planning, reasoning, code modification). Client-side operations (file reads, validation commands) are not billed. Price: **$0.035 / agent minute**.

---

## At-a-Glance Results Table

| # | Repository | Upgrade Path | Status | Detected | Transformed | Flag-Only | Validation | Agent Min | Cost |
|---|---|---|---|---|---|---|---|---|---|
| 1 | k8s-manifests (4 files, 7 resources) | 1.21 -> 1.32 | ✅ SUCCESS | 5/5 | 4/4 | 1/1 (PSP) | YAML parse PASS | 38.5 | $1.35 |
| 2 | terraform-eks (2 files, cluster + 2 node groups + 4 addons) | 1.28 -> 1.33 | ✅ SUCCESS | 7/7 | 7/7 | - | `terraform validate` PASS | 39.1 | $1.37 |
| 3 | helm-chart (1 chart, 2 templates) | 1.21 -> 1.30 | ✅ SUCCESS | 2/2 | 2/2 | - | `helm template` PASS | 17.7 | $0.62 |
| 4 | rollback-readiness fixture (18 files: 13 manifests + Terraform + Helm chart) | 1.33 -> 1.34 | ✅ SUCCESS | 14/14 | 11/11 | 1/1 (PSP) | `terraform validate` + `helm template` + `kubeconform` (1.34 and 1.33) PASS | 61.2 | $2.14 |
| | **TOTALS** | | **4/4** | **28/28** | **24/24** | **2/2** | **4/4 PASS** | **~156.4** | **~$5.47** |

---

## Detailed Per-Repository Results

### 1. Kubernetes Manifests - retail store app (1.21 -> 1.32)

**Input:** 4 manifest files with 5 intentionally deprecated resources + 2 control resources already on current APIs (Deployment `apps/v1`, Service `v1`).

| Planted Incompatibility | Removed In | Detected | Action Taken |
|---|---|---|---|
| Ingress `extensions/v1beta1` | 1.22 | ✅ | Transformed to `networking.k8s.io/v1`: backend restructured to `service.name`/`service.port.number`, `pathType: Prefix` added, `kubernetes.io/ingress.class` annotation converted to `spec.ingressClassName` |
| PodDisruptionBudget `policy/v1beta1` | 1.25 | ✅ | Transformed to `policy/v1` |
| CronJob `batch/v1beta1` | 1.25 | ✅ | Transformed to `batch/v1` |
| HorizontalPodAutoscaler `autoscaling/v2beta1` | 1.25 | ✅ | Transformed to `autoscaling/v2`: `targetAverageUtilization` restructured to `target.type: Utilization` + `averageUtilization` |
| PodSecurityPolicy `policy/v1beta1` | 1.25 | ✅ | **Flagged only** (per design): TODO comment added pointing to Pod Security Admission, listed as manual action item in report - NOT auto-migrated |

**Pass/Fail checks:**

```text
✅ All 4 deprecated resources transformed with comments/labels/annotations preserved
✅ PSP untouched except TODO comment (exit criterion 5)
✅ Control resources (Deployment/Service) byte-identical - zero false positives
✅ All output files parse as valid YAML (7 documents across 4 files)
✅ kubectl apply --dry-run=server against a LIVE Amazon EKS 1.35 cluster:
   6/6 transformed resources accepted by the API server (Deployment, Service,
   Ingress networking.k8s.io/v1, PDB policy/v1, CronJob batch/v1, HPA autoscaling/v2)
✅ Negative confirmation: applying the untouched PSP against the same cluster fails
   with "no matches for kind PodSecurityPolicy in version policy/v1beta1" - proving
   the API is truly gone and the flag-only design decision is correct
✅ MIGRATION_REPORT.md generated: summary, PSP manual action item, risk assessment
   per change, Upgrade Execution Path (1.21 -> 1.22 -> ... -> 1.32, 11 sequential hops)
```

---

### 2. Terraform - EKS cluster with AL2 node groups (1.28 -> 1.33)

**Input:** 2 `.tf` files declaring an EKS cluster on 1.28, two managed node groups on AL2 AMI types (x86 + ARM), and 4 EKS addons pinned below 1.33 minimums.

| Planted Incompatibility | Detected | Action Taken |
|---|---|---|
| `version = "1.28"` on `aws_eks_cluster` | ✅ | Updated to `"1.33"` |
| `ami_type = "AL2_x86_64"` (AL2 discontinued from EKS 1.33) | ✅ | Updated to `"AL2023_x86_64_STANDARD"` |
| `ami_type = "AL2_ARM_64"` | ✅ | Updated to `"AL2023_ARM_64_STANDARD"` |
| vpc-cni `v1.13.4-eksbuild.1` | ✅ | Updated to `v1.19.2-eksbuild.1` |
| coredns `v1.10.1-eksbuild.4` | ✅ | Updated to `v1.11.4-eksbuild.2` |
| kube-proxy `v1.28.1-eksbuild.1` | ✅ | Updated to `v1.33.0-eksbuild.1` |
| aws-ebs-csi-driver `v1.23.0-eksbuild.1` | ✅ | Updated to `v1.35.0-eksbuild.1` |

**Pass/Fail checks:**

```text
✅ terraform validate -> "Success! The configuration is valid." (verified independently
   after the run, terraform-provider-aws v6.x)
✅ IAM roles, VPC config, scaling config, tags untouched
✅ MIGRATION_REPORT.md generated with the sequential path 1.28 -> 1.29 -> 1.30 ->
   1.31 -> 1.32 -> 1.33 and addon compatibility rationale
```

---

### 3. Helm Chart - legacy-api (1.21 -> 1.30)

**Input:** 1 chart with an Ingress template on `networking.k8s.io/v1beta1` (removed in 1.22) and a PDB template on `policy/v1beta1` (removed in 1.25), plus `values.yaml` and `_helpers.tpl`.

| Planted Incompatibility | Detected | Action Taken |
|---|---|---|
| Ingress template `networking.k8s.io/v1beta1` | ✅ | Transformed to `networking.k8s.io/v1`: backend restructured, `pathType: Prefix` added, ingress-class annotation converted to `spec.ingressClassName` - all Helm templating expressions (`{{ .Values... }}`, `{{ include ... }}`) preserved intact |
| PDB template `policy/v1beta1` | ✅ | Transformed to `policy/v1` |

**Pass/Fail checks:**

```text
✅ helm template renders cleanly post-transformation (verified independently)
✅ values.yaml byte-identical (exit criterion: preserve values structure and keys)
✅ _helpers.tpl untouched
✅ MIGRATION_REPORT.md generated with sequential path and per-change risk assessment
```

---

### 4. Rollback readiness fixture - mixed repo (1.33 -> 1.34)

**Purpose:** validate the rollback-readiness additions (N-1 classification, Auto Mode disruption
blockers, Fargate caveat, version scoping). The 1.33 -> 1.34 hop was chosen deliberately: it is the
boundary where `storage.k8s.io/v1` VolumeAttributesClass graduates, so a *correct* transformation
is simultaneously a rollback blocker.

**Input:** 18 files - 13 manifests, 1 Terraform config (cluster + node group + Fargate profile),
1 Helm chart. Cases span forward blockers, rollback blockers, flag-only, negative controls, and one
deliberately out-of-range case.

| Planted case | Expected | Result |
|---|---|---|
| Ingress `extensions/v1beta1` | transform to `networking.k8s.io/v1` | PASS - backend restructured, `pathType: Prefix` added, ingress-class annotation moved to `spec.ingressClassName`, sibling ALB annotation preserved |
| PDB `policy/v1beta1` | transform to `policy/v1` | PASS |
| CronJob `batch/v1beta1` | transform to `batch/v1` | PASS |
| HPA `autoscaling/v2beta2` | transform to `autoscaling/v2` | PASS |
| Helm chart Ingress `extensions/v1beta1` | transform, keep templating | PASS - `{{ .Release.Name }}` / `{{ .Values... }}` expressions intact |
| Terraform `version = "1.33"` | update to `"1.34"` | PASS |
| Terraform `ami_type = "AL2_x86_64"` | update to AL2023 | PASS - `AL2023_x86_64_STANDARD` |
| `values.yaml` LB controller `v2.6.2` | bump to a 1.34-compatible tag | PASS - `v2.8.1`, values structure preserved |
| VolumeAttributesClass `storage.k8s.io/v1beta1` | transform to `v1` **and** flag as target-only | PASS - transformed, and annotated in-file with a `ROLLBACK IMPACT` comment naming 1.33 and the EBS CSI sidecar pinning caveat |
| NodePool budget `nodes: "0"` for `Drifted` | report ERROR-class, fix with TODO | PASS - changed to `nodes: "10%"` with a TODO deferring the rate to the workload owner |
| PDB `maxUnavailable: 0` | report WARNING-class, fix with TODO | PASS - changed to `1` with a TODO |
| `karpenter.sh/do-not-disrupt` on a pod template | report-only WARNING, no code change | PASS - reported as manual item 5, file byte-identical |
| Terraform Fargate profile | report that Fargate cannot roll back | PASS - reported as manual item 6 with the kubelet-skew ERROR explanation |
| PodSecurityPolicy | flag only, never transform | PASS - file byte-identical, listed as CRITICAL manual item |
| Correct Service / PDB / Deployment | untouched | PASS - all three byte-identical |
| Non-canonical IP/CIDR (a **1.36** issue) | must NOT be reported as blocking for 1.34 | PASS - reported as a *future* item, explicitly "Not blocking for 1.34", file byte-identical |

**Pass/Fail checks (validated independently, not from the agent's output):**

```text
PASS  helm template renders cleanly; rendered Ingress is networking.k8s.io/v1 with pathType,
      and the rendered output passes kubeconform against 1.34
PASS  terraform validate -> "Success! The configuration is valid." (provider aws v5.100.0)
PASS  YAML parse: 13/13 manifests parse; apiVersion inventory confirms every transformation
PASS  kubeconform v0.8.0 against Kubernetes 1.34 schemas:
      13 resources / 13 files - Valid 11, Invalid 0, Errors 0, Skipped 2
      (skipped = Karpenter NodePool, a CRD with no upstream schema, and PodSecurityPolicy)
PASS  Negative controls byte-identical vs the git baseline: service-ok, pdb-ok, deploy-ok,
      psp.yaml, netpol.yaml, deploy-ledger.yaml (6/6 UNTOUCHED)
PASS  No removed-API GroupVersion left anywhere in manifests/ or chart/ (psp.yaml excluded
      by design)
PASS  MIGRATION_REPORT.md contains the Rollback Readiness section: eligibility verdict,
      per-change N-1 column, disruption controls with insight severity, Fargate caveat,
      Terraform rollbackConfig gap, and a staged recommendation
```

**Empirical confirmation of the N-1 classification.** The interesting result is running the same
manifests against the **previous** version's schemas. The skill claimed exactly one change was
target-only; the schema set agrees, and nothing else regressed:

```text
kubeconform -kubernetes-version 1.34.0   ->  Valid 11, Invalid 0, Skipped 2
kubeconform -kubernetes-version 1.33.0   ->  Valid 10, Invalid 0, Skipped 3

The one extra skip on 1.33 is manifests/volumeattributesclass.yaml. Isolated:
  1.34.0  rc=0  VolumeAttributesClass gp3-fast is valid
  1.33.0  rc=1  failed validation: could not find schema for VolumeAttributesClass

That is the target-only verdict reproduced against upstream schemas rather than inferred
from release notes: storage.k8s.io/v1 exists at 1.34 and does not exist at 1.33, so applying
it does close the rollback window. Every other transformed resource validates on BOTH
versions, matching its "safe on both" verdict.
```

Second negative confirmation, this one for the flag-only rule: PodSecurityPolicy has **no schema at
1.34** (`could not find schema for PodSecurityPolicy`), independently reproducing what run 1 showed
against a live cluster - the API really is gone, so transforming it would be meaningless and
flagging it is the correct behaviour.

**Notes and follow-ups from this run:**

- **kubectl `--dry-run` was not used** in this run: the workstation kubeconfig pointed at a
  decommissioned cluster, so kubectl could not fetch an OpenAPI schema for any file. `kubeconform`
  against both version schema sets covers the same ground without a cluster, and run 1 already
  covers live-cluster acceptance. Two resources have no upstream schema (the Karpenter NodePool CRD
  and PSP) and are reported as skipped rather than passing.
- **Budget:** the run exceeded a 60 agent-minute limit (61.23 used) and was cut at the agent's own
  final `terraform validate`. All transformations and `MIGRATION_REPORT.md` were already complete on
  disk, so the deliverables are intact, but they were left uncommitted (the ATX Bot commit never
  happened) - the audit therefore ran against the working tree rather than `git diff baseline HEAD`.
  The reference set roughly doubled in size with the rollback material, so **budget 90-120 agent
  minutes** for this TD rather than 60.
- **Addon matrix gap (fixed 2026-08-20):** the report stated a v2.8.0+ minimum for the AWS Load
  Balancer Controller on 1.34, extrapolated from the 1.30+ and 1.32+ columns. The root cause was the
  matrix itself, which mixed AWS-published per-version data with community floors in a single table
  and so invited projection. Adding a "1.34+" column would have made it worse, because AWS publishes
  no floor for the LB Controller at any Kubernetes version — only a general "2.7.2 or later"
  recommendation. `references/eks-specific-changes.md` now splits the two: an exact
  per-Kubernetes-version table for the three EKS-managed add-ons (cited to the AWS docs) and a
  floors table for self-managed add-ons carrying a source-of-truth link per row plus an explicit
  instruction not to extrapolate to versions with no column.
- **Severity labelling (fixed 2026-08-20):** the report labelled the VolumeAttributesClass adoption
  with insight severity `ERROR`, conflating this skill's own risk rating with a cluster insight
  severity — no insight exists for a repository finding. `references/rollback-readiness.md` now
  states where severity is *quoted* (disruption controls and managed add-ons, per the Auto Mode
  docs) and where it is *rated* by the skill (everything in the additions tables).

---

## Exit Criteria Compliance (per SKILL.md)

| # | Exit Criterion | Run 1 | Run 2 | Run 3 | Run 4 |
|---|---|---|---|---|---|
| 1 | No removed APIs remain for target version | ✅ | ✅ | ✅ | ✅ |
| 2 | Comments/labels/annotations preserved | ✅ | ✅ | ✅ | ✅ |
| 3 | No resource deleted | ✅ | ✅ | ✅ | ✅ |
| 4 | Ambiguous changes marked with TODO + report | ✅ (PSP) | n/a | n/a | ✅ (PSP, NodePool, PDB) |
| 5 | PSP flagged, never auto-migrated | ✅ | n/a | n/a | ✅ |
| 6 | Validators pass (where available) | ✅ YAML | ✅ terraform | ✅ helm | ✅ terraform + helm + kubeconform (1.34 and 1.33) |
| 7 | MIGRATION_REPORT.md complete | ✅ | ✅ | ✅ | ✅ |
| 8 | Upgrade Execution Path with every sequential hop | ✅ (11 hops) | ✅ (5 hops) | ✅ (9 hops) | ✅ (1 hop) |
| 9 | N-1 verdict per change; target-only annotated in code | n/a | n/a | n/a | ✅ (11/11 rows, confirmed by dual-version kubeconform) |
| 10 | Disruption controls reported with insight severity; no cluster API called | n/a | n/a | n/a | ✅ (4 findings, zero cluster calls) |

---

## Validation Commands Used

```bash
# Manifest structural validation
python3 -c "import yaml,glob; [list(yaml.safe_load_all(open(f))) for f in glob.glob('manifests/*.yaml')]"

# Schema validation without a cluster, against BOTH sides of the upgrade hop.
# Running the target version proves the manifests are valid after transformation;
# running N-1 proves which changes are target-only (and therefore rollback-blocking).
kubeconform -kubernetes-version 1.34.0 -summary -verbose -ignore-missing-schemas manifests/
kubeconform -kubernetes-version 1.33.0 -summary -verbose -ignore-missing-schemas manifests/
helm template storefront ./chart | kubeconform -kubernetes-version 1.34.0 -summary -

# Live cluster validation (Amazon EKS 1.35)
aws eks update-kubeconfig --name <cluster> --region us-east-1
kubectl apply --dry-run=server -f manifests/   # 6/6 transformed resources accepted

# Terraform validation (after terraform init)
terraform validate

# Helm chart rendering
helm template test legacy-api/

# Diff audit against the pre-transformation git baseline
git diff <baseline-commit> HEAD
```
