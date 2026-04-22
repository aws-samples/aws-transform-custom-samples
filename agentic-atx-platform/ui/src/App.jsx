import React, { useState, useEffect } from 'react'
import TransformationList from './components/TransformationList'
import TransformationForm from './components/TransformationForm'
import CreateCustom from './components/CreateCustom'
import CsvUpload from './components/CsvUpload'
import JobTracker from './components/JobTracker'
import Chat from './components/Chat'

const TABS = ['Transformations', 'Execute', 'Create Custom', 'CSV Batch', 'Jobs', 'Chat']
const API_BASE = import.meta.env.VITE_API_ENDPOINT || '/api'

// Async orchestrator for AI operations
async function orchestrate(prompt, { onStep, pollIntervalMs = 5000, maxPollMs = 300000 } = {}) {
  const submitRes = await fetch(`${API_BASE}/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit', prompt })
  })
  const { request_id } = await submitRes.json()
  if (!request_id) throw new Error('No request_id returned')

  const deadline = Date.now() + maxPollMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs))
    const pollRes = await fetch(`${API_BASE}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'poll', request_id })
    })
    const data = await pollRes.json()
    if (data.status === 'PROCESSING' && data.step && onStep) {
      onStep(data.step)
    }
    if (data.status === 'COMPLETED') {
      const content = data?.result?.result?.content ?? data?.result?.result ?? data?.result
      if (typeof content === 'string') return content
      if (Array.isArray(content)) return content.map(c => c.text).join('\n')
      return JSON.stringify(content)
    }
    if (data.status === 'FAILED') throw new Error(data.error || 'Orchestration failed')
  }
  throw new Error('Orchestration timed out')
}

// Direct calls for fast operations (status, results) - no AI overhead
async function directCall(op, job_id) {
  const res = await fetch(`${API_BASE}/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'direct', op, job_id })
  })
  return res.json()
}

// Fire-and-forget: submit to orchestrator without waiting for result
async function submitAsync(prompt) {
  const res = await fetch(`${API_BASE}/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit', prompt })
  })
  return res.json() // returns { status: 'SUBMITTED', request_id: '...' }
}

export default function App() {
  const [tab, setTab] = useState('Transformations')
  const [jobs, setJobs] = useState([])
  const [jobsLoaded, setJobsLoaded] = useState(false)

  // Load jobs from DynamoDB on mount
  useEffect(() => {
    async function loadJobs() {
      try {
        const res = await fetch(`${API_BASE}/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'direct', op: 'list_jobs' })
        })
        const data = await res.json()
        if (data.jobs) setJobs(data.jobs)
      } catch (e) { console.error('Failed to load jobs:', e) }
      setJobsLoaded(true)
    }
    loadJobs()
  }, [])

  function updateJobs(updater) {
    setJobs(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      return next
    })
  }

  const addJob = (job) => {
    updateJobs(prev => [job, ...prev])
    // Persist to DynamoDB
    fetch(`${API_BASE}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'direct', op: 'save_job', job })
    }).catch(e => console.error('Failed to save job:', e))
  }

  const addJobs = (newJobs) => {
    updateJobs(prev => [...newJobs, ...prev])
    // Persist all to DynamoDB
    newJobs.forEach(job => {
      fetch(`${API_BASE}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'direct', op: 'save_job', job })
      }).catch(e => console.error('Failed to save job:', e))
    })
  }

  return (
    <div className="app">
      <header>
        <h1>ATX Transform</h1>
        <p className="subtitle">AI-Powered Code Transformation Platform</p>
      </header>
      <nav>
        {TABS.map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
            {t === 'Jobs' && jobs.length > 0 && <span className="badge">{jobs.length}</span>}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'Transformations' && <TransformationList orchestrate={orchestrate} />}
        {tab === 'Execute' && <TransformationForm orchestrate={orchestrate} onJobCreated={addJob} />}
        {tab === 'Create Custom' && <CreateCustom submitAsync={submitAsync} onJobCreated={addJob} orchestrate={orchestrate} />}
        {tab === 'CSV Batch' && <CsvUpload orchestrate={orchestrate} onJobsCreated={addJobs} />}
        {tab === 'Jobs' && <JobTracker orchestrate={orchestrate} directCall={directCall} jobs={jobs} setJobs={updateJobs} />}
        {tab === 'Chat' && <Chat orchestrate={orchestrate} jobs={jobs} />}
      </main>
    </div>
  )
}
