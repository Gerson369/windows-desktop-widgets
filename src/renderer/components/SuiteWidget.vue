<script setup lang="ts">
import { toolbox } from '../toolbox'

const api=toolbox
import {computed,onMounted,onBeforeUnmount,ref} from 'vue'
import type {AppData} from '../../main/types'
import {useDesktopDrag} from '../useDesktopDrag'
import AssistantIcon from './AssistantIcon.vue'
import CalendarCard from './suite/CalendarCard.vue'
import TimeCard from './suite/TimeCard.vue'
import NotesCard from './suite/NotesCard.vue'
import WeatherCard from './suite/WeatherCard.vue'
import DeviceCard from './suite/DeviceCard.vue'
const props=defineProps<{moduleId:string;embedded?:boolean}>()
const data=ref<AppData|null>(null), error=ref(''), shown=ref(!document.hidden)
const drag=useDesktopDrag()
const module=computed(()=>data.value?.desktopModules.find(item=>item.id===props.moduleId))
let dispose:(()=>void)|undefined
const visibility=()=>{shown.value=!document.hidden}
async function update(patch:{collapsed?:boolean;visible?:boolean}) {try {data.value=await api.desktopModules.update(props.moduleId,patch)}catch(reason){error.value=String(reason)}}
onMounted(async()=>{document.addEventListener('visibilitychange',visibility);try{data.value=await api.data.get();dispose=api.data.onChanged(next=>{data.value=next})}catch(reason){error.value=String(reason)}})
onBeforeUnmount(()=>{dispose?.();document.removeEventListener('visibilitychange',visibility)})
</script>
<template>
  <main v-if="data && module" class="suite-widget" :style="{'--suite-alpha':data.settings.desktopModuleOpacity/100}">
    <header v-if="!embedded" class="module-header" @pointerdown="drag.start" @pointermove="drag.move" @pointerup="drag.finish" @pointercancel="drag.finish" @lostpointercapture="drag.finish">
      <AssistantIcon :name="module.kind === 'notes' ? 'note' : module.kind"/><b>{{module.title}}</b><button aria-label="组件设置" title="组件设置" @click="api.desktopModules.openMain('settings')"><AssistantIcon name="settings"/></button><button :aria-label="module.collapsed?'展开组件':'收起组件'" :title="module.collapsed?'展开组件':'收起组件'" @click="update({collapsed:!module.collapsed})"><AssistantIcon :name="module.collapsed?'expand':'collapse'"/></button><button aria-label="隐藏组件" title="隐藏组件" @click="update({visible:false})"><AssistantIcon name="close"/></button>
    </header>
    <section v-if="shown && (embedded || !module.collapsed)" class="suite-content">
      <CalendarCard v-if="module.kind==='calendar'" :data="data"/>
      <NotesCard v-else-if="module.kind==='notes'" :data="data"/>
      <TimeCard v-else-if="module.kind==='clock' || module.kind==='countdown' || module.kind==='focus'" :data="data" :kind="module.kind"/>
      <WeatherCard v-else-if="module.kind==='weather'" :data="data"/>
      <DeviceCard v-else-if="module.kind==='devices'"/>
    </section>
    <p v-if="error" role="alert">{{error}}</p>
  </main>
</template>
<style>
.suite-widget{height:100%;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--widget-line,#ffffff32);border-radius:var(--widget-radius,14px);background:color-mix(in srgb,var(--widget-background,#232729) calc(var(--suite-alpha,.7)*100%),transparent);color:var(--widget-text,#f4f7f6);font-size:var(--widget-font-size,14px)}
.suite-widget .module-header{display:flex;align-items:center;gap:8px;flex:0 0 40px;padding:0 12px;cursor:move;touch-action:none;user-select:none}.suite-widget .module-header b{margin-right:auto;font-size:13px;font-weight:600}.suite-widget .module-header>svg{color:var(--widget-accent,#b8ddc7)}.suite-widget .module-header svg{width:18px;height:18px;flex-shrink:0}.suite-widget .module-header button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;background:transparent}
.suite-content{padding:12px 14px;overflow:auto;min-height:0;flex:1;scrollbar-width:thin;scrollbar-color:#b6c7bd55 transparent}.suite-content form,.suite-content .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.suite-content input,.suite-content textarea,.suite-content select,.suite-content button,.suite-widget header button{font:inherit;color:inherit;border:1px solid var(--widget-line,#ffffff30);border-radius:var(--widget-control-radius,8px);padding:6px 8px;background:#13221c66}.suite-content input,.suite-content textarea{max-width:100%;min-width:0;caret-color:#b7e5c7}.suite-content input::placeholder,.suite-content textarea::placeholder{color:#bccbc3}.suite-content input:not([type=checkbox]):not([type=number]):not([type=color]){flex:1}.suite-content input:not([type=checkbox]),.suite-content select,.suite-content button{min-height:30px}.suite-content input[type=checkbox]{accent-color:var(--widget-accent,#a4dbb6)}.suite-content button,.suite-widget header button{cursor:pointer;transition:background .15s ease,border-color .15s ease}.suite-content button:disabled{opacity:.5;cursor:default}.suite-content button:hover:not(:disabled),.suite-widget header button:hover{background:#a4dbb61f;border-color:#a4dbb64a}.suite-content :focus-visible,.suite-widget button:focus-visible{outline:2px solid #b8e1ca;outline-offset:1px}.suite-content small,.suite-content .hint{font-size:11px;line-height:1.65;color:#c5d3cb}.suite-content .entry{padding:12px 0;border-bottom:1px solid var(--widget-line,#ffffff24)}.suite-content .entry .row{margin:0}.suite-content p[role=alert]{color:#ffd0c6;font-size:12px;line-height:1.6}.suite-content h2{font-size:30px;font-weight:500;letter-spacing:-.02em;margin:10px 0;font-variant-numeric:tabular-nums}.suite-content textarea{width:100%;resize:vertical;min-height:90px}.suite-content label{display:flex;gap:6px;align-items:center}.suite-content a{color:#bce9cc}.suite-content button[aria-pressed=true]{background:#a4dbb629;border-color:#a4dbb66b;color:#e2f6e9}.suite-content ::selection{background:#47614f;color:#fff}.suite-content .empty-state{padding:24px 8px;text-align:center;color:#c5d3cb;font-size:12px;line-height:1.7}
@media(max-width:320px){.suite-content{padding:10px 12px}}
@media(prefers-reduced-motion:reduce){.suite-content button,.suite-widget header button{transition:none}}
</style>
