const assert = require('node:assert/strict')
const { promises: fs } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { app } = require('electron')

const startedAt = Date.now()
const marker = `MASTER_SEARCH_${startedAt}`
const root = join(tmpdir(), `gerson-master-search-${startedAt}`)
const generated = { files: 0, directories: 0, symlinkCreated: false }

async function write(path, content = 'fixture') {
  await fs.writeFile(path, content, 'utf8')
  generated.files += 1
}

async function main() {
  await app.whenReady()
  const modulePath = process.env.MASTER_SEARCH_MODULE || '../.master-search-test/system-services.cjs'
  const { searchFiles } = require(modulePath)
  try {
    await fs.mkdir(root, { recursive: true })
    for (let directory = 0; directory < 1000; directory += 1) {
      const nested = join(root, `层级-${String(Math.floor(directory / 100)).padStart(2, '0')}`, `folder ${String(directory).padStart(4, '0')}`)
      await fs.mkdir(nested, { recursive: true })
      generated.directories += 1
      const writes = []
      for (let file = 0; file < 20; file += 1) {
        const extension = ['txt', 'md', 'docx', 'xlsx', 'pptx', 'pdf', 'png', 'jpg', 'webp', 'psd', 'zip', '7z', 'exe', 'msi', 'json', 'js', 'ts', 'tsx', 'html', 'mp4', 'mp3'][(directory * 20 + file) % 21]
        writes.push(write(join(nested, `normal [${directory}-${file}] 中文 😀 & space.${extension}`)))
      }
      await Promise.all(writes)
    }
    const target = join(root, `TARGET_${marker}`)
    await fs.mkdir(target, { recursive: true })
    generated.directories += 1
    const exact = join(target, `EXACT_${marker}_English.txt`)
    const chinese = join(target, `中文检索_${marker}_😀.md`)
    const caseFile = join(target, `CASE_${marker}_MATCH.PDF`)
    const sizeFile = join(target, `SIZE_${marker}.bin`)
    const noExtension = join(target, `NO_EXTENSION_${marker}`)
    const doubleExtension = join(target, `DOUBLE_${marker}.tar.gz`)
    const duplicateOne = join(target, `duplicate-one-${marker}.txt`)
    const duplicateTwo = join(target, `duplicate-two-${marker}.txt`)
    const longDirectory = join(target, 'long-name-中文-😀-'.repeat(8), 'long-name-中文-😀-'.repeat(8))
    const longFile = join(longDirectory, `LONG_${marker}_${'x'.repeat(100)}.txt`)
    await fs.mkdir(longDirectory, { recursive: true })
    generated.directories += 2
    await Promise.all([
      write(exact), write(chinese), write(caseFile), fs.writeFile(sizeFile, Buffer.alloc(1_300_000, 7)).then(() => { generated.files += 1 }),
      write(noExtension), write(doubleExtension), write(duplicateOne), write(duplicateTwo), write(longFile)
    ])
    const vanished = join(target, `VANISHED_${marker}.txt`)
    const vanishedDirectory = join(target, `VANISHED_DIRECTORY_${marker}`)
    await write(vanished)
    await fs.mkdir(vanishedDirectory)
    generated.directories += 1
    await fs.rm(vanished)
    await fs.rm(vanishedDirectory, { recursive: true, force: true })
    try {
      await fs.symlink(root, join(root, `loop-${marker}`), 'junction')
      generated.symlinkCreated = true
    } catch {
      // Link creation can be prohibited by policy; the remaining tree still tests termination.
    }

    const has = (items, path) => items.some((item) => item.path.toLowerCase() === path.toLowerCase())
    const exactItems = await searchFiles({ keyword: `EXACT_${marker}`, extension: 'txt', path: `TARGET_${marker}` }, [root])
    const chineseItems = await searchFiles({ keyword: `中文检索_${marker}`, extension: 'md' }, [root])
    const caseItems = await searchFiles({ keyword: `case_${marker}_match`, extension: 'pdf' }, [root])
    const sizedItems = await searchFiles({ keyword: `SIZE_${marker}`, minSize: 1, maxSize: 2 }, [root])
    const combinedItems = await searchFiles({ keyword: `EXACT_${marker}`, extension: 'txt', path: `TARGET_${marker}`, modifiedAfter: new Date(Date.now() - 86400000).toISOString().slice(0, 10), maxSize: 1 }, [root])
    const noExtensionItems = await searchFiles({ keyword: `NO_EXTENSION_${marker}` }, [root])
    const doubleExtensionItems = await searchFiles({ keyword: `DOUBLE_${marker}`, extension: 'gz' }, [root])
    const duplicateItems = await searchFiles({ keyword: `duplicate-${marker}`, extension: 'txt' }, [root])
    const longItems = await searchFiles({ keyword: `LONG_${marker}`, extension: 'txt' }, [root])
    const noneItems = await searchFiles({ keyword: `VANISHED_${marker}` }, [root])
    const controller = new AbortController()
    controller.abort()
    const abortedItems = await searchFiles({ keyword: 'normal [' }, [root], controller.signal)

    assert.ok(generated.files >= 20010, `合成文件数量不足：${generated.files}`)
    assert.ok(generated.directories >= 1000, `合成目录数量不足：${generated.directories}`)
    assert.ok(has(exactItems, exact), '精确搜索失败')
    assert.ok(has(chineseItems, chinese), '中文 emoji 搜索失败')
    assert.ok(has(caseItems, caseFile), '大小写不敏感搜索失败')
    assert.ok(has(sizedItems, sizeFile), '大小筛选失败')
    assert.ok(has(combinedItems, exact), '多条件组合筛选失败')
    assert.ok(has(noExtensionItems, noExtension), '无扩展名搜索失败')
    assert.ok(has(doubleExtensionItems, doubleExtension), '双扩展名搜索失败')
    assert.ok(has(duplicateItems, duplicateOne) && has(duplicateItems, duplicateTwo), '同名文件搜索失败')
    assert.ok(has(longItems, longFile), '长路径搜索失败')
    assert.equal(noneItems.length, 0, '已删除文件或目录仍被返回')
    assert.equal(abortedItems.length, 0, '已中止查询仍返回结果')
    console.log(JSON.stringify({ ok: true, marker, root, generated, checks: ['exact', 'chinese-emoji', 'case-insensitive', 'extension', 'path', 'date', 'size', 'combined', 'duplicates', 'no-extension', 'double-extension', 'long-path', 'deleted-file-and-directory', 'abort', 'symlink-loop-termination'] }, null, 2))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    app.quit()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  app.quit()
  process.exitCode = 1
})
