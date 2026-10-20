const assert = require('node:assert/strict')
const { promises: fs } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { app } = require('electron')

const root = join(tmpdir(), `gerson-master-store-${Date.now()}`)
const userData = join(root, 'userData')
const custom = join(root, 'custom-data')

async function main() {
  app.setPath('userData', userData)
  app.setPath('home', root)
  app.setPath('downloads', join(root, 'Downloads'))
  await app.whenReady()
  const modulePath = process.env.MASTER_STORE_MODULE || '../.master-store-test/store.cjs'
  const { DataStore } = require(modulePath)
  try {
    const corruptDirectory = join(userData, 'data')
    const corruptFile = join(corruptDirectory, 'toolbox-data.json')
    await fs.mkdir(corruptDirectory, { recursive: true })
    await fs.writeFile(corruptFile, '{ definitely not valid JSON', 'utf8')
    const recovered = new DataStore()
    const recoveredData = await recovered.init()
    const namesAfterRecovery = await fs.readdir(corruptDirectory)
    assert.ok(namesAfterRecovery.some((name) => /^toolbox-data\.json\.corrupt-\d+\.json$/.test(name)), '损坏 JSON 原件未保留为带时间戳副本。')
    assert.ok(Array.isArray(recoveredData.todos) && Array.isArray(recoveredData.notes), '损坏数据恢复后未产生完整默认 schema。')

    const partialFile = join(root, 'partial.json')
    await fs.writeFile(partialFile, JSON.stringify({ settings: { desktopModuleOpacity: 999, desktopHoverCollapseDelay: 1, desktopIconAutoSortEnabled: 'true' }, todos: [{ id: 'safe', title: '保留待办', completed: false }] }), 'utf8')
    const imported = await recovered.importFrom(partialFile)
    assert.equal(imported.settings.desktopModuleOpacity, 100, '部分导入的透明度未钳制。')
    assert.equal(imported.settings.desktopHoverCollapseDelay, 180, '部分导入的悬停延迟未钳制。')
    assert.equal(imported.settings.desktopIconAutoSortEnabled, false, '非布尔自动排列设置未安全关闭。')
    assert.ok(Array.isArray(imported.mappings) && Array.isArray(imported.desktopModules), '部分导入缺少默认集合。')
    assert.equal(imported.todos[0].title, '保留待办', '有效待办未从部分导入保留。')

    const beforeInvalid = JSON.stringify(recovered.data)
    const invalidFile = join(root, 'invalid.json')
    await fs.writeFile(invalidFile, JSON.stringify({ settings: 'bad', todos: {} }), 'utf8')
    await assert.rejects(() => recovered.importFrom(invalidFile), /有效的桌面工具箱配置文件/)
    assert.equal(JSON.stringify(recovered.data), beforeInvalid, '无效导入改变了当前内存数据。')

    const fuzzDirectory = join(root, 'fuzz-data')
    await fs.mkdir(fuzzDirectory, { recursive: true })
    await fs.writeFile(join(fuzzDirectory, 'toolbox-data.json'), JSON.stringify({
      settings: { panelWidth: 'not-a-number', panelHeight: {}, panelMode: 'unexpected', panelOpacity: -5, panelColor: 'bad', desktopModeEnabled: true, shortcuts: [{ action: 'evil', accelerator: 42, enabled: 'yes' }] },
      todos: ['bad', null, { id: 'dup', title: '安全条目', categoryId: 'work', completed: false, createdAt: '2020-01-01T00:00:00.000Z', order: 0 }, { id: 'dup', title: '重复标识', categoryId: 'work', completed: false, createdAt: '2020-01-01T00:00:00.000Z', order: 1 }],
      favorites: [null, 'bad'], notes: [{ id: 'note-bad', title: 42, content: ['bad'], color: null, pinned: 'yes', updatedAt: null }], clipboardHistory: ['bad', null, { id: 'clip', type: 'image', imageDataUrl: 'x'.repeat(5000000) }],
      desktopModules: [{ id: 'bad', kind: 'evil', visible: true, collapsed: false, x: 'x', y: null, width: -1, height: {} }], desktopZones: [{ id: 'zone', name: 42, color: 'bad', opacity: 999, visible: 'yes', collapsed: null, locked: null, x: 'x', y: 'y', width: -2, height: {}, itemIds: 'bad' }],
      organizerRules: [{ id: 'rule', enabled: true, extensions: 'txt', targetType: 'folder', targetPath: 4, priority: 'bad' }], mappings: [null], iconLayouts: [null], storageItems: [null], inboxItems: [null], fileOperations: [null], recentFiles: [null]
    }), 'utf8')
    const fuzzStore = new DataStore()
    const fuzz = await fuzzStore.init(fuzzDirectory)
    assert.ok(fuzz.todos.every((item) => item && typeof item === 'object' && typeof item.id === 'string'), '错误 Todo 元素未在启动时安全过滤。')
    assert.ok(fuzz.favorites.every((item) => item && typeof item === 'object' && typeof item.id === 'string'), '错误收藏元素未在启动时安全过滤。')
    assert.ok(fuzz.desktopModules.every((item) => item && item.kind !== 'evil'), '错误桌面模块未被安全替换或过滤。')
    assert.ok(Number.isFinite(fuzz.settings.panelWidth) && Number.isFinite(fuzz.settings.panelHeight), '错误面板尺寸会在启动后保留。')
    assert.ok(fuzz.settings.panelMode === 'floating' || fuzz.settings.panelMode === 'edge' || fuzz.settings.panelMode === 'pinned', '错误面板模式未恢复默认。')

    const exportFile = join(root, 'exports', 'toolbox.json')
    await recovered.exportTo(exportFile)
    assert.ok((await fs.stat(exportFile)).size > 0, '导出文件为空。')
    const moved = await recovered.moveDataDirectory(custom)
    assert.equal(moved.settings.dataDirectory, custom, '迁移后未记录自定义数据目录。')
    assert.ok((await fs.stat(join(custom, 'toolbox-data.json'))).size > 0, '迁移目标未写入数据文件。')
    assert.ok((await fs.stat(exportFile)).size > 0, '迁移不应破坏先前导出。')
    console.log(JSON.stringify({ ok: true, root, checks: ['corrupt-json-preserved-and-recovered', 'partial-schema-normalized', 'invalid-import-rejected-without-state-change', 'export-nonempty', 'move-data-copies-and-rebinds', 'malformed-module-data-does-not-block-startup'] }, null, 2))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    app.quit()
  }
}
main().catch((error) => { console.error(error.stack || error.message || String(error)); app.quit(); process.exitCode = 1 })
