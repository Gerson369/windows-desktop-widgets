<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppData } from '../../main/types'
import { assistantTools, assistantDetailTools, type AssistantToolId } from '../../main/desktop-panels'
import { useDesktopDrag } from '../useDesktopDrag'
import { useWidgetHover } from '../useWidgetHover'
import WellnessControls from './WellnessControls.vue'
import AssistantIcon from './AssistantIcon.vue'
import DesktopModule from './DesktopModule.vue'
import SuiteWidget from './SuiteWidget.vue'
import SettingsPanel from './SettingsPanel.vue'
import AssistantOverview from './AssistantOverview.vue'

const props=defineProps<{initialSettings?:boolean}>()
const settingsOpen=ref(Boolean(props.initialSettings))
const settingsVisited=ref(Boolean(props.initialSettings))
const settingsSection=ref('health')
function openSettings(section='health'){settingsVisited.value=true;settingsSection.value=section;settingsOpen.value=true;waterOverflow.value={level:0,color:'#78cbdc'};void update({collapsed:false})}
const api = toolbox
const data = ref<AppData | null>(null)
const active = ref<AssistantToolId>('todos')
const error = ref('')
const waterOverflow = ref({level:0,color:'#78cbdc'})
const reminderId = ref('')
const drag = useDesktopDrag()
const module = computed(() => data.value?.desktopModules.find(item => item.kind === 'todos'))
const hover = useWidgetHover(() => Boolean(data.value?.settings.desktopHoverExpandEnabled) && !settingsOpen.value, () => Boolean(module.value?.collapsed), () => data.value?.settings.desktopHoverCollapseDelay || 360, () => drag.active)
const collapsed = computed(() => Boolean(module.value?.collapsed) && !hover.expanded.value)
const title = computed(() => [...assistantTools,...assistantDetailTools].find(tool => tool.id === active.value)!.title)
let dispose: (() => void) | undefined
let disposeNavigation: (() => void) | undefined
async function update(patch: { visible?: boolean; collapsed?: boolean }) {
  try { await api.desktopModules.update('todos', patch) } catch (reason) { error.value = String(reason) }
}
async function toggleCollapsed() {
  if (hover.expanded.value) { hover.cancel(); return }
  await update({ collapsed: !module.value?.collapsed })
}
function keydown(event: KeyboardEvent) {
  if(event.key==='Escape' && settingsOpen.value){event.preventDefault();settingsOpen.value=false;return}
  if (event.key === 'Escape' && !(event.target instanceof Element && event.target.closest('input,textarea,select,[popover],[role=dialog],.health-popover'))) void api.suite.visibility('closeOverlay')
}
function selectTool(id: typeof active.value) { reminderId.value = ''; active.value = id }
function navigate(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? assistantTools.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + assistantTools.length) % assistantTools.length
  selectTool(assistantTools[next].id)
  document.querySelector<HTMLButtonElement>(`[data-tool="${active.value}"]`)?.focus()
}
onMounted(async () => {
  document.addEventListener('keydown', keydown)
  disposeNavigation = api.events.onNavigate(section => {
    if(section==='settings' || section==='reminders' || section.startsWith('settings:')){openSettings(section==='settings:appearance'?'appearance':section==='settings:desktop'?'desktop':'health');return}
    settingsOpen.value=false
    const tool=[...assistantTools,...assistantDetailTools].find(tool=>tool.id===section)
    if(tool){selectTool(tool.id);void update({collapsed:false});return}
    if (section === 'wellness:hydration' || section === 'wellness:sedentary') { void update({ collapsed: false }); return }
    if (!section.startsWith('todo-reminder:')) return
    reminderId.value = section.slice('todo-reminder:'.length)
    active.value = 'todos'
  })
  try {
    dispose = api.data.onChanged(next => { data.value = next })
    data.value = await api.data.get()
  } catch (reason) { error.value = String(reason) }
})
onBeforeUnmount(() => { dispose?.(); disposeNavigation?.(); document.removeEventListener('keydown', keydown) })
</script>
<template>
  <main class="assistant-panel" :style="{ '--panel-alpha': (data?.settings.desktopModuleOpacity ?? 70) / 100 }" @mouseenter="hover.enter" @mouseleave="hover.leave">
    <div v-if="!collapsed && waterOverflow.level>0" class="assistant-flood" aria-hidden="true" :style="{'--water-level':waterOverflow.level,'--overflow-color':waterOverflow.color}"><svg class="flood-surface" viewBox="0 0 800 720" preserveAspectRatio="none"><path d="M0 10Q50 0 100 10T200 10T300 10T400 10T500 10T600 10T700 10T800 10V720H0Z"/></svg></div>
    <header class="module-header assistant-header" @pointerdown="drag.start" @pointermove="drag.move" @pointerup="drag.finish" @pointercancel="drag.finish" @lostpointercapture="drag.finish">
      <AssistantIcon name="layout"/><b>{{settingsOpen ? '助手设置' : '综合助手'}}</b>
      <button :title="settingsOpen ? '返回助手' : '设置'" :aria-label="settingsOpen ? '返回助手' : '设置'" @click="settingsOpen ? settingsOpen=false : openSettings()"><AssistantIcon :name="settingsOpen ? 'back' : 'settings'"/></button>
      <button :title="collapsed ? '展开' : '收起'" :aria-label="collapsed ? '展开综合助手' : '收起综合助手'" @click="toggleCollapsed"><AssistantIcon :name="collapsed ? 'expand' : 'collapse'"/></button>
      <button title="隐藏综合助手" aria-label="隐藏综合助手" @click="update({ visible: false })"><AssistantIcon name="close"/></button>
    </header>
    <SettingsPanel v-if="settingsVisited" v-show="settingsOpen && !collapsed" :section="settingsSection" @section="settingsSection=$event" @return="settingsOpen=false"/>
    <template v-if="!settingsOpen && !collapsed">
      <AssistantOverview v-if="data" :data="data" :active="active" @select="selectTool($event)"/>
      <nav class="assistant-tools" role="tablist" aria-label="助手功能">
        <button v-for="(tool, index) in assistantTools" :id="`tool-${tool.id}`" :key="tool.id" :data-tool="tool.id" role="tab" :aria-selected="active === tool.id" :aria-label="tool.title" :aria-controls="`content-${active}`" :tabindex="active === tool.id ? 0 : -1" :title="tool.title" @click="selectTool(tool.id)" @keydown="navigate($event, index)"><AssistantIcon :name="tool.icon"/></button>
      </nav>
      <section v-if="data" :id="`content-${active}`" class="assistant-content" role="tabpanel" :aria-label="title">
        <DesktopModule v-if="active === 'todos'" module-id="todos" :reminder-id="reminderId" embedded/>
        <SuiteWidget v-else :key="active" :module-id="active" embedded/>
      </section>
      <p v-else class="panel-message">正在加载…</p>
      <WellnessControls v-if="data" :data="data" @settings="openSettings()" @overflow="waterOverflow={level:$event.level,color:$event.color || '#78cbdc'}"/>
    </template>
    <p v-if="error" role="alert" class="panel-message">{{ error }}</p>
  </main>
</template>
<style scoped>
.assistant-panel>:not(.assistant-flood){position:relative;z-index:1}.assistant-flood{position:absolute;inset:40px 0 0;z-index:0;pointer-events:none;transform:translateY(calc((1 - var(--water-level))*100%));transition:transform 1s linear;overflow:visible}.flood-surface{position:absolute;left:0;top:-12px;width:200%;height:calc(100% + 12px);fill:color-mix(in srgb,var(--overflow-color) 24%,transparent);animation:flood-swell 4s linear infinite}@keyframes flood-swell{from{transform:translateX(0)}to{transform:translateX(-50%)}}@media(prefers-reduced-motion:reduce){.assistant-flood{transition:none}.flood-surface{animation:none}}

.assistant-panel{position:relative;isolation:isolate;height:100%;display:flex;flex-direction:column;overflow:hidden;border:1px solid #ffffff32;border-radius:6px;background:color-mix(in srgb,var(--widget-background,#232729) calc(var(--panel-alpha)*100%),transparent);color:var(--widget-text,#f4f7f6);font:var(--widget-font-size,14px) 'Microsoft YaHei UI',sans-serif}
.assistant-panel>header button,.assistant-summary button,.assistant-tools button{font:inherit;color:inherit;cursor:pointer;background:transparent;border:0;border-radius:4px}.assistant-panel>header button:hover,.assistant-summary button:hover,.assistant-tools button:hover{background:#ffffff16}.assistant-panel button:focus-visible{outline:2px solid #a4dbb6;outline-offset:-2px}.assistant-header svg,.assistant-summary svg,.assistant-tools svg{width:18px;height:18px;flex-shrink:0}
.assistant-header{display:flex;align-items:center;gap:8px;flex:0 0 40px;padding:0 10px;cursor:move;touch-action:none;user-select:none}.assistant-header>b{margin-right:auto;font-size:13px}.assistant-header>svg{color:#b8ddc7}.assistant-header button{display:grid;place-items:center;width:28px;height:28px}
.assistant-summary{display:flex;justify-content:space-between;align-items:center;padding:8px 12px 12px;gap:8px}.assistant-summary>button{display:flex;align-items:center;gap:10px;padding:4px;min-width:0}.assistant-summary strong{font-size:26px;font-weight:500;font-variant-numeric:tabular-nums}.assistant-summary span{font-size:11px;line-height:1.5}.assistant-summary .weather-shortcut{max-width:42%;flex-direction:column;gap:4px}.weather-shortcut span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.assistant-tools{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:0 10px;border-bottom:1px solid #ffffff28;flex:0 0 38px;gap:2px}.assistant-tools button{display:grid;place-items:center;border-radius:3px 3px 0 0;border-bottom:2px solid transparent}.assistant-tools button[aria-selected=true]{background:#a4dbb614;color:#c1efd1;border-bottom-color:#a4dbb6}
.assistant-section-title{display:flex;justify-content:space-between;align-items:center;padding:12px 14px 0;font-size:13px;font-weight:600}.assistant-section-title small{font-size:10px;font-weight:400;color:#cad8ce}.assistant-content{flex:1;min-height:0;overflow:hidden}.assistant-content :deep(.suite-widget){background:transparent;border:0;border-radius:0}.assistant-content :deep(.desktop-module){height:100%}.panel-message{padding:10px 14px;font-size:12px;line-height:1.6}.panel-message[role=alert]{color:#ffd0c6}
@media(max-height:360px){.assistant-summary{display:none}.assistant-section-title{padding-top:6px}.assistant-tools{flex-basis:34px}}
</style>
