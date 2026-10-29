<script setup lang="ts">
import AssistantIcon from './AssistantIcon.vue'
defineProps<{ pending: boolean; progress: number; failed: boolean; completed: boolean }>()
defineEmits<{ undo: [] }>()
</script>
<template>
  <button type="button" class="health-undo" :disabled="pending" aria-label="撤销最近的健康操作" :title="failed ? '撤销未完成，点击重试' : '撤销最近一次操作（15 秒内）'" @click.stop="$emit('undo')">
    <svg class="undo-timer" viewBox="0 0 20 20" aria-hidden="true"><circle class="timer-track" cx="10" cy="10" r="8.5"/><circle class="timer-left" cx="10" cy="10" r="8.5" pathLength="1" stroke-dasharray="1" :stroke-dashoffset="1-progress" transform="rotate(-90 10 10)"/></svg>
    <AssistantIcon :name="failed ? 'refresh' : completed ? 'check' : 'undo'"/>
  </button>
</template>
<style scoped>
.health-undo{position:relative;display:grid;place-items:center;z-index:40;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:#202a25df;color:#c5e6ce;cursor:pointer}
.health-undo>svg{width:12px;height:12px}
.health-undo .undo-timer{position:absolute;inset:0;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1;pointer-events:none}
.timer-track{opacity:.15}.timer-left{transition:stroke-dashoffset .2s linear}
.health-undo:hover:not(:disabled){background:#344a3d}.health-undo:active:not(:disabled){background:#415e4c}
.health-undo:disabled{opacity:.5;cursor:wait}.health-undo:focus-visible{outline:2px solid #c5e6ce;outline-offset:-2px}
@media(prefers-reduced-motion:reduce){.timer-left{transition:none}}
</style>
