import { PLAYER_ATTACK_COOLDOWN_TICKS } from './constants'

export type AttackCooldownState = Readonly<{ nextReadyTick: number }>

export type AttackCooldownResult = Readonly<{
  fired: boolean
  state: AttackCooldownState
}>

export function applyAttackCooldown(
  state: AttackCooldownState,
  tick: number,
  hasTargetInRange: boolean,
): AttackCooldownResult {
  if (!hasTargetInRange || tick < state.nextReadyTick) {
    return { fired: false, state }
  }
  return {
    fired: true,
    state: { nextReadyTick: tick + PLAYER_ATTACK_COOLDOWN_TICKS },
  }
}
