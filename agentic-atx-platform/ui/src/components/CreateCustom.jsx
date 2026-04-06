import { useState } from 'react'

const API_BASE = import.meta.env.VITE_API_ENDPOINT || '/api'

export default function CreateCustom({ submitAsync, onJobCreated, orchestrate }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [requirements, setRequirements] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMode, setSubmitMode] = useState('')  // 'publish' or 'review'
  const [banner, setBanner] = useState(null)
  // Review mode state
  const [reviewMode, setReviewMode] = useState(false)
  const [definition, setDefinition] = useState('')
  const [publishing, setPublishing] = useState(false)

  async function handleAutoPublish(e) {
    e.preventDefault()
    if (!name.trim() || !requirements.trim()) return
    setSubmitting(true)
    setSubmitMode('publish')
    setBanner(null)
    setReviewMode(false)

    try {
      const parts = [
        `Create a custom transformation called "${name.trim()}" with description "${description.trim() || name.trim()}".`,
        `Requirements: ${requirements.trim()}.`,
      ]
      if (sourceUrl.trim()) {
        parts.push(`Source repository: ${sourceUrl.trim()}. Analyze the source code first to understand the codebase before generating the definition.`)
      }
      parts.push('Generate the transformation definition and publish it to the ATX registry.')

      const result = await submitAsync(parts.join(' '))

      if (result.request_id) {
        onJobCreated({
          id: result.request_id, type: 'create',
          transformation: name.trim(), source: sourceUrl.trim() || 'N/A',
          status: 'PROCESSING', submittedAt: new Date().toISOString(),
        })
        setBanner({
          type: 'success',
          text: `Request submitted. The AI is generating and publishing "${name.trim()}". Track in Jobs tab.`,
          requestId: result.request_id,
        })
        setName(''); setDescription(''); setSourceUrl(''); setRequirements('')
      } else {
        setBanner({ type: 'error', text: 'Failed to submit request.' })
      }
    } catch (err) {
      setBanner({ type: 'error', text: `Error: ${err.message}` })
    }
    setSubmitting(false)
  }

  async function handleGenerateReview(e) {
      e.preventDefault()
      if (!name.trim() || !requirements.trim()) return
      setSubmitMode('review')

      const savedName = name.trim()
      const savedDesc = description.trim() || name.trim()
      const savedSource = sourceUrl.trim()
      const savedReqs = requirements.trim()

      // Show banner and clear form immediately
      setBanner({
        type: 'success',
        text: `Generating definition for "${savedName}". You can safely navigate away — track progress in the Jobs tab.`,
      })
      setName(''); setDescription(''); setSourceUrl(''); setRequirements('')
      setSubmitting(true)
      setReviewMode(false)

      try {
        const parts = [
          `Create a custom transformation called "${savedName}" with description "${savedDesc}".`,
          `Requirements: ${savedReqs}.`,
        ]
        if (savedSource) {
          parts.push(`Source repository: ${savedSource}. Analyze the source code first.`)
        }
        parts.push('Generate the transformation definition and upload to S3. Do NOT publish it yet.')

        const result = await submitAsync(parts.join(' '))
        const jobId = result.request_id || `preview-${Date.now()}`

        // Create job in tracker immediately
        onJobCreated({
          id: jobId, type: 'preview',
          transformation: savedName, source: savedSource || 'N/A',
          status: 'PROCESSING', submittedAt: new Date().toISOString(),
        })
      } catch (err) {
        setBanner({ type: 'error', text: `Error: ${err.message}` })
      }
      setSubmitting(false)
    }

  async function handlePublishReviewed() {
    setPublishing(true)
    setBanner(null)
    try {
      // Upload the edited definition back to S3
      const normalized = name.trim().toLowerCase().replace(/\s+/g, '-')
      const accountRes = await fetch(`${API_BASE}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'direct', op: 'list_custom' })
      })
      // Save edited definition
      // Use orchestrator to publish (it reads from S3)
      const result = await submitAsync(
        `Publish the transformation "${normalized}" with description "${description.trim() || name.trim()}" to the ATX registry. The definition is already in S3.`
      )
      if (result.request_id) {
        onJobCreated({
          id: result.request_id, type: 'create',
          transformation: name.trim(), source: sourceUrl.trim() || 'N/A',
          status: 'PROCESSING', submittedAt: new Date().toISOString(),
        })
        setBanner({ type: 'success', text: `Publishing "${name.trim()}" to the ATX registry. Track in Jobs tab.` })
        setReviewMode(false)
        setDefinition('')
        setName(''); setDescription(''); setSourceUrl(''); setRequirements('')
      }
    } catch (err) {
      setBanner({ type: 'error', text: `Publish failed: ${err.message}` })
    }
    setPublishing(false)
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Create Custom Transformation</h2>
      <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
        Define a custom transformation using natural language. The AI generates a transformation definition
        and publishes it to the ATX registry. Once published, it can be executed like any AWS-managed transformation.
      </p>

      {banner && (
        <div className="card" style={{
          borderColor: banner.type === 'success' ? '#3fb950' : '#da3633',
          background: banner.type === 'success' ? '#0c2d1a' : '#3d1114',
          marginBottom: 16,
        }}>
          <p style={{ color: banner.type === 'success' ? '#3fb950' : '#f85149', fontSize: 14 }}>
            {banner.type === 'success' ? '✅' : '❌'} {banner.text}
          </p>
          {banner.requestId && (
            <p style={{ fontSize: 11, color: '#484f58', marginTop: 6, fontFamily: 'monospace' }}>
              Request ID: {banner.requestId}
            </p>
          )}
        </div>
      )}

      {!reviewMode ? (
        <form onSubmit={handleAutoPublish}>
          <div className="card">
            <div className="form-group">
              <label htmlFor="name">Transformation Name</label>
              <input id="name" type="text" placeholder="e.g., add-structured-logging, migrate-flask-to-fastapi"
                value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="description">Description</label>
              <input id="description" type="text" placeholder="Short description of what this transformation does"
                value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="sourceUrl">Source Repository (optional)</label>
              <input id="sourceUrl" type="text" placeholder="https://github.com/user/repo"
                value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
              <p style={{ fontSize: 11, color: '#484f58', marginTop: 4 }}>
                If provided, the repo is cloned and analyzed so the AI generates a definition tailored to the actual code.
              </p>
            </div>
            <div className="form-group">
              <label htmlFor="requirements">Requirements (detailed)</label>
              <textarea id="requirements" rows={5}
                placeholder="Describe in detail what the transformation should do..."
                value={requirements} onChange={e => setRequirements(e.target.value)} required />
            </div>
            <div className="flex gap-8">
              <button className="btn btn-primary" type="submit" disabled={submitting || !name.trim() || !requirements.trim()}>
                {submitting && submitMode === 'publish' ? <><span className="spinner" /> Publishing...</> : 'Create & Publish'}
              </button>
              <button className="btn btn-secondary" type="button" onClick={handleGenerateReview}
                disabled={submitting || !name.trim() || !requirements.trim()}>
                {submitting && submitMode === 'review' ? <><span className="spinner" /> Generating...</> : 'Generate & Review'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="card">
          <div className="flex-between" style={{ marginBottom: 12 }}>
            <span style={{ color: '#c9d1d9', fontSize: 14, fontWeight: 500 }}>
              Review: {name} — transformation_definition.md
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setReviewMode(false)}>← Back</button>
          </div>
          <textarea
            value={definition}
            onChange={e => setDefinition(e.target.value)}
            rows={20}
            style={{
              width: '100%', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5,
              background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d',
              borderRadius: 6, padding: 12, resize: 'vertical',
            }}
          />
          <div className="flex gap-8" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handlePublishReviewed} disabled={publishing}>
              {publishing ? <><span className="spinner" /> Publishing...</> : 'Publish to Registry'}
            </button>
            <button className="btn btn-secondary" onClick={() => setReviewMode(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card mt-16" style={{ background: '#0d1117' }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>How it works</h3>
        <ol style={{ color: '#8b949e', fontSize: 12, lineHeight: 1.8, paddingLeft: 20 }}>
          <li>If a source repo is provided, a Batch job clones and analyzes the code</li>
          <li>AI generates a <code>transformation_definition.md</code> based on your requirements and the code analysis</li>
          <li><strong>Create & Publish</strong>: auto-publishes immediately | <strong>Generate & Review</strong>: lets you edit before publishing</li>
          <li>A Batch job runs <code>atx custom def publish</code> to register it</li>
          <li>Once published, use it like any other transformation</li>
        </ol>
      </div>
    </div>
  )
}
