import { execFile } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
const run = promisify(execFile)

export function renamedFilePath(source: string, name: string): string {
  if (!isAbsolute(source) || !name || name !== name.trim() || name.length > 255 || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) throw new Error('名称无效，请使用不含特殊字符的文件名。')
  const extension = extname(source)
  const targetName = /^\.(lnk|url)$/i.test(extension) && !name.toLowerCase().endsWith(extension.toLowerCase()) ? name + extension : name
  if (targetName.length > 255) throw new Error('文件名过长。')
  return join(dirname(source), targetName)
}

/** File.Move and Directory.Move refuse an existing destination on Windows. */
export async function renameCollectedFile(source: string, name: string): Promise<string> {
  const target = renamedFilePath(source, name)
  if (source === target) return target
  await lstat(source)
  if (source.toLowerCase() !== target.toLowerCase()) {
    try { await lstat(target); throw new Error('同名项目已存在，未覆盖任何文件。') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const command = "$ErrorActionPreference='Stop'; if ([System.IO.Directory]::Exists($env:GERSON_RENAME_SOURCE)) { [System.IO.Directory]::Move($env:GERSON_RENAME_SOURCE,$env:GERSON_RENAME_TARGET) } else { [System.IO.File]::Move($env:GERSON_RENAME_SOURCE,$env:GERSON_RENAME_TARGET) }"
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, env: { ...process.env, GERSON_RENAME_SOURCE: source, GERSON_RENAME_TARGET: target }
    })
  } catch { throw new Error(`无法重命名“${basename(source)}”，请检查同名文件、占用或访问权限。`) }
  return target
}
