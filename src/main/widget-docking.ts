import type { WidgetBounds } from './widget-snap'
export interface WidgetDock { parentId: 'quick' | 'todos'; edge: 'top' | 'bottom' | 'left' | 'right'; offset: number }
export function validWidgetDock(value: unknown): value is WidgetDock {
  const dock=value as WidgetDock | undefined
  return Boolean(dock && ['quick','todos'].includes(dock.parentId) && ['top','bottom','left','right'].includes(dock.edge) && Number.isFinite(dock.offset) && Math.abs(dock.offset)<=10000)
}
export function dockedWidgetBounds(child: WidgetBounds, dock: WidgetDock, parent: WidgetBounds): WidgetBounds {
  switch(dock.edge){
    case 'bottom':return {...child,x:parent.x+dock.offset,y:parent.y+parent.height}
    case 'top':return {...child,x:parent.x+dock.offset,y:parent.y-child.height}
    case 'right':return {...child,x:parent.x+parent.width,y:parent.y+dock.offset}
    case 'left':return {...child,x:parent.x-child.width,y:parent.y+dock.offset}
  }
}
export function findWidgetDock(child: WidgetBounds, parents: Array<{id:string;bounds:WidgetBounds}>): WidgetDock | undefined {
  for(const direction of ['vertical','horizontal'])for(const {id,bounds:p} of parents){
    if(id!=='quick' && id!=='todos')continue
    const horizontal=Math.min(child.x+child.width,p.x+p.width)-Math.max(child.x,p.x)>32
    const vertical=Math.min(child.y+child.height,p.y+p.height)-Math.max(child.y,p.y)>32
    if(direction==='vertical' && horizontal && Math.abs(child.y-p.y-p.height)<=1)return {parentId:id,edge:'bottom',offset:child.x-p.x}
    if(direction==='vertical' && horizontal && Math.abs(child.y+child.height-p.y)<=1)return {parentId:id,edge:'top',offset:child.x-p.x}
    if(direction==='horizontal' && vertical && Math.abs(child.x-p.x-p.width)<=1)return {parentId:id,edge:'right',offset:child.y-p.y}
    if(direction==='horizontal' && vertical && Math.abs(child.x+child.width-p.x)<=1)return {parentId:id,edge:'left',offset:child.y-p.y}
  }
}
export function fitDockedParent(parent: WidgetBounds, child: WidgetBounds, dock: WidgetDock, area: WidgetBounds): WidgetBounds {
  const vertical=dock.edge==='top' || dock.edge==='bottom'
  const minimumHeight=parent.height===42 ? 42 : dock.parentId==='quick' ? 280 : 160
  const offsetOverhang=Math.max(0,-dock.offset)
  // ponytail: screens smaller than the minimum docked group can still overflow; detach the panels if support for those screens is needed.
  const fitted={...parent,
    width:Math.max(300,Math.min(parent.width,area.width-(vertical?offsetOverhang:child.width))),
    height:Math.max(minimumHeight,Math.min(parent.height,area.height-(vertical?child.height:offsetOverhang)))}
  const attached=dockedWidgetBounds(child,dock,fitted)
  const left=Math.min(fitted.x,attached.x),top=Math.min(fitted.y,attached.y)
  const right=Math.max(fitted.x+fitted.width,attached.x+attached.width),bottom=Math.max(fitted.y+fitted.height,attached.y+attached.height)
  const dx=Math.max(area.x-left,Math.min(0,area.x+area.width-right)),dy=Math.max(area.y-top,Math.min(0,area.y+area.height-bottom))
  return {...fitted,x:fitted.x+dx,y:fitted.y+dy}
}
