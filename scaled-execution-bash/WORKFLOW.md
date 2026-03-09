# ATX Custom Automation - System Workflow (v2.0)

## Execution Flow Overview

```mermaid
flowchart TD
    A[START SCRIPT] --> B[Parse Arguments<br/>--input file<br/>--mode type]
    B --> C[Setup Environment<br/>Create dirs<br/>Check ATX CLI]
    C --> D[Load Repos<br/>CSV or JSON]
    D --> E[Pre-Flight Validation<br/>Region Check]
    E --> F{Resume Mode?}
    F -->|Yes| G[Skip COMPLETED<br/>Run remaining]
    F -->|No| H[Fresh Start<br/>Run all repos]
    G --> I[User Confirms<br/>b = Parallel<br/>t = Terminal<br/>s = Serial]
    H --> I
    I --> J[PARALLEL MODE]
    I --> K[TERMINAL MODE]
    I --> L[SERIAL MODE]
```

---

## Mode 1: Parallel Execution

```mermaid
flowchart TD
    A[Initialize Status File] --> B[Mark all repos PENDING]
    B --> C{TTY detected?}
    C -->|Yes| D[Dashboard Mode]
    C -->|No| E[Line Updates]
    D --> F[Launch Parallel Jobs<br/>Max 10 concurrent]
    E --> F
    F --> G[Monitor Loop<br/>Every 30s:<br/>Check job status<br/>Update dashboard<br/>Show progress bar]
    G --> H{All jobs complete?}
    H -->|No| G
    H -->|Yes| I[Show Final Dashboard]
    I --> J[Generate Summary Report]
```

**Dashboard View:**

```
════════════════════════════════════════════════════════════════
   🚀 BATCH EXECUTION IN PROGRESS
════════════════════════════════════════════════════════════════

  Repository                    Status         Duration
  ───────────────────────────── ────────────── ────────
  repo-1                        ⏳ IN_PROGRESS  2m 15s
  repo-2                        ✓  COMPLETED    1m 45s
  repo-3                        ⏸  PENDING      --

  Progress: ████░░░░░░░░░░░░░░░░ 1/3 (33%) | Elapsed: 2m 15s

  [Updates every 30s | Press Ctrl+C to interrupt]
════════════════════════════════════════════════════════════════
```

---

## Mode 2: Terminal Windows

```mermaid
flowchart TD
    A[For each repository] --> B[Create temp CSV<br/>single repo]
    B --> C[Spawn Terminal Window<br/>Pass --output-dir<br/>Run: --mode serial]
    C --> D{More repos?}
    D -->|Yes| A
    D -->|No| E[Parent Window:<br/>Monitoring Dashboard]
    E --> F[Read shared .atx-batch-status]
    F --> G{All done or<br/>2min stale?}
    G -->|No, update every 30s| F
    G -->|Yes| H[Show Final Summary]
```

**Each Spawned Terminal Shows:**

```
📥 Cloning repo-name...
✓ Cloned (2s)

🤖 Analyzing codebase...
📝 Generating transformation plan...
🔧 Applying changes...
✅ Transformation complete!

✓ Repository completed (1m 45s)
Press Enter to close...
```

---

## Mode 3: Serial Execution

```mermaid
flowchart TD
    A[Start] --> B[Process Repo 1]
    B --> C[Mark IN_PROGRESS]
    C --> D[Clone if GitHub URL]
    D --> E[Execute ATX<br/>Show LIVE output]
    E --> F[Mark COMPLETED<br/>or FAILED]
    F --> G{More repos?}
    G -->|Yes| B
    G -->|No| H[Generate Summary Report]
```

**Enhanced Serial Output (Option A):**

```
════════════════════════════════════════════════════════════════
   🚀 [1/5] anotar-app-api
════════════════════════════════════════════════════════════════
  📍 Source: https://github.com/org/repo.git (GitHub HTTPS)
  🔄 TDs: 2 (AWS/nodejs-version-upgrade → AWS/early-access-codebase-analysis)
  🔨 Build: npm test

  📥 Cloning...                              ✓ (2s)
  ▶ TD 1/2: AWS/nodejs-version-upgrade       ✓ (12s)
  ▶ TD 2/2: AWS/early-access-codebase...     ✓ (20s)

  ✅ Completed (35s)
════════════════════════════════════════════════════════════════
```

---

## Status Lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> IN_PROGRESS
    IN_PROGRESS --> COMPLETED
    IN_PROGRESS --> FAILED
    COMPLETED --> [*]
    FAILED --> [*]
```

| Status | Symbol | Color | Description |
|--------|--------|-------|-------------|
| PENDING | ⏸ | Cyan | Repo queued but not started |
| IN_PROGRESS | ⏳ | Yellow | ATX transformation running |
| COMPLETED | ✓ | Green | Transformation succeeded |
| FAILED | ✗ | Red | Error occurred |

---

## File Structure

```
batch_results/
├── 2026-02-24_21-00-00/              ← Timestamped run directory
│   ├── repo-1/
│   │   ├── execution.log             ← Full ATX output
│   │   └── td1_config.yaml           ← TD configuration
│   ├── repo-2/
│   │   └── execution.log
│   ├── .atx-batch-status             ← Status tracking (repo|status|time|duration)
│   ├── results.txt                   ← Machine-readable (status|repo|msg|dur)
│   ├── summary.log                   ← Human-readable summary
│   └── failed_repos.csv              ← Failed repos for retry
│
└── latest → 2026-02-24_21-00-00/     ← Symlink to most recent

batch_repos/                          ← Cloned GitHub repositories
└── repo-1/
└── repo-2/
```

---

## Concurrency Model (Parallel Mode)

```mermaid
sequenceDiagram
    participant P1 as Process 1
    participant Lock as File Lock (mkdir)
    participant P2 as Process 2
    participant P3 as Process 3

    P1->>Lock: mkdir "file.lock" ✓
    P2->>Lock: mkdir "file.lock" ✗ (wait)
    P3->>Lock: mkdir "file.lock" ✗ (wait)
    P1->>P1: Write to file
    P1->>Lock: rmdir "file.lock"
    P2->>Lock: mkdir "file.lock" ✓
    P2->>P2: Write to file
    P2->>Lock: rmdir "file.lock"
    P3->>Lock: mkdir "file.lock" ✓
    P3->>P3: Write to file
    P3->>Lock: rmdir "file.lock"
```

All status updates are atomic and safe for parallel execution.

---

## Resume Functionality

```mermaid
flowchart TD
    A["./script.sh --resume"] --> B[Find latest run<br/>batch_results/latest/]
    B --> C[Read .atx-batch-status]
    C --> D{For each repo}
    D --> E{Has COMPLETED entry?}
    E -->|Yes| F[SKIP]
    E -->|No| G[RUN]
    F --> D
    G --> D
    D -->|All checked| H[Execute remaining repos]
    H --> I[Write to SAME directory<br/>preserves history]
```

---

## Per-Repository Execution Flow

```mermaid
flowchart TD
    A[Mark PENDING] --> B[Mark IN_PROGRESS]
    B --> C{Repository Type?}
    C -->|GitHub URL| D[Clone repo]
    C -->|Local path| E[Use directly]
    D --> F[Execute ATX Transformation]
    E --> F
    F --> G[Parse comma-separated TDs]
    G --> H[Run each TD sequentially]
    H --> I{Scan log for<br/>error patterns}
    I -->|No errors| J{Exit code 0?}
    I -->|Error detected| L[Mark FAILED]
    J -->|Yes| K[Mark COMPLETED]
    J -->|No| L
    K --> M[Write to results.txt]
    L --> M
    M --> N[Update campaign<br/>if enabled]
```

---

## Pre-Flight Validation

```mermaid
flowchart TD
    A[Pre-Flight Check] --> B{AWS Region<br/>configured?}
    B -->|Not set| C["⚠ Warning: Not configured"]
    B -->|Set| D{Region supported?<br/>us-east-1 or<br/>eu-central-1}
    D -->|Yes| E["✓ Region OK"]
    D -->|No| F["✗ Region NOT SUPPORTED"]
    F --> G{Dry-run mode?}
    G -->|Yes| H[Continue with preview]
    G -->|No| I{--yes flag?}
    I -->|Yes| J[Abort execution]
    I -->|No| K[Ask user: Continue anyway?]
```

---

## ATX Error Detection

After each TD execution, the script scans logs for known error patterns:

| Pattern | Cause |
|---------|-------|
| `AWS Transform is not available in region` | Wrong AWS region configured |
| `Authentication failed` | Invalid AWS credentials |
| `Transformation not found` | TD name doesn't exist |
| `Access Denied` | Insufficient permissions |
| `InvalidIdentityToken` / `ExpiredToken` | Expired AWS session |
| `Rate exceeded` | API throttling |

If detected, the TD is marked as **FAILED** even if ATX CLI exits with code 0.

---

## Execution Modes Comparison

| Feature | Parallel | Terminal | Serial | Batch |
|---------|----------|----------|--------|-------|
| Speed | ⚡⚡⚡ | ⚡⚡ | ⚡ | ⚡⚡ |
| Live Output | Dashboard | Per-window | Full | Full |
| Resource Usage | High | Medium | Low | Medium |
| Debugging Ease | Medium | High | High | Medium |
| Best For | Large batches | Watching live | Simple cases | Dependencies |
| Max Concurrent | 10 | All | 1 | Per batch |
| CI/CD Friendly | Yes | No | Yes | Yes |

---

## Error Handling

```mermaid
flowchart LR
    A[No TTY?] --> B[Line-based updates]
    C[No jq?] --> D[Reject JSON<br/>Suggest CSV]
    E[Clone fails?] --> F[Mark FAILED<br/>Continue others]
    G["Ctrl+C pressed?"] --> H[Kill jobs<br/>Partial summary<br/>Suggest resume]
```

---

## Key Design Features

1. **Timestamped Isolation** — Each run gets unique folder, no overwrite prompts
2. **Dashboard Mode Flag** — Auto-detected: TTY + Parallel → Dashboard, otherwise full output
3. **Shared Output (Terminal Mode)** — Parent passes `--output-dir` to children, monitors shared status file
4. **Stale Detection** — No terminal updates for 2 minutes → Exit with resume suggestion
5. **Trust-All-Tools** — Enabled by default, override with `--no-trust-tools`
6. **Pre-Flight Validation** — Region check before execution starts
7. **Error Pattern Scanning** — Catches ATX issues that exit 0 but are actually failures

---

**Version:** 2.0
**Last Updated:** March 8, 2026
