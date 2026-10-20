import { onBeforeUnmount, ref, watch } from 'vue'

export function useWidgetHover(enabled: () => boolean, collapsed: () => boolean, delay: () => number, dragging: () => boolean) {
  const expanded = ref(false)
  let timer = 0
  const clear = () => { if (timer) window.clearTimeout(timer); timer = 0 }
  const cancel = () => {
    clear()
    if (!expanded.value) return
    expanded.value = false
    void window.toolbox.desktopModules.hover(false).catch(console.error)
  }
  const enter = () => {
    clear()
    if (!enabled() || !collapsed() || expanded.value) return
    timer = window.setTimeout(() => {
      if (!enabled() || !collapsed() || dragging()) return
      expanded.value = true
      void window.toolbox.desktopModules.hover(true).catch(error => { expanded.value = false; console.error(error) })
    }, 240)
  }
  const leave = () => {
    clear()
    if (!expanded.value) return
    timer = window.setTimeout(() => {
      if (dragging() || document.activeElement?.matches('input,textarea,select') || document.querySelector('.file-context-menu,.health-popover,.todo-reminder-editor')) { leave(); return }
      cancel()
    }, delay())
  }
  watch([enabled, collapsed], () => { if (!enabled() || !collapsed()) cancel() })
  onBeforeUnmount(cancel)
  return { expanded, enter, leave, cancel }
}
