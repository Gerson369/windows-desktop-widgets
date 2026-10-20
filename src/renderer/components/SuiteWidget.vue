<script setup lang="ts">
import { toolbox } from '../toolbox'

const api=toolbox
import {computed,onMounted,onBeforeUnmount,ref} from 'vue'
import type {AppData} from '../../main/types'
import {useDesktopDrag} from '../useDesktopDrag'
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
      <b>{{module.title}}</b><button aria-label="组件设置" @click="api.desktopModules.openMain('settings')">⚙</button><button :aria-label="module.collapsed?'展开组件':'收起组件'" @click="update({collapsed:!module.collapsed})">{{module.collapsed?'+':'−'}}</button><button aria-label="隐藏组件" @click="update({visible:false})">×</button>
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
.suite-widget{height:100%;display:flex;flex-direction:column;overflow:hidden;border:1px solid #ffffff32;border-radius:6px;background:color-mix(in srgb,var(--widget-background,#232729) calc(var(--suite-alpha,.7)*100%),transparent);color:var(--widget-text,#f4f7f6);font-size:var(--widget-font-size,14px)}
.suite-widget .module-header{display:flex;align-items:center;gap:6px;min-height:40px;padding:0 10px;cursor:move;touch-action:none;user-select:none}.suite-widget .module-header b{margin-right:auto}.suite-content{padding:12px;overflow:auto;min-height:0;flex:1}.suite-content form,.suite-content .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.suite-content input,.suite-content textarea,.suite-content select,.suite-content button,.suite-widget header button{font:inherit;color:inherit;border:1px solid #ffffff38;border-radius:4px;padding:6px;background:#182520}.suite-content input,.suite-content textarea{max-width:100%;min-width:0}.suite-content input:not([type=checkbox]):not([type=number]){flex:1}.suite-content button,.suite-widget header button{cursor:pointer}.suite-content button:disabled{opacity:.5;cursor:default}.suite-content button:hover:not(:disabled){background:#365443}.suite-content :focus-visible,.suite-widget button:focus-visible{outline:2px solid #a4dbb6;outline-offset:1px}.suite-content small,.suite-content .hint{font-size:12px;line-height:1.7;opacity:.8}.suite-content .entry{padding:10px 0;border-bottom:1px solid #ffffff24}.suite-content .entry .row{margin:0}.suite-content p[role=alert]{color:#ffd0c6;font-size:12px;line-height:1.6}.suite-content h2{font-size:30px;margin:10px 0;font-variant-numeric:tabular-nums}.suite-content textarea{width:100%;resize:vertical;min-height:90px}.suite-content label{display:flex;gap:6px;align-items:center}.suite-content a{color:#bce9cc}.suite-content button[aria-pressed=true]{background:#3d624d}
</style>
