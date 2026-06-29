import { useState, useEffect } from 'react'
import {
  readCachedKnowledgeItems, refreshKnowledgeItems,
  setKnowledgeItemStatus, deleteKnowledgeItem, exportKnowledgeItems,
} from '../knowledgeApi'
import { MANAGED_TRANSFORMATION_NAMES } from '../transformations'

const API_BASE = import.meta.env.VITE_API_ENDPOINT || '/api'

// Knowledge items can exist for any AWS-managed transformation (shared catalog)
// plus any published custom transformations (fetched via the list_custom op).

const preStyle = {
  background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
  padding: 12, fontSize: 12, lineHeight: 1.5, color: '#c9d1d9',
  overflowX: 'auto', whiteSpace: 'pre-wrap',
}

function StatusBadge({ status }) {
  const enabled = status === 'ENABLED'
  return (
    <span className="status" style={{
      background: enabled ? '#0c2d1a' : '#1f2937',
      color: enabled ? '#3fb950' : '#8b949e',
    }}>
      {status}
    </span>
  )
}

// The ATX `list-ki --json` output carries fix data in a `changes` field that is a
// (double-escaped) JSON string of { file_changes, code_samples: { before, after } }.
// Older/blog-style items may instead carry a plain `fix` string. Normalize both.
function parseChanges(item) {
  if (item.fix && typeof item.fix === 'string') {
    return { rawFix: item.fix }
  }
  if (!item.changes) return null
  try {
    let parsed = item.changes
    // `changes` is often a JSON string; may be wrapped/escaped more than once.
    for (let i = 0; i < 3 && typeof parsed === 'string'; i++) {
      parsed = JSON.parse(parsed)
    }
    if (parsed && typeof parsed === 'object') {
      const files = parsed.file_changes?.modified || parsed.file_changes?.added || []
      const before = parsed.code_samples?.before
      const after = parsed.code_samples?.after
      return {
        files: Array.isArray(files) ? files : [],
        before, after,
      }
    }
  } catch {
    // Fall back to showing the raw string if it won't parse.
    return { rawFix: typeof item.changes === 'string' ? item.changes : JSON.stringify(item.changes) }
  }
  return null
}

function KnowledgeItemCard({ item, transformationName, onChanged }) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localStatus, setLocalStatus] = useState(item.status)

  async function toggle() {
    const next = localStatus === 'ENABLED' ? 'DISABLED' : 'ENABLED'
    setBusy(true)
    try {
      await setKnowledgeItemStatus(transformationName, item.id, next)
      setLocalStatus(next)
      onChanged?.()
    } catch (e) {
      alert(`Failed to update: ${e.message}`)
    }
    setBusy(false)
  }

  async function remove() {
    if (!confirm(`Delete knowledge item "${item.title}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      await deleteKnowledgeItem(transformationName, item.id)
      onChanged?.(item.id)
    } catch (e) {
      alert(`Failed to delete: ${e.message}`)
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="flex-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 4 }}>
            <StatusBadge status={localStatus} />
            <span style={{ color: '#c9d1d9', fontSize: 14, fontWeight: 500 }}>{item.title}</span>
          </div>
          <p style={{ fontSize: 11, color: '#484f58', fontFamily: 'monospace' }}>{item.id}</p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-sm btn-secondary" onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Hide' : 'Details'}
          </button>
          <button
            className={`btn btn-sm ${localStatus === 'ENABLED' ? 'btn-secondary' : 'btn-primary'}`}
            onClick={toggle} disabled={busy}>
            {busy ? <span className="spinner" /> : localStatus === 'ENABLED' ? 'Disable' : 'Enable'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={remove} disabled={busy}>Delete</button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: '#8b949e', fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
            {item.description}
          </p>

          {item.rationale && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: '#c9d1d9', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Rationale</p>
              <p style={{ color: '#8b949e', fontSize: 13, lineHeight: 1.6 }}>{item.rationale}</p>
            </div>
          )}

          {(() => {
            const c = parseChanges(item)
            if (!c) return null

            if (c.rawFix) {
              return (
                <>
                  <p style={{ color: '#c9d1d9', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Fix</p>
                  <pre style={preStyle}>{c.rawFix}</pre>
                </>
              )
            }

            return (
              <>
                {c.files.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ color: '#c9d1d9', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                      Files changed
                    </p>
                    {c.files.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: '#8b949e', marginBottom: 2 }}>
                        <span className="tag" style={{ marginRight: 6 }}>{f.type || 'MODIFY'}</span>
                        {f.file}
                      </div>
                    ))}
                  </div>
                )}
                {c.before?.code && (
                  <div style={{ marginBottom: 8 }}>
                    <p style={{ color: '#f85149', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                      Before {c.before.file ? `— ${c.before.file}` : ''}
                    </p>
                    <pre style={preStyle}>{c.before.code}</pre>
                  </div>
                )}
                {c.after?.code && (
                  <div>
                    <p style={{ color: '#3fb950', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                      After {c.after.file ? `— ${c.after.file}` : ''}
                    </p>
                    <pre style={preStyle}>{c.after.code}</pre>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

export default function KnowledgeItems() {
  const [transformations, setTransformations] = useState(MANAGED_TRANSFORMATION_NAMES)
  const [transformation, setTransformation] = useState(MANAGED_TRANSFORMATION_NAMES[0])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [banner, setBanner] = useState(null)

  // On load / transformation change: read the S3 cache only (instant, no Batch job).
  async function loadCache() {
    setLoading(true)
    setError(null)
    try {
      const { knowledgeItems, source } = await readCachedKnowledgeItems(transformation)
      setItems(knowledgeItems)
      setSource(source)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  // Explicit user action: run a list-ki Batch job and poll (can take minutes).
  async function refresh() {
    setRefreshing(true)
    setError(null)
    setStatusText('Submitting refresh job...')
    try {
      const { knowledgeItems, source } = await refreshKnowledgeItems(transformation, {
        onStatus: setStatusText,
      })
      setItems(knowledgeItems)
      setSource(source)
    } catch (e) {
      setError(e.message)
    }
    setRefreshing(false)
    setStatusText('')
  }

  useEffect(() => { loadCache() }, [transformation])

  // Fetch published custom transformations once and append them to the dropdown.
  useEffect(() => {
    let cancelled = false
    async function loadCustoms() {
      try {
        const res = await fetch(`${API_BASE}/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'direct', op: 'list_custom' }),
        })
        const data = await res.json()
        const customNames = (data.customs || [])
          .filter(c => c.status === 'published' && c.name)
          .map(c => c.name)
        if (!cancelled && customNames.length > 0) {
          setTransformations(prev => {
            const merged = [...prev]
            for (const n of customNames) if (!merged.includes(n)) merged.push(n)
            return merged
          })
        }
      } catch (e) {
        console.error('Failed to load custom transformations:', e)
      }
    }
    loadCustoms()
    return () => { cancelled = true }
  }, [])

  async function handleExport() {
    setExporting(true)
    setBanner(null)
    try {
      await exportKnowledgeItems(transformation)
      setBanner('Export job submitted. Markdown will be written to the output bucket.')
    } catch (e) {
      setBanner(`Export failed: ${e.message}`)
    }
    setExporting(false)
  }

  function handleItemChanged(deletedId) {
    if (deletedId) setItems(prev => prev.filter(i => i.id !== deletedId))
  }

  const enabledCount = items.filter(i => i.status === 'ENABLED').length

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Knowledge Items</h2>
          <p style={{ color: '#8b949e', fontSize: 13, marginTop: 2 }}>
            Patterns and fixes ATX learned during runs. New items start <strong>disabled</strong> — review and enable to apply them on future runs.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex gap-8" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
            <label htmlFor="ki-transform">Transformation</label>
            <select id="ki-transform" value={transformation} onChange={e => setTransformation(e.target.value)}>
              {transformations.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={refresh} disabled={loading || refreshing}>
            {refreshing ? <><span className="spinner" /> Refreshing...</> : '↻ Pull from registry'}
          </button>
          <button className="btn btn-secondary" onClick={handleExport} disabled={exporting || items.length === 0}>
            {exporting ? <><span className="spinner" /> Exporting...</> : 'Export Markdown'}
          </button>
        </div>
      </div>

      {banner && (
        <div className="card" style={{ borderColor: '#1f6feb', background: '#0d1f3c' }}>
          <p style={{ color: '#79c0ff', fontSize: 13 }}>{banner}</p>
        </div>
      )}

      {!loading && !refreshing && !error && items.length > 0 && (
        <p style={{ color: '#8b949e', fontSize: 12, margin: '4px 4px 12px' }}>
          {items.length} item{items.length !== 1 ? 's' : ''} · {enabledCount} enabled
          {source === 'cache' && ' · cached'}
        </p>
      )}

      {(loading || refreshing) && (
        <div className="card">
          <span className="spinner" />
          <span className="loading-text">
            {refreshing ? (statusText || 'Refreshing...') : 'Loading cached knowledge items...'}
          </span>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: '#da3633', background: '#3d1114' }}>
          <p style={{ color: '#f85149', fontSize: 14 }}>❌ {error}</p>
        </div>
      )}

      {!loading && !refreshing && !error && items.length === 0 && (
        <div className="empty-state">
          <div className="icon">🧠</div>
          <p>No knowledge items cached for this transformation.</p>
          <p style={{ fontSize: 12, marginTop: 6 }}>
            They're generated automatically after runs. Click <strong>Pull from registry</strong> to fetch the latest —
            this runs a background job and can take a few minutes.
          </p>
        </div>
      )}

      {!loading && !refreshing && !error && items.map(item => (
        <KnowledgeItemCard
          key={item.id}
          item={item}
          transformationName={transformation}
          onChanged={handleItemChanged}
        />
      ))}
    </div>
  )
}
