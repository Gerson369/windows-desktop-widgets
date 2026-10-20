<script setup lang="ts">
import { toolbox } from '../../toolbox'

const api=toolbox
import {computed,onMounted,onBeforeUnmount,ref} from 'vue'
import type {AppData} from '../../../main/types'
import {dateKey,daysUntil,focusRemaining} from '../../../main/widget-suite'
const props=defineProps<{data:AppData;kind:'clock'|'countdown'|'focus'}>()
const editingCountdown=ref('')
const now=ref(Date.now()), zone=ref(''), title=ref(''), date=ref(dateKey(Date.now())),minutes=ref(Math.round(props.data.suite.focus.durationSeconds/60)),error=ref('')
let timer:ReturnType<typeof setInterval>|undefined
const remaining=computed(()=>focusRemaining(props.data.suite.focus,now.value))
const display=computed(()=>`${String(Math.floor(remaining.value/60)).padStart(2,'0')}:${String(remaining.value%60).padStart(2,'0')}`)
async function perform(action:()=>Promise<unknown>){try{await action();error.value=''}catch(reason){error.value=reason instanceof Error?reason.message:String(reason)}}
async function addZone(){await api.suite.save({timeZones:[...new Set([...props.data.suite.timeZones,zone.value.trim()])]});zone.value=''}
async function addDate(){await api.suite.save({countdowns:[...props.data.suite.countdowns.filter(item=>item.id!==editingCountdown.value),{id:editingCountdown.value||crypto.randomUUID(),title:title.value.trim(),date:date.value}]});title.value='';editingCountdown.value=''}
function time(timeZone:string){return new Intl.DateTimeFormat('zh-CN',{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now.value)}
function day(timeZone:string){return new Intl.DateTimeFormat('zh-CN',{timeZone,month:'long',day:'numeric',weekday:'short'}).format(now.value)}
onMounted(()=>{timer=setInterval(()=>{now.value=Date.now()},1000)})
onBeforeUnmount(()=>clearInterval(timer))
</script>
<template>
  <template v-if="kind==='clock'">
    <div v-for="item in data.suite.timeZones" :key="item" class="entry"><div class="row"><b>{{item}}</b><button v-if="item!==data.suite.timeZones[0]" :aria-label="`顶部时区 ${item}`" @click="perform(()=>api.suite.save({timeZones:[item,...data.suite.timeZones.filter(zone=>zone!==item)]}))">设为顶部</button><button v-if="data.suite.timeZones.length>1" :aria-label="`移除时区 ${item}`" @click="perform(()=>api.suite.save({timeZones:data.suite.timeZones.filter(zone=>zone!==item)}))">移除</button></div><h2>{{time(item)}}</h2><small>{{day(item)}}</small></div>
    <form @submit.prevent="perform(addZone)"><input v-model="zone" required maxlength="80" placeholder="如 Europe/London" aria-label="新增时区"/><button :disabled="!zone.trim()">添加</button></form><small>使用 IANA 时区名称，自动处理夏令时。</small>
  </template>
  <template v-else-if="kind==='countdown'">
    <div class="countdown-list"><div v-for="item in data.suite.countdowns" :key="item.id" class="countdown-item"><div class="countdown-copy"><b>{{item.title}}</b><small>{{item.date}}</small></div><strong class="countdown-days">{{daysUntil(item.date,now)===0?'今天':daysUntil(item.date,now)>0?`${daysUntil(item.date,now)} 天后`:`已过 ${-daysUntil(item.date,now)} 天`}}</strong><button class="countdown-action" :aria-label="`编辑日期 ${item.title}`" @click="editingCountdown=item.id;title=item.title;date=item.date">编辑</button><button class="countdown-action" :aria-label="`删除日期 ${item.title}`" @click="perform(()=>api.suite.save({countdowns:data.suite.countdowns.filter(date=>date.id!==item.id)}))">×</button></div></div>
    <p v-if="!data.suite.countdowns.length" class="hint">添加生日、纪念日或项目截止日期。</p>
    <form @submit.prevent="perform(addDate)"><input v-model="title" required maxlength="120" aria-label="重要日期名称" placeholder="重要日期名称"/><input v-model="date" type="date" required aria-label="重要日期"/><button>{{editingCountdown?'保存修改':'添加'}}</button></form>
  </template>
  <template v-else>
    <h2 role="timer" aria-live="off">{{display}}</h2><p>{{data.suite.focus.endAt?'正在专注':remaining?'已准备 / 已暂停':'本轮已完成'}}</p>
    <form @submit.prevent="perform(()=>api.suite.focus('start',Math.round(minutes*60)))"><label>分钟<input v-model.number="minutes" type="number" min="1" max="1440" required aria-label="专注分钟"/></label><button :disabled="!!data.suite.focus.endAt">开始新一轮</button></form>
    <div class="row"><button v-if="data.suite.focus.endAt" @click="perform(()=>api.suite.focus('pause'))">暂停</button><button v-else @click="perform(()=>api.suite.focus('start'))">继续</button><button @click="perform(()=>api.suite.focus('reset'))">重置</button></div><small>退出后保留截止时间；锁屏期间继续计时，解锁后提示完成。</small>
  </template>
  <p v-if="error" role="alert">{{error}}</p>
</template>

<style scoped>.countdown-item{display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid #ffffff20}.countdown-copy{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.countdown-copy b{font-size:12px;line-height:1.3;overflow-wrap:anywhere}.countdown-copy small{font-size:10px;line-height:1.4}.countdown-days{font-size:16px;font-weight:500;white-space:nowrap;font-variant-numeric:tabular-nums}.countdown-item .countdown-action{font-size:10px;padding:4px 5px}.countdown-list{margin-bottom:12px}</style>
