# Benchmark Results - ACK Resource Adoption from IaC

## Executive Summary

| Metric | Result |
|--------|--------|
| Repositories tested | 3 - one per supported IaC flavor (Terraform, CloudFormation, Pulumi) |
| Transformation success rate | 100% (3/3) |
| Resources inventoried | 18 IaC resources + 3 composition units (TF module, CFN nested stack, Pulumi ComponentResource) |
| ACK manifests generated | 8 flat (S3 x3, DynamoDB x3, IAM Role, VPC) |
| kro outputs generated | 3 ResourceGraphDefinitions + 3 instance CRs (one per composition unit) |
| Safety annotation audit | 14/14 ACK resource documents (flat + RGD-embedded templates) carry `adopt-or-create` + `deletion-policy: retain` (100%) |
| IaC syntax remnants in output | 0 across all runs (`!Ref`, `!GetAtt`, `${var.`, `.apply(` - none found) |
| Source IaC modified | 0 files in all runs (byte-identical to git baselines) |
| Unsupported resources flagged | 3/3 CloudWatch Log Groups report-only with guidance |
| adoption-fields discovery | VPC correctly emitted with `TODO(discovery)` + exact AWS CLI command (identifier only exists at deploy time) |
| Resource folding | `aws_iam_role_policy_attachment` folded into the Role spec (no orphan manifest) |
| `ADOPTION_REPORT.md` generated | 3/3 runs |
| Total agent minutes | ~116.4 |
| Total estimated cost | ~$4.07 (at $0.035/agent-minute) |

### Methodology

Each test repository was seeded with a **known mix of adoption scenarios** (flat resources, a reusable composition unit, an unsupported type), committed to git as a baseline, then transformed via:

```bash
atx custom def exec -n ack-resource-adoption-from-iac -p <repo> -x -t \
  --configuration 'additionalPlanContext=Adopt all resources.'
```

Results were verified against the git diff (what was generated), the exit criteria in [SKILL.md](SKILL.md), a programmatic annotation audit (YAML parse of every output document, including templates inside RGDs), and grep-based scans for IaC syntax remnants.

### Pricing Note

Agent minutes = active agent work (planning, reasoning, code generation). Client-side operations (file reads, validation) are not billed. Price: **$0.035 / agent minute**.

---

## At-a-Glance Results Table

| # | Repository | IaC Flavor | Status | Flat Manifests | kro RGD + Instance | Unsupported Flagged | Annotation Audit | Agent Min | Cost |
|---|---|---|---|---|---|---|---|---|---|
| 1 | mixed Terraform (7 resources + 1 module) | Terraform | ✅ SUCCESS | 3 (S3, DynamoDB, IAM Role w/ folded attachment) | 1 + 1 (queue-with-dlq) | 1 (Log Group) | 5/5 | 42.4 | $1.48 |
| 2 | platform stack (5 resources + 1 nested stack) | CloudFormation | ✅ SUCCESS | 3 (S3, DynamoDB, VPC w/ discovery TODO) | 1 + 1 (messaging: SNS+SQS) | 2 (Log Group, SNS Subscription¹) | 5/5 | 30.0 | $1.05 |
| 3 | platform program (4 resources + 1 ComponentResource) | Pulumi (Python) | ✅ SUCCESS | 2 (S3 BucketV2, DynamoDB) | 1 + 1 (QueueWithDlq) | 1 (Log Group) | 4/4 | 44.1 | $1.54 |
| | **TOTALS** | | **3/3** | **8** | **3 + 3** | **4** | **14/14** | **~116.4** | **~$4.07** |

> ¹ The SNS Subscription was conservatively flagged as unsupported because it was missing from the mapping reference at test time - the agent correctly followed the "never guess" constraint instead of inventing a Kind. The mapping table has since been extended with `AWS::SNS::Subscription` -> `sns.services.k8s.aws/v1alpha1 Subscription`. This is exactly the failure mode the design intends: gaps degrade to report-only guidance, never to wrong manifests.

---

## Detailed Per-Repository Results

### 1. Terraform - mixed repo (flat + module + unsupported)

**Input:** `main.tf` with S3 bucket, DynamoDB table, IAM role + policy attachment, a `module "order_queue"` instantiation (queue-with-dlq: 2 SQS queues wired via redrive policy), and a CloudWatch Log Group.

**Pass/Fail checks:**

```text
✅ 3 flat ACK manifests generated (Bucket, Table, Role)
✅ aws_iam_role_policy_attachment folded into Role spec.policies (no orphan manifest)
✅ Module -> kro RGD: inputs became schema fields (queueName: string,
   maxReceiveCount: integer | default=5), DLQ wiring via CEL
   (${dlq.status.ackResourceMetadata.arn}), + instance CR with the module arguments
✅ Agent added TODO(discovery) for SQS queueURL adoption-fields on its own,
   following the constraints (not present in the worked example)
✅ aws_cloudwatch_log_group flagged report-only with ACK roadmap guidance
✅ Source IaC byte-identical; 0 IaC syntax remnants; 5/5 annotation audit
```

### 2. CloudFormation - platform stack (flat + nested stack + adoption-fields case)

**Input:** `main.template.yaml` with S3 bucket (versioning), DynamoDB table, a VPC (identifier only exists at deploy time), a nested stack `MessagingStack` (child template: SNS Topic + SQS Queue + Subscription wired via `!Ref`/`!GetAtt`), and a Log Group.

**Pass/Fail checks:**

```text
✅ 3 flat ACK manifests generated (Bucket with versioning mapped, Table, VPC)
✅ VPC emitted with TODO(discovery) + exact CLI command
   (aws ec2 describe-vpcs --filters cidr-block) and placeholder adoption-fields -
   listed in the report's "Requires Discovery" section, per exit criterion 3
✅ Nested stack -> kro RGD "messaging": stack Parameters became schema fields,
   !Ref/!GetAtt wiring became CEL (${eventsTopic.status.ackResourceMetadata.arn}),
   RGD status surfaces topicARN, + instance CR with the parent stack's parameter values
✅ AWS::Logs::LogGroup flagged report-only
✅ SNS Subscription conservatively flagged (see footnote ¹) - never guessed
✅ Source templates byte-identical; 0 CFN syntax remnants in outputs; 5/5 annotation audit
```

### 3. Pulumi (Python) - platform program (flat + ComponentResource)

**Input:** `__main__.py` with `pulumi_aws`: S3 BucketV2, DynamoDB table, a `QueueWithDlq(pulumi.ComponentResource)` class instantiated as `billing` with `max_receive_count=3`, and a CloudWatch Log Group.

**Pass/Fail checks:**

```text
✅ 2 flat ACK manifests generated (Bucket from BucketV2, Table with keySchema mapped)
✅ ComponentResource -> kro RGD "queue-with-dlq": class constructor params became
   schema fields, the .apply() redrive wiring became CEL, + instance CR correctly
   capturing the per-instance override maxReceiveCount: 3 (not the default 5)
✅ aws.cloudwatch.LogGroup flagged report-only
✅ Source program byte-identical; 0 Pulumi syntax remnants (.apply(), pulumi.*)
   in outputs; 4/4 annotation audit
```

---

## Exit Criteria Compliance (per SKILL.md)

| # | Exit Criterion | Run 1 (TF) | Run 2 (CFN) | Run 3 (Pulumi) |
|---|---|---|---|---|
| 1 | One manifest/RGD slot per supported resource, no duplicates or silent drops | ✅ | ✅ | ✅ |
| 2 | 100% of manifests carry adopt-or-create + retain | ✅ 5/5 | ✅ 5/5 | ✅ 4/4 |
| 3 | adoption-fields resolved or TODO(discovery) + report | ✅ | ✅ (VPC) | ✅ |
| 4 | RGDs only for genuine composition units, with instance CRs, CEL refs | ✅ | ✅ | ✅ |
| 5 | No IaC syntax remnants in generated files | ✅ | ✅ | ✅ |
| 6 | Generated YAML parses cleanly | ✅ | ✅ | ✅ |
| 7 | Source IaC byte-identical | ✅ | ✅ | ✅ |
| 8 | ADOPTION_REPORT.md complete | ✅ | ✅ | ✅ |

---

## Validation Commands Used

```bash
# Annotation audit (every document, including RGD-embedded templates)
python3 - <<'EOF'
import yaml, glob
for f in glob.glob('ack-adoption/*.yaml'):
    for d in yaml.safe_load_all(open(f)):
        ...  # assert adoption-policy + deletion-policy on every ACK resource
EOF

# IaC syntax remnant scan (per flavor)
grep -rE '\$\{var\.|\$\{module\.|!Ref|!GetAtt|\.apply\(|pulumi\.' ack-adoption/

# Source integrity
git diff <baseline-commit> HEAD -- <source files>
```

---

## Runtime Adoption Proof (2026-08-28/29, live EKS cluster)

The audits above prove the annotations are **present in the YAML** - an indirect signal. This
section proves the semantics themselves, on a live cluster (`atx-ack-lab`, EKS 1.33,
us-east-1, an AWS lab account), using manifests **generated by this definition** from a real
Terraform fixture (S3 bucket with versioning + DynamoDB PAY_PER_REQUEST table, both created by
`terraform apply` first).

**The claim under test:** `services.k8s.aws/adoption-policy: adopt-or-create` ADOPTS the
existing AWS resource instead of recreating it, and `services.k8s.aws/deletion-policy: retain`
PRESERVES the AWS resource when the CR is deleted.

**Method:** physical-identifier comparison. A DynamoDB `TableId` and an S3 bucket
`CreationDate` are immutable per physical resource - if the controller had recreated the
resource, they would change.

| Phase | Assertion | Result |
|---|---|---|
| Baseline | `TableId a78832d2-1247-47a6-b3db-802dc13bac1d`, bucket created `2026-08-29T00:53:56Z` | captured pre-adoption |
| Adoption (`kubectl apply` of the generated manifests) | Both CRs reach `ACK.ResourceSynced: True` | PASS |
| **Adopt, not recreate** | `TableId` and bucket `CreationDate` byte-identical to baseline after sync | **PASS** |
| CR deletion (`kubectl delete bucket/table`) | CRs gone from the namespace | PASS |
| **Retain preserves** | Bucket answers `head-bucket`, table `ACTIVE` with the SAME `TableId`, after both CRs deleted | **PASS** |

Controllers: `s3-controller` and `dynamodb-controller`, chart/app **1.12.0**, credentials via
the node instance role.

### Version trap found while proving it (worth the whole exercise)

With controller **1.1.0**, the DynamoDB Table CR went **`ACK.Terminal: True` with
"Resource already exists"** - the controller attempted a CREATE and treated the existing table
as a fatal conflict, exactly the failure mode the annotation is supposed to prevent. The S3
controller 1.1.0 adopted fine. Upgrading the chart to **1.12.0** and recreating the CR produced
a clean adoption of the same physical table.

Consequences for the definition's guidance:

1. `adopt-or-create` is honored **only by controller versions that ship adoption support** -
   an old controller fails Terminal instead of adopting, and a Terminal condition does NOT
   self-heal on controller upgrade: the CR must be recreated.
2. The `ADOPTION_REPORT.md` should tell the operator to verify the installed controller
   version before applying (candidate `SKILL.md` improvement, batched for the next revision).

Evidence files: `pre-adoption-identifiers.txt`, `post-adoption-identifiers.txt`,
`post-delete-evidence.txt` (identifier snapshots per phase).

---

## Crossplane Flavor Extension (2026-08-29)

The definition gained Crossplane as a fourth IaC flavor (`references/crossplane-to-ack-kro.md`):
Managed Resources map to ACK manifests (with `crossplane.io/external-name` as the
highest-fidelity identifier source of any flavor), and `Composition` + XRD pairs map to kro
`ResourceGraphDefinition`s. Validated on a seeded fixture covering both layers plus the edge
semantics (a `deletionPolicy: Delete` MR, an Observe-only MR, `connectionDetails`, a string
`fmt` transform):

| Assertion | Result |
|---|---|
| Source integrity (`git diff` vs baseline outside `ack-adoption/`) | **0 files** |
| `crossplane.io/external-name` used as the AWS identifier (`acme-reports-prod`, `shop-sessions`) | PASS |
| Composition + XRD → one RGD, patches → CEL (`${schema.spec.queueName}-dlq`, sibling ref `${dlq.status...arn}`) | PASS |
| Claim instance → kro instance CR | PASS |
| No Crossplane syntax (`forProvider`, `*.upbound.io`) survives in emitted manifests | PASS |
| Annotation audit (adopt-or-create + retain on every ACK document incl. RGD templates) | PASS |
| `deletionPolicy: Delete` → retain, with the delete-semantics change called out in the report | PASS |
| `managementPolicies: ["Observe"]` recognized as read-only import intent | PASS |
| `connectionDetails` degraded to report-only with a migration section | PASS |
| Cutover guidance: pause Crossplane (`crossplane.io/paused`), flip `deletionPolicy` to `Orphan` before decommission | PASS |
| Agent minutes / cost | 38.99 / ~US$ 1.36 |

Validator invocation for this def's contract (output dir and report name differ from the
other definitions): `OUT_DIR=ack-adoption REPORT_NAME=ADOPTION_REPORT.md assert_def_run.py`.

Known variance, batched with the collection-wide report-contract revision: the generated
`ADOPTION_REPORT.md` prose contains em dash characters (U+2014); no definition in this
collection pins the punctuation rule yet (the new `flux-to-argocd` does, and is the template
for the fix).
