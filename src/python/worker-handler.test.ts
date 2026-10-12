import { describe, expect, it, vi } from 'vitest'
import type { PyodideInterface } from 'pyodide'

import { createEmptyObservationDto } from '../shared/contracts'
import type { PythonWorkerResponse } from './protocol'
import { createPythonWorkerHandler } from './worker-handler'

describe('Python Worker protocol boundary', () => {
  it('rejects malformed and pre-initialization requests without loading Python', async () => {
    const responses: PythonWorkerResponse[] = []
    const loadPyodide = vi.fn()
    const handle = createPythonWorkerHandler({
      loadPyodide,
      postMessage: (response) => responses.push(response),
      close: vi.fn(),
    })

    await handle({ sessionId: '', requestId: -1, type: 'boundary', payload: {} })
    await handle({
      sessionId: 'session-a',
      requestId: 2,
      type: 'boundary',
      payload: { tick: 0, observation: createEmptyObservationDto(0) },
    })
    await handle({
      sessionId: 'session-a',
      requestId: 0,
      type: 'boundary',
      payload: { tick: 0, observation: createEmptyObservationDto(0) },
    })

    expect(loadPyodide).not.toHaveBeenCalled()
    expect(responses.map((response) => response.type)).toEqual([
      'diagnostic',
      'diagnostic',
      'diagnostic',
    ])
    expect(responses.map((response) => response.payload)).toMatchObject([
      { code: 'INVALID_WORKER_REQUEST' },
      { code: 'WORKER_NOT_INITIALIZED' },
      { code: 'INVALID_WORKER_REQUEST' },
    ])
  })

  it('rejects stale sessions and non-monotonic request ids after initialization', async () => {
    const responses: PythonWorkerResponse[] = []
    const pyodide = {
      version: 'test',
      FS: { mkdirTree: vi.fn(), writeFile: vi.fn() },
      globals: { set: vi.fn() },
      registerJsModule: vi.fn(),
      runPython: vi.fn(),
    } as unknown as PyodideInterface
    const handle = createPythonWorkerHandler({
      loadPyodide: async () => pyodide,
      postMessage: (response) => responses.push(response),
      close: vi.fn(),
      now: () => 0,
    })

    await handle({
      sessionId: 'session-a',
      requestId: 1,
      type: 'initialize',
      payload: {
        runtimeBaseUrl: 'https://unused.invalid/pyodide/',
        files: { 'main.py': 'pass' },
        config: { executionBudget: 100 },
      },
    })
    await handle({
      sessionId: 'session-old',
      requestId: 2,
      type: 'terminate',
      payload: {},
    })
    await handle({
      sessionId: 'session-a',
      requestId: 1,
      type: 'terminate',
      payload: {},
    })

    expect(responses.map((response) => response.type)).toEqual([
      'initialized',
      'diagnostic',
      'diagnostic',
    ])
    expect(responses[1]?.payload).toMatchObject({ code: 'SESSION_MISMATCH' })
    expect(responses[2]?.payload).toMatchObject({
      code: 'NON_MONOTONIC_REQUEST_ID',
    })
  })
})
