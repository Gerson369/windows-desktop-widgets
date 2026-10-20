<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppData, FileResult } from '../../main/types'

const keyword = ref('')
const results = ref<FileResult[]>([])
const selected = ref(0)
const searching = ref(false)
const authorized = ref(false)
const recent = ref<string[]>([])
let timer: number | undefined
let dispose: (() => void) | undefined
let searchGeneration = 0

const visibleResults = computed(() => results.value.slice(0, 9))

async function runSearch(generation = ++searchGeneration) {
  const query = keyword.value.trim()
  if (!query) {
    if (generation === searchGeneration) { results.value = []; selected.value = 0 }
    return
  }
  if (!authorized.value) {
    const allowed = await toolbox.files.requestAuthorization()
    if (!allowed || generation !== searchGeneration) return
    authorized.value = true
  }
  if (generation !== searchGeneration) return
  searching.value = true
  try {
    const found = await toolbox.files.search({ keyword: query })
    if (generation !== searchGeneration) return
    results.value = found
    selected.value = 0
    recent.value = [query, ...recent.value.filter((item) => item !== query)].slice(0, 5)
  } finally {
    if (generation === searchGeneration) searching.value = false
  }
}

function queueSearch() {
  if (timer) window.clearTimeout(timer)
  const generation = ++searchGeneration
  void toolbox.files.cancelSearch()
  timer = window.setTimeout(() => { void runSearch(generation) }, 150)
}

async function open(item = visibleResults.value[selected.value]) {
  if (!item) return
  const error = await toolbox.files.open(item.path)
  if (!error) await toolbox.quickSearch.hide()
}

function move(delta: number) {
  if (!visibleResults.value.length) return
  selected.value = (selected.value + delta + visibleResults.value.length) % visibleResults.value.length
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { void toolbox.quickSearch.hide(); return }
  if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
  if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
  if (event.key === 'Enter') { event.preventDefault(); void open() }
}

onMounted(async () => {
  const data: AppData = await toolbox.data.get()
  authorized.value = data.settings.searchAuthorized
  dispose = toolbox.events.onNavigate(() => undefined)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  if (timer) window.clearTimeout(timer)
  searchGeneration += 1
  void toolbox.files.cancelSearch()
  dispose?.()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <main class="quick-search" @keydown="onKeydown">
    <div class="quick-query"><span>⌕</span><input v-model="keyword" autofocus placeholder="搜索文件、文件夹或应用…" @input="queueSearch"/><kbd>Esc</kbd></div>
    <div v-if="keyword" class="quick-status"><span>{{ searching ? '正在扫描本地文件…' : `${results.length} 个结果` }}</span><span>↑ ↓ 选择 · Enter 打开</span></div>
    <div class="quick-results">
      <button v-for="(item, index) in visibleResults" :key="item.path" :class="{ selected: index === selected }" @mouseenter="selected = index" @click="open(item)"><span>{{ item.isDirectory ? '▰' : '▤' }}</span><div><b>{{ item.name }}</b><small>{{ item.path }}</small></div><i>{{ item.isDirectory ? '文件夹' : item.extension?.toUpperCase() || '文件' }}</i></button>
      <p v-if="keyword && !searching && !visibleResults.length">未找到匹配结果。</p>
      <div v-if="!keyword" class="quick-empty"><b>本机快速搜索</b><p>输入即搜；仅在你查询时扫描本地文件。</p><div v-if="recent.length"><span>近期查询：</span><button v-for="item in recent" :key="item" @click="keyword = item; runSearch()">{{ item }}</button></div></div>
    </div>
  </main>
</template>

<style scoped>
:global(html), :global(body), :global(#app) { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
.quick-search { box-sizing: border-box; width: 100%; height: 100%; padding: 10px; border: 1px solid rgba(179,196,255,.44); border-radius: 8px; color: #edf2ff; background: rgba(13,22,38,.96); box-shadow: 0 18px 46px rgba(0,0,0,.36); font: 14px/1.4 "Microsoft YaHei", "Segoe UI", sans-serif; }
.quick-query { display: flex; align-items: center; gap: 9px; padding: 4px 7px; border: 1px solid rgba(164,187,255,.25); border-radius: 5px; background: rgba(255,255,255,.055); }
.quick-query > span { color: #99adff; font-size: 23px; }
.quick-query input { min-width: 0; flex: 1; height: 36px; color: #f4f6ff; font: inherit; border: 0; outline: 0; background: transparent; }
.quick-query input::placeholder { color: #aab4cb; }
.quick-query kbd { padding: 2px 5px; color: #b7c0d5; border: 1px solid rgba(255,255,255,.14); border-radius: 3px; font-size: 11px; }
.quick-status { display: flex; justify-content: space-between; padding: 8px 5px 6px; color: #9eabc7; font-size: 11px; }
.quick-results { display: grid; gap: 3px; }
.quick-results > button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; color: inherit; text-align: left; border: 1px solid transparent; border-radius: 5px; background: transparent; }
.quick-results > button.selected, .quick-results > button:hover { border-color: rgba(153,173,255,.28); background: rgba(109,140,255,.18); }
.quick-results > button > span { display: grid; place-items: center; width: 25px; height: 25px; color: #9fb0ff; border-radius: 4px; background: rgba(138,160,255,.12); }
.quick-results > button > div { min-width: 0; flex: 1; display: grid; }
.quick-results b, .quick-results small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick-results small { color: #aeb8ce; font-size: 11px; }
.quick-results i { color: #9ba9c9; font-size: 11px; font-style: normal; }
.quick-results > p { padding: 32px 0; color: #aab4ca; text-align: center; }
.quick-empty { padding: 40px 10px; color: #b4bfd5; text-align: center; }
.quick-empty b { color: #eff3ff; }
.quick-empty p { margin: 6px 0 18px; }
.quick-empty div { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; font-size: 12px; }
.quick-empty button { padding: 3px 6px; color: #d7def3; border: 1px solid rgba(255,255,255,.12); border-radius: 4px; background: rgba(255,255,255,.06); }
</style>
