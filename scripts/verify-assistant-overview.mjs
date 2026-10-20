import {spawn} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {connect,until,closeAll} from './cdp-check-client.mjs'
const directory=path.resolve('.overview-2.4.0-verified-e2e-data'),evidence=path.resolve('docs/evidence/overview-2.4.0'),port=9505
await fs.mkdir(directory,{recursive:true});await fs.mkdir(evidence,{recursive:true})
for(const name of ['quit','snapshot'])await fs.rm(path.join(directory,name),{force:true})
const env={...process.env,GERSON_E2E_DEBUG:'1',GERSON_E2E_DEBUG_PORT:String(port),GERSON_E2E_DATA_DIRECTORY:directory,GERSON_E2E_SKIP_DESKTOP:'1'};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),[path.resolve('scripts/compact-assistant-host.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']}),exited=once(child,'close')
let logs='';child.stdout.on('data',bytes=>{logs+=bytes});child.stderr.on('data',bytes=>{logs+=bytes})
const report={checks:[],ok:false},pages=async()=>(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const check=name=>{report.checks.push(name);console.log(name)}
const protocolSessions=new Map()
async function protocol(page,method,params){
 let session=protocolSessions.get(page.id)
 if(!session){
  const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map()
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  session={ws,pending,nextId:0};protocolSessions.set(page.id,session)
  ws.onmessage=({data})=>{const message=JSON.parse(String(data)),request=pending.get(message.id);if(!request)return;clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(Error(message.error.message)):request.resolve(message.result)}
 }
 return new Promise((resolve,reject)=>{const id=++session.nextId,timer=setTimeout(()=>{session.pending.delete(id);reject(Error('Protocol timeout'))},10000);session.pending.set(id,{resolve,reject,timer});session.ws.send(JSON.stringify({id,method,params}))})
}
async function screenshot(page,name){const result=await protocol(page,'Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,name),Buffer.from(result.data,'base64'))}
try{
 let targets;await until(async()=>{try{targets=await pages();return targets.some(page=>page.url.includes('desktopModule=todos'))}catch{return false}})
 const main=await connect(targets.find(page=>!page.url.includes('?'))),page=targets.find(page=>page.url.includes('desktopModule=todos')),assistant=await connect(page)
 const city1={id:'fixture-gz',name:'广州 · 广东 · 中国',latitude:23.13,longitude:113.26},city2={id:'fixture-sh',name:'上海 · 中国',latitude:31.23,longitude:121.47}
 const reading=city=>({city,updatedAt:new Date().toISOString(),temperature:26,apparent:28,humidity:62,wind:9,code:2,days:[]})
 await fs.writeFile(path.join(directory,'service-fixtures.json'),JSON.stringify({weather:{[city1.id]:reading(city1),[city2.id]:reading(city2)},metrics:{at:Date.now(),cpu:12.3,memoryUsed:8*1073741824,memoryTotal:16*1073741824,gpu:23.4,down:102400,up:20480,batteries:[],warnings:[]}}))
 await main(`window.toolbox.suite.save({cities:${JSON.stringify([city1,city2])},timeZones:['Asia/Shanghai','Europe/London'],countdowns:Array.from({length:12},(_,i)=>({id:'count-'+i,title:'日期 '+i,date:'2026-12-20'}))})`)
 await until(()=>assistant(`document.querySelector('.weather-details')?.textContent.includes('62%') && document.querySelector('.overview-devices')?.textContent.includes('12.3%')`))
 assert.deepEqual(await assistant(`[...document.querySelectorAll('[data-tool]')].map(button=>button.dataset.tool)`),['todos','calendar','notes','countdown','focus'])
 assert.match(await assistant(`document.querySelector('.overview-clock strong').textContent`),/^\d{2}:\d{2}:\d{2}$/)
 assert.ok(await assistant(`document.querySelector('.weather-details').textContent.includes('体感') && document.querySelector('.weather-details').textContent.includes('风速')`))
 check('five tool menus remain; header shows seconds, feels-like temperature, humidity, wind and compact device readings')
 const click=async selector=>{const point=await assistant(`(()=>{const box=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);await protocol(page,'Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await protocol(page,'Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})}
 await click('#overview-weather')
 await until(()=>assistant(`Boolean(document.querySelector('[aria-label="首页天气 上海 · 中国"]'))`))
 await assistant(`document.querySelector('[aria-label="首页天气 上海 · 中国"]').click()`)
 await until(()=>assistant(`document.querySelector('.weather-main b').textContent==='上海'`))
 await click('#overview-clock');await until(()=>assistant(`Boolean(document.querySelector('[aria-label="顶部时区 Europe/London"]'))`))
 await assistant(`document.querySelector('[aria-label="顶部时区 Europe/London"]').click()`)
 await until(()=>main(`window.toolbox.data.get().then(data=>data.suite.timeZones[0]==='Europe/London')`))
 await click('#overview-devices');await until(()=>assistant(`document.querySelector('.assistant-content').textContent.includes('CPU')`))
 await click('[data-tool="calendar"]');assert.equal(await assistant(`document.querySelectorAll('.assistant-section-title').length`),0)
 await click('[data-tool="countdown"]')
 await until(()=>assistant(`document.querySelectorAll('.countdown-item').length===12`))
 assert.ok(await assistant(`Math.max(...[...document.querySelectorAll('.countdown-item')].map(item=>item.getBoundingClientRect().height))<70`))
 assert.equal(await assistant(`document.querySelector('[data-tool="countdown"]').getAttribute('aria-label')`),'倒数日')
 await screenshot(page,'countdown.png')
 check('header modules open their existing settings/details directly; city and timezone selections update the header; countdown rows are compact and calendar has no repeated heading')
 const now=Date.now(),key=offset=>{const date=new Date(now);date.setDate(date.getDate()+offset);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`},today=key(0),future=key(1)
 const base={categoryId:'personal',createdAt:new Date(now).toISOString(),completed:false,order:0}
 const todos=[{...base,id:'today',title:'安排今天',dueAt:new Date(today+'T23:59:00').toISOString()},{...base,id:'future',title:'安排明天',dueAt:new Date(future+'T23:59:00').toISOString()},{...base,id:'unscheduled',title:'未安排'},{...base,id:'done',title:'已完成',completed:true}]
 await main(`(async()=>{for(const todo of ${JSON.stringify(todos)})await window.toolbox.entity.upsert('todos',todo)})()`)
 await click('[data-tool="todos"]')
 await until(()=>assistant(`document.querySelectorAll('.todo-filter [role="tab"]').length===4`))
 for(const [tab,count] of [['pending',3],['today',1],['planned',1],['completed',1]]){
  await click(`[data-todo-filter="${tab}"]`)
  await until(()=>assistant(`document.querySelectorAll('.desktop-todo').length===${count}`))
  assert.equal(await assistant(`document.querySelector('[data-todo-filter="${tab}"] small').textContent`),String(count))
 }
 assert.equal(await assistant(`document.querySelectorAll('.todo-scope').length`),0)
 await click('[data-todo-filter="pending"]')
 const title='仅记录添加日期-'+Date.now()
 await assistant(`(()=>{const input=document.querySelector('[aria-label="新增待办"]');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit()})()`)
 await until(()=>main(`window.toolbox.data.get().then(data=>data.todos.some(todo=>todo.title===${JSON.stringify(title)}))`))
 const added=await main(`window.toolbox.data.get().then(data=>data.todos.find(todo=>todo.title===${JSON.stringify(title)}))`)
 assert.equal(added.dueAt,undefined);assert.ok(Date.parse(added.createdAt)>=now)
 assert.ok(await assistant(`document.querySelector('[data-todo-id="${added.id}"] .todo-created').textContent.includes('添加于')`))
 check('four todo tabs show separate counts; creating without a schedule stores and displays creation time without assigning a due date')
 await assistant(`(()=>{const input=document.querySelector('[data-todo-id="${added.id}"] .date-text');input.focus()})()`)
 await assistant(`(()=>{const input=document.querySelector('[data-todo-id="${added.id}"] .date-text');input.value=${JSON.stringify(future.replaceAll('-','/'))};input.dispatchEvent(new Event('input',{bubbles:true}));input.blur()})()`)
 await until(()=>main(`window.toolbox.data.get().then(data=>data.todos.find(todo=>todo.id===${JSON.stringify(added.id)}).dueAt?.startsWith(${JSON.stringify(new Date(future+'T23:59:00').toISOString().slice(0,10))}))`))
 await click(`[data-todo-id="${added.id}"] .date-calendar`)
 await until(()=>assistant(`document.querySelectorAll('.due-date-popover:popover-open .month-grid button').length===42`))
 await screenshot(page,'todo-month-picker.png')
 await assistant(`document.querySelector('.due-date-popover:popover-open [aria-label="${today}"]').click()`)
 await until(()=>main(`window.toolbox.data.get().then(data=>data.todos.find(todo=>todo.id===${JSON.stringify(added.id)}).dueAt===${JSON.stringify(new Date(today+'T23:59:00').toISOString())})`))
 assert.equal((await main(`window.toolbox.data.get().then(data=>data.todos.find(todo=>todo.id===${JSON.stringify(added.id)}))`)).createdAt,added.createdAt)
 check('date text accepts typed dates; the icon opens a full 42-cell month; rescheduling never changes creation time')
 report.layouts=[]
 for(const width of [300,420,540]){
  await fs.writeFile(path.join(directory,'resize'),JSON.stringify({width,height:720}));await until(()=>assistant(`innerWidth===${width}`))
  await click('[data-tool="todos"]')
  const layout=await assistant(`(()=>{const overview=document.querySelector('.assistant-overview'),content=document.querySelector('.todo-content');return {width:innerWidth,overviewOverflow:overview.scrollWidth>overview.clientWidth+1,todoOverflow:content.scrollWidth>content.clientWidth+1,counts:[...document.querySelectorAll('.todo-filter small')].length}})()`)
  await assistant(`document.querySelector('.desktop-todo-list').scrollTop=0`)
  assert.equal(layout.overviewOverflow,false);assert.equal(layout.todoOverflow,false);assert.equal(layout.counts,4);report.layouts.push(layout);await screenshot(page,`overview-${width}.png`)
 }
 await click('[aria-label="设置"]')
 await main(`(async()=>{const data=await window.toolbox.data.get();await window.toolbox.settings.update({hydrationPlan:{...data.settings.hydrationPlan,enabled:true,goalMl:2000,cupMl:250,start:'00:00',end:'01:00',times:undefined},hydrationReminderEnabled:true})})()`)
 await until(()=>assistant(`Boolean(document.querySelector('.time-range input'))`))
 const range=await assistant(`(()=>{const inputs=[...document.querySelectorAll('.time-range input')].map(input=>input.getBoundingClientRect());return {sameRow:Math.abs(inputs[0].y-inputs[1].y)<1,arrow:document.querySelector('.time-arrow')?.textContent}})()`)
 assert.equal(range.sameRow,true);assert.equal(range.arrow,'→')
 await screenshot(page,'time-range.png')
 await click('[aria-label="返回助手"]')
 await until(()=>assistant(`document.querySelector('.water-icon').disabled && document.querySelector('.water-icon small').textContent==='已结束'`))
 const before=await main(`window.toolbox.wellness.get()`)
 assert.ok(before.hydrationPlan.nextCupMl>0)
 assert.equal(await main(`window.toolbox.wellness.respond('hydration','done').then(()=>false,()=>true)`),true)
 const after=await main(`window.toolbox.wellness.get()`)
 assert.equal(after.hydrationPlan.consumedMl,before.hydrationPlan.consumedMl)
 await screenshot(page,'hydration-ended.png')
 check('start and end share one row with an arrow; ended hydration is disabled and rejected by IPC while remaining water stays recorded')
 report.ok=true
}catch(error){report.error=String(error);console.error(error);process.exitCode=1}
finally{closeAll();for(const session of protocolSessions.values())session.ws.close();await fs.writeFile(path.join(directory,'quit'),'quit');const timer=setTimeout(()=>child.kill(),15000);await exited;clearTimeout(timer);await fs.writeFile(path.join(evidence,'runtime-report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(evidence,'electron.log'),logs);console.log(JSON.stringify(report))}
