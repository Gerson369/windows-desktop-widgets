const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

const helperSource = path.resolve(__dirname, '../native/UpdateHelper/Program.cs')
const windows = process.platform === 'win32'

test('Windows handoff waits for the old process, launches the matching edition and cleans its download', { skip: !windows }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "桌面更新 空格'&-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const fixture = path.join(root, 'fixture.exe')
  const source = path.join(root, 'Launcher.cs')
  fs.writeFileSync(source, `
using System;
using System.Diagnostics;
using System.IO;
class Launcher {
    static int Main() {
        string trigger = Environment.GetEnvironmentVariable("UPDATE_TEST_TRIGGER");
        if (File.Exists(trigger)) {
            File.Delete(trigger);
            Process child = Process.Start(Environment.GetEnvironmentVariable("UPDATE_TEST_NODE"),
                "\\\"" + Environment.GetEnvironmentVariable("UPDATE_TEST_CHILD") + "\\\"");
            child.WaitForExit();
            return child.ExitCode;
        }
        File.WriteAllText(Environment.GetEnvironmentVariable("UPDATE_TEST_RESULT"),
            Process.GetCurrentProcess().MainModule.FileName);
        return 0;
    }
}`.trim())
  const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  execFileSync(compiler, ['/nologo', '/target:winexe', '/out:' + fixture, source], { windowsHide: true })
  const resources = path.join(root, 'resources')
  const native = path.join(resources, 'native')
  fs.mkdirSync(native, { recursive: true })
  execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll',
    '/out:' + path.join(native, 'GersonUpdateHelper.exe'), helperSource], { windowsHide: true })
  const child = path.join(root, 'handoff.cjs')
  fs.writeFileSync(child, `
    const { loadTypeScript } = require(${JSON.stringify(require.resolve('./load-typescript.cjs'))})
    const { startAppUpdateInstall } = loadTypeScript('src/main/app-update-install.ts')
    startAppUpdateInstall({
      downloadPath: process.env.UPDATE_TEST_DOWNLOAD,
      portablePath: process.env.UPDATE_TEST_PORTABLE || undefined,
      resourcesPath: ${JSON.stringify(resources)}
    }).catch(error => { require('node:fs').writeFileSync(process.env.UPDATE_TEST_RESULT, error.stack); process.exitCode = 1 })
  `)
  for (const portable of [true, false]) {
    const downloadDir = fs.mkdtempSync(path.join(root, 'download-'))
    const download = path.join(downloadDir, 'update.exe')
    fs.copyFileSync(fixture, download)
    fs.appendFileSync(download, 'new release')
    const expected = fs.readFileSync(download)
    const launcher = path.join(root, '正在使用 [桌面].exe')
    if (portable) fs.copyFileSync(fixture, launcher)
    const result = path.join(root, portable ? 'portable-result' : 'installer-result')
    const trigger = path.join(root, 'start-child')
    if (portable) fs.writeFileSync(trigger, '')
    if (!portable) {
      const cache = path.join(root, 'gerson-update-helpers')
      const cached = fs.readdirSync(cache)
      assert.equal(cached.length, 1)
      fs.writeFileSync(path.join(cache, cached[0]), 'interrupted old cache')
    }
    const env = { ...process.env, TEMP: root, TMP: root, UPDATE_TEST_NODE: process.execPath, UPDATE_TEST_CHILD: child,
      UPDATE_TEST_DOWNLOAD: download, UPDATE_TEST_PORTABLE: portable ? launcher : '',
      UPDATE_TEST_RESULT: result, UPDATE_TEST_TRIGGER: trigger }
    try {
      execFileSync(portable ? launcher : process.execPath, portable ? [] : [child],
        { env, windowsHide: true, timeout: 30_000 })
    } catch (error) {
      if (fs.existsSync(result)) throw new Error(fs.readFileSync(result, 'utf8'))
      throw error
    }
    const deadline = Date.now() + 15_000
    while ((!fs.existsSync(result) || fs.existsSync(downloadDir)) && Date.now() < deadline) await delay(100)
    assert.equal(fs.readFileSync(result, 'utf8'), portable ? launcher : download)
    assert.equal(fs.existsSync(downloadDir), false)
    if (portable) assert.deepEqual(fs.readFileSync(launcher), expected)
  }
})

test('portable launch failure restores the original executable', { skip: !windows }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gerson-rollback-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const old = path.join(root, 'old.exe')
  const next = path.join(root, 'new.exe')
  const backup = path.join(root, 'backup')
  fs.writeFileSync(old, 'previous release')
  fs.writeFileSync(next, 'invalid executable')
  const source = path.join(root, 'Rollback.cs')
  fs.writeFileSync(source, `
    class Rollback {
      static int Main(string[] args) {
        var replace = typeof(Program).GetMethod("ReplacePortable",
          System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        try { replace.Invoke(null, new object[] { args[0], args[1], args[2] }); }
        catch (System.Reflection.TargetInvocationException error) {
          return error.InnerException is System.ComponentModel.Win32Exception ? 0 : 1;
        }
        return 2;
      }
    }`)
  const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const driver = path.join(root, 'rollback.exe')
  execFileSync(compiler, ['/nologo', '/target:winexe', '/main:Rollback', '/reference:System.Windows.Forms.dll',
    '/out:' + driver, helperSource, source], { windowsHide: true })
  execFileSync(driver, [next, old, backup], { windowsHide: true, timeout: 10_000 })
  assert.equal(fs.readFileSync(old, 'utf8'), 'previous release')
  assert.equal(fs.readFileSync(next, 'utf8'), 'invalid executable')
  assert.equal(fs.existsSync(backup), false)
})
