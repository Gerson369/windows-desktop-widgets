const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
function loadTypeScript(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = module.paths
  loaded.require = request => {
    if (Object.hasOwn(dependencies, request)) return dependencies[request]
    const relative = path.resolve(path.dirname(filename), `${request}.ts`)
    if (request.startsWith('.') && fs.existsSync(relative)) return loadTypeScript(path.relative(path.resolve(__dirname, '..'), relative), dependencies)
    return Module.prototype.require.call(loaded, request)
  }
  loaded._compile(compiled.outputText, filename)
  return loaded.exports
}

module.exports = {loadTypeScript}
