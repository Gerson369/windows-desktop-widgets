import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { connect, until, closeAll } from '../scripts/cdp-check-client.mjs'

const require = createRequire(import.meta.url)
const { loadTypeScript } = require('./load-typescript.cjs')
const { defaultData } = loadTypeScript('src/main/types.ts')
const { dateKey } = loadTypeScript('src/main/widget-suite.ts')
const directory = await fs.mkdtemp(path.resolve('.ui-gallery-e2e-data-'))
const desktop = path.join(directory, 'public-desktop')
const pictures = path.join(directory, 'screenshots')
const port = 9544
const today = dateKey(Date.now())
await fs.mkdir(path.join(directory, 'data'))
await fs.mkdir(desktop)
await fs.mkdir(pictures)

// Use real files and shortcuts without exposing the user's desktop inventory.
for (const [name, content] of Object.entries({
  '本周工作清单.txt': '本文件用于桌面搭子真实界面演示。\n整理工作资料\n安排本周事项\n',
  '项目说明.md': '# 公开演示项目\n用于展示文件分类和置顶操作。\n',
  '阅读摘记.txt': '演示资料：记录今天读到的一句话。\n'
})) await fs.writeFile(path.join(desktop, name), content)
await fs.mkdir(path.join(desktop, '项目资料'))
await fs.copyFile(path.resolve('resources/tray-icon.png'), path.join(desktop, '桌面搭子.png'))
const windows = process.env.WINDIR || 'C:\\Windows'
const quote = value => `'${value.replaceAll("'", "''")}'`
const shortcutCommands = Object.entries({ '记事本.lnk': 'notepad.exe', '计算器.lnk': 'calc.exe', '文件资源管理器.lnk': 'explorer.exe' }).map(([name, target]) =>
  `$shortcut=$shell.CreateShortcut(${quote(path.join(desktop, name))});$shortcut.TargetPath=${quote(path.join(windows, target === 'explorer.exe' ? '' : 'System32', target))};$shortcut.Save()`)
await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$shell=New-Object -ComObject WScript.Shell;${shortcutCommands.join(';')}`], { windowsHide: true })

const initial = defaultData()
Object.assign(initial.settings, {
  desktopWidgetVersion: 5, desktopCollected: false, desktopHoverExpandEnabled: false,
  desktopModuleOpacity: 88, healthSoundEnabled: false, shortcuts: [],
  hydrationReminderEnabled: true, hydrationIntervalMinutes: 15,
  sedentaryReminderEnabled: true, sedentaryIntervalMinutes: 60,
  hydrationPlan: { ...initial.settings.hydrationPlan, enabled: false, start: '00:00', end: '23:59' }
})
Object.assign(initial.desktopModules.find(item => item.id === 'quick'), { x: 460, y: 80, width: 380, height: 530, collapsed: false })
Object.assign(initial.desktopModules.find(item => item.id === 'todos'), { x: 40, y: 80, width: 420, height: 650, collapsed: false })
initial.desktopModules.push({ id: 'health', kind: 'health', title: '喝水与活动', visible: true, collapsed: false, x: 460, y: 610, width: 300, height: 80 })
initial.hydrationDay = { date: today, consumedMl: 0 }
await fs.writeFile(path.join(directory, 'data', 'toolbox-data.json'), JSON.stringify(initial))

const env = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1', GERSON_E2E_DESKTOP_DIRECTORY: desktop }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('scripts/compact-assistant-host.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = once(child, 'close')
let logs = '', assistant, collection, health, assistantPage
child.stdout.on('data', bytes => { logs += bytes }); child.stderr.on('data', bytes => { logs += bytes })
const report = { ok: false, directory, capturedAt: new Date().toISOString(), today, checks: [], screenshots: [], layoutIssues: [], disclosure: '真实运行的应用窗口；演示文件、待办、便签和日程由脚本实际创建，时钟和设备数据实时读取；没有模拟天气、设备或时间。' }
const check = message => { report.checks.push(message); console.log(message) }

async function protocol(page, method, params = {}) {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    return await new Promise((resolve, reject) => {
      ws.onmessage = ({ data }) => { const reply = JSON.parse(String(data)); if (reply.id === 1) reply.error ? reject(Error(reply.error.message)) : resolve(reply.result) }
      ws.send(JSON.stringify({ id: 1, method, params }))
    })
  } finally { ws.close() }
}
async function screenshot(page, evaluate, name) {
  await until(() => evaluate(`document.fonts.status === 'loaded'`))
  const text = await evaluate('document.body.innerText')
  assert.doesNotMatch(text, /C:\\Users\\|\.ui-gallery-e2e-data-|D:\\/i, 'published screenshots must not display local/private paths')
  const shot = await protocol(page, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const target = path.join(pictures, name)
  await fs.writeFile(target, Buffer.from(shot.data, 'base64'))
  report.screenshots.push(target)
}
async function fill(evaluate, selector, value) {
  await evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Input unavailable: '+${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`)
}
async function tool(id) {
  await assistant(`document.querySelector('[data-tool="${id}"]').click()`)
  await until(() => assistant(`document.querySelector('[data-tool="${id}"]').getAttribute('aria-selected')==='true' && document.querySelector('[role=tabpanel]').getAttribute('aria-label')`))
}
async function resize(width, height = 650) {
  await fs.writeFile(path.join(directory, 'resize'), JSON.stringify({ id: 'todos', width, height }))
  await until(() => assistant(`innerWidth===${width} && innerHeight===${height}`))
}
async function addTodo(title) {
  await fill(assistant, '[aria-label="新增待办"]', title)
  await assistant(`document.querySelector('.todo-create').requestSubmit()`)
  await until(() => assistant(`window.toolbox.data.get().then(data=>data.todos.some(item=>item.title===${JSON.stringify(title)}))`))
}

try {
  let pages
  await until(async () => { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return ['quick', 'todos', 'health'].every(id => pages.some(page => page.url.includes('desktopModule=' + id))) } catch { return false } })
  const collectionPage = pages.find(page => page.url.includes('desktopModule=quick'))
  assistantPage = pages.find(page => page.url.includes('desktopModule=todos'))
  const healthPage = pages.find(page => page.url.includes('desktopModule=health'))
  assistant = await connect(assistantPage); collection = await connect(collectionPage); health = await connect(healthPage)
  await until(() => assistant(`/\\d+(?:\\.\\d+)?%/.test(document.querySelector('.device-cpu b')?.textContent || '')`))
  report.liveCpu = await assistant(`document.querySelector('.device-cpu b').textContent`)
  await assistant(`document.querySelector('#overview-weather').click()`)
  await until(() => assistant(`Boolean(document.querySelector('[aria-label="搜索天气城市"]'))`))
  await fill(assistant, '[aria-label="搜索天气城市"]', '广州')
  await assistant(`document.querySelector('[aria-label="搜索天气城市"]').closest('form').requestSubmit()`)
  await until(() => assistant(`Boolean(document.querySelector('.city-result')) || Boolean(document.querySelector('.suite-content [role=alert]'))`))
  const weatherCity = await assistant(`(() => {const city=[...document.querySelectorAll('.city-result')].find(button=>/广州|Guangzhou/i.test(button.textContent));if(!city)return false;city.click();return true})()`)
  if (weatherCity) {
    await until(() => assistant(`window.toolbox.data.get().then(data=>data.suite.cities.length===1)`))
    await until(() => assistant(`Boolean(document.querySelector('.weather-current')) || Boolean(document.querySelector('.weather-city [role=alert]'))`))
  }
  assert.equal(weatherCity, true, 'Guangzhou must be saved through the actual search UI')
  if (!await assistant(`Boolean(document.querySelector('.weather-current'))`)) {
    await assistant(`Array.from(document.querySelectorAll('.suite-content button')).find(button=>button.textContent.trim()==='刷新天气')?.click()`)
    await until(() => assistant(`Boolean(document.querySelector('.weather-current'))`))
  }
  report.weatherReading = await assistant(`(async()=>{const data=await window.toolbox.data.get();return window.toolbox.suite.weather(data.suite.cities[0].id)})()`)
  assert.ok(Number.isFinite(report.weatherReading.temperature))
  assert.equal(report.weatherReading.days.length, 3)
  assert.notEqual(report.weatherReading.stale, true)
  await screenshot(assistantPage, assistant, 'weather.png')
  report.liveWeather = await assistant(`document.querySelector('#overview-weather').innerText`)
  await tool('todos')
  check('overview waits for a real CPU sample and tries Guangzhou through the actual city-search UI without injected readings')
  await until(() => collection(`document.querySelectorAll('.file-item').length===8`))
  const realInventory = await collection('window.toolbox.data.get().then(data=>data.desktopItems.map(item=>item.path))')
  assert.equal(realInventory.length, 8)
  assert.ok(realInventory.every(filename => path.dirname(filename) === desktop))
  check('collection scans eight real public sample files/shortcuts and contains no user desktop inventory')
  const pinned = path.join(desktop, '记事本.lnk')
  await collection(`document.querySelector('.file-item[data-path='+CSS.escape(${JSON.stringify(pinned)})+']').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:90,clientY:180}))`)
  await until(() => collection(`Boolean(document.querySelector('[data-menu-action=pin]'))`))
  await collection(`document.querySelector('[data-menu-action=pin]').click()`)
  await until(() => collection(`document.querySelector('.file-item')?.classList.contains('pinned')`))
  await screenshot(collectionPage, collection, 'collection.png')
  check('real right-click pin action persists and moves Notepad ahead of unpinned files')

  await until(() => assistant(`Boolean(document.querySelector('[aria-label="新增待办"]'))`))
  for (const title of ['检查新版桌面布局', '整理下周项目资料', '完成一次专注阅读']) await addTodo(title)
  await assistant(`document.querySelector('.todo-checkbox').click()`)
  await until(() => assistant(`window.toolbox.data.get().then(data=>data.todos.filter(item=>item.completed).length===1)`))
  await screenshot(assistantPage, assistant, 'todos.png')
  check('todo form creates three saved tasks and completion updates the real data store')

  await tool('calendar')
  await resize(420, 720)
  await until(() => assistant(`Boolean(document.querySelector('[aria-label="添加日程"]'))`))
  for (const [name, start, end, color] of [
    ['资料整理', '09:00', '10:00', '天蓝'],
    ['午后散步', '14:00', '14:30', '薄荷绿'],
    ['阅读复盘', '20:00', '21:00', '淡紫']
  ]) {
    await assistant(`document.querySelector('[aria-label="添加日程"]').click()`)
    await until(() => assistant(`Boolean(document.querySelector('.calendar-event-form'))`))
    await fill(assistant, '[aria-label="日程名称"]', name)
    await fill(assistant, '[aria-label="日程开始时间"]', `${today}T${start}`)
    await fill(assistant, '[aria-label="日程结束时间"]', `${today}T${end}`)
    await assistant(`document.querySelector('[aria-label="日程颜色：${color}"]').click();document.querySelector('.calendar-event-form').requestSubmit()`)
    await until(() => assistant(`!document.querySelector('.calendar-editor') && window.toolbox.data.get().then(data=>data.suite.events.some(item=>item.title===${JSON.stringify(name)}))`))
  }
  await until(() => assistant(`document.querySelectorAll('.calendar-event').length===3`))
  const calendar = await assistant(`(() => {const rows=[...document.querySelectorAll('.calendar-event')];return {today:document.querySelector('.calendar-grid [aria-current=date]').getAttribute('aria-label'),colors:rows.map(row=>getComputedStyle(row).getPropertyValue('--event-color').trim()),names:rows.map(row=>row.querySelector('b').textContent)}})()`)
  assert.equal(calendar.today, today)
  assert.equal(new Set(calendar.colors).size, 3)
  const examples = [3,8,16,25,28].filter(day=>day!==new Date().getDate()).slice(0,4).map((day,index)=>{
    const date=today.slice(0,8)+String(day).padStart(2,'0')
    return {id:'month-example-'+day,title:['整理账单','周末采购','项目讨论','读书计划'][index],start:new Date(date+'T10:00:00').toISOString(),end:new Date(date+'T11:00:00').toISOString(),allDay:false,category:'personal',color:['#e7b37b','#8ab9f1','#86d6cd','#eea1b6'][index]}
  })
  await assistant(`(async()=>{const data=await window.toolbox.data.get();await window.toolbox.suite.save({events:[...data.suite.events,...${JSON.stringify(examples)}]})})()`)
  await until(()=>assistant(`document.querySelectorAll('.calendar-month-event').length>=6`))
  report.monthLayouts=[]
  for (const width of [300,420]) {
    await resize(width,720)
    const layout=await assistant(`(()=>{const grid=document.querySelector('.calendar-grid'),view=document.querySelector('.calendar-month-scroll'),day=document.querySelector('.calendar-day[data-date="${today}"]');return {width:innerWidth,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:view.scrollWidth>view.clientWidth,badges:day.querySelectorAll('.calendar-month-event').length,more:day.querySelector('.calendar-more-events')?.textContent}})()`)
    assert.equal(layout.columns,7);assert.equal(layout.overflow,false);assert.equal(layout.badges,2);assert.match(layout.more,/1/)
    report.monthLayouts.push(layout)
  }
  await resize(420)
  await assistant(`document.querySelector('.suite-content').scrollTo(0,0)`)
  report.calendarAgenda = await assistant(`(() => {const content=document.querySelector('.suite-content').getBoundingClientRect();return {width:innerWidth,height:innerHeight,viewportBottom:content.bottom,rows:[...document.querySelectorAll('.calendar-event')].map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}))}})()`)
  await resize(420, 720)
  await screenshot(assistantPage, assistant, 'calendar-agenda.png')
  await assistant(`document.querySelector('[aria-label="编辑日程 阅读复盘"]').click()`)
  await until(() => assistant(`Boolean(document.querySelector('.calendar-editor'))`))
  await fill(assistant, '[aria-label="日程名称"]', '阅读与复盘')
  await assistant(`document.querySelector('.calendar-editor').scrollIntoView({block:'start'})`)
  report.calendarEditors = []
  for (const width of [300, 420]) {
    await resize(width)
    await assistant(`document.querySelector('.calendar-editor').scrollIntoView({block:'start'})`)
    const form = await assistant(`(() => {const editor=document.querySelector('.calendar-editor'),fields=[...document.querySelectorAll('.calendar-event-form>label')].map(node=>node.getBoundingClientRect());return {windowWidth:innerWidth,vertical:fields.every((field,index)=>index===0||field.top>=fields[index-1].bottom),overflow:editor.scrollWidth>editor.clientWidth,checkboxWidth:editor.querySelector('input[type=checkbox]').getBoundingClientRect().width,width:editor.clientWidth,scrollWidth:editor.scrollWidth,controls:[...editor.querySelectorAll('input,select,button')].map(input=>({label:input.getAttribute('aria-label')||input.textContent,clientWidth:input.clientWidth,width:input.getBoundingClientRect().width,right:input.getBoundingClientRect().right,boxSizing:getComputedStyle(input).boxSizing}))}})()`)
    assert.equal(form.vertical, true)
    assert.ok(Math.abs(form.checkboxWidth - 14) < 1)
    report.calendarEditors.push(form)
    if (form.overflow) report.layoutIssues.push(`Calendar editor overflows at ${width}px`)
  }
  await screenshot(assistantPage, assistant, 'calendar-editor.png')
  await assistant(`document.querySelector('.calendar-event-form').requestSubmit()`)
  await until(() => assistant(`!document.querySelector('.calendar-editor') && window.toolbox.data.get().then(data=>data.suite.events.some(item=>item.title==='阅读与复盘' && item.color==='#cbacf0'))`))
  check('calendar creates and edits three real events for today with three persisted colors and a vertical editor')

  await tool('countdown')
  await until(() => assistant(`Boolean(document.querySelector('.holiday-grid'))`))
  const future = new Date(); future.setDate(future.getDate() + 18)
  await fill(assistant, '[aria-label="重要日期名称"]', '项目交付日')
  await fill(assistant, '[aria-label="重要日期"]', dateKey(future))
  await assistant(`document.querySelector('[aria-label="重要日期名称"]').closest('form').requestSubmit()`)
  await until(() => assistant(`window.toolbox.data.get().then(data=>data.suite.countdowns.some(item=>item.title==='项目交付日'))`))
  report.holidayLayouts = []
  for (const width of [300, 420]) {
    await resize(width)
    const layout = await assistant(`(() => {const grid=document.querySelector('.holiday-grid');return {width:innerWidth,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,cards:grid.querySelectorAll('.holiday-card').length,overflow:document.body.scrollWidth>innerWidth}})()`)
    assert.equal(layout.columns, 3)
    assert.equal(layout.overflow, false)
    assert.ok(layout.cards >= 6)
    report.holidayLayouts.push(layout)
  }
  await resize(300, 720)
  await screenshot(assistantPage, assistant, 'countdown.png')
  check('holiday grid keeps three compact columns and custom countdown saves through the real form')

  await tool('notes')
  await resize(420)
  await until(() => assistant(`Boolean(document.querySelector('[aria-label="新便签标题"]'))`))
  await fill(assistant, '[aria-label="新便签标题"]', '今天的小计划')
  await assistant(`document.querySelector('[aria-label="新便签标题"]').closest('form').requestSubmit()`)
  await until(() => assistant(`Boolean(document.querySelector('[aria-label="便签内容"]'))`))
  await fill(assistant, '[aria-label="便签内容"]', '把重要的事留在桌面上。\n\n• 先完成一个小目标\n• 工作间隙喝几口水\n• 晚上整理今天的收获')
  await assistant(`document.querySelector('[aria-label="便签内容"]').dispatchEvent(new FocusEvent('blur'))`)
  await until(() => assistant(`window.toolbox.data.get().then(data=>data.notes.some(item=>item.content.includes('先完成一个小目标')))`))
  await screenshot(assistantPage, assistant, 'notes.png')
  check('notes are created and edited in the actual UI, then saved to the isolated data file')

  await assistant(`document.querySelector('[aria-label="设置"]').click()`)
  await until(() => assistant(`Boolean(document.querySelector('.settings-panel'))`))
  await screenshot(assistantPage, assistant, 'settings.png')
  await screenshot(healthPage, health, 'health.png')
  check('health/settings captures use the actual elapsed clock and live application state')

  const persisted = JSON.parse(await fs.readFile(path.join(directory, 'data', 'toolbox-data.json'), 'utf8'))
  assert.equal(persisted.todos.length, 3)
  assert.equal(persisted.notes.length, 1)
  assert.equal(persisted.suite.events.length, 7)
  assert.ok(persisted.desktopPinnedPaths.includes(pinned))
  assert.equal(await fs.access(path.join(directory, 'service-fixtures.json')).then(() => true, () => false), false)
  assert.equal(await fs.access(path.join(directory, 'clock')).then(() => true, () => false), false)
  assert.deepEqual(report.layoutIssues, [])
  report.ok = true
} catch (error) { report.error = String(error); console.error(logs); throw error }
finally {
  closeAll()
  await fs.writeFile(path.join(directory, 'quit'), 'quit')
  const timer = setTimeout(() => child.kill(), 15000); await exited; clearTimeout(timer)
  await fs.writeFile(path.join(directory, 'runtime.log'), logs)
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
