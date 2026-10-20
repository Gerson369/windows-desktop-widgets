import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { promisify } from 'node:util'
const run = promisify(execFile)
let desktopGestureProcess: ChildProcess | null = null

let guardian: ChildProcess | null = null
let recoveryWatcher: ChildProcess | null = null
let requestPath = ''
let pendingReady: { resolve: () => void; reject: (error: Error) => void } | undefined
let stopRequested = false
let onFailure: (error: string) => void = () => undefined
let requestSequence = 0

const bridgePath = (): string => app.isPackaged
  ? join(process.resourcesPath, 'native/GersonDesktopHostBridge.exe')
  : join(app.getAppPath(), 'native/DesktopHostBridge/GersonDesktopHostBridge.exe')

export function startDesktopGestures(onDoubleClick: () => void): void {
  if (desktopGestureProcess) return
  const child = spawn(bridgePath(), ['watch-desktop',String(process.pid)], { windowsHide:true, stdio:['ignore','pipe','ignore'] })
  desktopGestureProcess = child
  let pending = ''
  child.stdout?.on('data',bytes => {
    pending += bytes.toString('utf8')
    let end: number
    while((end=pending.indexOf('\n'))>=0) {
      const line=pending.slice(0,end).trim(); pending=pending.slice(end+1)
      try { if(JSON.parse(line).event==='desktop-double-click') onDoubleClick() } catch { /* Only complete protocol events are accepted. */ }
    }
  })
  child.on('error',error => console.error('[桌面双击]',error.message))
  child.once('close',() => { if(desktopGestureProcess===child) desktopGestureProcess=null })
}
export function stopDesktopGestures(): void { desktopGestureProcess?.kill(); desktopGestureProcess=null }

export async function shellFileIcon(path: string, index?: number): Promise<string> {
  const args=['icon',path,...(index===undefined ? [] : [String(index)])]
  const result=JSON.parse((await run(bridgePath(),args,{windowsHide:true,encoding:'utf8',maxBuffer:2*1024*1024})).stdout)
  if(!result.ok || typeof result.dataUrl!=='string' || !result.dataUrl.startsWith('data:image/png;base64,')) throw new Error('Windows 图标暂不可用')
  return result.dataUrl
}
export async function shellThumbnail(path: string): Promise<string> {
  const result=JSON.parse((await run(bridgePath(),['thumbnail',path],{windowsHide:true,encoding:'utf8',maxBuffer:2*1024*1024,timeout:5000})).stdout)
  if(!result.ok || typeof result.dataUrl!=='string' || !result.dataUrl.startsWith('data:image/png;base64,')) throw new Error('Windows 缩略图暂不可用')
  return result.dataUrl
}

async function publishRequest(windows: BrowserWindow[], collect: boolean, stop = false): Promise<void> {
  if (!requestPath) {
    const directory = join(app.getPath('userData'), 'desktop-host')
    await mkdir(directory, { recursive: true })
    requestPath = join(directory, `lease-${process.pid}.json`)
  }
  const temporary = `${requestPath}.${++requestSequence}.tmp`
  const handles = windows.filter(window => !window.isDestroyed() && window.isVisible()).map(window => {
    const bytes = window.getNativeWindowHandle()
    return Number(bytes.length === 8 ? bytes.readBigUInt64LE() : bytes.readUInt32LE())
  })
  if (!stop && !handles.length) throw new Error('桌面组件尚未准备好，保留原桌面图标。')
  await writeFile(temporary, JSON.stringify({ Windows: handles, Collect: collect, Stop: stop }), 'utf8')
  await rename(temporary, requestPath)
}

export async function collectDesktop(windows: BrowserWindow[], failure: (error: string) => void): Promise<void> {
  onFailure = failure
  stopRequested = false
  await publishRequest(windows, true)
  if (guardian) return
  const status = JSON.parse((await run(bridgePath(), ['status'], { windowsHide: true })).stdout) as { ok: boolean; iconViewVisible: boolean }
  if (!status.ok) throw new Error('Windows 桌面宿主不可用。')
  if (!recoveryWatcher) {
    const watcher = spawn(bridgePath(), ['watch-owner', String(process.pid)], { windowsHide:true, detached:true, stdio:'ignore' })
    await new Promise<void>((resolve,reject)=>{watcher.once('spawn',resolve);watcher.once('error',reject)})
    recoveryWatcher=watcher
    watcher.once('close',()=>{if(recoveryWatcher===watcher) recoveryWatcher=null})
    watcher.unref()
  }
  const ready = new Promise<void>((resolve, reject) => { pendingReady = { resolve, reject } })
  let confirmed = false
  guardian = spawn(bridgePath(), [String(process.pid), requestPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  guardian.stdout?.on('data', bytes => {
    buffer += bytes.toString('utf8')
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1)
      if (!line) continue
      try {
        const result = JSON.parse(line) as { ok: boolean; collected?: boolean; error?: string }
        if (!result.ok) {
          const error = new Error(result.error || '桌面收纳失败，已恢复原图标。')
          pendingReady?.reject(error); pendingReady = undefined
        } else if (result.collected) { confirmed = true; pendingReady?.resolve(); pendingReady = undefined }
      } catch { /* Non-protocol diagnostics do not change collection state. */ }
    }
  })
  guardian.once('error', error => { pendingReady?.reject(error); pendingReady = undefined })
  guardian.once('close', () => {
    guardian = null
    pendingReady?.reject(new Error('桌面宿主连接已结束，原桌面图标已恢复。')); pendingReady = undefined
    if (!stopRequested && confirmed) {
      void run(bridgePath(), ['restore', '1'], { windowsHide: true }).then(
        () => onFailure('桌面宿主连接已结束，已停止收纳并恢复原桌面。'),
        () => onFailure('桌面恢复未完成，请在桌面右键菜单中选择“显示桌面图标”。')
      )
    }
  })
  const timeout = setTimeout(() => pendingReady?.reject(new Error('桌面组件挂接超时，保留原桌面。')), 5000)
  try { await ready } catch (error) { await releaseDesktop(); throw error } finally { clearTimeout(timeout) }
}

export async function updateDesktopCollection(windows: BrowserWindow[]): Promise<void> {
  if (guardian && !stopRequested) await publishRequest(windows, true)
}

export async function releaseDesktop(): Promise<void> {
  stopRequested = true
  const child = guardian
  if (child) {
    const exited = new Promise<void>(resolve => { child.once('close', () => resolve()) })
    await publishRequest([], false, true)
    const released = await Promise.race([exited.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 3000))])
    if (!released) throw new Error('桌面恢复仍在进行，请稍后重试。')
  }
  // Always verify recovery, including an already-missing guardian or a stale hidden desktop.
  await run(bridgePath(), ['restore', '1'], { windowsHide:true, timeout:5000 })
}
