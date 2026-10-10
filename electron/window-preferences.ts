export type SecureWindowPreferences = Readonly<{
  preload: string
  nodeIntegration: false
  contextIsolation: true
  sandbox: true
  webSecurity: true
}>

export function createSecureWindowPreferences(preload: string): SecureWindowPreferences {
  return Object.freeze({
    preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  })
}
