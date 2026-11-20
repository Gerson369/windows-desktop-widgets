<script setup lang="ts">
import { toolbox } from '../../toolbox'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { AppData } from '../../../main/types'
import type { AgendaEvent } from '../../../main/calendar-service'
import { calendarEventColors, dateKey, validDateKey } from '../../../main/widget-suite'
import AssistantIcon from '../AssistantIcon.vue'

const api = toolbox
const props = defineProps<{ data: AppData }>()
const month = ref(dateKey(Date.now()).slice(0, 7)), selected = ref(dateKey(Date.now()))
const events = ref<AgendaEvent[]>([]), error = ref(''), busy = ref(false)
const editorOpen = ref(false), titleInput = ref<HTMLInputElement | null>(null)
const title = ref(''), start = ref(''), end = ref(''), eventDate = ref(selected.value)
const allDay = ref(false), category = ref<'work' | 'personal'>('personal'), editingId = ref('')
const color = ref<string>(calendarEventColors[0])
const colorNames = ['薄荷绿', '天蓝', '暖橙', '淡紫', '玫粉', '青绿']
const sourceName = ref(''), sourceUrl = ref('')
let timer: ReturnType<typeof setInterval> | undefined
let lastDay = dateKey(Date.now()), generation = 0, lastSubscriptionCheck = 0

const days = computed(() => {
  const [year, number] = month.value.split('-').map(Number)
  if (!year || number < 1 || number > 12) return []
  const first = new Date(year, number - 1, 1), count = new Date(year, number, 0).getDate()
  const leading = (first.getDay() + 6) % 7
  const dates = [...Array(leading).fill(''), ...Array.from({ length: count }, (_, index) => `${month.value}-${String(index + 1).padStart(2, '0')}`)]
  return [...dates, ...Array((7 - dates.length % 7) % 7).fill('')]
})
const selectedEvents = computed(() => {
  const first = new Date(`${selected.value}T00:00:00`)
  const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 1)
  return events.value.filter(event => Date.parse(event.start) < last.getTime() && (Date.parse(event.end) > first.getTime() || dateKey(new Date(event.start)) === selected.value))
    .sort((left, right) => Number(right.allDay) - Number(left.allDay) || left.start.localeCompare(right.start) || left.id.localeCompare(right.id))
})
const selectedTitle = computed(() => new Date(`${selected.value}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }))
const isToday = (date: string) => date === dateKey(Date.now())
const hasEvents = (date: string) => events.value.some(event => dateKey(new Date(event.start)) === date)
function select(date: string) { selected.value = date }
function changeMonth(offset: number) {
  const current = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.value) ? month.value : dateKey(Date.now()).slice(0, 7)
  const [year, number] = current.split('-').map(Number)
  month.value = dateKey(new Date(year, number - 1 + offset, 1)).slice(0, 7)
}
function today() { selected.value = dateKey(Date.now()); month.value = selected.value.slice(0, 7) }
function eventColor(event: AgendaEvent): string {
  const local = props.data.suite.events.find(item => item.id === event.id)
  return local?.color || (local?.category === 'work' ? calendarEventColors[1] : local ? calendarEventColors[3] : calendarEventColors[0])
}
function eventTime(event: AgendaEvent): string {
  return event.allDay ? '全天' : new Date(event.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function localInput(value: string): string {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
async function beginCreate() {
  if (busy.value) return
  editingId.value = ''; title.value = ''; eventDate.value = selected.value
  start.value = `${selected.value}T09:00`; end.value = `${selected.value}T10:00`
  allDay.value = false; category.value = 'personal'
  color.value = calendarEventColors[props.data.suite.events.length % calendarEventColors.length]
  error.value = ''; editorOpen.value = true
  await nextTick(); titleInput.value?.focus()
}
async function edit(event: AgendaEvent) {
  const local = props.data.suite.events.find(item => item.id === event.id)
  if (!local || busy.value) return
  editingId.value = local.id; title.value = local.title; eventDate.value = dateKey(new Date(local.start))
  start.value = localInput(local.start); end.value = localInput(local.end)
  allDay.value = local.allDay; category.value = local.category; color.value = eventColor(event)
  error.value = ''; editorOpen.value = true
  await nextTick(); titleInput.value?.focus()
}
function closeEditor() { if (!busy.value) { editorOpen.value = false; editingId.value = ''; error.value = '' } }
async function refresh() {
  const current = ++generation
  try {
    const [year, number] = month.value.split('-').map(Number)
    const from = new Date(year, number - 1, 1).getTime(), until = new Date(year, number, 1).getTime()
    if (!Number.isFinite(from) || !Number.isFinite(until)) return
    const result = await api.suite.agenda(from, until)
    if (current === generation) { events.value = result.events; error.value = result.errors.join('；') }
  } catch (reason) { if (current === generation) error.value = reason instanceof Error ? reason.message : String(reason) }
}
async function perform(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await action(); await refresh() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { busy.value = false }
}
async function save() {
  if (!title.value.trim()) throw new Error('请填写日程名称。')
  if (allDay.value && !validDateKey(eventDate.value)) throw new Error('请选择有效的日程日期。')
  const first = allDay.value ? new Date(`${eventDate.value}T00:00:00`) : new Date(start.value)
  const last = allDay.value ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + 1) : new Date(end.value)
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime()) || last.getTime() <= first.getTime()) throw new Error('结束时间须晚于开始时间。')
  const item = { id: editingId.value || crypto.randomUUID(), title: title.value.trim(), start: first.toISOString(), end: last.toISOString(), allDay: allDay.value, category: category.value, color: color.value }
  await api.suite.save({ events: [...props.data.suite.events.filter(event => event.id !== item.id), item] })
  selected.value = dateKey(first); month.value = selected.value.slice(0, 7)
  editorOpen.value = false; title.value = ''; editingId.value = ''
}
async function refreshSubscriptions() {
  if (Date.now() - lastSubscriptionCheck < 30 * 60000) return
  lastSubscriptionCheck = Date.now()
  for (const source of props.data.suite.sources.filter(item => item.enabled && item.url && Date.now() - Date.parse(item.updatedAt) > 30 * 60000)) {
    try { await api.suite.refreshCalendar(source.id) }
    catch { error.value = `${source.name}：更新失败，保留上次内容。` }
  }
}
watch(month, value => { if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && selected.value.slice(0, 7) !== value) selected.value = `${value}-01` })
watch([month, () => props.data.suite.events, () => props.data.suite.sources], () => { void refresh() }, { immediate: true })
onMounted(() => {
  void refreshSubscriptions()
  timer = setInterval(() => {
    const current = dateKey(Date.now())
    if (current !== lastDay) { if (selected.value === lastDay) today(); lastDay = current; void refresh() }
    void refreshSubscriptions()
  }, 60000)
})
onBeforeUnmount(() => { generation++; clearInterval(timer) })
</script>

<template>
  <section class="calendar-card" aria-label="日历与当天日程">
    <div class="calendar-monthbar">
      <input v-model="month" type="month" required aria-label="查看月份"/>
      <button type="button" class="calendar-today" @click="today">今天</button>
      <button type="button" class="calendar-icon-button" aria-label="上个月" title="上个月" @click="changeMonth(-1)"><AssistantIcon name="left"/></button>
      <button type="button" class="calendar-icon-button" aria-label="下个月" title="下个月" @click="changeMonth(1)"><AssistantIcon name="right"/></button>
    </div>
    <div class="calendar-grid" aria-label="选择日期">
      <small v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">{{ day }}</small>
      <template v-for="(date, index) in days" :key="index">
        <button v-if="date" type="button" :class="{ 'is-today': isToday(date), 'has-events': hasEvents(date) }" :aria-label="date" :aria-pressed="date === selected" :aria-current="isToday(date) ? 'date' : undefined" @click="select(date)">{{ Number(date.slice(-2)) }}<i v-if="hasEvents(date)" aria-hidden="true"/></button>
        <span v-else/>
      </template>
    </div>

    <div class="calendar-day-heading">
      <div><h3>{{ selectedTitle }}</h3><small>{{ isToday(selected) ? '今天 · ' : '' }}{{ selectedEvents.length }} 项日程</small></div>
      <button type="button" class="calendar-add" aria-label="添加日程" :disabled="busy" @click="beginCreate"><AssistantIcon name="plus"/>新建</button>
    </div>
    <div v-if="selectedEvents.length" class="calendar-agenda" aria-label="当天事项">
      <article v-for="event in selectedEvents" :key="event.id" class="calendar-event" :style="{ '--event-color': eventColor(event) }">
        <time :datetime="event.start">{{ eventTime(event) }}</time>
        <span class="calendar-event-dot" aria-hidden="true"/>
        <div class="calendar-event-copy"><b>{{ event.title }}</b><small>{{ event.source }}<template v-if="!event.allDay"> · 至 {{ new Date(event.end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }}</template></small></div>
        <div v-if="data.suite.events.some(item => item.id === event.id)" class="calendar-event-actions">
          <button type="button" class="calendar-icon-button" :aria-label="`编辑日程 ${event.title}`" title="编辑日程" :disabled="busy" @click="edit(event)"><AssistantIcon name="edit"/></button>
          <button type="button" class="calendar-icon-button" :aria-label="`删除日程 ${event.title}`" title="删除日程" :disabled="busy" @click="perform(() => api.suite.save({ events: data.suite.events.filter(item => item.id !== event.id) }))"><AssistantIcon name="recycle"/></button>
        </div>
      </article>
    </div>
    <p v-else class="calendar-empty">这一天还没有安排，给自己留一点空白。</p>

    <section v-if="editorOpen" class="calendar-editor" aria-label="日程编辑" @keydown.esc.stop.prevent="closeEditor">
      <div class="calendar-editor-heading"><h3>{{ editingId ? '编辑日程' : '新建日程' }}</h3><button type="button" class="calendar-icon-button" aria-label="取消日程编辑" :disabled="busy" @click="closeEditor"><AssistantIcon name="close"/></button></div>
      <form class="calendar-event-form" @submit.prevent="perform(save)">
        <label>事项<input ref="titleInput" v-model="title" required maxlength="120" placeholder="要做什么？" aria-label="日程名称" :disabled="busy"/></label>
        <div class="calendar-event-options"><label>类别<select v-model="category" aria-label="日程类别" :disabled="busy"><option value="personal">个人</option><option value="work">工作</option></select></label><label class="calendar-all-day"><input v-model="allDay" type="checkbox" :disabled="busy"/>全天</label></div>
        <label v-if="allDay">日期<input v-model="eventDate" type="date" required aria-label="日程日期" :disabled="busy"/></label>
        <template v-else><label>开始<input v-model="start" type="datetime-local" required aria-label="日程开始时间" :disabled="busy"/></label><label>结束<input v-model="end" type="datetime-local" required aria-label="日程结束时间" :disabled="busy"/></label></template>
        <fieldset class="calendar-colors"><legend>颜色</legend><button v-for="(value, index) in calendarEventColors" :key="value" type="button" :style="{ '--event-color': value }" :aria-label="`日程颜色：${colorNames[index]}`" :aria-pressed="color === value" :disabled="busy" @click="color = value"><AssistantIcon v-if="color === value" name="check"/></button></fieldset>
        <div class="calendar-editor-actions"><button type="button" :disabled="busy" @click="closeEditor">取消</button><button type="submit" class="calendar-save" :disabled="busy">{{ busy ? '保存中…' : '保存日程' }}</button></div>
      </form>
    </section>
    <p v-if="error" class="calendar-error" role="alert">{{ error }}</p><p v-if="busy && !editorOpen" class="hint" role="status">正在处理…</p>

    <details class="calendar-sources"><summary>日历来源与订阅</summary><button :disabled="busy" @click="perform(() => api.suite.importCalendar())">导入 ICS 文件</button>
      <form class="calendar-source-form" @submit.prevent="perform(async () => { await api.suite.subscribeCalendar(sourceName, sourceUrl); sourceName = ''; sourceUrl = '' })"><label>名称<input v-model="sourceName" required maxlength="120" placeholder="工作 / 个人日历" aria-label="订阅名称"/></label><label>地址<input v-model="sourceUrl" type="url" required placeholder="HTTPS 订阅地址" aria-label="日历订阅地址"/></label><button :disabled="busy">订阅</button></form>
      <div v-for="source in data.suite.sources" :key="source.id" class="entry"><label><input type="checkbox" :checked="source.enabled" @change="perform(() => api.suite.save({ sources: data.suite.sources.map(item => item.id === source.id ? { ...item, enabled: !item.enabled } : item) }))"/>{{ source.name }}</label><small>{{ source.updatedAt ? new Date(source.updatedAt).toLocaleString('zh-CN') : '尚未刷新' }}</small><div class="row"><button v-if="source.url" :disabled="busy" @click="perform(() => api.suite.refreshCalendar(source.id))">刷新</button><button :disabled="busy" @click="perform(() => api.suite.save({ sources: data.suite.sources.filter(item => item.id !== source.id) }))">移除来源</button></div></div>
      <p class="hint">订阅只读展示，每 30 分钟检查更新；导入文件变化后需重新导入。</p>
    </details>
  </section>
</template>

<style scoped>
.calendar-card{min-width:0}.calendar-card input,.calendar-card select,.calendar-card button{box-sizing:border-box}.calendar-card svg{width:16px;height:16px;flex-shrink:0}.calendar-monthbar{display:flex;align-items:center;gap:6px;margin-bottom:8px}.calendar-monthbar input{min-width:0;width:0;font-size:14px;font-weight:600;background:transparent;border-color:transparent;padding-left:2px}.calendar-card .calendar-icon-button{display:grid;place-items:center;width:28px;min-height:28px;height:28px;flex:0 0 28px;padding:0;border:0;background:transparent;border-radius:8px}.calendar-card .calendar-today{min-height:28px;padding:3px 9px;font-size:11px;background:transparent}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:19px;grid-auto-rows:25px;row-gap:2px;column-gap:3px;text-align:center}.calendar-grid>small{height:19px;padding:0;font-size:10px;line-height:19px;color:#bdcbc3}.calendar-card .calendar-grid>button{position:relative;min-width:0;min-height:25px;height:25px;line-height:21px;padding:1px 0;border:1px solid transparent;border-radius:8px;background:transparent;font-size:12px;font-variant-numeric:tabular-nums}.calendar-grid>button.is-today{color:#b9e8cd;box-shadow:inset 0 0 0 1px #a4dbb65c}.calendar-grid>button[aria-pressed=true]{background:#b8e1ca;color:#172d21;border-color:#b8e1ca;font-weight:600}.calendar-grid>button i{position:absolute;left:calc(50% - 1.5px);bottom:2px;width:3px;height:3px;border-radius:50%;background:currentColor}.calendar-day-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:8px;border-top:1px solid var(--widget-line,#ffffff24)}.calendar-day-heading h3,.calendar-editor h3{margin:0;font-size:13px;font-weight:600;line-height:1.5}.calendar-day-heading small{font-size:10px}.calendar-card .calendar-add{display:flex;align-items:center;gap:3px;padding:3px 8px;min-height:28px;background:#a4dbb61c;border-color:#a4dbb63d;font-size:11px}.calendar-empty{margin:16px 0 20px;font-size:12px;line-height:1.6;color:#bdcbc3}.calendar-agenda{display:grid;gap:4px;padding:8px 0 4px}.calendar-event{display:grid;grid-template-columns:38px 5px minmax(0,1fr) auto;align-items:start;gap:8px;padding:10px 5px;border-radius:9px;background:color-mix(in srgb,var(--event-color) 7%,transparent)}.calendar-event time{font-size:10px;line-height:19px;color:#d4e0d9;font-variant-numeric:tabular-nums}.calendar-event-dot{width:5px;height:5px;border-radius:50%;margin-top:7px;background:var(--event-color)}.calendar-event-copy{display:grid;gap:3px;min-width:0}.calendar-event-copy b{font-size:12px;line-height:19px;font-weight:500;overflow-wrap:anywhere}.calendar-event-copy small{font-size:10px;line-height:1.5}.calendar-event-actions{display:flex;gap:1px}.calendar-event-actions .calendar-icon-button{width:23px;height:26px;min-height:26px;flex-basis:23px;color:#bfcec5}.calendar-event-actions svg{width:13px;height:13px}.calendar-editor{margin-top:14px;padding:12px;border:1px solid var(--widget-line,#ffffff30);border-radius:12px;background:#15231c7a}.calendar-editor-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.calendar-card .calendar-event-form,.calendar-card .calendar-source-form{display:flex;flex-direction:column;align-items:stretch;gap:10px;margin:0}.calendar-event-form>label,.calendar-source-form>label{display:grid;grid-template-columns:32px minmax(0,1fr);gap:8px;font-size:11px}.calendar-event-form input,.calendar-event-form select,.calendar-source-form input{width:100%;min-width:0;max-width:100%;font-size:12px}.calendar-event-options{display:flex;align-items:center;gap:12px}.calendar-event-options>label:first-child{display:grid;grid-template-columns:32px minmax(0,1fr);gap:8px;min-width:0;flex:1;font-size:11px}.calendar-event-options select{min-width:0}.calendar-all-day{flex:0 0 auto;font-size:11px;white-space:nowrap}.calendar-event-form .calendar-all-day input{width:14px;height:14px;min-height:14px;max-width:14px;flex:0 0 14px;margin:0;padding:0}.calendar-colors{display:flex;align-items:center;gap:7px;min-width:0;padding:0;border:0;margin:0}.calendar-colors legend{float:left;font-size:11px;margin-right:6px;padding-top:5px}.calendar-colors button{display:grid;place-items:center;width:24px;height:24px;min-height:24px;padding:3px;border:2px solid transparent;border-radius:50%;background:var(--event-color);color:#14251c}.calendar-colors button[aria-pressed=true]{background:var(--event-color);border-color:#f4f7f6;color:#14251c}.calendar-colors svg{width:14px;height:14px}.calendar-editor-actions{display:flex;justify-content:flex-end;gap:6px;padding-top:2px}.calendar-editor-actions button{font-size:11px;min-height:30px;padding:4px 12px}.calendar-editor-actions .calendar-save{background:#b8e1ca;border-color:#b8e1ca;color:#172d21}.calendar-error{margin:10px 0 0}.calendar-sources{padding-top:14px;margin-top:14px;border-top:1px solid var(--widget-line,#ffffff24)}.calendar-sources>summary{cursor:pointer;font-size:11px;color:#c5d3cb;margin-bottom:10px}.calendar-source-form{padding-top:12px}.calendar-sources .entry small{display:block;margin:5px 0 8px}@media(max-width:320px){.calendar-event{grid-template-columns:34px 4px minmax(0,1fr) auto;gap:6px}.calendar-editor{padding:10px}.calendar-colors{gap:5px}.calendar-colors button{width:22px;height:22px;min-height:22px}.calendar-event-form>label{grid-template-columns:28px minmax(0,1fr)}}
</style>
