import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { connect, until, closeAll } from './cdp-check-client.mjs'

const root = path.resolve('.')
const directory = path.join(root, '.settings-redesign-e2e')
const desktop = path.join(directory, 'desktop')
const evidence = path.join(root, 'analysis')
const resultPath = path.join(evidence, 'settings-redesign-result.json')
const port = 9521
const report = { ok: false, checks: [], layouts: [], dialogs: [], screenshots: [] }
await fs.mkdir(desktop, { recursive: true })
await fs.mkdir(evidence, { recursive: true })
for (const name of ['quit', 'snapshot', 'resize', 'navigate', 'clock', 'fail-save', 'fail-store-write', 'menu-action', 'collection-items.json', 'data/toolbox-data.json']) {
  await fs.rm(path.join(directory, name), { force: true })
}
const fixturePath = path.join(desktop, '设置验收文档.txt')
const fixtureText = 'Settings redesign preview fixture. Never move or overwrite this file.\n'
await fs.writeFile(fixturePath, fixtureText)
// Only this Electron process sees the fixture desktop; preview never reads the user's desktop.
const host = path.join(directory, 'host.cjs')
await fs.writeFile(host, `require('electron').app.setPath('desktop', ${JSON.stringify(desktop)});\nrequire(${JSON.stringify(path.join(root, 'scripts/compact-assistant-host.cjs'))});\n`)
const environment = { ...process.env, GERSON_E2E_DEBUG: '1', GERSON_E2E_DEBUG_PORT: String(port), GERSON_E2E_DATA_DIRECTORY: directory, GERSON_E2E_SKIP_DESKTOP: '1' }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [host], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const exited = once(child, 'close')
let logs = ''
child.stdout.on('data', bytes => { logs += bytes })
child.stderr.on('data', bytes => { logs += bytes })
const sessions = new Map()
let dialogAnswer = null
const deadline = setTimeout(async () => {
  report.error = 'Settings redesign verification exceeded 110 seconds'
  await fs.writeFile(resultPath, JSON.stringify(report, null, 2))
  child.kill()
  process.exit(1)
}, 110000)

function check(message) { report.checks.push(message); console.log(message) }
async function protocol(page, method, params = {}) {
  let session = sessions.get(page.id)
  if (!session) {
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    session = { socket, nextId: 0, pending: new Map() }
    sessions.set(page.id, session)
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data))
      if (message.method === 'Page.javascriptDialogOpening') {
        const accept = dialogAnswer === true
        report.dialogs.push({ type: message.params.type, message: message.params.message, accepted: accept, expected: dialogAnswer !== null })
        dialogAnswer = null
        void protocol(page, 'Page.handleJavaScriptDialog', { accept }).catch(error => { report.dialogError = String(error) })
      }
      const pending = session.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      session.pending.delete(message.id)
      if (message.error) pending.reject(Error(message.error.message))
      else pending.resolve(message.result)
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++session.nextId
    const timer = setTimeout(() => { session.pending.delete(id); reject(Error(`${method} timed out`)) }, 8000)
    session.pending.set(id, { resolve, reject, timer })
    session.socket.send(JSON.stringify({ id, method, params }))
  })
}
async function screenshot(page, name) {
  const result = await protocol(page, 'Page.captureScreenshot', { format: 'png' })
  const file = `settings-redesign-${name}.png`
  await fs.writeFile(path.join(evidence, file), Buffer.from(result.data, 'base64'))
  report.screenshots.push(file)
}
async function clickText(evaluate, selector, text) {
  await evaluate(`(() => { const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => item.getClientRects().length && item.textContent.trim() === ${JSON.stringify(text)}); if (!element) throw Error('Visible button not found: ' + ${JSON.stringify(text)}); if (element.disabled) throw Error('Button disabled: ' + ${JSON.stringify(text)}); element.click() })()`)
}
async function input(evaluate, selector, value, event = 'change') {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw Error('Input not found: ' + ${JSON.stringify(selector)}); element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })) })()`)
}
async function select(evaluate, selector, text) {
  await clickText(evaluate, `${selector} button`, text)
  await until(() => evaluate(`[...document.querySelectorAll(${JSON.stringify(`${selector} button`)})].some(button => button.textContent.trim() === ${JSON.stringify(text)} && button.getAttribute('aria-pressed') === 'true')`))
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
}
async function layout(evaluate, name) {
  const result = await evaluate(`(() => { const body = document.querySelector('.settings-body'); return { width: innerWidth, height: innerHeight, section: ${JSON.stringify(name)}, overflow: body.scrollWidth > body.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, offenders: [...body.querySelectorAll('*')].filter(element => element.getClientRects().length && element.getBoundingClientRect().right > body.getBoundingClientRect().right + 1).slice(0, 8).map(element => ({ tag: element.tagName, class: String(element.className), text: element.textContent.slice(0, 60) })) } })()`)
  report.layouts.push(result)
  assert.equal(result.overflow, false, JSON.stringify(result))
}

try {
  let pages
  await until(async () => {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return pages.some(page => page.url.includes('desktopModule=health')) && pages.some(page => page.url.includes('desktopModule=todos')) } catch { return false }
  })
  const main = await connect(pages.find(page => !page.url.includes('?')))
  const assistantPage = pages.find(page => page.url.includes('desktopModule=todos'))
  const healthPage = pages.find(page => page.url.includes('desktopModule=health'))
  const assistant = await connect(assistantPage)
  const health = await connect(healthPage)
  const get = () => main('window.toolbox.data.get()')
  await protocol(assistantPage, 'Page.enable')
  await until(() => assistant(`Boolean(document.querySelector('[aria-label="设置"]'))`))
  await assistant(`document.querySelector('[aria-label="设置"]').click()`)
  await until(() => assistant(`Boolean(document.querySelector('.settings-body'))`))
  assert.deepEqual(await assistant(`[...document.querySelectorAll('.settings-tabs button')].map(button => button.textContent.trim())`), ['健康', '外观', '桌面'])
  await main(`(async () => { const data = await window.toolbox.data.get(); await window.toolbox.settings.update({ hydrationPlan: { ...data.settings.hydrationPlan, enabled: true, goalMl: 2000, cupMl: 250, start: '09:00', end: '20:00', times: undefined }, hydrationReminderEnabled: true, sedentaryReminderEnabled: true }) })()`)
  await select(assistant, '.settings-tabs', '健康')
  await until(() => assistant(`Boolean(document.querySelector('#hydration-goal'))`))
  await input(assistant, '#hydration-goal', 2500)
  await until(async () => (await get()).settings.hydrationPlan.goalMl === 2500)
  await fs.writeFile(path.join(directory, 'fail-save'), 'fail once')
  await input(assistant, '#hydration-goal', 3000)
  await until(() => assistant(`document.querySelector('.health-settings [role="alert"]')?.textContent.includes('测试保存失败')`))
  assert.equal((await get()).settings.hydrationPlan.goalMl, 2500)
  await select(assistant, '.settings-tabs', '外观')
  await input(assistant, '[aria-label="组件字号"]', 16, 'input')
  await input(assistant, '[aria-label="组件字号"]', 16)
  await until(async () => (await get()).suite.fontSize === 16)
  assert.ok(await assistant(`document.querySelector('.settings-save-status').textContent.includes('保存失败')`))
  await select(assistant, '.settings-tabs', '健康')
  assert.equal(await assistant(`document.querySelector('#hydration-goal').value`), '3000')
  await clickText(assistant, '.health-settings button', '重试保存计划')
  await until(async () => (await get()).settings.hydrationPlan.goalMl === 3000)
  await input(assistant, '#hydration-goal', 2000)
  await until(async () => (await get()).settings.hydrationPlan.goalMl === 2000)
  await assistant(`[...document.querySelectorAll('.health-settings button')].find(button => button.textContent.includes('编辑时间')).click()`)
  await until(() => assistant(`Boolean(document.querySelector('[aria-label="第 1 杯提醒时间"]'))`))
  await input(assistant, '[aria-label="第 1 杯提醒时间"]', '09:30')
  await until(async () => (await get()).settings.hydrationPlan.times?.[0] === '09:30')
  await clickText(assistant, '.health-settings button', '完成')
  check('Health goal saves; failed save keeps the draft across tabs and retry succeeds; cup times remain editable.')

  await select(assistant, '.settings-tabs', '外观')
  const oldOpacity = (await get()).settings.desktopModuleOpacity
  await input(assistant, '#widget-transparency', 62, 'input')
  await until(() => assistant(`Number(document.querySelector('.appearance-preview').style.getPropertyValue('--preview-opacity')) === 0.38`))
  assert.equal((await get()).settings.desktopModuleOpacity, oldOpacity)
  await input(assistant, '#widget-transparency', 62)
  await until(async () => (await get()).settings.desktopModuleOpacity === 38)
  for (const [label, value, field, variable] of [['组件背景颜色', '#25312b', 'background', '--preview-background'], ['组件文字颜色', '#e8f4ee', 'textColor', '--preview-text'], ['组件字号', '15', 'fontSize', '--preview-font']]) {
    const selector = `[aria-label="${label}"]`
    await input(assistant, selector, value, 'input')
    await until(() => assistant(`document.querySelector('.appearance-preview').style.getPropertyValue(${JSON.stringify(variable)}) === ${JSON.stringify(field === 'fontSize' ? `${value}px` : value)}`))
    await input(assistant, selector, value)
    await until(async () => String((await get()).suite[field]) === value)
  }
  const preview = await assistant(`(() => { const style = getComputedStyle(document.querySelector('.preview-widget')); return { color: style.color, fontSize: style.fontSize, background: style.backgroundColor } })()`)
  assert.equal(preview.color, 'rgb(232, 244, 238)')
  assert.equal(preview.fontSize, '15px')
  report.preview = preview
  check('Transparency previews before release; colors and font size preview immediately and persist after change.')
  const savedAppearance = (await get()).suite
  await input(assistant, '[aria-label="背景颜色十六进制值"]', '#oops', 'input')
  await input(assistant, '[aria-label="背景颜色十六进制值"]', '#oops')
  await until(() => assistant(`document.querySelector('.appearance-controls [role="alert"]')?.textContent.includes('六位')`))
  assert.equal((await get()).suite.background, savedAppearance.background)
  await input(assistant, '[aria-label="背景颜色十六进制值"]', savedAppearance.background, 'input')
  await input(assistant, '[aria-label="背景颜色十六进制值"]', savedAppearance.background)
  await until(() => assistant(`!document.querySelector('.appearance-controls [role="alert"]')`))
  await input(assistant, '[aria-label="组件字号"]', 25, 'input')
  await input(assistant, '[aria-label="组件字号"]', 25)
  await until(() => assistant(`Boolean(document.querySelector('.appearance-controls [role="alert"]'))`))
  assert.equal((await get()).suite.fontSize, savedAppearance.fontSize)
  await input(assistant, '[aria-label="组件字号"]', savedAppearance.fontSize, 'input')
  await input(assistant, '[aria-label="组件字号"]', savedAppearance.fontSize)
  await until(() => assistant(`!document.querySelector('.appearance-controls [role="alert"]')`))
  await fs.writeFile(path.join(directory, 'fail-store-write'), 'fail once')
  await input(assistant, '[aria-label="组件背景颜色"]', '#28302f', 'input')
  await input(assistant, '[aria-label="组件背景颜色"]', '#28302f')
  await until(() => assistant(`document.querySelector('.appearance-controls [role="alert"]')?.textContent.includes('磁盘写入失败')`))
  assert.equal((await get()).suite.background, savedAppearance.background)
  assert.equal(await assistant(`document.querySelector('[aria-label="组件背景颜色"]').value`), '#28302f')
  await input(assistant, '#widget-transparency', 59, 'input')
  await input(assistant, '#widget-transparency', 59)
  await until(async () => (await get()).settings.desktopModuleOpacity === 41)
  assert.equal(await assistant(`document.querySelector('[aria-label="组件背景颜色"]').value`), '#28302f')
  assert.ok(await assistant(`Boolean(document.querySelector('.appearance-controls [role="alert"]'))`))
  assert.ok(await assistant(`document.querySelector('.settings-save-status').textContent.includes('保存失败')`))
  await clickText(assistant, '.appearance-controls button', '重试')
  await until(async () => (await get()).suite.background === '#28302f')
  await input(assistant, '[aria-label="组件背景颜色"]', savedAppearance.background, 'input')
  await input(assistant, '[aria-label="组件背景颜色"]', savedAppearance.background)
  await until(async () => (await get()).suite.background === savedAppearance.background)
  check('Invalid colors and font sizes cannot overwrite saved appearance; a failed appearance write retains its draft and retries successfully.')

  await select(assistant, '.settings-tabs', '桌面')
  assert.deepEqual(await assistant(`[...document.querySelectorAll('.desktop-settings-tabs button')].map(button => button.textContent.trim())`), ['组件', '收纳', '备份', '数据'])
  await select(assistant, '.desktop-settings-tabs', '组件')
  assert.equal(await assistant(`document.querySelectorAll('.component-row').length`), 3)
  await clickText(assistant, '.shortcut-card button', '修改')
  assert.ok(await assistant(`Boolean(document.querySelector('[aria-label="综合助手快捷键"]'))`))
  await clickText(assistant, '.shortcut-card button', '取消')
  await select(assistant, '.desktop-settings-tabs', '收纳')
  await clickText(assistant, '.organizer-compact .compact-add', '新建')
  await input(assistant, '[aria-label="新分区名称"]', '设置验收分区', 'input')
  await assistant(`document.querySelector('.organizer-compact .inline-form').requestSubmit()`)
  await until(async () => (await get()).desktopZones.some(zone => zone.name === '设置验收分区'))
  const zone = (await get()).desktopZones.find(zone => zone.name === '设置验收分区')
  await main(`window.toolbox.organizer.upsertRule(${JSON.stringify({ id: 'settings-preview-rule', name: '验收文档引用', enabled: true, extensions: ['txt'], targetType: 'zone', targetId: zone.id, priority: 0, createdAt: '2026-10-23T00:00:00.000Z' })})`)
  await clickText(assistant, '.organizer-compact .rule-tabs button', '加入分区')
  await until(() => assistant(`document.querySelector('.compact-rule-list').textContent.includes('验收文档引用')`))
  await clickText(assistant, '.organizer-compact .rule-tabs button', '移动文件')
  assert.equal(await assistant(`document.querySelector('.compact-rule-list').textContent.includes('验收文档引用')`), false)
  await clickText(assistant, '.organizer-compact .rule-tabs button', '加入分区')
  await clickText(assistant, '.organizer-compact .preview-button', '预览整理方案')
  await until(() => assistant(`Boolean(document.querySelector('[aria-label="执行前确认"]'))`))
  const previewText = await assistant(`document.querySelector('[aria-label="执行前确认"]').textContent`)
  assert.ok(previewText.includes('设置验收文档.txt') && previewText.includes('设置验收分区'))
  assert.equal((await get()).fileOperations.length, 0)
  assert.equal(await fs.readFile(fixturePath, 'utf8'), fixtureText)
  check('Organizer creates a zone, filters reference/move rules and previews fixture source and destination without executing a move.')

  await select(assistant, '.desktop-settings-tabs', '备份')
  const backupsBefore = (await get()).widgetLayouts.length
  await clickText(assistant, '[aria-label="桌面设置"] button', '保存当前布局')
  await until(async () => (await get()).widgetLayouts.length === backupsBefore + 1)
  const saved = (await get()).widgetLayouts[0]
  await main('window.toolbox.settings.update({ desktopModuleOpacity: 54 })')
  dialogAnswer = false
  await clickText(assistant, '.backup-row button', '恢复')
  assert.equal(report.dialogs.at(-1)?.accepted, false)
  assert.ok(report.dialogs.at(-1)?.message.includes('恢复前会自动备份'))
  assert.equal((await get()).settings.desktopModuleOpacity, 54)
  dialogAnswer = true
  await clickText(assistant, '.backup-row button', '恢复')
  await until(async () => { const data = await get(); return data.settings.desktopModuleOpacity === saved.opacity && data.widgetLayouts[0].name === '恢复前自动备份' })
  assert.equal(report.dialogs.at(-1)?.accepted, true)
  assert.ok((await get()).widgetLayouts.some(backup => backup.id === saved.id))
  check('Layout backup saves; cancel leaves settings intact; confirmed restore recovers appearance and creates an automatic backup.')

  await select(assistant, '.desktop-settings-tabs', '数据')
  assert.equal(await assistant(`[...document.querySelectorAll('.suite-settings button')].filter(button => button.getClientRects().length && ['导出全部数据', '导入数据'].includes(button.textContent.trim())).length`), 2)
  dialogAnswer = false
  await clickText(assistant, '.suite-settings button', '导入数据')
  assert.equal(report.dialogs.at(-1)?.accepted, false)
  assert.ok(report.dialogs.at(-1)?.message.includes('替换'))
  check('Data export/import entries are visible; cancelling the import confirmation leaves the fixture data intact.')

  for (const [width, height] of [[300, 600], [360, 700], [460, 760]]) {
    await fs.writeFile(path.join(directory, 'resize'), JSON.stringify({ id: 'todos', width, height }))
    await until(() => assistant(`innerWidth === ${width} && innerHeight === ${height}`))
    for (const name of ['健康', '外观']) { await select(assistant, '.settings-tabs', name); await layout(assistant, name) }
    await input(assistant, '[aria-label="组件字号"]', 20, 'input')
    await layout(assistant, '外观/最大字号预览')
    await input(assistant, '[aria-label="组件字号"]', 15, 'input')
    await select(assistant, '.settings-tabs', '桌面')
    for (const name of ['组件', '收纳', '备份', '数据']) { await select(assistant, '.desktop-settings-tabs', name); await layout(assistant, `桌面/${name}`) }
  }
  check('All three main tabs and four desktop groups avoid horizontal overflow at 300, 360 and 460 pixels.')
  for (const [section, group, image] of [['健康', null, 'health'], ['外观', null, 'appearance'], ['桌面', '组件', 'components'], ['桌面', '收纳', 'organizer']]) {
    await select(assistant, '.settings-tabs', section)
    if (group) await select(assistant, '.desktop-settings-tabs', group)
    await assistant(`document.querySelector('.settings-body').scrollTop = 0`)
    await screenshot(assistantPage, image)
  }

  await until(() => health(`Boolean(document.querySelector('.daily-reservoir'))`))
  const healthStyles = await health(`(() => { const elements = [...document.querySelectorAll('.health-icon > span, .health-icon small, .daily-reservoir > span, .daily-reservoir small')]; return elements.map(element => ({ text: element.textContent, background: getComputedStyle(element).backgroundColor, selection: getComputedStyle(element, '::selection').backgroundColor, userSelect: getComputedStyle(element).userSelect })) })()`)
  assert.ok(healthStyles.length >= 6)
  for (const style of healthStyles) {
    assert.equal(style.background, 'rgba(0, 0, 0, 0)', JSON.stringify(style))
    assert.equal(style.selection, 'rgba(0, 0, 0, 0)', JSON.stringify(style))
    assert.equal(style.userSelect, 'none', JSON.stringify(style))
  }
  assert.equal(await health(`document.querySelector('.reservoir-fill').getAttribute('fill')`), '#78cbdc')
  assert.equal(await health(`document.querySelector('.spine-visual rect').getAttribute('fill')`), 'currentColor')
  report.healthStyles = healthStyles
  await screenshot(healthPage, 'health-widget')
  assert.equal(await fs.readFile(fixturePath, 'utf8'), fixtureText)
  assert.equal((await get()).fileOperations.length, 0)
  assert.ok(report.dialogs.every(dialog => dialog.expected))
  check('Health widget labels and selection backgrounds are transparent; text cannot be accidentally selected; artwork keeps its fill colors.')
  report.ok = true
} catch (error) {
  report.error = error.stack || String(error)
  console.error(error)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  closeAll()
  for (const session of sessions.values()) session.socket.close()
  await fs.writeFile(path.join(directory, 'quit'), 'quit')
  const forceQuit = setTimeout(() => child.kill(), 8000)
  await exited
  clearTimeout(forceQuit)
  await fs.writeFile(resultPath, JSON.stringify(report, null, 2))
  await fs.writeFile(path.join(evidence, 'settings-redesign-electron.log'), logs)
  console.log(JSON.stringify(report, null, 2))
}
