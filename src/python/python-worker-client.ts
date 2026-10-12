import {
  DEFAULT_EXECUTION_BUDGET,
  DEFAULT_WATCHDOG_MS,
  pythonWorkerResponseSchema,
  pythonWorkerRequestSchema,
  type Action,
  type PythonBoundaryResult,
  type PythonDiagnostic,
  type PythonExecutionConfig,
  type PythonFiles,
  type PythonWorkerRequest,
  type PythonWorkerResponse,
} from './protocol'
import {
  observationDtoSchema,
  sessionIdSchema,
  type ObservationDto,
} from '../shared/contracts'

type PendingRequest = Readonly<{
  resolve: (response: PythonWorkerResponse) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}>

type ClientOptions = Readonly<{
  worker?: Worker
  workerFactory?: () => Worker
  sessionIdFactory?: () => string
  watchdogMs?: number
}>

type SavedInitialization = Readonly<{
  files: PythonFiles
  runtimeBaseUrl: string
  config: PythonExecutionConfig
}>

export class PythonWorkerDiagnosticError extends Error {
  readonly diagnostic: PythonDiagnostic

  constructor(diagnostic: PythonDiagnostic) {
    super(diagnostic.message)
    this.name = diagnostic.name
    this.diagnostic = diagnostic
  }
}

export class PythonWorkerWatchdogError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Python Worker did not return control within ${timeoutMs} ms`)
    this.name = 'PythonWatchdogExceeded'
    this.timeoutMs = timeoutMs
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
  readonly #workerFactory: () => Worker
  readonly #sessionIdFactory: () => string
  readonly #watchdogMs: number
  readonly #pending = new Map<number, PendingRequest>()
  #worker: Worker
  #sessionId: string
  #requestId = 0
  #nextTick = 0
  #stopped = false
  #savedInitialization: SavedInitialization | undefined

  constructor(options: ClientOptions = {}) {
    this.#workerFactory = options.workerFactory ?? createWorker
    this.#sessionIdFactory = options.sessionIdFactory ?? (() => crypto.randomUUID())
    this.#watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS
    this.#worker = options.worker ?? this.#workerFactory()
    this.#sessionId = sessionIdSchema.parse(this.#sessionIdFactory())
    this.#attachWorkerListeners()
  }

  async initialize(
    files: PythonFiles,
    runtimeBaseUrl: string = pythonRuntimeBaseUrl(),
    config: PythonExecutionConfig = { executionBudget: DEFAULT_EXECUTION_BUDGET },
  ): Promise<Extract<PythonWorkerResponse, { type: 'initialized' }>['payload']> {
    this.#savedInitialization = {
      files: { ...files },
      runtimeBaseUrl,
      config: { ...config },
    }
    const response = await this.#send({
      type: 'initialize',
      payload: { files, runtimeBaseUrl, config },
    })
    if (response.type !== 'initialized') throw new Error('Unexpected Worker response')
    return response.payload
  }

  async boundary(
    tick: number,
    observation: ObservationDto,
  ): Promise<PythonBoundaryResult> {
    const parsedObservation = observationDtoSchema.parse(observation)
    const response = await this.#send(
      {
        type: 'boundary',
        payload: { tick, observation: parsedObservation },
      },
      this.#watchdogMs,
    )
    if (response.type !== 'boundary-result') {
      throw new Error('Unexpected Worker response')
    }
    return response.payload
  }

  async decide(observation: ObservationDto): Promise<Action> {
    const tick = this.#nextTick
    this.#nextTick += 6
    return (await this.boundary(tick, observation)).action
  }

  stop(): void {
    if (this.#stopped) return
    this.#hardStop(new Error('Python Worker stopped'))
  }

  async restart(): Promise<
    Extract<PythonWorkerResponse, { type: 'initialized' }>['payload']
  > {
    const saved = this.#savedInitialization
    if (saved === undefined) throw new Error('Python Worker has not been initialized')
    if (!this.#stopped) this.#hardStop(new Error('Python Worker restarting'))

    this.#worker = this.#workerFactory()
    this.#sessionId = sessionIdSchema.parse(this.#sessionIdFactory())
    this.#requestId = 0
    this.#nextTick = 0
    this.#stopped = false
    this.#attachWorkerListeners()
    return this.initialize(saved.files, saved.runtimeBaseUrl, saved.config)
  }

  async terminate(): Promise<void> {
    if (this.#stopped) return
    try {
      const response = await this.#send({ type: 'terminate', payload: {} })
      if (response.type !== 'terminated') throw new Error('Unexpected Worker response')
    } finally {
      this.#stopped = true
      this.#worker.terminate()
      this.#rejectAll(new Error('Python Worker terminated'))
    }
  }

  #send(
    request: Omit<PythonWorkerRequest, 'sessionId' | 'requestId'>,
    timeoutMs?: number,
  ): Promise<PythonWorkerResponse> {
    if (this.#stopped) return Promise.reject(new Error('Python Worker is stopped'))
    const requestId = ++this.#requestId
    const message = pythonWorkerRequestSchema.parse({
      ...request,
      sessionId: this.#sessionId,
      requestId,
    })
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              if (!this.#pending.has(requestId)) return
              this.#hardStop(new PythonWorkerWatchdogError(timeoutMs))
            }, timeoutMs)
      this.#pending.set(requestId, { resolve, reject, timer })
      this.#worker.postMessage(message)
    })
  }

  #attachWorkerListeners(): void {
    this.#worker.addEventListener('message', this.#handleMessage)
    this.#worker.addEventListener('error', this.#handleWorkerError)
    this.#worker.addEventListener('messageerror', this.#handleWorkerError)
  }

  readonly #handleMessage = (event: MessageEvent<unknown>): void => {
    if (
      typeof event.data === 'object' &&
      event.data !== null &&
      'sessionId' in event.data &&
      typeof event.data.sessionId === 'string' &&
      event.data.sessionId !== this.#sessionId
    ) {
      return
    }
    const parsed = pythonWorkerResponseSchema.safeParse(event.data)
    if (!parsed.success) {
      this.#hardStop(new Error('Python Worker returned an invalid response'))
      return
    }
    const response = parsed.data
    if (response.sessionId !== this.#sessionId) return
    const pending = this.#pending.get(response.requestId)
    if (pending === undefined) return
    if (pending.timer !== undefined) clearTimeout(pending.timer)
    this.#pending.delete(response.requestId)
    if (response.type === 'diagnostic') {
      pending.reject(new PythonWorkerDiagnosticError(response.payload))
    } else {
      pending.resolve(response)
    }
  }

  readonly #handleWorkerError = (event: ErrorEvent | MessageEvent): void => {
    const message = event instanceof ErrorEvent ? event.message : 'Worker message error'
    this.#hardStop(new Error(message))
  }

  #hardStop(error: Error): void {
    this.#stopped = true
    this.#worker.terminate()
    this.#rejectAll(error)
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}
