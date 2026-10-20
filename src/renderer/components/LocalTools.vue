<script setup lang="ts">
import { ref } from 'vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

const qrText = ref('')
const qrImage = ref('')
const qrStatus = ref('')
const imageSource = ref('')
const imageName = ref('')
const imageOutput = ref('')
const imageStatus = ref('')
const outputFormat = ref<'image/webp' | 'image/jpeg' | 'image/png'>('image/webp')
const quality = ref(82)
const scale = ref(100)
const pickedColor = ref('#6d8cff')
const colorStatus = ref('')

async function pickColor() {
  const EyeDropper = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
  if (!EyeDropper) { colorStatus.value = '当前系统未提供屏幕取色器，可使用颜色框手动选择。'; return }
  try { pickedColor.value = (await new EyeDropper().open()).sRGBHex; colorStatus.value = '已从屏幕取色。' }
  catch { colorStatus.value = '已取消取色。' }
}

async function copyColor() {
  try { await navigator.clipboard.writeText(pickedColor.value); colorStatus.value = '颜色值已复制。' }
  catch { colorStatus.value = '无法复制颜色值。' }
}

function download(dataUrl: string, name: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = name
  anchor.click()
}

async function generateQr() {
  const content = qrText.value.trim()
  if (!content) { qrStatus.value = '请输入文字或链接。'; return }
  try {
    qrImage.value = await QRCode.toDataURL(content, { errorCorrectionLevel: 'M', margin: 1, width: 420, color: { dark: '#101928', light: '#ffffff' } })
    qrStatus.value = '二维码已在本机生成。'
  } catch { qrStatus.value = '二维码生成失败，请缩短内容后重试。' }
}

async function decodeQr(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const source = await fileToDataUrl(file)
    const image = await loadImage(source)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) { qrStatus.value = '当前环境无法读取图片。'; return }
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })
    if (result?.data) { qrText.value = result.data; qrStatus.value = '已识别二维码内容。' }
    else qrStatus.value = '未识别到二维码，请使用清晰、完整的二维码图片。'
  } catch { qrStatus.value = '无法读取该图片，请选择有效的二维码图片。' }
}

async function loadImageFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    imageSource.value = await fileToDataUrl(file)
    imageName.value = file.name.replace(/\.[^.]+$/, '') || 'image'
    imageOutput.value = ''
    imageStatus.value = `已载入 ${file.name}，可设置格式、质量与缩放后导出。`
  } catch { imageStatus.value = '无法读取该图片。' }
}

async function renderImage() {
  if (!imageSource.value) { imageStatus.value = '请先选择一张图片。'; return }
  try {
    const image = await loadImage(imageSource.value)
    const ratio = Math.max(10, Math.min(100, scale.value)) / 100
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = canvas.getContext('2d')
    if (!context) { imageStatus.value = '当前环境无法处理图片。'; return }
    if (outputFormat.value === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    imageOutput.value = canvas.toDataURL(outputFormat.value, Math.max(.1, Math.min(1, quality.value / 100)))
    const extension = outputFormat.value.split('/')[1].replace('jpeg', 'jpg')
    imageStatus.value = `已在本机生成 ${canvas.width} × ${canvas.height} 的 ${extension.toUpperCase()} 预览。`
  } catch {
    imageOutput.value = ''
    imageStatus.value = '无法处理该图片，请选择有效、未损坏的图片。'
  }
}

function saveImage() {
  if (!imageOutput.value) { imageStatus.value = '请先生成预览。'; return }
  const extension = outputFormat.value.split('/')[1].replace('jpeg', 'jpg')
  download(imageOutput.value, `${imageName.value || 'image'}-processed.${extension}`)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source })
}
</script>

<template>
  <div class="color-tool glass-card local-tool-card"><div class="pane-heading"><div><h3>取色器</h3><p>优先从屏幕取色；不可用时可手动选择并复制 HEX</p></div></div><div class="color-picker-row"><input v-model="pickedColor" type="color" aria-label="选择颜色"/><code>{{ pickedColor.toUpperCase() }}</code><button class="secondary" @click="pickColor">从屏幕取色</button><button class="primary" @click="copyColor">复制颜色</button></div><p class="tool-status">{{ colorStatus || '不会保存或上传屏幕内容。' }}</p></div>
  <div class="local-tools-grid">
    <article class="glass-card local-tool-card"><div class="pane-heading"><div><h3>二维码</h3><p>本机生成与识别，不上传文字或图片</p></div></div><textarea v-model="qrText" placeholder="输入链接、文本或 Wi-Fi 信息…"></textarea><div class="tool-actions"><button class="primary" @click="generateQr">生成二维码</button><label class="secondary file-label">识别二维码<input type="file" accept="image/*" @change="decodeQr"/></label></div><div v-if="qrImage" class="qr-preview"><img :src="qrImage" alt="本机生成的二维码"/><button class="secondary" @click="download(qrImage, 'gerson-qr-code.png')">下载 PNG</button></div><p class="tool-status">{{ qrStatus || '二维码内容仅在当前窗口中处理。' }}</p></article>
    <article class="glass-card local-tool-card"><div class="pane-heading"><div><h3>图片格式转换与压缩</h3><p>在当前窗口通过画布处理，不上传原图</p></div></div><label class="image-picker"><span>选择图片</span><input type="file" accept="image/*" @change="loadImageFile"/></label><div class="image-options"><label>输出格式<select v-model="outputFormat"><option value="image/webp">WEBP</option><option value="image/jpeg">JPG</option><option value="image/png">PNG</option></select></label><label>质量 <b>{{ quality }}%</b><input v-model.number="quality" type="range" min="20" max="100"/></label><label>缩放 <b>{{ scale }}%</b><input v-model.number="scale" type="range" min="10" max="100"/></label></div><div class="tool-actions"><button class="secondary" @click="renderImage">生成预览</button><button class="primary" :disabled="!imageOutput" @click="saveImage">下载处理结果</button></div><img v-if="imageOutput || imageSource" class="image-preview" :src="imageOutput || imageSource" alt="图片处理预览"/><p class="tool-status">{{ imageStatus || '选择图片后可调整质量、缩放和格式。' }}</p></article>
  </div>
</template>

<style scoped>
.color-tool { margin-top: 16px; }
.color-picker-row { display: flex; align-items: center; gap: 9px; }
.color-picker-row input { width: 42px; height: 34px; padding: 2px; border: 0; background: transparent; }
.color-picker-row code { min-width: 83px; color: var(--text); }
.local-tools-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
.local-tool-card { min-width: 0; padding: 17px; }
.local-tool-card textarea { width: 100%; min-height: 66px; box-sizing: border-box; resize: vertical; }
.tool-actions { display: flex; gap: 8px; margin-top: 9px; }
.file-label, .image-picker { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.file-label input, .image-picker input { display: none; }
.qr-preview { display: flex; align-items: center; gap: 13px; margin-top: 12px; }
.qr-preview img { width: 100px; height: 100px; padding: 5px; border-radius: 5px; background: white; }
.tool-status { min-height: 17px; margin: 9px 0 0; color: var(--muted); font-size: 11px; }
.image-picker { width: 100%; min-height: 41px; border: 1px dashed rgba(255,255,255,.2); border-radius: 6px; color: var(--muted); background: rgba(255,255,255,.025); }
.image-picker:hover { border-color: var(--accent); color: var(--text); }
.image-options { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 10px; }
.image-options label { display: grid; gap: 4px; color: var(--muted); font-size: 11px; }
.image-options b { color: var(--text); font-weight: 600; }
.image-preview { display: block; max-width: 100%; max-height: 158px; margin: 11px auto 0; border-radius: 5px; object-fit: contain; }
@media (max-width: 900px) { .local-tools-grid { grid-template-columns: 1fr; } }
</style>
