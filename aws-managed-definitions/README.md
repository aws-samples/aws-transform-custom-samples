# AWS-Managed Transformation Definitions

Out-of-box transformation definitions provided by AWS for common migration and upgrade scenarios.

## Available Definitions

| Language | Transformation | Description |
|----------|---------------|-------------|
| Java | [Version Upgrade](java/version-upgrade.md) | Upgrade Java applications to newer JDK versions |
| Java | [AWS SDK v1 → v2](java/aws-sdk-v1-to-v2.md) | Migrate from AWS SDK for Java v1 to v2 |
| Node.js | [Version Upgrade](nodejs/version-upgrade.md) | Upgrade Node.js applications to newer runtime versions |
| Node.js | [AWS SDK v2 → v3](nodejs/aws-sdk-v2-to-v3.md) | Migrate from AWS SDK for JavaScript v2 to v3 |
| Python | [Version Upgrade](python/version-upgrade.md) | Upgrade Python 3.8/3.9 Lambda applications to 3.11+ |
| Python | [boto2 → boto3](python/boto2-to-boto3.md) | Migrate from AWS SDK v1 (boto2) to v2 (boto3) |
| General | [Codebase Analysis](comprehensive-codebase-analysis/codebase-analysis.md) | Static analysis and documentation for migration planning |

## Directory Structure

```
aws-managed-definitions/
├── comprehensive-codebase-analysis/
│   └── codebase-analysis.md
├── java/
│   ├── version-upgrade.md
│   └── aws-sdk-v1-to-v2.md
├── nodejs/
│   ├── version-upgrade.md
│   └── aws-sdk-v2-to-v3.md
└── python/
    ├── version-upgrade.md
    └── boto2-to-boto3.md
```
