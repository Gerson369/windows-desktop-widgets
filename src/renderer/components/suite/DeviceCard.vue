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
  <template v-if="data"><div class="entry">CPU <b>{{percent(data.cpu)}}</b></div><div class="entry">内存 <b>{{(data.memoryUsed/1073741824).toFixed(1)}} / {{(data.memoryTotal/1073741824).toFixed(1)}} GB</b></div><div class="entry">GPU 3D 引擎 <b>{{percent(data.gpu)}}</b></div><div class="entry">下载 <b>{{speed(data.down)}}</b><br/>上传 <b>{{speed(data.up)}}</b></div><div v-for="(battery,index) in data.batteries" :key="index" class="entry">{{battery.name}} <b>{{battery.percent}}%</b></div><p v-if="!data.batteries.length" class="hint">未读取到电池。台式机可能没有电池；部分耳机和蓝牙设备不向 Windows 提供电量。</p><p v-for="warning in data.warnings" :key="warning" class="hint">{{warning}}</p><small>采样于 {{new Date(data.at).toLocaleTimeString('zh-CN')}}；约每 10 秒采样。GPU 为 3D 引擎合计，虚拟网卡可能与物理网卡重复计数。</small></template><p v-else role="status">正在读取系统信息…</p><p v-if="error" role="alert">{{error}}</p>
</template>
