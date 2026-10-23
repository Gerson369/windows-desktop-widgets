<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { AppData, AppSettings } from '../../main/types'
import { defaultHydrationPlan, validateHydrationPlan, hydrationDayAt, hydrationTimes, type HydrationPlan } from '../../main/hydration-plan'
import { toolbox } from '../toolbox'
import { createSaveQueue } from '../save-queue'

const props = defineProps<{ data: AppData }>()
const emit = defineEmits<{ status: [message: string] }>()
const draft = reactive({ ...defaultHydrationPlan })
const dirty = ref(false)
const planMessage = ref('')
const planFailed = ref(false)
const planSaving = ref(false)
const settingMessage = ref('')
const failedSetting = ref<Partial<AppSettings> | null>(null)
const settingsSaving = ref(false)
const resetting = ref(false)
const resetMessage = ref('')
const resetFailed = ref(false)
const editingTimes = ref(false)
const customSchedule = ref(false)
const sedentaryIntervals = [30, 45, 60, 90]
const customSedentary = ref(false)
const showCustomSedentary = computed(() => customSedentary.value || !sedentaryIntervals.includes(props.data.settings.sedentaryIntervalMinutes))
const editorHeading = ref<HTMLElement | null>(null)
const editButton = ref<HTMLButtonElement | null>(null)
const saveQueue = createSaveQueue()
let planRevision = 0
let settingRevision = 0

watch(() => props.data.settings.hydrationPlan, plan => {
  if (dirty.value) return
  Object.assign(draft, plan)
  customSchedule.value = JSON.stringify(hydrationTimes(plan)) !== JSON.stringify(hydrationTimes({ ...plan, times: undefined }))
}, { immediate: true })

const times = computed(() => hydrationTimes(draft))
const today = computed(() => hydrationDayAt(props.data.hydrationDay, Date.now()).consumedMl)
const summaryPlan = computed(() => props.data.settings.hydrationPlan)
const totalCups = computed(() => Math.ceil(summaryPlan.value.goalMl / summaryPlan.value.cupMl))
const recordedCups = computed(() => Math.min(totalCups.value, Math.ceil(today.value / summaryPlan.value.cupMl)))
const progress = computed(() => Math.min(100, Math.round(today.value / summaryPlan.value.goalMl * 100)))

function reportStatus() {
  const error = planFailed.value ? planMessage.value : failedSetting.value ? settingMessage.value : resetFailed.value ? resetMessage.value : ''
  emit('status', error ? `保存失败：${error}` : planSaving.value || settingsSaving.value || resetting.value ? '正在保存…' : '已保存')
}

async function savePlan() {
  const current = ++planRevision
  dirty.value = true
  planFailed.value = false
  planSaving.value = true
  let plan: HydrationPlan
  try {
    plan = validateHydrationPlan({ ...draft, times: draft.times ? [...draft.times] : undefined })
  } catch (error) {
    planMessage.value = error instanceof Error ? error.message : '请检查喝水计划。'
    planFailed.value = true
    planSaving.value = false
    reportStatus()
    return
  }
  reportStatus()
  try {
    await saveQueue(() => toolbox.settings.update({
      hydrationPlan: plan,
      ...(plan.enabled && !props.data.settings.hydrationPlan.enabled ? { hydrationReminderEnabled: true } : {})
    }))
    if (current === planRevision) {
      dirty.value = false
      planMessage.value = ''
    }
  } catch (error) {
    if (current === planRevision) {
      planMessage.value = error instanceof Error ? error.message : '喝水计划未保存，请重试。'
      planFailed.value = true
    }
  } finally {
    if (current === planRevision) planSaving.value = false
    reportStatus()
  }
}

function setPlan(patch: Partial<HydrationPlan>) {
  Object.assign(draft, patch)
  if (['goalMl', 'cupMl', 'start', 'end', 'times'].some(key => key in patch)) {
    draft.times = undefined
    customSchedule.value = false
  }
  void savePlan()
}

function setNumber(key: 'goalMl' | 'cupMl', event: Event) {
  setPlan({ [key]: Number((event.target as HTMLInputElement).value) })
}

function setTime(index: number, event: Event) {
  customSchedule.value = true
  const updated = [...times.value]
  updated[index] = (event.target as HTMLInputElement).value
  draft.times = updated
  void savePlan()
}

async function saveSettings(patch: Partial<AppSettings>) {
  const current = ++settingRevision
  failedSetting.value = null
  settingMessage.value = ''
  settingsSaving.value = true
  reportStatus()
  try {
    for (const [key, minimum] of [['hydrationIntervalMinutes', 5], ['sedentaryIntervalMinutes', 15]] as const) {
      const value = patch[key]
      if (value !== undefined && (!Number.isInteger(value) || value < minimum || value > 240)) {
        throw new Error(`${key === 'hydrationIntervalMinutes' ? '喝水' : '久坐'}间隔须为 ${minimum}–240 分钟的整数。`)
      }
    }
    await saveQueue(() => toolbox.settings.update(patch))
  } catch (error) {
    if (current === settingRevision) {
      failedSetting.value = patch
      settingMessage.value = error instanceof Error ? error.message : '设置未保存，请重试。'
    }
  } finally {
    if (current === settingRevision) settingsSaving.value = false
    reportStatus()
  }
}

function selectSedentaryInterval(minutes: number) {
  customSedentary.value = false
  void saveSettings({ sedentaryReminderEnabled: true, sedentaryIntervalMinutes: minutes })
}

function setInterval(key: 'hydrationIntervalMinutes' | 'sedentaryIntervalMinutes', event: Event) {
  void saveSettings({ [key]: Number((event.target as HTMLInputElement).value) })
}

async function openTimeEditor() {
  editingTimes.value = true
  await nextTick()
  editorHeading.value?.focus({ preventScroll: true })
  editorHeading.value?.scrollIntoView({ block: 'start' })
}

async function closeTimeEditor() {
  editingTimes.value = false
  await nextTick()
  editButton.value?.focus()
}

async function resetToday() {
  if (!confirm('重置今日饮水记录？已喝水量将清零，水瓶会补满；开始和结束时间保持不变。结束时间后仍不能记录喝水。')) return
  resetting.value = true
  resetMessage.value = ''
  resetFailed.value = false
  reportStatus()
  try {
    await saveQueue(() => toolbox.wellness.resetHydration())
    resetMessage.value = '今日饮水记录已重置，水瓶已补满。'
  } catch (error) {
    resetFailed.value = true
    resetMessage.value = error instanceof Error ? error.message : '重置失败，请重试。'
  } finally {
    resetting.value = false
    reportStatus()
  }
}

function blur(event: KeyboardEvent) {
  (event.target as HTMLInputElement).blur()
}
</script>

<template>
  <section class="health-settings" aria-label="健康提醒设置">
    <template v-if="editingTimes">
      <button class="settings-link editor-back" @click="closeTimeEditor">← 返回健康设置</button>
      <section class="settings-card schedule-editor" aria-label="编辑喝水时间">
        <h3 ref="editorHeading" tabindex="-1">编辑喝水时间</h3>
        <p class="settings-hint">{{ draft.start }}–{{ draft.end }} · 每天 {{ times.length }} 杯。每杯时间按先后排列，至少相隔 5 分钟。</p>
        <div class="settings-segments" aria-label="时间分配方式">
          <button :aria-pressed="!customSchedule" @click="setPlan({ times: undefined })">平均分配</button>
          <button :aria-pressed="customSchedule" @click="customSchedule = true">自定义时间</button>
        </div>
        <div class="cup-time-list" aria-label="每杯喝水时间">
          <label v-for="(time, index) in times" :key="index" class="cup-time-row">
            <span><strong>第 {{ index + 1 }} 杯</strong><small>{{ Math.min(draft.cupMl, Math.max(0, draft.goalMl - index * draft.cupMl)) }} ml</small></span>
            <input :value="time" type="time" :aria-label="`第 ${index + 1} 杯提醒时间`" @change="setTime(index, $event)" @keydown.enter.prevent="blur"/>
          </label>
        </div>
        <p class="settings-hint schedule-rules">点击健康小组件的水杯记录一杯；结束后停止提醒且不能记录，次日重算，不补发错过的提醒。</p>
        <button class="settings-primary" @click="closeTimeEditor">完成</button>
      </section>
    </template>

    <template v-else>
      <section class="settings-card hydration-summary" aria-label="今日饮水">
        <span class="summary-label">今日饮水</span>
        <div class="summary-values">
          <div><strong>{{ today }}</strong><span class="summary-unit">ml</span><span class="summary-goal">/ {{ summaryPlan.goalMl }} ml</span></div>
          <span class="summary-cups">{{ recordedCups }} / {{ totalCups }} 杯</span>
        </div>
        <div class="summary-progress"><progress :value="progress" max="100" aria-label="今日饮水目标完成度"/><span>{{ progress }}%</span></div>
        <p v-if="!draft.enabled" class="settings-hint">当前使用固定间隔提醒；饮水目标保留，切换每日计划后按时段安排。</p>
      </section>

      <section class="settings-card hydration-settings" aria-labelledby="hydration-settings-heading">
        <div class="health-card-heading">
          <svg class="health-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 2C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-13Z"/><path d="M8 15a4 4 0 0 0 4 4"/></svg>
          <div class="health-heading-copy"><h3 id="hydration-settings-heading">饮水计划</h3><p class="settings-hint">关闭通知后，每日计划仍照常运行。</p></div>
          <div class="health-switch"><button class="settings-switch" role="switch" aria-label="喝水通知" :aria-checked="data.settings.hydrationReminderEnabled" :disabled="settingsSaving" @click="saveSettings({ hydrationReminderEnabled: !data.settings.hydrationReminderEnabled })"/><span>{{ data.settings.hydrationReminderEnabled ? '通知已开启' : '通知已关闭' }}</span></div>
        </div>
        <div class="settings-segments drinking-modes" aria-label="喝水方式">
          <button :aria-pressed="draft.enabled" @click="setPlan({ enabled: true })">每日计划</button>
          <button :aria-pressed="!draft.enabled" @click="setPlan({ enabled: false })">固定间隔</button>
        </div>
        <template v-if="draft.enabled">
          <p id="hydration-redistribute-hint" class="settings-hint redistribute-hint">修改目标、杯量或时段，会重新平均分配全部时间。</p>
          <div class="health-field-grid">
            <div class="settings-field">
              <label for="hydration-goal">每日目标 <span>ml</span></label>
              <input id="hydration-goal" :value="draft.goalMl" type="number" list="hydration-goal-options" min="500" max="5000" step="100" aria-describedby="hydration-redistribute-hint" @change="setNumber('goalMl', $event)" @keydown.enter.prevent="blur"/>
              <datalist id="hydration-goal-options" aria-label="每日目标快捷选择"><option v-for="ml in [1000, 2000, 3000]" :key="ml" :value="ml" :label="`${ml / 1000} L`"/></datalist>
            </div>
            <div class="settings-field">
              <label for="hydration-cup">每杯水量 <span>ml</span></label>
              <input id="hydration-cup" :value="draft.cupMl" type="number" list="hydration-cup-options" min="50" max="1000" aria-describedby="hydration-redistribute-hint" @change="setNumber('cupMl', $event)" @keydown.enter.prevent="blur"/>
              <datalist id="hydration-cup-options" aria-label="每杯水量快捷选择"><option v-for="ml in [200, 250, 300, 500]" :key="ml" :value="ml" :label="`${ml} ml`"/></datalist>
            </div>
            <div class="settings-field"><label for="hydration-start">开始时间</label><input id="hydration-start" :value="draft.start" type="time" @change="setPlan({ start: ($event.target as HTMLInputElement).value })" @keydown.enter.prevent="blur"/></div>
            <div class="settings-field"><label for="hydration-end">结束时间</label><input id="hydration-end" :value="draft.end" type="time" @change="setPlan({ end: ($event.target as HTMLInputElement).value })" @keydown.enter.prevent="blur"/></div>
          </div>
          <div class="settings-row schedule-summary"><span>每天 {{ times.length }} 杯 · {{ customSchedule ? '自定义时间' : '平均分配' }}</span><button ref="editButton" class="settings-link" @click="openTimeEditor">编辑时间 <span aria-hidden="true">›</span></button></div>
        </template>
        <template v-else>
          <p class="settings-hint interval-hint">按固定间隔发送通知，点选预设会同时开启通知。</p>
          <div class="health-presets interval-presets" aria-label="喝水间隔快捷选择"><button v-for="minutes in [15, 30, 45, 60]" :key="minutes" :aria-pressed="data.settings.hydrationIntervalMinutes === minutes" :disabled="settingsSaving" @click="saveSettings({ hydrationReminderEnabled: true, hydrationIntervalMinutes: minutes })">{{ minutes }} 分钟</button></div>
          <label class="settings-row interval-field">自定义间隔 <span><input :value="data.settings.hydrationIntervalMinutes" type="number" min="5" max="240" aria-label="喝水间隔分钟" :disabled="settingsSaving" @change="setInterval('hydrationIntervalMinutes', $event)" @keydown.enter.prevent="blur"/> 分钟</span></label>
        </template>
      </section>

      <section class="settings-card sedentary-settings" aria-labelledby="sedentary-settings-heading">
        <div class="health-card-heading">
          <svg class="health-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="4" r="2"/><path d="M9 8v6h6l2 7M13 8v5h5M6 9v8h6v4"/></svg>
          <div class="health-heading-copy"><h3 id="sedentary-settings-heading">久坐提醒</h3><p class="settings-hint">每隔一段时间，提醒你起身活动。</p></div>
          <div class="health-switch"><button class="settings-switch" role="switch" aria-label="久坐提醒" :aria-checked="data.settings.sedentaryReminderEnabled" :disabled="settingsSaving" @click="saveSettings({ sedentaryReminderEnabled: !data.settings.sedentaryReminderEnabled })"/><span>{{ data.settings.sedentaryReminderEnabled ? '通知已开启' : '通知已关闭' }}</span></div>
        </div>
        <div class="health-presets interval-presets" aria-label="久坐间隔快捷选择"><button v-for="minutes in sedentaryIntervals" :key="minutes" :aria-pressed="!showCustomSedentary && data.settings.sedentaryIntervalMinutes === minutes" :disabled="settingsSaving" @click="selectSedentaryInterval(minutes)">{{ minutes }} 分钟</button><button :aria-pressed="showCustomSedentary" :aria-expanded="showCustomSedentary" aria-controls="sedentary-custom-field" :disabled="settingsSaving" @click="customSedentary = true">自定义</button></div>
        <label v-if="showCustomSedentary" id="sedentary-custom-field" class="settings-row interval-field">自定义间隔 <span><input :value="data.settings.sedentaryIntervalMinutes" type="number" min="15" max="240" aria-label="久坐间隔分钟" :disabled="settingsSaving" @change="setInterval('sedentaryIntervalMinutes', $event)" @keydown.enter.prevent="blur"/> 分钟</span></label>
        <p v-else class="settings-hint current-interval">当前间隔：{{ data.settings.sedentaryIntervalMinutes }} 分钟。</p>
      </section>

      <section class="settings-card sound-settings" aria-labelledby="health-sound-heading">
        <div class="health-card-heading">
          <svg class="health-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 4-5 5H2v6h4l5 5V4Z"/><path d="M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/></svg>
          <div class="health-heading-copy"><h3 id="health-sound-heading">提醒声音</h3><p class="settings-hint">关闭后仍显示通知。</p></div>
          <div class="health-switch"><button class="settings-switch" role="switch" aria-label="提醒声音" :aria-checked="data.settings.healthSoundEnabled" :disabled="settingsSaving" @click="saveSettings({ healthSoundEnabled: !data.settings.healthSoundEnabled })"/><span>{{ data.settings.healthSoundEnabled ? '已开启' : '已关闭' }}</span></div>
        </div>
      </section>

      <div class="health-secondary-actions"><button class="settings-link" :disabled="resetting || dirty" @click="resetToday">{{ resetting ? '正在重置…' : '重置今日饮水记录' }}</button><p class="settings-hint">仅按计时提醒，不检测真实饮水或坐姿。</p></div>
    </template>

    <p v-if="planFailed" role="alert" class="health-save-error">{{ planMessage }} <button class="settings-link" @click="savePlan">重试保存计划</button></p>
    <p v-if="failedSetting" role="alert" class="health-save-error">{{ settingMessage }} <button class="settings-link" @click="saveSettings(failedSetting!)">重试保存设置</button></p>
    <p v-if="resetMessage" :role="resetFailed ? 'alert' : 'status'" class="health-reset-message">{{ resetMessage }} <button v-if="resetFailed" class="settings-link" :disabled="resetting || dirty" @click="resetToday">重试重置</button></p>
  </section>
</template>

<style scoped>
.health-settings{display:grid;gap:14px;min-width:0}.health-settings h3{font-size:16px;line-height:1.4;margin:0}.health-card-heading{display:flex;align-items:flex-start;gap:10px}.health-icon{width:24px;height:28px;flex:0 0 auto;color:var(--settings-accent,#a9d9bf)}.health-heading-copy{flex:1;min-width:0}.health-heading-copy .settings-hint{margin:4px 0 0}.health-switch{display:flex;align-items:center;gap:7px;flex:0 0 auto;padding-top:2px}.health-switch>span{font-size:11px;white-space:nowrap;color:var(--settings-muted,#b5bec3)}.summary-label{font-size:13px}.summary-values{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:5px 0 8px}.summary-values>div{min-width:0;display:flex;align-items:baseline;gap:5px}.summary-values strong{font-size:34px;font-weight:650;letter-spacing:-1px;line-height:1.2}.summary-unit{font-size:14px}.summary-goal{font-size:12px;color:var(--settings-muted,#b5bec3);margin-left:4px}.summary-cups{font-size:13px;white-space:nowrap;color:var(--settings-muted,#b5bec3)}.summary-progress{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--settings-muted,#b5bec3)}.summary-progress progress{appearance:none;flex:1;min-width:0;width:100%;height:9px;border:0;border-radius:12px;overflow:hidden;background:#394148}.summary-progress progress::-webkit-progress-bar{background:#394148;border-radius:12px}.summary-progress progress::-webkit-progress-value{background:var(--settings-accent,#a9d9bf);border-radius:12px}.hydration-summary>.settings-hint{margin:10px 0 0}.drinking-modes{margin-top:16px}.redistribute-hint{margin:10px 0 12px;font-size:11px}.health-field-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px 16px}.health-field-grid .settings-field{min-width:0;display:grid;align-content:start;gap:6px}.settings-field label{display:flex;justify-content:space-between;font-size:12px}.settings-field label span{color:var(--settings-muted,#b5bec3);font-size:11px}.health-field-grid input{width:100%;min-width:0;box-sizing:border-box}.health-presets{display:flex;gap:4px;flex-wrap:wrap}.health-presets button{min-width:0;flex:1 1 0;padding:4px 3px;font-size:11px;white-space:nowrap}.health-presets button[aria-pressed=true]{color:var(--settings-accent,#a9d9bf);border-color:#a9d9bf66;background:#a9d9bf14}.schedule-summary{margin-top:16px;padding-top:12px;border-top:1px solid var(--settings-border,#394148);font-size:12px}.schedule-summary .settings-link{white-space:nowrap}.schedule-summary .settings-link span{font-size:20px;line-height:12px;vertical-align:-1px;margin-left:4px}.interval-presets{margin-top:14px;gap:0}.interval-presets button{border-radius:0;padding:8px 3px}.interval-presets button+button{border-left:0}.interval-presets button:first-child{border-radius:7px 0 0 7px}.interval-presets button:last-child{border-radius:0 7px 7px 0}.interval-presets button[aria-pressed=true]{color:#153326;background:var(--settings-accent,#a9d9bf)}.current-interval{margin:10px 0 0}.interval-field{margin-top:10px;font-size:12px}.interval-field>span{display:flex;align-items:center;gap:6px;color:var(--settings-muted,#b5bec3)}.interval-field input{width:70px;box-sizing:border-box;color:var(--settings-text,#f0f3f2)}.interval-hint{margin:12px 0 0}.health-secondary-actions{display:grid;justify-items:start;gap:8px;padding:0 8px}.health-secondary-actions>.settings-link{font-size:12px;text-decoration:underline;text-underline-offset:3px}.health-secondary-actions .settings-hint{margin:0;font-size:11px}.editor-back{justify-self:start}.schedule-editor>h3{scroll-margin-top:12px;outline-offset:4px}.schedule-editor>.settings-hint{margin:8px 0 14px}.cup-time-list{margin-top:12px}.cup-time-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--settings-border,#394148)}.cup-time-row>span{display:flex;align-items:center;gap:10px;font-size:12px}.cup-time-row strong{font-weight:500}.cup-time-row small{font-size:11px;color:var(--settings-muted,#b5bec3)}.cup-time-row input{width:124px;min-width:0}.schedule-rules{margin:14px 0!important}.health-save-error{margin:0;padding:10px 12px;border:1px solid #e8a99f60;border-radius:8px;background:#e8a99f0a;color:#ffd0c6;font-size:12px;line-height:1.6}.health-save-error .settings-link{display:inline;font-size:12px}.health-reset-message{margin:0;font-size:12px;line-height:1.6;color:var(--settings-accent,#a9d9bf)}.health-reset-message[role=alert]{color:#ffd0c6}@media(max-width:390px){.health-card-heading{flex-wrap:wrap;gap:8px}.health-heading-copy{flex-basis:calc(100% - 32px)}.health-switch{margin-left:32px}.sound-settings .health-heading-copy{flex-basis:auto}.sound-settings .health-switch{margin-left:0}.health-field-grid{gap:12px 10px}.summary-values strong{font-size:30px}.summary-goal{font-size:11px;margin-left:0}.summary-cups{font-size:11px}}
</style>
