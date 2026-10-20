import { onBeforeUnmount } from 'vue'

export function useDesktopDrag() {
  let active=false
  let frame=0
  let started:Promise<void>=Promise.resolve()
  const report=(error:unknown):void=>{ console.error('桌面组件拖动失败',error) }
  const finish=():void=>{
    if(!active) return
    active=false
    if(frame) cancelAnimationFrame(frame)
    frame=0
    void started.then(()=>window.toolbox.desktopModules.drag('end')).catch(report)
  }
  const move=():void=>{
    if(!active || frame) return
    frame=requestAnimationFrame(()=>{
      frame=0
      void started.then(()=>window.toolbox.desktopModules.drag('move')).catch(report)
    })
  }
  const start=(event:PointerEvent):void=>{
    if(active || event.button!==0 || (event.target as Element).closest('button,input,select,textarea,a')) return
    event.preventDefault()
    const header=event.currentTarget as HTMLElement
    header.setPointerCapture(event.pointerId)
    active=true
    started=window.toolbox.desktopModules.drag('start')
    void started.catch(error=>{active=false;report(error)})
  }
  onBeforeUnmount(finish)
  return { start,move,finish,get active() { return active } }
}
