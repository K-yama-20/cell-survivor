export type SessionId = string

export type Envelope<TPayload> = Readonly<{
  sessionId: SessionId
  requestId: number
  type: string
  payload: TPayload
}>

export type Vector2 = Readonly<{ x: number; y: number }>

export type ActionDto = Readonly<{
  move_x: number
  move_y: number
  target_enemy_id: number | null
}>
