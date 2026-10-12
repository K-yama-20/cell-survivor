import { z } from 'zod'

const maxSafeInteger = Number.MAX_SAFE_INTEGER

export const sessionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    'sessionId must contain only stable identifier characters',
  )

export const requestIdSchema = z
  .number()
  .int()
  .positive()
  .max(maxSafeInteger)

export const entityIdSchema = z
  .number()
  .int()
  .positive()
  .max(maxSafeInteger)

export const simulationTickSchema = z
  .number()
  .int()
  .nonnegative()
  .max(maxSafeInteger)

export const vec2DtoSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict()

export const enemyKindSchema = z.enum(['chaser', 'runner'])

export const enemyViewDtoSchema = z
  .object({
    id: entityIdSchema,
    kind: enemyKindSchema,
    position: vec2DtoSchema,
    hp: z.number().int().nonnegative().max(maxSafeInteger),
    distance: z.number().finite().nonnegative(),
  })
  .strict()

export const observationDtoSchema = z
  .object({
    tick: simulationTickSchema,
    hp: z.number().int().nonnegative().max(maxSafeInteger),
    max_hp: z.number().int().positive().max(maxSafeInteger),
    position: vec2DtoSchema,
    enemies: z.array(enemyViewDtoSchema),
    nearest_enemy_id: entityIdSchema.nullable(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.hp > observation.max_hp) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hp'],
        message: 'hp must not exceed max_hp',
      })
    }

    const seenIds = new Set<number>()
    let previousId = 0
    for (const [index, enemy] of observation.enemies.entries()) {
      if (seenIds.has(enemy.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['enemies', index, 'id'],
          message: 'enemy ids must be unique',
        })
      }
      if (enemy.id <= previousId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['enemies', index, 'id'],
          message: 'enemies must be sorted by ascending id',
        })
      }
      seenIds.add(enemy.id)
      previousId = enemy.id
    }

    const nearest = observation.enemies.reduce<(typeof observation.enemies)[number] | null>(
      (candidate, enemy) => {
        if (candidate === null) return enemy
        if (enemy.distance < candidate.distance) return enemy
        if (enemy.distance === candidate.distance && enemy.id < candidate.id) return enemy
        return candidate
      },
      null,
    )
    if (observation.nearest_enemy_id !== (nearest?.id ?? null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nearest_enemy_id'],
        message: 'nearest_enemy_id must identify the nearest enemy (lowest id wins ties)',
      })
    }
  })

export const actionDtoSchema = z
  .object({
    move_x: z.number().finite(),
    move_y: z.number().finite(),
    target_enemy_id: entityIdSchema.nullable(),
  })
  .strict()

export const controlModeSchema = z.enum(['controller', 'manual'])
export const pythonYieldReasonSchema = z.enum([
  'action',
  'wait',
  'waiting',
  'return',
  'decision',
])

export const diagnosticCodeSchema = z.enum([
  'INVALID_WORKER_REQUEST',
  'WORKER_NOT_INITIALIZED',
  'WORKER_ALREADY_INITIALIZED',
  'WORKER_TERMINATED',
  'SESSION_MISMATCH',
  'NON_MONOTONIC_REQUEST_ID',
  'INVALID_ACTION',
  'CONTROL_MODE_ERROR',
  'EXECUTION_BUDGET_EXCEEDED',
  'PYTHON_EXCEPTION',
  'RUNTIME_ERROR',
])

export const workerDiagnosticSchema = z
  .object({
    kind: z.enum(['protocol', 'validation', 'python', 'runtime', 'budget']),
    code: diagnosticCodeSchema,
    severity: z.enum(['warning', 'error']),
    name: z.string().min(1),
    message: z.string().min(1),
    traceback: z.string().optional(),
    fileName: z.string().optional(),
    lineNumber: z.number().int().positive().optional(),
  })
  .strict()

export const NO_ACTION: ActionDto = Object.freeze({
  move_x: 0,
  move_y: 0,
  target_enemy_id: null,
})

export type ActionValidationResult = Readonly<{
  action: ActionDto
  diagnostics: readonly WorkerDiagnostic[]
}>

export function createEmptyObservationDto(tick: number): ObservationDto {
  return observationDtoSchema.parse({
    tick,
    hp: 100,
    max_hp: 100,
    position: { x: 0, y: 0 },
    enemies: [],
    nearest_enemy_id: null,
  })
}

export function validateActionDto(
  value: unknown,
  observation: ObservationDto,
): ActionValidationResult {
  const parsed = actionDtoSchema.safeParse(value)
  if (!parsed.success) {
    return {
      action: NO_ACTION,
      diagnostics: [
        {
          kind: 'validation',
          code: 'INVALID_ACTION',
          severity: 'warning',
          name: 'InvalidAction',
          message: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
      ],
    }
  }

  const targetId = parsed.data.target_enemy_id
  if (
    targetId !== null &&
    !observation.enemies.some((enemy) => enemy.id === targetId && enemy.hp > 0)
  ) {
    return {
      action: NO_ACTION,
      diagnostics: [
        {
          kind: 'validation',
          code: 'INVALID_ACTION',
          severity: 'warning',
          name: 'InvalidActionTarget',
          message: `target_enemy_id ${targetId} is not alive in this Observation`,
        },
      ],
    }
  }

  return { action: parsed.data, diagnostics: [] }
}

export function createEnvelopeSchema<
  TType extends string,
  TPayload extends z.ZodTypeAny,
>(type: TType, payload: TPayload) {
  return z
    .object({
      sessionId: sessionIdSchema,
      requestId: requestIdSchema,
      type: z.literal(type),
      payload,
    })
    .strict()
}

export type SessionId = z.infer<typeof sessionIdSchema>
export type RequestId = z.infer<typeof requestIdSchema>
export type Vec2Dto = z.infer<typeof vec2DtoSchema>
export type EnemyViewDto = z.infer<typeof enemyViewDtoSchema>
export type ObservationDto = z.infer<typeof observationDtoSchema>
export type ActionDto = z.infer<typeof actionDtoSchema>
export type ControlMode = z.infer<typeof controlModeSchema>
export type PythonYieldReason = z.infer<typeof pythonYieldReasonSchema>
export type WorkerDiagnostic = z.infer<typeof workerDiagnosticSchema>

export type Envelope<TType extends string, TPayload> = Readonly<{
  sessionId: SessionId
  requestId: RequestId
  type: TType
  payload: TPayload
}>
