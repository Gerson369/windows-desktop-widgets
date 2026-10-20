export function createSaveQueue() {
  let pending: Promise<unknown> = Promise.resolve()
  return <T>(save: () => Promise<T>): Promise<T> => {
    const result = pending.then(save)
    pending = result.catch(() => undefined)
    return result
  }
}
