<script setup lang="ts">
import { toolbox } from '../toolbox'

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { StickyNote } from '../../main/types'

const props = defineProps<{ noteId: string }>()
const note = ref<StickyNote | null>(null)
const title = ref('')
const content = ref('')
const color = ref('#fff0a8')
const saving = ref(false)
const error = ref('')
let dispose: (() => void) | undefined
let saveTimer: number | undefined

const populate = (next: StickyNote) => {
  note.value = next
  title.value = next.title
  content.value = next.content
  color.value = next.color
}

const save = async () => {
  if (!note.value || saving.value) return
  saving.value = true
  try {
    populate(await toolbox.notes.update(note.value.id, { title: title.value.trim() || '未命名便签', content: content.value, color: color.value }))
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '便签保存失败。'
  } finally { saving.value = false }
}

const scheduleSave = () => {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void save(), 420)
}

const togglePinned = async () => {
  if (!note.value) return
  try { populate(await toolbox.notes.update(note.value.id, { pinned: !note.value.pinned })) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '无法更新置顶状态。' }
}

const addChecklistItem = () => {
  content.value = `${content.value}${content.value && !content.value.endsWith('\n') ? '\n' : ''}☐ `
}

const completeChecklistItem = () => {
  const index = content.value.indexOf('☐')
  if (index >= 0) content.value = `${content.value.slice(0, index)}☑${content.value.slice(index + 1)}`
}

const hide = async () => {
  if (!note.value) return
  await save()
  await toolbox.notes.hide(note.value.id)
}

watch([title, content, color], scheduleSave)
onMounted(async () => {
  try {
    const current = await toolbox.notes.get(props.noteId)
    if (!current) { error.value = '该便签已被删除。'; return }
    populate(current)
    dispose = toolbox.notes.onChanged((changed) => {
      if (changed.id === props.noteId && !saving.value) populate(changed)
    })
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '无法加载便签。' }
})
onBeforeUnmount(() => { if (saveTimer) window.clearTimeout(saveTimer); dispose?.() })
</script>

<template>
  <main class="floating-note" :style="{ '--note-color': color }">
    <section v-if="error" class="note-error"><b>便签不可用</b><p>{{ error }}</p><button @click="hide">关闭</button></section>
    <template v-else-if="note">
      <header class="note-titlebar">
        <span class="drag-handle">⋮⋮</span>
        <input v-model="title" aria-label="便签标题" maxlength="80" placeholder="便签标题" />
        <div class="actions"><input v-model="color" title="便签颜色" type="color" /><button title="添加勾选项" @click="addChecklistItem">＋☐</button><button title="完成第一项未勾选内容" @click="completeChecklistItem">☑</button><button :class="{ active: note.pinned }" :title="note.pinned ? '取消置顶' : '保持置顶'" @click="togglePinned">{{ note.pinned ? '置顶中' : '置顶' }}</button><button title="隐藏便签" @click="hide">×</button></div>
      </header>
      <textarea v-model="content" aria-label="便签内容" placeholder="记录一个想法…" autofocus></textarea>
      <footer><span>{{ saving ? '正在保存…' : '自动保存' }}</span><span>拖动标题栏移动</span></footer>
    </template>
  </main>
</template>

<style scoped>
.floating-note { display: flex; flex-direction: column; width: 100vw; height: 100vh; overflow: hidden; color: #392d19; background: var(--note-color); font-family: Inter, "Microsoft YaHei", sans-serif; box-shadow: inset 0 0 0 1px rgba(90,68,23,.18); }
.note-titlebar { display: flex; align-items: center; gap: 7px; min-height: 42px; padding: 0 9px; border-bottom: 1px solid rgba(83,61,17,.17); background: rgba(255,255,255,.18); -webkit-app-region: drag; }
.drag-handle { color: rgba(55,41,20,.5); letter-spacing: -2px; cursor: grab; }
.note-titlebar input[type="text"], .note-titlebar > input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: #302513; font-size: 14px; font-weight: 700; -webkit-app-region: no-drag; }
.actions { display: flex; align-items: center; gap: 5px; -webkit-app-region: no-drag; }.actions input { width: 23px; height: 23px; padding: 0; border: 0; background: transparent; cursor: pointer; }.actions button { border: 1px solid rgba(80,60,21,.18); border-radius: 6px; padding: 4px 7px; background: rgba(255,255,255,.28); color: #4b381a; font-size: 11px; cursor: pointer; }.actions button:hover, .actions button.active { background: rgba(255,255,255,.65); }
textarea { flex: 1; min-height: 0; resize: none; border: 0; outline: 0; padding: 15px; background: transparent; color: #3c2e15; font: 14px/1.6 Inter, "Microsoft YaHei", sans-serif; }.floating-note footer { display: flex; justify-content: space-between; padding: 8px 12px; color: rgba(67,50,18,.65); font-size: 11px; border-top: 1px solid rgba(83,61,17,.14); }.note-error { display: grid; place-items: center; align-content: center; gap: 9px; flex: 1; background: #f8f0d1; }.note-error p { color: #725c2d; }.note-error button { border: 0; border-radius: 6px; padding: 7px 12px; background: #6b5220; color: white; cursor: pointer; }
</style>
