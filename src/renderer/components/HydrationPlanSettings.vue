<script setup lang="ts">
import { toolbox } from '../toolbox'
import { computed, reactive, ref, watch, nextTick } from 'vue'
import type { AppData } from '../../main/types'
import { defaultHydrationPlan, validateHydrationPlan, hydrationDayAt, hydrationTimes, type HydrationPlan } from '../../main/hydration-plan'
import { createSaveQueue } from '../save-queue'
const props=defineProps<{data:AppData}>()
const draft=reactive({...defaultHydrationPlan})
const message=ref(''),failed=ref(false),dirty=ref(false)
const resetting=ref(false),resetMessage=ref(''),resetFailed=ref(false)
const queue=createSaveQueue()
let revision=0
const calendar=ref<HTMLElement|null>(null),customSchedule=ref(false)
watch(()=>props.data.settings.hydrationPlan,plan=>{if(!dirty.value){Object.assign(draft,plan);customSchedule.value=JSON.stringify(hydrationTimes(plan))!==JSON.stringify(hydrationTimes({...plan,times:undefined}))}},{immediate:true})
const times=computed(()=>hydrationTimes(draft))
const today=computed(()=>hydrationDayAt(props.data.hydrationDay,Date.now()).consumedMl)
async function resetToday() {
  resetting.value=true;resetMessage.value='';resetFailed.value=false
  try {
    await toolbox.wellness.resetHydration()
    resetMessage.value='今日记录已重置，水瓶已补满。开始、结束时间保持不变。'
  } catch(error) {
    resetFailed.value=true
    resetMessage.value=error instanceof Error?error.message:'重置失败，请重试。'
  } finally { resetting.value=false }
}
async function save() {
  const current=++revision
  dirty.value=true;failed.value=false
  let plan:HydrationPlan
  try { plan=validateHydrationPlan({...draft,times:draft.times ? [...draft.times]:undefined}) }
  catch(error){message.value=error instanceof Error?error.message:'请检查计划';failed.value=true;return}
  message.value='正在保存…'
  try {
    await queue(()=>toolbox.settings.update({hydrationPlan:plan,...(plan.enabled && !props.data.settings.hydrationPlan.enabled?{hydrationReminderEnabled:true}:{})}))
    if(current===revision){dirty.value=false;message.value='已保存';failed.value=false}
  } catch(error){if(current===revision){message.value=error instanceof Error?error.message:'未保存，请重试';failed.value=true}}
}
function setPlan(patch:Partial<HydrationPlan>){Object.assign(draft,patch);if(['goalMl','cupMl','start','end','times'].some(key=>key in patch)){draft.times=undefined;customSchedule.value=false};void save()}
function setNumber(key:'goalMl'|'cupMl',event:Event){setPlan({[key]:Number((event.target as HTMLInputElement).value)})}
function setTime(index:number,event:Event){customSchedule.value=true;const updated=[...times.value];updated[index]=(event.target as HTMLInputElement).value;draft.times=updated;void save()}
const position=(time:string)=>(Number(time.slice(0,2))*60+Number(time.slice(3)))*.8
watch(()=>[draft.start,draft.enabled,calendar.value],async()=>{await nextTick();if(calendar.value)calendar.value.scrollTop=Math.max(0,Number(draft.start.slice(0,2))-1)*48},{flush:'post'})
async function customize(){customSchedule.value=true;await nextTick();const input=calendar.value?.querySelector<HTMLInputElement>('input');input?.focus();input?.scrollIntoView({block:'center'})}
function distribute(){customSchedule.value=false;setPlan({times:undefined})}
function blur(event:KeyboardEvent){(event.target as HTMLInputElement).blur()}
</script>
<template>
<section class="hydration-plan-settings" aria-label="喝水计划设置">
  <h4>喝水方式</h4>
  <div class="choices"><button :aria-pressed="!draft.enabled" @click="setPlan({enabled:false})">固定间隔</button><button :aria-pressed="draft.enabled" @click="setPlan({enabled:true})">每日计划</button></div>
  <h4>每日目标 · 点选即启用</h4><div class="choices"><button v-for="ml in [1000,2000,3000]" :key="ml" :aria-pressed="draft.enabled && draft.goalMl===ml" @click="setPlan({enabled:true,goalMl:ml})">{{ml/1000}} L</button></div>
  <template v-if="draft.enabled">
    <h4>每日计划详情</h4>
    <label>自定义目标（ml）<input :value="draft.goalMl" type="number" min="500" max="5000" step="100" aria-label="每日喝水目标" @change="setNumber('goalMl',$event)" @keydown.enter.prevent="blur"/></label>
    <h4>每杯水量</h4><div class="choices"><button v-for="ml in [200,250,300,500]" :key="ml" :aria-pressed="draft.cupMl===ml" @click="setPlan({cupMl:ml})">{{ml}} ml</button></div>
    <label>自定义杯量（ml）<input :value="draft.cupMl" type="number" min="50" max="1000" aria-label="每杯水量" @change="setNumber('cupMl',$event)" @keydown.enter.prevent="blur"/></label>
    <div class="time-range"><label>开始<input :value="draft.start" type="time" aria-label="喝水计划开始时间" @change="setPlan({start:($event.target as HTMLInputElement).value})" @keydown.enter.prevent="blur"/></label><span class="time-arrow" aria-hidden="true">→</span><label>结束<input :value="draft.end" type="time" aria-label="喝水计划结束时间" @change="setPlan({end:($event.target as HTMLInputElement).value})" @keydown.enter.prevent="blur"/></label></div>
    <p class="hint">每天 {{times.length}} 杯 · 今日已记录 {{today}} ml。调整目标、杯量或时段会重新平均分配。</p>
    <button :disabled="resetting || dirty" @click="resetToday">{{resetting?'正在重置…':'重置今日记录'}}</button>
    <p class="hint">清空今日已喝水量并补满水瓶；结束时间后仍不能记录喝水。</p>
    <p v-if="resetMessage" :role="resetFailed?'alert':'status'" class="save-message">{{resetMessage}}</p>
    <div class="choices schedule-actions"><button :aria-pressed="!customSchedule" @click="distribute">平均分配</button><button :aria-pressed="customSchedule" @click="customize">自定义时间</button></div>
    <p class="hint">24 小时日视图 · 直接修改每杯时间，至少相隔 5 分钟。</p>
    <div ref="calendar" class="day-calendar" aria-label="24 小时喝水日视图">
      <div class="day-hours">
        <div v-for="hour in 24" :key="hour" class="hour-line" :style="{top:`${(hour-1)*48}px`}"><span>{{String(hour-1).padStart(2,'0')}}:00</span></div>
        <label v-for="(time,index) in times" :key="index" class="cup-slot" :style="{top:`${position(time)}px`,'--cup-column':index%2}"><span>第 {{index+1}} 杯 · {{Math.min(draft.cupMl,Math.max(0,draft.goalMl-index*draft.cupMl))}} ml</span><input :value="time" type="time" :aria-label="`第 ${index+1} 杯提醒时间`" @change="setTime(index,$event)" @keydown.enter.prevent="blur"/></label>
      </div>
    </div>
    <p class="hint">点击水杯记录一杯；结束后停止提醒，次日重算，不补发错过的提醒。</p>
  </template>
  <p v-if="message" :role="failed?'alert':'status'" class="save-message">{{message}} <button v-if="failed" @click="save">重试</button></p>
  <slot name="quick-controls"/>
</section>
</template>
<style scoped>
.day-calendar{container-type:inline-size;height:320px;overflow:auto;border:1px solid #ffffff30;border-radius:4px;margin:12px 0;background:#00000014}.day-hours{position:relative;height:1152px;min-width:0}.hour-line{position:absolute;left:0;right:0;height:48px;border-top:1px solid #ffffff24}.hour-line:after{content:'';position:absolute;left:54px;right:0;top:24px;border-top:1px dotted #ffffff12}.hour-line span{font-size:10px;padding:2px;color:#b8c9be}.hydration-plan-settings .cup-slot{position:absolute;display:flex;flex-direction:column;align-items:stretch;gap:2px;left:calc(60px + var(--cup-column)*130px);width:122px;padding:3px 5px;margin:0;border:1px solid #91cad766;border-radius:3px;background:#28454d;color:#ecf6f8;font-size:10px;box-sizing:border-box}.cup-slot input{width:100%;padding:0;font-size:11px}.schedule-actions{margin:10px 0}@container(max-width:329px){.hydration-plan-settings .cup-slot{left:54px;width:calc(100% - 62px)}}

.hydration-plan-settings{margin:14px 0;padding:12px 0;border-top:1px solid #ffffff24}h4{margin:12px 0 8px;font-size:12px}.choices{display:flex;gap:6px;flex-wrap:wrap}.choices button{flex:0 0 auto;white-space:nowrap}button,input{font:inherit;color:inherit;background:#ffffff0c;border:1px solid #ffffff30;border-radius:4px;padding:5px 8px;font-size:12px}button{cursor:pointer}button[aria-pressed=true]{background:#bdddc7;color:#14281b;border-color:#bdddc7}label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;padding:7px 0}input{width:105px;max-width:100%;min-width:0;box-sizing:border-box}.time-range{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px}.time-range label{display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:0}.time-range input{width:100%;min-width:0}.time-arrow{padding-top:20px;color:#b8ddc7}.hint{font-size:11px;line-height:1.7;color:#c0cec7}.save-message{font-size:12px;color:#b8ddc4}[role=alert]{color:#ffd0c6}:focus-visible{outline:2px solid #a4dbb6;outline-offset:2px}
</style>
