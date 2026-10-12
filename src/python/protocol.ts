import { z } from 'zod'

import {
  actionDtoSchema,
  controlModeSchema,
  createEnvelopeSchema,
  observationDtoSchema,
  pythonYieldReasonSchema,
  workerDiagnosticSchema,
  type ActionDto,
  type ObservationDto,
  type WorkerDiagnostic,
} from '../shared/contracts'

const pythonFileNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*\.py$/, 'Python files must be flat .py modules')

export const DEFAULT_EXECUTION_BUDGET = 50_000
export const DEFAULT_WATCHDOG_MS = 2_000

export const pythonExecutionConfigSchema = z
  .object({
    executionBudget: z.number().int().positive().max(10_000_000),
  })
  .strict()

const initializeRequestSchema = createEnvelopeSchema(
  'initialize',
  z
    .object({
      runtimeBaseUrl: z.string().url(),
      files: z.record(pythonFileNameSchema, z.string()),
      config: pythonExecutionConfigSchema.default({
        executionBudget: DEFAULT_EXECUTION_BUDGET,
      }),
    })
    .strict(),
)

export const boundaryRequestSchema = createEnvelopeSchema(
  'boundary',
  z
    .object({
      tick: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      observation: observationDtoSchema,
    })
    .strict()
    .superRefine((payload, context) => {
      if (payload.tick !== payload.observation.tick) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['observation', 'tick'],
          message: 'Envelope tick must match ObservationDTO.tick',
        })
      }
    }),
)

const terminateRequestSchema = createEnvelopeSchema(
  'terminate',
  z.object({}).strict(),
)

export const pythonWorkerRequestSchema = z.discriminatedUnion('type', [
  initializeRequestSchema,
  boundaryRequestSchema,
  terminateRequestSchema,
])

const initializedResponseSchema = createEnvelopeSchema(
  'initialized',
  z
    .object({
      pyodideVersion: z.string().min(1),
      loadTimeMs: z.number().finite().nonnegative(),
    })
    .strict(),
)

const boundaryResultResponseSchema = createEnvelopeSchema(
  'boundary-result',
  z
    .object({
      action: actionDtoSchema,
      mode: controlModeSchema,
      yieldReason: pythonYieldReasonSchema,
      resumeTick: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
      budgetUsed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      diagnostics: z.array(workerDiagnosticSchema),
    })
    .strict(),
)

const terminatedResponseSchema = createEnvelopeSchema(
  'terminated',
  z.object({}).strict(),
)

const diagnosticResponseSchema = createEnvelopeSchema(
  'diagnostic',
  workerDiagnosticSchema,
)

export const pythonWorkerResponseSchema = z.discriminatedUnion('type', [
  initializedResponseSchema,
  boundaryResultResponseSchema,
  terminatedResponseSchema,
  diagnosticResponseSchema,
])

export {
  actionDtoSchema as actionSchema,
  observationDtoSchema,
  workerDiagnosticSchema as pythonDiagnosticSchema,
}
export type Action = ActionDto
export type PythonDiagnostic = WorkerDiagnostic
export type PythonExecutionConfig = z.infer<typeof pythonExecutionConfigSchema>
export type PythonWorkerRequest = z.infer<typeof pythonWorkerRequestSchema>
export type PythonWorkerResponse = z.infer<typeof pythonWorkerResponseSchema>
export type PythonFiles = Record<string, string>
export type PythonBoundaryResult = Extract<
  PythonWorkerResponse,
  { type: 'boundary-result' }
>['payload']
export type { ObservationDto }
