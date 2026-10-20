import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { DesktopFileCategory, DesktopIconArrangePlan, DesktopScanResult, IconLayoutBackup, IconLayoutEntry } from './types'

const execFileAsync = promisify(execFile)

export interface NativeLayoutEntry {
  key: string
  name: string
  x: number
  y: number
}

export interface NativeLayoutSnapshot {
  createdAt: string
  spacingX: number
  spacingY: number
  entries: NativeLayoutEntry[]
}

export interface DesktopStatus {
  ok: boolean
  available: boolean
  explorerProcessId?: number
  itemCount?: number
  spacingX?: number
  spacingY?: number
  autoArrange?: boolean
  error?: string
}

const helperPath = (): string => {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return app.isPackaged
    ? join(root, 'native', 'GersonDesktopLayoutBridge.exe')
    : join(root, 'native', 'DesktopLayoutBridge', 'GersonDesktopLayoutBridge.exe')
}

export const decodeNativeOutput = (bytes: Buffer): string => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes) }
}

const invoke = async <T>(args: string[]): Promise<T> => {
  if (process.platform !== 'win32') throw new Error('真实桌面图标布局控制仅支持 Windows。')
  const executable = helperPath()
  if (!existsSync(executable)) throw new Error('Windows 桌面布局桥接程序不存在。请重新执行原生模块构建。')
  // Console encoding varies by launcher: accept strict UTF-8, then legacy Chinese output.
  const output = await execFileAsync(executable, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }) as unknown as { stdout: Buffer }
  const stdout = decodeNativeOutput(output.stdout)
  const result = JSON.parse(stdout.trim() || '{}') as T & { ok?: boolean; error?: string }
  if (result.ok === false) throw new Error(result.error || 'Windows 桌面布局操作失败。')
  return result as T
}

export const getDesktopStatus = async (): Promise<DesktopStatus> => {
  if (process.platform !== 'win32') return { ok: false, available: false, error: '该系统不支持 Windows Explorer 图标控制。' }
  try {
    const result = await invoke<Omit<DesktopStatus, 'available'>>(['status'])
    return { ...result, available: Boolean(result.ok) }
  } catch (error) {
    return { ok: false, available: false, error: error instanceof Error ? error.message : '桌面图标控件不可用。' }
  }
}

export const readDesktopLayout = async (): Promise<NativeLayoutSnapshot> => {
  // .NET JavaScriptSerializer 保留 PascalCase；此处兼容旧桥接输出与未来 camelCase 输出。
  const result = await invoke<{ ok: boolean; layout: unknown }>(['read'])
  const raw = result.layout as {
    createdAt?: string; CreatedAt?: string; spacingX?: number; SpacingX?: number; spacingY?: number; SpacingY?: number
    entries?: Array<Partial<NativeLayoutEntry>>; Entries?: Array<{ Key?: string; Name?: string; X?: number; Y?: number }>
  }
  const entries = raw.entries ?? raw.Entries ?? []
  return {
    createdAt: raw.createdAt ?? raw.CreatedAt ?? new Date().toISOString(),
    spacingX: raw.spacingX ?? raw.SpacingX ?? 112,
    spacingY: raw.spacingY ?? raw.SpacingY ?? 139,
    entries: entries.map((item) => {
      const value = item as Partial<NativeLayoutEntry> & { Key?: string; Name?: string; X?: number; Y?: number }
      return {
        key: value.key ?? value.name ?? value.Key ?? value.Name ?? '',
        name: value.name ?? value.key ?? value.Name ?? value.Key ?? '',
        x: value.x ?? value.X ?? 0,
        y: value.y ?? value.Y ?? 0
      }
    })
  }
}

export const setDesktopSpacing = async (horizontal: number, vertical: number): Promise<{ spacingX: number; spacingY: number }> => {
  const result = await invoke<{ ok: boolean; spacingX: number; spacingY: number }>(['spacing', String(horizontal), String(vertical)])
  return { spacingX: result.spacingX, spacingY: result.spacingY }
}

export const snapDesktopToGrid = async (): Promise<number> => {
  const result = await invoke<{ ok: boolean; applied: number }>(['snap'])
  return result.applied
}

export const snapSelectedDesktopIconsToEdge = async (): Promise<number> => {
  const result = await invoke<{ ok: boolean; applied: number }>(['snap-edge'])
  return result.applied
}

export const refreshNativeDesktopIcons = async (): Promise<number> => {
  const result = await invoke<{ ok: boolean; redrawn: number }>(['refresh'])
  return result.redrawn
}

export const toBackup = (layout: NativeLayoutSnapshot, name: string): IconLayoutBackup => ({
  id: `${Date.now().toString(36)}-native-layout`,
  name,
  createdAt: layout.createdAt,
  spacingX: layout.spacingX,
  spacingY: layout.spacingY,
  native: true,
  entries: layout.entries.map((item) => ({ path: item.key, name: item.name, x: item.x, y: item.y }))
})

export const applyBackup = async (backup: IconLayoutBackup): Promise<number> => {
  if (!backup.entries.length) return 0
  const payload: NativeLayoutSnapshot = {
    createdAt: backup.createdAt,
    spacingX: backup.spacingX || 112,
    spacingY: backup.spacingY || 139,
    entries: backup.entries.map((item: IconLayoutEntry) => ({ key: item.path, name: item.name || item.path, x: item.x, y: item.y }))
  }
  const file = join(app.getPath('temp'), `gerson-desktop-layout-${Date.now()}.json`)
  await writeFile(file, JSON.stringify(payload), 'utf8')
  try {
    const result = await invoke<{ ok: boolean; applied: number }>(['apply', file])
    return result.applied
  } finally {
    await unlink(file).catch(() => undefined)
  }
}

const categoryOrder: DesktopFileCategory[] = ['folder', 'shortcut', 'document', 'image', 'archive', 'installer', 'video', 'audio', 'system', 'other']
const emptyCounts = (): Record<DesktopFileCategory, number> => ({ video: 0, audio: 0, system: 0, image: 0, document: 0, archive: 0, installer: 0, shortcut: 0, folder: 0, other: 0 })
const normalizeIconName = (value: string): string => value.trim().toLocaleLowerCase('zh-CN')
const withoutShortcutExtension = (value: string): string => value.replace(/\.(lnk|url)$/i, '')

/**
 * 生成只影响 Explorer 图标坐标的稳定分类布局。分类依据来自桌面根目录扫描；
 * 未匹配或无法解析的图标保留为“其他”，不会删除、隐藏或移动对应文件。
 */
export const createCategoryLayoutPlan = (
  layout: NativeLayoutSnapshot,
  scan: DesktopScanResult,
  autoArrangeDetected: boolean,
  workArea: { width: number; height: number; x?: number; y?: number }
): DesktopIconArrangePlan => {
  const scanByName = new Map<string, DesktopFileCategory>()
  for (const item of scan.items) {
    scanByName.set(normalizeIconName(item.name), item.category)
    if (item.category === 'shortcut') scanByName.set(normalizeIconName(withoutShortcutExtension(item.name)), item.category)
  }
  const categoryForName = (name: string): DesktopFileCategory => {
    const normalized = normalizeIconName(name)
    return scanByName.get(normalized) || scanByName.get(normalizeIconName(withoutShortcutExtension(name))) || 'other'
  }
  const grouped = new Map<DesktopFileCategory, NativeLayoutEntry[]>()
  for (const category of categoryOrder) grouped.set(category, [])
  for (const entry of layout.entries) grouped.get(categoryForName(entry.name))!.push(entry)
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
  const counts = emptyCounts()
  const entries: DesktopIconArrangePlan['entries'] = []
  const horizontal = Math.max(32, layout.spacingX)
  const vertical = Math.max(32, layout.spacingY)
  const maxRows = Math.max(0, Math.floor(workArea.height / vertical))
  const maxColumns = Math.max(0, Math.floor(workArea.width / horizontal))
  const capacity = maxRows * maxColumns
  let cell = 0
  let remaining = layout.entries.length
  for (const category of categoryOrder) {
    const group = (grouped.get(category) || []).sort((a, b) => collator.compare(a.name, b.name) || a.key.localeCompare(b.key))
    if (!group.length) continue
    counts[category] = group.length
    // Only reserve a separator column when every remaining icon still fits.
    const nextColumn = maxRows > 0 ? Math.ceil(cell / maxRows) * maxRows + maxRows : cell
    if (cell > 0 && capacity - nextColumn >= remaining) cell = nextColumn
    for (const entry of group) {
      const fits = cell < capacity
      entries.push({
        path: entry.key,
        name: entry.name,
        x: fits ? (workArea.x || 0) + Math.floor(cell / maxRows) * horizontal : entry.x,
        y: fits ? (workArea.y || 0) + (cell % maxRows) * vertical : entry.y,
        category,
        status: fits ? 'planned' : 'skipped',
        ...(fits ? {} : { reason: '屏幕空间不足，保留原位置。' })
      })
      cell += 1
      remaining -= 1
    }
  }
  const warnings: string[] = []
  if (layout.entries.length > capacity) warnings.push(`当前工作区最多容纳 ${capacity} 个图标，请缩小系统图标或减少桌面项目后重新预览。`)
  if (autoArrangeDetected) warnings.push('Windows 当前已启用“自动排列图标”，系统可能覆盖手工分类坐标；请先关闭系统自动排列后再应用。')
  if (entries.some((entry) => entry.category === 'other')) warnings.push('未识别项目已归入“其他”，不会被删除或移动。')
  return { createdAt: layout.createdAt, itemCount: layout.entries.length, autoArrangeDetected, spacingX: horizontal, spacingY: vertical, entries, counts, warnings }
}
