#!/usr/bin/env bash
set -euo pipefail

# Ensure we never leave the caller (the ATX agent) with silence. If the script
# exits before the report is printed, say so clearly. A failed Release Readiness Review is NOT a blocker.
DONE=0
trap 'rc=$?; if [[ $DONE -eq 0 ]]; then echo "" >&2; echo "The Release Readiness Review did not complete (see the error above). This is not a blocker: tell the user what went wrong and proceed with completing the transformation." >&2; fi; exit $rc' EXIT

# Release Readiness Review via DevOps Agent APIs - Option A flow
# Usage: run_release_readiness_review.sh --agent-space-arn ARN --repository org/repo --pr-number NUM [--region REGION] [--profile PROFILE]
#
# NOTE: The Release Readiness Review (DevOps Agent) is currently only available
# in us-east-1. Region defaults to us-east-1; do not override it with another region.

REGION="${AWS_REGION:-us-east-1}"
AGENT_SPACE_ARN="${AGENT_SPACE_ARN:-}"
REPOSITORY=""   # per-invocation; provided via --repository
PR_NUMBER=""    # per-invocation; provided via --pr-number
PROFILE="${DEVOPS_AWS_PROFILE:-}"
POLL_INTERVAL=30
MAX_POLL_ATTEMPTS=90  # 45 min at 30s intervals

PROVIDER=""  # github|gitlab; auto-detected from the git remote, override with --provider

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-space-arn) AGENT_SPACE_ARN="$2"; shift 2;;
    --repository) REPOSITORY="$2"; shift 2;;
    --pr-number) PR_NUMBER="$2"; shift 2;;
    --region) REGION="$2"; shift 2;;
    --profile) PROFILE="$2"; shift 2;;
    --provider) PROVIDER="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

: "${AGENT_SPACE_ARN:?Required: --agent-space-arn or AGENT_SPACE_ARN env var}"
: "${REPOSITORY:?Required: --repository}"
: "${PR_NUMBER:?Required: --pr-number}"

# Normalize the repository identifier: strip leading/trailing slashes that are
# common copy-paste artifacts (e.g. "org/repo/" from a URL bar). The normalized
# form is what we match against associations and send to the API.
REPOSITORY="${REPOSITORY#/}"
REPOSITORY="${REPOSITORY%/}"

# The Release Readiness Review (DevOps Agent) is only available in us-east-1.
if [[ "$REGION" != "us-east-1" ]]; then
  echo "Release Readiness Review could not run: it is only available in us-east-1, but region '$REGION' was requested." >&2
  echo "Unset AWS_REGION / --region (defaults to us-east-1) or set it to us-east-1." >&2
  exit 1
fi

# Determine the Git provider. Use the explicit override if given, otherwise
# auto-detect from the origin remote. Only GitHub and GitLab are supported;
# anything else is rejected with a clear message. For GitLab, --pr-number is
# treated as the MR iid.
if [[ -z "$PROVIDER" ]]; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
  if [[ -z "$REMOTE_URL" ]]; then
    echo "Release Readiness Review could not run: unable to determine the Git provider (no 'origin' remote found)." >&2
    echo "Run from a Git repository whose remote is GitHub or GitLab, or pass --provider github|gitlab." >&2
    exit 1
  fi
  case "$REMOTE_URL" in
    https://*|http://*) HOST_SEGMENT="${REMOTE_URL#*://}"; HOST_SEGMENT="${HOST_SEGMENT#*@}"; HOST_SEGMENT="${HOST_SEGMENT%%/*}";;
    ssh://*)            HOST_SEGMENT="${REMOTE_URL#ssh://}"; HOST_SEGMENT="${HOST_SEGMENT#*@}"; HOST_SEGMENT="${HOST_SEGMENT%%[/:]*}";;
    *@*)                HOST_SEGMENT="${REMOTE_URL#*@}"; HOST_SEGMENT="${HOST_SEGMENT%%:*}";;
    *)                  HOST_SEGMENT="${REMOTE_URL%%[/:]*}";;
  esac
  # Match on the host portion only, so a repo/path segment such as
  # 'github-tools' in a GitLab URL cannot be misclassified as GitHub.
  case "$HOST_SEGMENT" in
    *github*) PROVIDER="github";;
    *gitlab*) PROVIDER="gitlab";;
    *)
      echo "Release Readiness Review could not run: unsupported Git provider for remote host '$HOST_SEGMENT' (remote '$REMOTE_URL')." >&2
      echo "Only GitHub and GitLab are supported. Override with --provider github|gitlab if needed." >&2
      exit 1;;
  esac
fi

if [[ "$PROVIDER" != "github" && "$PROVIDER" != "gitlab" ]]; then
  echo "Release Readiness Review could not run: unsupported provider '$PROVIDER'." >&2
  echo "Supported providers: github, gitlab." >&2
  exit 1
fi

# Validate ARN shape up front — a malformed ARN otherwise fails later with a confusing error
if [[ ! "$AGENT_SPACE_ARN" =~ ^arn:aws:[a-z0-9-]+:[a-z0-9-]+:[0-9]{12}:agent-space/[0-9a-fA-F-]{36}$ ]]; then
  echo "Release Readiness Review could not run: AGENT_SPACE_ARN is malformed: '$AGENT_SPACE_ARN'" >&2
  echo "Expected: arn:aws:<service>:<region>:<account-id>:agent-space/<uuid>" >&2
  exit 1
fi

# Extract ID from ARN (arn:aws:aidevops:REGION:ACCOUNT:agent-space/ID)
AGENT_SPACE_ID="${AGENT_SPACE_ARN##*/}"

# Build profile args if set
PROFILE_ARGS=()
if [[ -n "$PROFILE" ]]; then
  PROFILE_ARGS=(--profile "$PROFILE")
fi

echo "=== Release Readiness Review ===" >&2
echo "Agent Space: $AGENT_SPACE_ID" >&2
echo "Provider:   $PROVIDER" >&2
echo "Repository: $REPOSITORY" >&2
echo "Change #:   $PR_NUMBER" >&2
[[ -n "$PROFILE" ]] && echo "Profile:    $PROFILE" >&2

# 1. Verify repo association
echo "Checking repository association..." >&2
ASSOCIATIONS=$(aws devops-agent list-associations \
  --agent-space-id "$AGENT_SPACE_ID" \
  --region "$REGION" \
  ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
  --output json)

REPO_NAME=$(echo "$REPOSITORY" | cut -d'/' -f2)
REPO_OWNER=$(echo "$REPOSITORY" | cut -d'/' -f1)

# Match the association under the provider-specific config block.
# GitHub keys on owner + repoName; GitLab keys on the full projectPath.
if [[ "$PROVIDER" == "gitlab" ]]; then
  MATCH=$(echo "$ASSOCIATIONS" | jq -r --arg path "$REPOSITORY" \
    '.associations[] | select(.configuration.gitlab.projectPath == $path) | .associationId' 2>/dev/null || true)
else
  MATCH=$(echo "$ASSOCIATIONS" | jq -r --arg name "$REPO_NAME" --arg owner "$REPO_OWNER" \
    '.associations[] | select(.configuration.github.repoName == $name and .configuration.github.owner == $owner) | .associationId' 2>/dev/null || true)
fi

if [[ -z "$MATCH" ]]; then
  echo "Repository $REPOSITORY is not associated with Agent Space $AGENT_SPACE_ID (provider: $PROVIDER)" >&2
  echo "Available associations:" >&2
  echo "$ASSOCIATIONS" | jq -r '.associations[]? | .configuration as $c | if $c.github then "\($c.github.owner)/\($c.github.repoName)" elif $c.gitlab then $c.gitlab.projectPath else empty end' >&2
  exit 1
fi
echo "Found association: $MATCH" >&2

# Resolve the instance host for Enterprise / self-managed servers.
# Left empty for the public hosts (github.com / gitlab.com), where hostname is omitted.
if [[ "$PROVIDER" == "gitlab" ]]; then
  INSTANCE=$(echo "$ASSOCIATIONS" | jq -r --arg path "$REPOSITORY" \
    '.associations[] | select(.configuration.gitlab.projectPath == $path) | .configuration.gitlab.instanceIdentifier // empty' 2>/dev/null | head -1)
  DEFAULT_HOST="gitlab.com"
else
  INSTANCE=$(echo "$ASSOCIATIONS" | jq -r --arg name "$REPO_NAME" --arg owner "$REPO_OWNER" \
    '.associations[] | select(.configuration.github.repoName == $name and .configuration.github.owner == $owner) | .configuration.github.instanceIdentifier // empty' 2>/dev/null | head -1)
  DEFAULT_HOST="github.com"
fi
HOSTNAME=""
if [[ -n "$INSTANCE" && "$INSTANCE" != "$DEFAULT_HOST" ]]; then
  HOSTNAME="$INSTANCE"
  echo "Instance host: $HOSTNAME" >&2
fi

# 2. Create backlog task (trigger Release Readiness Review)
echo "Triggering Release Readiness Review..." >&2
if [[ "$PROVIDER" == "gitlab" ]]; then
  # GitLab: --pr-number carries the merge request iid; repository is the full projectPath
  ITEM=$(jq -nc --arg repo "$REPOSITORY" --arg mr "$PR_NUMBER" --arg host "$HOSTNAME" \
    '{repository: $repo, mergeRequestIid: $mr} + (if $host != "" then {hostname: $host} else {} end)')
  DESCRIPTION=$(jq -nc --argjson item "$ITEM" '{agentInput: {content: {gitlabMrContent: [$item]}}}')
else
  ITEM=$(jq -nc --arg repo "$REPOSITORY" --arg pr "$PR_NUMBER" --arg host "$HOSTNAME" \
    '{repository: $repo, prNumber: $pr} + (if $host != "" then {hostname: $host} else {} end)')
  DESCRIPTION=$(jq -nc --argjson item "$ITEM" '{agentInput: {content: {githubPrContent: [$item]}}}')
fi

TASK_RESPONSE=$(aws devops-agent create-backlog-task \
  --agent-space-id "$AGENT_SPACE_ID" \
  --task-type "RELEASE_READINESS_REVIEW" \
  --title "Release Readiness Review: ATX transformation validation" \
  --description "$DESCRIPTION" \
  --priority "HIGH" \
  --region "$REGION" \
  ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
  --output json)

TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.task.taskId')
echo "Task created: $TASK_ID" >&2

# 3. Poll until complete
echo "Polling for completion (up to ${MAX_POLL_ATTEMPTS} attempts, ${POLL_INTERVAL}s interval)..." >&2
for i in $(seq 1 $MAX_POLL_ATTEMPTS); do
  TASK_STATUS=$(aws devops-agent get-backlog-task \
    --agent-space-id "$AGENT_SPACE_ID" \
    --task-id "$TASK_ID" \
    --region "$REGION" \
    ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
    --output json)

  STATUS=$(echo "$TASK_STATUS" | jq -r '.task.status')
  echo "  [$i/$MAX_POLL_ATTEMPTS] Status: $STATUS" >&2

  case "$STATUS" in
    COMPLETED) break;;
    FAILED|TIMED_OUT)
      echo "ERROR: Task ended with status: $STATUS" >&2
      echo "$TASK_STATUS" | jq . >&2
      exit 1;;
  esac
  sleep "$POLL_INTERVAL"
done

if [[ "$STATUS" != "COMPLETED" ]]; then
  echo "ERROR: Timed out waiting for task completion" >&2
  exit 1
fi

# 4. Get execution ID
echo "Fetching execution..." >&2
EXECUTIONS=$(aws devops-agent list-executions \
  --agent-space-id "$AGENT_SPACE_ID" \
  --task-id "$TASK_ID" \
  --region "$REGION" \
  ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
  --output json)

EXECUTION_ID=$(echo "$EXECUTIONS" | jq -r '.executions[0].executionId // empty')
if [[ -z "$EXECUTION_ID" || "$EXECUTION_ID" == "null" ]]; then
  echo "Release Readiness Review could not run: task $TASK_ID completed but no execution is visible yet. Retry shortly." >&2
  exit 1
fi
echo "Execution: $EXECUTION_ID" >&2

# 5. Get risk report
echo "Fetching risk report..." >&2
JOURNAL=$(aws devops-agent list-journal-records \
  --agent-space-id "$AGENT_SPACE_ID" \
  --execution-id "$EXECUTION_ID" \
  --record-type "release_analysis_report" \
  --region "$REGION" \
  ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
  --output json)

# Output the report JSON to stdout
# The content field is a JSON string with structure: {type: "release_analysis_report", report: {...}}
REPORT=$(echo "$JOURNAL" | jq -r '.records[0].content // empty' | jq -r '.report // empty')
if [[ -z "$REPORT" || "$REPORT" == "null" ]]; then
  echo "Release Readiness Review could not run: no risk report found in the journal records for execution $EXECUTION_ID." >&2
  exit 1
fi
echo "$REPORT"
DONE=1  # report produced; the run succeeded regardless of the recommendation

# Summary to stderr. This runs after DONE=1 and is purely informational, so it
# must never be able to fail the script (a jq error here would otherwise be
# masked by the EXIT trap and surface as a confusing non-zero exit).
ACTION=$(echo "$REPORT" | jq -r '.recommendedAction // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
RISK_COUNT=$(echo "$REPORT" | jq -r '(.risks // []) | (if type == "array" then length else 0 end)' 2>/dev/null || echo 0)
echo "" >&2
echo "=== RESULT ===" >&2
echo "Recommended Action: $ACTION" >&2
echo "Risks Found: $RISK_COUNT" >&2

if [[ "$ACTION" != "Standard Deployment" ]]; then
  echo "" >&2
  echo "Critical risks:" >&2
  echo "$REPORT" | jq -r '(.risks // []) | (if type == "array" then .[] else empty end) | select(.severity == "critical") | "  - \(.title): \(.description)"' 2>/dev/null >&2 || true
fi
