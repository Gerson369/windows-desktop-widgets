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
const directory = await fs.mkdtemp(path.resolve('.collection-pins-e2e-data-'))
const port = 9539
const env = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1' }
delete env.ELECTRON_RUN_AS_NODE
await fs.mkdir(path.join(directory, 'data'))
await fs.mkdir(path.join(directory, 'references'))
await fs.writeFile(path.join(directory, 'capture-open-path'), '1')

const fixture = defaultData()
Object.assign(fixture.settings, { desktopWidgetVersion: 5, desktopHoverExpandEnabled: false })
Object.assign(fixture.desktopModules.find(module => module.id === 'quick'), { x: 400, y: 90, width: 360, height: 480, collapsed: false })
Object.assign(fixture.desktopModules.find(module => module.id === 'todos'), { visible: false })
await fs.writeFile(path.join(directory, 'data', 'toolbox-data.json'), JSON.stringify(fixture))
const files = Object.fromEntries(['A-app.lnk', 'Z-daily-app.lnk', 'A-image.png', 'Z-favorite.png', 'A-note.txt', 'Z-note.txt'].map(name => [name, path.join(directory, 'references', name)]))
for (const [name, target] of Object.entries(files)) {
  const content = name.endsWith('.png') ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xoAAAAAASUVORK5CYII=', 'base64') : name.endsWith('.txt') ? 'isolated collection opening check' : 'placeholder shortcut; never executed'
  await fs.writeFile(target, content)
}

const report = { ok: false, directory, checks: [] }
const check = message => { report.checks.push(message); console.log(message) }
let session

async function start() {
  await fs.rm(path.join(directory, 'quit'), { force: true })
  const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('scripts/compact-assistant-host.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'close')
  session = { child, exited, logs: '' }
  child.stdout.on('data', bytes => { session.logs += bytes })
  child.stderr.on('data', bytes => { session.logs += bytes })
  let targets
  await until(async () => {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return targets.some(page => page.url.includes('desktopModule=quick')) }
    catch { return false }
  })
  const page = targets.find(page => page.url.includes('desktopModule=quick'))
  const evaluate = await connect(page)
  await until(() => evaluate('Boolean(document.querySelector(".collection-tabs [data-tab=all]"))'))
  return { evaluate, page }
}

async function stop() {
  if (!session) return
  closeAll()
  await fs.writeFile(path.join(directory, 'quit'), 'quit')
  const timer = setTimeout(() => session.child.kill(), 15000)
  await session.exited
  clearTimeout(timer)
  await fs.appendFile(path.join(directory, 'runtime.log'), session.logs)
  session = undefined
}

async function screenshot(page, name) {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    const result = await new Promise((resolve, reject) => {
      ws.onmessage = ({ data }) => { const result = JSON.parse(String(data)); if (result.id === 1) result.error ? reject(Error(result.error.message)) : resolve(result.result) }
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
    })
    await fs.writeFile(path.join(directory, name), Buffer.from(result.data, 'base64'))
  } finally { ws.close() }
}

async function selectTab(evaluate, tab) {
  await evaluate(`document.querySelector('[data-tab=${tab}]').click()`)
  await until(() => evaluate(`document.querySelector('[data-tab=${tab}]').getAttribute('aria-pressed') === 'true'`))
}

async function menuPin(evaluate, target, pinned) {
  await evaluate(`document.querySelector('.file-item[data-path='+CSS.escape(${JSON.stringify(target)})+']').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:80,clientY:180}))`)
  await until(() => evaluate(`document.querySelector('[data-menu-action=pin]')?.textContent.trim() === ${JSON.stringify(pinned ? '置顶' : '取消置顶')}`))
  await evaluate(`document.querySelector('[data-menu-action=pin]').click()`)
  await until(() => evaluate(`window.toolbox.data.get().then(data => data.desktopPinnedPaths.includes(${JSON.stringify(target)}) === ${pinned})`))
}

async function verifyCompactTabs(evaluate, page) {
  report.layouts = []
  for (const width of [300, 360, 420]) {
    await fs.writeFile(path.join(directory, 'resize'), JSON.stringify({ id: 'quick', width, height: 480 }))
    await until(() => evaluate(`innerWidth === ${width}`))
    for (const largeCounts of [false, true]) {
      const layout = await evaluate(`(() => {
        const nav = document.querySelector('.collection-tabs'), navRect = nav.getBoundingClientRect();
        const counts = [...nav.querySelectorAll('small')], original = counts.map(node => node.textContent);
        if (${largeCounts}) counts.forEach(node => { node.textContent = '99999' });
        const tabs = [...nav.querySelectorAll('button')].map(button => {
          const name = button.querySelector('span'), count = button.querySelector('small');
          const box = button.getBoundingClientRect(), label = name.getBoundingClientRect(), number = count.getBoundingClientRect();
          return { label: name.textContent, width: box.width, left: box.left, right: box.right, labelBottom: label.bottom, countTop: number.top,
            textInside: label.left >= box.left && label.right <= box.right && number.left >= box.left && number.right <= box.right,
            smallerCount: parseFloat(getComputedStyle(count).fontSize) < parseFloat(getComputedStyle(name).fontSize) };
        });
        counts.forEach((node, index) => { node.textContent = original[index] });
        return { width: innerWidth, largeCounts: ${largeCounts}, height: navRect.height, left: navRect.left, right: navRect.right, tabs };
      })()`)
      assert.deepEqual(layout.tabs.map(tab => tab.label), ['全部', '应用', '文件', '图片', '影音'])
      assert.ok(layout.height >= 33 && layout.height <= 34, `classification height at ${width}px remains compact`)
      assert.ok(layout.left >= 0 && layout.right <= width)
      assert.ok(Math.max(...layout.tabs.map(tab => tab.width)) - Math.min(...layout.tabs.map(tab => tab.width)) < 1)
      assert.ok(layout.tabs.every(tab => tab.countTop >= tab.labelBottom && tab.textInside && tab.smallerCount))
      report.layouts.push(layout)
    }
    await screenshot(page, `collection-tabs-${width}.png`)
  }
  await fs.writeFile(path.join(directory, 'resize'), JSON.stringify({ id: 'quick', width: 360, height: 480 }))
  await until(() => evaluate('innerWidth === 360'))
  check('300/360/420px category bars keep five equal columns with small counts below names in the original height, including five-digit counts')
}

try {
  let { evaluate, page } = await start()
  assert.equal(await evaluate('document.querySelector("[data-tab=all]").getAttribute("aria-pressed")'), 'true')
  check('fresh launch defaults to all categories')
  await evaluate(`(()=>{const transfer=new DataTransfer();transfer.setData('application/x-gerson-desktop-items',${JSON.stringify(JSON.stringify(Object.values(files)))});document.querySelector('.collection-body').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))})()`)
  await until(() => evaluate(`window.toolbox.data.get().then(data => ${JSON.stringify(Object.values(files))}.every(path => data.inboxItems.some(item => item.sourcePath === path)))`))
  let saved = await evaluate('window.toolbox.data.get()')
  for (const [name, target] of Object.entries(files)) assert.equal(saved.desktopAssignments[target], name.endsWith('.lnk') ? 'desktop-apps' : name.endsWith('.png') ? 'desktop-images' : 'desktop-documents')
  await until(() => evaluate(`Array.from(document.querySelectorAll('.file-item')).filter(item => ${JSON.stringify(Object.values(files))}.includes(item.dataset.path)).length === 6`))
  assert.equal(await evaluate('document.querySelector(".total-count").textContent.trim()'), await evaluate('document.querySelector("[data-tab=all] small").textContent.trim()'))
  check('drop into all stores six real file references with automatic app, image and document classification')

  await menuPin(evaluate, files['Z-daily-app.lnk'], true)
  await menuPin(evaluate, files['Z-favorite.png'], true)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.file-pin')).backgroundColor`), 'rgba(0, 0, 0, 0)')
  for (const selector of ['.collection-sort select', '.project-switch select']) {
    assert.ok(await evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});if(!field)return true;return getComputedStyle(field).backgroundColor==='rgba(10, 13, 14, 0.3)'})()`))
  }
  await until(() => evaluate('Array.from(document.querySelectorAll(".file-item")).slice(0,2).every(item=>item.classList.contains("pinned"))'))
  assert.deepEqual(new Set(await evaluate('Array.from(document.querySelectorAll(".file-item")).slice(0,2).map(item=>item.dataset.path)')), new Set([files['Z-daily-app.lnk'], files['Z-favorite.png']]))
  await verifyCompactTabs(evaluate, page)
  await screenshot(page, 'collection-all-pinned.png')
  for (const [tab, name] of [['apps', 'Z-daily-app.lnk'], ['images', 'Z-favorite.png']]) {
    await selectTab(evaluate, tab)
    await until(() => evaluate(`document.querySelector('.file-item')?.dataset.path === ${JSON.stringify(files[name])}`))
    await screenshot(page, `collection-${tab}-pinned.png`)
  }
  check('right-click pins app and image references ahead of every unpinned item in all and individual categories')

  await selectTab(evaluate, 'all')
  await evaluate(`document.querySelector('.file-item[data-path='+CSS.escape(${JSON.stringify(files['Z-note.txt'])})+']').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`)
  await until(async () => { try { return (await fs.readFile(path.join(directory, 'opened-paths.jsonl'), 'utf8')).includes(JSON.stringify(files['Z-note.txt'])) } catch { return false } })
  saved = await evaluate('window.toolbox.data.get()')
  assert.ok(saved.recentFiles.some(item => item.path === files['Z-note.txt'] && item.kind === 'opened'))
  check('double-click reaches the real file-open handler and records the opened file; host captures external launch')
  await stop()

  ;({ evaluate, page } = await start())
  assert.equal(await evaluate('document.querySelector("[data-tab=all]").getAttribute("aria-pressed")'), 'true')
  await until(() => evaluate('Array.from(document.querySelectorAll(".file-item")).slice(0,2).every(item=>item.classList.contains("pinned"))'))
  assert.deepEqual(new Set((await evaluate('window.toolbox.data.get()')).desktopPinnedPaths), new Set([files['Z-daily-app.lnk'], files['Z-favorite.png']]))
  check('restart restores all as the default and persists both pinned references')
  await menuPin(evaluate, files['Z-daily-app.lnk'], false)
  await until(() => evaluate(`document.querySelector('.file-item')?.dataset.path === ${JSON.stringify(files['Z-favorite.png'])}`))
  assert.deepEqual((await evaluate('window.toolbox.data.get()')).desktopPinnedPaths, [files['Z-favorite.png']])
  check('cancel pin removes only that reference and retains the other category pin')
  for (const pinned of (await evaluate('window.toolbox.data.get()')).desktopPinnedPaths) await evaluate(`window.toolbox.desktop.setPinned(${JSON.stringify(pinned)},false)`)
  const reorderPaths = Array.from({length:12}, (_,index) => path.join(directory,'references',`reorder-${String(index).padStart(2,'0')}.txt`))
  for (const file of reorderPaths) await fs.writeFile(file,'pin order fixture')
  await evaluate(`window.toolbox.organizer.assignDesktopItems(${JSON.stringify(reorderPaths)},'all')`)
  await selectTab(evaluate,'all')
  for (const file of reorderPaths.slice(0,8)) await evaluate(`window.toolbox.desktop.setPinned(${JSON.stringify(file)},true)`)
  await evaluate(`document.querySelector('.collection-body').scrollTop=200`)
  const scrollBefore = await evaluate(`document.querySelector('.collection-body').scrollTop`)
  assert.ok(scrollBefore>0)
  await menuPin(evaluate,reorderPaths[8],true)
  assert.equal(await evaluate(`document.querySelector('.collection-body').scrollTop`),scrollBefore)
  const beginPinDrag = (from, to) => evaluate(`(() => {
    const items = [...document.querySelectorAll('.file-item')];
    const source = items.find(item => item.dataset.path === ${JSON.stringify(from)});
    const target = items.find(item => item.dataset.path === ${JSON.stringify(to)});
    const transfer = new DataTransfer();
    transfer.setDragImage = preview => {
      const style = getComputedStyle(preview);
      window.pinDragImage = { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow, parts: [...preview.children].map(node => node.localName), label: preview.lastElementChild.textContent };
    };
    const rect = target.getBoundingClientRect();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    const body = document.querySelector('.collection-body');
    window.movePinDrag = (x, y) => body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height }));
    window.finishPinDrag = type => source.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`)
  await beginPinDrag(reorderPaths[8], reorderPaths[0])
  const dragImage = await evaluate('window.pinDragImage')
  assert.equal(dragImage.background, 'rgba(0, 0, 0, 0)')
  assert.equal(dragImage.border, '0px')
  assert.equal(dragImage.shadow, 'none')
  assert.match(dragImage.parts[0], /^(img|svg)$/)
  assert.equal(dragImage.parts[1], 'span')
  assert.equal(dragImage.label, 'reorder-08.txt')
  await evaluate(`window.movePinDrag(.02, .5)`)
  assert.equal(await evaluate(`Boolean(document.querySelector('.pin-placeholder'))`), false)
  await evaluate(`window.movePinDrag(.5, .5)`)
  await until(() => evaluate(`Boolean(document.querySelector('.pin-placeholder'))`))
  await evaluate(`window.movePinDrag(1.02, .5)`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.pin-placeholder')).order`), '-1')
  assert.equal((await evaluate('window.toolbox.data.get()')).desktopPinnedPaths[0], reorderPaths[0])
  await evaluate(`window.finishPinDrag('drop'); window.finishPinDrag('dragend'); delete window.finishPinDrag`)
  await until(() => evaluate(`!document.querySelector('.pin-placeholder')`))
  await until(()=>evaluate(`window.toolbox.data.get().then(data=>data.desktopPinnedPaths[0]===${JSON.stringify(reorderPaths[8])})`))
  await until(()=>evaluate(`document.querySelector('.file-item').dataset.path===${JSON.stringify(reorderPaths[8])}`))
  const savedOrder=(await evaluate('window.toolbox.data.get()')).desktopPinnedPaths
  await stop()
  ;({evaluate,page}=await start())
  assert.deepEqual((await evaluate('window.toolbox.data.get()')).desktopPinnedPaths,savedOrder)
  await until(()=>evaluate(`document.querySelector('.file-item').dataset.path===${JSON.stringify(reorderPaths[8])}`))
  await beginPinDrag(reorderPaths[8], reorderPaths[7])
  await evaluate(`window.movePinDrag(.5, .5)`)
  await until(() => evaluate(`getComputedStyle(document.querySelector('.pin-placeholder')).order === '17'`))
  await evaluate(`window.finishPinDrag('dragend')`)
  await until(() => evaluate(`!document.querySelector('.pin-placeholder')`))
  assert.deepEqual((await evaluate('window.toolbox.data.get()')).desktopPinnedPaths,savedOrder)
  await evaluate(`Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))`)
  await beginPinDrag(reorderPaths[8], reorderPaths[7])
  await evaluate(`window.movePinDrag(.5, .5); window.finishPinDrag('drop'); window.finishPinDrag('dragend')`)
  await until(() => evaluate(`window.toolbox.data.get().then(data => data.desktopPinnedPaths.at(-1) === ${JSON.stringify(reorderPaths[8])})`))
  check('pin keeps scroll position; dragging ninth pin before first persists and survives restart')
  report.ok = true
} catch (error) {
  report.error = String(error)
  console.error(error)
  process.exitCode = 1
} finally {
  await stop()
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
