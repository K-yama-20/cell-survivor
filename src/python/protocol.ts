import { z } from 'zod'

const sessionIdSchema = z.string().min(1).max(128)
const requestIdSchema = z.number().int().nonnegative()
const pythonFileNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*\.py$/, 'Python files must be flat .py modules')

export const actionSchema = z
  .object({
    move_x: z.number().finite().min(-1).max(1),
    move_y: z.number().finite().min(-1).max(1),
    target_enemy_id: z.number().int().nonnegative().nullable(),
  })
  .strict()

const initializeRequestSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: requestIdSchema,
  type: z.literal('initialize'),
  payload: z.object({
    runtimeBaseUrl: z.string().url(),
    files: z.record(pythonFileNameSchema, z.string()),
  }),
})

const boundaryRequestSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: requestIdSchema,
  type: z.literal('boundary'),
  payload: z.object({ observation: z.record(z.string(), z.unknown()) }),
})

const terminateRequestSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: requestIdSchema,
  type: z.literal('terminate'),
  payload: z.object({}).strict(),
})

export const pythonWorkerRequestSchema = z.discriminatedUnion('type', [
  initializeRequestSchema,
  boundaryRequestSchema,
  terminateRequestSchema,
])

export const pythonDiagnosticSchema = z.object({
  kind: z.enum(['protocol', 'python', 'runtime']),
  name: z.string(),
  message: z.string(),
  traceback: z.string().optional(),
  fileName: z.string().optional(),
  lineNumber: z.number().int().positive().optional(),
})

const responseEnvelope = {
  sessionId: sessionIdSchema,
  requestId: requestIdSchema,
}

export const pythonWorkerResponseSchema = z.discriminatedUnion('type', [
  z.object({
    ...responseEnvelope,
    type: z.literal('initialized'),
    payload: z.object({
      pyodideVersion: z.string(),
      loadTimeMs: z.number().nonnegative(),
    }),
  }),
  z.object({
    ...responseEnvelope,
    type: z.literal('boundary-result'),
    payload: z.object({ action: actionSchema }),
  }),
  z.object({
    ...responseEnvelope,
    type: z.literal('terminated'),
    payload: z.object({}).strict(),
  }),
  z.object({
    ...responseEnvelope,
    type: z.literal('diagnostic'),
    payload: pythonDiagnosticSchema,
  }),
])

export type Action = z.infer<typeof actionSchema>
export type PythonDiagnostic = z.infer<typeof pythonDiagnosticSchema>
export type PythonWorkerRequest = z.infer<typeof pythonWorkerRequestSchema>
export type PythonWorkerResponse = z.infer<typeof pythonWorkerResponseSchema>
export type PythonFiles = Record<string, string>
