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
Object.assign(initial.settings, { desktopWidgetVersion: 5, desktopCollected: false, desktopHoverExpandEnabled: false, desktopModuleOpacity: 88, shortcuts: [], healthSoundEnabled: false, autoStart: false, hydrationReminderEnabled: false, sedentaryReminderEnabled: false })
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
let logs = '', evaluate, page, failure
child.stdout.on('data', bytes => { logs += bytes }); child.stderr.on('data', bytes => { logs += bytes })
const report = { ok: false, directory, layouts: [], menus: [], switches: [], checks: [], screenshots: [] }
async function resize(width, height = 720) {
  await fs.writeFile(path.join(directory, 'resize'), JSON.stringify({ id: 'todos', width, height }))
  await until(() => evaluate(`innerWidth===${width} && innerHeight===${height}`))
}
async function fill(selector, value) {
  await evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));})()`)
}
async function protocol(method, params = {}) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    return await new Promise((resolve, reject) => {
      socket.onmessage = ({ data }) => { const result = JSON.parse(String(data)); if (result.id === 1) result.error ? reject(Error(result.error.message)) : resolve(result.result) }
      socket.send(JSON.stringify({ id: 1, method, params }))
    })
  } finally { socket.close() }
}
async function screenshot(name) {
  const shot = await protocol('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const target = path.join(directory, name)
  await fs.writeFile(target, Buffer.from(shot.data, 'base64')); report.screenshots.push(target)
}
async function openMenu(title) {
  const selector = `[aria-label="${title}的更多操作"]`
  await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)})) && !document.querySelector(${JSON.stringify(selector)}).disabled`))
  const before = await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:'nearest'});button.focus();return button.closest('.countdown-item').getBoundingClientRect().height})()`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  await until(() => evaluate(`Boolean(document.querySelector('.countdown-menu:popover-open'))`))
  const result = await evaluate(`(()=>{
    const menu=document.querySelector('.countdown-menu:popover-open'),r=menu.getBoundingClientRect(),trigger=document.querySelector(${JSON.stringify(selector)}),c=trigger.closest('.countdown-item').getBoundingClientRect();
    return {title:${JSON.stringify(title)},width:innerWidth,height:innerHeight,cardHeight:c.height,role:menu.getAttribute('role'),inside:r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight,anchorBottom:trigger.getBoundingClientRect().bottom,menu:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},buttons:[...menu.querySelectorAll('button')].map(button=>{const b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return {label:button.getAttribute('aria-label'),hit:hit===button || button.contains(hit)}})};
  })()`)
  assert.equal(result.cardHeight, before)
  assert.equal(result.role, 'group'); assert.equal(result.inside, true, JSON.stringify(result))
  assert.deepEqual(result.buttons.map(button=>button.label), [`编辑日期 ${title}`, `删除日期 ${title}`])
  assert.ok(result.buttons.every(button=>button.hit))
  report.menus.push(result)
  return result
}
async function escapeMenu() {
  await evaluate(`document.querySelector('.countdown-menu:popover-open button').focus()`)
  await protocol('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await protocol('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await until(() => evaluate(`!document.querySelector('.countdown-menu:popover-open')`))
  assert.equal(await evaluate(`document.visibilityState==='visible' && Boolean(document.querySelector('.countdown-panel'))`), true)
}
async function switchMenu(title) {
  const target=await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(`[aria-label="${title}的更多操作"]`)}),r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:hit===button || button.contains(hit)}})()`)
  assert.equal(target.hit,true)
  await protocol('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1})
  await protocol('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1})
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const result=await evaluate(`(()=>{const menu=document.querySelector('.countdown-menu:popover-open');return {width:innerWidth,open:Boolean(menu),labels:menu?[...menu.querySelectorAll('button')].map(button=>button.getAttribute('aria-label')):[]}})()`)
  report.switches.push(result)
  if(result.open)await escapeMenu()
  else assert.equal(await evaluate('document.visibilityState'),'visible')
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
        const number=element.querySelector('.countdown-days'),unit=number.querySelector('span'),title=element.querySelector('b'),date=element.querySelector('small'),trigger=element.querySelector('[aria-label$="的更多操作"]');
        const range=document.createRange();range.selectNodeContents(number.firstChild);const digits=range.getBoundingClientRect();
        return {title:title.textContent,kind:element.classList.contains('holiday-card')?'holiday':'personal',overflow:element.scrollWidth>element.clientWidth,box:box(element),heading:box(title),headingContentRight:title.getBoundingClientRect().right-parseFloat(getComputedStyle(title).paddingRight),date:box(date),number:box(number),digits:{left:digits.left,right:digits.right},unit:unit?box(unit):null,trigger:trigger?box(trigger):null,inlineActions:Boolean(element.querySelector('.countdown-actions'))};
      });return {width:innerWidth,overflow:document.body.scrollWidth>innerWidth,lists,cards};
    })()`)
    assert.equal(layout.overflow, false)
    for (const list of layout.lists) { assert.equal(list.columns, 3); assert.equal(list.overflow, false) }
    const reference=layout.cards.find(card=>card.kind==='holiday')
    for (const card of layout.cards) {
      assert.ok(Math.abs(card.box.width-reference.box.width)<1, `${width}px ${card.title} has a different width from holidays`)
      assert.ok(Math.abs(card.box.height-reference.box.height)<1, `${width}px ${card.title} has a different height from holidays`)
      assert.equal(card.overflow, false, `${width}px ${card.title} overflows its card`)
      assert.equal(card.inlineActions, false)
      assert.ok(card.heading.bottom<=card.number.top+1 && card.number.bottom<=card.date.top+1)
      assert.ok(card.digits.right <= card.number.right + 1, `${width}px ${card.title} clips its day count`)
      if (card.unit) assert.ok(card.digits.right <= card.unit.left + 1, `${width}px digits overlap the unit`)
      if (card.trigger) {
        assert.ok(card.trigger.left>=card.box.left && card.trigger.right<=card.box.right+1)
        assert.ok(card.trigger.top>=card.box.top && card.trigger.bottom<=card.number.top+1)
        assert.ok(card.headingContentRight<=card.trigger.left+1, `${width}px title overlaps the more control`)
      }
    }
    report.layouts.push(layout)
    for(const title of [longTitle,'今天的小目标']){await openMenu(title);await escapeMenu()}
    await openMenu(longTitle);await switchMenu('今天的小目标')
  }
  report.checks.push('300/360/420px personal dates match holiday card widths and heights; long titles and real 1000/99999-day counts remain inside without an action row')
  await resize(300,360);await openMenu('今天的小目标');await escapeMenu()
  await resize(300,300)
  const edgeMenu=await openMenu('今天的小目标')
  assert.ok(edgeMenu.menu.top<edgeMenu.anchorBottom+3,'short viewport must exercise vertical menu clamping')
  await escapeMenu()
  report.checks.push('first/last menus stay inside all widths and 300/360px-high viewports; vertical clamping works, opening keeps card height unchanged, and Escape closes only the menu')
  await resize(300)
  await openMenu(longTitle)
  await evaluate(`document.querySelector(${JSON.stringify(`[aria-label="编辑日期 ${longTitle}"]`)}).click()`)
  await until(() => evaluate(`document.querySelector('[aria-label="重要日期名称"]').value===${JSON.stringify(longTitle)}`))
  assert.equal(await evaluate(`Boolean(document.querySelector('.countdown-menu:popover-open'))`),false)
  await fill('[aria-label="重要日期名称"]', '项目交付日')
  await fill('[aria-label="重要日期"]', dateAfter(18))
  await evaluate(`document.querySelector('.countdown-form').requestSubmit()`)
  await until(() => evaluate(`window.toolbox.data.get().then(data=>data.suite.countdowns.some(item=>item.id==='long-title' && item.title==='项目交付日'))`))
  await openMenu('较远的日期')
  await evaluate(`document.querySelector('[aria-label="删除日期 较远的日期"]').click()`)
  await until(() => evaluate(`window.toolbox.data.get().then(data=>!data.suite.countdowns.some(item=>item.id==='five-digits'))`))
  assert.equal(await evaluate(`Boolean(document.querySelector('.countdown-menu:popover-open'))`),false)
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
  const saved=JSON.parse(await fs.readFile(path.join(directory,'data','toolbox-data.json'),'utf8'))
  assert.equal(saved.suite.countdowns.length,3)
  assert.ok(saved.suite.countdowns.some(item=>item.title==='下一次出发'))
  assert.equal(await fs.access(path.join(directory,'notifications.jsonl')).then(()=>true,()=>false),false)
  assert.ok(report.switches.every(result=>result.open && result.labels[0]==='编辑日期 今天的小目标' && result.labels[1]==='删除日期 今天的小目标'),JSON.stringify(report.switches))
  report.checks.push('one real pointer click switches an already open menu to another date without requiring a second click')
  report.ok = true
} catch (error) { report.error = String(error); failure=error }
finally {
  closeAll(); await fs.writeFile(path.join(directory, 'quit'), 'quit')
  const timer = setTimeout(() => child.kill(), 15000); await exited; clearTimeout(timer)
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  await fs.writeFile(path.join(directory, 'runtime.log'), logs)
}
console.log(JSON.stringify(report))
if(failure)throw failure
