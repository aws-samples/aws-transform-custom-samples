# AWS-Managed Transformation Definitions

Out-of-box transformation definitions provided by AWS for common migration and upgrade scenarios.

## Available Definitions

| Language | Transformation | Description |
|----------|---------------|-------------|
| Java | [Version Upgrade](java/version-upgrade.md) | Upgrade Java applications to newer JDK versions |
| Java | [AWS SDK v1 → v2](java/aws-sdk-v1-to-v2.md) | Migrate from AWS SDK for Java v1 to v2 |
| Java | [x86 → Graviton](graviton-migration/java/transformation-definition_x86-to-graviton.md) | Validate and migrate Java apps to AWS Graviton (ARM64) |
| Node.js | [Version Upgrade](nodejs/version-upgrade.md) | Upgrade Node.js applications to newer runtime versions |
| Node.js | [AWS SDK v2 → v3](nodejs/aws-sdk-v2-to-v3.md) | Migrate from AWS SDK for JavaScript v2 to v3 |
| Python | [Version Upgrade](python/version-upgrade.md) | Upgrade Python 3.8/3.9 Lambda applications to 3.11+ |
| Python | [boto2 → boto3](python/boto2-to-boto3.md) | Migrate from AWS SDK v1 (boto2) to v2 (boto3) |
| General | [Codebase Analysis](comprehensive-codebase-analysis/codebase-analysis.md) | Static analysis and documentation for migration planning |
| Readiness | [Modernization Readiness Analysis](readiness-analysis/modernization-readiness-analysis.md) | Scans portfolios for cloud-native maturity gaps and maps findings to AWS modernization pathways |
| Readiness | [Agentic Readiness Analysis](readiness-analysis/agentic-readiness-analysis.md) | Evaluates whether systems are ready to be safely called by AI agents — covering APIs, identity, state management, human-in-the-loop, and observability |
| Readiness | [Portfolio Modernization Readiness](readiness-analysis/portfolio-modernization-readiness.md) | Aggregates per-repo MOD reports into portfolio-level roadmap and cross-cutting analysis |
| Readiness | [Portfolio Agentic Readiness](readiness-analysis/portfolio-agentic-readiness.md) | Aggregates per-repo ARA reports into portfolio-level cross-cutting analysis |
| AWS DevOps Agent | [Release Readiness Code Review](devops-agent-release-readiness-code-review/README.md) | Runs a Release Readiness Review on transformation code changes to catch deployment risks before completion |

## Directory Structure

```
aws-managed-definitions/
├── comprehensive-codebase-analysis/
│   └── codebase-analysis.md
├── graviton-migration/
│   └── java/
│       ├── transformation-definition_x86-to-graviton.md
│       └── document_references/
│           ├── agent-scope-boundaries.md
│           └── documentation-standards.md
├── java/
│   ├── version-upgrade.md
│   ├── aws-sdk-v1-to-v2.md
│   └── x86-to-graviton.md     # stub → graviton-migration/java/
├── nodejs/
│   ├── version-upgrade.md
│   └── aws-sdk-v2-to-v3.md
├── python/
│   ├── version-upgrade.md
│   └── boto2-to-boto3.md
├── devops-agent-release-readiness-code-review/
│   ├── README.md
│   ├── SKILL.md
│   └── scripts/
│       └── run_release_readiness_review.sh
└── readiness-analysis/
    ├── modernization-readiness-analysis.md
    ├── agentic-readiness-analysis.md
    ├── portfolio-modernization-readiness.md
    └── portfolio-agentic-readiness.md
```
