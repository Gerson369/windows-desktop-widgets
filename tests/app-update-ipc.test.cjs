const assert = require('node:assert/strict')
const test = require('node:test')
const { loadTypeScript } = require('./load-typescript.cjs')

const windowsTest = process.platform === 'win32' && process.arch === 'x64' ? test : test.skip

function harness() {
  const handlers = new Map()
  const calls = []
  const sender = { mainFrame: {}, isDestroyed: () => false, send: (_channel, percent) => calls.push(percent) }
  const event = { sender, senderFrame: sender.mainFrame }
  const target = { version: '3.0.0' }
  const app = { isPackaged: true, getVersion: () => '2.9.0', getPath: () => 'temp', quit: () => calls.push('quit') }
  const operations = {
    createUpdateFetcher: () => () => { throw new Error('unexpected network access in IPC test') },
    checkForAppUpdate: async () => target,
    downloadAppUpdate: async (_asset, _dir, _fetch, progress) => {
      for (const received of [1, 2, 41, 42, 200]) progress(received, 200)
      return 'temp/update-1/new.exe'
    },
    startAppUpdateInstall: async () => { calls.push('install') },
    restoreDesktop: async () => { calls.push('restore') }
  }
  const { registerAppUpdates } = loadTypeScript('src/main/app-update-ipc.ts', {
    electron: { app, ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, net: {} },
    './app-update': operations,
    './app-update-install': operations,
    'node:fs/promises': { rm: async () => { calls.push('cleanup') } }
  })
  registerAppUpdates(e => e.sender === sender, () => operations.restoreDesktop(), () => calls.push('resume'))
  return { app, event, calls, operations, invoke: (name, e = event) => handlers.get('app-update:' + name)(e) }
}

windowsTest('only the settings window which checked for a release can start it', async () => {
  const { app, event, invoke, calls } = harness()
  assert.equal((await invoke('check', { ...event, senderFrame: {} })).status, 'error')
  assert.equal((await invoke('install')).status, 'error')
  assert.deepEqual(await invoke('check'), { status: 'available', version: '3.0.0' })
  app.isPackaged = false
  assert.equal((await invoke('install')).status, 'error')
  app.isPackaged = true
  assert.equal((await invoke('install', { ...event, sender: { mainFrame: event.senderFrame } })).status, 'error')
  const result = invoke('install')
  assert.equal((await invoke('install')).status, 'error')
  assert.equal((await result).status, 'installing')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [0, 1, 20, 21, 100, 'restore', 'install', 'quit'])
})

windowsTest('failed handoff resumes the desktop and allows a new check', async () => {
  const { operations, invoke, calls } = harness()
  await invoke('check')
  operations.startAppUpdateInstall = async () => { throw new Error('目录只读') }
  assert.deepEqual(await invoke('install'), { status: 'error', message: '目录只读' })
  assert.deepEqual(calls.slice(-3), ['restore', 'resume', 'cleanup'])
  operations.checkForAppUpdate = async () => null
  assert.equal((await invoke('check')).status, 'current')
  assert.equal((await invoke('install')).status, 'error')
  assert.ok(!calls.includes('quit'))
})
