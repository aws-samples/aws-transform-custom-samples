import React, { useState, useEffect } from 'react'

export default function TransformationForm({ orchestrate, onJobCreated }) {
  const [transformations, setTransformations] = useState([])
  const [transformation, setTransformation] = useState('')
  const [source, setSource] = useState('')
  const [buildCmd, setBuildCmd] = useState('')
  const [additionalContext, setAdditionalContext] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [response, setResponse] = useState(null)
  const [step, setStep] = useState('')

  // Load transformations dynamically from orchestrator
  // Load transformations dynamically from orchestrator
  useEffect(() => {
    const managed = [
      'AWS/python-version-upgrade',
      'AWS/java-version-upgrade',
      'AWS/nodejs-version-upgrade',
      'AWS/python-boto2-to-boto3',
      'AWS/java-aws-sdk-v1-to-v2',
      'AWS/nodejs-aws-sdk-v2-to-v3',
      'AWS/early-access-comprehensive-codebase-analysis',
      'AWS/early-access-java-x86-to-graviton',
      'AWS/early-access-angular-to-react-migration',
      'AWS/early-access-jfr-performance-optimization',
    ]
    setTransformations(managed)
    // Load published custom transforms
    async function loadCustom() {
      try {
        const API = import.meta.env.VITE_API_ENDPOINT || '/api'
        const res = await fetch(`${API}/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'direct', op: 'list_custom' })
        })
        const data = await res.json()
        const published = (data.customs || []).filter(c => c.status === 'published').map(c => c.name)
        if (published.length > 0) setTransformations([...published, ...managed])
      } catch {}
    }
    loadCustom()
    setLoadingList(false)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!source.trim() || !transformation) return
    setLoading(true)
    setResponse(null)
    setStep('')

    const configParts = []
    if (buildCmd.trim()) configParts.push(`buildCommand=${buildCmd.trim()}`)
    if (additionalContext.trim()) configParts.push(`additionalPlanContext=${additionalContext.trim()}`)
    const configStr = configParts.length > 0 ? ` Configuration: ${configParts.join(', ')}.` : ''

    try {
      const result = await orchestrate(
        `Execute the ${transformation} transformation on this repository: ${source.trim()}.${configStr}`,
        { onStep: setStep }
      )

      const jobIdMatch = result.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (jobIdMatch) {
        onJobCreated({
          id: jobIdMatch[0],
          transformation,
          source: source.trim(),
          status: 'SUBMITTED',
          submittedAt: new Date().toISOString(),
        })
        // Clear form and show success
        setSource('')
        setBuildCmd('')
        setAdditionalContext('')
        setTransformation('')
        setResponse({ success: true, jobId: jobIdMatch[0], transformation, text: result })
      } else {
        setResponse({ text: result })
      }
    } catch (err) {
      setResponse({ error: err.message })
    }
    setLoading(false)
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Execute Transformation</h2>
      <form onSubmit={handleSubmit}>
        <div className="card">
          <div className="form-group">
            <label htmlFor="transformation">Transformation</label>
            {loadingList ? (
              <div style={{ padding: '10px 0' }}><span className="spinner" /><span className="loading-text" style={{ marginLeft: 8 }}>Loading transformations...</span></div>
            ) : (
              <select id="transformation" value={transformation} onChange={e => setTransformation(e.target.value)}>
                <option value="">Select a transformation...</option>
                {transformations.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="source">Source Repository (GitHub URL or S3 path)</label>
            <input id="source" type="text" placeholder="https://github.com/user/repo or s3://bucket/path/to/source" value={source} onChange={e => setSource(e.target.value)} required />
          </div>
          <div className="flex gap-16">
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="buildCmd">Build / Validation Command</label>
              <input id="buildCmd" type="text" placeholder="pytest, mvn clean install, npm test" value={buildCmd} onChange={e => setBuildCmd(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="context">Additional Context</label>
              <input id="context" type="text" placeholder="Target Python 3.13, Target Java 21" value={additionalContext} onChange={e => setAdditionalContext(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading || !source.trim() || !transformation}>
            {loading ? <><span className="spinner" /> {step || 'Submitting...'}</> : 'Execute Transformation'}
          </button>
        </div>
      </form>
      {response && (
        <div className="card mt-16" style={{ borderColor: response.success ? '#3fb950' : response.error ? '#da3633' : '#21262d', background: response.success ? '#0c2d1a' : undefined }}>
          {response.error ? (
            <p style={{ color: '#f85149' }}>Error: {response.error}</p>
          ) : response.success ? (
            <>
              <p style={{ color: '#3fb950', fontSize: 14, marginBottom: 8 }}>
                ✅ Job submitted successfully
              </p>
              <p style={{ fontSize: 13, color: '#c9d1d9' }}>
                Transformation: {response.transformation}<br />
                Job ID: <code style={{ color: '#79c0ff' }}>{response.jobId}</code>
              </p>
              <p style={{ fontSize: 12, color: '#8b949e', marginTop: 8 }}>
                Track progress in the Jobs tab. Typically takes 10-25 minutes.
              </p>
            </>
          ) : (
            <div className="response-box">{response.text}</div>
          )}
        </div>
      )}
    </div>
  )
}
