<script setup lang="ts">
import { toolbox } from '../toolbox'
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import SuiteSettings from './SuiteSettings.vue'
import HydrationPlanSettings from './HydrationPlanSettings.vue'
import OrganizerCenter from './OrganizerCenter.vue'
import type { AppData, AppSettings } from '../../main/types'
import { collectionTabs, type CollectionTab } from '../../main/desktop-collection'
import { createSaveQueue } from '../save-queue'
const api = toolbox
const data = ref<AppData | null>(null)
const message = ref('')
const settingsBody=ref<HTMLElement|null>(null)
const transparencyPreview = ref<number | null>(null)
const busy = ref(false)
const emit=defineEmits<{section:[value:string];return:[]}>()
function selectSection(value:string){section.value=value;emit('section',value)}
const props = defineProps<{ section?: string }>()
const section = ref(props.section || 'health')
watch(() => props.section, value => { if(value) section.value = value })
watch(section,async()=>{await nextTick();settingsBody.value?.scrollTo(0,0)})
const saveQueue = createSaveQueue()
const retry = ref<(() => Promise<void>) | null>(null)
const ruleExtensions = ref('')
const ruleTab = ref<CollectionTab>('files')
let dispose: (() => void) | undefined
let saveRevision=0
async function perform(action: () => Promise<void>) {
  const current=++saveRevision
  busy.value = true; message.value = '正在保存…'
  try {
    await saveQueue(action)
    if(current===saveRevision){retry.value=null;if(message.value==='正在保存…')message.value='已保存'}
  } catch (error) {
    if(current===saveRevision){retry.value=action;message.value=error instanceof Error?error.message:'操作失败，请重试'}
  } finally { if(current===saveRevision)busy.value=false }
}

async function update(patch: Partial<AppSettings>) { data.value = await toolbox.settings.update(patch) }
async function saveCollectionRule() {
  const extensions=ruleExtensions.value.split(/[\s,、;]+/).map(value=>value.trim().replace(/^\./,'').toLowerCase()).filter(Boolean)
  if (!extensions.length || extensions.some(value=>!(/^[a-z0-9]{1,12}$/).test(value))) throw new Error('请填写扩展名，例如 pdf、psd，多个用逗号分隔。')
  const rules={...data.value?.settings.collectionRules}
  for(const extension of extensions) rules[extension]=ruleTab.value
  await update({collectionRules:rules})
  ruleExtensions.value=''
}
async function removeCollectionRule(extension: string) {
  const rules={...data.value?.settings.collectionRules}
  delete rules[extension]
  await update({collectionRules:rules})
}
async function setTransparency(event: Event) {
  const transparency = Number((event.target as HTMLInputElement).value)
  await perform(() => update({ desktopModuleOpacity: 100 - transparency }))
}
async function restore(id: string) {
  if (!confirm('还原这份备份的桌面图标位置？请先关闭 Windows 的“自动排列图标”。')) return
  await perform(async () => {
    const status = await toolbox.desktop.status()
    if (status.autoArrange) throw new Error('Windows 正在自动排列图标，请先在桌面右键菜单中关闭。')
    const count = await toolbox.desktop.restoreNative(id)
    message.value = `已还原 ${count} 个图标`
  })
}
onMounted(async () => {
  try {
    data.value = await toolbox.data.get()
    dispose = toolbox.data.onChanged(next => { data.value = next })
  } catch (error) { message.value = String(error) }
})
onBeforeUnmount(() => dispose?.())
</script>
<template>
<section class="settings-panel" aria-label="助手设置"><nav class="settings-tabs" aria-label="设置分类"><button v-for="item in [{id:'health',label:'健康'},{id:'appearance',label:'外观'},{id:'desktop',label:'桌面'}]" :key="item.id" :aria-pressed="section===item.id" @click="selectSection(item.id)">{{item.label}}</button></nav>
<div v-if="data" ref="settingsBody" class="settings-body" :data-section="section">
<section v-show="section==='health'" aria-label="健康设置">
      <label>喝水提醒 <button role="switch" :aria-label="'喝水提醒'" :aria-checked="data.settings.hydrationReminderEnabled" @click="perform(() => update({hydrationReminderEnabled:!data!.settings.hydrationReminderEnabled}))">{{data.settings.hydrationReminderEnabled ? '开启' : '关闭'}}</button></label>
      <p v-if="data.settings.hydrationPlan.enabled" class="hint">每日计划照常计时；关闭喝水提醒只关闭通知，不停止水杯进度。</p>
      <div class="preset-row" v-if="!data.settings.hydrationPlan.enabled"><button v-for="minutes in [15,30,45,60]" :key="minutes" :aria-pressed="data.settings.hydrationIntervalMinutes===minutes" @click="perform(() => update({hydrationReminderEnabled:true,hydrationIntervalMinutes:minutes}))">{{minutes}} 分钟</button></div><label v-if="!data.settings.hydrationPlan.enabled">自定义间隔（分钟）<input :disabled="data.settings.hydrationPlan.enabled" type="number" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" min="5" max="240" :value="data.settings.hydrationIntervalMinutes" @change="perform(() => update({ hydrationIntervalMinutes: Number(($event.target as HTMLInputElement).value) }))"/></label>
      <HydrationPlanSettings :data="data"><template #quick-controls>      <label>久坐提醒 <button role="switch" :aria-label="'久坐提醒'" :aria-checked="data.settings.sedentaryReminderEnabled" @click="perform(() => update({sedentaryReminderEnabled:!data!.settings.sedentaryReminderEnabled}))">{{data.settings.sedentaryReminderEnabled ? '开启' : '关闭'}}</button></label>
      <div class="preset-row"><button v-for="minutes in [30,45,60,90]" :key="minutes" :aria-pressed="data.settings.sedentaryIntervalMinutes===minutes" @click="perform(() => update({sedentaryReminderEnabled:true,sedentaryIntervalMinutes:minutes}))">{{minutes}} 分钟</button></div><label>久坐间隔（分钟）<input type="number" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" min="15" max="240" :value="data.settings.sedentaryIntervalMinutes" @change="perform(() => update({ sedentaryIntervalMinutes: Number(($event.target as HTMLInputElement).value) }))"/></label>
</template></HydrationPlanSettings>
      <label>提醒声音 <button role="switch" :aria-label="'提醒声音'" :aria-checked="data.settings.healthSoundEnabled" @click="perform(() => update({healthSoundEnabled:!data!.settings.healthSoundEnabled}))">{{data.settings.healthSoundEnabled ? '开启' : '关闭'}}</button></label><p class="hint">关闭声音即为静音通知。图标仅根据计时变化，不能检测真实坐姿或判断是否已经喝水。</p>
</section>
<section v-show="section==='appearance'" aria-label="外观设置">      <label for="widget-transparency">组件透明度 <span class="transparency-control"><input id="widget-transparency" type="range" min="10" max="85" step="1" :value="transparencyPreview ?? 100 - data.settings.desktopModuleOpacity" aria-describedby="transparency-hint" @input="transparencyPreview = Number(($event.target as HTMLInputElement).value)" @change="setTransparency"/><output for="widget-transparency">{{ transparencyPreview ?? 100 - data.settings.desktopModuleOpacity }}%</output></span></label>
      <p id="transparency-hint" class="hint transparency-hint">向右更透明，松开后保存，同时调整桌面收纳和综合助手，文字与图标保持清晰。</p>
<SuiteSettings :data="data" group="appearance"/></section>
<section v-show="section==='desktop'" aria-label="桌面设置"><SuiteSettings :data="data" group="desktop" @return="emit('return')"/>      <label>自动吸附 <button role="switch" aria-label="自动吸附" :aria-checked="data.settings.snapMode !== 'none'" @click="perform(() => update({snapMode:data!.settings.snapMode==='none'?'edge':'none'}))">{{data.settings.snapMode!=='none'?'开启':'关闭'}}</button></label>
      <label>悬停展开 <button role="switch" :aria-label="'悬停展开'" :aria-checked="data.settings.desktopHoverExpandEnabled" @click="perform(() => update({desktopHoverExpandEnabled:!data!.settings.desktopHoverExpandEnabled}))">{{data.settings.desktopHoverExpandEnabled ? '开启' : '关闭'}}</button></label>
      <label>开机启动 <button role="switch" :aria-label="'开机启动'" :aria-checked="data.settings.autoStart" @click="perform(() => update({autoStart:!data!.settings.autoStart}))">{{data.settings.autoStart ? '开启' : '关闭'}}</button></label>
      <section class="settings-group"><h3>组件布局备份</h3><p class="hint">保存组件位置、尺寸、折叠、透明度、分类和排序。恢复前自动保存当前布局；下次启动恢复保存的位置与显隐。</p><button :disabled="busy" @click="perform(async () => { data = await api.desktop.backupWidgets() })">保存当前布局</button><div v-for="backup in data.widgetLayouts" :key="backup.id" class="backup"><span>{{ backup.name }}</span><button :disabled="busy" @click="perform(async () => { data = await api.desktop.restoreWidgets(backup.id) })">应用</button></div></section>
      <section class="settings-group"><h3>原桌面图标位置备份</h3><p class="hint">保留原来的桌面图标位置。旧版坐标重排已停用。</p><div v-for="backup in data.iconLayouts.filter(item => item.native)" :key="backup.id" class="backup"><span>{{ backup.name }}</span><button :disabled="busy" @click="restore(backup.id)">还原</button></div></section>
      <section class="settings-group"><h3>文件分类与移动</h3><OrganizerCenter :data="data" @update="data = $event" @toast="message = $event"/><p class="hint">文件移动需要先预览并确认，可撤销。自动收纳后，桌面只保留分类框。</p></section>
      <section class="settings-group"><h3>文件分类规则</h3><p class="hint">按扩展名归入页签，保存后自动更新；手动分类优先。最多 32 条。</p><form class="rule-editor" @submit.prevent="perform(saveCollectionRule)"><input v-model="ruleExtensions" maxlength="160" placeholder="例如 pdf、psd" aria-label="规则扩展名"/><select v-model="ruleTab" aria-label="规则目标分类"><option v-for="tab in collectionTabs" :key="tab.id" :value="tab.id">{{ tab.label }}</option></select><button :disabled="busy || !ruleExtensions.trim()">保存</button></form><div v-for="(target,extension) in data.settings.collectionRules" :key="extension" class="backup"><span>.{{ extension }} → {{ collectionTabs.find(tab=>tab.id===target)?.label }}</span><button :disabled="busy" @click="perform(() => removeCollectionRule(String(extension)))">移除</button></div></section>
</section></div><p v-else class="hint">正在加载设置…</p><p v-if="message" class="save-status" role="status">{{message}}<button v-if="retry" @click="perform(retry!)">重试</button></p></section>
</template>
<style scoped>

.rule-editor { display:flex; gap:6px; }.rule-editor input { min-width:0; flex:1; padding:6px; }.rule-editor select,.rule-editor button { padding:6px; }.rule-editor input,.rule-editor select { color:inherit; background:#25342c; border:1px solid #ffffff40; border-radius:4px; }
.transparency-control { display:flex; align-items:center; gap:8px; }.transparency-control output { width:36px; text-align:right; font-variant-numeric:tabular-nums; }.transparency-hint { margin-top:8px; }
.settings-body{flex:1;min-height:0;overflow:auto;padding:0 16px 16px;scrollbar-gutter:stable}.hint{font-size:12px;color:#bcc8c4;line-height:1.8;margin:0 0 16px}label{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:12px;padding:8px 0;border-bottom:1px solid #ffffff10}input[type=number]{width:70px;padding:5px}input[type=range]{width:150px}input{accent-color:#a4dbb6}.backup{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;font-size:11px}.backup button{padding:4px 10px}.settings-body > p:last-child{margin-top:12px}

.settings-panel{display:flex;flex-direction:column;flex:1;min-height:0;color:inherit;background:rgba(35,39,41,.94)}
.settings-tabs{display:flex;gap:6px;flex:0 0 auto;padding:8px 12px;border-bottom:1px solid #ffffff18}.settings-tabs button{flex:1}
.settings-panel button,.settings-panel select,.settings-panel input:not([type=checkbox]):not([type=range]):not([type=color]){font:inherit;color:inherit;background:#ffffff0c;border:1px solid #ffffff30;border-radius:4px;padding:5px 9px;font-size:12px}
.settings-panel button{cursor:pointer}.settings-panel button[aria-checked=true],.settings-panel button[aria-pressed=true]{background:#bdddc7;color:#14281b;border-color:#bdddc7}.settings-panel :focus-visible{outline:2px solid #a4dbb6;outline-offset:2px}
.preset-row{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.preset-row button{flex:0 0 auto;white-space:nowrap}.settings-group{border-top:1px solid #ffffff20;padding:12px 0}h3{font-size:14px;margin:16px 0 8px}.save-status{flex:0 0 auto;padding:8px 16px;margin:0;font-size:12px;background:#203029;border-top:1px solid #ffffff18}.save-status button{margin-left:8px}.settings-panel label{flex-wrap:wrap}.settings-panel input[type=number]{max-width:100%}
</style>
