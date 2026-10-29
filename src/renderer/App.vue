<script setup lang="ts">
import SuiteWidget from './components/SuiteWidget.vue'
import AssistantPanel from './components/AssistantPanel.vue'
import HealthPanel from './components/HealthPanel.vue'
import FloatingNote from './components/FloatingNote.vue'
import DesktopCollection from './components/DesktopCollection.vue'
import DesktopZoneWindow from './components/DesktopZoneWindow.vue'
import DesktopHydrationFlood from './components/DesktopHydrationFlood.vue'
import { extraWidgetKinds } from '../main/widget-suite'
const query = new URLSearchParams(location.search)
const dashboard = query.has('dashboard'), noteId = query.get('note'), moduleId = query.get('desktopModule'), zoneId = query.get('desktopZone')
const standaloneHealth = !dashboard && !noteId && moduleId === 'health'
const floodPanelKey = dashboard ? 'main' : noteId ? `note:${noteId}` : moduleId || (zoneId ? `zone:${zoneId}` : 'main')
</script>
<template>
  <AssistantPanel v-if="dashboard"/>
  <FloatingNote v-else-if="noteId" :note-id="noteId"/>
  <HealthPanel v-else-if="standaloneHealth"/>
  <SuiteWidget v-else-if="moduleId && (extraWidgetKinds as readonly string[]).includes(moduleId)" :module-id="moduleId"/>
  <DesktopCollection v-else-if="moduleId === 'quick'"/>
  <AssistantPanel v-else-if="moduleId"/>
  <DesktopZoneWindow v-else-if="zoneId" :zone-id="zoneId"/>
  <AssistantPanel v-else initial-settings/>
  <DesktopHydrationFlood v-if="!standaloneHealth" :panel-key="floodPanelKey"/>
</template>
