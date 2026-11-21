<script setup lang="ts">
import { toolbox } from '../../toolbox'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { AppData } from '../../../main/types'
import type { AgendaEvent } from '../../../main/calendar-service'
import { calendarEventColors, dateKey, validDateKey } from '../../../main/widget-suite'
import { calendarWeeks, eventsOnCalendarDate, monthDates } from '../../calendar-layout'
import AssistantIcon from '../AssistantIcon.vue'

const api = toolbox
const props = defineProps<{ data: AppData }>()
const month = ref(dateKey(Date.now()).slice(0, 7)), selected = ref(dateKey(Date.now()))
const events = ref<AgendaEvent[]>([]), error = ref(''), busy = ref(false)
const editorOpen = ref(false), titleInput = ref<HTMLInputElement | null>(null)
const popupOpen = ref(false), calendarDialog = ref<HTMLDialogElement | null>(null)
const detailEvent = ref<AgendaEvent | null>(null), popupHeading = ref<HTMLElement | null>(null)
const title = ref(''), start = ref(''), end = ref(''), eventDate = ref(selected.value)
const eventEndDate = ref(selected.value), location = ref(''), notes = ref('')
const allDay = ref(false), category = ref<'work' | 'personal'>('personal'), editingId = ref('')
const color = ref<string>(calendarEventColors[0])
const colorNames = ['薄荷绿', '天蓝', '暖橙', '淡紫', '玫粉', '青绿']
const sourceName = ref(''), sourceUrl = ref('')
let timer: ReturnType<typeof setInterval> | undefined
let lastDay = dateKey(Date.now()), generation = 0, lastSubscriptionCheck = 0

const days = computed(() => monthDates(month.value))
const weeks = computed(() => calendarWeeks(days.value, events.value))
const eventsOnDate = (date: string) => eventsOnCalendarDate(events.value, date)
const selectedEvents = computed(() => eventsOnDate(selected.value))
const selectedTitle = computed(() => new Date(`${selected.value}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }))
const isToday = (date: string) => date === dateKey(Date.now())
function select(date: string) { selected.value = date }
async function showPopup() {
  popupOpen.value = true
  await nextTick()
  if (calendarDialog.value && !calendarDialog.value.open) calendarDialog.value.showModal()
  if (editorOpen.value) titleInput.value?.focus()
  else popupHeading.value?.focus()
}
async function openDay(date: string) {
  if (busy.value) return
  select(date); editorOpen.value = false; detailEvent.value = null; error.value = ''
  await showPopup()
}
async function openEvent(event: AgendaEvent, date: string) {
  if (busy.value) return
  select(date); editorOpen.value = false; detailEvent.value = event; error.value = ''
  await showPopup()
}
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
function displayEnd(event: Pick<AgendaEvent, 'start' | 'end' | 'allDay'>): Date {
  const end = Date.parse(event.end)
  return new Date(event.allDay && end > Date.parse(event.start) ? end - 1 : end)
}
function detailTime(event: AgendaEvent, boundary: 'start' | 'end'): string {
  const date = boundary === 'end' ? displayEnd(event) : new Date(event.start)
  return date.toLocaleString('zh-CN', event.allDay
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
const detailIsLocal = computed(() => detailEvent.value && props.data.suite.events.some(item => item.id === detailEvent.value?.id))
function localInput(value: string): string {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
async function beginCreate() {
  if (busy.value) return
  editingId.value = ''; title.value = ''; eventDate.value = selected.value
  eventEndDate.value = selected.value; location.value = ''; notes.value = ''; detailEvent.value = null
  start.value = `${selected.value}T09:00`; end.value = `${selected.value}T10:00`
  allDay.value = false; category.value = 'personal'
  color.value = calendarEventColors[props.data.suite.events.length % calendarEventColors.length]
  error.value = ''; editorOpen.value = true
  await showPopup()
}
async function edit(event: AgendaEvent) {
  const local = props.data.suite.events.find(item => item.id === event.id)
  if (!local || busy.value) return
  editingId.value = local.id; title.value = local.title; eventDate.value = dateKey(new Date(local.start))
  const last = displayEnd(local)
  eventEndDate.value = dateKey(last); location.value = local.location || ''; notes.value = local.notes || ''; detailEvent.value = null
  start.value = localInput(local.start); end.value = localInput(local.end)
  allDay.value = local.allDay; category.value = local.category; color.value = eventColor(event)
  error.value = ''; editorOpen.value = true
  await showPopup()
}
function dismissPopup() {
  popupOpen.value = false; editorOpen.value = false; detailEvent.value = null; editingId.value = ''; error.value = ''
  calendarDialog.value?.close()
}
function closeEditor() { if (!busy.value) dismissPopup() }
async function removeEvent(event: AgendaEvent) {
  await api.suite.save({ events: props.data.suite.events.filter(item => item.id !== event.id) })
  if (detailEvent.value?.id === event.id) dismissPopup()
}
async function refresh() {
  const current = ++generation
  try {
    if (!days.value.length) return
    const from = new Date(`${days.value[0]}T00:00:00`).getTime()
    const last = new Date(`${days.value[days.value.length - 1]}T00:00:00`); last.setDate(last.getDate() + 1)
    const until = last.getTime()
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
  if (allDay.value && (!validDateKey(eventDate.value) || !validDateKey(eventEndDate.value) || eventEndDate.value < eventDate.value)) throw new Error('请选择有效的起止日期，结束日期不能早于开始日期。')
  const first = allDay.value ? new Date(`${eventDate.value}T00:00:00`) : new Date(start.value)
  const last = allDay.value ? new Date(`${eventEndDate.value}T00:00:00`) : new Date(end.value)
  if (allDay.value) last.setDate(last.getDate() + 1)
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime()) || last.getTime() <= first.getTime()) throw new Error('结束时间须晚于开始时间。')
  const item = { id: editingId.value || crypto.randomUUID(), title: title.value.trim(), start: first.toISOString(), end: last.toISOString(), allDay: allDay.value, category: category.value, color: color.value, ...(location.value.trim() ? { location: location.value.trim() } : {}), ...(notes.value.trim() ? { notes: notes.value.trim() } : {}) }
  await api.suite.save({ events: [...props.data.suite.events.filter(event => event.id !== item.id), item] })
  selected.value = dateKey(first); month.value = selected.value.slice(0, 7)
  dismissPopup(); title.value = ''
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
      <button type="button" class="calendar-icon-button calendar-add" aria-label="添加日程" title="添加日程" :disabled="busy" @click="beginCreate"><AssistantIcon name="plus"/></button>
    </div>
    <div class="calendar-month-scroll" aria-label="月历事项">
      <div class="calendar-grid" aria-label="选择日期">
        <div class="calendar-weekdays"><small v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">{{ day }}</small></div>
        <div v-for="week in weeks" :key="week.days[0].date" class="calendar-week">
          <div v-for="(day, index) in week.days" :key="day.date" class="calendar-day" role="group" :data-date="day.date" :style="{ gridColumn: index + 1 }" :class="{ 'is-today': isToday(day.date), 'is-outside': !day.date.startsWith(month), 'is-weekend': index > 4, 'is-selected': day.date === selected }" :aria-label="`${day.date}，${day.events.length} 项日程`" @click="openDay(day.date)">
            <button type="button" class="calendar-date-number" :aria-label="day.date" :aria-pressed="day.date === selected" :aria-current="isToday(day.date) ? 'date' : undefined" @click.stop="openDay(day.date)">{{ Number(day.date.slice(-2)) }}</button>
            <button v-if="day.remaining" type="button" class="calendar-more-events" :aria-label="`查看 ${day.date} 全部 ${day.events.length} 项日程`" @click.stop="openDay(day.date)">+{{ day.remaining }}</button>
          </div>
          <button v-for="segment in week.segments" :key="segment.event.id" type="button" class="calendar-month-event" :class="{ 'continues-before': segment.continuesBefore, 'continues-after': segment.continuesAfter }" :data-event-id="segment.event.id" :data-start-date="week.days[segment.start].date" :data-end-date="week.days[segment.end - 1].date" :style="{ '--event-color': eventColor(segment.event), gridColumn: `${segment.start + 1} / ${segment.end + 1}`, gridRow: segment.lane + 2 }" :aria-label="`查看日程 ${segment.event.title}`" :title="segment.event.title" @click="openEvent(segment.event, week.days[segment.start].date)">{{ segment.event.title }}</button>
        </div>
      </div>
    </div>

    <dialog ref="calendarDialog" class="calendar-dialog" aria-labelledby="calendar-popup-title" @cancel.prevent="closeEditor">
      <template v-if="popupOpen && !editorOpen && !detailEvent">
        <div class="calendar-editor-heading"><div><h3 id="calendar-popup-title" ref="popupHeading" tabindex="-1">{{ selectedTitle }}</h3><small>{{ isToday(selected) ? '今天 · ' : '' }}{{ selectedEvents.length }} 项日程</small></div><button type="button" class="calendar-icon-button" aria-label="关闭当天日程" :disabled="busy" @click="closeEditor"><AssistantIcon name="close"/></button></div>
        <div v-if="selectedEvents.length" class="calendar-agenda" aria-label="当天事项">
      <article v-for="event in selectedEvents" :key="event.id" class="calendar-event" :style="{ '--event-color': eventColor(event) }">
        <time :datetime="event.start">{{ eventTime(event) }}</time>
        <span class="calendar-event-dot" aria-hidden="true"/>
        <button type="button" class="calendar-event-copy" :aria-label="`查看日程 ${event.title}`" :disabled="busy" @click="openEvent(event, selected)"><b>{{ event.title }}</b><small>{{ event.source }}<template v-if="!event.allDay"> · 至 {{ new Date(event.end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }}</template></small></button>
        <div v-if="data.suite.events.some(item => item.id === event.id)" class="calendar-event-actions">
          <button type="button" class="calendar-icon-button" :aria-label="`编辑日程 ${event.title}`" title="编辑日程" :disabled="busy" @click="edit(event)"><AssistantIcon name="edit"/></button>
          <button type="button" class="calendar-icon-button" :aria-label="`删除日程 ${event.title}`" title="删除日程" :disabled="busy" @click="perform(() => removeEvent(event))"><AssistantIcon name="recycle"/></button>
        </div>
      </article>
    </div>
        <p v-else class="calendar-empty">这一天还没有安排，给自己留一点空白。</p>
        <div class="calendar-editor-actions"><button type="button" class="calendar-add" :disabled="busy" @click="beginCreate"><AssistantIcon name="plus"/>新建日程</button></div>
      </template>

      <section v-if="detailEvent && !editorOpen" class="calendar-event-detail" :style="{ '--event-color': eventColor(detailEvent) }" aria-label="日程详情">
        <div class="calendar-detail-heading"><span class="calendar-detail-dot" aria-hidden="true"/><div><h3 id="calendar-popup-title" ref="popupHeading" tabindex="-1">{{ detailEvent.title }}</h3><small>{{ detailEvent.source }}{{ detailIsLocal ? '' : ' · 只读日历' }}</small></div><button type="button" class="calendar-icon-button" aria-label="关闭日程详情" :disabled="busy" @click="closeEditor"><AssistantIcon name="close"/></button></div>
        <dl class="calendar-detail-times"><div><dt>开始{{ detailEvent.allDay ? '日期' : '时间' }}</dt><dd><time :datetime="detailEvent.start">{{ detailTime(detailEvent, 'start') }}</time></dd></div><div><dt>结束{{ detailEvent.allDay ? '日期' : '时间' }}</dt><dd><time :datetime="detailEvent.end">{{ detailTime(detailEvent, 'end') }}</time></dd></div></dl>
        <p v-if="detailEvent.allDay" class="calendar-detail-hint">全天 · 包含结束日期当天</p>
        <div v-if="detailEvent.location" class="calendar-detail-section"><h4>地点</h4><p>{{ detailEvent.location }}</p></div>
        <div v-if="detailEvent.notes" class="calendar-detail-section"><h4>备注</h4><p>{{ detailEvent.notes }}</p></div>
        <div v-if="detailIsLocal" class="calendar-detail-actions"><button type="button" :aria-label="`删除日程 ${detailEvent.title}`" :disabled="busy" @click="perform(() => removeEvent(detailEvent!))"><AssistantIcon name="recycle"/>删除</button><button type="button" class="calendar-save" :aria-label="`编辑日程 ${detailEvent.title}`" :disabled="busy" @click="edit(detailEvent)"><AssistantIcon name="edit"/>编辑日程</button></div>
      </section>

    <section v-if="editorOpen" class="calendar-editor" aria-label="日程编辑">
      <div class="calendar-editor-heading"><h3 id="calendar-popup-title">{{ editingId ? '编辑日程' : '新建日程' }}</h3><button type="button" class="calendar-icon-button" aria-label="取消日程编辑" :disabled="busy" @click="closeEditor"><AssistantIcon name="close"/></button></div>
      <form class="calendar-event-form" @submit.prevent="perform(save)">
        <label>事项<input ref="titleInput" v-model="title" required maxlength="120" placeholder="要做什么？" aria-label="日程名称" :disabled="busy"/></label>
        <div class="calendar-event-options"><label>类别<select v-model="category" aria-label="日程类别" :disabled="busy"><option value="personal">个人</option><option value="work">工作</option></select></label><label class="calendar-all-day"><input v-model="allDay" type="checkbox" :disabled="busy"/>全天</label></div>
        <template v-if="allDay"><label>开始<input v-model="eventDate" type="date" required aria-label="日程日期" :disabled="busy"/></label><label>结束<input v-model="eventEndDate" type="date" required :min="eventDate" aria-label="日程结束日期" :disabled="busy"/></label><p class="calendar-detail-hint">全天日程包含结束日期当天</p></template>
        <template v-else><label>开始<input v-model="start" type="datetime-local" required aria-label="日程开始时间" :disabled="busy"/></label><label>结束<input v-model="end" type="datetime-local" required aria-label="日程结束时间" :disabled="busy"/></label></template>
        <fieldset class="calendar-colors"><legend>颜色</legend><button v-for="(value, index) in calendarEventColors" :key="value" type="button" :style="{ '--event-color': value }" :aria-label="`日程颜色：${colorNames[index]}`" :aria-pressed="color === value" :disabled="busy" @click="color = value"><AssistantIcon v-if="color === value" name="check"/></button></fieldset>
        <label>地点<input v-model="location" maxlength="300" placeholder="选填" aria-label="日程地点" :disabled="busy"/></label>
        <label>备注<textarea v-model="notes" rows="3" maxlength="4000" placeholder="记下要准备的内容…" aria-label="日程备注" :disabled="busy"/></label>
        <div class="calendar-editor-actions"><button type="button" :disabled="busy" @click="closeEditor">取消</button><button type="submit" class="calendar-save" :disabled="busy">{{ busy ? '保存中…' : '保存日程' }}</button></div>
      </form>
    </section>
      <p v-if="error" class="calendar-error" role="alert">{{ error }}</p><p v-if="busy" class="hint" role="status">正在处理…</p>
    </dialog>
    <p v-if="error && !popupOpen" class="calendar-error" role="alert">{{ error }}</p><p v-if="busy && !popupOpen" class="hint" role="status">正在处理…</p>

    <details class="calendar-sources"><summary>日历来源与订阅</summary><button :disabled="busy" @click="perform(() => api.suite.importCalendar())">导入 ICS 文件</button>
      <form class="calendar-source-form" @submit.prevent="perform(async () => { await api.suite.subscribeCalendar(sourceName, sourceUrl); sourceName = ''; sourceUrl = '' })"><label>名称<input v-model="sourceName" required maxlength="120" placeholder="工作 / 个人日历" aria-label="订阅名称"/></label><label>地址<input v-model="sourceUrl" type="url" required placeholder="HTTPS 订阅地址" aria-label="日历订阅地址"/></label><button :disabled="busy">订阅</button></form>
      <div v-for="source in data.suite.sources" :key="source.id" class="entry"><label><input type="checkbox" :checked="source.enabled" @change="perform(() => api.suite.save({ sources: data.suite.sources.map(item => item.id === source.id ? { ...item, enabled: !item.enabled } : item) }))"/>{{ source.name }}</label><small>{{ source.updatedAt ? new Date(source.updatedAt).toLocaleString('zh-CN') : '尚未刷新' }}</small><div class="row"><button v-if="source.url" :disabled="busy" @click="perform(() => api.suite.refreshCalendar(source.id))">刷新</button><button :disabled="busy" @click="perform(() => api.suite.save({ sources: data.suite.sources.filter(item => item.id !== source.id) }))">移除来源</button></div></div>
      <p class="hint">订阅只读展示，每 30 分钟检查更新；导入文件变化后需重新导入。</p>
    </details>
  </section>
</template>

<style scoped>
.calendar-card{min-width:0}
.calendar-dialog{box-sizing:border-box;position:fixed;inset:auto 0 0;width:calc(100vw - 24px);max-width:480px;max-height:calc(100vh - 32px);margin:0 auto 12px;padding:18px;overflow:auto;border:1px solid #9db9a84d;border-radius:18px;background:#24302b;color:#e4eee7;box-shadow:0 18px 60px #0008}
.calendar-dialog::backdrop{background:#07110c99}
.calendar-card input,.calendar-card select,.calendar-card textarea,.calendar-card button{box-sizing:border-box}
.calendar-card svg{width:16px;height:16px;flex-shrink:0}
.calendar-monthbar{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.calendar-monthbar input{min-width:0;width:0;font-size:14px;font-weight:600;background:transparent;border-color:transparent;padding-left:2px}
.calendar-card .calendar-icon-button{display:grid;place-items:center;width:28px;min-height:28px;height:28px;flex:0 0 28px;padding:0;border:0;background:transparent;border-radius:8px}
.calendar-card .calendar-today{min-height:28px;padding:3px 9px;font-size:11px;background:transparent}
.calendar-month-scroll{min-width:0;border:1px solid var(--widget-line,#ffffff24);border-radius:8px;overflow:hidden}
.calendar-grid{min-width:0;font-variant-numeric:tabular-nums}
.calendar-weekdays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));height:24px;align-items:center;text-align:center;background:#ffffff04}
.calendar-weekdays small{font-size:10px;color:#bdcbc3}
.calendar-weekdays small:nth-last-child(-n+2){color:#a6c9b5}
.calendar-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:22px 14px 14px 12px;min-width:0;border-top:1px solid var(--widget-line,#ffffff18)}
.calendar-day{display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;grid-row:1 / 5;min-width:0;padding:2px;border-right:1px solid var(--widget-line,#ffffff12);cursor:pointer}
.calendar-day:nth-child(7){border-right:0}
.calendar-day:hover{background:#a4dbb60a}
.calendar-day.is-selected{background:#a4dbb612}
.calendar-day.is-weekend{background:#00000012}
.calendar-day.is-weekend.is-selected{background:#a4dbb612}
.calendar-card .calendar-date-number{display:grid;place-items:center;flex:0 0 18px;width:20px;height:18px;min-height:18px;padding:0;border:0;background:transparent;border-radius:5px;font-size:11px;line-height:18px;color:#e4eee7}
.calendar-day.is-outside .calendar-date-number{opacity:.4}
.calendar-day.is-today .calendar-date-number{box-shadow:inset 0 0 0 1px #a4dbb65c;color:#c7f0d8}
.calendar-day.is-selected .calendar-date-number{background:#b8e1ca;color:#172d21;font-weight:600}
.calendar-card .calendar-month-event{z-index:1;display:block;align-self:center;min-width:0;max-width:100%;height:13px;min-height:13px;margin:0 1px;padding:0 3px;border:1px solid color-mix(in srgb,var(--event-color) 65%,transparent);border-left:3px solid var(--event-color);border-radius:2px;background:color-mix(in srgb,var(--event-color) 20%,#1b2423);color:#eef6f1;text-align:left;font-size:9px;line-height:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.calendar-card .calendar-month-event:hover{background:color-mix(in srgb,var(--event-color) 35%,#1b2423)}
.calendar-card .calendar-month-event.continues-before{border-left-width:0;border-top-left-radius:0;border-bottom-left-radius:0}
.calendar-card .calendar-month-event.continues-after{border-right-width:0;border-top-right-radius:0;border-bottom-right-radius:0}
.calendar-card .calendar-more-events{height:10px;min-height:10px;padding:0 1px;border:0;background:transparent;text-align:left;font-size:8px;line-height:10px;color:#c5d3cb}
.calendar-dialog h3{margin:0;font-size:14px;font-weight:600;line-height:1.5}
.calendar-dialog h3:focus{outline:none}
.calendar-dialog small{font-size:10px}
.calendar-card .calendar-add{display:flex;align-items:center;gap:3px;padding:3px 8px;min-height:28px;background:#a4dbb61c;border-color:#a4dbb63d;font-size:11px}
.calendar-empty{margin:16px 0 20px;font-size:12px;line-height:1.6;color:#bdcbc3}
.calendar-agenda{display:grid;gap:4px;padding:8px 0 4px}
.calendar-event{display:grid;grid-template-columns:38px 5px minmax(0,1fr) auto;align-items:start;gap:8px;padding:10px 5px;border-radius:9px;background:color-mix(in srgb,var(--event-color) 7%,transparent)}
.calendar-event time{font-size:10px;line-height:19px;color:#d4e0d9;font-variant-numeric:tabular-nums}
.calendar-event-dot{width:5px;height:5px;border-radius:50%;margin-top:7px;background:var(--event-color)}
.calendar-card .calendar-event-copy{display:grid;gap:3px;min-width:0;padding:0;border:0;background:transparent;text-align:left;color:inherit}
.calendar-event-copy:disabled{opacity:1;cursor:default}
.calendar-event-copy b{font-size:12px;line-height:19px;font-weight:500;overflow-wrap:anywhere}
.calendar-event-copy small{font-size:10px;line-height:1.5}
.calendar-event-actions{display:flex;gap:1px}
.calendar-event-actions .calendar-icon-button{width:23px;height:26px;min-height:26px;flex-basis:23px;color:#bfcec5}
.calendar-event-actions svg{width:13px;height:13px}
.calendar-editor{min-width:0}
.calendar-editor-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.calendar-card .calendar-event-form,.calendar-card .calendar-source-form{display:flex;flex-direction:column;align-items:stretch;gap:10px;margin:0}
.calendar-event-form>label,.calendar-source-form>label{display:grid;align-items:center;grid-template-columns:32px minmax(0,1fr);gap:8px;font-size:11px}
.calendar-event-form input,.calendar-event-form select,.calendar-event-form textarea,.calendar-source-form input{width:100%;min-width:0;max-width:100%;font-size:12px}
.calendar-event-options{display:flex;align-items:center;gap:12px}
.calendar-event-options>label:first-child{display:grid;grid-template-columns:32px minmax(0,1fr);gap:8px;min-width:0;flex:1;font-size:11px}
.calendar-event-options select{min-width:0}
.calendar-all-day{flex:0 0 auto;font-size:11px;white-space:nowrap}
.calendar-event-form .calendar-all-day input{width:14px;height:14px;min-height:14px;max-width:14px;flex:0 0 14px;margin:0;padding:0}
.calendar-colors{display:flex;align-items:center;gap:7px;min-width:0;padding:0;border:0;margin:0}
.calendar-colors legend{float:left;font-size:11px;margin-right:6px;padding-top:5px}
.calendar-colors button{display:grid;place-items:center;width:24px;height:24px;min-height:24px;padding:3px;border:2px solid transparent;border-radius:50%;background:var(--event-color);color:#14251c}
.calendar-colors button[aria-pressed=true]{background:var(--event-color);border-color:#f4f7f6;color:#14251c}
.calendar-colors svg{width:14px;height:14px}
.calendar-editor-actions{display:flex;justify-content:flex-end;gap:6px;padding-top:2px}
.calendar-editor-actions button{font-size:11px;min-height:30px;padding:4px 12px}
.calendar-editor-actions .calendar-save{background:#b8e1ca;border-color:#b8e1ca;color:#172d21}
.calendar-event-form textarea{box-sizing:border-box;resize:vertical;min-height:62px;max-height:160px;padding:7px 9px;border:1px solid var(--widget-line,#ffffff24);border-radius:8px;background:#18231e;color:inherit;font:inherit;line-height:1.6}
.calendar-detail-heading{display:flex;align-items:flex-start;gap:10px;margin-bottom:18px}
.calendar-detail-heading>div{flex:1;min-width:0}
.calendar-detail-heading h3{font-size:18px;line-height:1.5;overflow-wrap:anywhere}
.calendar-detail-heading small{display:block;margin-top:5px;color:#b7c9bd;font-size:11px}
.calendar-detail-dot{flex:0 0 10px;width:10px;height:10px;margin-top:8px;border-radius:50%;background:var(--event-color)}
.calendar-detail-times{display:grid;gap:8px;margin:0}
.calendar-detail-times>div{display:grid;grid-template-columns:56px minmax(0,1fr);gap:10px;font-size:12px;line-height:1.6}
.calendar-detail-times dt{color:#b7c9bd}
.calendar-detail-times dd{min-width:0;margin:0;overflow-wrap:anywhere}
.calendar-detail-hint{margin:3px 0 0;font-size:10px;color:#b7c9bd;line-height:1.5}
.calendar-detail-section{margin-top:16px;padding-top:14px;border-top:1px solid var(--widget-line,#ffffff18)}
.calendar-detail-section h4{margin:0 0 5px;font-size:11px;font-weight:400;color:#b7c9bd}
.calendar-detail-section p{margin:0;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.calendar-detail-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:20px;padding-top:14px;border-top:1px solid var(--widget-line,#ffffff18)}
.calendar-detail-actions button{display:flex;align-items:center;gap:5px;padding:7px 11px;font-size:12px}
.calendar-detail-actions .calendar-save{background:#b8e1ca;color:#172d21;border-color:#b8e1ca}
.calendar-error{margin:10px 0 0}
.calendar-sources{padding-top:14px;margin-top:14px;border-top:1px solid var(--widget-line,#ffffff24)}
.calendar-sources>summary{cursor:pointer;font-size:11px;color:#c5d3cb;margin-bottom:10px}
.calendar-source-form{padding-top:12px}
.calendar-sources .entry small{display:block;margin:5px 0 8px}
@media(max-width:320px){.calendar-event{grid-template-columns:34px 4px minmax(0,1fr) auto;gap:6px}
.calendar-dialog{padding:12px}
.calendar-colors{gap:5px}
.calendar-colors button{width:22px;height:22px;min-height:22px}
.calendar-event-form>label{grid-template-columns:28px minmax(0,1fr)}
}

</style>
