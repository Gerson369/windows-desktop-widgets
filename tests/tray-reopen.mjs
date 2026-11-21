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
const directory = await fs.mkdtemp(path.resolve('.tray-reopen-e2e-data-'))
const desktop = path.join(directory, 'public-desktop'), port = 9552
await fs.mkdir(path.join(directory, 'data'))
await fs.mkdir(desktop)
const initial = defaultData()
Object.assign(initial.settings, { desktopWidgetVersion: 5, desktopCollected: false, desktopHoverExpandEnabled: false, shortcuts: [], healthSoundEnabled: false })
for (const module of initial.desktopModules) module.visible = module.id === 'todos'
Object.assign(initial.desktopModules.find(module => module.id === 'todos'), { x: 80, y: 80, width: 360, height: 600, collapsed: false })
initial.desktopModules.push({ id: 'health', kind: 'health', title: '喝水与活动', visible: false, collapsed: false, x: 80, y: 680, width: 300, height: 80 })
await fs.writeFile(path.join(directory, 'data', 'toolbox-data.json'), JSON.stringify(initial))
await fs.writeFile(path.join(directory, 'capture-bounds'), '1')
const env = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1', GERSON_E2E_DESKTOP_DIRECTORY: desktop }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('scripts/compact-assistant-host.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = once(child, 'close')
let logs = '', main, assistant
child.stdout.on('data', bytes => { logs += bytes }); child.stderr.on('data', bytes => { logs += bytes })
const report = { ok: false, directory, checks: [], states: [] }
const stored = () => main(`window.toolbox.data.get().then(data=>data.desktopModules.find(module=>module.id==='todos'))`)
async function state() {
  return assistant(`({visibility:document.visibilityState,height:innerHeight,focused:document.hasFocus(),active:document.querySelector('[data-tool][aria-selected=true]')?.dataset.tool,expanded:Boolean(document.querySelector('[aria-label="收起桌面搭子"]'))})`)
}
async function closeAssistant() {
  await assistant('window.close()')
  await until(async () => !(await stored()).visible && (await state()).visibility === 'hidden')
}
async function reopen(label) {
  await main(`window.toolbox.desktopModules.openMain('todos')`)
  await until(async () => {
    const settings = await stored(), visible = await state()
    return settings.visible && !settings.collapsed && visible.visibility === 'visible' && visible.height > 42 && visible.expanded && visible.active === 'todos'
  })
  let bounds
  await until(async () => {
    try { const windows = JSON.parse(await fs.readFile(path.join(directory, 'window-bounds.json'), 'utf8')); bounds = windows.find(window => window.url.includes('desktopModule=todos'))?.bounds; return bounds?.height > 42 } catch { return false }
  })
  const shown = await state()
  assert.equal(bounds.height, shown.height)
  await assistant(`document.querySelector('[data-tool=countdown]').click()`)
  await until(() => assistant(`document.querySelector('[data-tool=countdown]').getAttribute('aria-selected')==='true' && document.querySelector('.holiday-grid')?.getBoundingClientRect().height>0`))
  report.states.push({ label, stored: await stored(), window: shown, bounds })
  report.checks.push(label + ': visible, expanded and interactive through the same public open path used by the tray')
}
try {
  let pages
  await until(async () => {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return pages.some(page => page.url.includes('desktopModule=todos')) && pages.some(page => !page.url.includes('?')) } catch { return false }
  })
  main = await connect(pages.find(page => !page.url.includes('?')))
  assistant = await connect(pages.find(page => page.url.includes('desktopModule=todos')))
  await until(() => assistant(`Boolean(document.querySelector('[data-tool=todos]'))`))
  assert.equal((await stored()).visible, true)
  await closeAssistant()
  await reopen('after native close')
  await closeAssistant()
  await reopen('after repeated native close')
  await assistant(`document.querySelector('[aria-label="收起桌面搭子"]').click()`)
  await until(async () => (await stored()).collapsed && (await state()).height === 42)
  await closeAssistant()
  await reopen('after collapsed native close')
  report.ok = true
} catch (error) { report.error = String(error); console.error(error); throw error }
finally {
  closeAll()
  await fs.writeFile(path.join(directory, 'quit'), 'quit')
  const timer = setTimeout(() => child.kill(), 15000)
  await exited; clearTimeout(timer)
  await fs.writeFile(path.join(directory, 'runtime.log'), logs)
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ ok: report.ok, directory, checks: report.checks }))
