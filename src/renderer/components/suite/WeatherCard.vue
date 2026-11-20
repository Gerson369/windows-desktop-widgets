<script setup lang="ts">
import { toolbox } from '../../toolbox'

const api=toolbox
import {weatherDescription as description} from '../../weather-description'
import AssistantIcon from '../AssistantIcon.vue'
import {onMounted,onBeforeUnmount,ref,watch} from 'vue'
import type {AppData} from '../../../main/types'
import type {WeatherCity} from '../../../main/widget-suite'
import type {WeatherReading} from '../../../main/weather-service'
const props=defineProps<{data:AppData}>()
const query=ref(''),results=ref<WeatherCity[]>([]),readings=ref<Record<string,WeatherReading>>({}),errors=ref<Record<string,string>>({}),error=ref(''),busy=ref(false),status=ref('')
let timer:ReturnType<typeof setInterval>|undefined,active=true
async function refresh(){for(const city of props.data.suite.cities){try{const reading=await api.suite.weather(city.id);if(active){readings.value[city.id]=reading;delete errors.value[city.id]}}catch(reason){if(active)errors.value[city.id]=String(reason)}}}
async function search(){if(busy.value)return;busy.value=true;error.value='';status.value='';try{results.value=await api.suite.searchCities(query.value);error.value=results.value.length?'':'没有找到城市，可尝试英文名称。'}catch{error.value='城市搜索暂时不可用，请检查网络后重试。'}finally{busy.value=false}}
async function add(city:WeatherCity){if(busy.value)return;busy.value=true;error.value='';try{await api.suite.save({cities:[...props.data.suite.cities.filter(item=>item.id!==city.id),city]});results.value=[];query.value='';status.value=`已添加 ${city.name}`}catch{error.value='城市未能保存，请重试。'}finally{busy.value=false}}
async function select(city:WeatherCity){try{await api.suite.save({cities:[city,...props.data.suite.cities.filter(item=>item.id!==city.id)]})}catch(reason){error.value=String(reason)}}
async function remove(id:string){try{await api.suite.save({cities:props.data.suite.cities.filter(item=>item.id!==id)})}catch(reason){error.value=String(reason)}}

watch(()=>props.data.suite.cities,()=>{void refresh()})
onMounted(()=>{void refresh();timer=setInterval(()=>{void refresh()},15*60000)})
onBeforeUnmount(()=>{active=false;clearInterval(timer)})
</script>
<template>
  <div v-for="city in data.suite.cities" :key="city.id" class="entry weather-city"><div class="row weather-city-heading"><b>{{city.name}}</b><button v-if="data.suite.cities[0]?.id!==city.id" :aria-label="`首页天气 ${city.name}`" @click="select(city)">显示在顶部</button><small v-else>当前顶部城市</small><button class="weather-remove" :aria-label="`移除城市 ${city.name}`" title="移除城市" @click="remove(city.id)"><AssistantIcon name="close"/></button></div><template v-if="readings[city.id]"><h2 class="weather-current"><AssistantIcon name="weather"/>{{Math.round(readings[city.id].temperature)}}° <small>{{description(readings[city.id].code)}}</small></h2><p class="hint">体感 {{readings[city.id].apparent}}° · 湿度 {{readings[city.id].humidity}}% · 风速 {{readings[city.id].wind}} km/h</p><div class="weather-forecast"><div v-for="day in readings[city.id].days" :key="day.date"><small>{{day.date.slice(5).replace('-', '/')}}</small><span>{{description(day.code)}}</span><b>{{day.low}}°–{{day.high}}°</b></div></div><small>{{readings[city.id].stale?'更新失败，显示缓存 · ':''}}{{new Date(readings[city.id].updatedAt).toLocaleString('zh-CN')}}</small></template><p v-else class="hint">{{errors[city.id]?'暂时没有天气数据':'正在读取天气…'}}</p><p v-if="errors[city.id] || readings[city.id]?.error" role="alert">{{errors[city.id] || readings[city.id]?.error}}</p></div>
  <form @submit.prevent="search"><input v-model="query" required minlength="2" maxlength="80" aria-label="搜索天气城市" placeholder="输入城市，如广州、北京"/><button :disabled="busy">{{busy?'搜索中…':'搜索'}}</button></form><div v-for="city in results" :key="city.id" class="entry"><button class="city-result" :disabled="busy || data.suite.cities.some(item=>item.id===city.id)" :aria-label="`添加城市 ${city.name}`" @click="add(city)"><span>{{city.name}}</span><small v-if="data.suite.cities.some(item=>item.id===city.id)">已添加</small><AssistantIcon v-else name="plus"/></button></div><button v-if="data.suite.cities.length" @click="refresh">刷新天气</button><p v-if="status" role="status" class="hint">{{status}}</p><p v-if="error" role="alert">{{error}}</p><p class="hint">数据：<a href="https://open-meteo.com/" @click.prevent="api.system.openExternal('https://open-meteo.com/')">Open-Meteo</a>。每 15 分钟更新；不读取定位。公共接口供非商业用途，商业使用需相应许可。</p>
</template>

<style scoped>
.city-result{display:flex!important;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;min-height:38px}.city-result span{min-width:0;overflow-wrap:anywhere}.city-result svg{width:16px;height:16px;flex-shrink:0}
.weather-city-heading{gap:6px!important}.weather-city-heading>b{font-size:14px;margin-right:auto}.weather-city-heading>small{font-size:10px}.weather-city-heading button{min-height:26px;font-size:10px;padding:3px 6px}.weather-city-heading .weather-remove{display:grid;place-items:center;width:24px;height:24px;min-height:24px;padding:0;background:transparent;border-color:transparent}.weather-remove svg{width:13px;height:13px}.weather-current{display:flex;align-items:center;gap:8px;font-size:34px!important}.weather-current>svg{width:30px;height:30px;color:#b8e1ca}.weather-current>small{margin-left:2px;font-size:12px}.weather-forecast{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}.weather-forecast>div{display:grid;justify-items:center;gap:5px;padding:9px 3px;border-radius:9px;background:#b8e1ca0b;font-size:10px;text-align:center}.weather-forecast span{color:#d7e3db;line-height:1.5}.weather-forecast b{font-size:11px;font-weight:500;white-space:nowrap}.weather-city>small{font-size:10px}
</style>
