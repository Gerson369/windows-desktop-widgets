<script setup lang="ts">
defineProps<{ wet: boolean; level: number; paused: boolean }>()
</script>
<template>
  <div v-if="wet && level > 0" class="health-flood" :class="{paused}" :style="{'--water-level':Math.min(1,level)}" aria-hidden="true" :data-water-level="Math.min(1,level)">
    <div class="health-flood-water"><svg viewBox="0 0 600 12" preserveAspectRatio="none"><path d="M0 6Q25 0 50 6T100 6T150 6T200 6T250 6T300 6T350 6T400 6T450 6T500 6T550 6T600 6V12H0Z"/></svg></div>
  </div>
</template>
<style scoped>
.health-flood{position:fixed;inset:0;overflow:hidden;pointer-events:none;border-radius:5px;z-index:30}
.health-flood-water{position:absolute;left:0;right:0;top:-6px;height:calc(100% + 6px);transform:translateY(calc((1 - var(--water-level))*100%));transition:transform 1s linear;opacity:.24}
.health-flood-water::after{content:'';position:absolute;inset:6px 0 0;background:#78cbdc}
.health-flood svg{position:absolute;left:0;top:-6px;display:block;width:200%;height:12px;fill:#78cbdc;animation:health-flood-swell 4s linear infinite}
.health-flood.paused svg{animation-play-state:paused}
@keyframes health-flood-swell{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.health-flood-water{transition:none}.health-flood svg{animation:none}}
</style>
