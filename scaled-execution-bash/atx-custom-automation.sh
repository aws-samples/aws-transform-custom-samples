#!/bin/bash

# ATX Custom Automation Script - Enterprise Batch Processing
# Purpose: Automate ATX Custom transformations across multiple repositories
# Version: 2.0
# Created: November 16, 2025 | Updated: February 24, 2026
# 
# Key Features:
# - Hybrid input: CSV (simple) or JSON (advanced)
# - Auto-clone GitHub repositories (HTTPS/SSH)
# - Multi-TD sequential execution per repository
# - Sophisticated parallel processing with batch groups
# - Live dashboard with in-place updates (TTY mode)
# - Cross-platform terminal spawning
# - Trust-all-tools enabled by default
# - Timestamped run isolation with resume support
# - Enhanced status tracking (PENDING, IN_PROGRESS, COMPLETED, FAILED)
# - Comprehensive summary reports
# - Build command optional (ATX handles validation internally if not provided)

set -euo pipefail

SCRIPT_VERSION="2.0"

# Configuration
RUN_TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
OUTPUT_BASE_DIR="./batch_results"
OUTPUT_DIR=""  # Will be set in setup_environment
CLONE_DIR="./batch_repos"
INPUT_FILE=""
INPUT_FORMAT=""  # "csv" or "json"
STATUS_FILE=""  # Checkpoint file (set after output_dir known)

# Execution settings
TRUST_ALL_TOOLS=true  # Enabled by default for automation
EXECUTION_MODE="parallel"  # "serial", "parallel", "batch", "terminal"
MODE_EXPLICIT=false  # Track if --mode was explicitly set via CLI
BATCH_NUMBER=""
MAX_JOBS=10  # Default parallel job limit (configurable)
DRY_RUN=false
SKIP_CONFIRM=false
RESUME_MODE=false  # Resume from previous run

# Campaign settings
CAMPAIGN_NAME=""
CREATE_CAMPAIGN=false

# ATX Custom supported regions (source regions only)
# Reference: https://docs.aws.amazon.com/transform/latest/userguide/cross-region-processing.html
ATX_CUSTOM_SUPPORTED_REGIONS=("us-east-1" "eu-central-1")

# Known ATX error patterns that indicate failure despite exit code 0
ATX_ERROR_PATTERNS=(
    "AWS Transform is not available in region"
    "Authentication failed"
    "Transformation not found"
    "Access Denied"
    "Unable to connect to the service"
    "Rate exceeded"
    "InvalidIdentityToken"
    "ExpiredToken"
    "The security token included in the request is expired"
)

# Repository array (populated from CSV or JSON)
REPOS=()

# Dashboard mode flag (set when parallel mode with TTY)
DASHBOARD_MODE=false

# Colors (disabled when output is not a terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    MAGENTA='\033[0;35m'
    NC='\033[0m'
    IS_TTY=true
else
    RED='' GREEN='' YELLOW='' BLUE='' CYAN='' MAGENTA='' NC=''
    IS_TTY=false
fi

#═══════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
#═══════════════════════════════════════════════════════════════

log_info() {
    if [[ "$DASHBOARD_MODE" == true ]]; then
        echo -e "${BLUE}[INFO]${NC} $1" >> "$OUTPUT_DIR/summary.log"
    else
        echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$OUTPUT_DIR/summary.log"
    fi
}

log_success() {
    if [[ "$DASHBOARD_MODE" == true ]]; then
        echo -e "${GREEN}✓${NC} $1" >> "$OUTPUT_DIR/summary.log"
    else
        echo -e "${GREEN}✓${NC} $1" | tee -a "$OUTPUT_DIR/summary.log"
    fi
}

log_error() {
    if [[ "$DASHBOARD_MODE" == true ]]; then
        echo -e "${RED}✗${NC} $1" >> "$OUTPUT_DIR/summary.log"
    else
        echo -e "${RED}✗${NC} $1" | tee -a "$OUTPUT_DIR/summary.log"
    fi
}

log_warning() {
    if [[ "$DASHBOARD_MODE" == true ]]; then
        echo -e "${YELLOW}⚠${NC} $1" >> "$OUTPUT_DIR/summary.log"
    else
        echo -e "${YELLOW}⚠${NC} $1" | tee -a "$OUTPUT_DIR/summary.log"
    fi
}

format_duration() {
    local seconds=${1:-}
    [[ -z "$seconds" ]] && echo "N/A" && return
    
    seconds=${seconds%s}
    
    if [ "$seconds" -lt 60 ]; then
        echo "${seconds}s"
    elif [ "$seconds" -lt 3600 ]; then
        echo "$((seconds / 60))m $((seconds % 60))s"
    else
        local h=$((seconds / 3600))
        local m=$(((seconds % 3600) / 60))
        local s=$((seconds % 60))
        [[ $m -eq 0 && $s -eq 0 ]] && echo "${h}h" || echo "${h}h ${m}m ${s}s"
    fi
}

write_with_lock() {
    local file="$1"
    local content="$2"
    local lockfile="${file}.lock"
    local max_wait=30
    local waited=0
    
    while ! mkdir "$lockfile" 2>/dev/null; do
        sleep 0.1
        ((waited++)) || true
        [[ $waited -gt $((max_wait * 10)) ]] && return 1
    done
    
    echo "$content" >> "$file"
    rmdir "$lockfile"
}

#═══════════════════════════════════════════════════════════════
# CHECKPOINT/RESUME SYSTEM
#═══════════════════════════════════════════════════════════════

init_status_file() {
    [[ -z "$STATUS_FILE" ]] && STATUS_FILE="$OUTPUT_DIR/.atx-batch-status"
    
    if [[ ! -f "$STATUS_FILE" ]]; then
        mkdir -p "$OUTPUT_DIR"
        echo "# ATX Batch Automation Status - $(date)" > "$STATUS_FILE"
        echo "# Format: REPO_NAME|STATUS|TIMESTAMP|DURATION|MESSAGE" >> "$STATUS_FILE"
    fi
}

mark_repo_status() {
    local repo_name=$1
    local status=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local duration=${3:-""}
    local message=${4:-""}
    
    init_status_file
    
    # Remove old entry and add new one (with lock for parallel safety)
    local lockfile="${STATUS_FILE}.lock"
    mkdir "$lockfile" 2>/dev/null || return 0
    if [[ -f "$STATUS_FILE" ]]; then
        local tmpfile="${STATUS_FILE}.tmp.$$"
        grep -v "^${repo_name}|" "$STATUS_FILE" > "$tmpfile" 2>/dev/null || true
        mv "$tmpfile" "$STATUS_FILE" 2>/dev/null || true
    fi
    echo "${repo_name}|${status}|${timestamp}|${duration}|${message}" >> "$STATUS_FILE"
    rmdir "$lockfile" 2>/dev/null || true
}

#═══════════════════════════════════════════════════════════════
# REPOSITORY HANDLING
#═══════════════════════════════════════════════════════════════

expand_path() {
    local path="$1"
    # Safe tilde expansion without eval
    if [[ "$path" == "~/"* ]]; then
        echo "${HOME}/${path#\~/}"
    elif [[ "$path" == "~" ]]; then
        echo "$HOME"
    else
        echo "$path"
    fi
}

detect_repository_type() {
    local repo_path="$1"
    
    if [[ "$repo_path" =~ ^https?:// ]] || [[ "$repo_path" =~ ^git@.*: ]]; then
        [[ "$repo_path" =~ ^https?:// ]] && echo "https" || echo "ssh"
    else
        local expanded
        expanded=$(expand_path "$repo_path")
        [[ -d "$expanded" ]] && echo "local" || echo "unknown"
    fi
}

normalize_repository_name() {
    local repo_path="$1"
    
    if [[ "$repo_path" =~ ^(https?://|git@) ]]; then
        basename "$repo_path" .git
    else
        basename "$(expand_path "$repo_path")"
    fi | sed 's/[^a-zA-Z0-9._-]/_/g'
}

clone_repository() {
    local repo_url="$1"
    local clone_path="$2"
    
    # Validate clone_path is under CLONE_DIR to prevent accidental rm -rf of wrong paths
    local real_clone_dir
    real_clone_dir=$(cd "$CLONE_DIR" 2>/dev/null && pwd) || { echo "ERROR:CLONE_DIR not accessible" >&2; return 1; }
    local real_clone_path
    real_clone_path="${real_clone_dir}/$(basename "$clone_path")"
    case "$real_clone_path" in
        "$real_clone_dir"/*) ;; # safe
        *) echo "ERROR:clone_path is not under CLONE_DIR" >&2; return 1 ;;
    esac
    
    [[ -d "$clone_path" ]] && rm -rf "$clone_path"
    
    for ((i=0; i<2; i++)); do
        if git clone --depth 1 "$repo_url" "$clone_path" > /dev/null 2>&1; then
            [[ -d "$clone_path" ]] && [[ -n "$(ls -A "$clone_path" 2>/dev/null)" ]] && return 0
        fi
        [[ $i -lt 1 ]] && sleep 2
    done
    return 1
}

prepare_repository() {
    local repo_path="$1"
    local repo_name="$2"
    local repo_type=$(detect_repository_type "$repo_path")
    
    case "$repo_type" in
        "https"|"ssh")
            local clone_path="$CLONE_DIR/$repo_name"
            
            # Show clone progress (suppress if dashboard mode)
            local clone_start=$(date +%s)
            if [[ "$DASHBOARD_MODE" != true ]]; then
                echo -e "${CYAN}📥 Cloning${NC} $repo_name from GitHub..." | tee -a "$OUTPUT_DIR/summary.log" >&2
            else
                echo -e "${CYAN}📥 Cloning${NC} $repo_name from GitHub..." >> "$OUTPUT_DIR/summary.log"
            fi
            
            if clone_repository "$repo_path" "$clone_path"; then
                local clone_duration=$(($(date +%s) - clone_start))
                if [[ "$DASHBOARD_MODE" != true ]]; then
                    echo -e "${GREEN}✓ Cloned${NC} $repo_name ($(format_duration $clone_duration))" | tee -a "$OUTPUT_DIR/summary.log" >&2
                else
                    echo -e "${GREEN}✓ Cloned${NC} $repo_name ($(format_duration $clone_duration))" >> "$OUTPUT_DIR/summary.log"
                fi
                echo "$clone_path"
            else
                local clone_duration=$(($(date +%s) - clone_start))
                if [[ "$DASHBOARD_MODE" != true ]]; then
                    echo -e "${RED}✗ Clone failed${NC} $repo_name ($(format_duration $clone_duration))" | tee -a "$OUTPUT_DIR/summary.log" >&2
                else
                    echo -e "${RED}✗ Clone failed${NC} $repo_name ($(format_duration $clone_duration))" >> "$OUTPUT_DIR/summary.log"
                fi
                if [[ "$repo_type" == "https" ]]; then
                    echo "ERROR:Git clone authentication failed. Configure git credentials or use SSH URLs.|$repo_path" >&2
                else
                    echo "ERROR:Git clone failed (SSH). Verify SSH keys configured.|$repo_path" >&2
                fi
                return 1
            fi
            ;;
        "local")
            local expanded
            expanded=$(expand_path "$repo_path")
            if [[ -d "$expanded" ]] && [[ -r "$expanded" ]]; then
                if [[ "$DASHBOARD_MODE" != true ]]; then
                    echo -e "${CYAN}📂 Using local path${NC} $repo_name" | tee -a "$OUTPUT_DIR/summary.log" >&2
                else
                    echo -e "${CYAN}📂 Using local path${NC} $repo_name" >> "$OUTPUT_DIR/summary.log"
                fi
                echo "$expanded"
            else
                echo "ERROR:Path not found or not accessible.|$expanded" >&2
                return 1
            fi
            ;;
        *)
            echo "ERROR:Invalid repository path format.|$repo_path" >&2
            return 1
            ;;
    esac
}

#═══════════════════════════════════════════════════════════════
# CONFIGURATION LOADING
#═══════════════════════════════════════════════════════════════

load_config_from_csv() {
    local csv_file=$1
    log_info "Loading CSV: $csv_file"
    
    local line_num=0
    while IFS=',' read -r repo_path transformation_name build_cmd validation_cmds plan_context; do
        ((line_num++)) || true
        [[ $line_num -eq 1 ]] && continue  # Skip header
        
        # Clean fields
        repo_path=$(echo "$repo_path" | sed 's/^"//;s/"$//' | xargs)
        transformation_name=$(echo "$transformation_name" | sed 's/^"//;s/"$//' | xargs)
        build_cmd=$(echo "$build_cmd" | sed 's/^"//;s/"$//' | xargs)
        validation_cmds=$(echo "$validation_cmds" | sed 's/^"//;s/"$//' | xargs)
        plan_context=$(echo "$plan_context" | sed 's/^"//;s/"$//' | xargs)
        
        [[ -z "$repo_path" ]] && continue
        [[ -z "$transformation_name" ]] && log_error "Missing transformation_name (line $line_num)" && continue
        
        # CSV restriction: Single-TD only (no commas allowed in TD name)
        if [[ "$transformation_name" == *","* ]]; then
            log_error "CSV supports single-TD only. Multi-TD detected on line $line_num: '$transformation_name'"
            log_error "For multi-TD, use JSON format. Skipping this repository."
            continue
        fi
        
        local repo_name=$(normalize_repository_name "$repo_path")
        
        # Format: NAME|||PATH|||TD|||BUILD|||VALIDATION|||CONTEXT|||PARALLEL|||BATCH|||PRIORITY
        # Use ||| as delimiter to avoid conflicts with : in URLs
        REPOS+=("${repo_name}|||${repo_path}|||${transformation_name}|||${build_cmd}|||${validation_cmds}|||${plan_context}|||true|||1|||normal")
    done < "$csv_file"
    
    log_info "Loaded ${#REPOS[@]} repositories from CSV"
}

load_config_from_json() {
    local json_file=$1
    
    if ! command -v jq &> /dev/null; then
        log_error "jq required for JSON. Install: https://jqlang.github.io/jq/download/"
        exit 1
    fi
    
    log_info "Loading JSON: $json_file"
    
    local repo_count=$(jq '.repositories | length' "$json_file")
    REPOS=()
    
    for ((i=0; i<repo_count; i++)); do
        local name=$(jq -r ".repositories[$i].name" "$json_file")
        local path=$(jq -r ".repositories[$i].path // .repositories[$i].name" "$json_file")
        local td=$(jq -r ".repositories[$i].transformation_name // .repositories[$i].td" "$json_file")
        local build=$(jq -r ".repositories[$i].build_command // \"\"" "$json_file")
        local validation=$(jq -r ".repositories[$i].validation_commands // \"\"" "$json_file")
        local context=$(jq -r ".repositories[$i].additional_plan_context // \"\"" "$json_file")
        local parallel=$(jq -r ".repositories[$i].parallel_eligible // \"true\"" "$json_file")
        local batch=$(jq -r ".repositories[$i].batch_group // \"1\"" "$json_file")
        local priority=$(jq -r ".repositories[$i].execution_priority // \"normal\"" "$json_file")
        
        REPOS+=("${name}|||${path}|||${td}|||${build}|||${validation}|||${context}|||${parallel}|||${batch}|||${priority}")
    done
    
    log_info "Loaded ${#REPOS[@]} repositories from JSON"
}

get_repo_info() {
    local repo_name=$1
    local field=$2
    
    for repo_entry in "${REPOS[@]}"; do
        local name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        if [ "$name" = "$repo_name" ]; then
            case $field in
                "path") echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $2}' ;;
                "transformation") echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $3}' ;;
                "build") echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $4}' ;;
                "validation") echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $5}' ;;
                "context") echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $6}' ;;
                "parallel") echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $7}' ;;
                "batch") echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $8}' ;;
                "priority") echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $9}' ;;
            esac
            return 0
        fi
    done
    return 1
}

#═══════════════════════════════════════════════════════════════
# CAMPAIGN MANAGEMENT
#═══════════════════════════════════════════════════════════════

create_campaign() {
    local campaign_name="$1"
    local transformation_name="$2"
    
    log_info "Creating campaign: $campaign_name"
    
    # Create repos file for campaign
    local repos_file="$OUTPUT_DIR/campaign_repos.txt"
    for repo_entry in "${REPOS[@]}"; do
        local repo_name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        echo "$repo_name" >> "$repos_file"
    done
    
    # Create campaign
    if atx custom campaign create --name "$campaign_name" \
                                  --transformation-name "$transformation_name" \
                                  --repos-file "$repos_file" 2>&1 | tee -a "$OUTPUT_DIR/summary.log"; then
        log_success "Campaign created: $campaign_name"
        return 0
    else
        log_error "Failed to create campaign: $campaign_name"
        return 1
    fi
}

update_campaign_status() {
    local campaign_name="$1"
    local repo_name="$2"
    local status="$3"
    
    if [[ -n "$campaign_name" ]]; then
        atx custom campaign update-repo --name "$campaign_name" \
                                       --repo-name "$repo_name" \
                                       --status "$status" 2>&1 | tee -a "$OUTPUT_DIR/summary.log" > /dev/null || true
    fi
}

#═══════════════════════════════════════════════════════════════
# ATX EXECUTION
#═══════════════════════════════════════════════════════════════

execute_atx_for_repo() {
    local repo_name="$1"
    local repo_path=$(get_repo_info "$repo_name" "path")
    local transformation=$(get_repo_info "$repo_name" "transformation")
    local build_cmd=$(get_repo_info "$repo_name" "build")
    local validation=$(get_repo_info "$repo_name" "validation")
    local context=$(get_repo_info "$repo_name" "context")
    
    # Create subdirectory for this repository's artifacts
    local repo_output_dir="$OUTPUT_DIR/$repo_name"
    mkdir -p "$repo_output_dir"
    
    local log_file="$repo_output_dir/execution.log"
    local start_time=$(date +%s)
    
    # Update campaign status to IN_PROGRESS
    update_campaign_status "$CAMPAIGN_NAME" "$repo_name" "IN_PROGRESS"
    
    # Parse comma-separated TDs
    IFS=',' read -ra TD_ARRAY <<< "$transformation"
    
    # In dry-run mode, skip cloning and just preview commands
    if [[ "$DRY_RUN" == true ]]; then
        local work_path="<repo-path:$repo_path>"
        local repo_type
        repo_type=$(detect_repository_type "$repo_path")
        [[ "$repo_type" == "https" || "$repo_type" == "ssh" ]] && work_path="$CLONE_DIR/$repo_name"
        [[ "$repo_type" == "local" ]] && work_path=$(expand_path "$repo_path")
        
        # Enhanced visual output for dry-run
        echo -e "\n${CYAN}┌─────────────────────────────────────────────────────────────┐${NC}"
        echo -e "${CYAN}│${NC} 📦 ${MAGENTA}Repository:${NC} ${repo_name}"
        echo -e "${CYAN}│${NC} 📍 ${MAGENTA}Path:${NC} ${repo_path}"
        echo -e "${CYAN}│${NC} 🔄 ${MAGENTA}Transformations:${NC} ${#TD_ARRAY[@]}"
        [[ -n "$build_cmd" ]] && echo -e "${CYAN}│${NC} 🔨 ${MAGENTA}Build:${NC} ${build_cmd}"
        echo -e "${CYAN}└─────────────────────────────────────────────────────────────┘${NC}"
        
        for ((td_idx=0; td_idx<${#TD_ARRAY[@]}; td_idx++)); do
            local current_td="${TD_ARRAY[td_idx]}"
            local td_num=$((td_idx+1))
            
            echo -e "\n  ${BLUE}▶${NC} ${YELLOW}TD ${td_num}/${#TD_ARRAY[@]}:${NC} ${current_td}"
            
            local atx_cmd_args=("atx" "custom" "def" "exec")
            atx_cmd_args+=("--code-repository-path" "$work_path")
            atx_cmd_args+=("--transformation-name" "$current_td")
            [[ -n "$build_cmd" ]] && atx_cmd_args+=("--build-command" "$build_cmd")
            [[ "$TRUST_ALL_TOOLS" == true ]] && atx_cmd_args+=("--trust-all-tools")
            atx_cmd_args+=("--non-interactive")
            
            echo -e "  ${CYAN}Command:${NC} ${atx_cmd_args[*]}" | tee -a "$log_file"
        done
        
        echo -e "  ${GREEN}✓ Preview complete${NC}\n"
        
        local duration=$(($(date +%s) - start_time))
        write_with_lock "$OUTPUT_DIR/results.txt" "SUCCESS|$repo_name|DRY-RUN: ${#TD_ARRAY[@]} TD(s) previewed|$duration"
        mark_repo_status "$repo_name" "COMPLETED" "${duration}s" "DRY-RUN: ${#TD_ARRAY[@]} TD(s) previewed"
        return 0
    fi
    
    # Prepare repository (clone if remote)
    local work_path
    if ! work_path=$(prepare_repository "$repo_path" "$repo_name"); then
        local duration=$(($(date +%s) - start_time))
        
        # Parse error message (format: ERROR:message|path) - extract from stderr
        local error_msg="Prep failed"
        if echo "$work_path" | grep -q "^ERROR:"; then
            error_msg=$(echo "$work_path" | grep "^ERROR:" | cut -d: -f2- | cut -d'|' -f1)
        fi
        
        write_with_lock "$OUTPUT_DIR/results.txt" "FAILED|$repo_name|$error_msg|$duration"
        echo "Preparation failed: $work_path" >> "$log_file"
        update_campaign_status "$CAMPAIGN_NAME" "$repo_name" "FAILED"
        return 1
    fi
    
    # Parse comma-separated TDs (works for both CSV and JSON)
    # CSV: Use quotes for multi-TD or switch to JSON
    IFS=',' read -ra TD_ARRAY <<< "$transformation"
    
    log_info "Transforming: $repo_name (${#TD_ARRAY[@]} TD(s))"
    
    # Execute each TD sequentially
    local final_result=0
    for ((td_idx=0; td_idx<${#TD_ARRAY[@]}; td_idx++)); do
        local current_td="${TD_ARRAY[td_idx]}"
        local td_num=$((td_idx+1))
        
        echo "=== TD ${td_num}/${#TD_ARRAY[@]}: $current_td ===" >> "$log_file"
        
        # Build ATX command as array (avoids eval)
        local atx_cmd_args=("atx" "custom" "def" "exec")
        atx_cmd_args+=("--code-repository-path" "$work_path")
        atx_cmd_args+=("--transformation-name" "$current_td")
        
        # Add build command if provided (OPTIONAL)
        [[ -n "$build_cmd" ]] && atx_cmd_args+=("--build-command" "$build_cmd")
        
        # Trust-all-tools (default enabled)
        [[ "$TRUST_ALL_TOOLS" == true ]] && atx_cmd_args+=("--trust-all-tools")
        
        # Non-interactive
        atx_cmd_args+=("--non-interactive")
        
        # Create config if validation/context provided
        if [[ -n "$validation" ]] || [[ -n "$context" ]]; then
            local config_file="$repo_output_dir/td${td_num}_config.yaml"
            # Use single quotes for YAML values to avoid issues with special characters
            local sq="'"
            local esc_work_path="${work_path//$sq/$sq$sq}"
            local esc_td="${current_td//$sq/$sq$sq}"
            {
                echo "codeRepositoryPath: '${esc_work_path}'"
                echo "transformationName: '${esc_td}'"
                if [[ -n "$build_cmd" ]]; then
                    local esc_build="${build_cmd//$sq/$sq$sq}"
                    echo "buildCommand: '${esc_build}'"
                fi
                if [[ -n "$validation" ]]; then
                    local esc_val="${validation//$sq/$sq$sq}"
                    echo "validationCommands: '${esc_val}'"
                fi
                if [[ -n "$context" ]]; then
                    local esc_ctx="${context//$sq/$sq$sq}"
                    echo "additionalPlanContext: '${esc_ctx}'"
                fi
            } > "$config_file"
            atx_cmd_args+=("--configuration" "file://$config_file")
        fi
        
        # Execute
        echo "Executing: ${atx_cmd_args[*]}" >> "$log_file"
        
        local cmd_exit=0
        # Dashboard mode: suppress output to avoid messing up dashboard
        # Serial/terminal mode: show live ATX output to user
        if [[ "$DASHBOARD_MODE" == true ]]; then
            # Filter spinner and "Thinking" text, pipe to /dev/null
            "${atx_cmd_args[@]}" 2>&1 | tee >(grep -v "⠋\|⠙\|⠹\|⠸\|⠼\|⠴\|⠦\|⠧\|⠇\|⠏.*Thinking" >> "$log_file") > /dev/null || true
        else
            # Show live output in terminal (serial/terminal mode)
            "${atx_cmd_args[@]}" 2>&1 | tee -a "$log_file" || true
        fi
        cmd_exit=${PIPESTATUS[0]}
        
        # Scan log for known ATX error patterns (ATX may exit 0 despite errors)
        local detected_error=""
        for pattern in "${ATX_ERROR_PATTERNS[@]}"; do
            if grep -q "$pattern" "$log_file" 2>/dev/null; then
                detected_error="$pattern"
                cmd_exit=1  # Force failure
                break
            fi
        done
        
        if [[ $cmd_exit -eq 0 ]]; then
            log_success "✓ TD ${td_num}/${#TD_ARRAY[@]} completed: $current_td"
        else
            if [[ -n "$detected_error" ]]; then
                log_error "✗ TD ${td_num}/${#TD_ARRAY[@]} failed: $current_td"
                log_error "  Detected issue: $detected_error"
                echo "ATX ERROR DETECTED: $detected_error" >> "$log_file"
            else
                log_error "✗ TD ${td_num}/${#TD_ARRAY[@]} failed: $current_td"
            fi
            final_result=$cmd_exit
            break
        fi
    done
    
    # Record result in unified status file
    local duration=$(($(date +%s) - start_time))
    local duration_fmt="${duration}s"
    
    if [[ $final_result -eq 0 ]]; then
        write_with_lock "$OUTPUT_DIR/results.txt" "SUCCESS|$repo_name|All ${#TD_ARRAY[@]} TD(s) completed|$duration"
        mark_repo_status "$repo_name" "COMPLETED" "$duration_fmt" "All ${#TD_ARRAY[@]} TD(s) completed"
        log_success "Repository $repo_name completed ($(format_duration $duration))"
        update_campaign_status "$CAMPAIGN_NAME" "$repo_name" "COMPLETED"
        return 0
    else
        write_with_lock "$OUTPUT_DIR/results.txt" "FAILED|$repo_name|TD failed|$duration"
        mark_repo_status "$repo_name" "FAILED" "$duration_fmt" "TD failed"
        log_error "Repository $repo_name failed ($(format_duration $duration))"
        update_campaign_status "$CAMPAIGN_NAME" "$repo_name" "FAILED"
        return 1
    fi
}

#═══════════════════════════════════════════════════════════════
# SIGNAL HANDLING
#═══════════════════════════════════════════════════════════════

cleanup_on_interrupt() {
    echo ""
    log_warning "Execution interrupted! Cleaning up..."
    
    # Kill all background processes (handle unbound array with set -u)
    if [[ -n "${pids[@]+"${pids[@]}"}" ]]; then
        for pid in "${pids[@]}"; do
            kill "$pid" 2>/dev/null || true
        done
        wait 2>/dev/null || true
    fi
    
    # Generate partial summary
    echo ""
    echo -e "${YELLOW}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}   ⚠ EXECUTION INTERRUPTED${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════════════════════${NC}"
    
    if [[ -f "$OUTPUT_DIR/results.txt" ]]; then
        local total=$(tail -n +2 "$OUTPUT_DIR/results.txt" | wc -l | tr -d ' ')
        local successful=$(tail -n +2 "$OUTPUT_DIR/results.txt" | grep "^SUCCESS" | wc -l | tr -d ' ')
        local failed=$(tail -n +2 "$OUTPUT_DIR/results.txt" | grep "^FAILED" | wc -l | tr -d ' ')
        
        echo -e "${GREEN}✓ Completed:${NC} $successful"
        echo -e "${RED}✗ Failed:${NC} $failed"
        echo -e "${YELLOW}⚠ Interrupted:${NC} $((${#REPOS[@]} - total))"
        echo ""
        echo "Partial results saved to: $OUTPUT_DIR/summary.log"
        echo "To resume, use the same input file with --resume flag (future feature)"
    fi
    
    echo -e "${YELLOW}════════════════════════════════════════════════════════════════${NC}"
    exit 130
}

#═══════════════════════════════════════════════════════════════
# DASHBOARD DISPLAY (for parallel mode with TTY)
#═══════════════════════════════════════════════════════════════

DASHBOARD_LINES=0  # Track number of lines for cleanup

draw_progress_bar() {
    local completed=$1
    local total=$2
    local bar_width=20
    
    local filled=$((completed * bar_width / total))
    local empty=$((bar_width - filled))
    
    local bar=""
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done
    
    local percentage=$((completed * 100 / total))
    echo "${bar} ${completed}/${total} (${percentage}%)"
}

get_repo_duration() {
    local repo_name=$1
    local status_line
    
    [[ ! -f "$STATUS_FILE" ]] && echo "--" && return
    
    status_line=$(grep "^${repo_name}|" "$STATUS_FILE" 2>/dev/null | tail -1)
    [[ -z "$status_line" ]] && echo "--" && return
    
    # Parse status line (format: REPO_NAME|STATUS|TIMESTAMP|DURATION|MESSAGE)
    # Using | delimiter avoids conflicts with : in timestamps
    local status=$(echo "$status_line" | cut -d'|' -f2)
    local timestamp=$(echo "$status_line" | cut -d'|' -f3)
    local duration=$(echo "$status_line" | cut -d'|' -f4)
    
    if [[ "$status" == "COMPLETED" ]] || [[ "$status" == "FAILED" ]]; then
        echo "$duration"
    elif [[ "$status" == "IN_PROGRESS" ]]; then
        # Calculate elapsed time
        local start_epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "$timestamp" "+%s" 2>/dev/null || date "+%s")
        local now=$(date +%s)
        local elapsed=$((now - start_epoch))
        format_duration "$elapsed"
    else
        echo "--"
    fi
}

get_repo_status_symbol() {
    local status=$1
    
    case "$status" in
        "PENDING") echo "⏸ " ;;
        "IN_PROGRESS") echo "⏳" ;;
        "COMPLETED") echo "✓ " ;;
        "FAILED") echo "✗ " ;;
        *) echo "? " ;;
    esac
}

clear_dashboard() {
    if [[ "$IS_TTY" == true ]] && [[ $DASHBOARD_LINES -gt 0 ]]; then
        # Move cursor up and clear lines
        for ((i=0; i<DASHBOARD_LINES; i++)); do
            tput cuu1  # Move up one line
            tput el    # Clear to end of line
        done
    fi
}

show_dashboard_header() {
    [[ "$IS_TTY" != true ]] && return
    
    DASHBOARD_LINES=0
    
    echo "════════════════════════════════════════════════════════════════"
    ((DASHBOARD_LINES++))
    echo "   🚀 BATCH EXECUTION IN PROGRESS"
    ((DASHBOARD_LINES++))
    echo "════════════════════════════════════════════════════════════════"
    ((DASHBOARD_LINES++))
    echo ""
    ((DASHBOARD_LINES++))
}

update_dashboard() {
    local total=$1
    local start_time=$2
    
    [[ "$IS_TTY" != true ]] && return
    
    # Clear previous dashboard content (keep header)
    local content_lines=$((DASHBOARD_LINES - 4))  # Subtract header lines
    if [[ $content_lines -gt 0 ]]; then
        for ((i=0; i<content_lines; i++)); do
            tput cuu1
            tput el
        done
    fi
    
    # Reset line counter to header only
    DASHBOARD_LINES=4
    
    # Table header
    printf "  %-35s %-13s %s\n" "Repository" "Status" "Duration"
    ((DASHBOARD_LINES++))
    printf "  %.35s %.13s %.8s\n" "───────────────────────────────────" "─────────────" "────────"
    ((DASHBOARD_LINES++))
    
    # Repository status lines
    local completed=0
    for repo_entry in "${REPOS[@]}"; do
        local repo_name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        
        # Get status from status file
        local status="PENDING"
        if [[ -f "$STATUS_FILE" ]]; then
            local status_line=$(grep "^${repo_name}|" "$STATUS_FILE" 2>/dev/null | tail -1)
            if [[ -n "$status_line" ]]; then
                status=$(echo "$status_line" | cut -d'|' -f2)
            fi
        fi
        
        [[ "$status" == "COMPLETED" ]] && ((completed++)) || true
        
        local symbol=$(get_repo_status_symbol "$status")
        local duration=$(get_repo_duration "$repo_name")
        
        # Truncate long repo names
        local display_name="$repo_name"
        if [[ ${#repo_name} -gt 33 ]]; then
            display_name="${repo_name:0:30}..."
        fi
        
        # Color status
        local status_display="$status"
        case "$status" in
            "COMPLETED") status_display="${GREEN}${symbol}${status}${NC}" ;;
            "FAILED") status_display="${RED}${symbol}${status}${NC}" ;;
            "IN_PROGRESS") status_display="${YELLOW}${symbol}${status}${NC}" ;;
            "PENDING") status_display="${CYAN}${symbol}${status}${NC}" ;;
        esac
        
        printf "  %-35s ${status_display} %8s\n" "$display_name" "$duration"
        ((DASHBOARD_LINES++))
    done
    
    # Blank line
    echo ""
    ((DASHBOARD_LINES++))
    
    # Progress bar
    local progress_bar=$(draw_progress_bar "$completed" "$total")
    local elapsed=$(format_duration $(($(date +%s) - start_time)))
    echo -e "  Progress: ${CYAN}${progress_bar}${NC} | Elapsed: ${elapsed}"
    ((DASHBOARD_LINES++))
    
    # Blank line
    echo ""
    ((DASHBOARD_LINES++))
    
    # Control hint with auto-update info
    echo "  [Updates every 30s | Press Ctrl+C to interrupt]"
    ((DASHBOARD_LINES++))
    
    # Footer
    echo "════════════════════════════════════════════════════════════════"
    ((DASHBOARD_LINES++))
}

show_final_summary() {
    [[ "$IS_TTY" != true ]] && return
    
    # Clear dashboard
    clear_dashboard
    
    # Show final summary header
    echo "════════════════════════════════════════════════════════════════"
    echo "   ✅ BATCH EXECUTION COMPLETED"
    echo "════════════════════════════════════════════════════════════════"
    echo ""
}

#═══════════════════════════════════════════════════════════════
# EXECUTION MODES
#═══════════════════════════════════════════════════════════════

execute_serial() {
    local total=${#REPOS[@]}
    log_info "Executing $total repositories in serial mode"
    
    for ((i=0; i<total; i++)); do
        local repo_entry="${REPOS[$i]}"
        local repo_name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        
        if [[ -z "$repo_name" ]]; then
            log_error "Empty repo_name at index $i, skipping"
            continue
        fi
        
        # Enhanced visual header for each repository (Option A style)
        local repo_path=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $2}')
        local td=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $3}')
        local build=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $4}')
        local td_count=$(echo "$td" | tr ',' '\n' | wc -l | tr -d ' ')
        local repo_type=$(detect_repository_type "$repo_path")
        local type_label=""
        case "$repo_type" in
            "https") type_label="GitHub HTTPS" ;;
            "ssh") type_label="GitHub SSH" ;;
            "local") type_label="Local" ;;
        esac
        
        echo ""
        echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
        echo -e "${BLUE}   🚀 [$((i+1))/${total}] ${CYAN}${repo_name}${NC}"
        echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
        echo -e "  📍 ${MAGENTA}Source:${NC} ${repo_path} (${type_label})"
        if [[ $td_count -gt 1 ]]; then
            echo -e "  🔄 ${MAGENTA}TDs:${NC} ${td_count} ($(echo "$td" | sed 's/,/ → /g'))"
        else
            echo -e "  🔄 ${MAGENTA}TD:${NC} ${td}"
        fi
        [[ -n "$build" ]] && echo -e "  🔨 ${MAGENTA}Build:${NC} ${build}"
        echo ""
        
        # Save repo mapping inside repo subdirectory
        local repo_output_dir="$OUTPUT_DIR/$repo_name"
        mkdir -p "$repo_output_dir"
        echo "$repo_entry" > "$repo_output_dir/.repo_mapping"
        
        # Mark as IN_PROGRESS
        mark_repo_status "$repo_name" "IN_PROGRESS"
        
        if ! execute_atx_for_repo "$repo_name"; then
            # Get specific error message from results.txt
            local error_msg=$(grep "^FAILED|$repo_name|" "$OUTPUT_DIR/results.txt" 2>/dev/null | cut -d'|' -f3 || echo "Unknown error")
            
            echo -e "${RED}[ERROR]${NC} Repository ${CYAN}$repo_name${NC} failed:"
            echo -e "  ${RED}✗${NC} $error_msg"
            echo -e "  ${BLUE}→${NC} Check ${OUTPUT_DIR}/${repo_name}/execution.log for details" | tee -a "$OUTPUT_DIR/summary.log"
        fi
    done
}

execute_parallel() {
    local total=${#REPOS[@]}
    local pids=()
    
    # Initialize status file and mark all as PENDING
    init_status_file
    for repo_entry in "${REPOS[@]}"; do
        local repo_name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        mark_repo_status "$repo_name" "PENDING"
    done
    
    # Determine if we should use dashboard mode
    local use_dashboard=false
    if [[ "$IS_TTY" == true ]] && [[ "$DRY_RUN" != true ]]; then
        use_dashboard=true
        DASHBOARD_MODE=true  # Set global flag
    fi
    
    if [[ "$use_dashboard" == true ]]; then
        log_info "Executing $total repositories in parallel (max $MAX_JOBS jobs)" >> "$OUTPUT_DIR/summary.log"
        show_dashboard_header
    else
        log_info "Executing $total repositories in parallel (max $MAX_JOBS jobs)"
    fi
    
    local start_parallel=$(date +%s)
    local last_status_update=$start_parallel
    
    # Launch all jobs
    for repo_entry in "${REPOS[@]}"; do
        # Wait if at capacity
        while [[ ${#pids[@]} -ge $MAX_JOBS ]]; do
            local new_pids=()
            for pid in "${pids[@]}"; do
                kill -0 "$pid" 2>/dev/null && new_pids+=($pid)
            done
            pids=("${new_pids[@]}")
            [[ ${#pids[@]} -ge $MAX_JOBS ]] && sleep 1
            
            # Update dashboard while waiting
            if [[ "$use_dashboard" == true ]]; then
                local now=$(date +%s)
                if [[ $((now - last_status_update)) -ge 30 ]]; then
                    update_dashboard "$total" "$start_parallel"
                    last_status_update=$now
                fi
            fi
        done
        
        local repo_name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        
        # Save repo mapping inside repo subdirectory
        local repo_output_dir="$OUTPUT_DIR/$repo_name"
        mkdir -p "$repo_output_dir"
        echo "$repo_entry" > "$repo_output_dir/.repo_mapping"
        
        # Mark as IN_PROGRESS
        mark_repo_status "$repo_name" "IN_PROGRESS"
        
        (execute_atx_for_repo "$repo_name") &
        pids+=($!)
        
        # Initial dashboard update after first job starts
        if [[ "$use_dashboard" == true ]] && [[ ${#pids[@]} -eq 1 ]]; then
            update_dashboard "$total" "$start_parallel"
            last_status_update=$(date +%s)
        fi
    done
    
    # Wait for all jobs with periodic updates
    if [[ "$use_dashboard" != true ]]; then
        echo ""
    fi
    
    while [[ ${#pids[@]} -gt 0 ]]; do
        local new_pids=()
        for pid in "${pids[@]+"${pids[@]}"}"; do
            kill -0 "$pid" 2>/dev/null && new_pids+=($pid)
        done
        pids=("${new_pids[@]+"${new_pids[@]}"}")
        
        # Show status every 30 seconds
        local now=$(date +%s)
        if [[ $((now - last_status_update)) -ge 30 ]] && [[ ${#pids[@]} -gt 0 ]]; then
            if [[ "$use_dashboard" == true ]]; then
                update_dashboard "$total" "$start_parallel"
            else
                # Fallback: line-based updates (non-TTY)
                local elapsed=$((now - start_parallel))
                local completed=$(tail -n +2 "$OUTPUT_DIR/results.txt" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
                local running=${#pids[@]}
                echo -e "${BLUE}[$(format_duration $elapsed)]${NC} 🔄 ${running} running | ${GREEN}${completed}/${total} completed${NC}"
            fi
            last_status_update=$now
        fi
        
        [[ ${#pids[@]} -gt 0 ]] && sleep 1
    done
    
    # Final dashboard or newline
    if [[ "$use_dashboard" == true ]]; then
        update_dashboard "$total" "$start_parallel"
        sleep 1  # Brief pause to show final state
        show_final_summary
    else
        echo ""
    fi
    
    log_success "All parallel jobs completed"
}

execute_terminal() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   🖥️  Spawning Terminal Windows${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    log_info "Spawning ${#REPOS[@]} terminal windows (one per repository)..."
    echo ""
    
    # Create temp directory for single-repo files
    local temp_dir="/tmp/atx-terminal-$$"
    mkdir -p "$temp_dir"
    
    local count=0
    for repo_entry in "${REPOS[@]}"; do
        ((count++)) || true
        local repo_name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        local repo_path=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $2}')
        local td=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $3}')
        local build=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $4}')
        local validation=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $5}')
        local context=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $6}')
        local td_count=$(echo "$td" | tr ',' '\n' | wc -l)
        
        # Create temporary single-repo CSV file for this repo
        local temp_csv="$temp_dir/repo_${count}.csv"
        echo "repo_path,transformation_name,build_command,validation_commands,additional_plan_context" > "$temp_csv"
        echo "\"$repo_path\",\"$td\",\"$build\",\"$validation\",\"$context\"" >> "$temp_csv"
        
        # Build command using temp file (pass shared output dir for status tracking)
        local repo_command="cd '$(pwd)' && $0 --input '$temp_csv' --mode serial --yes --output-dir '$OUTPUT_DIR'; read -p 'Press Enter to close...'"
        
        # Show what's being spawned
        if [[ $td_count -gt 1 ]]; then
            echo -e "${GREEN}✓${NC} Terminal $count: ${CYAN}$repo_name${NC} ($td_count TDs sequential)"
        else
            echo -e "${GREEN}✓${NC} Terminal $count: ${CYAN}$repo_name${NC}"
        fi
        
        local terminal_title="ATX: $repo_name"
        spawn_terminal_with_command "$repo_command" "$terminal_title"
        
        # Brief delay between spawns
        sleep 1
    done
    
    echo ""
    log_success "Spawned ${#REPOS[@]} terminal windows"
    echo -e "${CYAN}💡 Each repository executes in its own terminal${NC}"
    echo -e "${CYAN}💡 Multi-TD repos execute TDs sequentially (one after another)${NC}"
    echo -e "${CYAN}💡 All results written to: ${OUTPUT_DIR}${NC}"
    echo ""
    
    # Show monitoring dashboard in parent window
    if [[ "$IS_TTY" == true ]]; then
        log_info "Monitoring terminal execution (press Ctrl+C to stop monitoring)..."
        echo ""
        
        # Brief delay to let terminals start and create status entries
        sleep 2
        
        # Initialize status file for monitoring
        init_status_file
        
        local total=${#REPOS[@]}
        local start_monitor=$(date +%s)
        local last_update=$start_monitor
        
        # Show dashboard monitoring
        show_dashboard_header
        update_dashboard "$total" "$start_monitor"
        
        # Monitor loop - update dashboard every 30 seconds until all complete
        local last_status_change=$start_monitor
        local prev_completed=0
        
        while true; do
            sleep 5  # Check every 5 seconds
            
            # Count completed and failed repos (tr -d removes any newlines)
            local completed=0
            local failed=0
            if [[ -f "$STATUS_FILE" ]]; then
                completed=$(grep -c "|COMPLETED|" "$STATUS_FILE" 2>/dev/null | tr -d '\n' || echo "0")
                failed=$(grep -c "|FAILED|" "$STATUS_FILE" 2>/dev/null | tr -d '\n' || echo "0")
            fi
            
            # Track if status changed (any repo completed/failed)
            local current_done=$((completed + failed))
            if [[ $current_done -gt $prev_completed ]]; then
                last_status_change=$(date +%s)
                prev_completed=$current_done
            fi
            
            # Update dashboard every 30 seconds
            local now=$(date +%s)
            if [[ $((now - last_update)) -ge 30 ]]; then
                update_dashboard "$total" "$start_monitor"
                last_update=$now
            fi
            
            # Exit when all complete or failed
            if [[ $((completed + failed)) -ge $total ]]; then
                update_dashboard "$total" "$start_monitor"
                sleep 1
                show_final_summary
                break
            fi
            
            # Stale detection: if no status changes for 2 minutes, assume terminals died
            if [[ $((now - last_status_change)) -gt 120 ]]; then
                update_dashboard "$total" "$start_monitor"
                echo ""
                log_warning "No status updates for 2 minutes. Terminals may have been closed."
                log_info "Completed/Failed: $((completed + failed))/$total"
                log_info "To resume, run: $0 --input $INPUT_FILE --resume"
                break
            fi
        done
        
        log_success "All terminal executions completed!"
    fi
    
    exit 0
}

execute_batch() {
    local batch_num=$1
    
    # Get repositories in this batch
    local batch_repos=()
    for repo_entry in "${REPOS[@]}"; do
        local repo_name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        local batch_group=$(get_repo_info "$repo_name" "batch")
        
        if [[ "$batch_group" == "$batch_num" ]]; then
            batch_repos+=("$repo_name")
        fi
    done
    
    if [[ ${#batch_repos[@]} -eq 0 ]]; then
        log_error "No repositories found in batch $batch_num"
        echo ""
        echo -e "${CYAN}💡 Tip:${NC} Use JSON format with batch_group field to configure batches"
        exit 1
    fi
    
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   📦 Batch $batch_num Execution${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}Repositories in batch:${NC} ${#batch_repos[@]}"
    echo ""
    
    # List repos in this batch
    for repo_name in "${batch_repos[@]}"; do
        local td=$(get_repo_info "$repo_name" "transformation")
        local td_count=$(echo "$td" | tr ',' '\n' | wc -l)
        if [[ $td_count -gt 1 ]]; then
            echo -e "  • ${CYAN}$repo_name${NC} ($td_count TDs)"
        else
            echo -e "  • ${CYAN}$repo_name${NC}"
        fi
    done
    echo ""
    
    # Execute repos in this batch sequentially
    local failed_count=0
    local completed_count=0
    
    for repo_name in "${batch_repos[@]}"; do
        if execute_atx_for_repo "$repo_name"; then
            ((completed_count++)) || true
        else
            ((failed_count++)) || true
            log_warning "Continuing with remaining repositories in batch..."
        fi
        echo ""
    done
    
    # Batch summary
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   📦 Batch $batch_num Completed${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ Completed:${NC} $completed_count"
    echo -e "${RED}✗ Failed:${NC} $failed_count"
    echo ""
    
    return $failed_count
}

#═══════════════════════════════════════════════════════════════
# REPORTING
#═══════════════════════════════════════════════════════════════

generate_summary_report() {
    local total_duration="$1"
    local results_file="$OUTPUT_DIR/results.txt"
    
    [[ ! -f "$results_file" ]] && return
    
    # Count using awk for reliability
    local total=$(tail -n +2 "$results_file" | wc -l | tr -d ' ')
    local successful=$(tail -n +2 "$results_file" | grep "^SUCCESS" | wc -l | tr -d ' ')
    local failed=$(tail -n +2 "$results_file" | grep "^FAILED" | wc -l | tr -d ' ')
    local total_exec=$(tail -n +2 "$results_file" | awk -F'|' '{sum+=$4} END {print sum}')
    
    local success_rate=0
    [[ $total -gt 0 ]] && success_rate=$(( (successful * 100) / total ))
    
    {
        echo ""
        echo "EXECUTION SUMMARY"
        echo "================="
        echo "Completed: $(date)"
        echo "Wall time: $(format_duration $total_duration)"
        echo "Execution time: $(format_duration $total_exec)"
        echo ""
        echo "STATISTICS"
        echo "=========="
        printf "%-20s | %s\n" "Total Repositories" "$total"
        printf "%-20s | %s\n" "Successful" "$successful"
        printf "%-20s | %s\n" "Failed" "$failed"
        printf "%-20s | %s%%\n" "Success Rate" "$success_rate"
        printf "%-20s | %s\n" "Mode" "$EXECUTION_MODE"
        printf "%-20s | %s\n" "Input Format" "$INPUT_FORMAT"
        echo ""
        
        if [[ $failed -gt 0 ]]; then
            echo "FAILED REPOSITORIES"
            echo "==================="
            tail -n +2 "$results_file" | while IFS='|' read -r status repo_name msg dur; do
                [[ "$status" == "FAILED" ]] && printf "%-30s | %s\n" "$repo_name" "$msg"
            done
            echo ""
        fi
        
        echo "DETAILED RESULTS"
        echo "================"
        printf "%-10s | %-30s | %-40s | %s\n" "Status" "Repository" "Message" "Duration"
        printf "%.10s-+-%.30s-+-%.40s-+-%s\n" "----------" "------------------------------" "----------------------------------------" "----------"
        tail -n +2 "$results_file" | while IFS='|' read -r status repo_name msg dur; do
            printf "%-10s | %-30s | %-40s | %s\n" "$status" "$repo_name" "${msg:0:40}" "$(format_duration $dur)"
        done
        echo ""
    } >> "$OUTPUT_DIR/summary.log"
    
    # Generate failed repos CSV
    if [[ $failed -gt 0 ]] && [[ "$INPUT_FORMAT" == "csv" ]]; then
        echo "repo_path,transformation_name,build_command,validation_commands,additional_plan_context" > "$OUTPUT_DIR/failed_repos.csv"
        tail -n +2 "$results_file" | while IFS='|' read -r status repo_name msg dur; do
            if [[ "$status" == "FAILED" ]] && [[ -f "$OUTPUT_DIR/$repo_name/.repo_mapping" ]]; then
                local entry=$(cat "$OUTPUT_DIR/$repo_name/.repo_mapping")
                local path=$(echo "$entry" | awk -F'\\|\\|\\|' '{print $2}')
                local td=$(echo "$entry" | awk -F'\\|\\|\\|' '{print $3}')
                local build=$(echo "$entry" | awk -F'\\|\\|\\|' '{print $4}')
                local val=$(echo "$entry" | awk -F'\\|\\|\\|' '{print $5}')
                local ctx=$(echo "$entry" | awk -F'\\|\\|\\|' '{print $6}')
                echo "\"$path\",\"$td\",\"$build\",\"$val\",\"$ctx\"" >> "$OUTPUT_DIR/failed_repos.csv"
            fi
        done
        log_info "Failed repos saved to: $OUTPUT_DIR/failed_repos.csv"
    fi
    
    # Cleanup old-style files (no longer created, but clean up if they exist)
    rm -f "$OUTPUT_DIR/.repo_mapping_"* "$OUTPUT_DIR/".*.yaml "$OUTPUT_DIR/."{total,success,fail,exec_time}
    
    echo ""
    echo "=========================================="
    echo "EXECUTION COMPLETED"
    echo "=========================================="
    echo "Total: $total | Success: $successful | Failed: $failed | Rate: ${success_rate}%"
    echo "Duration: $(format_duration $total_duration)"
    echo "Summary: $OUTPUT_DIR/summary.log"
    echo "=========================================="
}

#═══════════════════════════════════════════════════════════════
# SETUP AND VALIDATION
#═══════════════════════════════════════════════════════════════

check_ssh_connectivity() {
    # Check if any repositories use SSH URLs
    local has_ssh_repos=false
    for repo_entry in "${REPOS[@]}"; do
        local repo_path=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $2}')
        if [[ "$repo_path" =~ ^git@.*: ]]; then
            has_ssh_repos=true
            break
        fi
    done
    
    # Skip check if no SSH repos
    if [[ "$has_ssh_repos" == false ]]; then
        return 0
    fi
    
    log_info "Checking SSH connectivity to GitHub..."
    
    # Test SSH connection with timeout
    if timeout 5 ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
        log_success "SSH connectivity to github.com verified"
    else
        log_warning "SSH connectivity to github.com failed"
        echo -e "${YELLOW}  Repositories using SSH URLs may fail to clone.${NC}"
        echo -e "${CYAN}  Set up SSH keys: https://docs.github.com/en/authentication/connecting-to-github-with-ssh${NC}"
        echo ""
    fi
}

confirm_execution() {
    echo ""
    echo "═══════════════════════════════════════"
    echo "EXECUTION PLAN"
    echo "═══════════════════════════════════════"
    echo "Repositories: ${#REPOS[@]}"
    echo "Input: $INPUT_FORMAT"
    echo "Clone to: $CLONE_DIR"
    echo "Results to: $OUTPUT_DIR"
    
    if [[ -n "$CAMPAIGN_NAME" ]]; then
        echo "Campaign: $CAMPAIGN_NAME"
    fi
    
    echo ""
    echo "Repositories to process:"
    local count=0
    for repo_entry in "${REPOS[@]}"; do
        ((count++)) || true
        [[ $count -gt 5 ]] && echo "  ... and $((${#REPOS[@]} - 5)) more" && break
        
        local name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
        local path=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $2}')
        local td=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $3}')
        local td_count=$(echo "$td" | tr ',' '\n' | wc -l)
        
        # Detect repo type for display
        local repo_type=$(detect_repository_type "$path")
        local type_label=""
        case "$repo_type" in
            "https") type_label="HTTPS" ;;
            "ssh") type_label="SSH" ;;
            "local") type_label="local" ;;
        esac
        
        if [[ $td_count -gt 1 ]]; then
            echo "  $count. $name ($td_count TDs, $type_label)"
        else
            echo "  $count. $name ($type_label)"
        fi
    done
    
    if [[ "$SKIP_CONFIRM" == true ]]; then
        # --yes flag: only default to parallel if mode wasn't explicitly set
        if [[ "$MODE_EXPLICIT" == false ]]; then
            EXECUTION_MODE="parallel"
            log_info "Execution confirmed (--yes). Defaulting to background parallel..."
        else
            log_info "Execution confirmed (--yes). Using explicit mode: $EXECUTION_MODE..."
        fi
        return
    fi
    
    echo ""
    echo "═══════════════════════════════════════"
    echo "How would you like to execute?"
    echo -e "  ${GREEN}b${NC} - Background parallel (repos run in same terminal with 30s updates)"
    echo -e "  ${GREEN}t${NC} - Terminal windows (each repo gets its own terminal window)"
    echo -e "  ${GREEN}s${NC} - Serial (one repo at a time in this terminal)"
    echo -e "  ${RED}c${NC} - Cancel"
    echo ""
    read -p "Choose execution mode (b/t/s/C): " -n 1 -r
    echo
    
    case $REPLY in
        [Bb])
            EXECUTION_MODE="parallel"
            log_info "Starting background parallel execution..."
            ;;
        [Tt])
            EXECUTION_MODE="terminal"
            log_info "Will spawn terminal windows for each repository..."
            ;;
        [Ss])
            EXECUTION_MODE="serial"
            log_info "Starting serial execution..."
            ;;
        *)
            log_info "Execution cancelled by user"
            exit 0
            ;;
    esac
}

setup_environment() {
    # Set OUTPUT_DIR to timestamped folder (unless resuming or user specified custom dir)
    if [[ "$RESUME_MODE" == true ]] && [[ -z "$OUTPUT_DIR" ]]; then
        # Find latest run folder for resume
        if [[ -L "$OUTPUT_BASE_DIR/latest" ]]; then
            # readlink returns relative path, so prepend OUTPUT_BASE_DIR
            OUTPUT_DIR="$OUTPUT_BASE_DIR/$(readlink "$OUTPUT_BASE_DIR/latest")"
            log_info "Resuming from latest run: $(basename "$OUTPUT_DIR")"
        elif [[ -d "$OUTPUT_BASE_DIR" ]]; then
            # Find most recent timestamped folder
            local latest_dir=$(ls -1td "$OUTPUT_BASE_DIR"/2*_*-*-* 2>/dev/null | head -1)
            if [[ -n "$latest_dir" ]]; then
                OUTPUT_DIR="$latest_dir"
                log_info "Resuming from: $(basename "$OUTPUT_DIR")"
            else
                log_warning "No previous runs found. Starting fresh run."
                OUTPUT_DIR="$OUTPUT_BASE_DIR/$RUN_TIMESTAMP"
            fi
        else
            OUTPUT_DIR="$OUTPUT_BASE_DIR/$RUN_TIMESTAMP"
        fi
    elif [[ -z "$OUTPUT_DIR" ]]; then
        # New run with timestamped folder
        OUTPUT_DIR="$OUTPUT_BASE_DIR/$RUN_TIMESTAMP"
    fi
    
    # Create directories
    mkdir -p "$OUTPUT_DIR" "$CLONE_DIR"
    
    # Create/update 'latest' symlink (skip for resume mode)
    if [[ "$RESUME_MODE" != true ]]; then
        rm -f "$OUTPUT_BASE_DIR/latest"
        ln -s "$(basename "$OUTPUT_DIR")" "$OUTPUT_BASE_DIR/latest"
        log_info "Created symlink: batch_results/latest → $(basename "$OUTPUT_DIR")"
    fi
    
    # Clean old lock files
    find "$OUTPUT_DIR" -name "*.lock" -type d -mmin +60 -exec rmdir {} \; 2>/dev/null || true
    
    # Check disk space
    local space=$(df -BG "$OUTPUT_DIR" 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//' || echo "999")
    if [[ $space -lt 1 ]]; then
        log_error "Insufficient disk space (need 1GB, have ${space}GB)"
        exit 1
    fi
    
    # Initialize summary log
    if [[ ! -f "$OUTPUT_DIR/summary.log" ]]; then
        echo "ATX Custom Batch Execution - $(date)" > "$OUTPUT_DIR/summary.log"
        echo "=======================================" >> "$OUTPUT_DIR/summary.log"
        echo "Run ID: $(basename "$OUTPUT_DIR")" >> "$OUTPUT_DIR/summary.log"
        echo "" >> "$OUTPUT_DIR/summary.log"
    fi
}

#═══════════════════════════════════════════════════════════════
# PRE-FLIGHT VALIDATION
#═══════════════════════════════════════════════════════════════

run_preflight_checks() {
    local has_errors=false
    
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   🔍 PRE-FLIGHT VALIDATION${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # 1. Check AWS Region
    local current_region=""
    current_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo "")}}"
    
    if [[ -z "$current_region" ]]; then
        echo -e "  ${YELLOW}⚠${NC}  AWS Region: ${YELLOW}Not configured${NC}"
        echo -e "     ${CYAN}→ Set AWS_REGION or run: aws configure set region us-east-1${NC}"
        log_warning "AWS region not configured. ATX Custom requires us-east-1 or eu-central-1."
    else
        local region_supported=false
        for supported_region in "${ATX_CUSTOM_SUPPORTED_REGIONS[@]}"; do
            if [[ "$current_region" == "$supported_region" ]]; then
                region_supported=true
                break
            fi
        done
        
        if [[ "$region_supported" == true ]]; then
            echo -e "  ${GREEN}✓${NC}  AWS Region: ${GREEN}${current_region}${NC}"
        else
            echo -e "  ${RED}✗${NC}  AWS Region: ${RED}${current_region}${NC} (NOT SUPPORTED)"
            echo -e "     ${CYAN}→ ATX Custom only supports: ${ATX_CUSTOM_SUPPORTED_REGIONS[*]}${NC}"
            echo -e "     ${CYAN}→ Fix: export AWS_REGION=us-east-1${NC}"
            has_errors=true
        fi
    fi
    
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    
    # Block execution if critical errors found
    if [[ "$has_errors" == true ]]; then
        echo ""
        echo -e "${RED}⚠️  Pre-flight validation failed. Fix the issues above before running.${NC}"
        echo ""
        
        if [[ "$DRY_RUN" == true ]]; then
            log_warning "Pre-flight issues detected (dry-run mode — continuing with preview)"
            return 0  # Don't block dry-run
        fi
        
        if [[ "$SKIP_CONFIRM" == true ]]; then
            log_error "Pre-flight validation failed. Aborting (--yes mode)."
            exit 1
        fi
        
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Execution cancelled due to pre-flight failures"
            exit 1
        fi
        log_warning "Continuing despite pre-flight failures (user override)"
    else
        echo -e "${GREEN}  ✅ All pre-flight checks passed${NC}"
        echo ""
    fi
}

check_atx_cli() {
    if ! command -v atx &> /dev/null; then
        # Skip interactive install prompt in dry-run mode
        if [[ "$DRY_RUN" == true ]]; then
            log_error "ATX CLI not found. Install: curl -fsSL https://desktop-release.transform.us-east-1.api.aws/install.sh | bash"
            exit 1
        fi
        
        log_error "ATX CLI not found. Install now? (y/N)"
        read -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Installing ATX Custom..."
            curl -fsSL https://desktop-release.transform.us-east-1.api.aws/install.sh | bash
            log_success "ATX installed. Run script again to proceed."
        else
            echo "Install manually: curl -fsSL https://desktop-release.transform.us-east-1.api.aws/install.sh | bash"
        fi
        exit 1
    fi
    
    local version=$(atx --version 2>/dev/null || echo "unknown")
    log_info "ATX CLI version: $version"
    
    # Skip interactive update prompt in dry-run mode
    if [[ "$DRY_RUN" != true ]] && atx update --check 2>/dev/null | grep -q "newer version"; then
        log_info "ATX update available. Update now? (y/N)"
        read -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Updating ATX..."
            atx update
            log_success "ATX updated"
        else
            log_info "Continuing with current version"
        fi
    elif [[ "$DRY_RUN" == true ]] && atx update --check 2>/dev/null | grep -q "newer version"; then
        log_info "ATX update available (skipping in dry-run mode)"
    fi
}

#═══════════════════════════════════════════════════════════════
# TERMINAL SPAWNING
#═══════════════════════════════════════════════════════════════

spawn_terminal_with_command() {
    local command=$1
    local title=${2:-"ATX Batch Execution"}
    
    echo -e "${CYAN}🖥️  Spawning terminal:${NC} $title"
    
    case "$OSTYPE" in
        darwin*)
            # macOS - Use AppleScript
            osascript -e "tell application \"Terminal\" to do script \"cd '$(pwd)' && $command\""
            ;;
        linux*)
            # Linux - Try different terminals
            if command -v gnome-terminal &> /dev/null; then
                gnome-terminal --title="$title" -- bash -c "cd '$(pwd)' && $command; read -p 'Press Enter to close...'"
            elif command -v xterm &> /dev/null; then
                xterm -T "$title" -e bash -c "cd '$(pwd)' && $command; read -p 'Press Enter to close...'" &
            else
                log_warning "No supported terminal found. Running in background..."
                bash -c "cd '$(pwd)' && $command" &
            fi
            ;;
        *)
            log_warning "Unsupported OS: $OSTYPE. Running in background..."
            bash -c "cd '$(pwd)' && $command" &
            ;;
    esac
    
    sleep 0.5  # Brief delay between spawns
}

#═══════════════════════════════════════════════════════════════
# MAIN
#═══════════════════════════════════════════════════════════════

usage() {
    cat << EOF
════════════════════════════════════════════════════════════════
   🚀 ATX Custom Automation - Enterprise Batch Processing
════════════════════════════════════════════════════════════════

USAGE:
    $0 [OPTIONS] --input <file>

REQUIRED:
    --input <file>          📄 Input file (.csv or .json, auto-detected)

EXECUTION MODE OPTIONS:
    --mode <mode>           🔄 Execution mode: serial, parallel, batch, or terminal
                              • serial: One repo at a time
                              • parallel: Max 10 repos at once (default)
                              • terminal: Spawn terminal window per repo
    --batch <n>             📦 Execute specific batch number (1, 2, 3...)
    --resume                🔄 Resume from previous run (skip completed repos)
    --dry-run               👁️  Preview without executing transformations
    --yes, -y               ✅ Skip confirmation prompt (for CI/CD, defaults to background parallel)

CAMPAIGN OPTIONS:
    --campaign <name>       📊 Use existing ATX campaign (track statuses)
    --create-campaign <name> ✨ Create new campaign + track execution

ADVANCED OPTIONS:
    --no-trust-tools        🔐 Disable auto-trust (require manual confirmations)
    --max-jobs <n>          ⚙️  Max parallel jobs (default: 10, use with --mode parallel)
    --output-dir <dir>      📁 Custom output directory (default: ./batch_results)
    --clone-dir <dir>       📁 Custom clone directory (default: ./batch_repos)

OTHER:
    --help                  ❓ Show this help message
    --version               📌 Show version

════════════════════════════════════════════════════════════════
   📝 INPUT FORMATS
════════════════════════════════════════════════════════════════

CSV FORMAT (Simple - Single TD per repo):
    repo_path,transformation_name,build_command,validation_commands,additional_plan_context
    
    ✅ Use for: Simple scenarios with one TD per repository
    ❌ Limitation: Multi-TD not supported (use JSON instead)
    
    Example:
    /path/to/repo,AWS/java-version-upgrade,mvn test,"","Upgrade to Java 17"

JSON FORMAT (Advanced - Multi-TD, batches, priorities):
    {
      "repositories": [
        {
          "name": "my-app",
          "path": "https://github.com/org/repo.git",
          "transformation_name": "AWS/java-upgrade,AWS/sdk-v2",
          "batch_group": 1,
          "parallel_eligible": true
        }
      ]
    }
    
    ✅ Use for: Multi-TD, GitHub URLs, batch processing, priorities

════════════════════════════════════════════════════════════════
   💡 EXAMPLES
════════════════════════════════════════════════════════════════

🔹 Simple CSV execution:
    $0 --input repos.csv

🔹 Single repo with multi-TD (create JSON with 1 repo):
    $0 --input single-repo.json --dry-run

🔹 Parallel execution (4 at once):
    $0 --input config.json --mode parallel

🔹 Batch processing (JSON with batch_group field):
    $0 --input config.json --batch 1

🔹 Campaign tracking:
    $0 --input repos.csv --create-campaign "feb-2026-upgrade"

🔹 Dry run preview:
    $0 --input repos.csv --dry-run

🔹 Resume after interruption:
    $0 --input repos.csv --resume

════════════════════════════════════════════════════════════════
   ✨ KEY FEATURES
════════════════════════════════════════════════════════════════

✓ CSV + JSON hybrid input formats
✓ Auto-clone GitHub repositories (HTTPS/SSH)
✓ Multi-TD sequential execution (JSON only)
✓ Live dashboard with real-time progress updates
✓ Timestamped run isolation (automatic history)
✓ Resume interrupted executions automatically
✓ Enhanced status tracking (4 states with emojis)
✓ Campaign integration for team visibility (optional)
✓ Terminal window spawning with monitoring
✓ Trust-all-tools enabled by default
✓ Comprehensive summary reports
✓ Failed repository retry via CSV

════════════════════════════════════════════════════════════════

EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --input)
                INPUT_FILE="$2"
                shift 2
                ;;
            --mode)
                EXECUTION_MODE="$2"
                MODE_EXPLICIT=true
                shift 2
                ;;
            --batch)
                BATCH_NUMBER="$2"
                EXECUTION_MODE="batch"
                shift 2
                ;;
            --campaign)
                CAMPAIGN_NAME="$2"
                shift 2
                ;;
            --create-campaign)
                CREATE_CAMPAIGN=true
                CAMPAIGN_NAME="$2"
                shift 2
                ;;
            --no-trust-tools)
                TRUST_ALL_TOOLS=false
                shift
                ;;
            --output-dir)
                OUTPUT_DIR="$2"
                shift 2
                ;;
            --clone-dir)
                CLONE_DIR="$2"
                shift 2
                ;;
            --max-jobs)
                MAX_JOBS="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --resume)
                RESUME_MODE=true
                shift
                ;;
            --yes|-y)
                SKIP_CONFIRM=true
                shift
                ;;
            --help)
                usage
                exit 0
                ;;
            --version)
                echo "atx-custom-automation $SCRIPT_VERSION"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
    
    [[ -z "$INPUT_FILE" ]] && echo "Error: --input required" && usage && exit 1
    [[ ! -f "$INPUT_FILE" ]] && echo "Error: File not found: $INPUT_FILE" && exit 1
    
    # Validate --mode
    case "$EXECUTION_MODE" in
        serial|parallel|batch|terminal) ;;
        *) echo "Error: --mode must be serial, parallel, batch, or terminal"; exit 1 ;;
    esac
    
    # Validate --max-jobs
    if ! [[ "$MAX_JOBS" =~ ^[0-9]+$ ]] || [[ "$MAX_JOBS" -lt 1 ]]; then
        echo "Error: --max-jobs must be a positive integer"; exit 1
    fi
    
    # Validate --batch
    if [[ "$EXECUTION_MODE" == "batch" ]] && ! [[ "$BATCH_NUMBER" =~ ^[0-9]+$ ]]; then
        echo "Error: --batch must be a number"; exit 1
    fi
    
    # Auto-detect format
    if [[ "$INPUT_FILE" =~ \.json$ ]]; then
        INPUT_FORMAT="json"
    elif [[ "$INPUT_FILE" =~ \.csv$ ]]; then
        INPUT_FORMAT="csv"
    else
        echo "Error: File must be .csv or .json"
        exit 1
    fi
}

main() {
    local start_time=$(date +%s)
    
    # Set up trap for graceful Ctrl+C handling
    trap cleanup_on_interrupt SIGINT SIGTERM
    
    parse_args "$@"
    setup_environment
    check_atx_cli
    
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   🚀 ATX Custom Automation Starting${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}📄 Input:${NC} $INPUT_FILE ($INPUT_FORMAT)"
    echo -e "${CYAN}🔄 Mode:${NC} $EXECUTION_MODE"
    [[ "$DRY_RUN" == true ]] && echo -e "${YELLOW}👁️  DRY-RUN MODE${NC} - No transformations will be executed"
    echo ""
    
    # Load configuration
    if [[ "$INPUT_FORMAT" == "csv" ]]; then
        load_config_from_csv "$INPUT_FILE"
    else
        load_config_from_json "$INPUT_FILE"
    fi
    
    [[ ${#REPOS[@]} -eq 0 ]] && log_error "No repositories loaded" && exit 1
    
    # Run pre-flight validation (region, TD names, connectivity)
    run_preflight_checks
    
    # Handle resume mode
    if [[ "$RESUME_MODE" == true ]]; then
        init_status_file
        if [[ -f "$STATUS_FILE" ]]; then
            # Filter out completed repos
            local original_count=${#REPOS[@]}
            local filtered_repos=()
            
            for repo_entry in "${REPOS[@]}"; do
                local repo_name=$(echo "$repo_entry" | awk -F'\\|\\|\\|' '{print $1}')
                local status=$(grep "^${repo_name}|COMPLETED|" "$STATUS_FILE" 2>/dev/null || echo "")
                
                if [[ -z "$status" ]]; then
                    filtered_repos+=("$repo_entry")
                fi
            done
            
            local skipped=$((original_count - ${#filtered_repos[@]}))
            
            if [[ $skipped -gt 0 ]]; then
                REPOS=("${filtered_repos[@]}")
                log_info "Resume mode: Skipping $skipped completed repositories, running ${#REPOS[@]} remaining"
            else
                log_info "Resume mode: No completed repositories found, running all ${#REPOS[@]}"
            fi
            
            [[ ${#REPOS[@]} -eq 0 ]] && log_success "All repositories already completed!" && exit 0
        else
            log_warning "Resume mode: No previous run found (.atx-batch-status missing)"
        fi
    fi
    
    # Check SSH connectivity for repos using SSH URLs
    check_ssh_connectivity
    
    # Show execution plan and confirm (unless dry-run)
    if [[ "$DRY_RUN" != true ]]; then
        confirm_execution
    fi
    
    # Create campaign if requested
    if [[ "$CREATE_CAMPAIGN" == true ]]; then
        # Get first TD from first repository for campaign
        local first_repo="${REPOS[0]}"
        local first_td=$(echo "$first_repo" | awk -F'\\|\\|\\|' '{print $3}' | cut -d, -f1)
        
        create_campaign "$CAMPAIGN_NAME" "$first_td" || {
            log_error "Campaign creation failed. Continue without campaign tracking? (y/N)"
            read -n 1 -r
            echo
            [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
            CAMPAIGN_NAME=""  # Clear campaign name to proceed without it
        }
    fi
    
    # Log campaign info
    if [[ -n "$CAMPAIGN_NAME" ]]; then
        log_info "Campaign tracking enabled: $CAMPAIGN_NAME"
    fi
    
    # Initialize results
    echo "STATUS|REPO_NAME|MESSAGE|DURATION" > "$OUTPUT_DIR/results.txt"
    
    # Execute based on mode
    case "$EXECUTION_MODE" in
        "batch")
            # Execute specific batch
            if [[ -z "$BATCH_NUMBER" ]]; then
                log_error "Batch number required with --batch"
                exit 1
            fi
            
            execute_batch "$BATCH_NUMBER"
            exit $?
            ;;
        "terminal")
            # Spawn terminal windows (one per repository)
            execute_terminal
            exit $?
            ;;
        "parallel")
            # Standard parallel execution
            execute_parallel
            ;;
        *)
            execute_serial
            ;;
    esac
    
    # Generate summary
    local total_duration=$(($(date +%s) - start_time))
    generate_summary_report "$total_duration"
    
    # Campaign monitoring reminder
    if [[ -n "$CAMPAIGN_NAME" ]]; then
        echo ""
        log_info "Monitor campaign: atx custom campaign get --name \"$CAMPAIGN_NAME\""
        log_info "View repo status: atx custom campaign list-repos --name \"$CAMPAIGN_NAME\""
    fi
    
    log_success "Execution completed!"
}

main "$@"
