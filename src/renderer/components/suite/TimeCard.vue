<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, useId } from 'vue'
import { toolbox } from '../../toolbox'
import type { AppData } from '../../../main/types'
import { dateKey, daysUntil, focusRemaining } from '../../../main/widget-suite'
import type { Countdown } from '../../../main/widget-suite'
import { holidayCountdowns, hasVerifiedHolidayDates, holidayCalendarSource, holidayCalendarRange } from '../../../main/holiday-countdowns'
import AssistantIcon from '../AssistantIcon.vue'

const props = defineProps<{ data: AppData; kind: 'clock' | 'countdown' | 'focus' }>()
const api = toolbox
const editingCountdown = ref('')
const countdownMenu = ref<HTMLElement | null>(null), menuDate = ref<Countdown | null>(null)
const countdownTitleInput = ref<HTMLInputElement | null>(null), countdownMenuId = useId()
const menuPosition = ref({ left: '8px', top: '8px' })
const now = ref(Date.now()), zone = ref(''), title = ref(''), date = ref(dateKey(Date.now()))
const minutes = ref(Math.round(props.data.suite.focus.durationSeconds / 60)), error = ref(''), pending = ref(false)
const allHolidays = ref(false)
const today = computed(() => dateKey(now.value))
const dayTimestamp = computed(() => new Date(`${today.value}T12:00:00`).getTime())
const countdowns = computed(() => props.data.suite.countdowns.map(item => ({ ...item, days: daysUntil(item.date, dayTimestamp.value) })))
const holidays = computed(() => holidayCountdowns(today.value).map(item => ({ ...item, days: daysUntil(item.date, dayTimestamp.value) })))
const visibleHolidays = computed(() => allHolidays.value ? holidays.value : holidays.value.slice(0, 6))
const remaining = computed(() => focusRemaining(props.data.suite.focus, now.value))
const display = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`)
let timer: ReturnType<typeof setInterval> | undefined

async function perform(action: () => Promise<unknown>) {
  if (pending.value) return
  pending.value = true
  try { await action(); error.value = '' }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { pending.value = false }
}
async function addZone() {
  await api.suite.save({ timeZones: [...new Set([...props.data.suite.timeZones, zone.value.trim()])] })
  zone.value = ''
}
async function addDate() {
  await api.suite.save({ countdowns: [...props.data.suite.countdowns.filter(item => item.id !== editingCountdown.value), { id: editingCountdown.value || crypto.randomUUID(), title: title.value.trim(), date: date.value }] })
  title.value = ''; editingCountdown.value = ''
}
function prepareDateMenu(item: Countdown, event: MouseEvent) {
  // Let the native toggle reopen the shared popover when switching cards.
  if (menuDate.value?.id !== item.id && countdownMenu.value?.matches(':popover-open')) countdownMenu.value.hidePopover()
  menuDate.value = item
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menuPosition.value = {
    left: `${Math.max(8, Math.min(box.right - 120, innerWidth - 128))}px`,
    top: `${Math.max(8, Math.min(box.bottom + 4, innerHeight - 80))}px`
  }
}
function focusDateMenu(event: Event) {
  if ((event as ToggleEvent).newState === 'open') countdownMenu.value?.querySelector('button')?.focus()
}
async function editDate(item: Countdown) {
  editingCountdown.value = item.id; title.value = item.title; date.value = item.date
  countdownMenu.value?.hidePopover()
  await nextTick(); countdownTitleInput.value?.focus()
}
async function removeDate(item: Countdown) {
  await api.suite.save({ countdowns: props.data.suite.countdowns.filter(date => date.id !== item.id) })
  countdownMenu.value?.hidePopover()
  await nextTick(); countdownTitleInput.value?.focus()
}
function time(timeZone: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now.value) }
function day(timeZone: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'long', day: 'numeric', weekday: 'short' }).format(now.value) }
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section v-if="kind === 'clock'" class="time-panel world-clocks" aria-label="世界时钟">
    <article v-for="item in data.suite.timeZones" :key="item" class="world-clock">
      <div class="time-section-heading"><b>{{ item }}</b><div class="time-actions"><button v-if="item !== data.suite.timeZones[0]" :aria-label="`顶部时区 ${item}`" :disabled="pending" @click="perform(() => api.suite.save({ timeZones: [item, ...data.suite.timeZones.filter(zone => zone !== item)] }))">设为顶部</button><button v-if="data.suite.timeZones.length > 1" class="time-icon-button" :aria-label="`移除时区 ${item}`" :disabled="pending" @click="perform(() => api.suite.save({ timeZones: data.suite.timeZones.filter(zone => zone !== item) }))"><AssistantIcon name="close"/></button></div></div>
      <strong class="world-clock-time">{{ time(item) }}</strong><small>{{ day(item) }}</small>
    </article>
    <form class="time-inline-form" @submit.prevent="perform(addZone)"><input v-model="zone" required maxlength="80" placeholder="如 Europe/London" aria-label="新增时区"/><button class="time-primary" :disabled="pending || !zone.trim()">添加</button></form>
    <p class="time-hint">使用 IANA 时区名称，自动处理夏令时。</p>
  </section>
  <section v-else-if="kind === 'countdown'" class="time-panel countdown-panel" aria-label="倒数日">
    <div class="time-section-heading"><h3>我的日期 <small>{{ countdowns.length }}</small></h3><AssistantIcon name="countdown"/></div>
    <div v-if="countdowns.length" class="countdown-list">
      <article v-for="item in countdowns" :key="item.id" class="countdown-item" :class="{ 'is-today': item.days === 0, 'is-past': item.days < 0 }">
        <b :title="item.title">{{ item.title }}</b>
        <strong class="countdown-days">{{ item.days === 0 ? '今天' : Math.abs(item.days) }}<span v-if="item.days !== 0">{{ item.days > 0 ? '天后' : '天前' }}</span></strong>
        <small>{{ item.date }}</small>
        <button type="button" class="countdown-more time-icon-button" :aria-label="`${item.title}的更多操作`" title="更多操作" :popovertarget="countdownMenuId" :disabled="pending" @click="prepareDateMenu(item, $event)"><AssistantIcon name="more"/></button>
      </article>
    </div>
    <p v-else class="time-empty">记下生日、纪念日或下一次出发的日子。</p>
    <div :id="countdownMenuId" ref="countdownMenu" popover="auto" class="countdown-menu" role="group" aria-label="日期操作" :style="menuPosition" @toggle="focusDateMenu" @keydown.esc.stop>
      <template v-if="menuDate"><button type="button" :aria-label="`编辑日期 ${menuDate.title}`" :disabled="pending" @click="editDate(menuDate)"><AssistantIcon name="edit"/>编辑</button><button type="button" :aria-label="`删除日期 ${menuDate.title}`" :disabled="pending" @click="perform(() => removeDate(menuDate!))"><AssistantIcon name="recycle"/>删除</button></template>
    </div>
    <form class="countdown-form" @submit.prevent="perform(addDate)">
      <input ref="countdownTitleInput" v-model="title" required maxlength="120" aria-label="重要日期名称" placeholder="添加一个重要日子"/>
      <div><input v-model="date" type="date" required aria-label="重要日期"/><button v-if="editingCountdown" class="time-icon-button" type="button" aria-label="取消编辑日期" :disabled="pending" @click="editingCountdown = ''; title = ''"><AssistantIcon name="close"/></button><button class="time-primary" :disabled="pending">{{ editingCountdown ? '保存' : '添加日期' }}</button></div>
    </form>
    <div class="time-section-heading holiday-heading"><h3>即将到来的节日</h3><button v-if="holidays.length > 6" class="time-text-button" :aria-expanded="allHolidays" aria-controls="holiday-grid" @click="allHolidays = !allHolidays">{{ allHolidays ? '收起' : '查看全部节日' }}<AssistantIcon :name="allHolidays ? 'collapse' : 'expand'"/></button></div>
    <div id="holiday-grid" class="holiday-grid">
      <article v-for="item in visibleHolidays" :key="item.id" class="holiday-card" :class="{ 'is-today': item.days === 0 }"><b>{{ item.title }}</b><strong class="countdown-days">{{ item.days === 0 ? '今天' : item.days }}<span v-if="item.days !== 0">天后</span></strong><small>{{ item.date }}</small></article>
    </div>
    <p class="time-hint holiday-source"><span>{{ hasVerifiedHolidayDates(today) ? '节日日期，不含调休安排' : '当前年份暂无农历数据，仅显示公历节日' }}</span><button class="time-text-button" :title="`香港天文台历法数据 ${holidayCalendarRange}`" @click="perform(() => api.system.openExternal(holidayCalendarSource))">历法来源 · {{ holidayCalendarRange }}</button></p>
  </section>
  <section v-else class="time-panel focus-panel" aria-label="专注计时">
    <div class="focus-status"><span :class="{ running: data.suite.focus.endAt }"/>{{ data.suite.focus.endAt ? '正在专注' : remaining ? '准备好，专注一会儿' : '本轮已完成' }}</div>
    <strong class="focus-display" role="timer" aria-live="off">{{ display }}</strong>
    <form class="focus-form" @submit.prevent="perform(() => api.suite.focus('start', Math.round(minutes * 60)))"><label>专注时长<input v-model.number="minutes" type="number" min="1" max="1440" required aria-label="专注分钟"/><span>分钟</span></label><button class="time-primary" :disabled="pending || !!data.suite.focus.endAt"><AssistantIcon name="play"/>开始新一轮</button></form>
    <div class="focus-controls"><button v-if="data.suite.focus.endAt" :disabled="pending" @click="perform(() => api.suite.focus('pause'))"><AssistantIcon name="pause"/>暂停</button><button v-else :disabled="pending" @click="perform(() => api.suite.focus('start'))"><AssistantIcon name="play"/>继续</button><button :disabled="pending" @click="perform(() => api.suite.focus('reset'))"><AssistantIcon name="refresh"/>重置</button></div>
    <p class="time-hint">退出后保留截止时间；锁屏期间继续计时。</p>
  </section>
  <p v-if="error" role="alert">{{ error }}</p>
</template>

<style scoped>
.time-panel{container-type:inline-size;min-width:0;color:var(--widget-text,#f4f7f6)}
.time-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;min-width:0}
.time-section-heading h3{display:flex;align-items:baseline;gap:6px;margin:0;font-size:13px;font-weight:600}
.time-section-heading h3 small{font-size:10px;color:#b7c6bf;font-weight:400}
.time-section-heading>svg{width:17px;height:17px;color:#add9be}
.time-panel button{border-radius:8px}
.time-panel .time-primary{background:#b7ddc5;border-color:#b7ddc5;color:#183c2b;font-size:11px;font-weight:600;padding:7px 12px}
.time-panel .time-primary:hover:not(:disabled){background:#c6ead2}
.time-panel .time-icon-button{display:grid;place-items:center;flex-shrink:0;width:24px;height:24px;padding:4px;border:0;background:transparent;color:#bbcbc3;border-radius:6px}
.time-icon-button svg{width:14px;height:14px}
.time-panel .time-text-button{display:inline-flex;align-items:center;gap:3px;padding:0;border:0;background:transparent;color:#c3d8cc;font-size:10px;line-height:18px;white-space:nowrap}
.time-text-button svg{width:13px;height:13px}
.time-panel .time-hint{margin:8px 0 0;color:#b7c6bf;font-size:10px;line-height:1.6}
.countdown-list,.holiday-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.countdown-item,.holiday-card{position:relative;display:flex;flex-direction:column;gap:2px;min-width:0;padding:5px 6px;border:1px solid #c1dfcc24;border-radius:12px;background:#c1dfcc08}
.countdown-item{min-height:0}
.countdown-item>b,.holiday-card>b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:500;line-height:14px}
.countdown-item>b{padding-right:16px}
.countdown-item>small,.holiday-card>small{font-size:9px;line-height:11px;color:#b7c6bf;font-variant-numeric:tabular-nums}
.countdown-days{display:flex;align-items:baseline;gap:2px;font-size:18px;font-weight:500;line-height:22px;color:#bde4cc;font-variant-numeric:tabular-nums;white-space:nowrap}
.countdown-days span{font-size:9px;font-weight:400;color:#bacdc1}
.time-panel .countdown-more{position:absolute;top:3px;right:3px;width:18px;height:18px;min-height:18px;padding:1px}.countdown-more svg{width:12px;height:12px}
.countdown-menu{position:fixed;inset:auto;margin:0;box-sizing:border-box;width:120px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:4px;border:1px solid #718b78;border-radius:8px;background:#25342c;color:#f4f7f6;font:11px 'Microsoft YaHei UI',sans-serif}
.countdown-menu::backdrop{background:transparent}
.time-panel .countdown-menu button{display:flex;align-items:center;gap:6px;width:100%;min-height:28px;padding:5px 8px;border:0;background:transparent;text-align:left;font:inherit;color:inherit}.countdown-menu svg{width:14px;height:14px}.time-panel .countdown-menu button:hover{background:#ffffff14}
.is-today{border-color:#c4e9d063;background:#b7ddc514}
.is-past .countdown-days{color:#c1cbc5}
.time-empty{margin:0;padding:10px 0 4px;font-size:11px;line-height:1.6;color:#bacbc1}
.suite-content .countdown-form{display:flex;flex-direction:column;align-items:stretch;gap:6px;margin:8px 0 10px}
.countdown-form>div{display:flex;gap:6px;min-width:0}
.countdown-form input{width:100%;min-width:0;padding:7px 9px;font-size:11px;border-radius:8px;background:#15231c70;border-color:#bdd9c629;color-scheme:dark}
.countdown-form input[type=date]{flex:1;width:0}
.holiday-heading{margin-bottom:8px}
.holiday-card{gap:2px}
.holiday-source{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 8px}
.world-clocks{display:grid;gap:10px}
.world-clock{padding:12px;border:1px solid #c1dfcc24;border-radius:12px;background:#c1dfcc08}
.world-clock .time-section-heading{margin-bottom:7px}
.world-clock .time-section-heading>b{font-size:12px;font-weight:500;min-width:0;overflow-wrap:anywhere}
.world-clock-time{display:block;font-size:32px;font-weight:400;line-height:1.25;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.world-clock>small{display:block;font-size:11px;line-height:1.6;color:#b7c6bf}
.time-actions{display:flex;gap:4px;align-items:center;flex-shrink:0}
.time-actions>button{font-size:10px;padding:4px 7px}
.suite-content .time-inline-form{display:flex;flex-wrap:nowrap;margin:4px 0 0;gap:6px}
.time-inline-form input{min-width:0;width:0;font-size:11px;border-radius:8px}
.focus-panel{padding:14px 2px;text-align:center}
.focus-status{display:flex;align-items:center;justify-content:center;gap:7px;color:#c3d4c8;font-size:12px}
.focus-status>span{width:6px;height:6px;background:#829d8c;border-radius:50%}
.focus-status>span.running{background:#b9e5ca}
.focus-display{display:block;margin:16px 0 20px;font-size:clamp(44px,16cqi,70px);font-weight:400;letter-spacing:-.035em;font-variant-numeric:tabular-nums;line-height:1.2;color:#d6f0df}
.suite-content .focus-form{display:flex;flex-direction:column;align-items:stretch;margin:0;gap:12px}
.focus-form>label{display:flex;justify-content:center;gap:8px;font-size:11px;color:#bbcdc1}
.focus-form input{width:64px;padding:5px 8px;text-align:center;border-radius:8px;font-size:12px}
.focus-form .time-primary{display:flex;align-items:center;justify-content:center;gap:6px;min-height:36px}
.focus-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 12px}
.focus-controls>button{display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;min-height:32px}
.focus-panel button svg{width:14px;height:14px}
</style>
