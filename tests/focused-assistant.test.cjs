const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {loadTypeScript}=require('./load-typescript.cjs')
const { createCategoryLayoutPlan, decodeNativeOutput } = loadTypeScript('src/main/desktop-layout.ts')
const { normalizeReminderSettings, tickReminders, resumeReminderClocks } = loadTypeScript('src/main/wellness-reminders.ts')
const { defaultHydrationPlan, validateHydrationPlan, hydrationTimes, hydrationDayAt, hydrationPlanClock, hydrationPlanSnapshot, recordHydration } = loadTypeScript('src/main/hydration-plan.ts')
test('daily water plan retains legacy schedules without coupling them to new reminder timing', () => {
  const plan = validateHydrationPlan({...defaultHydrationPlan,enabled:true})
  assert.equal(hydrationTimes(plan).length,8)
  assert.equal(hydrationTimes(plan)[0],'10:13')
  assert.deepEqual(hydrationTimes({...plan,cupMl:0}),[])
  assert.deepEqual(validateHydrationPlan({...plan,times:['09:30']}).times,['09:30'])
  assert.equal(validateHydrationPlan({...plan,start:'19:50'}).start,'19:50')
  for(const patch of [{goalMl:0},{cupMl:NaN},{end:'08:00'},{times:['25:00']},{times:Array(101).fill('10:00')}]) assert.throws(()=>validateHydrationPlan({...plan,...patch}))
})
test('daily water clock divides remaining time and cups, retains running clocks and stops at day end or goal', () => {
  const at=(h,m=0)=>new Date(2026,9,19,h,m).getTime()
  const plan=validateHydrationPlan({...defaultHydrationPlan,enabled:true})
  const day=hydrationDayAt(undefined,at(9))
  const clock=hydrationPlanClock(plan,day,undefined,at(12))
  assert.equal(clock.dueAt,at(12)+(at(20)-at(12))/9)
  assert.equal(hydrationPlanClock(plan,day,clock,at(13)),clock)
  assert.equal(hydrationPlanClock(plan,day,undefined,at(20)),undefined)
  assert.equal(hydrationPlanClock(plan,day,undefined,at(8)).startedAt,at(9))
  const completed={...day,consumedMl:250,completedTimes:['12:40']}
  assert.equal(hydrationPlanClock(plan,completed,undefined,at(12)).dueAt,at(13))
  assert.equal(hydrationPlanClock(plan,{...day,consumedMl:2000},clock,at(13)),undefined)
  assert.equal(hydrationPlanSnapshot(plan,{...day,consumedMl:1900},at(13)).nextCupMl,100)
  assert.equal(hydrationDayAt(completed,new Date(2026,9,20,9).getTime()).consumedMl,0)
  assert.deepEqual(hydrationDayAt(completed,at(15)),completed)
})
test('actual water records work in both modes at any hour, exceed the target and deduplicate each confirmation',()=>{
  const at=hour=>new Date(2026,9,29,hour).getTime()
  const day={...hydrationDayAt(undefined,at(8)),consumedMl:4900,completedTimes:['07:30'],lastCupAt:at(7)}
  const before=structuredClone(day)
  for(const enabled of [false,true])for(const now of [at(8),at(12),at(22)]){
    const plan={...defaultHydrationPlan,enabled},saved=recordHydration(plan,day,1500,now,'confirmed-cup')
    assert.equal(saved.consumedMl,6400)
    assert.equal(saved.lastCupAt,now)
    assert.deepEqual(saved.completedTimes,day.completedTimes)
    assert.deepEqual(saved.recordIds,['confirmed-cup'])
    assert.deepEqual(recordHydration(plan,saved,1500,now+1000,'confirmed-cup'),saved)
    assert.equal(hydrationDayAt(saved,now+1000).consumedMl,6400)
  }
  assert.deepEqual(day,before)
})
test('actual water records validate amounts and identifiers and never silently truncate the daily limit',()=>{
  const now=new Date(2026,9,29,12).getTime(),plan={...defaultHydrationPlan,enabled:true}
  const day={...hydrationDayAt(undefined,now),consumedMl:99900}
  for(const amount of [0,-1,1.5,NaN,Infinity,2001,'250'])assert.throws(()=>recordHydration(plan,day,amount,now,'valid-id'))
  for(const id of ['',null,'white space','../path','x'.repeat(101)])assert.throws(()=>recordHydration(plan,day,100,now,id))
  const saved=recordHydration(plan,day,100,now,'valid-id')
  assert.equal(saved.consumedMl,100000)
  assert.deepEqual(recordHydration(plan,saved,100,now+1000,'valid-id'),saved)
  assert.throws(()=>recordHydration(plan,saved,1,now+1000,'another-id'),/100000/)
  assert.equal(day.consumedMl,99900)
  assert.throws(()=>recordHydration(plan,day,1,NaN,'valid-id'),/时间/)
})
test('daily normalization retains legacy history and valid confirmation ids but resets them on the next day',()=>{
  const now=new Date(2026,9,29,12).getTime(),day={...hydrationDayAt(undefined,now),consumedMl:6000,completedTimes:['10:00'],lastCupAt:now,recordIds:['a','a','../bad','b']}
  assert.deepEqual(hydrationDayAt(day,now),{...day,recordIds:['a','b']})
  const tomorrow=hydrationDayAt(day,now+86400000)
  assert.equal(tomorrow.consumedMl,0);assert.deepEqual(tomorrow.completedTimes,[])
  assert.equal(tomorrow.lastCupAt,undefined);assert.equal(tomorrow.recordIds,undefined)
})
test('actual drinks redistribute only the remaining cups and short windows never create catch-up bursts',()=>{
  const at=(h,m=0)=>new Date(2026,9,29,h,m).getTime()
  const plan=validateHydrationPlan({...defaultHydrationPlan,enabled:true,times:['09:10']})
  const day=hydrationDayAt(undefined,at(9)),initial=hydrationPlanClock(plan,day,undefined,at(12))
  const early=recordHydration(plan,day,1000,at(12,10),'early')
  const reflowed=hydrationPlanClock(plan,early,initial,at(12,10))
  assert.equal(reflowed.startedAt,at(12,10));assert.equal(reflowed.dueAt,at(13,44))
  const late=recordHydration(plan,day,1000,at(15),'late')
  assert.equal(hydrationPlanClock(plan,late,initial,at(15)).dueAt,at(16))
  assert.equal(hydrationPlanClock({...plan,times:['18:00']},day,initial,at(12,10)),initial)
  const brief=validateHydrationPlan({...plan,start:'19:50',end:'20:00'})
  assert.equal(hydrationPlanClock(brief,day,undefined,at(19,50)).intervalMinutes,5)
  assert.equal(hydrationPlanClock(brief,day,undefined,at(19,55)),undefined)
  assert.equal(hydrationPlanClock(plan,{...day,consumedMl:2100},initial,at(15)),undefined)
})
function iconModule(overrides = {}) {
  const image = value => ({isEmpty:()=>!value, toBitmap:()=>Buffer.from([0,0,0,value ? 255 : 0]), toDataURL:()=>value})
  return loadTypeScript('src/main/file-icons.ts', {
    electron: { app: {getFileIcon:async()=>image('electron-icon')}, nativeImage:{createFromDataURL:image}, shell:{readShortcutLink:()=>({target:'app.exe',icon:'custom.dll',iconIndex:-17})}, ...overrides.electron },
    './desktop-host': {shellFileIcon:overrides.shellFileIcon || (async()=>'native-icon'),shellThumbnail:overrides.shellThumbnail || (async()=>{throw Error('no thumbnail')})},
    'node:fs/promises': {readFile:async()=>'[InternetShortcut]\nIconFile="game.ico"\nIconIndex=3'}
  })
}
test('internet shortcuts preserve explicit icon file, resource index and INI section boundaries', () => {
  const { internetShortcutIcon }=iconModule()
  assert.deepEqual(internetShortcutIcon('\ufeff[InternetShortcut]\r\nIconFile="C:\\Game art\\game.ico"\r\nIconIndex=-12\r\n[Other]\r\nIconFile=wrong.ico'),{path:'C:\\Game art\\game.ico',index:-12})
  assert.deepEqual(internetShortcutIcon('[InternetShortcut]\niconfile=game.ico\niconindex=bad'),{path:'game.ico',index:0})
  assert.equal(internetShortcutIcon('[Other]\nIconFile=wrong.ico'),undefined)
})
test('shortcut icons prefer their own resource and index, share pending loads, and retain shell fallback', {skip:process.platform!=='win32'}, async () => {
  const calls=[]
  const icons=iconModule({shellFileIcon:async(path,index)=>{calls.push([path,index]);return 'native:'+path}})
  const first=icons.readFileIcon('app.lnk')
  assert.equal(first,icons.readFileIcon('app.lnk'))
  assert.equal(await first,'native:custom.dll')
  assert.deepEqual(calls,[['custom.dll',-17]])
  assert.equal(await icons.readFileIcon('game.url'),'native:game.ico')
  assert.deepEqual(calls.at(-1),['game.ico',3])
  const fallbackCalls=[]
  const fallback=iconModule({shellFileIcon:async(path,index)=>{fallbackCalls.push([path,index]);if(path!=='broken.lnk')throw Error('resource missing');return 'shell-icon'}})
  assert.equal(await fallback.readFileIcon('broken.lnk'),'shell-icon')
  assert.deepEqual(fallbackCalls,[['custom.dll',-17],['app.exe',0],['broken.lnk',undefined]])
})
test('temporary icon failures are not cached and can recover on the next request', {skip:process.platform!=='win32'}, async () => {
  let ready=false
  const icons=iconModule({shellFileIcon:async()=>{if(!ready)throw Error('busy');return 'recovered-icon'},electron:{app:{getFileIcon:async()=>{throw Error('busy')}}}})
  await assert.rejects(icons.readFileIcon('app.lnk'),/未读取到可见图标/)
  ready=true
  assert.equal(await icons.readFileIcon('app.lnk'),'recovered-icon')
})
test('a failed icon refresh retains the last good image and recovers later', {skip:process.platform!=='win32'}, async () => {
  let image='original-icon'
  const icons=iconModule({shellFileIcon:async()=>{if(!image)throw Error('busy');return image},electron:{app:{getFileIcon:async()=>{throw Error('busy')}}}})
  assert.equal(await icons.readFileIcon('app.lnk'),'original-icon')
  image='';icons.clearFileIcons()
  assert.equal(await icons.readFileIcon('app.lnk'),'original-icon')
  image='updated-icon'
  assert.equal(await icons.readFileIcon('app.lnk'),'updated-icon')
})
test('image and video thumbnails use Windows results and unavailable previews keep file icons', {skip:process.platform!=='win32'}, async () => {
  const icons=iconModule({shellThumbnail:async path=>{if(path.endsWith('.mp4'))throw Error('no codec');return 'thumbnail'}})
  assert.equal(await icons.readFileIcon('photo.png'),'thumbnail')
  assert.equal(await icons.readFileIcon('movie.mp4'),'electron-icon')
})
test('todo reminder schedules validate future times and persist delivery identity without repeated catch-up', () => {
  const {validateTodoReminder,dueTodoReminders}=loadTypeScript('src/main/todo-reminders.ts')
  const now=Date.parse('2026-10-19T10:00:00Z')
  const at=validateTodoReminder('2026-10-19T10:01:00Z',now)
  assert.equal(at,'2026-10-19T10:01:00.000Z')
  assert.equal(validateTodoReminder(null,now),undefined)
  assert.throws(()=>validateTodoReminder('yesterday',now),/将来/)
  assert.throws(()=>validateTodoReminder('2026-10-19T09:00:00Z',now),/将来/)
  const task={id:'one',completed:false,reminderAt:at}
  assert.deepEqual(dueTodoReminders([task],now),[])
  assert.deepEqual(dueTodoReminders([task],now+60000),[task])
  assert.deepEqual(dueTodoReminders([{...task,reminderNotifiedAt:at}],now+600000),[])
  assert.deepEqual(dueTodoReminders([{...task,completed:true}],now+600000),[])
  assert.deepEqual(dueTodoReminders([{...task,reminderAt:'invalid'}],now),[])
  assert.equal(dueTodoReminders([{...task,reminderNotifiedAt:'old-time'}],now+600000).length,1)
})
function layoutCase(count, workArea) {
  const categories = ['folder', 'shortcut', 'document', 'image', 'archive', 'installer', 'other']
  const entries = Array.from({ length: count }, (_, index) => ({ key: `item-${index}`, name: `项目${index}`, x: index * 3, y: index * 4 }))
  const layout = { createdAt: '2026-10-18T00:00:00Z', spacingX: 112, spacingY: 139, entries }
  const scan = { items: entries.map((entry, index) => ({ name: entry.name, category: categories[index % categories.length] })) }
  return { layout, scan, plan: createCategoryLayoutPlan(layout, scan, false, workArea) }
}

test('100 icons fit entirely within a 1920×1080 work area without changing the input', () => {
  const { layout, scan, plan } = layoutCase(100, { width: 1920, height: 1080 })
  assert.equal(plan.entries.length, 100)
  assert.ok(plan.entries.every(entry => entry.status === 'planned' && entry.x >= 0 && entry.y >= 0 && entry.x + plan.spacingX <= 1920 && entry.y + plan.spacingY <= 1080))
  assert.equal(new Set(plan.entries.map(entry => `${entry.x},${entry.y}`)).size, 100)
  assert.deepEqual(plan, createCategoryLayoutPlan(layout, scan, false, { width: 1920, height: 1080 }))
  assert.equal(layout.entries[5].x, 15)
  assert.equal(layout.entries[5].y, 20)
})
test('capacity overflow is explicit and leaves skipped icons at their original positions', () => {
  const { layout, plan } = layoutCase(13, { width: 448, height: 417 })
  assert.equal(plan.entries.filter(entry => entry.status === 'planned').length, 12)
  const skipped = plan.entries.find(entry => entry.status === 'skipped')
  const original = layout.entries.find(entry => entry.key === skipped.path)
  assert.equal(skipped.x, original.x)
  assert.equal(skipped.y, original.y)
  assert.ok(plan.warnings.some(text => text.includes('12')))
})
test('tiny work areas produce no invalid or overlapping planned positions', () => {
  const { plan } = layoutCase(10, { width: 80, height: 80 })
  assert.ok(plan.entries.every(entry => entry.status === 'skipped' && Number.isFinite(entry.x) && Number.isFinite(entry.y)))
})
test('empty layouts and Explorer automatic arrangement retain meaningful status', () => {
  const { layout, scan } = layoutCase(0, { width: 1920, height: 1080 })
  const plan = createCategoryLayoutPlan(layout, scan, true, { width: 1920, height: 1080 })
  assert.equal(plan.entries.length, 0)
  assert.equal(plan.autoArrangeDetected, true)
  assert.ok(plan.warnings.some(text => text.includes('自动排列')))
})
const enabled = { hydrationReminderEnabled: true, hydrationIntervalMinutes: 45, sedentaryReminderEnabled: true, sedentaryIntervalMinutes: 60 }
test('reminders wait a full interval and hydration and break clocks run independently', () => {
  const initial = tickReminders(enabled, {}, 0)
  assert.deepEqual(initial.due, [])
  const water = tickReminders(enabled, initial.state, 45 * 60_000)
  assert.deepEqual(water.due, ['hydration'])
  const rest = tickReminders(enabled, water.state, 60 * 60_000)
  assert.deepEqual(rest.due, ['sedentary'])
  assert.equal(rest.state.hydration.dueAt, 45 * 60_000)
  assert.equal(rest.state.hydration.notified, true)
  assert.deepEqual(tickReminders(enabled, rest.state, 120 * 60_000).due, [])
})
test('disabled and changed reminders restart their interval without catch-up bursts', () => {
  const initial = tickReminders(enabled, {}, 0)
  const disabled = tickReminders({ ...enabled, hydrationReminderEnabled: false, sedentaryReminderEnabled: false }, initial.state, 500)
  assert.deepEqual(disabled.state, {})
  const restarted = tickReminders(enabled, disabled.state, 1000)
  assert.equal(restarted.state.hydration.dueAt, 1000 + 45 * 60_000)
  const changed = tickReminders({ ...enabled, hydrationIntervalMinutes: 30 }, restarted.state, 2000)
  assert.equal(changed.state.hydration.dueAt, 2000 + 30 * 60_000)
  const delayed = tickReminders(enabled, initial.state, 10 * 60 * 60_000)
  assert.deepEqual(delayed.due, ['hydration', 'sedentary'])
  assert.equal(delayed.state.hydration.notified, true)
  assert.deepEqual(tickReminders(enabled, delayed.state, 11 * 60 * 60_000).due, [])
})
test('reminder normalization bounds persisted and IPC inputs', () => {
  const normalized = normalizeReminderSettings({ hydrationIntervalMinutes: -100, sedentaryIntervalMinutes: Infinity, hydrationReminderEnabled: 'yes' }, enabled)
  assert.equal(normalized.hydrationIntervalMinutes, 5)
  assert.equal(normalized.sedentaryIntervalMinutes, 60)
  assert.equal(normalized.hydrationReminderEnabled, true)
  assert.equal(normalizeReminderSettings({ hydrationIntervalMinutes: 1000 }, enabled).hydrationIntervalMinutes, 240)
})

test('native output accepts both UTF-8 and legacy Chinese console encoding', () => {
  assert.equal(decodeNativeOutput(Buffer.from('桌面图标', 'utf8')), '桌面图标')
  assert.equal(decodeNativeOutput(Buffer.from([0xd6, 0xd0])), '中')
})
test('layout respects work-area offsets such as a top or left taskbar', () => {
  const { layout, scan } = layoutCase(10, { width: 1920, height: 1080 })
  const plan = createCategoryLayoutPlan(layout, scan, false, { x: 48, y: 32, width: 1920, height: 1080 })
  assert.ok(plan.entries.every(entry => entry.x >= 48 && entry.y >= 32 && entry.x + plan.spacingX <= 1968 && entry.y + plan.spacingY <= 1112))
})

const { synchronizeDesktopGroups, placeStartupWidgets } = loadTypeScript('src/main/desktop-widgets.ts')
const { defaultData } = loadTypeScript('src/main/types.ts')
test('external rename preserves manual classification by unique file identity, without confusing replacements or hard links', () => {
  const { renamedDesktopPaths }=loadTypeScript('src/main/desktop-widgets.ts')
  const data=defaultData()
  const old={path:'C:/Desktop/a.pdf',name:'a.pdf',category:'document',identity:'1:10'}
  synchronizeDesktopGroups(data,[old],{x:0,y:0,width:1920,height:1040},'2026-10-19T00:00:00Z')
  data.desktopAssignments[old.path]='desktop-images'
  const next={...old,path:'C:/Desktop/b.pdf',name:'b.pdf'}
  synchronizeDesktopGroups(data,[next],{x:0,y:0,width:1920,height:1040},'2026-10-19T00:00:01Z')
  assert.equal(data.desktopAssignments[next.path],'desktop-images')
  assert.equal(data.desktopAssignments[old.path],undefined)
  assert.deepEqual(data.desktopZones.find(zone=>zone.id==='desktop-images').itemIds,[next.path])
  assert.equal(renamedDesktopPaths([old],[{...next,identity:'1:11'}]).size,0)
  assert.equal(renamedDesktopPaths([old],[next,{...next,path:'C:/Desktop/c.pdf'}]).size,0)
  assert.equal(renamedDesktopPaths([old],[old,next]).size,0)
})
test('extension rules classify unassigned files while manual classification and folders retain priority', () => {
  const {normalizeCollectionRules}=loadTypeScript('src/main/desktop-collection.ts')
  assert.deepEqual(normalizeCollectionRules({'.PDF':'images',psd:'images','../bad':'apps',exe:'bad'}),{pdf:'images',psd:'images'})
  const data=defaultData()
  data.settings.collectionRules={pdf:'images'}
  const items=[{path:'C:/Desktop/a.pdf',name:'a.pdf',extension:'pdf',category:'document',isDirectory:false},{path:'C:/Desktop/b.pdf',name:'b.pdf',extension:'pdf',category:'document',isDirectory:false},{path:'C:/Desktop/folder.pdf',name:'folder.pdf',extension:'pdf',category:'folder',isDirectory:true}]
  synchronizeDesktopGroups(data,items,{x:0,y:0,width:1920,height:1040},'2026-10-19T00:00:00Z')
  data.desktopAssignments[items[1].path]='desktop-documents'
  synchronizeDesktopGroups(data,items,{x:0,y:0,width:1920,height:1040},'2026-10-19T00:00:01Z')
  assert.deepEqual(data.desktopZones.find(zone=>zone.id==='desktop-images').itemIds,[items[0].path])
  assert.ok(data.desktopZones.find(zone=>zone.id==='desktop-documents').itemIds.includes(items[1].path))
  assert.ok(data.desktopZones.find(zone=>zone.id==='desktop-folders').itemIds.includes(items[2].path))
})
test('component layout backups restore presentation and assignments while preserving file and todo data', () => {
  const { captureWidgetLayout,applyWidgetLayout,validWidgetLayout }=loadTypeScript('src/main/widget-layout.ts',{'./desktop-collection':loadTypeScript('src/main/desktop-collection.ts')})
  const data=defaultData()
  synchronizeDesktopGroups(data,[{path:'C:/Desktop/a.pdf',name:'a.pdf',category:'document'}],{x:0,y:0,width:1920,height:1040},'2026-10-19T00:00:00Z')
  data.desktopAssignments['C:/Desktop/a.pdf']='desktop-images'
  data.todos=[{id:'keep',title:'keep',completed:false}]
  const backup=captureWidgetLayout(data,'backup','test','2026-10-19T00:00:00Z')
  assert.equal(validWidgetLayout(backup),true)
  const original=structuredClone(data)
  data.desktopModules[0].x=100
  data.settings.desktopModuleOpacity=20
  data.desktopAssignments={}
  data.todos[0].completed=true
  applyWidgetLayout(data,backup)
  assert.deepEqual(data.desktopModules,original.desktopModules)
  assert.equal(data.settings.desktopModuleOpacity,original.settings.desktopModuleOpacity)
  assert.equal(data.todos[0].completed,true)
  assert.deepEqual(data.desktopItems,original.desktopItems)
  assert.deepEqual(data.desktopAssignments,original.desktopAssignments)
  assert.equal(validWidgetLayout({...backup,modules:[backup.modules[0],backup.modules[0]]}),false)
  assert.throws(()=>applyWidgetLayout(data,{...backup,opacity:NaN}),/无效/)
  const untrusted=structuredClone(backup);untrusted.modules[0].visible=false
  applyWidgetLayout(data,untrusted)
  assert.equal(data.desktopModules[0].visible,false)
})
test('opening positions widgets on the right below the top and preserves task and collection data', () => {
  const data = defaultData()
  const area = { x: -1920, y: 32, width: 1920, height: 1040 }
  const before = structuredClone(data)
  placeStartupWidgets(data, area)
  const quick = data.desktopModules.find(module => module.kind === 'quick')
  const todos = data.desktopModules.find(module => module.kind === 'todos')
  assert.equal(quick.x + quick.width, area.x + area.width - 20)
  assert.equal(quick.y, area.y + 80)
  assert.equal(todos.x + todos.width, quick.x)
  assert.equal(todos.y, quick.y)
  assert.deepEqual(data.todos, before.todos)
  assert.deepEqual(data.desktopItems, before.desktopItems)
  quick.x = -1500
  quick.y = 400
  placeStartupWidgets(data, area)
  assert.equal(quick.x + quick.width, -20)
  assert.equal(quick.y, 112)
  placeStartupWidgets(data, { x: 0, y: 0, width: 560, height: 800 })
  assert.equal(todos.y, quick.y + quick.height)
  assert.ok(todos.y + todos.height <= 784)
  assert.ok(quick.x >= 0 && todos.x >= 0)
})
test('widget migration preserves user data, disables unsafe sorting, and groups without writing files', () => {
  const data = defaultData()
  data.settings.desktopModeEnabled = false
  data.settings.desktopIconAutoSortEnabled = true
  data.todos = [{ id: 'keep', title: 'Keep this task' }]
  const items = [{ path: 'C:/Desktop/a.lnk', category: 'shortcut' }, { path: 'C:/Desktop/photo.png', category: 'image' }, { path: 'C:/Desktop/a.lnk', category: 'shortcut' }]
  const source = structuredClone(items)
  synchronizeDesktopGroups(data, items, { x: 0, y: 0, width: 1920, height: 1040 }, '2026-10-19T00:00:00Z')
  assert.equal(data.settings.desktopModeEnabled, true)
  assert.equal(data.settings.desktopIconAutoSortEnabled, false)
  assert.equal(data.desktopZones.length, 7)
  assert.deepEqual(data.desktopZones.find(z => z.id === 'desktop-apps').itemIds, ['C:/Desktop/a.lnk'])
  assert.deepEqual(items, source)
  assert.equal(data.todos[0].id, 'keep')
  assert.ok(data.desktopZones.every(z => z.x >= 0 && z.y >= 0 && z.x + z.width <= 1920 && z.y + z.height <= 1040))
  const moved = data.desktopZones[0]; moved.x = 12; moved.collapsed = true
  synchronizeDesktopGroups(data, [], { x: 0, y: 0, width: 1920, height: 1040 }, '2026-10-19T00:00:00Z')
  assert.equal(moved.x, 12)
  assert.equal(moved.collapsed, true)
  assert.deepEqual(moved.itemIds, [])
  assert.equal(data.desktopZones.length, 7)
})
test('normal launch shows widgets and has no startup coordinate-write path', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8')
  const startup = main.slice(main.indexOf('app.whenReady()'))
  assert.doesNotMatch(startup, /showMainWindow|applyBackup|runStartupDesktopCategoryLayout/)
  assert.doesNotMatch(startup, /placeStartupWidgets\(data, area\)/)
  assert.match(startup, /fitWidgetToWorkArea/)
  assert.match(startup, /void collectAtStartup\(\)/)
  const watcher = main.slice(main.indexOf('const resetDirectoryWatchers'), main.indexOf('const validCollections'))
  assert.doesNotMatch(watcher, /applyBackup|applyDesktopCategoryLayout/)
  assert.match(watcher, /refreshDesktopGroups/)
  assert.match(main, /旧版坐标重排已停用/)
})

const { classifyDesktopItem } = loadTypeScript('src/main/desktop-categories.ts')
test('video and audio classification is case-insensitive and folders win over extensions', () => {
  assert.equal(classifyDesktopItem('电影.MKV', false), 'video')
  assert.equal(classifyDesktopItem('录音.wav', false), 'audio')
  assert.equal(classifyDesktopItem('资料.mp4', true), 'folder')
  assert.equal(classifyDesktopItem('程序.lnk', false), 'shortcut')
  assert.equal(classifyDesktopItem('report.pdf', false), 'document')
})
test('manual reassignment wins over category rules without duplicate icons', () => {
  const data = defaultData()
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const items = [{ path: 'C:/Desktop/movie.mp4', category: 'video' }, { path: 'C:/Desktop/song.mp3', category: 'audio' }]
  synchronizeDesktopGroups(data, items, area, '2026-10-19T00:00:00Z')
  assert.deepEqual(data.desktopZones.find(z => z.id === 'desktop-videos').itemIds, ['C:/Desktop/movie.mp4'])
  data.desktopAssignments['C:/Desktop/movie.mp4'] = 'desktop-audio'
  synchronizeDesktopGroups(data, items, area, '2026-10-19T00:00:00Z')
  assert.deepEqual(data.desktopZones.find(z => z.id === 'desktop-videos').itemIds, [])
  assert.equal(data.desktopZones.filter(z => z.itemIds.includes('C:/Desktop/movie.mp4')).length, 1)
  assert.ok(data.desktopZones.find(z => z.id === 'desktop-audio').itemIds.includes('C:/Desktop/movie.mp4'))
})

const { selectVisibleDesktopItems } = loadTypeScript('src/main/desktop-widgets.ts')
test('Shell-only namespace entries are excluded and real desktop files win ambiguous display names', () => {
  const files = [
    { path: 'C:/Users/Demo/Downloads', name: 'Downloads', displayName: '下载', category: 'folder' },
    { path: 'C:/Desktop/下载.lnk', name: '下载.lnk', displayName: '下载', category: 'shortcut' },
    { path: 'shell:::{00000000-0000-0000-0000-000000000000}', name: '隐藏的系统入口', displayName: '隐藏的系统入口', category: 'system' }
  ]
  const result = selectVisibleDesktopItems([{ name: '下载' }], files, ['C:/Desktop'])
  assert.deepEqual(result.items.map(item => item.path), ['C:/Desktop/下载.lnk'])
  assert.deepEqual(result.missing, [])
  assert.deepEqual(selectVisibleDesktopItems([{ name: '未知项目' }], files, ['C:/Desktop']).missing, ['未知项目'])
})

const { desktopCoverageProblems } = loadTypeScript('src/main/desktop-widgets.ts')
test('collection refuses missing, hidden or duplicate file coverage before hiding the original desktop', () => {
  const data = defaultData()
  const items = [{ path: 'C:/Desktop/file.pdf', category: 'document' }]
  synchronizeDesktopGroups(data, items, { x: 0, y: 0, width: 1920, height: 1040 }, '2026-10-19T00:00:00Z')
  assert.deepEqual(desktopCoverageProblems(data), [])
  const zone = data.desktopZones.find(zone => zone.itemIds.length)
  zone.visible = false
  assert.deepEqual(desktopCoverageProblems(data), ['C:/Desktop/file.pdf'])
  zone.visible = true; zone.itemIds.push('C:/Desktop/file.pdf')
  assert.deepEqual(desktopCoverageProblems(data), ['C:/Desktop/file.pdf'])
})

const { collectionTabs, collectionItems } = loadTypeScript('src/main/desktop-collection.ts')
test('collection frame and independent todo retain every category without duplicate items', () => {
  const data = defaultData()
  data.settings.desktopWidgetVersion = 2
  data.todos = [{ id: 'keep', title: 'Existing todo' }]
  const items = ['shortcut', 'folder', 'document', 'image', 'video', 'audio', 'system'].map(category => ({ path: 'C:/Desktop/' + category, name: category, category }))
  synchronizeDesktopGroups(data, items, { x: 0, y: 0, width: 1280, height: 720 }, '2026-10-19T00:00:00Z')
  assert.deepEqual(data.desktopModules.filter(module => module.visible).map(module => module.kind), ['quick', 'todos'])
  assert.equal(data.settings.desktopWidgetVersion, 5)
  assert.equal(data.settings.desktopSnapDistance, 10)
  assert.equal(data.todos[0].title, 'Existing todo')
  const paths = collectionTabs.flatMap(tab => collectionItems(data, tab.id).map(item => item.path))
  assert.equal(paths.length, items.length)
  assert.equal(new Set(paths).size, items.length)
  assert.equal(collectionItems(data, 'media').length, 2)
  const quick = data.desktopModules.find(module => module.kind === 'quick')
  quick.x = 100; quick.collapsed = true
  synchronizeDesktopGroups(data, items, { x: 0, y: 0, width: 1280, height: 720 }, '2026-10-19T00:00:00Z')
  assert.equal(quick.x, 100)
  assert.equal(quick.collapsed, true)
})

const { sortCollectionItems, normalizeCollectionSorts } = loadTypeScript('src/main/desktop-collection.ts')
test('collection multi-selection supports deterministic single, toggle and anchor ranges', () => {
  const {selectCollectionPaths}=loadTypeScript('src/main/desktop-collection.ts')
  const paths=['a','b','c','d']
  const initial=new Set(['a'])
  assert.deepEqual([...selectCollectionPaths(paths,initial,'a','c','range')],['a','b','c'])
  assert.deepEqual([...selectCollectionPaths(paths,initial,'a','c','toggle')],['a','c'])
  assert.deepEqual([...selectCollectionPaths(paths,initial,'a','a','toggle')],[])
  assert.deepEqual([...selectCollectionPaths(paths,initial,'missing','c','range')],['c'])
  assert.deepEqual([...initial],['a'])
})
test('alphabetical and type sorting are deterministic, reversible and never mutate the source', () => {
  const items = [
    { path:'C:/z.pdf', name:'Zeta.pdf', extension:'pdf', isDirectory:false },
    { path:'C:/b.txt', name:'Beta.txt', extension:'txt', isDirectory:false },
    { path:'C:/a.txt', name:'Alpha.txt', extension:'txt', isDirectory:false },
    { path:'C:/folder', name:'Folder', extension:'', isDirectory:true }
  ]
  const source = structuredClone(items)
  assert.deepEqual(sortCollectionItems(items, { by:'name', direction:'asc' }).map(item => item.name), ['Alpha.txt','Beta.txt','Folder','Zeta.pdf'])
  assert.deepEqual(sortCollectionItems(items, { by:'name', direction:'desc' }).map(item => item.name), ['Zeta.pdf','Folder','Beta.txt','Alpha.txt'])
  assert.deepEqual(sortCollectionItems(items, { by:'type', direction:'asc' }).map(item => item.name), ['Folder','Zeta.pdf','Alpha.txt','Beta.txt'])
  assert.deepEqual(items, source)
  assert.deepEqual(normalizeCollectionSorts({ apps:{ by:'type', direction:'desc' }, files:{ by:'bad', direction:'bad' } }).apps, { by:'name', direction:'desc' })
  assert.deepEqual(normalizeCollectionSorts(null).files, { by:'type', direction:'asc' })
})

const { respondToReminder, reminderVisual, reminderPercent, hydrationReminderVisual, hydrationCupMl } = loadTypeScript('src/main/wellness-reminders.ts')
test('water cup accumulates whole millilitres and never exceeds its capacity after becoming overdue',()=>{
  for(const [progress,amount] of [[0,0],[.0039,0],[.004,1],[.01,2],[.5,125],[1,250],[2.5,250],[-1,0]])assert.equal(hydrationCupMl(250,progress),amount)
  assert.equal(hydrationCupMl(300,.5),150)
  for(const [capacity,progress] of [[0,1],[-1,1],[NaN,.5],[250,NaN],[250,Infinity]])assert.equal(hydrationCupMl(capacity,progress),0)
  const clock={startedAt:0,dueAt:30*60_000,intervalMinutes:30}
  for(const [now,amount] of [[0,0],[15*60_000,125],[30*60_000,250],[60*60_000,250]])assert.equal(hydrationCupMl(250,reminderVisual(clock,now).progress),amount)
})
test('a completed daily goal leaves an empty cup in both modes even when an old full clock remains',()=>{
  const now=new Date(2026,9,29,12).getTime()
  const clock={startedAt:now-60*60_000,dueAt:now-30*60_000,intervalMinutes:30}
  for(const enabled of [false,true]){
    const plan={...defaultHydrationPlan,enabled,goalMl:500}
    const day={...hydrationDayAt(undefined,now),consumedMl:500}
    const visual=hydrationReminderVisual({state:{hydration:clock},paused:false,now,hydrationPlan:hydrationPlanSnapshot(plan,day,now)},now)
    assert.equal(visual.progress,0);assert.equal(visual.percent,0);assert.equal(visual.overdue,false)
    assert.equal(hydrationCupMl(plan.cupMl,visual.progress),0)
  }
})
test('overdue percentages keep growing while water and spine visuals stay bounded', () => {
  const clock={startedAt:0,dueAt:1800000,intervalMinutes:30}
  for(const [ratio,percent] of [[1,100],[1.01,101],[1.25,125],[2.5,250]]) {
    const visual=reminderVisual(clock,clock.dueAt*ratio)
    assert.equal(visual.percent,percent)
    assert.equal(visual.progress,1)
    assert.equal(visual.overdue,true)
  }
  const done=respondToReminder(enabled,{hydration:clock},'hydration','done',clock.dueAt*2)
  assert.equal(reminderVisual(done.hydration,clock.dueAt*2).percent,1)
})
test('daily water has no historical overflow after reopening but an existing overdue clock keeps growing', () => {
  const at=(h,m=0)=>new Date(2026,9,19,h,m).getTime()
  const plan=validateHydrationPlan({...defaultHydrationPlan,enabled:true})
  const day=hydrationDayAt(undefined,at(22))
  let snapshot={state:{},paused:false,now:at(22),hydrationPlan:hydrationPlanSnapshot(plan,day,at(22))}
  assert.equal(snapshot.hydrationPlan.status,'ended')
  assert.equal(snapshot.hydrationPlan.restingProgress,0)
  assert.equal(snapshot.hydrationPlan.restingClock,undefined)
  assert.equal(hydrationReminderVisual(snapshot,at(22)).progress,0)
  assert.equal(hydrationReminderVisual(snapshot,at(22)).overdue,false)
  snapshot.hydrationPlan=hydrationPlanSnapshot(plan,{...day,consumedMl:250,lastCupAt:at(21)},at(22))
  assert.equal(hydrationReminderVisual(snapshot,at(22)).progress,0)
  const next=new Date(2026,9,20,8).getTime()
  assert.equal(hydrationPlanSnapshot(plan,day,next).restingProgress,0)
  const clock=hydrationPlanClock(plan,day,undefined,at(9))
  const middle=clock.startedAt+(clock.dueAt-clock.startedAt)/2
  snapshot={state:{hydration:clock},paused:false,now:middle,hydrationPlan:hydrationPlanSnapshot(plan,day,middle)}
  assert.equal(hydrationReminderVisual(snapshot,middle).percent,50)
  assert.equal(hydrationReminderVisual(snapshot,clock.dueAt).percent,100)
  snapshot.hydrationPlan=hydrationPlanSnapshot(plan,day,at(22))
  assert.ok(hydrationReminderVisual(snapshot,at(22)).percent>100)
  assert.equal(hydrationReminderVisual(snapshot,at(22)).overdue,true)
})
test('reading without input keeps both clocks growing and unrelated settings retain their start times', () => {
  const settings={...enabled,hydrationIntervalMinutes:30}
  const initial=tickReminders(settings,{},0).state
  let state=initial
  for(let elapsed=20_000;elapsed<=15*60_000;elapsed+=20_000) state=tickReminders(settings,state,elapsed).state
  assert.equal(state.hydration.startedAt,0)
  assert.equal(state.sedentary.startedAt,0)
  assert.equal(reminderVisual(state.hydration,15*60_000).progress,.5)
  assert.equal(reminderVisual(state.sedentary,15*60_000).progress,.25)
  const normalized=normalizeReminderSettings({healthSoundEnabled:true},settings)
  assert.deepEqual(tickReminders(normalized,state,15*60_000).state,state)
})
test('lock and sleep preserve progress and snooze time without mutating the original clocks', () => {
  const settings={...enabled,hydrationIntervalMinutes:30}
  const original=respondToReminder(settings,tickReminders(settings,{},0).state,'hydration','snooze',5*60_000)
  const before=structuredClone(original)
  const resumed=resumeReminderClocks(original,10*60_000,70*60_000)
  assert.equal(reminderVisual(resumed.hydration,70*60_000).progress,reminderVisual(original.hydration,10*60_000).progress)
  assert.equal(resumed.hydration.snoozedUntil,75*60_000)
  assert.equal(resumed.sedentary.dueAt,120*60_000)
  assert.deepEqual(original,before)
  assert.deepEqual(resumeReminderClocks(original,1000,500),original)
  assert.deepEqual(resumeReminderClocks({},1000,5000),{})
})
test('daily plan keeps its snooze, progress and original slot when lock time shifts its deadline',()=>{
  const at=(h,m=0)=>new Date(2026,9,29,h,m).getTime()
  const plan=validateHydrationPlan({...defaultHydrationPlan,enabled:true,goalMl:500,times:['09:10','10:00']})
  const day=hydrationDayAt(undefined,at(9))
  const clock=hydrationPlanClock(plan,day,undefined,at(9,5))
  const snoozed=respondToReminder({...enabled,hydrationIntervalMinutes:clock.intervalMinutes},{hydration:{...clock,notified:true}},'hydration','snooze',at(9,11))
  const before=structuredClone(snoozed)
  const resumed=resumeReminderClocks(snoozed,at(9,12),at(9,22))
  assert.equal(resumed.hydration.planTime,clock.planTime)
  assert.equal(resumed.hydration.dueAt,clock.dueAt+10*60_000)
  assert.equal(resumed.hydration.snoozedUntil,at(9,31))
  assert.equal(reminderVisual(resumed.hydration,at(9,22)).progress,reminderVisual(snoozed.hydration,at(9,12)).progress)
  assert.equal(hydrationPlanClock(plan,day,resumed.hydration,at(9,22)),resumed.hydration)
  assert.deepEqual(snoozed,before)
  const brief=validateHydrationPlan({...plan,end:'09:20'})
  const briefClock=hydrationPlanClock(brief,day,undefined,at(9))
  const shifted=resumeReminderClocks({hydration:briefClock},at(9,1),at(9,18)).hydration
  assert.ok(shifted.dueAt>at(9,20))
  assert.equal(hydrationPlanClock(brief,day,shifted,at(9,18)),shifted)
})
test('health icons progress to overdue without repeating alerts, snooze once and reset on completion', () => {
  const settings = { ...enabled, hydrationIntervalMinutes:30 }
  const initial = tickReminders(settings, {}, 0).state
  assert.equal(reminderVisual(initial.hydration, 15*60_000).progress, .5)
  const due = tickReminders(settings, initial, 30*60_000)
  assert.deepEqual(due.due, ['hydration'])
  assert.equal(reminderVisual(due.state.hydration, 31*60_000).overdue, true)
  const snoozed = respondToReminder(settings, due.state, 'hydration', 'snooze', 31*60_000)
  assert.equal(reminderVisual(snoozed.hydration, 35*60_000).snoozed, true)
  assert.deepEqual(tickReminders(settings, snoozed, 40*60_000).due, [])
  assert.deepEqual(tickReminders(settings, snoozed, 41*60_000).due, ['hydration'])
  const done = respondToReminder(settings, snoozed, 'hydration', 'done', 42*60_000)
  assert.equal(reminderVisual(done.hydration, 42*60_000).progress, 0)
  assert.equal(done.hydration.dueAt, 72*60_000)
  assert.deepEqual(done.sedentary, initial.sedentary)
})

const { renamedFilePath, renameCollectedFile } = loadTypeScript('src/main/file-rename.ts')
test('F2 rename preserves shortcut suffixes and rejects path traversal and reserved Windows names', () => {
  const root = path.join(require('node:os').tmpdir(), 'gerson-file-name-validation')
  assert.equal(renamedFilePath(path.join(root,'App.lnk'),'New App'),path.join(root,'New App.lnk'))
  assert.equal(renamedFilePath(path.join(root,'Photo.png'),'New.png'),path.join(root,'New.png'))
  for (const name of ['../escape.txt','bad/name','CON.txt','LPT1','NUL','bad.','bad ']) assert.throws(() => renamedFilePath(path.join(root,'a.txt'), name))
})
test('real file and folder rename refuses collisions and preserves content and special characters', async () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gerson-rename-check-'))
  const source = path.join(directory, "原始'$().txt")
  const target = path.join(directory, "New'$().txt")
  const existing = path.join(directory, 'existing.txt')
  const folder = path.join(directory, 'Folder')
  const renamedFolder = path.join(directory, 'Renamed Folder')
  try {
    fs.writeFileSync(source, 'preserved-content'); fs.writeFileSync(existing, 'never-overwrite'); fs.mkdirSync(folder)
    await assert.rejects(renameCollectedFile(source, 'existing.txt'), /同名/)
    assert.equal(fs.readFileSync(existing,'utf8'),'never-overwrite')
    assert.equal(await renameCollectedFile(source, path.basename(target)),target)
    assert.equal(fs.readFileSync(target,'utf8'),'preserved-content')
    await renameCollectedFile(folder, 'Renamed Folder')
    assert.equal(fs.statSync(renamedFolder).isDirectory(),true)
  } finally {
    for (const file of [source,target,existing]) if (fs.existsSync(file)) fs.unlinkSync(file)
    for (const item of [folder,renamedFolder]) if (fs.existsSync(item)) fs.rmdirSync(item)
    fs.rmdirSync(directory)
  }
})

const { snapWidgetBounds, draggedWidgetBounds } = loadTypeScript('src/main/widget-snap.ts')
test('a removed display or smaller work area returns widgets to visible bounds', () => {
  const {fitWidgetToWorkArea}=loadTypeScript('src/main/widget-snap.ts')
  assert.deepEqual(fitWidgetToWorkArea({x:2100,y:1000,width:360,height:480},{x:0,y:0,width:1920,height:1040}),{x:1560,y:560,width:360,height:480})
  assert.deepEqual(fitWidgetToWorkArea({x:-2500,y:-100,width:900,height:1000},{x:-1280,y:40,width:800,height:600}),{x:-1280,y:40,width:800,height:600})
})
test('release snap selects nearby edges without attracting distant windows or clamping free movement', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const raw = { x: 8, y: 200, width: 360, height: 480 }
  assert.deepEqual(snapWidgetBounds(raw, area, [], 10), { ...raw, x: 0 })
  assert.equal(snapWidgetBounds({ ...raw, x: 12 }, area, [], 10).x, 12)
  assert.equal(snapWidgetBounds({ ...raw, x: -80 }, area, [], 10).x, -80)
  assert.equal(snapWidgetBounds({ ...raw, x: 300 }, area, [{ x: 305, y: 900, width: 360, height: 100 }], 10).x, 300)
  assert.equal(snapWidgetBounds({ ...raw, x: 668 }, area, [{ x: 300, y: 200, width: 360, height: 400 }], 10).x, 660)
  assert.equal(snapWidgetBounds({ ...raw, x: 672 }, area, [{ x: 300, y: 200, width: 360, height: 400 }], 10).x, 672)
  assert.equal(snapWidgetBounds({ ...raw, x: -1912 }, { ...area, x: -1920 }, [], 10).x, -1920)
  assert.deepEqual(raw, { x: 8, y: 200, width: 360, height: 480 })
})

test('nearby side-by-side widgets align their tops and detach from the original proposed position', () => {
  const area={x:0,y:0,width:1920,height:1040}
  const neighbor={x:300,y:200,width:300,height:280}
  assert.deepEqual(snapWidgetBounds({x:604,y:206,width:360,height:480},area,[neighbor],10),{x:600,y:200,width:360,height:480})
  assert.equal(snapWidgetBounds({x:630,y:230,width:360,height:480},area,[neighbor],10).x,630)
})

test('a new title drag can detach an already aligned window without changing its anchor or adding a gap', () => {
  const origin={x:600,y:200,width:360,height:480}
  const anchor={x:640,y:220}
  const area={x:0,y:0,width:1920,height:1040}
  const neighbors=[{x:300,y:200,width:300,height:280}]
  assert.equal(snapWidgetBounds(draggedWidgetBounds(origin,anchor,{x:645,y:220}),area,neighbors,10).x,600)
  assert.equal(snapWidgetBounds(draggedWidgetBounds(origin,anchor,{x:670,y:220}),area,neighbors,10).x,630)
  assert.equal(snapWidgetBounds(draggedWidgetBounds(origin,anchor,{x:620,y:220}),area,[],10).x,580)
  assert.equal(snapWidgetBounds({x:598,y:200,width:360,height:480},area,neighbors,10).x,neighbors[0].x+neighbors[0].width)
  assert.deepEqual(origin,{x:600,y:200,width:360,height:480})
})

test('title pointer capture can restart dragging and does not intercept header buttons', async () => {
  const { createSSRApp }=require('vue')
  const { renderToString }=require('vue/server-renderer')
  const { useDesktopDrag }=loadTypeScript('src/renderer/useDesktopDrag.ts')
  const saved={window:global.window,requestAnimationFrame:global.requestAnimationFrame,cancelAnimationFrame:global.cancelAnimationFrame}
  const calls=[]
  let queued,drag,captures=0
  try {
    global.window={toolbox:{desktopModules:{drag:async action=>{calls.push(action)}}}}
    global.requestAnimationFrame=callback=>{queued=callback;return 1}
    global.cancelAnimationFrame=()=>{queued=null}
    await renderToString(createSSRApp({setup(){drag=useDesktopDrag();return()=>null}}))
    const event={button:0,pointerId:1,target:{closest:()=>null},currentTarget:{setPointerCapture(){captures++}},preventDefault(){}}
    drag.start({...event,target:{closest:()=>({})}})
    assert.deepEqual(calls,[])
    for(let attempt=0;attempt<2;attempt++) {
      drag.start(event); drag.move(); await Promise.resolve()
      queued(); await Promise.resolve(); await Promise.resolve()
      drag.finish(); await Promise.resolve(); await Promise.resolve()
    }
    assert.deepEqual(calls,['start','move','end','start','move','end'])
    assert.equal(captures,2)
    drag.start(event); drag.move(); drag.finish(); await Promise.resolve(); await Promise.resolve()
    assert.equal(queued,null)
    assert.deepEqual(calls.slice(-2),['start','end'])
  } finally {
    for(const [key,value] of Object.entries(saved)) { if(value===undefined) delete global[key];else global[key]=value }
  }
})
test('temporary hover expansion waits, defers collapse during interaction, and can be cancelled', async () => {
  const {createSSRApp}=require('vue')
  const {renderToString}=require('vue/server-renderer')
  const {useWidgetHover}=loadTypeScript('src/renderer/useWidgetHover.ts')
  const saved={window:global.window,document:global.document}
  const tasks=new Map();const calls=[];let next=0,hover,blocked=false,dragging=false
  const runNext=()=>{const [id,callback]=tasks.entries().next().value;tasks.delete(id);callback()}
  try {
    global.window={setTimeout:callback=>{tasks.set(++next,callback);return next},clearTimeout:id=>tasks.delete(id),toolbox:{desktopModules:{hover:async value=>{calls.push(value)}}}}
    global.document={activeElement:null,querySelector:()=>blocked ? {} : null}
    await renderToString(createSSRApp({setup(){hover=useWidgetHover(()=>true,()=>true,()=>360,()=>dragging);return()=>null}}))
    hover.enter();assert.equal(hover.expanded.value,false);runNext();assert.equal(hover.expanded.value,true)
    blocked=true;hover.leave();runNext();assert.equal(hover.expanded.value,true)
    blocked=false;runNext();assert.equal(hover.expanded.value,false)
    dragging=true;hover.enter();runNext();assert.equal(hover.expanded.value,false)
    dragging=false;hover.enter();runNext();hover.cancel();assert.equal(hover.expanded.value,false)
    assert.deepEqual(calls,[true,false,true,false])
  } finally {for(const [key,value] of Object.entries(saved)){if(value===undefined)delete global[key];else global[key]=value}}
})


test('display starts at one percent without shortening the reminder interval', () => {
  for (const [progress, percent] of [[0,1],[.001,1],[.25,25],[.999,99],[1,100],[1.2,120]]) assert.equal(reminderPercent(progress),percent)
  const settings = { ...enabled, hydrationIntervalMinutes:30 }
  const initial = tickReminders(settings, {}, 1000).state
  assert.equal(reminderPercent(reminderVisual(initial.hydration,1000).progress),1)
  assert.equal(initial.hydration.dueAt,1801000)
  assert.deepEqual(tickReminders(settings,initial,1800999).due,[])
  assert.deepEqual(tickReminders(settings,initial,1801000).due,['hydration'])
})


const {snapResizedWidgetBounds}=loadTypeScript('src/main/widget-snap.ts')
test('bottom resizing aligns adjacent bottoms without moving the title or locking the next resize',()=>{
  const area={x:0,y:0,width:1920,height:1040}
  const neighbor={x:600,y:80,width:360,height:480}
  const raw={x:300,y:80,width:300,height:474}
  assert.deepEqual(snapResizedWidgetBounds(raw,area,[neighbor],10),{...raw,height:480})
  assert.equal(snapResizedWidgetBounds({...raw,height:486},area,[neighbor],10).height,480)
  assert.equal(snapResizedWidgetBounds({...raw,height:500},area,[neighbor],10).height,500)
  assert.equal(snapResizedWidgetBounds({...raw,x:200},area,[neighbor],10).height,474)
  assert.equal(snapResizedWidgetBounds({...raw,y:50,height:504},area,[neighbor],10).height,510)
  assert.equal(snapResizedWidgetBounds({...raw,height:954},area,[],10).height,960)
  assert.deepEqual(raw,{x:300,y:80,width:300,height:474})
})


const {canReuseDesktopInventory}=loadTypeScript('src/main/desktop-widgets.ts')
test('warm collection reuses only a complete inventory matching the live desktop and current paths',()=>{
  const cached=[{path:'C:\\Desktop\\A.lnk',name:'A.lnk',displayName:'A',category:'shortcut'},{path:'C:\\Desktop\\B.txt',name:'B.txt',category:'document'}]
  const live=[{name:'A'},{name:'B.txt'}]
  assert.equal(canReuseDesktopInventory(live,cached,cached),true)
  assert.equal(canReuseDesktopInventory([...live,{name:'New.txt'}],cached,cached),false)
  assert.equal(canReuseDesktopInventory([{name:'A'}],cached,cached),false)
  assert.equal(canReuseDesktopInventory([{name:'Renamed'},{name:'B.txt'}],cached,cached),false)
  assert.equal(canReuseDesktopInventory(live,cached,[cached[0],{...cached[1],path:'C:\\Other\\B.txt'}]),false)
  assert.equal(canReuseDesktopInventory(live,[cached[0],cached[0]],cached),false)
  assert.equal(canReuseDesktopInventory([],[],[]),false)
})


test('warm inventory rejects deleted or changed files even when Explorer hides their extensions',async()=>{
  const {isDesktopInventoryCurrent}=loadTypeScript('src/main/desktop-shell.ts',{'./desktop-categories':loadTypeScript('src/main/desktop-categories.ts'),'node:fs/promises':{stat:async path=>{if(path==='deleted')throw Error('ENOENT');return {mtimeMs:path==='changed'?2000:1000}}}})
  const item=path=>({path,modifiedAt:new Date(1000).toISOString()})
  assert.equal(await isDesktopInventoryCurrent([item('unchanged'),item('shell:recycle')]),true)
  assert.equal(await isDesktopInventoryCurrent([item('changed')]),false)
  assert.equal(await isDesktopInventoryCurrent([item('deleted')]),false)
})


test('overdue daily clock retains its original start across schedule end without generating another alert',()=>{
  const {overdueHydrationClock}=loadTypeScript('src/main/hydration-plan.ts')
  const at=(h,m=0)=>new Date(2026,9,19,h,m).getTime()
  const plan=validateHydrationPlan({...defaultHydrationPlan,enabled:true}),day=hydrationDayAt(undefined,at(9))
  const clock=hydrationPlanClock(plan,day,undefined,at(9))
  assert.deepEqual(overdueHydrationClock(plan,day,clock,at(22)),clock)
  assert.equal(overdueHydrationClock(plan,day,undefined,at(22)),undefined)
  assert.equal(overdueHydrationClock(plan,{...day,lastCupAt:at(21),consumedMl:250},clock,at(22)),undefined)
  const tomorrow=new Date(2026,9,20,22).getTime()
  assert.equal(overdueHydrationClock(plan,day,clock,tomorrow),undefined)
  const lastPlan=validateHydrationPlan({...defaultHydrationPlan,enabled:true,goalMl:500,times:['09:10','19:59']})
  const last=hydrationPlanClock(lastPlan,day,undefined,at(19,50))
  assert.equal(last.dueAt,at(19,55))
  assert.equal(hydrationPlanClock(lastPlan,day,last,at(19,55)+20000),last)
  assert.equal(overdueHydrationClock(lastPlan,day,last,at(22)),last)
})

test('undo restores captured state and rejects expiry, stale tokens, changed settings or newer hydration data',()=>{
  const {captureWellnessUndo,validateWellnessUndo}=loadTypeScript('src/main/wellness-undo.ts')
  const {defaultData}=loadTypeScript('src/main/types.ts')
  const data=defaultData(),now=new Date(2026,9,20,10).getTime()
  data.settings.hydrationPlan=validateHydrationPlan({...defaultHydrationPlan,enabled:true})
  const day=hydrationDayAt(undefined,now),clock={intervalMinutes:30,startedAt:now-3600000,dueAt:now-1800000,notified:true}
  const undo=captureWellnessUndo('one','hydration',data.settings,clock,day,now)
  const before=structuredClone(undo)
  const after={...day,consumedMl:250,lastCupAt:now,completedTimes:['10:00']};undo.dayAfter=structuredClone(after)
  validateWellnessUndo(undo,'one',data.settings,after,now+10000)
  assert.deepEqual(undo.clock,clock);assert.deepEqual(undo.dayBefore,day)
  clock.startedAt=0;day.consumedMl=999
  assert.deepEqual(undo.clock,before.clock);assert.deepEqual(undo.dayBefore,before.dayBefore)
  for(const [id,settings,current,at] of [['old',data.settings,after,now],['one',data.settings,after,now+15000],['one',data.settings,after,now+15001],['one',{...data.settings,hydrationIntervalMinutes:60},after,now],['one',data.settings,{...after,consumedMl:500},now],['one',data.settings,after,now+86400000]])assert.throws(()=>validateWellnessUndo(undo,id,settings,current,at))
})

test('overdue spine stays orange, flood rises and segments separate without exceeding bounded visuals',()=>{
  const {healthEffects,spineSegments}=loadTypeScript('src/renderer/health-effects.ts')
  assert.equal(healthEffects(80,false).color,undefined)
  let prior=healthEffects(100,true)
  for(const percent of [101,125,150,200,300,400,800]){
    const next=healthEffects(percent,true)
    const [red,green,blue]=next.color.match(/\d+/g).map(Number)
    assert.equal(red,244);assert.ok(green>=150 && green<=207 && blue>=60 && blue<=156)
    assert.ok(next.flood>=prior.flood && next.separation>=prior.separation && next.severity>=prior.severity)
    for(const key of ['flood','separation','severity','spill'])assert.ok(next[key]>=0 && next[key]<=1)
    prior=next
  }
  assert.equal(healthEffects(400,true).flood,1)
  assert.equal(healthEffects(300,true).separation,1)
  assert.equal(spineSegments(1,1).filter(bone=>bone.separated).length,10)
  for(const amount of [0,.5,1])for(const bone of spineSegments(1,amount))assert.ok(bone.y>=4 && bone.y+bone.height<=51.001)
})


test('water keeps its original blue at all overdue levels while accumulation increases',()=>{
  const {waterOverflowEffects}=loadTypeScript('src/renderer/health-effects.ts')
  let previous=0
  for(const percent of [50,100,125,200,300,400,1000]){
    const effects=waterOverflowEffects(percent,percent>=100)
    assert.equal(effects.color,'#78cbdc');assert.ok(effects.flood>=previous);previous=effects.flood
  }
})

test('spine loses exactly one more bone every ten percent after 100, in order, and completion restores it',()=>{
  const {healthEffects,spineSegments}=loadTypeScript('src/renderer/health-effects.ts')
  for(const percent of [99,100,101,109,110,119,120,129,130,140,150,160,170,180,190,199,200,300]){
    const expected=Math.min(10,Math.max(0,Math.floor((percent-100)/10)))
    const bones=spineSegments(1,healthEffects(percent,percent>=100).separation)
    assert.equal(bones.filter(bone=>bone.separated).length,expected,`${percent}%`)
    assert.ok(bones.every((bone,index)=>bone.separated===(index<expected)))
  }
  assert.equal(healthEffects(300,false).separation,0)
})

test('only the next attached bone loosens progressively before each drop and resets on the next stage',()=>{
  const {healthEffects,spineSegments}=loadTypeScript('src/renderer/health-effects.ts')
  for(const base of [100,110,150,190]){
    let previous=0
    for(const offset of [1,5,9]){
      const effects=healthEffects(base+offset,true),bones=spineSegments(1,effects.separation,effects.looseness)
      const loose=bones.filter(bone=>!bone.separated && bone.looseness>0)
      assert.equal(loose.length,1);assert.equal(bones.indexOf(loose[0]),(base-100)/10)
      assert.ok(loose[0].looseness>previous);previous=loose[0].looseness
    }
    assert.equal(healthEffects(base+10,true).looseness,0)
  }
  assert.equal(healthEffects(300,true).looseness,0)
  assert.equal(healthEffects(109,false).looseness,0)
})

test('gravity accelerates falling pieces, bounces on the floor and settles without mutating its input',()=>{
  const {stepBody,bodyHalfHeight}=loadTypeScript('src/renderer/health-physics.ts')
  const body={x:30,y:20,vx:10,vy:0,width:8,height:3,angle:.4,spin:1}
  const before=structuredClone(body),first=stepBody(body,.02,100,200,.27),second=stepBody(first,.02,100,200,.27)
  assert.ok(first.y>body.y && second.vy>first.vy)
  assert.deepEqual(body,before)
  const one=stepBody({...body,spin:0},.04,100,200,.27)
  const two=stepBody(stepBody({...body,spin:0},.02,100,200,.27),.02,100,200,.27)
  assert.ok(Math.abs(one.y-two.y)<1e-8)
  let falling={...body},bounced=false
  for(let frame=0;frame<600;frame++){
    falling=stepBody(falling,1/60,100,200,.27)
    if(falling.landed && falling.vy<0)bounced=true
    assert.ok(falling.y+bodyHalfHeight(falling)<=100.00001)
  }
  assert.equal(bounced,true);assert.equal(falling.settled,true)
  assert.ok(Math.abs(falling.y+bodyHalfHeight(falling)-100)<1e-8)
  const moved=stepBody({...falling,settled:false},1/60,140,200,.27)
  assert.ok(moved.y>falling.y)
})


test('daily cup starts at each opening time without changing the saved daily history',()=>{
  const at=(h,m=0,s=0)=>new Date(2026,9,22,h,m,s).getTime()
  const plan=validateHydrationPlan({...defaultHydrationPlan,enabled:true,goalMl:500,times:['09:10','10:00']})
  const day=hydrationDayAt(undefined,at(9))
  const initial=hydrationPlanClock(plan,day,undefined,at(9,5))
  assert.equal(initial.startedAt,at(9,5))
  assert.equal(reminderVisual(initial,at(9,5)).progress,0)
  assert.equal(reminderVisual(initial,at(9,6)).progress,60000/(initial.dueAt-initial.startedAt))
  assert.equal(hydrationPlanClock(plan,day,initial,at(9,6)),initial)
  const drank={...day,consumedMl:250,completedTimes:['09:10'],lastCupAt:at(9,12,30)}
  const before=structuredClone({plan,day,drank})
  const afterRestart=hydrationPlanClock(plan,drank,undefined,at(9,15))
  assert.equal(afterRestart.startedAt,at(9,15))
  assert.equal(afterRestart.dueAt,at(9,15)+(at(20)-at(9,15))/2)
  assert.equal(afterRestart.planTime,'14:37')
  assert.equal(reminderVisual(afterRestart,at(9,15)).progress,0)
  assert.equal(hydrationPlanSnapshot(plan,drank,at(9,15)).consumedMl,250)
  assert.equal(hydrationPlanSnapshot(plan,drank,at(9,15)).restingClock,undefined)
  assert.equal(hydrationPlanClock(plan,day,undefined,at(9,10)).dueAt,at(9,10)+(at(20)-at(9,10))/3)
  assert.equal(hydrationPlanClock(plan,day,undefined,at(10)).startedAt,at(10))
  assert.equal(hydrationPlanClock(plan,drank,undefined,at(20)),undefined)
  assert.deepEqual({plan,day,drank},before)
})
