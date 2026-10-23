<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { hydrationReminderVisual, reminderVisual, type ReminderKind, type WellnessSnapshot } from '../../main/wellness-reminders'
import type { AppData } from '../../main/types'
import HealthPhysics from './HealthPhysics.vue'
import { healthEffects, spineSegments, waterOverflowEffects } from '../health-effects'
import { hydrationPlanCanRecord } from '../../main/hydration-plan'

const cupSvg = ref<SVGSVGElement | null>(null), spineSvg = ref<SVGSVGElement | null>(null), physicsActive = ref(false), fallingBones = ref<number[]>([])
const props = defineProps<{ data: AppData }>()
const api = toolbox
const snapshot = ref<WellnessSnapshot>({ state: {}, paused: false, now: Date.now() })
const now = ref(Date.now())
const plan = computed(() => snapshot.value.hydrationPlan)
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
  if (kind === 'hydration' && plan.value?.enabled) {
    if (plan.value.status === 'complete') return '今日喝水目标已完成'
    if (plan.value.status === 'before') return `${plan.value.start} 开始，未开始时不能记录喝水或扣减水量`
    if (plan.value.status === 'ended') return `今日记录已结束，剩余 ${Math.max(0,plan.value.goalMl-plan.value.consumedMl)}ml 表示未达标；明天 ${plan.value.start} 开始`
    if (!snapshot.value.state.hydration) return '今天没有后续提醒，仍可记录喝水'
  }
  if (!enabled(kind)) return '尚未开启，点击开始计时'
  if (snapshot.value.paused) return '计时已暂停，解锁或唤醒后继续'
  const state = visual(kind)
  if (state.snoozed) return `${state.minutes} 分钟后再提醒`
  if (state.overdue) return kind === 'hydration' ? '水杯满了，该喝水了' : '坐得有点久，起来活动一下'
  return `${state.minutes || (kind === 'hydration' ? props.data.settings.hydrationIntervalMinutes : props.data.settings.sedentaryIntervalMinutes)} 分钟后提醒`
}
async function context(kind: ReminderKind) {
  try { await api.wellness.menu(kind) } catch(reason) { error.value=String(reason) }
}
async function action(kind: ReminderKind, mode: 'done' | 'snooze' | 'enable') {
  if (pending.value) return
  pending.value = true
  error.value = ''
  feedback.value = '';menuFeedback.value=''
  try {
    if (mode === 'enable') await api.settings.update(kind === 'hydration' ? { hydrationReminderEnabled: true } : { sedentaryReminderEnabled: true })
    else snapshot.value = await api.wellness.respond(kind, mode)
    if (mode === 'done') { lastDone.value = kind; feedbackUntil.value = Date.now() + 2000; now.value = Date.now() }
    feedback.value = mode === 'done' ? `${kind === 'hydration' ? '已记录喝水' : '已活动'}，已更新提醒` : mode === 'snooze' ? '已推迟十分钟' : '已开启提醒'
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '操作未完成' }
  finally { pending.value = false }
}
async function complete(kind: ReminderKind) {
  if (kind === 'hydration' && plan.value && !hydrationPlanCanRecord(plan.value)) return
  await action(kind, enabled(kind) || (kind === 'hydration' && plan.value?.enabled) ? 'done' : 'enable')
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
    <div v-if="plan?.enabled" class="daily-reservoir" role="img" aria-label="全天剩余水量" :title="`每日目标 ${plan.goalMl}ml，剩余 ${Math.max(0,plan.goalMl-plan.consumedMl)}ml`">
      <svg viewBox="0 0 28 51" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><defs><clipPath id="daily-bottle"><path d="M9 8v6L5 20v28q0 3 3 3h12q3 0 3-3V20l-4-6V8z"/></clipPath></defs><g clip-path="url(#daily-bottle)"><rect class="reservoir-fill" x="4" :y="51-43*Math.max(0,1-plan.consumedMl/plan.goalMl)" width="20" height="43" fill="#78cbdc" fill-opacity=".8"/></g><path class="bottle-outline" d="M9 8v6L5 20v28q0 3 3 3h12q3 0 3-3V20l-4-6V8z M9 8h10V4H9z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
      <span>{{ plan.goalMl/1000 }}L<small>已喝 {{ plan.consumedMl }}ml</small><small>剩余 {{ Math.max(0,plan.goalMl-plan.consumedMl) }}ml</small></span>
    </div>
    <button class="health-icon water-icon" :style="{'--overdue-color':'#b3e4ed','--water-fill':'#78cbdc'}" :class="{ disabled: !enabled('hydration'), overdue: water.overdue }" :disabled="pending || (plan && !hydrationPlanCanRecord(plan))" :title="`点击${plan?.enabled ? `记录本杯 ${plan.nextCupMl}ml` : '确认已喝水'}；${label('hydration')}。右键设置`" aria-label="记录本杯喝水" aria-haspopup="menu" @click="complete('hydration')" @keydown.shift.f10.prevent="context('hydration')" @contextmenu.prevent="context('hydration')">
      <svg ref="cupSvg" class="water-cup" viewBox="0 0 44 39" preserveAspectRatio="xMidYMax meet" role="progressbar" aria-label="本杯喝水计时进度" :aria-valuenow="Math.min(100,water.percent)" :aria-valuemin="0" :aria-valuemax="100" :aria-valuetext="`${water.percent}%，${label('hydration')}`">
        <defs><clipPath id="health-cup"><path d="M9 8h23l-3 28q-.3 3-3 3H15q-2.7 0-3-3z"/></clipPath></defs>
        <g clip-path="url(#health-cup)"><g class="water-fill" :style="{ transform: `translateY(${30 * (1 - Math.max(.01, water.progress))}px)` }">
          <g class="water-slosh"><path class="water-wave" d="M-20 9q7-3 14 0t14 0t14 0t14 0t14 0t14 0v50h-84z" fill="var(--water-fill,#78cbdc)" fill-opacity=".85"/></g>
        </g></g>
        <path class="cup-outline" d="M9 8h23l-3 28q-.3 3-3 3H15q-2.7 0-3-3z M32 13h3q6 0 5 7t-9 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <g v-if="water.overdue" class="overflow"><path d="M9 9C3 13 6 21 3 30 M32 9C39 12 35 24 40 36" fill="none" stroke="#78cbdc" :stroke-width=".5+waterEffects.spill*2.5" :opacity=".3+waterEffects.spill*.5"/></g>
      </svg>
      <span>喝水<small>{{ plan?.enabled && plan.status==='ended' ? '已结束' : plan?.enabled && plan.status==='complete' ? '完成' : plan?.enabled && plan.status==='before' ? '未开始' : recentlyDone('hydration') ? '已记录' : enabled('hydration') ? `${water.percent}%` : '未开启' }}</small></span><i v-if="water.overdue" aria-hidden="true"/>
    </button>
    </div>
    <span class="health-feedback" role="status">{{ feedback }}</span><span v-if="error" class="health-error" role="alert">{{ error }}</span><span v-else-if="menuFeedback && (menuFailed || now<menuFeedbackUntil)" class="health-error" :class="{'health-success':!menuFailed}" :role="menuFailed?'alert':'status'">{{menuFeedback}}</span>
  </section>
</template>

<style scoped>
.wellness-controls ::selection{background:transparent;color:inherit}
.health-success{color:#d4eadc!important}
.vertebra.loose{transform-box:fill-box;transform-origin:center;animation:bone-loosen var(--shake-duration) ease-in-out infinite}
@keyframes bone-loosen{0%,42%,100%{transform:translateX(0) rotate(0)}8%,24%{transform:translateX(calc(-1 * var(--shake-distance))) rotate(calc(-1 * var(--shake-angle)))}16%,32%{transform:translateX(var(--shake-distance)) rotate(var(--shake-angle))}}


.physics-active .spine-visual rect.falling{visibility:hidden}

.health-receipt{position:absolute;left:8px;right:8px;bottom:calc(100% + 6px);z-index:9;display:flex;align-items:center;justify-content:space-between;min-height:22px;gap:8px;padding:5px 8px;border:1px solid #ffffff30;border-radius:4px;background:#25342cf2;color:#d4eadc;font-size:11px}.health-receipt button{padding:3px 0;border:0;background:transparent;color:#bce9cc;font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.health-receipt button:disabled{opacity:.5}


.health-error{position:absolute;bottom:100%;left:8px;right:8px;padding:7px;background:#25342c;color:#ffd0c7;font-size:11px}.health-icon>span{min-width:32px}
.health-control { display:flex; align-items:flex-end; gap:1px; }.daily-reservoir { display:flex; align-items:flex-end; gap:4px; border:0; background:transparent; color:#b3e4ed; padding:0 3px 0 0; font-size:10px; }.daily-reservoir svg { height:54px; width:28px; flex-shrink:0; }.daily-reservoir small { display:block; font-size:9px; }.reservoir-fill { transition:y .7s ease; }


.health-feedback { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
@keyframes slosh { 0%,100% { transform:rotate(-4deg); } 50% { transform:rotate(4deg); } }
@keyframes wave { from { transform:translateX(0); } to { transform:translateX(-28px); } }

.water-fill { transition:transform 1s linear; }.health-icon small { display:block; margin:0; color:currentColor; font-size:10px; font-variant-numeric:tabular-nums; }
.wellness-controls { user-select:none; position:relative; display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:6px; flex:0 0 auto; padding:10px 12px 8px; border-top:1px solid #ffffff14; color:#c2d8ca; }.health-icon { position:relative; display:flex; align-items:flex-end; gap:3px; padding:0 6px 0 0; border:0; border-radius:4px; background:transparent; color:inherit; cursor:pointer; font:inherit; font-size:10px; }.health-icon svg { width:34px; height:40px; margin-bottom:0; flex-shrink:0; overflow:visible; }.health-icon .spine-visual{width:34px;height:54px;margin-bottom:0}.health-icon>span,.daily-reservoir>span{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:1px;min-width:32px;padding-bottom:4px;line-height:14px;text-align:center;white-space:nowrap}.health-icon small{line-height:14px;text-align:center}.health-control{min-width:0;gap:3px}.activity-control{flex:0 0 auto}.hydration-control{justify-content:flex-end}.activity-control{color:#c1e4bb}.hydration-control{color:#b3e4ed}.wellness-controls:has(.daily-reservoir) .water-icon{padding-right:2px}.health-icon:hover:not(:disabled){filter:brightness(1.18)}.health-icon:active:not(:disabled){filter:brightness(1.35)}.health-icon:disabled{cursor:default;opacity:.6}.water-icon { color:#b3e4ed; }.spine-icon { color:#c1e4bb; }.health-icon.disabled:not(:hover) { color:#a8bbb0; opacity:.65; }.health-icon.overdue { color:var(--overdue-color,#f3cf9c); }.health-icon i { color:inherit; width:4px; height:4px; border-radius:50%; background:currentColor; }.water-slosh { transform-origin:21px 10px; animation:slosh 3.2s ease-in-out infinite; }.water-wave { animation:wave 2.8s linear infinite; }.water-icon.disabled .water-slosh,.water-icon.disabled .water-wave { animation-play-state:paused; }.spine-icon rect,.spine-icon path { transition:transform .45s cubic-bezier(.16,1,.3,1),d .45s cubic-bezier(.16,1,.3,1); }
.health-popover { position:absolute; left:9px; bottom:calc(100% + 4px); z-index:8; width:calc(100vw - 20px); max-width:340px; padding:13px; background:#25342c; color:#e5eee7; border:1px solid #718b78; border-radius:5px; font-size:11px; }.health-popover p { margin:9px 0; line-height:1.7; }.health-popover button { border:0; border-radius:3px; padding:5px 7px; background:#ffffff13; color:inherit; font:inherit; cursor:pointer; }.health-popover button:hover { background:#ffffff24; }.health-popover .health-note { color:#c6d6ca; font-size:10px; }.health-popover [role=alert] { color:#ffd0c7; }.wellness-controls button:focus-visible { outline:2px solid #c5e6ce; outline-offset:1px; }@media(prefers-reduced-motion:reduce) { .wellness-controls * { animation:none !important; transition:none !important; } }
@media(max-width:330px){.wellness-controls{padding-left:8px;padding-right:8px;gap:4px}.health-control{gap:1px}.health-icon{gap:1px;padding-right:2px}.daily-reservoir{gap:1px;padding-right:0}.daily-reservoir>span{min-width:30px}.daily-reservoir small{font-size:8px}}
</style>
