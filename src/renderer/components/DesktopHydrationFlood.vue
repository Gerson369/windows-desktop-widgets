<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { hydrationReminderVisual, type WellnessSnapshot } from '../../main/wellness-reminders'
import { panelFloodLevel } from '../health-effects'
import { toolbox } from '../toolbox'
import HydrationFlood from './HydrationFlood.vue'

const props = defineProps<{ panelKey: string }>()
const snapshot = ref<WellnessSnapshot | null>(null)
const water = computed(() => snapshot.value ? hydrationReminderVisual(snapshot.value, snapshot.value.now) : undefined)
const index = computed(() => snapshot.value?.floodOrder?.indexOf(props.panelKey) ?? -1)
const level = computed(() => water.value ? panelFloodLevel(water.value.percent, water.value.overdue, index.value) : 0)
let dispose: (() => void) | undefined
let disposed = false
onMounted(async () => {
  dispose = toolbox.wellness.onChanged(value => { snapshot.value = value })
  try {
    const initial = await toolbox.wellness.get()
    if (!disposed && !snapshot.value) snapshot.value = initial
  } catch { /* The next reminder broadcast restores the visual without blocking the page. */ }
})
onBeforeUnmount(() => { disposed = true; dispose?.() })
</script>
<template>
  <HydrationFlood :key="index" :wet="water?.overdue ?? false" :level="level" :paused="snapshot?.paused ?? false"/>
</template>
