import {
  pythonWorkerResponseSchema,
  type Action,
  type PythonDiagnostic,
  type PythonFiles,
  type PythonWorkerRequest,
  type PythonWorkerResponse,
} from './protocol'

type PendingRequest = Readonly<{
  resolve: (response: PythonWorkerResponse) => void
  reject: (error: Error) => void
}>

export class PythonWorkerDiagnosticError extends Error {
  readonly diagnostic: PythonDiagnostic

  constructor(diagnostic: PythonDiagnostic) {
    super(diagnostic.message)
    this.name = diagnostic.name
    this.diagnostic = diagnostic
  }
}

export function pythonRuntimeBaseUrl(baseUrl: string = document.baseURI): string {
  return new URL('pyodide/', baseUrl).href
}

function createWorker(): Worker {
  return new Worker(new URL('../workers/python.worker.ts', import.meta.url), {
    type: 'module',
    name: 'micro-survivor-python',
  })
}

export class PythonWorkerClient {
  readonly #worker: Worker
  readonly #sessionId: string
  readonly #pending = new Map<number, PendingRequest>()
  #requestId = 0
  #terminated = false

  constructor(options?: Readonly<{ worker?: Worker; sessionId?: string }>) {
    this.#worker = options?.worker ?? createWorker()
    this.#sessionId = options?.sessionId ?? crypto.randomUUID()
    this.#worker.addEventListener('message', this.#handleMessage)
    this.#worker.addEventListener('error', this.#handleWorkerError)
    this.#worker.addEventListener('messageerror', this.#handleWorkerError)
  }

  async initialize(
    files: PythonFiles,
    runtimeBaseUrl: string = pythonRuntimeBaseUrl(),
  ): Promise<Extract<PythonWorkerResponse, { type: 'initialized' }>['payload']> {
    const response = await this.#send({
      type: 'initialize',
      payload: { files, runtimeBaseUrl },
    })
    if (response.type !== 'initialized') throw new Error('Unexpected Worker response')
    return response.payload
  }

  async decide(observation: Readonly<Record<string, unknown>>): Promise<Action> {
    const response = await this.#send({
      type: 'boundary',
      payload: { observation },
    })
    if (response.type !== 'boundary-result') {
      throw new Error('Unexpected Worker response')
    }
    return response.payload.action
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return
    try {
      const response = await this.#send({ type: 'terminate', payload: {} })
      if (response.type !== 'terminated') throw new Error('Unexpected Worker response')
    } finally {
      this.#terminated = true
      this.#worker.terminate()
      this.#rejectAll(new Error('Python Worker terminated'))
    }
  }

  #send(
    request: Omit<PythonWorkerRequest, 'sessionId' | 'requestId'>,
  ): Promise<PythonWorkerResponse> {
    if (this.#terminated) return Promise.reject(new Error('Python Worker terminated'))
    const requestId = ++this.#requestId
    const message = { ...request, sessionId: this.#sessionId, requestId }
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject })
      this.#worker.postMessage(message)
    })
  }

  readonly #handleMessage = (event: MessageEvent<unknown>): void => {
    const parsed = pythonWorkerResponseSchema.safeParse(event.data)
    if (!parsed.success) {
      this.#rejectAll(new Error('Python Worker returned an invalid response'))
      return
    }
    const response = parsed.data
    if (response.sessionId !== this.#sessionId) return
    const pending = this.#pending.get(response.requestId)
    if (pending === undefined) return
    this.#pending.delete(response.requestId)
    if (response.type === 'diagnostic') {
      pending.reject(new PythonWorkerDiagnosticError(response.payload))
    } else {
      pending.resolve(response)
    }
  }

  readonly #handleWorkerError = (event: ErrorEvent | MessageEvent): void => {
    const message = event instanceof ErrorEvent ? event.message : 'Worker message error'
    this.#rejectAll(new Error(message))
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}
