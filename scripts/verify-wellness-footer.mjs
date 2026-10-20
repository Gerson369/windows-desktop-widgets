import {spawn} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {connect,until,closeAll} from './cdp-check-client.mjs'
const directory=path.resolve('.wellness-footer-2.4.0-e2e-data'),evidence=path.resolve('docs/evidence/wellness-footer-2.4.0'),port=9502
await fs.mkdir(directory,{recursive:true});await fs.mkdir(evidence,{recursive:true});await fs.rm(path.join(directory,'quit'),{force:true});await fs.rm(path.join(directory,'snapshot'),{force:true})
const env={...process.env,GERSON_E2E_DEBUG:'1',GERSON_E2E_DEBUG_PORT:String(port),GERSON_E2E_DATA_DIRECTORY:directory,GERSON_E2E_SKIP_DESKTOP:'1'};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),[path.resolve('scripts/compact-assistant-host.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']}),exited=once(child,'close')
let logs='';child.stdout.on('data',bytes=>{logs+=bytes});child.stderr.on('data',bytes=>{logs+=bytes})
const report={checks:[],ok:false},pages=async()=>(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const check=name=>{report.checks.push(name);console.log(name)}
async function screenshot(page,name){const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});try{const result=await new Promise((resolve,reject)=>{ws.onmessage=({data})=>{const msg=JSON.parse(String(data));if(msg.id===1)msg.error?reject(Error(msg.error.message)):resolve(msg.result)};ws.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png'}}))});await fs.writeFile(path.join(evidence,name),Buffer.from(result.data,'base64'))}finally{ws.close()}}
try{
 let targets;await until(async()=>{try{targets=await pages();return targets.some(page=>page.url.includes('desktopModule=todos'))}catch{return false}})
 const main=await connect(targets.find(page=>!page.url.includes('?'))),page=targets.find(page=>page.url.includes('desktopModule=todos')),assistant=await connect(page)
 await main(`(async()=>{const data=await window.toolbox.data.get();await window.toolbox.settings.update({hydrationPlan:{...data.settings.hydrationPlan,enabled:true,start:'00:00',end:'23:59',times:undefined},hydrationReminderEnabled:true,sedentaryReminderEnabled:true})})()`)
 await until(()=>assistant(`Boolean(document.querySelector('.daily-reservoir'))`))
 assert.equal(await assistant(`document.querySelector('.wellness-controls>.health-control').classList.contains('activity-control')`),true)
 assert.equal(await assistant(`document.querySelectorAll('.health-confirm').length`),0)
 assert.equal(await assistant(`document.querySelector('[aria-label="全天剩余水量"]').tagName`),'DIV')
 check('activity stays left; separate action buttons removed; bottle is read-only')
 report.layouts=[]
 for(const width of [300,420,360]){
  await fs.writeFile(path.join(directory,'resize'),JSON.stringify({width,height:480}));await until(()=>assistant(`innerWidth===${width}`))
  const layout=await assistant(`(()=>{const rect=selector=>document.querySelector(selector).getBoundingClientRect();const ink=selector=>{const element=document.querySelector(selector),box=element.getBBox(),matrix=element.getScreenCTM(),top=new DOMPoint(box.x,box.y).matrixTransform(matrix),bottom=new DOMPoint(box.x+box.width,box.y+box.height).matrixTransform(matrix);return {top:top.y,bottom:bottom.y,height:bottom.y-top.y}};const bottle=ink('.bottle-outline'),spine=ink('.spine-outline'),cup=ink('.cup-outline');const centered=['.water-icon>span','.spine-icon>span'].every(selector=>{const span=document.querySelector(selector),range=document.createRange();range.selectNodeContents(span.firstChild);const label=range.getBoundingClientRect(),value=span.querySelector('small').getBoundingClientRect();return Math.abs(label.x+label.width/2-value.x-value.width/2)<1});return {width:innerWidth,overflow:[...document.querySelectorAll('.health-control')].some(item=>item.getBoundingClientRect().right>innerWidth),centered,baseline:Math.max(bottle.bottom,spine.bottom,cup.bottom)-Math.min(bottle.bottom,spine.bottom,cup.bottom),sameHeight:Math.abs(bottle.height-spine.height)<1,ink:{bottle,spine,cup},activityBeforeBottle:rect('.activity-control').right<=rect('.daily-reservoir').left}})()`)
  assert.equal(layout.overflow,false);assert.equal(layout.centered,true);assert.ok(layout.baseline<1);assert.equal(layout.sameHeight,true);assert.equal(layout.activityBeforeBottle,true);report.layouts.push(layout)
  await screenshot(page,`footer-${width}.png`)
 }
 check('300/360/420 DIP align actual visible SVG paths, including equal bottle/spine heights, rather than only their outer frames')
 for(const percent of ['19%','100%'])assert.equal(await assistant(`(()=>{const span=document.querySelector('.water-icon>span'),small=span.querySelector('small');small.textContent=${JSON.stringify(percent)};const range=document.createRange();range.selectNodeContents(span.firstChild);const label=range.getBoundingClientRect(),value=small.getBoundingClientRect();return Math.abs(label.x+label.width/2-value.x-value.width/2)<1})()`),true)
 check('two-digit and three-digit progress text remains centered under its label')
 const before=await main(`window.toolbox.wellness.get()`)
 await assistant(`document.querySelector('.water-icon').click()`)
 await until(()=>main(`window.toolbox.wellness.get().then(state=>state.hydrationPlan.consumedMl===${before.hydrationPlan.consumedMl+before.hydrationPlan.nextCupMl})`))
 await assistant(`document.querySelector('.spine-icon').click()`)
 await until(()=>assistant(`document.querySelector('[role=status].health-feedback').textContent.includes('已活动')`))
 const after=await main(`window.toolbox.wellness.get()`);assert.ok(after.state.sedentary);report.recordedMl=after.hydrationPlan.consumedMl-before.hydrationPlan.consumedMl
 assert.equal(await assistant(`document.querySelectorAll('.health-popover').length`),0)
 assert.ok(await assistant(`document.querySelector('.spine-icon small').textContent.includes('已活动')`))
 check('left-click cup records one cup and left-click spine confirms activity, with inline feedback and no popup')
 await assistant(`document.querySelector('.water-icon').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`)
 await until(()=>assistant(`Boolean(document.querySelector('[aria-label="喝水快捷设置"]'))`))
 assert.ok(await assistant(`document.querySelector('.health-context-menu').textContent.includes('10 分钟后提醒')`))
 await assistant(`document.querySelector('.health-context-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
 await until(()=>assistant(`!document.querySelector('.health-context-menu')`))
 check('right-click retains intervals, daily-plan access and ten-minute snooze; Escape closes menu')
 for(const progress of [0,.5,1]){
  const state=await main(`window.toolbox.wellness.get()`),at=Date.now()
  state.state.sedentary={intervalMinutes:60,startedAt:at-progress*3600000,dueAt:at+(1-progress)*3600000};state.now=at;state.paused=true
  await fs.writeFile(path.join(directory,'snapshot'),JSON.stringify(state))
  await until(()=>assistant(`document.querySelector('.spine-icon small').textContent.trim()===${JSON.stringify(progress===0?'1%':`${Math.floor(progress*100)}%`)}`))
  await new Promise(resolve=>setTimeout(resolve,650))
  const bent=await assistant(`(()=>{const bottom=selector=>{const element=document.querySelector(selector),box=element.getBBox();return new DOMPoint(box.x,box.y+box.height).matrixTransform(element.getScreenCTM()).y};const baseline=bottom('.bottle-outline'),spine=bottom('.spine-outline');const bones=[...document.querySelectorAll('.spine-visual rect')].flatMap(element=>{const box=element.getBBox(),matrix=element.getScreenCTM();return [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix).y)});return {baseline,spine,boneBottom:Math.max(...bones)}})()`)
  assert.ok(Math.abs(bent.baseline-bent.spine)<1);assert.ok(bent.boneBottom<=bent.baseline+1,JSON.stringify(bent))
  await screenshot(page,`footer-bend-${progress}.png`)
 }
 check('rendered spine at straight, halfway and fully bent progress never falls below the shared artwork baseline')
 report.ok=true
}catch(error){report.error=String(error);console.error(error);process.exitCode=1}
finally{closeAll();await fs.rm(path.join(directory,'snapshot'),{force:true});await fs.writeFile(path.join(directory,'quit'),'quit');const timer=setTimeout(()=>child.kill(),15000);await exited;clearTimeout(timer);await fs.writeFile(path.join(evidence,'runtime-report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(evidence,'electron.log'),logs);console.log(JSON.stringify(report))}
