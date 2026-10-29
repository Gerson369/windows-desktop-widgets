import { captureWellnessUndo, validateWellnessUndo, type WellnessUndo } from './wellness-undo'
import { desktopPanels, setPanelVisibility, assistantTools, assistantDetailTools } from './desktop-panels'
import { defaultSuite, validateSuite, extraWidgetKinds, widgetTitles, changeFocus, focusRemaining, type WidgetSuite } from './widget-suite'
import { agenda, validateCalendar } from './calendar-service'
import { readFile, stat } from 'node:fs/promises'
import { publicText } from './public-request'
import { cityWeather, searchCities } from './weather-service'
import { readMetrics } from './device-metrics'
import { hydrationDayAt, hydrationPlanSnapshot, hydrationPlanClock, overdueHydrationClock, validateHydrationPlan, recordHydration } from './hydration-plan'
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, screen, shell, Tray } from 'electron'
import { basename, extname, isAbsolute, join } from 'node:path'
import { existsSync } from 'node:fs'
import { createId, defaultData, type AppData, type AppSettings, type DesktopIconArrangePlan, type DesktopModule, type DesktopZone, type InboxItem, type MappingItem, type OrganizerRule, type StickyNote, type StorageItem, type TodoItem } from './types'
import { store } from './store'
import { synchronizeDesktopGroups, selectVisibleDesktopItems, canReuseDesktopInventory, desktopCoverageProblems, migrateDesktopCollection, placeStartupWidgets } from './desktop-widgets'
import { snapWidgetBounds, snapResizedWidgetBounds, draggedWidgetBounds, fitWidgetToWorkArea, type WidgetResizeEdge } from './widget-snap'
import { dockedWidgetBounds, findWidgetDock, fitDockedParent } from './widget-docking'
import { normalizeCollectionSorts, normalizeCollectionRules, type CollectionProgress } from './desktop-collection'
import { dueTodoReminders, validateTodoReminder } from './todo-reminders'
import { renameCollectedFile } from './file-rename'
import { classifyDesktopItem } from './desktop-categories'
import { collectDesktop, releaseDesktop, updateDesktopCollection, startDesktopGestures, stopDesktopGestures } from './desktop-host'
import { readFileIcon, invalidateFileIcon } from './file-icons'
import { captureWidgetLayout, applyWidgetLayout } from './widget-layout'
import { readShellDesktopItems, isDesktopInventoryCurrent, type ShellDesktopItem } from './desktop-shell'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { normalizeReminderSettings, tickReminders, respondToReminder, resumeReminderClocks, hydrationCupMl, hydrationReminderVisual, type ReminderKind, type ReminderState, type WellnessSnapshot, type ReminderSettings } from './wellness-reminders'
import { applyBackup, createCategoryLayoutPlan, getDesktopStatus, readDesktopLayout, refreshNativeDesktopIcons, setDesktopSpacing, snapDesktopToGrid, snapSelectedDesktopIconsToEdge, toBackup } from './desktop-layout'
import { captureDisplay, captureFullScreen, captureWindowList, copyImageDataUrl, inspectSearchBackend, openPath, refreshIconCache, revealPath, searchFiles, setWindowsDesktopIconsHidden, watchDirectory } from './system-services'
import { assignOrganizationItem, desktopRoot, executeBatchRename, executeOrganization, previewBatchRename, previewOrganization, recentDesktopFiles, revertOperation, scanDesktop } from './organizer-services'

let widgetsTemporarilyHidden = false
let mainWindow: BrowserWindow | null = null
let mainWindowExplicitOpen = false
let quickSearchWindow: BrowserWindow | null = null
let edgeHoverPoller: NodeJS.Timeout | null = null
let captureOverlayWindow: BrowserWindow | null = null
let captureSource: { dataUrl: string; width: number; height: number } | null = null
const noteWindows = new Map<string, BrowserWindow>()
const desktopModuleWindows = new Map<string, BrowserWindow>()
const desktopModuleBoundsTimers = new Map<string, NodeJS.Timeout>()
const draggingDesktopWidgets = new Set<string>()
const resizingDesktopWidgets = new Set<string>()
const isDesktopWidgetInteracting = (id: string): boolean => draggingDesktopWidgets.has(id) || resizingDesktopWidgets.has(id)
const desktopDragOrigins = new Map<string,{bounds:Electron.Rectangle;pointer:Electron.Point}>()
const hoverExpandedModules = new Set<string>()
const applyingDesktopModuleBounds = new Set<string>()
const desktopZoneWindows = new Map<string, BrowserWindow>()
const desktopZoneBoundsTimers = new Map<string, NodeJS.Timeout>()
const applyingDesktopZoneBounds = new Set<string>()
const changingFilePaths = new Set<string>()
let restorePanelAfterCapture = false
let tray: Tray | null = null
let quitting = false
let desktopReleasePending = false
let desktopReleased = false
let collectionBusy = false
let collectionTask: Promise<AppData> | null = null
let collectionProgress: CollectionProgress = {busy:false,message:'',failed:false}
let startupCollectionCancelled = false
let desktopRecoveryTimer: NodeJS.Timeout | null = null
let shellDesktopItems: ShellDesktopItem[] = []
let reminderTimer: NodeJS.Timeout | null = null
let desktopSortTimer: NodeJS.Timeout | null = null
let wellnessReminderState: ReminderState = {}
let wellnessUndo: WellnessUndo | null = null
let wellnessPaused = false
let wellnessPausedAt: number | null = null
const wellnessNotifications = new Map<ReminderKind, Notification>()
let directoryUnwatchers: Array<() => void> = []
const todoNotifications = new Map<string, Notification>()
/** 每个渲染上下文至多保留一项本地搜索；新请求、窗口隐藏或销毁均会取消旧扫描。 */
const activeFileSearches = new Map<number, AbortController>()
const pendingLayoutPreviews = new Map<number, { plan: DesktopIconArrangePlan; fingerprint: string; createdAt: number }>()
const pendingOrganizerPreviews = new Map<number, { plan: import('./types').OrganizerPlan; createdAt: number }>()
const pendingBatchRenamePreviews = new Map<number, { key: string; plan: import('./types').BatchRenamePlan; createdAt: number }>()
const PREVIEW_CONFIRMATION_TTL_MS = 5 * 60_000
const batchRenamePreviewKey = (paths: string[], prefix: string, start: number): string => JSON.stringify([paths.slice(0, 100), prefix, start])
const cancelFileSearch = (webContentsId: number): void => {
  const controller = activeFileSearches.get(webContentsId)
  if (controller) controller.abort()
  activeFileSearches.delete(webContentsId)
}

const isDevelopment = !app.isPackaged
// 仅在端到端验收显式开启时开放本地调试端口，避免普通开发环境与其他服务争抢 9222。
if (isDevelopment && process.env.GERSON_E2E_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.GERSON_E2E_DEBUG_PORT || '9222')
}
const isolatedTest = isDevelopment && process.env.GERSON_E2E_DEBUG==='1' && process.env.GERSON_E2E_DATA_DIRECTORY && isAbsolute(process.env.GERSON_E2E_DATA_DIRECTORY)
if(isolatedTest) app.setPath('userData',process.env.GERSON_E2E_DATA_DIRECTORY!)
const skipTestDesktop = Boolean(isolatedTest && process.env.GERSON_E2E_SKIP_DESKTOP==='1')
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => {
  if (!mainWindow || collectionBusy) return
  void toggleDashboard().catch(console.error)
})
const rendererUrl = process.env.ELECTRON_RENDERER_URL
const isSafeFilesystemPath = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 32_767 && isAbsolute(value.trim())
const isAllowedExternalUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return false
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol) } catch { return false }
}
const isPngDataUrl = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= 60_000_000

const sendToRenderer = (channel: string, payload?: unknown): void => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

const hardenRendererWindow = (window: BrowserWindow): void => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
}

const broadcastData = (): void => {
  sendToRenderer('data:changed', store.data)
  const suite=store.data.suite
  for (const window of [mainWindow, ...desktopModuleWindows.values(), ...desktopZoneWindows.values()]) {
    if(window && !window.isDestroyed()) void window.webContents.executeJavaScript(`document.documentElement.style.setProperty('--widget-background','${suite.background}');document.documentElement.style.setProperty('--widget-text','${suite.textColor}');document.documentElement.style.setProperty('--widget-font-size','${suite.fontSize}px')`).catch(()=>undefined)
  }
  for (const window of [...desktopModuleWindows.values(), ...desktopZoneWindows.values()]) {
    if (!window.isDestroyed()) window.webContents.send('data:changed', store.data)
  }
}

const applySettings = (settings: AppSettings): void => {
  nativeTheme.themeSource = settings.theme
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(1)
    mainWindow.setSize(420, 600)
    if (settings.panelMode === 'pinned') mainWindow.setAlwaysOnTop(true, 'floating')
    else mainWindow.setAlwaysOnTop(false)
  }
  if(!isolatedTest) app.setLoginItemSettings({ openAtLogin: settings.autoStart, openAsHidden: true, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ['--hidden'] })
  closeEdgeTrigger()
  void refreshDesktopModules()
  void refreshDesktopZones()
}

const getPanelBounds = (settings = store.data.settings): Electron.Rectangle => {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return { x: area.x + area.width - 436, y: area.y + 24, width: 420, height: Math.min(600, area.height - 48) }
}

const loadRenderer = async (window: BrowserWindow, query?: Record<string, string>): Promise<void> => {
  if (rendererUrl) {
    const suffix = query ? `${rendererUrl.includes('?') ? '&' : '?'}${new URLSearchParams(query).toString()}` : ''
    await window.loadURL(`${rendererUrl}${suffix}`)
  } else await window.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined)
}

const createMainWindow = async (): Promise<BrowserWindow> => {
  const settings = store.data.settings
  const window = new BrowserWindow({
    ...getPanelBounds(settings),
    minWidth: 380,
    minHeight: 420,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  window.setOpacity(1)
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindowExplicitOpen = false
      window.hide()
    }
  })
  // 边缘模式的自动折叠由 edge trigger 的鼠标位置轮询处理，避免仅依赖 blur 而导致鼠标移出后仍停留。
  hardenRendererWindow(window)
  await loadRenderer(window)
  mainWindow = window
  return window
}

const showMainWindow = async (section?: string, explicit = true): Promise<void> => {
  if(section === 'settings' || section === 'reminders' || section?.startsWith('settings:') || [...assistantTools,...assistantDetailTools].some(tool=>tool.id===section)) {
    await showDesktopWidgets()
    await updateDesktopModule('todos', {visible:true,collapsed:false})
    const assistant=desktopModuleWindows.get('todos')
    assistant?.webContents.send('navigate', section)
    assistant?.moveTop(); assistant?.focus()
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) await createMainWindow()
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  // 按钮、托盘、快捷键和模块入口属于显式打开：边缘轮询不得在鼠标尚未移入窗口前立即收起。
  if (explicit) mainWindowExplicitOpen = true
  window.setBounds(getPanelBounds())
  if (window.isMinimized()) window.restore()
  window.show()
  window.moveTop()
  window.focus()
  if (section) sendToRenderer('navigate', section)
}

const showQuickSearchWindow = async (): Promise<void> => {
  if (quickSearchWindow && !quickSearchWindow.isDestroyed()) {
    quickSearchWindow.show()
    quickSearchWindow.focus()
    return
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = Math.min(720, Math.max(520, display.width - 40))
  const height = 460
  const window = new BrowserWindow({
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.max(display.y + 36, Math.round(display.y + (display.height - height) / 4)),
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  quickSearchWindow = window
  hardenRendererWindow(window)
  window.on('close', (event) => { if (!quitting) { event.preventDefault(); window.hide() } })
  window.on('closed', () => {
    cancelFileSearch(window.webContents.id)
    if (quickSearchWindow === window) quickSearchWindow = null
  })
  await loadRenderer(window, { quickSearch: '1' })
  window.show()
  window.focus()
}

const hideQuickSearchWindow = (): void => {
  if (quickSearchWindow && !quickSearchWindow.isDestroyed()) {
    cancelFileSearch(quickSearchWindow.webContents.id)
    quickSearchWindow.hide()
  }
}

const healthWidgetSize = {width:300,height:108}

const desktopModuleBounds = (module: DesktopModule): Electron.Rectangle => {
  const raw = {
  x: Math.round(module.x),
  y: Math.round(module.y),
  width: module.kind==='health' ? healthWidgetSize.width : Math.max(240, Math.round(module.width)),
  height: module.kind==='health' ? healthWidgetSize.height : module.collapsed && !hoverExpandedModules.has(module.id) ? 42 : Math.max(120, Math.round(module.height))
  }
  if(module.kind==='health' && module.dock){
    const parent=store.data.desktopModules.find(item=>item.id===module.dock!.parentId)
    if(parent)return dockedWidgetBounds(raw,module.dock,desktopModuleBounds(parent))
  }
  const health=store.data.desktopModules.find(item=>item.kind==='health' && item.visible && item.dock?.parentId===module.id)
  return health?.dock ? fitDockedParent(raw,{...health,...healthWidgetSize},health.dock,screen.getDisplayMatching(raw).workArea) : raw
}

const followDockedHealth = (parentId: string, bounds: Electron.Rectangle): void => {
  const health=store.data.desktopModules.find(item=>item.kind==='health' && item.dock?.parentId===parentId)
  const window=health && desktopModuleWindows.get(health.id)
  if(!health?.dock || !window || window.isDestroyed() || isDesktopWidgetInteracting(health.id))return
  applyingDesktopModuleBounds.add(health.id)
  try{window.setBounds(dockedWidgetBounds({...window.getBounds(),...healthWidgetSize},health.dock,bounds))}finally{applyingDesktopModuleBounds.delete(health.id)}
}

const snapDesktopModuleBounds = (movingId: string, raw: Electron.Rectangle, resizeEdge?: WidgetResizeEdge): Electron.Rectangle => {
  const display = screen.getDisplayNearestPoint({ x: raw.x + Math.round(raw.width / 2), y: raw.y + Math.round(raw.height / 2) }).workArea
  const neighbors = [...desktopModuleWindows, ...desktopZoneWindows]
    .filter(([id, window]) => id !== movingId && !window.isDestroyed() && window.isVisible())
    .filter(([id])=> !(id==='health' && store.data.desktopModules.find(item=>item.id==='health')?.dock?.parentId===movingId))
    .map(([, window]) => window.getBounds())
  const distance = store.data.settings.desktopSnapDistance
  const snapped = store.data.settings.snapMode === 'none' ? raw : resizeEdge ? snapResizedWidgetBounds(raw, display, neighbors, distance, resizeEdge) : snapWidgetBounds(raw, display, neighbors, distance)
  const health=store.data.desktopModules.find(item=>item.kind==='health' && item.visible && item.dock?.parentId===movingId)
  return health?.dock ? fitDockedParent(snapped,{...health,...healthWidgetSize},health.dock,display) : snapped
}

const bindDesktopWidgetMovement = (id: string, window: BrowserWindow, applying: Set<string>, persist: () => void): void => {
  if(id==='health')window.on('resize',()=>{
    if(window.isDestroyed())return
    const bounds=window.getBounds()
    if(bounds.width===healthWidgetSize.width && bounds.height===healthWidgetSize.height)return
    applying.add(id)
    try{window.setBounds({...window.getBounds(),...healthWidgetSize})}finally{applying.delete(id)}
  })

  window.on('move',()=>{if(!window.isDestroyed())followDockedHealth(id,window.getBounds())})
  window.on('resize',()=>{if(!window.isDestroyed())followDockedHealth(id,window.getBounds())})
  window.on('will-resize', (event, raw, details) => {
    if (applying.has(id)) return
    resizingDesktopWidgets.add(id)
    const snapped = snapDesktopModuleBounds(id, raw, details.edge)
    const [minimumWidth, minimumHeight] = window.getMinimumSize()
    if ((snapped.x === raw.x && snapped.y === raw.y && snapped.width === raw.width && snapped.height === raw.height) || snapped.width < minimumWidth || snapped.height < minimumHeight) return
    event.preventDefault()
    applying.add(id)
    try { window.setBounds(snapped) } finally { applying.delete(id) }
  })
  window.on('will-move', () => {
    if (applying.has(id)) return
    draggingDesktopWidgets.add(id)
  })
  window.on('moved', () => {
    if (applying.has(id) || resizingDesktopWidgets.has(id) || desktopDragOrigins.has(id) || window.isDestroyed()) return
    if (!draggingDesktopWidgets.delete(id)) return
    const raw = window.getBounds()
    const snapped = snapDesktopModuleBounds(id, raw)
    if (snapped.x !== raw.x || snapped.y !== raw.y || snapped.width !== raw.width || snapped.height !== raw.height) {
      applying.add(id)
      window.setBounds(snapped)
      applying.delete(id)
    }
    persist()
  })
  window.on('resize', () => { if (!isDesktopWidgetInteracting(id)) persist() })
  window.on('resized', () => { if (resizingDesktopWidgets.delete(id)) persist() })
  window.on('closed', () => { resizingDesktopWidgets.delete(id); draggingDesktopWidgets.delete(id); desktopDragOrigins.delete(id) })
}

const persistDesktopModuleBounds = (id: string, window: BrowserWindow): void => {
  if (applyingDesktopModuleBounds.has(id) || isDesktopWidgetInteracting(id)) return
  const previousTimer = desktopModuleBoundsTimers.get(id)
  if (previousTimer) clearTimeout(previousTimer)
  const timer = setTimeout(() => {
    const module = store.data.desktopModules.find((item) => item.id === id)
    if (!module || window.isDestroyed() || isDesktopWidgetInteracting(id)) return
    const bounds = window.getBounds()
    void store.update((data) => {
      const target = data.desktopModules.find((item) => item.id === id)
      if (!target) return
      target.x = bounds.x
      target.y = bounds.y
      target.displayId=screen.getDisplayMatching(bounds).id
      if (!target.collapsed) {
        target.width = bounds.width
        target.height = bounds.height
      }
      target.preferredBounds={x:target.x,y:target.y,width:target.width,height:target.height}
      if(id==='health')target.dock=findWidgetDock(bounds,[...desktopModuleWindows].filter(([parentId,parent])=>['quick','todos'].includes(parentId) && !parent.isDestroyed() && parent.isVisible()).map(([parentId,parent])=>({id:parentId,bounds:parent.getBounds()})))
      const health=data.desktopModules.find(item=>item.kind==='health' && item.dock?.parentId===id)
      const child=health && desktopModuleWindows.get(health.id)
      if(health && child && !child.isDestroyed())Object.assign(health,child.getBounds(),{preferredBounds:child.getBounds()})
    }).then(broadcastData)
  }, 180)
  desktopModuleBoundsTimers.set(id, timer)
}

const refreshDesktopModules = async (): Promise<void> => {
  if (!store.data.settings.desktopModeEnabled) {
    for (const window of desktopModuleWindows.values()) if (!window.isDestroyed()) window.hide()
    return
  }
  for (const module of desktopPanels(store.data.desktopModules)) {
    let window = desktopModuleWindows.get(module.id)
    if ((!module.visible || widgetsTemporarilyHidden) && (!window || window.isDestroyed())) continue
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({
        ...desktopModuleBounds(module),
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: module.kind!=='health' && !module.collapsed,
        minWidth: 300,
        minHeight: module.kind==='health' ? 108 : 42,
        maxWidth: module.kind==='health' ? healthWidgetSize.width : undefined,
        maxHeight: module.kind==='health' ? healthWidgetSize.height : undefined,
        skipTaskbar: true,
        show: false,
        webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
      })
      desktopModuleWindows.set(module.id, window)
      hardenRendererWindow(window)
      const moduleId = module.id
      bindDesktopWidgetMovement(moduleId, window, applyingDesktopModuleBounds, () => persistDesktopModuleBounds(moduleId, window!))
      window.on('close', (event) => {
        if (!quitting) {
          event.preventDefault()
          window?.hide()
          void updateDesktopModule(moduleId, { visible: false })
        }
      })
      window.on('closed', () => {
        hoverExpandedModules.delete(moduleId)
        const timer = desktopModuleBoundsTimers.get(moduleId)
        if (timer) clearTimeout(timer)
        desktopModuleBoundsTimers.delete(moduleId)
        desktopModuleWindows.delete(moduleId)
      })
      await loadRenderer(window, { desktopModule: module.id })
    }
    applyingDesktopModuleBounds.add(module.id)
    if(module.kind==='health')window.setMaximumSize(healthWidgetSize.width,healthWidgetSize.height)
    window.setMinimumSize(300, module.kind==='health' ? 108 : module.collapsed && !hoverExpandedModules.has(module.id) ? 42 : module.kind === 'quick' ? 280 : 160)
    if (!isDesktopWidgetInteracting(module.id)) window.setBounds(desktopModuleBounds(module))
    window.setResizable(module.kind!=='health' && !module.collapsed)
    applyingDesktopModuleBounds.delete(module.id)
    if (module.visible && !widgetsTemporarilyHidden) { if(window.isMinimized()) window.restore(); window.showInactive() }
    else window.hide()
  }
  if(store.data.settings.desktopCollected && !widgetsTemporarilyHidden) await updateDesktopCollection(collectionWindows())
}

const desktopZoneBounds = (zone: DesktopZone): Electron.Rectangle => ({
  x: Math.round(zone.x),
  y: Math.round(zone.y),
  width: Math.max(240, Math.round(zone.width)),
  height: zone.collapsed ? 42 : Math.max(120, Math.round(zone.height))
})

const persistDesktopZoneBounds = (id: string, window: BrowserWindow): void => {
  if (applyingDesktopZoneBounds.has(id) || isDesktopWidgetInteracting(id)) return
  const previous = desktopZoneBoundsTimers.get(id)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    const zone = store.data.desktopZones.find((item) => item.id === id)
    if (!zone || zone.locked || window.isDestroyed() || isDesktopWidgetInteracting(id)) return
    const bounds = window.getBounds()
    void store.update((data) => {
      const target = data.desktopZones.find((item) => item.id === id)
      if (!target || target.locked) return
      target.x = bounds.x
      target.y = bounds.y
      target.displayId=screen.getDisplayMatching(bounds).id
      if (!target.collapsed) { target.width = bounds.width; target.height = bounds.height }
      target.preferredBounds={x:target.x,y:target.y,width:target.width,height:target.height}
    }).then(broadcastData)
  }, 180)
  desktopZoneBoundsTimers.set(id, timer)
}

const refreshDesktopZones = async (): Promise<void> => {
  // Project zones now render inside the collection instead of creating desktop windows.
  for (const window of desktopZoneWindows.values()) if (!window.isDestroyed()) window.destroy()
  desktopZoneWindows.clear()
}

const updateDesktopZone = async (id: string, patch: Partial<Pick<DesktopZone, 'name' | 'visible' | 'collapsed' | 'locked' | 'color' | 'opacity'>>): Promise<AppData> => {
  if (patch.visible === false && store.data.settings.desktopCollected) await stopDesktopCollection()
  const result = await store.update((data) => {
    const zone = data.desktopZones.find((item) => item.id === id)
    if (!zone) throw new Error('未找到指定的桌面分区。')
    if (typeof patch.name === 'string') zone.name = patch.name.trim().slice(0, 24) || zone.name
    if (typeof patch.visible === 'boolean') zone.visible = patch.visible
    if (typeof patch.collapsed === 'boolean') zone.collapsed = patch.collapsed
    if (typeof patch.locked === 'boolean') zone.locked = patch.locked
    if (typeof patch.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.color)) zone.color = patch.color
    if (typeof patch.opacity === 'number' && Number.isFinite(patch.opacity)) zone.opacity = Math.round(Math.max(0, Math.min(100, patch.opacity)))
  })
  broadcastData()
  await refreshDesktopZones()
  return result
}

const updateDesktopModule = async (id: string, patch: Partial<Pick<DesktopModule, 'visible' | 'collapsed' | 'title'>>): Promise<AppData> => {
  if (id === 'quick' && patch.visible === false && store.data.settings.desktopCollected) await stopDesktopCollection()
  const result = await store.update((data) => {
    const module = data.desktopModules.find((item) => item.id === id)
    if (!module) throw new Error('未找到指定的桌面模块。')
    if (typeof patch.visible === 'boolean') setPanelVisibility(data.desktopModules, id, patch.visible)
    if (typeof patch.collapsed === 'boolean') module.collapsed = patch.collapsed
    if (typeof patch.title === 'string') module.title = patch.title.slice(0, 24)
  })
  broadcastData()
  await refreshDesktopModules()
  return result
}

const closeDesktopModuleWindows = (): void => {
  for (const window of desktopModuleWindows.values()) if (!window.isDestroyed()) window.destroy()
  desktopModuleWindows.clear()
}

const closeDesktopZoneWindows = (): void => {
  for (const window of desktopZoneWindows.values()) if (!window.isDestroyed()) window.destroy()
  desktopZoneWindows.clear()
}

const closeEdgeTrigger = (): void => {
  if (edgeHoverPoller) clearInterval(edgeHoverPoller)
  edgeHoverPoller = null
}

const pointInBounds = (point: Electron.Point, bounds: Electron.Rectangle): boolean => point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height

/**
 * 边缘唤出不再创建透明 BrowserWindow。旧实现的隐形窗口在某些 Windows 组合器中会拦截/丢失事件，
 * 导致主窗口和托盘均难以恢复；改用主进程读取鼠标坐标，不产生额外窗口和焦点竞争。
 */
const refreshEdgeTrigger = (): void => {
  closeEdgeTrigger()
  if (store.data.settings.panelMode !== 'edge') return
  edgeHoverPoller = setInterval(() => {
    const window = mainWindow
    if (!window || window.isDestroyed()) return
    const settings = store.data.settings
    const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const thickness = 6
    const triggerBounds: Electron.Rectangle = { x: work.x + work.width - thickness, y: work.y, width: thickness, height: work.height }
    if (settings.panelPosition === 'left') triggerBounds.x = work.x
    if (settings.panelPosition === 'top') Object.assign(triggerBounds, { x: work.x, y: work.y, width: work.width, height: thickness })
    if (settings.panelPosition === 'bottom') Object.assign(triggerBounds, { x: work.x, y: work.y + work.height - thickness, width: work.width, height: thickness })
    const cursor = screen.getCursorScreenPoint()
    if (!window.isVisible() && pointInBounds(cursor, triggerBounds)) {
      void showMainWindow(undefined, false)
      return
    }
    // 模块按钮、托盘和快捷键属于显式打开；仅由用户关闭，绝不被边缘轮询自动收起。
    if (window.isVisible() && mainWindowExplicitOpen) return
    if (window.isVisible() && !pointInBounds(cursor, window.getBounds()) && !pointInBounds(cursor, triggerBounds)) window.hide()
  }, 120)
  edgeHoverPoller.unref()
}

const startRegionCapture = async (): Promise<void> => {
  if (captureOverlayWindow && !captureOverlayWindow.isDestroyed()) {
    captureOverlayWindow.focus()
    return
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // 在主面板仍存在时完成采集，避免 Windows 在窗口切换期间阻塞桌面捕获；
  // 随后立即隐藏面板，透明采集窗口不会出现在最终图像中。
  restorePanelAfterCapture = Boolean(mainWindow?.isVisible())
  const previousOpacity = mainWindow?.getOpacity() ?? 1
  mainWindow?.setOpacity(0)
  try {
    await new Promise((resolve) => setTimeout(resolve, 80))
    const displayIndex = Math.max(0, screen.getAllDisplays().findIndex((item) => item.id === display.id))
    captureSource = await captureDisplay(displayIndex)
  } catch (error) {
    mainWindow?.setOpacity(previousOpacity)
    if (restorePanelAfterCapture) showMainWindow('system')
    restorePanelAfterCapture = false
    throw error
  }
  mainWindow?.setOpacity(previousOpacity)
  mainWindow?.hide()
  const overlay = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  captureOverlayWindow = overlay
  hardenRendererWindow(overlay)
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.on('closed', () => {
    if (captureOverlayWindow === overlay) captureOverlayWindow = null
    captureSource = null
    if (restorePanelAfterCapture) showMainWindow('system')
    restorePanelAfterCapture = false
  })
  await loadRenderer(overlay, { capture: '1' })
  overlay.show()
  overlay.focus()
}

const noteBounds = (note: StickyNote): Electron.Rectangle => {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const saved = note.windowBounds
  const width = Math.max(220, Math.min(saved?.width || 340, display.width))
  const height = Math.max(170, Math.min(saved?.height || 280, display.height))
  const x = saved?.x ?? Math.round(display.x + display.width - width - 28)
  const y = saved?.y ?? Math.round(display.y + display.height - height - 90)
  return { x: Math.max(display.x, Math.min(x, display.x + display.width - width)), y: Math.max(display.y, Math.min(y, display.y + display.height - height)), width, height }
}

const sendToNote = (id: string, channel: string, payload?: unknown): void => {
  const window = noteWindows.get(id)
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}

const saveNoteState = async (id: string, patch: Partial<StickyNote>): Promise<StickyNote> => {
  let updated: StickyNote | undefined
  await store.update((data) => {
    const note = data.notes.find((item) => item.id === id)
    if (!note) throw new Error('未找到指定的便签。')
    Object.assign(note, patch, { updatedAt: new Date().toISOString() })
    updated = note
  })
  if (!updated) throw new Error('未找到指定的便签。')
  const window = noteWindows.get(id)
  if (window && !window.isDestroyed()) {
    if (patch.title !== undefined) window.setTitle(updated.title)
    if (patch.pinned !== undefined) window.setAlwaysOnTop(updated.pinned, updated.pinned ? 'floating' : undefined)
  }
  sendToNote(id, 'note:changed', updated)
  broadcastData()
  return updated
}

const showFloatingNote = async (id: string, focus = true): Promise<StickyNote> => {
  const note = store.data.notes.find((item) => item.id === id)
  if (!note) throw new Error('未找到指定的便签。')
  const existing = noteWindows.get(id)
  if (existing && !existing.isDestroyed()) {
    if (!note.floating) await saveNoteState(id, { floating: true })
    if(focus){existing.show();existing.focus()}else existing.showInactive()
    return store.data.notes.find((item) => item.id === id)!
  }
  if (!note.floating) await saveNoteState(id, { floating: true })
  const current = store.data.notes.find((item) => item.id === id)!
  const window = new BrowserWindow({
    ...noteBounds(current),
    minWidth: 220,
    minHeight: 170,
    frame: false,
    transparent: false,
    resizable: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: current.pinned,
    title: current.title,
    backgroundColor: current.color,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  noteWindows.set(id, window)
  hardenRendererWindow(window)
  let boundsTimer: NodeJS.Timeout | null = null
  const queueBoundsSave = () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!window.isDestroyed()) void saveNoteState(id, { windowBounds: window.getBounds() })
    }, 260)
  }
  window.on('move', queueBoundsSave)
  window.on('resize', queueBoundsSave)
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
      void saveNoteState(id, { floating: false })
    }
  })
  window.on('closed', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    if (noteWindows.get(id) === window) noteWindows.delete(id)
  })
  await loadRenderer(window, { note: id })
  if(focus){window.show();window.focus()}else window.showInactive()
  return store.data.notes.find((item) => item.id === id)!
}

const hideFloatingNote = async (id: string): Promise<StickyNote> => {
  const window = noteWindows.get(id)
  if (window && !window.isDestroyed()) window.hide()
  return saveNoteState(id, { floating: false })
}

const closeAllNoteWindows = (): void => {
  for (const window of noteWindows.values()) window.destroy()
  noteWindows.clear()
}

const createTray = (): void => {
  // Windows 托盘优先使用实体 PNG；app.getAppPath() 在发布包中指向 app.asar，不能据此拼接 resources。
  const iconPath = app.isPackaged ? join(process.resourcesPath, 'tray-icon.png') : join(app.getAppPath(), 'resources', 'tray-icon.png')
  const preferredIcon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  const fallbackIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI5IiBmaWxsPSIjNTc3N0Q4Ii8+PHRleHQgeD0iMTYiIHk9IjIyIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXdlaWdodD0iNzAwIiBmb250LXNpemU9IjE4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5HPC90ZXh0Pjwvc3ZnPg==')
  const trayIcon = preferredIcon.isEmpty() ? fallbackIcon : preferredIcon.resize({ width: 32, height: 32 })
  tray = new Tray(trayIcon)
  tray.setToolTip('桌面搭子')
  const updateMenu = (): void => {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: '显示桌面小组件', click: () => { void showDesktopWidgets() } },
      { label: store.data.settings.desktopCollected ? '停止收纳，显示原桌面' : '自动收纳桌面', click: () => { void (store.data.settings.desktopCollected ? stopDesktopCollection() : startDesktopCollection()).catch(error => { new Notification({ title: '桌面收纳未完成', body: error.message }).show() }) } },
      { label: '刷新文件分类', click: () => { void refreshDesktopGroups().catch(console.error) } },
      { label: '设置与布局恢复', click: () => { void showMainWindow('settings') } },
      { label: '喝水与久坐提醒', click: () => { void showMainWindow('reminders') } },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit() } }
    ]))
  }
  updateMenu()
  tray.on('click', () => { void showDesktopWidgets() })
  tray.on('double-click', () => { void showDesktopWidgets() })
  tray.on('right-click', updateMenu)
  setInterval(updateMenu, 20_000).unref()
}

const backupNativeDesktopLayout = async (snapshot?: Awaited<ReturnType<typeof readDesktopLayout>>): Promise<{ id: string; count: number }> => {
  const layout = snapshot ?? await readDesktopLayout()
  const backup = toBackup(layout, `真实桌面布局 ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
  await store.update((data) => {
    data.iconLayouts = [backup, ...data.iconLayouts].slice(0, 20)
  })
  broadcastData()
  return { id: backup.id, count: backup.entries.length }
}

const restoreNativeDesktopLayout = async (id: string): Promise<number> => {
  const backup = store.data.iconLayouts.find((item) => item.id === id)
  if (!backup) throw new Error('未找到指定的桌面布局备份。')
  const status = await getDesktopStatus()
  if (!status.available) throw new Error(status.error || '桌面不可用。')
  if (status.autoArrange) throw new Error('请先关闭 Windows 的“自动排列图标”，再恢复位置。')
  await backupNativeDesktopLayout()
  const applied = await applyBackup(backup)
  await refreshNativeDesktopIcons()
  const actual = await readDesktopLayout()
  const mismatches = backup.entries.filter(entry => {
    const current = actual.entries.find(item => item.name === (entry.name || entry.path))
    return current && (current.x !== entry.x || current.y !== entry.y)
  })
  if (mismatches.length) throw new Error(`${mismatches.length} 个图标未恢复到备份位置，恢复前状态已保存。`)
  return applied
}

const restoreLatestCategoryLayout = async (): Promise<{ id: string; applied: number }> => {
  const backup = store.data.iconLayouts.find((item) => item.native && item.name.startsWith('分类前桌面布局'))
  if (!backup) throw new Error('尚无可还原的分类前桌面布局备份。')
  const applied = await restoreNativeDesktopLayout(backup.id)
  return { id: backup.id, applied }
}

const resetDesktopControlDefaults = async (): Promise<AppData> => {
  const defaults = defaultData().settings
  const data = await store.update((draft) => {
    draft.settings.iconSpacing = defaults.iconSpacing
    draft.settings.snapMode = defaults.snapMode
    draft.settings.desktopSnapDistance = defaults.desktopSnapDistance
    draft.settings.hideDesktopIcons = false
    draft.settings.desktopIconAutoSortEnabled = false
    draft.settings.desktopIconSortOnboardingSeen = false
    draft.settings.desktopHoverExpandEnabled = false
    draft.settings.desktopHoverCollapseDelay = defaults.desktopHoverCollapseDelay
  })
  applySettings(data.settings)
  broadcastData()
  return data
}

const captureCategoryLayout = async () => {
  const status = await getDesktopStatus()
  if (!status.available) throw new Error(status.error || '当前 Windows Explorer 桌面图标控件不可用。')
  const publicDesktop = process.platform === 'win32' && process.env.PUBLIC ? join(process.env.PUBLIC, 'Desktop') : null
  const [layout, scan, sharedScan] = await Promise.all([readDesktopLayout(), scanDesktop(), publicDesktop ? scanDesktop(publicDesktop) : Promise.resolve(null)])
  if (sharedScan) {
    scan.items = [...sharedScan.items, ...scan.items]
    for (const category of Object.keys(scan.counts) as Array<keyof typeof scan.counts>) scan.counts[category] += sharedScan.counts[category]
  }
  const displayArea = screen.getPrimaryDisplay().workArea
  // Explorer positions use physical pixels; Electron work areas use device-independent pixels.
  const workArea = process.platform === 'win32' ? screen.dipToScreenRect(null, displayArea) : displayArea
  const plan = createCategoryLayoutPlan(layout, scan, Boolean(status.autoArrange), workArea)
  const fingerprint = JSON.stringify([layout.spacingX, layout.spacingY, layout.entries, workArea, scan.items.map(item => [item.path, item.category])])
  return { plan, layout, fingerprint }
}

const collectionWindows = (): BrowserWindow[] => [...desktopModuleWindows.values(), ...desktopZoneWindows.values()].filter(window => !window.isDestroyed() && window.isVisible())

const stopDesktopCollection = async (showOriginalIcons = true): Promise<AppData> => {
  if(showOriginalIcons) startupCollectionCancelled=true
  if(desktopRecoveryTimer) clearTimeout(desktopRecoveryTimer)
  desktopRecoveryTimer=null
  await releaseDesktop()
  const data = await store.update(draft => { draft.settings.desktopCollected = false })
  broadcastData()
  if(showOriginalIcons)setCollectionProgress(false,'原桌面已显示，图标位置保持不变')
  return data
}

const refreshDesktopGroups = async (): Promise<AppData> => {
  const createdAt = new Date().toISOString()
  let items: import('./types').DesktopScanItem[] = []
  if (process.platform === 'win32') {
    const roots = [desktopRoot(), ...(process.env.PUBLIC ? [join(process.env.PUBLIC, 'Desktop')] : [])]
    let missing = 0
    for (let attempt = 0; attempt < 4; attempt++) {
      const [shellItems, layout] = await Promise.all([readShellDesktopItems(createdAt), readDesktopLayout()])
      const selected = selectVisibleDesktopItems(layout.entries, shellItems, roots)
      missing = selected.missing.length
      if (!missing) { items = selected.items; break }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 300))
    }
    if (missing) throw new Error(`还有 ${missing} 个桌面项目未识别，原桌面保持显示。`)
  } else items = (await scanDesktop()).items
  for (const item of items) {
    const previous = store.data.desktopItems.find(old => old.path === item.path)
    if (previous && previous.modifiedAt !== item.modifiedAt) invalidateFileIcon(item.path)
  }
  shellDesktopItems = items as ShellDesktopItem[]
  const data = await store.update(draft => synchronizeDesktopGroups(draft, items, screen.getPrimaryDisplay().workArea, createdAt))
  broadcastData()
  await refreshDesktopZones()
  return data
}

const setCollectionProgress = (busy: boolean, message: string, failed = false): void => {
  collectionProgress = {busy,message,failed}
  for(const window of [mainWindow,...desktopModuleWindows.values()]) if(window && !window.isDestroyed()) window.webContents.send('desktop:progressChanged',collectionProgress)
}
const startDesktopCollection = (): Promise<AppData> => {
  if(collectionTask)return collectionTask
  collectionTask=collectDesktopOnce().finally(()=>{collectionTask=null})
  return collectionTask
}
const collectDesktopOnce = async (): Promise<AppData> => {
  if (process.platform !== 'win32') throw new Error('桌面收纳目前仅支持 Windows。')
  collectionBusy = true
  startupCollectionCancelled = false
  setCollectionProgress(true,'正在读取桌面…')
  try {
    let layout = await readDesktopLayout()
    if (!canReuseDesktopInventory(layout.entries, shellDesktopItems, store.data.desktopItems) || !await isDesktopInventoryCurrent(shellDesktopItems)) {
      await refreshDesktopGroups()
      layout = await readDesktopLayout()
    }
    const names = new Set(shellDesktopItems.flatMap(item => [item.displayName, item.name]).map(name => name.trim().toLocaleLowerCase('zh-CN')))
    const missing = layout.entries.filter(item => !names.has(item.name.trim().toLocaleLowerCase('zh-CN')))
    if (missing.length) throw new Error(`还有 ${missing.length} 个桌面项目未识别，暂不收纳，原图标保持显示。`)
    if (!layout.entries.length || !shellDesktopItems.length) throw new Error('桌面清单尚未准备好，请重新检测。')
    if (!store.data.settings.desktopModeEnabled || !store.data.desktopModules.find(module => module.id === 'quick')?.visible || !collectionWindows().length) await showDesktopWidgets()
    if (desktopCoverageProblems(store.data).length) throw new Error('分类框尚未唯一覆盖全部桌面项目，原图标保持显示。')
    const windows = collectionWindows()
    setCollectionProgress(true,'正在准备收纳内容…')
    await Promise.all(windows.map(async window => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if(startupCollectionCancelled || desktopReleasePending)throw new Error('已停止本次收纳，原图标保持显示。')
        if (window.isDestroyed()) throw new Error('组件已关闭，原图标保持显示。')
        if (!window.webContents.isLoadingMainFrame() && await window.webContents.executeJavaScript("Boolean(document.querySelector('.zone-header, .desktop-collection[data-inventory-ready=\"true\"], .assistant-panel .assistant-header, .health-panel .wellness-controls')) && Array.from(document.querySelectorAll('.file-item')).every(item => item.dataset.path.startsWith('shell:') || (item.querySelector('img')?.complete && item.querySelector('img').naturalWidth > 0) || item.querySelector('[data-icon-fallback]'))")) return
        await new Promise(resolve => setTimeout(resolve, 75))
      }
      throw new Error('组件或图标尚未准备好，原图标保持显示。')
    }))
    if (!store.data.settings.desktopCollected) await backupNativeDesktopLayout(layout)
    if (startupCollectionCancelled || desktopReleasePending) throw new Error('已停止本次收纳，原图标保持显示。')
    setCollectionProgress(true,'正在收纳桌面…')
    await collectDesktop(windows, message => {
      new Notification({ title: '桌面收纳已停止', body: message }).show()
      void store.update(draft => { draft.settings.desktopCollected = false }).then(() => {
        broadcastData()
        if (startupCollectionCancelled || desktopReleasePending) return
        if (desktopRecoveryTimer) clearTimeout(desktopRecoveryTimer)
        desktopRecoveryTimer = setTimeout(() => { desktopRecoveryTimer=null; void collectAtStartup() },1500)
      })
    })
    if(startupCollectionCancelled || desktopReleasePending)throw new Error('已停止本次收纳，原图标保持显示。')
    const data = await store.update(draft => { draft.settings.desktopCollected = true })
    broadcastData()
    setCollectionProgress(false,`已收纳 ${data.desktopItems.length} 项`)
    return data
  } catch (error) {
    try { await stopDesktopCollection(false) }
    finally { setCollectionProgress(false,error instanceof Error?error.message:'收纳未完成，原图标保持显示。',!startupCollectionCancelled && !desktopReleasePending) }
    throw error
  }
  finally { collectionBusy = false }
}

const showDesktopWidgets = async (): Promise<void> => {
  await store.update(data => {
    data.settings.desktopModeEnabled = true
    const quick=data.desktopModules.find(module=>module.id==='quick')
    if(quick) quick.visible=true
    widgetsTemporarilyHidden=false
  })
  broadcastData()
  await refreshDesktopModules()
  await refreshDesktopZones()
}

const fitDesktopWidgetsToDisplays = async (): Promise<void> => {
  await store.update(data => {
    for (const module of data.desktopModules) {
      const display=screen.getAllDisplays().find(display=>display.id===module.displayId) || screen.getDisplayMatching(module)
      Object.assign(module,fitWidgetToWorkArea(module.preferredBounds || module,display.workArea))
    }
    for(const zone of data.desktopZones.filter(zone=>!zone.id.startsWith('desktop-'))) {
      const display=screen.getAllDisplays().find(display=>display.id===zone.displayId) || screen.getDisplayMatching(zone)
      Object.assign(zone,fitWidgetToWorkArea(zone.preferredBounds || zone,display.workArea))
    }
  })
  await refreshDesktopModules()
  await refreshDesktopZones()
  broadcastData()
}

const toggleDesktopIcons = async (): Promise<{ success: boolean; hidden: boolean }> => {
  const target = !store.data.settings.hideDesktopIcons
  const success = await setWindowsDesktopIconsHidden(target)
  if (success) {
    await store.update((data) => { data.settings.hideDesktopIcons = target })
    broadcastData()
  }
  return { success, hidden: target }
}

const toggleDashboard = async (): Promise<void> => {
  await refreshDesktopModules()
  const window = desktopModuleWindows.get('todos')
  if (window && !window.isDestroyed() && window.isVisible() && window.isFocused()) {
    window.hide()
    return
  }
  if (!store.data.settings.desktopModeEnabled) await store.update(data => { data.settings.desktopModeEnabled = true })
  await updateDesktopModule('todos', { visible: true, collapsed: false })
  const assistant = desktopModuleWindows.get('todos')
  if (assistant && !assistant.isDestroyed()) { assistant.show(); assistant.focus() }
}


const registerShortcuts = (): void => {
  globalShortcut.unregisterAll()
  for (const shortcut of store.data.settings.shortcuts.filter((item) => item.enabled && ['toggle-panel', 'todo'].includes(item.action))) {
    let registered=false
    try { registered = globalShortcut.register(shortcut.accelerator, () => {
      if (shortcut.action === 'toggle-panel') void toggleDashboard()
      if (shortcut.action === 'search') void showQuickSearchWindow()
      if (shortcut.action === 'todo') {
        void showDesktopWidgets().then(async () => {
          await updateDesktopModule('todos', { visible: true, collapsed: false })
          const window = desktopModuleWindows.get('todos')
          window?.focus()
        })
      }
      if (shortcut.action === 'note') showMainWindow('notes')
      if (shortcut.action === 'screenshot') {
        void captureFullScreen().then(() => {
          new Notification({ title: '截图已复制', body: '全屏截图已复制到剪贴板。' }).show()
          showMainWindow('system')
          sendToRenderer('screenshot:copied')
        })
      }
    })
    } catch(error) { console.error('[快捷键]',error) }
    if (!registered) sendToRenderer('shortcut:error', shortcut.accelerator)
  }
}

const currentWellnessUndo = (): WellnessSnapshot['undo'] => {
  try {
    validateWellnessUndo(wellnessUndo, wellnessUndo?.id, store.data.settings, store.data.hydrationDay, Date.now())
    return { id: wellnessUndo.id, kind: wellnessUndo.kind, expiresAt: wellnessUndo.expiresAt }
  } catch { return undefined }
}
const wellnessFloodOrder = (): string[] => {
  const panels = new Map<string, BrowserWindow | null | undefined>([
    ...['health', 'quick', 'todos'].map(id => [id, desktopModuleWindows.get(id)] as const),
    ...desktopModuleWindows,
    ...Array.from(desktopZoneWindows, ([id, window]) => [`zone:${id}`, window] as const),
    ...Array.from(noteWindows, ([id, window]) => [`note:${id}`, window] as const),
    ['main', mainWindow]
  ])
  return [...panels].filter(([, window]) => window && !window.isDestroyed() && window.isVisible()).map(([id]) => id)
}
const wellnessSnapshot = (): WellnessSnapshot => ({ undo: currentWellnessUndo(), state: wellnessReminderState, paused: wellnessPaused, now: wellnessPausedAt ?? Date.now(), hydrationPlan: hydrationPlanSnapshot(store.data.settings.hydrationPlan, store.data.hydrationDay, Date.now()), floodOrder: wellnessFloodOrder() })
const publishWellness = (): void => {
  const snapshot = wellnessSnapshot()
  for (const window of [mainWindow, ...desktopModuleWindows.values(), ...desktopZoneWindows.values(), ...noteWindows.values()]) if (window && !window.isDestroyed()) window.webContents.send('wellness:changed', snapshot)
}
const advanceWellness = (now: number): void => {
  if (wellnessPaused) { publishWellness(); return }
  let settings: ReminderSettings = { ...store.data.settings, hydrationReminderEnabled: hydrationDayAt(store.data.hydrationDay, now).consumedMl < store.data.settings.hydrationPlan.goalMl }
  const previousHydration = wellnessReminderState.hydration
  const carriedHydration = overdueHydrationClock(store.data.settings.hydrationPlan, store.data.hydrationDay, wellnessReminderState.hydration, now)
  if (store.data.settings.hydrationPlan.enabled) {
    const clock = hydrationPlanClock(store.data.settings.hydrationPlan, store.data.hydrationDay, wellnessReminderState.hydration, now)
    wellnessReminderState = { ...wellnessReminderState, hydration: clock }
    settings = { ...settings, hydrationReminderEnabled: settings.hydrationReminderEnabled && Boolean(clock), hydrationIntervalMinutes: clock?.intervalMinutes ?? settings.hydrationIntervalMinutes }
  } else if (wellnessReminderState.hydration?.planKey) delete wellnessReminderState.hydration
  const result = tickReminders(settings, wellnessReminderState, now)
  wellnessReminderState = carriedHydration ? { ...result.state, hydration: carriedHydration } : result.state
  // Filling the cup is independent of notification delivery.
  if (!store.data.settings.hydrationReminderEnabled && wellnessReminderState.hydration && result.due.includes('hydration')) wellnessReminderState.hydration.notified = previousHydration?.notified
  if (!settings.hydrationReminderEnabled || !store.data.settings.hydrationReminderEnabled) { wellnessNotifications.get('hydration')?.close(); wellnessNotifications.delete('hydration') }
  for (const kind of result.due) {
    if (kind === 'hydration' && !store.data.settings.hydrationReminderEnabled) continue
    if (!Notification.isSupported()) continue
    wellnessNotifications.get(kind)?.close()
    const notification = new Notification({
      title: kind === 'hydration' ? '水杯满了，喝几口水吧' : '起来活动，让脊柱舒展一下',
      body: kind === 'hydration' ? '点击通知查看水杯，点击水杯即可记录当前水量。' : '点击通知确认已活动，或推迟 10 分钟。',
      silent: !store.data.settings.healthSoundEnabled
    })
    wellnessNotifications.set(kind, notification)
    notification.on('click', () => {
      void showDesktopWidgets().then(async () => {
        await updateDesktopModule('todos', { visible: true, collapsed: false })
        await updateDesktopModule('health', { visible: true })
        const window = desktopModuleWindows.get(kind === 'hydration' ? 'health' : 'todos')
        window?.webContents.send('navigate', kind === 'hydration' ? 'wellness:recordHydration' : `wellness:${kind}`)
        window?.focus()
      })
    })
    notification.show()
  }
  publishWellness()
}
const startReminderWatcher = (): void => {
  let suspended = false
  let locked = false
  let dayRefresh: Promise<void> | null = null
  const refreshHydrationDay = (now: number): void => {
    if (dayRefresh || hydrationDayAt(store.data.hydrationDay, now).date === store.data.hydrationDay.date) return
    dayRefresh = store.update(data => { data.hydrationDay = hydrationDayAt(data.hydrationDay, Date.now()) }).then(() => {
      delete wellnessReminderState.hydration
      wellnessUndo = null
      advanceWellness(Date.now())
      broadcastData()
    }).catch(console.error).finally(() => { dayRefresh = null })
  }
  const pause = (): void => {
    if (wellnessPausedAt === null) wellnessPausedAt = Date.now()
    wellnessPaused = true
    wellnessNotifications.forEach(notification => notification.close()); wellnessNotifications.clear(); publishWellness()
  }
  const resume = (): void => {
    if (suspended || locked) return
    const now = Date.now()
    refreshHydrationDay(now)
    if (wellnessPausedAt !== null) {
      wellnessReminderState = resumeReminderClocks(wellnessReminderState, wellnessPausedAt, now)
      if (wellnessUndo?.clock) wellnessUndo.clock = resumeReminderClocks({ [wellnessUndo.kind]: wellnessUndo.clock }, wellnessPausedAt, now)[wellnessUndo.kind]
    }
    wellnessPausedAt = null
    wellnessPaused = false
    advanceWellness(now)
  }
  powerMonitor.on('suspend', () => { suspended = true; pause() })
  powerMonitor.on('lock-screen', () => { locked = true; pause() })
  powerMonitor.on('resume', () => { suspended = false; resume() })
  powerMonitor.on('unlock-screen', () => { locked = false; resume() })
  advanceWellness(Date.now())
  void advanceTodoReminders(Date.now()).catch(console.error)
  let nextTodoCheckAt = Date.now() + 20_000
  reminderTimer = setInterval(() => {
    const now = Date.now()
    refreshHydrationDay(now)
    if (suspended || locked) pause()
    else advanceWellness(now)
    const focus=store.data.suite.focus
    if (!suspended && !locked && focus.endAt !== null && focusRemaining(focus,now) === 0 && !focus.notified) {
      void store.update(data=>{data.suite.focus={...data.suite.focus,endAt:null,remainingSeconds:0,notified:true}}).then(()=>{
        new Notification({title:'专注计时结束',body:'这一轮已完成，可以休息一下。'}).show();broadcastData()
      }).catch(console.error)
    }
    if (!suspended && !locked && now >= nextTodoCheckAt) {
      nextTodoCheckAt = now + 20_000
      void advanceTodoReminders(now).catch(console.error)
    }
  }, 1000)
}

const advanceTodoReminders = async (now: number): Promise<void> => {
  if (!Notification.isSupported()) return
  const due = dueTodoReminders(store.data.todos, now)
  if (!due.length) return
  await store.update(data => {
    for (const pending of due) {
      const todo = data.todos.find(item => item.id === pending.id)
      if (todo && todo.reminderAt === pending.reminderAt) todo.reminderNotifiedAt = pending.reminderAt
    }
  })
  for (const todo of due) {
    todoNotifications.get(todo.id)?.close()
    const notification = new Notification({ title:'待办提醒',body:todo.title,silent:!store.data.settings.healthSoundEnabled })
    todoNotifications.set(todo.id,notification)
    notification.on('click', () => {
      void showDesktopWidgets().then(async () => {
        await updateDesktopModule('todos',{visible:true,collapsed:false})
        const window=desktopModuleWindows.get('todos')
        window?.webContents.send('navigate',`todo-reminder:${todo.id}`)
        window?.focus()
      })
    })
    notification.show()
  }
  broadcastData()
}

const resetDirectoryWatchers = (): void => {
  directoryUnwatchers.forEach((stop) => stop())
  directoryUnwatchers = []
  const sources = [desktopRoot(), ...(process.platform === 'win32' && process.env.PUBLIC ? [join(process.env.PUBLIC, 'Desktop')] : [])]
  for (const source of new Set(sources)) directoryUnwatchers.push(watchDirectory(source, () => {
    sendToRenderer('files:changed', source)
    if (desktopSortTimer) clearTimeout(desktopSortTimer)
    desktopSortTimer = setTimeout(() => { void refreshDesktopGroups().catch(console.error) }, 1200)
  }))
}

const validCollections = ['favorites', 'todos', 'categories', 'storageItems', 'mappings', 'notes', 'iconLayouts'] as const
type ValidCollection = (typeof validCollections)[number]
const isCollection = (value: string): value is ValidCollection => (validCollections as readonly string[]).includes(value)

const requestSearchAuthorization = async (): Promise<boolean> => {
  if (store.data.settings.searchAuthorized) return true
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: '授权文件搜索',
    message: '首次全盘文件搜索需要系统文件访问权限。',
    detail: '搜索由工具箱自己的本地按需扫描后端执行；macOS 可能在首次检索时请求“文件与文件夹”或“完全磁盘访问”权限。拒绝后仍可在稍后再次搜索时授权。',
    buttons: ['继续并授权', '暂不授权'],
    defaultId: 0,
    cancelId: 1
  })
  if (result.response !== 0) return false
  await store.update((data) => { data.settings.searchAuthorized = true })
  broadcastData()
  return true
}

const registerIpc = (): void => {
  ipcMain.handle('suite:save', async (_event, patch: unknown) => {
    if(!patch || typeof patch!=='object' || Array.isArray(patch)) throw new Error('组件配置无效。')
    const source=patch as Partial<WidgetSuite>
    const allowed=['background','textColor','fontSize','showSystemIcons','timeZones','events','countdowns','cities','sources']
    if(Object.keys(source).some(key=>!allowed.includes(key))) throw new Error('不支持的组件设置。')
    const suite=validateSuite({...store.data.suite,...source})
    for(const calendar of suite.sources) if(calendar.content) validateCalendar(calendar.content)
    const data=await store.update(draft=>{draft.suite=suite})
    broadcastData()
    return data
  })
  ipcMain.handle('suite:focus', async (_event, action: unknown, seconds?: unknown) => {
    if(typeof action!=='string' || (seconds!==undefined && typeof seconds!=='number')) throw new Error('计时参数无效。')
    const focus=changeFocus(store.data.suite.focus,action,Date.now(),seconds as number|undefined)
    const data=await store.update(draft=>{draft.suite.focus=focus})
    broadcastData();return data
  })
  ipcMain.handle('suite:agenda', (_event, from: unknown, until: unknown) => {
    if(typeof from!=='number' || typeof until!=='number' || !Number.isFinite(from) || !Number.isFinite(until) || Math.abs(from)>8e15 || until<=from || until-from>93*86400000) throw new Error('日程范围须为 1–93 天。')
    return agenda(store.data.suite.events,store.data.suite.sources,from,until)
  })
  ipcMain.handle('suite:importCalendar', async () => {
    const selected=await dialog.showOpenDialog(mainWindow!,{filters:[{name:'日历文件',extensions:['ics']}],properties:['openFile']})
    if(selected.canceled) return null
    const path=selected.filePaths[0]
    if((await stat(path)).size>2_000_000) throw new Error('日历文件不能超过 2 MB。')
    const content=await readFile(path,'utf8');validateCalendar(content)
    if(store.data.suite.sources.length>=12) throw new Error('最多添加 12 个日历来源。')
    const sources=[...store.data.suite.sources,{id:createId(),name:basename(path,'.ics').slice(0,120),enabled:true,content,updatedAt:new Date().toISOString()}]
    const suite=validateSuite({...store.data.suite,sources})
    const data=await store.update(draft=>{draft.suite=suite});broadcastData();return data
  })
  ipcMain.handle('suite:subscribeCalendar', async (_event, name: unknown, address: unknown) => {
    if(typeof name!=='string' || !name.trim() || name.length>120 || typeof address!=='string' || address.length>2048 || store.data.suite.sources.length>=12) throw new Error('请填写日历名称和有效订阅地址；最多 12 个来源。')
    const content=await publicText(address);validateCalendar(content)
    const suite=validateSuite({...store.data.suite,sources:[...store.data.suite.sources,{id:createId(),name:name.trim(),url:address,enabled:true,content,updatedAt:new Date().toISOString()}]})
    const data=await store.update(draft=>{draft.suite=suite});broadcastData();return data
  })
  ipcMain.handle('suite:refreshCalendar', async (_event,id:unknown) => {
    const source=store.data.suite.sources.find(source=>source.id===id)
    if(!source?.url) throw new Error('此来源不是在线订阅，请重新导入文件。')
    const content=await publicText(source.url);validateCalendar(content)
    const data=await store.update(draft=>{const entry=draft.suite.sources.find(item=>item.id===id);if(entry){entry.content=content;entry.updatedAt=new Date().toISOString()}})
    broadcastData();return data
  })
  ipcMain.handle('suite:searchCities', (_event,query:unknown)=>searchCities(query))
  ipcMain.handle('suite:weather', (_event,id:unknown)=>{
    const city=store.data.suite.cities.find(city=>city.id===id)
    if(!city) throw new Error('请先选择城市。')
    return cityWeather(city)
  })
  ipcMain.handle('suite:metrics', ()=>{
    if(wellnessPaused) throw new Error('锁屏或休眠期间暂停采样。')
    return readMetrics()
  })
  ipcMain.handle('suite:displays', ()=>screen.getAllDisplays().map(display=>({id:display.id,label:display.label || `显示器 ${display.id}`,workArea:display.workArea})))
  ipcMain.handle('suite:moveDisplay', async (_event,id:unknown,displayId:unknown)=>{
    const display=screen.getAllDisplays().find(item=>item.id===displayId)
    const module=[...store.data.desktopModules,...store.data.desktopZones.filter(zone=>!zone.id.startsWith('desktop-'))].find(item=>item.id===id)
    if(!display || !module) throw new Error('显示器或组件不存在。')
    const data=await store.update(draft=>{const target=[...draft.desktopModules,...draft.desktopZones].find(item=>item.id===id)!;const bounds=fitWidgetToWorkArea({...target,x:display.workArea.x+24,y:display.workArea.y+24},display.workArea);Object.assign(target,bounds,{displayId:display.id,preferredBounds:{...bounds}})})
    await refreshDesktopModules();await refreshDesktopZones();broadcastData();return data
  })
  ipcMain.handle('suite:visibility', async (_event,action:unknown)=>{
    if(action==='overlay') {await toggleDashboard();return}
    if(action==='closeOverlay') {desktopModuleWindows.get('todos')?.hide();return}
    if(action==='resetLayout') {
      await store.update(data=>{placeStartupWidgets(data,screen.getPrimaryDisplay().workArea);for(const module of data.desktopModules.filter(module=>['quick','todos'].includes(module.id))){module.displayId=screen.getPrimaryDisplay().id;module.preferredBounds={x:module.x,y:module.y,width:module.width,height:module.height}}})
      await fitDesktopWidgetsToDisplays();return
    }
    if(action!=='toggle') throw new Error('显示操作无效。')
    widgetsTemporarilyHidden=!widgetsTemporarilyHidden
    if(widgetsTemporarilyHidden && store.data.settings.desktopCollected) await releaseDesktop()
    await refreshDesktopModules();await refreshDesktopZones()
    if(!widgetsTemporarilyHidden && store.data.settings.desktopCollected) await collectAtStartup()
  })
  ipcMain.handle('todoReminders:set', async (_event, id: unknown, value: unknown) => {
    const todo=store.data.todos.find(item=>item.id===id)
    if (!todo || todo.completed) throw new Error('请选择未完成的待办。')
    const reminderAt=validateTodoReminder(value,Date.now())
    const data=await store.update(draft=>{ const item=draft.todos.find(item=>item.id===id)!;item.reminderAt=reminderAt;delete item.reminderNotifiedAt })
    todoNotifications.get(todo.id)?.close();todoNotifications.delete(todo.id)
    broadcastData()
    return data
  })
  ipcMain.handle('todoReminders:respond', async (_event, id: unknown, action: unknown) => {
    const todo=store.data.todos.find(item=>item.id===id)
    if (!todo || (action!=='done' && action!=='snooze')) throw new Error('待办提醒操作无效。')
    const data=await store.update(draft=>{
      const item=draft.todos.find(item=>item.id===id)!
      if(action==='done') item.completed=true
      else {item.completed=false;item.reminderAt=new Date(Date.now()+10*60000).toISOString();delete item.reminderNotifiedAt}
    })
    todoNotifications.get(todo.id)?.close();todoNotifications.delete(todo.id)
    broadcastData()
    return data
  })
  ipcMain.handle('wellness:get', () => wellnessSnapshot())
  ipcMain.handle('wellness:setHydrationGoal', async (_event, goalMl: unknown) => {
    if (typeof goalMl !== 'number') throw new Error('今日总喝水量须为 500–5000ml 的整数。')
    if (goalMl === store.data.settings.hydrationPlan.goalMl) return store.data
    const updated = await store.update(data => {
      data.settings.hydrationPlan = validateHydrationPlan({ ...data.settings.hydrationPlan, goalMl })
    })
    if (wellnessUndo?.kind === 'hydration') wellnessUndo = null
    wellnessNotifications.get('hydration')?.close(); wellnessNotifications.delete('hydration')
    advanceWellness(Date.now())
    broadcastData()
    return updated
  })
  ipcMain.handle('desktop:progress', () => collectionProgress)
  ipcMain.handle('wellness:resetHydration', async () => {
    await store.update(data => { data.hydrationDay = hydrationDayAt(undefined, Date.now()) })
    delete wellnessReminderState.hydration
    if (wellnessUndo?.kind === 'hydration') wellnessUndo = null
    wellnessNotifications.get('hydration')?.close(); wellnessNotifications.delete('hydration')
    advanceWellness(Date.now())
    broadcastData()
    return store.data
  })
  ipcMain.handle('wellness:menu', (event, kind: unknown) => {
    if(kind!=='hydration' && kind!=='sedentary')throw new Error('健康提醒类型无效。')
    const enabled=kind==='hydration'?store.data.settings.hydrationReminderEnabled:store.data.settings.sedentaryReminderEnabled
    const plan=hydrationPlanSnapshot(store.data.settings.hydrationPlan,store.data.hydrationDay,Date.now())
    const canSnooze=enabled && (kind!=='hydration' || (plan.status!=='complete' && (!plan.enabled || plan.status==='active')))
    const report=(message:string,failed=false):void=>{if(!event.sender.isDestroyed())event.sender.send('wellness:feedback',{message,failed})}
    const selectInterval=(minutes:number):void=>{void store.update(data=>{
      if(kind==='hydration'){data.settings.hydrationReminderEnabled=true;data.settings.hydrationIntervalMinutes=minutes;data.settings.hydrationPlan.enabled=false}
      else{data.settings.sedentaryReminderEnabled=true;data.settings.sedentaryIntervalMinutes=minutes}
    }).then(()=>{advanceWellness(Date.now());broadcastData();report(`已${kind==='hydration'?'切换为固定间隔，':''}设置为 ${minutes} 分钟`)}).catch(error=>report(error instanceof Error?error.message:'设置未保存，请重试。',true))}
    const template: Electron.MenuItemConstructorOptions[]=[
      {label:'10 分钟后提醒',enabled:canSnooze,click:()=>event.sender.send('navigate',`wellness:snooze:${kind}`)},
      {type:'separator'},
      ...(kind==='hydration'?[15,30,45,60]:[30,45,60,90]).map(minutes=>({type:'checkbox' as const,label:`${minutes} 分钟${kind==='hydration' && store.data.settings.hydrationPlan.enabled?' · 切换为固定间隔':''}`,checked:enabled && (kind==='hydration'?!store.data.settings.hydrationPlan.enabled && store.data.settings.hydrationIntervalMinutes===minutes:store.data.settings.sedentaryIntervalMinutes===minutes),click:()=>selectInterval(minutes)})),
      {type:'separator'},
      {label:'自定义间隔…',click:()=>{void showMainWindow('reminders')}},
      ...(kind==='hydration'?[{label:'每日喝水计划…',click:()=>{void showMainWindow('reminders')}}]:[])
    ]
    Menu.buildFromTemplate(template).popup({window:BrowserWindow.fromWebContents(event.sender) ?? undefined})
  })
  ipcMain.handle('wellness:respond', async (_event, kind: unknown, action: unknown, recording: unknown) => {
    if ((kind !== 'hydration' && kind !== 'sedentary') || (action !== 'done' && action !== 'snooze')) throw new Error('健康提醒操作无效。')
    if ((kind === 'sedentary' && !store.data.settings.sedentaryReminderEnabled) || (kind === 'hydration' && action === 'snooze' && !store.data.settings.hydrationReminderEnabled)) throw new Error('请先开启这项提醒。')
    const now = kind === 'hydration' && action === 'done' ? Date.now() : wellnessPausedAt ?? Date.now()
    const undo = action === 'done' ? captureWellnessUndo(createId(), kind, store.data.settings, wellnessReminderState[kind], store.data.hydrationDay, Date.now()) : null
    if (kind === 'hydration' && action === 'done') {
      if (!recording || typeof recording !== 'object' || typeof (recording as Record<string, unknown>).amountMl !== 'number' || typeof (recording as Record<string, unknown>).recordId !== 'string') throw new Error('喝水记录缺少当前杯量，请重试。')
      const { amountMl, recordId } = recording as { amountMl: number; recordId: string }
      let recorded = false
      await store.update(data => {
        const day = hydrationDayAt(data.hydrationDay, now)
        const next = recordHydration(data.settings.hydrationPlan, day, amountMl, now, recordId)
        if (day.recordIds?.includes(recordId)) return
        const clock = wellnessReminderState.hydration
        const currentClock = clock && day.lastCupAt !== undefined && clock.startedAt < day.lastCupAt ? undefined : clock
        const visualNow = wellnessPausedAt ?? now
        const water = hydrationReminderVisual({ state: { ...wellnessReminderState, hydration: currentClock }, paused: wellnessPaused, now: visualNow, hydrationPlan: hydrationPlanSnapshot(data.settings.hydrationPlan, day, now) }, visualNow)
        if (amountMl > hydrationCupMl(data.settings.hydrationPlan.cupMl, water.progress)) throw new Error('当前杯量已变化，请按水杯显示的水量重试。')
        data.hydrationDay = next
        recorded = true
      })
      if (!recorded) return wellnessSnapshot()
      delete wellnessReminderState.hydration
      advanceWellness(now)
      broadcastData()
    } else wellnessReminderState = respondToReminder(store.data.settings, wellnessReminderState, kind, action, now)
    if (undo?.dayBefore) undo.dayAfter = structuredClone(hydrationDayAt(store.data.hydrationDay, Date.now()))
    wellnessUndo = undo
    wellnessNotifications.get(kind)?.close(); wellnessNotifications.delete(kind)
    publishWellness()
    return wellnessSnapshot()
  })
  ipcMain.handle('wellness:undo', async (_event, id: unknown) => {
    const record = wellnessUndo
    validateWellnessUndo(record, id, store.data.settings, store.data.hydrationDay, Date.now())
    if (record.dayBefore) await store.update(data => {
      data.hydrationDay = { ...structuredClone(record.dayBefore!), recordIds: [...new Set([...(record.dayBefore!.recordIds ?? []), ...(data.hydrationDay.recordIds ?? [])])] }
    })
    wellnessReminderState = { ...wellnessReminderState, [record.kind]: record.clock ? { ...record.clock } : undefined }
    wellnessUndo = null
    wellnessNotifications.get(record.kind)?.close(); wellnessNotifications.delete(record.kind)
    advanceWellness(wellnessPausedAt ?? Date.now())
    broadcastData(); publishWellness()
    return wellnessSnapshot()
  })
  const requireCollectedPath = (path: unknown, allowSystem = false): string => {
    if (typeof path !== 'string' || (!allowSystem && !isSafeFilesystemPath(path)) || ![...store.data.desktopItems.map(item => item.path), ...store.data.inboxItems.map(item => item.sourcePath)].includes(path)) throw new Error('请选择收纳框内的现有项目。')
    return path
  }
  const updateCollectedPath = async (source: string, target: string | null): Promise<AppData> => store.update(data => {
    const assignedZone = data.desktopAssignments[source]
    delete data.desktopAssignments[source]
    if (target && assignedZone) data.desktopAssignments[target] = assignedZone
    const item = data.desktopItems.find(item => item.path === source)
    if (item && target) {
      item.path = target; item.name = basename(target); item.extension = extname(target).slice(1).toLowerCase()
      item.category = classifyDesktopItem(item.name, item.isDirectory)
    } else data.desktopItems = data.desktopItems.filter(item => item.path !== source)
    data.desktopZones.forEach(zone => { zone.itemIds = zone.itemIds.flatMap(id => id === source ? target ? [target] : [] : [id]) })
    for (const entry of data.inboxItems.filter(entry => entry.sourcePath === source)) {
      if (target) { entry.sourcePath = target; entry.name = basename(target) }
      else data.desktopZones.forEach(zone => { zone.itemIds = zone.itemIds.filter(id => id !== entry.id) })
    }
    if (!target) data.inboxItems = data.inboxItems.filter(entry => entry.sourcePath !== source)
    synchronizeDesktopGroups(data, data.desktopItems, screen.getPrimaryDisplay().workArea, new Date().toISOString())
  })
  ipcMain.handle('data:get', () => store.data)
  ipcMain.handle('files:rename', async (_event, path: unknown, name: unknown) => {
    const source = requireCollectedPath(path)
    if (typeof name !== 'string' || changingFilePaths.has(source)) throw new Error('项目正在处理，请稍候。')
    changingFilePaths.add(source)
    try {
      const target = await renameCollectedFile(source, name)
      let data: AppData
      try { data = await updateCollectedPath(source, target) }
      catch (error) {
        if (source !== target) {
          try { await renameCollectedFile(target, basename(source)) }
          catch { throw new Error(`文件已改名为“${basename(target)}”，分类记录未保存，请重新整理桌面。`) }
        }
        throw error
      }
      broadcastData()
      return { data, path: target }
    } finally { changingFilePaths.delete(source) }
  })
  ipcMain.handle('files:trash', async (_event, path: unknown) => {
    const source = requireCollectedPath(path)
    if (changingFilePaths.has(source)) throw new Error('项目正在处理，请稍候。')
    changingFilePaths.add(source)
    try {
      await shell.trashItem(source)
      const data = await updateCollectedPath(source, null)
      broadcastData()
      return data
    } finally { changingFilePaths.delete(source) }
  })
  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置参数无效。')
    if(patch.shortcuts!==undefined) {
      if(!Array.isArray(patch.shortcuts) || patch.shortcuts.length>5 || new Set(patch.shortcuts.map(item=>item?.action)).size!==patch.shortcuts.length) throw new Error('快捷键设置无效。')
      for(const shortcut of patch.shortcuts) {
        if(!shortcut || !['toggle-panel','search','screenshot','todo','note'].includes(shortcut.action) || typeof shortcut.enabled!=='boolean' || typeof shortcut.accelerator!=='string' || shortcut.accelerator.length>100) throw new Error('快捷键设置无效。')
        const parts=shortcut.accelerator.split('+'), key=parts.pop()!
        if(!parts.length || parts.some(part=>!['CommandOrControl','CmdOrCtrl','Control','Ctrl','Alt','Option','Shift','Super','Meta','Command','Cmd'].includes(part)) || !/^(?:[A-Za-z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Return|Escape|Esc|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus)$/i.test(key)) throw new Error('请输入有效组合键，例如 Ctrl+Shift+Space。')
      }
    }
    const safePatch: Partial<AppSettings> = { ...patch, ...normalizeReminderSettings(patch, store.data.settings) }
    if ('collectionSorts' in patch) {
      if (!patch.collectionSorts || typeof patch.collectionSorts !== 'object' || Array.isArray(patch.collectionSorts)) throw new Error('排序设置无效。')
      safePatch.collectionSorts = normalizeCollectionSorts({ ...store.data.settings.collectionSorts, ...patch.collectionSorts })
    }
    if ('collectionRules' in patch) {
      const rules=normalizeCollectionRules(patch.collectionRules)
      if (!patch.collectionRules || typeof patch.collectionRules!=='object' || Array.isArray(patch.collectionRules) || Object.keys(patch.collectionRules).length>32 || Object.keys(rules).length!==Object.keys(patch.collectionRules).length) throw new Error('最多设置 32 条有效扩展名规则。')
      safePatch.collectionRules=rules
    }
    for (const key of ['desktopModeEnabled', 'autoStart', 'hideDesktopIcons', 'healthSoundEnabled'] as const) {
      if (typeof safePatch[key] !== 'boolean') delete safePatch[key]
    }
    for (const [key, minimum, maximum] of [['panelOpacity', 65, 100], ['desktopModuleOpacity', 0, 100], ['panelWidth', 760, 1600], ['panelHeight', 520, 1000], ['desktopSnapDistance', 6, 16]] as const) {
      const value = safePatch[key]
      if (typeof value === 'number' && Number.isFinite(value)) safePatch[key] = Math.round(Math.max(minimum, Math.min(maximum, value)))
      else delete safePatch[key]
    }
    if (safePatch.snapMode && !['grid', 'edge', 'none'].includes(safePatch.snapMode)) delete safePatch.snapMode
    delete safePatch.desktopCollected
    if (safePatch.desktopModeEnabled === false && store.data.settings.desktopCollected) await stopDesktopCollection()
    safePatch.desktopIconAutoSortEnabled = false
    delete safePatch.desktopWidgetVersion
    if (typeof safePatch.desktopIconSortOnboardingSeen !== 'boolean') delete safePatch.desktopIconSortOnboardingSeen
    if (typeof safePatch.desktopHoverExpandEnabled !== 'boolean') delete safePatch.desktopHoverExpandEnabled
    if (typeof safePatch.desktopHoverCollapseDelay === 'number' && Number.isFinite(safePatch.desktopHoverCollapseDelay)) safePatch.desktopHoverCollapseDelay = Math.round(Math.max(180, Math.min(2000, safePatch.desktopHoverCollapseDelay)))
    else delete safePatch.desktopHoverCollapseDelay
    const shouldRestoreDesktopModules = safePatch.desktopModeEnabled === true && !store.data.settings.desktopModeEnabled
    if ('hydrationPlan' in patch) safePatch.hydrationPlan = validateHydrationPlan(patch.hydrationPlan)
    const updated = await store.update((data) => {
      data.settings = { ...data.settings, ...safePatch }
      // 重新启用时恢复收纳框和独立待办。
      if (shouldRestoreDesktopModules) { const quick=data.desktopModules.find(module=>module.id==='quick'); if(quick) quick.visible=true }
    })
    applySettings(updated.settings)
    for (const kind of ['hydration', 'sedentary'] as const) {
      if (!(kind === 'hydration' ? updated.settings.hydrationReminderEnabled : updated.settings.sedentaryReminderEnabled)) {
        wellnessNotifications.get(kind)?.close(); wellnessNotifications.delete(kind)
      }
    }
    advanceWellness(Date.now())
    if (patch.shortcuts) registerShortcuts()
    broadcastData()
    if ('collectionRules' in patch) return refreshDesktopGroups()
    return updated
  })
  ipcMain.handle('settings:reset', async () => {
    await releaseDesktop()
    const data = await store.reset()
    applySettings(data.settings)
    registerShortcuts()
    resetDirectoryWatchers()
    if (data.settings.desktopCollected) return startDesktopCollection()
    broadcastData()
    return data
  })
  ipcMain.handle('desktopModules:update', async (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('桌面模块更新参数无效。')
    const source = patch as Record<string, unknown>
    const safe: Partial<Pick<DesktopModule, 'visible' | 'collapsed' | 'title'>> = {}
    if (typeof source.visible === 'boolean') safe.visible = source.visible
    if (typeof source.collapsed === 'boolean') safe.collapsed = source.collapsed
    if (typeof source.title === 'string') safe.title = source.title
    if (!Object.keys(safe).length) throw new Error('没有可更新的桌面模块字段。')
    return updateDesktopModule(id, safe)
  })
  ipcMain.handle('desktopModules:openMain', (_event, section?: string) => showMainWindow(section))
  ipcMain.handle('desktopModules:hover', async (event, expanded: unknown) => {
    if (typeof expanded !== 'boolean') throw new Error('展开状态无效。')
    const entry = [...desktopModuleWindows].find(([, window]) => !window.isDestroyed() && window.webContents === event.sender)
    if (!entry) throw new Error('只能展开当前组件。')
    if (expanded && store.data.settings.desktopHoverExpandEnabled) hoverExpandedModules.add(entry[0])
    else hoverExpandedModules.delete(entry[0])
    await refreshDesktopModules()
  })
  ipcMain.handle('desktopModules:drag', (event, action: unknown) => {
    if(!['start','move','end'].includes(String(action))) throw new Error('拖动操作无效。')
    const entry=[...desktopModuleWindows].find(([,window])=>!window.isDestroyed() && window.webContents===event.sender)
    if(!entry) throw new Error('只能移动当前桌面组件。')
    const [id,window]=entry
    if(action==='start') {
      desktopDragOrigins.set(id,{bounds:window.getBounds(),pointer:screen.getCursorScreenPoint()})
      draggingDesktopWidgets.add(id)
      return
    }
    const origin=desktopDragOrigins.get(id)
    if(!origin) return
    const raw=draggedWidgetBounds(origin.bounds,origin.pointer,screen.getCursorScreenPoint())
    const snapped=snapDesktopModuleBounds(id,raw)
    applyingDesktopModuleBounds.add(id)
    try { window.setBounds(snapped) } finally { applyingDesktopModuleBounds.delete(id) }
    if(action==='end') {
      desktopDragOrigins.delete(id); draggingDesktopWidgets.delete(id)
      persistDesktopModuleBounds(id,window)
    }
  })
  ipcMain.handle('quickSearch:show', () => showQuickSearchWindow())
  ipcMain.handle('quickSearch:hide', () => hideQuickSearchWindow())
  ipcMain.handle('clipboard:copy', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('剪贴板条目标识无效。')
    const item = store.data.clipboardHistory.find((candidate) => candidate.id === id)
    if (!item) throw new Error('未找到剪贴板记录。')
    if (item.type === 'image' && item.imageDataUrl) clipboard.writeImage(nativeImage.createFromDataURL(item.imageDataUrl))
    else if (item.type === 'text' && item.text) clipboard.writeText(item.text)
    else throw new Error('剪贴板记录内容不可用。')
  })
  ipcMain.handle('clipboard:update', async (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('剪贴板更新参数无效。')
    const source = patch as Record<string, unknown>
    const data = await store.update((draft) => {
      const item = draft.clipboardHistory.find((candidate) => candidate.id === id)
      if (!item) throw new Error('未找到剪贴板记录。')
      if (typeof source.pinned === 'boolean') item.pinned = source.pinned
    })
    broadcastData()
    return data
  })
  ipcMain.handle('clipboard:remove', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('剪贴板条目标识无效。')
    const data = await store.update((draft) => { draft.clipboardHistory = draft.clipboardHistory.filter((item) => item.id !== id) })
    broadcastData()
    return data
  })
  ipcMain.handle('entity:upsert', async (_event, collection: string, entry: Record<string, unknown>) => {
    if (!isCollection(collection)) throw new Error('不支持的数据集合。')
    if (!entry || typeof entry!=='object' || Array.isArray(entry) || (entry.id!==undefined && (typeof entry.id!=='string' || entry.id.length>160))) throw new Error('条目参数无效。')
    if(collection==='notes' && (typeof entry.title!=='string' || entry.title.length>120 || typeof entry.content!=='string' || entry.content.length>50000)) throw new Error('便签内容无效或过长。')
    if(collection==='todos' && 'dueAt' in entry && entry.dueAt!==undefined && entry.dueAt!==null && entry.dueAt!=='' && (typeof entry.dueAt!=='string' || !Number.isFinite(Date.parse(entry.dueAt)))) throw new Error('待办日期无效。')
    if (collection === 'todos') {
      if(entry.id && !('title' in entry) && !store.data.todos.some(todo=>todo.id===entry.id))throw new Error('事项已被删除，请刷新列表。')
      entry = { ...entry }
      if (entry.dueAt === null || entry.dueAt === '') entry.dueAt = undefined
      if ('title' in entry) {
        if (typeof entry.title !== 'string' || !entry.title.trim() || entry.title.trim().length > 80) throw new Error('事项名称须为 1 到 80 个字符。')
        entry.title = entry.title.trim()
      }
      if ('reminderAt' in entry) {
        if (!store.data.todos.some(todo => todo.id === entry.id && !todo.completed)) throw new Error('请选择未完成的待办。')
        entry.reminderAt = validateTodoReminder(entry.reminderAt, Date.now())
      }
    }
    const data = await store.update((draft) => {
      const list = draft[collection] as unknown as Array<Record<string, unknown>>
      const index = list.findIndex((item) => item.id === entry.id)
      if (index >= 0) {
        const previous=list[index]
        const next={...previous,...entry}
        if(collection==='todos') {
          if(next.reminderAt===previous.reminderAt) next.reminderNotifiedAt=previous.reminderNotifiedAt
          else delete next.reminderNotifiedAt
        }
        list[index]=next
      }
      else list.push({ ...entry, id: entry.id || createId(), createdAt: entry.createdAt || new Date().toISOString() })
    })
    if(collection==='todos') for(const [id,notification] of todoNotifications) {
      if(!data.todos.some(todo=>todo.id===id && !todo.completed) || (id===entry.id && 'reminderAt' in entry)) {notification.close();todoNotifications.delete(id)}
    }
    resetDirectoryWatchers()
    broadcastData()
    return data
  })
  ipcMain.handle('entity:remove', async (_event, collection: string, id: string) => {
    if (!isCollection(collection)) throw new Error('不支持的数据集合。')
    if (collection === 'notes') {
      const window = noteWindows.get(id)
      if (window && !window.isDestroyed()) window.destroy()
      noteWindows.delete(id)
    }
    const data = await store.update((draft) => {
      const list = draft[collection] as unknown as Array<Record<string, unknown>>
      const index = list.findIndex((item) => item.id === id)
      if (index >= 0) list.splice(index, 1)
      if (collection === 'todos') { todoNotifications.get(id)?.close();todoNotifications.delete(id) }
    })
    resetDirectoryWatchers()
    broadcastData()
    return data
  })
  ipcMain.handle('notes:get', (_event, id: string) => store.data.notes.find((item) => item.id === id) || null)
  ipcMain.handle('notes:show', async (_event, id: string) => showFloatingNote(id))
  ipcMain.handle('notes:hide', async (_event, id: string) => hideFloatingNote(id))
  ipcMain.handle('notes:update', async (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('便签更新参数无效。')
    const input = patch as Record<string, unknown>
    const safe: Partial<StickyNote> = {}
    if (typeof input.title === 'string') safe.title = input.title.slice(0, 80)
    if (typeof input.content === 'string') safe.content = input.content.slice(0, 20_000)
    if (typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color)) safe.color = input.color
    if (typeof input.pinned === 'boolean') safe.pinned = input.pinned
    if (!Object.keys(safe).length) throw new Error('没有可更新的便签字段。')
    return saveNoteState(id, safe)
  })
  ipcMain.handle('desktop:collect', () => startDesktopCollection())
  ipcMain.handle('desktop:release', () => stopDesktopCollection())
  ipcMain.handle('desktop:backupWidgets', async () => {
    const data = await store.update(draft => {
      const backup = captureWidgetLayout(draft, createId(), `组件布局 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, new Date().toISOString())
      draft.widgetLayouts = [backup, ...draft.widgetLayouts].slice(0, 10)
    })
    broadcastData()
    return data
  })
  ipcMain.handle('desktop:restoreWidgets', async (_event, id: unknown) => {
    const backup = store.data.widgetLayouts.find(item => item.id === id)
    if (!backup) throw new Error('未找到组件布局备份。')
    if(backup.modules.some(module=>module.id==='quick' && module.visible===false) && store.data.settings.desktopCollected) await stopDesktopCollection()
    await store.update(draft => {
      const current = captureWidgetLayout(draft, createId(), '恢复前自动备份', new Date().toISOString())
      applyWidgetLayout(draft, backup)
      draft.widgetLayouts = [current, ...draft.widgetLayouts].slice(0, 10)
    })
    await fitDesktopWidgetsToDisplays()
    return refreshDesktopGroups()
  })
  const assignDesktopItems = async (paths: unknown, zoneId: unknown): Promise<AppData> => {
    if (!Array.isArray(paths) || !paths.length || paths.length > 500 || typeof zoneId !== 'string' || !store.data.desktopZones.some(zone => zone.id === zoneId)) throw new Error('请选择现有桌面项目和分类框。')
    const selected: string[] = []
    const additions: InboxItem[]=[]
    for(const raw of [...new Set(paths)]) {
      if(typeof raw!=='string') throw new Error('文件路径无效。')
      if(store.data.desktopItems.some(item=>item.path===raw)) selected.push(raw)
      else {
        if(!isSafeFilesystemPath(raw)) throw new Error('文件路径无效。')
        const metadata=await stat(raw)
        selected.push(raw)
        if(!store.data.inboxItems.some(item=>item.sourcePath===raw)) additions.push({id:createId(),type:'file',name:basename(raw),sourcePath:raw,createdAt:metadata.birthtime.toISOString(),modifiedAt:metadata.mtime.toISOString(),isDirectory:metadata.isDirectory(),archived:false,zoneId})
      }
    }
    if(store.data.inboxItems.length+additions.length>1000) throw new Error('文件引用最多 1000 项。')
    await store.update(data => {
      data.inboxItems.push(...additions)
      for (const path of selected) {
        data.desktopAssignments[path] = zoneId
        const inbox=data.inboxItems.find(item=>item.sourcePath===path)
        if(inbox) inbox.zoneId=zoneId
      }
      data.desktopZones.forEach(zone => { zone.itemIds = zone.itemIds.filter(id => !selected.includes(id) && !data.inboxItems.some(entry => entry.id === id && selected.includes(entry.sourcePath || ''))) })
    })
    const next=await refreshDesktopGroups()
    await refreshDesktopZones()
    return next
  }
  ipcMain.handle('organizer:assignDesktopItem', (_event, path: unknown, zoneId: unknown) => assignDesktopItems([path], zoneId))
  ipcMain.handle('organizer:assignDesktopItems', (_event, paths: unknown, zoneId: unknown) => assignDesktopItems(paths, zoneId))
  ipcMain.handle('organizer:refreshDesktopGroups', () => refreshDesktopGroups())
  ipcMain.handle('files:icon', async (_event, path: unknown) => {
    if (!isSafeFilesystemPath(path)) throw new Error('文件路径无效。')
    return readFileIcon(path)
  })
  ipcMain.handle('organizer:createZone', async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('桌面分区参数无效。')
    const source = input as Record<string, unknown>
    const name = typeof source.name === 'string' ? source.name.trim().slice(0, 24) : ''
    if (!name) throw new Error('请填写分区名称。')
    const color = typeof source.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(source.color) ? source.color : '#6d8cff'
    const opacity = typeof source.opacity === 'number' && Number.isFinite(source.opacity) ? Math.round(Math.max(0, Math.min(100, source.opacity))) : 28
    const data = await store.update((draft) => {
      if (draft.desktopZones.length >= 12) throw new Error('最多创建 12 个桌面分区。')
      const offset = draft.desktopZones.length * 26
      draft.desktopZones.push({ id: createId(), name, color, opacity, visible: true, collapsed: false, locked: false, x: 42 + offset, y: 346 + offset, width: 320, height: 184, itemIds: [], createdAt: new Date().toISOString() })
    })
    broadcastData()
    await refreshDesktopZones()
    return data
  })
  ipcMain.handle('organizer:updateZone', async (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('桌面分区更新参数无效。')
    const source = patch as Record<string, unknown>
    const safe: Partial<Pick<DesktopZone, 'name' | 'visible' | 'collapsed' | 'locked' | 'color' | 'opacity'>> = {}
    if (typeof source.name === 'string') safe.name = source.name
    if (typeof source.visible === 'boolean') safe.visible = source.visible
    if (typeof source.collapsed === 'boolean') safe.collapsed = source.collapsed
    if (typeof source.locked === 'boolean') safe.locked = source.locked
    if (typeof source.color === 'string') safe.color = source.color
    if (typeof source.opacity === 'number') safe.opacity = source.opacity
    if (!Object.keys(safe).length) throw new Error('没有可更新的桌面分区字段。')
    return updateDesktopZone(id, safe)
  })
  ipcMain.handle('organizer:removeZone', async (_event, id: unknown) => {
    if (store.data.settings.desktopCollected) await stopDesktopCollection()
    if (typeof id !== 'string' || id.startsWith('desktop-')) throw new Error('只能解散自建项目分区。')
    const data = await store.update((draft) => {
      draft.desktopZones = draft.desktopZones.filter((zone) => zone.id !== id)
      draft.inboxItems = draft.inboxItems.map((item) => item.zoneId === id ? { ...item, zoneId: 'desktop-documents' } : item)
      for(const [path,zoneId] of Object.entries(draft.desktopAssignments)) if(zoneId===id) draft.desktopAssignments[path]='desktop-documents'
      draft.organizerRules = draft.organizerRules.map((rule) => rule.targetType === 'zone' && rule.targetId === id ? { ...rule, enabled: false, targetId: undefined } : rule)
    })
    const window = desktopZoneWindows.get(id)
    if (window && !window.isDestroyed()) window.destroy()
    broadcastData()
    return refreshDesktopGroups()
  })
  ipcMain.handle('organizer:addInboxItems', async (_event, entries: unknown) => {
    if (!Array.isArray(entries) || entries.length > 50) throw new Error('待处理箱条目数量无效。')
    const safeEntries: Array<Omit<InboxItem, 'id' | 'createdAt' | 'archived'>> = []
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const source = entry as Record<string, unknown>
      const type = source.type
      const name = typeof source.name === 'string' ? source.name.trim().slice(0, 120) : ''
      const sourcePath = typeof source.sourcePath === 'string' ? source.sourcePath.trim().slice(0, 32767) : undefined
      const content = typeof source.content === 'string' ? source.content.trim().slice(0, 50_000) : undefined
      if (!name || !['file', 'link', 'text', 'image'].includes(String(type))) continue
      if (type === 'link' && (!content || !/^https?:\/\//i.test(content))) continue
      if ((type === 'file' || type === 'image') && !sourcePath) continue
      if (type === 'text' && !content) continue
      safeEntries.push({ type: type as InboxItem['type'], name, sourcePath, content })
    }
    if (!safeEntries.length) throw new Error('没有可加入待处理箱的有效条目。')
    const data = await store.update((draft) => {
      const now = new Date().toISOString()
      draft.inboxItems = [...safeEntries.map((entry) => ({ ...entry, id: createId(), createdAt: now, archived: false })), ...draft.inboxItems].slice(0, 300)
    })
    broadcastData()
    return data
  })
  ipcMain.handle('organizer:updateInboxItem', async (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('待处理箱更新参数无效。')
    const source = patch as Record<string, unknown>
    const data = await store.update((draft) => {
      const item = draft.inboxItems.find((candidate) => candidate.id === id)
      if (!item) throw new Error('未找到待处理箱条目。')
      if (typeof source.archived === 'boolean') item.archived = source.archived
      if (typeof source.zoneId === 'string' || source.zoneId === null) item.zoneId = typeof source.zoneId === 'string' ? source.zoneId : undefined
      if (typeof source.zoneId === 'string') {
        const zone = draft.desktopZones.find((candidate) => candidate.id === source.zoneId)
        if (!zone) throw new Error('目标桌面分区不存在。')
        if (!zone.itemIds.includes(item.id)) zone.itemIds.push(item.id)
      }
    })
    broadcastData()
    return data
  })
  ipcMain.handle('organizer:removeInboxItem', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('待处理箱条目标识无效。')
    const data = await store.update((draft) => {
      draft.inboxItems = draft.inboxItems.filter((item) => item.id !== id)
      draft.desktopZones.forEach((zone) => { zone.itemIds = zone.itemIds.filter((itemId) => itemId !== id) })
    })
    broadcastData()
    return data
  })
  ipcMain.handle('organizer:upsertRule', async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('整理规则参数无效。')
    const source = input as Record<string, unknown>
    const id = typeof source.id === 'string' ? source.id : createId()
    const name = typeof source.name === 'string' ? source.name.trim().slice(0, 80) : ''
    const targetType = source.targetType === 'folder' ? 'folder' : 'zone'
    const extensions = Array.isArray(source.extensions) ? source.extensions.filter((item): item is string => typeof item === 'string').map((item) => item.trim().replace(/^\./, '').toLowerCase()).filter((item) => /^[a-z0-9_-]{1,16}$/.test(item)).slice(0, 40) : []
    const nameIncludes = typeof source.nameIncludes === 'string' ? source.nameIncludes.trim().slice(0, 80) : undefined
    const createdAfter = typeof source.createdAfter === 'string' && !Number.isNaN(new Date(source.createdAfter).getTime()) ? source.createdAfter : undefined
    const targetId = typeof source.targetId === 'string' ? source.targetId : undefined
    const targetPath = typeof source.targetPath === 'string' ? source.targetPath.trim().slice(0, 32767) : undefined
    if (!name || (!extensions.length && !nameIncludes && !createdAfter)) throw new Error('规则至少需要一个扩展名、名称关键词或创建时间条件。')
    if (targetType === 'zone' && !store.data.desktopZones.some((zone) => zone.id === targetId)) throw new Error('请选择有效的桌面分区作为目标。')
    if (targetType === 'folder' && !targetPath) throw new Error('请选择目标文件夹。')
    const data = await store.update((draft) => {
      const rule: OrganizerRule = { id, name, enabled: source.enabled !== false, extensions, nameIncludes, createdAfter, targetType, targetId: targetType === 'zone' ? targetId : undefined, targetPath: targetType === 'folder' ? targetPath : undefined, priority: typeof source.priority === 'number' && Number.isFinite(source.priority) ? Math.max(0, Math.round(source.priority)) : draft.organizerRules.length, createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString() }
      const index = draft.organizerRules.findIndex((candidate) => candidate.id === id)
      if (index >= 0) draft.organizerRules[index] = rule
      else if (draft.organizerRules.length < 50) draft.organizerRules.push(rule)
      else throw new Error('最多保存 50 条整理规则。')
    })
    broadcastData()
    return data
  })
  ipcMain.handle('organizer:removeRule', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('整理规则标识无效。')
    const data = await store.update((draft) => { draft.organizerRules = draft.organizerRules.filter((rule) => rule.id !== id) })
    broadcastData()
    return data
  })
  ipcMain.handle('organizer:installDefaultArchiveRules', async () => {
    const templates = [
      { name: '图片 → 图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'], folder: '图片' },
      { name: '文档 → 文档', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'wps'], folder: '文档' },
      { name: '压缩包 → 压缩包', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'], folder: '压缩包' },
      { name: '安装包 → 安装包', extensions: ['exe', 'msi', 'msix', 'appx', 'apk'], folder: '安装包' }
    ]
    const data = await store.update((draft) => {
      for (const template of templates) {
        if (draft.organizerRules.some((rule) => rule.name === template.name)) continue
        draft.organizerRules.push({ id: createId(), name: template.name, enabled: true, extensions: template.extensions, targetType: 'folder', targetPath: join(desktopRoot(), template.folder), priority: draft.organizerRules.length, createdAt: new Date().toISOString() })
      }
    })
    broadcastData()
    return data
  })
  ipcMain.handle('organizer:scanDesktop', () => scanDesktop())
  ipcMain.handle('organizer:previewOrganization', async (event) => {
    const plan = await previewOrganization(store.data)
    pendingOrganizerPreviews.set(event.sender.id, { plan, createdAt: Date.now() })
    return plan
  })
  ipcMain.handle('organizer:executeOrganization', async (event, confirmed: unknown) => {
    if (confirmed !== true) throw new Error('整理操作需要在预览后明确确认。')
    const cached = pendingOrganizerPreviews.get(event.sender.id)
    pendingOrganizerPreviews.delete(event.sender.id)
    if (!cached || Date.now() - cached.createdAt > PREVIEW_CONFIRMATION_TTL_MS) throw new Error('整理预览已失效，请重新预览后确认。')
    const record = await executeOrganization(structuredClone(store.data), cached.plan)
    const data = await store.update((draft) => {
      cached.plan.items.forEach((item, index) => {
        if (item.action === 'assign' && record.items[index]?.status === 'completed') record.items[index] = assignOrganizationItem(draft, item)
      })
      draft.fileOperations = [record, ...draft.fileOperations].slice(0, 30)
    })
    broadcastData()
    return data
  })
  ipcMain.handle('organizer:revertOperation', async (_event, id: unknown, confirmed: unknown) => {
    if (typeof id !== 'string' || confirmed !== true) throw new Error('回退操作需要明确确认。')
    const record = store.data.fileOperations.find((item) => item.id === id)
    if (!record || !record.reversible) throw new Error('找不到可回退的整理操作。')
    const reverted = await revertOperation(record)
    const data = await store.update((draft) => { draft.fileOperations = [reverted, ...draft.fileOperations].slice(0, 30) })
    broadcastData()
    return data
  })
  ipcMain.handle('organizer:recentFiles', async () => {
    const items = await recentDesktopFiles(store.data.recentFiles)
    await store.update((draft) => { draft.recentFiles = items })
    broadcastData()
    return items
  })
  ipcMain.handle('organizer:previewBatchRename', async (event, paths: unknown, prefix: unknown, start: unknown) => {
    if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string') || typeof prefix !== 'string') throw new Error('批量重命名参数无效。')
    const safePaths = paths.slice(0, 100) as string[]
    const safeStart = typeof start === 'number' && Number.isFinite(start) ? Math.max(1, Math.round(start)) : 1
    const plan = await previewBatchRename(safePaths, prefix, safeStart)
    pendingBatchRenamePreviews.set(event.sender.id, { key: batchRenamePreviewKey(safePaths, prefix, safeStart), plan, createdAt: Date.now() })
    return plan
  })
  ipcMain.handle('organizer:executeBatchRename', async (event, paths: unknown, prefix: unknown, start: unknown, confirmed: unknown) => {
    if (confirmed !== true || !Array.isArray(paths) || paths.some((item) => typeof item !== 'string') || typeof prefix !== 'string') throw new Error('批量重命名需要预览后明确确认。')
    const safePaths = paths.slice(0, 100) as string[]
    const safeStart = typeof start === 'number' && Number.isFinite(start) ? Math.max(1, Math.round(start)) : 1
    const cached = pendingBatchRenamePreviews.get(event.sender.id)
    pendingBatchRenamePreviews.delete(event.sender.id)
    if (!cached || Date.now() - cached.createdAt > PREVIEW_CONFIRMATION_TTL_MS || cached.key !== batchRenamePreviewKey(safePaths, prefix, safeStart)) throw new Error('批量重命名预览已失效或参数已变更，请重新预览后确认。')
    const record = await executeBatchRename(safePaths, prefix, safeStart, cached.plan)
    const data = await store.update((draft) => { draft.fileOperations = [record, ...draft.fileOperations].slice(0, 30) })
    broadcastData()
    return data
  })
  ipcMain.handle('files:inspectBackend', () => inspectSearchBackend())
  ipcMain.handle('files:requestAuthorization', () => requestSearchAuthorization())
  ipcMain.handle('files:search', async (event, filters) => {
    if (!filters || typeof filters !== 'object') throw new Error('搜索条件无效。')
    if (!await requestSearchAuthorization()) return []
    cancelFileSearch(event.sender.id)
    const controller = new AbortController()
    activeFileSearches.set(event.sender.id, controller)
    try {
      return await searchFiles(filters as import('./types').FileFilters, undefined, controller.signal)
    } finally {
      if (activeFileSearches.get(event.sender.id) === controller) activeFileSearches.delete(event.sender.id)
    }
  })
  ipcMain.handle('files:cancelSearch', (event) => cancelFileSearch(event.sender.id))
  ipcMain.handle('files:open', async (_event, path: unknown) => {
    if (typeof path === 'string' && path.startsWith('shell:') && shellDesktopItems.some(item => item.path === path && item.category === 'system')) {
      await promisify(execFile)('explorer.exe', [path], { windowsHide: true })
      return ''
    }
    if (!isSafeFilesystemPath(path)) throw new Error('文件路径无效。')
    const safePath = path.trim()
    const error = await openPath(safePath)
    if (!error) {
      await store.update((draft) => {
        draft.recentFiles = [{ path: safePath, name: basename(safePath), kind: 'opened' as const, occurredAt: new Date().toISOString() }, ...draft.recentFiles.filter((item) => item.path !== safePath || item.kind !== 'opened')].slice(0, 80)
      })
      broadcastData()
    }
    return error
  })
  ipcMain.handle('files:reveal', (_event, path: unknown) => {
    if (!isSafeFilesystemPath(path)) throw new Error('文件路径无效。')
    return revealPath(path.trim())
  })
  ipcMain.handle('files:copyPath', (_event, path: unknown) => {
    if (!isSafeFilesystemPath(path)) throw new Error('文件路径无效。')
    clipboard.writeText(path.trim())
  })
  ipcMain.handle('dialog:selectFolder', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:selectFile', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow!, { properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('config:export', async (event) => {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow!, { title: '导出桌面搭子配置', defaultPath: 'gerson-toolbox-config.json', filters: [{ name: 'JSON 配置', extensions: ['json'] }] })
    if (!result.canceled && result.filePath) await store.exportTo(result.filePath)
    return result.filePath || null
  })
  ipcMain.handle('config:import', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow!, { title: '导入桌面搭子配置', properties: ['openFile'], filters: [{ name: 'JSON 配置', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    await releaseDesktop()
    const data = await store.importFrom(result.filePaths[0])
    applySettings(data.settings)
    registerShortcuts()
    resetDirectoryWatchers()
    if (data.settings.desktopCollected) return startDesktopCollection()
    broadcastData()
    return data
  })
  ipcMain.handle('config:moveData', async (_event, directory: unknown) => {
    if (!isSafeFilesystemPath(directory)) throw new Error('数据目录无效。')
    const data = await store.moveDataDirectory(directory.trim())
    broadcastData()
    return data
  })
  ipcMain.handle('system:toggleDesktopIcons', () => toggleDesktopIcons())
  ipcMain.handle('system:refreshIcons', async () => {
    try {
      await refreshNativeDesktopIcons()
      return true
    } catch {
      return refreshIconCache()
    }
  })
  ipcMain.handle('desktop:status', () => getDesktopStatus())
  ipcMain.handle('desktop:backupNative', () => backupNativeDesktopLayout())
  ipcMain.handle('desktop:restoreNative', (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim() || id.length > 160) throw new Error('桌面布局备份标识无效。')
    return restoreNativeDesktopLayout(id)
  })
  ipcMain.handle('desktop:restoreLatestCategoryLayout', async (_event, confirmed: unknown) => {
    if (confirmed !== true) throw new Error('还原分类前布局需要明确确认。')
    return restoreLatestCategoryLayout()
  })
  ipcMain.handle('desktop:resetControlDefaults', async (_event, confirmed: unknown) => {
    if (confirmed !== true) throw new Error('恢复桌面控制默认设置需要明确确认。')
    return resetDesktopControlDefaults()
  })
  ipcMain.handle('desktop:snapNative', async (_event, mode: 'grid' | 'edge' = 'grid') => {
    await backupNativeDesktopLayout()
    return mode === 'edge' ? snapSelectedDesktopIconsToEdge() : snapDesktopToGrid()
  })
  ipcMain.handle('desktop:setSpacing', async (_event, horizontal: unknown, vertical: unknown) => {
    if (typeof horizontal !== 'number' || !Number.isFinite(horizontal) || typeof vertical !== 'number' || !Number.isFinite(vertical) || horizontal < 32 || horizontal > 512 || vertical < 32 || vertical > 512) throw new Error('图标间距必须为 32 至 512 的有限数值。')
    const result = await setDesktopSpacing(Math.round(horizontal), Math.round(vertical))
    await store.update((data) => { data.settings.iconSpacing = horizontal })
    broadcastData()
    return result
  })
  ipcMain.handle('desktop:previewCategoryLayout', async (event) => {
    const context = await captureCategoryLayout()
    pendingLayoutPreviews.set(event.sender.id, { plan: context.plan, fingerprint: context.fingerprint, createdAt: Date.now() })
    return context.plan
  })
  ipcMain.handle('desktop:applyCategoryLayout', () => { throw new Error('旧版坐标重排已停用，请使用桌面分类组件。') })
  ipcMain.handle('system:captureScreen', () => captureFullScreen())
  ipcMain.handle('capture:start', () => startRegionCapture())
  ipcMain.handle('capture:getSource', (event) => {
    if (!captureOverlayWindow || captureOverlayWindow.isDestroyed() || event.sender.id !== captureOverlayWindow.webContents.id || !captureSource) throw new Error('截图选区窗口不可用。')
    return captureSource
  })
  ipcMain.handle('capture:complete', (event, dataUrl: unknown) => {
    if (!captureOverlayWindow || captureOverlayWindow.isDestroyed() || event.sender.id !== captureOverlayWindow.webContents.id) throw new Error('无权提交截图。')
    if (!isPngDataUrl(dataUrl)) throw new Error('截图数据无效或过大。')
    copyImageDataUrl(dataUrl)
    sendToRenderer('screenshot:region', dataUrl)
    captureOverlayWindow.close()
  })
  ipcMain.handle('capture:cancel', (event) => {
    if (!captureOverlayWindow || captureOverlayWindow.isDestroyed() || event.sender.id !== captureOverlayWindow.webContents.id) throw new Error('无权取消截图。')
    captureOverlayWindow.close()
  })
  ipcMain.handle('system:captureWindows', () => captureWindowList())
  ipcMain.handle('system:copyImage', (_event, dataUrl: unknown) => {
    if (!isPngDataUrl(dataUrl)) throw new Error('截图数据无效或过大。')
    copyImageDataUrl(dataUrl)
  })
  ipcMain.handle('system:openExternal', (_event, url: unknown) => {
    if (!isAllowedExternalUrl(url)) throw new Error('仅允许打开 HTTP(S) 或 mailto 链接。')
    return shell.openExternal(url)
  })
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggleMaximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize())
  // 必须触发 BrowserWindow 的 close 事件，统一清除显式打开锁定后再隐藏，避免边缘模式被永久抑制。
  ipcMain.handle('window:close', () => mainWindow?.close())
}

const collectAtStartup = async (): Promise<void> => {
  let lastError: unknown
  for(let attempt=0;attempt<5 && !desktopReleasePending && !startupCollectionCancelled;attempt++) {
    if(collectionBusy) return
    try { await startDesktopCollection(); return }
    catch(error) { lastError=error; if(attempt<4) await new Promise(resolve => setTimeout(resolve,2000)) }
  }
  if(!desktopReleasePending && !startupCollectionCancelled) new Notification({title:'桌面收纳未完成，原图标已保留',body:lastError instanceof Error ? lastError.message : '桌面尚未准备好，请双击空白桌面重试。'}).show()
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.gerson.desktoptoolbox')
  await store.init()
  if (store.data.settings.dataDirectory) await store.init(store.data.settings.dataDirectory)
  await store.update(data => {
    const area = screen.getPrimaryDisplay().workArea
    migrateDesktopCollection(data, area)
    if(!data.desktopModules.some(module=>module.kind==='health')){
      const assistant=data.desktopModules.find(module=>module.kind==='todos')!
      assistant.height=Math.min(assistant.height,Math.max(160,area.y+area.height-assistant.y-144))
      assistant.preferredBounds={x:assistant.x,y:assistant.y,width:assistant.width,height:assistant.height}
      data.desktopModules.push({id:'health',kind:'health',title:'喝水与活动',visible:true,collapsed:false,x:assistant.x,y:assistant.y+assistant.height,width:300,height:108,dock:{parentId:'todos',edge:'bottom',offset:0},displayId:screen.getPrimaryDisplay().id})
    }
    const health=data.desktopModules.find(module=>module.kind==='health')
    if(health){
      Object.assign(health,healthWidgetSize)
      if(health.preferredBounds)Object.assign(health.preferredBounds,healthWidgetSize)
      if(health.dock)health.dock=findWidgetDock(health,data.desktopModules.filter(module=>module.visible && ['quick','todos'].includes(module.id)).map(module=>({id:module.id,bounds:module}))) ?? health.dock
    }
    if(skipTestDesktop) data.settings.desktopCollected=false
    if (!data.desktopModules.some(module=>module.displayId!==undefined)) {
      for(const module of data.desktopModules) module.displayId=screen.getDisplayMatching(module).id
    }
    for(const [index,kind] of extraWidgetKinds.entries()) {
      if(!data.desktopModules.some(module=>module.id===kind)) data.desktopModules.push({id:kind,kind,title:widgetTitles[kind],visible:false,collapsed:false,x:area.x+24+(index%3)*320,y:area.y+24+Math.floor(index/3)*260,width:316,height:320,displayId:screen.getPrimaryDisplay().id})
    }
    for(const module of [...data.desktopModules,...data.desktopZones.filter(zone=>!zone.id.startsWith('desktop-'))]) {
      if(!module.preferredBounds) module.preferredBounds={x:module.x,y:module.y,width:module.width,height:module.height}
      const display=screen.getAllDisplays().find(display=>display.id===module.displayId) || screen.getDisplayMatching(module)
      Object.assign(module,fitWidgetToWorkArea(module.preferredBounds,display.workArea))
    }
  })
  registerIpc()
  try { await refreshDesktopGroups() }
  catch (error) {
    console.error('[桌面初始化]', error)
    await store.update(data => {
      data.settings.desktopCollected = false

    })
  }
  await createMainWindow()
  createTray()
  for(const note of store.data.notes.filter(note=>note.floating)) {
    try {await showFloatingNote(note.id,false)}catch(error){console.error('[便签恢复]',error)}
  }
  applySettings(store.data.settings)
  registerShortcuts()
  resetDirectoryWatchers()
  startReminderWatcher()
  const updateDisplayLayout = () => { void fitDesktopWidgetsToDisplays().catch(console.error) }
  screen.on('display-added', updateDisplayLayout)
  screen.on('display-removed', updateDisplayLayout)
  screen.on('display-metrics-changed', updateDisplayLayout)
  if(!skipTestDesktop) startDesktopGestures(() => {
    if(collectionBusy || desktopReleasePending) return
    void startDesktopCollection().catch(error => new Notification({title:'桌面收纳未完成',body:error.message}).show())
  })
  if(!skipTestDesktop && store.data.settings.desktopModeEnabled && store.data.desktopModules.some(module=>module.id==='quick' && module.visible)) void collectAtStartup()

  if (isDevelopment && process.env.GERSON_OPEN_DEVTOOLS === '1') mainWindow?.webContents.openDevTools({ mode: 'detach' })

  app.on('activate', () => { void showDesktopWidgets() })
})

app.on('window-all-closed', () => undefined)

app.on('before-quit', (event) => {
  if (!desktopReleased) {
    event.preventDefault()
    if (!desktopReleasePending) {
      desktopReleasePending = true
      if (desktopRecoveryTimer) clearTimeout(desktopRecoveryTimer)
      void (skipTestDesktop ? Promise.resolve() : releaseDesktop()).then(() => { desktopReleased = true; app.quit() }).catch(error => {
        desktopReleasePending=false
        console.error('[退出恢复]',error)
        new Notification({title:'桌面图标恢复未完成，软件暂未退出',body:'请再次尝试退出，或在桌面右键菜单中开启显示桌面图标。'}).show()
      })
    }
    return
  }
  quitting = true
  stopDesktopGestures()
  globalShortcut.unregisterAll()
  if (reminderTimer) clearInterval(reminderTimer)
  if (desktopSortTimer) clearTimeout(desktopSortTimer)
  directoryUnwatchers.forEach((stop) => stop())
  closeAllNoteWindows()
  hideQuickSearchWindow()
  if (quickSearchWindow && !quickSearchWindow.isDestroyed()) quickSearchWindow.destroy()
  closeDesktopModuleWindows()
  closeDesktopZoneWindows()
  closeEdgeTrigger()
})

process.on('uncaughtException', (error) => console.error('[主进程异常]', error))
