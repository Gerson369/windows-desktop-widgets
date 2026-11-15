import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { connect, until, closeAll } from '../scripts/cdp-check-client.mjs'

const require = createRequire(import.meta.url)
const { loadTypeScript } = require('./load-typescript.cjs')
const { defaultData } = loadTypeScript('src/main/types.ts')
const directory = await fs.mkdtemp(path.resolve('.health-dock-startup-e2e-data-'))
const port = 9537
const env = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1' }
delete env.ELECTRON_RUN_AS_NODE
await fs.mkdir(path.join(directory, 'data'))
await fs.writeFile(path.join(directory, 'capture-bounds'), '1')

function fixture(dock) {
  const data = defaultData()
  Object.assign(data.settings, { desktopWidgetVersion: 5, desktopHoverExpandEnabled: false, snapMode: 'none' })
  Object.assign(data.desktopModules.find(module => module.id === 'quick'), { x: 450, y: 90, width: 300, height: 350, collapsed: true })
  Object.assign(data.desktopModules.find(module => module.id === 'todos'), { x: 100, y: 90, width: 300, height: 350, collapsed: true })
  data.desktopModules.push({ id: 'health', kind: 'health', title: '喝水与活动', visible: true, collapsed: false, x: 450, y: 132, width: 300, height: 80, ...(dock ? { dock } : {}) })
  return data
}

async function verifyStartup(label) {
  await fs.rm(path.join(directory, 'quit'), { force: true })
  const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('scripts/compact-assistant-host.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'close')
  let logs = ''
  child.stderr.on('data', bytes => { logs += bytes })
  child.stdout.on('data', bytes => { logs += bytes })
  try {
    let pages
    await until(async () => {
      try {
        pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        return pages.some(page => page.url.includes('desktopModule=health'))
      } catch { return false }
    })
    const quick = await connect(pages.find(page => page.url.includes('desktopModule=quick')))
    await until(() => quick('Boolean(document.querySelector(".collapse-button"))'))
    const stored = await quick('window.toolbox.data.get()')
    assert.deepEqual(stored.desktopModules.find(module => module.id === 'health').dock, { parentId: 'quick', edge: 'bottom', offset: 0 })
    const bounds = async () => {
      const windows = JSON.parse(await fs.readFile(path.join(directory, 'window-bounds.json'), 'utf8'))
      const read = id => windows.find(window => window.url.includes('desktopModule=' + id)).bounds
      return { parent: read('quick'), child: read('health') }
    }
    await until(async () => { try { return (await bounds()).child.height === 80 } catch { return false } })
    for (const collapsed of [false, true, false]) {
      await quick('document.querySelector(".collapse-button").click()')
      await until(async () => {
        const { parent, child } = await bounds()
        return parent.height === (collapsed ? 42 : 350) && child.x === parent.x && child.y === parent.y + parent.height && child.width === 300 && child.height === 80
      })
    }
    // Save a collapsed startup again to exercise the following launch without any drag.
    await quick('document.querySelector(".collapse-button").click()')
    await until(async () => {
      const { parent, child } = await bounds()
      return parent.height === 42 && child.y === parent.y + parent.height
    })
    console.log(label + ': startup dock, expand, collapse and repeated expansion passed')
  } finally {
    closeAll()
    await fs.writeFile(path.join(directory, 'quit'), 'quit')
    const timer = setTimeout(() => child.kill(), 15000)
    await exited
    clearTimeout(timer)
    await fs.appendFile(path.join(directory, 'runtime.log'), logs)
  }
}

for (const [label, dock] of [['missing saved dock', undefined], ['incorrect saved parent', { parentId: 'todos', edge: 'bottom', offset: 0 }]]) {
  await fs.writeFile(path.join(directory, 'data', 'toolbox-data.json'), JSON.stringify(fixture(dock)))
  await verifyStartup(label)
  await verifyStartup(label + ' after restart')
}
console.log(JSON.stringify({ ok: true, directory }))
