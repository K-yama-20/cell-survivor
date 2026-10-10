import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('microSurvivor', {
  platform: process.platform,
})
