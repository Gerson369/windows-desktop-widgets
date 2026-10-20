import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { app } from 'electron'
import { classifyDesktopItem } from './desktop-categories'
import type { AppData, BatchRenamePlan, DesktopFileCategory, DesktopScanItem, DesktopScanResult, FileOperationItem, FileOperationRecord, OrganizerPlan, OrganizerPlanItem, OrganizerRule, RecentFile } from './types'

const IGNORED_DESKTOP_NAMES = new Set(['desktop.ini', 'thumbs.db'])
const INVALID_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f]/

export const desktopRoot = (): string => resolve(app.getPath('desktop'))

const isWithin = (root: string, target: string): boolean => {
  const relativePath = relative(resolve(root), resolve(target))
  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.split(/[\\/]/).includes('..')
}

const isDesktopEntry = (path: string): boolean => dirname(resolve(path)).toLowerCase() === desktopRoot().toLowerCase()

const safeFolderTarget = (path: string): boolean => {
  const root = desktopRoot()
  return isWithin(root, path) && resolve(path).toLowerCase() !== root.toLowerCase()
}


const itemFromPath = async (path: string): Promise<DesktopScanItem | null> => {
  try {
    const stats = await fs.lstat(path)
    if (stats.isSymbolicLink()) return null
    const name = basename(path)
    if (IGNORED_DESKTOP_NAMES.has(name.toLowerCase())) return null
    return {
      path,
      name,
      extension: extname(name).slice(1).toLowerCase(),
      category: classifyDesktopItem(name, stats.isDirectory()),
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
      isDirectory: stats.isDirectory()
    }
  } catch {
    return null
  }
}

export const scanDesktop = async (desktopPath = desktopRoot()): Promise<DesktopScanResult> => {
  const counts: Record<DesktopFileCategory, number> = { video: 0, audio: 0, system: 0, image: 0, document: 0, archive: 0, installer: 0, shortcut: 0, folder: 0, other: 0 }
  let entries: string[] = []
  try { entries = await fs.readdir(desktopPath) } catch { return { desktopPath, items: [], counts } }
  const items = (await Promise.all(entries.map((name) => itemFromPath(join(desktopPath, name))))).filter((item): item is DesktopScanItem => item !== null)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  for (const item of items) counts[item.category] += 1
  return { desktopPath, items, counts }
}

const ruleMatches = (item: DesktopScanItem, rule: OrganizerRule): boolean => {
  if (!rule.enabled) return false
  const extensions = rule.extensions.map((value) => value.trim().replace(/^\./, '').toLowerCase()).filter(Boolean)
  if (extensions.length && !extensions.includes(item.extension)) return false
  if (rule.nameIncludes && !item.name.toLowerCase().includes(rule.nameIncludes.trim().toLowerCase())) return false
  if (rule.createdAfter && new Date(item.createdAt) < new Date(rule.createdAfter)) return false
  return Boolean(extensions.length || rule.nameIncludes || rule.createdAfter)
}

const planItemForRule = async (item: DesktopScanItem, rule: OrganizerRule, data: AppData): Promise<OrganizerPlanItem> => {
  if (rule.targetType === 'zone') {
    if (!rule.targetId) return { sourcePath: item.path, action: 'assign', status: 'skipped', reason: '规则未指定桌面分区。' }
    const zone = data.desktopZones.find((candidate) => candidate.id === rule.targetId)
    if (!zone) return { sourcePath: item.path, action: 'assign', status: 'skipped', reason: '指定桌面分区不存在。' }
    if (zone.itemIds.includes(item.path)) return { sourcePath: item.path, action: 'assign', status: 'skipped', zoneId: rule.targetId, reason: '项目已在目标桌面分区中。' }
    return { sourcePath: item.path, action: 'assign', status: 'planned', zoneId: rule.targetId }
  }
  if (!rule.targetPath || !safeFolderTarget(rule.targetPath)) return { sourcePath: item.path, action: 'move', status: 'skipped', reason: '目标文件夹必须位于桌面目录内。' }
  const targetPath = join(rule.targetPath, item.name)
  if (resolve(targetPath).toLowerCase() === resolve(item.path).toLowerCase()) return { sourcePath: item.path, targetPath, action: 'move', status: 'skipped', reason: '源路径与目标路径相同。' }
  try {
    await fs.access(targetPath)
    return { sourcePath: item.path, targetPath, action: 'move', status: 'skipped', reason: '目标已存在，未覆盖。' }
  } catch {
    return { sourcePath: item.path, targetPath, action: 'move', status: 'planned' }
  }
}

export const previewOrganization = async (data: AppData): Promise<OrganizerPlan> => {
  const scan = await scanDesktop()
  const rules = [...data.organizerRules].filter((rule) => rule.enabled).sort((a, b) => a.priority - b.priority)
  const items: OrganizerPlanItem[] = []
  for (const item of scan.items) {
    const rule = rules.find((candidate) => ruleMatches(item, candidate))
    if (rule) items.push(await planItemForRule(item, rule, data))
  }
  return { desktopPath: scan.desktopPath, items }
}

const moveOne = async (sourcePath: string, targetPath: string): Promise<FileOperationItem> => {
  if (!isDesktopEntry(sourcePath) || !safeFolderTarget(dirname(targetPath)) || !isWithin(desktopRoot(), targetPath)) {
    return { sourcePath, targetPath, action: 'move', status: 'failed', reason: '仅允许整理桌面根目录中的项目到桌面子文件夹。' }
  }
  try {
    const source = await fs.lstat(sourcePath)
    if (source.isSymbolicLink()) return { sourcePath, targetPath, action: 'move', status: 'failed', reason: '不处理符号链接。' }
    try { await fs.access(targetPath); return { sourcePath, targetPath, action: 'move', status: 'skipped', reason: '目标已存在，未覆盖。' } } catch { /* 目标不存在，继续 */ }
    await fs.mkdir(dirname(targetPath), { recursive: true })
    await fs.rename(sourcePath, targetPath)
    return { sourcePath, targetPath, action: 'move', status: 'completed' }
  } catch (error) {
    return { sourcePath, targetPath, action: 'move', status: 'failed', reason: error instanceof Error ? error.message : '移动失败。' }
  }
}

export const executeOrganization = async (data: AppData, confirmedPlan?: OrganizerPlan): Promise<FileOperationRecord> => {
  // 必须使用用户刚刚确认的预览计划；不在执行时重扫桌面，避免 Preview 之后出现的新文件被额外处理。
  const plan = confirmedPlan || await previewOrganization(data)
  const record: FileOperationRecord = { id: `${Date.now().toString(36)}-organize`, kind: 'organize', createdAt: new Date().toISOString(), reversible: true, items: [] }
  for (const item of plan.items) {
    if (item.status !== 'planned') {
      record.items.push({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: item.action === 'assign' ? 'move' : item.action, status: 'skipped', reason: item.reason })
      continue
    }
    if (item.action === 'assign') {
      const zone = data.desktopZones.find((candidate) => candidate.id === item.zoneId)
      if (!zone) record.items.push({ sourcePath: item.sourcePath, action: 'move', status: 'skipped', reason: '指定桌面分区不存在。' })
      else {
        data.desktopAssignments[item.sourcePath] = zone.id
        if (!zone.itemIds.includes(item.sourcePath)) zone.itemIds.push(item.sourcePath)
        record.items.push({ sourcePath: item.sourcePath, action: 'move', status: 'completed', reason: `已加入应用层分区“${zone.name}”，原文件未移动。` })
      }
      continue
    }
    if (!item.targetPath) record.items.push({ sourcePath: item.sourcePath, action: 'move', status: 'skipped', reason: '缺少目标路径。' })
    else record.items.push(await moveOne(item.sourcePath, item.targetPath))
  }
  return record
}

export const revertOperation = async (record: FileOperationRecord): Promise<FileOperationRecord> => {
  const reverted: FileOperationRecord = { id: `${Date.now().toString(36)}-revert`, kind: record.kind, createdAt: new Date().toISOString(), reversible: false, items: [] }
  for (const item of record.items.filter((candidate) => candidate.status === 'completed' && candidate.targetPath)) {
    const targetPath = item.targetPath!
    if (!isWithin(desktopRoot(), targetPath) || !isDesktopEntry(item.sourcePath)) {
      reverted.items.push({ ...item, status: 'skipped', reason: '该操作不符合安全回退范围。' })
      continue
    }
    try {
      try { await fs.access(item.sourcePath); reverted.items.push({ ...item, status: 'skipped', reason: '原路径已存在，未覆盖。' }); continue } catch { /* 原路径空闲 */ }
      await fs.rename(targetPath, item.sourcePath)
      reverted.items.push({ ...item, status: 'reverted' })
    } catch (error) { reverted.items.push({ ...item, status: 'failed', reason: error instanceof Error ? error.message : '回退失败。' }) }
  }
  return reverted
}

export const recentDesktopFiles = async (opened: RecentFile[]): Promise<RecentFile[]> => {
  const scan = await scanDesktop()
  const recentModified = scan.items.filter((item) => !item.isDirectory).slice(0, 80).map((item) => ({ path: item.path, name: item.name, kind: 'modified' as const, occurredAt: item.modifiedAt }))
  const downloads = resolve(app.getPath('downloads'))
  let downloadEntries: string[] = []
  try { downloadEntries = await fs.readdir(downloads) } catch { /* 下载目录不可用时仅返回其他项 */ }
  const recentDownloads = (await Promise.all(downloadEntries.map((name) => itemFromPath(join(downloads, name))))).filter((item): item is DesktopScanItem => item !== null && !item.isDirectory)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
    .map((item) => ({ path: item.path, name: item.name, kind: 'downloaded' as const, occurredAt: item.createdAt }))
  const merged = [...opened, ...recentDownloads, ...recentModified]
  const unique = new Map<string, RecentFile>()
  for (const item of merged) if (!unique.has(`${item.kind}:${item.path}`)) unique.set(`${item.kind}:${item.path}`, item)
  return [...unique.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 120)
}

export const previewBatchRename = async (paths: string[], prefix: string, start = 1): Promise<BatchRenamePlan> => {
  const normalizedPrefix = prefix.trim().slice(0, 80)
  if (!normalizedPrefix || INVALID_FILE_NAME.test(normalizedPrefix)) return { items: paths.map((sourcePath) => ({ sourcePath, status: 'skipped', reason: '名称前缀为空或包含 Windows 不允许的字符。' })) }
  const candidates = [...new Set(paths)].filter(isDesktopEntry)
  const plannedNames = new Set<string>()
  const items: BatchRenamePlan['items'] = []
  for (const [offset, sourcePath] of candidates.entries()) {
    const scanned = await itemFromPath(sourcePath)
    if (!scanned || scanned.isDirectory) { items.push({ sourcePath, status: 'skipped', reason: '只支持重命名桌面根目录中的普通文件。' }); continue }
    const extension = extname(scanned.name)
    const targetPath = join(dirname(sourcePath), `${normalizedPrefix}-${String(start + offset).padStart(2, '0')}${extension}`)
    const dedupeKey = targetPath.toLowerCase()
    if (plannedNames.has(dedupeKey) || resolve(targetPath).toLowerCase() === resolve(sourcePath).toLowerCase()) { items.push({ sourcePath, targetPath, status: 'skipped', reason: '新名称重复或未发生变化。' }); continue }
    plannedNames.add(dedupeKey)
    try { await fs.access(targetPath); items.push({ sourcePath, targetPath, status: 'skipped', reason: '目标名称已存在，未覆盖。' }) } catch { items.push({ sourcePath, targetPath, status: 'planned' }) }
  }
  return { items }
}

export const executeBatchRename = async (paths: string[], prefix: string, start = 1, confirmedPlan?: BatchRenamePlan): Promise<FileOperationRecord> => {
  // 使用确认过的计划，不在执行时重新枚举候选项；每项仍重新验证以防源/目标在确认后变化。
  const plan = confirmedPlan || await previewBatchRename(paths, prefix, start)
  const record: FileOperationRecord = { id: `${Date.now().toString(36)}-rename`, kind: 'rename', createdAt: new Date().toISOString(), reversible: true, items: [] }
  for (const item of plan.items) {
    if (item.status !== 'planned' || !item.targetPath) { record.items.push({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: 'rename', status: 'skipped', reason: item.reason }); continue }
    if (!isDesktopEntry(item.sourcePath) || !isDesktopEntry(item.targetPath) || dirname(resolve(item.sourcePath)).toLowerCase() !== dirname(resolve(item.targetPath)).toLowerCase()) {
      record.items.push({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: 'rename', status: 'skipped', reason: '重命名路径不再符合桌面根目录安全范围。' })
      continue
    }
    try {
      const source = await fs.lstat(item.sourcePath)
      if (source.isDirectory() || source.isSymbolicLink()) { record.items.push({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: 'rename', status: 'skipped', reason: '源项目已变更，不执行重命名。' }); continue }
      try { await fs.access(item.targetPath); record.items.push({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: 'rename', status: 'skipped', reason: '目标名称已存在，未覆盖。' }); continue } catch { /* 目标仍不存在，继续 */ }
      await fs.rename(item.sourcePath, item.targetPath)
      record.items.push({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: 'rename', status: 'completed' })
    } catch (error) { record.items.push({ sourcePath: item.sourcePath, targetPath: item.targetPath, action: 'rename', status: 'failed', reason: error instanceof Error ? error.message : '重命名失败。' }) }
  }
  return record
}
