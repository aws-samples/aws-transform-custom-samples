import React, { useState, useEffect, useRef } from 'react'

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`
}

const STATUS_STEPS = ['SUBMITTED', 'PENDING', 'RUNNABLE', 'STARTING', 'RUNNING', 'SUCCEEDED']

function ProgressBar({ status }) {
  const idx = STATUS_STEPS.indexOf(status)
  const pct = status === 'FAILED' ? 100 : status === 'PROCESSING' ? 50 : idx >= 0 ? Math.round(((idx + 1) / STATUS_STEPS.length) * 100) : 0
  const color = status === 'FAILED' ? '#f85149' : status === 'SUCCEEDED' ? '#3fb950' : '#58a6ff'
  return <div style={{ background: '#21262d', borderRadius: 4, height: 6, width: '100%', marginTop: 8 }}>
    <div style={{ background: color, borderRadius: 4, height: 6, width: `${pct}%`, transition: 'width 0.5s' }} />
  </div>
}

function ResultsSummary({ data }) {
  const [showFiles, setShowFiles] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [fileSearch, setFileSearch] = useState('')
  const [downloadingAll, setDownloadingAll] = useState(false)
  const files = data.files || []
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0)
  const totalKB = (totalSize / 1024).toFixed(1)
  const totalMB = totalSize > 1048576 ? ` (${(totalSize / 1048576).toFixed(1)} MB)` : ''

  const bucket = data.results_location?.replace('s3://', '').split('/')[0] || ''

  const filteredFiles = fileSearch
    ? files.filter(f => (f.name || f.key).toLowerCase().includes(fileSearch.toLowerCase()))
    : files

  async function previewFile(file) {
    setPreviewLoading(true)
    setPreview(null)
    try {
      const API = import.meta.env.VITE_API_ENDPOINT || '/api'
      const res = await fetch(`${API}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'direct', op: 'get_file', bucket, key: file.key })
      })
      const result = await res.json()
      if (result.content) {
        setPreview({ name: file.name || file.key.split('/').pop(), content: result.content, size: result.size })
      } else {
        setPreview({ name: file.name, content: `Error: ${result.error || 'Could not load file'}`, size: 0 })
      }
    } catch (e) {
      setPreview({ name: file.name, content: `Error: ${e.message}`, size: 0 })
    }
    setPreviewLoading(false)
  }

  async function downloadFile(file) {
    try {
      const API = import.meta.env.VITE_API_ENDPOINT || '/api'
      const res = await fetch(`${API}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'direct', op: 'download_url', bucket, key: file.key })
      })
      const result = await res.json()
      if (result.url) {
        const a = document.createElement('a')
        a.href = result.url
        a.download = file.name || file.key.split('/').pop()
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (e) { console.error('Download failed:', e) }
  }

  async function downloadAll() {
    setDownloadingAll(true)
    try {
      const API = import.meta.env.VITE_API_ENDPOINT || '/api'
      const prefix = data.results_location?.replace(`s3://${bucket}/`, '') || ''
      const startRes = await fetch(`${API}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'direct', op: 'download_all', bucket, prefix })
      })
      const startData = await startRes.json()
      if (startData.status === 'COMPLETED' && startData.url) {
        // Cached ZIP exists, download immediately
        const a = document.createElement('a')
        a.href = startData.url
        a.download = `results-${data.job_name || 'download'}.zip`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setDownloadingAll(false)
        return
      }
      if (!startData.download_id) {
        alert(startData.error || 'Failed to start download')
        setDownloadingAll(false)
        return
      }
      const downloadId = startData.download_id
      // Save download state to parent so it survives collapse
      if (data._onDownloadStart) data._onDownloadStart(downloadId)

      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const pollRes = await fetch(`${API}/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'direct', op: 'download_all', bucket, prefix, download_id: downloadId })
        })
        const pollData = await pollRes.json()
        if (pollData.status === 'COMPLETED' && pollData.url) {
          const a = document.createElement('a')
          a.href = pollData.url
          a.download = `results-${data.job_name || 'download'}.zip`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          if (data._onDownloadComplete) data._onDownloadComplete()
          break
        }
        if (pollData.status === 'FAILED') {
          alert(`Download failed: ${pollData.error}`)
          if (data._onDownloadComplete) data._onDownloadComplete()
          break
        }
      }
    } catch (e) { console.error('Download all failed:', e) }
    setDownloadingAll(false)
  }

  const fileCount = files.length
  const estimateMin = Math.max(1, Math.ceil(fileCount / 200))  // ~200 files/min

  return (
    <div>
      <div style={{ background: '#0d1117', borderRadius: 6, padding: 12, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><span style={{ color: '#8b949e' }}>Files: </span><span style={{ color: '#c9d1d9' }}>{files.length}</span></div>
          <div><span style={{ color: '#8b949e' }}>Total size: </span><span style={{ color: '#c9d1d9' }}>{totalKB} KB{totalMB}</span></div>
          <button className="btn btn-secondary btn-sm" onClick={downloadAll} disabled={downloadingAll || data._downloading} style={{ marginLeft: 'auto' }}>
            {(downloadingAll || data._downloading)
              ? <><span className="spinner" /> Zipping {fileCount} files (~{estimateMin} min)...</>
              : `⬇ Download All (${fileCount} files)`}
          </button>
        </div>
        <p style={{ fontSize: 11, color: '#484f58', marginTop: 6, fontFamily: 'monospace', wordBreak: 'break-all' }}>{data.results_location}</p>
      </div>
      {files.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="flex gap-8" style={{ alignItems: 'center' }}>
            <span
              style={{ color: '#58a6ff', fontSize: 12, cursor: 'pointer' }}
              onClick={() => setShowFiles(!showFiles)}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setShowFiles(!showFiles) }}
            >
              {showFiles ? '▾ Hide files' : '▸ Show files'}
            </span>
            {showFiles && (
              <input type="text" placeholder="Search files..." value={fileSearch} onChange={e => setFileSearch(e.target.value)}
                style={{ fontSize: 11, padding: '3px 8px', width: 200, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9' }} />
            )}
            {showFiles && fileSearch && <span style={{ fontSize: 11, color: '#8b949e' }}>{filteredFiles.length} of {files.length}</span>}
          </div>
          {showFiles && (
            <div className="table-wrap" style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>File</th><th>Size</th><th></th></tr></thead>
                <tbody>
                  {filteredFiles.map((f, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{f.name || f.key.split('/').pop()}</td>
                      <td style={{ fontSize: 12, color: '#8b949e' }}>{(f.size / 1024).toFixed(1)} KB</td>
                      <td><span style={{ color: '#58a6ff', fontSize: 11, cursor: 'pointer' }} onClick={() => previewFile(f)}>Preview</span>
                        <span style={{ color: '#484f58', margin: '0 4px' }}>|</span>
                        <span style={{ color: '#58a6ff', fontSize: 11, cursor: 'pointer' }} onClick={() => downloadFile(f)}>Download</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {previewLoading && <div style={{ marginTop: 8 }}><span className="spinner" /><span className="loading-text" style={{ marginLeft: 8 }}>Loading preview...</span></div>}

      {preview && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setPreview(null)}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, width: '80%', maxWidth: 900, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #21262d' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#c9d1d9' }}>{preview.name}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)}>✕ Close</button>
            </div>
            <pre style={{ padding: 16, margin: 0, overflow: 'auto', flex: 1, fontSize: 12, lineHeight: 1.5, color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {preview.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function FailedJobDetails({ jobId, job, onRetry }) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showRetryForm, setShowRetryForm] = useState(false)
  const [retrySource, setRetrySource] = useState(job.source || '')
  const [retryTransform, setRetryTransform] = useState(job.transformation || '')
  const [retryBuildCmd, setRetryBuildCmd] = useState('')
  const [retryContext, setRetryContext] = useState('')
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    async function loadDetails() {
      try {
        const API = import.meta.env.VITE_API_ENDPOINT || '/api'
        const res = await fetch(`${API}/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'direct', op: 'status', job_id: jobId })
        })
        const data = await res.json()
        setDetails(data)
      } catch {}
      setLoading(false)
    }
    loadDetails()
  }, [jobId])

  async function handleRetry() {
    setRetrying(true)
    await onRetry({
      ...job,
      source: retrySource,
      transformation: retryTransform,
      buildCmd: retryBuildCmd,
      additionalContext: retryContext,
    })
    setRetrying(false)
  }

  const reason = details?.failure_reason || details?.error || 'Unknown error'
  const logStream = details?.log_stream

  return (
    <div style={{ marginTop: 12 }}>
      <span style={{ color: '#f85149', fontSize: 13, fontWeight: 500 }}>Job Failed</span>
      {loading ? (
        <div style={{ marginTop: 6 }}><span className="spinner" /><span className="loading-text" style={{ marginLeft: 8 }}>Loading error details...</span></div>
      ) : (
        <div style={{ marginTop: 8, background: '#1c1012', border: '1px solid #3d1114', borderRadius: 6, padding: 12 }}>
          <p style={{ color: '#f85149', fontSize: 12, fontFamily: 'monospace', margin: 0, whiteSpace: 'pre-wrap' }}>{reason}</p>
          {logStream && (
            <p style={{ color: '#484f58', fontSize: 11, marginTop: 8, fontFamily: 'monospace' }}>
              Log stream: {logStream}
            </p>
          )}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        {!showRetryForm ? (
          <div className="flex gap-8" style={{ alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => handleRetry()}>↻ Retry Same</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowRetryForm(true)}>✏ Retry with Changes</button>
            <span style={{ color: '#8b949e', fontSize: 11 }}>
              Tip: Use Chat tab for detailed failure analysis
            </span>
          </div>
        ) : (
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: 12, marginTop: 4 }}>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#8b949e' }}>Transformation</label>
              <input type="text" value={retryTransform} onChange={e => setRetryTransform(e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#8b949e' }}>Source Repository</label>
              <input type="text" value={retrySource} onChange={e => setRetrySource(e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px' }} />
            </div>
            <div className="flex gap-8" style={{ marginBottom: 8 }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label style={{ fontSize: 11, color: '#8b949e' }}>Build / Validation Command</label>
                <input type="text" value={retryBuildCmd} onChange={e => setRetryBuildCmd(e.target.value)}
                  placeholder="pytest, mvn clean install, npm test"
                  style={{ fontSize: 12, padding: '4px 8px' }} />
              </div>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label style={{ fontSize: 11, color: '#8b949e' }}>Additional Context</label>
                <input type="text" value={retryContext} onChange={e => setRetryContext(e.target.value)}
                  placeholder="Target Python 3.13, Target Java 21"
                  style={{ fontSize: 12, padding: '4px 8px' }} />
              </div>
            </div>
            <div className="flex gap-8">
              <button className="btn btn-primary btn-sm" onClick={handleRetry} disabled={retrying || !retrySource.trim()}>
                {retrying ? <><span className="spinner" /> Submitting...</> : '↻ Retry'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowRetryForm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewAndPublish({ job, orchestrate, onPublished }) {
  const [definition, setDefinition] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const API = import.meta.env.VITE_API_ENDPOINT || '/api'
        const normalized = job.transformation.toLowerCase().replace(/\s+/g, '-')
        const res = await fetch(`${API}/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'direct', op: 'get_file', definition_name: normalized })
        })
        const data = await res.json()
        if (data.content) setDefinition(data.content)
        else setDefinition(`Could not load: ${data.error || 'Unknown error'}`)
      } catch (e) { setDefinition(`Error: ${e.message}`) }
      setLoading(false)
    }
    load()
  }, [job.transformation])

  async function handlePublish() {
    setPublishing(true)
    try {
      const normalized = job.transformation.toLowerCase().replace(/\s+/g, '-')
      // Save edited definition back to S3 first
      const API = import.meta.env.VITE_API_ENDPOINT || '/api'
      // Use orchestrator to publish
      await orchestrate(`Publish the transformation "${normalized}" with description "${job.transformation}" to the ATX registry. The definition is already in S3.`)
      onPublished()
    } catch (e) { console.error('Publish failed:', e) }
    setPublishing(false)
  }

  if (loading) return <div style={{ marginTop: 16 }}><span className="spinner" /><span className="loading-text" style={{ marginLeft: 8 }}>Loading definition...</span></div>

  return (
    <div style={{ marginTop: 16 }}>
      <span style={{ color: '#79c0ff', fontSize: 13, fontWeight: 500 }}>Review Definition</span>
      <p style={{ color: '#8b949e', fontSize: 12, marginTop: 4 }}>
        Edit the definition below, then publish to the ATX registry.
      </p>
      <textarea
        value={definition}
        onChange={e => setDefinition(e.target.value)}
        rows={15}
        style={{
          width: '100%', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5,
          background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d',
          borderRadius: 6, padding: 12, resize: 'vertical', marginTop: 8,
        }}
      />
      <div className="flex gap-8" style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={handlePublish} disabled={publishing}>
          {publishing ? <><span className="spinner" /> Publishing...</> : '🚀 Publish to Registry'}
        </button>
      </div>
    </div>
  )
}

function ViewDefinitionButton({ name }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)

  async function loadDefinition() {
    setLoading(true)
    try {
      const API = import.meta.env.VITE_API_ENDPOINT || '/api'
      const res = await fetch(`${API}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'direct', op: 'get_file', definition_name: name })
      })
      const result = await res.json()
      if (result.content) {
        setPreview({ name: `${name}/transformation_definition.md`, content: result.content })
      } else {
        setPreview({ name: `${name}/transformation_definition.md`, content: `Could not load: ${result.error || 'Unknown error'}` })
      }
    } catch (e) {
      setPreview({ name: `${name}/transformation_definition.md`, content: `Error: ${e.message}` })
    }
    setLoading(false)
  }

  return (
    <>
      <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={loadDefinition} disabled={loading}>
        {loading ? <><span className="spinner" /> Loading...</> : '📄 View Definition'}
      </button>
      {preview && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setPreview(null)}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, width: '80%', maxWidth: 900, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #21262d' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#c9d1d9' }}>{preview.name}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)}>✕ Close</button>
            </div>
            <pre style={{ padding: 16, margin: 0, overflow: 'auto', flex: 1, fontSize: 12, lineHeight: 1.5, color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {preview.content}
            </pre>
          </div>
        </div>
      )}
    </>
  )
}

export default function JobTracker({ orchestrate, directCall, jobs, setJobs }) {
  const [expanded, setExpanded] = useState(null)
  const [jobResults, setJobResults] = useState({})
  const [lastRefresh, setLastRefresh] = useState(null)
  const [, forceUpdate] = useState(0)
  const pollRef = useRef(null)
  const [activeDownloads, setActiveDownloads] = useState({})

  useEffect(() => { const t = setInterval(() => forceUpdate(n => n + 1), 5000); return () => clearInterval(t) }, [])

  useEffect(() => {
    const active = jobs.filter(j => !['SUCCEEDED', 'FAILED'].includes(j.status))
    if (!active.length) { if (pollRef.current) clearInterval(pollRef.current); return }
    pollRef.current = setInterval(() => active.forEach(j => refreshStatus(j.id)), 15000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [jobs])

  async function refreshStatus(jobId) {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return

    try {
      if (job.type === 'create' || job.type === 'preview') {
        // Create jobs: poll orchestrator result from S3
        const API = import.meta.env.VITE_API_ENDPOINT || '/api'
        const res = await fetch(`${API}/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'poll', request_id: jobId })
        })
        const data = await res.json()
        if (data.status === 'COMPLETED') {
          const resultText = data?.result?.result?.content?.[0]?.text || data?.result?.result?.result || JSON.stringify(data?.result)
          setJobs(prev => prev.map(j => j.id !== jobId ? j : { ...j, status: 'SUCCEEDED', result: resultText }))
          _persistJobUpdate(jobId, { status: 'SUCCEEDED', result: resultText })
        } else if (data.status === 'FAILED') {
          setJobs(prev => prev.map(j => j.id !== jobId ? j : { ...j, status: 'FAILED', error: data.error }))
          _persistJobUpdate(jobId, { status: 'FAILED' })
        } else if (data.step) {
          setJobs(prev => prev.map(j => j.id !== jobId ? j : { ...j, step: data.step }))
        }
        setLastRefresh(new Date().toISOString())
      } else {
        // Execution jobs: poll Batch status
        const result = await directCall('status', jobId)
        if (result.job_status) {
          const jobName = result.job_name || ''
          let detectedTransform = null
          const awsMatch = jobName.match(/(python-version-upgrade|java-version-upgrade|nodejs-version-upgrade|python-boto2-to-boto3|java-aws-sdk-v1-to-v2|nodejs-aws-sdk-v2-to-v3|early-access-[\w-]+)/)
          if (awsMatch) detectedTransform = `AWS/${awsMatch[1]}`

          setJobs(prev => prev.map(j => {
            if (j.id !== jobId) return j
            const updates = { ...j, status: result.job_status }
            if (detectedTransform && (j.transformation === 'Batch job' || j.transformation === 'AI-determined')) {
              updates.transformation = detectedTransform
            }
            return updates
          }))
          _persistJobUpdate(jobId, { status: result.job_status })
          setLastRefresh(new Date().toISOString())
        }
      }
    } catch (e) { console.error(e) }
  }

  async function refreshAll() { for (const j of jobs) await refreshStatus(j.id) }

  function _persistJobUpdate(jobId, updates) {
    const API = import.meta.env.VITE_API_ENDPOINT || '/api'
    fetch(`${API}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'direct', op: 'update_job', job_id: jobId, updates })
    }).catch(e => console.error('Failed to persist job update:', e))
  }

  async function loadResults(jobId) {
    setJobResults(prev => ({ ...prev, [jobId]: { loading: true } }))
    try {
      const result = await directCall('results', jobId)
      if (result.files && result.files.length > 0) {
        setJobResults(prev => ({ ...prev, [jobId]: { loading: false, data: result } }))
      } else {
        setJobResults(prev => ({ ...prev, [jobId]: { loading: false, data: result, empty: true } }))
      }
    } catch (e) {
      setJobResults(prev => ({ ...prev, [jobId]: { loading: false, error: e.message } }))
    }
  }

  function toggleExpand(jobId) {
    const isOpening = expanded !== jobId
    setExpanded(isOpening ? jobId : null)
    // Auto-load results when expanding a succeeded job
    if (isOpening) {
      const job = jobs.find(j => j.id === jobId)
      if (job?.status === 'SUCCEEDED' && job?.type !== 'create' && !jobResults[jobId]) {
        loadResults(jobId)
      }
    }
  }

  function removeJob(jobId) {
    setJobs(prev => prev.filter(j => j.id !== jobId))
    if (expanded === jobId) setExpanded(null)
    const API = import.meta.env.VITE_API_ENDPOINT || '/api'
    fetch(`${API}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'direct', op: 'delete_job', job_id: jobId })
    }).catch(e => console.error('Failed to delete job:', e))
  }

  async function retryJob(job) {
    let prompt
    if (job.type === 'create') {
      prompt = `Create a custom transformation called "${job.transformation}". Generate the transformation definition and publish it to the ATX registry.`
    } else {
      const configParts = []
      if (job.buildCmd) configParts.push(`buildCommand=${job.buildCmd}`)
      if (job.additionalContext) configParts.push(`additionalPlanContext=${job.additionalContext}`)
      const configStr = configParts.length > 0 ? ` Configuration: ${configParts.join(', ')}.` : ''
      prompt = `Execute the ${job.transformation} transformation on this repository: ${job.source}.${configStr}`
    }
    removeJob(job.id)
    try {
      const result = await orchestrate(prompt)
      const jobIdMatch = result.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (jobIdMatch) {
        const newJob = {
          id: jobIdMatch[0],
          type: job.type || 'execution',
          transformation: job.transformation,
          source: job.source,
          status: 'SUBMITTED',
          submittedAt: new Date().toISOString(),
        }
        setJobs(prev => [newJob, ...prev])
        const API = import.meta.env.VITE_API_ENDPOINT || '/api'
        fetch(`${API}/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'direct', op: 'save_job', job: newJob })
        }).catch(() => {})
      }
    } catch (e) { console.error('Retry failed:', e) }
  }

  async function downloadFile(bucket, key, fileName) {
    try {
      const API = import.meta.env.VITE_API_ENDPOINT || '/api'
      const res = await fetch(`${API}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'direct', op: 'download_url', bucket, key })
      })
      const data = await res.json()
      if (data.url) {
        const a = document.createElement('a')
        a.href = data.url
        a.download = fileName || key.split('/').pop()
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (e) { console.error('Download failed:', e) }
  }

  if (!jobs.length) return <div className="empty-state"><div className="icon">📋</div><p>No jobs yet. Execute a transformation to see jobs here.</p></div>

  const activeCount = jobs.filter(j => !['SUCCEEDED', 'FAILED'].includes(j.status)).length

  return (
    <div>
      <div className="flex-between mb-16">
        <h2 style={{ fontSize: 18 }}>Job Tracker ({jobs.length})</h2>
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          {lastRefresh && <span style={{ color: '#484f58', fontSize: 11 }}>Updated {timeAgo(lastRefresh)}</span>}
          <button className="btn btn-secondary btn-sm" onClick={refreshAll} title="Refresh all">Refresh All</button>
        </div>
      </div>
      {activeCount > 0 && <p style={{ color: '#8b949e', fontSize: 12, marginBottom: 12 }}>● Auto-refreshing {activeCount} active job{activeCount !== 1 ? 's' : ''} every 15s</p>}

      {jobs.map(job => {
        const isExpanded = expanded === job.id
        const results = jobResults[job.id]
        return (
          <div className="card" key={job.id} style={{ padding: 0, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', gap: 16 }}
              onClick={() => toggleExpand(job.id)} role="button" tabIndex={0}>
              <span style={{ color: '#484f58', fontSize: 12, width: 16 }}>{isExpanded ? '▾' : '▸'}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8b949e', minWidth: 75 }}>{job.id.slice(0, 8)}...</span>
              {job.type === 'create' && <span className="tag" style={{ background: '#1a2e1a', color: '#7ee787', fontSize: 10, padding: '2px 6px' }}>CREATE</span>}
              {job.type === 'preview' && <span className="tag" style={{ background: '#1a1e2e', color: '#79c0ff', fontSize: 10, padding: '2px 6px' }}>PREVIEW</span>}
              <span style={{ flex: 1, fontSize: 13 }}>{job.transformation}{job.step && job.status === 'PROCESSING' ? <span style={{ color: '#8b949e', fontSize: 11, marginLeft: 8 }}>{job.step}</span> : ''}</span>
              <span style={{ fontSize: 12, color: '#8b949e', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.source.replace('https://github.com/', '')}
              </span>
              <span className={`status status-${job.status.toLowerCase()}`}>{job.status}</span>
              <span style={{ fontSize: 11, color: '#484f58', minWidth: 55, textAlign: 'right' }}>{timeAgo(job.submittedAt)}</span>
              <div className="flex gap-8" onClick={e => e.stopPropagation()}>
                <button className="btn btn-secondary btn-sm" onClick={() => refreshStatus(job.id)} title="Refresh status">↻</button>
                <button className="btn btn-danger btn-sm" onClick={() => removeJob(job.id)} title="Remove from tracker">✕</button>
              </div>
            </div>

            {isExpanded && (
              <div style={{ padding: '0 16px 16px 48px', borderTop: '1px solid #21262d' }}>
                <ProgressBar status={job.status} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', marginTop: 12, fontSize: 12 }}>
                  <div><span style={{ color: '#8b949e' }}>Job ID</span><p style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 2 }}>{job.id}</p></div>
                  <div><span style={{ color: '#8b949e' }}>Source</span><p style={{ marginTop: 2, wordBreak: 'break-all' }}>{job.source}</p></div>
                </div>

                {job.status === 'SUCCEEDED' && job.type === 'create' && (
                  <div style={{ marginTop: 16 }}>
                    <span style={{ color: '#3fb950', fontSize: 13, fontWeight: 500 }}>Transformation published to ATX registry</span>
                    <p style={{ color: '#8b949e', fontSize: 12, marginTop: 4 }}>
                      Go to the Transformations tab and refresh to see it. You can now execute it on any repository.
                    </p>
                    <ViewDefinitionButton name={job.transformation} />
                  </div>
                )}

                {job.status === 'SUCCEEDED' && job.type === 'preview' && (
                  <PreviewAndPublish job={job} orchestrate={orchestrate} onPublished={(pubJob) => {
                    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, type: 'create', status: 'PROCESSING' } : j))
                    const API = import.meta.env.VITE_API_ENDPOINT || '/api'
                    fetch(`${API}/orchestrate`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'direct', op: 'update_job', job_id: job.id, updates: { type: 'create', status: 'PROCESSING' } })
                    }).catch(() => {})
                  }} />
                )}

                {job.status === 'SUCCEEDED' && job.type !== 'create' && (
                  <div style={{ marginTop: 16 }}>
                    <div className="flex-between" style={{ marginBottom: 8 }}>
                      <span style={{ color: '#3fb950', fontSize: 13, fontWeight: 500 }}>Results</span>
                      {results && !results.loading && (
                        <button className="btn btn-secondary btn-sm" onClick={() => loadResults(job.id)} title="Reload results">↻</button>
                      )}
                    </div>
                    {!results || results.loading ? (
                      <div><span className="spinner" /><span className="loading-text" style={{ marginLeft: 8 }}>Loading results...</span></div>
                    ) : results.error ? (
                      <p style={{ color: '#f85149', fontSize: 12 }}>Error: {results.error}</p>
                    ) : results.data ? (
                      <ResultsSummary data={{
                        ...results.data,
                        _downloading: !!activeDownloads[job.id],
                        _onDownloadStart: (downloadId) => setActiveDownloads(prev => ({ ...prev, [job.id]: downloadId })),
                        _onDownloadComplete: () => setActiveDownloads(prev => { const n = { ...prev }; delete n[job.id]; return n }),
                      }} />
                    ) : null}
                  </div>
                )}

                {job.status === 'FAILED' && (
                  <FailedJobDetails jobId={job.id} job={job} onRetry={(modifiedJob) => retryJob(modifiedJob || job)} />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
