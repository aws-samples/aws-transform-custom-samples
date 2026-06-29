import { useState, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { fetchMetrics, fetchExecutions, rankBy, statusSplit, typeSplit } from '../metricsApi'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const RANGES = [
  { id: '24h', label: 'Last 24h' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
]

const COLORS = {
  blue: '#58a6ff', green: '#3fb950', red: '#f85149',
  purple: '#d2a8ff', orange: '#f0883e', teal: '#39c5cf', gray: '#8b949e', yellow: '#d29922',
}

const gridColor = '#21262d'
const tickColor = '#8b949e'
const baseScales = {
  x: { grid: { color: gridColor }, ticks: { color: tickColor, autoSkip: true } },
  y: { grid: { color: gridColor }, ticks: { color: tickColor }, beginAtZero: true },
}
const legendOpts = { labels: { color: '#c9d1d9', boxWidth: 12, font: { size: 11 } } }

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ margin: 0, padding: 16 }}>
      <p style={{ color: '#8b949e', fontSize: 12, marginBottom: 6 }}>{label}</p>
      <div style={{ fontSize: 26, fontWeight: 600, color: accent || '#e1e4e8' }}>
        {(value ?? 0).toLocaleString()}
      </div>
    </div>
  )
}

export default function Metrics() {
  const [range, setRange] = useState('7d')
  const [data, setData] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchMetrics({ range }), fetchExecutions({ range })])
      .then(([agg, det]) => {
        if (!cancelled) { setData(agg); setDetail(det) }
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range])

  const tc = data?.transformCustom
  const totals = tc?.totals || {}
  const jobs = data?.jobs || {}
  const executions = detail?.executions?.filter(e => e.executionId) || []

  // Job status counts → bar
  const jobStatusChart = {
    labels: ['Succeeded', 'Failed', 'Running', 'Starting', 'Runnable', 'Pending', 'Submitted'],
    datasets: [{
      label: 'Jobs',
      data: [jobs.SUCCEEDED, jobs.FAILED, jobs.RUNNING, jobs.STARTING, jobs.RUNNABLE, jobs.PENDING, jobs.SUBMITTED].map(v => v || 0),
      backgroundColor: [COLORS.green, COLORS.red, COLORS.blue, COLORS.purple, COLORS.teal, COLORS.yellow, COLORS.gray],
    }],
  }

  // Top transformations by completed executions
  const topTransforms = rankBy(tc?.byTransformation, 'TransformationExecutionCompleted')
  const topTransformsChart = {
    labels: topTransforms.map(d => d.key.replace(/^AWS\//, '')),
    datasets: [{ label: 'Completed', data: topTransforms.map(d => d.value), backgroundColor: COLORS.blue }],
  }

  // Agent minutes by transformation
  const minutesByTransform = rankBy(tc?.byTransformation, 'AgentExecutionMinutes')
  const minutesChart = {
    labels: minutesByTransform.map(d => d.key.replace(/^AWS\//, '')),
    datasets: [{ label: 'Agent Minutes', data: minutesByTransform.map(d => d.value), backgroundColor: COLORS.teal }],
  }

  // Top repositories by agent minutes
  const topRepos = rankBy(tc?.byRepository, 'AgentExecutionMinutes')
  const topReposChart = {
    labels: topRepos.map(d => d.key),
    datasets: [{ label: 'Agent Minutes', data: topRepos.map(d => d.value), backgroundColor: COLORS.purple }],
  }

  // Execution status / type doughnuts (from per-execution detail)
  const statusData = statusSplit(executions)
  const statusColorMap = { Success: COLORS.green, Failure: COLORS.red, InProgress: COLORS.blue }
  const statusChart = {
    labels: statusData.map(d => d.key),
    datasets: [{
      data: statusData.map(d => d.value),
      backgroundColor: statusData.map(d => statusColorMap[d.key] || COLORS.gray),
      borderColor: '#161b22', borderWidth: 2,
    }],
  }
  const typeData = typeSplit(executions)
  const typeChart = {
    labels: typeData.map(d => d.key),
    datasets: [{
      data: typeData.map(d => d.value),
      backgroundColor: [COLORS.blue, COLORS.orange, COLORS.gray],
      borderColor: '#161b22', borderWidth: 2,
    }],
  }

  const hasTransformData = topTransforms.length > 0 || minutesByTransform.length > 0

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Metrics</h2>
          <p style={{ color: '#8b949e', fontSize: 13, marginTop: 2 }}>
            From the <code>AWS/TransformCustom</code> CloudWatch namespace.
          </p>
        </div>
        <div className="filter-bar" style={{ margin: 0 }}>
          <select value={range} onChange={e => setRange(e.target.value)}>
            {RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {loading && (
        <div className="card"><span className="spinner" /><span className="loading-text">Loading metrics...</span></div>
      )}

      {error && (
        <div className="card" style={{ borderColor: '#da3633', background: '#3d1114' }}>
          <p style={{ color: '#f85149', fontSize: 14 }}>❌ Failed to load metrics: {error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Summary stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatCard label="Conversations Started" value={totals.ConversationStarted} accent={COLORS.purple} />
            <StatCard label="Executions Started" value={totals.TransformationExecutionStarted} accent={COLORS.blue} />
            <StatCard label="Executions Completed" value={totals.TransformationExecutionCompleted} accent={COLORS.green} />
            <StatCard label="Agent Exec Minutes" value={Math.round(totals.AgentExecutionMinutes || 0)} accent={COLORS.teal} />
            <StatCard label="Unique Conversations" value={tc?.uniqueConversations} />
            <StatCard label="Unique Executions" value={tc?.uniqueExecutions} />
          </div>

          {/* Job status overview */}
          <div className="card">
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>Batch Job Status</h3>
            <div style={{ height: 240 }}>
              <Bar data={jobStatusChart} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } }, scales: baseScales,
              }} />
            </div>
          </div>

          {/* Execution status + type doughnuts */}
          {executions.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card">
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Execution Status</h3>
                <div style={{ height: 240 }}>
                  <Doughnut data={statusChart} options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { ...legendOpts, position: 'bottom' } },
                  }} />
                </div>
              </div>
              <div className="card">
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Execution Type</h3>
                <div style={{ height: 240 }}>
                  <Doughnut data={typeChart} options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { ...legendOpts, position: 'bottom' } },
                  }} />
                </div>
              </div>
            </div>
          )}

          {/* Top transformations + agent minutes */}
          {hasTransformData && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card">
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Top Transformations (completed)</h3>
                <div style={{ height: 260 }}>
                  <Bar data={topTransformsChart} options={{
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } }, scales: baseScales,
                  }} />
                </div>
              </div>
              <div className="card">
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Agent Minutes by Transformation</h3>
                <div style={{ height: 260 }}>
                  <Bar data={minutesChart} options={{
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } }, scales: baseScales,
                  }} />
                </div>
              </div>
            </div>
          )}

          {/* Top repositories */}
          {topRepos.length > 0 && (
            <div className="card">
              <h3 style={{ fontSize: 14, marginBottom: 12 }}>Top Repositories (agent minutes)</h3>
              <div style={{ height: 240 }}>
                <Bar data={topReposChart} options={{
                  indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false } }, scales: baseScales,
                }} />
              </div>
            </div>
          )}

          {/* Code impact (companions of TransformationExecutionCompleted) */}
          <div className="card">
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>Code Impact</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
              <StatCard label="Lines Added" value={totals.LinesAdded} accent={COLORS.green} />
              <StatCard label="Lines Deleted" value={totals.LinesDeleted} accent={COLORS.red} />
              <StatCard label="Lines Modified" value={totals.LinesModified} accent={COLORS.orange} />
              <StatCard label="Files Read" value={totals.FilesRead} accent={COLORS.blue} />
              <StatCard label="Files Modified" value={totals.FilesModified} accent={COLORS.purple} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
