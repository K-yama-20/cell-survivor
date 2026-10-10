import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PythonWorkerClient,
  PythonWorkerWatchdogError,
} from './python-worker-client'

type Listener = (event: MessageEvent<unknown>) => void

class FakeWorker {
  readonly messages: unknown[] = []
  terminated = false
  readonly #listeners = new Map<string, Listener[]>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.#listeners.get(type) ?? []
    listeners.push(listener as Listener)
    this.#listeners.set(type, listeners)
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
    const request = message as {
      sessionId: string
      requestId: number
      type: string
    }
    if (request.type === 'initialize') {
      this.#emit({
        sessionId: request.sessionId,
        requestId: request.requestId,
        type: 'initialized',
        payload: { pyodideVersion: '314.0.7', loadTimeMs: 1 },
      })
    }
  }

  terminate(): void {
    this.terminated = true
  }

  #emit(data: unknown): void {
    const event = { data } as MessageEvent<unknown>
    for (const listener of this.#listeners.get('message') ?? []) listener(event)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Python Worker watchdog and restart', () => {
  it('hard-stops an unresponsive Worker and restores the saved source in a new one', async () => {
    vi.useFakeTimers()
    const workers: FakeWorker[] = []
    const sessionIds = ['session-1', 'session-2']
    const client = new PythonWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker as unknown as Worker
      },
      sessionIdFactory: () => sessionIds.shift() ?? 'unexpected-session',
      watchdogMs: 50,
    })
    const files = { 'main.py': 'while True: pass' }
    await client.initialize(files, 'app://bundle/pyodide/', {
      executionBudget: 100,
    })

    const boundary = client.boundary(0, {})
    const rejected = expect(boundary).rejects.toBeInstanceOf(PythonWorkerWatchdogError)
    await vi.advanceTimersByTimeAsync(50)
    await rejected

    expect(workers[0]?.terminated).toBe(true)
    await client.restart()

    expect(workers).toHaveLength(2)
    expect(workers[1]?.messages[0]).toMatchObject({
      sessionId: 'session-2',
      requestId: 1,
      type: 'initialize',
      payload: { files },
    })
  })
})
