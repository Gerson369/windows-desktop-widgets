const sockets = []
export async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  sockets.push(socket)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data))
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(Error(message.error.message))
    else request.resolve(message.result)
  }
  return async expression => {
    const result = await new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Runtime check timed out')) }, 30000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
}
export async function until(check) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('Runtime check did not reach the expected state')
}
export function closeAll() { sockets.forEach(socket => socket.close()) }
