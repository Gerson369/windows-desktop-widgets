import { classifyDesktopItem } from './desktop-categories'
import type { AppData, AppSettings, CollectionSort } from './types'

export const collectionTabs = [
  { id: 'apps', label: '应用', targetZone: 'desktop-apps' },
  { id: 'files', label: '文件', targetZone: 'desktop-documents' },
  { id: 'images', label: '图片', targetZone: 'desktop-images' },
  { id: 'media', label: '影音', targetZone: 'desktop-videos' }
] as const
export type CollectionTab = typeof collectionTabs[number]['id']

export function normalizeCollectionRules(source: unknown): AppSettings['collectionRules'] {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const entries = Object.entries(source).map(([extension, tab]) => [extension.trim().replace(/^\./, '').toLowerCase(), tab] as const)
  return Object.fromEntries(entries.filter(([extension, tab]) => /^[a-z0-9]{1,12}$/.test(extension) && collectionTabs.some(item => item.id === tab)).slice(0, 32)) as AppSettings['collectionRules']
}

export function selectCollectionPaths(paths: string[], selected: Set<string>, anchor: string, target: string, mode: 'single' | 'toggle' | 'range'): Set<string> {
  if (!paths.includes(target)) return new Set(selected)
  if (mode === 'single') return new Set([target])
  if (mode === 'toggle') {
    const result = new Set(selected)
    if (result.has(target)) result.delete(target)
    else result.add(target)
    return result
  }
  const start = paths.indexOf(anchor)
  const end = paths.indexOf(target)
  return new Set(start < 0 ? [target] : paths.slice(Math.min(start, end), Math.max(start, end) + 1))
}

export interface CollectionItem { path: string; name: string; extension: string; isDirectory: boolean; createdAt?: string; modifiedAt?: string; category?: string }

export function normalizeCollectionSorts(source: unknown): AppSettings['collectionSorts'] {
  const input = source && typeof source === 'object' && !Array.isArray(source) ? source as Record<string, unknown> : {}
  return Object.fromEntries(collectionTabs.map(tab => {
    const value = input[tab.id] as Partial<CollectionSort> | undefined
    return [tab.id, { by: tab.id==='apps' && value?.by==='type' ? 'name' : value && ['name','type','createdAt','modifiedAt'].includes(value.by || '') ? value.by! : tab.id === 'apps' ? 'name' : 'type', direction: value?.direction === 'desc' ? 'desc' : 'asc' }]
  })) as AppSettings['collectionSorts']
}

export function sortCollectionItems<T extends CollectionItem>(items: T[], sort: CollectionSort): T[] {
  const compare = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }).compare
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...items].sort((a, b) => {
    if (sort.by === 'createdAt' || sort.by === 'modifiedAt') {
      const left = Date.parse(a[sort.by] || ''), right = Date.parse(b[sort.by] || '')
      if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1
      if (Number.isFinite(left) && left !== right) return direction * (left-right)
    }
    if (sort.by === 'type' && a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const typeOrder = sort.by === 'type' ? compare(a.extension, b.extension) : 0
    return direction * (typeOrder || compare(a.name, b.name) || compare(a.path, b.path))
  })
}

export function collectionItems(data: AppData, tab: CollectionTab): CollectionItem[] {
  const tabForZone = (id: string): CollectionTab => {
    if (['desktop-apps', 'desktop-system'].includes(id)) return 'apps'
    if (id === 'desktop-images') return 'images'
    if (['desktop-videos', 'desktop-audio'].includes(id)) return 'media'
    return 'files'
  }
  const items = new Map<string, CollectionItem>()
  for (const zone of data.desktopZones.filter(zone => zone.id.startsWith('desktop-') && zone.visible && tabForZone(zone.id) === tab)) {
    for (const id of zone.itemIds) {
      const inbox = data.inboxItems.find(item => item.id === id)
      const path = inbox?.sourcePath || id
      const item = data.desktopItems.find(item => item.path === path)
      if (item || inbox?.sourcePath) items.set(path, {
        path, name: (inbox?.name || item?.name || path).replace(/\.(lnk|url)$/i, ''),
        extension: item?.extension || path.split(/[\\/]/).pop()?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '',
        isDirectory: item?.isDirectory || inbox?.isDirectory || false, createdAt:item?.createdAt || inbox?.createdAt, modifiedAt:item?.modifiedAt || inbox?.modifiedAt, category:item?.category || classifyDesktopItem(inbox?.name || path,inbox?.isDirectory===true)
      })
    }
  }
  return [...items.values()]
}
