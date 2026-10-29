<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { AppData, AppSettings } from '../../main/types'
import { defaultHydrationPlan, validateHydrationPlan, hydrationDayAt, type HydrationPlan } from '../../main/hydration-plan'
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
const sedentaryIntervals = [30, 45, 60, 90]
const customSedentary = ref(false)
const showCustomSedentary = computed(() => customSedentary.value || !sedentaryIntervals.includes(props.data.settings.sedentaryIntervalMinutes))
const saveQueue = createSaveQueue()
let planRevision = 0
let settingRevision = 0

watch(() => props.data.settings.hydrationPlan, plan => {
  if (dirty.value) return
  Object.assign(draft, plan, { times: undefined })
}, { immediate: true })

const today = computed(() => hydrationDayAt(props.data.hydrationDay, Date.now()).consumedMl)
const summaryPlan = computed(() => props.data.settings.hydrationPlan)
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
    plan = validateHydrationPlan({ ...draft, times: undefined })
  } catch (error) {
    planMessage.value = error instanceof Error ? error.message : '请检查喝水计划。'
    planFailed.value = true
    planSaving.value = false
    reportStatus()
    return
  }
  reportStatus()
  try {
    await saveQueue(() => toolbox.settings.update({ hydrationPlan: plan }))
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
  Object.assign(draft, patch, { times: undefined })
  void savePlan()
}

function setNumber(key: 'goalMl' | 'cupMl', event: Event) {
  setPlan({ [key]: Number((event.target as HTMLInputElement).value) })
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
  void saveSettings({ sedentaryIntervalMinutes: minutes })
}

function setInterval(key: 'hydrationIntervalMinutes' | 'sedentaryIntervalMinutes', event: Event) {
  void saveSettings({ [key]: Number((event.target as HTMLInputElement).value) })
}

async function resetToday() {
  if (!confirm('重置今日饮水记录？已喝水量将清零，水瓶会补满；目标、水杯容量和提醒时段保持不变。')) return
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
    <div class="hydration-summary" aria-label="今日饮水">
      <div class="summary-values"><span>今日饮水</span><strong>{{ today }} <span>/ {{ summaryPlan.goalMl }} ml</span></strong><span>{{ progress }}%</span></div>
      <progress :value="progress" max="100" aria-label="今日饮水目标完成度"/>
    </div>

    <section class="health-settings-section hydration-settings" aria-labelledby="hydration-settings-heading">
      <div class="health-setting-heading">
        <h3 id="hydration-settings-heading">饮水计划</h3>
        <div class="health-switch"><span>{{ data.settings.hydrationReminderEnabled ? '通知开启' : '通知关闭' }}</span><button class="settings-switch" role="switch" aria-label="喝水通知" :aria-checked="data.settings.hydrationReminderEnabled" :disabled="settingsSaving" @click="saveSettings({ hydrationReminderEnabled: !data.settings.hydrationReminderEnabled })"/></div>
      </div>
      <div class="health-field-grid hydration-common-fields">
        <div class="settings-field">
          <label for="hydration-goal">每日目标 <span>ml</span></label>
          <input id="hydration-goal" :value="draft.goalMl" type="number" list="hydration-goal-options" min="500" max="5000" step="100" aria-describedby="hydration-recording-hint" @change="setNumber('goalMl', $event)" @keydown.enter.prevent="blur"/>
          <datalist id="hydration-goal-options" aria-label="每日目标快捷选择"><option v-for="ml in [1000, 2000, 3000]" :key="ml" :value="ml" :label="`${ml / 1000} L`"/></datalist>
        </div>
        <div class="settings-field">
          <label for="hydration-cup">水杯容量 <span>ml</span></label>
          <input id="hydration-cup" :value="draft.cupMl" type="number" list="hydration-cup-options" min="50" max="1000" aria-describedby="hydration-recording-hint" @change="setNumber('cupMl', $event)" @keydown.enter.prevent="blur"/>
          <datalist id="hydration-cup-options" aria-label="水杯容量快捷选择"><option v-for="ml in [200, 250, 300, 500]" :key="ml" :value="ml" :label="`${ml} ml`"/></datalist>
        </div>
      </div>
      <p id="hydration-recording-hint" class="settings-hint">水杯随计时蓄水，点击按杯中当前毫升数记录。</p>
      <div class="settings-segments drinking-modes" aria-label="喝水方式">
        <button :aria-pressed="draft.enabled" @click="setPlan({ enabled: true })">每日计划</button>
        <button :aria-pressed="!draft.enabled" @click="setPlan({ enabled: false })">固定间隔</button>
      </div>
      <template v-if="draft.enabled">
        <div class="health-field-grid">
          <div class="settings-field"><label for="hydration-start">开始时间</label><input id="hydration-start" :value="draft.start" type="time" @change="setPlan({ start: ($event.target as HTMLInputElement).value })" @keydown.enter.prevent="blur"/></div>
          <div class="settings-field"><label for="hydration-end">结束时间</label><input id="hydration-end" :value="draft.end" type="time" @change="setPlan({ end: ($event.target as HTMLInputElement).value })" @keydown.enter.prevent="blur"/></div>
        </div>
        <p class="settings-hint redistribute-hint">每次记录后，按剩余水量与剩余时段自动均分提醒。</p>
      </template>
      <template v-else>
        <div class="health-presets" aria-label="喝水间隔快捷选择"><button v-for="minutes in [15, 30, 45, 60]" :key="minutes" :aria-pressed="data.settings.hydrationIntervalMinutes === minutes" :disabled="settingsSaving" @click="saveSettings({ hydrationIntervalMinutes: minutes })">{{ minutes }} 分钟</button></div>
        <label class="settings-row interval-field">自定义间隔 <span><input :value="data.settings.hydrationIntervalMinutes" type="number" min="5" max="240" aria-label="喝水间隔分钟" :disabled="settingsSaving" @change="setInterval('hydrationIntervalMinutes', $event)" @keydown.enter.prevent="blur"/> 分钟</span></label>
      </template>
    </section>

    <section class="health-settings-section sedentary-settings" aria-labelledby="sedentary-settings-heading">
      <div class="health-setting-heading">
        <h3 id="sedentary-settings-heading">久坐提醒</h3>
        <div class="health-switch"><span>{{ data.settings.sedentaryReminderEnabled ? '通知开启' : '通知关闭' }}</span><button class="settings-switch" role="switch" aria-label="久坐提醒" :aria-checked="data.settings.sedentaryReminderEnabled" :disabled="settingsSaving" @click="saveSettings({ sedentaryReminderEnabled: !data.settings.sedentaryReminderEnabled })"/></div>
      </div>
      <div class="health-presets" aria-label="久坐间隔快捷选择"><button v-for="minutes in sedentaryIntervals" :key="minutes" :aria-pressed="!showCustomSedentary && data.settings.sedentaryIntervalMinutes === minutes" :disabled="settingsSaving" @click="selectSedentaryInterval(minutes)">{{ minutes }} 分钟</button><button :aria-pressed="showCustomSedentary" :aria-expanded="showCustomSedentary" aria-controls="sedentary-custom-field" :disabled="settingsSaving" @click="customSedentary = true">自定义</button></div>
      <label v-if="showCustomSedentary" id="sedentary-custom-field" class="settings-row interval-field">自定义间隔 <span><input :value="data.settings.sedentaryIntervalMinutes" type="number" min="15" max="240" aria-label="久坐间隔分钟" :disabled="settingsSaving" @change="setInterval('sedentaryIntervalMinutes', $event)" @keydown.enter.prevent="blur"/> 分钟</span></label>
    </section>

    <section class="health-settings-section sound-settings" aria-labelledby="health-sound-heading">
      <div class="health-setting-heading">
        <div><h3 id="health-sound-heading">提醒声音</h3><p class="settings-hint">仅控制通知声音。</p></div>
        <div class="health-switch"><span>{{ data.settings.healthSoundEnabled ? '已开启' : '已关闭' }}</span><button class="settings-switch" role="switch" aria-label="提醒声音" :aria-checked="data.settings.healthSoundEnabled" :disabled="settingsSaving" @click="saveSettings({ healthSoundEnabled: !data.settings.healthSoundEnabled })"/></div>
      </div>
    </section>

    <div class="health-secondary-actions"><button class="settings-link" :disabled="resetting || dirty" @click="resetToday">{{ resetting ? '正在重置…' : '重置今日饮水记录' }}</button><p class="settings-hint">仅按计时提醒，不检测真实饮水或坐姿。</p></div>
    <p v-if="planFailed" role="alert" class="health-save-error">{{ planMessage }} <button class="settings-link" @click="savePlan">重试保存计划</button></p>
    <p v-if="failedSetting" role="alert" class="health-save-error">{{ settingMessage }} <button class="settings-link" @click="saveSettings(failedSetting!)">重试保存设置</button></p>
    <p v-if="resetMessage" :role="resetFailed ? 'alert' : 'status'" class="health-reset-message">{{ resetMessage }} <button v-if="resetFailed" class="settings-link" :disabled="resetting || dirty" @click="resetToday">重试重置</button></p>
  </section>
</template>
