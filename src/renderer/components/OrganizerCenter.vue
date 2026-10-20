<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, ref } from 'vue'
import AssistantIcon from './AssistantIcon.vue'
import type { AppData, DesktopZone, OrganizerPlan, OrganizerRule } from '../../main/types'
const props = defineProps<{ data: AppData }>()
const emit = defineEmits<{ update: [value: AppData]; toast: [text: string, kind?: 'success' | 'error' | 'info'] }>()
const api = toolbox
const busy = ref(false)
const zoneName = ref('')
const plan = ref<OrganizerPlan | null>(null)
const ruleName = ref('')
const extensions = ref('')
const targetType = ref<'zone' | 'folder'>('zone')
const targetId = ref('')
const targetPath = ref('')
const changes = computed(() => plan.value?.items.filter(i => i.status === 'planned') || [])
const latestOperation = computed(() => props.data.fileOperations.find(record => record.kind === 'organize' && record.items.some(item => item.status === 'completed' && item.targetPath)))
const basename = (path: string) => path.split(/[\\/]/).pop() || path
async function perform(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  try { await action() } catch (error) { emit('toast', error instanceof Error ? error.message : '整理未完成，请重试。', 'error') }
  finally { busy.value = false }
}
async function createZone() {
  if (!zoneName.value.trim()) return
  emit('update', await api.organizer.createZone({ name: zoneName.value.trim(), color: '#81c99a', opacity: props.data.settings.desktopModuleOpacity }))
  zoneName.value = ''
  emit('toast', '分区已创建，可在桌面拖动调整位置')
}
async function addFiles(zone: DesktopZone) {
  const paths = await api.dialogs.selectFiles()
  if (!paths.length) return
  const previousIds = new Set(props.data.inboxItems.map(item => item.id))
  let next = await api.organizer.addInboxItems(paths.slice(0, 50).map(sourcePath => ({ type: 'file', name: basename(sourcePath), sourcePath })))
  const additions = next.inboxItems.filter(item => !previousIds.has(item.id))
  for (const item of additions) next = await api.organizer.updateInboxItem(item.id, { zoneId: zone.id })
  emit('update', next)
  emit('toast', `已向“${zone.name}”添加 ${additions.length} 个文件引用`)
}
async function dissolveZone(zone: DesktopZone) {
  if (confirm(`解散“${zone.name}”？原文件会保留。`)) emit('update', await api.organizer.removeZone(zone.id))
}
async function saveRule() {
  const name = ruleName.value.trim()
  if (!name || !extensions.value.trim()) throw new Error('请填写规则名称和扩展名。')
  const rule: OrganizerRule = { id: crypto.randomUUID(), name, enabled: true, extensions: extensions.value.split(/[,，、;；\s]+/).map(e => e.replace(/^\./, '').toLowerCase()).filter(Boolean), targetType: targetType.value, targetId: targetId.value || undefined, targetPath: targetPath.value || undefined, priority: props.data.organizerRules.length, createdAt: new Date().toISOString() }
  emit('update', await api.organizer.upsertRule(rule))
  plan.value = null; ruleName.value = ''; extensions.value = ''
  emit('toast', '规则已保存，预览后再执行')
}
async function preview() { plan.value = await api.organizer.previewOrganization() }
async function execute() {
  const moves = changes.value.filter(i => i.action === 'move').length
  if (moves && !confirm(`将移动 ${moves} 个桌面文件到预览中的文件夹。确认执行？`)) return
  const next = await api.organizer.executeOrganization(true)
  emit('update', next)
  const items = next.fileOperations[0]?.items || []
  const completed = items.filter(i => i.status === 'completed').length
  const failed = items.filter(i => i.status === 'failed').length
  emit('toast', `已完成 ${completed} 项${failed ? `，${failed} 项失败，请查看记录` : ''}`, failed ? 'error' : 'success')
  plan.value = null
}
async function revert() {
  const record = latestOperation.value
  if (!record || !confirm('将还原最近一批已移动的文件，原位置有同名文件时会跳过。继续？')) return
  const next = await api.organizer.revertOperation(record.id, true)
  emit('update', next)
  const restored = next.fileOperations[0]?.items.filter(i => i.status === 'reverted').length || 0
  emit('toast', `已回退 ${restored} 项文件操作`)
}
</script>
<template>
  <div class="page-heading"><div><h1>文件分类，放得顺手</h1><p>分区保留原文件位置；归档规则可以移动文件。</p></div><button class="primary" :disabled="busy" @click="perform(preview)">预览分类整理</button></div>
  <section class="zone-section"><div class="section-heading"><h2>透明桌面分区</h2><span>{{ data.desktopZones.length }} / 12</span></div><form class="inline-form" @submit.prevent="perform(createZone)"><input v-model="zoneName" maxlength="24" aria-label="新分区名称" placeholder="分区名称，例如：工作资料"/><button type="submit" class="secondary" :disabled="busy || !zoneName.trim() || data.desktopZones.length >= 12"><AssistantIcon name="plus"/>新建分区</button></form><p v-if="!data.desktopZones.length" class="empty-text">创建第一个分区，把常用文件放在手边。</p><div v-else class="zone-cards"><article v-for="zone in data.desktopZones" :key="zone.id" class="zone-card"><div><AssistantIcon name="folder"/><h3>{{ zone.name }}</h3><small>{{ zone.itemIds.length }} 项</small></div><div class="zone-card-actions"><button class="text-button" :disabled="busy" @click="perform(() => addFiles(zone))">添加文件</button><button class="text-button" :disabled="busy" @click="perform(async () => emit('update', await api.organizer.updateZone(zone.id, { visible: !zone.visible })))">{{ zone.visible ? '隐藏' : '显示' }}</button><button class="text-button danger" :disabled="busy" @click="perform(() => dissolveZone(zone))">解散</button></div></article></div></section>
  <section class="rule-section"><div class="section-heading"><h2>分类规则</h2><button class="text-button" :disabled="busy" @click="perform(async () => { emit('update', await api.organizer.installDefaultArchiveRules()); plan = null; emit('toast', '已添加四类归档规则，预览后确认才会移动文件') })">添加常用归档规则</button></div><form class="rule-form surface" @submit.prevent="perform(saveRule)"><label>规则名称<input v-model="ruleName" maxlength="40" placeholder="例如：设计文档" required/></label><label>文件扩展名<input v-model="extensions" placeholder="pdf, docx, pptx" required/></label><label>整理方式<select v-model="targetType"><option value="zone">加入透明分区</option><option value="folder">移动到桌面文件夹</option></select></label><label v-if="targetType === 'zone'">目标分区<select v-model="targetId" required><option value="" disabled>选择分区</option><option v-for="zone in data.desktopZones" :key="zone.id" :value="zone.id">{{ zone.name }}</option></select></label><label v-else>目标文件夹<div class="path-picker"><input :value="targetPath" readonly placeholder="选择桌面内的子文件夹" required/><button type="button" class="secondary" @click="perform(async () => { targetPath = await api.dialogs.selectFolder() || targetPath })">选择</button></div></label><button class="secondary" type="submit" :disabled="busy">保存规则</button></form><div class="rule-list"><article v-for="rule in data.organizerRules" :key="rule.id"><input type="checkbox" :checked="rule.enabled" :disabled="busy" :aria-label="`启用规则：${rule.name}`" @change="perform(async () => { emit('update', await api.organizer.upsertRule({ ...rule, enabled: !rule.enabled })); plan = null })"/><div><strong>{{ rule.name }}</strong><small>{{ rule.extensions.map(e => `.${e}`).join(' ') }} → {{ rule.targetType === 'zone' ? data.desktopZones.find(z => z.id === rule.targetId)?.name || '分区不存在' : rule.targetPath }}</small></div><button class="icon-button" :disabled="busy" :aria-label="`删除规则：${rule.name}`" @click="perform(async () => { emit('update', await api.organizer.removeRule(rule.id)); plan = null })"><AssistantIcon name="close"/></button></article></div></section>
  <section v-if="plan" class="file-preview surface"><div class="section-heading"><h2>执行前确认</h2><span>{{ changes.length }} 项变更</span></div><div v-if="plan.items.length" class="file-plan-list"><article v-for="item in plan.items" :key="item.sourcePath"><AssistantIcon name="file"/><div><strong>{{ basename(item.sourcePath) }}</strong><small>{{ item.status === 'skipped' ? item.reason : item.action === 'assign' ? `加入分区：${data.desktopZones.find(z => z.id === item.zoneId)?.name || '分区已失效'}` : `移动至：${item.targetPath}` }}</small></div><span>{{ item.status === 'planned' ? '待执行' : '跳过' }}</span></article></div><p v-else class="empty-text">没有匹配的项目。可先添加或调整分类规则。</p><div class="preview-footer"><span>同名文件跳过，不会覆盖。</span><button class="secondary" @click="plan = null">取消</button><button class="primary" :disabled="busy || !changes.length" @click="perform(execute)">确认执行 {{ changes.length }} 项</button></div></section>
  <div class="operation-row"><p>文件移动可回退；分区中的引用不改变原文件。</p><button class="secondary" :disabled="busy || !latestOperation" @click="perform(revert)">回退最近文件移动</button></div>
  <details v-if="data.fileOperations.length" class="operation-history"><summary>最近操作记录</summary><div v-for="record in data.fileOperations.slice(0, 5)" :key="record.id"><p>{{ new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</p><small v-for="(item, index) in record.items" :key="index">{{ basename(item.sourcePath) }} · {{ item.status }}{{ item.reason ? ` · ${item.reason}` : '' }}</small></div></details>
</template>
