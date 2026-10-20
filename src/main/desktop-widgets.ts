import type { AppData, DesktopFileCategory, DesktopScanItem } from './types'

const groups: Array<{ id: string; name: string; categories: DesktopFileCategory[] }> = [
  { id: 'desktop-apps', name: '应用与快捷方式', categories: ['shortcut'] },
  { id: 'desktop-folders', name: '文件夹', categories: ['folder'] },
  { id: 'desktop-documents', name: '文档与文件', categories: ['document', 'archive', 'installer', 'other'] },
  { id: 'desktop-images', name: '图片', categories: ['image'] },
  { id: 'desktop-videos', name: '视频', categories: ['video'] },
  { id: 'desktop-audio', name: '音频', categories: ['audio'] },
  { id: 'desktop-system', name: '系统图标', categories: ['system'] }
]

export function renamedDesktopPaths(previous: DesktopScanItem[], next: DesktopScanItem[]): Map<string, string> {
  const paths = new Set(next.map(item => item.path))
  const renames = new Map<string, string>()
  for (const item of previous) {
    if (!item.identity || paths.has(item.path)) continue
    const originals = previous.filter(other => other.identity === item.identity)
    const replacements = next.filter(other => other.identity === item.identity)
    if (originals.length === 1 && replacements.length === 1) renames.set(item.path, replacements[0].path)
  }
  return renames
}

export function placeStartupWidgets(data: AppData, area: { x: number; y: number; width: number; height: number }): void {
  const quick = data.desktopModules.find(module => module.kind === 'quick')
  const todos = data.desktopModules.find(module => module.kind === 'todos')
  if (!quick || !todos) return
  for (const module of [quick, todos]) {
    module.width = Math.min(module.width, Math.max(300, area.width - 40))
    module.height = Math.min(module.height, Math.max(280, area.height - 96))
    module.visible = true
  }
  const top = area.y + Math.max(16, Math.min(80, area.height - Math.max(quick.height, todos.height) - 16))
  quick.x = area.x + area.width - quick.width - 20
  quick.y = top
  todos.x = quick.x - todos.width
  todos.y = top
  if (todos.x < area.x + 16) {
    const available = Math.max(440, area.height - 96)
    quick.height = Math.min(quick.height, available - 160)
    todos.height = Math.min(todos.height, available - quick.height)
    quick.y = area.y + Math.max(16, Math.min(80, area.height - quick.height - todos.height - 16))
    todos.x = area.x + area.width - todos.width - 20
    todos.y = quick.y + quick.height
  }
}

/** Updates classification only; the native desktop lease controls original icon visibility. */
export function synchronizeDesktopGroups(data: AppData, items: DesktopScanItem[], area: { x: number; y: number; width: number; height: number }, createdAt: string): void {
  for (const [before, after] of renamedDesktopPaths(data.desktopItems, items)) {
    if (data.desktopAssignments[before] && !data.desktopAssignments[after]) data.desktopAssignments[after] = data.desktopAssignments[before]
    delete data.desktopAssignments[before]
    for (const zone of data.desktopZones) zone.itemIds = zone.itemIds.map(id => id === before ? after : id)
  }
  const firstRun = data.settings.desktopWidgetVersion < 3
  const managedIds = new Set(groups.map(group => group.id))
  data.desktopItems = [...new Map(items.map(item => [item.path, item])).values()].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  const targetFor = (item: DesktopScanItem): string | undefined => {
    const assigned = data.desktopAssignments[item.path]
    if (assigned && data.desktopZones.some(zone => zone.id === assigned)) return assigned
    const custom = data.desktopZones.find(zone => !managedIds.has(zone.id) && zone.itemIds.some(id => id === item.path || data.inboxItems.some(entry => entry.id === id && entry.sourcePath === item.path)))
    const rule = !item.isDirectory && Object.hasOwn(data.settings.collectionRules, item.extension) ? data.settings.collectionRules[item.extension] : undefined
    const category = rule ? ({apps:'shortcut',files:'document',images:'image',media:'video'} as const)[rule] : item.category
    return custom?.id || groups.find(group => group.categories.includes(category))?.id
  }
  for (const group of groups) {
    let zone = data.desktopZones.find(zone => zone.id === group.id)
    if (!zone && data.desktopZones.length < 12) {
      zone = { id: group.id, name: group.name, color: '#a4dbb6', opacity: 46, visible: false, collapsed: false, locked: false,
        x: area.x + area.width - 320, y: area.y + 24, width: 304, height: 228, itemIds: [], createdAt }
      data.desktopZones.push(zone)
    }
    if (!zone) continue
    const previousCount = zone.itemIds.length
    zone.itemIds = data.desktopItems.filter(item => targetFor(item) === group.id).map(item => item.path)
    if (!firstRun && !previousCount && zone.itemIds.length) {
      const occupied = [...data.desktopZones, ...data.desktopModules].filter(state => state.id !== zone!.id && state.visible)
      let placed = false
      for (let row = 0; !placed && row < Math.floor((area.height - 24) / (zone.height + 12)); row++) {
        for (let column = 0; column < Math.floor((area.width - 24) / (zone.width + 12)); column++) {
          const x = area.x + area.width - (column + 1) * (zone.width + 12) - 12
          const y = area.y + 24 + row * (zone.height + 12)
          if (occupied.some(other => x < other.x + other.width && x + zone!.width > other.x && y < other.y + other.height && y + zone!.height > other.y)) continue
          zone.x = x; zone.y = y; placed = true; break
        }
      }
    }
    if (!zone.itemIds.length) zone.visible = false
    else if (firstRun || !previousCount) zone.visible = true
  }
  for (const [path, id] of Object.entries(data.desktopAssignments)) {
    const zone = data.desktopZones.find(zone => zone.id === id)
    if (zone && !managedIds.has(id) && data.desktopItems.some(item => item.path === path) && !zone.itemIds.includes(path)) zone.itemIds.push(path)
  }
  for(const entry of data.inboxItems.filter(entry=>!entry.archived && entry.sourcePath && entry.zoneId)) {
    const zone=data.desktopZones.find(zone=>zone.id===entry.zoneId)
    if(zone && !zone.itemIds.includes(entry.id) && !zone.itemIds.includes(entry.sourcePath!)) zone.itemIds.push(entry.id)
    if(zone) zone.visible=true
  }
  migrateDesktopCollection(data, area)
}

export function migrateDesktopCollection(data: AppData, area: { x: number; y: number; width: number; height: number }): void {
  if (data.settings.desktopWidgetVersion < 3) {
    data.settings.desktopModeEnabled = true
    data.settings.desktopModuleOpacity = 46
    data.settings.desktopHoverExpandEnabled = false
    data.settings.desktopIconAutoSortEnabled = false
    data.settings.desktopSnapDistance = 10
    data.desktopModules.forEach(module => { module.visible = module.kind === 'quick' })
    const quick = data.desktopModules.find(module => module.kind === 'quick')
    if (quick) {
      quick.title = '桌面收纳'
      quick.width = Math.min(360, area.width - 32)
      quick.height = Math.min(480, area.height - 48)
      quick.x = area.x + area.width - quick.width - 20
      quick.y = area.y + 24
      quick.collapsed = false
    }
    data.settings.desktopWidgetVersion = 3
  }
  if (data.settings.desktopWidgetVersion < 4) {
    if (!data.settings.hydrationReminderEnabled && data.settings.hydrationIntervalMinutes === 45) data.settings.hydrationIntervalMinutes = 30
    const quick = data.desktopModules.find(module => module.kind === 'quick')
    const todos = data.desktopModules.find(module => module.kind === 'todos')
    if (quick && todos) {
      todos.width = Math.min(304, area.width - 32)
      todos.height = Math.min(280, area.height - 48)
      const left = quick.x - todos.width - 12
      todos.x = Math.max(area.x + 16, Math.min(left >= area.x ? left : quick.x + quick.width + 12, area.x + area.width - todos.width - 16))
      todos.y = Math.max(area.y + 16, Math.min(quick.y, area.y + area.height - todos.height - 16))
      todos.title = '今日待办'
      todos.visible = true
      todos.collapsed = false
    }
    data.settings.desktopWidgetVersion = 4
  }
  if (data.settings.desktopWidgetVersion < 5) {
    const quick = data.desktopModules.find(module => module.kind === 'quick')
    const assistant = data.desktopModules.find(module => module.kind === 'todos')
    if (assistant) {
      const besideCollection = quick && Math.abs(assistant.x + assistant.width - quick.x) <= 16
      assistant.visible ||= data.desktopModules.some(module => module.kind !== 'quick' && module.kind !== 'todos' && module.visible)
      assistant.width = Math.min(Math.max(360, assistant.width), area.width - 32)
      assistant.height = Math.min(Math.max(480, assistant.height), area.height - 48)
      if (besideCollection) assistant.x = Math.max(area.x + 16, quick.x - assistant.width)
      assistant.title = '综合助手'
      assistant.preferredBounds = { x: assistant.x, y: assistant.y, width: assistant.width, height: assistant.height }
    }
    data.settings.desktopWidgetVersion = 5
  }
}

export function selectVisibleDesktopItems<T extends DesktopScanItem & { displayName?: string }>(entries: Array<{ name: string }>, items: T[], roots: string[]): { items: T[]; missing: string[] } {
  const normalize = (value: string): string => value.trim().toLocaleLowerCase('zh-CN')
  const desktopRoots = roots.map(root => normalize(root).replace(/[\\/]+$/, ''))
  const remaining = [...items].sort((a, b) => {
    const score = (item: T): number => desktopRoots.includes(normalize(item.path.replace(/[\\/][^\\/]+$/, ''))) ? 0 : item.category === 'system' ? 1 : 2
    return score(a) - score(b) || a.path.localeCompare(b.path, 'zh-CN')
  })
  const selected: T[] = []
  const missing: string[] = []
  for (const entry of entries) {
    const name = normalize(entry.name)
    const index = remaining.findIndex(item => normalize(item.displayName || item.name) === name || normalize(item.name) === name)
    if (index < 0) missing.push(entry.name)
    else selected.push(...remaining.splice(index, 1))
  }
  return { items: selected, missing }
}

export function canReuseDesktopInventory(entries: Array<{ name: string }>, cached: Array<DesktopScanItem & { displayName?: string }>, current: DesktopScanItem[]): boolean {
  if (!entries.length || entries.length !== cached.length || current.length !== cached.length) return false
  const paths = new Set(cached.map(item => item.path))
  return paths.size === cached.length && current.every(item => paths.has(item.path)) && selectVisibleDesktopItems(entries, cached, []).missing.length === 0
}

export function desktopCoverageProblems(data: AppData): string[] {
  if (data.settings.desktopWidgetVersion >= 3 && !data.desktopModules.some(module => module.kind === 'quick' && module.visible)) return data.desktopItems.map(item => item.path)
  const counts = new Map(data.desktopItems.map(item => [item.path, 0]))
  for (const zone of data.desktopZones.filter(zone => zone.visible)) {
    for (const id of zone.itemIds) {
      const path = data.inboxItems.find(item => item.id === id)?.sourcePath || id
      if (counts.has(path)) counts.set(path, counts.get(path)! + 1)
    }
  }
  return [...counts].filter(([, count]) => count !== 1).map(([path]) => path)
}
