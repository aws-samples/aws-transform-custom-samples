# Benchmark Results - EKS Version Upgrade Readiness

## Executive Summary

| Metric | Result |
|--------|--------|
| Total repositories tested | 3 (Kubernetes manifests, Terraform, Helm chart) |
| Transformation success rate | 100% (3/3) |
| Deprecated APIs detected | 9/9 planted incompatibilities detected (100%) |
| Automatic transformations | 8/8 applied correctly |
| Flag-only items (PSP) | 1/1 correctly flagged, NOT auto-migrated |
| Control resources (already compatible) | 0 modified (correct - no false positives) |
| Validation | `terraform validate` PASS, `helm template` PASS, YAML parse PASS, `kubectl apply --dry-run=server` PASS against a live EKS 1.35 cluster (6/6 transformed resources accepted) |
| `MIGRATION_REPORT.md` generated | 3/3 runs |
| Total agent minutes | ~95.2 |
| Total estimated cost | ~$3.33 (at $0.035/agent-minute) |

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
| | **TOTALS** | | **3/3** | **14/14** | **13/13** | **1/1** | **3/3 PASS** | **~95.2** | **~$3.33** |

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

## Exit Criteria Compliance (per SKILL.md)

| # | Exit Criterion | Run 1 | Run 2 | Run 3 |
|---|---|---|---|---|
| 1 | No removed APIs remain for target version | ✅ | ✅ | ✅ |
| 2 | Comments/labels/annotations preserved | ✅ | ✅ | ✅ |
| 3 | No resource deleted | ✅ | ✅ | ✅ |
| 4 | Ambiguous changes marked with TODO + report | ✅ (PSP) | n/a | n/a |
| 5 | PSP flagged, never auto-migrated | ✅ | n/a | n/a |
| 6 | Validators pass (where available) | ✅ YAML | ✅ terraform | ✅ helm |
| 7 | MIGRATION_REPORT.md complete | ✅ | ✅ | ✅ |
| 8 | Upgrade Execution Path with every sequential hop | ✅ (11 hops) | ✅ (5 hops) | ✅ (9 hops) |

---

## Validation Commands Used

```bash
# Manifest structural validation
python3 -c "import yaml,glob; [list(yaml.safe_load_all(open(f))) for f in glob.glob('manifests/*.yaml')]"

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
