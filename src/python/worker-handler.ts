import type { PyodideInterface } from 'pyodide'

import { pythonDiagnosticFromError, runtimeDiagnosticFromError } from './diagnostics'
import {
  pythonWorkerRequestSchema,
  type PythonDiagnostic,
  type PythonWorkerResponse,
} from './protocol'
import { PythonControllerRuntime } from './python-runtime'

type LoadPyodide = (options: {
  indexURL: string
  stdout: (message: string) => void
  stderr: (message: string) => void
}) => Promise<PyodideInterface>

type HandlerOptions = Readonly<{
  loadPyodide: LoadPyodide
  postMessage: (response: PythonWorkerResponse) => void
  close: () => void
  now?: () => number
}>

type EnvelopeIdentity = Readonly<{ sessionId: string; requestId: number }>

function readEnvelopeIdentity(value: unknown): EnvelopeIdentity {
  if (typeof value !== 'object' || value === null) {
    return { sessionId: 'invalid', requestId: 0 }
  }
  const candidate = value as { sessionId?: unknown; requestId?: unknown }
  return {
    sessionId:
      typeof candidate.sessionId === 'string' && candidate.sessionId.length > 0
        ? candidate.sessionId
        : 'invalid',
    requestId:
      typeof candidate.requestId === 'number' &&
      Number.isInteger(candidate.requestId) &&
      candidate.requestId >= 0
        ? candidate.requestId
        : 0,
  }
}

function diagnosticForExecution(error: unknown): PythonDiagnostic {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Traceback') || message.includes('File "')
    ? pythonDiagnosticFromError(error)
    : runtimeDiagnosticFromError(error)
}

export function createPythonWorkerHandler(options: HandlerOptions) {
  const now = options.now ?? (() => performance.now())
  let runtime: PythonControllerRuntime | undefined
  let activeSessionId: string | undefined
  let lastRequestId = -1
  let terminated = false

  function postDiagnostic(
    identity: EnvelopeIdentity,
    diagnostic: PythonDiagnostic,
  ): void {
    options.postMessage({
      ...identity,
      type: 'diagnostic',
      payload: diagnostic,
    })
  }

  return async function handleMessage(rawRequest: unknown): Promise<void> {
    const identity = readEnvelopeIdentity(rawRequest)
    const parsed = pythonWorkerRequestSchema.safeParse(rawRequest)
    if (!parsed.success) {
      postDiagnostic(identity, {
        kind: 'protocol',
        name: 'InvalidWorkerRequest',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      })
      return
    }

    const request = parsed.data
    if (terminated) {
      postDiagnostic(identity, {
        kind: 'protocol',
        name: 'WorkerTerminated',
        message: 'The Python Worker has already terminated',
      })
      return
    }
    if (activeSessionId !== undefined && request.sessionId !== activeSessionId) {
      postDiagnostic(identity, {
        kind: 'protocol',
        name: 'SessionMismatch',
        message: 'Worker messages must use the initialized sessionId',
      })
      return
    }
    if (request.requestId <= lastRequestId) {
      postDiagnostic(identity, {
        kind: 'protocol',
        name: 'NonMonotonicRequestId',
        message: 'requestId must increase monotonically',
      })
      return
    }

    activeSessionId = request.sessionId
    lastRequestId = request.requestId

    try {
      if (request.type === 'initialize') {
        if (runtime !== undefined) throw new Error('Worker is already initialized')
        const startedAt = now()
        const pyodide = await options.loadPyodide({
          indexURL: request.payload.runtimeBaseUrl,
          stdout: () => undefined,
          stderr: () => undefined,
        })
        runtime = new PythonControllerRuntime(pyodide)
        runtime.initialize(request.payload.files)
        options.postMessage({
          ...identity,
          type: 'initialized',
          payload: {
            pyodideVersion: runtime.version,
            loadTimeMs: now() - startedAt,
          },
        })
        return
      }

      if (request.type === 'terminate') {
        terminated = true
        options.postMessage({ ...identity, type: 'terminated', payload: {} })
        options.close()
        return
      }

      if (runtime === undefined) throw new Error('Worker is not initialized')

      if (request.type === 'boundary') {
        options.postMessage({
          ...identity,
          type: 'boundary-result',
          payload: { action: runtime.decide(request.payload.observation) },
        })
      }
    } catch (error) {
      postDiagnostic(identity, diagnosticForExecution(error))
    }
  }
}
