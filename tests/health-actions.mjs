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
const directory = await fs.mkdtemp(path.resolve('.health-actions-e2e-data-')), port = 9538, checks = []
const at = (hour, minute = 0, second = 0) => new Date(2026, 10, 15, hour, minute, second).getTime()
const data = defaultData()
Object.assign(data.settings, { desktopWidgetVersion: 5, hydrationPlan: { enabled: false, goalMl: 2000, cupMl: 250, start: '09:00', end: '20:00' }, hydrationIntervalMinutes: 15, hydrationReminderEnabled: true, sedentaryReminderEnabled: true, sedentaryIntervalMinutes: 60, healthSoundEnabled: false })
data.hydrationDay = { date: '2026-11-15', consumedMl: 0 }
data.desktopModules.push({ id: 'health', kind: 'health', title: '喝水与活动', visible: true, collapsed: false, x: 450, y: 132, width: 360, height: 80 })
await fs.mkdir(path.join(directory, 'data'))
await fs.writeFile(path.join(directory, 'data', 'toolbox-data.json'), JSON.stringify(data))
await fs.writeFile(path.join(directory, 'clock'), String(at(11)))
const env = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('scripts/compact-assistant-host.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = once(child, 'close')
let logs = '', main, health
child.stdout.on('data', bytes => { logs += bytes }); child.stderr.on('data', bytes => { logs += bytes })
const state = () => main('window.toolbox.wellness.get()')
const button = kind => kind === 'hydration' ? '.water-icon' : '.spine-icon'
const undoButton = kind => kind === 'hydration' ? '.water-undo' : '.activity-undo'
async function clock(time) {
  await fs.writeFile(path.join(directory, 'clock.tmp'), String(time)); await fs.rename(path.join(directory, 'clock.tmp'), path.join(directory, 'clock'))
  await health(`Date.now=()=>${time}`)
}
async function amount(expected) { await until(() => health(`document.querySelector('.water-icon small')?.textContent==='${expected}ml'`)) }
async function complete(kind) {
  const previousId = (await state()).undo?.[kind]?.id
  await health(`document.querySelector('${button(kind)}').click()`)
  await until(async () => { const next = (await state()).undo?.[kind]; return next && next.id !== previousId })
  await until(() => health(`Boolean(document.querySelector('${undoButton(kind)}:not(:disabled)'))`))
  return state()
}
async function undo(kind) {
  await health(`document.querySelector('${undoButton(kind)}').click()`)
  await until(async () => !(await state()).undo?.[kind])
  return state()
}
async function rejectsUndo(id) { assert.equal(await main(`window.toolbox.wellness.undo(${JSON.stringify(id)}).then(()=>false,()=>true)`), true) }
try {
  let pages
  await until(async () => { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return pages.some(page => page.url.includes('desktopModule=health')) } catch { return false } })
  main = await connect(pages.find(page => !page.url.includes('?')))
  health = await connect(pages.find(page => page.url.includes('desktopModule=health')))
  await until(() => health(`Boolean(document.querySelector('.water-icon'))`))
  assert.equal((await state()).state.hydration.startedAt, at(11))
  await clock(at(11, 7, 30)); await amount(28)
  assert.equal((await complete('hydration')).hydrationPlan.consumedMl, 28)
  assert.equal((await main('window.toolbox.data.get()')).hydrationDay.consumedMl, 28)
  assert.equal((await undo('hydration')).hydrationPlan.consumedMl, 0)
  await clock(at(11, 15)); await amount(56)
  checks.push('11:00 startup to 20:00 at 15-minute intervals gives 56ml full and records/persists 28ml half-cup')

  for (const order of [['hydration', 'sedentary'], ['sedentary', 'hydration']]) {
    const before = await state()
    for (const kind of order) await complete(kind)
    const completed = await state()
    assert.deepEqual(Object.keys(completed.undo).sort(), ['hydration', 'sedentary'])
    assert.equal(await health(`document.querySelectorAll('.water-undo,.activity-undo').length`), 2)
    const waterUndone = await undo('hydration')
    assert.equal(waterUndone.hydrationPlan.consumedMl, before.hydrationPlan.consumedMl)
    assert.equal(waterUndone.state.hydration.startedAt, before.state.hydration.startedAt)
    assert.deepEqual(waterUndone.state.sedentary, completed.state.sedentary)
    assert.equal(waterUndone.undo.sedentary.id, completed.undo.sedentary.id)
    const activityUndone = await undo('sedentary')
    assert.equal(activityUndone.state.sedentary.startedAt, before.state.sedentary.startedAt)
    assert.equal(activityUndone.state.hydration.startedAt, waterUndone.state.hydration.startedAt)
    assert.equal(activityUndone.hydrationPlan.consumedMl, waterUndone.hydrationPlan.consumedMl)
    checks.push(order.join(' → ') + ': both undo buttons remain and each restores only its own data/clock')
  }

  const water = await complete('hydration'), waterId = water.undo.hydration.id
  await clock(at(11, 15, 5)); const activity = await complete('sedentary')
  await clock(at(11, 15, 15))
  await until(() => health(`!document.querySelector('.water-undo') && Boolean(document.querySelector('.activity-undo'))`))
  await rejectsUndo(waterId)
  assert.equal((await state()).undo.sedentary.id, activity.undo.sedentary.id)
  await undo('sedentary')
  await clock(at(11, 15, 16)); const first = await complete('sedentary')
  await clock(at(11, 15, 17)); const second = await complete('sedentary')
  await rejectsUndo(first.undo.sedentary.id); await undo('sedentary')
  assert.notEqual(first.undo.sedentary.id, second.undo.sedentary.id)
  checks.push('15-second expiry is independent; a newer activity replaces only the same-kind undo token')

  await main(`window.toolbox.settings.update({hydrationPlan:{enabled:false,goalMl:5000,cupMl:250,start:'09:00',end:'20:00'},hydrationIntervalMinutes:5})`)
  await clock(at(11, 20, 17)); await amount(47)
  const firstDrink = await complete('hydration')
  await clock(at(11, 20, 24)); await amount(1)
  const secondDrink = await complete('hydration')
  await rejectsUndo(firstDrink.undo.hydration.id)
  const latestUndone = await undo('hydration')
  assert.equal(latestUndone.hydrationPlan.consumedMl, firstDrink.hydrationPlan.consumedMl)
  assert.equal(secondDrink.hydrationPlan.consumedMl, firstDrink.hydrationPlan.consumedMl + 1)
  checks.push('a newer water record replaces its own undo token; undo restores the previous drink without removing it')
  console.log(JSON.stringify({ ok: true, checks, directory }))
} catch (error) { console.error(logs); throw error }
finally {
  closeAll(); await fs.writeFile(path.join(directory, 'quit'), 'quit')
  const timer = setTimeout(() => child.kill(), 15000); await exited; clearTimeout(timer)
  await fs.writeFile(path.join(directory, 'runtime.log'), logs)
}
