import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('tests/desktop-fallback-boot.cjs'), '--user-data-dir=' + path.join(process.env.TEMP, 'gerson-desktop-fallback-check'), '--remote-debugging-port=9348'], { windowsHide: false, stdio: 'ignore' })
let socket
try {
  let pages
  for (let attempt = 0; attempt < 80; attempt++) {
    try { pages = await (await fetch('http://127.0.0.1:9348/json/list')).json(); if (pages.some(page => page.url.includes('desktopModule=todos'))) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(pages?.some(page => page.url.includes('desktopModule=quick')), 'Missing native bridge must retain quick widget')
  const page = pages.find(page => !page.url.includes('?'))
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const evaluate = expression => new Promise((resolve, reject) => {
    const request = ++id
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)); if (message.id !== request) return
      if (message.result.exceptionDetails) reject(Error(message.result.exceptionDetails.text)); else resolve(message.result.result.value)
    }
    socket.send(JSON.stringify({ id: request, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  const settings = await evaluate('window.toolbox.data.get().then(data => data.settings)')
  assert.equal(settings.desktopCollected, false)
  assert.equal(settings.desktopModeEnabled, true)
  const data = await evaluate(`window.toolbox.entity.upsert('todos', { id: 'fallback-test', title: '待办仍可使用', completed: false, order: 0, categoryId: 'work', createdAt: '2026-10-19T00:00:00Z' })`)
  assert.ok(data.todos.some(todo => todo.id === 'fallback-test'))
  await fs.mkdir('analysis/desktop-assistant-1.4-verification', { recursive: true })
  const result = { ok: true, checks: ['missing native bridge preserves original desktop', 'collection and independent todo widgets still open', 'todo storage remains usable'] }
  await fs.writeFile('analysis/desktop-assistant-1.4-verification/startup-fallback-result.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { socket?.close(); child.kill() }
