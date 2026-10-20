const fs = require('node:fs')
const path = require('node:path')

const [sourcePath, destinationPath] = process.argv.slice(2)
if (!sourcePath || !destinationPath) throw new Error('需要提供源 package.json 和目标 package.json 路径。')
const manifest = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
delete manifest.build
delete manifest.scripts
delete manifest.devDependencies
fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
fs.writeFileSync(destinationPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
