import { useState, useRef, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_ENDPOINT || '/api'

export default function Chat({ orchestrate, jobs }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! I can help you understand your transformation jobs. Ask me about job status, why a job failed, what changed in the results, or anything about available transformations. To create or execute transformations, use the dedicated tabs above.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState('')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)

    try {
      // Build context from selected job
      let context = 'IMPORTANT: You are in read-only chat mode. You can check job status, analyze results, explain failures, and answer questions about transformations. Do NOT create new transformations, execute transformations, or submit any jobs. If the user asks to create or execute, tell them to use the Create Custom or Execute tabs instead. '
      if (selectedJob) {
        const job = jobs.find(j => j.id === selectedJob)
        if (job) {
          context = `Context: Job ${job.id} (${job.transformation} on ${job.source}, status: ${job.status}, type: ${job.type || 'execution'}). `
          if (job.type === 'preview' || job.type === 'create') {
            context += 'This is an orchestrator request (not a Batch job). Do not try to check Batch status for this ID. '
          }

          // If job succeeded, try to get result file list
          if (job.status === 'SUCCEEDED' && job.type !== 'create') {
            try {
              const res = await fetch(`${API_BASE}/orchestrate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'direct', op: 'results', job_id: job.id })
              })
              const data = await res.json()
              if (data.files && data.files.length > 0) {
                const fileList = data.files.slice(0, 20).map(f => f.name || f.key.split('/').pop()).join(', ')
                context += `Result files: ${fileList}. Results at: ${data.results_location}. `
              }
            } catch {}
          }
        }
      }

      const prompt = context
        ? `${context}\n\nUser question: ${userMsg}`
        : userMsg

      // Retry up to 3 times on transient Strands streaming errors
      let result
      let lastErr
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await orchestrate(prompt)
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          if (!err.message || !err.message.includes('concatenate')) {
            break  // Non-retryable error
          }
        }
      }
      if (lastErr) throw lastErr
      // Clean up raw error responses
      if (result && result.includes('"statusCode":500')) {
        try {
          const parsed = JSON.parse(result)
          if (parsed.body) {
            const body = JSON.parse(parsed.body)
            if (body.error) {
              result = `I encountered an issue processing your request. Please try again. (${body.error})`
            }
          }
        } catch {}
      }
      setMessages(prev => [...prev, { role: 'assistant', text: result }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err.message}` }])
    }
    setLoading(false)
  }

  const activeJobs = jobs.filter(j => j.id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)', minHeight: 400 }}>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 18 }}>Chat</h2>
        <select value={selectedJob} onChange={e => setSelectedJob(e.target.value)}
          style={{ width: 'auto', minWidth: 200, fontSize: 12 }}>
          <option value="">No job context (general chat)</option>
          {activeJobs.map(j => (
            <option key={j.id} value={j.id}>
              {j.id.slice(0, 8)}... {j.transformation} ({j.status})
            </option>
          ))}
        </select>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', background: '#0d1117',
        borderRadius: 8, border: '1px solid #21262d', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
            background: msg.role === 'user' ? '#1f3a5f' : '#161b22',
            border: `1px solid ${msg.role === 'user' ? '#1f4a7f' : '#30363d'}`,
            borderRadius: 8, padding: '10px 14px',
          }}>
            <p style={{
              fontSize: 13, lineHeight: 1.6, color: '#c9d1d9',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
            }}>
              {msg.text}
            </p>
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', padding: '10px 14px' }}>
            <span className="spinner" /><span className="loading-text" style={{ marginLeft: 8 }}>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={selectedJob ? 'Ask about this job...' : 'Ask about transformations, jobs, or results...'}
          style={{ flex: 1 }}
          disabled={loading}
        />
        <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>

      {selectedJob && (
        <p style={{ fontSize: 11, color: '#484f58', marginTop: 6 }}>
          Chatting about job {selectedJob.slice(0, 8)}... The AI has access to job details and result files.
        </p>
      )}
    </div>
  )
}
