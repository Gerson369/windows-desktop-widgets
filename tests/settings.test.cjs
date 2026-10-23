const test=require('node:test'),assert=require('node:assert/strict')
const {loadTypeScript}=require('./load-typescript.cjs')
test('health dock follows any supported edge and detaches once it is dragged away',()=>{
 const {findWidgetDock,dockedWidgetBounds,fitDockedParent,validWidgetDock}=loadTypeScript('src/main/widget-docking.ts')
 const parent={x:100,y:100,width:300,height:400},child={x:100,y:500,width:300,height:128}
 const dock=findWidgetDock(child,[{id:'todos',bounds:parent}])
 assert.deepEqual(dock,{parentId:'todos',edge:'bottom',offset:0})
 assert.deepEqual(dockedWidgetBounds(child,dock,{...parent,x:130,y:150}),{...child,x:130,y:550})
 assert.equal(findWidgetDock({...child,y:530},[{id:'todos',bounds:parent}]),undefined)
 assert.deepEqual(findWidgetDock(child,[{id:'quick',bounds:{x:400,y:100,width:300,height:700}},{id:'todos',bounds:parent}]),{parentId:'todos',edge:'bottom',offset:0})
 for(const edge of ['top','bottom','left','right'])assert.equal(validWidgetDock({parentId:'quick',edge,offset:0}),true)
 assert.equal(validWidgetDock({parentId:'health',edge:'bottom',offset:0}),false)
 const fitted=fitDockedParent({...parent,y:300},child,dock,{x:0,y:0,width:1000,height:800})
 assert.equal(fitted.y+fitted.height+child.height,800)
 const attached=dockedWidgetBounds(child,dock,{...parent,height:42})
 assert.equal(attached.y,142)
 const {desktopPanels,setPanelVisibility}=loadTypeScript('src/main/desktop-panels.ts')
 const modules=[{id:'quick',kind:'quick',title:'桌面收纳',visible:true},{id:'todos',kind:'todos',title:'综合助手',visible:false},{id:'health',kind:'health',title:'喝水与活动',visible:true}]
 assert.equal(desktopPanels(modules).length,3)
 assert.equal(desktopPanels(modules).find(m=>m.id==='todos').visible,false)
 setPanelVisibility(modules,'todos',false)
 assert.equal(modules.find(m=>m.id==='health').visible,true)
})
test('startup health normalization keeps saved docks for collapsed or hidden parents and prefers a detected dock',()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')
 const source=fs.readFileSync('src/main/index.ts','utf8'),ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true)
 const size=ast.statements.find(node=>ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name) && declaration.name.text==='healthWidgetSize'))
 const startup=ast.statements.find(node=>ts.isExpressionStatement(node) && node.expression.getText(ast).startsWith('app.whenReady().then('))
 assert.ok(size && startup)
 let healthDeclaration,normalization
 function visit(node){
  if(ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name) && declaration.name.text==='health'))healthDeclaration=node
  if(ts.isIfStatement(node) && node.expression.getText(ast)==='health' && node.thenStatement.getText(ast).includes('Object.assign(health,healthWidgetSize)'))normalization=node
  ts.forEachChild(node,visit)
 }
 visit(startup)
 assert.ok(healthDeclaration && normalization)
 const compiled=ts.transpileModule(`${size.getText(ast)};module.exports=data=>{${healthDeclaration.getText(ast)};${normalization.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const context={module:{exports:null},...loadTypeScript('src/main/widget-docking.ts')}
 vm.runInNewContext(compiled,context)
 const savedDock={parentId:'todos',edge:'bottom',offset:0}
 const parent={id:'todos',kind:'todos',visible:true,collapsed:true,x:100,y:100,width:300,height:400}
 for(const visible of [true,false]){
  const health={id:'health',kind:'health',x:100,y:142,width:450,height:128,preferredBounds:{x:100,y:142,width:450,height:128},dock:{...savedDock}}
  context.module.exports({desktopModules:[{...parent,visible},health]})
  assert.deepEqual(health.dock,savedDock)
  assert.equal(health.width,300);assert.equal(health.height,108)
  assert.deepEqual(health.preferredBounds,{x:100,y:142,width:300,height:108})
 }
 const health={id:'health',kind:'health',x:100,y:500,width:450,height:128,dock:{parentId:'quick',edge:'right',offset:0}}
 context.module.exports({desktopModules:[{...parent,collapsed:false},health]})
 assert.deepEqual(health.dock,savedDock)
 assert.equal(health.width,300);assert.equal(health.height,108)
})

test('docked panels fit all four edges after moving or oversized resizing',()=>{
 const {dockedWidgetBounds,fitDockedParent}=loadTypeScript('src/main/widget-docking.ts')
 const area={x:0,y:0,width:1366,height:728},child={x:0,y:0,width:300,height:108}
 const parent={x:100,y:0,width:300,height:700},dock={parentId:'todos',edge:'bottom',offset:0}
 assert.deepEqual(fitDockedParent(parent,child,dock,area),{...parent,y:0,height:620})
 for(const parentId of ['quick','todos'])for(const edge of ['top','bottom','left','right'])for(const offset of [-60,0,60]){
  const proposed={x:-500,y:600,width:2000,height:2000},attachment={parentId,edge,offset}
  const fitted=fitDockedParent(proposed,child,attachment,area),attached=dockedWidgetBounds(child,attachment,fitted)
  for(const bounds of [fitted,attached]){
   assert.ok(bounds.x>=area.x && bounds.y>=area.y,`${parentId} ${edge} ${offset} starts inside the work area`)
   assert.ok(bounds.x+bounds.width<=area.x+area.width && bounds.y+bounds.height<=area.y+area.height,`${parentId} ${edge} ${offset} ends inside the work area`)
  }
  assert.ok(fitted.width>=300 && fitted.height>=(parentId==='quick'?280:160))
  assert.deepEqual(proposed,{x:-500,y:600,width:2000,height:2000})
  assert.deepEqual(attachment,{parentId,edge,offset})
 }
 assert.deepEqual(parent,{x:100,y:0,width:300,height:700})
 assert.deepEqual(child,{x:0,y:0,width:300,height:108})
})

test('docked fitting preserves normal and collapsed layouts and minimum window sizes',()=>{
 const {fitDockedParent}=loadTypeScript('src/main/widget-docking.ts')
 const area={x:0,y:0,width:2000,height:1600},child={x:0,y:0,width:300,height:108}
 for(const parentId of ['quick','todos'])for(const edge of ['top','bottom','left','right'])for(const height of [42,400]){
  const parent={x:400,y:400,width:300,height},dock={parentId,edge,offset:0}
  assert.deepEqual(fitDockedParent(parent,child,dock,area),parent)
 }
 const collapsed={x:100,y:0,width:300,height:42},dock={parentId:'todos',edge:'bottom',offset:0}
 assert.deepEqual(fitDockedParent(collapsed,child,dock,{x:0,y:0,width:1366,height:150}),collapsed)
 for(const parentId of ['quick','todos']){
  const fitted=fitDockedParent({x:0,y:0,width:500,height:700},child,{parentId,edge:'bottom',offset:0},{x:0,y:0,width:250,height:200})
  assert.equal(fitted.width,300)
  assert.equal(fitted.height,parentId==='quick'?280:160)
 }
})

test('window callbacks apply width-only dock fitting and preserve ordinary right resizing',()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),{EventEmitter}=require('node:events')
 const source=fs.readFileSync('src/main/index.ts','utf8'),ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true)
 const declarations=['healthWidgetSize','snapDesktopModuleBounds','bindDesktopWidgetMovement'].map(name=>{
  const statement=ast.statements.find(node=>ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name) && declaration.name.text===name))
  assert.ok(statement,`${name} exists`)
  return statement.getText(ast)
 }).join(';')
 const compiled=ts.transpileModule(declarations+';module.exports=bindDesktopWidgetMovement',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 function windowCase(docked){
  const raw={x:0,y:0,width:1200,height:400},applied=[],window=new EventEmitter()
  let bounds=raw,prevented=0,persisted=0
  Object.assign(window,{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>bounds,getMinimumSize:()=>[300,160],setBounds:next=>{bounds=next;applied.push(next)}})
  const context={module:{exports:null},...loadTypeScript('src/main/widget-snap.ts'),...loadTypeScript('src/main/widget-docking.ts'),
   screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1366,height:728}})},
   store:{data:{settings:{snapMode:'none',desktopSnapDistance:10},desktopModules:docked?[{id:'health',kind:'health',visible:true,x:0,y:0,width:300,height:108,dock:{parentId:'todos',edge:'right',offset:0}}]:[]}},
   desktopModuleWindows:new Map([['todos',window]]),desktopZoneWindows:new Map(),resizingDesktopWidgets:new Set(),draggingDesktopWidgets:new Set(),desktopDragOrigins:new Map(),
   followDockedHealth:()=>{},isDesktopWidgetInteracting:()=>false}
  vm.runInNewContext(compiled,context)
  context.module.exports('todos',window,new Set(),()=>{persisted++})
  return {raw,window,applied,event:{preventDefault:()=>{prevented++}},counts:()=>({prevented,persisted})}
 }
 const resize=windowCase(true)
 resize.window.emit('will-resize',resize.event,resize.raw,{edge:'right'})
 assert.deepEqual(resize.counts(),{prevented:1,persisted:0})
 assert.deepEqual(resize.applied,[{...resize.raw,width:1066}])
 const moved=windowCase(true)
 moved.window.emit('will-move');moved.window.emit('moved')
 assert.deepEqual(moved.applied,[{...moved.raw,width:1066}])
 assert.deepEqual(moved.counts(),{prevented:0,persisted:1})
 const ordinary=windowCase(false)
 ordinary.window.emit('will-resize',ordinary.event,ordinary.raw,{edge:'right'})
 assert.deepEqual(ordinary.applied,[])
 assert.deepEqual(ordinary.counts(),{prevented:0,persisted:0})
})

test('overdue badge follows scheduled instant and excludes completed or undated tasks',()=>{
 const {isTodoOverdue}=loadTypeScript('src/renderer/todo-groups.ts')
 const now=new Date(2026,9,21,9).getTime()
 assert.equal(isTodoOverdue({completed:false,dueAt:new Date(now-1).toISOString()},now),true)
 for(const todo of [{completed:false},{completed:false,dueAt:'invalid'},{completed:true,dueAt:new Date(now-1).toISOString()},{completed:false,dueAt:new Date(now).toISOString()},{completed:false,dueAt:new Date(now+1).toISOString()}])assert.equal(isTodoOverdue(todo,now),false)
})
test('todo date and time round-trip without discarding the selected hour',()=>{
 const {parseTodoDateTime,todoDueAt,todoDueValue}=loadTypeScript('src/renderer/todo-dates.ts')
 const now=new Date(2026,9,21,0,9).getTime()
 assert.equal(parseTodoDateTime('2026-10-21 14:30',now),'2026-10-21T14:30')
 assert.equal(parseTodoDateTime('明天 09:15',now),'2026-10-22T09:15')
 for(const invalid of ['2026-02-30T14:30','2026-10-21T24:00','2026-10-21T09:60'])assert.equal(parseTodoDateTime(invalid,now),null)
 assert.equal(todoDueValue(todoDueAt('2026-10-21T14:30')),'2026-10-21T14:30')
 assert.equal(todoDueValue(todoDueAt('2026-10-21')),'2026-10-21T23:59')
 assert.equal(todoDueAt(''),undefined)
 assert.throws(()=>todoDueAt('2026-10-21T25:00'))
})
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
 for(const status of ['active'])assert.equal(hydrationPlanCanRecord({enabled:true,status}),true)
 for(const status of ['before','ended','complete'])assert.equal(hydrationPlanCanRecord({enabled:true,status}),false)
 assert.equal(hydrationPlanCanRecord({enabled:false,status:'ended'}),true)
})
