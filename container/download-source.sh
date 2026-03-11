#!/bin/bash
set -e

# Logging function with timestamps
log() {
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"
}

SOURCE_URL="$1"

if [[ -z "$SOURCE_URL" ]]; then
    log "No source URL provided, skipping download"
    mkdir -p /source/workspace
    echo "workspace" > /tmp/repo_name.txt
    log "Created workspace directory at /source/workspace"
    exit 0
fi

# Validate source URL format before clearing /source
if [[ "$SOURCE_URL" == s3://* ]]; then
    SOURCE_TYPE="s3"
elif [[ "$SOURCE_URL" == https://* ]] || [[ "$SOURCE_URL" == http://* ]] || [[ "$SOURCE_URL" == *.git ]]; then
    SOURCE_TYPE="git"
else
    log "Error: Unsupported source URL format: $SOURCE_URL"
    log "Supported formats:"
    log "  - Git repositories: https://github.com/user/repo.git or any HTTPS git URL"
    log "  - S3 directories: s3://bucket-name/path/"
    log "  - S3 ZIP files: s3://bucket-name/path/file.zip"
    exit 1
fi

# Clear /source directory only after validation
rm -rf /source/*

if [[ "$SOURCE_TYPE" == "s3" ]]; then
    log "Downloading from S3: $SOURCE_URL"

    # Check if it's a ZIP file
    if [[ "$SOURCE_URL" == *.zip ]]; then
        log "Detected ZIP file, downloading and extracting..."
        
        # Extract ZIP filename without extension for folder name
        ZIP_BASENAME=$(basename "$SOURCE_URL" .zip)
        
        # Download ZIP file
        ZIP_FILE="/tmp/source.zip"
        aws s3 cp "$SOURCE_URL" "$ZIP_FILE" --quiet
        
        # Extract ZIP file to /source
        unzip -q "$ZIP_FILE" -d /source/
        rm "$ZIP_FILE"
        
        # Find the extracted directories
        EXTRACTED_DIRS=$(find /source -mindepth 1 -maxdepth 1 -type d)
        DIR_COUNT=0
        if [[ -n "$EXTRACTED_DIRS" ]]; then
            DIR_COUNT=$(echo "$EXTRACTED_DIRS" | wc -l)
        fi
        
        if [ "$DIR_COUNT" -eq 1 ]; then
            # Single directory extracted, use it
            DIR_NAME=$(basename "$EXTRACTED_DIRS")
            log "Extracted to directory: $DIR_NAME"
            echo "$DIR_NAME" > /tmp/repo_name.txt
        else
            # Zero, multiple files/dirs — wrap everything under ZIP name
            log "Wrapping extracted content in '$ZIP_BASENAME' directory"
            mkdir -p "/source/$ZIP_BASENAME"
            find /source -mindepth 1 -maxdepth 1 ! -name "$ZIP_BASENAME" -exec mv {} "/source/$ZIP_BASENAME/" \;
            echo "$ZIP_BASENAME" > /tmp/repo_name.txt
            log "All files moved to /source/$ZIP_BASENAME/"
        fi
    else
        # Regular S3 directory sync
        log "Syncing S3 directory..."
        mkdir -p /source/project
        aws s3 sync "$SOURCE_URL" /source/project/ --quiet
        echo "project" > /tmp/repo_name.txt
    fi
    
elif [[ "$SOURCE_TYPE" == "git" ]]; then
    log "Cloning git repository: $SOURCE_URL"
    # Extract repo name: strip trailing .git and take basename
    REPO_NAME=$(basename "$SOURCE_URL" .git)
    git clone "$SOURCE_URL" "/source/$REPO_NAME"
    echo "$REPO_NAME" > /tmp/repo_name.txt
fi

log "Source code downloaded successfully to /source/"
ls -la /source/
