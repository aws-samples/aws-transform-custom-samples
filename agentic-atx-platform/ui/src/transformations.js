// Shared catalog of AWS-managed transformations. Used by TransformationList
// (display) and KnowledgeItems (dropdown) so the two never drift.

export const MANAGED_TRANSFORMATIONS = [
  { name: 'AWS/python-version-upgrade', language: 'python', description: 'Upgrade Python applications from 3.8/3.9 to 3.11/3.12/3.13', managed: true },
  { name: 'AWS/java-version-upgrade', language: 'java', description: 'Upgrade Java applications from any source JDK to any target JDK with dependency modernization', managed: true },
  { name: 'AWS/nodejs-version-upgrade', language: 'nodejs', description: 'Upgrade Node.js applications from any source to any target version', managed: true },
  { name: 'AWS/python-boto2-to-boto3', language: 'python', description: 'Migrate Python applications from boto2 to boto3', managed: true },
  { name: 'AWS/java-aws-sdk-v1-to-v2', language: 'java', description: 'Upgrade AWS SDK from v1 to v2 for Java (Maven or Gradle)', managed: true },
  { name: 'AWS/nodejs-aws-sdk-v2-to-v3', language: 'nodejs', description: 'Upgrade Node.js from AWS SDK v2 to v3 modular architecture', managed: true },
  { name: 'AWS/comprehensive-codebase-analysis', language: 'all', description: 'Deep static analysis with technical debt, security, and modernization insights', managed: true },
  { name: 'AWS/java-performance-optimization', language: 'java', description: 'Optimize Java performance by analyzing JFR profiling data to detect CPU/memory hotspots and apply targeted fixes', managed: true },
  { name: 'AWS/early-access-java-x86-to-graviton', language: 'java', description: '[Early Access] Validate and migrate Java applications to ARM64 for AWS Graviton', managed: true },
  { name: 'AWS/early-access-angular-to-react-migration', language: 'nodejs', description: '[Early Access] Transform Angular applications to React', managed: true },
  { name: 'AWS/vue.js-version-upgrade', language: 'nodejs', description: '[Early Access] Upgrade Vue.js 2 applications to Vue.js 3', managed: true },
  { name: 'AWS/angular-version-upgrade', language: 'nodejs', description: '[Early Access] Upgrade older Angular applications to a target Angular version', managed: true },
  { name: 'AWS/early-access-log4j-to-slf4j-migration', language: 'java', description: '[Early Access] Migrate Java applications from Log4j (1.x/2.x) to SLF4J with Logback backend', managed: true },
]

export const MANAGED_TRANSFORMATION_NAMES = MANAGED_TRANSFORMATIONS.map(t => t.name)
