#!/bin/bash
set -e

# Logging function with timestamps
log() {
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"
}

OUTPUT_PATH="$1"
S3_BUCKET="$2"

if [[ -z "$OUTPUT_PATH" ]]; then
    log "Error: Output path is required"
    exit 1
fi

if [[ -z "$S3_BUCKET" ]]; then
    log "Error: S3_BUCKET is required"
    exit 1
fi

# Remove leading/trailing slashes from OUTPUT_PATH
OUTPUT_PATH="${OUTPUT_PATH#/}"
OUTPUT_PATH="${OUTPUT_PATH%/}"

# Construct full S3 URL
S3_BASE_URL="s3://${S3_BUCKET}/${OUTPUT_PATH}"
[[ "$S3_BASE_URL" != */ ]] && S3_BASE_URL="${S3_BASE_URL}/"

# Find the conversation ID from ATX logs
CONVERSATION_ID=""
if [ -d "$HOME/.aws/atx/custom" ]; then
    CONVERSATION_ID=$(ls -t "$HOME/.aws/atx/custom" 2>/dev/null | head -n 1)
fi
if [[ -z "$CONVERSATION_ID" ]]; then
    CONVERSATION_ID="job_$(date +"%Y%m%d_%H%M%S")"
    log "No conversation ID found, using: $CONVERSATION_ID"
else
    log "Found conversation ID: $CONVERSATION_ID"
fi

S3_BASE="${S3_BASE_URL}${CONVERSATION_ID}"

log "Uploading results to: $S3_BASE"

# Zip and upload transformed source code
if [ -d "/source" ] && [ "$(ls -A /source 2>/dev/null)" ]; then
    log "Zipping transformed source code..."
    cd /source
    zip -qr /tmp/transformed-code.zip . \
        -x ".git/*" \
        -x ".env*" \
        -x "*.pem" \
        -x "*.key" \
        -x "node_modules/*" \
        -x ".aws/*"
    log "Uploading code zip..."
    aws s3 cp /tmp/transformed-code.zip "${S3_BASE}/code.zip" --quiet \
        || log "Warning: Code upload failed"
    rm -f /tmp/transformed-code.zip
    log "Code uploaded to: ${S3_BASE}/code.zip"
else
    log "No source code to upload"
fi

# Collect and upload all logs and artifacts for this job
log "Collecting logs and artifacts..."
LOGS_STAGING="/tmp/job-logs"
rm -rf "$LOGS_STAGING"
mkdir -p "$LOGS_STAGING"

# ATX CLI debug and error logs
cp "$HOME/.aws/atx/logs/debug"*.log "$LOGS_STAGING/" 2>/dev/null || true
cp "$HOME/.aws/atx/logs/error.log" "$LOGS_STAGING/" 2>/dev/null || true

# Conversation-specific files
ATX_CONVERSATION_DIR="$HOME/.aws/atx/custom/$CONVERSATION_ID"
if [ -d "$ATX_CONVERSATION_DIR" ]; then
    # Conversation log and worklog
    cp "$ATX_CONVERSATION_DIR"/logs/*.log "$LOGS_STAGING/" 2>/dev/null || true
    # Plan and validation artifacts
    cp "$ATX_CONVERSATION_DIR/plan.json" "$LOGS_STAGING/" 2>/dev/null || true
    cp "$ATX_CONVERSATION_DIR/artifacts/validation_summary.md" "$LOGS_STAGING/" 2>/dev/null || true
fi

if [ "$(ls -A "$LOGS_STAGING" 2>/dev/null)" ]; then
    log "Zipping logs..."
    cd "$LOGS_STAGING"
    zip -qr /tmp/logs.zip .
    aws s3 cp /tmp/logs.zip "${S3_BASE}/logs.zip" --quiet \
        || log "Warning: Log upload failed"
    rm -f /tmp/logs.zip
    log "Logs uploaded to: ${S3_BASE}/logs.zip"
else
    log "No logs found to upload"
fi
rm -rf "$LOGS_STAGING"

log ""
log "Results uploaded successfully!"
log "Conversation ID: $CONVERSATION_ID"
log "S3 Location: $S3_BASE"
log "  Code: ${S3_BASE}/code.zip"
log "  Logs: ${S3_BASE}/logs.zip"
