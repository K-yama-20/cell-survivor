import { describe, expect, it, vi } from 'vitest'

import type { PythonWorkerResponse } from './protocol'
import { createPythonWorkerHandler } from './worker-handler'

describe('Python Worker protocol boundary', () => {
  it('rejects malformed and non-monotonic requests without loading Python', async () => {
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
      payload: { observation: {} },
    })
    await handle({
      sessionId: 'session-a',
      requestId: 1,
      type: 'boundary',
      payload: { observation: {} },
    })

    expect(loadPyodide).not.toHaveBeenCalled()
    expect(responses.map((response) => response.type)).toEqual([
      'diagnostic',
      'diagnostic',
      'diagnostic',
    ])
    expect(responses.at(-1)?.payload).toMatchObject({
      name: 'NonMonotonicRequestId',
    })
  })
})
