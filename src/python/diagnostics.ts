import type { PythonDiagnostic } from './protocol'

function lastMatch(pattern: RegExp, value: string): RegExpExecArray | undefined {
  let result: RegExpExecArray | null
  let last: RegExpExecArray | undefined
  while ((result = pattern.exec(value)) !== null) last = result
  return last
}

export function pythonDiagnosticFromError(error: unknown): PythonDiagnostic {
  const traceback = error instanceof Error ? error.message : String(error)
  const location = lastMatch(/File "([^"]+)", line (\d+)/g, traceback)
  const exception = lastMatch(/^([A-Za-z_][\w.]*(?:Error|Exception|Exceeded)):\s*(.*)$/gm, traceback)
  const rawFileName = location?.[1]
  const fileName = rawFileName?.split(/[\\/]/).at(-1)

  const name =
    exception?.[1]?.split('.').at(-1) ??
    (error instanceof Error ? error.name : 'PythonError')
  const budgetExceeded = name === 'ExecutionBudgetExceeded'
  const controlModeError = name === 'ControlModeError'

  return {
    kind: budgetExceeded ? 'budget' : 'python',
    code: budgetExceeded
      ? 'EXECUTION_BUDGET_EXCEEDED'
      : controlModeError
        ? 'CONTROL_MODE_ERROR'
        : 'PYTHON_EXCEPTION',
    severity: 'error',
    name,
    message: exception?.[2] || traceback.split('\n').at(-1) || 'Python execution failed',
    traceback,
    ...(fileName ? { fileName } : {}),
    ...(location ? { lineNumber: Number(location[2]) } : {}),
  }
}

export function runtimeDiagnosticFromError(error: unknown): PythonDiagnostic {
  return {
    kind: 'runtime',
    code: 'RUNTIME_ERROR',
    severity: 'error',
    name: error instanceof Error ? error.name : 'RuntimeError',
    message: error instanceof Error ? error.message : String(error),
  }
}
