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
const directory = await fs.mkdtemp(path.resolve('.calendar-popup-e2e-data-'))
const desktop = path.join(directory, 'public-desktop'), port = 9553
const today = dateKey(Date.now())
const dateAfter = (date, days) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return dateKey(value) }
const monthStart = today.slice(0, 8) + '01'
const monthMonday = dateAfter(monthStart, (8 - new Date(`${monthStart}T12:00:00`).getDay()) % 7)
const firstMonday = [0, 7, 14].map(days => dateAfter(monthMonday, days)).find(date => today < dateAfter(date, 1) || today > dateAfter(date, 8))
const crossWeekStart = dateAfter(firstMonday, 4), crossWeekEnd = dateAfter(firstMonday, 8)
const sameWeekStart = dateAfter(firstMonday, 1), sameWeekEnd = dateAfter(firstMonday, 2)
await fs.mkdir(path.join(directory, 'data'))
await fs.mkdir(desktop)
const initial = defaultData()
Object.assign(initial.settings, { desktopWidgetVersion: 5, desktopCollected: false, desktopHoverExpandEnabled: false, desktopModuleOpacity: 88, shortcuts: [], healthSoundEnabled: false, hydrationReminderEnabled: false, sedentaryReminderEnabled: false })
for (const module of initial.desktopModules) module.visible = module.id === 'todos'
Object.assign(initial.desktopModules.find(module => module.id === 'todos'), { x: 40, y: 70, width: 420, height: 650, collapsed: false })
initial.suite.events = [
  { id: 'local-morning', title: '资料整理', start: new Date(`${today}T09:00:00`).toISOString(), end: new Date(`${today}T10:00:00`).toISOString(), allDay: false, category: 'work', color: '#8ab9f1', location: '共享书房 A 区', notes: '整理公开演示资料。\n完成后记录进度。' },
  { id: 'local-afternoon', title: '午后散步', start: new Date(`${today}T14:00:00`).toISOString(), end: new Date(`${today}T14:30:00`).toISOString(), allDay: false, category: 'personal', color: '#b8e1ca' },
  { id: 'same-week', title: '两天资料归档', start: new Date(`${sameWeekStart}T00:00:00`).toISOString(), end: new Date(`${dateAfter(sameWeekEnd, 1)}T00:00:00`).toISOString(), allDay: true, category: 'personal', color: '#e7b37b' },
  { id: 'cross-week', title: '跨周项目准备', start: new Date(`${crossWeekStart}T00:00:00`).toISOString(), end: new Date(`${dateAfter(crossWeekEnd, 1)}T00:00:00`).toISOString(), allDay: true, category: 'work', color: '#86d6cd' }
]
initial.suite.sources = [{ id: 'readonly-source', name: '公开订阅演示', enabled: true, updatedAt: new Date().toISOString(), content: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gerson//Popup Test//EN\r\nBEGIN:VEVENT\r\nUID:readonly-event\r\nDTSTART;VALUE=DATE:${today.replaceAll('-', '')}\r\nDTEND;VALUE=DATE:${dateAfter(today, 1).replaceAll('-', '')}\r\nSUMMARY:订阅只读事项\r\nLOCATION:线上公开会议室\r\nDESCRIPTION:订阅发布的公开安排。\\n请准时查看。\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n` }]
await fs.writeFile(path.join(directory, 'data', 'toolbox-data.json'), JSON.stringify(initial))
const env = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1', GERSON_E2E_DESKTOP_DIRECTORY: desktop }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('scripts/compact-assistant-host.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = once(child, 'close')
let logs = '', evaluate, page, failure
child.stdout.on('data', bytes => { logs += bytes }); child.stderr.on('data', bytes => { logs += bytes })
const report = { ok: false, directory, checks: [], layouts: [], monthLayouts: [], screenshots: [] }
const dayButton = `.calendar-date-number[aria-label="${today}"]`
const addButton = '[aria-label="添加日程"]'

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
async function resize(width) {
  await fs.writeFile(path.join(directory, 'resize'), JSON.stringify({ id: 'todos', width, height: 650 }))
  await until(() => evaluate(`innerWidth===${width} && innerHeight===650`))
}
async function click(selector) {
  await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button)throw Error('Missing button: '+${JSON.stringify(selector)});button.focus();button.click()})()`)
}
async function fill(selector, value) {
  await evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});if(!field)throw Error('Missing input: '+${JSON.stringify(selector)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))})()`)
}
async function popupOpen() { await until(() => evaluate(`document.querySelector('.calendar-dialog')?.matches(':modal')`)) }
async function popupClosed() { await until(() => evaluate(`!document.querySelector('.calendar-dialog').open`)) }
async function calendarHeight() { return evaluate(`({card:document.querySelector('.calendar-card').getBoundingClientRect().height,content:document.querySelector('.suite-content').scrollHeight})`) }
async function escapeFrom(selector, returnSelector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  await protocol('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await protocol('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await popupClosed()
  assert.deepEqual(await evaluate(`({visible:document.visibilityState,focused:document.activeElement===document.querySelector(${JSON.stringify(returnSelector)})})`), { visible: 'visible', focused: true })
}
async function layout(mode) {
  const result = await evaluate(`(()=>{
    const dialog=document.querySelector('.calendar-dialog'),r=dialog.getBoundingClientRect(),hit=document.elementFromPoint(r.left+5,r.top+5);
    const fields=[...dialog.querySelectorAll('.calendar-event-form>label')].map(field=>field.getBoundingClientRect());
    return {mode:${JSON.stringify(mode)},width:innerWidth,open:dialog.open,modal:dialog.matches(':modal'),backdrop:getComputedStyle(dialog,'::backdrop').backgroundColor,overflow:dialog.scrollWidth>dialog.clientWidth,inside:r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight,bottomGap:innerHeight-r.bottom,topLayerHit:hit===dialog || dialog.contains(hit),vertical:fields.every((field,index)=>index===0 || field.top>=fields[index-1].bottom),controlsInside:[...dialog.querySelectorAll('input,select,textarea,button')].every(control=>{const c=control.getBoundingClientRect();return c.left>=r.left && c.right<=r.right}),bounds:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
  })()`)
  assert.equal(result.open, true); assert.equal(result.modal, true); assert.equal(result.overflow, false)
  assert.equal(result.inside, true); assert.equal(result.topLayerHit, true); assert.equal(result.vertical, true); assert.equal(result.controlsInside, true)
  assert.ok(result.bottomGap >= 0 && result.bottomGap <= 16, 'calendar popup must anchor to the bottom of the window')
  assert.doesNotMatch(result.backdrop, /^(?:transparent|rgba\(0, 0, 0, 0\))$/)
  report.layouts.push(result)
}
async function monthLayout() {
  const result = await evaluate(`(()=>{
    const weeks=[...document.querySelectorAll('.calendar-week')],view=document.querySelector('.calendar-month-scroll');
    const segments=[...document.querySelectorAll('.calendar-month-event')].map(bar=>{
      const style=getComputedStyle(bar),first=Number(style.gridColumnStart)-1,end=Number(style.gridColumnEnd)-1;
      const days=[...bar.closest('.calendar-week').querySelectorAll('.calendar-day')],r=bar.getBoundingClientRect();
      const firstBox=days[first]?.getBoundingClientRect(),lastBox=days[end-1]?.getBoundingClientRect();
      return {id:bar.dataset.eventId,first:days[first]?.dataset.date,last:days[end-1]?.dataset.date,span:end-first,before:bar.classList.contains('continues-before'),after:bar.classList.contains('continues-after'),inside:r.left>=0 && r.right<=innerWidth,coversDays:Boolean(firstBox && lastBox && r.left<firstBox.left+firstBox.width/2 && r.right>lastBox.left+lastBox.width/2)};
    });
    return {width:innerWidth,columns:weeks.map(week=>getComputedStyle(week).gridTemplateColumns.split(' ').length),overflow:view.scrollWidth>view.clientWidth,segments};
  })()`)
  assert.ok(result.columns.length >= 4); assert.ok(result.columns.every(count => count === 7)); assert.equal(result.overflow, false)
  assert.ok(result.segments.every(segment => segment.inside && segment.coversDays))
  assert.deepEqual(result.segments.filter(segment => segment.id === 'same-week').map(({ first, last, span }) => ({ first, last, span })), [{ first: sameWeekStart, last: sameWeekEnd, span: 2 }])
  assert.deepEqual(result.segments.filter(segment => segment.id === 'cross-week').map(({ first, last, span }) => ({ first, last, span })), [
    { first: crossWeekStart, last: dateAfter(crossWeekStart, 2), span: 3 },
    { first: dateAfter(crossWeekStart, 3), last: crossWeekEnd, span: 2 }
  ])
  assert.deepEqual(result.segments.filter(segment => segment.id === 'cross-week').map(({ before, after }) => ({ before, after })), [{ before: false, after: true }, { before: true, after: false }])
  report.monthLayouts.push(result)
}
async function screenshot(name) {
  await until(() => evaluate(`document.fonts.status==='loaded'`))
  assert.doesNotMatch(await evaluate('document.body.innerText'), /C:\\Users\\|D:\\|\.calendar-popup-e2e-data-/i)
  const image = await protocol('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const target = path.join(directory, name)
  await fs.writeFile(target, Buffer.from(image.data, 'base64')); report.screenshots.push(target)
}

try {
  await until(async () => { try { const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); page = pages.find(candidate => candidate.url.includes('desktopModule=todos')); return Boolean(page) } catch { return false } })
  evaluate = await connect(page)
  await until(() => evaluate(`Boolean(document.querySelector('[data-tool=calendar]'))`))
  await click('[data-tool=calendar]')
  await until(() => evaluate(`Boolean(document.querySelector('.calendar-month-event[data-event-id="local-morning"]')) && Boolean(document.querySelector('.calendar-more-events'))`))
  for (const width of [300, 420]) { await resize(width); await monthLayout() }
  report.checks.push('300/420px month grids keep seven columns; a two-day event is one continuous bar and a Friday-to-Tuesday event splits into three-day/two-day weekly segments')
  assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-agenda,.calendar-editor'))`), false)
  const originalHeight = await calendarHeight()
  await click(dayButton); await popupOpen()
  await until(() => evaluate(`document.querySelectorAll('.calendar-event').length===3`))
  await layout('day')
  await screenshot('calendar-day-popup-420.png')
  await escapeFrom('[aria-label="关闭当天日程"]', dayButton)
  assert.deepEqual(await calendarHeight(), originalHeight)
  report.checks.push('date opens a bottom day drawer; Escape from its close control keeps the assistant visible, restores focus and leaves month height unchanged')

  await click('.calendar-more-events'); await popupOpen()
  await click('.calendar-dialog .calendar-event-copy[aria-label="查看日程 资料整理"]')
  await until(() => evaluate(`Boolean(document.querySelector('.calendar-event-detail'))`))
  assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-editor'))`), false)
  const detail = await evaluate(`document.querySelector('.calendar-event-detail').innerText`)
  assert.match(detail, /资料整理/); assert.match(detail, /共享书房 A 区/); assert.match(detail, /完成后记录进度/)
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.calendar-detail-times time')].map(time=>time.dateTime)`), [initial.suite.events[0].start, initial.suite.events[0].end])
  await layout('detail')
  report.detailFocus = await evaluate(`(()=>{const heading=document.querySelector('.calendar-event-detail h3');return {focused:document.activeElement===heading,outline:getComputedStyle(heading).outlineStyle}})()`)
  assert.deepEqual(report.detailFocus, { focused: true, outline: 'none' })
  await protocol('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await protocol('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  report.controlFocus = await evaluate(`(()=>{const control=document.activeElement,style=getComputedStyle(control);return {button:control.tagName==='BUTTON',visible:control.matches(':focus-visible'),outline:style.outlineStyle,width:parseFloat(style.outlineWidth)}})()`)
  assert.equal(report.controlFocus.button, true); assert.equal(report.controlFocus.visible, true)
  assert.notEqual(report.controlFocus.outline, 'none'); assert.ok(report.controlFocus.width >= 1)
  await screenshot('calendar-detail-popup-420.png')
  await click('[aria-label="编辑日程 资料整理"]')
  await until(() => evaluate(`document.querySelector('[aria-label="日程名称"]')?.value==='资料整理'`))
  await fill('[aria-label="日程名称"]', '取消的更改')
  await click('[aria-label="取消日程编辑"]'); await popupClosed()
  assert.equal(await evaluate(`window.toolbox.data.get().then(data=>data.suite.events.find(item=>item.id==='local-morning').title)`), '资料整理')
  await click('.calendar-month-event[data-event-id="local-morning"]'); await popupOpen()
  assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-event-detail')) && !document.querySelector('.calendar-editor')`), true)
  await click('[aria-label="编辑日程 资料整理"]')
  await escapeFrom('[aria-label="日程颜色：天蓝"]', '.calendar-month-event[data-event-id="local-morning"]')
  report.checks.push('more-count opens the day list, agenda and month titles open details first, editing requires its own action, and cancelling or Escape discards changes')
  report.checks.push('after Escape and reopening details, headings keep focus without a decorative outline while keyboard-focused controls retain a visible outline')

  await click('.calendar-month-event[aria-label="查看日程 订阅只读事项"]'); await popupOpen()
  assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-editor'))`), false)
  const readonly = await evaluate(`document.querySelector('.calendar-event-detail').innerText`)
  assert.match(readonly, /订阅只读事项/); assert.match(readonly, /线上公开会议室/); assert.match(readonly, /请准时查看/)
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="编辑日程 订阅只读事项"],[aria-label="删除日程 订阅只读事项"]'))`), false)
  await escapeFrom('[aria-label="关闭日程详情"]', '.calendar-month-event[aria-label="查看日程 订阅只读事项"]')
  assert.deepEqual(await calendarHeight(), originalHeight)
  report.checks.push('subscribed events show their own read-only detail drawer including location and notes, without edit/delete actions')

  for (const width of [300, 420]) {
    await resize(width)
    const height = await calendarHeight(), name = `失败重试 ${width}`
    await click(addButton); await popupOpen()
    assert.equal(await evaluate(`document.activeElement===document.querySelector('[aria-label="日程名称"]')`), true)
    await fill('[aria-label="日程名称"]', name)
    await fill('[aria-label="日程开始时间"]', `${today}T16:00`)
    await fill('[aria-label="日程结束时间"]', `${today}T17:00`)
    await fill('[aria-label="日程地点"]', `公开演示会议室 ${width}`)
    await fill('[aria-label="日程备注"]', '第一行公开备注。\n第二行安排。')
    if (width === 420) {
      await click('.calendar-all-day input')
      await fill('[aria-label="日程日期"]', today)
      await fill('[aria-label="日程结束日期"]', dateAfter(today, 2))
    }
    await click('[aria-label="日程颜色：淡紫"]')
    await layout('editor')
    await fs.writeFile(path.join(directory, 'fail-store-write'), 'fail once')
    await evaluate(`document.querySelector('.calendar-event-form').requestSubmit()`)
    await until(() => evaluate(`document.querySelector('.calendar-dialog [role=alert]')?.textContent.includes('测试磁盘写入失败') && !document.querySelector('.calendar-save').disabled`))
    await layout('failed-save')
    assert.deepEqual(await evaluate(`({name:document.querySelector('[aria-label="日程名称"]').value,color:document.querySelector('[aria-label="日程颜色：淡紫"]').getAttribute('aria-pressed'),location:document.querySelector('[aria-label="日程地点"]').value,notes:document.querySelector('[aria-label="日程备注"]').value,count:document.querySelectorAll('.calendar-event-form').length})`), { name, color: 'true', location: `公开演示会议室 ${width}`, notes: '第一行公开备注。\n第二行安排。', count: 1 })
    assert.equal(await evaluate(`window.toolbox.data.get().then(data=>data.suite.events.some(item=>item.title===${JSON.stringify(name)}))`), false)
    await screenshot(`calendar-editor-popup-${width}.png`)
    await evaluate(`document.querySelector('.calendar-event-form').requestSubmit()`)
    await popupClosed()
    assert.equal(await evaluate(`window.toolbox.data.get().then(data=>data.suite.events.filter(item=>item.title===${JSON.stringify(name)} && item.color==='#cbacf0').length)`), 1)
    if (width === 420) {
      const allDay = await evaluate(`window.toolbox.data.get().then(data=>data.suite.events.find(item=>item.title===${JSON.stringify(name)}))`)
      assert.equal(allDay.allDay, true)
      assert.equal(dateKey(new Date(allDay.start)), today)
      assert.equal(dateKey(new Date(allDay.end)), dateAfter(today, 3), 'all-day end input includes its selected final day')
    }
    assert.deepEqual(await calendarHeight(), height)
    await click(dayButton); await popupOpen()
    await click(`.calendar-event-copy[aria-label="查看日程 ${name}"]`)
    await until(() => evaluate(`Boolean(document.querySelector('.calendar-event-detail'))`))
    assert.match(await evaluate(`document.querySelector('.calendar-event-detail').innerText`), /第一行公开备注/)
    await layout('saved-detail')
    await click(`[aria-label="编辑日程 ${name}"]`)
    await until(() => evaluate(`Boolean(document.querySelector('.calendar-editor'))`))
    assert.equal(await evaluate(`document.querySelector('[aria-label="日程地点"]').value`), `公开演示会议室 ${width}`)
    await fill('[aria-label="日程地点"]', `更改后的会议室 ${width}`)
    await fill('[aria-label="日程备注"]', '编辑后保留的多行备注。\n第二项内容。')
    await evaluate(`document.querySelector('.calendar-event-form').requestSubmit()`)
    await popupClosed()
    assert.equal(await evaluate(`window.toolbox.data.get().then(data=>data.suite.events.some(item=>item.title===${JSON.stringify(name)} && item.location===${JSON.stringify(`更改后的会议室 ${width}`)} && item.notes==='编辑后保留的多行备注。\\n第二项内容。'))`), true)
    await click(addButton); await popupOpen()
    await fill('[aria-label="日程名称"]', '不保存的草稿')
    await escapeFrom('.calendar-save', addButton)
    assert.equal(await evaluate(`window.toolbox.data.get().then(data=>data.suite.events.some(item=>item.title==='不保存的草稿'))`), false)
    assert.deepEqual(await calendarHeight(), height)
  }
  report.checks.push('300/420px bottom drawers have no horizontal overflow; real disk failures retain all input, retry saves once, and location/notes survive create and edit; all-day end dates are inclusive')
  const saved = JSON.parse(await fs.readFile(path.join(directory, 'data', 'toolbox-data.json'), 'utf8'))
  assert.equal(saved.suite.events.length, 6)
  assert.deepEqual(saved.suite.sources, initial.suite.sources)
  assert.equal(saved.suite.events.find(event => event.id === 'local-morning').title, '资料整理')
  report.ok = true
} catch (error) { report.error = String(error); failure = error }
finally {
  closeAll(); await fs.writeFile(path.join(directory, 'quit'), 'quit')
  const timer = setTimeout(() => child.kill(), 15000); await exited; clearTimeout(timer)
  await fs.writeFile(path.join(directory, 'runtime.log'), logs)
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))
if (failure) throw failure
