<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue'
import type {AppData} from '../../main/types'
import type {WeatherReading} from '../../main/weather-service'
import type {Metrics} from '../../main/device-metrics'
import {toolbox} from '../toolbox'
import {weatherDescription} from '../weather-description'
import AssistantIcon from './AssistantIcon.vue'
const props=defineProps<{data:AppData;active:string}>()
const emit=defineEmits<{select:[id:'clock'|'weather'|'devices']}>()
const now=ref(Date.now()),weather=ref<WeatherReading|null>(null),metrics=ref<Metrics|null>(null)
const weatherError=ref(''),metricsError=ref('')
const city=computed(()=>props.data.suite.cities[0])
const zone=computed(()=>props.data.suite.timeZones[0] || Intl.DateTimeFormat().resolvedOptions().timeZone)
const time=computed(()=>new Intl.DateTimeFormat('zh-CN',{timeZone:zone.value,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now.value))
const date=computed(()=>new Intl.DateTimeFormat('zh-CN',{timeZone:zone.value,month:'long',day:'numeric',weekday:'short'}).format(now.value))
let alive=true,generation=0
let clockTimer:ReturnType<typeof setInterval>|undefined,weatherTimer:ReturnType<typeof setInterval>|undefined,metricTimer:ReturnType<typeof setInterval>|undefined
async function refreshWeather(){const id=city.value?.id,current=++generation;weatherError.value='';if(!id){weather.value=null;return}try{const next=await toolbox.suite.weather(id);if(alive && current===generation)weather.value=next}catch{if(alive && current===generation){weather.value=null;weatherError.value='天气暂不可用'}}}
async function refreshMetrics(){try{const next=await toolbox.suite.metrics();if(alive){metrics.value=next;metricsError.value=''}}catch{if(alive)metricsError.value='设备数据暂不可用'}}
const percent=(value:number|null|undefined)=>value==null?'—':`${value.toFixed(1)}%`
const speed=(value:number|null|undefined)=>value==null?'—':value>=1048576?`${(value/1048576).toFixed(1)}M/s`:`${(value/1024).toFixed(0)}K/s`
watch(()=>city.value?.id,()=>{weather.value=null;void refreshWeather()})
onMounted(()=>{void refreshWeather();void refreshMetrics();clockTimer=setInterval(()=>now.value=Date.now(),1000);weatherTimer=setInterval(()=>void refreshWeather(),15*60000);metricTimer=setInterval(()=>void refreshMetrics(),10000)})
onBeforeUnmount(()=>{alive=false;generation++;clearInterval(clockTimer);clearInterval(weatherTimer);clearInterval(metricTimer)})
</script>
<template>
<section class="assistant-overview" aria-label="时间天气与设备信息">
  <button id="overview-clock" class="overview-clock" :aria-pressed="active==='clock'" aria-label="设置时间与时区" @click="emit('select','clock')"><strong>{{time}}</strong><span>{{date}}</span></button>
  <button id="overview-weather" class="overview-weather" :aria-pressed="active==='weather'" aria-label="查看和更换天气城市" @click="emit('select','weather')"><span class="weather-main"><AssistantIcon name="weather"/><b>{{city?.name.split(' · ')[0] || '添加城市'}}</b><strong v-if="weather">{{Math.round(weather.temperature)}}°</strong><small v-if="weather">{{weatherDescription(weather.code)}}</small></span><span v-if="weather" class="weather-details"><span>体感 {{Math.round(weather.apparent)}}°</span><span>湿度 {{weather.humidity}}%</span><span>风速 {{weather.wind}} km/h</span></span><small v-else>{{weatherError || (city?'正在读取天气…':'点击选择城市')}}</small><small v-if="weather?.stale">缓存天气</small></button>
  <button id="overview-devices" class="overview-devices" :aria-pressed="active==='devices'" aria-label="查看设备读数" :title="metricsError || '点击查看设备详情'" @click="emit('select','devices')">
    <span class="device-stat device-cpu"><span>CPU</span><b>{{percent(metrics?.cpu)}}</b></span>
    <span class="device-stat device-memory"><span>内存</span><b>{{metrics?`${(metrics.memoryUsed/1073741824).toFixed(1)}/${(metrics.memoryTotal/1073741824).toFixed(1)}G`:'—'}}</b></span>
    <span class="device-stat device-gpu"><span>GPU</span><b>{{percent(metrics?.gpu)}}</b></span>
    <span class="network"><span class="network-rate" :aria-label="`下载速度 ${speed(metrics?.down)}`"><span aria-hidden="true">↓</span><b>{{speed(metrics?.down)}}</b></span><span class="device-batteries"><span v-for="battery in metrics?.batteries" :key="battery.name" :title="`${battery.name} ${battery.percent}%`">{{battery.name}} {{battery.percent}}% </span></span><span class="network-rate" :aria-label="`上传速度 ${speed(metrics?.up)}`"><span aria-hidden="true">↑</span><b>{{speed(metrics?.up)}}</b></span></span>
  </button>
</section>
</template>
<style scoped>
.assistant-overview{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:6px 10px;padding:4px 12px 6px;color:inherit;flex:0 0 auto}.assistant-overview button{min-width:0;padding:3px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left;border-radius:3px}.assistant-overview button:hover{background:#b5e3ef0b}.assistant-overview button:focus-visible{outline:2px solid #a4dbb6;outline-offset:2px}.assistant-overview button[aria-pressed=true]{background:#b5e3ef0b}.overview-clock{display:flex;flex-direction:column;justify-content:flex-start;gap:3px}.overview-clock strong{font:500 clamp(19px,6.2vw,27px)/1.1 Consolas,monospace;letter-spacing:-.7px;color:#e6f6f5;font-variant-numeric:tabular-nums;white-space:nowrap}.overview-clock>span{font-size:10px;color:#becdce}.overview-weather{display:flex;flex-direction:column;justify-content:flex-start;gap:4px}.weather-main{display:flex;align-items:center;gap:5px;min-width:0}.weather-main svg{width:18px;height:18px;flex:0 0 auto;color:#b7e2e8}.weather-main b{font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weather-main strong{font:500 20px/1 Consolas,monospace;color:#c2edf1}.weather-main small{font-size:9px;white-space:nowrap}.weather-details{display:flex;flex-wrap:wrap;gap:3px 7px;font-size:9px;color:#c3d4d5}.overview-weather>small{font-size:9px;color:#c3d4d5}.overview-devices{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr) minmax(0,1fr);gap:4px 7px;border-top:1px solid #b6e7ef22!important;padding-top:6px!important;color:#a5c3c9!important;font:10px/1.4 Consolas,'Microsoft YaHei UI',monospace!important;font-variant-numeric:tabular-nums!important}.device-stat{display:flex;align-items:baseline;gap:4px;min-width:0;white-space:nowrap}.device-stat>span{color:#9bb6bc}.device-stat b{min-width:0;overflow:hidden;text-overflow:ellipsis}.device-cpu b,.device-gpu b{min-width:6ch;text-align:right}.device-memory{justify-content:center}.device-gpu{justify-content:flex-end}.overview-devices b{font-weight:500;color:#dcebed}.overview-devices .network{grid-column:1/-1;display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;align-items:center;gap:8px;min-width:0;font-size:9px;line-height:1.4}.network-rate{display:flex;gap:4px;align-items:baseline;white-space:nowrap}.network-rate>span{color:#9bb6bc}.network-rate b{color:#b9cfd2;font-weight:400}.device-batteries{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;color:#a5bfc4}
</style>
