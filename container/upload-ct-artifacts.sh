#!/bin/bash
# upload-ct-artifacts.sh — uploads ATX Control Tower analysis/remediation
# artifacts to S3. Runs inside the Batch container before exit.
#
# For each selected conversation directory under ~/.aws/atx/custom/, reads
# its metadata.json to discover its repo path, and uploads:
#   - code.zip — the working directory (TD-agnostic; mirrors upload-results.sh)
#   - logs.zip — cherry-picked debug logs (mirrors upload-results.sh)
# to s3://${CT_OUTPUT_BUCKET}/${ANALYSIS_ID}/<repo-slug>/.
#
# Differs from upload-results.sh in that:
#   - upload-results.sh picks ONE conversation (ls -t | head -n 1).
#     This script processes one or more conversations; ATX CT can produce
#     multiple per container, and the caller can scope which ones to upload.
#   - upload-results.sh zips /source/. This script zips each conversation's
#     codeRepositoryPath (from metadata.json), since CT manages source dirs
#     under ~/.atxct/sources/... not /source/.
#
# Usage:
#   upload-ct-artifacts.sh <analysis-id> <ct-output-bucket> [conv-id ...]
#
# When conv-ids are provided, only those conversations are uploaded. When no
# conv-ids are provided, ALL conversations on disk are uploaded (legacy
# behavior). The latter is safe for single-run containers but produces
# cross-contamination when a long-running container has accumulated
# conversations from prior analyses or remediations under the new run's
# S3 prefix. Pass conv-ids when the caller knows which conversations belong
# to the current run (e.g., from Analysis.summary's convId.* entries
# populated by CR-278804433).
#
# Exit code: always 0. Upload failures are logged but do not fail the job —
# findings are already in FES (the primary deliverable for ATX CT analyses).

set -u

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"; }

ANALYSIS_ID="${1:-}"
S3_BUCKET="${2:-}"
shift 2 2>/dev/null || true
SELECTED_CONV_IDS=("$@")

if [[ -z "$ANALYSIS_ID" || -z "$S3_BUCKET" ]]; then
  log "Error: usage: upload-ct-artifacts.sh <analysis-id> <ct-output-bucket> [conv-id ...]"
  exit 1
fi

CONV_BASE="$HOME/.aws/atx/custom"
if [[ ! -d "$CONV_BASE" ]]; then
  log "No conversation directory at $CONV_BASE — nothing to upload"
  exit 0
fi

UPLOADED=0
SKIPPED=0
FAILED=0

# upload_conv: process a single conversation directory.
# Caller increments UPLOADED/SKIPPED/FAILED counters via stdout-parse.
upload_conv() {
  local conv_dir="$1"
  local CONV_ID
  CONV_ID=$(basename "$conv_dir")
  local META="$conv_dir/metadata.json"

  if [[ ! -d "$conv_dir" ]]; then
    log "Skipping $CONV_ID (directory not found)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  if [[ ! -f "$META" ]]; then
    log "Skipping $CONV_ID (no metadata.json)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  local REPO_PATH
  REPO_PATH=$(jq -r '.codeRepositoryPath // empty' "$META" 2>/dev/null)
  if [[ -z "$REPO_PATH" ]]; then
    log "Skipping $CONV_ID (no codeRepositoryPath in metadata.json)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  local REPO_SLUG
  REPO_SLUG=$(basename "$REPO_PATH")
  local S3_PREFIX="s3://${S3_BUCKET}/${ANALYSIS_ID}/${REPO_SLUG}"

  # code.zip — the entire working directory (whatever the TD wrote there)
  if [[ -d "$REPO_PATH" ]]; then
    if (cd "$REPO_PATH" && zip -qr /tmp/code.zip . \
        -x ".git/*" \
        -x ".env*" \
        -x "*.pem" \
        -x "*.key" \
        -x "node_modules/*" \
        -x ".aws/*"); then
      if aws s3 cp /tmp/code.zip "${S3_PREFIX}/code.zip" --quiet; then
        log "Uploaded ${S3_PREFIX}/code.zip"
      else
        log "Warning: failed to upload code.zip for $CONV_ID"
        FAILED=$((FAILED + 1))
      fi
      rm -f /tmp/code.zip
    else
      log "Warning: failed to zip $REPO_PATH for $CONV_ID"
      FAILED=$((FAILED + 1))
    fi
  else
    log "Warning: REPO_PATH $REPO_PATH does not exist for $CONV_ID"
  fi

  # logs.zip — cherry-pick the same files Custom's upload-results.sh picks
  local LOGS_STAGING
  LOGS_STAGING=$(mktemp -d /tmp/ct-logs-XXXX)
  cp "$HOME/.aws/atx/logs/debug"*.log "$LOGS_STAGING/" 2>/dev/null || true
  cp "$HOME/.aws/atx/logs/error.log" "$LOGS_STAGING/" 2>/dev/null || true
  cp "$conv_dir"/logs/*.log "$LOGS_STAGING/" 2>/dev/null || true
  cp "$conv_dir/plan.json" "$LOGS_STAGING/" 2>/dev/null || true
  cp "$conv_dir/artifacts/validation_summary.md" "$LOGS_STAGING/" 2>/dev/null || true

  if [[ -n "$(ls -A "$LOGS_STAGING" 2>/dev/null)" ]]; then
    if (cd "$LOGS_STAGING" && zip -qr /tmp/logs.zip .); then
      if aws s3 cp /tmp/logs.zip "${S3_PREFIX}/logs.zip" --quiet; then
        log "Uploaded ${S3_PREFIX}/logs.zip"
        UPLOADED=$((UPLOADED + 1))
      else
        log "Warning: failed to upload logs.zip for $CONV_ID"
        FAILED=$((FAILED + 1))
      fi
      rm -f /tmp/logs.zip
    else
      log "Warning: failed to zip logs for $CONV_ID"
      FAILED=$((FAILED + 1))
    fi
  else
    log "No logs found for $CONV_ID — skipping logs.zip"
  fi
  rm -rf "$LOGS_STAGING"
}

if [[ "${#SELECTED_CONV_IDS[@]}" -gt 0 ]]; then
  log "Processing ${#SELECTED_CONV_IDS[@]} explicitly-named conversation(s)"
  for conv_id in "${SELECTED_CONV_IDS[@]}"; do
    upload_conv "${CONV_BASE}/${conv_id}"
  done
else
  log "No conversation IDs specified — processing ALL conversations under $CONV_BASE"
  for conv_dir in "$CONV_BASE"/*/; do
    [[ -d "$conv_dir" ]] || continue
    upload_conv "$conv_dir"
  done
fi

log "ATX CT artifact upload complete: uploaded=$UPLOADED skipped=$SKIPPED failed=$FAILED analysis_id=$ANALYSIS_ID"
exit 0
