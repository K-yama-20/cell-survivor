import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

async function findPage(port) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Electron is still starting.
    }
    await delay(100)
  }
  throw new Error('Electron renderer did not expose a debugging target')
}

async function openSocket(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return socket
}

function createEvaluator(socket) {
  let nextId = 0
  return (expression) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const onMessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        socket.removeEventListener('message', onMessage)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result?.result?.value)
      }
      socket.addEventListener('message', onMessage)
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      )
    })
}

const port = await reservePort()
const electron = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
  cwd: projectRoot,
  env: { ...process.env, MICRO_SURVIVOR_PYTHON_SPIKE: '1' },
  stdio: 'ignore',
  windowsHide: true,
})

let socket
try {
  const page = await findPage(port)
  socket = await openSocket(page.webSocketDebuggerUrl)
  const evaluate = createEvaluator(socket)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const status = await evaluate(
      `(() => {
        const node = document.querySelector('.python-spike-probe [data-status]')
        return node ? { status: node.dataset.status, text: node.textContent } : null
      })()`,
    )
    if (status?.status === 'passed') {
      console.log(status.text.trim())
      break
    }
    if (status?.status === 'failed') throw new Error(status.text.trim())
    await delay(100)
  }
  const finalStatus = await evaluate(
    `document.querySelector('.python-spike-probe [data-status]')?.dataset.status`,
  )
  if (finalStatus !== 'passed') throw new Error('Python Worker spike timed out')
} finally {
  socket?.close()
  electron.kill()
}
