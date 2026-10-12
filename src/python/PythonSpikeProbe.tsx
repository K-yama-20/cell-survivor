import { useEffect, useState } from 'react'

import { PythonWorkerDiagnosticError } from './python-worker-client'
import { runPythonWorkerSpike, type PythonSpikeResult } from './run-spike'

type ProbeState =
  | Readonly<{ status: 'running' }>
  | Readonly<{ status: 'passed'; result: PythonSpikeResult }>
  | Readonly<{ status: 'failed'; message: string }>

export function PythonSpikeProbe() {
  const [state, setState] = useState<ProbeState>({ status: 'running' })

  useEffect(() => {
    let active = true
    void runPythonWorkerSpike()
      .then((result) => {
        if (active) setState({ status: 'passed', result })
      })
      .catch((error: unknown) => {
        if (!active) return
        if (error instanceof PythonWorkerDiagnosticError) {
          const location = error.diagnostic.fileName
            ? ` (${error.diagnostic.fileName}:${error.diagnostic.lineNumber ?? '?'})`
            : ''
          setState({ status: 'failed', message: `${error.message}${location}` })
          return
        }
        setState({
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <section className="python-spike-probe overlay-interactive" aria-live="polite">
      <strong>Offline Python Worker Spike</strong>
      {state.status === 'running' && <p data-status="running">Pyodideを起動しています…</p>}
      {state.status === 'passed' && (
        <p data-status="passed">
          PASS — Pyodide {state.result.pyodideVersion} / {state.result.callCount} calls / load{' '}
          {state.result.loadTimeMs.toFixed(0)} ms / boundaries{' '}
          {state.result.boundaryTimeMs.toFixed(0)} ms / continuation{' '}
          {state.result.continuationBoundaries} boundaries
        </p>
      )}
      {state.status === 'failed' && <p data-status="failed">FAIL — {state.message}</p>}
    </section>
  )
}
