import type { DesktopModule } from './types'

export const healthWidgetSize = { width: 300, height: 80 } as const

export const assistantTools = [
  { id: 'todos', title: '待办', icon: 'todo' },
  { id: 'calendar', title: '日历', icon: 'calendar' },
  { id: 'notes', title: '便签', icon: 'note' },
  { id: 'countdown', title: '倒数日', icon: 'countdown' },
  { id: 'focus', title: '专注', icon: 'focus' },
] as const
export const assistantDetailTools = [
  { id:'clock', title:'时钟', icon:'clock' },
  { id:'weather', title:'天气', icon:'weather' },
  { id:'devices', title:'设备', icon:'desktop' }
] as const
export type AssistantToolId = typeof assistantTools[number]['id'] | typeof assistantDetailTools[number]['id']

export function desktopPanels(modules: DesktopModule[]): DesktopModule[] {
  const legacyToolsVisible = modules.some(module => !['quick','todos','health'].includes(module.kind) && module.visible)
  return modules.filter(module => ['quick','todos','health'].includes(module.kind)).map(module => module.kind === 'todos'
    ? { ...module, title: '桌面搭子', visible: module.visible || legacyToolsVisible }
    : { ...module })
}

export function setPanelVisibility(modules: DesktopModule[], id: string, visible: boolean): void {
  const module = modules.find(module => module.id === id)
  if (!module) throw new Error('未找到指定的桌面模块。')
  module.visible = visible
  if (module.kind === 'todos' && !visible) {
    for (const tool of modules.filter(item => !['quick','todos','health'].includes(item.kind))) tool.visible = false
  }
}
