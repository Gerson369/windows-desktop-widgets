import { app, nativeImage, shell, type NativeImage } from 'electron'
import { shellFileIcon, shellThumbnail } from './desktop-host'
import { readFile } from 'node:fs/promises'

const cache = new Map<string,Promise<string>>()
const lastGood = new Map<string,string>()
export function internetShortcutIcon(content: string): { path: string; index: number } | undefined {
  let inShortcut=false
  let path=''
  let index=0
  for(const source of content.split(/\r?\n/)) {
    const line=source.trim()
    if(line.startsWith('[')) { inShortcut=line.toLowerCase()==='[internetshortcut]'; continue }
    if(!inShortcut) continue
    const equals=line.indexOf('=')
    if(equals<0) continue
    const key=line.slice(0,equals).trim().toLowerCase()
    const value=line.slice(equals+1).trim()
    if(key==='iconfile') path=value.replace(/^"(.*)"$/, '$1')
    if(key==='iconindex' && /^-?\d+$/.test(value)) index=Number(value)
  }
  return path ? {path,index} : undefined
}
function visibleImage(image: NativeImage): boolean {
  if(image.isEmpty()) return false
  const bitmap=image.toBitmap()
  for(let i=3;i<bitmap.length;i+=4) if(bitmap[i]) return true
  return false
}
async function loadFileIcon(path: string): Promise<string> {
  if(process.platform==='win32' && /\.(png|jpg|jpeg|webp|bmp|gif|tif|tiff|mp4|mov|mkv|avi|wmv|webm)$/i.test(path)) {
    try {
      const image=await shellThumbnail(path)
      if(visibleImage(nativeImage.createFromDataURL(image))) return image
    } catch { /* A missing thumbnail must retain the normal file icon. */ }
  }
  let shortcut: ReturnType<typeof shell.readShortcutLink> | undefined
  if(/\.lnk$/i.test(path)) {
    try { shortcut=shell.readShortcutLink(path) } catch { /* Windows can still supply an icon for an unresolved shortcut. */ }
  }
  if(process.platform==='win32' && shortcut) {
    const resources=[{path:shortcut.icon,index:shortcut.iconIndex ?? 0}, {path:shortcut.target,index:0}]
    for(const resource of resources) {
      if(!resource.path) continue
      try {
        const dataUrl=await shellFileIcon(resource.path,resource.index)
        if(visibleImage(nativeImage.createFromDataURL(dataUrl))) return dataUrl
      } catch { /* Preserve the shell lookup when a custom resource no longer exists. */ }
    }
  }
  if(process.platform==='win32' && /\.url$/i.test(path)) {
    try {
      const resource=internetShortcutIcon(await readFile(path,'utf8'))
      if(resource) {
        const dataUrl=await shellFileIcon(resource.path,resource.index)
        if(visibleImage(nativeImage.createFromDataURL(dataUrl))) return dataUrl
      }
    } catch { /* Missing internet-shortcut resources fall back to the Windows shell icon. */ }
  }
  if(process.platform==='win32' && /\.(lnk|url)$/i.test(path)) {
    try {
      const dataUrl=await shellFileIcon(path)
      if(visibleImage(nativeImage.createFromDataURL(dataUrl))) return dataUrl
    } catch { /* Fall back to Electron when the shell icon is unavailable. */ }
  }
  const candidates=[path]
  if(shortcut?.target) candidates.push(shortcut.target)
  for(const candidate of candidates) {
    try { const image=await app.getFileIcon(candidate,{size:'normal'}); if(visibleImage(image)) return image.toDataURL() } catch { /* Try the next source. */ }
  }
  throw new Error('未读取到可见图标')
}
export function readFileIcon(path: string): Promise<string> {
  const existing=cache.get(path)
  if(existing) return existing
  const loading=loadFileIcon(path).then(icon => {
    lastGood.set(path,icon)
    if(lastGood.size>512) lastGood.delete(lastGood.keys().next().value!)
    return icon
  }).catch(error => {
    if(cache.get(path)===loading) cache.delete(path)
    const previous=lastGood.get(path)
    if(previous) return previous
    throw error
  })
  cache.set(path,loading)
  if(cache.size>512) cache.delete(cache.keys().next().value!)
  return loading
}
export function clearFileIcons(): void { cache.clear() }
export function invalidateFileIcon(path: string): void { cache.delete(path) }
