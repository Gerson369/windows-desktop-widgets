<script setup lang="ts">
import { toolbox } from '../../toolbox'

const api=toolbox
import {onMounted,onBeforeUnmount,ref} from 'vue'
import type {Metrics} from '../../../main/device-metrics'
const data=ref<Metrics|null>(null),error=ref(''),busy=ref(false)
let timer:ReturnType<typeof setTimeout>|undefined,active=true
const percent=(value:number|null)=>value===null?'首次采样 / 不可读取':`${value.toFixed(1)}%`
function speed(value:number|null){if(value===null)return '等待两次采样';return value>=1048576?`${(value/1048576).toFixed(2)} MB/s`:`${(value/1024).toFixed(1)} KB/s`}
async function refresh(){if(busy.value)return;busy.value=true;try{const next=await api.suite.metrics();if(active){data.value=next;error.value=''}}catch(reason){if(active)error.value=String(reason)}finally{busy.value=false;if(active)timer=setTimeout(()=>{void refresh()},10000)}}
onMounted(()=>{void refresh()})
onBeforeUnmount(()=>{active=false;clearTimeout(timer)})
</script>
<template>
  <template v-if="data">
    <dl class="device-readings">
      <div><dt>处理器 <small>CPU</small></dt><dd>{{percent(data.cpu)}}</dd></div>
      <div><dt>内存</dt><dd>{{(data.memoryUsed/1073741824).toFixed(1)}} <small>/ {{(data.memoryTotal/1073741824).toFixed(1)}} GB</small></dd></div>
      <div><dt>图形处理器 <small>GPU 3D</small></dt><dd>{{percent(data.gpu)}}</dd></div>
      <div><dt>网络下载</dt><dd>{{speed(data.down)}}</dd></div>
      <div><dt>网络上传</dt><dd>{{speed(data.up)}}</dd></div>
      <div v-for="(battery,index) in data.batteries" :key="index"><dt>{{battery.name}}</dt><dd>{{battery.percent}}%</dd></div>
    </dl>
    <p v-if="!data.batteries.length" class="hint">未读取到电池；部分蓝牙设备不向 Windows 提供电量。</p>
    <p v-for="warning in data.warnings" :key="warning" class="hint">{{warning}}</p>
    <small class="device-updated">采样于 {{new Date(data.at).toLocaleTimeString('zh-CN')}} · 约每 10 秒更新</small>
    <p class="hint">GPU 为 3D 引擎合计；虚拟网卡可能与物理网卡重复计数。</p>
  </template>
  <p v-else role="status">正在读取系统信息…</p><p v-if="error" role="alert">{{error}}</p>
</template>
<style scoped>
.device-readings{display:grid;gap:0;margin:0 0 12px}.device-readings>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 2px;border-bottom:1px solid var(--widget-line,#ffffff24)}.device-readings dt{display:grid;gap:3px;font-size:12px;color:#d7e3db;min-width:0;overflow-wrap:anywhere}.device-readings dd{margin:0;font-size:16px;font-weight:500;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}.device-readings small,.device-updated{font-size:10px;color:#bdcbc3}.device-readings dd small{font-size:11px}
</style>
