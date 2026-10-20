const {app,BrowserWindow,ipcMain}=require('electron')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'..')
app.setAppPath(root)
const failSave=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'fail-save')
const handle=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,listener)=>handle(channel,async(...args)=>{
  const fixturePath=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'service-fixtures.json')
  if(fs.existsSync(fixturePath)){const fixtures=JSON.parse(fs.readFileSync(fixturePath,'utf8'));if(channel==='suite:metrics' && fixtures.metrics)return fixtures.metrics;if(channel==='suite:weather' && fixtures.weather?.[args[1]])return fixtures.weather[args[1]]}
  if(channel==='settings:update' && fs.existsSync(failSave)){fs.unlinkSync(failSave);throw Error('测试保存失败，请重试')}
  return listener(...args)
})
require(path.join(root,'out/main/index.js'))
const marker=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'quit')
const snapshot=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'snapshot')
// Hold explicit visual fixtures steady while production reminder broadcasts continue.
app.on('web-contents-created',(_event,contents)=>{
  const send=contents.send.bind(contents)
  contents.send=(channel,...args)=>{
    if(channel==='wellness:changed' && fs.existsSync(snapshot))args[0]=JSON.parse(fs.readFileSync(snapshot,'utf8'))
    send(channel,...args)
  }
})
const resize=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'resize')
const navigation=path.join(process.env.GERSON_E2E_DATA_DIRECTORY,'navigate')
const timer=setInterval(()=>{if(fs.existsSync(snapshot)){const state=JSON.parse(fs.readFileSync(snapshot,'utf8'));BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('desktopModule=todos'))?.webContents.send('wellness:changed',state)}if(fs.existsSync(resize)){const bounds=JSON.parse(fs.readFileSync(resize,'utf8'));fs.unlinkSync(resize);const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('desktopModule=todos'));if(window)window.setBounds({...window.getBounds(),...bounds})}if(fs.existsSync(navigation)){const section=fs.readFileSync(navigation,'utf8');fs.unlinkSync(navigation);BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('desktopModule=todos'))?.webContents.send('navigate',section)}if(fs.existsSync(marker)){clearInterval(timer);app.quit()}},200)
setTimeout(()=>{clearInterval(timer);app.quit()},120000).unref()
