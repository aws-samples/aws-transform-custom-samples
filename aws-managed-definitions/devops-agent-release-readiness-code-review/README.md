# AWS DevOps Agent - Release Readiness Code Review

A client-side ATX skill that runs a **Release Readiness Review** via
[AWS DevOps Agent](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html)
on a transformation's code changes before the transformation is marked complete. It acts
as the final quality gate: after ATX finishes its changes and the build/tests pass, the
skill submits the changes (via a draft PR) to AWS DevOps Agent and surfaces any deployment
risks so ATX can iterate before handing off.

## What it does

1. Has ATX create a **draft** pull/merge request for its changes.
2. Triggers a Release Readiness Review against that change via the DevOps Agent APIs.
3. Polls until the review completes and returns a structured risk report.
4. If the report recommends anything other than `Standard Deployment`, ATX fixes the
   flagged risks, re-validates, updates the PR, and re-runs the review.

A review that **fails to run** (missing setup, no association, permissions, etc.) never
blocks the transformation - the skill reports the reason and ATX proceeds. Only a review
that actually returns risks causes ATX to iterate.

## How it works

`scripts/run_release_readiness_review.sh` performs the API-driven flow:

1. `list-associations` - verifies the repo is associated with the Agent Space
2. `create-backlog-task` - triggers the review (task type `RELEASE_READINESS_REVIEW`)
3. `get-backlog-task` - polls until `COMPLETED`/`FAILED` (up to 45 minutes)
4. `list-executions` - resolves the execution
5. `list-journal-records --record-type release_analysis_report` - fetches the risk report

The script writes only the risk report JSON to stdout; all progress and diagnostics go to
stderr.

## Installation

Copy this folder into a location where ATX discovers skills in your repository. The
conventional location is:

```
.aws/atx/skills/devops-agent-release-readiness-code-review/
├── SKILL.md
└── scripts/
    └── run_release_readiness_review.sh
```

You may place it elsewhere - the `SKILL.md` references the script by a `<skill-dir>`
placeholder, so adjust the invocation path to wherever you install it.

## Provider support

The provider is auto-detected from the repo's `origin` remote (override with
`--provider github|gitlab`). Supported:

- **GitHub** (github.com and GitHub Enterprise Server)
- **GitLab** (gitlab.com and self-managed, including nested group paths)

For Enterprise / self-managed instances the host is taken from the association's
`instanceIdentifier`; for the public hosts it is omitted.

## Configuration

| Env var | CLI flag | Description |
|---------|----------|-------------|
| `AGENT_SPACE_ARN` | `--agent-space-arn` | DevOps Agent Space ARN (constant per customer) |
| `AWS_REGION` | `--region` | AWS region; defaults to `us-east-1` (the only supported region) |
| `DEVOPS_AWS_PROFILE` | `--profile` | Optional AWS profile; uses default credentials if unset |
| - | `--repository` | `owner/repo` (GitHub) or full project path (GitLab); per-invocation, CLI only |
| - | `--pr-number` | PR number (GitHub) or MR iid (GitLab); per-invocation, CLI only |

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| AWS Transform CLI (atx) | Latest | Runs the transformation that triggers this skill |
| AWS CLI | v2 | Calls the DevOps Agent APIs |
| `gh` / `glab` | Latest | Creates the draft PR (GitHub) / MR (GitLab) |
| `jq` | Latest | Parses API responses |

You also need:

- The Release Readiness Review (AWS DevOps Agent) is currently **only available in `us-east-1`**.
- AWS credentials with `aidevops:CreateBacklogTask`, `GetBacklogTask`, `ListExecutions`,
  `ListJournalRecords`, and `ListAssociations` permissions.
- The target repository **associated** with your DevOps Agent Space. See
  [Configuring capabilities for AWS DevOps Agent](https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-capabilities-for-aws-devops-agent-connecting-to-cicd-pipelines-index.html).

To set up the AWS Transform CLI and authentication, see the
[AWS Transform Custom Getting Started Guide](https://docs.aws.amazon.com/transform/latest/userguide/custom-get-started.html).

## Getting Started

This is a gate skill: install it in your repository, then run any transformation and it
runs automatically as the final step (it is not executed on its own).

1. **Install the skill** - copy this folder into a skill-discovery location in your repo
   (see [Installation](#installation), conventionally `.aws/atx/skills/devops-agent-release-readiness-code-review/`).
2. **Set the Agent Space ARN:**
   ```bash
   export AGENT_SPACE_ARN=arn:aws:aidevops:us-east-1:<account-id>:agent-space/<agent-space-id>
   ```
3. **Ensure the repo is associated** with that Agent Space and a Git CLI (`gh`/`glab`) is authenticated.
4. **Run any transformation** - the skill triggers at the end:
   ```bash
   AWS_REGION=us-east-1 \
   AGENT_SPACE_ARN=arn:aws:aidevops:us-east-1:<account-id>:agent-space/<agent-space-id> \
   atx custom def exec -n AWS/java-aws-sdk-v1-to-v2 -p . -c "mvn clean test" -x -t
   ```

To exercise the review path directly (without running a full transformation), create a
draft PR first, then call the script:

```bash
AGENT_SPACE_ARN=arn:aws:aidevops:us-east-1:<account-id>:agent-space/<agent-space-id> \
bash <skill-dir>/scripts/run_release_readiness_review.sh \
  --repository "owner/repo" \
  --pr-number "1"
```

> The review typically takes 10-15 minutes (up to 45). Allow a generous timeout and let it
> run to completion; progress is printed every 30s.

## Reading the result

The script outputs the risk report JSON. Key field: `recommendedAction`.

- `Standard Deployment` - proceed and complete the transformation.
- Anything else - review the `risks` array, address `critical` / `high`-confidence items,
  then re-run.

## Troubleshooting

The script sends all diagnostics to stderr and only the risk report to stdout. A review
that cannot run is **never a blocker** - the script prints the reason and the
transformation still completes. Common messages and fixes:

| Message | Cause | Fix |
|---|---|---|
| `it is only available in us-east-1, but region 'X' was requested` | `AWS_REGION` / `--region` set to another region | Unset `AWS_REGION` (defaults to us-east-1) or set it to `us-east-1` |
| `unable to determine the Git provider (no 'origin' remote found)` | Not run inside a Git repo, or no `origin` remote | Run from the repo, ensure an `origin` remote exists, or pass `--provider github\|gitlab` |
| `unsupported Git provider for remote host '...'` | Remote host is not GitHub or GitLab | Only GitHub and GitLab are supported; override with `--provider` if auto-detection is wrong |
| `Repository ... is not associated ...` | The repo is not associated with the Agent Space | Associate the repo with your DevOps Agent Space (the message lists the associations it found) |
| `AGENT_SPACE_ARN is malformed` | ARN format is wrong | Use `arn:aws:aidevops:us-east-1:<account-id>:agent-space/<uuid>` |
| `Required: --repository` / `Required: --pr-number` | A required CLI arg is missing | Pass both `--repository` and `--pr-number` |
| `no risk report found in the journal records` | Review completed but produced no report (or records not yet visible) | Retry shortly; if it persists, check the execution in the Agent Space |
| `AccessDeniedException` / not authorized | Missing IAM permissions | Grant the `aidevops:*` permissions listed under Prerequisites |
| `did not complete ... This is not a blocker` | The review could not run for some reason | Expected behavior - read the preceding error, fix it if desired, and the transformation still completes |
