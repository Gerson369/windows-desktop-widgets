<script setup lang="ts">
import { toolbox } from '../toolbox'

const emit=defineEmits<{return:[]}>()
const api=toolbox
const confirm=window.confirm.bind(window)
import {onMounted,onBeforeUnmount,ref} from 'vue'
import { createSaveQueue } from '../save-queue'
import { desktopPanels } from '../../main/desktop-panels'
import type {AppData} from '../../main/types'
const props=defineProps<{data:AppData;group:'appearance'|'desktop'}>()
const error=ref(''),displays=ref<Array<{id:number;label:string}>>([]),busy=ref(false)
const shortcut=ref(props.data.settings.shortcuts.find(item=>item.action==='toggle-panel')?.accelerator || 'CommandOrControl+Shift+Space')
let disposeShortcut:(()=>void)|undefined
const queue=createSaveQueue(),retry=ref<(()=>Promise<unknown>)|null>(null)
let saveRevision=0
async function perform(action:()=>Promise<unknown>){const current=++saveRevision;busy.value=true;error.value='';try{await queue(action);if(current===saveRevision)retry.value=null}catch(reason){if(current===saveRevision){retry.value=action;error.value=String(reason)}}finally{if(current===saveRevision)busy.value=false}}
async function setShortcut(){await api.settings.update({shortcuts:[...props.data.settings.shortcuts.filter(item=>item.action!=='toggle-panel'),{action:'toggle-panel',accelerator:shortcut.value,enabled:true}]})}
onBeforeUnmount(()=>disposeShortcut?.())
onMounted(async()=>{disposeShortcut=api.events.onShortcutError(key=>{error.value=`快捷键 ${key} 无法注册，可能已被其他程序占用。`});try{displays.value=await api.suite.displays()}catch(reason){error.value=String(reason)}})
</script>
<template>
  <section class="suite-settings">
    <template v-if="group==='desktop'">
    <h3>组件管理</h3><p class="hint">桌面只显示收纳框和综合助手。助手内点击图标切换全部工具，项目在收纳框内切换。</p>
    <div v-for="module in desktopPanels(data.desktopModules)" :key="module.id" class="component-row"><span class="component-name">{{module.title}}</span><button role="switch" :aria-label="`显示${module.title}`" :aria-checked="module.visible" :disabled="busy" @click="perform(()=>api.desktopModules.update(module.id,{visible:!module.visible}))">{{module.visible?'显示':'隐藏'}}</button><select :value="module.displayId" :aria-label="`${module.title}所在显示器`" :disabled="busy" @change="perform(()=>api.suite.moveDisplay(module.id,Number(($event.target as HTMLSelectElement).value)))"><option v-for="display in displays" :key="display.id" :value="display.id">{{display.label}}</option></select></div>

    <div class="actions"><button @click="emit('return')">打开综合助手</button><button @click="perform(()=>api.suite.visibility('toggle'))">临时显示 / 隐藏</button><button @click="perform(()=>api.suite.visibility('resetLayout'))">恢复右侧布局</button></div>
    <form class="actions" @submit.prevent="perform(setShortcut)"><input v-model="shortcut" maxlength="100" aria-label="综合助手快捷键" @change="perform(setShortcut)" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"/></form><p class="hint">默认 Ctrl + Shift + Space 呼出 / 收起；面板内 Esc 收起。</p>
    </template><template v-if="group==='appearance'">
    <h3>统一外观</h3><label>背景颜色<input type="color" :value="data.suite.background" aria-label="组件背景颜色" @change="perform(()=>api.suite.save({background:($event.target as HTMLInputElement).value}))"/></label><label>文字颜色<input type="color" :value="data.suite.textColor" aria-label="组件文字颜色" @change="perform(()=>api.suite.save({textColor:($event.target as HTMLInputElement).value}))"/></label><label>字号<input type="number" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" min="12" max="20" :value="data.suite.fontSize" aria-label="组件字号" @change="perform(()=>api.suite.save({fontSize:Number(($event.target as HTMLInputElement).value)}))"/></label>
    </template><template v-if="group==='desktop'">
    <label>在收纳框中显示系统图标<button role="switch" aria-label="显示系统图标" :aria-checked="data.suite.showSystemIcons" @click="perform(()=>api.suite.save({showSystemIcons:!data.suite.showSystemIcons}))">{{data.suite.showSystemIcons?'显示':'隐藏'}}</button></label><p class="hint">系统图标也能从应用页打开；显示原桌面可恢复 Explorer 图标。</p>
    <h3>数据与隐私</h3><p class="hint">便签、待办、布局和日程保存在本机。天气仅发送所选城市信息；订阅仅访问你添加的地址。无新闻推荐、广告或收费试用。</p><div class="actions"><button @click="perform(()=>api.config.export())">导出全部数据</button><button @click="perform(async()=>{if(confirm('导入会替换当前配置；请先导出备份。继续？'))await api.config.import()})">导入数据</button></div><p class="hint">导出含便签正文和私人日历订阅链接，请妥善保管。</p></template><p v-if="error" role="alert">{{error}} <button v-if="retry" @click="perform(retry!)">重试</button></p>
  </section>
</template>
<style scoped>.suite-settings{font-size:12px}.suite-settings label{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0}.component-row{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(80px,140px);align-items:center;gap:6px}.component-row .component-name{flex:1;font-size:12px}.component-row{padding:8px 0}.suite-settings button[aria-checked=true]{background:#bdddc7;color:#14281b}.component-row select{min-width:0;width:100%}.actions{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}.actions input{min-width:0;flex:1}.suite-settings button,.suite-settings select,.suite-settings input:not([type=checkbox]):not([type=color]){padding:5px 8px;color:inherit;background:#24352c;border:1px solid #ffffff38;border-radius:4px;font:inherit}.suite-settings h3{font-size:14px;margin:18px 0 4px}.suite-settings [role=alert]{font-size:12px;color:#ffd0c6}.suite-settings :focus-visible{outline:2px solid #a4dbb6}</style>
