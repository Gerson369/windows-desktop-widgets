<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed, reactive, ref, watch, nextTick } from 'vue'
import { toolbox } from '../toolbox'
import { createSaveQueue } from '../save-queue'
import { collectionTabs, type CollectionTab } from '../../main/desktop-collection'
import type { AppData, AppSettings } from '../../main/types'
import SuiteSettings from './SuiteSettings.vue'
import HydrationPlanSettings from './HydrationPlanSettings.vue'
import OrganizerCenter from './OrganizerCenter.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import AssistantIcon from './AssistantIcon.vue'
import '../styles/settings.css'

const api = toolbox
const props = defineProps<{ section?: string }>()
const emit = defineEmits<{ section: [value: string]; return: [] }>()
const data = ref<AppData | null>(null)
const statuses = reactive<Record<string, string>>({ 设置: '正在加载设置…' })
const lastMessage = ref('正在加载设置…')
const message = computed({
  get: () => statuses.设置,
  set: value => reportStatus('设置', value)
})
const displayMessage = computed(() => {
  const failures = Object.entries(statuses).filter(([, value]) => /失败|未保存/.test(value))
  if (failures.length) return failures.map(([source, value]) => source + '：' + value).join('；')
  return Object.values(statuses).find(value => /正在/.test(value)) || lastMessage.value
})
const section = ref(props.section || 'health'), desktopTab = ref('components')
const settingsBody = ref<HTMLElement | null>(null)
const busy = ref(false), showAllBackups = ref(false), showAllIcons = ref(false)
const saveQueue = createSaveQueue()
const retry = ref<(() => Promise<void>) | null>(null)
const ruleExtensions = ref(''), ruleTab = ref<CollectionTab>('files')
const sections = [{ id: 'health', label: '健康' }, { id: 'appearance', label: '外观' }, { id: 'desktop', label: '桌面' }]
const desktopTabs = [{ id: 'components', label: '组件' }, { id: 'organizer', label: '收纳' }, { id: 'backups', label: '备份' }, { id: 'data', label: '数据' }]
let dispose: (() => void) | undefined
let saveRevision = 0

function selectSection(value: string) { section.value = value; emit('section', value) }
function reportStatus(source: string, value: string) { statuses[source] = value; lastMessage.value = value }
watch(() => props.section, value => { if (value) section.value = value })
watch([section, desktopTab], async () => { await nextTick(); settingsBody.value?.scrollTo(0, 0) })
async function perform(action: () => Promise<void>) {
  const current = ++saveRevision
  busy.value = true
  message.value = '正在保存…'
  try {
    await saveQueue(action)
    if (current === saveRevision) { retry.value = null; if (message.value === '正在保存…') message.value = '已保存' }
  } catch (reason) {
    if (current === saveRevision) { retry.value = action; message.value = '操作失败：' + (reason instanceof Error ? reason.message : '请重试') }
  } finally { if (current === saveRevision) busy.value = false }
}
async function update(patch: Partial<AppSettings>) { data.value = await api.settings.update(patch) }
async function saveCollectionRule() {
  const extensions = ruleExtensions.value.split(/[\s,、;]+/).map(value => value.trim().replace(/^\./, '').toLowerCase()).filter(Boolean)
  if (!extensions.length || extensions.some(value => !/^[a-z0-9]{1,12}$/.test(value))) throw new Error('请填写扩展名，例如 pdf、psd，多个用逗号分隔。')
  const rules = { ...data.value?.settings.collectionRules }
  for (const extension of extensions) rules[extension] = ruleTab.value
  await update({ collectionRules: rules })
  ruleExtensions.value = ''
}
async function removeCollectionRule(extension: string) {
  const rules = { ...data.value?.settings.collectionRules }
  delete rules[extension]
  await update({ collectionRules: rules })
}
async function restoreWidgets(id: string) {
  if (!confirm('恢复这份组件布局？将改变组件位置、尺寸、显隐和外观；恢复前会自动备份当前布局，不会移动文件。')) return
  await perform(async () => { data.value = await api.desktop.restoreWidgets(id) })
}
async function restoreIcons(id: string) {
  if (!confirm('还原这份备份的桌面图标位置？不会移动文件；请先关闭 Windows 的“自动排列图标”。')) return
  await perform(async () => {
    if ((await api.desktop.status()).autoArrange) throw new Error('Windows 正在自动排列图标，请先在桌面右键菜单中关闭。')
    const count = await api.desktop.restoreNative(id)
    message.value = `已还原 ${count} 个图标`
  })
}
function backupDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
onMounted(async () => {
  try { data.value = await api.data.get(); dispose = api.data.onChanged(next => { data.value = next }); message.value = '已保存' }
  catch (reason) { message.value = '加载失败：' + String(reason) }
})
onBeforeUnmount(() => dispose?.())
</script>
<template>
  <section class="settings-panel" aria-label="助手设置">
    <nav class="settings-tabs" aria-label="设置分类">
      <button v-for="item in sections" :key="item.id" :aria-pressed="section === item.id" @click="selectSection(item.id)">{{ item.label }}</button>
    </nav>
    <div v-if="data" ref="settingsBody" class="settings-body" :data-section="section">
      <section v-show="section === 'health'" aria-label="健康设置">
        <div class="settings-heading"><h2>健康提醒</h2><p>按你的节奏安排喝水与活动。</p></div>
        <HydrationPlanSettings :data="data" @status="reportStatus('健康', $event)"/>
      </section>
      <section v-show="section === 'appearance'" aria-label="外观设置">
        <div class="settings-heading"><h2>外观</h2><p>让桌面组件看起来更顺眼。</p></div>
        <AppearanceSettings :data="data" @status="reportStatus('外观', $event)"/>
      </section>
      <section v-show="section === 'desktop'" aria-label="桌面设置">
        <div class="settings-heading"><h2>桌面管理</h2><p>安排组件、收纳与桌面布局。</p></div>
        <nav class="desktop-settings-tabs" aria-label="桌面设置分组">
          <button v-for="tab in desktopTabs" :key="tab.id" :aria-pressed="desktopTab === tab.id" @click="desktopTab = tab.id">{{ tab.label }}</button>
        </nav>
        <div v-show="desktopTab === 'components'">
          <SuiteSettings :data="data" group="desktop" @return="emit('return')" @status="reportStatus('组件', $event)">
            <template #behavior>
              <div class="settings-row"><div><span>自动吸附</span><p class="settings-hint">靠近屏幕边缘时吸附</p></div><button class="settings-switch" role="switch" aria-label="自动吸附" :aria-checked="data.settings.snapMode !== 'none'" :disabled="busy" @click="perform(() => update({ snapMode: data!.settings.snapMode === 'none' ? 'edge' : 'none' }))"/></div>
              <div class="settings-row"><div><span>悬停展开</span><p class="settings-hint">鼠标移入时展开组件</p></div><button class="settings-switch" role="switch" aria-label="悬停展开" :aria-checked="data.settings.desktopHoverExpandEnabled" :disabled="busy" @click="perform(() => update({ desktopHoverExpandEnabled: !data!.settings.desktopHoverExpandEnabled }))"/></div>
              <div class="settings-row"><span>开机启动</span><button class="settings-switch" role="switch" aria-label="开机启动" :aria-checked="data.settings.autoStart" :disabled="busy" @click="perform(() => update({ autoStart: !data!.settings.autoStart }))"/></div>
            </template>
          </SuiteSettings>
        </div>
        <div v-show="desktopTab === 'organizer'">
          <OrganizerCenter :data="data" compact @update="data = $event" @toast="reportStatus('收纳', $event)" @status="reportStatus('收纳', $event)"/>
          <details class="settings-card collection-rule-settings">
            <summary>收纳框页签分类规则 <AssistantIcon name="expand"/></summary>
            <p class="settings-hint">仅改变收纳框中的展示分类，不移动文件。手动分类优先，最多 32 条。</p>
            <form class="collection-rule-editor" @submit.prevent="perform(saveCollectionRule)">
              <label class="settings-field">文件扩展名<input v-model="ruleExtensions" maxlength="160" placeholder="例如 pdf、psd" aria-label="规则扩展名"/></label>
              <label class="settings-field">目标页签<select v-model="ruleTab" aria-label="规则目标分类"><option v-for="tab in collectionTabs" :key="tab.id" :value="tab.id">{{ tab.label }}</option></select></label>
              <button :disabled="busy || !ruleExtensions.trim()">保存规则</button>
            </form>
            <div v-for="(target, extension) in data.settings.collectionRules" :key="extension" class="settings-row"><span>.{{ extension }} → {{ collectionTabs.find(tab => tab.id === target)?.label }}</span><button class="settings-link" :disabled="busy" @click="perform(() => removeCollectionRule(String(extension)))">移除</button></div>
          </details>
        </div>
        <div v-show="desktopTab === 'backups'">
          <section class="settings-card">
            <div class="settings-card-heading"><h3>组件布局备份</h3><button :disabled="busy" @click="perform(async () => { data = await api.desktop.backupWidgets() })">保存当前布局</button></div>
            <p class="settings-hint">保存位置、尺寸、显隐和外观；恢复前自动备份当前布局。</p>
            <p v-if="!data.widgetLayouts.length" class="settings-hint">还没有备份，先保存当前桌面布局。</p>
            <div v-for="backup in (showAllBackups ? data.widgetLayouts : data.widgetLayouts.slice(0, 3))" :key="backup.id" class="settings-row backup-row">
              <div><b>{{ backup.name.includes('自动') ? '恢复前自动备份' : '手动布局备份' }}</b><small>{{ backupDate(backup.createdAt) }}</small></div>
              <button :disabled="busy" @click="restoreWidgets(backup.id)">恢复</button>
            </div>
            <button v-if="data.widgetLayouts.length > 3" class="settings-link" @click="showAllBackups = !showAllBackups">{{ showAllBackups ? '收起历史记录' : '查看全部 ' + data.widgetLayouts.length + ' 份备份' }}</button>
          </section>
          <section class="settings-card">
            <h3>原桌面图标位置备份</h3><p class="settings-hint">仅恢复 Explorer 图标坐标，不移动文件。</p>
            <p v-if="!data.iconLayouts.some(item => item.native)" class="settings-hint">暂无原桌面图标位置备份。</p>
            <div v-for="backup in data.iconLayouts.filter(item => item.native).slice(0, showAllIcons ? undefined : 3)" :key="backup.id" class="settings-row backup-row">
              <div><b>{{ backup.name }}</b><small>{{ backupDate(backup.createdAt) }}</small></div><button :disabled="busy" @click="restoreIcons(backup.id)">还原</button>
            </div>
            <button v-if="data.iconLayouts.filter(item => item.native).length > 3" class="settings-link" @click="showAllIcons = !showAllIcons">{{ showAllIcons ? '收起历史记录' : '查看全部图标备份' }}</button>
          </section>
        </div>
        <SuiteSettings v-show="desktopTab === 'data'" :data="data" group="data" @status="reportStatus('数据', $event)"/>
      </section>
    </div>
    <p v-else class="settings-loading">正在加载设置…</p>
    <footer class="settings-save-status" :class="{ 'has-error': /失败|未保存/.test(displayMessage) }" role="status" aria-live="polite">
      <AssistantIcon :name="/失败|未保存/.test(displayMessage) ? 'bell' : 'check'"/><span>{{ displayMessage }}</span><button v-if="retry" class="settings-link" :disabled="busy" @click="perform(retry!)">重试</button><small>更改自动保存</small>
    </footer>
  </section>
</template>
