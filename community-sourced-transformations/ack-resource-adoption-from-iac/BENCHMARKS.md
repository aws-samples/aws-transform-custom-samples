# Benchmark Results - ACK Resource Adoption from IaC

## Executive Summary

| Metric | Result |
|--------|--------|
| Repositories tested | 1 (mixed Terraform: flat resources + module + unsupported type) |
| Transformation success rate | 100% (1/1) |
| Resources inventoried | 7 Terraform resources + 1 module instantiation |
| ACK manifests generated | 3 flat (S3, DynamoDB, IAM Role) |
| kro outputs generated | 1 ResourceGraphDefinition + 1 instance CR (queue-with-dlq module) |
| Safety annotation audit | 5/5 ACK manifests (flat + inside RGD) carry `adopt-or-create` + `deletion-policy: retain` (100%) |
| IaC syntax remnants in output | 0 (`!Ref`, `${var.`, `${module.` - none found) |
| Source IaC modified | 0 files (byte-identical to baseline) |
| Unsupported resources flagged | 1/1 (CloudWatch Log Group - report-only with roadmap guidance) |
| Resource folding | 1/1 (`aws_iam_role_policy_attachment` folded into the Role spec `policies` field) |
| `ADOPTION_REPORT.md` generated | Yes (inventory, skips, prerequisites, apply order) |
| Agent minutes | ~42.4 |
| Estimated cost | ~$1.48 (at $0.035/agent-minute) |

### Methodology

The test repository was seeded with a **known mix of adoption scenarios**, committed to git as a baseline, then transformed via:

```bash
atx custom def exec -n ack-resource-adoption-from-iac -p <repo> -x -t \
  --configuration 'additionalPlanContext=Adopt all resources.'
```

Results were verified against the git diff (what was generated), the exit criteria in [SKILL.md](SKILL.md), a programmatic annotation audit (YAML parse of every output document, including templates inside the RGD), and grep-based scans for IaC syntax remnants.

### Pricing Note

Agent minutes = active agent work (planning, reasoning, code generation). Client-side operations (file reads, validation) are not billed. Price: **$0.035 / agent minute**.

---

## Test Repository Composition

| Input (Terraform) | Scenario Exercised | Expected Output |
|---|---|---|
| `aws_s3_bucket.reports` | Flat resource, identifier in spec | Plain ACK `Bucket` manifest |
| `aws_dynamodb_table.orders` (key schema + tags) | Flat resource with structural spec mapping | Plain ACK `Table` manifest with keySchema/attributeDefinitions |
| `aws_iam_role.app` + `aws_iam_role_policy_attachment.app_s3` | Split-resource folding | ONE ACK `Role` manifest with the attachment folded into `spec.policies` |
| `module "order_queue"` (queue-with-dlq: 2 SQS queues wired via redrive policy) | Composition unit | kro `ResourceGraphDefinition` + instance CR, internal refs as CEL |
| `aws_cloudwatch_log_group.app` | Unsupported type (no GA ACK controller) | NO manifest - flagged in report with guidance |

---

## Results Detail

### Generated Files

```text
ack-adoption/
├── s3-bucket-reports.yaml       # Bucket, adopt-or-create + retain
├── dynamodb-table-orders.yaml   # Table, keySchema/attributes/tags mapped
├── iam-role-app.yaml            # Role with folded policy attachment
├── rgd-queue-with-dlq.yaml      # kro RGD: schema fields from module variables,
│                                #   2 Queue templates with adoption annotations,
│                                #   DLQ wiring via CEL (${dlq.status...})
└── instance-orders-queue.yaml   # Instance CR with the module's argument values
ADOPTION_REPORT.md
```

### Pass/Fail Checks

```text
✅ Annotation audit: 5/5 ACK resource documents (3 flat + 2 RGD templates) carry BOTH
   services.k8s.aws/adoption-policy: "adopt-or-create" AND
   services.k8s.aws/deletion-policy: "retain"
✅ Module inputs became RGD schema fields (queueName: string,
   maxReceiveCount: integer | default=5)
✅ Terraform interpolation replaced by CEL: ${schema.spec.queueName},
   ${dlq.status.ackResourceMetadata.arn} - zero IaC syntax remnants in any output
✅ aws_iam_role_policy_attachment correctly folded into Role spec.policies
   (no orphan manifest generated)
✅ aws_cloudwatch_log_group NOT converted - listed in ADOPTION_REPORT.md
   "Skipped Resources" with keep-in-Terraform guidance and ACK roadmap link
✅ Source IaC byte-identical to the pre-run git baseline (exit criterion 7)
✅ All generated YAML parses cleanly (7 documents across 5 files)
✅ ADOPTION_REPORT.md contains: inventory table, skipped resources with reasons,
   prerequisite checklist, dependency-sorted apply order
```

### Exit Criteria Compliance (per SKILL.md)

| # | Exit Criterion | Result |
|---|---|---|
| 1 | One manifest/RGD slot per supported resource, no duplicates or silent drops | ✅ 6 mapped -> 3 flat + 2 in RGD + 1 folded |
| 2 | 100% of manifests carry adopt-or-create + retain | ✅ 5/5 |
| 3 | adoption-fields resolved or TODO(discovery) + report | ✅ (identifiers in spec for this set) |
| 4 | RGDs only for genuine composition units, with instance CRs, CEL refs | ✅ 1 RGD + 1 instance |
| 5 | No IaC syntax remnants in generated files | ✅ 0 found |
| 6 | Generated YAML parses cleanly | ✅ 7/7 documents |
| 7 | Source IaC byte-identical | ✅ |
| 8 | ADOPTION_REPORT.md complete | ✅ |

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

# IaC syntax remnant scan
grep -rE '\$\{var\.|\$\{module\.|!Ref|!GetAtt' ack-adoption/

# Source integrity
git diff <baseline-commit> HEAD -- main.tf modules/
```
