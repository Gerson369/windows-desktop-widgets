<script setup lang="ts">
import { toolbox } from '../../toolbox'

const api=toolbox
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue'
import type {AppData} from '../../../main/types'
import type {AgendaEvent} from '../../../main/calendar-service'
import {dateKey} from '../../../main/widget-suite'
const props=defineProps<{data:AppData}>()
const month=ref(dateKey(Date.now()).slice(0,7)),selected=ref(dateKey(Date.now())),events=ref<AgendaEvent[]>([]),error=ref(''),busy=ref(false)
const title=ref(''),start=ref(`${selected.value}T09:00`),end=ref(`${selected.value}T10:00`),allDay=ref(false),category=ref<'work'|'personal'>('personal'),editingId=ref('')
const sourceName=ref(''),sourceUrl=ref('')
let timer:ReturnType<typeof setInterval>|undefined
let lastDay=dateKey(Date.now()),generation=0,lastSubscriptionCheck=0
const days=computed(()=>{
  const [year,m]=month.value.split('-').map(Number)
  if(!year || !m) return []
  const first=new Date(year,m-1,1),count=new Date(year,m,0).getDate()
  return [...Array((first.getDay()+6)%7).fill(''),...Array.from({length:count},(_,index)=>`${month.value}-${String(index+1).padStart(2,'0')}`)]
})
const selectedEvents=computed(()=>events.value.filter(event=>dateKey(new Date(event.start))===selected.value || (Date.parse(event.start)<new Date(`${selected.value}T23:59:59`).getTime() && Date.parse(event.end)>new Date(`${selected.value}T00:00:00`).getTime())))
function select(date:string){selected.value=date;start.value=`${date}T09:00`;end.value=`${date}T10:00`;editingId.value='';title.value=''}
async function refresh(){
  const current=++generation
  try{
    const [year,m]=month.value.split('-').map(Number)
    const from=new Date(year,m-1,1).getTime(),until=new Date(year,m,32).getTime()
    if(!Number.isFinite(from) || !Number.isFinite(until))return
    const result=await api.suite.agenda(from,until)
    if(current===generation){events.value=result.events;error.value=result.errors.join('；')}
  }catch(reason){if(current===generation)error.value=String(reason)}
}
async function perform(action:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await action();await refresh()}catch(reason){error.value=String(reason)}finally{busy.value=false}}
async function save(){
  const first=allDay.value?new Date(`${selected.value}T00:00:00`):new Date(start.value)
  const last=allDay.value?new Date(first.getFullYear(),first.getMonth(),first.getDate()+1):new Date(end.value)
  const item={id:editingId.value||crypto.randomUUID(),title:title.value.trim(),start:first.toISOString(),end:last.toISOString(),allDay:allDay.value,category:category.value}
  await api.suite.save({events:[...props.data.suite.events.filter(event=>event.id!==item.id),item]})
  title.value='';editingId.value=''
}
function edit(event:AgendaEvent){
  const local=props.data.suite.events.find(item=>item.id===event.id)
  if(!local)return
  const input=(value:string)=>{const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}
  document.querySelector<HTMLDetailsElement>('details')?.setAttribute('open','');editingId.value=local.id;title.value=local.title;start.value=input(local.start);end.value=input(local.end);allDay.value=local.allDay;category.value=local.category
}
async function refreshSubscriptions(){
  if(Date.now()-lastSubscriptionCheck<30*60000)return
  lastSubscriptionCheck=Date.now()
  for(const source of props.data.suite.sources.filter(item=>item.enabled && item.url && Date.now()-Date.parse(item.updatedAt)>30*60000)) {
    try{await api.suite.refreshCalendar(source.id)}catch(reason){error.value=`${source.name}：更新失败，保留上次内容。${String(reason)}`}
  }
}
watch([month,()=>props.data.suite.events,()=>props.data.suite.sources],()=>{void refresh()},{immediate:true})
onMounted(()=>{void refreshSubscriptions();timer=setInterval(()=>{const today=dateKey(Date.now());if(today!==lastDay){if(selected.value===lastDay){select(today);month.value=today.slice(0,7)}lastDay=today;void refresh()}void refreshSubscriptions()},60000)})
onBeforeUnmount(()=>{generation++;clearInterval(timer)})
</script>
<template>
  <div class="row"><input v-model="month" type="month" required aria-label="查看月份"/><button @click="select(dateKey(Date.now()));month=selected.slice(0,7)">今天</button></div>
  <div class="calendar-grid"><small v-for="day in ['一','二','三','四','五','六','日']" :key="day">{{day}}</small><template v-for="(date,index) in days" :key="index"><button v-if="date" :aria-label="date" :aria-pressed="date===selected" @click="select(date)">{{Number(date.slice(-2))}}</button><span v-else/></template></div>
  <p><b>{{selected}}</b></p><div v-for="event in selectedEvents" :key="event.id" class="entry"><b>{{event.title}}</b><p class="hint">{{event.allDay?'全天':new Date(event.start).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}} · {{event.source}}</p><div v-if="data.suite.events.some(item=>item.id===event.id)" class="row"><button @click="edit(event)">编辑</button><button :disabled="busy" @click="perform(()=>api.suite.save({events:data.suite.events.filter(item=>item.id!==event.id)}))">删除</button></div></div><p v-if="!selectedEvents.length" class="hint">当天暂无日程。</p>
  <details><summary>{{editingId?'编辑日程':'添加日程'}}</summary><form @submit.prevent="perform(save)"><input v-model="title" required maxlength="120" placeholder="日程名称" aria-label="日程名称"/><select v-model="category" aria-label="日程类别"><option value="work">工作</option><option value="personal">个人</option></select><label><input v-model="allDay" type="checkbox"/>全天</label><template v-if="!allDay"><input v-model="start" type="datetime-local" required aria-label="日程开始时间"/><input v-model="end" type="datetime-local" required aria-label="日程结束时间"/></template><button :disabled="busy">保存日程</button></form></details>
  <details><summary>日历来源与近期安排</summary><button :disabled="busy" @click="perform(()=>api.suite.importCalendar())">导入 ICS 文件</button>
    <form @submit.prevent="perform(async()=>{await api.suite.subscribeCalendar(sourceName,sourceUrl);sourceName='';sourceUrl=''})"><input v-model="sourceName" required maxlength="120" placeholder="工作 / 个人日历名称" aria-label="订阅名称"/><input v-model="sourceUrl" type="url" required placeholder="HTTPS 订阅地址" aria-label="日历订阅地址"/><button :disabled="busy">订阅</button></form>
    <div v-for="source in data.suite.sources" :key="source.id" class="entry"><label><input type="checkbox" :checked="source.enabled" @change="perform(()=>api.suite.save({sources:data.suite.sources.map(item=>item.id===source.id?{...item,enabled:!item.enabled}:item)}))"/>{{source.name}}</label><small>{{source.updatedAt?new Date(source.updatedAt).toLocaleString('zh-CN'):'尚未刷新'}}</small><div class="row"><button v-if="source.url" :disabled="busy" @click="perform(()=>api.suite.refreshCalendar(source.id))">刷新</button><button :disabled="busy" @click="perform(()=>api.suite.save({sources:data.suite.sources.filter(item=>item.id!==source.id)}))">移除来源</button></div></div>
    <p class="hint">订阅为只读合并展示，启用时每 30 分钟检查更新；导入文件需要重新导入才能更新。</p><div v-for="event in events.filter(item=>Date.parse(item.end)>=Date.now()).slice(0,12)" :key="event.id" class="entry"><b>{{event.title}}</b><p class="hint">{{new Date(event.start).toLocaleString('zh-CN')}} · {{event.source}}</p></div>
  </details><p v-if="busy" role="status">正在处理…</p><p v-if="error" role="alert">{{error}}</p>
</template>
<style scoped>.calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}.calendar-grid button{padding:5px 0}.calendar-grid small{padding:5px}details{padding:10px 0}summary{cursor:pointer;margin-bottom:10px}</style>
