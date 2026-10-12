// @vitest-environment node

import { loadPyodide } from 'pyodide'
import { describe, expect, it, vi } from 'vitest'

import { observationDtoSchema } from '../shared/contracts'
import type { PythonWorkerResponse } from './protocol'
import { nextPythonBoundaryTick, PythonRuntime } from './python-runtime'
import { createPythonWorkerHandler } from './worker-handler'

describe('synchronous Python continuation spike', () => {
  const observation = (tick: number, enemyIds: readonly number[] = []) => {
    const enemies = enemyIds.map((id, index) => ({
      id,
      kind: 'chaser' as const,
      position: { x: index + 1, y: 0 },
      hp: 10,
      distance: index + 1,
    }))
    return observationDtoSchema.parse({
      tick,
      hp: 100,
      max_hp: 100,
      position: { x: 0, y: 0 },
      enemies,
      nearest_enemy_id: enemies[0]?.id ?? null,
    })
  }

  it('rounds optional waits to the next six-tick decision boundary', () => {
    expect(nextPythonBoundaryTick(0, 1)).toBe(6)
    expect(nextPythonBoundaryTick(0, 6)).toBe(6)
    expect(nextPythonBoundaryTick(0, 7)).toBe(12)
    expect(nextPythonBoundaryTick(6, 7)).toBe(18)
  })

  it(
    'auto-waits after actions and preserves nested locals across rounded wait boundaries',
    async () => {
      const pyodide = await loadPyodide()
      const runtime = new PythonRuntime(pyodide)
      runtime.initialize(
        {
          'main.py': `from microgame import Action, act, attack_nearest, get_state, wait_ticks

def nested_loop():
    frozen_tick = get_state().tick
    total = 0
    for value in range(20):
        total += value
    assert get_state().tick == frozen_tick

    selected = attack_nearest()
    local_target = selected
    wait_ticks(1)

    while True:
        local_target += 1
        act(Action(target_enemy_id=local_target))
        wait_ticks(7)

nested_loop()
`,
        },
        { executionBudget: 5_000 },
      )

      const at0 = await runtime.boundary(0, observation(0, [7, 8, 9]))
      const at6 = await runtime.boundary(6, observation(6, [7, 8, 9]))
      const at12 = await runtime.boundary(12, observation(12, [7, 8, 9]))
      const at18 = await runtime.boundary(18, observation(18, [7, 8, 9]))
      const at24 = await runtime.boundary(24, observation(24, [7, 8, 9]))
      const at30 = await runtime.boundary(30, observation(30, [7, 8, 9]))

      expect(at0).toMatchObject({
        action: { target_enemy_id: 7 },
        mode: 'manual',
        yieldReason: 'action',
        resumeTick: 6,
      })
      expect(at0.budgetUsed).toBeGreaterThan(0)
      expect(at6).toMatchObject({
        action: { target_enemy_id: 7 },
        yieldReason: 'wait',
        resumeTick: 12,
      })
      expect(at6.budgetUsed).toBeGreaterThan(0)
      expect(at12).toMatchObject({
        action: { target_enemy_id: 8 },
        yieldReason: 'action',
        resumeTick: 18,
      })
      expect(at18).toMatchObject({
        action: { target_enemy_id: 8 },
        yieldReason: 'wait',
        resumeTick: 30,
      })
      expect(at24).toMatchObject({
        action: { target_enemy_id: 8 },
        yieldReason: 'waiting',
        resumeTick: 30,
      })
      expect(at30).toMatchObject({
        action: { target_enemy_id: 9 },
        yieldReason: 'action',
        resumeTick: 36,
      })
    },
    30_000,
  )

  it(
    'stops unrelated non-yielding code shapes with one execution-budget diagnostic',
    async () => {
      const responses: PythonWorkerResponse[] = []
      const handle = createPythonWorkerHandler({
        loadPyodide: () => loadPyodide(),
        postMessage: (response) => responses.push(response),
        close: vi.fn(),
      })
      await handle({
        sessionId: 'budget',
        requestId: 1,
        type: 'initialize',
        payload: {
          runtimeBaseUrl: 'https://unused.invalid/pyodide/',
          config: { executionBudget: 200 },
          files: {
            'main.py': `from microgame import wait_ticks

def recurse(value):
    return recurse(value + 1)

def decide(state):
    if state.tick == 0:
        value = 0
        while True:
            value += 1
    if state.tick == 6:
        recurse(0)
    if state.tick == 12:
        sum(value * value for value in range(100000))
    if state.tick == 18:
        wait_ticks(6)
    return {"move_x": 0, "move_y": 0, "target_enemy_id": None}
`,
          },
        },
      })

      for (const index of [0, 1, 2]) {
        await handle({
          sessionId: 'budget',
          requestId: index + 2,
          type: 'boundary',
          payload: { tick: index * 6, observation: observation(index * 6) },
        })
      }
      await handle({
        sessionId: 'budget',
        requestId: 5,
        type: 'boundary',
        payload: { tick: 18, observation: observation(18) },
      })
      await handle({
        sessionId: 'budget',
        requestId: 6,
        type: 'boundary',
        payload: { tick: 24, observation: observation(24) },
      })

      const diagnostics = responses.filter((response) => response.type === 'diagnostic')
      expect(diagnostics).toHaveLength(4)
      for (const diagnostic of diagnostics.slice(0, 3)) {
        expect(diagnostic).toMatchObject({
          payload: {
            kind: 'budget',
            code: 'EXECUTION_BUDGET_EXCEEDED',
            name: 'ExecutionBudgetExceeded',
          },
        })
      }
      expect(diagnostics[3]).toMatchObject({
        payload: {
          kind: 'python',
          code: 'CONTROL_MODE_ERROR',
          name: 'ControlModeError',
        },
      })
      expect(responses.at(-1)).toMatchObject({
        type: 'boundary-result',
        payload: { mode: 'controller', yieldReason: 'decision' },
      })
    },
    30_000,
  )

  it(
    'serializes a monitoring continuation with its Controller and rejects action conflicts',
    async () => {
      const pyodide = await loadPyodide()
      const runtime = new PythonRuntime(pyodide)
      runtime.initialize(
        {
          'main.py': `from microgame import Action, ControlModeError, act, set_ai, wait_ticks

conflict_detected = False

class Controller:
    def __init__(self):
        self.calls = 0

    def decide(self, state):
        self.calls += 1
        target = self.calls if conflict_detected else 999
        return Action(target_enemy_id=target)

set_ai(Controller())

try:
    act(Action())
except ControlModeError:
    conflict_detected = True

while True:
    wait_ticks(6)
`,
        },
        { executionBudget: 2_000 },
      )

      const at0 = await runtime.boundary(0, observation(0, [1, 2]))
      const at6 = await runtime.boundary(6, observation(6, [1, 2]))

      expect(at0).toMatchObject({
        mode: 'controller',
        yieldReason: 'decision',
        action: { target_enemy_id: 1 },
        resumeTick: 6,
      })
      expect(at6).toMatchObject({
        mode: 'controller',
        yieldReason: 'decision',
        action: { target_enemy_id: 2 },
        resumeTick: 12,
      })
    },
    30_000,
  )

  it(
    'converts the DTO to frozen public Python types and reports an invalid Action as no-action',
    async () => {
      const pyodide = await loadPyodide()
      const runtime = new PythonRuntime(pyodide)
      runtime.initialize(
        {
          'main.py': `from dataclasses import FrozenInstanceError
from microgame import Action, EnemyView, Observation, Vec2

def decide(state):
    assert isinstance(state, Observation)
    assert isinstance(state.position, Vec2)
    assert isinstance(state.enemies, tuple)
    assert isinstance(state.nearest_enemy, EnemyView)
    try:
        state.hp = 0
    except FrozenInstanceError:
        pass
    else:
        raise AssertionError("Observation must be frozen")
    return Action(move_x=float("nan"), target_enemy_id=state.nearest_enemy.id)
`,
        },
        { executionBudget: 2_000 },
      )

      const result = await runtime.boundary(0, observation(0, [1]))

      expect(result).toMatchObject({
        action: { move_x: 0, move_y: 0, target_enemy_id: null },
        mode: 'controller',
        yieldReason: 'decision',
        diagnostics: [
          {
            kind: 'validation',
            code: 'INVALID_ACTION',
            severity: 'warning',
          },
        ],
      })
    },
    30_000,
  )
})
