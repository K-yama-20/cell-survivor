import { PythonWorkerClient } from './python-worker-client'
import { observationDtoSchema, type ObservationDto } from '../shared/contracts'
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

function spikeObservation(
  tick: number,
  enemyIds: readonly number[],
  hp = 100,
): ObservationDto {
  const enemies = enemyIds.map((id, index) => ({
    id,
    kind: 'chaser' as const,
    position: { x: index + 1, y: 0 },
    hp: 10,
    distance: index + 1,
  }))
  return observationDtoSchema.parse({
    tick,
    hp,
    max_hp: 100,
    position: { x: 0, y: 0 },
    enemies,
    nearest_enemy_id: enemies[0]?.id ?? null,
  })
}

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
      const action = await controllerClient.decide(
        spikeObservation((call - 1) * 6, [7]),
      )
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
    const at0 = await continuationClient.boundary(0, spikeObservation(0, [40, 41]))
    const at6 = await continuationClient.boundary(6, spikeObservation(6, [40, 41]))
    const at12 = await continuationClient.boundary(
      12,
      spikeObservation(12, [40, 41]),
    )
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
