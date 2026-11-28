import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const repository = 'Gerson369/windows-desktop-widgets'
const latestRelease = `https://api.github.com/repos/${repository}/releases/latest`
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const assetHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
const maxPackageSize = 512 * 1024 * 1024

export type UpdateEdition = 'setup' | 'portable'
export type UpdateFetch = (url: string, init: RequestInit) => Promise<Response>
export interface UpdateAsset {
  version: string
  edition: UpdateEdition
  name: string
  url: string
  size: number
  sha256: string
}

export function createUpdateFetcher(net: Pick<Electron.Net, 'request' | 'fetch'>): UpdateFetch {
  return (url, init) => {
    if (init.redirect !== 'manual') return net.fetch(url, init)
    // Electron 33's net.fetch rejects manual redirects without exposing Location.
    return new Promise<Response>((resolveResponse, reject) => {
      init.signal?.throwIfAborted()
      const request = net.request({ url, redirect: 'manual', credentials: 'omit', cache: 'no-store' })
      const abort = () => { request.abort(); reject(new Error('下载已超时，请重试。')) }
      init.signal?.addEventListener('abort', abort, { once: true })
      request.once('close', () => init.signal?.removeEventListener('abort', abort))
      request.on('error', reject)
      request.once('redirect', (status, _method, location) => {
        resolveResponse(new Response(null, { status, headers: { location } }))
      })
      request.once('response', response => {
        if (!(response instanceof Readable)) {
          request.abort()
          reject(new Error('无法读取更新文件。'))
          return
        }
        if (response.statusCode !== 200) {
          resolveResponse(new Response(null, { status: response.statusCode }))
          request.abort()
          return
        }
        resolveResponse(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>))
      })
      request.end()
    })
  }
}

function versionParts(version: string): number[] {
  const parts = version.split('.').map(Number)
  if (!stableVersion.test(version) || !parts.every(Number.isSafeInteger)) throw new Error('版本号格式无效。')
  return parts
}

function isNewer(candidate: string, current: string): boolean {
  const next = versionParts(candidate)
  const installed = versionParts(current)
  const difference = next.findIndex((part, index) => part !== installed[index])
  return difference !== -1 && next[difference] > installed[difference]
}

function packageName(version: string, edition: UpdateEdition): string {
  return `windows-desktop-widgets-${version}-x64-${edition}.exe`
}

function packageUrl(version: string, name: string): string {
  return `https://github.com/${repository}/releases/download/v${version}/${name}`
}

function validAsset(asset: UpdateAsset): boolean {
  return stableVersion.test(asset.version) && ['setup', 'portable'].includes(asset.edition)
    && asset.name === packageName(asset.version, asset.edition) && asset.url === packageUrl(asset.version, asset.name)
    && /^[0-9a-f]{64}$/.test(asset.sha256) && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maxPackageSize
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function networkFailure(signal: AbortSignal, cause: unknown): Error {
  return new Error(signal.aborted ? '连接 GitHub 超时，请稍后重试。' : '无法连接 GitHub，请检查网络后重试。', { cause })
}

function httpFailure(status: number): Error {
  if (status === 429 || status === 403) return new Error(`GitHub 暂时限制访问（${status}），请稍后重试。`)
  return new Error(`访问 GitHub 失败（${status}），请稍后重试。`)
}

async function fetchResponse(fetcher: UpdateFetch, url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  try {
    return await fetcher(url, init)
  } catch (cause) {
    throw networkFailure(init.signal, cause)
  }
}

export async function checkForAppUpdate(currentVersion: string, edition: UpdateEdition, fetcher: UpdateFetch): Promise<UpdateAsset | null> {
  const signal = AbortSignal.timeout(20_000)
  const response = await fetchResponse(fetcher, latestRelease, {
    redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Gerson-Desktop-Widgets' }
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw httpFailure(response.status)
  }
  const release: unknown = await response.json().catch(cause => {
    if (cause instanceof SyntaxError) throw new Error('GitHub 返回的版本信息无效，请稍后重试。')
    throw networkFailure(signal, cause)
  })
  if (!record(release) || release.draft !== false || release.prerelease !== false ||
      typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) throw new Error('未取得有效的正式发布版本。')
  const version = release.tag_name.slice(1)
  if (!isNewer(version, currentVersion)) return null
  const name = packageName(version, edition)
  const entry = Array.isArray(release.assets) && release.assets.find(item => record(item) && item.name === name)
  if (!record(entry) || entry.state !== 'uploaded' || typeof entry.browser_download_url !== 'string' ||
      typeof entry.size !== 'number' || typeof entry.digest !== 'string' || !entry.digest.startsWith('sha256:')) {
    throw new Error('新版尚未提供对应的更新包或 SHA-256 校验值，请稍后重试。')
  }
  const asset = { version, edition, name, size: entry.size, url: entry.browser_download_url, sha256: entry.digest.slice(7) }
  if (!validAsset(asset)) throw new Error('更新包信息无效，请稍后重试。')
  return asset
}

async function openDownload(asset: UpdateAsset, fetcher: UpdateFetch, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  let url = asset.url
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchResponse(fetcher, url, { signal, redirect: 'manual', credentials: 'omit', cache: 'no-store' })
    if (response.status === 200 && response.body) return response.body
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw httpFailure(response.status)
    const next = new URL(location, url)
    if (next.protocol !== 'https:' || next.port || next.username || next.password || !assetHosts.has(next.hostname)) {
      throw new Error('更新包跳转地址无效。')
    }
    url = next.href
  }
  throw new Error('下载更新时跳转次数过多。')
}

export async function downloadAppUpdate(asset: UpdateAsset, directory: string, fetcher: UpdateFetch,
  onProgress?: (received: number, total: number) => void): Promise<string> {
  if (!validAsset(asset)) throw new Error('更新包信息无效。')
  await mkdir(directory, { recursive: true })
  const staging = await mkdtemp(join(resolve(directory), 'update-'))
  const file = join(staging, asset.name)
  const signal = AbortSignal.timeout(15 * 60_000)
  try {
    const body = await openDownload(asset, fetcher, signal)
    const hash = createHash('sha256')
    let received = 0
    async function* checkedChunks() {
      const reader = body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read().catch(cause => { throw networkFailure(signal, cause) })
          if (done) break
          received += value.byteLength
          if (received > asset.size) throw new Error('下载文件大小与发布记录不符。')
          hash.update(value)
          yield value
          onProgress?.(received, asset.size)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
    await pipeline(checkedChunks(), createWriteStream(file, { flags: 'wx' }), { signal })
    if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('下载文件未通过完整性校验，请重新下载。')
    return file
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (signal.aborted) throw networkFailure(signal, error)
    throw error
  }
}
