<script setup lang="ts">
import { toolbox } from '../toolbox'

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

type Tool = 'pen' | 'rect' | 'arrow' | 'text'
type Point = { x: number; y: number }
type Selection = { x: number; y: number; width: number; height: number }
type CaptureSource = { dataUrl: string; width: number; height: number }

const stage = ref<HTMLElement | null>(null)
const editorCanvas = ref<HTMLCanvasElement | null>(null)
const source = ref<CaptureSource | null>(null)
const sourceImage = new Image()
const loading = ref(true)
const error = ref('')
const mode = ref<'select' | 'edit'>('select')
const tool = ref<Tool>('pen')
const color = ref('#ff3b30')
const lineWidth = ref(4)
const selecting = ref(false)
const drawing = ref(false)
const start = ref<Point | null>(null)
const current = ref<Point | null>(null)
const crop = ref<Selection | null>(null)
const history = ref<ImageData[]>([])
const originalCrop = ref<ImageData | null>(null)
const drawSnapshot = ref<ImageData | null>(null)
const saving = ref(false)

const selectionStyle = computed(() => {
  if (!start.value || !current.value) return {}
  const x = Math.min(start.value.x, current.value.x)
  const y = Math.min(start.value.y, current.value.y)
  return { left: `${x}px`, top: `${y}px`, width: `${Math.abs(current.value.x - start.value.x)}px`, height: `${Math.abs(current.value.y - start.value.y)}px` }
})

const clampPoint = (event: PointerEvent, element: HTMLElement): Point => {
  const bounds = element.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
    y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
  }
}

const canvasPoint = (event: PointerEvent): Point | null => {
  const canvas = editorCanvas.value
  if (!canvas) return null
  const bounds = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) * canvas.width / bounds.width,
    y: (event.clientY - bounds.top) * canvas.height / bounds.height
  }
}

const drawArrow = (context: CanvasRenderingContext2D, from: Point, to: Point) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const head = Math.max(12, lineWidth.value * 4)
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6))
  context.moveTo(to.x, to.y)
  context.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6))
  context.stroke()
}

const resetCanvasToSnapshot = () => {
  const canvas = editorCanvas.value
  const snapshot = drawSnapshot.value
  const context = canvas?.getContext('2d')
  if (canvas && snapshot && context) context.putImageData(snapshot, 0, 0)
}

const configureContext = (context: CanvasRenderingContext2D) => {
  context.strokeStyle = color.value
  context.fillStyle = color.value
  context.lineWidth = lineWidth.value
  context.lineCap = 'round'
  context.lineJoin = 'round'
}

const startSelection = (event: PointerEvent) => {
  if (mode.value !== 'select' || !stage.value) return
  stage.value.setPointerCapture(event.pointerId)
  selecting.value = true
  start.value = clampPoint(event, stage.value)
  current.value = start.value
}

const moveSelection = (event: PointerEvent) => {
  if (!selecting.value || !stage.value) return
  current.value = clampPoint(event, stage.value)
}

const finishSelection = async () => {
  if (!selecting.value || !start.value || !current.value || !stage.value || !source.value) return
  selecting.value = false
  const left = Math.min(start.value.x, current.value.x)
  const top = Math.min(start.value.y, current.value.y)
  const width = Math.abs(current.value.x - start.value.x)
  const height = Math.abs(current.value.y - start.value.y)
  if (width < 12 || height < 12) {
    start.value = null
    current.value = null
    return
  }
  const bounds = stage.value.getBoundingClientRect()
  crop.value = {
    x: Math.round(left * source.value.width / bounds.width),
    y: Math.round(top * source.value.height / bounds.height),
    width: Math.round(width * source.value.width / bounds.width),
    height: Math.round(height * source.value.height / bounds.height)
  }
  mode.value = 'edit'
  await nextTick()
  const canvas = editorCanvas.value
  const capture = crop.value
  if (!canvas || !capture) return
  canvas.width = capture.width
  canvas.height = capture.height
  const context = canvas.getContext('2d')
  if (!context) return
  context.drawImage(sourceImage, capture.x, capture.y, capture.width, capture.height, 0, 0, capture.width, capture.height)
  originalCrop.value = context.getImageData(0, 0, canvas.width, canvas.height)
  history.value = []
}

const beginDrawing = (event: PointerEvent) => {
  const canvas = editorCanvas.value
  const context = canvas?.getContext('2d')
  const point = canvasPoint(event)
  if (!canvas || !context || !point) return
  canvas.setPointerCapture(event.pointerId)
  if (tool.value === 'text') {
    const value = window.prompt('输入标注文字：')?.trim()
    if (!value) return
    history.value.push(context.getImageData(0, 0, canvas.width, canvas.height))
    configureContext(context)
    context.font = `${Math.max(16, lineWidth.value * 5)}px system-ui, sans-serif`
    context.fillText(value, point.x, point.y)
    return
  }
  drawing.value = true
  start.value = point
  current.value = point
  drawSnapshot.value = context.getImageData(0, 0, canvas.width, canvas.height)
  history.value.push(drawSnapshot.value)
  configureContext(context)
  if (tool.value === 'pen') {
    context.beginPath()
    context.moveTo(point.x, point.y)
  }
}

const draw = (event: PointerEvent) => {
  if (!drawing.value || !start.value) return
  const canvas = editorCanvas.value
  const context = canvas?.getContext('2d')
  const point = canvasPoint(event)
  if (!canvas || !context || !point) return
  configureContext(context)
  if (tool.value === 'pen') {
    context.lineTo(point.x, point.y)
    context.stroke()
  } else {
    resetCanvasToSnapshot()
    if (tool.value === 'rect') context.strokeRect(start.value.x, start.value.y, point.x - start.value.x, point.y - start.value.y)
    if (tool.value === 'arrow') drawArrow(context, start.value, point)
  }
  current.value = point
}

const finishDrawing = () => {
  drawing.value = false
  drawSnapshot.value = null
  start.value = null
  current.value = null
}

const undo = () => {
  const canvas = editorCanvas.value
  const context = canvas?.getContext('2d')
  const previous = history.value.pop()
  if (context && previous) context.putImageData(previous, 0, 0)
}

const clearAnnotations = () => {
  const canvas = editorCanvas.value
  const context = canvas?.getContext('2d')
  if (context && originalCrop.value) {
    context.putImageData(originalCrop.value, 0, 0)
    history.value = []
  }
}

const cancel = async () => {
  try { await toolbox.capture.cancel() } catch { window.close() }
}

const save = async () => {
  const canvas = editorCanvas.value
  if (!canvas || saving.value) return
  saving.value = true
  try { await toolbox.capture.complete(canvas.toDataURL('image/png')) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '无法保存截图。'; saving.value = false }
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') void cancel()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo() }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save() }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    source.value = await toolbox.capture.getSource()
    sourceImage.onload = () => { loading.value = false }
    sourceImage.onerror = () => { error.value = '无法读取屏幕图像。'; loading.value = false }
    sourceImage.src = source.value.dataUrl
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '截图初始化失败。'
    loading.value = false
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <main class="capture-overlay">
    <section v-if="error" class="capture-error"><h1>截图工具无法启动</h1><p>{{ error }}</p><button @click="cancel">关闭</button></section>
    <template v-else-if="source">
      <div v-if="mode === 'select'" ref="stage" class="selection-stage" @pointerdown="startSelection" @pointermove="moveSelection" @pointerup="finishSelection">
        <img :src="source.dataUrl" alt="当前屏幕" draggable="false" />
        <div class="selection-shade"></div>
        <div v-if="start && current" class="selection-box" :style="selectionStyle"><span>{{ Math.round(Math.abs((current?.x || 0) - (start?.x || 0))) }} × {{ Math.round(Math.abs((current?.y || 0) - (start?.y || 0))) }}</span></div>
        <div class="selection-help"><b>拖动选择截图区域</b><span>Esc 取消</span></div>
      </div>
      <section v-else class="editor-stage">
        <header class="editor-toolbar">
          <div class="tool-group" aria-label="标注工具"><button :class="{ active: tool === 'pen' }" title="画笔" @click="tool = 'pen'">画笔</button><button :class="{ active: tool === 'rect' }" title="矩形" @click="tool = 'rect'">矩形</button><button :class="{ active: tool === 'arrow' }" title="箭头" @click="tool = 'arrow'">箭头</button><button :class="{ active: tool === 'text' }" title="文字" @click="tool = 'text'">文字</button></div>
          <label>颜色 <input v-model="color" type="color" /></label><label>粗细 <input v-model.number="lineWidth" type="range" min="2" max="16" /></label>
          <div class="toolbar-actions"><button :disabled="!history.length" @click="undo">撤销</button><button @click="clearAnnotations">清除标注</button><button @click="cancel">取消</button><button class="save" :disabled="saving" @click="save">{{ saving ? '正在保存…' : '复制并完成' }}</button></div>
        </header>
        <div class="canvas-wrap"><canvas ref="editorCanvas" @pointerdown="beginDrawing" @pointermove="draw" @pointerup="finishDrawing" @pointerleave="finishDrawing"></canvas></div>
        <footer><span>选区截图将复制到剪贴板</span><span>Ctrl / ⌘ + Z 撤销 · Ctrl / ⌘ + Enter 完成</span></footer>
      </section>
    </template>
    <div v-else class="loading">{{ loading ? '正在准备截图…' : '无法准备截图。' }}</div>
  </main>
</template>

<style scoped>
.capture-overlay { width: 100vw; height: 100vh; overflow: hidden; background: #090c12; color: #fff; font-family: Inter, "Microsoft YaHei", sans-serif; }
.selection-stage { position: relative; width: 100%; height: 100%; cursor: crosshair; user-select: none; touch-action: none; }
.selection-stage > img { width: 100%; height: 100%; object-fit: fill; display: block; pointer-events: none; }
.selection-shade { position: absolute; inset: 0; background: rgba(0, 0, 0, .42); pointer-events: none; }
.selection-box { position: absolute; box-sizing: border-box; border: 2px solid #73a7ff; box-shadow: 0 0 0 9999px rgba(0,0,0,.28); pointer-events: none; }
.selection-box span { position: absolute; left: 0; bottom: calc(100% + 7px); padding: 5px 8px; border-radius: 6px; background: #1769e0; font-size: 12px; white-space: nowrap; }
.selection-help { position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%); display: flex; gap: 16px; align-items: center; padding: 11px 16px; border: 1px solid rgba(255,255,255,.18); border-radius: 10px; background: rgba(14,18,28,.82); box-shadow: 0 12px 30px rgba(0,0,0,.3); font-size: 13px; pointer-events: none; }
.selection-help span { color: #b6c0d2; }
.editor-stage { display: flex; flex-direction: column; width: 100%; height: 100%; background: rgba(11,15,24,.97); }
.editor-toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 10px 18px; border-bottom: 1px solid #2a3345; background: #121a2a; }
.tool-group, .toolbar-actions { display: flex; gap: 6px; }
.editor-toolbar button { border: 1px solid #3b4962; border-radius: 7px; background: #202b40; color: #eaf0ff; padding: 7px 10px; cursor: pointer; }
.editor-toolbar button:hover, .editor-toolbar button.active { background: #2e66bc; border-color: #74a9ff; }
.editor-toolbar button:disabled { cursor: not-allowed; opacity: .45; }
.editor-toolbar .save { background: #1870e4; border-color: #75aeff; }
.editor-toolbar label { display: inline-flex; align-items: center; gap: 6px; color: #c8d2e4; font-size: 13px; }
.editor-toolbar input[type="color"] { width: 28px; height: 28px; border: 0; padding: 0; background: none; cursor: pointer; }
.editor-toolbar input[type="range"] { width: 88px; accent-color: #4a8fff; }
.toolbar-actions { margin-left: auto; }
.canvas-wrap { flex: 1; min-height: 0; display: grid; place-items: center; overflow: auto; padding: 24px; background: linear-gradient(45deg, #171d2a 25%, #131a27 25%, #131a27 50%, #171d2a 50%, #171d2a 75%, #131a27 75%); background-size: 22px 22px; }
.canvas-wrap canvas { max-width: 92vw; max-height: calc(100vh - 150px); box-shadow: 0 12px 46px rgba(0,0,0,.55); cursor: crosshair; touch-action: none; }
.editor-stage footer { display: flex; justify-content: space-between; padding: 9px 18px; color: #91a0ba; font-size: 12px; border-top: 1px solid #2a3345; background: #121a2a; }
.loading, .capture-error { display: grid; place-items: center; align-content: center; gap: 12px; width: 100%; height: 100%; background: #121a2a; }
.capture-error p { color: #c2cee2; }.capture-error button { border: 0; border-radius: 8px; padding: 9px 16px; background: #2e66bc; color: white; cursor: pointer; }
</style>
