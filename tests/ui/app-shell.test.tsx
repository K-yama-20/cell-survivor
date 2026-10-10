import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../src/App'

vi.mock('../../src/game/rendering/GameCanvas', () => ({
  GameCanvas: () => <div className="game-canvas" data-testid="game-canvas" />,
}))

describe('fullscreen game shell', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<App />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('renders the Phaser host and React overlay as independent sibling layers', () => {
    const shell = container.querySelector('.app-shell')
    const gameCanvas = container.querySelector('.game-canvas')
    const overlay = container.querySelector('.game-overlay')

    expect(gameCanvas?.parentElement).toBe(shell)
    expect(overlay?.parentElement).toBe(shell)
    expect(overlay?.contains(gameCanvas)).toBe(false)
    expect(overlay?.querySelector('[aria-label="ゲーム状態"]')).not.toBeNull()
    expect(overlay?.querySelector('[aria-label="main.py エディタの仮表示"]')).not.toBeNull()
  })

  it('stops overlay pointer, wheel, and keyboard events before game-level handlers', () => {
    const editor = container.querySelector<HTMLElement>('.editor-window')
    const pointerHandler = vi.fn()
    const wheelHandler = vi.fn()
    const keyHandler = vi.fn()

    window.addEventListener('pointerdown', pointerHandler)
    window.addEventListener('wheel', wheelHandler)
    window.addEventListener('keydown', keyHandler)

    editor?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    editor?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    editor?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'f' }))

    expect(pointerHandler).not.toHaveBeenCalled()
    expect(wheelHandler).not.toHaveBeenCalled()
    expect(keyHandler).not.toHaveBeenCalled()

    window.removeEventListener('pointerdown', pointerHandler)
    window.removeEventListener('wheel', wheelHandler)
    window.removeEventListener('keydown', keyHandler)
  })
})
