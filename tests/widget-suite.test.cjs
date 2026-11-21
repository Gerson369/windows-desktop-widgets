const test=require('node:test')
const assert=require('node:assert/strict')
const {loadTypeScript}=require('./load-typescript.cjs')
const suite=loadTypeScript('src/main/widget-suite.ts')
const holidays=loadTypeScript('src/main/holiday-countdowns.ts')
const metrics=loadTypeScript('src/main/device-metrics.ts')
const request=loadTypeScript('src/main/public-request.ts')
const {defaultData}=loadTypeScript('src/main/types.ts')
const {captureWidgetLayout,applyWidgetLayout,validWidgetLayout}=loadTypeScript('src/main/widget-layout.ts')
const calendar=import('ical.js').then(library=>loadTypeScript('src/main/calendar-service.ts',{'ical.js':library}))
const source=content=>({id:'work',name:'工作日历',enabled:true,content,updatedAt:''})
const ics=events=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gerson//Tests//EN\r\n${events}\r\nEND:VCALENDAR`
const event=(body)=>`BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT`

test('suite validates dates, timezones, identifiers, sizes and focus without changing its input',()=>{
  const value=suite.defaultSuite(),before=structuredClone(value)
  assert.deepEqual(suite.validateSuite(value),value)
  assert.deepEqual(value,before)
  assert.equal(suite.validDateKey('2026-02-30'),false)
  assert.equal(suite.validDateKey('2028-02-29'),true)
  assert.equal(suite.daysUntil('2026-10-20',new Date(2026,9,19,23).getTime()),1)
  for(const patch of [{timeZones:['Invalid/Zone']},{fontSize:NaN},{background:'red;script'},{cities:[{id:'bad',name:'bad',latitude:NaN,longitude:0}]},{countdowns:[{id:'a',title:'a',date:'2026-02-30'}]},{focus:{durationSeconds:1500,remainingSeconds:-1,endAt:null}}]) assert.throws(()=>suite.validateSuite({...value,...patch}))
  assert.throws(()=>suite.validateSuite({...value,countdowns:[{id:'same',title:'a',date:'2026-10-20'},{id:'same',title:'b',date:'2026-10-21'}]}),/重复/)
})

test('calendar details validate and round-trip without adding fields to old or cleared events',async()=>{
  const original={id:'meeting',title:'讨论',start:'2026-10-19T09:00:00.000Z',end:'2026-10-19T10:00:00.000Z',allDay:false,category:'work'}
  const validate=details=>suite.validateSuite({...suite.defaultSuite(),events:[{...original,...details}]}).events[0]
  assert.deepEqual(validate({}),original)
  assert.deepEqual(validate({location:' \n ',notes:'\t'}),original)
  const saved=validate({location:'  会议室 A  ',notes:' 第一行\n第二行 <b>文本</b> '})
  assert.equal(saved.location,'会议室 A'); assert.equal(saved.notes,'第一行\n第二行 <b>文本</b>')
  assert.deepEqual(validate(JSON.parse(JSON.stringify(saved))),saved)
  const api=await calendar
  assert.deepEqual(api.agenda([saved],[],Date.parse('2026-10-19'),Date.parse('2026-10-20')).events[0],{...saved,source:'工作'})
  assert.deepEqual(original,{id:'meeting',title:'讨论',start:'2026-10-19T09:00:00.000Z',end:'2026-10-19T10:00:00.000Z',allDay:false,category:'work'})
  for(const [key,maximum] of [['location',300],['notes',4000]]) {
    assert.equal(validate({[key]:'字'.repeat(maximum)})[key].length,maximum)
    for(const value of [null,12,true,[],{},'字'.repeat(maximum+1),' '.repeat(maximum+1)]) assert.throws(()=>validate({[key]:value}),/文本/)
  }
})

test('focus resumes after restart, pauses exactly and reaches zero without resetting elapsed time',()=>{
  const initial=suite.defaultSuite().focus
  const running=suite.changeFocus(initial,'start',100000,120)
  assert.equal(suite.focusRemaining(JSON.parse(JSON.stringify(running)),130000),90)
  const paused=suite.changeFocus(running,'pause',130000)
  assert.equal(suite.focusRemaining(paused,900000),90)
  const resumed=suite.changeFocus(paused,'start',900000)
  assert.equal(suite.focusRemaining(resumed,990000),0)
  assert.equal(suite.focusRemaining(resumed,1200000),0)
  assert.equal(suite.changeFocus(resumed,'reset',1200000).remainingSeconds,120)
  assert.throws(()=>suite.changeFocus(initial,'start',0,0))
  assert.equal(initial.endAt,null)
})

test('built-in holidays use verified lunar and Qingming dates rather than system lunar estimates',()=>{
  const upcoming=holidays.holidayCountdowns('2027-01-01')
  const expected={元旦:'2027-01-01',除夕:'2027-02-05',春节:'2027-02-06',元宵节:'2027-02-20',清明节:'2027-04-05',劳动节:'2027-05-01',端午节:'2027-06-09',七夕节:'2027-08-08',中秋节:'2027-09-15',国庆节:'2027-10-01',重阳节:'2027-10-08'}
  assert.deepEqual(Object.fromEntries(upcoming.map(item=>[item.title,item.date])),expected)
  assert.equal(new Set(upcoming.map(item=>item.id)).size,11)
  assert.deepEqual(upcoming.map(item=>item.date),upcoming.map(item=>item.date).sort())
  assert.equal(holidays.holidayCountdowns('2028-01-01').find(item=>item.title==='清明节').date,'2028-04-04')
  const overlapping=holidays.holidayCountdowns('2031-01-01').filter(item=>item.date==='2031-10-01')
  assert.deepEqual(new Set(overlapping.map(item=>item.title)),new Set(['中秋节','国庆节']))
})

test('holidays retain today, advance across years, and never guess lunar dates outside the verified range',()=>{
  assert.equal(holidays.holidayCountdowns('2027-02-06').find(item=>item.title==='春节').date,'2027-02-06')
  assert.equal(holidays.holidayCountdowns('2027-02-07').find(item=>item.title==='春节').date,'2028-01-26')
  assert.equal(holidays.holidayCountdowns('2026-12-31')[0].date,'2027-01-01')
  for(let year=2026;year<=2035;year++){
    const rows=holidays.holidayCountdowns(`${year}-01-01`)
    assert.equal(rows.length,11)
    assert.ok(rows.every(item=>suite.validDateKey(item.date)))
    assert.equal(holidays.hasVerifiedHolidayDates(`${year}-01-01`),true)
  }
  const unsupported=holidays.holidayCountdowns('2036-01-01')
  assert.deepEqual(unsupported.map(item=>item.title),['元旦','劳动节','国庆节'])
  assert.equal(holidays.hasVerifiedHolidayDates('2036-01-01'),false)
  assert.throws(()=>holidays.holidayCountdowns('2027-02-30'),/日期/)
})

test('network rates discard first samples, resets and changed adapters',()=>{
  const before={at:1000,key:'wifi',received:1000,sent:2000}
  assert.deepEqual(metrics.networkRate(undefined,before),{down:null,up:null})
  assert.deepEqual(metrics.networkRate(before,{at:3000,key:'wifi',received:5000,sent:4000}),{down:2000,up:1000})
  for(const patch of [{at:1000},{key:'ethernet'},{received:0},{sent:0}]) assert.deepEqual(metrics.networkRate(before,{...before,at:3000,...patch}),{down:null,up:null})
})

test('public URL reads reject local addresses, private networks, IPv4-mapped IPv6 and credentials',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','172.16.5.1','192.168.1.2','169.254.169.254','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::']) assert.equal(request.publicAddress(address),false,address)
  assert.equal(request.publicAddress('8.8.8.8'),true)
  assert.equal(request.publicAddress('2606:4700:4700::1111'),true)
  for(const url of ['http://example.com','https://user:pass@example.com','https://example.com:8443']) await assert.rejects(request.publicText(url))
})

test('calendar expands RRULE, EXDATE and rescheduled exceptions with correct source identity',async()=>{
  const api=await calendar
  const content=ics([
    event('UID:weekly\r\nDTSTART:20261019T010000Z\r\nDTEND:20261019T020000Z\r\nSUMMARY:Weekly\r\nLOCATION:Old room\r\nDESCRIPTION:Original notes\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE:20261020T010000Z'),
    event('UID:weekly\r\nRECURRENCE-ID:20261021T010000Z\r\nDTSTART:20261021T030000Z\r\nDTEND:20261021T040000Z\r\nSUMMARY:Changed\r\nLOCATION:New room\r\nDESCRIPTION:Updated notes')
  ].join('\r\n'))
  const rows=api.expandCalendar(source(content),Date.parse('2026-10-19'),Date.parse('2026-10-24'))
  assert.equal(rows.length,3)
  assert.deepEqual(rows.map(row=>row.title),['Weekly','Changed','Weekly'])
  assert.equal(rows[1].start,'2026-10-21T03:00:00.000Z')
  assert.deepEqual(rows.map(row=>[row.location,row.notes]),[['Old room','Original notes'],['New room','Updated notes'],['Old room','Original notes']])
  assert.ok(rows.every(row=>row.source==='工作日历'))
})

test('calendar imports plain text details with decoded escapes and bounded length',async()=>{
  const api=await calendar
  const content=ics([
    event('UID:plain\r\nDTSTART:20261019T010000Z\r\nDTEND:20261019T020000Z\r\nSUMMARY:Plain\r\nLOCATION:Room\\, A\\; B\r\nDESCRIPTION:第一行\\n第二行 <b>纯文本</b>'),
    event(`UID:long\r\nDTSTART:20261019T030000Z\r\nDTEND:20261019T040000Z\r\nSUMMARY:Long\r\nLOCATION:${'地'.repeat(301)}\r\nDESCRIPTION:${'记'.repeat(4001)}`),
    event('UID:old\r\nDTSTART:20261019T050000Z\r\nDTEND:20261019T060000Z\r\nSUMMARY:Old')
  ].join('\r\n'))
  const rows=api.expandCalendar(source(content),Date.parse('2026-10-19'),Date.parse('2026-10-20'))
  assert.equal(rows[0].location,'Room, A; B'); assert.equal(rows[0].notes,'第一行\n第二行 <b>纯文本</b>')
  assert.equal(rows[1].location,'地'.repeat(300)); assert.equal(rows[1].notes,'记'.repeat(4000))
  assert.equal(Object.hasOwn(rows[2],'location'),false); assert.equal(Object.hasOwn(rows[2],'notes'),false)
})

test('calendar keeps all-day end exclusive and filters cancelled recurrence instances',async()=>{
  const api=await calendar
  const content=ics([
    event('UID:all\r\nDTSTART;VALUE=DATE:20261019\r\nDTEND;VALUE=DATE:20261020\r\nSUMMARY:Day'),
    event('UID:repeat\r\nDTSTART:20261019T010000Z\r\nDTEND:20261019T020000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nSUMMARY:Call'),
    event('UID:repeat\r\nRECURRENCE-ID:20261020T010000Z\r\nDTSTART:20261020T010000Z\r\nDTEND:20261020T020000Z\r\nSTATUS:CANCELLED')
  ].join('\r\n'))
  const rows=api.expandCalendar(source(content),new Date(2026,9,19).getTime(),new Date(2026,9,22).getTime())
  assert.equal(rows.length,2)
  assert.equal(rows[0].allDay,true)
  assert.equal(new Date(rows[0].end).getDate(),20)
  assert.equal(api.expandCalendar(source(content),new Date(2026,9,20).getTime(),new Date(2026,9,21).getTime()).length,0)
})

test('calendar handles IANA timezone without embedded VTIMEZONE including daylight saving',async()=>{
  const api=await calendar
  const content=ics(event('UID:dst\r\nDTSTART;TZID=America/New_York:20261031T090000\r\nDTEND;TZID=America/New_York:20261031T100000\r\nSUMMARY:Local\r\nRRULE:FREQ=DAILY;COUNT=3'))
  const rows=api.expandCalendar(source(content),Date.parse('2026-10-30'),Date.parse('2026-11-04'))
  assert.deepEqual(rows.map(row=>row.start),['2026-10-31T13:00:00.000Z','2026-11-01T14:00:00.000Z','2026-11-02T14:00:00.000Z'])
  const result=api.agenda([], [source('invalid')],0,1000)
  assert.equal(result.events.length,0)
  assert.equal(result.errors.length,1)
})

test('layout backups include disabled new widgets and project zones without reverting content',()=>{
  const data=defaultData()
  data.desktopModules.push({id:'clock',kind:'clock',title:'Clock',visible:false,collapsed:false,x:40,y:40,width:316,height:320,displayId:3})
  data.desktopZones.push({id:'project',name:'Project',color:'#aabbcc',opacity:60,visible:true,collapsed:false,locked:false,x:30,y:30,width:320,height:180,itemIds:[],createdAt:'2026-10-19'})
  const backup=captureWidgetLayout(data,'backup','test','2026-10-19T00:00:00Z')
  assert.equal(validWidgetLayout(backup),true)
  const compact=structuredClone(backup)
  compact.modules.push({id:'health',x:0,y:0,width:300,height:80,collapsed:false,visible:true,preferredBounds:{x:0,y:0,width:300,height:80}})
  assert.equal(validWidgetLayout(compact),true)
  compact.modules.at(-1).height=79
  assert.equal(validWidgetLayout(compact),false)
  compact.modules.at(-1).height=80
  compact.modules.at(-1).preferredBounds.height=79
  assert.equal(validWidgetLayout(compact),false)
  for(const legacyHeight of [108,128]){
    compact.modules.at(-1).height=legacyHeight
    compact.modules.at(-1).preferredBounds.height=legacyHeight
    assert.equal(validWidgetLayout(compact),true)
  }
  compact.modules.at(-1).height=80
  compact.modules.at(-1).preferredBounds.height=80
  compact.modules.at(-1).id='notes'
  assert.equal(validWidgetLayout(compact),false)

  data.desktopModules[2].visible=true;data.desktopModules[2].displayId=1;data.desktopZones[0].x=999;data.suite.background='#ffffff';data.suite.countdowns=[{id:'keep',title:'keep',date:'2026-10-20'}]
  applyWidgetLayout(data,backup)
  assert.equal(data.desktopModules[2].visible,false)
  assert.equal(data.desktopModules[2].displayId,3)
  assert.equal(data.desktopZones[0].x,30)
  assert.equal(data.suite.background,'#232729')
  assert.equal(data.suite.countdowns[0].id,'keep')
})

test('time sorting places missing metadata last and never changes source order',()=>{
  const {sortCollectionItems}=loadTypeScript('src/main/desktop-collection.ts')
  const items=[{name:'old',path:'old',extension:'txt',isDirectory:false,modifiedAt:'2020-01-01'},{name:'missing',path:'missing',extension:'txt',isDirectory:false},{name:'new',path:'new',extension:'txt',isDirectory:false,modifiedAt:'2026-01-01'}]
  const before=structuredClone(items)
  assert.deepEqual(sortCollectionItems(items,{by:'modifiedAt',direction:'desc'}).map(item=>item.name),['new','old','missing'])
  assert.deepEqual(items,before)
})

test('upgrading legacy data retains the original file and invalid suite imports do not replace current data',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gerson-suite-migration-'))
  const {DataStore}=loadTypeScript('src/main/store.ts',{electron:{app:{getPath:()=>directory}}})
  const old=defaultData()
  delete old.suite
  old.todos=[{id:'keep',title:'保留事项',completed:false,categoryId:'work',createdAt:'2026-10-19',order:0}]
  old.notes=[{id:'note',title:'保留便签',content:'原始正文',pinned:false,color:'#fff0a8',updatedAt:'2026-10-19'}]
  await fs.writeFile(path.join(directory,'toolbox-data.json'),JSON.stringify(old))
  const store=new DataStore()
  const migrated=await store.init(directory)
  assert.deepEqual(migrated.suite,suite.defaultSuite())
  assert.equal(migrated.todos[0].title,'保留事项')
  assert.equal(migrated.notes[0].content,'原始正文')
  const backup=(await fs.readdir(directory)).find(name=>name.includes('.before-widget-suite-'))
  assert.ok(backup)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,backup),'utf8')),old)
  const invalid={...migrated,suite:{...migrated.suite,fontSize:-1},todos:[]}
  const invalidPath=path.join(directory,'invalid-import.json')
  await fs.writeFile(invalidPath,JSON.stringify(invalid))
  await assert.rejects(store.importFrom(invalidPath),/字号/)
  assert.equal(store.data.todos[0].id,'keep')
})

test('health preferred bounds keep compact and legacy sizes without loosening ordinary panel minimums',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gerson-health-bounds-'))
  const {DataStore}=loadTypeScript('src/main/store.ts',{electron:{app:{getPath:()=>directory}}})
  for(const height of [80,108,128,79]){
    const data=defaultData(),bounds={x:10,y:20,width:300,height}
    data.desktopModules.push({id:'health',kind:'health',title:'健康提醒',visible:true,collapsed:false,...bounds,preferredBounds:{...bounds},dock:{parentId:'todos',edge:'bottom',offset:0}})
    data.desktopModules[0].preferredBounds={x:30,y:40,width:300,height:80}
    await fs.writeFile(path.join(directory,'toolbox-data.json'),JSON.stringify(data))
    const store=new DataStore(),restored=await store.init(directory)
    const health=restored.desktopModules.find(module=>module.id==='health')
    assert.deepEqual(health.preferredBounds,height>=80?bounds:undefined)
    assert.deepEqual(health.dock,{parentId:'todos',edge:'bottom',offset:0})
    assert.equal(restored.desktopModules[0].preferredBounds,undefined)
  }
})


test('all enabled legacy modules project to exactly two panels without changing stored data',()=>{
  const {desktopPanels,setPanelVisibility,assistantTools}=loadTypeScript('src/main/desktop-panels.ts')
  const data=defaultData()
  for(const kind of suite.extraWidgetKinds) data.desktopModules.push({id:kind,kind,title:kind,visible:true,collapsed:false,x:40,y:40,width:316,height:320})
  data.desktopModules.find(module=>module.id==='todos').visible=false
  const before=structuredClone(data)
  const panels=desktopPanels(data.desktopModules)
  assert.deepEqual(panels.map(panel=>panel.kind),['quick','todos'])
  assert.equal(panels[1].visible,true)
  assert.equal(panels[1].title,'桌面搭子')
  assert.deepEqual(data,before)
  assert.equal(assistantTools.length,5)
  assert.equal(new Set(assistantTools.map(tool=>tool.id)).size,5)
  setPanelVisibility(data.desktopModules,'todos',false)
  assert.equal(desktopPanels(data.desktopModules)[1].visible,false)
  assert.equal(data.desktopModules[0].visible,before.desktopModules[0].visible)
  setPanelVisibility(data.desktopModules,'todos',true)
  assert.equal(desktopPanels(data.desktopModules)[1].visible,true)
  assert.throws(()=>setPanelVisibility(data.desktopModules,'missing',true))
})


test('compact panel migration enlarges the assistant once and preserves custom layout on subsequent starts',()=>{
  const {migrateDesktopCollection}=loadTypeScript('src/main/desktop-widgets.ts')
  const data=defaultData(),area={x:0,y:0,width:1920,height:1040}
  data.settings.desktopWidgetVersion=4
  Object.assign(data.desktopModules[0],{x:1500,y:80,width:360,height:480})
  Object.assign(data.desktopModules[1],{x:1196,y:80,width:304,height:280,visible:false})
  data.desktopModules.push({id:'clock',kind:'clock',title:'Clock',visible:true,collapsed:false,x:20,y:20,width:316,height:320})
  migrateDesktopCollection(data,area)
  assert.equal(data.settings.desktopWidgetVersion,5)
  const assistant=data.desktopModules[1]
  assert.equal(assistant.width,360);assert.equal(assistant.height,480);assert.equal(assistant.x,1140);assert.equal(assistant.visible,true)
  Object.assign(assistant,{x:700,y:100,width:400,height:360})
  const before=structuredClone(data)
  migrateDesktopCollection(data,area)
  assert.deepEqual(data,before)
})


test('IPC copies reactive cities and nested saved lists while preserving invalid numbers for validation',()=>{
  const {reactive}=require('vue')
  const {copyIpcData}=loadTypeScript('src/renderer/ipc-data.ts')
  const cities=reactive([{id:'guangzhou',name:'广州',latitude:23.1,longitude:113.3}])
  assert.throws(()=>structuredClone({cities}))
  const patch=copyIpcData({cities:[...cities,cities[0]],events:reactive([{id:'event',title:'日程'}])})
  assert.deepEqual(structuredClone(patch),{cities:[...cities.map(city=>({...city})),{...cities[0]}],events:[{id:'event',title:'日程'}]})
  assert.notEqual(patch.cities[0],cities[0])
  assert.equal(Number.isNaN(copyIpcData({value:NaN}).value),true)
  assert.equal(copyIpcData({value:Infinity}).value,Infinity)
  const cycle={};cycle.self=cycle
  const copy=copyIpcData(cycle);assert.equal(copy.self,copy);const cloned=structuredClone(copy);assert.equal(cloned.self,cloned)
  const date=new Date(0)
  assert.equal(copyIpcData(date),date)
})

test('todo quick dates cross month and year boundaries with readable labels',()=>{
  const {relativeDateKey,todoDateLabel}=loadTypeScript('src/renderer/todo-dates.ts')
  const now=new Date(2026,11,31,23,30).getTime()
  assert.equal(relativeDateKey(now,1),'2027-01-01')
  assert.equal(todoDateLabel('2027-01-01',now),'明天')
  assert.equal(todoDateLabel('2026-12-31',now),'今天')
  assert.equal(todoDateLabel('',now),'日期')
  assert.equal(todoDateLabel('2026-02-30',now),'日期')
  assert.equal(todoDateLabel('2027-02-01',now),'2027年2月1日')
})


test('failed local writes and rejected mutations leave current data intact and permit retry',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gerson-save-rollback-'))
  const {DataStore}=loadTypeScript('src/main/store.ts',{electron:{app:{getPath:()=>directory}}})
  const store=new DataStore();await store.init(directory)
  const before=structuredClone(store.data),disk=await fs.readFile(path.join(directory,'toolbox-data.json'),'utf8')
  const write=store.db.write.bind(store.db)
  store.db.write=()=>{throw Error('disk full')}
  await assert.rejects(store.update(data=>{data.settings.hydrationIntervalMinutes=15;data.settings.hydrationPlan.enabled=true}),/disk full/)
  assert.deepEqual(store.data,before)
  await assert.rejects(store.replace({...before,todos:[]}),/disk full/)
  assert.deepEqual(store.data,before)
  await assert.rejects(store.update(data=>{data.todos=[];throw Error('cancelled')}),/cancelled/)
  assert.deepEqual(store.data,before)
  assert.equal(await fs.readFile(path.join(directory,'toolbox-data.json'),'utf8'),disk)
  store.db.write=write
  await store.update(data=>{data.settings.hydrationIntervalMinutes=15})
  assert.equal(store.data.settings.hydrationIntervalMinutes,15)
  assert.equal(JSON.parse(await fs.readFile(path.join(directory,'toolbox-data.json'),'utf8')).settings.hydrationIntervalMinutes,15)
})

test('organization commits assignments to the latest data after a concurrent save',async(t)=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),vm=require('node:vm')
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gerson-organizer-race-'))
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true})})
  const {DataStore}=loadTypeScript('src/main/store.ts',{electron:{app:{getPath:()=>directory}}})
  const store=new DataStore();await store.init(directory)
  await store.update(data=>{data.desktopZones.push({id:'zone',name:'Project',itemIds:[]})})
  let finishMove,enteredMove
  const moving=new Promise(resolve=>{enteredMove=resolve})
  const desktop=path.join(directory,'Desktop')
  const organizer=loadTypeScript('src/main/organizer-services.ts',{
    electron:{app:{getPath:()=>desktop}},
    'node:fs':{promises:{lstat:async()=>({isSymbolicLink:()=>false}),access:async()=>{throw Error('missing')},mkdir:async()=>{},rename:()=>new Promise(resolve=>{finishMove=resolve;enteredMove()})}}
  })
  const plan={desktopPath:desktop,items:[
    {sourcePath:path.join(desktop,'move.txt'),targetPath:path.join(desktop,'archive','move.txt'),action:'move',status:'planned'},
    {sourcePath:path.join(desktop,'assign.txt'),zoneId:'zone',action:'assign',status:'planned'}
  ]}
  const mainSource=await fs.readFile('src/main/index.ts','utf8'),ast=ts.createSourceFile('index.ts',mainSource,ts.ScriptTarget.Latest,true)
  function findHandler(node){if(ts.isCallExpression(node) && node.expression.getText(ast)==='ipcMain.handle' && node.arguments[0]?.text==='organizer:executeOrganization')return node.arguments[1];return ts.forEachChild(node,findHandler)}
  const context={module:{exports:null},store,...organizer,structuredClone,PREVIEW_CONFIRMATION_TTL_MS:60000,pendingOrganizerPreviews:new Map([[1,{plan,createdAt:Date.now()}]]),broadcastData:()=>{}}
  vm.runInNewContext(ts.transpileModule(`module.exports=${findHandler(ast).getText(ast)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context)
  const pending=context.module.exports({sender:{id:1}},true)
  await moving
  await store.update(data=>{data.settings.hydrationIntervalMinutes=15})
  finishMove();await pending
  assert.equal(store.data.settings.hydrationIntervalMinutes,15)
  assert.equal(store.data.desktopAssignments[plan.items[1].sourcePath],'zone')
  assert.deepEqual(store.data.desktopZones[0].itemIds,[plan.items[1].sourcePath])
  assert.equal(store.data.fileOperations[0].items[1].status,'completed')
  const saved=JSON.parse(await fs.readFile(path.join(directory,'toolbox-data.json'),'utf8'))
  assert.equal(saved.settings.hydrationIntervalMinutes,15)
  assert.equal(saved.desktopAssignments[plan.items[1].sourcePath],'zone')
})
