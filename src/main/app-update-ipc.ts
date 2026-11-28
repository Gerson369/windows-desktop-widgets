import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, ipcMain, net, type IpcMainInvokeEvent } from 'electron'
import { checkForAppUpdate, createUpdateFetcher, downloadAppUpdate, type UpdateAsset } from './app-update'
import { startAppUpdateInstall } from './app-update-install'
import type { AppUpdateResult } from '../shared/app-update'

export function registerAppUpdates(
  isSettingsWindow: (event: IpcMainInvokeEvent) => boolean,
  restoreDesktop: () => Promise<void>,
  resumeDesktop: () => void
): void {
  const offers = new WeakMap<Electron.WebContents, UpdateAsset>()
  const portablePath = process.env.PORTABLE_EXECUTABLE_FILE
  const edition = portablePath ? 'portable' : 'setup'
  let installBusy = false
  const failure = (message: string): AppUpdateResult => ({ status: 'error', message })
  const fetchUpdate = createUpdateFetcher(net)
  const allowed = (event: IpcMainInvokeEvent) =>
    event.senderFrame === event.sender.mainFrame && isSettingsWindow(event)

  ipcMain.handle('app-update:check', async (event): Promise<AppUpdateResult> => {
    if (!allowed(event)) return failure('请在助手设置中检查更新。')
    if (process.platform !== 'win32' || process.arch !== 'x64') return failure('目前提供 Windows x64 版本的更新。')
    if (installBusy) return failure('更新正在进行，请稍候。')
    offers.delete(event.sender)
    try {
      const asset = await checkForAppUpdate(app.getVersion(), edition, fetchUpdate)
      if (!asset) return { status: 'current', version: app.getVersion() }
      offers.set(event.sender, asset)
      return { status: 'available', version: asset.version }
    } catch (error) {
      return failure(error instanceof Error ? error.message : '检查更新失败，请重试。')
    }
  })

  ipcMain.handle('app-update:install', async (event): Promise<AppUpdateResult> => {
    if (!allowed(event)) return failure('请在助手设置中更新。')
    if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64') return failure('请使用 Windows x64 正式版进行更新。')
    const asset = offers.get(event.sender)
    if (!asset) return failure('请先检查更新。')
    if (installBusy) return failure('更新正在进行，请稍候。')
    installBusy = true
    let downloadPath: string | undefined
    let desktopRestored = false
    try {
      let lastPercent = -1
      downloadPath = await downloadAppUpdate(asset, join(app.getPath('temp'), 'GersonToolbox-updates'), fetchUpdate, (received, total) => {
        const percent = Math.floor(received * 100 / total)
        if (percent !== lastPercent && !event.sender.isDestroyed()) event.sender.send('app-update:progress', percent)
        lastPercent = percent
      })
      await restoreDesktop()
      desktopRestored = true
      await startAppUpdateInstall({ downloadPath, portablePath, resourcesPath: process.resourcesPath })
      setImmediate(() => app.quit())
      return { status: 'installing', version: asset.version }
    } catch (error) {
      try {
        if (desktopRestored) resumeDesktop()
        if (downloadPath) await rm(dirname(downloadPath), { recursive: true, force: true }).catch(cleanupError => console.error('[更新文件清理]', cleanupError))
      } finally {
        installBusy = false
      }
      return failure(error instanceof Error ? error.message : '更新失败，请重试。')
    }
  })
}
