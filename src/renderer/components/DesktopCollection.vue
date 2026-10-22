<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DesktopZoneWindow from './DesktopZoneWindow.vue'
import AssistantIcon from './AssistantIcon.vue'
import { useDesktopDrag } from '../useDesktopDrag'
import { useWidgetHover } from '../useWidgetHover'
const titleDrag=useDesktopDrag()
import { collectionItems, collectionTabs, sortCollectionItems, normalizeCollectionSorts, selectCollectionPaths, type CollectionTab, type CollectionItem } from '../../main/desktop-collection'
import { renamedDesktopPaths } from '../../main/desktop-widgets'
import type { AppData } from '../../main/types'

const props=defineProps<{embedded?:boolean}>()
const api = toolbox
const typeFilter=ref('all')
const data = ref<AppData | null>(null)
const activeProject = ref('')
const projects = computed(() => data.value?.desktopZones.filter(zone => zone.visible && !zone.id.startsWith('desktop-')) || [])
const activeTab = ref<CollectionTab>('apps')
const selectedPath = ref('')
const selectedPaths = ref(new Set<string>())
const selectionAnchor = ref('')
const renamingPath = ref('')
const renameDraft = ref('')
const fileMenu = ref<{ item: CollectionItem; x: number; y: number } | null>(null)
const search = ref('')
const message = ref('')
const messageFailed = ref(false)
const progress=ref<import('../../main/desktop-collection').CollectionProgress>({busy:false,message:'',failed:false})
const busy = ref(false)
const dropTab = ref('')
const icons = ref<Record<string, string>>({})
const failedIcons = ref<Record<string,boolean>>({})
const loadingIcons = new Set<string>()
const moduleState = computed(() => data.value?.desktopModules.find(module => module.kind === 'quick'))
const hover = useWidgetHover(() => Boolean(data.value?.settings.desktopHoverExpandEnabled), () => Boolean(moduleState.value?.collapsed), () => data.value?.settings.desktopHoverCollapseDelay || 360, () => titleDrag.active)
const collapsed = computed(() => Boolean(moduleState.value?.collapsed) && !hover.expanded.value)
const tabs = computed(() => collectionTabs.map(tab => ({ ...tab, items: data.value ? collectionItems(data.value, tab.id) : [] })))
const currentSort = computed(() => data.value?.settings.collectionSorts[activeTab.value] || { by: 'name' as const, direction: 'asc' as const })
const visibleItems = computed(() => sortCollectionItems((tabs.value.find(tab => tab.id === activeTab.value)?.items || []).filter(item => (data.value?.suite.showSystemIcons !== false || !item.path.startsWith('shell:')) && (typeFilter.value==='all' || item.category===typeFilter.value || (typeFilter.value==='folder' && item.isDirectory)) && item.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())), currentSort.value))
const alpha = computed(() => (data.value?.settings.desktopModuleOpacity ?? 46) / 100)
let disposeData: (() => void) | undefined
let disposeProgress: (() => void) | undefined
const footerMessage=computed(()=>progress.value.busy?progress.value.message:message.value || progress.value.message)
const footerFailed=computed(()=>progress.value.busy?false:message.value?messageFailed.value:progress.value.failed)
watch([search,typeFilter],()=>{selectedPaths.value=new Set();selectedPath.value='';selectionAnchor.value='';fileMenu.value=null})

async function perform(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  messageFailed.value=false
  try { await action() } catch (error) { messageFailed.value=true;message.value = error instanceof Error ? error.message : '操作未完成，请重试' }
  finally { busy.value = false }
}
function selectTab(id: CollectionTab) {
  activeTab.value = id
  typeFilter.value='all'
  message.value = ''
  selectedPath.value = ''; renamingPath.value = ''
  selectedPaths.value = new Set(); selectionAnchor.value = ''
  void loadIcons()
}
async function changeSort(event: Event) {
  const [by, direction] = (event.target as HTMLSelectElement).value.split(':') as ['name' | 'type' | 'createdAt' | 'modifiedAt', 'asc' | 'desc']
  if (data.value) data.value = await api.settings.update({ collectionSorts: normalizeCollectionSorts({ ...data.value.settings.collectionSorts, [activeTab.value]: { by, direction } }) })
}
async function classifySelection(event: Event) {
  const id = (event.target as HTMLSelectElement).value as CollectionTab
  const tab = collectionTabs.find(tab => tab.id === id)
  if (!tab) return
  data.value = await api.organizer.assignDesktopItems([...selectedPaths.value], tab.targetZone)
  selectTab(id)
  message.value=`已归入${tab.label}，原文件位置不变${search.value?'；当前搜索条件仍保留':''}`
}
async function beginRename(item: CollectionItem) {
  if (item.path.startsWith('shell:')) { message.value = '系统图标不能在这里改名'; return }
  selectedPath.value = item.path
  renamingPath.value = item.path
  renameDraft.value = item.name
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('.rename-input')
  input?.focus()
  const extensionStart = !item.isDirectory && !['lnk','url'].includes(item.extension) ? item.name.lastIndexOf('.') : -1
  input?.setSelectionRange(0, extensionStart > 0 ? extensionStart : item.name.length)
}
async function saveRename(item: CollectionItem) {
  if (renamingPath.value !== item.path || busy.value) return
  if (renameDraft.value === item.name) { renamingPath.value = ''; return }
  await perform(async () => {
    const result = await api.files.rename(item.path, renameDraft.value)
    data.value = result.data; selectedPath.value = result.path; renamingPath.value = ''
    void loadIcons()
  })
}
function selectItem(item: CollectionItem, event?: MouseEvent | KeyboardEvent) {
  const mode = event?.shiftKey ? 'range' : event?.ctrlKey || event?.metaKey ? 'toggle' : 'single'
  selectedPaths.value = selectCollectionPaths(visibleItems.value.map(item => item.path), selectedPaths.value, selectionAnchor.value, item.path, mode)
  selectedPath.value = item.path
  if (mode !== 'range') selectionAnchor.value = item.path
}
async function trashSelected() {
  const paths = selectedPaths.value.size ? [...selectedPaths.value] : [selectedPath.value]
  if (paths.some(path => !path || path.startsWith('shell:'))) { message.value = '系统图标不能移到回收站'; return }
  await perform(async () => {
    const failed: string[] = []
    for (const path of paths) {
      try { data.value = await api.files.trash(path); selectedPaths.value.delete(path) }
      catch (error) { failed.push(`${visibleItems.value.find(item => item.path === path)?.name || path}：${error instanceof Error?error.message:'未完成，请重试'}`) }
    }
    selectedPath.value = [...selectedPaths.value][0] || ''
    messageFailed.value=failed.length>0
    message.value = `${paths.length - failed.length} 项已移到回收站${failed.length?`；未完成：${failed.join('、')}`:''}`
  })
}
function keydown(event: KeyboardEvent) {
  if ((event.target as Element)?.closest('input,textarea,select,button,.file-context-menu')) return
  const item = visibleItems.value.find(item => item.path === selectedPath.value)
  if (event.key === 'F2' && item && selectedPaths.value.size <= 1) { event.preventDefault(); void beginRename(item) }
  if (event.key === 'Delete') { event.preventDefault(); void trashSelected() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectedPaths.value = new Set(visibleItems.value.map(item => item.path)) }
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key) && visibleItems.value.length) {
    event.preventDefault()
    const grid = document.querySelector('.collection-files')
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1
    const delta = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key] || 0
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? visibleItems.value.length - 1 : Math.max(0, Math.min(visibleItems.value.length - 1, visibleItems.value.findIndex(item => item.path === selectedPath.value) + delta))
    const next = visibleItems.value[index]
    selectItem(next,event)
    void nextTick(() => document.querySelector<HTMLElement>(`.file-item[data-path="${CSS.escape(next.path)}"]`)?.focus())
  }
}
async function contextMenu(event: MouseEvent, item: CollectionItem) {
  if (!selectedPaths.value.has(item.path)) selectItem(item)
  selectedPath.value = item.path
  fileMenu.value = { item, x: Math.max(8,Math.min(event.clientX,window.innerWidth-176)), y: Math.max(8,Math.min(event.clientY,window.innerHeight-148)) }
  await nextTick()
  document.querySelector<HTMLButtonElement>('.file-context-menu button')?.focus()
}
async function chooseFileAction(action: string) {
  const item = fileMenu.value?.item
  fileMenu.value = null
  if (!item) return
  try {
    if (action === 'rename') await beginRename(item)
    if (action === 'open') await perform(() => openFile(item.path))
    if (action === 'reveal') await perform(() => api.files.reveal(item.path))
    if (action === 'trash') await trashSelected()
  } catch (error) { message.value = error instanceof Error ? error.message : '操作未完成' }
}
function menuKeydown(event: KeyboardEvent) {
  if (!['ArrowDown','ArrowUp'].includes(event.key)) return
  event.preventDefault()
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.file-context-menu button:not(:disabled)')]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
}
async function loadIcons(refresh = new Set<string>()) {
  const pending = visibleItems.value.filter(item => !item.path.startsWith('shell:') && (!icons.value[item.path] || refresh.has(item.path)) && !loadingIcons.has(item.path))
  pending.forEach(item => loadingIcons.add(item.path))
  await Promise.all(Array.from({length:Math.min(6,pending.length)},async () => {
    let item: CollectionItem | undefined
    while((item=pending.shift())) {
      const path=item.path
      try { icons.value[path]=await api.files.icon(path); delete failedIcons.value[path] }
      catch { failedIcons.value[path]=!icons.value[path] }
      finally { loadingIcons.delete(path) }
    }
  }))
}
async function toggleCollapsed() {
  if (hover.expanded.value) { hover.cancel(); return }
  if (moduleState.value) data.value = await api.desktopModules.update(moduleState.value.id, { collapsed: !moduleState.value.collapsed })
}
async function collect() { data.value = await api.desktop.collect(); void loadIcons() }
async function release() { data.value = await api.desktop.release() }
async function openFile(path: string) {
  const error = await api.files.open(path)
  if (error) throw new Error(error)
}
function dragStart(event: DragEvent, path: string) {
  const item = visibleItems.value.find(item => item.path === path)
  if (item && !selectedPaths.value.has(path)) selectItem(item)
  event.dataTransfer?.setData('application/x-gerson-desktop-items', JSON.stringify([...selectedPaths.value]))
  event.dataTransfer?.setData('application/x-gerson-desktop-item', path)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
async function drop(event: DragEvent, id: CollectionTab) {
  dropTab.value = ''
  await perform(async () => {
    const batch = event.dataTransfer?.getData('application/x-gerson-desktop-items')
    const single = event.dataTransfer?.getData('application/x-gerson-desktop-item')
    const paths = batch ? JSON.parse(batch) : single ? [single] : [...(event.dataTransfer?.files || [])].map(file => api.files.pathForDroppedFile(file))
    if (!paths.length) return
    data.value = await api.organizer.assignDesktopItems(paths, collectionTabs.find(tab => tab.id === id)!.targetZone)
    selectTab(id)
    message.value=`已归入${collectionTabs.find(tab=>tab.id===id)!.label}，原文件位置不变${search.value?'；当前搜索条件仍保留':''}`
  })
}
function closeMenu(event: PointerEvent) {
  if (!(event.target as Element)?.closest('.file-context-menu')) fileMenu.value = null
}
onMounted(async () => {
  disposeProgress=api.desktop.onProgress(value=>{progress.value=value;if(value.busy)message.value=''})
  progress.value=await api.desktop.progress()
  disposeData = api.data.onChanged(next => {
    const previous = data.value?.desktopItems || []
    const refresh = new Set<string>()
    const body = document.querySelector('.collection-body')
    const scrollTop = body?.scrollTop || 0
    for (const [before, after] of renamedDesktopPaths(previous, next.desktopItems)) {
      if (icons.value[before]) icons.value[after] = icons.value[before]
      if (selectedPath.value === before) selectedPath.value = after
      if (selectedPaths.value.delete(before)) selectedPaths.value.add(after)
      refresh.add(after)
    }
    for (const item of next.desktopItems) {
      const old = previous.find(entry => entry.path === item.path)
      if (old && old.modifiedAt !== item.modifiedAt) refresh.add(item.path)
    }
    data.value = next
    const currentPaths = new Set(next.desktopItems.map(item => item.path))
    selectedPaths.value = new Set([...selectedPaths.value].filter(path => currentPaths.has(path)))
    void loadIcons(refresh)
    void nextTick(() => { if (body?.isConnected) body.scrollTop = scrollTop })
  })
  document.addEventListener('pointerdown', closeMenu)
  await perform(async () => { data.value = await api.data.get(); void loadIcons() })
})
onBeforeUnmount(() => { disposeProgress?.();disposeData?.(); document.removeEventListener('pointerdown', closeMenu) })
</script>

<template>
  <main class="desktop-collection" :data-inventory-ready="Boolean(data)" :style="{ '--collection-alpha': alpha }" @mouseenter="hover.enter" @mouseleave="hover.leave" @keydown="keydown" @keydown.esc="fileMenu = null">
    <header class="module-header collection-header" @pointerdown="!props.embedded && titleDrag.start($event)" @pointermove="titleDrag.move" @pointerup="titleDrag.finish" @pointercancel="titleDrag.finish" @lostpointercapture="titleDrag.finish">
      <AssistantIcon name="layout"/><b>桌面收纳</b><span class="total-count">{{ data?.desktopItems.length || 0 }}</span>
      <button class="collect-button header-action" :disabled="busy || progress.busy" :aria-label="data?.settings.desktopCollected ? '重新整理' : '收纳桌面'" :title="busy ? '正在整理…' : data?.settings.desktopCollected ? '重新整理' : '收纳桌面'" @click="perform(collect)"><AssistantIcon name="refresh"/></button>
      <button class="header-action" aria-label="显示原桌面" title="显示原桌面" :disabled="busy || !data?.settings.desktopCollected" @click="perform(release)"><AssistantIcon name="desktop"/></button>
      <button class="collapse-button" :aria-label="collapsed ? '展开收纳框' : '收起收纳框'" :title="collapsed ? '展开' : '收起'" @click="perform(toggleCollapsed)"><AssistantIcon :name="collapsed ? 'expand' : 'collapse'"/></button>
    </header>
    <template v-if="!collapsed">
      <label v-if="projects.length" class="project-switch">收纳位置<select v-model="activeProject" aria-label="收纳位置"><option value="">桌面分类</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
      <DesktopZoneWindow v-if="activeProject && projects.some(project => project.id === activeProject)" :key="activeProject" :zone-id="activeProject" embedded/>
      <template v-else>
      <nav class="collection-tabs" aria-label="收纳分类">
        <button v-for="tab in tabs" :key="tab.id" :data-tab="tab.id" :class="{ active: activeTab === tab.id, 'drop-target': dropTab === tab.id }" :aria-pressed="activeTab === tab.id" @click="selectTab(tab.id)" @dragover.prevent="dropTab = tab.id" @dragleave="dropTab = ''" @drop.prevent="drop($event, tab.id)">{{ tab.label }}<small>{{ tab.items.length }}</small></button>
      </nav>
        <label class="collection-search"><AssistantIcon name="search"/><input v-model="search" aria-label="搜索当前分类" placeholder="搜索当前分类"/><button v-if="search" aria-label="清除搜索" @click="search = ''"><AssistantIcon name="close"/></button></label>
        <div class="collection-sort"><span>{{ selectedPaths.size ? `已选择 ${selectedPaths.size} 项` : `${visibleItems.length} 个项目` }}</span><select v-if="selectedPaths.size > 1" aria-label="批量分类" value="" @change="perform(() => classifySelection($event))"><option value="" disabled>分类到…</option><option v-for="tab in tabs" :key="tab.id" :value="tab.id">{{ tab.label }}</option></select><select aria-label="排序方式" :value="`${currentSort.by}:${currentSort.direction}`" @change="perform(() => changeSort($event))"><option value="modifiedAt:desc">最近修改</option><option value="modifiedAt:asc">修改最早</option><option value="createdAt:desc">最新创建</option><option value="createdAt:asc">创建最早</option><option value="name:asc">名称 A → Z</option><option value="name:desc">名称 Z → A</option><option v-if="activeTab !== 'apps'" value="type:asc">文件类型 ↑</option><option v-if="activeTab !== 'apps'" value="type:desc">文件类型 ↓</option></select></div>
        <div class="collection-sort"><select v-model="typeFilter" aria-label="内容类型筛选"><option value="all">全部类型</option><option value="folder">文件夹</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音乐 / 音频</option><option value="document">文档</option></select><small>拖入文件或文件夹即可收纳引用</small></div><section class="collection-body" :aria-label="tabs.find(tab => tab.id === activeTab)?.label" @dragover.prevent @drop.prevent="drop($event, activeTab as CollectionTab)">
          <div v-if="visibleItems.length" class="collection-files" role="listbox" aria-label="分类项目"><div v-for="item in visibleItems" :key="item.path" class="file-item" :class="{ selected: selectedPaths.has(item.path) }" role="option" :aria-selected="selectedPaths.has(item.path)" tabindex="0" :data-path="item.path" :title="item.name" :draggable="renamingPath !== item.path" @click="selectItem(item, $event)" @focus="selectedPath = item.path" @contextmenu.prevent="contextMenu($event,item)" @dragstart="dragStart($event, item.path)" @dblclick="perform(() => openFile(item.path))" @keyup.enter="!renamingPath && perform(() => openFile(item.path))"><img v-if="icons[item.path] && !failedIcons[item.path]" :src="icons[item.path]" alt="" @error="failedIcons[item.path]=true"/><AssistantIcon v-else data-icon-fallback :name="item.path.startsWith('shell:') ? 'recycle' : 'file'"/><input v-if="renamingPath === item.path" v-model="renameDraft" class="rename-input" aria-label="新文件名" maxlength="255" @click.stop @dblclick.stop @keydown.stop @keyup.enter.stop="saveRename(item)" @keyup.esc.stop="renamingPath = ''" @blur="saveRename(item)"/><span v-else>{{ item.name }}</span><small v-if="renamingPath===item.path && message && messageFailed" class="rename-error" role="alert">{{message}}</small></div></div>
          <p v-else class="collection-empty">{{ search || typeFilter!=='all' ? '没有符合当前条件的项目，请清除搜索或筛选。' : '这个分类还没有项目' }}</p>
        </section>
      <footer class="collection-footer"><span v-if="footerMessage" :role="footerFailed?'alert':'status'" :title="footerMessage">{{ footerMessage }}</span><span v-else>{{ data?.settings.desktopCollected ? '已收纳 · 新文件自动分类' : '原桌面已显示 · 点击顶部整理按钮可重新收纳' }}</span><span v-if="!footerMessage">F2 改名</span></footer>
      </template>
      <div v-if="fileMenu" class="file-context-menu" role="menu" aria-label="文件操作" :style="{left:fileMenu.x+'px',top:fileMenu.y+'px'}" @keydown="menuKeydown"><button role="menuitem" data-menu-action="open" @click="chooseFileAction('open')">打开</button><button role="menuitem" data-menu-action="rename" :disabled="fileMenu.item.path.startsWith('shell:') || selectedPaths.size > 1" @click="chooseFileAction('rename')">重命名 <small>F2</small></button><button role="menuitem" data-menu-action="reveal" :disabled="fileMenu.item.path.startsWith('shell:')" @click="chooseFileAction('reveal')">在文件夹中显示</button><button role="menuitem" data-menu-action="trash" :disabled="fileMenu.item.path.startsWith('shell:')" @click="chooseFileAction('trash')">{{selectedPaths.size>1?`将 ${selectedPaths.size} 项移到回收站`:'移到回收站'}}</button></div>
    </template>
  </main>
</template>

<style scoped>
.rename-error{font-size:10px;color:#ffd0c6;overflow-wrap:anywhere;line-height:1.4}
:global(html), :global(body), :global(#app) { width:100%; height:100%; margin:0; overflow:hidden; background:transparent !important; }
.desktop-collection { display:flex; flex-direction:column; width:100%; height:100%; overflow:hidden; border:1px solid #ffffff32; border-radius:6px; background:rgba(30,37,42,var(--collection-alpha)); color:#f4f7f6; font-family:'Microsoft YaHei UI',sans-serif; font-size:12px; }
button,input { font:inherit; color:inherit; }button { cursor:pointer; }button:disabled { opacity:.45; cursor:default; }button:focus-visible,input:focus-visible { outline:2px solid #addcc0; outline-offset:-2px; }svg { width:16px; height:16px; flex-shrink:0; }
.collection-header { display:flex; align-items:center; flex:0 0 36px; gap:9px; padding:0 10px; -webkit-app-region:no-drag; touch-action:none; user-select:none; cursor:move; }.collection-header > svg { color:#b8ddc7; }.collection-header b { white-space:nowrap; font-size:13px; font-weight:400; }.total-count { color:#d1dbd8; font-size:11px; font-variant-numeric:tabular-nums; margin-right:auto; }.collection-header button { display:grid; place-items:center; width:26px; height:28px; border:0; border-radius:3px; background:transparent; -webkit-app-region:no-drag; }.collection-header button:hover { background:#ffffff16; }
.project-switch{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 12px 6px;color:#d1dbd8;font-size:11px}.project-switch select{min-width:0;max-width:75%;padding:5px;background:#26352f;color:inherit;border:1px solid #ffffff28;border-radius:3px;font:inherit}.desktop-collection :deep(.zone-window.embedded){flex:1;min-height:0}
.collection-tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); flex:0 0 33px; margin:0 10px; border-bottom:1px solid #ffffff22; gap:3px; }.collection-tabs button { position:relative; border:0; border-bottom:2px solid transparent; background:transparent; color:#d1dbd8; padding:0; white-space:nowrap; }.collection-tabs button:hover { color:#fff; background:#ffffff0b; }.collection-tabs .active { color:#c1efd1; border-bottom-color:#a4dbb6; }.collection-tabs small { font-size:9px; margin-left:4px; font-variant-numeric:tabular-nums; }.collection-tabs .drop-target { background:#a4dbb633; outline:1px solid #a4dbb6; }
.collection-search { display:flex; align-items:center; flex:0 0 29px; gap:7px; margin:8px 12px 4px; padding:0 7px; border-radius:3px; background:#00000021; color:#cfdbd5; }.collection-search svg { width:13px; height:13px; }.collection-search input { min-width:0; width:100%; height:28px; padding:0; border:0; background:transparent; caret-color:#b7e5c7; }.collection-search input::placeholder { color:#c1cec6; }.collection-search button { display:grid; place-items:center; padding:0; border:0; background:transparent; }
.collection-body { flex:1; min-height:0; overflow:auto; padding:4px 10px 8px; scrollbar-width:thin; scrollbar-color:#b6c7bd66 transparent; }.collection-files { display:grid; grid-template-columns:repeat(auto-fill,minmax(68px,1fr)); align-content:start; gap:4px; }.collection-files .file-item { display:flex; flex-direction:column; align-items:center; gap:5px; min-width:0; height:82px; padding:8px 3px 5px; border:1px solid transparent; border-radius:4px; background:transparent; }.collection-files .file-item:hover,.collection-files .file-item:focus-visible,.collection-files .file-item.selected { border-color:#ffffff30; background:#ffffff14; }.collection-files img,.collection-files svg { width:32px; height:32px; object-fit:contain; flex-shrink:0; }.collection-files span { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; width:100%; overflow:hidden; overflow-wrap:anywhere; text-align:center; line-height:16px; font-size:11px; }.collection-empty { margin:44px 0; text-align:center; color:#d3ded8; }
.collection-todos { flex:1; min-height:0; overflow:hidden; }.collection-footer { display:flex; justify-content:space-between; gap:10px; flex:0 0 auto; padding:6px 12px; font-size:10px; color:#cfdbd4; }.collection-footer [role=alert] { color:#ffcec7; line-height:1.5; }::selection { color:#fff; background:#47614f; }
.collection-sort { display:flex; justify-content:space-between; align-items:center; padding:0 13px 5px; font-size:10px; color:#d1dbd8; }.collection-sort select { max-width:145px; border:0; background:#26352f; border-radius:3px; padding:3px; color:#e4eee7; font:inherit; }.rename-input { width:100%; min-width:0; height:27px; padding:2px; border:1px solid #b7dfc7; background:#162b21; color:white; text-align:center; font-size:11px; }
.file-context-menu { position:fixed; z-index:20; width:164px; padding:4px; border:1px solid #718b78; border-radius:4px; background:#25342c; color:#eef4ef; }.file-context-menu button { display:flex; align-items:center; justify-content:space-between; width:100%; height:32px; padding:0 10px; border:0; border-radius:2px; background:transparent; color:inherit; font:inherit; text-align:left; }.file-context-menu button:hover:not(:disabled),.file-context-menu button:focus-visible { background:#ffffff18; }.file-context-menu button:last-child { border-top:1px solid #ffffff20; border-radius:0; }.file-context-menu small { color:#c1d3c6; }
</style>
