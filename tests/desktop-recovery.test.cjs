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
