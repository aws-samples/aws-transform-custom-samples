// Metrics API client for the AWS/TransformCustom CloudWatch namespace.
//
// Backend: the metrics logic from scaled-execution-containers PR #41 (get_metrics.py)
// is ported into the agentic platform's async_invoke_agent Lambda and exposed via the
// existing `/orchestrate` endpoint as `op: "metrics"`. This keeps the UI on the single
// unauthenticated HTTP API (no SigV4) instead of the IAM-authed REST API.
//
// The response shape matches get_metrics.py `type=all` / `type=transform`:
//   {
//     startTime, endTime,
//     jobs: { SUBMITTED, PENDING, RUNNABLE, STARTING, RUNNING, SUCCEEDED, FAILED },
//     transformCustom: {
//       totals: { TransformationExecutionStarted, TransformationExecutionCompleted,
//                 ConversationStarted, AgentExecutionMinutes, ExecutionDuration,
//                 FilesRead, FilesModified, LinesAdded, LinesDeleted, LinesModified },
//       uniqueConversations, uniqueExecutions,
//       byTransformation: { [name]: { <metric>: value, ... } },
//       byRepository:     { [repo]: { <metric>: value, ... } }
//     },
//     lambda: {...}, api: {...}
//   }
//
// SWAP POINT: set VITE_METRICS_MOCK=false (or change USE_MOCK) once the Lambda op is deployed.

const API_BASE = import.meta.env.VITE_API_ENDPOINT || '/api'
const USE_MOCK = (import.meta.env.VITE_METRICS_MOCK ?? 'true') !== 'false'

// period (hours) for each UI range option
const RANGE_HOURS = { '24h': 24, '7d': 168, '30d': 720 }

/**
 * Fetch aggregate metrics (type=all) for a UI range.
 * @param {Object} opts
 * @param {string} opts.range - '24h' | '7d' | '30d'
 * @returns raw get_metrics.py response (see shape above)
 */
export async function fetchMetrics({ range = '7d' } = {}) {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 400))
    return mockMetrics(range)
  }

  const res = await fetch(`${API_BASE}/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'direct', op: 'metrics', type: 'all', period: RANGE_HOURS[range] || 168 }),
  })
  if (!res.ok) throw new Error(`Metrics API returned ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

/**
 * Per-execution breakdown (type=transform_detail).
 * @returns { startTime, endTime, executions: [{ executionId, dimensions, metrics }, ...] }
 */
export async function fetchExecutions({ range = '7d' } = {}) {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 300))
    return mockExecutions()
  }
  const res = await fetch(`${API_BASE}/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'direct', op: 'metrics', type: 'transform_detail', period: RANGE_HOURS[range] || 168 }),
  })
  if (!res.ok) throw new Error(`Metrics API returned ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

// ---- Derivation helpers (shared by component so live + mock behave identically) ----

// Turn { byTransformation: { name: { Metric: v } } } into sorted [{ key, value }]
// ranked by a chosen metric (default: TransformationExecutionCompleted, fallback started).
export function rankBy(group, metric = 'TransformationExecutionCompleted', limit = 8) {
  if (!group) return []
  return Object.entries(group)
    .map(([key, m]) => ({
      key,
      value: m[metric] ?? m.TransformationExecutionStarted ?? m.AgentExecutionMinutes ?? 0,
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

// Execution status split, derived from each execution's metrics rather than the raw
// ExecutionStatus dimension. ATX stamps ExecutionStatus at emit time and doesn't always
// reconcile it to a terminal value (e.g. comprehensive-codebase-analysis emits final
// metrics while still tagged "InProgress"). So we treat presence of
// TransformationExecutionCompleted as the source of truth:
//   - completed + Failure dimension      -> Failed
//   - completed (any other status)       -> Success
//   - no completion metric               -> fall back to the raw status (e.g. InProgress)
export function statusSplit(executions = []) {
  const counts = {}
  for (const e of executions) {
    const rawStatus = e?.dimensions?.ExecutionStatus
    const completed = !!e?.metrics?.TransformationExecutionCompleted
    let bucket
    if (completed) {
      bucket = rawStatus === 'Failure' ? 'Failed' : 'Success'
    } else {
      bucket = rawStatus || 'InProgress'
    }
    counts[bucket] = (counts[bucket] || 0) + 1
  }
  return Object.entries(counts).map(([key, value]) => ({ key, value }))
}

export function typeSplit(executions = []) {
  const counts = {}
  for (const e of executions) {
    const t = e?.dimensions?.ExecutionType
    if (t) counts[t] = (counts[t] || 0) + 1
  }
  return Object.entries(counts).map(([key, value]) => ({ key, value }))
}

// ---- Mock data (shaped identically to get_metrics.py) ----

function mockMetrics(range) {
  const scale = range === '24h' ? 0.3 : range === '30d' ? 3 : 1
  const r = (n) => Math.round(n * scale)
  return {
    startTime: new Date(Date.now() - (RANGE_HOURS[range] || 168) * 3600_000).toISOString(),
    endTime: new Date().toISOString(),
    jobs: { SUBMITTED: 0, PENDING: 0, RUNNABLE: 1, STARTING: 2, RUNNING: 3, SUCCEEDED: r(31), FAILED: r(3) },
    transformCustom: {
      totals: {
        TransformationExecutionStarted: r(8),
        TransformationExecutionCompleted: r(5),
        ConversationStarted: r(125),
        AgentExecutionMinutes: r(635.5),
        ExecutionDuration: r(8495.94),
        FilesRead: r(336),
        FilesModified: r(28),
        LinesAdded: r(68),
        LinesDeleted: r(79),
        LinesModified: r(229),
      },
      uniqueConversations: r(12),
      uniqueExecutions: r(12),
      byTransformation: {
        'AWS/python-version-upgrade': { TransformationExecutionCompleted: r(2), TransformationExecutionStarted: r(3), AgentExecutionMinutes: r(92.65), FilesModified: r(12), FilesRead: r(60), LinesModified: r(189) },
        'AWS/java-version-upgrade': { TransformationExecutionStarted: r(2), TransformationExecutionCompleted: r(1), AgentExecutionMinutes: r(49.08), FilesRead: r(49), FilesModified: r(13), LinesAdded: r(68) },
        'AWS/nodejs-version-upgrade': { TransformationExecutionStarted: r(2), TransformationExecutionCompleted: r(1), AgentExecutionMinutes: r(55.75), FilesModified: r(3), LinesModified: r(40) },
        'AWS/comprehensive-codebase-analysis': { TransformationExecutionStarted: r(4), TransformationExecutionCompleted: r(2), AgentExecutionMinutes: r(438.03), FilesRead: r(227) },
      },
      byRepository: {
        'todoapilambda': { TransformationExecutionCompleted: r(2), TransformationExecutionStarted: r(3), AgentExecutionMinutes: r(189.22), FilesModified: r(12), FilesRead: r(60) },
        'spring-petclinic': { TransformationExecutionStarted: r(2), AgentExecutionMinutes: r(167.79), FilesRead: r(78) },
        'auth-gateway': { TransformationExecutionCompleted: r(1), TransformationExecutionStarted: r(2), AgentExecutionMinutes: r(70.5) },
      },
    },
    lambda: { 'atx-async-invoke-agent': { invocations: r(42), errors: 0, avgDurationMs: 245.3 } },
    api: { requests: r(120), '4xxErrors': r(2), '5xxErrors': 0 },
  }
}

function mockExecutions() {
  const mk = (status, type, transform, repo, mins) => ({
    executionId: crypto.randomUUID(),
    dimensions: {
      ExecutionStatus: status, ExecutionType: type,
      TransformationName: transform, RepositoryName: repo,
      ConversationId: '2026' + Math.random().toString().slice(2, 10),
    },
    // Terminal runs carry a completion metric; InProgress runs don't (mirrors real ATX data).
    metrics: status === 'InProgress'
      ? { AgentExecutionMinutes: mins }
      : { AgentExecutionMinutes: mins, TransformationExecutionCompleted: 1 },
  })
  return {
    startTime: new Date(Date.now() - 168 * 3600_000).toISOString(),
    endTime: new Date().toISOString(),
    executions: [
      mk('Success', 'Unsupervised', 'AWS/python-version-upgrade', 'todoapilambda', 39.19),
      mk('Success', 'Unsupervised', 'AWS/java-version-upgrade', 'auth-gateway', 49.08),
      mk('Failure', 'Supervised', 'AWS/nodejs-version-upgrade', 'web-frontend', 12.5),
      mk('Success', 'Unsupervised', 'AWS/comprehensive-codebase-analysis', 'spring-petclinic', 88.3),
      mk('InProgress', 'Unsupervised', 'AWS/python-version-upgrade', 'inventory-api', 15.0),
    ],
  }
}
