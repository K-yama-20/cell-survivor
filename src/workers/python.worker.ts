/// <reference lib="webworker" />

import { loadPyodide } from 'pyodide'

import { createPythonWorkerHandler } from '../python/worker-handler'

const workerScope = self as DedicatedWorkerGlobalScope
const handleMessage = createPythonWorkerHandler({
  loadPyodide: (options) => {
    const runtimeUrl = new URL(options.indexURL)
    if (
      runtimeUrl.origin !== workerScope.location.origin ||
      !runtimeUrl.pathname.endsWith('/pyodide/')
    ) {
      throw new Error('Pyodide must load from the local /pyodide/ asset directory')
    }
    return loadPyodide(options)
  },
  postMessage: (response) => workerScope.postMessage(response),
  close: () => workerScope.close(),
})

let queue = Promise.resolve()
workerScope.onmessage = (event: MessageEvent<unknown>) => {
  queue = queue.then(() => handleMessage(event.data))
}
