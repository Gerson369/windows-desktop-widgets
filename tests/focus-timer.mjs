import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { connect, until, closeAll } from '../scripts/cdp-check-client.mjs'

const require=createRequire(import.meta.url)
const { loadTypeScript }=require('./load-typescript.cjs')
const { defaultData }=loadTypeScript('src/main/types.ts')
const directory=await fs.mkdtemp(path.resolve('.focus-timer-e2e-data-'))
const desktop=path.join(directory,'public-desktop'),port=9564
const expectRegression=process.argv.includes('--expect-regression')
await fs.mkdir(path.join(directory,'data'));await fs.mkdir(desktop)
const initial=defaultData()
Object.assign(initial.settings,{desktopWidgetVersion:5,desktopCollected:false,desktopHoverExpandEnabled:false,desktopModuleOpacity:88,healthSoundEnabled:false,shortcuts:[],autoStart:false,hydrationReminderEnabled:false,sedentaryReminderEnabled:false})
for(const module of initial.desktopModules)module.visible=module.id==='todos'
Object.assign(initial.desktopModules.find(module=>module.id==='todos'),{x:40,y:60,width:420,height:650,collapsed:false})
initial.desktopModules.push({id:'focus',kind:'focus',title:'专注计时',visible:false,collapsed:false,x:480,y:60,width:300,height:650})
await fs.writeFile(path.join(directory,'data','toolbox-data.json'),JSON.stringify(initial))
const env={...process.env,GERSON_E2E_DEBUG:'1',GERSON_E2E_DEBUG_PORT:String(port),GERSON_E2E_DATA_DIRECTORY:directory,GERSON_E2E_SKIP_DESKTOP:'1',GERSON_E2E_DESKTOP_DIRECTORY:desktop}
delete env.ELECTRON_RUN_AS_NODE
const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),[path.resolve('scripts/compact-assistant-host.cjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']})
const exited=once(child,'close')
let logs='',evaluate,page,failure
child.stdout.on('data',bytes=>{logs+=bytes});child.stderr.on('data',bytes=>{logs+=bytes})
const report={ok:false,directory,expectRegression,checks:[],samples:[],screenshots:[],notificationChecks:[],notifications:[],disclosure:'真实应用窗口；边界检查通过宿主clock文件控制主进程时间，并控制TimeCard缓存interval，不改写渲染器Date.now。截图前移除clock并原生重载。所有测试通知仅写独立日志，禁止向操作系统发卡片。'}
const getFocus=()=>evaluate('window.toolbox.data.get().then(data=>data.suite.focus)')
const seconds=text=>{assert.match(text,/^\d{2,}:\d{2}$/);const [minutes,seconds]=text.split(':').map(Number);return minutes*60+seconds}
async function readNotifications() {
  try {return (await fs.readFile(path.join(directory,'notifications.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}
  catch(error){if(error.code==='ENOENT')return [];throw error}
}
async function expectNotificationCount(stage,count) {
  const notifications=(await readNotifications()).filter(item=>item.title==='专注计时结束')
  report.notificationChecks.push({stage,at:Date.now(),count:notifications.length})
  assert.equal(notifications.length,count,stage)
  return notifications
}

async function protocol(method,params={}) {
  const socket=new WebSocket(page.webSocketDebuggerUrl)
  try {
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
    return await new Promise((resolve,reject)=>{
      socket.onmessage=({data})=>{const response=JSON.parse(String(data));if(response.id===1)response.error?reject(Error(response.error.message)):resolve(response.result)}
      socket.send(JSON.stringify({id:1,method,params}))
    })
  } finally {socket.close()}
}
async function settle(){await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')}
async function tool(id) {
  await evaluate(`document.querySelector('[data-tool="${id}"]').click()`)
  await until(()=>evaluate(`document.querySelector('[data-tool="${id}"]').getAttribute('aria-selected')==='true' && ${id==='focus' ? "Boolean(document.querySelector('.focus-display'))" : 'true'}`))
  await settle()
}
async function reloadFocus() {
  const origin=await evaluate('performance.timeOrigin')
  await protocol('Page.reload')
  await until(async()=>{try{return await evaluate(`performance.timeOrigin!==${origin} && Boolean(document.querySelector('[data-tool=focus]'))`)}catch{return false}})
  await tool('focus')
}
async function clickControl(text) {
  await until(()=>evaluate(`[...document.querySelectorAll('.focus-controls button')].some(button=>button.textContent.trim()===${JSON.stringify(text)} && !button.disabled)`))
  await evaluate(`[...document.querySelectorAll('.focus-controls button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`)
}
async function reset() {
  await clickControl('重置')
  await until(async()=>{const clock=await getFocus();return clock.endAt===null && clock.remainingSeconds===clock.durationSeconds})
  await settle()
}
async function observe() {
  await evaluate(`(()=>{
    window.__focusObserver?.disconnect();window.__focusFrames=[];
    window.__readFocusFrame=()=>{const text=document.querySelector('.focus-display')?.textContent;if(text)window.__focusFrames.push({at:Date.now(),text})};
    window.__focusObserver=new MutationObserver(window.__readFocusFrame);window.__focusObserver.observe(document.querySelector('.focus-display'),{childList:true,characterData:true,subtree:true});
  })()`)
}
async function sample(name,maximum) {
  await settle()
  const result=await evaluate(`(()=>{window.__readFocusFrame();return {name:${JSON.stringify(name)},text:document.querySelector('.focus-display').textContent,frames:window.__focusFrames.slice(),cachedAge:window.__focusClock?Date.now()-window.__focusClock.lastTick:null}})()`)
  result.clock=await getFocus();report.samples.push(result)
  for(const frame of result.frames)assert.ok(seconds(frame.text)<=maximum, `${name} displayed ${frame.text}, above ${maximum}s`)
  return result
}
async function start(minutes=25) {
  await observe()
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="专注分钟"]');input.value=${JSON.stringify(String(minutes))};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await until(()=>evaluate(`!document.querySelector('.focus-form button').disabled`))
  await evaluate("document.querySelector('.focus-form').requestSubmit()")
  await until(async()=>{const clock=await getFocus();return clock.endAt!==null && clock.remainingSeconds===minutes*60})
  await settle()
}
async function screenshot(name) {
  await until(()=>evaluate("document.fonts.status==='loaded'"))
  assert.doesNotMatch(await evaluate('document.body.innerText'),/C:\\Users\\|D:\\|\.focus-timer-e2e-data-/i)
  const result=await protocol('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  const filename=path.join(directory,name)
  await fs.writeFile(filename,Buffer.from(result.data,'base64'));report.screenshots.push(filename)
}

try {
  await until(async()=>{try{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();page=pages.find(target=>target.url.includes('desktopModule=todos'));return Boolean(page)}catch{return false}})
  evaluate=await connect(page)
  await until(()=>evaluate("Boolean(document.querySelector('[data-tool=focus]'))"))
  await evaluate(`(()=>{
    const state={hold:true,lastTick:Date.now(),captured:0,nativeSetInterval:window.setInterval.bind(window)};
    window.__focusClock=state;
    window.setInterval=(callback,delay,...args)=>{
      if(delay===1000 && typeof callback==='function' && String(callback).includes('Date.now') && document.querySelector('.focus-panel')){
        state.lastTick=Date.now();state.captured++;state.tick=()=>{callback(...args);state.lastTick=Date.now()};
        return state.nativeSetInterval(()=>{if(!state.hold)state.tick()},delay);
      }
      return state.nativeSetInterval(callback,delay,...args);
    };
  })()`)
  await tool('focus')
  assert.equal(await evaluate('window.__focusClock.captured'),1)
  await sleep(220)
  await start(25)
  const initialFrame=await evaluate("document.querySelector('.focus-display').textContent")
  report.initial={text:initialFrame,clock:await getFocus(),cachedAge:await evaluate('Date.now()-window.__focusClock.lastTick')}
  if(expectRegression) {
    assert.equal(initialFrame,'25:01','old build must reproduce the extra second with a stale component tick')
    await screenshot('focus-old-2501.png')
    report.checks.push('old production build reproduces 25:01 after a real 25-minute start with only the component tick held')
  } else {
    assert.equal(initialFrame,'25:00')
    await sample('initial 25-minute start',1500)
    await expectNotificationCount('25-minute round is still running',0)
    await sleep(1250);await clickControl('暂停')
    await until(async()=> (await getFocus()).endAt===null)
    const paused=await getFocus()
    assert.ok(paused.remainingSeconds<1500)
    assert.equal(seconds(await evaluate("document.querySelector('.focus-display').textContent")),paused.remainingSeconds)
    await observe();await sleep(120);await clickControl('继续')
    await until(async()=> (await getFocus()).endAt!==null)
    const resumed=await sample('resume with stale renderer time',paused.remainingSeconds)
    assert.equal(resumed.clock.remainingSeconds,paused.remainingSeconds)
    await expectNotificationCount('resumed round has not reached its deadline',0)
    report.checks.push('starting 25 minutes never shows 25:01; pause/resume cannot add a second even while its renderer tick is stale')

    for(const [index,age] of [20,950,1050].entries()) {
      await reset();await evaluate('window.__focusClock.tick()');await sleep(age)
      await start(index===1?1:25)
      await sample(`new round after ${age}ms cached tick`,index===1?60:1500)
    }
    await reset();await evaluate('window.__focusClock.tick()')
    await evaluate('(()=>{const until=performance.now()+1350;while(performance.now()<until){}})()')
    await start(25);await sample('new round after 1350ms renderer long task',1500)
    await reset();assert.equal(await evaluate("document.querySelector('.focus-display').textContent"),'25:00')
    await expectNotificationCount('reset and new rounds remain unfinished',0)
    report.checks.push('repeated reset/new rounds and 20/950/1050ms cached-tick ages plus a 1350ms renderer task never exceed their chosen duration')

    await evaluate('window.__focusClock.hold=false;window.setInterval=window.__focusClock.nativeSetInterval;window.__focusClock.tick()')
    await evaluate("window.toolbox.suite.focus('start',10)")
    const deadline=(await getFocus()).endAt
    await tool('todos');await sleep(350);await tool('focus')
    assert.equal((await getFocus()).endAt,deadline)
    await observe();await sample('after switching tools',10)
    await reloadFocus()
    assert.equal((await getFocus()).endAt,deadline)
    await observe();await sleep(1250)
    const reloaded=await sample('after renderer reload',10)
    assert.ok(seconds(reloaded.text)<10)
    assert.equal(reloaded.clock.endAt,deadline)
    assert.ok(Date.now()<deadline)
    await expectNotificationCount('tool switch and reload are before deadline',0)
    report.checks.push('switching tools and reloading the renderer preserve the real stored deadline and continue its elapsed countdown')

    await reset()
    const mainClockBase=Date.now()
    const setMainClock=async value=>{
      await fs.writeFile(path.join(directory,'clock.next'),String(value))
      await fs.rename(path.join(directory,'clock.next'),path.join(directory,'clock'))
    }
    await setMainClock(mainClockBase)
    await evaluate("window.toolbox.suite.focus('start',1500)")
    const boundaryClock=await getFocus()
    assert.equal(boundaryClock.endAt,mainClockBase+1500000)
    await setMainClock(boundaryClock.endAt-900000);await sleep(1150)
    const fifteenMinutes=await getFocus()
    assert.equal(fifteenMinutes.endAt,boundaryClock.endAt);assert.equal(fifteenMinutes.notified,false)
    await expectNotificationCount('25-minute round still has 15 minutes remaining on main clock',0)
    await setMainClock(boundaryClock.endAt-1);await sleep(1150)
    const beforeDeadline=await getFocus()
    assert.equal(beforeDeadline.endAt,boundaryClock.endAt);assert.equal(beforeDeadline.notified,false)
    await expectNotificationCount('one millisecond before the main-process deadline',0)
    await setMainClock(boundaryClock.endAt)
    await until(async()=>{const clock=await getFocus();return clock.endAt===null && clock.remainingSeconds===0 && clock.notified})
    await until(async()=> (await readNotifications()).filter(item=>item.title==='专注计时结束').length===1)
    const boundaryNotices=await expectNotificationCount('exact main-process deadline',1)
    assert.equal(boundaryNotices[0].at,boundaryClock.endAt)
    await sleep(1150)
    assert.deepEqual(await expectNotificationCount('repeat main timer tick after exact deadline',1),boundaryNotices)
    report.mainClockBoundary={injectedClockOnlyInMain:true,start:mainClockBase,deadline:boundaryClock.endAt,fifteenMinutes,beforeDeadline,completed:await getFocus(),notifications:boundaryNotices}
    await fs.rm(path.join(directory,'clock'))
    report.checks.push('main-only clock checks preserve a 25-minute round at 15 minutes remaining and deadline minus 1ms; exact deadline captures one notification without repeats')

    await reset();await observe()
    const requestedAt=Date.now()
    await evaluate("window.toolbox.suite.focus('start',3)")
    const shortClock=await getFocus()
    report.shortRound={requestedAt,deadline:shortClock.endAt,durationSeconds:shortClock.durationSeconds}
    await until(()=>evaluate("document.querySelector('.focus-display').textContent==='00:00'"))
    const completed=await sample('three-second API round reaches zero',3)
    assert.equal(completed.text,'00:00')
    for(let index=1;index<completed.frames.length;index++)assert.ok(seconds(completed.frames[index].text)<=seconds(completed.frames[index-1].text))
    await until(async()=>{const clock=await getFocus();return clock.endAt===null && clock.remainingSeconds===0 && clock.notified})
    await until(async()=> (await readNotifications()).filter(item=>item.title==='专注计时结束').length===boundaryNotices.length+1)
    const notices=await expectNotificationCount('three-second round adds exactly one completed notification',boundaryNotices.length+1)
    const shortNotices=notices.slice(boundaryNotices.length)
    assert.equal(shortNotices.length,1)
    assert.equal(shortNotices[0].body,'这一轮已完成，可以休息一下。')
    assert.ok(shortNotices[0].at>=shortClock.endAt,'completion notification cannot precede its deadline')
    await sleep(1150)
    assert.deepEqual(await expectNotificationCount('one further real timer tick does not duplicate completion',notices.length),notices)
    report.notifiedEvidence={clock:await getFocus(),deadline:shortClock.endAt,notifications:shortNotices,observedAt:Date.now(),afterDeadlineMs:shortNotices[0].at-shortClock.endAt}
    report.checks.push('a real three-second service round counts down monotonically to 00:00 and persists completion without negative values')
    report.checks.push('unfinished rounds produce no notifications; the completed short round is captured once at or after its deadline, with Windows delivery disabled by the test host')

    await reloadFocus();await reset();await start(25)
    assert.equal(await evaluate("typeof window.__focusClock==='undefined' && window.setInterval.toString().includes('[native code]')"),true)
    assert.equal(await evaluate("document.querySelector('.focus-display').textContent"),'25:00')
    await screenshot('focus.png')
    assert.equal(await evaluate("Date.now.toString().includes('[native code]')"),true)
    assert.equal(await fs.access(path.join(directory,'clock')).then(()=>true,()=>false),false)
    report.checks.push('final focus screenshot captures a real running 25:00 round using the native renderer clock and isolated public data')
    await expectNotificationCount('a fresh 25-minute round does not inherit a completed notification',notices.length)
    await clickControl('暂停')
  }
  report.ok=true
}catch(error){report.error=String(error);failure=error}
finally {
  closeAll();await fs.writeFile(path.join(directory,'quit'),'quit')
  const timer=setTimeout(()=>child.kill(),15000);await exited;clearTimeout(timer)
  report.notifications=await readNotifications()
  await fs.writeFile(path.join(directory,'runtime.log'),logs)
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2))
}
console.log(JSON.stringify(report))
if(failure)throw failure
