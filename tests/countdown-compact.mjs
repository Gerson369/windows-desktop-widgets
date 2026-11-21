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
const { dateKey } = loadTypeScript('src/main/widget-suite.ts')
const directory = await fs.mkdtemp(path.resolve('.countdown-compact-e2e-data-'))
const desktop = path.join(directory, 'public-desktop'), port = 9551
await fs.mkdir(path.join(directory, 'data'))
await fs.mkdir(desktop)
const dateAfter = days => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + days); return dateKey(date) }
const longTitle = '项目交付与年度目标汇总的较长名称'
const initial = defaultData()
Object.assign(initial.settings, { desktopWidgetVersion: 5, desktopCollected: false, desktopHoverExpandEnabled: false, desktopModuleOpacity: 88, shortcuts: [], healthSoundEnabled: false })
for (const module of initial.desktopModules) module.visible = module.id === 'todos'
Object.assign(initial.desktopModules.find(module => module.id === 'todos'), { x: 40, y: 70, width: 300, height: 720, collapsed: false })
initial.suite.countdowns = [
  { id: 'long-title', title: longTitle, date: dateAfter(1000) },
  { id: 'five-digits', title: '较远的日期', date: dateAfter(99999) },
  { id: 'today', title: '今天的小目标', date: dateAfter(0) }
]
await fs.writeFile(path.join(directory, 'data', 'toolbox-data.json'), JSON.stringify(initial))
const env = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1', GERSON_E2E_DESKTOP_DIRECTORY: desktop }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('scripts/compact-assistant-host.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = once(child, 'close')
let logs = '', evaluate, page
child.stdout.on('data', bytes => { logs += bytes }); child.stderr.on('data', bytes => { logs += bytes })
const report = { ok: false, directory, layouts: [], checks: [], screenshots: [] }
async function resize(width) {
  await fs.writeFile(path.join(directory, 'resize'), JSON.stringify({ id: 'todos', width, height: 720 }))
  await until(() => evaluate(`innerWidth===${width} && innerHeight===720`))
}
async function fill(selector, value) {
  await evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));})()`)
}
async function screenshot(name) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    const shot = await new Promise((resolve, reject) => {
      socket.onmessage = ({ data }) => { const result = JSON.parse(String(data)); if (result.id === 1) result.error ? reject(Error(result.error.message)) : resolve(result.result) }
      socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: false } }))
    })
    const target = path.join(directory, name)
    await fs.writeFile(target, Buffer.from(shot.data, 'base64')); report.screenshots.push(target)
  } finally { socket.close() }
}
try {
  await until(async () => {
    try { const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); page = pages.find(candidate => candidate.url.includes('desktopModule=todos')); return Boolean(page) } catch { return false }
  })
  evaluate = await connect(page)
  await until(() => evaluate(`Boolean(document.querySelector('[data-tool=countdown]'))`))
  await evaluate(`document.querySelector('[data-tool=countdown]').click()`)
  await until(() => evaluate(`document.querySelectorAll('.countdown-item').length===3 && document.querySelectorAll('.holiday-card').length===6`))
  for (const width of [300, 360, 420]) {
    await resize(width)
    const layout = await evaluate(`(()=>{
      const box=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
      const lists=['.countdown-list','.holiday-grid'].map(selector=>{const element=document.querySelector(selector);return {selector,columns:getComputedStyle(element).gridTemplateColumns.split(' ').length,overflow:element.scrollWidth>element.clientWidth,box:box(element)}});
      const cards=[...document.querySelectorAll('.countdown-item,.holiday-card')].map(element=>{
        const number=element.querySelector('.countdown-days'),unit=number.querySelector('span'),actions=element.querySelector('.countdown-actions');
        const range=document.createRange();range.selectNodeContents(number.firstChild);const digits=range.getBoundingClientRect();
        return {title:element.querySelector('b').textContent,overflow:element.scrollWidth>element.clientWidth,box:box(element),number:box(number),digits:{left:digits.left,right:digits.right},unit:unit?box(unit):null,actions:actions?box(actions):null};
      });return {width:innerWidth,overflow:document.body.scrollWidth>innerWidth,lists,cards};
    })()`)
    assert.equal(layout.overflow, false)
    for (const list of layout.lists) { assert.equal(list.columns, 3); assert.equal(list.overflow, false) }
    for (const card of layout.cards) {
      assert.equal(card.overflow, false, `${width}px ${card.title} overflows its card`)
      assert.ok(card.digits.right <= card.number.right + 1, `${width}px ${card.title} clips its day count`)
      if (card.unit) assert.ok(card.digits.right <= card.unit.left + 1, `${width}px digits overlap the unit`)
      if (card.actions) { assert.ok(card.actions.top >= card.number.bottom - 1, `${width}px controls overlap the days`); assert.ok(card.actions.right <= card.box.right + 1) }
    }
    report.layouts.push(layout)
  }
  report.checks.push('300/360/420px use three columns for dates and six holidays; long titles and real 1000/99999-day records do not overlap or spill')
  await resize(300)
  await evaluate(`document.querySelector(${JSON.stringify(`[aria-label="编辑日期 ${longTitle}"]`)}).click()`)
  await until(() => evaluate(`document.querySelector('[aria-label="重要日期名称"]').value===${JSON.stringify(longTitle)}`))
  await fill('[aria-label="重要日期名称"]', '项目交付日')
  await fill('[aria-label="重要日期"]', dateAfter(18))
  await evaluate(`document.querySelector('.countdown-form').requestSubmit()`)
  await until(() => evaluate(`window.toolbox.data.get().then(data=>data.suite.countdowns.some(item=>item.id==='long-title' && item.title==='项目交付日'))`))
  await evaluate(`document.querySelector('[aria-label="删除日期 较远的日期"]').click()`)
  await until(() => evaluate(`window.toolbox.data.get().then(data=>!data.suite.countdowns.some(item=>item.id==='five-digits'))`))
  await fill('[aria-label="重要日期名称"]', '下一次出发')
  await fill('[aria-label="重要日期"]', dateAfter(30))
  await evaluate(`document.querySelector('.countdown-form').requestSubmit()`)
  await until(() => evaluate(`window.toolbox.data.get().then(data=>data.suite.countdowns.some(item=>item.title==='下一次出发'))`))
  report.checks.push('300px retains usable edit, delete and add actions with real stored records')
  await until(() => evaluate(`document.fonts.status==='loaded'`))
  const text = await evaluate('document.body.innerText')
  assert.doesNotMatch(text, /C:\\Users\\|D:\\|\.countdown-compact-e2e-data-/i)
  await evaluate(`document.querySelector('.suite-content').scrollTo(0,0)`)
  await screenshot('countdown-300.png')
  report.ok = true
  console.log(JSON.stringify({ ok: report.ok, directory, widths: report.layouts.map(layout => layout.width), checks: report.checks, screenshots: report.screenshots }))
} catch (error) { report.error = String(error); console.error(error); throw error }
finally {
  closeAll(); await fs.writeFile(path.join(directory, 'quit'), 'quit')
  const timer = setTimeout(() => child.kill(), 15000); await exited; clearTimeout(timer)
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  await fs.writeFile(path.join(directory, 'runtime.log'), logs)
}
