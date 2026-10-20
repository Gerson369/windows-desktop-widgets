import type { DesktopScanItem } from './types'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import { classifyDesktopItem } from './desktop-categories'
import { stat } from 'node:fs/promises'
const run = promisify(execFile)

export interface ShellDesktopItem extends DesktopScanItem { displayName: string }

export async function isDesktopInventoryCurrent(items: ShellDesktopItem[]): Promise<boolean> {
  const checks = await Promise.all(items.filter(item => !item.path.startsWith('shell:')).map(async item => {
    try { return new Date((await stat(item.path)).mtimeMs).toISOString() === item.modifiedAt }
    catch { return false }
  }))
  return checks.every(Boolean)
}

export async function readShellDesktopItems(createdAt: string): Promise<ShellDesktopItem[]> {
  const command = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $ErrorActionPreference = 'Stop'; $shell = New-Object -ComObject Shell.Application; $desktop = $shell.Namespace(0); if (!$desktop) { throw 'Desktop namespace is unavailable' }; $items = @($desktop.Items() | ForEach-Object { [pscustomobject]@{ Path = $_.Path; Name = $_.Name; IsDirectory = $_.IsFolder } }); ConvertTo-Json -Compress -InputObject $items`
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const rows: unknown = JSON.parse(stdout.trim())
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Windows 桌面项目清单无效。')
  return Promise.all(rows.map(async (row: unknown) => {
    const value = row as { Path?: unknown; Name?: unknown; IsDirectory?: unknown }
    if (!value || typeof value.Path !== 'string' || !value.Path || typeof value.Name !== 'string') throw new Error('Windows 桌面项目不完整。')
    const system = /^::\{[0-9a-f-]{36}\}(?:\\.*)?$/i.test(value.Path)
    if (!system && !/^(?:[a-z]:\\|\\\\)/i.test(value.Path)) throw new Error('Windows 桌面项目路径无效。')
    const path = system ? `shell:${value.Path}` : value.Path
    const isDirectory = value.IsDirectory === true
    const name = system ? value.Name : basename(path)
    const item = { path, name, displayName: value.Name, extension: system ? '' : name.split('.').slice(1).pop()?.toLowerCase() || '', category: system ? 'system' : classifyDesktopItem(name, isDirectory), isDirectory, createdAt, modifiedAt: createdAt } as ShellDesktopItem
    if (!system) {
      try {
        const info = await stat(path, { bigint: true })
        if (info.ino !== 0n) item.identity = `${info.dev}:${info.ino}`
        item.modifiedAt = new Date(Number(info.mtimeMs)).toISOString()
      } catch { /* A final desktop coverage check handles entries removed during enumeration. */ }
    }
    return item
  }))
}
