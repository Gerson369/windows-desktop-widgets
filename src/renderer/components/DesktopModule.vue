<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {groupTodos,type TodoTab} from '../todo-groups'
import {todoDateLabel} from '../todo-dates'
import DueDatePicker from './DueDatePicker.vue'
import AssistantIcon from './AssistantIcon.vue'
import { useDesktopDrag } from '../useDesktopDrag'
import { useWidgetHover } from '../useWidgetHover'
const titleDrag=useDesktopDrag()
import type { AppData, DesktopModule, TodoItem } from '../../main/types'

const props = defineProps<{ moduleId: string; embedded?: boolean; reminderId?: string }>()
const data = ref<AppData | null>(null)
const message = ref('')
const collecting = ref(false)
const quickTodoTitle = ref('')
const quickTodoDate=ref('')
const todoTab=ref<TodoTab>('pending'),listNow=ref(Date.now()),addingTodo=ref(false)
let dateTimer:ReturnType<typeof setInterval>|undefined
const dueDay=(at:string)=>{const date=new Date(at);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
async function setDue(todo:TodoItem,day:string){try {await toolbox.entity.upsert('todos',{id:todo.id,dueAt:day?new Date(`${day}T23:59:00`).toISOString():null})}catch(reason){message.value=String(reason)}}
const editingTodoId = ref<string | null>(null)
const editingTodoTitle = ref('')
const savingTodoTitle = ref(false)
const updatingTodoId = ref<string | null>(null)
const showCompleted = computed(()=>todoTab.value==='completed')
const reminderTodoId = ref<string | null>(null)
const reminderDraft = ref('')
const reminderEnabledDraft = ref(false)
const reminderError = ref('')
let dispose: (() => void) | undefined
let disposeNavigation: (() => void) | undefined

const moduleState = computed<DesktopModule | null>(() => data.value?.desktopModules.find((item) => item.id === props.moduleId) || null)
const hover = useWidgetHover(() => Boolean(!props.embedded && data.value?.settings.desktopHoverExpandEnabled), () => Boolean(moduleState.value?.collapsed), () => data.value?.settings.desktopHoverCollapseDelay || 360, () => titleDrag.active)
const collapsed = computed(() => Boolean(moduleState.value?.collapsed) && !hover.expanded.value)
const opacity = computed(() => Math.max(0, Math.min(1, (data.value?.settings.desktopModuleOpacity ?? 28) / 100)))
const todoGroups=computed(()=>groupTodos(data.value?.todos||[],listNow.value))
const pendingTodos=computed(()=>todoGroups.value.pending)
const completedTodos=computed(()=>todoGroups.value.completed)
const visibleTodos=computed(()=>todoGroups.value[todoTab.value])
const todoTabs=[{id:'pending',title:'待办'},{id:'today',title:'今天'},{id:'planned',title:'计划'},{id:'completed',title:'已完成'}] as const
const reminderTodo = computed(() => data.value?.todos.find(item => item.id === reminderTodoId.value))
function reminderInput(at: string): string {
  const date = Number.isFinite(Date.parse(at)) ? new Date(at) : new Date(Date.now()+30*60000)
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)
}
async function openTodoReminder(todo: TodoItem) {
  if (todo.completed) return
  reminderTodoId.value=todo.id
  reminderEnabledDraft.value=true
  reminderDraft.value=reminderInput(todo.reminderAt || new Date(Date.now()+30*60000).toISOString())
  reminderError.value=''
  await nextTick()
  document.querySelector<HTMLInputElement>('[aria-label="待办提醒时间"]')?.focus()
}

const action = async (section: 'desktop' | 'todos' | 'organizer' | 'settings') => {
  await toolbox.desktopModules.openMain(section)
}

const refreshGroups = async () => {
  try { data.value = await toolbox.organizer.refreshDesktopGroups(); message.value = '文件分类已更新' }
  catch (error) { message.value = error instanceof Error ? error.message : '分类未完成' }
}
const collectNow = async () => {
  if (collecting.value) return
  collecting.value = true
  try { data.value = await toolbox.desktop.collect(); message.value = `已收纳 ${data.value.desktopItems.length} 个项目` }
  catch (error) { message.value = error instanceof Error ? error.message : '收纳未完成，原图标保持显示' }
  finally { collecting.value = false }
}
const release = async () => {
  try { data.value = await toolbox.desktop.release(); message.value = '已显示原桌面，图标位置保持不变' }
  catch (error) { message.value = error instanceof Error ? error.message : '桌面恢复未完成' }
}
const toggleCollapsed = async () => {
  if (hover.expanded.value) { hover.cancel(); return }
  if (!moduleState.value) return
  data.value = await toolbox.desktopModules.update(moduleState.value.id, { collapsed: !moduleState.value.collapsed })
}

const hide = async () => {
  if (!moduleState.value) return
  data.value = await toolbox.desktopModules.update(moduleState.value.id, { visible: false })
}

const toggleTodo = async (todo: TodoItem, event: Event) => {
  const checkbox = event.target as HTMLInputElement
  if (updatingTodoId.value) { checkbox.checked = todo.completed; return }
  updatingTodoId.value = todo.id
  message.value = ''
  try {
    data.value = await toolbox.entity.upsert('todos', { id: todo.id, completed: checkbox.checked })
  } catch (error) {
    checkbox.checked = todo.completed
    message.value = error instanceof Error ? error.message : '完成状态未保存，请重试。'
  } finally { updatingTodoId.value = null }
}

const beginTodoRename = async (todo: TodoItem) => {
  if (savingTodoTitle.value) return
  editingTodoId.value = todo.id
  editingTodoTitle.value = todo.title
  message.value = ''
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('[data-todo-rename]')
  input?.focus()
  input?.select()
}
const cancelTodoRename = () => { editingTodoId.value = null; message.value = '' }
const saveTodoRename = async (todo: TodoItem) => {
  if (editingTodoId.value !== todo.id || savingTodoTitle.value) return
  const title = editingTodoTitle.value.trim()
  if (!title) { message.value = '事项名称不能为空。'; return }
  if (title === todo.title) { editingTodoId.value = null; return }
  savingTodoTitle.value = true
  message.value = ''
  try {
    data.value = await toolbox.entity.upsert('todos', { id: todo.id, title })
    editingTodoId.value = null
  } catch (error) { message.value = error instanceof Error ? error.message : '改名未保存，请重试。' }
  finally { savingTodoTitle.value = false }
}

const saveTodoReminder = async () => {
  if (!reminderTodo.value) return
  reminderError.value = ''
  try {
    const todo = reminderTodo.value
    const patch: Record<string, unknown> = { id: todo.id }
    if (!todo.completed) {
      const at = !reminderEnabledDraft.value ? null : todo.reminderAt && reminderDraft.value === reminderInput(todo.reminderAt)
        ? todo.reminderAt : new Date(reminderDraft.value).toISOString()
      if (at !== (todo.reminderAt || null)) patch.reminderAt = at
    }
    data.value = await toolbox.entity.upsert('todos', patch)
    reminderTodoId.value = null
  } catch (error) { reminderError.value = error instanceof Error ? error.message : '提醒未保存，请重试。' }
}

const addTodo = async () => {
  const title = quickTodoTitle.value.trim()
  if (!data.value || !title || addingTodo.value) return
  addingTodo.value=true;message.value=''
  try {
  const nextOrder = Math.max(-1, ...data.value.todos.map((item) => item.order)) + 1
  data.value = await toolbox.entity.upsert('todos', {
    id: crypto.randomUUID(),
    title,
    categoryId: data.value.categories[0]?.id || 'personal',
    completed: false,
    dueAt: quickTodoDate.value ? new Date(`${quickTodoDate.value}T23:59:00`).toISOString() : undefined,
    order: nextOrder
  })
  quickTodoTitle.value = ''
  quickTodoDate.value = ''
  todoTab.value='pending'
  }catch(error){message.value=error instanceof Error?error.message:'添加失败，请重试'}finally{addingTodo.value=false}
}

function openRequestedReminder(id = props.reminderId) {
  const todo = data.value?.todos.find(item => item.id === id)
  if (todo) { todoTab.value = 'pending'; void openTodoReminder(todo) }
}
watch(() => props.reminderId, id => openRequestedReminder(id))
onMounted(async () => {
  dateTimer=setInterval(()=>listNow.value=Date.now(),30000)
  try {
    data.value = await toolbox.data.get()
    openRequestedReminder()
    dispose = toolbox.data.onChanged((next) => { data.value = next })
    disposeNavigation = toolbox.events.onNavigate(section => {
      if (!section.startsWith('todo-reminder:')) return
      const todo=data.value?.todos.find(item=>item.id===section.slice('todo-reminder:'.length))
      if (todo) { todoTab.value='pending'; void openTodoReminder(todo) }
    })
  } catch (error) { message.value = error instanceof Error ? error.message : '桌面模块无法初始化。' }
})
onBeforeUnmount(() => {
  clearInterval(dateTimer)
  dispose?.()
  disposeNavigation?.()
})
</script>

<template>
  <main v-if="moduleState" class="desktop-module" :class="{ embedded }" :style="{ '--module-alpha': opacity }" @mouseenter="hover.enter" @mouseleave="hover.leave">
    <header v-if="!embedded" class="module-header" @pointerdown="titleDrag.start" @pointermove="titleDrag.move" @pointerup="titleDrag.finish" @pointercancel="titleDrag.finish" @lostpointercapture="titleDrag.finish">
      <div class="module-title"><span class="drag-grip">⠿</span><b>{{ moduleState.title }}</b></div>
      <div class="module-tools"><button class="collapse-button" :aria-label="collapsed ? '展开待办' : '收起待办'" :title="collapsed ? '展开' : '收起'" @click="toggleCollapsed"><AssistantIcon :name="collapsed ? 'expand' : 'collapse'"/></button><button title="暂时隐藏模块" aria-label="隐藏待办" @click="hide"><AssistantIcon name="close"/></button></div>
    </header>
    <template v-if="embedded || !collapsed">
      <section v-if="moduleState.kind === 'quick'" class="quick-content">
        <div class="quick-grid collect-grid"><button :disabled="collecting" class="collect-button" @click="collectNow"><AssistantIcon name="folder"/><b>{{ collecting ? '正在收纳…' : data?.settings.desktopCollected ? '重新整理' : '自动收纳桌面' }}</b></button><button :disabled="!data?.settings.desktopCollected || collecting" @click="release"><AssistantIcon name="layout"/><b>显示原桌面</b></button></div>
        <div class="todo-summary" style="margin-top:10px"><span role="status">{{ message || (data?.settings.desktopCollected ? '已收纳 · 新文件自动分类' : '收纳后桌面只保留分类框') }}</span><button @click="action('settings')">设置</button></div>
      </section>
      <section v-else class="todo-content">
        <div class="todo-toolbar"><div class="todo-filter" role="tablist" aria-label="待办分类"><button v-for="tab in todoTabs" :key="tab.id" :data-todo-filter="tab.id" role="tab" :class="{active:todoTab===tab.id}" :aria-selected="todoTab===tab.id" @click="todoTab=tab.id"><span>{{tab.title}}</span><small>{{todoGroups[tab.id].length}}</small></button></div></div><form v-if="!showCompleted" class="todo-create" @submit.prevent="addTodo"><input v-model="quickTodoTitle" maxlength="80" placeholder="添加待办，按 Enter 保存" aria-label="新增待办"/><div class="todo-create-actions"><DueDatePicker v-model="quickTodoDate" label="新待办日期"/><button :disabled="addingTodo || !quickTodoTitle.trim()" type="submit" aria-label="添加待办" title="添加待办"><AssistantIcon name="plus"/></button></div></form>
        <section v-if="reminderTodo" class="todo-reminder-editor" role="dialog" aria-label="事项提醒设置" @keydown.esc="reminderTodoId=null">
          <div class="reminder-heading"><b>提醒设置</b><button aria-label="关闭待办提醒" @click="reminderTodoId=null">关闭</button></div>
          <form class="todo-details-form todo-reminder-form" @submit.prevent="saveTodoReminder">
            <div class="todo-settings-fields"><p class="reminder-task-title">{{ reminderTodo.title }}</p>
            <p v-if="reminderTodo.completed" class="completed-hint">已完成；返回列表后点击前方方框可恢复为待办。</p>
            <template v-else>
              <label class="reminder-enabled"><input v-model="reminderEnabledDraft" type="checkbox" aria-label="开启事项提醒"/>提醒我</label>
              <label>提醒时间<input v-model="reminderDraft" type="datetime-local" aria-label="待办提醒时间" :disabled="!reminderEnabledDraft" :required="reminderEnabledDraft"/></label>
              <div class="reminder-actions"><button type="button" @click="reminderEnabledDraft=true; reminderDraft=reminderInput(new Date(Date.now()+10*60000).toISOString())">10 分钟后提醒</button></div>
            </template>
            </div><div class="reminder-actions todo-save-actions"><button type="submit">保存提醒</button><button type="button" @click="reminderTodoId=null">取消</button></div>
          </form>
          <p v-if="reminderError" role="alert">{{ reminderError }}</p>
        </section>
        <div class="desktop-todo-list"><div v-for="todo in visibleTodos" :key="todo.id" class="desktop-todo" :class="{completed:todo.completed}" :data-todo-id="todo.id">
          <input class="todo-checkbox" type="checkbox" :checked="todo.completed" :disabled="updatingTodoId !== null" :aria-label="`${todo.completed ? '恢复待办' : '完成'}：${todo.title}`" @change="toggleTodo(todo,$event)"/>
          <div class="todo-copy">          <input v-if="editingTodoId === todo.id" v-model="editingTodoTitle" class="todo-rename" data-todo-rename :disabled="savingTodoTitle" aria-label="重命名待办事项" maxlength="80" @keydown.enter.prevent="saveTodoRename(todo)" @keydown.esc.prevent="cancelTodoRename" @blur="saveTodoRename(todo)"/>
          <button v-else class="todo-title" :aria-label="`重命名事项：${todo.title}`" :title="`${todo.title} · 点击改名`" @click="beginTodoRename(todo)"><span>{{ todo.title }}</span></button>
<small class="todo-created" :title="`添加于 ${new Date(todo.createdAt).toLocaleString('zh-CN')}`">添加于 {{todoDateLabel(dueDay(todo.createdAt),listNow)}}</small></div>
          <DueDatePicker :model-value="todo.dueAt ? dueDay(todo.dueAt) : ''" :label="`事项日期：${todo.title}`" @update:model-value="setDue(todo,$event)"/><button v-if="!todo.completed" class="todo-reminder-button" :class="{active:todo.reminderAt}" :aria-label="`提醒：${todo.title}`" :title="todo.reminderAt ? new Date(todo.reminderAt).toLocaleString() : '设置提醒'" @click="openTodoReminder(todo)"><AssistantIcon name="bell"/></button>
        </div></div>
        <p v-if="message" role="alert" class="todo-error">{{ message }}</p>
        <p v-if="visibleTodos.length === 0" class="empty">{{ showCompleted ? '还没有已完成事项' : '今天没有待办，保持轻松。' }}</p>
        <p v-if="showCompleted && visibleTodos.length" class="completed-hint">点击前方方框可恢复为待办；点击文字直接改名</p>
      </section>
    </template>
  </main>
  <main v-else class="desktop-module missing"><p>{{ message || '桌面模块不可用。' }}</p></main>
</template>

<style scoped>
.todo-copy{display:flex;flex-direction:column;flex:1;min-width:0;gap:1px}.todo-copy .todo-title span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.todo-created{font-size:9px;color:#aebfb7;white-space:nowrap;line-height:1.5}.todo-toolbar .todo-filter{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));width:100%;gap:3px!important}.todo-toolbar .todo-filter button{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0 7px}.todo-filter button small{font-size:12px;font-variant-numeric:tabular-nums;color:#b7d8c4}

.todo-scope{flex:0 0 auto;width:auto;max-width:100%;align-self:flex-start;margin:0 0 12px;padding:5px 8px;border:1px solid #ffffff28;border-radius:4px;background:#26352f;color:#e4eee7;font:inherit;font-size:11px}
.todo-content .todo-create{flex-direction:column;gap:8px;margin:0 0 12px;padding:10px;border:1px solid #ffffff28;border-radius:5px;background:#00000012}.todo-create>input{flex:0 0 auto;box-sizing:border-box;width:100%;height:30px;padding:0 2px;border:0;background:transparent;font-size:12px}.todo-create-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.todo-create-actions>button{display:grid;place-items:center;min-height:28px;width:30px}.todo-create-actions>button svg{width:16px;height:16px}.todo-content .todo-filter{flex:0 0 auto}.desktop-todo-list .desktop-todo{box-sizing:border-box;gap:8px;min-height:44px}.desktop-todo-list .todo-title span{white-space:normal;overflow-wrap:anywhere;line-height:1.6}.desktop-todo-list .todo-reminder-button{flex:0 0 26px}.todo-content>.empty{margin-top:20px;line-height:1.8}

.todo-reminder-editor { display:flex; flex-direction:column; overflow:hidden !important; }
.todo-details-form { display:flex; flex-direction:column; flex:1; min-height:0; }
.todo-settings-fields { flex:1; min-height:0; overflow:auto; padding:2px; }
.todo-reminder-editor .todo-save-actions { flex:0 0 auto; margin-bottom:0; padding-top:10px; border-top:1px solid #ffffff20; }

.desktop-todo .todo-checkbox { appearance:none; flex:0 0 16px; width:16px; height:16px; min-width:16px; padding:0; margin:0 3px; border:1px solid #d2dfd5; border-radius:3px; background:transparent; cursor:pointer; }
.desktop-todo .todo-checkbox:checked { background:#bdddc7; border-color:#bdddc7; }
.desktop-todo .todo-checkbox:checked::after { content:'✓'; display:block; color:#14281b; font-size:13px; line-height:14px; text-align:center; }
.desktop-todo .todo-checkbox:disabled { opacity:.5; cursor:wait; }
.todo-title { display:flex; min-width:0; flex:1; padding:3px 0; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; font:inherit; }
.todo-title span { flex:1; }.todo-checkbox:focus-visible,.todo-title:focus-visible,.todo-reminder-button:focus-visible { outline:2px solid #bdddc7; outline-offset:3px; }
.todo-reminder-editor .reminder-enabled { flex-direction:row; align-items:center; margin:15px 0; }.todo-reminder-editor .reminder-enabled input { width:16px; height:16px; margin:0; accent-color:#bdddc7; }.todo-reminder-editor input:disabled { opacity:.45; }
.reminder-task-title { margin:0 0 14px; overflow-wrap:anywhere; }.desktop-todo .todo-rename { flex:1; min-width:0; }
.todo-error { color:#ffd0c7; font-size:11px; }

.desktop-module { position:relative; }.todo-reminder-button { flex:0 0 24px; border:0; background:transparent; color:#b9cec0; cursor:pointer; padding:3px; }.todo-reminder-button svg { width:15px; height:15px; }.todo-reminder-button.active { color:#bce7c7; }.todo-reminder-editor { position:absolute; z-index:5; inset:40px 0 0; padding:12px; overflow:auto; background:#25342c; color:#edf4ef; font-size:12px; }.reminder-heading { display:flex; gap:10px; align-items:center; justify-content:space-between; margin-bottom:15px; }.reminder-heading b { overflow-wrap:anywhere; }.todo-reminder-editor button { border:1px solid #ffffff30; border-radius:4px; padding:5px 8px; background:#ffffff13; color:inherit; cursor:pointer; }.todo-reminder-editor label { display:flex; flex-direction:column; gap:7px; }.todo-reminder-editor input { min-width:0; width:100%; padding:7px; border:1px solid #ffffff40; border-radius:4px; color:inherit; background:#13221a; color-scheme:dark; }.reminder-actions { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0; }.todo-reminder-editor [role=alert] { color:#ffd0c7; }
.desktop-module.embedded { border:0; border-radius:0; background:transparent; }.desktop-module.embedded .todo-content { height:100%; box-sizing:border-box; padding:14px 16px 12px; }
:global(html), :global(body), :global(#app) { width:100%; height:100%; margin:0; overflow:hidden; background:transparent !important; }
.desktop-module { box-sizing:border-box; width:100%; height:100%; overflow:hidden; color:rgba(248,252,255,.96); border:1px solid rgba(232,243,255,.28); border-radius:6px; background:rgba(35,39,41,var(--module-alpha)); box-shadow:0 2px 8px rgba(4,11,24,.08), inset 0 1px 0 rgba(255,255,255,.08); font-family:"Microsoft YaHei UI",sans-serif; }
.module-header { display:flex; align-items:center; justify-content:space-between; height:40px; padding:0 10px; border-bottom:1px solid rgba(233,241,255,.15); background:rgba(8,22,40,.045); -webkit-app-region:no-drag; touch-action:none; user-select:none; cursor:move; }
.module-title { display:flex; align-items:center; gap:8px; min-width:0; }.module-title b { font-size:13px; letter-spacing:.02em; }.drag-grip { color:rgba(234,243,255,.66); font-size:15px; letter-spacing:-4px; }
.module-tools { display:flex; gap:2px; -webkit-app-region:no-drag; }.module-tools button { width:26px; height:28px; display:grid; place-items:center; padding:0; border:0; border-radius:3px; background:transparent; color:rgba(243,248,255,.82); font-size:15px; cursor:pointer; }.module-tools button:hover { background:rgba(255,255,255,.12); color:white; }
.collect-grid { grid-template-columns:1.3fr 1fr !important; }.collect-button { background:rgba(139,214,162,.2) !important; }.quick-content { padding:10px 11px 11px; }.quick-content p { margin:0 0 9px; color:rgba(232,241,251,.76); font-size:11px; line-height:1.4; }.quick-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }.quick-grid button { display:grid; gap:4px; place-items:center; min-height:62px; padding:7px 4px; border:1px solid rgba(239,246,255,.14); border-radius:5px; background:rgba(8,24,43,.11); color:rgba(249,252,255,.95); cursor:pointer; transition:background .16s ease,transform .16s ease; }.quick-grid button:hover { background:rgba(123,169,255,.18); transform:translateY(-1px); }.quick-grid span { font-size:19px; color:#a4dbb6; }.quick-grid b { font-size:11px; font-weight:600; }
.todo-content { display:flex; flex-direction:column; height:calc(100% - 40px); padding:9px 10px 10px; overflow:hidden; }.todo-summary { display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; color:rgba(234,243,254,.72); font-size:11px; }.todo-summary button { border:0; background:transparent; padding:2px 0; color:#a4dbb6; font-size:11px; cursor:pointer; }.todo-create { display:flex; gap:5px; margin:0 0 6px; }.todo-create input { min-width:0; flex:1; height:27px; padding:0 8px; border:1px solid rgba(238,246,255,.18); border-radius:4px; outline:0; background:rgba(8,24,43,.12); color:rgba(250,253,255,.96); font:inherit; font-size:11px; }.todo-create input::placeholder { color:rgba(230,240,252,.62); }.todo-create input:focus { border-color:rgba(177,211,255,.66); background:rgba(8,24,43,.20); }.todo-create button { width:28px; border:1px solid rgba(238,246,255,.18); border-radius:4px; background:rgba(129,176,255,.18); color:#e7f1ff; font-size:17px; line-height:1; cursor:pointer; }.todo-create button:disabled { opacity:.38; cursor:default; }.desktop-todo-list { min-height:0; flex:1; overflow:auto; }.desktop-todo-list::-webkit-scrollbar { width:4px; }.desktop-todo-list::-webkit-scrollbar-thumb { border-radius:4px; background:rgba(232,242,255,.24); }.desktop-todo { display:flex; align-items:center; gap:8px; width:100%; padding:8px 2px; border:0; border-bottom:1px solid rgba(231,240,255,.13); background:transparent; color:rgba(250,252,255,.95); text-align:left; cursor:default; }.desktop-todo:last-child { border-bottom:0; }.todo-title:hover span { color:#bcd6ff; }.desktop-todo span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }.desktop-todo input { min-width:0; flex:1; height:24px; padding:0 6px; color:rgba(250,253,255,.96); border:1px solid rgba(177,211,255,.66); border-radius:3px; outline:0; background:rgba(8,24,43,.34); font:inherit; font-size:12px; }.empty { margin:12px 0 4px; color:rgba(234,243,254,.7); text-align:center; font-size:12px; }.missing { display:grid; place-items:center; color:white; background:rgba(14,28,49,.65); }
.module-tools button svg { width:16px; height:16px; }.todo-filter { display:flex; gap:16px; margin-bottom:10px; border-bottom:1px solid #ffffff20; }.todo-filter button { padding:2px 0 8px; border:0; border-bottom:2px solid transparent; background:transparent; color:#d1dbd8; font:inherit; font-size:11px; cursor:pointer; }.todo-filter .active { color:#c1efd1; border-bottom-color:#a4dbb6; }.desktop-todo.completed span { text-decoration:line-through; color:#c0cfc5; }.completed-hint { margin:8px 0 0; color:#c4d2c9; font-size:10px; }
.todo-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:0 0 auto;margin-bottom:12px;border-bottom:1px solid #ffffff20}.todo-toolbar .todo-filter{border:0;margin-bottom:0;gap:12px}.todo-toolbar .todo-scope{margin:0 0 6px;max-width:44%}.todo-content .todo-create{flex:0 0 auto}.todo-content .todo-create>input{flex:0 0 30px;box-sizing:border-box;min-height:30px;height:30px;width:100%;padding:0 2px;border:0;background:transparent;font-size:12px}
</style>
