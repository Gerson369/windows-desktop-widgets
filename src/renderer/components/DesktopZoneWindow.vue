<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AssistantIcon from './AssistantIcon.vue'
import type { AppData } from '../../main/types'
const props = defineProps<{ zoneId: string; embedded?: boolean }>()
const api = toolbox
const data = ref<AppData | null>(null)
const message = ref('')
const icons = ref<Record<string, string>>({})
const editingTitle = ref(false)
const draggingOver = ref(false)
const titleDraft = ref('')
let dispose: (() => void) | undefined
const zone = computed(() => data.value?.desktopZones.find(item => item.id === props.zoneId))
const items = computed(() => {
  if (!zone.value || !data.value) return []
  return zone.value.itemIds.map(id => {
    const entry = data.value!.inboxItems.find(item => item.id === id)
    const path = entry?.sourcePath || id
    const desktopItem = data.value!.desktopItems.find(item => item.path === path)
    return { id, path, name: entry?.name || desktopItem?.name || path.split(/[\\/]/).pop() || path }
  })
})
const opacity = computed(() => Math.max(0, Math.min(1, (data.value?.settings.desktopModuleOpacity ?? 70) / 100)))
async function perform(action: () => Promise<void>) {
  try { await action(); message.value = '' } catch (error) { message.value = error instanceof Error ? error.message : '操作未完成，请重试。' }
}
async function update(patch: { collapsed?: boolean; locked?: boolean; name?: string }) {
  data.value = await toolbox.organizer.updateZone(props.zoneId, patch)
}
async function rename() {
  const name = titleDraft.value.trim()
  if (name) await update({ name })
  editingTitle.value = false
}
async function openFile(path: string) {
  const error = await toolbox.files.open(path)
  if (error) throw new Error(error)
}
function dragStart(event: DragEvent, path: string) {
  event.dataTransfer?.setData('application/x-gerson-desktop-item', path)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
async function drop(event: DragEvent) {
  draggingOver.value = false
  await perform(async () => {
    let path = event.dataTransfer?.getData('application/x-gerson-desktop-item')
    if (!path) {
      const file = event.dataTransfer?.files[0]
      if (file) path = api.files.pathForDroppedFile(file)
    }
    if (!path) return
    data.value = await api.organizer.assignDesktopItem(path, props.zoneId)
  })
}
async function loadIcons() {
  for (const item of items.value) {
    if (icons.value[item.path] || item.path.startsWith('shell:')) continue
    try { icons.value[item.path] = await api.files.icon(item.path) } catch { /* Deleted or inaccessible files keep the fallback icon. */ }
  }
}
onMounted(async () => {
  await perform(async () => {
    data.value = await toolbox.data.get()
    dispose = toolbox.data.onChanged(next => { data.value = next; void loadIcons() })
    await loadIcons()
  })
})
onBeforeUnmount(() => dispose?.())
</script>
<template>
  <main v-if="zone" class="zone-window" :class="{ embedded, locked: zone.locked, 'drag-over': draggingOver }" @dragover.prevent="draggingOver = true" @dragleave.self="draggingOver = false" @drop.prevent="drop" :style="{ '--zone-alpha': opacity }">
    <header class="zone-header"><AssistantIcon name="folder"/><form v-if="editingTitle" @submit.prevent="perform(rename)"><input v-model="titleDraft" aria-label="分区名称" maxlength="24" @keyup.esc="editingTitle = false"/><button type="submit">保存</button></form><button v-else class="zone-title" title="双击修改分区名称" @dblclick="titleDraft = zone.name; editingTitle = true">{{ zone.name }}</button><span class="zone-count">{{ items.length }}</span><button v-if="!embedded" :aria-label="zone.collapsed ? '展开分区' : '收起分区'" @click="perform(() => update({ collapsed: !zone!.collapsed }))">{{ zone.collapsed ? '+' : '−' }}</button><button v-if="!embedded" :aria-label="zone.locked ? '解锁分区位置' : '锁定分区位置'" :title="zone.locked ? '解锁位置' : '锁定位置'" @click="perform(() => update({ locked: !zone!.locked }))"><AssistantIcon :name="zone.locked ? 'check' : 'layout'"/></button></header>
    <section v-if="embedded || !zone.collapsed" class="zone-body"><div v-if="items.length" class="zone-files"><button v-for="item in items" :key="item.id" :title="item.path" draggable="true" @dragstart="dragStart($event, item.path)" @dblclick="perform(() => openFile(item.path))" @keyup.enter="perform(() => openFile(item.path))"><img v-if="icons[item.path]" :src="icons[item.path]" alt=""/><AssistantIcon v-else name="file"/><span>{{ item.name.replace(/\.(lnk|url)$/i, '') }}</span></button></div><div v-else class="zone-empty"><AssistantIcon name="folder"/><p>此分类暂时没有文件</p><button @click="perform(async () => { data = await api.organizer.refreshDesktopGroups() })">刷新分类</button></div><p v-if="message" role="status" class="zone-error">{{ message }}</p></section>
  </main>
  <main v-else class="zone-window zone-empty"><p>{{ message || '正在加载分区…' }}</p></main>
</template>
<style scoped>
:global(html), :global(body), :global(#app) { background: transparent !important; }
.zone-window { width:100%; height:100%; overflow:hidden; border:1px solid #ffffff36; border-radius:6px; background:rgba(35,39,41,var(--zone-alpha,.7)); color:#f4f6f6; }
.zone-window.embedded{border:0;border-radius:0;background:transparent;display:flex;flex-direction:column}.embedded .zone-header{-webkit-app-region:no-drag;flex:0 0 40px}.embedded .zone-body{flex:1;min-height:0;height:auto}
.drag-over { outline:2px solid #a4dbb6; outline-offset:-3px; }.zone-header { height:40px; display:flex; align-items:center; gap:8px; padding:0 9px; background:#ffffff06; border-bottom:1px solid #ffffff18; -webkit-app-region:drag; }.locked .zone-header { -webkit-app-region:no-drag; }.zone-header > svg { color:#b1d8bd; width:17px; height:17px; }.zone-header button, .zone-header input, .zone-header form { -webkit-app-region:no-drag; }.zone-header button { border:0; background:transparent; padding:4px; border-radius:3px; color:#e6ebed; }.zone-header button:hover { background:#ffffff18; }.zone-header .zone-title { padding:4px 0; font-size:12px; font-weight:600; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.zone-header .zone-count { margin-left:auto; color:#d0d6d7; font-size:10px; }.zone-header button svg { width:13px; height:13px; }.zone-header form { display:flex; min-width:0; flex:1; }.zone-header input { width:100%; padding:3px; font-size:11px; }
.zone-body { height:calc(100% - 40px); overflow:auto; padding:10px 8px; }.zone-files { display:grid; grid-template-columns:repeat(auto-fill,minmax(66px,1fr)); gap:5px; }.zone-files button { display:flex; flex-direction:column; align-items:center; gap:8px; padding:10px 4px; background:transparent; border:1px solid transparent; border-radius:4px; color:#f5f6f6; min-width:0; }.zone-files button:hover, .zone-files button:focus-visible { border-color:#ffffff30; background:#ffffff12; }.zone-files img { width:32px; height:32px; object-fit:contain; }.zone-files svg { width:26px; height:26px; color:#c8dacf; }.zone-files span { font-size:11px; line-height:1.5; width:100%; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.zone-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100%; padding:12px; }.zone-empty svg { width:30px; height:30px; color:#ccdbd0; }.zone-empty p { margin:12px 0 8px; font-size:12px; color:#e2e6e7; }.zone-empty button { border:0; background:transparent; color:#b6e5c5; padding:5px; font-size:11px; }.zone-error { color:#ffd2cc; font-size:11px; line-height:1.6; margin:7px 0; }
</style>
