<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount} from 'vue'
import {toolbox} from '../toolbox'
import {useDesktopDrag} from '../useDesktopDrag'
import WellnessControls from './WellnessControls.vue'
import type {AppData} from '../../main/types'
const data=ref<AppData|null>(null),error=ref(''),drag=useDesktopDrag()
let dispose:(()=>void)|undefined
onMounted(async()=>{dispose=toolbox.data.onChanged(value=>data.value=value);try{data.value=await toolbox.data.get()}catch(reason){error.value=String(reason)}})
onBeforeUnmount(()=>dispose?.())
</script>
<template>
<main class="health-panel" :style="{'--health-alpha':(data?.settings.desktopModuleOpacity ?? 70)/100}">
 <header @pointerdown="drag.start" @pointermove="drag.move" @pointerup="drag.finish" @pointercancel="drag.finish" @lostpointercapture="drag.finish"><span>⠿ 喝水与活动</span></header>
 <p v-if="error" role="alert">{{error}}</p>
 <WellnessControls v-if="data" :data="data"/>
</main>
</template>
<style scoped>
.health-panel{height:100vh;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;border:1px solid #ffffff36;border-radius:6px;overflow:hidden;background:color-mix(in srgb,var(--widget-background,#232729) calc(var(--health-alpha,.7)*100%),transparent);color:var(--widget-text,#f4f7f6);font:11px 'Microsoft YaHei UI',sans-serif}header{height:24px;flex:0 0 24px;display:flex;align-items:center;justify-content:space-between;padding:0 9px;cursor:grab;user-select:none}.health-panel :deep(.wellness-controls){border-top:0;flex:1;align-items:flex-end;padding-top:6px;padding-bottom:10px}.health-panel :deep(.health-error){bottom:calc(100% - 20px);max-height:54px;overflow:auto;font-size:10px;padding:4px 6px;z-index:12}.health-panel :deep(.health-receipt){bottom:calc(100% - 4px);font-size:10px;min-height:18px;padding:3px 6px}p{font-size:10px;margin:0 8px;color:#ffb0a5}
</style>
