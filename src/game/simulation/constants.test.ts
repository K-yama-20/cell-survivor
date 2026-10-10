import { describe, expect, it } from 'vitest'

import { AI_BOUNDARY_TICKS, STAGE_DURATION_TICKS, TICKS_PER_SECOND } from './constants'

describe('simulation timing contract', () => {
  it('matches the canonical MVP specification', () => {
    expect(TICKS_PER_SECOND).toBe(30)
    expect(AI_BOUNDARY_TICKS).toBe(6)
    expect(STAGE_DURATION_TICKS).toBe(1_800)
    expect(STAGE_DURATION_TICKS / TICKS_PER_SECOND).toBe(60)
  })
})
