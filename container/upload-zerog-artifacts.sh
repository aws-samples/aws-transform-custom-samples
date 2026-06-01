#!/bin/bash
# upload-zerog-artifacts.sh — uploads ZeroG (ATX Control Tower) analysis/remediation
# artifacts to S3. Runs inside the Batch container before exit.
#
# Iterates ALL conversation directories under ~/.aws/atx/custom/, reads each
# conversation's metadata.json to discover its repo path, and uploads:
#   - reports.zip       (the repo's ATXDocumentation/ folder — analysis output)
#   - conversation.zip  (the conversation directory: artifacts/, logs/, metadata.json, ...)
# to s3://${CT_OUTPUT_BUCKET}/${ANALYSIS_ID}/<repo-slug>/.
#
# Different from upload-results.sh:
#   - upload-results.sh picks ONE conversation (ls -t | head -n 1) and zips /source/.
#   - This script iterates ALL conversations; ZeroG analyses produce N conversations
#     (one per repo) in a single container's lifetime.
#
# Usage:
#   upload-zerog-artifacts.sh <analysis-id> <ct-output-bucket>
#
# Exit code: always 0. Upload failures are logged but do not fail the job —
# findings are already in FES (the primary deliverable for ZeroG analyses).

set -u

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"; }

ANALYSIS_ID="${1:-}"
S3_BUCKET="${2:-}"

if [[ -z "$ANALYSIS_ID" || -z "$S3_BUCKET" ]]; then
  log "Error: usage: upload-zerog-artifacts.sh <analysis-id> <ct-output-bucket>"
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

for conv_dir in "$CONV_BASE"/*/; do
  [[ -d "$conv_dir" ]] || continue
  CONV_ID=$(basename "$conv_dir")
  META="$conv_dir/metadata.json"

  if [[ ! -f "$META" ]]; then
    log "Skipping $CONV_ID (no metadata.json)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  REPO_PATH=$(jq -r '.codeRepositoryPath // empty' "$META" 2>/dev/null)
  if [[ -z "$REPO_PATH" ]]; then
    log "Skipping $CONV_ID (no codeRepositoryPath in metadata.json)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  REPO_SLUG=$(basename "$REPO_PATH")
  S3_PREFIX="s3://${S3_BUCKET}/${ANALYSIS_ID}/${REPO_SLUG}"

  # reports.zip — ATXDocumentation/ from the repo dir (analysis output)
  if [[ -d "$REPO_PATH/ATXDocumentation" ]]; then
    if (cd "$REPO_PATH" && zip -qr /tmp/reports.zip ATXDocumentation/); then
      if aws s3 cp /tmp/reports.zip "${S3_PREFIX}/reports.zip" --quiet; then
        log "Uploaded ${S3_PREFIX}/reports.zip"
      else
        log "Warning: failed to upload reports.zip for $CONV_ID"
        FAILED=$((FAILED + 1))
      fi
      rm -f /tmp/reports.zip
    else
      log "Warning: failed to zip ATXDocumentation/ for $CONV_ID"
      FAILED=$((FAILED + 1))
    fi
  else
    log "No ATXDocumentation/ in $REPO_PATH — skipping reports.zip for $CONV_ID"
  fi

  # conversation.zip — entire conversation directory (logs, artifacts, metadata, mcp_usage)
  if (cd "$conv_dir" && zip -qr /tmp/conversation.zip .); then
    if aws s3 cp /tmp/conversation.zip "${S3_PREFIX}/conversation.zip" --quiet; then
      log "Uploaded ${S3_PREFIX}/conversation.zip"
      UPLOADED=$((UPLOADED + 1))
    else
      log "Warning: failed to upload conversation.zip for $CONV_ID"
      FAILED=$((FAILED + 1))
    fi
    rm -f /tmp/conversation.zip
  else
    log "Warning: failed to zip conversation directory for $CONV_ID"
    FAILED=$((FAILED + 1))
  fi
done

log "ZeroG artifact upload complete: uploaded=$UPLOADED skipped=$SKIPPED failed=$FAILED analysis_id=$ANALYSIS_ID"
exit 0
