import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppData, AppSettings, BatchRenamePlan, DesktopIconArrangePlan, DesktopScanResult, DesktopZone, FileFilters, InboxItem, OrganizerPlan, RecentFile } from '../main/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args).catch(error => {
  const message=error instanceof Error?error.message:String(error)
  throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''))
})

const toolbox = {
  suite: {
    save: (patch: Partial<import('../main/widget-suite').WidgetSuite>) => invoke<AppData>('suite:save', patch),
    focus: (action: 'start'|'pause'|'reset', seconds?: number) => invoke<AppData>('suite:focus', action, seconds),
    agenda: (from: number, until: number) => invoke<ReturnType<typeof import('../main/calendar-service').agenda>>('suite:agenda',from,until),
    importCalendar: () => invoke<AppData|null>('suite:importCalendar'),
    subscribeCalendar: (name:string,url:string) => invoke<AppData>('suite:subscribeCalendar',name,url),
    refreshCalendar: (id:string) => invoke<AppData>('suite:refreshCalendar',id),
    searchCities: (query:string) => invoke<import('../main/widget-suite').WeatherCity[]>('suite:searchCities',query),
    weather: (id:string) => invoke<import('../main/weather-service').WeatherReading>('suite:weather',id),
    metrics: () => invoke<import('../main/device-metrics').Metrics>('suite:metrics'),
    displays: () => invoke<Array<{id:number;label:string;workArea:{x:number;y:number;width:number;height:number}}>>('suite:displays'),
    moveDisplay: (id:string,displayId:number) => invoke<AppData>('suite:moveDisplay',id,displayId),
    visibility: (action:'overlay'|'closeOverlay'|'toggle'|'resetLayout') => invoke<void>('suite:visibility',action)
  },
  todoReminders: {
    set: (id: string, at: string | null) => invoke<AppData>('todoReminders:set', id, at),
    respond: (id: string, action: 'done' | 'snooze') => invoke<AppData>('todoReminders:respond', id, action),
  },
  wellness: {
    onFeedback: (callback: (result: {message:string;failed:boolean}) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: {message:string;failed:boolean}) => callback(result)
      ipcRenderer.on('wellness:feedback', listener)
      return () => ipcRenderer.removeListener('wellness:feedback', listener)
    },
    resetHydration: () => invoke<AppData>('wellness:resetHydration'),
    setHydrationGoal: (goalMl: number) => invoke<AppData>('wellness:setHydrationGoal', goalMl),
    menu: (kind: import('../main/wellness-reminders').ReminderKind) => invoke<void>('wellness:menu', kind),
    get: () => invoke<import('../main/wellness-reminders').WellnessSnapshot>('wellness:get'),
    undo: (id: string) => invoke<import('../main/wellness-reminders').WellnessSnapshot>('wellness:undo', id),
    respond: (kind: import('../main/wellness-reminders').ReminderKind, action: 'done' | 'snooze', recording?: import('../main/hydration-plan').HydrationRecording) => invoke<import('../main/wellness-reminders').WellnessSnapshot>('wellness:respond', kind, action, recording),
    onChanged: (callback: (snapshot: import('../main/wellness-reminders').WellnessSnapshot) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: import('../main/wellness-reminders').WellnessSnapshot) => callback(snapshot)
      ipcRenderer.on('wellness:changed', listener)
      return () => ipcRenderer.removeListener('wellness:changed', listener)
    }
  },
  data: {
    get: () => invoke<AppData>('data:get'),
    onChanged: (callback: (data: AppData) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: AppData) => callback(data)
      ipcRenderer.on('data:changed', listener)
      return () => ipcRenderer.removeListener('data:changed', listener)
    }
  },
  settings: {
    update: (patch: Partial<AppSettings>) => invoke<AppData>('settings:update', patch),
    reset: () => invoke<AppData>('settings:reset')
  },
  entity: {
    upsert: (collection: string, entry: Record<string, unknown>) => invoke<AppData>('entity:upsert', collection, entry),
    remove: (collection: string, id: string) => invoke<AppData>('entity:remove', collection, id)
  },
  organizer: {
    assignDesktopItems: (paths: string[], zoneId: string) => invoke<AppData>('organizer:assignDesktopItems', paths, zoneId),
    assignDesktopItem: (path: string, zoneId: string) => invoke<AppData>('organizer:assignDesktopItem', path, zoneId),
    refreshDesktopGroups: () => invoke<AppData>('organizer:refreshDesktopGroups'),
    createZone: (input: Pick<DesktopZone, 'name'> & Partial<Pick<DesktopZone, 'color' | 'opacity'>>) => invoke<AppData>('organizer:createZone', input),
    updateZone: (id: string, patch: Partial<Pick<DesktopZone, 'name' | 'visible' | 'collapsed' | 'locked' | 'color' | 'opacity'>>) => invoke<AppData>('organizer:updateZone', id, patch),
    removeZone: (id: string) => invoke<AppData>('organizer:removeZone', id),
    addInboxItems: (entries: Array<Pick<InboxItem, 'type' | 'name'> & Partial<Pick<InboxItem, 'sourcePath' | 'content'>>>) => invoke<AppData>('organizer:addInboxItems', entries),
    updateInboxItem: (id: string, patch: Partial<Pick<InboxItem, 'archived' | 'zoneId'>>) => invoke<AppData>('organizer:updateInboxItem', id, patch),
    removeInboxItem: (id: string) => invoke<AppData>('organizer:removeInboxItem', id),
    upsertRule: (rule: import('../main/types').OrganizerRule) => invoke<AppData>('organizer:upsertRule', rule),
    removeRule: (id: string) => invoke<AppData>('organizer:removeRule', id),
    installDefaultArchiveRules: () => invoke<AppData>('organizer:installDefaultArchiveRules'),
    scanDesktop: () => invoke<DesktopScanResult>('organizer:scanDesktop'),
    previewOrganization: () => invoke<OrganizerPlan>('organizer:previewOrganization'),
    executeOrganization: (confirmed: true) => invoke<AppData>('organizer:executeOrganization', confirmed),
    revertOperation: (id: string, confirmed: true) => invoke<AppData>('organizer:revertOperation', id, confirmed),
    recentFiles: () => invoke<RecentFile[]>('organizer:recentFiles'),
    previewBatchRename: (paths: string[], prefix: string, start: number) => invoke<BatchRenamePlan>('organizer:previewBatchRename', paths, prefix, start),
    executeBatchRename: (paths: string[], prefix: string, start: number, confirmed: true) => invoke<AppData>('organizer:executeBatchRename', paths, prefix, start, confirmed)
  },
  files: {
    rename: (path: string, name: string) => invoke<{ data: AppData; path: string }>('files:rename', path, name),
    trash: (path: string) => invoke<AppData>('files:trash', path),
    pathForDroppedFile: (file: File) => webUtils.getPathForFile(file),
    icon: (path: string) => invoke<string>('files:icon', path),
    inspectBackend: () => invoke<{ cwd: string; client: string; exists: boolean; raw: string[]; error?: string }>('files:inspectBackend'),
    requestAuthorization: () => invoke<boolean>('files:requestAuthorization'),
    search: (filters: FileFilters) => invoke<import('../main/types').FileResult[]>('files:search', filters),
    cancelSearch: () => invoke<void>('files:cancelSearch'),
    open: (path: string) => invoke<string>('files:open', path),
    reveal: (path: string) => invoke<void>('files:reveal', path),
    copyPath: (path: string) => invoke<void>('files:copyPath', path),
    onChanged: (callback: (path: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, path: string) => callback(path)
      ipcRenderer.on('files:changed', listener)
      return () => ipcRenderer.removeListener('files:changed', listener)
    }
  },
  dialogs: {
    selectFolder: () => invoke<string | null>('dialog:selectFolder'),
    selectFiles: () => invoke<string[]>('dialog:selectFile')
  },
  config: {
    export: () => invoke<string | null>('config:export'),
    import: () => invoke<AppData | null>('config:import'),
    moveData: (directory: string) => invoke<AppData>('config:moveData', directory)
  },
  desktop: {
    progress: () => invoke<import('../main/desktop-collection').CollectionProgress>('desktop:progress'),
    onProgress: (callback: (progress: import('../main/desktop-collection').CollectionProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: import('../main/desktop-collection').CollectionProgress) => callback(progress)
      ipcRenderer.on('desktop:progressChanged', listener)
      return () => ipcRenderer.removeListener('desktop:progressChanged', listener)
    },
    collect: () => invoke<AppData>('desktop:collect'),
    release: () => invoke<AppData>('desktop:release'),
    backupWidgets: () => invoke<AppData>('desktop:backupWidgets'),
    restoreWidgets: (id: string) => invoke<AppData>('desktop:restoreWidgets', id),
    onAutoSortError: (callback: (message: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
      ipcRenderer.on('desktop:categoryAutoSortError', listener)
      return () => ipcRenderer.removeListener('desktop:categoryAutoSortError', listener)
    },
    status: () => invoke<{ ok: boolean; available: boolean; itemCount?: number; spacingX?: number; spacingY?: number; autoArrange?: boolean; error?: string }>('desktop:status'),
    backupNative: () => invoke<{ id: string; count: number }>('desktop:backupNative'),
    restoreNative: (id: string) => invoke<number>('desktop:restoreNative', id),
    restoreLatestCategoryLayout: (confirmed: true) => invoke<{ id: string; applied: number }>('desktop:restoreLatestCategoryLayout', confirmed),
    resetControlDefaults: (confirmed: true) => invoke<AppData>('desktop:resetControlDefaults', confirmed),
    snapNative: (mode: 'grid' | 'edge') => invoke<number>('desktop:snapNative', mode),
    setSpacing: (horizontal: number, vertical: number) => invoke<{ spacingX: number; spacingY: number }>('desktop:setSpacing', horizontal, vertical),
    previewCategoryLayout: () => invoke<DesktopIconArrangePlan>('desktop:previewCategoryLayout'),
    applyCategoryLayout: (confirmed: true) => invoke<{ backupId: string; applied: number; plan: DesktopIconArrangePlan }>('desktop:applyCategoryLayout', confirmed)
  },
  system: {
    toggleDesktopIcons: () => invoke<{ success: boolean; hidden: boolean }>('system:toggleDesktopIcons'),
    refreshIcons: () => invoke<boolean>('system:refreshIcons'),
    captureScreen: () => invoke<{ dataUrl: string }>('system:captureScreen'),
    captureWindows: () => invoke<Array<{ id: string; name: string; dataUrl: string }>>('system:captureWindows'),
    copyImage: (dataUrl: string) => invoke<void>('system:copyImage', dataUrl),
    openExternal: (url: string) => invoke<void>('system:openExternal', url),
    onScreenshotCopied: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('screenshot:copied', listener)
      return () => ipcRenderer.removeListener('screenshot:copied', listener)
    },
    onRegionCaptured: (callback: (dataUrl: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, dataUrl: string) => callback(dataUrl)
      ipcRenderer.on('screenshot:region', listener)
      return () => ipcRenderer.removeListener('screenshot:region', listener)
    }
  },
  capture: {
    start: () => invoke<void>('capture:start'),
    getSource: () => invoke<{ dataUrl: string; width: number; height: number }>('capture:getSource'),
    complete: (dataUrl: string) => invoke<void>('capture:complete', dataUrl),
    cancel: () => invoke<void>('capture:cancel')
  },
  clipboardHistory: {
    copy: (id: string) => invoke<void>('clipboard:copy', id),
    update: (id: string, patch: { pinned?: boolean }) => invoke<AppData>('clipboard:update', id, patch),
    remove: (id: string) => invoke<AppData>('clipboard:remove', id)
  },
  quickSearch: {
    show: () => invoke<void>('quickSearch:show'),
    hide: () => invoke<void>('quickSearch:hide')
  },
  desktopModules: {
    hover: (expanded: boolean) => invoke<void>('desktopModules:hover', expanded),
    drag: (action: 'start'|'move'|'end') => invoke<void>('desktopModules:drag',action),
    update: (id: string, patch: { visible?: boolean; collapsed?: boolean; title?: string }) => invoke<import('../main/types').AppData>('desktopModules:update', id, patch),
    openMain: (section?: string) => invoke<void>('desktopModules:openMain', section)
  },
  notes: {
    get: (id: string) => invoke<import('../main/types').StickyNote | null>('notes:get', id),
    show: (id: string) => invoke<import('../main/types').StickyNote>('notes:show', id),
    hide: (id: string) => invoke<import('../main/types').StickyNote>('notes:hide', id),
    update: (id: string, patch: Partial<import('../main/types').StickyNote>) => invoke<import('../main/types').StickyNote>('notes:update', id, patch),
    onChanged: (callback: (note: import('../main/types').StickyNote) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, note: import('../main/types').StickyNote) => callback(note)
      ipcRenderer.on('note:changed', listener)
      return () => ipcRenderer.removeListener('note:changed', listener)
    }
  },
  window: {
    minimize: () => invoke<void>('window:minimize'),
    toggleMaximize: () => invoke<void>('window:toggleMaximize'),
    close: () => invoke<void>('window:close')
  },
  events: {
    onNavigate: (callback: (section: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, section: string) => callback(section)
      ipcRenderer.on('navigate', listener)
      return () => ipcRenderer.removeListener('navigate', listener)
    },
    onShortcutError: (callback: (accelerator: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, accelerator: string) => callback(accelerator)
      ipcRenderer.on('shortcut:error', listener)
      return () => ipcRenderer.removeListener('shortcut:error', listener)
    }
  }
}

contextBridge.exposeInMainWorld('toolbox', toolbox)

export type Toolbox = typeof toolbox
