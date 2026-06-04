#!/bin/bash
#
# upload-ct-artifacts.sh — Upload ATX CT analysis or remediation artifacts to S3.
#
# Iterates analysis.repos[] (or remediation.repos.keys[]) for the given ID and
# zips each repo's working directory directly to S3 at:
#   s3://<bucket>/<id>/<source-name>::<repo-name>/code.zip
#
# Self-contained: sources nvm and exports PATH so the script works whether
# invoked from a chain that already set up env or fresh.
#
# Usage: upload-ct-artifacts.sh <analysis-id-or-remediation-id> <ct-output-bucket>
#
# Notes:
# - Tries the ID as an analysis first; falls back to remediation if not found.
# - Path layout per provider:
#     github / gitlab → /home/atxuser/.atxct/sources/<source>/repos/<full-slug>
#     local           → /home/atxuser/repos/<repo-name>
# - Findings are persisted to the CT backend during the analysis/remediation
#   itself; this script only handles the working-dir code.zip upload.
# - Exit code is always 0. Upload failures are logged but don't fail the job.
set -u

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"; }

# Self-setup: ensure atx ct gamma + Node 22 are available
[ -s /home/atxuser/.nvm/nvm.sh ] && source /home/atxuser/.nvm/nvm.sh 2>/dev/null && nvm use 22 >/dev/null 2>&1
# Prepend atx's install location to PATH; do NOT overwrite — that loses nvm's Node 22 path
export PATH=/home/atxuser/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}

ANALYSIS_ID="${1:-}"
S3_BUCKET="${2:-}"

if [[ -z "$ANALYSIS_ID" || -z "$S3_BUCKET" ]]; then
  log "Error: usage: upload-ct-artifacts.sh <analysis-id-or-remediation-id> <ct-output-bucket>"
  exit 1
fi

# Try analysis first via --json (supported)
REPOS=$(atx ct analysis get --id "$ANALYSIS_ID" --json 2>/dev/null | jq -r '.repos[]?')

# Fall back to remediation status (which does NOT support --json — parse text output).
# Text format:
#   ID:     01...
#   Name:   ...
#   Status: ...
#     <source>::<repo>  <repo-status>  /path  (branch: ...)
# We extract the source-qualified repo slugs (any token containing '::') and dedupe.
if [[ -z "$REPOS" ]]; then
  REPOS=$(atx ct remediation status --id "$ANALYSIS_ID" 2>/dev/null \
    | grep -oE '[a-zA-Z0-9_-]+::[a-zA-Z0-9_.-]+' \
    | sort -u)
fi

if [[ -z "$REPOS" ]]; then
  log "No repos found for $ANALYSIS_ID (not an analysis or remediation, or has no repos)"
  exit 0
fi

UPLOADED=0
FAILED=0
SKIPPED=0

for slug in $REPOS; do
  source_name=$(echo "$slug" | awk -F'::' '{print $1}')
  repo_name=$(echo "$slug" | awk -F'::' '{print $2}')

  provider=$(atx ct source list --json 2>/dev/null | jq -r ".[] | select(.source==\"$source_name\") | .provider")
  case "$provider" in
    github|gitlab) repo_path="/home/atxuser/.atxct/sources/$source_name/repos/$slug" ;;
    local)         repo_path="/home/atxuser/repos/$repo_name" ;;
    *)
      log "Skip $slug — unknown provider '$provider'"
      SKIPPED=$((SKIPPED + 1))
      continue
      ;;
  esac

  if [[ ! -d "$repo_path" ]]; then
    log "Skip $slug — path not found: $repo_path"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if (cd "$repo_path" && zip -qry /tmp/code.zip . -x '.env*' -x '*.pem' -x '*.key' -x 'node_modules/*' -x '.aws/*'); then
    if aws s3 cp /tmp/code.zip "s3://${S3_BUCKET}/${ANALYSIS_ID}/${slug}/code.zip" --quiet; then
      log "Uploaded $slug → s3://${S3_BUCKET}/${ANALYSIS_ID}/${slug}/code.zip"
      UPLOADED=$((UPLOADED + 1))
    else
      log "Upload failed for $slug"
      FAILED=$((FAILED + 1))
    fi
  else
    log "Zip failed for $slug at $repo_path"
    FAILED=$((FAILED + 1))
  fi

  rm -f /tmp/code.zip
done

log "ATX CT artifact upload complete: uploaded=$UPLOADED skipped=$SKIPPED failed=$FAILED analysis_id=$ANALYSIS_ID"
exit 0
