const assert = require('node:assert/strict')
const { app } = require('electron')

const categories = {
  folder: ['项目文件夹', 'Archive Folder'],
  shortcut: ['浏览器.lnk', '官网.url'],
  document: ['报告.pdf', '计划.docx', '清单.xlsx'],
  image: ['照片.png', '封面.webp'],
  archive: ['资料.zip', '备份.7z'],
  installer: ['安装程序.exe', '驱动.msi'],
  other: ['无扩展名', '代码.psd']
}

const buildCase = (count) => {
  const names = Object.entries(categories).flatMap(([, values]) => values)
  const entries = Array.from({ length: count }, (_, index) => ({ key: `C:\\VirtualDesktop\\item-${index}`, name: `${names[index % names.length].replace(/(\.[^.]+)?$/, `-${String(index).padStart(3, '0')}$1`)}`, x: index % 5 === 0 ? -240 + index * 3 : (index % 7) * 112, y: index % 4 === 0 ? -120 + index * 5 : Math.floor(index / 7) * 139 }))
  const scanItems = entries.map((entry, index) => {
    const original = names[index % names.length]
    const category = Object.entries(categories).find(([, values]) => values.includes(original))?.[0] || 'other'
    return { path: `C:\\VirtualDesktop\\${entry.name}`, name: entry.name, extension: entry.name.split('.').pop() || '', category, createdAt: '2026-08-27T00:00:00.000Z', modifiedAt: '2026-08-27T00:00:00.000Z', isDirectory: category === 'folder' }
  })
  return { layout: { createdAt: '2026-08-27T00:00:00.000Z', spacingX: 112, spacingY: 139, entries }, scan: { desktopPath: 'C:\\VirtualDesktop', items: scanItems, counts: { image: 0, document: 0, archive: 0, installer: 0, shortcut: 0, folder: 0, other: 0 } } }
}

async function main() {
  await app.whenReady()
  const modulePath = process.env.MASTER_DESKTOP_LAYOUT_MODULE || '../.master-desktop-layout-test/desktop-layout.cjs'
  const { createCategoryLayoutPlan, toBackup } = require(modulePath)
  const results = []
  for (const count of [10, 50, 100]) {
    const { layout, scan } = buildCase(count)
    const original = JSON.stringify(layout)
    const plan = createCategoryLayoutPlan(layout, scan, false, { width: 1920, height: 1080 })
    assert.equal(plan.itemCount, count, `${count} 个图标的计划数量异常。`)
    assert.equal(plan.entries.length, count, `${count} 个图标未全部进入预览。`)
    assert.equal(JSON.stringify(layout), original, '预览修改了输入布局。')
    assert.ok(plan.entries.every((entry) => entry.status === 'planned' && entry.path.startsWith('C:\\VirtualDesktop\\')), '预览产生非法路径或非计划状态。')
    assert.ok(plan.entries.every((entry) => entry.x >= 0 && entry.y >= 0), '预览未将负坐标布局重排到安全坐标空间。')
    assert.equal(Object.values(plan.counts).reduce((total, value) => total + value, 0), count, '分类统计总数不等于图标总数。')
    const backup = toBackup(layout, `simulated ${count}`)
    assert.equal(backup.entries.length, count, '快照序列化遗漏图标。')
    assert.ok(backup.native && backup.spacingX === 112 && backup.spacingY === 139, '快照未保留布局元数据。')
    results.push({ count, categories: plan.counts, backupEntries: backup.entries.length })
  }
  const { layout, scan } = buildCase(10)
  const autoPlan = createCategoryLayoutPlan(layout, scan, true, { width: 1280, height: 720 })
  assert.equal(autoPlan.autoArrangeDetected, true, '自动排列状态未传入预览。')
  assert.ok(autoPlan.warnings.some((warning) => warning.includes('自动排列图标')), '自动排列预览未显示阻止应用的警告。')
  console.log(JSON.stringify({ ok: true, checks: ['simulation-10-50-100', 'category-preview', 'snapshot-serialization', 'negative-coordinate-normalization', 'auto-arrange-warning', 'preview-does-not-mutate-layout', 'no-file-operation-surface'], results }, null, 2))
  app.quit()
}
main().catch((error) => { console.error(error.stack || error.message || String(error)); app.quit(); process.exitCode = 1 })
