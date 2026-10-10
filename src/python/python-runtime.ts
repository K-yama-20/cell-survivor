import type { PyodideInterface } from 'pyodide'

import { actionSchema, type Action, type PythonFiles } from './protocol'

type PyValue = Readonly<{
  toJs: (options?: { dict_converter?: typeof Object.fromEntries }) => unknown
  destroy: () => void
}>

const projectDirectory = '/home/pyodide/project'

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

export class PythonControllerRuntime {
  readonly #pyodide: PyodideInterface
  #initialized = false

  constructor(pyodide: PyodideInterface) {
    this.#pyodide = pyodide
  }

  get version(): string {
    return this.#pyodide.version
  }

  initialize(files: PythonFiles): void {
    if (this.#initialized) throw new Error('Python controller is already initialized')
    if (!Object.hasOwn(files, 'main.py')) throw new Error('main.py is required')

    this.#pyodide.FS.mkdirTree(projectDirectory)
    for (const [fileName, source] of Object.entries(files)) {
      this.#pyodide.FS.writeFile(`${projectDirectory}/${fileName}`, source)
    }

    this.#pyodide.runPython(
      `
import sys

_microgame_project_dir = ${JSON.stringify(projectDirectory)}
if _microgame_project_dir not in sys.path:
    sys.path.insert(0, _microgame_project_dir)

_microgame_namespace = {"__name__": "__main__", "__file__": "main.py"}
with open(_microgame_project_dir + "/main.py", "r", encoding="utf-8") as _entry:
    _microgame_source = _entry.read()
exec(compile(_microgame_source, "main.py", "exec"), _microgame_namespace)

_microgame_candidate = _microgame_namespace.get(
    "controller", _microgame_namespace.get("decide")
)
if hasattr(_microgame_candidate, "decide"):
    _microgame_candidate = _microgame_candidate.decide
if not callable(_microgame_candidate):
    raise TypeError("main.py must define decide(state) or controller.decide(state)")

_microgame_decide = _microgame_candidate
`,
      { filename: 'microgame_bootstrap.py' },
    )
    this.#initialized = true
  }

  decide(observation: Readonly<Record<string, unknown>>): Action {
    if (!this.#initialized) throw new Error('Python controller is not initialized')

    this.#pyodide.globals.set(
      '_microgame_observation_json',
      JSON.stringify(observation),
    )
    const result = this.#pyodide.runPython(
      `
import json
_microgame_decide(json.loads(_microgame_observation_json))
`,
      { filename: 'microgame_boundary.py' },
    )
    return actionSchema.parse(toPlainValue(result))
  }
}
