import { describe, expect, it } from 'vitest'

import { AI_BOUNDARY_TICKS } from './constants'
import { applyAttackCooldown, type AttackCooldownState } from './attack-cooldown'

describe('simulation-owned attack cooldown', () => {
  it('does not fire faster when Python resubmits a target every decision boundary', () => {
    let state: AttackCooldownState = { nextReadyTick: 0 }
    let targetSelected = false
    const firedAt: number[] = []

    for (let tick = 0; tick <= 35; tick += 1) {
      if (tick % AI_BOUNDARY_TICKS === 0) targetSelected = true
      const result = applyAttackCooldown(state, tick, targetSelected)
      state = result.state
      if (result.fired) firedAt.push(tick)
    }

    expect(firedAt).toEqual([0, 15, 30])
  })
})
