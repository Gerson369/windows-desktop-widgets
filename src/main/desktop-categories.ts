import type { DesktopFileCategory } from './types'

const CATEGORY_EXTENSIONS: Record<Exclude<DesktopFileCategory, 'folder' | 'other' | 'system'>, Set<string>> = {
  image: new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'ico', 'avif']),
  document: new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'wps']),
  archive: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso']),
  installer: new Set(['exe', 'msi', 'msix', 'appx', 'apk']),
  shortcut: new Set(['lnk', 'url']),
  video: new Set(['mp4', 'mkv', 'mov', 'avi', 'wmv', 'webm', 'm4v', 'mpeg', 'mpg', 'flv', 'ts', '3gp']),
  audio: new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff', 'aif', 'opus', 'mid'])
}
export const classifyDesktopItem = (name: string, isDirectory: boolean): DesktopFileCategory => {
  if (isDirectory) return 'folder'
  const base = name.split(/[\\/]/).pop() || ''
  const dot = base.lastIndexOf('.')
  const extension = dot > 0 ? base.slice(dot+1).toLowerCase() : ''
  return (Object.entries(CATEGORY_EXTENSIONS).find(([, extensions]) => extensions.has(extension))?.[0] as DesktopFileCategory | undefined) || 'other'
}

