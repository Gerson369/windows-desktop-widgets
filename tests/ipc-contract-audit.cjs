const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const includeDirectories = ['src', 'native', 'resources']
const ignoredDirectories = new Set(['node_modules', 'out', 'release', '.git'])

function filesUnder(directory) {
  const result = []
  if (!fs.existsSync(directory)) return result
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) result.push(...filesUnder(path.join(directory, entry.name)))
    } else result.push(path.join(directory, entry.name))
  }
  return result
}

const sourceFiles = includeDirectories.flatMap((directory) => filesUnder(path.join(root, directory)))
  .filter((file) => /\.(?:ts|vue|js|cjs|json|cs|ps1|cmd)$/i.test(file))
const read = (file) => fs.readFileSync(file, 'utf8')
const preload = read(path.join(root, 'src/preload/index.ts'))
const main = read(path.join(root, 'src/main/index.ts'))
const invocationPattern = /invoke(?:<[^\n]*>)?\('([^']+)'/g
const handlerPattern = /ipcMain\.handle\('([^']+)'/g
const invoked = new Set([...preload.matchAll(invocationPattern)].map((match) => match[1]))
const handled = new Set([...main.matchAll(handlerPattern)].map((match) => match[1]))
const missingHandlers = [...invoked].filter((channel) => !handled.has(channel)).sort()
const unusedHandlers = [...handled].filter((channel) => !invoked.has(channel)).sort()

const suspiciousPattern = /\b(?:MOCK|FAKE|TODO|FIXME|STUB)\b/g
const suspicious = []
for (const file of sourceFiles) {
  const lines = read(file).split(/\r?\n/)
  lines.forEach((line, index) => {
    if (suspiciousPattern.test(line)) suspicious.push({ file: path.relative(root, file).replaceAll('\\', '/'), line: index + 1, text: line.trim().slice(0, 220) })
    suspiciousPattern.lastIndex = 0
  })
}

const everythingPattern = /Everything|es\.exe/ig
const everythingReferences = []
for (const file of sourceFiles) {
  const content = read(file)
  if (everythingPattern.test(content)) everythingReferences.push(path.relative(root, file).replaceAll('\\', '/'))
  everythingPattern.lastIndex = 0
}

console.log(JSON.stringify({
  canonicalRoot: root,
  sourceFileCount: sourceFiles.length,
  ipc: { invoked: [...invoked].sort(), handled: [...handled].sort(), missingHandlers, unusedHandlers },
  suspicious,
  everythingReferences
}, null, 2))
