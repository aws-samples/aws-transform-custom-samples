// Knowledge Items API client.
//
// Backend: get_knowledge_items.py logic ported into the agentic platform's
// async_invoke_agent Lambda, exposed via `/orchestrate` as `op: "knowledge_items"`
// with a `kiAction` selector. Reads are two-tier: an instant S3 cache (kiAction:"get"),
// falling back to a Batch job (kiAction:"submit") that you poll (kiAction:"poll").
// Writes (enable/disable/delete/export) are fire-and-forget Batch jobs.
//
// A knowledge item: { id, status: 'ENABLED'|'DISABLED', title, description, fix }
//
// SWAP POINT: set VITE_KI_MOCK=false once the Lambda op is deployed.

const API_BASE = import.meta.env.VITE_API_ENDPOINT || '/api'
const USE_MOCK = (import.meta.env.VITE_KI_MOCK ?? 'true') !== 'false'

async function ki(payload) {
  const res = await fetch(`${API_BASE}/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'direct', op: 'knowledge_items', ...payload }),
  })
  if (!res.ok) throw new Error(`Knowledge Items API returned ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

/**
 * Read cached knowledge items for a transformation (instant, no Batch job).
 * @param {string} transformationName
 * @returns {Promise<{ knowledgeItems: object[], source: string }>}
 */
export async function readCachedKnowledgeItems(transformationName) {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 300))
    return { source: 'cache', knowledgeItems: mockItems(transformationName) }
  }
  const cached = await ki({ kiAction: 'get', transformationName })
  return { source: 'cache', knowledgeItems: cached.knowledgeItems || [] }
}

/**
 * Refresh knowledge items by running a list-ki Batch job and polling for the result.
 * This is the expensive path (Fargate cold start) — call it explicitly, not on load.
 * @param {string} transformationName
 * @param {object} opts - { onStatus, pollIntervalMs, maxPollMs }
 * @returns {Promise<{ knowledgeItems: object[], source: string }>}
 */
export async function refreshKnowledgeItems(transformationName, opts = {}) {
  const { onStatus, pollIntervalMs = 4000, maxPollMs = 180000 } = opts

  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 800))
    return { source: 'refresh', knowledgeItems: mockItems(transformationName) }
  }

  onStatus?.('Submitting refresh job...')
  const submit = await ki({ kiAction: 'submit', cliAction: 'list-ki', transformationName })
  const requestId = submit.request_id
  if (!requestId) throw new Error('No request_id returned from submit')

  const deadline = Date.now() + maxPollMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs))
    const polled = await ki({ kiAction: 'poll', request_id: requestId })
    if (polled.status === 'COMPLETED') {
      return { source: 'refresh', knowledgeItems: polled.knowledgeItems || [] }
    }
    if (polled.status === 'FAILED') throw new Error(polled.error || 'Refresh failed')
    onStatus?.('Running list-ki job (this can take a few minutes)...')
  }
  throw new Error('Timed out refreshing knowledge items')
}

/** Enable or disable a knowledge item. status: 'ENABLED' | 'DISABLED' */
export async function setKnowledgeItemStatus(transformationName, id, status) {
  if (USE_MOCK) { await new Promise(r => setTimeout(r, 300)); return { status: 'SUBMITTED' } }
  return ki({ kiAction: 'update-ki-status', transformationName, id, status })
}

/** Delete a knowledge item. */
export async function deleteKnowledgeItem(transformationName, id) {
  if (USE_MOCK) { await new Promise(r => setTimeout(r, 300)); return { status: 'SUBMITTED' } }
  return ki({ kiAction: 'delete-ki', transformationName, id })
}

/** Toggle auto-apply of new knowledge items. autoEnabled: 'TRUE' | 'FALSE' */
export async function setAutoApply(transformationName, autoEnabled) {
  if (USE_MOCK) { await new Promise(r => setTimeout(r, 300)); return { status: 'SUBMITTED' } }
  return ki({ kiAction: 'update-ki-config', transformationName, autoEnabled })
}

/** Export all knowledge items to markdown (Batch job). */
export async function exportKnowledgeItems(transformationName) {
  if (USE_MOCK) { await new Promise(r => setTimeout(r, 300)); return { status: 'SUBMITTED' } }
  return ki({ kiAction: 'export-ki-markdown', transformationName })
}

// ---- Mock data (shape from the ATX list-ki output in the AWS blog) ----

function mockItems(transformationName) {
  if (transformationName !== 'AWS/java-version-upgrade') {
    return [
      {
        id: 'c2a1f0e3-1111-2222-3333-444455556666',
        status: 'DISABLED',
        title: 'Sample learned pattern',
        description: 'A representative knowledge item captured during a prior run of this transformation.',
        rationale: 'Illustrates the shape of a knowledge item before any real runs populate the cache.',
        changes: JSON.stringify({
          file_changes: { modified: [{ file: 'src/example.txt', type: 'MODIFY' }] },
          code_samples: {
            before: { file: 'src/example.txt', code: 'old value' },
            after: { file: 'src/example.txt', code: 'new value' },
          },
        }),
      },
    ]
  }
  return [
    {
      id: '7f36cfd4-2926-44fa-8fa5-eb5384e65c77',
      status: 'DISABLED',
      title: 'Mockito 5.14.2 ByteBuddy incompatible with Java 26',
      description: 'Mockito 5.14.2 fails to mock standard library classes like ArrayList under Java 26. ByteBuddy cannot modify ArrayList and related collection classes. Mockito 5.15.2 resolves the compatibility issue.',
      rationale: 'Bytecode manipulation libraries must support the target Java class file format. ByteBuddy bundled with Mockito 5.14.2 cannot handle Java 26 (class major version 70).',
      changes: JSON.stringify({
        file_changes: { modified: [{ file: 'pom.xml', type: 'MODIFY' }] },
        code_samples: {
          before: { language: 'xml', file: 'pom.xml', code: '<dependency>\n  <groupId>org.mockito</groupId>\n  <artifactId>mockito-core</artifactId>\n  <version>5.14.2</version>\n  <scope>test</scope>\n</dependency>' },
          after: { language: 'xml', file: 'pom.xml', code: '<dependency>\n  <groupId>org.mockito</groupId>\n  <artifactId>mockito-core</artifactId>\n  <version>5.15.2</version>\n  <scope>test</scope>\n</dependency>' },
        },
      }),
    },
    {
      id: 'adb1b8e6-4199-4d4d-964c-1eab5c94de1a',
      status: 'DISABLED',
      title: 'Spring Boot 3.2.12 ASM lacks Java 26 class format support',
      description: 'Spring Boot 3.2.12 uses an ASM version that cannot parse Java 26 class files (major version 70). Test execution fails with "Incompatible class format" during classpath scanning. Spring Boot 3.5.14 or newer is required.',
      rationale: 'Classpath scanning at test time parses bytecode; an ASM version without Java 26 support breaks the entire test run, not just compilation.',
      changes: JSON.stringify({
        file_changes: { modified: [{ file: 'pom.xml', type: 'MODIFY' }] },
        code_samples: {
          before: { language: 'xml', file: 'pom.xml', code: '<parent>\n  <groupId>org.springframework.boot</groupId>\n  <artifactId>spring-boot-starter-parent</artifactId>\n  <version>3.2.12</version>\n</parent>' },
          after: { language: 'xml', file: 'pom.xml', code: '<parent>\n  <groupId>org.springframework.boot</groupId>\n  <artifactId>spring-boot-starter-parent</artifactId>\n  <version>3.5.14</version>\n</parent>' },
        },
      }),
    },
  ]
}
