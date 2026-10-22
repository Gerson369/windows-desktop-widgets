const {app,BrowserWindow,ipcMain,Menu}=require('electron')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'..')
const testDirectory=process.env.GERSON_E2E_DATA_DIRECTORY
const collectionFixture=path.join(testDirectory,'collection-items.json')
const withCollection=data=>{
 if(!fs.existsSync(collectionFixture))return data
 const items=JSON.parse(fs.readFileSync(collectionFixture,'utf8'))
 return {...data,desktopItems:items,desktopZones:data.desktopZones.map(zone=>({...zone,itemIds:items.filter(item=>zone.id===(item.category==='image'?'desktop-images':'desktop-apps')).map(item=>item.path)}))}
}
const failStoreWrite=path.join(testDirectory,'fail-store-write'),writeSync=fs.writeFileSync
fs.writeFileSync=(file,...args)=>{
 if(String(file).startsWith(testDirectory) && String(file).includes('toolbox-data.json') && fs.existsSync(failStoreWrite)){fs.unlinkSync(failStoreWrite);throw Error('测试磁盘写入失败，原设置已保留')}
 return writeSync(file,...args)
}
const buildMenu=Menu.buildFromTemplate.bind(Menu)
Menu.buildFromTemplate=(template)=>{
 const menu=buildMenu(template),popup=menu.popup.bind(menu)
 menu.popup=options=>{
  const choice=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'menu-action')
  if(!fs.existsSync(choice))return popup(options)
  const label=fs.readFileSync(choice,'utf8');fs.unlinkSync(choice)
  const item=menu.items.find(item=>item.label===label)
  if(!item || !item.enabled)throw Error('Menu item unavailable: '+label)
  item.click()
 }
 return menu
}
const testClock=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'clock')
const realNow=Date.now
Date.now=()=>fs.existsSync(testClock)?Number(fs.readFileSync(testClock,'utf8')):realNow()
app.setAppPath(root)
const failSave=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'fail-save')
const handle=ipcMain.handle.bind(ipcMain)
let readData
ipcMain.handle=(channel,listener)=>{
 if(channel==='data:get')readData=listener
 return handle(channel,async(...args)=>{
  if(channel==='files:trash' && fs.existsSync(collectionFixture)){
   const items=JSON.parse(fs.readFileSync(collectionFixture,'utf8')),item=items.find(item=>item.path===args[1])
   if(item){if(item.testFailure)throw Error(item.testFailure);fs.writeFileSync(collectionFixture,JSON.stringify(items.filter(candidate=>candidate.path!==item.path)));return withCollection(await readData(args[0]))}
  }
  const fixturePath=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'service-fixtures.json')
  if(fs.existsSync(fixturePath)){const fixtures=JSON.parse(fs.readFileSync(fixturePath,'utf8'));if(channel==='suite:metrics' && fixtures.metrics)return fixtures.metrics;if(channel==='suite:weather' && fixtures.weather?.[args[1]])return fixtures.weather[args[1]]}
  if(channel==='settings:update' && fs.existsSync(failSave)){fs.unlinkSync(failSave);throw Error('测试保存失败，请重试')}
  if(channel==='entity:upsert' && args[1]==='todos' && Object.hasOwn(args[2],'reminderAt')){
    const delay=path.join(testDirectory,'delay-reminder-save')
    if(fs.existsSync(delay)){fs.unlinkSync(delay);await new Promise(resolve=>setTimeout(resolve,300))}
    const failure=path.join(testDirectory,'fail-reminder-save')
    if(fs.existsSync(failure)){fs.unlinkSync(failure);throw Error('测试提醒未保存，请重试')}
  }
  const result=await listener(...args)
  return channel==='data:get'?withCollection(result):result
 })
}
require(path.join(root,'out/main/index.js'))
const marker=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'quit')
const snapshot=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'snapshot')
// Hold explicit visual fixtures steady while production reminder broadcasts continue.
app.on('web-contents-created',(_event,contents)=>{
  const send=contents.send.bind(contents)
  contents.send=(channel,...args)=>{
    if(channel==='wellness:changed' && fs.existsSync(snapshot))args[0]=JSON.parse(fs.readFileSync(snapshot,'utf8'))
    if(channel==='data:changed')args[0]=withCollection(args[0])
    send(channel,...args)
  }
})
const resize=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'resize')
const navigation=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'navigate')
const boundsTimer=setInterval(()=>{
 if(fs.existsSync(path.join(testDirectory,'capture-bounds'))){const target=path.join(testDirectory,'window-bounds.json');fs.writeFileSync(target+'.tmp',JSON.stringify(BrowserWindow.getAllWindows().map(window=>({url:window.webContents.getURL(),bounds:window.getBounds()}))));fs.renameSync(target+'.tmp',target)}
},200)
boundsTimer.unref()
const timer=setInterval(()=>{if(fs.existsSync(snapshot)){const state=JSON.parse(fs.readFileSync(snapshot,'utf8'));BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('desktopModule=todos'))?.webContents.send('wellness:changed',state)}if(fs.existsSync(resize)){const {id='todos',...bounds}=JSON.parse(fs.readFileSync(resize,'utf8'));fs.unlinkSync(resize);const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('desktopModule='+id));if(window){const moving='x' in bounds || 'y' in bounds;if(moving)window.emit('will-move');window.setBounds({...window.getBounds(),...bounds});if(moving)window.emit('moved')}}if(fs.existsSync(navigation)){const section=fs.readFileSync(navigation,'utf8');fs.unlinkSync(navigation);BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('desktopModule=todos'))?.webContents.send('navigate',section)}if(fs.existsSync(marker)){clearInterval(timer);app.quit()}},200)
setTimeout(()=>{clearInterval(timer);app.quit()},120000).unref()
