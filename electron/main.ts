import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

import { resolveAppAssetPath } from './app-protocol'
import { createSecureWindowPreferences } from './window-preferences'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const rendererDirectory = path.join(currentDirectory, '../dist')
const showPythonSpike = process.env.MICRO_SURVIVOR_PYTHON_SPIKE === '1'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#071018',
    show: false,
    webPreferences: createSecureWindowPreferences(
      path.join(currentDirectory, 'preload.mjs'),
    ),
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.VITE_DEV_SERVER_URL) {
    const developmentUrl = new URL(process.env.VITE_DEV_SERVER_URL)
    if (showPythonSpike) developmentUrl.searchParams.set('python-spike', '1')
    void window.loadURL(developmentUrl.href)
  } else {
    const query = showPythonSpike ? '?python-spike=1' : ''
    void window.loadURL(`app://bundle/index.html${query}`)
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const assetPath = resolveAppAssetPath(request.url)
    if (assetPath === undefined) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(path.join(rendererDirectory, assetPath)).href)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
