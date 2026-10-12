// @vitest-environment node

import { loadPyodide } from 'pyodide'
import { describe, expect, it, vi } from 'vitest'

import { observationDtoSchema } from '../shared/contracts'
import type { PythonWorkerResponse } from './protocol'
import { PYTHON_SPIKE_CALL_COUNT, pythonSpikeFiles } from './spike-program'
import { createPythonWorkerHandler } from './worker-handler'

describe('offline Pyodide Worker integration', () => {
  const observation = (tick: number, targetEnemyId: number, hp = 100) =>
    observationDtoSchema.parse({
      tick,
      hp,
      max_hp: 100,
      position: { x: 0, y: 0 },
      enemies: [
        {
          id: targetEnemyId,
          kind: 'chaser',
          position: { x: 10, y: 0 },
          hp: 10,
          distance: 10,
        },
      ],
      nearest_enemy_id: targetEnemyId,
    })

  it(
    'keeps one controller alive for 1000+ boundaries and recovers from Python errors',
    async () => {
      const responses: PythonWorkerResponse[] = []
      const close = vi.fn()
      const handle = createPythonWorkerHandler({
        loadPyodide: () => loadPyodide(),
        postMessage: (response) => responses.push(response),
        close,
      })
      const request = (
        requestId: number,
        type: 'boundary' | 'terminate',
        payload: Record<string, unknown>,
      ) => handle({ sessionId: 'integration', requestId, type, payload })

      await handle({
        sessionId: 'integration',
        requestId: 1,
        type: 'initialize',
        payload: {
          runtimeBaseUrl: 'https://unused.invalid/pyodide/',
          files: pythonSpikeFiles,
        },
      })

      for (let call = 1; call <= PYTHON_SPIKE_CALL_COUNT; call += 1) {
        await request(call + 1, 'boundary', {
          tick: (call - 1) * 6,
          observation: observation((call - 1) * 6, 7),
        })
      }

      await request(PYTHON_SPIKE_CALL_COUNT + 2, 'boundary', {
        tick: PYTHON_SPIKE_CALL_COUNT * 6,
        observation: observation(PYTHON_SPIKE_CALL_COUNT * 6, 7, 0),
      })
      await request(PYTHON_SPIKE_CALL_COUNT + 3, 'boundary', {
        tick: (PYTHON_SPIKE_CALL_COUNT + 1) * 6,
        observation: observation((PYTHON_SPIKE_CALL_COUNT + 1) * 6, 9),
      })
      await request(PYTHON_SPIKE_CALL_COUNT + 4, 'terminate', {})

      const initialized = responses[0]
      const firstAction = responses[1]
      const thousandthAction = responses[1_000]
      const diagnostic = responses.at(-3)
      const recovered = responses.at(-2)

      expect(initialized).toMatchObject({
        type: 'initialized',
        payload: { pyodideVersion: '314.0.7' },
      })
      expect(firstAction).toMatchObject({
        type: 'boundary-result',
        payload: { action: { move_x: 1, target_enemy_id: 7 } },
      })
      expect(thousandthAction).toMatchObject({
        type: 'boundary-result',
        payload: { action: { move_x: -1, target_enemy_id: 7 } },
      })
      expect(diagnostic).toMatchObject({
        type: 'diagnostic',
        payload: {
          kind: 'python',
          code: 'PYTHON_EXCEPTION',
          name: 'RuntimeError',
          message: 'deliberate spike failure',
          fileName: 'main.py',
          lineNumber: expect.any(Number),
        },
      })
      expect(recovered).toMatchObject({
        type: 'boundary-result',
        payload: { action: { move_x: 1, target_enemy_id: 9 } },
      })
      expect(responses.at(-1)?.type).toBe('terminated')
      expect(close).toHaveBeenCalledOnce()
    },
    30_000,
  )
})
