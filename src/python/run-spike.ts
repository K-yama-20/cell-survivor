import { PythonWorkerClient } from './python-worker-client'
import {
  PYTHON_SPIKE_CALL_COUNT,
  pythonContinuationSpikeFiles,
  pythonSpikeFiles,
} from './spike-program'

export type PythonSpikeResult = Readonly<{
  pyodideVersion: string
  loadTimeMs: number
  boundaryTimeMs: number
  callCount: number
  continuationBoundaries: number
}>

export async function runPythonWorkerSpike(
  controllerClient: PythonWorkerClient = new PythonWorkerClient(),
  continuationClient: PythonWorkerClient = new PythonWorkerClient(),
): Promise<PythonSpikeResult> {
  let initialized: Awaited<ReturnType<PythonWorkerClient['initialize']>>
  let boundaryTimeMs: number
  try {
    initialized = await controllerClient.initialize(pythonSpikeFiles)
    const startedAt = performance.now()
    for (let call = 1; call <= PYTHON_SPIKE_CALL_COUNT; call += 1) {
      const action = await controllerClient.decide({
        expected_call: call,
        target_enemy_id: 7,
      })
      const expectedMoveX = call % 2 === 1 ? 1 : -1
      if (action.move_x !== expectedMoveX || action.target_enemy_id !== 7) {
        throw new Error(`Unexpected Action at boundary ${call}`)
      }
    }
    boundaryTimeMs = performance.now() - startedAt
  } finally {
    await controllerClient.terminate()
  }

  try {
    await continuationClient.initialize(pythonContinuationSpikeFiles)
    const at0 = await continuationClient.boundary(0, {})
    const at6 = await continuationClient.boundary(6, {})
    const at12 = await continuationClient.boundary(12, {})
    if (
      at0.action.target_enemy_id !== 40 ||
      at0.resumeTick !== 6 ||
      at6.yieldReason !== 'wait' ||
      at6.resumeTick !== 12 ||
      at12.action.target_enemy_id !== 41
    ) {
      throw new Error('Synchronous action/wait continuation did not preserve state')
    }
  } finally {
    await continuationClient.terminate()
  }

  return {
    ...initialized,
    boundaryTimeMs,
    callCount: PYTHON_SPIKE_CALL_COUNT,
    continuationBoundaries: 3,
  }
}
