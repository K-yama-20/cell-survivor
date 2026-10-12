import type { PyodideInterface } from 'pyodide'

import {
  type Action,
  type PythonBoundaryResult,
  type PythonExecutionConfig,
  type PythonFiles,
} from './protocol'
import {
  NO_ACTION,
  observationDtoSchema,
  validateActionDto,
  type ObservationDto,
  type WorkerDiagnostic,
} from '../shared/contracts'
import {
  microgameModuleSource,
  pythonBootstrapSource,
  pythonBudgetRuntimeSource,
  pythonControllerBoundarySource,
} from './python-sources'

type PyValue = Readonly<{
  toJs: (options?: { dict_converter?: typeof Object.fromEntries }) => unknown
  destroy: () => void
}>

type RuntimeEvent =
  | Readonly<{
      type: 'yield'
      reason: 'action' | 'wait'
      resumeTick: number
      budgetUsed: number
    }>
  | Readonly<{ type: 'return' }>
  | Readonly<{ type: 'error'; error: unknown }>

type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve: (value: T) => void
}>

const projectDirectory = '/home/pyodide/project'
const decisionIntervalTicks = 6
const emptyObservation: ObservationDto = observationDtoSchema.parse({
  tick: 0,
  hp: 1,
  max_hp: 1,
  position: { x: 0, y: 0 },
  enemies: [],
  nearest_enemy_id: null,
})

export function nextPythonBoundaryTick(currentTick: number, waitTicks: number): number {
  return (
    decisionIntervalTicks *
    Math.ceil((currentTick + waitTicks) / decisionIntervalTicks)
  )
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => {
      if (resolvePromise === undefined) throw new Error('Deferred is not initialized')
      resolvePromise(value)
    },
  }
}

function isPyValue(value: unknown): value is PyValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toJs' in value &&
    typeof value.toJs === 'function' &&
    'destroy' in value &&
    typeof value.destroy === 'function'
  )
}

function toPlainValue(value: unknown): unknown {
  if (!isPyValue(value)) return value
  try {
    return value.toJs({ dict_converter: Object.fromEntries })
  } finally {
    value.destroy()
  }
}

function contextJson(
  tick: number,
  observation: ObservationDto,
): string {
  return JSON.stringify({ tick, observation: { ...observation, tick } })
}

export class PythonRuntime {
  readonly #pyodide: PyodideInterface
  #initialized = false
  #started = false
  #finished = false
  #controllerRegistered = false
  #controllerExecuting = false
  #currentTick = 0
  #currentObservation: ObservationDto = emptyObservation
  #lastAction: Action = NO_ACTION
  #boundaryDiagnostics: WorkerDiagnostic[] = []
  #resumeTick: number | null = null
  #resume: ((context: string) => void) | undefined
  #event: Deferred<RuntimeEvent> | undefined

  constructor(pyodide: PyodideInterface) {
    this.#pyodide = pyodide
  }

  get version(): string {
    return this.#pyodide.version
  }

  initialize(files: PythonFiles, config: PythonExecutionConfig): void {
    if (this.#initialized) throw new Error('Python runtime is already initialized')
    if (!Object.hasOwn(files, 'main.py')) throw new Error('main.py is required')
    if (Object.hasOwn(files, 'microgame.py') || Object.hasOwn(files, '_microgame_runtime.py')) {
      throw new Error('microgame.py and _microgame_runtime.py are reserved modules')
    }

    this.#pyodide.FS.mkdirTree(projectDirectory)
    for (const [fileName, source] of Object.entries(files)) {
      this.#pyodide.FS.writeFile(`${projectDirectory}/${fileName}`, source)
    }
    this.#pyodide.FS.writeFile(
      `${projectDirectory}/_microgame_runtime.py`,
      pythonBudgetRuntimeSource,
    )
    this.#pyodide.FS.writeFile(`${projectDirectory}/microgame.py`, microgameModuleSource)

    this.#pyodide.registerJsModule('microgame_bridge', {
      action_allowed: () => !this.#controllerRegistered,
      register_controller: () => {
        this.#controllerRegistered = true
      },
      wait_allowed: () => !this.#controllerExecuting,
      suspend: (
        kind: unknown,
        actionJson: unknown,
        ticks: unknown,
        budgetUsed: unknown,
      ) => this.#suspend(kind, actionJson, ticks, budgetUsed),
    })

    this.#pyodide.runPython(
      `
import sys
_microgame_project_dir = ${JSON.stringify(projectDirectory)}
if _microgame_project_dir not in sys.path:
    sys.path.insert(0, _microgame_project_dir)
import _microgame_runtime
_microgame_runtime.configure(${config.executionBudget})
`,
      { filename: 'microgame_setup.py' },
    )
    this.#pyodide.globals.set('_microgame_source', files['main.py'])
    this.#initialized = true
  }

  async boundary(
    tick: number,
    observation: ObservationDto,
  ): Promise<PythonBoundaryResult> {
    if (!this.#initialized) throw new Error('Python runtime is not initialized')
    if (tick % decisionIntervalTicks !== 0) {
      throw new Error(`Python boundaries must be multiples of ${decisionIntervalTicks}`)
    }
    if (this.#started && tick < this.#currentTick) {
      throw new Error('Python boundary ticks must be monotonic')
    }

    const parsedObservation = observationDtoSchema.parse(observation)
    if (parsedObservation.tick !== tick) {
      throw new Error('Python boundary tick must match ObservationDTO.tick')
    }

    this.#currentTick = tick
    this.#currentObservation = parsedObservation
    this.#boundaryDiagnostics = []

    let manualEvent: RuntimeEvent | undefined
    if (!this.#started) {
      manualEvent = await this.#startProgram()
    } else if (!this.#finished && this.#resume !== undefined) {
      if (this.#resumeTick !== null && tick >= this.#resumeTick) {
        manualEvent = await this.#resumeProgram()
      }
    }

    if (manualEvent?.type === 'error') throw manualEvent.error

    if (this.#controllerRegistered) {
      return this.#runController()
    }

    if (manualEvent?.type === 'yield') {
      return {
        action: this.#lastAction,
        mode: 'manual',
        yieldReason: manualEvent.reason,
        resumeTick: manualEvent.resumeTick,
        budgetUsed: manualEvent.budgetUsed,
        diagnostics: this.#boundaryDiagnostics,
      }
    }

    return {
      action: this.#lastAction,
      mode: 'manual',
      yieldReason: this.#finished ? 'return' : 'waiting',
      resumeTick: this.#resumeTick,
      budgetUsed: 0,
      diagnostics: this.#boundaryDiagnostics,
    }
  }

  async #startProgram(): Promise<RuntimeEvent> {
    this.#started = true
    const event = this.#prepareEvent()
    this.#pyodide.globals.set(
      '_microgame_initial_context_json',
      contextJson(this.#currentTick, this.#currentObservation),
    )
    void this.#pyodide
      .runPythonAsync(pythonBootstrapSource, { filename: 'microgame_bootstrap.py' })
      .then(() => {
        this.#finished = true
        this.#resume = undefined
        this.#resumeTick = null
        this.#emit({ type: 'return' })
      })
      .catch((error: unknown) => {
        this.#finished = true
        this.#resume = undefined
        this.#resumeTick = null
        this.#emit({ type: 'error', error })
      })
    return event.promise
  }

  async #resumeProgram(): Promise<RuntimeEvent> {
    const event = this.#prepareEvent()
    const resume = this.#resume
    if (resume === undefined) throw new Error('Python program is not suspended')
    this.#resume = undefined
    this.#resumeTick = null
    resume(contextJson(this.#currentTick, this.#currentObservation))
    return event.promise
  }

  async #runController(): Promise<PythonBoundaryResult> {
    this.#pyodide.globals.set(
      '_microgame_boundary_context_json',
      contextJson(this.#currentTick, this.#currentObservation),
    )
    this.#controllerExecuting = true
    let rawResult: unknown
    try {
      rawResult = toPlainValue(
        await this.#pyodide.runPythonAsync(pythonControllerBoundarySource, {
          filename: 'microgame_boundary.py',
        }),
      )
    } finally {
      this.#controllerExecuting = false
      if (!this.#finished && this.#resume !== undefined) {
        this.#pyodide.runPython(
          'import _microgame_runtime; _microgame_runtime.enable_budget()',
          { filename: 'microgame_resume_trace.py' },
        )
      }
    }
    if (typeof rawResult !== 'string') {
      throw new Error('Controller boundary did not return JSON')
    }
    const parsed = JSON.parse(rawResult) as {
      actionJson: unknown
      budgetUsed: unknown
    }
    const actionValue =
      typeof parsed.actionJson === 'string'
        ? this.#parseActionJson(parsed.actionJson)
        : null
    this.#setAction(actionValue)
    if (!Number.isInteger(parsed.budgetUsed) || Number(parsed.budgetUsed) < 0) {
      throw new Error('Controller returned an invalid budget count')
    }
    return {
      action: this.#lastAction,
      mode: 'controller',
      yieldReason: 'decision',
      resumeTick: this.#resumeTick,
      budgetUsed: Number(parsed.budgetUsed),
      diagnostics: this.#boundaryDiagnostics,
    }
  }

  #suspend(
    kind: unknown,
    actionJson: unknown,
    ticks: unknown,
    budgetUsed: unknown,
  ): Promise<string> {
    if (this.#resume !== undefined) throw new Error('Python program is already suspended')
    if (kind !== 'action' && kind !== 'wait') throw new Error('Invalid suspension kind')
    if (!Number.isInteger(ticks) || Number(ticks) <= 0) {
      throw new Error('Suspension ticks must be a positive integer')
    }
    if (!Number.isInteger(budgetUsed) || Number(budgetUsed) < 0) {
      throw new Error('Invalid Python execution budget count')
    }
    if (kind === 'action') {
      if (typeof actionJson !== 'string') throw new Error('Action payload must be JSON')
      this.#setAction(this.#parseActionJson(actionJson))
    }

    const nextTick = nextPythonBoundaryTick(this.#currentTick, Number(ticks))
    this.#resumeTick = nextTick
    const suspension = new Promise<string>((resolve) => {
      this.#resume = resolve
    })
    this.#emit({
      type: 'yield',
      reason: kind,
      resumeTick: nextTick,
      budgetUsed: Number(budgetUsed),
    })
    return suspension
  }

  #parseActionJson(actionJson: string): unknown {
    try {
      return JSON.parse(actionJson)
    } catch {
      return null
    }
  }

  #setAction(value: unknown): void {
    const result = validateActionDto(value, this.#currentObservation)
    this.#lastAction = result.action
    this.#boundaryDiagnostics.push(...result.diagnostics)
  }

  #prepareEvent(): Deferred<RuntimeEvent> {
    if (this.#event !== undefined) throw new Error('Python runtime event already pending')
    const event = deferred<RuntimeEvent>()
    this.#event = event
    return event
  }

  #emit(event: RuntimeEvent): void {
    const pending = this.#event
    if (pending === undefined) throw new Error('Python runtime emitted an unexpected event')
    this.#event = undefined
    pending.resolve(event)
  }
}
