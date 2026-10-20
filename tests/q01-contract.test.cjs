const assert = require('node:assert/strict')
const test = require('node:test')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function staticAudit() {
  const result = spawnSync(process.execPath, ['tests/ipc-contract-audit.cjs'], {
    cwd: root,
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

test('预加载层的每个 invoke 通道都由主进程处理', () => {
  const audit = staticAudit()
  assert.deepEqual(audit.ipc.missingHandlers, [])
  assert.deepEqual(audit.ipc.unusedHandlers, [])
  assert.ok(audit.ipc.invoked.length > 0)
  assert.equal(audit.ipc.invoked.length, audit.ipc.handled.length)
})

test('产品源码不包含模拟实现标记或第三方搜索程序残留', () => {
  const audit = staticAudit()
  assert.deepEqual(audit.suspicious, [])
  assert.deepEqual(audit.everythingReferences, [])
})

test('冻结范围内不存在 CPU、内存或临时目录清理入口', () => {
  const relevantSources = [
    'src/main/index.ts',
    'src/main/system-services.ts',
    'src/preload/index.ts',
    'src/renderer/env.d.ts',
    'src/renderer/App.vue'
  ].map((relative) => fs.readFileSync(path.join(root, relative), 'utf8')).join('\n')
  assert.doesNotMatch(relevantSources, /system:clean|cleanTemporaryFiles|安全清理|立即清理|CPU[\s/]*内存优化/)
})

test('桌面助手仅呈现已确认的功能入口', () => {
  const source = ['src/renderer/App.vue','src/renderer/components/SettingsPanel.vue'].map(relative=>fs.readFileSync(path.join(root,relative),'utf8')).join('\n')
  assert.doesNotMatch(source, /文件搜索|系统增强|更新与支持|LocalTools|QuickSearchOverlay|CaptureOverlay/)
  for (const label of ['助手设置', '文件分类', '喝水提醒', '久坐提醒', '组件布局备份', '原桌面图标位置备份']) assert.ok(source.includes(label))
  const main = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8')
  assert.doesNotMatch(main, /startClipboardWatcher|clipboardTimer/)
})

test('Windows 发布配置显式携带本地托盘图标而非缺失资源回退', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const trayResource = manifest.build.extraResources.find((item) => item.from === 'resources/tray-icon.png' && item.to === 'tray-icon.png')
  assert.ok(trayResource)
  const icon = path.join(root, 'resources', 'tray-icon.png')
  assert.ok(fs.existsSync(icon))
  assert.ok(fs.statSync(icon).size > 0)
})
