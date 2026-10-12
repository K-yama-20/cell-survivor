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
      code: 'PYTHON_EXCEPTION',
      severity: 'error',
      name: 'RuntimeError',
      message: 'deliberate failure',
      fileName: 'main.py',
      lineNumber: 12,
    })
  })

  it('preserves execution-budget diagnostics as a single generic stop reason', () => {
    const diagnostic = pythonDiagnosticFromError(
      new Error(`PythonError: Traceback (most recent call last):
  File "main.py", line 3, in <module>
  File "/home/pyodide/project/_microgame_runtime.py", line 29, in consume
ExecutionBudgetExceeded: Python execution budget of 100 trace events was exceeded`),
    )

    expect(diagnostic).toMatchObject({
      kind: 'budget',
      code: 'EXECUTION_BUDGET_EXCEEDED',
      severity: 'error',
      name: 'ExecutionBudgetExceeded',
      message: 'Python execution budget of 100 trace events was exceeded',
    })
  })
})
