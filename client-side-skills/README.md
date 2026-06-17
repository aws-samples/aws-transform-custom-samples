# Client-Side Skills

Client-side skills are additional capabilities that extend the AWS Transform agent during transformation executions. They allow you to provide custom tools, scripts, and instructions that the agent can use alongside its built-in capabilities.

For full documentation, see [Custom Workflows - Client-Side Skills](https://docs.aws.amazon.com/transform/latest/userguide/custom-workflows.html).

## Available Skills

| Skill | Description |
|-------|-------------|
| [DevOps Agent Release Readiness Code Review](devops-agent-release-readiness-code-review/README.md) | Runs a Release Readiness Review on transformation code changes via AWS DevOps Agent to catch deployment risks before completion |

## How to Use Client-Side Skills with ATX

### Skill Discovery Directories

Skills are discovered from four directories in precedence order. If a skill with the same name exists in multiple directories, the first directory in the list takes priority:

1. `<project>/.aws/atx/skills/` - Project-level, AWS Transform CLI-specific
2. `<project>/.agents/skills/` - Project-level, cross-client (available to any compatible agent tooling)
3. `~/.aws/atx/skills/` - User-level, AWS Transform CLI-specific
4. `~/.agents/skills/` - User-level, cross-client (available to any compatible agent tooling)

The `.aws/atx/skills/` directories are specific to the AWS Transform CLI. The `.agents/skills/` directories are cross-client, meaning skills placed there are available to any compatible agent tooling beyond the AWS Transform CLI.

### Skill Directory Structure

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```
~/.aws/atx/skills/
└── my-skill/
    ├── SKILL.md          # Required: frontmatter + instructions
    ├── references/       # Optional: reference docs the agent can read
    │   └── guide.md
    └── scripts/          # Optional: scripts the agent can execute
        └── validate.py
```

### SKILL.md Format

```yaml
---
name: my-skill
description: When to use this skill
---
# Skill Title

Instructions for the agent...
```

The `name` field must match the parent directory name.

### Disabling a Skill

To prevent a skill from being loaded without removing its files, add `disable-model-invocation: true` to the frontmatter:

```yaml
---
name: my-skill
description: When to use this skill
disable-model-invocation: true
---
```

When this property is set, the CLI skips the skill during discovery. The agent cannot see or use the skill unless a transformation definition explicitly instructs it to read the skill file.

### Skill Availability by Execution Mode

- **Exec mode** (`atx custom def exec` with `--code-repository-path`) - Discovers skills from both user-level and project-level directories.
- **Interactive mode** (`atx`) - Only user-level skills are discovered initially. When you provide a code repository path during the session, project-level skills are also loaded.

### Verifying Skill Discovery

Check the CLI's debug log after a run to verify which skills were discovered:

```bash
grep -i "skill" ~/.aws/atx/logs/debug.log | tail -20
```

> **Note:** Client-side skills require CLI version 2.0 or later.

## Choosing Between Project-Level and User-Level Skills

**Project-level skills** (`<project>/.aws/atx/skills/`):

Commit these to version control so every team member running transformations against the repository automatically discovers them. Use project-level skills for:

- Repository-specific compliance checks (Dockerfile rules, Terraform policies, migration safety validators)
- Organization coding standards that apply to this codebase (observability patterns, error handling, naming conventions)
- Build or test scripts unique to the project (custom linters, architecture fitness functions)
- API migration guides for internal libraries used in this repository

**User-level skills** (`~/.aws/atx/skills/`):

These remain on your machine and activate during all transformations regardless of which repository you target. Use user-level skills for:

- Personal workflow tools (changelog generators, commit message formatters)
- Cross-project preferences (preferred test patterns, documentation style reminders)
- License compliance checks that your organization requires across all repositories
- Coverage thresholds or quality gates you enforce on every codebase you work with

## Tips for Effective Skills

- Write clear `description` fields in your `SKILL.md` frontmatter. The agent uses this field to decide when a skill is relevant.
- Exit validation scripts with code 0 on success and non-zero on failure. The agent interprets exit codes to determine compliance.
- Print clear, actionable error messages in scripts. The agent reads output to understand what to fix.
- Place skills in the cross-client directory (`.agents/skills/`) at either level to share them with other AI development tools beyond the AWS Transform CLI.

## Installing a Skill from This Repository

To install a skill from this directory into your project or user-level skill discovery path:

```bash
# Project-level (recommended for team-shared skills)
cp -r <skill-name>/ <your-project>/.aws/atx/skills/<skill-name>/

# User-level (for personal use across all projects)
cp -r <skill-name>/ ~/.aws/atx/skills/<skill-name>/
```

Then run any transformation and the skill will be automatically discovered and used by the agent.
