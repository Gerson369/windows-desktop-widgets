import { copyIpcData } from './ipc-data'

const bridge = window.toolbox
// Strip reactive containers before crossing contextBridge, which clones arguments itself.
export const toolbox: typeof bridge = {
  ...bridge,
  suite: { ...bridge.suite, save: patch => bridge.suite.save(copyIpcData(patch) as typeof patch) },
  settings: { ...bridge.settings, update: patch => bridge.settings.update(copyIpcData(patch) as typeof patch) },
  entity: { ...bridge.entity, upsert: (collection, entry) => bridge.entity.upsert(collection, copyIpcData(entry) as typeof entry) }
}
