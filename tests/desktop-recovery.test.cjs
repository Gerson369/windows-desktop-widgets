const test=require('node:test')
const assert=require('node:assert/strict')
const {loadTypeScript}=require('./load-typescript.cjs')
function recovery(failure){
  const calls=[]
  const host=loadTypeScript('src/main/desktop-host.ts',{
    electron:{app:{isPackaged:false,getAppPath:()=>process.cwd()}},
    'node:child_process':{execFile:(file,args,options,callback)=>{calls.push({file,args,options});callback(failure || null,{stdout:'{"ok":true}'})}}
  })
  return {host,calls}
}
test('release explicitly shows icons even when there is no remaining guardian',async()=>{
  const {host,calls}=recovery()
  await host.releaseDesktop()
  assert.equal(calls.length,1)
  assert.deepEqual(calls[0].args,['restore','1'])
  assert.equal(calls[0].options.timeout,5000)
})
test('failed explicit restoration rejects instead of reporting a successful exit',async()=>{
  const {host}=recovery(new Error('Explorer is restarting'))
  await assert.rejects(host.releaseDesktop(),/Explorer is restarting/)
})


const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')
const mainSource=fs.readFileSync('src/main/index.ts','utf8'),mainAst=ts.createSourceFile('index.ts',mainSource,ts.ScriptTarget.Latest,true)
function findNode(node,predicate){if(predicate(node))return node;return ts.forEachChild(node,child=>findNode(child,predicate))}
function collectionStarter(collectDesktopOnce){
  const declaration=findNode(mainAst,node=>ts.isVariableDeclaration(node) && node.name.getText(mainAst)==='startDesktopCollection')
  const source='let collectionTask=null;'+declaration.parent.getText(mainAst)+';module.exports=startDesktopCollection'
  const context={collectDesktopOnce,module:{exports:null}}
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context)
  return context.module.exports
}
test('repeated collection requests share one pending operation and can run again after completion',async()=>{
  let calls=0,finish
  const start=collectionStarter(()=>{calls++;return new Promise(resolve=>finish=resolve)})
  const first=start(),second=start();assert.equal(first,second);assert.equal(calls,1)
  finish('done');assert.equal(await first,'done')
  const next=start();assert.equal(calls,2);finish('again');assert.equal(await next,'again')
})
test('failed collection releases the shared task so retry is possible',async()=>{
  let calls=0
  const start=collectionStarter(()=>++calls===1?Promise.reject(Error('unavailable')):Promise.resolve('ready'))
  await assert.rejects(start(),/unavailable/);assert.equal(await start(),'ready')
})
test('collection readiness accepts an explicit fallback but rejects missing inventory or missing visuals',()=>{
  const call=findNode(mainAst,node=>ts.isCallExpression(node) && node.expression.getText(mainAst).endsWith('executeJavaScript') && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.includes('data-inventory-ready'))
  const ready=(header,items)=>Boolean(vm.runInNewContext(call.arguments[0].text,{document:{querySelector:()=>header,querySelectorAll:()=>items}}))
  const item=(image,fallback)=>({dataset:{path:'file.txt'},querySelector:selector=>selector==='img'?image:fallback})
  assert.equal(ready(true,[item(null,{})]),true)
  assert.equal(ready(true,[item({complete:true,naturalWidth:32},null)]),true)
  assert.equal(ready(true,[item({complete:true,naturalWidth:0},null)]),false)
  assert.equal(ready(false,[]),false)
  for(const surface of ['.assistant-panel .assistant-header','.health-panel .wellness-controls']) {
    assert.equal(Boolean(vm.runInNewContext(call.arguments[0].text,{document:{querySelector:selector=>selector.includes(surface)?{}:null,querySelectorAll:()=>[]}})),true)
  }
})
