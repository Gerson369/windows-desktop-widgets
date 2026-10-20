import { execFile } from 'node:child_process'
import { promises as fs, createReadStream, statSync, watch } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { homedir, platform, tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { clipboard, desktopCapturer, nativeImage, shell } from 'electron'
import type { FileFilters, FileResult } from './types'

const execFileAsync = promisify(execFile)
const MAX_RESULTS = 500
const IGNORED_NAMES = new Set(['node_modules', '$Recycle.Bin', 'System Volume Information', '.git', 'Windows', 'Program Files', 'Program Files (x86)'])

/**
 * 自有按需本地搜索后端：仅在用户查询时遍历受控目录，不内置、调用或启动第三方搜索程序。
 */
export const inspectSearchBackend = async (): Promise<{ cwd: string; client: string; exists: boolean; raw: string[]; error?: string }> => ({
  cwd: process.cwd(),
  client: 'gerson-local-search',
  exists: true,
  raw: []
})

const toResult = async (path: string): Promise<FileResult | null> => {
  try {
    const stats = await fs.stat(path)
    return {
      path,
      name: basename(path),
      extension: extname(path).replace('.', '').toLowerCase(),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      isDirectory: stats.isDirectory()
    }
  } catch {
    return null
  }
}

const matches = (result: FileResult, filters: FileFilters): boolean => {
  const keyword = filters.keyword.trim().toLowerCase()
  if (keyword && !result.name.toLowerCase().includes(keyword) && !result.path.toLowerCase().includes(keyword)) return false
  if (filters.extension && result.extension !== filters.extension.replace('.', '').toLowerCase()) return false
  if (filters.path && !result.path.toLowerCase().includes(filters.path.toLowerCase())) return false
  if (filters.minSize !== undefined && result.size < filters.minSize * 1024 * 1024) return false
  if (filters.maxSize !== undefined && result.size > filters.maxSize * 1024 * 1024) return false
  if (filters.modifiedAfter && new Date(result.modifiedAt) < new Date(filters.modifiedAfter)) return false
  if (filters.modifiedBefore && new Date(result.modifiedAt) > new Date(`${filters.modifiedBefore}T23:59:59`)) return false
  return true
}

const mightMatchNamePath = (path: string, name: string, isDirectory: boolean, filters: FileFilters): boolean => {
  const normalizedPath = path.toLowerCase()
  const normalizedName = name.toLowerCase()
  const keyword = filters.keyword.trim().toLowerCase()
  if (keyword && !normalizedName.includes(keyword) && !normalizedPath.includes(keyword)) return false
  if (filters.path && !normalizedPath.includes(filters.path.toLowerCase())) return false
  if (filters.extension) {
    if (isDirectory || extname(name).replace('.', '').toLowerCase() !== filters.extension.replace('.', '').toLowerCase()) return false
  }
  return true
}

const fromCommand = async (command: string, args: string[], filters: FileFilters): Promise<FileResult[]> => {
  const { stdout } = await execFileAsync(command, args, { windowsHide: true, maxBuffer: 12 * 1024 * 1024 })
  const paths = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 5000)
  const results = (await Promise.all(paths.map(toResult))).filter((item): item is FileResult => item !== null)
  return results.filter((item) => matches(item, filters)).slice(0, MAX_RESULTS)
}

const recursivelySearch = async (roots: string[], filters: FileFilters, signal?: AbortSignal): Promise<FileResult[]> => {
  const results: FileResult[] = []
  // 反向入栈并采用 LIFO：每个优先根目录先完整扫描，再进入下一根目录，避免刚开始
  // 扫描临时目录就轮转到整个用户目录，造成已命中结果仍长期不可见。
  const pending = roots.map((path) => resolve(path)).reverse()
  const visited = new Set<string>()
  while (!signal?.aborted && pending.length && results.length < MAX_RESULTS) {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    try {
      const directory = await fs.opendir(current)
      for await (const entry of directory) {
        if (signal?.aborted || results.length >= MAX_RESULTS) break
        if (IGNORED_NAMES.has(entry.name)) continue
        const fullPath = join(current, entry.name)
        if (entry.isDirectory()) {
          pending.push(fullPath)
          if (mightMatchNamePath(fullPath, entry.name, true, filters)) {
            const result = await toResult(fullPath)
            if (result && matches(result, filters)) results.push(result)
          }
        } else if (mightMatchNamePath(fullPath, entry.name, false, filters)) {
          const result = await toResult(fullPath)
          if (result && matches(result, filters)) results.push(result)
        }
      }
    } catch {
      // 无访问权限的目录将被安静跳过，确保全盘检索持续运行。
    }
  }
  return signal?.aborted ? [] : results.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

const windowsRoots = async (): Promise<string[]> => {
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"], { windowsHide: true })
    return stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  } catch {
    return ['C:\\']
  }
}

export const searchFiles = async (filters: FileFilters, roots?: string[], signal?: AbortSignal): Promise<FileResult[]> => {
  const activePlatform = platform()
  // 自有递归扫描不具备 NTFS 索引器的全盘检索速度。显式 roots 仅供受控内部调用；
  // 普通产品路径必须先扫描当前用户常用位置，只有完全未命中时才回退到磁盘根目录。
  const userRoots = [...new Set([tmpdir(), join(homedir(), 'Desktop'), join(homedir(), 'Downloads'), homedir()])]
  if (roots?.length) return recursivelySearch(roots, filters, signal)

  if (activePlatform === 'darwin') {
    try {
      return await fromCommand('mdfind', [`kMDItemDisplayName == '*${filters.keyword.replace(/['\\]/g, '')}*'cd`], filters)
    } catch {
      return recursivelySearch(userRoots, filters, signal)
    }
  }

  for (const root of userRoots) {
    const localResults = await recursivelySearch([root], filters, signal)
    if (signal?.aborted || localResults.length) return localResults
  }
  if (activePlatform !== 'win32') return []
  // 所有用户常用位置均未命中才继续覆盖可用 Windows 文件系统根目录；不会下载、启动或调用第三方搜索软件。
  return recursivelySearch(await windowsRoots(), filters, signal)
}

export const openPath = async (path: string): Promise<string> => shell.openPath(path)
export const revealPath = (path: string): void => shell.showItemInFolder(path)

const captureSourcesWithTimeout = async <T>(request: Promise<T>): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      request,
      new Promise<T>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('屏幕采集超时，请检查 Windows 屏幕录制权限后重试。')), 12_000) })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export const captureFullScreen = async (): Promise<{ dataUrl: string }> => {
  const sources = await captureSourcesWithTimeout(desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 2560, height: 1440 } }))
  if (!sources.length) throw new Error('未发现可截图的显示器。')
  const image = sources[0].thumbnail
  clipboard.writeImage(image)
  return { dataUrl: image.toDataURL() }
}

/**
 * 读取指定显示器的截图而不写入剪贴板。选择区域窗口据此在渲染端完成裁剪与标注，
 * 最终图片仅在用户点击“复制并完成”后才会替换系统剪贴板内容。
 */
export const captureDisplay = async (displayIndex: number): Promise<{ dataUrl: string; width: number; height: number }> => {
  const sources = await captureSourcesWithTimeout(desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 2560, height: 1440 } }))
  // desktopCapturer 返回的屏幕源按显示器枚举顺序排列；主进程传入同一顺序的索引。
  const source = sources[displayIndex] || sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error('未发现可用的显示器截图。')
  const size = source.thumbnail.getSize()
  return { dataUrl: source.thumbnail.toDataURL(), width: size.width, height: size.height }
}

export const captureWindowList = async (): Promise<Array<{ id: string; name: string; dataUrl: string }>> => {
  const sources = await captureSourcesWithTimeout(desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 640, height: 360 }, fetchWindowIcons: true }))
  return sources.filter((source) => source.name).map((source) => ({ id: source.id, name: source.name, dataUrl: source.thumbnail.toDataURL() }))
}

export const copyImageDataUrl = (dataUrl: string): void => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
}

export const setWindowsDesktopIconsHidden = async (hidden: boolean): Promise<boolean> => {
  if (platform() !== 'win32') return false
  try {
    const value = hidden ? '1' : '0'
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name HideIcons -Value ${value}; Start-Process ie4uinit.exe -ArgumentList '-show' -WindowStyle Hidden`], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

export const refreshIconCache = async (): Promise<boolean> => {
  if (platform() !== 'win32') return false
  try {
    await execFileAsync('ie4uinit.exe', ['-show'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

export const watchDirectory = (path: string, onChange: () => void): (() => void) => {
  let debounceTimer: NodeJS.Timeout | undefined
  let signature = ''
  const emit = (): void => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(onChange, 180)
  }
  const fingerprint = (): string => {
    try {
      const stats = statSync(path, { throwIfNoEntry: false })
      return stats ? `${stats.isDirectory() ? 'd' : 'f'}:${stats.mtimeMs}:${stats.size}` : 'missing'
    } catch { return 'unavailable' }
  }
  try {
    // 单个文件不能可靠地以 recursive 模式监听；改为监听其父目录，避免文档原子保存时来源条目失联。
    const watchPath = statSync(path).isDirectory() ? path : dirname(path)
    signature = fingerprint()
    const watcher = watch(watchPath, { recursive: process.platform !== 'linux' }, () => emit())
    // fs.watch 在网络盘、Office 原子保存和云同步目录中可能遗漏事件；轮询只作轻量兜底。
    const poller = setInterval(() => {
      const current = fingerprint()
      if (current !== signature) {
        signature = current
        emit()
      }
    }, 1800)
    poller.unref()
    return () => {
      clearTimeout(debounceTimer)
      clearInterval(poller)
      watcher.close()
    }
  } catch {
    return () => undefined
  }
}

export const readTextFile = async (path: string): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
