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
const directory = await fs.mkdtemp(path.resolve('.settings-compact-e2e-data-'))
const desktop = path.join(directory, 'public-desktop'), pictures = path.join(directory, 'screenshots'), port = 9563
await fs.mkdir(path.join(directory, 'data')); await fs.mkdir(desktop); await fs.mkdir(pictures)
const files = {
  '本周工作清单.txt': '公开演示资料：整理项目文件，安排每周事项。\n',
  '项目说明.md': '# 公开演示项目\n用于展示桌面收纳。\n',
  '阅读摘记.txt': '把今天的收获留在桌面上。\n',
  '会议安排.csv': '事项,时间\n每周计划,09:00\n'
}
for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(desktop, name), content)
await fs.mkdir(path.join(desktop, '项目资料'))
await fs.copyFile(path.resolve('resources/tray-icon.png'), path.join(desktop, '桌面搭子.png'))
const windows = process.env.WINDIR || 'C:\\Windows'
const quote = value => `'${value.replaceAll("'", "''")}'`
const links = Object.entries({ '记事本.lnk': 'notepad.exe', '计算器.lnk': 'calc.exe' }).map(([name, target]) =>
  `$shortcut=$shell.CreateShortcut(${quote(path.join(desktop, name))});$shortcut.TargetPath=${quote(path.join(windows, 'System32', target))};$shortcut.Save()`)
await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$shell=New-Object -ComObject WScript.Shell;${links.join(';')}`], { windowsHide: true })

const initial = defaultData()
Object.assign(initial.settings, { desktopWidgetVersion: 5, desktopCollected: false, desktopHoverExpandEnabled: false, desktopModuleOpacity: 88, healthSoundEnabled: false, shortcuts: [], autoStart: false, hydrationReminderEnabled: false, sedentaryReminderEnabled: false })
initial.settings.hydrationPlan.enabled = true
initial.hydrationDay = { date: dateKey(Date.now()), consumedMl: 800 }
Object.assign(initial.desktopModules.find(module => module.id === 'quick'), { title: '桌面收纳', x: 480, y: 60, width: 420, height: 650, collapsed: false, visible: true })
Object.assign(initial.desktopModules.find(module => module.id === 'todos'), { x: 40, y: 60, width: 420, height: 650, collapsed: false, visible: true })
initial.desktopModules.push({ id: 'health', kind: 'health', title: '喝水与活动', visible: false, collapsed: false, x: 480, y: 710, width: 300, height: 80 })
const zoneNames = {
  'desktop-apps': '常用应用', 'desktop-folders': '项目文件夹', 'desktop-documents': '工作文档与日常资料整理',
  'desktop-images': '图片素材', 'desktop-videos': '视频文件', 'desktop-audio': '音频资料', 'desktop-system': '系统图标'
}
initial.desktopZones = Object.entries(zoneNames).map(([id, name], index) => ({ id, name, color: '#a4dbb6', opacity: 88, visible: false, collapsed: false, locked: false, x: 40 + index * 20, y: 100, width: 300, height: 200, itemIds: [], createdAt: new Date().toISOString() }))
await fs.writeFile(path.join(directory, 'data', 'toolbox-data.json'), JSON.stringify(initial))
const environment = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1', GERSON_E2E_DESKTOP_DIRECTORY: desktop }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('scripts/compact-assistant-host.cjs')], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = once(child, 'close')
let logs = '', page, collectionPage, evaluate, collection, failure
child.stdout.on('data', bytes => { logs += bytes }); child.stderr.on('data', bytes => { logs += bytes })
const report = { ok: false, directory, capturedAt: new Date().toISOString(), checks: [], layouts: [], previews: [], zones: [], collectionLayouts: [], screenshots: [], disclosure: '真实应用窗口；收纳文件与7个分区为独立公开演示资料，设备与时间实时读取。' }

async function protocol(target, method, params = {}) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    return await new Promise((resolve, reject) => {
      socket.onmessage = ({ data }) => { const response = JSON.parse(String(data)); if (response.id === 1) response.error ? reject(Error(response.error.message)) : resolve(response.result) }
      socket.send(JSON.stringify({ id: 1, method, params }))
    })
  } finally { socket.close() }
}
async function settle() { await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`) }
async function resize(id, width) {
  await fs.writeFile(path.join(directory, 'resize'), JSON.stringify({ id, width, height: 650 }))
  const target = id === 'todos' ? evaluate : collection
  await until(() => target(`innerWidth===${width} && innerHeight===650`))
}
async function clickText(selector, text) {
  await evaluate(`(()=>{const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.getClientRects().length && node.textContent.trim()===${JSON.stringify(text)});if(!button || button.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)});button.click()})()`)
}
async function select(selector, text) {
  await clickText(`${selector} button`, text)
  await until(() => evaluate(`[...document.querySelectorAll(${JSON.stringify(`${selector} button`)})].some(button=>button.textContent.trim()===${JSON.stringify(text)} && button.getAttribute('aria-pressed')==='true')`))
  await settle()
}
async function input(selector, value, event = 'change') {
  await evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});if(!field)throw Error('Input unavailable: '+${JSON.stringify(selector)});field.value=${JSON.stringify(String(value))};field.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`)
}
const get = () => evaluate('window.toolbox.data.get()')
async function screenshot(target, reader, name) {
  await until(() => reader(`document.fonts.status==='loaded'`))
  assert.doesNotMatch(await reader('document.body.innerText'), /C:\\Users\\|D:\\|\.settings-compact-e2e-data-/i)
  const result = await protocol(target, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const filename = path.join(pictures, name)
  await fs.writeFile(filename, Buffer.from(result.data, 'base64')); report.screenshots.push(filename)
}
async function layout(name) {
  const result = await evaluate(`(()=>{
    const body=document.querySelector('.settings-body'),r=body.getBoundingClientRect(),footer=document.querySelector('.settings-save-status').getBoundingClientRect();
    const navs=[...document.querySelectorAll('.settings-tabs,.desktop-settings-tabs')].filter(nav=>nav.getClientRects().length);
    return {name:${JSON.stringify(name)},width:innerWidth,overflow:body.scrollWidth>body.clientWidth+1 || document.documentElement.scrollWidth>innerWidth+1,footerClear:r.bottom<=footer.top+1,navs:navs.map(nav=>{const b=nav.getBoundingClientRect();return {top:b.top,bottom:b.bottom,outsideBody:!body.contains(nav),aboveBody:b.bottom<=r.top+1,hit:[...nav.querySelectorAll('button')].every(button=>{const c=button.getBoundingClientRect(),hit=document.elementFromPoint(c.left+c.width/2,c.top+c.height/2);return hit===button || button.contains(hit)})}}),offenders:[...body.querySelectorAll('*')].filter(node=>node.getClientRects().length && (node.getBoundingClientRect().right>r.right+1 || node.getBoundingClientRect().left<r.left-1)).slice(0,8).map(node=>({tag:node.tagName,class:String(node.className),text:node.textContent.slice(0,45)}))};
  })()`)
  assert.equal(result.overflow, false, JSON.stringify(result)); assert.equal(result.footerClear, true)
  assert.deepEqual(result.offenders, [], JSON.stringify(result.offenders))
  for (const nav of result.navs) { assert.equal(nav.outsideBody, true); assert.equal(nav.aboveBody, true); assert.equal(nav.hit, true) }
  report.layouts.push(result)
  return result
}
async function scrollLayout(name) {
  const before = await layout(name + '/top')
  await evaluate(`document.querySelector('.settings-body').scrollTop=document.querySelector('.settings-body').scrollHeight`)
  await settle()
  const after = await layout(name + '/bottom')
  assert.deepEqual(after.navs.map(({ top, bottom }) => ({ top, bottom })), before.navs.map(({ top, bottom }) => ({ top, bottom })))
  await evaluate(`document.querySelector('.settings-body').scrollTop=0`); await settle()
}
async function previewLayout() {
  const result = await evaluate(`(()=>{const preview=document.querySelector('.appearance-preview'),grid=preview.querySelector('.preview-widgets'),widgets=[...grid.children],rect=preview.getBoundingClientRect();return {width:innerWidth,height:rect.height,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,font:preview.style.getPropertyValue('--preview-font'),sameRow:Math.abs(widgets[0].getBoundingClientRect().top-widgets[1].getBoundingClientRect().top)<1,overflow:widgets.some(widget=>widget.scrollWidth>widget.clientWidth+1),widgets:widgets.map(widget=>({width:widget.clientWidth,scrollWidth:widget.scrollWidth,font:getComputedStyle(widget).fontSize,color:getComputedStyle(widget).color}))}})()`)
  assert.equal(result.columns, 2); assert.equal(result.sameRow, true); assert.equal(result.overflow, false)
  assert.ok(result.height<=180, JSON.stringify(result)); assert.equal(result.font, '20px')
  assert.ok(result.widgets.every(widget=>widget.font==='20px' && widget.color==='rgb(232, 244, 238)'))
  report.previews.push(result)
}
async function zoneLayout() {
  const result = await evaluate(`(()=>{return {width:innerWidth,rows:[...document.querySelectorAll('.compact-zone-row')].map(row=>{
    const r=row.getBoundingClientRect(),title=row.querySelector('h3'),count=row.querySelector('small');
    const cells=[row.querySelector('.zone-identity>svg'),title,count,row.querySelector('[role=switch]'),row.querySelector('summary')].map(node=>{const c=node.getBoundingClientRect();return {left:c.left,right:c.right,center:c.top+c.height/2}});
    return {name:title.textContent,height:r.height,inside:cells.every(cell=>cell.left>=r.left-.5 && cell.right<=r.right+.5),bounds:{left:r.left,right:r.right},cells,centers:cells.map(cell=>cell.center),oneLine:title.getBoundingClientRect().height<=parseFloat(getComputedStyle(title).lineHeight)+1,count:count.textContent,tooltip:title.title};
  })}})()`)
  report.zones.push(result)
  assert.equal(result.rows.length, 7)
  const savedZones=(await get()).desktopZones
  for (const row of result.rows) { assert.ok(row.height<=46, JSON.stringify(row)); assert.equal(row.inside, true, JSON.stringify(row)); assert.equal(row.oneLine, true); assert.equal(row.tooltip, row.name); assert.equal(row.count,savedZones.find(zone=>zone.name===row.name).itemIds.length+' 项'); assert.ok(Math.max(...row.centers)-Math.min(...row.centers)<1.1, JSON.stringify(row)) }
}

try {
  let pages
  await until(async () => { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); page = pages.find(target=>target.url.includes('desktopModule=todos')); collectionPage = pages.find(target=>target.url.includes('desktopModule=quick')); return Boolean(page && collectionPage) } catch { return false } })
  evaluate = await connect(page); collection = await connect(collectionPage)
  await until(() => evaluate(`Boolean(document.querySelector('[aria-label="设置"]'))`))
  await evaluate(`document.querySelector('[aria-label="设置"]').click()`)
  await until(() => evaluate(`Boolean(document.querySelector('.settings-body'))`))
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.settings-tabs button')].map(button=>button.textContent.trim())`), ['健康', '外观', '桌面'])
  await select('.settings-tabs', '外观')
  const oldOpacity = (await get()).settings.desktopModuleOpacity
  await input('#widget-transparency', 62, 'input')
  assert.equal(await evaluate(`Number(document.querySelector('.appearance-preview').style.getPropertyValue('--preview-opacity'))`), 0.38)
  assert.equal((await get()).settings.desktopModuleOpacity, oldOpacity)
  await input('#widget-transparency', 62)
  await until(async () => (await get()).settings.desktopModuleOpacity===38)
  for (const [label, value, field, variable] of [['组件背景颜色','#25312b','background','--preview-background'],['组件文字颜色','#e8f4ee','textColor','--preview-text'],['组件字号',20,'fontSize','--preview-font']]) {
    await input(`[aria-label="${label}"]`, value, 'input')
    assert.equal(await evaluate(`document.querySelector('.appearance-preview').style.getPropertyValue(${JSON.stringify(variable)})`), field==='fontSize' ? `${value}px` : value)
    await input(`[aria-label="${label}"]`, value)
    await until(async () => String((await get()).suite[field])===String(value))
  }
  await fs.writeFile(path.join(directory, 'fail-store-write'), 'fail once')
  await input('[aria-label="组件背景颜色"]', '#28302f', 'input'); await input('[aria-label="组件背景颜色"]', '#28302f')
  await until(() => evaluate(`document.querySelector('.appearance-controls [role=alert]')?.textContent.includes('磁盘写入失败')`))
  assert.equal((await get()).suite.background, '#25312b')
  assert.equal(await evaluate(`document.querySelector('[aria-label="组件背景颜色"]').value`), '#28302f')
  await clickText('.appearance-controls button', '重试')
  await until(async () => (await get()).suite.background==='#28302f')
  await input('[aria-label="组件背景颜色"]', '#25312b', 'input'); await input('[aria-label="组件背景颜色"]', '#25312b')
  await until(async () => (await get()).suite.background==='#25312b')
  report.checks.push('appearance updates its preview before release, saves opacity/color/font on change, and retains a failed disk-write draft for successful retry')

  await select('.settings-tabs', '桌面'); await select('.desktop-settings-tabs', '备份')
  for (let index=0; index<4; index++) {
    await clickText('[aria-label="桌面设置"] button', '保存当前布局')
    await until(async () => (await get()).widgetLayouts.length===index+1)
    await until(() => evaluate(`[...document.querySelectorAll('[aria-label="桌面设置"] button')].some(button=>button.textContent.trim()==='保存当前布局' && !button.disabled)`))
  }
  for (const width of [300, 420]) {
    await resize('todos', width)
    for (const section of ['健康', '外观']) {
      await select('.settings-tabs', section); await scrollLayout(section)
      if (section==='外观') await previewLayout()
    }
    await select('.settings-tabs', '桌面')
    for (const group of ['组件', '收纳', '备份', '数据']) {
      await select('.desktop-settings-tabs', group)
      if (group==='组件') {
        const actions=await evaluate("[...document.querySelectorAll('.desktop-actions button')].map(button=>({text:button.textContent.trim(),label:button.getAttribute('aria-label')}))")
        assert.equal(actions.length,2)
        assert.ok(actions.every(action=>action.label?.includes(action.text)))
      }
      if (group==='收纳') {
        if (await evaluate(`document.querySelector('.organizer-compact .view-all').getAttribute('aria-expanded')!=='true'`)) await clickText('.organizer-compact .view-all', '查看全部 7 个分区')
        await zoneLayout()
      }
      await scrollLayout(`桌面/${group}`)
    }
  }
  report.checks.push('300/420px keep three primary pages and all four desktop groups within width; both navigation rows remain fixed, clickable and unobscured during scrolling')
  report.checks.push('20px previews keep two columns within 180px; seven expanded zones use a single compact row with counts and controls aligned')

  await select('.desktop-settings-tabs', '收纳')
  const zoneSelector='[aria-label="显示分区：工作文档与日常资料整理"]'
  const visible = (await get()).desktopZones.find(zone=>zone.id==='desktop-documents').visible
  await evaluate(`document.querySelector(${JSON.stringify(zoneSelector)}).click()`)
  await until(async () => (await get()).desktopZones.find(zone=>zone.id==='desktop-documents').visible!==visible)
  await evaluate(`document.querySelector(${JSON.stringify(zoneSelector)}).click()`)
  await until(async () => (await get()).desktopZones.find(zone=>zone.id==='desktop-documents').visible===visible)
  await evaluate(`document.querySelector('.compact-zone-row summary').click()`)
  assert.equal(await evaluate(`document.querySelector('.compact-zone-row .item-menu').open`), true)
  const menu = await evaluate(`(()=>{const menu=document.querySelector('.compact-zone-row .item-menu-actions'),r=menu.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+12);return {inside:r.left>=0 && r.right<=innerWidth,hit:menu.contains(hit),items:[...menu.querySelectorAll('button')].map(button=>button.textContent.trim())}})()`)
  assert.equal(menu.inside, true); assert.equal(menu.hit, true); assert.deepEqual(menu.items, ['添加文件','解散分区'])
  await evaluate(`document.querySelector('.compact-zone-row summary').focus()`)
  await protocol(page, 'Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 })
  await protocol(page, 'Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 })
  assert.equal(await evaluate(`document.querySelector('.compact-zone-row .item-menu').open`), false)
  assert.equal(await evaluate('document.visibilityState'), 'visible')
  report.checks.push('zone visibility switches persist; the more menu is reachable and Escape closes it while leaving settings open')

  await select('.settings-tabs', '外观')
  await input('[aria-label="组件字号"]', 15, 'input'); await input('[aria-label="组件字号"]', 15)
  await input('#widget-transparency', 12, 'input'); await input('#widget-transparency', 12)
  await until(async () => { const data=await get();return data.suite.fontSize===15 && data.settings.desktopModuleOpacity===88 })
  await until(() => collection(`document.querySelectorAll('.file-item').length===8`))
  const inventory=await get()
  assert.equal(inventory.desktopZones.length, 7)
  assert.ok(inventory.desktopItems.every(item=>path.dirname(item.path)===desktop))
  for (const width of [300,420]) {
    await resize('quick', width)
    const result=await collection(`(()=>{const grid=document.querySelector('.collection-files'),search=document.querySelector('.collection-search'),r=search.getBoundingClientRect();return {width:innerWidth,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth>innerWidth || grid.scrollWidth>grid.clientWidth,cardHeights:[...grid.children].map(card=>card.getBoundingClientRect().height),icons:[...grid.querySelectorAll('.file-item>img,.file-item>[data-icon-fallback]')].map(icon=>({width:icon.getBoundingClientRect().width,height:icon.getBoundingClientRect().height})),searchInside:r.left>=0 && r.right<=innerWidth}})()`)
    assert.equal(result.columns,3);assert.equal(result.overflow,false);assert.equal(result.searchInside,true)
    assert.ok(result.cardHeights.every(height=>height>=76 && height<=80))
    assert.ok(result.icons.every(icon=>icon.width===32 && icon.height===32))
    report.collectionLayouts.push(result)
    await collection(`(()=>{const input=document.querySelector('[aria-label="搜索当前分类"]');input.value='项目';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await until(() => collection(`document.querySelectorAll('.file-item').length===2`))
    const clear=await collection(`(()=>{const button=document.querySelector('[aria-label="清除搜索"]'),search=document.querySelector('.collection-search').getBoundingClientRect(),r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,inside:r.width===22 && r.height===22 && r.right<=search.right && r.top>=search.top && r.bottom<=search.bottom,hit:hit===button || button.contains(hit)}})()`)
    assert.equal(clear.inside,true);assert.equal(clear.hit,true)
    await protocol(collectionPage,'Input.dispatchMouseEvent',{type:'mousePressed',x:clear.x,y:clear.y,button:'left',clickCount:1})
    await protocol(collectionPage,'Input.dispatchMouseEvent',{type:'mouseReleased',x:clear.x,y:clear.y,button:'left',clickCount:1})
    await until(() => collection(`document.querySelectorAll('.file-item').length===8`))
  }
  report.checks.push('collection keeps three compact columns, 32px icons and usable single-row search/clear controls at 300/420px using eight real public files')
  for (const width of [300,420]) {
    await resize('todos',width)
    for (const [section,group,name] of [['外观',null,'appearance'],['桌面','收纳','organizer'],['桌面','组件','components'],['健康',null,'health']]) {
      await select('.settings-tabs',section);if(group)await select('.desktop-settings-tabs',group)
      await evaluate(`document.querySelector('.settings-body').scrollTop=0`);await settle()
      await screenshot(page,evaluate,`settings-${name}${width===300 ? '-300' : ''}.png`)
    }
    await resize('quick',width);await screenshot(collectionPage,collection,`collection${width===300 ? '-300' : ''}.png`)
  }
  const saved=JSON.parse(await fs.readFile(path.join(directory,'data','toolbox-data.json'),'utf8'))
  assert.equal(saved.settings.autoStart,false);assert.deepEqual(saved.settings.shortcuts,[]);assert.equal(saved.fileOperations.length,0)
  assert.equal(saved.suite.background,'#25312b');assert.equal(saved.suite.textColor,'#e8f4ee');assert.equal(saved.suite.fontSize,15);assert.equal(saved.settings.desktopModuleOpacity,88)
  for(const [name,content] of Object.entries(files))assert.equal(await fs.readFile(path.join(desktop,name),'utf8'),content)
  report.ok=true
} catch(error) { report.error=String(error);failure=error }
finally {
  closeAll();await fs.writeFile(path.join(directory,'quit'),'quit')
  const timer=setTimeout(()=>child.kill(),15000);await exited;clearTimeout(timer)
  await fs.writeFile(path.join(directory,'runtime.log'),logs)
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2))
}
console.log(JSON.stringify(report))
if(failure)throw failure
