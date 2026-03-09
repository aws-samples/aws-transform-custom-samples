# ATX Custom Automation - Batch Code Transformation

Automate AWS Transform Custom transformations across multiple repositories with a single command. Perfect for migrating Java versions, upgrading Python, modernizing Node.js applications, and more.

## 🎯 What Does This Do?

This script orchestrates AWS Transform Custom (ATX) across multiple code repositories simultaneously. It handles:
- Cloning repositories from GitHub
- Running ATX transformations sequentially or in parallel
- Tracking progress with a live dashboard
- Managing failures and retries
- Generating comprehensive reports

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Install ATX Custom CLI
curl -fsSL https://desktop-release.transform.us-east-1.api.aws/install.sh | bash

# Verify installation
atx --version
```

### 2. Create Input File

Create `my-repos.csv`:
```csv
repo_path,transformation_name,build_command,validation_commands,additional_plan_context
https://github.com/myorg/java-app.git,AWS/java-version-upgrade,mvn clean test,"","Upgrade Java 8 to 17"
./local-python-project,AWS/python-version-upgrade,pytest,"","Upgrade Python 3.8 to 3.11"
git@github.com:myorg/node-service.git,AWS/nodejs-version-upgrade,npm test,"","Upgrade Node.js 16 to 20"
```

### 3. Run Transformations

```bash
./atx-custom-automation.sh --input my-repos.csv
```

Choose execution mode:
- **`b`** - Background parallel (all repos run together, live dashboard)
- **`t`** - Terminal windows (each repo in its own window)
- **`s`** - Serial (one repo at a time)

### 4. View Results

```bash
cat batch_results/latest/summary.log
```

## 📊 Execution Modes

### Background Parallel (Recommended for Speed)

```bash
./atx-custom-automation.sh --input repos.csv
# Choose 'b'
```

**Live Dashboard:**
```
════════════════════════════════════════════════════════════════
   🚀 BATCH EXECUTION IN PROGRESS
════════════════════════════════════════════════════════════════

  Repository                          Status         Duration
  ─────────────────────────────────── ────────────── ────────
  java-spring-app                     ⏳ IN_PROGRESS  2m 15s
  python-flask-api                    ✓  COMPLETED    1m 45s
  nodejs-express-service              ⏳ IN_PROGRESS  2m 05s
  react-frontend                      ⏸  PENDING      --
  go-microservice                     ⏸  PENDING      --

  Progress: ████░░░░░░░░░░░░░░░░ 1/5 (20%) | Elapsed: 2m 15s
  
  [Updates every 30s | Press Ctrl+C to interrupt]
════════════════════════════════════════════════════════════════
```

### Terminal Windows (Best for Watching Live)

```bash
./atx-custom-automation.sh --input repos.csv
# Choose 't'
```

- Opens a separate terminal window for each repository
- See live ATX output in each window
- Parent window shows monitoring dashboard
- Automatically detects when terminals close

### Serial (Safest)

```bash
./atx-custom-automation.sh --input repos.csv
# Choose 's'
```

- One repository at a time
- Full output visible
- Easier to debug issues

## 📝 Input Formats

### CSV Format (Simple)

Use for straightforward scenarios with one transformation per repository.

**Template:**
```csv
repo_path,transformation_name,build_command,validation_commands,additional_plan_context
```

**Example:**
```csv
repo_path,transformation_name,build_command,validation_commands,additional_plan_context
https://github.com/org/java-app.git,AWS/java-version-upgrade,mvn clean test,"","Java 8→17"
./local/python-service,AWS/python-version-upgrade,pytest,"","Python 3.8→3.11"
git@github.com:org/node-api.git,AWS/nodejs-version-upgrade,npm test,"","Node 16→20"
```

**Field Descriptions:**
- `repo_path` - GitHub URL (HTTPS/SSH) or local path
- `transformation_name` - ATX transformation to apply
- `build_command` - Validation command (optional - leave empty if not needed)
- `validation_commands` - Additional validation requirements (optional)
- `additional_plan_context` - Extra context for ATX (optional)

### JSON Format (Advanced)

Use when you need multiple transformations per repository, batch groups, or execution priorities.

**Template:**
```json
{
  "repositories": [
    {
      "name": "my-app",
      "path": "https://github.com/org/repo.git",
      "transformation_name": "AWS/java-upgrade,AWS/sdk-v2,AWS/spring-boot-3",
      "build_command": "mvn clean install",
      "parallel_eligible": true,
      "batch_group": 1,
      "execution_priority": "high"
    }
  ]
}
```

**JSON-Only Features:**
- Multiple transformations per repo (comma-separated)
- Batch groups for coordinated execution
- Execution priorities (high/normal/low)
- Parallel eligibility control

## 🔐 Authentication

### GitHub SSH (Recommended for Private Repos)

```bash
# 1. Generate SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# 2. Add to GitHub
cat ~/.ssh/id_ed25519.pub
# Copy and add to: GitHub Settings → SSH and GPG keys

# 3. Test connection
ssh -T git@github.com

# 4. Use SSH URLs in input file
git@github.com:myorg/private-repo.git
```

### GitHub HTTPS

Use personal access tokens or configure git credentials:
```bash
git config --global credential.helper store
```

## 🛠️ Command Reference

```bash
# Basic execution
./atx-custom-automation.sh --input <file>

# Execution modes
--mode parallel              # Multiple repos at once (default)
--mode serial                # One repo at a time  
--mode terminal              # Separate terminal per repo

# Options
--yes, -y                    # Skip confirmation (for automation)
--dry-run                    # Preview without executing
--resume                     # Continue from previous run
--max-jobs <n>              # Max parallel jobs (default: 10)

# Campaign tracking (optional)
--create-campaign <name>     # Create ATX campaign
--campaign <name>            # Use existing campaign

# Advanced
--output-dir <path>          # Custom output directory
--clone-dir <path>           # Custom clone directory
--no-trust-tools             # Require manual approvals

# Help
--help                       # Show detailed help
--version                    # Show version
```

## 📂 Output Structure

Each execution creates a timestamped folder:

```
batch_results/
├── 2026-02-24_21-00-00/           # Run from 9 PM
│   ├── java-app/
│   │   ├── execution.log          # Detailed ATX output
│   │   └── td1_config.yaml        # TD configuration
│   ├── python-service/
│   │   └── execution.log
│   ├── .atx-batch-status          # Status tracking
│   ├── results.txt                # Machine-readable results
│   ├── summary.log                # Human-readable summary
│   └── failed_repos.csv           # Failed repos (for retry)
│
└── latest → 2026-02-24_21-00-00/  # Symlink to most recent
```

### Understanding Results

**Status Indicators:**
- ⏸ `PENDING` - Queued, not started
- ⏳ `IN_PROGRESS` - Currently transforming
- ✓ `COMPLETED` - Successfully finished
- ✗ `FAILED` - Error occurred

**Duration vs Elapsed:**
- **Duration** column - Time for that specific repository
- **Elapsed** time - Total time since batch started (parallel repos overlap)

## 🔄 Resume & Recovery

### Resume Interrupted Execution

```bash
# First run (interrupted)
./atx-custom-automation.sh --input repos.csv --yes

# Press Ctrl+C to stop...

# Resume from where you left off
./atx-custom-automation.sh --input repos.csv --resume
```

The script automatically:
- Finds the latest run
- Skips completed repositories
- Re-runs failed or interrupted repositories
- Writes results to the same folder

### Retry Failed Repositories

```bash
# After a batch completes, retry failures
./atx-custom-automation.sh --input batch_results/latest/failed_repos.csv
```

## 💡 Common Use Cases

### Use Case 1: Java Version Upgrade Portfolio

```csv
repo_path,transformation_name,build_command,validation_commands,additional_plan_context
./service-auth,AWS/java-version-upgrade,mvn clean install,"","Java 8→17"
./service-payment,AWS/java-version-upgrade,mvn test,"","Java 8→17"
./service-notification,AWS/java-version-upgrade,./gradlew test,"","Java 11→17"
```

Run with:
```bash
./atx-custom-automation.sh --input java-upgrades.csv --mode parallel --max-jobs 3
```

### Use Case 2: Multi-Transformation Migration (JSON)

For repositories needing multiple transformations in sequence:

```json
{
  "repositories": [
    {
      "name": "legacy-monolith",
      "path": "./legacy-monolith",
      "transformation_name": "AWS/java-upgrade,AWS/sdk-v2,AWS/spring-boot-3",
      "build_command": "mvn clean install",
      "additional_plan_context": "Critical production service"
    }
  ]
}
```

Run with:
```bash
./atx-custom-automation.sh --input critical-migration.json
```

### Use Case 3: Watch Live in Terminal Windows

```bash
./atx-custom-automation.sh --input repos.csv
# Choose 't' for terminal windows
```

Each repository opens in its own terminal showing live ATX output. Parent window displays monitoring dashboard tracking all executions.

### Use Case 4: CI/CD Automation

```bash
# Non-interactive execution
./atx-custom-automation.sh --input repos.csv --yes

# Or explicit mode
./atx-custom-automation.sh --input repos.csv --mode parallel --yes
```

## 🐛 Troubleshooting

### ATX CLI Not Found

```bash
curl -fsSL https://desktop-release.transform.us-east-1.api.aws/install.sh | bash
```

### Clone Failed (Private Repos)

Set up SSH keys (see Authentication section above).

### Transformation Failed

Check detailed logs:
```bash
cat batch_results/latest/<repo-name>/execution.log
```

### No Status Updates (Terminal Mode)

If you close terminal windows, the monitoring stops after 2 minutes of no updates with a helpful message to resume.

##  Advanced Features

### Multi-Transformation Execution (JSON Only)

Run multiple transformations in sequence on the same repository:

```json
{
  "repositories": [
    {
      "name": "my-monolith",
      "path": "./my-monolith",
      "transformation_name": "AWS/java-upgrade,AWS/sdk-v2,AWS/security-hardening",
      "build_command": "mvn clean install"
    }
  ]
}
```

Transformations execute one after another (TD1 → TD2 → TD3).

### Campaign Tracking

Integrate with ATX Custom's campaign system for team-wide visibility:

```bash
# Create campaign and execute
./atx-custom-automation.sh --input repos.csv --create-campaign "q1-2026-java-migration"

# Monitor via ATX CLI
atx custom campaign get --name "q1-2026-java-migration"
atx custom campaign list-repos --name "q1-2026-java-migration"
```

### Batch Groups (JSON Only)

Coordinate execution order across repositories:

```json
{
  "repositories": [
    {
      "name": "database-schema",
      "path": "./db-schema",
      "transformation_name": "AWS/sql-modernization",
      "batch_group": 1
    },
    {
      "name": "backend-api",  
      "path": "./backend",
      "transformation_name": "AWS/java-upgrade",
      "batch_group": 2
    }
  ]
}
```

Run batch 1, then batch 2:
```bash
./atx-custom-automation.sh --input repos.json --batch 1
./atx-custom-automation.sh --input repos.json --batch 2
```

## 🎯 Recommendations

### When to Use CSV vs JSON

**Use CSV when:**
- Simple one-transformation-per-repo scenarios
- Working with Excel or spreadsheet tools
- Quick setup is priority
- Learning the tool

**Use JSON when:**
- Multiple transformations per repository
- Batch coordination needed
- Execution priorities matter
- Advanced control required

**Pro tip:** Start with CSV, migrate to JSON when complexity grows.

## 📋 Execution Summary

After completion, view the summary:

```bash
cat batch_results/latest/summary.log
```

**Example Summary:**
```
EXECUTION SUMMARY
=================
Total Repositories  | 10
Successful         | 8
Failed             | 2
Success Rate       | 80%

FAILED REPOSITORIES
===================
legacy-service     | Build validation failed
old-monolith       | TD execution failed
```

## 🚨 Common Patterns

### Pattern: Failed Repository Retry

```bash
# Initial run
./atx-custom-automation.sh --input repos.csv

# Automatically creates failed_repos.csv
./atx-custom-automation.sh --input batch_results/latest/failed_repos.csv
```

### Pattern: Dry Run Before Production

```bash
# Preview without executing
./atx-custom-automation.sh --input production-repos.csv --dry-run

# Review preview, then execute
./atx-custom-automation.sh --input production-repos.csv
```

### Pattern: Mixed Language Portfolio

```csv
repo_path,transformation_name,build_command,validation_commands,additional_plan_context
./java-backend,AWS/java-version-upgrade,mvn test,"","Java"
./python-ml-service,AWS/python-version-upgrade,pytest,"","Python"
./nodejs-frontend,AWS/nodejs-version-upgrade,npm test,"","Node.js"
./go-gateway,AWS/go-modernization,go test ./...,"","Go"
```

## 🎓 Best Practices

1. **Start small** - Test with 1-2 repos before running on your entire portfolio
2. **Use SSH for private repos** - More reliable than HTTPS authentication
3. **Review dry-run output** - Always preview transformations first
4. **Monitor dashboard** - Watch for failures in real-time
5. **Check execution logs** - Detailed logs help debug issues
6. **Resume interrupted runs** - Don't restart from scratch

## 📊 Templates

Quickstart templates provided:
- `template-repos.csv` - CSV format with all columns
- `template-config.json` - JSON format with all options

Copy and customize for your repositories.

---

**Version:** 2.0  
**Last Updated:** February 24, 2026  
**Support:** Check ATX documentation at https://docs.aws.amazon.com/transform/