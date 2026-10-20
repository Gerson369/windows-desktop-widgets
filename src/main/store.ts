import { validateSuite, defaultSuite, extraWidgetKinds } from './widget-suite'
import { validateHydrationPlan, hydrationDayAt } from './hydration-plan'
import { mkdir, copyFile, access, rename } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { AppData, defaultData } from './types'
import { normalizeReminderSettings } from './wellness-reminders'
import { normalizeCollectionSorts, normalizeCollectionRules } from './desktop-collection'
import { validWidgetLayout } from './widget-layout'

interface LowDbAdapter {
  getState(): AppData | undefined
  setState(data: AppData): void
  write(): void
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const hasStringId = (value: unknown): value is Record<string, unknown> => isRecord(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 160
const boundedNumber = (value: unknown, minimum: number, maximum: number, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(minimum, Math.min(maximum, value))) : fallback

// lowdb v1 是 CommonJS 实现，可在 Electron 33 的 CommonJS 主进程中稳定加载。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const low = require('lowdb') as (adapter: unknown) => LowDbAdapter
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileSync = require('lowdb/adapters/FileSync') as new (path: string) => unknown

export class DataStore {
  private db!: LowDbAdapter
  private filePath = ''

  private normalize(source: unknown): AppData {
    const defaults = defaultData()
    const incoming = isRecord(source) ? source : {}
    const records = <T>(key: keyof AppData): T[] => Array.isArray(incoming[key]) ? incoming[key].filter(hasStringId) as T[] : []
    const rawSettings = isRecord(incoming.settings) ? incoming.settings : {}
    const data: AppData = {
      ...defaults,
      ...incoming,
      settings: { ...defaults.settings, ...rawSettings },
      favorites: records<AppData['favorites'][number]>('favorites'),
      todos: records<AppData['todos'][number]>('todos'),
      categories: records<AppData['categories'][number]>('categories'),
      storageItems: records<AppData['storageItems'][number]>('storageItems'),
      mappings: records<AppData['mappings'][number]>('mappings'),
      notes: records<AppData['notes'][number]>('notes'),
      clipboardHistory: records<AppData['clipboardHistory'][number]>('clipboardHistory'),
      iconLayouts: records<AppData['iconLayouts'][number]>('iconLayouts'),
      widgetLayouts: records<AppData['widgetLayouts'][number]>('widgetLayouts').filter(validWidgetLayout).slice(0, 10),
      desktopModules: records<AppData['desktopModules'][number]>('desktopModules'),
      desktopZones: records<AppData['desktopZones'][number]>('desktopZones'),
      inboxItems: records<AppData['inboxItems'][number]>('inboxItems'),
      organizerRules: records<AppData['organizerRules'][number]>('organizerRules'),
      fileOperations: records<AppData['fileOperations'][number]>('fileOperations'),
      recentFiles: records<AppData['recentFiles'][number]>('recentFiles')
    }

    try { data.suite = validateSuite(incoming.suite ?? defaultSuite()) }
    catch { data.suite = defaultSuite() }
    data.hydrationDay = hydrationDayAt(incoming.hydrationDay, Date.now())
    try { data.settings.hydrationPlan = validateHydrationPlan(rawSettings.hydrationPlan) }
    catch { data.settings.hydrationPlan = structuredClone(defaults.settings.hydrationPlan) }
    data.desktopItems = []
    data.desktopAssignments = isRecord(incoming.desktopAssignments) ? Object.fromEntries(Object.entries(incoming.desktopAssignments).filter(([path, id]) => path.length <= 32767 && typeof id === 'string' && id.length <= 160).slice(0, 10000)) as Record<string, string> : {}
    data.settings.desktopCollected = typeof rawSettings.desktopCollected === 'boolean' ? rawSettings.desktopCollected : defaults.settings.desktopCollected

    // 错误设置不能让主窗口边界或模式在首次初始化时崩溃。
    data.settings.theme = ['light', 'dark', 'system'].includes(String(rawSettings.theme)) ? rawSettings.theme as AppData['settings']['theme'] : defaults.settings.theme
    data.settings.fontSize = boundedNumber(rawSettings.fontSize, 12, 20, defaults.settings.fontSize)
    data.settings.panelOpacity = boundedNumber(rawSettings.panelOpacity, 15, 100, defaults.settings.panelOpacity)
    data.settings.panelWidth = boundedNumber(rawSettings.panelWidth, 760, 1600, defaults.settings.panelWidth)
    data.settings.panelHeight = boundedNumber(rawSettings.panelHeight, 520, 1000, defaults.settings.panelHeight)
    data.settings.panelMode = ['edge', 'floating', 'pinned'].includes(String(rawSettings.panelMode)) ? rawSettings.panelMode as AppData['settings']['panelMode'] : defaults.settings.panelMode
    data.settings.panelPosition = ['left', 'right', 'top', 'bottom'].includes(String(rawSettings.panelPosition)) ? rawSettings.panelPosition as AppData['settings']['panelPosition'] : defaults.settings.panelPosition
    data.settings.desktopModuleOpacity = boundedNumber(rawSettings.desktopModuleOpacity, 0, 100, defaults.settings.desktopModuleOpacity)
    data.settings.desktopSnapDistance = boundedNumber(rawSettings.desktopSnapDistance, 6, 16, defaults.settings.desktopSnapDistance)
    data.settings.desktopIconAutoSortEnabled = rawSettings.desktopIconAutoSortEnabled === true
    data.settings.desktopIconSortOnboardingSeen = rawSettings.desktopIconSortOnboardingSeen === true
    data.settings.desktopHoverExpandEnabled = typeof rawSettings.desktopHoverExpandEnabled === 'boolean' ? rawSettings.desktopHoverExpandEnabled : defaults.settings.desktopHoverExpandEnabled
    data.settings.desktopHoverCollapseDelay = boundedNumber(rawSettings.desktopHoverCollapseDelay, 180, 2000, defaults.settings.desktopHoverCollapseDelay)
    data.settings.desktopWidgetVersion = boundedNumber(rawSettings.desktopWidgetVersion, 0, 5, 0)
    data.settings.collectionSorts = normalizeCollectionSorts(rawSettings.collectionSorts)
    data.settings.collectionRules = normalizeCollectionRules(rawSettings.collectionRules)
    data.settings.healthSoundEnabled = rawSettings.healthSoundEnabled === true
    data.settings.desktopModeEnabled = typeof rawSettings.desktopModeEnabled === 'boolean' ? rawSettings.desktopModeEnabled : true
    data.settings.desktopIconAutoSortEnabled = false
    Object.assign(data.settings, normalizeReminderSettings(rawSettings, defaults.settings))
    if (!Array.isArray(rawSettings.shortcuts)) data.settings.shortcuts = defaults.settings.shortcuts

    // 任何不满足窗口/规则关键结构的模块数据均回退默认或忽略，避免单条坏记录阻塞启动。
    const knownTodoIds = new Set<string>()
    data.todos = data.todos
      .filter((item) => typeof item.title === 'string' && item.title.length <= 500 && !knownTodoIds.has(item.id) && (knownTodoIds.add(item.id), true))
      .map((item, index) => ({
        ...item,
        categoryId: typeof item.categoryId === 'string' && item.categoryId ? item.categoryId : defaults.categories[0].id,
        completed: item.completed === true,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        dueAt: typeof item.dueAt === 'string' ? item.dueAt : undefined,
        reminderAt: typeof item.reminderAt === 'string' && Number.isFinite(Date.parse(item.reminderAt)) ? item.reminderAt : undefined,
        reminderNotifiedAt: typeof item.reminderNotifiedAt === 'string' ? item.reminderNotifiedAt : undefined,
        order: typeof item.order === 'number' && Number.isFinite(item.order) ? Math.round(item.order) : index
      }))
    data.favorites = data.favorites.filter((item) => typeof item.name === 'string' && typeof item.path === 'string' && typeof item.createdAt === 'string')
    data.notes = data.notes.filter((item) => typeof item.title === 'string' && typeof item.content === 'string' && typeof item.updatedAt === 'string' && typeof item.pinned === 'boolean')
    data.clipboardHistory = data.clipboardHistory.filter((item) => item.type === 'text' ? typeof item.text === 'string' && item.text.length <= 50_000 : item.type === 'image' && typeof item.imageDataUrl === 'string' && item.imageDataUrl.length <= 4_500_000).slice(0, 50)
    data.desktopModules = data.desktopModules.filter((item) => (['quick', 'todos', ...extraWidgetKinds] as string[]).includes(item.kind) && typeof item.title === 'string' && typeof item.visible === 'boolean' && typeof item.collapsed === 'boolean' && [item.x, item.y, item.width, item.height].every((value) => typeof value === 'number' && Number.isFinite(value)))
    for(const item of [...data.desktopModules,...data.desktopZones]) {
      const bounds=item.preferredBounds
      if(bounds && (![bounds.x,bounds.y,bounds.width,bounds.height].every(value=>typeof value==='number' && Number.isFinite(value)) || bounds.width<240 || bounds.height<120)) delete item.preferredBounds
    }
    if (!data.desktopModules.length) data.desktopModules = defaults.desktopModules
    data.desktopZones = data.desktopZones.filter((item) => typeof item.name === 'string' && typeof item.visible === 'boolean' && typeof item.collapsed === 'boolean' && typeof item.locked === 'boolean' && Array.isArray(item.itemIds) && [item.x, item.y, item.width, item.height].every((value) => typeof value === 'number' && Number.isFinite(value)))
    data.organizerRules = data.organizerRules.filter((item) => typeof item.name === 'string' && typeof item.enabled === 'boolean' && Array.isArray(item.extensions) && ['zone', 'folder'].includes(item.targetType) && typeof item.priority === 'number' && Number.isFinite(item.priority))

    const home = app.getPath('home')
    const desktop = join(home, 'Desktop')
    const downloads = app.getPath('downloads')
    data.favorites = data.favorites.length ? data.favorites.map((item) => {
      if (item.id === 'desktop' && !item.path) return { ...item, path: desktop }
      if (item.id === 'downloads' && !item.path) return { ...item, path: downloads }
      return item
    }) : defaults.favorites.map((item) => item.id === 'desktop' ? { ...item, path: desktop } : item.id === 'downloads' ? { ...item, path: downloads } : item)
    return data
  }

  async init(customDirectory?: string): Promise<AppData> {
    const baseDirectory = customDirectory || join(app.getPath('userData'), 'data')
    await mkdir(baseDirectory, { recursive: true })
    this.filePath = join(baseDirectory, 'toolbox-data.json')
    let persisted: AppData | undefined
    try {
      this.db = this.createDatabase(this.filePath)
      persisted = this.db.getState()
    } catch (error) {
      // 不覆盖不可解析的原件：先以时间戳保留，再从默认状态安全启动。
      const recoveryPath = `${this.filePath}.corrupt-${Date.now()}.json`
      try { await rename(this.filePath, recoveryPath) } catch { /* 文件可能不存在或被外部进程占用，继续创建独立默认库。 */ }
      this.db = this.createDatabase(this.filePath)
      persisted = undefined
      console.error('[数据恢复] 本地配置无法解析，已保留原文件副本。', error)
    }
    if(persisted && existsSync(this.filePath)) {
      let needsBackup=!(persisted as AppData).suite
      try {if(persisted.suite) validateSuite(persisted.suite)} catch {needsBackup=true}
      if(needsBackup) {
        const backupPath=`${this.filePath}.before-widget-suite-${Date.now()}.json`
        await copyFile(this.filePath,backupPath,constants.COPYFILE_EXCL)
      }
    }
    const normalized = this.normalize(persisted)
    this.db.setState(normalized)
    this.db.write()
    return normalized
  }

  private createDatabase(filePath: string): LowDbAdapter { return low(new FileSync(filePath)) }
  get data(): AppData { const data = this.db.getState(); if (!data) throw new Error('工具箱数据尚未初始化。'); return data }
  async update(mutator: (data: AppData) => void): Promise<AppData> { const data = this.data; mutator(data); this.db.setState(data); this.db.write(); return data }
  async replace(data: AppData): Promise<AppData> { const normalized = this.normalize(data); this.db.setState(normalized); this.db.write(); return normalized }
  async reset(): Promise<AppData> { return this.replace(defaultData()) }
  async exportTo(destination: string): Promise<void> { this.db.write(); await mkdir(dirname(destination), { recursive: true }); await copyFile(this.filePath, destination) }
  async importFrom(source: string): Promise<AppData> { let candidate: AppData | undefined; try { candidate = this.createDatabase(source).getState() } catch { throw new Error('所选文件不是有效的桌面工具箱配置文件。') }; if (!candidate || !isRecord(candidate) || !isRecord(candidate.settings) || !Array.isArray(candidate.todos)) throw new Error('所选文件不是有效的桌面工具箱配置文件。'); if(candidate.suite) validateSuite(candidate.suite); await this.exportTo(`${this.filePath}.before-import-${Date.now()}.json`); return this.replace(candidate) }
  async moveDataDirectory(targetDirectory: string): Promise<AppData> {
    await mkdir(targetDirectory, { recursive: true })
    const targetFile = join(targetDirectory, 'toolbox-data.json')
    const sourceFile = this.filePath
    // 仅在源库确实不存在时允许初始化新目录；已有源库的复制错误必须向上报告，不能静默切换为空库。
    if (existsSync(sourceFile) && resolve(sourceFile).toLowerCase() !== resolve(targetFile).toLowerCase()) {
      await access(sourceFile, constants.F_OK)
      this.db.write()
      await copyFile(sourceFile, targetFile)
    }
    await this.init(targetDirectory)
    return this.update((data) => { data.settings.dataDirectory = targetDirectory })
  }
}

export const store = new DataStore()
