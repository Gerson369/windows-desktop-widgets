<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  back: 'M14 5l-7 7 7 7 M7 12h14',
  calendar: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M13 14h4 M7 18h2',
  note: 'M4 3h16v13l-5 5H4z M15 21v-5h5 M8 8h8 M8 12h6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',
  countdown: 'M6 3h12 M6 21h12 M8 3v4l8 10v4 M16 3v4L8 17v4',
  focus: 'M9 2h6 M12 2v3 M18 5l2 2 M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M12 8v5l3 2',
  weather: 'M8 4v2 M3 8l2 1 M14 4l-1 2 M5 14a5 5 0 0 1 7-7 M7 20a4 4 0 1 1 1-8 6 6 0 0 1 11 2 3 3 0 0 1 0 6z',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 3 M18 18a8 8 0 0 1-13-3',
  desktop: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  collapse: 'M6 15l6-6 6 6',
  expand: 'M6 9l6 6 6-6',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  recycle: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 10v7 M14 10v7',
  layout: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  folder: 'M3 6h7l2 2h9v12H3z M3 8V4h7l2 2',
  todo: 'M9 5h11v16H4V5h2 M9 3h6v4H9z M8 13l3 3 5-6',
  bell: 'M18 8a6 6 0 0 0-12 0v6l-2 3h16l-2-3z M9 21h6',
  settings: 'M9 2h6l.5 3L18 6.5l2.8-1 2.2 4-2.5 2v1l2.5 2-2.2 4-2.8-1-2.5 1.5-.5 3H9l-.5-3L6 17.5l-2.8 1-2.2-4 2.5-2v-1L1 9.5l2.2-4 2.8 1L8.5 5z M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  water: 'M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12z M8 15a4 4 0 0 0 4 4',
  break: 'M12 3v3 M12 9v6 M7 10l5-2 5 2 M12 15l-4 6 M12 15l5 6',
  file: 'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6 6l12 12 M18 6 6 18',
  undo: 'M9 5 4 10l5 5 M4 10h9a7 7 0 0 1 7 7v2',
  check: 'M5 12l4 4L19 6'
}
</script>
<template><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.file"/></svg></template>
