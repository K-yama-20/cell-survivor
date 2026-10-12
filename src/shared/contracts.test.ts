import { describe, expect, expectTypeOf, it } from 'vitest'

import { pythonWorkerRequestSchema, pythonWorkerResponseSchema } from '../python/protocol'
import {
  NO_ACTION,
  actionDtoSchema,
  observationDtoSchema,
  validateActionDto,
  type ActionDto,
  type Envelope,
  type ObservationDto,
} from './contracts'

function validObservation(): ObservationDto {
  return observationDtoSchema.parse({
    tick: 12,
    hp: 80,
    max_hp: 100,
    position: { x: 3, y: 4 },
    enemies: [
      {
        id: 2,
        kind: 'chaser',
        position: { x: 5, y: 4 },
        hp: 10,
        distance: 2,
      },
      {
        id: 7,
        kind: 'runner',
        position: { x: 3, y: 7 },
        hp: 20,
        distance: 3,
      },
    ],
    nearest_enemy_id: 2,
  })
}

describe('shared DTO contracts', () => {
  it('round-trips an ObservationDTO through JSON without changing its contract', () => {
    const observation = validObservation()
    const transferred = JSON.parse(JSON.stringify(observation)) as unknown

    expect(observationDtoSchema.parse(transferred)).toEqual(observation)
    expectTypeOf(observation).toMatchTypeOf<ObservationDto>()
  })

  it.each([
    ['NaN coordinate', { ...validObservation(), position: { x: Number.NaN, y: 0 } }],
    [
      'Infinity distance',
      {
        ...validObservation(),
        enemies: [
          {
            ...validObservation().enemies[0],
            distance: Number.POSITIVE_INFINITY,
          },
        ],
        nearest_enemy_id: 2,
      },
    ],
    [
      'invalid entity id',
      {
        ...validObservation(),
        enemies: [{ ...validObservation().enemies[0], id: 0 }],
        nearest_enemy_id: null,
      },
    ],
    ['invalid field type', { ...validObservation(), hp: '80' }],
  ])('rejects %s', (_label, value) => {
    expect(observationDtoSchema.safeParse(value).success).toBe(false)
  })

  it('requires stable enemy ordering and a deterministic nearest enemy', () => {
    const observation = validObservation()
    expect(
      observationDtoSchema.safeParse({
        ...observation,
        enemies: [...observation.enemies].reverse(),
      }).success,
    ).toBe(false)
    expect(
      observationDtoSchema.safeParse({
        ...observation,
        nearest_enemy_id: 7,
      }).success,
    ).toBe(false)
  })

  it('accepts any finite movement vector and rejects invalid or dead targets as no-action', () => {
    const observation = validObservation()
    const action = actionDtoSchema.parse({
      move_x: 3,
      move_y: 4,
      target_enemy_id: 2,
    })
    expectTypeOf(action).toMatchTypeOf<ActionDto>()
    expect(validateActionDto(action, observation)).toEqual({
      action,
      diagnostics: [],
    })

    for (const invalid of [
      { move_x: Number.NaN, move_y: 0, target_enemy_id: null },
      { move_x: 0, move_y: Number.POSITIVE_INFINITY, target_enemy_id: null },
      { move_x: 0, move_y: 0, target_enemy_id: -1 },
      { move_x: 0, move_y: 0, target_enemy_id: 999 },
      { move_x: '0', move_y: 0, target_enemy_id: null },
    ]) {
      const result = validateActionDto(invalid, observation)
      expect(result.action).toEqual(NO_ACTION)
      expect(result.diagnostics).toMatchObject([
        { code: 'INVALID_ACTION', severity: 'warning' },
      ])
    }
  })

  it('uses one ActionDTO for manual and controller boundary results', () => {
    const action = { move_x: 1, move_y: 0, target_enemy_id: 2 }
    for (const mode of ['manual', 'controller'] as const) {
      const parsed = pythonWorkerResponseSchema.parse({
        sessionId: 'session-1',
        requestId: 2,
        type: 'boundary-result',
        payload: {
          action,
          mode,
          yieldReason: mode === 'manual' ? 'action' : 'decision',
          resumeTick: 18,
          budgetUsed: 12,
          diagnostics: [],
        },
      })
      expect(parsed.type).toBe('boundary-result')
      if (parsed.type === 'boundary-result') {
        expect(parsed.payload.action).toEqual(action)
      }
    }
  })

  it('rejects malformed envelopes, non-positive request ids, and mismatched ticks', () => {
    const observation = validObservation()
    const validEnvelope: Envelope<'boundary', { tick: number; observation: ObservationDto }> = {
      sessionId: 'session-1',
      requestId: 3,
      type: 'boundary',
      payload: { tick: observation.tick, observation },
    }
    expect(pythonWorkerRequestSchema.safeParse(validEnvelope).success).toBe(true)

    expect(
      pythonWorkerRequestSchema.safeParse({ ...validEnvelope, sessionId: 'old session' })
        .success,
    ).toBe(false)
    expect(
      pythonWorkerRequestSchema.safeParse({ ...validEnvelope, requestId: 0 }).success,
    ).toBe(false)
    expect(
      pythonWorkerRequestSchema.safeParse({
        ...validEnvelope,
        payload: { tick: 18, observation },
      }).success,
    ).toBe(false)
  })
})
