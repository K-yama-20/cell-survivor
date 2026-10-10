import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJsonPath = require.resolve('pyodide/package.json')
const packageRoot = path.dirname(packageJsonPath)
const outputDirectory = path.join(projectRoot, 'public', 'pyodide')
const runtimeFiles = [
  'pyodide-lock.json',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'pyodide.mjs',
  'python_stdlib.zip',
]

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const pinnedVersion = '314.0.7'

if (packageJson.version !== pinnedVersion) {
  throw new Error(
    `Expected pyodide ${pinnedVersion}, received ${String(packageJson.version)}`,
  )
}

await mkdir(outputDirectory, { recursive: true })
await Promise.all(
  runtimeFiles.map((fileName) =>
    copyFile(path.join(packageRoot, fileName), path.join(outputDirectory, fileName)),
  ),
)

console.log(`Copied Pyodide ${pinnedVersion} runtime assets to public/pyodide`)
