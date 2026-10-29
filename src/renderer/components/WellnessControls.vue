<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { hydrationCupMl, hydrationReminderVisual, reminderVisual, type ReminderKind, type WellnessSnapshot } from '../../main/wellness-reminders'
import type { AppData } from '../../main/types'
import HealthPhysics from './HealthPhysics.vue'
import { healthEffects, spineSegments, waterOverflowEffects } from '../health-effects'
import { hydrationPlanCanRecord, type HydrationRecording } from '../../main/hydration-plan'

const cupSvg = ref<SVGSVGElement | null>(null), spineSvg = ref<SVGSVGElement | null>(null), physicsActive = ref(false), fallingBones = ref<number[]>([])
const props = defineProps<{ data: AppData }>()
const api = toolbox
const snapshot = ref<WellnessSnapshot>({ state: {}, paused: false, now: Date.now() })
const now = ref(Date.now())
const plan = computed(() => snapshot.value.hydrationPlan)
const canRecordWater = computed(() => !plan.value || hydrationPlanCanRecord(plan.value, snapshot.value.state.hydration, snapshot.value.paused ? snapshot.value.now : now.value))
const goalEditor = ref<HTMLFormElement | null>(null)
const goalInput = ref<HTMLInputElement | null>(null)
const goalMl = ref(props.data.settings.hydrationPlan.goalMl)
const goalError = ref('')
const error = ref('')
const feedback = ref('')
const menuFeedback=ref(''),menuFailed=ref(false),menuFeedbackUntil=ref(0)
const pending = ref(false)
const lastDone = ref<ReminderKind | null>(null)
const feedbackUntil = ref(0)
const recentlyDone = (kind: ReminderKind) => lastDone.value === kind && now.value < feedbackUntil.value
let timer: number | undefined
let disposeNavigation: (() => void) | undefined
let disposeState: (() => void) | undefined
let disposeFeedback: (() => void) | undefined
const enabled = (kind: ReminderKind) => kind === 'hydration' ? props.data.settings.hydrationReminderEnabled || props.data.settings.hydrationPlan.enabled : props.data.settings.sedentaryReminderEnabled
const visual = (kind: ReminderKind) => kind === 'hydration' ? hydrationReminderVisual(snapshot.value, snapshot.value.paused ? snapshot.value.now : now.value) : reminderVisual(snapshot.value.state[kind], snapshot.value.paused ? snapshot.value.now : now.value)
const water = computed(() => visual('hydration'))
const currentCupMl = computed(() => hydrationCupMl(props.data.settings.hydrationPlan.cupMl, water.value.progress))
const spine = computed(() => visual('sedentary'))
const waterEffects = computed(() => waterOverflowEffects(water.value.percent, water.value.overdue))
const spineEffects = computed(() => healthEffects(spine.value.percent, spine.value.overdue))
const vertebrae = computed(() => spineSegments(spine.value.progress, spineEffects.value.separation, spineEffects.value.looseness))
const undo = computed(() => snapshot.value.undo && snapshot.value.undo.expiresAt > now.value ? snapshot.value.undo : undefined)
async function undoCompletion() {
  if (!undo.value || pending.value) return
  pending.value = true
  try { snapshot.value = await api.wellness.undo(undo.value.id); lastDone.value = null; feedback.value = '已撤销，恢复原来的记录与计时'; error.value = '' }
  catch (failure) { error.value = failure instanceof Error ? failure.message : '撤销失败' }
  finally { pending.value = false }
}
const label = (kind: ReminderKind): string => {
  if (kind === 'hydration' && plan.value?.status === 'complete') return '今日目标已完成，仍可记录实际喝水量'
  if (kind === 'hydration' && plan.value?.enabled) {
    if (plan.value.status === 'before') return `${plan.value.start} 开始提醒，现在也可记录喝水`
    if (plan.value.status === 'ended') return '今日计划提醒已结束，仍可记录实际喝水量'
    if (!snapshot.value.state.hydration) return '今天没有后续喝水计时'
  }
  if (!enabled(kind)) return kind === 'hydration' ? '通知已关闭，仍可记录喝水' : '尚未开启，点击开始计时'
  if (snapshot.value.paused) return '计时已暂停，解锁或唤醒后继续'
  const state = visual(kind)
  if (state.snoozed) return `${state.minutes} 分钟后再提醒`
  if (state.overdue) return kind === 'hydration' ? '水杯满了，该喝水了' : '坐得有点久，起来活动一下'
  return `${state.minutes || (kind === 'hydration' ? props.data.settings.hydrationIntervalMinutes : props.data.settings.sedentaryIntervalMinutes)} 分钟后提醒`
}
async function context(kind: ReminderKind) {
  try { await api.wellness.menu(kind) } catch(reason) { error.value=String(reason) }
}
async function action(kind: ReminderKind, mode: 'done' | 'snooze' | 'enable', recording?: HydrationRecording) {
  if (pending.value) return false
  pending.value = true
  error.value = ''
  feedback.value = '';menuFeedback.value=''
  try {
    if (mode === 'enable') await api.settings.update(kind === 'hydration' ? { hydrationReminderEnabled: true } : { sedentaryReminderEnabled: true })
    else snapshot.value = await api.wellness.respond(kind, mode, recording)
    if (mode === 'done') { lastDone.value = kind; feedbackUntil.value = Date.now() + 2000; now.value = Date.now() }
    feedback.value = mode === 'done' ? `${kind === 'hydration' ? `已记录 ${recording?.amountMl}ml` : '已活动'}，已更新提醒` : mode === 'snooze' ? '已推迟十分钟' : '已开启提醒'
    return true
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '操作未完成'; return false }
  finally { pending.value = false }
}
async function complete(kind: ReminderKind) {
  if (kind === 'hydration') {
    if (pending.value || !canRecordWater.value || currentCupMl.value < 1) return
    await action('hydration', 'done', { amountMl: currentCupMl.value, recordId: crypto.randomUUID() })
    return
  }
  await action(kind, enabled(kind) ? 'done' : 'enable')
}
async function openGoalEditor() {
  if (pending.value) return
  goalMl.value = props.data.settings.hydrationPlan.goalMl
  goalError.value = ''; error.value = ''
  await nextTick()
  goalEditor.value?.showPopover()
  goalInput.value?.focus()
  goalInput.value?.select()
}
async function saveGoal() {
  if (pending.value) return
  pending.value = true
  goalError.value = ''
  try {
    await api.wellness.setHydrationGoal(Number(goalMl.value))
    snapshot.value = await api.wellness.get()
    feedback.value = `今日总喝水量已设为 ${goalMl.value}ml`
    goalEditor.value?.hidePopover()
  } catch (failure) { goalError.value = failure instanceof Error ? failure.message : '目标未保存，请重试。' }
  finally { pending.value = false }
}
onMounted(async () => {
  disposeFeedback=api.wellness.onFeedback(result=>{error.value='';menuFeedback.value=result.message;menuFailed.value=result.failed;menuFeedbackUntil.value=Date.now()+5000})
  disposeState = api.wellness.onChanged(state => { snapshot.value = state })
  disposeNavigation = api.events.onNavigate(section => {if(section==='wellness:snooze:hydration')void action('hydration','snooze');if(section==='wellness:snooze:sedentary')void action('sedentary','snooze')})
  timer = window.setInterval(() => { now.value = Date.now() }, 1000)
  try { snapshot.value = await api.wellness.get() } catch { error.value = '提醒状态暂不可用' }
})
onBeforeUnmount(() => { disposeFeedback?.();disposeState?.(); if (timer) window.clearInterval(timer); disposeNavigation?.() })
</script>

<template>
  <section class="wellness-controls" :class="{'physics-active':physicsActive}" aria-label="健康互动">
    <HealthPhysics :cup="cupSvg" :spine="spineSvg" :wet="water.overdue" :spill="waterEffects.spill" :flooding="waterEffects.flood" :separation="spineEffects.separation" :paused="snapshot.paused" :bone-color="spineEffects.color || '#c1e4bb'" @enabled="physicsActive=$event" @pieces="fallingBones=$event"/>
    <div v-if="undo" class="health-receipt" role="status"><span>{{ undo.kind === 'hydration' ? '已记录喝水' : '已完成活动' }}</span><button :disabled="pending" aria-label="撤销最近的健康操作" @click="undoCompletion">撤销 · {{ Math.max(1,Math.ceil((undo.expiresAt-now)/1000)) }}秒</button></div>
    <div class="health-control activity-control">
    <button class="health-icon spine-icon" :style="{'--overdue-color':spineEffects.color}" :class="{ disabled: !enabled('sedentary'), overdue: spine.overdue }" :disabled="pending" :title="`点击完成活动；${label('sedentary')}。右键设置`" aria-label="完成活动" aria-haspopup="menu" @click="complete('sedentary')" @keydown.shift.f10.prevent="context('sedentary')" @contextmenu.prevent="context('sedentary')">
      <svg ref="spineSvg" class="spine-visual" viewBox="4 0 34 51" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><path class="spine-outline" :opacity="1-spineEffects.separation" :d="`M21 4 Q${21 + spine.progress * 20} 27 21 51`" fill="none" stroke="currentColor" stroke-width="1.4"/><g v-for="(bone,i) in vertebrae" :key="i" class="vertebra" :class="{loose:bone.looseness>0 && !fallingBones.includes(i)}" :style="{'--shake-distance':`${.15+bone.looseness*.7}px`,'--shake-angle':`${1+bone.looseness*7}deg`,'--shake-duration':`${1.2-bone.looseness*.7}s`}"><rect :x="bone.x" :y="bone.y" width="8" :height="bone.height" rx="1" :class="{separated:bone.separated,falling:fallingBones.includes(i)}" :transform="`rotate(${bone.angle} ${bone.x+4} ${bone.y+bone.height/2})`" fill="currentColor"/></g><path :opacity="1-spineEffects.separation" d="M14 51q7-4 14 0" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
      <span>活动<small>{{ recentlyDone('sedentary') ? '已活动' : enabled('sedentary') ? `${spine.percent}%` : '—' }}</small></span><i v-if="spine.overdue" aria-hidden="true"/>
    </button>
    </div>
    <div class="health-control hydration-control">
    <button v-if="plan" type="button" class="daily-reservoir" aria-label="设置今日总喝水量" aria-haspopup="dialog" :disabled="pending" :title="`每日目标 ${plan.goalMl}ml，剩余 ${Math.max(0,plan.goalMl-plan.consumedMl)}ml；右键设置今日总喝水量`" @click="openGoalEditor" @contextmenu.prevent="openGoalEditor" @keydown.shift.f10.prevent="openGoalEditor">
      <svg viewBox="0 0 28 51" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><defs><clipPath id="daily-bottle"><path d="M9 8v6L5 20v28q0 3 3 3h12q3 0 3-3V20l-4-6V8z"/></clipPath></defs><g clip-path="url(#daily-bottle)"><rect class="reservoir-fill" x="4" :y="51-43*Math.max(0,1-plan.consumedMl/plan.goalMl)" width="20" height="43" fill="#78cbdc" fill-opacity=".8"/></g><path class="bottle-outline" d="M9 8v6L5 20v28q0 3 3 3h12q3 0 3-3V20l-4-6V8z M9 8h10V4H9z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
      <span class="daily-copy"><strong>{{ plan.goalMl/1000 }}<em>L</em></strong><small>已喝 <b>{{ plan.consumedMl }}</b><em>ml</em></small><small>剩余 <b>{{ Math.max(0,plan.goalMl-plan.consumedMl) }}</b><em>ml</em></small></span>
    </button>
    <button class="health-icon water-icon" :style="{'--overdue-color':'#b3e4ed','--water-fill':'#78cbdc'}" :class="{ overdue: water.overdue }" :disabled="pending || !canRecordWater" :title="`点击喝完并记录当前 ${currentCupMl}ml；${label('hydration')}。右键设置`" aria-label="喝完当前杯水" aria-haspopup="menu" @click="complete('hydration')" @keydown.shift.f10.prevent="context('hydration')" @contextmenu.prevent="context('hydration')">
      <svg ref="cupSvg" class="water-cup" viewBox="0 0 44 39" preserveAspectRatio="xMidYMax meet" role="img" :aria-label="`当前杯水量 ${currentCupMl}ml，${label('hydration')}`">
        <defs><clipPath id="health-cup"><path d="M9 8h23l-3 28q-.3 3-3 3H15q-2.7 0-3-3z"/></clipPath></defs>
        <g clip-path="url(#health-cup)"><g class="water-fill" :style="{ transform: `translateY(${30 * (1 - water.progress)}px)` }">
          <g class="water-slosh"><path class="water-wave" d="M-20 9q7-3 14 0t14 0t14 0t14 0t14 0t14 0v50h-84z" fill="var(--water-fill,#78cbdc)" fill-opacity=".85"/></g>
        </g></g>
        <path class="cup-outline" d="M9 8h23l-3 28q-.3 3-3 3H15q-2.7 0-3-3z M32 13h3q6 0 5 7t-9 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <g v-if="water.overdue" class="overflow"><path d="M9 9C5 11 6 17 5 21 M32 9C36 11 35 15 36 18" fill="none" stroke="#78cbdc" stroke-linecap="round" :stroke-width=".8+waterEffects.spill*1.2" :opacity=".4+waterEffects.spill*.4"/></g>
      </svg>
      <span>喝水<small>{{ currentCupMl }}ml</small></span><i v-if="water.overdue" aria-hidden="true"/>
    </button>
    </div>
    <form ref="goalEditor" popover="auto" role="dialog" class="health-popover goal-editor" aria-label="设置今日总喝水量" @submit.prevent="saveGoal">
      <div class="goal-editor-heading"><label for="bottle-hydration-goal">今日总喝水量</label><button type="button" :disabled="pending" @click="goalEditor?.hidePopover()">取消</button></div>
      <div class="goal-editor-fields"><input id="bottle-hydration-goal" ref="goalInput" v-model.number="goalMl" type="number" min="500" max="5000" step="1" required aria-label="今日总喝水量毫升" :disabled="pending" @input="goalError=''"/><span>ml</span><button type="submit" :disabled="pending">{{ pending ? '保存中…' : '保存' }}</button></div>
      <span v-if="goalError" role="alert" class="goal-editor-error">{{ goalError }}</span><span v-else class="goal-editor-hint">同步健康设置的每日目标，已喝水量保留。</span>
    </form>
    <span class="health-feedback" role="status">{{ feedback }}</span><span v-if="error" class="health-error" role="alert">{{ error }}</span><span v-else-if="menuFeedback && (menuFailed || now<menuFeedbackUntil)" class="health-error" :class="{'health-success':!menuFailed}" :role="menuFailed?'alert':'status'">{{menuFeedback}}</span>
  </section>
</template>

<style scoped>
.wellness-controls ::selection{background:transparent;color:inherit}
.daily-reservoir{cursor:pointer;font-family:inherit;line-height:inherit}
.health-popover.goal-editor{position:fixed;inset:5px;margin:0;width:auto;max-width:none;max-height:calc(100vh - 10px);box-sizing:border-box;overflow:auto;padding:7px 10px;background:#25342c;color:#e5eee7;cursor:default}
.goal-editor:popover-open{display:flex;flex-direction:column;gap:5px}
.goal-editor-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
.goal-editor-heading button{padding:1px 5px;min-height:21px}
.goal-editor-fields{display:grid;grid-template-columns:minmax(64px,1fr) auto auto;gap:7px;align-items:center}
.goal-editor-fields input{min-width:0;width:100%;box-sizing:border-box;border:1px solid #789282;border-radius:4px;background:#1c2822;color:#eef7f1;font:inherit;font-size:14px;padding:4px 7px;user-select:text;caret-color:#bce9cc}
.goal-editor .goal-editor-fields button{min-height:27px;background:#a9d9bf;color:#14291e;font-weight:600}
.goal-editor-hint,.goal-editor-error{font-size:10px;line-height:1.3}.goal-editor-error{color:#ffd0c7}
.health-success{color:#d4eadc!important}
.vertebra.loose{transform-box:fill-box;transform-origin:center;animation:bone-loosen var(--shake-duration) ease-in-out infinite}
@keyframes bone-loosen{0%,42%,100%{transform:translateX(0) rotate(0)}8%,24%{transform:translateX(calc(-1 * var(--shake-distance))) rotate(calc(-1 * var(--shake-angle)))}16%,32%{transform:translateX(var(--shake-distance)) rotate(var(--shake-angle))}}


.physics-active .spine-visual rect.falling{visibility:hidden}

.health-receipt{position:absolute;left:8px;right:8px;bottom:calc(100% + 6px);z-index:9;display:flex;align-items:center;justify-content:space-between;min-height:22px;gap:8px;padding:5px 8px;border:1px solid #ffffff30;border-radius:4px;background:#25342cf2;color:#d4eadc;font-size:11px}.health-receipt button{padding:3px 0;border:0;background:transparent;color:#bce9cc;font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.health-receipt button:disabled{opacity:.5}


.health-error{position:absolute;bottom:100%;left:8px;right:8px;padding:7px;background:#25342c;color:#ffd0c7;font-size:11px}.health-icon>span{min-width:32px}
.health-control{min-width:0;display:flex;justify-content:center}
.hydration-control{display:contents}
.daily-reservoir{min-width:0;display:flex;align-items:flex-end;justify-content:center;gap:7px;border:0;border-radius:5px;background:transparent;color:#b3e4ed;padding:4px 0 8px;font-size:11px}
.daily-reservoir svg{height:54px;width:28px;flex:none}
.daily-reservoir>.daily-copy{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;padding-bottom:1px;line-height:13px;white-space:nowrap;font-variant-numeric:tabular-nums}
.daily-copy strong{font-size:14px;line-height:18px;font-weight:600;color:#d6f1f5}
.daily-copy small{font-size:9px;line-height:13px;color:#bdd7dc}
.daily-copy b{font-weight:500;color:#d6e8eb}
.daily-copy em{font-style:normal;font-size:.85em;margin-left:2px;font-weight:400}
.reservoir-fill{transition:y .7s ease}


.health-feedback { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
@keyframes slosh { 0%,100% { transform:rotate(-4deg); } 50% { transform:rotate(4deg); } }
@keyframes wave { from { transform:translateX(0); } to { transform:translateX(-28px); } }

.water-fill{transition:transform 1s linear}
.wellness-controls{user-select:none;position:relative;display:grid;grid-template-columns:1fr 1fr;align-items:end;align-content:center;gap:8px;flex:0 0 auto;padding:10px 10px 16px;border-top:1px solid #ffffff14;color:#c2d8ca}
.wellness-controls:has(.daily-reservoir){grid-template-columns:minmax(68px,.85fr) minmax(108px,1.4fr) minmax(70px,.9fr)}
.health-icon{min-width:0;position:relative;display:flex;align-items:flex-end;justify-content:center;gap:5px;padding:4px 0 8px;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:11px}
.health-icon svg{width:34px;height:40px;flex:none;overflow:visible}
.health-icon .spine-visual{width:30px;height:54px}
.health-icon .water-cup{width:32px}
.health-icon>span{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;min-width:30px;padding-bottom:3px;line-height:14px;text-align:center;white-space:nowrap}
.health-icon small{display:block;margin:0;color:currentColor;font-size:12px;font-weight:500;line-height:15px;font-variant-numeric:tabular-nums}
.daily-reservoir:hover:not(:disabled),.health-icon:hover:not(:disabled){background:#ffffff08;filter:brightness(1.08)}
.daily-reservoir:active:not(:disabled),.health-icon:active:not(:disabled){background:#ffffff12}
.health-icon:disabled,.daily-reservoir:disabled{cursor:default;opacity:.65}
.water-icon{color:#b3e4ed}
.water-icon small{font-size:11px}
.spine-icon{color:#c1e4bb}
.health-icon.disabled:not(:hover){color:#a8bbb0;opacity:.65}
.health-icon.overdue{color:var(--overdue-color,#f3cf9c)}
.health-icon i{position:absolute;right:0;bottom:17px;width:3px;height:3px;border-radius:50%;background:currentColor}
.water-slosh{transform-origin:21px 10px;animation:slosh 3.2s ease-in-out infinite}
.water-wave{animation:wave 2.8s linear infinite}
.water-icon.disabled .water-slosh,.water-icon.disabled .water-wave{animation-play-state:paused}
.spine-icon rect,.spine-icon path{transition:transform .45s cubic-bezier(.16,1,.3,1),d .45s cubic-bezier(.16,1,.3,1)}
.health-popover { position:absolute; left:9px; bottom:calc(100% + 4px); z-index:8; width:calc(100vw - 20px); max-width:340px; padding:13px; background:#25342c; color:#e5eee7; border:1px solid #718b78; border-radius:5px; font-size:11px; }.health-popover p { margin:9px 0; line-height:1.7; }.health-popover button { border:0; border-radius:3px; padding:5px 7px; background:#ffffff13; color:inherit; font:inherit; cursor:pointer; }.health-popover button:hover { background:#ffffff24; }.health-popover .health-note { color:#c6d6ca; font-size:10px; }.health-popover [role=alert] { color:#ffd0c7; }.wellness-controls button:focus-visible { outline:2px solid #c5e6ce; outline-offset:1px; }@media(prefers-reduced-motion:reduce) { .wellness-controls * { animation:none !important; transition:none !important; } }
@media(max-width:330px){.wellness-controls{gap:6px;padding-left:8px;padding-right:8px}.health-icon{gap:3px}.daily-reservoir{gap:5px}}
</style>
