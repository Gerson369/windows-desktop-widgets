const assert = require('node:assert/strict')
const { promises: fs } = require('node:fs')
const { join, basename } = require('node:path')
const { tmpdir } = require('node:os')
const { app } = require('electron')

const root = join(tmpdir(), `gerson-master-organizer-${Date.now()}`)
const outside = join(tmpdir(), `gerson-master-outside-${Date.now()}`)
const now = new Date().toISOString()
const makeRule = (overrides) => ({ id: `rule-${Math.random().toString(36).slice(2)}`, name: 'test rule', enabled: true, extensions: [], targetType: 'folder', priority: 0, createdAt: now, ...overrides })

async function exists(path) { try { await fs.access(path); return true } catch { return false } }

async function main() {
  await app.whenReady()
  app.setPath('desktop', root)
  const modulePath = process.env.MASTER_ORGANIZER_MODULE || '../.master-organizer-test/organizer-services.cjs'
  const organizer = require(modulePath)
  try {
    const docs = join(root, '文档')
    const archive = join(root, '压缩包')
    await fs.mkdir(root, { recursive: true })
    await fs.mkdir(docs)
    await fs.mkdir(archive)
    const pdf = join(root, '报告 中文 😀.pdf')
    const txt = join(root, '待整理 text.txt')
    const zip = join(root, '资料.zip')
    const noExtension = join(root, '无扩展名')
    const hidden = join(root, '.hidden-file.txt')
    const collision = join(root, '冲突.txt')
    const conflictTarget = join(docs, '冲突.txt')
    const folder = join(root, '保留文件夹')
    await Promise.all([
      fs.writeFile(pdf, 'pdf'), fs.writeFile(txt, 'txt'), fs.writeFile(zip, 'zip'), fs.writeFile(noExtension, 'none'), fs.writeFile(hidden, 'hidden'), fs.writeFile(collision, 'source'), fs.writeFile(conflictTarget, 'existing target'), fs.mkdir(folder)
    ])
    const initialPaths = [pdf, txt, zip, noExtension, hidden, collision]
    const data = {
      settings: {}, favorites: [], todos: [], categories: [], storageItems: [], mappings: [], notes: [], clipboardHistory: [], iconLayouts: [], desktopModules: [], desktopZones: [{ id: 'zone-safe', name: 'Virtual zone', color: '#6d8cff', opacity: 28, visible: true, collapsed: false, locked: false, x: 0, y: 0, width: 320, height: 184, itemIds: [], createdAt: now }], inboxItems: [], fileOperations: [], recentFiles: [],
      organizerRules: [
        makeRule({ id: 'priority-doc', name: 'Docs first', extensions: ['pdf', 'txt'], targetPath: docs, priority: 0 }),
        makeRule({ id: 'priority-later', name: 'Later text', extensions: ['txt'], targetPath: archive, priority: 1 }),
        makeRule({ id: 'zip-zone', name: 'Zip virtual', extensions: ['zip'], targetType: 'zone', targetId: 'zone-safe', priority: 2 }),
        makeRule({ id: 'escape', name: 'Escape blocked', extensions: [''], nameIncludes: '无扩展名', targetPath: join(root, '..', '..', basename(outside)), priority: 3 })
      ]
    }
    const beforePreview = await Promise.all(initialPaths.map(exists))
    const preview = await organizer.previewOrganization(data)
    const afterPreview = await Promise.all(initialPaths.map(exists))
    assert.deepEqual(afterPreview, beforePreview, '预览发生了文件写入或移动。')
    const itemFor = (path) => preview.items.find((item) => item.sourcePath.toLowerCase() === path.toLowerCase())
    assert.equal(itemFor(pdf).status, 'planned', 'PDF 预览未进入计划。')
    assert.equal(itemFor(pdf).targetPath, join(docs, '报告 中文 😀.pdf'), '高优先级规则没有决定 PDF 目标。')
    assert.equal(itemFor(txt).targetPath, join(docs, '待整理 text.txt'), '重叠规则没有保持确定的优先级。')
    assert.equal(itemFor(collision).status, 'skipped', '预览未提前显示同名目标冲突。')
    assert.match(itemFor(collision).reason, /目标已存在/, '同名目标冲突原因不明确。')
    assert.equal(itemFor(zip).action, 'assign', '虚拟分区规则没有保持与文件移动分离。')
    assert.equal(itemFor(noExtension).status, 'skipped', '越界目标规则没有在预览中阻止。')
    assert.match(itemFor(noExtension).reason, /桌面目录内/, '越界目标缺少受控目录原因。')

    const record = await organizer.executeOrganization(data, preview)
    assert.ok(await exists(join(docs, '报告 中文 😀.pdf')), '执行没有移动已预览 PDF。')
    assert.ok(await exists(join(docs, '待整理 text.txt')), '执行没有移动已预览 TXT。')
    assert.ok(await exists(collision), '同名冲突源文件被意外移动。')
    assert.equal(await fs.readFile(conflictTarget, 'utf8'), 'existing target', '同名目标被静默覆盖。')
    assert.ok(await exists(zip), '虚拟分区规则移动了真实文件。')
    assert.ok(data.desktopZones[0].itemIds.includes(zip), '虚拟分区没有记录文件引用。')
    assert.ok(record.items.every((item) => initialPaths.includes(item.sourcePath)), '执行了预览范围外的文件。')

    const repeatedPreview = await organizer.previewOrganization(data)
    const second = await organizer.executeOrganization(data, repeatedPreview)
    assert.ok(second.items.every((item) => item.status === 'skipped'), '重复执行在源文件已移动后产生不稳定修改。')
    const rollback = await organizer.revertOperation(record)
    assert.ok(await exists(pdf) && await exists(txt), '回退没有恢复原始文件。')
    assert.ok(!(await exists(join(docs, '报告 中文 😀.pdf'))) && !(await exists(join(docs, '待整理 text.txt'))), '回退后目标仍残留。')
    assert.ok(await exists(collision) && await exists(noExtension) && await exists(zip), '回退触及无关或受保护文件。')
    const revertedCount = rollback.items.filter((item) => item.status === 'reverted').length
    assert.ok(revertedCount === 3, `回退的已移动文件数量不正确：${revertedCount}; ${JSON.stringify(rollback.items)}`)

    const toctouPreviewSource = join(root, '确认预览中的文件.txt')
    const toctouLateSource = join(root, '预览后新增文件.txt')
    await fs.writeFile(toctouPreviewSource, 'planned before confirmation')
    const toctouPreview = await organizer.previewOrganization(data)
    assert.ok(toctouPreview.items.some((item) => item.sourcePath === toctouPreviewSource && item.status === 'planned'), 'TOCTOU 夹具未出现在确认预览中。')
    await fs.writeFile(toctouLateSource, 'must remain outside confirmed preview')
    const toctouRecord = await organizer.executeOrganization(data, toctouPreview)
    assert.ok(await exists(join(docs, '确认预览中的文件.txt')), '确认预览中的文件未被执行。')
    assert.ok(await exists(toctouLateSource), '预览后新增、未列入计划的文件被额外移动。')
    assert.ok(!toctouRecord.items.some((item) => item.sourcePath === toctouLateSource), '执行记录包含预览范围外的新增文件。')
    await organizer.revertOperation(toctouRecord)

    const renameOne = join(root, 'rename one.txt')
    const renameTwo = join(root, 'rename two.txt')
    const renameCollision = join(root, 'Batch-02.txt')
    await Promise.all([fs.writeFile(renameOne, 'one'), fs.writeFile(renameTwo, 'two'), fs.writeFile(renameCollision, 'occupied')])
    const invalidRename = await organizer.previewBatchRename([renameOne], '../escape', 1)
    assert.equal(invalidRename.items[0].status, 'skipped', '非法重命名前缀没有阻止。')
    const renamePlan = await organizer.previewBatchRename([renameOne, renameTwo, renameOne, join(outside, 'unrelated.txt')], 'Batch', 1)
    assert.equal(renamePlan.items.length, 2, '批量重命名没有去重或过滤桌面外路径。')
    assert.equal(renamePlan.items[0].status, 'planned', '首个批量重命名未计划。')
    assert.equal(renamePlan.items[1].status, 'skipped', '已有目标名未在预览中跳过。')
    const renameFirstTarget = join(root, 'Batch-01.txt')
    await fs.writeFile(renameFirstTarget, 'appeared after preview')
    const renameRecord = await organizer.executeBatchRename([renameOne, renameTwo], 'Batch', 1, renamePlan)
    assert.ok(await exists(renameOne), '确认后出现目标时源文件被意外改名。')
    assert.ok(await exists(renameTwo), '冲突重命名源文件被意外改名。')
    assert.equal(await fs.readFile(renameFirstTarget, 'utf8'), 'appeared after preview', '批量重命名覆盖了预览后出现的目标。')
    assert.equal(await fs.readFile(renameCollision, 'utf8'), 'occupied', '批量重命名覆盖了已有目标。')
    assert.equal(renameRecord.items.filter((item) => item.status === 'completed').length, 0, '确认后出现目标仍被重命名。')

    console.log(JSON.stringify({ ok: true, root, checks: ['preview-no-write', 'priority-determinism', 'preview-apply-consistency', 'no-unlisted-move', 'no-silent-overwrite', 'path-escape-blocked', 'virtual-zone-file-separation', 'repeat-stability', 'rollback-isolation', 'rename-validation', 'rename-no-overwrite', 'confirmed-preview-toctou-isolation', 'revalidate-target-before-rename'] }, null, 2))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
    app.quit()
  }
}
main().catch((error) => { console.error(error.stack || error.message || String(error)); app.quit(); process.exitCode = 1 })
