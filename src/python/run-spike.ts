import { PythonWorkerClient } from './python-worker-client'
import { PYTHON_SPIKE_CALL_COUNT, pythonSpikeFiles } from './spike-program'

export type PythonSpikeResult = Readonly<{
  pyodideVersion: string
  loadTimeMs: number
  boundaryTimeMs: number
  callCount: number
}>

export async function runPythonWorkerSpike(
  client: PythonWorkerClient = new PythonWorkerClient(),
): Promise<PythonSpikeResult> {
  try {
    const initialized = await client.initialize(pythonSpikeFiles)
    const startedAt = performance.now()
    for (let call = 1; call <= PYTHON_SPIKE_CALL_COUNT; call += 1) {
      const action = await client.decide({
        expected_call: call,
        target_enemy_id: 7,
      })
      const expectedMoveX = call % 2 === 1 ? 1 : -1
      if (action.move_x !== expectedMoveX || action.target_enemy_id !== 7) {
        throw new Error(`Unexpected Action at boundary ${call}`)
      }
    }
    return {
      ...initialized,
      boundaryTimeMs: performance.now() - startedAt,
      callCount: PYTHON_SPIKE_CALL_COUNT,
    }
  } finally {
    await client.terminate()
  }
}
