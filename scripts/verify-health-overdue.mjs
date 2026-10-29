import {spawn} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {connect,until,closeAll} from './cdp-check-client.mjs'
const directory=path.resolve('.health-gravity-2.4.0-e2e-data'),evidence=path.resolve('docs/evidence/health-overdue-2.4.0'),port=9503
await fs.mkdir(directory,{recursive:true});await fs.mkdir(evidence,{recursive:true})
for(const name of ['quit','snapshot','clock'])await fs.rm(path.join(directory,name),{force:true})
const env={...process.env,GERSON_E2E_DEBUG:'1',GERSON_E2E_DEBUG_PORT:String(port),GERSON_E2E_DATA_DIRECTORY:directory,GERSON_E2E_SKIP_DESKTOP:'1'};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),[path.resolve('scripts/compact-assistant-host.cjs'),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']}),exited=once(child,'close')
let logs='';child.stdout.on('data',bytes=>{logs+=bytes});child.stderr.on('data',bytes=>{logs+=bytes})
const report={checks:[],ok:false},pages=async()=>(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const check=name=>{report.checks.push(name);console.log(name)}
const protocolSessions=new Map()
async function protocol(healthPage,method,params){
 let session=protocolSessions.get(healthPage.id)
 if(!session){
  const ws=new WebSocket(healthPage.webSocketDebuggerUrl),pending=new Map()
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  session={ws,pending,nextId:0};protocolSessions.set(healthPage.id,session)
  ws.onmessage=({data})=>{const message=JSON.parse(String(data)),request=pending.get(message.id);if(!request)return;clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(Error(message.error.message)):request.resolve(message.result)}
 }
 return new Promise((resolve,reject)=>{const id=++session.nextId,timer=setTimeout(()=>{session.pending.delete(id);reject(Error('Protocol timeout'))},10000);session.pending.set(id,{resolve,reject,timer});session.ws.send(JSON.stringify({id,method,params}))})
}
async function screenshot(healthPage,name){const result=await protocol(healthPage,'Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,name),Buffer.from(result.data,'base64'))}
try{
 let targets;await until(async()=>{try{targets=await pages();return targets.some(page=>page.url.includes('desktopModule=health'))}catch{return false}})
 const main=await connect(targets.find(page=>!page.url.includes('?'))),healthPage=targets.find(page=>page.url.includes('desktopModule=health')),health=await connect(healthPage)
 async function advanceClock(now){
  await fs.writeFile(path.join(directory,'clock'),String(now))
  await health(`Date.now=()=>${now}`)
 }
 async function prepareFullCup(){
  const before=await main(`window.toolbox.wellness.get()`)
  assert.ok(before.state.hydration,'The isolated plan must have another cup to fill')
  await advanceClock(before.state.hydration.dueAt)
  await until(()=>health(`document.querySelector('.water-icon small')?.textContent.trim()==='250ml' && !document.querySelector('.water-icon').disabled`))
  return before
 }
 async function drinkFullCup(){
  const before=await prepareFullCup()
  await health(`document.querySelector('.water-icon').click()`)
  await until(()=>main(`window.toolbox.wellness.get().then(state=>state.hydrationPlan.consumedMl===${before.hydrationPlan.consumedMl+250})`))
 }
 await main(`(async()=>{const data=await window.toolbox.data.get();await window.toolbox.settings.update({hydrationPlan:{...data.settings.hydrationPlan,enabled:true,goalMl:5000,cupMl:250,times:undefined,start:'00:00',end:'23:59'},hydrationReminderEnabled:true,sedentaryReminderEnabled:true})})()`)
 await until(()=>health(`Boolean(document.querySelector('.water-icon'))`))
 const initial=await main(`window.toolbox.wellness.get()`)
 await drinkFullCup()
 await until(()=>health(`Boolean(document.querySelector('[aria-label="撤销最近的健康操作"]'))`))
 await screenshot(healthPage,'undo-receipt.png')
 let saved=await main(`window.toolbox.wellness.get()`);assert.ok(saved.hydrationPlan.consumedMl>initial.hydrationPlan.consumedMl)
 await health(`document.querySelector('[aria-label="撤销最近的健康操作"]').click()`)
 await until(()=>main(`window.toolbox.wellness.get().then(state=>state.hydrationPlan.consumedMl===${initial.hydrationPlan.consumedMl})`))
 const restored=await main(`window.toolbox.wellness.get()`)
 assert.equal(restored.state.hydration?.startedAt,initial.state.hydration?.startedAt)
 assert.equal(restored.state.hydration?.dueAt,initial.state.hydration?.dueAt)
 assert.equal(restored.undo,undefined)
 check('one click drinks the displayed full 250ml cup; undo restores its amount and original clock')
 const beforeActivity=await main(`window.toolbox.wellness.get()`)
 await health(`document.querySelector('.spine-icon').click()`)
 await until(()=>health(`Boolean(document.querySelector('[aria-label="撤销最近的健康操作"]'))`))
 await health(`document.querySelector('[aria-label="撤销最近的健康操作"]').click()`)
 await until(()=>main(`window.toolbox.wellness.get().then(state=>!state.undo)`))
 const activityRestored=await main(`window.toolbox.wellness.get()`)
 assert.equal(activityRestored.state.sedentary.startedAt,beforeActivity.state.sedentary.startedAt)
 assert.equal(activityRestored.state.sedentary.dueAt,beforeActivity.state.sedentary.dueAt)
 check('activity undo restores the original clock rather than starting a new interval')
 await drinkFullCup();const first=await main(`window.toolbox.wellness.get()`)
 await drinkFullCup()
 await until(()=>main(`window.toolbox.wellness.get().then(state=>state.undo?.id!==${JSON.stringify(first.undo.id)})`))
 const second=await main(`window.toolbox.wellness.get()`)
 assert.equal(await main(`window.toolbox.wellness.undo(${JSON.stringify(first.undo.id)}).then(()=>false,()=>true)`),true)
 assert.equal((await main(`window.toolbox.wellness.get()`)).hydrationPlan.consumedMl,second.hydrationPlan.consumedMl)
 await health(`document.querySelector('[aria-label="撤销最近的健康操作"]').click()`)
 await until(()=>main(`window.toolbox.wellness.get().then(state=>state.hydrationPlan.consumedMl===${first.hydrationPlan.consumedMl})`))
 check('a newer record invalidates the old undo token and undo removes only the latest cup')
 await protocol(healthPage,'Page.bringToFront',{})
 await protocol(healthPage,'Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
 // Explicit visual fixtures provide overdue states without waiting hours or changing user data.
 const layout=await main(`window.toolbox.wellness.get()`);report.visuals=[]
 await health(`document.head.insertAdjacentHTML('beforeend','<style>.spine-icon rect,.spine-icon path,.assistant-flood{transition:none!important}</style>')`)
 async function setVisual(percent){
  const at=Date.now(),state=structuredClone(layout);state.undo=undefined;state.paused=false;state.now=at
  state.hydrationPlan.status='active';state.hydrationPlan.restingClock=undefined
  for(const kind of ['hydration','sedentary'])state.state[kind]={intervalMinutes:30,startedAt:at-percent/100*1800000,dueAt:at+(1-percent/100)*1800000}
  await fs.writeFile(path.join(directory,'snapshot'),JSON.stringify(state))
  await until(()=>health(`document.querySelector('.water-icon small').textContent.trim()===${JSON.stringify(percent+'%')} && document.querySelector('.spine-icon small').textContent.trim()===${JSON.stringify(percent+'%')}`))
 }
 for(const percent of [100,101,105,109,110,119,120,130,140,150,160,170,180,190,200,300,400]){
  await setVisual(percent)
  if(percent>100)await until(()=>health(`Number(document.querySelector('.health-physics').dataset.waterParticles)>0`))
  const expectedBones=Math.min(10,Math.max(0,Math.floor((percent-100)/10)))
  await until(()=>health(`Number(document.querySelector('.health-physics').dataset.fallenBones)===${expectedBones}`))
  const visual=await health(`(()=>{const flood=document.querySelector('.assistant-flood');return {color:getComputedStyle(document.querySelector('.water-icon')).color,drops:Number(document.querySelector('.health-physics').dataset.waterParticles),fallen:Number(document.querySelector('.health-physics').dataset.fallenBones),segments:document.querySelectorAll('.spine-visual rect.separated').length,connectionOpacity:document.querySelector('.spine-outline').getAttribute('opacity'),level:flood?Number(flood.style.getPropertyValue('--water-level')):0,pointer:flood?getComputedStyle(flood).pointerEvents:'none'}})()`)
  assert.equal(visual.fallen,expectedBones);assert.equal(visual.segments,expectedBones)
  if([101,105,109,119].includes(percent)){
   const wobble=await health(`(()=>{const bones=[...document.querySelectorAll('.vertebra')],loose=document.querySelectorAll('.vertebra.loose');return {count:loose.length,index:bones.indexOf(loose[0]),name:getComputedStyle(loose[0]).animationName,distance:parseFloat(loose[0].style.getPropertyValue('--shake-distance')),duration:parseFloat(loose[0].style.getPropertyValue('--shake-duration'))}})()`)
   assert.equal(wobble.count,1);assert.equal(wobble.index,expectedBones);assert.equal(wobble.name.startsWith('bone-loosen'),true)
   visual.wobble=wobble
  }
  if(percent>100){
   const surface=await health(`(()=>{const flood=document.querySelector('.assistant-flood');return {border:getComputedStyle(flood).borderTopWidth,background:getComputedStyle(flood).backgroundColor,path:flood.querySelector('path').getAttribute('d')}})()`)
   assert.equal(surface.border,'0px');assert.equal(surface.background,'rgba(0, 0, 0, 0)');assert.ok(surface.path.endsWith('V720H0Z'))
  }

  assert.equal(visual.pointer,'none');if(percent>=300){assert.equal(visual.segments,10);assert.equal(Number(visual.connectionOpacity),0)}
  if(report.visuals.length){const prior=report.visuals.at(-1);assert.ok(visual.level>=prior.level && visual.segments>=prior.segments)}
  report.visuals.push({percent,...visual});await screenshot(healthPage,`overdue-${percent}.png`)
 }
 assert.equal(report.visuals.at(-1).level,1)
 const shakes=report.visuals.filter(item=>[101,105,109].includes(item.percent)).map(item=>item.wobble)
 assert.ok(shakes[0].distance<shakes[1].distance && shakes[1].distance<shakes[2].distance && shakes[0].duration>shakes[1].duration && shakes[1].duration>shakes[2].duration)
 check('the next attached bone shakes more strongly and faster before dropping; the flood has one continuous wave edge without a flat border')
 assert.ok(report.visuals.every(item=>item.color===report.visuals[0].color))
 await setVisual(100)
 await until(()=>health(`document.querySelectorAll('.spine-visual rect.falling').length===0`))
 await health(`(()=>{window.__boneCounts=[0];window.__boneObserver=new MutationObserver(()=>{const count=document.querySelectorAll('.spine-visual rect.falling').length;if(count!==window.__boneCounts.at(-1))window.__boneCounts.push(count)});window.__boneObserver.observe(document.querySelector('.spine-visual'),{subtree:true,attributes:true,attributeFilter:['class']})})()`)
 await setVisual(200)
 await until(()=>health(`document.querySelectorAll('.spine-visual rect.falling').length===10`))
 const sequence=await health(`window.__boneObserver.disconnect();window.__boneCounts`)
 assert.deepEqual(sequence,[0,1,2,3,4,5,6,7,8,9,10]);report.catchupSequence=sequence
 check('jumping across overdue stages still releases one bone at a time, keeping waiting pieces visible')
 await setVisual(400)
 await screenshot(healthPage,'gravity-flight.png')
 await new Promise(resolve=>setTimeout(resolve,2200))
 await screenshot(healthPage,'gravity-ground.png')
 assert.equal(await health(`document.querySelector('.health-physics').style.pointerEvents || getComputedStyle(document.querySelector('.health-physics')).pointerEvents`),'none')
 check('spine drops one additional bone at each ten-percent step from 110 through 200')
 check('overdue water remains blue, particles fall and splash, all ten detached bones are rendered by the gravity layer')
 await protocol(healthPage,'Page.bringToFront',{})
 await protocol(healthPage,'Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await protocol(healthPage,'Page.reload',{})
 await until(()=>health(`document.querySelector('.spine-icon small')?.textContent.trim()==='400%' && !document.querySelector('.wellness-controls').classList.contains('physics-active')`))
 await screenshot(healthPage,'reduced-motion.png')
 assert.equal(await health(`getComputedStyle(document.querySelector('.spine-visual rect.separated')).visibility`),'visible')
 await protocol(healthPage,'Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
 await protocol(healthPage,'Page.reload',{})
 await until(()=>health(`document.querySelector('.spine-icon small')?.textContent.trim()==='400%' && document.querySelector('.wellness-controls')?.classList.contains('physics-active')`))
 check('reduced-motion preference at load disables gravity and retains static separated pieces; restoring motion at load resumes physics')
 const beforePointer=await prepareFullCup()
 const target=await health(`(()=>{const button=document.querySelector('.water-icon'),box=button.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;return {x,y,passes:button.contains(document.elementFromPoint(x,y))}})()`);assert.equal(target.passes,true)
 await fs.rm(path.join(directory,'snapshot'),{force:true})
 await protocol(healthPage,'Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:target.x,y:target.y})
 await protocol(healthPage,'Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:target.x,y:target.y})
 await until(()=>main(`window.toolbox.wellness.get().then(state=>state.hydrationPlan.consumedMl===${beforePointer.hydrationPlan.consumedMl+250})`))
 await until(()=>health(`Boolean(document.querySelector('[aria-label="撤销最近的健康操作"]')) && !document.querySelector('.assistant-flood')`))
 check('real pointer clicks pass through the flood to drink the displayed 250ml, drain it and offer undo directly')
 const expiry=await main(`window.toolbox.wellness.get()`)
 await advanceClock(expiry.undo.expiresAt+1)
 await until(()=>health(`!document.querySelector('[aria-label="撤销最近的健康操作"]')`))
 assert.equal(await main(`window.toolbox.wellness.undo(${JSON.stringify(expiry.undo.id)}).then(()=>false,()=>true)`),true)
 check('15-second undo receipt expires and the server also refuses the expired token')
 report.ok=true
}catch(error){report.error=String(error);console.error(error);process.exitCode=1}
finally{closeAll();for(const session of protocolSessions.values())session.ws.close();await fs.rm(path.join(directory,'snapshot'),{force:true});await fs.writeFile(path.join(directory,'quit'),'quit');const timer=setTimeout(()=>child.kill(),15000);await exited;clearTimeout(timer);await fs.rm(path.join(directory,'clock'),{force:true});await fs.writeFile(path.join(evidence,'runtime-report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(evidence,'electron.log'),logs);console.log(JSON.stringify(report))}
