# Node.js Patterns Reference

Node.js-specific containerisation gotchas for Phase 2 transformation. Applies when `package.json` is present.

## Table of Contents

1. [Port Parsing — parseInt NaN Guard](#port-parsing)
2. [ioredis Pub/Sub Two-Connection Pattern](#ioredis-pubsub)
3. [process.env Timing — Module-Level Reads](#processenv-timing)
4. [multer memoryStorage Filename Trap](#multer-memorystorage)
5. [require.main Guard for CLI/Library Dual-Use](#requiremain-guard)
6. [Winston Transport Stacking](#winston-transport-stacking)
7. [connect-redis Version-Aware Import](#connect-redis-version-aware)
8. [ioredis Middleware Configuration](#ioredis-middleware-config)
9. [process.env Enumeration](#processenv-enumeration)
10. [Node.js Binary Absent Fallback](#nodejs-binary-absent-fallback)
11. [Non-Root USER on node:18-alpine](#non-root-user-on-node18-alpine)
12. [Jest Test Environment Variables](#jest-test-environment-variables)
13. [Socket.io Graceful Shutdown](#socketio-graceful-shutdown)
14. [Cluster Module Removal](#cluster-module-removal)
15. [CronJob Connection Bootstrap](#cronjob-connection-bootstrap)
16. [Optional Dependency Guard](#optional-dependency-guard)
17. [Bull/BullMQ Graceful Shutdown](#bull-bullmq-graceful-shutdown)
18. [Apollo Federation Subgraph Decomposition](#apollo-federation-subgraph-decomposition)
19. [WebSocket Gateway Extraction](#websocket-gateway-extraction)
20. [Next.js Route-to-Service Mapping](#nextjs-route-to-service-mapping)
21. [NestJS WebSocket Scaling](#nestjs-websocket-scaling)
22. [amqplib Reconnect Pattern](#amqplib-reconnect-pattern)
23. [IRSA Cross-Task Dependency](#irsa-cross-task-dependency)
24. [Test File Co-Scoping Rule](#test-file-co-scoping-rule)
25. [RABBITMQ_ROUTING_KEY False-Positive Exemption](#rabbitmq_routing_key-false-positive-exemption)
26. [JSDoc Cron Comment Hazard (Tier 1 Escalation)](#jsdoc-cron-comment-hazard)
27. [Template Literal Tier 1 Escalation](#template-literal-tier-1-escalation)
28. [connect-redis Absent-from-package.json Default](#connect-redis-absent-default)
29. [CronJob Lazy-Require for Connection-Eager Modules](#cronjob-lazy-require)
30. [SIGTERM Handler Standalone Worker Exception](#sigterm-handler-standalone-worker-exception)
31. [Express/Koa Health Probe Ordering](#expresskoa-health-probe-ordering)


## Pre-Docker Local Validation

**Purpose:** Verify Node.js source has no syntax errors, dependencies resolve, and TypeScript compiles — all BEFORE `docker build`.

### Commands
```bash
# 1. Syntax check entry point(s)
node --check src/index.js  # or main field from package.json
# Expected: exit 0 (silent success)

# 2. Dependency install
npm ci 2>&1  # or: npm install --prefer-offline
# Expected: exit 0

# 3. TypeScript compilation (if tsconfig.json present)
[ -f tsconfig.json ] && npx tsc --noEmit 2>&1
# Expected: exit 0

# 4. Unit tests (infrastructure-excluded)
npx jest --testPathIgnorePatterns='integration|e2e' --passWithNoTests 2>&1 || true
# Exit 0 = PASS; infrastructure failures = CONDITIONAL PASS; import errors = FAIL
```

### Expected Output
- Step 1: No output (exit 0 = syntax OK)
- Step 2: Exit 0 with packages installed
- Step 3: Exit 0 (no type errors) — only if TypeScript
- Step 4: Exit 0 or infrastructure-only failures

### CONDITIONAL PASS Triggers
- `node` not installed and `mise install node` fails → CONDITIONAL PASS
- Node.js version mismatch (engines.node in package.json) → CONDITIONAL PASS
- `npm ci` fails due to lock file desync → fix lock file first (see §Lock File Desync Pre-Check)
- Network timeout on npm registry (after 1 retry) → CONDITIONAL PASS

### Toolchain Bootstrap
```bash
# Check Node.js availability
command -v node && node --version
# If absent or wrong version, try mise
if [ -f .tool-versions ] || [ -f .mise.toml ] || [ -f .nvmrc ]; then
  command -v mise && mise install node 2>/dev/null
  export PATH=$HOME/.local/share/mise/shims:$PATH
fi
node --version && npm --version
```

### Validated Example Repositories
- NOT YET VALIDATED AGAINST REAL REPO — commands inferred from Node.js documentation. Mark as validated when a Node.js project passes through the pipeline.


## Port Parsing

```javascript
// BAD: string concatenation instead of addition
const port = process.env.PORT || 3000;  // "8080" (string)

// GOOD: always parseInt with NaN guard
const port = parseInt(process.env.PORT, 10) || 3000;
```

Rule: Every `process.env.*` read used as a number must use `parseInt(value, 10)` with `|| default`.

## ioredis Pub/Sub

A Redis connection in subscribe mode cannot issue other commands:

```javascript
const Redis = require('ioredis');
const subscriber = new Redis(process.env.REDIS_URL);
const publisher = new Redis(process.env.REDIS_URL);

subscriber.subscribe('channel');
subscriber.on('message', (ch, msg) => { /* handle */ });
publisher.publish('channel', JSON.stringify(data));
```

**Trap**: Single connection for both → `ERR only (P)SUBSCRIBE / (P)UNSUBSCRIBE / PING / QUIT`.

## process.env Timing

Module-level reads execute at `require()` time — before runtime setup:

```javascript
// BAD: reads env before dotenv.config
const DB_HOST = process.env.DB_HOST;  // undefined

// GOOD: lazy getter
module.exports = {
  get DB_HOST() { return process.env.DB_HOST || 'localhost'; }
};
```

Rule: Never assign `process.env.*` to a module-level constant.

## multer memoryStorage

With `multer({ storage: multer.memoryStorage() })`, `req.file.filename` is **undefined**:

```javascript
// BAD:
const filename = req.file.filename;  // undefined!
// GOOD:
const key = `uploads/${Date.now()}-${req.file.originalname}`;
await s3.putObject({ Key: key, Body: req.file.buffer });
```

## require.main Guard

```javascript
if (require.main === module) {
  runTask().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { runTask };
```

Without this guard, `require('./worker')` executes the task at import time.

## Winston Transport Stacking

`logger.add(transport)` appends — does NOT replace:

```javascript
// GOOD: configure once
const logger = winston.createLogger({
  transports: [new winston.transports.Console({ format: winston.format.json() })]
});
```

Migration: Remove all file transports; ensure exactly one Console transport outputting stdout.

## connect-redis Version-Aware Import

**CRITICAL: The CJS import pattern differs between connect-redis v7 and v9+.**

**v7 (CJS — uses `exports.default`):**
```javascript
const RedisStore = require('connect-redis').default;
const store = new RedisStore({ client: redisClient });
```

**v7 (ESM):**
```javascript
import RedisStore from 'connect-redis';
const store = new RedisStore({ client: redisClient });
```

**v9+ (CJS — uses named export):**
```javascript
const { RedisStore } = require('connect-redis');
const store = new RedisStore({ client: redisClient });
```

**v9+ (ESM):**
```javascript
import { RedisStore } from 'connect-redis';
const store = new RedisStore({ client: redisClient });
```

**Version detection:**
```bash
grep '"connect-redis"' package.json package-lock.json | grep -oP '"[~^]?\K[0-9]+'
# First digit: 7 → use .default; 9 → use { RedisStore }
```

**v6 (LEGACY — factory function, do NOT use in new code):**
```javascript
const RedisStore = require('connect-redis')(session);
```

**Jest mock shape warning**: Mock shape MUST mirror real CJS export structure. A mock matching the wrong import shape masks production bugs — all tests pass on broken code. For v7: `jest.mock('connect-redis', () => ({ default: MockRedisStore }))`. For v9+: `jest.mock('connect-redis', () => ({ RedisStore: MockRedisStore }))`.

**Source**: connect-redis v9.x uses destructuring import `const { RedisStore } = require('connect-redis')` whereas v7.x uses `require('connect-redis').default` (https://stackoverflow.com/questions/79784688/trying-to-use-connect-redis-but-getting-an-error).

## ioredis Middleware Config

```javascript
const redis = new Redis({
  host: process.env.REDIS_HOST,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0
});
```

## process.env Enumeration

When extracting env var names for ENV_VARIABLES.md, use digit-inclusive regex:

```bash
# Correct: includes vars like S3_BUCKET_V2, PORT_8080 — excludes node_modules/__tests__/kubernetes/
grep -rhoP 'process\.env\.([A-Za-z][A-Za-z0-9_]+)' . --include='*.js' --include='*.ts' --exclude-dir=node_modules --exclude-dir=__tests__ --exclude-dir=kubernetes | sort -u

# Also check destructured patterns:
grep -rn 'const.*=.*process\.env' src/ | grep -oP '[A-Z][A-Z0-9_]+'
```

**Note:** Do NOT use `grep -h` with pipe-based node_modules exclusion — `-h` suppresses filenames, breaking downstream path-based filtering. Use `--exclude-dir=node_modules` instead.

## Node.js Binary Absent Fallback

When `node` is not installed in the migration environment:

**Decision list (numbered — follow in order):**

1. **Is `node` available?** → Run `node --check file.js` directly. Done.
2. **Is `node` absent but needed only for syntax check?** → Use Tier 1 (Python brace-balance).
3. **Does Tier 1 report MISMATCH on a JS/TS file?** → Unconditionally escalate to Tier 2. Do NOT attempt manual inspection or check for template literals — any JS/TS Tier 1 MISMATCH is a known false-positive risk. When Tier 1 MISMATCH + Tier 2 PASS, document as false positive and proceed.
4. **Is runtime execution needed (tests, linting)?** → Use Tier 2 (download node).
5. **Does Tier 2 node_modules/.bin fail with "Permission denied"?** → Use Tier 2b (invoke via node binary).

**Tier 1 — Python brace-balance + grep assertions** (immediate substitute):
```bash
python3 -c "
import re, sys
code = open(sys.argv[1]).read()
# Strip strings and comments to avoid false matches
code = re.sub(r'//[^\n]*', '', code)
code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
code = re.sub(r'\x60[^\x60]*\x60', '', code, flags=re.DOTALL)  # template literals
code = re.sub(r'\"(?:[^\"\\\\]|\\\\.)*\"', '', code, flags=re.DOTALL)
code = re.sub(r\"'(?:[^'\\\\\\\\]|\\\\\\\\.)*'\", '', code, flags=re.DOTALL)
for o,c,name in [('{','}','curly'),('(',')', 'paren'),('[',']','bracket')]:
    if code.count(o) != code.count(c):
        print(f'MISMATCH {name}: {code.count(o)} open vs {code.count(c)} close')
        sys.exit(1)
print('OK')
" path/to/file.js
```

**Known false-positive triggers in Tier 1**: Template literals with embedded braces (`\`${obj.key}\``), regex containing braces (`/\d{3}/`), URL strings with encoded braces. If Tier 1 reports MISMATCH on a file with template literals or regex, escalate to Tier 2.

**Tier 2 — Download node v18 to /tmp** (for tasks requiring runtime):
```bash
if ! which node >/dev/null 2>&1; then
  curl -sSL https://nodejs.org/dist/v18.20.2/node-v18.20.2-linux-x64.tar.xz | tar -xJ -C /tmp/
  export PATH="/tmp/node-v18.20.2-linux-x64/bin:$PATH"
fi
```

**Tier 2b — Permission denied on node_modules/.bin symlinks**:

If `node_modules/.bin/<tool>` (jest, mocha, eslint) returns "Permission denied", invoke via the downloaded or system node binary directly:
```bash
# Instead of: npx jest (or node_modules/.bin/jest)
node node_modules/.bin/jest --passWithNoTests
# Or with downloaded node:
/tmp/node-v18.20.2-linux-x64/bin/node node_modules/.bin/jest --passWithNoTests
```

**Rule**: Apply Tier 1 proactively. Escalate to Tier 2 if runtime execution is required. Use Tier 2b when symlink permissions block direct execution.

## Non-Root USER on node:18-alpine

`node:18-alpine` provides a built-in `node` user at UID 1000. Do NOT create a new user:

```dockerfile
USER 1000:1000
WORKDIR /app
COPY --chown=1000:1000 . .
```

**Kubernetes manifest alignment**:
```yaml
securityContext:
  runAsUser: 1000
  runAsGroup: 1000
  runAsNonRoot: true
```

## Jest Test Environment Variables

When running Jest tests that depend on env vars:

```bash
# Set required env vars inline
DB_HOST=localhost REDIS_URL=redis://localhost:6379 node node_modules/.bin/jest --passWithNoTests
```

**jest.config.js environment setup** (if project uses `setupFiles`):
```javascript
// jest.setup.js
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.PORT = process.env.PORT || '3000';
```

**Rule**: Tests requiring specific env vars must have them provided at invocation. Do NOT modify source `.env` files. Use `--passWithNoTests` flag to avoid failure when no test files match in a subset run.

**Coverage + memory**: For large codebases, add `--maxWorkers=2` to prevent OOM in constrained environments.

## Socket.io Graceful Shutdown

```javascript
const server = http.createServer(app);
const io = new Server(server);

process.on('SIGTERM', () => {
  // 1. Stop accepting new connections
  io.close(() => {
    // 2. Close HTTP server
    server.close(() => {
      // 3. Clean up other resources
      process.exit(0);
    });
  });
  // 4. Force exit after grace period
  setTimeout(() => process.exit(1), 25000);
});
```

**Rule**: Socket.io server MUST be closed BEFORE the HTTP server. Set `terminationGracePeriodSeconds: 30` in pod spec to allow connection draining.

## Cluster Module Removal

Node.js `cluster` module (for multi-process scaling) is REDUNDANT in Kubernetes — HPA handles scaling:

```javascript
// BEFORE (remove this):
const cluster = require('cluster');
if (cluster.isMaster) {
  for (let i = 0; i < numCPUs; i++) cluster.fork();
} else {
  startServer();
}

// AFTER (single-process, Kubernetes scales pods):
startServer();
```

**Detection**:
```bash
grep -rn 'require.*cluster\|cluster\.fork\|cluster\.isMaster\|cluster\.isPrimary' . --include='*.js' --include='*.ts'
```

**Migration**: Remove cluster logic entirely. Set `WEB_CONCURRENCY=1` or remove it. Let Kubernetes HPA scale pod count.

## CronJob Connection Bootstrap

CronJob containers that connect to databases/Redis must handle connection lifecycle:

```javascript
// GOOD: Connect at start, disconnect at end
async function runJob() {
  const db = await connectDB();
  try {
    await doWork(db);
  } finally {
    await db.close();  // MUST close — CronJob pods don't receive SIGTERM reliably
  }
}

runJob().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
```

**Rule**: CronJob entry points MUST explicitly close connections and call `process.exit()`. Without explicit exit, Node.js event loop keeps process alive indefinitely (Job never completes).

## Optional Dependency Guard

When a dependency is used only in certain code paths (e.g., `sharp` for image processing):

```javascript
// GOOD: graceful fallback when optional dep missing
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('sharp not available, image processing disabled');
}

function processImage(buffer) {
  if (!sharp) throw new Error('Image processing requires sharp');
  return sharp(buffer).resize(200).toBuffer();
}
```

**package.json**: Move to `optionalDependencies` if not needed for core functionality.

## Bull/BullMQ Graceful Shutdown

Bull/BullMQ workers must handle SIGTERM to complete in-progress jobs:
```javascript
const worker = new Worker('queue', processor);
process.on('SIGTERM', async () => {
  await worker.close();  // Waits for active job to finish
  process.exit(0);
});
```

**Rule**: Set `terminationGracePeriodSeconds` ≥ max expected job duration. Without `worker.close()`, active jobs are aborted mid-execution.

## Apollo Federation Subgraph Decomposition

**Trigger:** `@apollo/server` or `apollo-server` in `package.json` dependencies.

**Pattern:** Apollo Federation v2 decomposes a monolithic GraphQL schema into domain-specific subgraph services behind an Apollo Router gateway.

**Decomposition mapping:**
1. Each resolver file/module → potential subgraph service
2. `@key` directive identifies entity ownership across subgraphs
3. Apollo Router replaces monolithic Apollo Server as gateway
4. Each subgraph = separate Deployment + Service in Kubernetes

**Kubernetes architecture:**
- `deployment-apollo-router.yaml` — gateway, CPU-based HPA
- `deployment-users-subgraph.yaml` — users domain
- `deployment-orders-subgraph.yaml` — orders domain
- Ingress routes all `/graphql` traffic to Apollo Router only

**Detection:**
```bash
grep -r '@apollo/federation\|@apollo/subgraph\|buildSubgraphSchema' package.json src/
```

## WebSocket Gateway Extraction

**Trigger:** `socket.io` or `ws` in `package.json` dependencies.

**Pattern:** Extract WebSocket handling into a RealtimeGatewayService.

**Why separate:**
- WebSocket connections are long-lived vs HTTP (milliseconds)
- Scaling driver = connection count, not CPU
- Pod restart kills all connections — needs separate lifecycle

**Redis adapter requirement** (cross-pod message delivery):
```javascript
const { createAdapter } = require('@socket.io/redis-adapter');
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

**Socket.io `getRoomUsers()` async replacement:**
```javascript
// BEFORE (in-memory, single-pod):
const users = io.sockets.adapter.rooms.get(roomId);
// AFTER (Redis-backed, multi-pod):
const sockets = await io.in(roomId).fetchSockets();
const users = sockets.map(s => s.data.userId);
```

**HPA:** Scale on custom metric (WebSocket connection count), NOT CPU.

## Next.js Route-to-Service Mapping

**Trigger:** `next` in `package.json` + API routes in `pages/api/` or `app/api/`.

**Decomposition pattern:**
- `pages/api/<domain>/` or `app/api/<domain>/route.ts` → potential backend service
- Next.js remains as BFF serving SSR pages
- Backend services exposed via internal ClusterIP Service

**Build-time vs runtime env vars:**
- `NEXT_PUBLIC_*` → baked into client bundle at build time
- Non-prefixed → server-side only, runtime injectable

**Detection:**
```bash
find pages/api app/api -type f -name '*.ts' -o -name '*.js' 2>/dev/null | \
  sed 's|/[^/]*$||' | sort -u | wc -l
# >3 distinct API route directories = strong decomposition signal
```

## NestJS WebSocket Scaling

**Trigger:** `@nestjs/websockets` or `@nestjs/platform-socket.io` in `package.json` dependencies.

**Problem:** NestJS WebSocket gateways maintain a `connectedClients` map that is pod-local. With HPA scaling, clients connected to pod A cannot receive events broadcast from pod B.

**Solution — Redis adapter:**
```typescript
// main.ts or app.module.ts
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

export class RedisIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: any) {
    const server = super.createIOServer(port, options);
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    return server;
  }
}
// In bootstrap: app.useWebSocketAdapter(new RedisIoAdapter(app));
```

**Detection:**
```bash
grep -rn 'WebSocketGateway\|@SubscribeMessage\|connectedClients' . --include='*.ts'
```

**NetworkPolicy:** WebSocket gateway Deployment needs Redis egress (TCP 6379) AND WebSocket-specific Ingress annotations (`proxy-read-timeout: 3600`, `proxy-send-timeout: 3600`).

**Rule:** Any NestJS WebSocket gateway with HPA replicas > 1 MUST use Redis adapter. Pod-local `connectedClients` is a horizontal-scaling blocker.

## amqplib Reconnect Pattern

**Trigger:** `amqplib` in `package.json` dependencies (RabbitMQ client).

**Problem:** `amqplib` does NOT auto-reconnect on connection loss. Without explicit reconnect logic, pod network blips cause permanent consumer death — the pod stays alive but processes no messages.

**Solution:**
```javascript
const amqp = require('amqplib');

let connection = null;
let channel = null;

async function connect() {
  connection = await amqp.connect(process.env.RABBITMQ_URL);
  connection.on('error', (err) => {
    console.error('RabbitMQ connection error:', err.message);
    setTimeout(connect, 5000);
  });
  connection.on('close', () => {
    console.warn('RabbitMQ connection closed, reconnecting...');
    setTimeout(connect, 5000);
  });
  channel = await connection.createChannel();
  await channel.assertQueue(process.env.QUEUE_NAME, { durable: true });
  channel.consume(process.env.QUEUE_NAME, handleMessage);
}

connect().catch(console.error);
```

**Detection:**
```bash
grep -rn 'amqplib\|amqp\.connect' . --include='*.js' --include='*.ts' | grep -v node_modules
```

**livenessProbe consideration:** Without reconnect logic, use exec livenessProbe that verifies the channel is open (e.g., check a health flag file written by the `connection.on('close')` handler).

**Rule:** All amqplib consumers MUST implement reconnect-on-error. Default amqplib behaviour is to silently stop consuming on any connection interruption.

## IRSA Cross-Task Dependency

**Trigger:** Node.js projects using AWS SDK where Criterion 2 (config externalisation) applies `requireEnv()` or similar mandatory-env patterns to AWS credential variables.

**Problem:** Criterion 6 IRSA guard needs AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY to be empty strings in IRSA mode. But `requireEnv()` (or any validation that treats empty string as falsy) crashes when the value is `""`.

**WRONG — requireEnv rejects empty string:**
```javascript
// config.js
const AWS_ACCESS_KEY_ID = requireEnv('AWS_ACCESS_KEY_ID'); // throws on ""
```

**CORRECT — use fallback to empty string:**
```javascript
// config.js
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

// s3-client.js
const clientConfig = { region: process.env.AWS_REGION || 'us-east-1' };
if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY };
}
const s3 = new S3Client(clientConfig);
```

**Rule:** AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY MUST use `process.env.X || ""` pattern. NEVER use requireEnv(), assertEnv(), or any validation that rejects empty strings for these two specific variables.

**Jest setup companion:** After applying IRSA pattern, update jest.setup.js in the SAME task:
```javascript
// jest.setup.js
process.env.AWS_ACCESS_KEY_ID = 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
process.env.AWS_REGION = 'us-east-1';
```

## Test File Co-Scoping Rule

**Trigger:** ANY source file modification that removes functions, renames exports, or applies requireEnv().

**Problem:** Removing a function from source or applying requireEnv() leaves dead references in test files (describe blocks, mocks, imports). These are discovered only in a later dedicated test task, causing downstream failures and expensive rework.

**Rule:** When modifying a source file, scan the ENTIRE corresponding test file for ALL references to the modified construct in the SAME task scope:
```bash
# After modifying src/config.js:
grep -n 'functionName\|removedExport\|oldPattern' tests/config.test.js __tests__/config.test.js
```

**Checklist for each source modification:**
1. Removed function → remove/rewrite ALL test describe blocks, mocks, and imports referencing it.
2. Renamed export → update ALL test imports and mock references.
3. Applied requireEnv() → add the env var to jest.setup.js with a non-empty test value.
4. Changed function signature → update ALL test call sites.

**Detection — find orphaned test references after migration:**
```bash
# List all exported names from source
grep -oP 'module\.exports\.\K\w+|exports\.\K\w+' src/*.js | sort -u > /tmp/exports.txt
# List all referenced names in tests
grep -oP "require\('.*?'\)\.\K\w+" tests/*.js __tests__/*.js | sort -u > /tmp/test_refs.txt
# Find test refs not in exports
comm -23 /tmp/test_refs.txt /tmp/exports.txt
```

## RABBITMQ_ROUTING_KEY False-Positive Exemption

**Problem:** Credential scan (Criterion 6) flags variables ending in `_KEY` as secrets. `RABBITMQ_ROUTING_KEY` (and similar AMQP routing configuration) is NOT a credential — it's a message routing label.

**Rule:** Variables ending in `_ROUTING_KEY` are ConfigMap values, not Secrets:
- `RABBITMQ_ROUTING_KEY` → ConfigMap
- `AMQP_ROUTING_KEY` → ConfigMap  
- `EVENT_ROUTING_KEY` → ConfigMap

**Detection of false positives:**
```bash
# Check if any routing key was incorrectly placed in Secret
grep -i 'routing.key' kubernetes/secret.yaml && echo "FALSE POSITIVE: routing key in Secret"
```

**Rule applies to the general pattern**: Any env var whose name ends with `_ROUTING_KEY`, `_QUEUE_NAME`, `_EXCHANGE_NAME`, or `_TOPIC_NAME` is a non-credential ConfigMap value regardless of containing the substring "KEY".


## npm ci --omit=dev Dockerfile Pattern

**Trigger:** Node.js Dockerfile using `npm install --production` or `npm install --only=production`.

**Problem:** The `--production` flag is deprecated in npm 8+ (ships with node:18+). Using it produces a deprecation warning and may behave unexpectedly in future npm versions.

**Before (deprecated):**
```dockerfile
RUN npm ci --production
```

**After (correct):**
```dockerfile
RUN npm ci --omit=dev
```

**Rule:** All Node.js Dockerfiles MUST use `npm ci --omit=dev` instead of `npm install --production` or `npm ci --production`. The `--omit=dev` flag explicitly excludes devDependencies from the install.

**Source:** https://github.com/npm/cli/issues/8025 — "I suggest using: --omit=dev instead of the deprecated flag --production"

## require.main Guard Placement

**Trigger:** Node.js module that both exports functions AND has a standalone execution path (CLI entry, CronJob worker).

**Rule:** Place `require.main === module` guard AFTER `module.exports` — not before. Otherwise, imports of the module trigger the standalone execution path.

**Before (incorrect — guard blocks exports):**
```javascript
if (require.main === module) {
  runTask().then(() => process.exit(0));
}
module.exports = { runTask };  // Never reached when required!
```

**After (correct — exports available, guard at bottom):**
```javascript
async function runTask() { /* ... */ }

module.exports = { runTask };

if (require.main === module) {
  runTask().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
```

## node-cron Multi-Schedule CronJob Generation

**Trigger:** Application using `node-cron` or `cron` package with multiple `cron.schedule()` calls at different intervals.

**Rule:** Generate ONE CronJob manifest per distinct schedule expression. A single Node.js CronJob manifest that runs all tasks defeats Kubernetes schedule granularity.

**Detection:**
```bash
grep -rn 'cron\.schedule\|new CronJob\|new Cron' src/ --include='*.js' --include='*.ts' | grep -oP "'[0-9*/,\s]+'|\"[0-9*/,\s]+\"" | sort -u
```

**Pattern:** If the grep produces >1 unique schedule expression:
- Create separate CronJob manifests per schedule: `cronjob-<task-name>.yaml`
- Each CronJob uses a command flag or env var to select its task: `node worker.js --task=cleanup`
- Apply `app.kubernetes.io/role: cronjob` label to all CronJob pod templates

## node-cron CronJob One-Shot Exit Pattern

**Trigger:** Node.js CronJob containers using `node-cron` or `cron` package that register a scheduled callback.

**Problem:** `node-cron` keeps the Node.js event loop alive indefinitely after the scheduled callback fires — the Job never completes, eventually hitting `activeDeadlineSeconds` and being force-killed.

**WRONG — event loop stays alive:**
```javascript
const cron = require('node-cron');
cron.schedule('* * * * *', () => {
  doWork();
  // node-cron keeps process alive — Job never terminates!
});
```

**CORRECT — one-shot execution with explicit exit:**
```javascript
async function main() {
  await doWork();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

**Rule:** In Kubernetes CronJob containers, do NOT use `node-cron`/`cron` scheduling. The Kubernetes CronJob `schedule:` field handles timing. The container entry point MUST execute the task once and call `process.exit(0)`. The in-process scheduler pattern is for long-running Deployments only.

**Detection:**
```bash
grep -rn 'cron\.schedule\|new CronJob\|new Cron' . --include='*.js' --include='*.ts' | grep -v node_modules
```

## Next.js Standalone Output Scope

**Trigger:** Next.js project using `output: 'standalone'` in `next.config.js`.

**Problem:** `next build` with standalone output copies only the files needed for production serving into `.next/standalone/`. Scripts in `scripts/`, custom `lib/` utilities not imported by pages/API routes, and dev tools are EXCLUDED from the standalone output.

**Rule:** Audit the standalone output before finalising the Dockerfile:
```bash
# After build, check what's included
ls .next/standalone/
# Compare with expected runtime dependencies
```

**Dockerfile pattern for Next.js standalone:**
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_MANUAL_SIG_HANDLE=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER 1000
EXPOSE 3000
CMD ["node", "server.js"]
```

**NEXT_MANUAL_SIG_HANDLE=1**: Required as Dockerfile ENV for graceful shutdown in Kubernetes. Without it, Next.js does not handle SIGTERM, causing abrupt termination during rolling updates.

## NEXT_PUBLIC_* Build-Time Exclusion

**Trigger:** Next.js project with `NEXT_PUBLIC_*` environment variables.

**Problem:** `NEXT_PUBLIC_*` variables are baked into the JavaScript bundle at BUILD time (inlined by webpack). They are NOT read at runtime from `process.env`. Placing them in ConfigMap has no runtime effect.

**Rule:**
- `NEXT_PUBLIC_*` vars MUST be available as build args in the Dockerfile (ARG/ENV before `npm run build`)
- Do NOT include `NEXT_PUBLIC_*` vars in the Kubernetes ConfigMap — they have no runtime effect
- Document in ENV_VARIABLES.md with annotation: "Build-time only — baked into client bundle"

**Dockerfile pattern:**
```dockerfile
ARG NEXT_PUBLIC_API_URL=https://api.example.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build
```

## pg.Pool Connection Limit ConfigMap

**Trigger:** Node.js project using `pg` (node-postgres) with `new Pool()`.

**Rule:** Externalise `max` (pool size) to a ConfigMap variable with replica-aware formula:

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
});
```

**ConfigMap entry:**
```yaml
data:
  DB_POOL_MAX: "10"  # Formula: max_connections / expected_replicas (e.g., 100/10=10)
```

**ENV_VARIABLES.md entry:** `DB_POOL_MAX` — Maximum connections per pool instance. Production formula: `max_connections / replica_count`. K8s Scope: ConfigMap.

## BullMQ Graceful Shutdown

**Trigger:** Node.js project using BullMQ (`@bull-board`, `bullmq`, `bull`).

**Rule:** BullMQ workers MUST close gracefully on SIGTERM to avoid lost jobs:

```javascript
const { Worker } = require('bullmq');
const worker = new Worker('queue', processor, { connection: redisOpts });

async function shutdown() {
  await worker.close();       // Finishes current job, stops polling
  await worker.connection.ping(); // Verify connection still alive (bootstrap check)
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

**Multiple workers pattern:**
```javascript
const workers = [worker1, worker2, worker3];
process.on('SIGTERM', async () => {
  await Promise.all(workers.map(w => w.close()));
  process.exit(0);
});
```

**Connection bootstrap verification:** After creating the BullMQ connection, verify it's alive before starting the worker:
```javascript
const connection = new IORedis(process.env.REDIS_URL);
await connection.ping(); // Throws if Redis unreachable — fail fast
const worker = new Worker('queue', processor, { connection });
```

## ws vs socket.io — WebSocket Scaling Differences

**Trigger:** `ws` or `socket.io` in `package.json` dependencies with HPA replicas > 1.

**Problem:** `ws` (raw WebSocket) and `socket.io` handle horizontal scaling differently:

| Library | Multi-Pod Support | Required Adapter |
|---------|------------------|-----------------|
| `socket.io` | Built-in adapter mechanism | `@socket.io/redis-adapter` — broadcasts to all pods |
| `ws` (raw) | No built-in multi-pod | Sticky sessions (nginx `ip_hash`) OR external pub/sub |

**socket.io with Redis adapter (preferred):**
```javascript
const { createAdapter } = require('@socket.io/redis-adapter');
io.adapter(createAdapter(pubClient, subClient));
```

**ws with sticky sessions** (when Redis adapter unavailable):
```yaml
# Ingress annotation for sticky sessions
nginx.ingress.kubernetes.io/affinity: "cookie"
nginx.ingress.kubernetes.io/session-cookie-name: "ws-route"
nginx.ingress.kubernetes.io/session-cookie-expires: "172800"
```

**Rule:** For `socket.io` projects, always add Redis adapter when HPA > 1. For `ws` projects, document sticky-session requirement in INFRASTRUCTURE_REQUIREMENTS.md and add Ingress annotations.

**Detection:**
```bash
grep -rn '"ws"\|"socket.io"' package.json | grep -v devDependencies
```

## SIGTERM Handler Ownership Rule

**Trigger:** Node.js projects with multiple entry points or shared modules that register `process.on('SIGTERM', ...)`.

**Problem:** When a shared module registers `process.on('SIGTERM', handler)`, AND the main entry point also registers its own SIGTERM handler, behaviour is unpredictable — Node.js calls ALL registered handlers but only the last-registered `process.exit()` determines the exit code. Worse, if the shared module calls `process.exit(0)` before the entry point's graceful shutdown completes, in-flight requests are dropped.

**Rule:** Only the application entry point (the file that starts the HTTP server or worker) registers `process.on('SIGTERM', ...)`. Shared modules expose `shutdown()` methods that the entry point calls within its own SIGTERM handler.

**WRONG — shared module registers SIGTERM:**
```javascript
// lib/cache.js
process.on('SIGTERM', () => { cache.disconnect(); process.exit(0); }); // BUG
```

**CORRECT — entry point owns SIGTERM, calls module shutdown:**
```javascript
// lib/cache.js
module.exports.shutdown = () => cache.disconnect();

// server.js (entry point)
const cache = require('./lib/cache');
process.on('SIGTERM', async () => {
  server.close();
  await cache.shutdown();
  process.exit(0);
});
```

**Detection:**
```bash
grep -rn "process\.on.*SIGTERM\|process\.on.*SIGINT" . --include='*.js' --include='*.ts' | grep -v node_modules | grep -v test
# Multiple matches in different files = ownership violation
```

**Rule:** If grep returns SIGTERM handlers in more than one non-test source file, consolidate to the entry point only.

## JSDoc Cron Comment Hazard (Tier 1 Escalation)

**Trigger:** Tier 1 brace-balance check reports MISMATCH on files containing JSDoc blocks with cron expressions.

**Problem:** JSDoc comments containing `*/step` cron syntax (e.g., `* */5 * * *`) prematurely close the JSDoc comment block. The `*/` inside the cron expression is interpreted as the comment terminator, leaving subsequent code syntactically broken from the parser's perspective. The Tier 1 Python brace-balance checker sees unbalanced braces in the resulting malformed code.

**Detection:**
```bash
grep -n '\*/[0-9]' path/to/file.js | grep -c '^\s*\*'
# If matches found inside JSDoc, this is a known Tier 1 false positive
```

**Rule:** When Tier 1 reports MISMATCH and the file contains JSDoc blocks with `*/N` cron expressions, escalate directly to Tier 2 without per-line analysis. This is a known limitation of comment stripping in the Tier 1 checker.

## Template Literal Tier 1 Escalation

**Trigger:** Tier 1 brace-balance check reports MISMATCH on files containing template literals with `${expression}` syntax.

**Problem:** The Tier 1 Python checker's template-literal stripping regex (`\x60[^\x60]*\x60`) fails on nested template literals, tagged templates, or template literals spanning multiple lines with embedded expressions containing braces. The remaining `${...}` content produces false brace-count mismatches.

**Rule:** When Tier 1 reports MISMATCH and the file contains template literals (backtick strings with `${}`), escalate directly to Tier 2. Do NOT attempt manual brace counting or per-line inspection — template literals with complex expressions are beyond Tier 1's capability.

**Detection of template literals:**
```bash
grep -c '`.*\${' path/to/file.js
# Any count > 0 = template literals present → Tier 1 false-positive likely
```

## connect-redis Absent-from-package.json Default

**Trigger:** Session externalisation (Sub-Phase §4) requires `connect-redis`, but it is NOT listed in `package.json` dependencies.

**Problem:** When `connect-redis` is absent from both `package.json` and `package-lock.json`, the worker cannot determine which version to use. Installing without a pinned version may pull v9+ (latest), but the project's existing `express-session` setup may expect v7 patterns.

**Rule:** When `connect-redis` is absent from `package.json`:
1. Check `express-session` version: `grep '"express-session"' package.json`
2. Default to v7 import pattern (`.default`) — it has broader compatibility with older express-session setups
3. Add `"connect-redis": "^7.1.0"` to dependencies
4. Document the version choice in TRANSFORMATION_SUMMARY.md

## CronJob Lazy-Require for Connection-Eager Modules

**Trigger:** CronJob entry points that import shared scheduler/utility modules which transitively require connection-eager libraries (Bull, BullMQ, ioredis, mongoose, pg).

**Problem:** Top-level `require()` of shared modules creates database/Redis connections at import time — even if the CronJob only needs a small subset of functionality. This wastes connections in short-lived CronJob pods and may cause connection timeouts if backing services are slow to respond.

**WRONG — top-level require creates connections immediately:**
```javascript
const scheduler = require('../lib/scheduler'); // internally does: new Redis(), new Pool()
async function main() {
  await scheduler.runCleanup(); // only needs one function
  process.exit(0);
}
```

**CORRECT — lazy require inside the function:**
```javascript
async function main() {
  const { runCleanup } = require('../lib/scheduler');
  await runCleanup();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

**Detection:**
```bash
# Find CronJob entry points (files with process.exit pattern)
grep -rln 'process\.exit(0)' src/ --include='*.js' | while read f; do
  # Check if they import connection-eager modules at top level
  head -20 "$f" | grep -q 'require.*redis\|require.*mongoose\|require.*bull\|require.*pg' && echo "EAGER: $f"
done
```

**Rule:** CronJob entry points should lazy-require connection-eager modules inside the main function body, not at module top-level.

## SIGTERM Handler Standalone Worker Exception

**Trigger:** Standalone worker pods (Deployments running background job processors like Bull/BullMQ workers, queue consumers) that are NOT shared modules.

**Problem:** The SIGTERM Handler Ownership Rule (§25 above) states that only the entry point should register SIGTERM. However, standalone worker Deployment entry points ARE their own entry point — they legitimately register SIGTERM handlers for graceful job completion.

**Rule:** The SIGTERM ownership rule applies to SHARED MODULES (libraries imported by multiple entry points). Standalone worker entry points (files that ARE the container's CMD) are exempt — they own their process lifecycle and MUST register SIGTERM/SIGINT for graceful shutdown. Cross-reference: SKILL.md §9 CronJob framework exception list — worker Deployments with Bull/BullMQ MUST have SIGTERM handler for `worker.close()`.

**Detection (is this file a standalone entry point?):**
```bash
# Check if the file is referenced as CMD in Dockerfile or in a Deployment manifest
grep -rn "$(basename file.js)" Dockerfile kubernetes/*.yaml
# If referenced as container command → standalone entry point → SIGTERM is correct
```

## Express/Koa Health Probe Ordering

**Problem:** In Express/Koa applications, middleware registered with `app.use()` applies to ALL subsequent routes. Health/readiness probe endpoints registered AFTER global auth middleware receive 401/403 from K8s liveness/readiness checks, blocking pod readiness.

**Rule:** Health probe routes MUST be registered BEFORE any global auth middleware.

**Express — CORRECT ordering:**
```javascript
const app = express();

// 1. Register health probes FIRST (no auth required)
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/readyz', (req, res) => res.status(200).json({ status: 'ok' }));

// 2. THEN apply auth middleware
app.use(passport.authenticate('jwt', { session: false }));

// 3. Register protected routes
app.use('/api', apiRouter);
```

**Express — WRONG (probes receive 401):**
```javascript
const app = express();
app.use(passport.authenticate('jwt', { session: false })); // Auth first
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' })); // Gets 401!
```

**Koa:**
```javascript
const app = new Koa();
// Health route BEFORE auth middleware
router.get('/healthz', (ctx) => { ctx.body = { status: 'ok' }; });
app.use(router.routes());
app.use(authMiddleware);
app.use(protectedRouter.routes());
```

**Detection:**
```bash
# Find where health routes are registered relative to auth middleware
grep -n 'app\.use\|app\.get.*health\|app\.get.*ready\|passport\|authenticate' src/ --include='*.js' --include='*.ts' -r | sort -t: -k2 -n
# If auth middleware line number < health route line number → issue
```

**Rule:** After migration, verify probe path returns HTTP 2xx without credentials: `curl -s -o /dev/null -w '%{http_code}' http://localhost:PORT/healthz` — expected: 200.

## Config Module Audit — Post-Patch Call-Site Sweep

**Trigger:** After patching a central config module (e.g., `src/config.js`, `config/index.ts`) to use env var reads.

**Problem:** Fixing the config module does NOT neutralise call-site `||` fallback expressions in application files or multi-consumer workers that read `process.env` directly, bypassing the config module entirely.

**Two mandatory steps:**

**Step 1 — Pre-patch discovery** (run BEFORE patching config module):
```bash
# Find ALL direct process.env reads across entire src/ (not just config/)
grep -rn 'process\.env\.' src/ --include='*.js' --include='*.ts' --exclude-dir=node_modules | grep -v 'config\|Config' | sort
```
This identifies files that bypass the config module.

**Step 2 — Post-patch sweep** (run AFTER config module is patched):
```bash
# Find surviving call-site fallback expressions
grep -rnE 'process\.env\.[A-Z_]+\s*\|\|\s*["\x27]' src/ --include='*.js' --include='*.ts' --exclude-dir=node_modules | grep -v 'config/'
# Find hardcoded localhost/redis fallbacks
grep -rn '|| "redis://\||| "localhost"\||| "127.0.0.1"\||| "mongodb://' src/ --include='*.js' --include='*.ts' --exclude-dir=node_modules
```

**Rule:** Every match in the post-patch sweep is a credential/config bypass that must be fixed in the same task scope. Common patterns:
- Worker files with `process.env.REDIS_URL || "redis://localhost:6379"`
- Route handlers with `process.env.DB_HOST || "localhost"`
- Middleware with `process.env.SECRET || "default-secret"`

Replace each with a reference to the centralised config module OR remove the fallback (use bare `process.env.VAR` when the var is required).

## Multi-Consumer Scope Detection

**Trigger:** Node.js applications with multiple worker/consumer entry points (e.g., `worker.js`, `consumer.js`, `processor.js`) alongside the main HTTP server.

**Problem:** Config externalisation tasks often patch only the primary entry point's config reads, leaving secondary workers with hardcoded values or direct `process.env` reads that bypass the config module.

**Detection:**
```bash
# Find potential worker entry points
grep -rln 'process\.exit\|worker\|consumer\|processor' src/ --include='*.js' --include='*.ts' | grep -v node_modules | grep -v test
# Cross-reference with package.json scripts
grep -A20 '"scripts"' package.json | grep -E 'worker|consumer|processor|queue'
```

**Rule:** After patching the main config module, run the config audit on EVERY entry point file identified above. Each worker that reads env vars directly must either (a) import from the centralised config module, or (b) have its fallback expressions removed.

## Mise/asdf Toolchain Bootstrap (Node.js)

**Trigger:** Node.js project with `.tool-versions` or `.mise.toml` specifying node version.

**Bootstrap procedure:**
```bash
if [ -f .tool-versions ] || [ -f .mise.toml ]; then
  mise install node 2>/dev/null
  export PATH=$HOME/.local/share/mise/shims:$PATH
fi
node --version  # Verify
```

### Toolchain Bootstrap Fallback (Tier 2)

When `npm` is absent from PATH (mise shim not activated or node not installed):
```bash
# Read version from .tool-versions or .nvmrc
NODE_VER=$(grep 'nodejs' .tool-versions 2>/dev/null | awk '{print $2}')
[ -z "$NODE_VER" ] && NODE_VER=$(cat .nvmrc 2>/dev/null | tr -d 'v')
[ -z "$NODE_VER" ] && NODE_VER="18.20.2"  # fallback

# Download and activate
curl -sSL "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz" | tar -xJ -C /tmp
export PATH="/tmp/node-v${NODE_VER}-linux-x64/bin:$PATH"
node --version && npm --version
```

**Rule:** Before ANY `npm install`, `npm test`, or `node` command, check for mise/asdf config and activate. If activation fails, use the Tier 2 curl+tar download fallback.

## multer-s3 v3 Requires @aws-sdk/client-s3 v3

**Trigger:** Node.js file upload applications using `multer-s3` package.

**Problem:** `multer-s3` v3+ requires `@aws-sdk/client-s3` (AWS SDK v3). If the project currently uses `aws-sdk` (v2), upgrading multer-s3 without also migrating to SDK v3 causes runtime errors.

**Detection:**
```bash
grep -E 'multer-s3|@aws-sdk/client-s3|aws-sdk' package.json
```

**Compatibility matrix:**
| multer-s3 | AWS SDK Required | Import Pattern |
|---|---|---|
| v2.x | `aws-sdk` (v2) | `const AWS = require('aws-sdk')` |
| v3.x | `@aws-sdk/client-s3` (v3) | `const { S3Client } = require('@aws-sdk/client-s3')` |

**Rule:** When migrating file uploads to S3, verify multer-s3 version matches the AWS SDK version in package.json. If upgrading to SDK v3, add `@aws-sdk/client-s3` to dependencies.

## jest.mock Virtual for Migration-Added Packages

**Trigger:** Adding new packages during migration (e.g., `@aws-sdk/client-s3`, `ioredis`, `connect-redis`) that don't exist in the test environment.

**Problem:** Tests importing modules that reference newly-added packages fail with "Cannot find module" if the test runner doesn't have the package installed (e.g., in CI with `--no-optional`).

**Fix — jest.mock with virtual module:**
```javascript
// In test file or jest.setup.js (see decision tree below)
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}), { virtual: true });
```

**Rule:** For every package added during migration that is referenced in testable code paths, add a `jest.mock(..., { virtual: true })` in `jest.setup.js` or the relevant test file. The `virtual: true` flag allows mocking modules that aren't installed.

### jest.mock Placement Decision Tree

Determine WHERE to place the jest.mock call:

1. **Package used in ≤3 test files** → mock in EACH test file (top of file, before imports).
2. **Package used in 4+ test files** → add to `jest.setup.js` via `setupFilesAfterEnv` in jest config (NOT `setupFilesAfterFramework` — that key is invalid and silently ignored).
3. **Module-scope instantiation** (e.g., `const client = new S3Client()` at top of a source module) → `jest.mock` MUST be at the top of the test file, BEFORE any `require()`/`import`. Babel-jest hoists `jest.mock()` calls to the top of the file, but ONLY when they appear in the test file itself — not from setup files.

**jest.config.js setupFilesAfterEnv** (correct configuration):
```javascript
// jest.config.js
module.exports = {
  setupFilesAfterEnv: ['./jest.setup.js'],  // ← correct key
  // NOT: setupFilesAfterFramework (invalid, silently ignored)
};
```

**Module-scope instantiation example** (requires test-file placement):
```javascript
// src/storage.js — module-level instantiation
const { S3Client } = require('@aws-sdk/client-s3');
const client = new S3Client({ region: process.env.AWS_REGION }); // runs at require() time

// test/storage.test.js — mock MUST be here, not in jest.setup.js
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
}), { virtual: true });
const { uploadFile } = require('../src/storage');
```

## BullMQ Worker SIGTERM Capture

**Trigger:** Node.js applications using BullMQ workers that must gracefully shut down.

**Problem:** BullMQ workers processing long-running jobs need explicit SIGTERM handling to finish the current job before pod termination. Without it, Kubernetes kills the worker mid-job after `terminationGracePeriodSeconds`.

**Pattern:**
```javascript
const worker = new Worker('queue-name', async (job) => {
  // ... process job
}, { connection: redis });

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});
```

**Kubernetes manifest:**
```yaml
terminationGracePeriodSeconds: 60  # Must exceed longest expected job duration
```

**Detection:**
```bash
grep -rn 'new Worker\|BullMQ\|bullmq' src/ --include='*.js' --include='*.ts' | grep -v node_modules
```

**Rule:** ALL BullMQ/Bull worker Deployments MUST have SIGTERM handling that calls `worker.close()`. Set `terminationGracePeriodSeconds` to exceed the longest expected job processing time.


## Singleton Import-Graph Check

**Trigger:** Node.js projects where a shared module creates a connection at import time (e.g., `const redis = new Redis(...)` at module level) and multiple entry points import it.

**Problem:** If multiple workers/services import the same singleton connection module, each import in a different container creates its own connection. But within a single process, `require()` caches modules — subsequent imports return the SAME instance. This is safe for single-process Deployments but breaks when the same module is imported in a CronJob one-shot script (the connection may never close because `require()` caching keeps the event loop alive).

**Detection:**
```bash
# Find module-level connection singletons
grep -rn 'module\.exports.*=.*new Redis\|module\.exports.*=.*new Pool\|module\.exports.*=.*createClient' src/ --include='*.js' --include='*.ts' | grep -v test | grep -v node_modules
```

**Rule:** For CronJob entry points that import singleton connection modules, verify the one-shot script calls `.disconnect()` or `.end()` after completing work. Without explicit close, Node.js event loop stays alive indefinitely due to the cached singleton keeping an active socket. Cross-reference with §CronJob Connection Bootstrap and §CronJob Lazy-Require patterns.

## §6 Filesystem-to-Object-Store Migration Cascade Checklist

**Trigger:** Node.js project with file upload handling being migrated to S3/object store (Sub-Phase §6).

**Problem:** S3 migration touches multiple layers that must all be updated in the SAME task to avoid deferred-fix cascades:

### Mandatory In-Task Steps (do NOT defer any):

1. **Sweep ALL route handlers for `req.file.path`** and replace with `req.file.key` (or `req.file.location` for multer-s3):
```bash
grep -rn 'req\.file\.path\|req\.files\[.*\]\.path' src/ routes/ --include='*.js' --include='*.ts' | grep -v node_modules
```
Every match must be updated in the same task.

2. **Update ENV_VARIABLES.md immediately** when new env vars are introduced (S3_BUCKET, AWS_REGION, S3_ENDPOINT). Do NOT defer to Final Review.

3. **IRSA credential guard trigger**: The presence of ANY AWS SDK client instantiation (`new S3Client(...)`, `new S3({...})`) is the trigger for IRSA credential env reads — even if the source code has zero pre-existing AWS credential reads.

4. **Adapter wiring in same task as package.json addition**: When adding `multer-s3` or `@aws-sdk/client-s3` to package.json, complete the storage adapter wiring in the same task:
```javascript
// Complete in same task — not deferred:
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const upload = multer({
  storage: multerS3({
    s3: new S3Client({ region: process.env.AWS_REGION }),
    bucket: process.env.S3_BUCKET,
    key: (req, file, cb) => cb(null, `uploads/${Date.now()}-${file.originalname}`)
  })
});
```

5. **Delete-path migration**: If the app has file-deletion logic using `fs.unlink(path)`, grep and migrate to `DeleteObjectCommand`:
```bash
grep -rn 'fs\.unlink\|fs\.rmSync\|fs\.unlinkSync' src/ --include='*.js' --include='*.ts' | grep -v node_modules
```

### Verification:
```bash
# After migration — zero local-path file operations on upload paths:
grep -rn 'req\.file\.path\|req\.file\.destination\|fs\.unlink.*upload' src/ --include='*.js' --include='*.ts' | grep -v node_modules
# Expected: 0 matches
```

## Test Migration — jest.mock Requirements

**Trigger:** ANY package added during migration (§4 session, §6 S3, §7 credentials) that is referenced in testable code paths.

### Pre-Test Checklist (run BEFORE any test command):

1. **Identify all migration-added packages:**
```bash
# Compare current package.json against original
diff <(git show HEAD:package.json 2>/dev/null | grep -oP '"[^"]+":' | sort) <(grep -oP '"[^"]+":' package.json | sort) | grep '>'
```

2. **For each added package referenced in source code**, add jest.mock with `{ virtual: true }`:
```javascript
// jest.setup.js or individual test files
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}), { virtual: true });

jest.mock('ioredis', () => jest.fn(() => ({
  get: jest.fn(), set: jest.fn(), del: jest.fn(),
  on: jest.fn(), connect: jest.fn(),
  disconnect: jest.fn(),
})), { virtual: true });

jest.mock('connect-redis', () => ({
  default: jest.fn(() => ({}))  // v7 shape; adjust for v9+
}), { virtual: true });
```

3. **Test-update task timing**: The test-update task MUST run immediately after the last migration task and BEFORE any validation task. Tests failing due to missing mocks block all downstream validation.

### Common Migration-Added Packages Requiring Virtual Mocks:

| Package | Mock Shape |
|---------|-----------|
| `@aws-sdk/client-s3` | `{ S3Client, PutObjectCommand, GetObjectCommand }` |
| `ioredis` | Constructor returning `{ get, set, del, on, connect, disconnect }` |
| `connect-redis` | v7: `{ default: MockRedisStore }`, v9+: `{ RedisStore: MockRedisStore }` |
| `multer-s3` | `jest.fn(() => ({}))` |
| `@socket.io/redis-adapter` | `{ createAdapter: jest.fn() }` |


## NestJS Probe Path Verification

**Trigger:** NestJS applications with health check endpoints configured for Kubernetes probes.

**Problem:** NestJS `@Controller()` route paths are NOT the same as Express-level route registrations. Probe paths must match `expressApp.get()` registrations in `main.ts`/`bootstrap()`, not `@Controller()` decorator paths. The Express adapter registers routes at a different level than NestJS controllers — controller routes go through guards/interceptors (which may require auth), but `expressApp.get()` routes bypass them.

**Detection:**
```bash
# Find probe path registration (Express-level, pre-auth):
grep -rn 'app\.get\|expressApp\.get\|getHttpAdapter.*get' src/main.ts src/bootstrap* 2>/dev/null

# Find controller-level health route (may require auth — NOT suitable for probes):
grep -rn '@Get.*health\|@Controller.*health' src/ --include='*.ts'
```

**Rule:** For NestJS, probe paths MUST match the `expressApp.get()` registration in `main.ts`:
```typescript
// main.ts — probe route registered BEFORE global guards
const app = await NestFactory.create(AppModule);
const expressApp = app.getHttpAdapter().getInstance();
expressApp.get('/healthz', (req, res) => res.status(200).send('ok'));
// ... then apply guards, interceptors, etc.
```

The probe path in the manifest is `/healthz` (matching the Express registration), NOT `/api/health` (which might be a controller route behind auth).

**Tier 2 version matching (Node.js):** When generating manifests, use the Node.js version from `package.json` `engines.node` field or `.nvmrc` for the Dockerfile FROM tag. Mismatch causes `node --check` failures in Tier 2.

```bash
# Detect expected Node version
grep -oP '"node":\s*"[>=<^~]*\K[0-9]+' package.json 2>/dev/null || cat .nvmrc 2>/dev/null
```


## Lock File Desync Pre-Check

**Trigger:** Node.js project with `package-lock.json` or `yarn.lock` present.

**Problem:** When `package.json` has been modified (dependency added/removed/updated) but the lock file was not regenerated, `npm ci` (used in Dockerfiles for deterministic installs) fails with "npm ERR! `npm ci` can only install packages when your package.json and package-lock.json are in sync."

**Detection (pre-Docker-build gate):**
```bash
# Check for desync indicators
npm ci --dry-run 2>&1 | grep -q 'in sync' && echo "SYNC OK" || echo "LOCK DESYNC DETECTED"
# Fallback when npm unavailable:
node -e "
const pkg = require('./package.json');
const lock = require('./package-lock.json');
const pkgDeps = {...(pkg.dependencies||{}), ...(pkg.devDependencies||{})};
const lockPkgs = Object.keys(lock.packages || lock.dependencies || {}).filter(k => k && !k.startsWith('node_modules/'));
const missing = Object.keys(pkgDeps).filter(d => !JSON.stringify(lock).includes(d));
if (missing.length) { console.log('DESYNC:', missing.join(', ')); process.exit(1); }
"
```

**Rule:** Before `docker build`, verify lock file is in sync with `package.json`. If desync detected, run `npm install` (or `yarn install`) to regenerate the lock file before building. Record in TRANSFORMATION_SUMMARY.md if lock file was regenerated during migration.

## Package Removal Ordering Constraint

**Trigger:** Removing multiple npm packages during migration (e.g., removing `express-session` memory store, `connect-mongo` when switching to Redis).

**Problem:** Removing a package that other packages depend on causes `npm install` to fail with peer dependency errors. The removal order matters — remove dependents first, then dependencies.

**Detection:**
```bash
# Check if package B depends on package A before removing A:
npm ls <package-to-remove> 2>/dev/null | grep -v 'empty\|UNMET'
```

**Rule:** When removing multiple packages:
1. Use `npm ls` to check for dependents of each package
2. Remove packages in reverse-dependency order (dependents first)
3. After all removals, run `npm install` once (not after each removal)
4. Verify with `npm ls --all 2>&1 | grep -c 'UNMET PEER'` — should be 0

## S3 URL Region-Sensitive Assertions

**Trigger:** Node.js applications using AWS S3 SDK where URL format varies by region.

**Problem:** S3 URL format differs between regions — `https://s3.amazonaws.com/bucket/key` (us-east-1 path-style) vs `https://bucket.s3.us-west-2.amazonaws.com/key` (virtual-hosted). Tests or assertions that hardcode one URL format fail when the region changes.

**Detection:**
```bash
grep -rn 's3\.amazonaws\.com\|s3\.[a-z]\{2\}-[a-z]*-[0-9]' . --include='*.js' --include='*.ts' | grep -v 'node_modules'
```

**Rule:** When externalising S3 configuration:
1. `S3_REGION` (or `AWS_REGION`) MUST be a ConfigMap entry — URL format depends on it
2. Do NOT hardcode S3 URL patterns in application code or tests
3. Use SDK-provided URL construction (`getSignedUrl()`, `endpoint` config) rather than string concatenation
4. For `S3_ENDPOINT` (custom endpoints like MinIO), classify as ConfigMap (not Secret — it's a hostname, not a credential)

