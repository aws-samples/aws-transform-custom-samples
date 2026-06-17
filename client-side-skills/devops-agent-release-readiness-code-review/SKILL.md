---
name: devops-agent-release-readiness-code-review
description: Final review gate for every ATX transformation. Runs a Release Readiness Review on the transformation's code changes via a draft PR to catch deployment risks. MUST be invoked at the end of every transformation, after the build passes, tests pass, and changes are committed, and BEFORE marking the transformation complete, finalizing, wrapping up, declaring success, submitting, or handing off.
---
# Release Readiness Review

This skill is the final gate before a transformation is completed: it reviews the
transformation's committed code changes for deployment risks. Follow the steps below to
create a draft PR, run the review, and act on the result. If the review cannot run, that
never blocks completion (see step 5).

## Steps

### 1. Create a Draft Pull Request

Create a **draft** pull request for your changes on the repository's Git provider, then note its repository (`owner/repo`) and PR number to pass to the script in step 2.

Use the command appropriate for the repo's remote. For example, if the remote is **GitHub**, use the `gh` CLI:

```bash
gh pr create --draft --title "ATX: <transformation-description>" --body "Automated transformation - pending Release Readiness Review"

PR_NUMBER=$(gh pr view --json number -q '.number')
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
```

For other providers, use the equivalent command. For **GitLab**, open a draft merge request with `glab` and capture the project path and MR iid:

```bash
glab mr create --draft --title "ATX: <transformation-description>" --description "Automated transformation - pending Release Readiness Review"

PR_NUMBER=$(glab mr view --output json | jq -r '.iid')
REPO=$(glab repo view --output json | jq -r '.path_with_namespace')
```

The review script auto-detects the provider from the repo's `origin` remote, so you pass the repository and change number the same way for either provider (for GitLab, `--pr-number` is the MR iid).

### 2. Run the Release Readiness Review

Execute the Release Readiness Review script with the PR details. The script lives next to this `SKILL.md` under `scripts/`, so run it using the path to wherever this skill is installed:

```bash
bash <skill-dir>/scripts/run_release_readiness_review.sh \
  --agent-space-arn "$AGENT_SPACE_ARN" \
  --repository "$REPO" \
  --pr-number "$PR_NUMBER"
```

Replace `<skill-dir>` with the directory that contains this `SKILL.md` (for example, `.aws/atx/skills/devops-agent-release-readiness-code-review` if the skill is installed there).

Both `--repository` and `--pr-number` are required and must be passed on the command line:

- `--repository`: the full repository identifier.
  - GitHub: `owner/repo` (e.g. `my-org/my-service`)
  - GitLab: the full project path `namespace/project`, including any nested groups (e.g. `mygroup/subgroup/myproject`)
- `--pr-number`: the change number (digits only).
  - GitHub: the pull request number (e.g. `8`)
  - GitLab: the merge request iid (e.g. `8`)

> **This is a long-running command.** The review typically takes 10-15 minutes and can take up to 45 minutes. When you invoke it, set the command/tool timeout to **at least 45 minutes (2700s)** and let it run to completion — do not use a short timeout and do not interrupt it. The script polls and prints progress every 30s; that output is normal, not a hang. (The script enforces its own 45-minute cap internally.)

The `AGENT_SPACE_ARN` environment variable must be set to the customer's DevOps Agent Space ARN.

The AWS profile is **optional**: if `DEVOPS_AWS_PROFILE` (or `--profile`) is not set, the script uses the default AWS credentials. Set it only when the Agent Space lives in a different account/profile than the one ATX is running with (e.g. `DEVOPS_AWS_PROFILE=devops-agent`).

The script will:
- Verify the repository is associated with the Agent Space
- Trigger a Release Readiness Review task
- Poll until completion
- Output the structured risk report as JSON

**If the script fails for any reason** — missing setup, Agent Space not found, no permissions, repo not associated, task error — that is **not a blocker**. Read the error it printed, tell the user what went wrong, and proceed to complete the transformation. Only a report that actually came back and recommends against deployment should make you iterate (see below).

### 3. Review the Results

The script outputs a JSON risk report. Check these fields:

- `recommendedAction`: If `Standard Deployment`, proceed to complete the transformation.
- `recommendedAction`: If anything else (e.g., `Block Deployment`), review the `risks` array.

### 4. Iterate on Findings

If the report does NOT recommend `Standard Deployment`:

1. Read each risk in the `risks` array
2. For risks with `severity: "critical"`, apply the `suggestedFix` if provided
3. For risks with `confidenceLevel: "high"`, these are real issues - fix them
4. For risks with `confidenceLevel: "low"` or `severity: "low"`, use your judgment
5. After fixing, re-run validation (build command), commit changes, update the PR, and re-run step 2

If the report recommends `Standard Deployment`, proceed to complete the transformation.

### 5. Complete

Once the Release Readiness Review approves (or all critical risks are addressed), the transformation may be completed. If the Release Readiness Review could not run, note the reason for the user and complete the transformation — a failed review never blocks completion.
