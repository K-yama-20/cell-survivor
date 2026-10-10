import { describe, expect, it } from 'vitest'

import { pythonDiagnosticFromError } from './diagnostics'

describe('Python diagnostics', () => {
  it('extracts the final user-code file and line from a traceback', () => {
    const diagnostic = pythonDiagnosticFromError(
      new Error(`PythonError: Traceback (most recent call last):
  File "microgame_boundary.py", line 3, in <module>
  File "/home/pyodide/project/main.py", line 12, in decide
RuntimeError: deliberate failure`),
    )

    expect(diagnostic).toMatchObject({
      kind: 'python',
      name: 'RuntimeError',
      message: 'deliberate failure',
      fileName: 'main.py',
      lineNumber: 12,
    })
  })
})
