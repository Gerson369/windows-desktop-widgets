<script setup lang="ts">
import { onBeforeUnmount, reactive, shallowReactive, watch } from 'vue'
import { previewWidgetOpacity } from '../widget-opacity-preview'
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
onBeforeUnmount(() => previewWidgetOpacity(null))
watch(() => props.data.suite, suite => {
  if (!dirty.style) Object.assign(draft, { background: suite.background, textColor: suite.textColor, fontSize: suite.fontSize })
})
watch(() => props.data.settings.desktopModuleOpacity, opacity => {
  if (!dirty.transparency) draft.transparency = 100 - opacity
})
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
    if (current === revisions[group]) {
      dirty[group] = false; retries[group] = null
      if (group === 'transparency') previewWidgetOpacity(null)
    }
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
function previewTransparency() {
  dirty.transparency = true
  ++revisions.transparency
  previewWidgetOpacity(100 - draft.transparency)
  emit('status', '预览中，松开后保存')
}
function stepFont(step: number) {
  draft.fontSize = Math.max(12, Math.min(20, draft.fontSize + step))
  saveStyle()
}
</script>
<template>
  <section class="settings-card appearance-controls">
    <h3>组件样式</h3>
    <div class="transparency-setting">
      <label for="widget-transparency">透明度 <output for="widget-transparency">{{ draft.transparency }}%</output></label>
      <input id="widget-transparency" v-model.number="draft.transparency" type="range" min="10" max="85" step="1" aria-describedby="transparency-hint" @input="previewTransparency" @change="saveTransparency"/>
      <div class="slider-ends"><span>更实</span><span>更透</span></div>
      <p id="transparency-hint" class="settings-hint">拖动实时预览，松开后保存。文字与图标保持清晰。</p>
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
.transparency-setting{padding:10px 0 8px;border-bottom:1px solid var(--settings-border)}.transparency-setting label{display:flex;justify-content:space-between}.transparency-setting output{font-variant-numeric:tabular-nums}.transparency-setting input{width:100%;margin:6px 0 3px}.slider-ends{display:flex;justify-content:space-between;color:var(--settings-muted);font-size:11px}.transparency-setting p{margin-top:5px}
.color-controls{display:flex;align-items:center;gap:8px;min-width:0}.color-controls input[type=color]{width:38px;height:30px;padding:2px;cursor:pointer}.color-controls .hex-input{width:92px;font-size:12px}
.font-stepper{display:flex;align-items:stretch}.font-stepper input{width:48px;text-align:center;border-radius:0;padding:4px!important;appearance:textfield}.font-stepper input::-webkit-inner-spin-button{appearance:none}.font-stepper button{border-radius:0;padding:4px 10px}.font-stepper button:first-child{border-radius:6px 0 0 6px;border-right:0}.font-stepper button:last-child{border-radius:0 6px 6px 0;border-left:0}.appearance-scope{display:flex;align-items:center;gap:6px;margin:0;padding:0 2px}.appearance-scope svg{width:16px;height:16px}
@media(max-width:340px){.color-controls{gap:5px}.color-controls .hex-input{width:80px}}
</style>
