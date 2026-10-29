<script setup lang="ts">
import { computed, reactive, shallowReactive, watch } from 'vue'
import { toolbox } from '../toolbox'
import { createSaveQueue } from '../save-queue'
import AssistantIcon from './AssistantIcon.vue'
import type { AppData } from '../../main/types'

type SaveGroup = 'style' | 'transparency'
const props = defineProps<{ data: AppData }>()
const emit = defineEmits<{ status: [message: string] }>()
const draft = reactive({ ...props.data.suite, transparency: 100 - props.data.settings.desktopModuleOpacity })
const dirty = reactive({ style: false, transparency: false })
const pending = reactive({ style: false, transparency: false })
const errors = reactive({ style: '', transparency: '' })
const retries = shallowReactive<Record<SaveGroup, (() => Promise<unknown>) | null>>({ style: null, transparency: null })
const revisions = { style: 0, transparency: 0 }
const saveGroups: SaveGroup[] = ['style', 'transparency']
const queue = createSaveQueue()
watch(() => props.data.suite, suite => {
  if (!dirty.style) Object.assign(draft, { background: suite.background, textColor: suite.textColor, fontSize: suite.fontSize })
})
watch(() => props.data.settings.desktopModuleOpacity, opacity => {
  if (!dirty.transparency) draft.transparency = 100 - opacity
})
const previewStyle = computed(() => ({
  '--preview-background': draft.background,
  '--preview-text': draft.textColor,
  '--preview-opacity': (100 - draft.transparency) / 100,
  '--preview-font': draft.fontSize + 'px'
}))
function reportStatus() {
  const error = saveGroups.map(group => errors[group]).filter(Boolean).join('；')
  emit('status', error ? '保存失败：' + error : saveGroups.some(group => pending[group]) ? '正在保存…' : '已保存')
}
async function commit(group: SaveGroup, action: () => Promise<unknown>) {
  const current = ++revisions[group]
  dirty[group] = true
  pending[group] = true
  errors[group] = ''
  reportStatus()
  try {
    await queue(action)
    if (current === revisions[group]) { dirty[group] = false; retries[group] = null }
  } catch (reason) {
    if (current === revisions[group]) {
      errors[group] = reason instanceof Error ? reason.message : '外观未保存，请重试'
      retries[group] = action
    }
  } finally {
    if (current === revisions[group]) { pending[group] = false; reportStatus() }
  }
}
function saveStyle() {
  if (!/^#[\da-f]{6}$/i.test(draft.background) || !/^#[\da-f]{6}$/i.test(draft.textColor)
    || !Number.isInteger(draft.fontSize) || draft.fontSize < 12 || draft.fontSize > 20) {
    ++revisions.style
    pending.style = false
    errors.style = '颜色请填写六位十六进制值，字号需为 12–20 的整数。'
    dirty.style = true
    retries.style = null
    reportStatus()
    return
  }
  const snapshot = { background: draft.background, textColor: draft.textColor, fontSize: draft.fontSize }
  void commit('style', () => toolbox.suite.save(snapshot))
}
function saveTransparency() {
  const opacity = 100 - draft.transparency
  void commit('transparency', () => toolbox.settings.update({ desktopModuleOpacity: opacity }))
}
function stepFont(step: number) {
  draft.fontSize = Math.max(12, Math.min(20, draft.fontSize + step))
  saveStyle()
}
</script>
<template>
  <section class="appearance-preview settings-card" :style="previewStyle" aria-label="组件效果预览">
    <div class="preview-heading"><h3>效果预览</h3><span>实时预览 · 示例内容</span></div>
    <div class="preview-widgets">
      <div class="preview-widget preview-collection"><b>桌面收纳</b><div class="preview-files">
        <span><AssistantIcon name="folder"/>工作资料</span><span><AssistantIcon name="file"/>文档</span><span><AssistantIcon name="folder"/>图片</span>
      </div></div>
      <div class="preview-widget preview-assistant"><b>桌面搭子</b><strong>10:24</strong><span><i/>整理工作资料</span><span><i/>查看会议安排</span></div>
    </div>
  </section>
  <section class="settings-card appearance-controls">
    <h3>组件样式</h3>
    <div class="transparency-setting">
      <label for="widget-transparency">透明度 <output for="widget-transparency">{{ draft.transparency }}%</output></label>
      <input id="widget-transparency" v-model.number="draft.transparency" type="range" min="10" max="85" step="1" aria-describedby="transparency-hint" @input="dirty.transparency = true" @change="saveTransparency"/>
      <div class="slider-ends"><span>更实</span><span>更透</span></div>
      <p id="transparency-hint" class="settings-hint">仅调整背景，文字与图标保持清晰。松开后保存。</p>
    </div>
    <label class="settings-row color-row">背景颜色 <span class="color-controls">
      <input v-model="draft.background" type="color" aria-label="组件背景颜色" @input="dirty.style = true" @change="saveStyle"/>
      <input v-model="draft.background" class="hex-input" maxlength="7" aria-label="背景颜色十六进制值" @input="dirty.style = true" @change="saveStyle" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"/>
    </span></label>
    <label class="settings-row color-row">文字颜色 <span class="color-controls">
      <input v-model="draft.textColor" type="color" aria-label="组件文字颜色" @input="dirty.style = true" @change="saveStyle"/>
      <input v-model="draft.textColor" class="hex-input" maxlength="7" aria-label="文字颜色十六进制值" @input="dirty.style = true" @change="saveStyle" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"/>
    </span></label>
    <div class="settings-row"><div><label for="widget-font-size">字号</label><p class="settings-hint">支持 12–20 px</p></div><div class="font-stepper">
      <button :disabled="draft.fontSize <= 12" aria-label="缩小字号" @click="stepFont(-1)">−</button>
      <input id="widget-font-size" v-model.number="draft.fontSize" type="number" min="12" max="20" aria-label="组件字号" @input="dirty.style = true" @change="saveStyle" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"/>
      <button :disabled="draft.fontSize >= 20" aria-label="放大字号" @click="stepFont(1)">+</button>
    </div></div>
    <template v-for="group in saveGroups" :key="group"><p v-if="errors[group]" class="settings-error" role="alert">{{ errors[group] }} <button v-if="retries[group]" class="settings-link" :disabled="pending[group]" @click="commit(group, retries[group]!)">重试</button></p></template>
  </section>
  <p class="settings-hint appearance-scope"><AssistantIcon name="check"/>同时应用到桌面收纳与桌面搭子。</p>
</template>
<style scoped>
.appearance-preview{position:relative;overflow:hidden;background:#30383e!important;isolation:isolate}
.appearance-preview::before{content:"";position:absolute;inset:0;z-index:-1;background:#485159;clip-path:polygon(30% 0,55% 0,100% 65%,100% 95%)}
.preview-heading{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:14px}.preview-heading span{font-size:10px;color:#c5d6ce}
.preview-widgets{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;align-items:center;min-height:120px}
.preview-widget{padding:12px 10px;border:1px solid #7c898b;border-radius:8px;background:color-mix(in srgb,var(--preview-background) calc(var(--preview-opacity)*100%),transparent);color:var(--preview-text);font-size:var(--preview-font);min-width:0}
.preview-widget b{font-size:1em;font-weight:600;display:block;white-space:nowrap}.preview-files{display:flex;gap:10px;justify-content:space-between;margin-top:18px}.preview-files span{font-size:.65em;white-space:nowrap;display:flex;flex-direction:column;align-items:center;gap:6px}.preview-files svg{width:24px;height:28px}.preview-assistant strong{display:block;font-size:1.9em;line-height:1.2;margin:10px 0 14px;font-variant-numeric:tabular-nums}.preview-assistant>span{font-size:.65em;display:flex;align-items:center;gap:6px;margin-top:8px;white-space:nowrap}.preview-assistant i{width:10px;height:10px;border:1px solid currentColor;border-radius:2px;flex-shrink:0}
.transparency-setting{padding:18px 0 12px;border-bottom:1px solid var(--settings-border)}.transparency-setting label{display:flex;justify-content:space-between}.transparency-setting output{font-variant-numeric:tabular-nums}.transparency-setting input{width:100%;margin:12px 0 6px}.slider-ends{display:flex;justify-content:space-between;color:var(--settings-muted);font-size:12px}.transparency-setting p{margin-top:10px}
.color-controls{display:flex;align-items:center;gap:8px;min-width:0}.color-controls input[type=color]{width:38px;height:30px;padding:2px;cursor:pointer}.color-controls .hex-input{width:92px;font-size:12px}
.font-stepper{display:flex;align-items:stretch}.font-stepper input{width:48px;text-align:center;border-radius:0;padding:4px!important;appearance:textfield}.font-stepper input::-webkit-inner-spin-button{appearance:none}.font-stepper button{border-radius:0;padding:4px 10px}.font-stepper button:first-child{border-radius:6px 0 0 6px;border-right:0}.font-stepper button:last-child{border-radius:0 6px 6px 0;border-left:0}.appearance-scope{display:flex;align-items:center;gap:8px;padding:0 6px}.appearance-scope svg{width:16px;height:16px}
@media(max-width:340px){.preview-widgets{grid-template-columns:1fr;gap:6px}.preview-widget{padding:10px 6px}.preview-files{gap:5px}.preview-heading span{font-size:9px}.color-controls{gap:5px}.color-controls .hex-input{width:80px}}
</style>
