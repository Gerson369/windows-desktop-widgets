import { extraWidgetKinds } from './widget-suite'
import { validWidgetDock } from './widget-docking'
import type { AppData, WidgetLayoutBackup } from './types'
import { normalizeCollectionSorts, normalizeCollectionRules } from './desktop-collection'
import { healthWidgetSize } from './desktop-panels'

export function captureWidgetLayout(data: AppData, id: string, name: string, createdAt: string): WidgetLayoutBackup {
  return {
    id, name, createdAt,
    modules: data.desktopModules.map(({ id, x, y, width, height, collapsed, visible, displayId, preferredBounds, dock }) => ({ id, x, y, width, height, collapsed, visible, displayId, preferredBounds, ...(dock?{dock:{...dock}}:{}) })),
    zones: structuredClone(data.desktopZones.filter(zone=>!zone.id.startsWith('desktop-'))),
    suite: {background:data.suite.background,textColor:data.suite.textColor,fontSize:data.suite.fontSize},
    opacity: data.settings.desktopModuleOpacity,
    sorts: structuredClone(data.settings.collectionSorts),
    assignments: { ...data.desktopAssignments },
    rules: { ...data.settings.collectionRules }
  }
}

export function validWidgetLayout(value: unknown): value is WidgetLayoutBackup {
  if (!value || typeof value !== 'object') return false
  const backup = value as WidgetLayoutBackup
  if (typeof backup.id !== 'string' || backup.id.length > 160 || typeof backup.name !== 'string' || backup.name.length > 200 || typeof backup.createdAt !== 'string' || !Number.isFinite(Date.parse(backup.createdAt))) return false
  if (!Array.isArray(backup.modules) || backup.modules.length < 2 || backup.modules.length > 10 || new Set(backup.modules.map(item => item?.id)).size !== backup.modules.length) return false
  if (!backup.modules.every(item => item && (['quick', 'todos', 'health', ...extraWidgetKinds] as string[]).includes(item.id) && typeof item.collapsed === 'boolean'
    && (item.dock===undefined || validWidgetDock(item.dock))
    && [item.x, item.y, item.width, item.height].every(Number.isFinite) && Math.abs(item.x) <= 100000 && Math.abs(item.y) <= 100000
    && item.width >= 300 && item.width <= 10000 && item.height >= (item.id==='health' ? healthWidgetSize.height : 120) && item.height <= 10000)) return false
  if(backup.modules.some(item=>item.preferredBounds && (![item.preferredBounds.x,item.preferredBounds.y,item.preferredBounds.width,item.preferredBounds.height].every(Number.isFinite) || item.preferredBounds.width<240 || item.preferredBounds.height<(item.id==='health' ? healthWidgetSize.height : 120)))) return false
  if(backup.zones !== undefined && (!Array.isArray(backup.zones) || backup.zones.length>12 || backup.zones.some(zone=>!zone || typeof zone.id!=='string' || zone.id.startsWith('desktop-') || typeof zone.name!=='string' || zone.name.length>120 || typeof zone.visible!=='boolean' || typeof zone.collapsed!=='boolean' || typeof zone.locked!=='boolean' || !/^#[0-9a-f]{6}$/i.test(zone.color) || !Number.isFinite(zone.opacity) || zone.opacity<0 || zone.opacity>100 || !Array.isArray(zone.itemIds) || zone.itemIds.length>10000 || !zone.itemIds.every(id=>typeof id==='string') || ![zone.x,zone.y,zone.width,zone.height].every(Number.isFinite) || zone.width<240 || zone.height<120))) return false
  return Number.isFinite(backup.opacity) && backup.opacity >= 0 && backup.opacity <= 100
    && Boolean(backup.assignments && typeof backup.assignments === 'object' && !Array.isArray(backup.assignments)
      && Object.entries(backup.assignments).length <= 10000
      && Object.entries(backup.assignments).every(([path, id]) => path.length <= 32767 && typeof id === 'string' && id.length <= 160))
}

export function applyWidgetLayout(data: AppData, backup: WidgetLayoutBackup): void {
  if (!validWidgetLayout(backup)) throw new Error('组件布局备份无效。')
  for (const saved of backup.modules) {
    const module = data.desktopModules.find(item => item.id === saved.id)
    if (module) {
      if (typeof saved.visible === 'boolean') module.visible = saved.visible
      if(saved.dock)module.dock={...saved.dock}
      else delete module.dock
      if (Number.isFinite(saved.displayId)) module.displayId = saved.displayId
      if(saved.preferredBounds) module.preferredBounds={...saved.preferredBounds}
      else delete module.preferredBounds
      module.x = saved.x; module.y = saved.y; module.width = saved.width; module.height = saved.height; module.collapsed = saved.collapsed
    }
  }
  if(backup.zones) {
    for(const saved of backup.zones) {
      const current=data.desktopZones.find(zone=>zone.id===saved.id)
      if(current) Object.assign(current,structuredClone(saved))
      else if(data.desktopZones.length<19) data.desktopZones.push(structuredClone(saved))
    }
  }
  if (backup.suite) {
    if (/^#[0-9a-f]{6}$/i.test(backup.suite.background)) data.suite.background=backup.suite.background
    if (/^#[0-9a-f]{6}$/i.test(backup.suite.textColor)) data.suite.textColor=backup.suite.textColor
    if (Number.isInteger(backup.suite.fontSize) && backup.suite.fontSize>=12 && backup.suite.fontSize<=20) data.suite.fontSize=backup.suite.fontSize
  }
  data.settings.desktopModuleOpacity = backup.opacity
  data.settings.collectionSorts = normalizeCollectionSorts(backup.sorts)
  if (backup.rules) data.settings.collectionRules = normalizeCollectionRules(backup.rules)
  data.desktopAssignments = Object.fromEntries(Object.entries(backup.assignments).filter(([path, id]) => (data.desktopItems.some(item => item.path === path) || data.inboxItems.some(item=>item.sourcePath===path)) && data.desktopZones.some(zone => zone.id === id)))
  for(const entry of data.inboxItems) if(entry.sourcePath && data.desktopAssignments[entry.sourcePath]) entry.zoneId=data.desktopAssignments[entry.sourcePath]
  for(const zone of data.desktopZones) zone.itemIds=zone.itemIds.filter(id=>{const entry=data.inboxItems.find(item=>item.id===id);const target=data.desktopAssignments[entry?.sourcePath || id];return !target || target===zone.id})
}
