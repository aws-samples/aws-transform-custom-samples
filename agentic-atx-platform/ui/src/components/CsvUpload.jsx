import React, { useState, useRef } from 'react'
import Papa from 'papaparse'

export default function CsvUpload({ orchestrate, onJobsCreated }) {
  const [rows, setRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [fileName, setFileName] = useState('')
  const [dragover, setDragover] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, step: '' })
  const [banner, setBanner] = useState(null)
  const fileRef = useRef()

  function handleFile(file) {
    if (!file || !file.name.endsWith('.csv')) { alert('Please upload a .csv file'); return }
    setFileName(file.name)
    setBanner(null)
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (result) => { setHeaders(result.meta.fields || []); setRows(result.data) }
    })
  }

  async function submitAll() {
    setSubmitting(true)
    setBanner(null)
    setProgress({ current: 0, total: rows.length })
    const allResults = []

    for (let i = 0; i < rows.length; i++) {
      setProgress({ current: i + 1, total: rows.length, step: '' })
      const row = rows[i]
      const source = row.source?.trim()
      if (!source) { allResults.push({ status: 'ERROR', source: 'missing' }); continue }

      const parts = [`Execute the ${row.transformation?.trim() || 'best matching'} transformation on ${source}.`]
      if (row.validationCommands?.trim()) parts.push(`Configuration: validationCommands=${row.validationCommands.trim()}`)
      if (row.additionalPlanContext?.trim()) {
        if (parts.some(p => p.startsWith('Configuration:'))) {
          parts[parts.length - 1] += `,additionalPlanContext=${row.additionalPlanContext.trim()}`
        } else {
          parts.push(`Configuration: additionalPlanContext=${row.additionalPlanContext.trim()}`)
        }
      }
      if (row.language?.trim()) parts.push(`It's a ${row.language.trim()} application.`)
      if (row.requirements?.trim()) parts.push(`Requirements: ${row.requirements.trim()}.`)
      if (!row.transformation?.trim()) parts.push('Find the best matching transformation and execute it.')

      try {
        const result = await orchestrate(parts.join(' '), {
          onStep: (s) => setProgress(prev => ({ ...prev, step: s }))
        })
        const jobIdMatch = result.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
        // Match AWS-managed transforms (AWS/xxx) or custom transforms (word-word pattern)
        const awsMatch = result.match(/AWS\/[\w-]+/i)
        const customMatch = result.match(/['""`]([a-z][a-z0-9-]{2,})['""`]/i)
        const transformName = awsMatch ? awsMatch[0] :
                              row.transformation?.trim() ||
                              (customMatch ? customMatch[1] : 'AI-determined')
        allResults.push({
          source,
          transformation: transformName,
          status: jobIdMatch ? 'SUBMITTED' : 'PROCESSED',
          jobId: jobIdMatch ? jobIdMatch[0] : null,
        })
      } catch {
        allResults.push({ source, status: 'ERROR', jobId: null })
      }
    }

    const newJobs = allResults.filter(r => r.jobId).map(r => ({
      id: r.jobId, transformation: r.transformation, source: r.source,
      status: 'SUBMITTED', submittedAt: new Date().toISOString(),
    }))
    if (newJobs.length > 0) onJobsCreated(newJobs)

    setRows([]); setHeaders([]); setFileName('')
    if (fileRef.current) fileRef.current.value = ''
    setSubmitting(false)

    const ok = allResults.filter(r => r.jobId).length
    const fail = allResults.filter(r => r.status === 'ERROR').length
    setBanner({
      type: fail === 0 ? 'success' : ok > 0 ? 'warning' : 'error',
      text: `${ok} job${ok !== 1 ? 's' : ''} submitted${fail > 0 ? `, ${fail} failed` : ''}. Track in Jobs tab.`
    })
  }

  const hasSource = headers.includes('source')

  function downloadTemplate() {
    const template = `source,transformation,validationCommands,additionalPlanContext
(required) GitHub or S3 URL of the repository,(optional) e.g. AWS/python-version-upgrade or custom name,(optional) e.g. pytest or mvn clean test,(optional) e.g. Target Python 3.13`
    const blob = new Blob([template], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'batch-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>CSV Batch Upload</h2>
      {banner && (
        <div className="card" style={{
          borderColor: banner.type === 'success' ? '#3fb950' : banner.type === 'warning' ? '#d29922' : '#da3633',
          background: banner.type === 'success' ? '#0c2d1a' : banner.type === 'warning' ? '#2d2200' : '#3d1114',
          marginBottom: 16,
        }}>
          <p style={{ color: banner.type === 'success' ? '#3fb950' : banner.type === 'warning' ? '#d29922' : '#f85149', fontSize: 14 }}>
            {banner.type === 'success' ? '✅' : banner.type === 'warning' ? '⚠️' : '❌'} {banner.text}
          </p>
        </div>
      )}
      {rows.length === 0 ? (
        <div className={`upload-area ${dragover ? 'dragover' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragover(true) }} onDragLeave={() => setDragover(false)}
          onDrop={e => { e.preventDefault(); setDragover(false); handleFile(e.dataTransfer.files[0]) }}
          onClick={() => fileRef.current?.click()} role="button" tabIndex={0}>
          <div className="icon">📄</div>
          <p>Drop a CSV file here or click to browse</p>
          <p style={{ fontSize: 12, marginTop: 8, color: '#484f58' }}>
            Required: source | Optional: transformation, language, requirements, validationCommands, additionalPlanContext
          </p>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            <span style={{ color: '#58a6ff', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={e => { e.stopPropagation(); downloadTemplate() }}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); downloadTemplate() } }}>
              ⬇ Download CSV template
            </span>
          </p>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
        </div>
      ) : (
        <>
          <div className="flex-between mb-16">
            <div>
              <span style={{ color: '#58a6ff' }}>📄 {fileName}</span>
              <span style={{ color: '#8b949e', marginLeft: 12 }}>{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex gap-8">
              <button className="btn btn-secondary btn-sm" onClick={() => { setRows([]); setHeaders([]); setFileName('') }}>Clear</button>
              <button className="btn btn-primary btn-sm" onClick={submitAll} disabled={submitting || !hasSource}>
                {submitting
                  ? <><span className="spinner" /> Processing {progress.current}/{progress.total}{progress.step ? ` — ${progress.step}` : '...'}</>
                  : `Submit All (${rows.length})`}
              </button>
            </div>
          </div>
          {!hasSource && <div className="card" style={{ borderColor: '#da3633' }}><p style={{ color: '#f85149' }}>Missing required column: source</p></div>}
          <div className="csv-preview">
            <h4>Preview</h4>
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th>{headers.map(h => <th key={h}>{h}{h === 'source' && <span style={{ color: '#f85149' }}> *</span>}</th>)}</tr></thead>
                <tbody>{rows.map((row, i) => <tr key={i}><td>{i + 1}</td>{headers.map(h => <td key={h}>{row[h]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
