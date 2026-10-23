<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, nextTick, ref } from 'vue'
import AssistantIcon from './AssistantIcon.vue'
import type { AppData, DesktopZone, OrganizerPlan, OrganizerRule } from '../../main/types'
const props = defineProps<{ data: AppData; compact?: boolean }>()
const emit = defineEmits<{ update: [value: AppData]; toast: [text: string, kind?: 'success' | 'error' | 'info']; status: [message: string] }>()
const api = toolbox
const busy = ref(false)
const pendingLabel = ref('')
const errorMessage = ref('')
const zoneName = ref('')
const showZoneForm = ref(false)
const showAllZones = ref(false)
const zoneNameInput = ref<HTMLInputElement>()
const newZoneButton = ref<HTMLButtonElement>()
const plan = ref<OrganizerPlan | null>(null)
const previewSection = ref<HTMLElement>()
const ruleName = ref('')
const extensions = ref('')
const targetType = ref<'zone' | 'folder'>('zone')
const targetId = ref('')
const targetPath = ref('')
const ruleTab = ref<'zone' | 'folder'>('folder')
const showRuleForm = ref(false)
const ruleNameInput = ref<HTMLInputElement>()
const addRuleButton = ref<HTMLButtonElement>()
const visibleZones = computed(() => props.compact && !showAllZones.value ? props.data.desktopZones.slice(0, 4) : props.data.desktopZones)
const visibleRules = computed(() => props.compact ? props.data.organizerRules.filter(rule => rule.targetType === ruleTab.value) : props.data.organizerRules)
const changes = computed(() => plan.value?.items.filter(i => i.status === 'planned') || [])
const moveCount = computed(() => changes.value.filter(item => item.action === 'move').length)
const latestOperation = computed(() => props.data.fileOperations.find(record => record.kind === 'organize' && record.reversible && record.items.some(item => item.status === 'completed' && item.targetPath)))
const basename = (path: string) => path.split(/[\\/]/).pop() || path
const operationStatus = { planned: '待执行', completed: '已完成', skipped: '已跳过', failed: '失败', reverted: '已回退' }
async function perform(action: () => Promise<string | void>, pending = '正在保存…', completed = '已保存') {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  pendingLabel.value = pending
  emit('status', pending)
  try { emit('status', await action() || completed) }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '整理未完成，请重试。'
    emit('toast', errorMessage.value, 'error')
    emit('status', `操作失败：${errorMessage.value}`)
  } finally { busy.value = false; pendingLabel.value = '' }
}
async function toggleZoneForm() {
  showZoneForm.value = !showZoneForm.value
  await nextTick()
  if (showZoneForm.value) zoneNameInput.value?.focus()
  else newZoneButton.value?.focus()
}
async function toggleRuleForm() {
  showRuleForm.value = !showRuleForm.value
  if (showRuleForm.value) targetType.value = ruleTab.value
  await nextTick()
  if (showRuleForm.value) ruleNameInput.value?.focus()
  else addRuleButton.value?.focus()
}
function closeMenu(event: Event) {
  const menu = (event.currentTarget as HTMLElement).closest('details')
  if (!menu) return
  menu.open = false
  menu.querySelector('summary')?.focus()
}
async function toggleZone(zone: DesktopZone) {
  emit('update', await api.organizer.updateZone(zone.id, { visible: !zone.visible }))
}
async function toggleRule(rule: OrganizerRule) {
  emit('update', await api.organizer.upsertRule({ ...rule, enabled: !rule.enabled }))
  plan.value = null
}
async function removeRule(rule: OrganizerRule) {
  emit('update', await api.organizer.removeRule(rule.id))
  plan.value = null
  addRuleButton.value?.focus()
}
async function installDefaultRules() {
  emit('update', await api.organizer.installDefaultArchiveRules())
  ruleTab.value = 'folder'
  plan.value = null
  emit('toast', '已添加四类归档规则，预览后确认才会移动文件')
}
async function createZone() {
  if (!zoneName.value.trim()) throw new Error('请填写分区名称。')
  emit('update', await api.organizer.createZone({ name: zoneName.value.trim(), color: '#81c99a', opacity: props.data.settings.desktopModuleOpacity }))
  plan.value = null
  zoneName.value = ''
  showZoneForm.value = false
  newZoneButton.value?.focus()
  emit('toast', '分区已创建，可在桌面拖动调整位置')
}
async function addFiles(zone: DesktopZone) {
  const paths = await api.dialogs.selectFiles()
  if (!paths.length) return '已取消添加'
  const previousIds = new Set(props.data.inboxItems.map(item => item.id))
  let next = await api.organizer.addInboxItems(paths.slice(0, 50).map(sourcePath => ({ type: 'file', name: basename(sourcePath), sourcePath })))
  const additions = next.inboxItems.filter(item => !previousIds.has(item.id))
  for (const item of additions) next = await api.organizer.updateInboxItem(item.id, { zoneId: zone.id })
  emit('update', next)
  plan.value = null
  emit('toast', `已向“${zone.name}”添加 ${additions.length} 个文件引用`)
}
async function dissolveZone(zone: DesktopZone) {
  if (!confirm(`解散“${zone.name}”？原文件会保留。`)) return '已取消解散'
  emit('update', await api.organizer.removeZone(zone.id))
  plan.value = null
  newZoneButton.value?.focus()
  emit('toast', '分区已解散，原文件已保留')
}
async function saveRule() {
  const name = ruleName.value.trim()
  if (!name || !extensions.value.trim()) throw new Error('请填写规则名称和扩展名。')
  if (targetType.value === 'zone' && !targetId.value) throw new Error('请选择目标分区。')
  if (targetType.value === 'folder' && !targetPath.value) throw new Error('请选择目标文件夹。')
  const rule: OrganizerRule = { id: crypto.randomUUID(), name, enabled: true, extensions: extensions.value.split(/[,，、;；\s]+/).map(e => e.replace(/^\./, '').toLowerCase()).filter(Boolean), targetType: targetType.value, targetId: targetId.value || undefined, targetPath: targetPath.value || undefined, priority: props.data.organizerRules.length, createdAt: new Date().toISOString() }
  emit('update', await api.organizer.upsertRule(rule))
  plan.value = null; ruleName.value = ''; extensions.value = ''
  ruleTab.value = targetType.value
  showRuleForm.value = false
  addRuleButton.value?.focus()
  emit('toast', '规则已保存，预览后再执行')
}
async function preview() {
  plan.value = await api.organizer.previewOrganization()
  await nextTick()
  previewSection.value?.focus()
  previewSection.value?.scrollIntoView({ block: 'nearest' })
  return '预览已生成，待确认执行'
}
async function execute() {
  if (!plan.value || !changes.value.length) throw new Error('请先预览整理方案。')
  if (moveCount.value && !confirm(`将移动 ${moveCount.value} 个桌面文件到预览中的文件夹。确认执行？`)) return '已取消执行'
  const next = await api.organizer.executeOrganization(true)
  emit('update', next)
  const items = next.fileOperations[0]?.items || []
  const completed = items.filter(i => i.status === 'completed').length
  const failed = items.filter(i => i.status === 'failed').length
  const message = `已完成 ${completed} 项${failed ? `，${failed} 项失败，请查看记录` : ''}`
  emit('toast', message, failed ? 'error' : 'success')
  plan.value = null
  return message
}
async function revert() {
  const record = latestOperation.value
  if (!record || !confirm('将还原最近一批已移动的文件，原位置有同名文件时会跳过。继续？')) return '已取消回退'
  const next = await api.organizer.revertOperation(record.id, true)
  emit('update', next)
  plan.value = null
  const items = next.fileOperations[0]?.items || []
  const restored = items.filter(item => item.status === 'reverted').length
  const failed = items.filter(item => item.status === 'failed').length
  const skipped = items.filter(item => item.status === 'skipped').length
  const message = `已回退 ${restored} 项${skipped ? `，${skipped} 项跳过` : ''}${failed ? `，${failed} 项失败，请查看记录` : ''}`
  emit('toast', message, failed ? 'error' : 'success')
  return message
}
</script>
<template>
  <div class="organizer-center" :class="{ 'organizer-compact': compact }" :aria-busy="busy">
    <div v-if="!compact" class="page-heading">
      <div><h1>文件分类，放得顺手</h1><p>分区保留原文件位置；归档规则可以移动文件。</p></div>
      <button class="primary" :disabled="busy" @click="perform(preview, '正在预览…')">预览分类整理</button>
    </div>
    <section :class="compact ? 'settings-card' : 'zone-section'">
      <div class="section-heading">
        <div><h2>{{ compact ? '透明分区' : '透明桌面分区' }}</h2><p v-if="compact" class="settings-hint">只添加引用，保留原文件位置。</p></div>
        <span class="zone-capacity">{{ data.desktopZones.length }} / 12</span>
        <button v-if="compact" ref="newZoneButton" class="secondary compact-add" :aria-expanded="showZoneForm" :disabled="busy || data.desktopZones.length >= 12" @click="toggleZoneForm"><AssistantIcon name="plus"/>新建</button>
      </div>
      <form v-if="!compact || showZoneForm" class="inline-form" @submit.prevent="perform(createZone)" @keydown.esc.stop="compact && toggleZoneForm()">
        <input ref="zoneNameInput" v-model="zoneName" maxlength="24" aria-label="新分区名称" placeholder="分区名称，例如：工作资料" required/>
        <button type="submit" class="secondary" :disabled="busy || !zoneName.trim() || data.desktopZones.length >= 12">{{ compact ? '创建' : '新建分区' }}</button>
        <button v-if="compact" type="button" class="settings-link" :disabled="busy" @click="toggleZoneForm">取消</button>
      </form>
      <p v-if="!data.desktopZones.length" class="empty-text">创建第一个分区，把常用文件放在手边。</p>
      <div v-else :class="compact ? 'compact-zones' : 'zone-cards'">
        <article v-for="zone in visibleZones" :key="zone.id" :class="compact ? 'compact-zone-row' : 'zone-card'">
          <div class="zone-identity"><AssistantIcon name="folder"/><h3 :title="zone.name">{{ zone.name }}</h3><small>{{ zone.itemIds.length }} 项</small></div>
          <template v-if="compact">
            <button class="settings-switch" type="button" role="switch" :aria-checked="zone.visible" :aria-label="`显示分区：${zone.name}`" :disabled="busy" @click="perform(() => toggleZone(zone))"><span/></button>
            <details class="item-menu" @keydown.esc.stop.prevent="closeMenu($event)">
              <summary :aria-label="`${zone.name}的更多操作`"><AssistantIcon name="more"/></summary>
              <div class="item-menu-actions"><button :disabled="busy" @click="closeMenu($event); perform(() => addFiles(zone))">添加文件</button><button class="danger" :disabled="busy" @click="closeMenu($event); perform(() => dissolveZone(zone))">解散分区</button></div>
            </details>
          </template>
          <div v-else class="zone-card-actions">
            <button class="text-button" :disabled="busy" @click="perform(() => addFiles(zone))">添加文件</button>
            <button class="text-button" :disabled="busy" @click="perform(() => toggleZone(zone))">{{ zone.visible ? '隐藏' : '显示' }}</button>
            <button class="text-button danger" :disabled="busy" @click="perform(() => dissolveZone(zone))">解散</button>
          </div>
        </article>
      </div>
      <button v-if="compact && data.desktopZones.length > 4" class="view-all" :aria-expanded="showAllZones" @click="showAllZones = !showAllZones">{{ showAllZones ? '收起分区' : `查看全部 ${data.desktopZones.length} 个分区` }}<AssistantIcon :name="showAllZones ? 'collapse' : 'expand'"/></button>
    </section>
    <section :class="compact ? 'settings-card' : 'rule-section'">
      <div class="section-heading">
        <h2>{{ compact ? '分类与归档规则' : '分类规则' }}</h2>
        <button v-if="compact" ref="addRuleButton" class="secondary compact-add" :aria-expanded="showRuleForm" :disabled="busy" @click="toggleRuleForm"><AssistantIcon name="plus"/>添加</button>
        <button v-else class="text-button" :disabled="busy" @click="perform(installDefaultRules)">添加常用归档规则</button>
      </div>
      <div v-if="compact" class="settings-segments rule-tabs" role="group" aria-label="规则类型">
        <button type="button" :aria-pressed="ruleTab === 'zone'" @click="ruleTab = 'zone'">加入分区</button>
        <button type="button" :aria-pressed="ruleTab === 'folder'" @click="ruleTab = 'folder'">移动文件</button>
      </div>
      <p v-if="compact" :class="ruleTab === 'folder' ? 'move-notice' : 'settings-hint'">{{ ruleTab === 'folder' ? '移动会改变原文件位置，执行前需预览确认。' : '加入分区仅添加文件引用，不改变原文件位置。' }}</p>
      <form v-if="!compact || showRuleForm" class="rule-form surface" @submit.prevent="perform(saveRule)" @keydown.esc.stop="compact && toggleRuleForm()">
        <label>规则名称<input ref="ruleNameInput" v-model="ruleName" maxlength="40" placeholder="例如：设计文档" required/></label>
        <label>文件扩展名<input v-model="extensions" placeholder="pdf, docx, pptx" required/></label>
        <label>整理方式<select v-model="targetType"><option value="zone">加入透明分区</option><option value="folder">移动到桌面文件夹</option></select></label>
        <label v-if="targetType === 'zone'">目标分区<select v-model="targetId" required><option value="" disabled>选择分区</option><option v-for="zone in data.desktopZones" :key="zone.id" :value="zone.id">{{ zone.name }}</option></select></label>
        <label v-else>目标文件夹<div class="path-picker"><input :value="targetPath" readonly placeholder="选择桌面内的子文件夹" required/><button type="button" class="secondary" :disabled="busy" @click="perform(async () => { targetPath = await api.dialogs.selectFolder() || targetPath }, '正在选择文件夹…', '文件夹已选择，待保存规则')">选择</button></div></label>
        <div v-if="compact" class="rule-form-actions"><button class="settings-primary" type="submit" :disabled="busy">保存规则</button><button class="settings-link" type="button" :disabled="busy" @click="toggleRuleForm">取消</button></div>
        <button v-else class="secondary" type="submit" :disabled="busy">保存规则</button>
      </form>
      <p v-if="compact && !visibleRules.length" class="empty-text">{{ ruleTab === 'zone' ? '还没有分区规则。添加后，匹配文件会显示在指定分区。' : '还没有移动规则。可添加常用归档规则，再预览整理方案。' }}</p>
      <div class="rule-list" :class="{ 'compact-rule-list': compact }">
        <article v-for="rule in visibleRules" :key="rule.id">
          <AssistantIcon v-if="compact" :name="rule.targetType === 'zone' ? 'folder' : 'file'"/>
          <input v-else type="checkbox" :checked="rule.enabled" :disabled="busy" :aria-label="`启用规则：${rule.name}`" @change="perform(() => toggleRule(rule))"/>
          <div><strong>{{ rule.name }}</strong><small>{{ rule.extensions.map(extension => `.${extension}`).join(' · ') }}</small><small class="rule-destination">→ {{ rule.targetType === 'zone' ? data.desktopZones.find(zone => zone.id === rule.targetId)?.name || '分区不存在' : rule.targetPath }}</small></div>
          <template v-if="compact">
            <button class="settings-switch" type="button" role="switch" :aria-checked="rule.enabled" :aria-label="`启用规则：${rule.name}`" :disabled="busy" @click="perform(() => toggleRule(rule))"><span/></button>
            <details class="item-menu" @keydown.esc.stop.prevent="closeMenu($event)"><summary :aria-label="`${rule.name}的更多操作`"><AssistantIcon name="more"/></summary><div class="item-menu-actions"><button class="danger" :disabled="busy" @click="closeMenu($event); perform(() => removeRule(rule))">删除规则</button></div></details>
          </template>
          <button v-else class="icon-button" :disabled="busy" :aria-label="`删除规则：${rule.name}`" @click="perform(() => removeRule(rule))"><AssistantIcon name="close"/></button>
        </article>
      </div>
      <template v-if="compact">
        <button class="add-default-rules" :disabled="busy" @click="perform(installDefaultRules)"><AssistantIcon name="plus"/>添加常用归档规则</button>
        <button class="settings-primary preview-button" :disabled="busy" @click="perform(preview, '正在预览…')"><AssistantIcon name="search"/>预览整理方案</button>
        <button class="undo-button settings-link" :disabled="busy || !latestOperation" @click="perform(revert, '正在回退…')"><AssistantIcon name="refresh"/>撤销最近一次移动</button>
        <p class="settings-hint undo-hint">原位置有同名文件时跳过，不覆盖。</p>
      </template>
    </section>
    <section v-if="plan" ref="previewSection" tabindex="-1" class="file-preview" :class="compact ? 'settings-card' : 'surface'" aria-label="执行前确认">
      <div class="section-heading"><h2>执行前确认</h2><span>{{ changes.length }} 项变更</span></div>
      <p class="settings-hint preview-summary">加入分区 {{ changes.length - moveCount }} 项 · 移动文件 {{ moveCount }} 项 · 跳过 {{ plan.items.length - changes.length }} 项</p>
      <div v-if="plan.items.length" class="file-plan-list">
        <article v-for="item in plan.items" :key="item.sourcePath">
          <AssistantIcon name="file"/>
          <div><strong>{{ basename(item.sourcePath) }}</strong><small>来源：{{ item.sourcePath }}</small><small>{{ item.action === 'assign' ? `去向：分区“${data.desktopZones.find(zone => zone.id === item.zoneId)?.name || '分区已失效'}”` : `去向：${item.targetPath || '无有效目标'}` }}</small><small v-if="item.status === 'skipped'" class="skip-reason">跳过原因：{{ item.reason }}</small></div>
          <span>{{ item.status === 'planned' ? '待执行' : '跳过' }}</span>
        </article>
      </div>
      <p v-else class="empty-text">没有匹配的项目。可先添加或调整分类规则。</p>
      <div class="preview-footer"><span>同名文件跳过，不会覆盖。</span><button class="secondary" :disabled="busy" @click="plan = null">取消</button><button :class="compact ? 'settings-primary' : 'primary'" :disabled="busy || !changes.length" @click="perform(execute, '正在执行…')">确认执行 {{ changes.length }} 项</button></div>
    </section>
    <div v-if="!compact" class="operation-row"><p>文件移动可回退；分区中的引用不改变原文件。</p><button class="secondary" :disabled="busy || !latestOperation" @click="perform(revert, '正在回退…')">回退最近文件移动</button></div>
    <details v-if="data.fileOperations.length" class="operation-history" :class="{ 'compact-history': compact }">
      <summary>最近操作记录</summary>
      <div v-for="record in data.fileOperations.slice(0, 5)" :key="record.id"><p>{{ new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</p><small v-for="(item, index) in record.items" :key="index">{{ basename(item.sourcePath) }} · {{ operationStatus[item.status] }}{{ item.reason ? ` · ${item.reason}` : '' }}</small></div>
    </details>
    <p v-if="busy" class="settings-hint organizer-feedback" role="status">{{ pendingLabel }}</p>
    <p v-if="errorMessage" class="organizer-error" role="alert">{{ errorMessage }} 请调整后重试。</p>
  </div>
</template>

<style scoped>
.organizer-compact { display: grid; gap: 14px; min-width: 0; }
.organizer-compact .section-heading { gap: 10px; margin-bottom: 12px; }
.organizer-compact h2 { margin: 0; font-size: 15px; line-height: 1.5; }
.organizer-compact .section-heading > div { flex: 1; min-width: 0; }
.organizer-compact .section-heading .settings-hint { margin: 4px 0 0; }
.organizer-compact .zone-capacity { margin-left: auto; font-size: 12px; white-space: nowrap; }
.compact-add { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px; white-space: nowrap; }
.compact-add svg { width: 16px; height: 16px; }
.organizer-compact .inline-form { flex-wrap: wrap; gap: 8px; }
.organizer-compact .inline-form input { width: 100%; min-width: 0; }
.compact-zones { display: grid; }
.compact-zone-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 11px 0; border-bottom: 1px solid var(--settings-line, #394148); }
.compact-zone-row:last-child { border-bottom: 0; }
.zone-identity { min-width: 0; }
.compact-zone-row .zone-identity { display: flex; flex: 1; align-items: center; gap: 9px; }
.compact-zone-row .zone-identity > svg { width: 20px; height: 20px; flex: 0 0 auto; color: var(--accent, #a9d9bf); }
.compact-zone-row h3 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; margin: 0; }
.compact-zone-row small { flex: 0 0 auto; color: var(--settings-muted, #b5bec3); font-size: 11px; white-space: nowrap; }
.organizer-compact .settings-switch { flex: 0 0 auto; }
.item-menu { position: relative; flex: 0 0 auto; }
.item-menu summary { display: grid; width: 30px; height: 30px; place-items: center; cursor: pointer; border-radius: 6px; list-style: none; color: var(--settings-text, #f0f3f2); }
.item-menu summary::-webkit-details-marker { display: none; }
.item-menu summary svg { width: 20px; height: 20px; }
.item-menu summary:hover, .item-menu[open] summary { background: #ffffff0b; }
.item-menu summary:focus-visible { outline: 2px solid var(--accent, #a9d9bf); outline-offset: 2px; }
.item-menu-actions { position: absolute; top: 32px; right: 0; z-index: 5; display: grid; min-width: 126px; padding: 5px; background: #252b30; border: 1px solid var(--settings-line, #394148); border-radius: 8px; }
.item-menu-actions button { width: 100%; padding: 9px 11px; border: 0; background: transparent; text-align: left; white-space: nowrap; }
.item-menu-actions button:hover { background: #ffffff0b; }
.view-all, .add-default-rules { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 40px; padding: 9px 0; border: 0; background: transparent; text-align: left; font-size: 12px; }
.view-all { border-top: 1px solid var(--settings-line, #394148); }
.view-all svg { width: 16px; height: 16px; margin-left: auto; }
.add-default-rules svg { width: 18px; height: 18px; }
.rule-tabs { margin-bottom: 10px; }
.move-notice { margin: 0 0 10px; padding: 9px 10px; border: 1px solid #92743b; border-radius: 6px; background: #c9962514; color: #edc47e; font-size: 12px; line-height: 1.6; }
.organizer-compact .rule-form { margin: 12px 0; padding: 12px; grid-template-columns: minmax(0, 1fr); background: #00000012; }
.organizer-compact .rule-form label { font-size: 12px; }
.organizer-compact .rule-form input, .organizer-compact .rule-form select { width: 100%; min-width: 0; }
.organizer-compact .rule-form-actions { display: flex; align-items: center; gap: 12px; }
.organizer-compact .path-picker input { flex: 1; width: 80px; }
.organizer-compact .path-picker button { flex: 0 0 auto; }
.compact-rule-list { margin: 0; }
.compact-rule-list article { gap: 8px; padding: 11px 0; border-color: var(--settings-line, #394148); }
.compact-rule-list article > svg { width: 21px; height: 21px; flex: 0 0 auto; color: var(--settings-muted, #b5bec3); }
.compact-rule-list strong { margin-bottom: 3px; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.compact-rule-list small { color: var(--settings-muted, #b5bec3); font-size: 11px; line-height: 1.55; }
.rule-destination { overflow-wrap: anywhere; }
.preview-button { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; margin-top: 8px; }
.preview-button svg, .undo-button svg { width: 18px; height: 18px; }
.undo-button { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 13px 0 5px; }
.undo-hint { text-align: center; margin: 0 !important; }
.organizer-compact .file-preview { margin: 0; }
.preview-summary { margin-bottom: 12px; }
.organizer-compact .file-plan-list { max-height: none; }
.organizer-compact .file-plan-list article { align-items: flex-start; border-color: var(--settings-line, #394148); }
.organizer-compact .file-plan-list article > svg { flex: 0 0 18px; width: 18px; height: 18px; }
.organizer-compact .file-plan-list small { font-size: 11px; line-height: 1.6; color: var(--settings-muted, #b5bec3); }
.organizer-compact .file-plan-list .skip-reason { color: #edc47e; }
.organizer-compact .preview-footer { display: flex; flex-wrap: wrap; }
.organizer-compact .preview-footer > span { flex: 1 0 100%; }
.compact-history { margin: 0; font-size: 12px; }
.compact-history summary { padding: 8px 0; }
.organizer-feedback { margin: 0; }
.organizer-error { color: #f0b7b2; font-size: 12px; line-height: 1.7; margin: 0; }
@media (max-width: 380px) {
  .compact-zone-row { gap: 5px; }
  .compact-zone-row .zone-identity { flex-wrap: wrap; column-gap: 7px; row-gap: 3px; }
  .compact-zone-row h3 { flex: 1; }
  .compact-zone-row small { margin-left: 27px; flex-basis: 100%; }
}
</style>