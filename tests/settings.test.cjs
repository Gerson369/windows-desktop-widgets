const test=require('node:test'),assert=require('node:assert/strict')
const {loadTypeScript}=require('./load-typescript.cjs')
const {createSaveQueue}=loadTypeScript('src/renderer/save-queue.ts')
test('setting saves run in order, preserve return values and recover after a rejected save',async()=>{
 const queue=createSaveQueue(),events=[]
 let release
 const first=queue(async()=>{events.push('first');await new Promise(resolve=>release=resolve);return 1})
 const failed=queue(async()=>{events.push('failed');throw Error('offline')})
 const rejected=assert.rejects(failed,/offline/)
 const last=queue(async()=>{events.push('last');return 3})
 await Promise.resolve();assert.deepEqual(events,['first']);release()
 assert.equal(await first,1);await rejected;assert.equal(await last,3);assert.deepEqual(events,['first','failed','last'])
})

test('todo date text parses real dates and month grid includes leap day on a Monday-first six-week grid',()=>{
 const {parseTodoDate,calendarMonthDays}=loadTypeScript('src/renderer/todo-dates.ts')
 const now=new Date(2026,9,20,12).getTime()
 for(const input of ['2026-10-22','2026/10/22','2026年10月22日'])assert.equal(parseTodoDate(input,now),'2026-10-22')
 assert.equal(parseTodoDate('明天',now),'2026-10-21');assert.equal(parseTodoDate('',now),'')
 for(const input of ['2026-02-29','2026-13-01','abc'])assert.equal(parseTodoDate(input,now),null)
 const days=calendarMonthDays('2024-02');assert.equal(days.length,42);assert.equal(new Date(days[0]+'T12:00:00').getDay(),1);assert.ok(days.includes('2024-02-29'))
})
test('todo creation date never acts as a schedule date and the four counts follow the planned day',()=>{
 const {groupTodos}=loadTypeScript('src/renderer/todo-groups.ts'),now=new Date(2026,9,20,12).getTime()
 const base={categoryId:'personal',createdAt:new Date(now).toISOString(),completed:false,order:0}
 const todos=[{...base,id:'unscheduled',title:'new'},{...base,id:'today',title:'today',dueAt:new Date(2026,9,20,23).toISOString()},{...base,id:'future',title:'future',dueAt:new Date(2026,9,21,23).toISOString()},{...base,id:'past',title:'past',dueAt:new Date(2026,9,19,23).toISOString()},{...base,id:'done',title:'done',completed:true}]
 const groups=groupTodos(todos,now)
 assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key,items])=>[key,items.length])),{pending:4,today:1,planned:1,completed:1})
 assert.equal(groups.today[0].id,'today');assert.equal(groups.planned[0].id,'future');assert.equal(todos[0].dueAt,undefined)
})
test('daily hydration rejects recording once the time range ends or the goal is complete',()=>{
 const {hydrationPlanCanRecord}=loadTypeScript('src/main/hydration-plan.ts')
 for(const status of ['before','active'])assert.equal(hydrationPlanCanRecord({enabled:true,status}),true)
 for(const status of ['ended','complete'])assert.equal(hydrationPlanCanRecord({enabled:true,status}),false)
 assert.equal(hydrationPlanCanRecord({enabled:false,status:'ended'}),true)
})
