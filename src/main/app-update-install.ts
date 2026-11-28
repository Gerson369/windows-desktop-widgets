import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

interface UpdateInstallPaths {
  downloadPath: string
  portablePath?: string
  resourcesPath: string
}

async function cachedUpdateHelper(resourcesPath: string): Promise<string> {
  // The portable launcher removes its extracted runtime when Electron exits.
  const bundled = await readFile(join(resourcesPath, 'native', 'GersonUpdateHelper.exe'))
  const digest = createHash('sha256').update(bundled).digest('hex')
  const cache = join(tmpdir(), 'gerson-update-helpers')
  const helper = join(cache, digest + '.exe')
  const cachedMatches = async () => (await readFile(helper).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  }))?.equals(bundled)
  if (await cachedMatches()) return helper

  await mkdir(cache, { recursive: true })
  const staged = join(cache, randomUUID() + '.tmp')
  try {
    await writeFile(staged, bundled, { flag: 'wx' })
    try {
      await rename(staged, helper)
    } catch (error) {
      // Windows can lock the verified helper if another update has already started it.
      if (!(await cachedMatches())) throw error
    }
    if (!(await cachedMatches())) throw new Error('更新助手校验失败。')
    return helper
  } finally {
    await rm(staged, { force: true })
  }
}

export async function startAppUpdateInstall({ downloadPath, portablePath, resourcesPath }: UpdateInstallPaths): Promise<void> {
  if (process.platform !== 'win32' || !isAbsolute(downloadPath) || !/\.exe$/i.test(downloadPath) ||
      (portablePath !== undefined && (!isAbsolute(portablePath) || !/\.exe$/i.test(portablePath)))) {
    throw new Error('无法确定 Windows 更新文件的位置。')
  }
  const directory = dirname(downloadPath)
  const helper = await cachedUpdateHelper(resourcesPath)
  const child = spawn(helper, [downloadPath, String(process.pid),
    ...(portablePath ? [portablePath, String(process.ppid)] : [])
  ], { cwd: dirname(helper), windowsHide: true, detached: true, stdio: 'ignore' })
  await once(child, 'spawn')
  child.unref()

  // A detached Windows process survives the portable launcher, but cannot acknowledge via stdout.
  const statusPath = join(directory, 'handoff.status')
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const status = await readFile(statusPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    if (status === 'ready') return
    if (status.startsWith('error: ')) throw new Error(status.slice(7))
    if (child.exitCode !== null || child.signalCode) throw new Error('Windows 更新助手未能启动。')
    await delay(100)
  }
  child.kill()
  throw new Error('启动更新助手超时，请重试。')
}
