import type { WidgetSuite, ExtraWidgetKind } from './widget-suite'
import { defaultSuite } from './widget-suite'
import { defaultHydrationPlan, type HydrationPlan, type HydrationDay } from './hydration-plan'
export type ThemeMode = 'light' | 'dark' | 'system'
export type PanelMode = 'edge' | 'floating' | 'pinned'
export type SortMode = 'manual' | 'createdAt' | 'dueDate' | 'status'

export interface FileFilters {
  keyword: string
  extension?: string
  path?: string
  minSize?: number
  maxSize?: number
  modifiedAfter?: string
  modifiedBefore?: string
}

export interface FileResult {
  path: string
  name: string
  extension: string
  size: number
  modifiedAt: string
  isDirectory: boolean
}

export interface FavoriteFolder {
  id: string
  name: string
  path: string
  color: string
  createdAt: string
}

export interface TodoCategory {
  id: string
  name: string
  color: string
}

export interface TodoItem {
  id: string
  title: string
  categoryId: string
  completed: boolean
  createdAt: string
  dueAt?: string
  reminderAt?: string
  reminderNotifiedAt?: string
  order: number
}

export interface StorageItem {
  id: string
  parentId: string | null
  name: string
  sourcePath?: string
  type: 'folder' | 'file'
  createdAt: string
}

export interface MappingItem {
  id: string
  name: string
  target: string
  kind: 'folder' | 'file' | 'url'
  icon?: string
  createdAt: string
}

export interface StickyNote {
  id: string
  title: string
  content: string
  color: string
  /** 是否以独立悬浮窗口显示。 */
  floating?: boolean
  /** 独立窗口的上次位置与尺寸；旧数据缺失时使用安全默认值。 */
  windowBounds?: { x: number; y: number; width: number; height: number }
  pinned: boolean
  updatedAt: string
}

export interface ClipboardItem {
  id: string
  type: 'text' | 'image'
  text?: string
  imageDataUrl?: string
  pinned?: boolean
  createdAt: string
}

export interface IconLayoutEntry {
  path: string
  name?: string
  x: number
  y: number
}

export interface IconLayoutBackup {
  id: string
  name: string
  createdAt: string
  spacingX?: number
  spacingY?: number
  native?: boolean
  entries: IconLayoutEntry[]
}

/** 仅改变 Explorer 图标坐标的分类布局预览；不涉及任何文件移动。 */
export interface DesktopIconArrangeItem extends IconLayoutEntry {
  category: DesktopFileCategory
  status: 'planned' | 'skipped'
  reason?: string
}

export interface DesktopIconArrangePlan {
  createdAt: string
  itemCount: number
  autoArrangeDetected: boolean
  spacingX: number
  spacingY: number
  entries: DesktopIconArrangeItem[]
  counts: Record<DesktopFileCategory, number>
  warnings: string[]
}

export interface ShortcutConfig {
  action: 'toggle-panel' | 'search' | 'screenshot' | 'todo' | 'note'
  accelerator: string
  enabled: boolean
}

export type DesktopModuleKind = 'quick' | 'todos' | ExtraWidgetKind

export interface DesktopModule {
  id: string
  kind: DesktopModuleKind
  title: string
  visible: boolean
  collapsed: boolean
  x: number
  y: number
  width: number
  height: number
  displayId?: number
  preferredBounds?: {x:number;y:number;width:number;height:number}
}

export interface WidgetLayoutBackup {
  id: string
  name: string
  createdAt: string
  modules: Array<Pick<DesktopModule, 'id' | 'x' | 'y' | 'width' | 'height' | 'collapsed'> & Partial<Pick<DesktopModule, 'visible' | 'displayId' | 'preferredBounds'>>>
  zones?: DesktopZone[]
  suite?: Pick<WidgetSuite, 'background' | 'textColor' | 'fontSize'>
  opacity: number
  sorts: AppSettings['collectionSorts']
  assignments: Record<string, string>
  rules?: AppSettings['collectionRules']
}

export interface DesktopZone {
  displayId?: number
  preferredBounds?: {x:number;y:number;width:number;height:number}
  id: string
  name: string
  color: string
  opacity: number
  visible: boolean
  collapsed: boolean
  locked: boolean
  x: number
  y: number
  width: number
  height: number
  itemIds: string[]
  createdAt: string
}

export interface InboxItem {
  isDirectory?: boolean
  modifiedAt?: string
  id: string
  type: 'file' | 'link' | 'text' | 'image'
  name: string
  sourcePath?: string
  content?: string
  createdAt: string
  archived: boolean
  zoneId?: string
}

export interface OrganizerRule {
  id: string
  name: string
  enabled: boolean
  extensions: string[]
  nameIncludes?: string
  createdAfter?: string
  targetType: 'zone' | 'folder'
  targetId?: string
  targetPath?: string
  priority: number
  createdAt: string
}

export interface FileOperationItem {
  sourcePath: string
  targetPath?: string
  action: 'move' | 'rename'
  status: 'planned' | 'completed' | 'skipped' | 'failed' | 'reverted'
  reason?: string
}

export interface FileOperationRecord {
  id: string
  kind: 'organize' | 'rename'
  createdAt: string
  reversible: boolean
  items: FileOperationItem[]
}

export interface RecentFile {
  path: string
  name: string
  kind: 'opened' | 'downloaded' | 'modified'
  occurredAt: string
}

export type DesktopFileCategory = 'image' | 'document' | 'archive' | 'installer' | 'shortcut' | 'folder' | 'video' | 'audio' | 'system' | 'other'

export interface DesktopScanItem {
  path: string
  identity?: string
  name: string
  extension: string
  category: DesktopFileCategory
  createdAt: string
  modifiedAt: string
  isDirectory: boolean
}

export interface DesktopScanResult {
  desktopPath: string
  items: DesktopScanItem[]
  counts: Record<DesktopFileCategory, number>
}

export interface OrganizerPlanItem {
  sourcePath: string
  targetPath?: string
  action: 'assign' | 'move'
  status: 'planned' | 'skipped'
  reason?: string
  zoneId?: string
}

export interface OrganizerPlan {
  desktopPath: string
  items: OrganizerPlanItem[]
}

export interface BatchRenamePlanItem {
  sourcePath: string
  targetPath?: string
  status: 'planned' | 'skipped'
  reason?: string
}

export interface BatchRenamePlan {
  items: BatchRenamePlanItem[]
}

export interface CollectionSort { by: 'name' | 'type' | 'createdAt' | 'modifiedAt'; direction: 'asc' | 'desc' }
export interface AppSettings {
  collectionRules: Record<string, 'apps' | 'files' | 'images' | 'media'>
  collectionSorts: Record<'apps' | 'files' | 'images' | 'media', CollectionSort>
  theme: ThemeMode
  fontSize: number
  panelColor: string
  panelOpacity: number
  panelWidth: number
  panelHeight: number
  panelMode: PanelMode
  panelPosition: 'left' | 'right' | 'top' | 'bottom'
  iconSpacing: number
  snapMode: 'grid' | 'edge' | 'none'
  hideDesktopIcons: boolean
  autoStart: boolean
  checkUpdates: boolean
  updateUrl: string
  dataDirectory: string
  searchAuthorized: boolean
  /** 启用后显示轻量透明的桌面工作模块，而非占据主面板。 */
  desktopCollected: boolean
  desktopWidgetVersion: number
  desktopModeEnabled: boolean
  desktopModuleOpacity: number
  desktopSnapDistance: number
  /** 用户明确启用后，启动时仅按类型重排 Explorer 图标坐标，不移动文件。 */
  desktopIconAutoSortEnabled: boolean
  /** 首次桌面体检提示的显示状态，避免反复打扰。 */
  desktopIconSortOnboardingSeen: boolean
  /** 透明模块是否可在鼠标悬停时临时展开。 */
  desktopHoverExpandEnabled: boolean
  /** 鼠标离开后的收起延迟，防止频繁闪动。 */
  desktopHoverCollapseDelay: number
  hydrationPlan: HydrationPlan
  hydrationReminderEnabled: boolean
  healthSoundEnabled: boolean
  hydrationIntervalMinutes: number
  sedentaryReminderEnabled: boolean
  sedentaryIntervalMinutes: number
  shortcuts: ShortcutConfig[]
}

export interface AppData {
  suite: WidgetSuite
  settings: AppSettings
  hydrationDay: HydrationDay
  favorites: FavoriteFolder[]
  todos: TodoItem[]
  categories: TodoCategory[]
  storageItems: StorageItem[]
  mappings: MappingItem[]
  notes: StickyNote[]
  clipboardHistory: ClipboardItem[]
  iconLayouts: IconLayoutBackup[]
  desktopModules: DesktopModule[]
  desktopItems: DesktopScanItem[]
  desktopAssignments: Record<string, string>
  widgetLayouts: WidgetLayoutBackup[]
  desktopZones: DesktopZone[]
  inboxItems: InboxItem[]
  organizerRules: OrganizerRule[]
  fileOperations: FileOperationRecord[]
  recentFiles: RecentFile[]
}

export const defaultSettings: AppSettings = {
  collectionRules: {},
  collectionSorts: { apps: { by: 'name', direction: 'asc' }, files: { by: 'type', direction: 'asc' }, images: { by: 'type', direction: 'asc' }, media: { by: 'type', direction: 'asc' } },
  theme: 'dark',
  fontSize: 14,
  panelColor: '#1d2a44',
  panelOpacity: 94,
  panelWidth: 1080,
  panelHeight: 720,
  panelMode: 'floating',
  panelPosition: 'right',
  iconSpacing: 16,
  snapMode: 'grid',
  hideDesktopIcons: false,
  autoStart: false,
  checkUpdates: false,
  updateUrl: 'https://github.com/',
  dataDirectory: '',
  searchAuthorized: false,
  desktopCollected: true,
  desktopWidgetVersion: 0,
  desktopModeEnabled: true,
  desktopModuleOpacity: 70,
  desktopSnapDistance: 10,
  desktopIconAutoSortEnabled: false,
  desktopIconSortOnboardingSeen: false,
  desktopHoverExpandEnabled: true,
  desktopHoverCollapseDelay: 360,
  hydrationPlan: { ...defaultHydrationPlan },
  hydrationReminderEnabled: false,
  hydrationIntervalMinutes: 30,
  healthSoundEnabled: false,
  sedentaryReminderEnabled: false,
  sedentaryIntervalMinutes: 60,
  shortcuts: [
    { action: 'toggle-panel', accelerator: 'CommandOrControl+Shift+Space', enabled: true },
    { action: 'todo', accelerator: 'CommandOrControl+Shift+T', enabled: true }
  ]
}

export const defaultData = (): AppData => ({
  suite: defaultSuite(),
  settings: structuredClone(defaultSettings),
  hydrationDay: { date: '', consumedMl: 0 },
  favorites: [
    { id: 'desktop', name: '桌面', path: '', color: '#6d8cff', createdAt: new Date().toISOString() },
    { id: 'downloads', name: '下载', path: '', color: '#68d7b3', createdAt: new Date().toISOString() }
  ],
  todos: [],
  categories: [
    { id: 'work', name: '工作', color: '#6d8cff' },
    { id: 'personal', name: '个人', color: '#ee8ba8' },
    { id: 'follow', name: '待跟进', color: '#f3b56c' }
  ],
  storageItems: [],
  mappings: [],
  notes: [],
  clipboardHistory: [],
  iconLayouts: [],
  desktopModules: [
    { id: 'quick', kind: 'quick', title: '快捷操作', visible: true, collapsed: false, x: 42, y: 118, width: 316, height: 164 },
    { id: 'todos', kind: 'todos', title: '今日待办', visible: true, collapsed: false, x: 374, y: 118, width: 316, height: 202 }
  ],
  desktopItems: [],
  desktopAssignments: {},
  widgetLayouts: [],
  desktopZones: [],
  inboxItems: [],
  organizerRules: [],
  fileOperations: [],
  recentFiles: []
})

export const createId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
