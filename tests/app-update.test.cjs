const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { Readable } = require('node:stream')
const { tmpdir } = require('node:os')
const { loadTypeScript } = require('./load-typescript.cjs')
const { checkForAppUpdate, createUpdateFetcher, downloadAppUpdate } = loadTypeScript('src/main/app-update.ts')

const version = '2.10.0'
const bytes = Buffer.from('download fixture')
const digest = createHash('sha256').update(bytes).digest('hex')
const name = edition => `windows-desktop-widgets-${version}-x64-${edition}.exe`
const url = edition => `https://github.com/Gerson369/windows-desktop-widgets/releases/download/v${version}/${name(edition)}`
function releaseEntry(edition) {
  return { name: name(edition), state: 'uploaded', browser_download_url: url(edition), size: bytes.length, digest: 'sha256:' + digest }
}
function check(current, edition, overrides = {}) {
  return checkForAppUpdate(current, edition, async (endpoint, options) => {
    assert.equal(endpoint, 'https://api.github.com/repos/Gerson369/windows-desktop-widgets/releases/latest')
    assert.equal(options.redirect, 'error')
    return Response.json({ tag_name: 'v' + version, draft: false, prerelease: false, assets: [releaseEntry('setup'), releaseEntry('portable')], ...overrides })
  })
}

test('stable check compares numeric versions and selects the current Windows edition', async () => {
  assert.equal(await check(version, 'setup'), null)
  assert.equal(await check('3.0.0', 'portable'), null)
  for (const edition of ['setup', 'portable']) {
    const asset = await check('2.9.19', edition)
    assert.deepEqual(asset, { version, edition, name: name(edition), size: bytes.length, url: url(edition), sha256: digest })
  }
})

test('invalid release, other edition, unsafe URL and missing digest cannot offer an update', async () => {
  const entry = releaseEntry('setup')
  for (const overrides of [{ draft: true }, { prerelease: true }, { tag_name: 'v2.10.0-beta.1' },
    { assets: [releaseEntry('portable')] }, { assets: [{ ...entry, state: 'starter' }] },
    { assets: [{ ...entry, digest: null }] }, { assets: [{ ...entry, browser_download_url: 'https://example.org/file' }] }]) {
    await assert.rejects(check('2.9.0', 'setup', overrides))
  }
  await assert.rejects(checkForAppUpdate('2.9.0', 'setup', async () => new Response('', { status: 403 })), /限制访问（403）/)
  await assert.rejects(checkForAppUpdate('2.9.0', 'setup', async () => { throw new Error('ERR_NETWORK_CHANGED') }), /请检查网络/)
})

test('parallel validated downloads use independent staging files and report bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gerson-update-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const asset = await check('2.9.0', 'portable')
  const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/file'
  const progress = []
  async function fetcher(address, options) {
    assert.equal(options.redirect, 'manual')
    if (address === asset.url) return Response.redirect(cdn)
    assert.equal(address, cdn)
    return new Response(bytes)
  }
  const [first, second] = await Promise.all([
    downloadAppUpdate(asset, directory, fetcher, (value, total) => progress.push([value, total])),
    downloadAppUpdate(asset, directory, fetcher)
  ])
  assert.notEqual(first, second)
  assert.deepEqual(await readFile(first), bytes)
  assert.deepEqual(await readFile(second), bytes)
  assert.deepEqual(progress.at(-1), [bytes.length, bytes.length])
})

test('Electron transport exposes a manual redirect and streams the response from the approved host', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gerson-update-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const asset = await check('2.9.0', 'portable')
  const cdn = 'https://release-assets.githubusercontent.com/file'
  const requested = []
  const fetcher = createUpdateFetcher({
    request(options) {
      const request = new EventEmitter()
      requested.push(options.url)
      assert.equal(options.redirect, 'manual')
      request.end = () => {
        if (options.url === asset.url) {
          request.emit('redirect', 302, 'GET', cdn)
          request.emit('error', new Error('Redirect was cancelled'))
        } else {
          const response = Readable.from([bytes])
          response.statusCode = 200
          request.emit('response', response)
          response.once('end', () => request.emit('close'))
        }
      }
      return request
    }
  })
  const file = await downloadAppUpdate(asset, directory, fetcher)
  assert.deepEqual(requested, [asset.url, cdn])
  assert.deepEqual(await readFile(file), bytes)
})

test('untrusted redirect, broken connection, short, long and corrupt files leave no executable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gerson-update-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const asset = await check('2.9.0', 'setup')
  for (const fetcher of [
    () => Response.redirect('https://release-assets.githubusercontent.com.example.org/file'),
    () => Response.redirect('http://release-assets.githubusercontent.com/file'),
    () => Response.redirect('https://user@release-assets.githubusercontent.com/file'),
    () => new Response('missing', { status: 404 }),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection lost')) } })),
    () => new Response('short'), () => new Response(Buffer.alloc(bytes.length + 1)), () => new Response(Buffer.alloc(bytes.length))
  ]) {
    await assert.rejects(downloadAppUpdate(asset, directory, fetcher))
    assert.deepEqual(await readdir(directory), [])
  }
  await assert.rejects(downloadAppUpdate({ ...asset, name: '../unsafe.exe' }, directory, () => new Response(bytes)))
})
