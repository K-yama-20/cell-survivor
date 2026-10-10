import { describe, expect, it } from 'vitest'

import { createSecureWindowPreferences } from '../electron/window-preferences'

describe('Electron renderer security boundary', () => {
  it('keeps Node.js isolated from the renderer', () => {
    const preferences = createSecureWindowPreferences('preload.mjs')

    expect(preferences).toEqual({
      preload: 'preload.mjs',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    })
    expect(Object.isFrozen(preferences)).toBe(true)
  })
})
