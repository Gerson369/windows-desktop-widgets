// Vue proxies are not structured-cloneable; copy only JSON-style containers before IPC.
export function copyIpcData(value: unknown, copies = new WeakMap<object, unknown>()): unknown {
  if (!value || typeof value !== 'object') return value
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
  if (copies.has(value)) return copies.get(value)
  const result: unknown[] | Record<string, unknown> = Array.isArray(value) ? new Array(value.length) : {}
  copies.set(value, result)
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(result, key, { value: copyIpcData(item, copies), enumerable: true, writable: true, configurable: true })
  }
  return result
}
