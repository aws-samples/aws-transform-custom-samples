#!/bin/bash
set -e

# Initialize nvm for Node.js
export NVM_DIR="/home/atxuser/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Initialize pyenv for Python version management
export PYENV_ROOT="/home/atxuser/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
if command -v pyenv &>/dev/null; then
    eval "$(pyenv init -)"
fi

# Gradle is installed directly at /opt/gradle — no runtime init needed

# Logging function with timestamps (defined early — used by version switching below)
log() {
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"
}

# ============================================================================
# VERSION SWITCHING
# ============================================================================
# Reads JAVA_VERSION, PYTHON_VERSION, NODE_VERSION environment variables
# and switches the active runtime accordingly. These can be set via Batch
# container overrides or docker run -e flags.

switch_java_version() {
    local ver="${JAVA_VERSION:-}"
    if [[ -z "$ver" ]]; then return; fi

    local java_home=""
    case "$ver" in
        8)  java_home="/usr/lib/jvm/java-1.8.0-amazon-corretto.x86_64" ;;
        11) java_home="/usr/lib/jvm/java-11-amazon-corretto.x86_64" ;;
        17) java_home="/usr/lib/jvm/java-17-amazon-corretto.x86_64" ;;
        21) java_home="/usr/lib/jvm/java-21-amazon-corretto.x86_64" ;;
        25) java_home="/usr/lib/jvm/java-25-amazon-corretto.x86_64" ;;
        *)  log "Warning: Unknown JAVA_VERSION=$ver (available: 8, 11, 17, 21, 25). Using default."
            return ;;
    esac

    if [[ -d "$java_home" ]]; then
        export JAVA_HOME="$java_home"
        export PATH="$JAVA_HOME/bin:$PATH"
        log "Switched to Java $ver (JAVA_HOME=$JAVA_HOME)"
    else
        log "Warning: Java $ver directory not found at $java_home. Using default."
    fi
}

switch_python_version() {
    local ver="${PYTHON_VERSION:-}"
    if [[ -z "$ver" ]]; then return; fi

    # Normalize: accept both "13" and "3.13" formats
    if [[ "$ver" =~ ^[0-9]+$ ]] && (( ver < 20 )); then
        ver="3.$ver"
    fi

    # Try dnf-installed versions first (3.11, 3.12, 3.13)
    if command -v "python${ver}" &>/dev/null; then
        # Create/update the python3 alternative to point to the requested version
        local py_path
        py_path=$(command -v "python${ver}")
        log "Switched to Python $ver ($py_path)"
        # Alias python3 to the requested version for this session
        alias python3="$py_path" 2>/dev/null || true
        export ATX_PYTHON="$py_path"
        return
    fi

    # Try pyenv-installed versions (3.8, 3.9, 3.10, 3.14)
    if command -v pyenv &>/dev/null; then
        local pyenv_ver
        pyenv_ver=$(pyenv versions --bare 2>/dev/null | grep "^${ver}" | tail -1)
        if [[ -n "$pyenv_ver" ]]; then
            pyenv shell "$pyenv_ver"
            log "Switched to Python $pyenv_ver (via pyenv)"
            return
        fi
    fi

    log "Warning: Python $ver not found (available: 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14). Using default."
}

switch_node_version() {
    local ver="${NODE_VERSION:-}"
    if [[ -z "$ver" ]]; then return; fi

    if [[ -s "$NVM_DIR/nvm.sh" ]]; then
        # nvm use outputs to stderr, capture it
        if nvm use "$ver" &>/dev/null; then
            log "Switched to Node.js $(node --version) (requested: $ver)"
        else
            log "Warning: Node.js $ver not found (available: 16, 18, 20, 22, 24). Using default."
        fi
    else
        log "Warning: nvm not available, cannot switch Node.js version."
    fi
}

# Apply version switches if environment variables are set
switch_java_version
switch_python_version
switch_node_version

# ============================================================================
# HELPER COMMANDS (available in interactive sessions and during job execution)
# ============================================================================

use-java() {
    JAVA_VERSION="$1" switch_java_version
}

use-python() {
    PYTHON_VERSION="$1" switch_python_version
}

use-node() {
    NODE_VERSION="$1" switch_node_version
}

show-versions() {
    echo "=== Active Versions ==="
    echo "Java:   $(java -version 2>&1 | head -1)"
    echo "Python: $(python3 --version 2>&1)"
    echo "Node:   $(node --version 2>&1)"
    echo ""
    echo "=== Available Versions ==="
    echo "Java:   8, 11, 17, 21, 25 (Amazon Corretto)"
    echo "Python: 3.8, 3.9, 3.10 (pyenv) | 3.11, 3.12, 3.13 (system) | 3.14 (pyenv)"
    echo "Node:   $(ls $NVM_DIR/versions/node/ 2>/dev/null | grep -v default | tr '\n' ' ')"
    echo ""
    echo "Switch: use-java 21 | use-python 13 | use-node 22"
}

export -f use-java use-python use-node show-versions switch_java_version switch_python_version switch_node_version

# Cleanup function
cleanup() {
    rm -f /tmp/repo_name.txt
    if [[ -n "${REFRESH_PID:-}" ]]; then
        kill "$REFRESH_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Retry function for network operations
retry() {
    local max_attempts=3
    local timeout=5
    local attempt=1
    local exitCode=0

    while [ $attempt -le $max_attempts ]; do
        if "$@"; then
            return 0
        else
            exitCode=$?
        fi

        if [ $attempt -lt $max_attempts ]; then
            log "Command failed (attempt $attempt/$max_attempts). Retrying in $timeout seconds..."
            sleep $timeout
            timeout=$((timeout * 2))
        fi
        attempt=$((attempt + 1))
    done

    log "Command failed after $max_attempts attempts."
    return $exitCode
}

# Parse arguments
SOURCE=""
OUTPUT=""
COMMAND=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --source)
            SOURCE="$2"
            shift 2
            ;;
        --output)
            OUTPUT="$2"
            shift 2
            ;;
        --command)
            COMMAND="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: [--source <git-url|s3-url>] --output <s3-bucket-url> --command <atx-command>"
            exit 1
            ;;
    esac
done

# Validate required arguments
if [[ -z "$COMMAND" ]]; then
    echo "Error: Missing required arguments"
    echo "Usage: [--source <git-url|s3-url>] [--output <s3-path>] --command <atx-command>"
    echo ""
    echo "Environment Variables:"
    echo "  S3_BUCKET - S3 bucket name for output (required if --output is specified)"
    echo ""
    echo "Examples:"
    echo "  --command \"atx custom def list\""
    echo "  --source https://github.com/user/repo.git --output results/job1/ --command \"atx custom def exec\""
    echo "  With S3_BUCKET=my-bucket, output goes to s3://my-bucket/results/job1/"
    exit 1
fi

# Check if output is specified and S3_BUCKET is set
if [[ -n "$OUTPUT" && -z "$S3_BUCKET" ]]; then
    echo "Error: S3_BUCKET environment variable must be set when using --output"
    echo "Example: docker run -e S3_BUCKET=my-bucket ... --output results/job1/"
    exit 1
fi

log "Starting AWS Transform CLI execution..."
log "Source: $SOURCE"
log "Output: $OUTPUT"
log "Command: $COMMAND"

# Set global git configuration for ATX
log "Configuring git identity for ATX..."
git config --global user.email "${GIT_USER_EMAIL:-atx-container@aws-transform.local}"
git config --global user.name "${GIT_USER_NAME:-AWS Transform Container}"

# Set ATX shell timeout for long-running jobs (default: 12 hours)
export ATX_SHELL_TIMEOUT="${ATX_SHELL_TIMEOUT:-43200}"
log "Set ATX_SHELL_TIMEOUT=$ATX_SHELL_TIMEOUT for long-running transformations"

# Configure AWS credentials for ATX CLI
# ATX CLI requires credentials as environment variables
if [[ -n "$AWS_ACCESS_KEY_ID" && -n "$AWS_SECRET_ACCESS_KEY" ]]; then
    log "Using explicit AWS credentials from environment variables"
    export USING_EXPLICIT_CREDS=true
    aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID"
    aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY"
    aws configure set region "${AWS_DEFAULT_REGION:-us-east-1}"
    
    if [[ -n "$AWS_SESSION_TOKEN" ]]; then
        aws configure set aws_session_token "$AWS_SESSION_TOKEN"
    fi
else
    log "No explicit credentials found, retrieving temporary credentials from IAM role..."
    
    # Verify IAM role is available
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        log "Error: No credentials available (neither environment variables nor IAM role)"
        exit 1
    fi
    
    # Export credentials for tools that only read env vars (e.g., ATX CLI)
    # Also write to ~/.aws/credentials for tools that read the credentials file
    log "Retrieving temporary credentials from IAM role..."
    
    if TEMP_CREDS=$(aws configure export-credentials --format env 2>/dev/null) && [[ -n "$TEMP_CREDS" ]]; then
        export AWS_ACCESS_KEY_ID=$(echo "$TEMP_CREDS" | grep '^export AWS_ACCESS_KEY_ID=' | sed 's/^export AWS_ACCESS_KEY_ID=//')
        export AWS_SECRET_ACCESS_KEY=$(echo "$TEMP_CREDS" | grep '^export AWS_SECRET_ACCESS_KEY=' | sed 's/^export AWS_SECRET_ACCESS_KEY=//')
        SESSION_TOKEN=$(echo "$TEMP_CREDS" | grep '^export AWS_SESSION_TOKEN=' | sed 's/^export AWS_SESSION_TOKEN=//')
        if [[ -n "$SESSION_TOKEN" ]]; then
            export AWS_SESSION_TOKEN="$SESSION_TOKEN"
        fi
        
        if [[ -z "$AWS_ACCESS_KEY_ID" || -z "$AWS_SECRET_ACCESS_KEY" ]]; then
            log "Error: Failed to export credentials from IAM role"
            exit 1
        fi
        
        aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID"
        aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY"
        aws configure set region "${AWS_DEFAULT_REGION:-us-east-1}"
        if [[ -n "${AWS_SESSION_TOKEN:-}" ]]; then
            aws configure set aws_session_token "$AWS_SESSION_TOKEN"
        fi
        
        log "Successfully retrieved and exported temporary credentials from IAM role"
        ROLE_ARN=$(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null || echo "Unable to retrieve role ARN")
        log "Using IAM role: $ROLE_ARN"
    else
        log "Error: Failed to retrieve credentials from IAM role"
        exit 1
    fi
fi

# Verify AWS credentials are working with retry
log "Verifying AWS credentials..."

if ! retry aws sts get-caller-identity --output text > /dev/null; then
    log "Error: Unable to authenticate with AWS after multiple attempts"
    exit 1
fi
log "AWS credentials verified successfully"

# ============================================================================
# PRIVATE REPOSITORY ACCESS
# ============================================================================
# Fetch credentials from AWS Secrets Manager for private repositories.
# Secrets are optional — if a secret doesn't exist, that credential is skipped.
#
# Three secret types supported:
#
# 1. atx/ssh-key (plain string) — SSH private key for private SSH repo cloning
#
# 2. atx/github-token (plain string) — GitHub PAT for private HTTPS repo cloning
#
# 3. atx/credentials (JSON array) — Generic credential files for any tool/registry
#    Each entry writes content to a file path inside the container.
#    Example:
#    [
#      {"path": "/home/atxuser/.npmrc", "content": "//npm.company.com/:_authToken=TOKEN"},
#      {"path": "/home/atxuser/.m2/settings.xml", "content": "<settings>...</settings>"},
#      {"path": "/home/atxuser/.config/pip/pip.conf", "content": "[global]\nindex-url = https://..."},
#      {"path": "/home/atxuser/.gem/credentials", "content": "---\n:rubygems_api_key: KEY", "mode": "0600"},
#      {"path": "/home/atxuser/.cargo/credentials.toml", "content": "[registry]\ntoken = \"TOKEN\""}
#    ]

fetch_private_credentials() {
    log "Fetching private repository credentials from Secrets Manager..."

    # SSH key for private repos (SSH URLs: git@github.com:org/repo.git)
    SSH_KEY=$(aws secretsmanager get-secret-value \
        --secret-id "atx/ssh-key" --query SecretString --output text 2>/dev/null || true)
    if [[ -n "$SSH_KEY" ]]; then
        mkdir -p /home/atxuser/.ssh
        echo "$SSH_KEY" > /home/atxuser/.ssh/id_rsa
        chmod 0600 /home/atxuser/.ssh/id_rsa
        chown -R atxuser:atxuser /home/atxuser/.ssh
        # Populate known_hosts with major git hosting providers
        ssh-keyscan -t ed25519,rsa github.com gitlab.com bitbucket.org \
            >> /home/atxuser/.ssh/known_hosts 2>/dev/null || true
        cat > /home/atxuser/.ssh/config <<'EOF'
Host *
    StrictHostKeyChecking yes
    UserKnownHostsFile /home/atxuser/.ssh/known_hosts
    LogLevel ERROR
EOF
        chmod 0600 /home/atxuser/.ssh/config /home/atxuser/.ssh/known_hosts
        log "✓ SSH key configured for private repository access"
    fi

    # GitHub token for private repos (HTTPS URLs)
    GITHUB_TOKEN=$(aws secretsmanager get-secret-value \
        --secret-id "atx/github-token" --query SecretString --output text 2>/dev/null || true)
    if [[ -n "$GITHUB_TOKEN" ]]; then
        echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > /home/atxuser/.git-credentials
        chmod 0600 /home/atxuser/.git-credentials
        chown atxuser:atxuser /home/atxuser/.git-credentials
        git config --global credential.helper store
        log "✓ GitHub credentials configured"
    fi

    # Generic credential files — works for any language/tool/registry
    # Written directly by python3 to avoid shell expansion and trailing newline stripping
    CREDS_JSON=$(aws secretsmanager get-secret-value \
        --secret-id "atx/credentials" --query SecretString --output text 2>/dev/null || true)
    if [[ -n "$CREDS_JSON" ]]; then
        echo "$CREDS_JSON" | python3 -c "
import sys, json, os, stat

ALLOWED_PREFIXES = ['/home/atxuser/']

entries = json.load(sys.stdin)
for entry in entries:
    fpath = os.path.realpath(entry['path'])
    content = entry['content']
    mode = int(entry.get('mode', '0644'), 8)

    # Validate path is under allowed prefixes
    if not any(fpath.startswith(p) for p in ALLOWED_PREFIXES):
        print(f'SKIPPED (path not allowed): {fpath}', file=sys.stderr)
        continue

    os.makedirs(os.path.dirname(fpath), exist_ok=True)
    with open(fpath, 'w') as f:
        f.write(content)
        if not content.endswith('\n'):
            f.write('\n')
    os.chmod(fpath, mode)
    os.chown(fpath, 1000, 1000)  # atxuser uid:gid
    print(f'✓ Credential file written: {fpath}')
"
    fi
}

fetch_private_credentials
# ============================================================================

# Download MCP configuration from S3 if available
log "Checking for MCP configuration..."
MCP_CONFIG_KEY="mcp-config/mcp.json"
MCP_CONFIG_PATH="/home/atxuser/.aws/atx/mcp.json"

# SOURCE_BUCKET is set as environment variable in job definition
if [ -n "$SOURCE_BUCKET" ] && aws s3 ls "s3://$SOURCE_BUCKET/$MCP_CONFIG_KEY" &>/dev/null; then
    log "MCP configuration found in S3, downloading..."
    
    # Create directory if it doesn't exist
    mkdir -p "$(dirname "$MCP_CONFIG_PATH")"
    
    # Download MCP config
    if aws s3 cp "s3://$SOURCE_BUCKET/$MCP_CONFIG_KEY" "$MCP_CONFIG_PATH" --quiet; then
        # Set proper ownership
        chown atxuser:atxuser "$MCP_CONFIG_PATH"
        chmod 644 "$MCP_CONFIG_PATH"
        log "MCP configuration downloaded successfully to $MCP_CONFIG_PATH"
    else
        log "Warning: Failed to download MCP configuration, continuing without it"
    fi
else
    log "No MCP configuration found in S3, using default ATX settings"
fi

# Background credential refresh for long-running jobs (every 45 minutes)
# Writes to ~/.aws/credentials so subsequent aws CLI calls pick up fresh creds.
# Note: env vars exported here do NOT propagate to the parent process — that's OK
# because the initial env vars are set above and most tools also check the creds file.
if [[ -z "${USING_EXPLICIT_CREDS:-}" ]]; then
    log "Starting background credential refresh (every 45 minutes)..."
    (
        # Unset inherited credential env vars so export-credentials falls through
        # to the ECS credential provider for fresh credentials.
        unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
        while true; do
            sleep 2700  # 45 minutes
            # Use /dev/null as credentials file for the fetch so it skips stale creds
            # and reaches the ECS provider. Then write fresh creds to the real file.
            if TEMP_CREDS=$(AWS_SHARED_CREDENTIALS_FILE=/dev/null aws configure export-credentials --format env 2>/dev/null) && [[ -n "$TEMP_CREDS" ]]; then
                REFRESH_KEY=$(echo "$TEMP_CREDS" | grep '^export AWS_ACCESS_KEY_ID=' | sed 's/^export AWS_ACCESS_KEY_ID=//')
                REFRESH_SECRET=$(echo "$TEMP_CREDS" | grep '^export AWS_SECRET_ACCESS_KEY=' | sed 's/^export AWS_SECRET_ACCESS_KEY=//')
                REFRESH_TOKEN=$(echo "$TEMP_CREDS" | grep '^export AWS_SESSION_TOKEN=' | sed 's/^export AWS_SESSION_TOKEN=//')
                if [[ -n "$REFRESH_KEY" && -n "$REFRESH_SECRET" ]]; then
                    aws configure set aws_access_key_id "$REFRESH_KEY"
                    aws configure set aws_secret_access_key "$REFRESH_SECRET"
                    [[ -n "$REFRESH_TOKEN" ]] && aws configure set aws_session_token "$REFRESH_TOKEN"
                    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Credentials refreshed in ~/.aws/credentials"
                fi
            else
                echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Warning: credential refresh failed, continuing with existing"
            fi
        done
    ) &
    REFRESH_PID=$!
    log "Credential refresh started (PID: $REFRESH_PID)"
fi

# ============================================================================
# COMMAND VALIDATION (Defense-in-depth)
# ============================================================================
# Mirrors the Lambda-layer validateCommand() logic. This ensures that even if
# a Batch job is submitted directly (bypassing Lambda), the container rejects
# dangerous commands.
validate_command() {
    local cmd="$1"
    local trimmed
    trimmed="$(echo "$cmd" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

    if [[ "$trimmed" != atx* ]]; then
        log "SECURITY: Command rejected — must start with 'atx'. Got: ${trimmed:0:40}..."
        exit 1
    fi

    local dangerous_patterns=('`' '$(' '${')
    for pattern in "${dangerous_patterns[@]}"; do
        if [[ "$trimmed" == *"$pattern"* ]]; then
            log "SECURITY: Command rejected — contains dangerous pattern: $pattern"
            exit 1
        fi
    done

    log "Command validation passed"
}

# ============================================================================
# CUSTOM INITIALIZATION (Optional)
# ============================================================================
# If you've extended this container with custom configurations, they're already
# set up from your Dockerfile (e.g., .npmrc, settings.xml, .git-credentials).
# 
# Add any runtime-specific initialization here if needed:
# - Additional environment variables
# - Dynamic credential retrieval
# - Custom tool initialization
#
# See container/README.md for extending the base image with private repo access.
# ============================================================================


# Download source code if provided
if [[ -n "$SOURCE" ]]; then
    # If source is an SSH URL, ensure the host is in known_hosts
    if [[ "$SOURCE" == git@* ]] || [[ "$SOURCE" == ssh://* ]]; then
        SSH_HOST=""
        if [[ "$SOURCE" == git@* ]]; then
            SSH_HOST=$(echo "$SOURCE" | sed 's/^git@//' | cut -d: -f1)
        elif [[ "$SOURCE" == ssh://* ]]; then
            SSH_HOST=$(echo "$SOURCE" | sed 's|^ssh://[^@]*@||' | cut -d/ -f1 | cut -d: -f1)
        fi
        if [[ -n "$SSH_HOST" ]] && [[ -f /home/atxuser/.ssh/known_hosts ]]; then
            if ! grep -q "^$SSH_HOST " /home/atxuser/.ssh/known_hosts 2>/dev/null; then
                log "Adding SSH host key for $SSH_HOST..."
                ssh-keyscan -t ed25519,rsa "$SSH_HOST" >> /home/atxuser/.ssh/known_hosts 2>/dev/null || true
            fi
        fi
    fi

    log "Downloading source code..."
    retry /app/download-source.sh "$SOURCE"
    
    # Get the repo/project directory name
    REPO_NAME=$(cat /tmp/repo_name.txt)
    PROJECT_PATH="/source/$REPO_NAME"
    
    # Initialize git repo if not present
    cd "$PROJECT_PATH"
    if [ ! -d ".git" ]; then
        log "Initializing git repository..."
        git init
        git config user.email "${GIT_USER_EMAIL:-container@aws-transform.local}"
        git config user.name "${GIT_USER_NAME:-AWS Transform Container}"
        git add .
        git commit -m "Initial commit"
    fi
    
    # Smart -p flag handling
    # Only replace -p if it exists in the original command
    if [[ "$COMMAND" == *" -p "* ]] || [[ "$COMMAND" == *" --code-repository-path "* ]]; then
        log "Detected -p flag in command, replacing with container path"
        # Remove existing -p/--code-repository-path and its value (anchored to flag boundaries)
        COMMAND=$(echo "$COMMAND" | sed -E 's/(^| )(-p|--code-repository-path) [^ ]+/ /g' | sed 's/  */ /g' | sed 's/^ //;s/ $//')
        # Add correct -p flag with container path
        COMMAND="$COMMAND -p $PROJECT_PATH"
        log "Replaced with: -p $PROJECT_PATH"
    else
        log "No -p flag in command, ATX will use current directory"
    fi
    
    # Validate command before execution (defense-in-depth — mirrors Lambda validation)
    validate_command "$COMMAND"
    log "Executing command: $COMMAND"
    ATX_EXIT=0
    eval "$COMMAND" || ATX_EXIT=$?
    if [[ $ATX_EXIT -ne 0 ]]; then
        log "Warning: ATX command exited with code $ATX_EXIT"
    fi
else
    # Validate command before execution (defense-in-depth — mirrors Lambda validation)
    validate_command "$COMMAND"
    log "Executing command (no source code): $COMMAND"
    mkdir -p /source
    cd /source
    ATX_EXIT=0
    eval "$COMMAND" || ATX_EXIT=$?
    if [[ $ATX_EXIT -ne 0 ]]; then
        log "Warning: ATX command exited with code $ATX_EXIT"
    fi
fi

# Upload results if output is specified (even on ATX failure, to preserve logs)
if [[ -n "$OUTPUT" ]]; then
    log "Uploading results..."
    retry /app/upload-results.sh "$OUTPUT" "$S3_BUCKET"
else
    log "No output specified, skipping S3 upload"
fi

# Emit structured job summary for CloudWatch dashboard queries
JOB_STATUS="SUCCEEDED"
if [[ "${ATX_EXIT:-0}" -ne 0 ]]; then
    JOB_STATUS="FAILED"
fi
TD_NAME=$(echo "$COMMAND" | sed -n 's/.*-n \([^ ]*\).*/\1/p')
TD_NAME="${TD_NAME:-unknown}"
log "JOB_SUMMARY | jobStatus=${JOB_STATUS} | exitCode=${ATX_EXIT:-0} | tdName=${TD_NAME} | sourceRepo=${SOURCE:-none} | outputPath=${OUTPUT:-none}"

log "AWS Transform CLI execution completed!"

# Propagate ATX exit code so Batch marks the job as failed if transformation failed
exit "${ATX_EXIT:-0}"