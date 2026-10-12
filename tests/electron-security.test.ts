import { describe, expect, it } from 'vitest'

import { resolveAppAssetPath } from '../electron/app-protocol'
import { CONTENT_SECURITY_POLICY } from '../electron/security-policy'
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

describe('local app protocol', () => {
  it('serves only files below the renderer distribution directory', () => {
    expect(resolveAppAssetPath('app://bundle/pyodide/pyodide.mjs')).toBe(
      'pyodide/pyodide.mjs',
    )
    expect(resolveAppAssetPath('app://other/pyodide/pyodide.mjs')).toBeUndefined()
    expect(resolveAppAssetPath('app://bundle/..%2Fsecrets.txt')).toBeUndefined()
  })
})

describe('packaged renderer content security policy', () => {
  it('limits network connections to the local app origin', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'")
    expect(CONTENT_SECURITY_POLICY).not.toContain('connect-src *')
    expect(CONTENT_SECURITY_POLICY).not.toContain('connect-src https:')
    expect(CONTENT_SECURITY_POLICY).not.toContain('connect-src \'self\' ws:')
  })
})
