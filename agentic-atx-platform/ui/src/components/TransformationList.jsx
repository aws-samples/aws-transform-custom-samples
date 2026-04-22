import React, { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_ENDPOINT || '/api'

const GITHUB_BASE = 'https://github.com/aws-samples/aws-transform-custom-samples/tree/main/aws-managed-definitions'

const MANAGED_TRANSFORMATIONS = [
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

async function directCall(op, extra = {}) {
  const res = await fetch(`${API_BASE}/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'direct', op, ...extra })
  })
  return res.json()
}

function CustomTransformCard({ name, description }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)

  async function viewDefinition() {
    setLoading(true)
    try {
      const normalized = name.toLowerCase().replace(/\s+/g, '-')
      const res = await fetch(`${API_BASE}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'direct', op: 'get_file', definition_name: normalized })
      })
      const data = await res.json()
      if (data.content) setPreview(data.content)
      else setPreview(`Could not load: ${data.error || 'Unknown error'}`)
    } catch (e) { setPreview(`Error: ${e.message}`) }
    setLoading(false)
  }

  return (
    <div className="card" style={{ borderColor: '#1a2e1a' }}>
      <div className="flex-between">
        <h3>{name}</h3>
        <div className="flex gap-8">
          <button className="btn btn-secondary btn-sm" onClick={viewDefinition} disabled={loading}>
            {loading ? <><span className="spinner" /></> : '📄 View Definition'}
          </button>
          <span className="tag" style={{ background: '#1a2e1a', color: '#7ee787' }}>Custom</span>
        </div>
      </div>
      <p>{description || 'Custom transformation'}</p>
      {preview && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setPreview(null)}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, width: '80%', maxWidth: 900, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #21262d' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#c9d1d9' }}>{name}/transformation_definition.md</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)}>✕ Close</button>
            </div>
            <pre style={{ padding: 16, margin: 0, overflow: 'auto', flex: 1, fontSize: 12, lineHeight: 1.5, color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {preview}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TransformationList({ orchestrate }) {
  const [filter, setFilter] = useState('all')
  const [customs, setCustoms] = useState([])
  const [loadingCustoms, setLoadingCustoms] = useState(true)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => { loadCustomTransforms() }, [])

  async function loadCustomTransforms() {
    setLoadingCustoms(true)
    try {
      const result = await directCall('list_custom')
      if (result.customs) {
        // Check publish status for any still "publishing"
        const updated = await Promise.all(result.customs.map(async (c) => {
          if (c.status === 'publishing' && c.job_id) {
            const checked = await directCall('check_publish', { name: c.name })
            return checked.name ? checked : c
          }
          return c
        }))
        setCustoms(updated)
      }
    } catch (e) { console.error('Failed to load custom transforms:', e) }
    setLoadingCustoms(false)
  }

  const managed = filter === 'all' ? MANAGED_TRANSFORMATIONS : MANAGED_TRANSFORMATIONS.filter(t => t.language === filter || t.language === 'all')
  const publishedCustoms = customs.filter(c => c.status === 'published')
  const publishingCustoms = customs.filter(c => c.status === 'publishing')

  async function showDetail(name) {
    setDetailLoading(true)
    setDetail(null)
    try {
      const result = await orchestrate(`Describe the transformation ${name} in detail`)
      setDetail({ name, text: result })
    } catch (e) { setDetail({ name, text: `Could not load details: ${e.message}` }) }
    setDetailLoading(false)
  }

  return (
    <div>
      <div className="flex-between mb-16">
        <h2 style={{ fontSize: 18 }}>
          Transformations ({managed.length + publishedCustoms.length})
        </h2>
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
            <option value="all">All Languages</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="nodejs">Node.js</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={loadCustomTransforms} title="Refresh custom transforms">↻</button>
        </div>
      </div>

      {publishedCustoms.length > 0 && (
        <>
          <p style={{ color: '#7ee787', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Custom ({publishedCustoms.length})</p>
          {publishedCustoms.map(c => (
            <CustomTransformCard key={c.name} name={c.name} description={c.description} />
          ))}
        </>
      )}

      {publishingCustoms.length > 0 && (
        <>
          <p style={{ color: '#d2a8ff', fontSize: 13, fontWeight: 500, marginBottom: 8, marginTop: 16 }}>Publishing...</p>
          {publishingCustoms.map(c => (
            <div className="card" key={c.name} style={{ borderColor: '#2d1f4e', opacity: 0.7 }}>
              <div className="flex-between">
                <h3>{c.name}</h3>
                <span className="tag" style={{ background: '#2d1f4e', color: '#d2a8ff' }}>Publishing</span>
              </div>
              <p style={{ fontSize: 12 }}>{c.description || 'Awaiting publish...'}</p>
            </div>
          ))}
        </>
      )}

      <p style={{ color: '#58a6ff', fontSize: 13, fontWeight: 500, marginBottom: 8, marginTop: publishedCustoms.length > 0 || publishingCustoms.length > 0 ? 16 : 0 }}>
        AWS Managed ({managed.length})
      </p>
      {managed.map(t => (
        <div className="card" key={t.name}>
          <div className="flex-between">
            <h3>{t.name}</h3>
            <a href={GITHUB_BASE} target="_blank" rel="noopener noreferrer"
              className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>View Definition ↗</a>
          </div>
          <p>{t.description}</p>
          <span className="tag">{t.language}</span>
        </div>
      ))}

      {detailLoading && <div className="card mt-16"><span className="spinner" /><span className="loading-text">Loading details...</span></div>}
      {detail && <div className="response-box mt-16"><strong>{detail.name}</strong><br /><br />{detail.text}</div>}
    </div>
  )
}
