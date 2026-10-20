<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bodyHalfHeight, stepBody, type PhysicsBody } from '../health-physics'

const props = defineProps<{ cup: SVGSVGElement | null; spine: SVGSVGElement | null; spill: number; flooding: number; wet: boolean; separation: number; paused: boolean; boneColor: string }>()
const emit = defineEmits<{ enabled: [value: boolean]; pieces: [ids: number[]] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const counts = ref({ water: 0, bones: 0, active: false })
interface Droplet extends PhysicsBody { splash?: boolean; floor: number }
interface Ripple { x: number; y: number; age: number }
let drops: Droplet[] = [], ripples: Ripple[] = []
const bones = new Map<number, PhysicsBody>()
let waitingBones: Array<{ id: number; body: PhysicsBody }> = [], nextBoneAt = 0
let context: CanvasRenderingContext2D | null = null, frame = 0, last = 0, debt = 0, sequence = 0, width = 0, height = 0, metricsAt = 0
let reduced: MediaQueryList | undefined
const allowed = () => Boolean(context && !document.hidden && !reduced?.matches)
function resize() {
  if (!canvas.value || !context) return
  width = innerWidth; height = innerHeight
  const scale = devicePixelRatio || 1
  canvas.value.width = Math.round(width * scale); canvas.value.height = Math.round(height * scale)
  context.setTransform(scale, 0, 0, scale, 0, 0)
  for (const [id, body] of bones) bones.set(id, { ...body, x: Math.min(width - 5, body.x), y: Math.min(height - 3 - bodyHalfHeight(body), body.y), settled: false })
  waitingBones = []
  synchronizeBones()
  wake()
}
function sourcePoint(svg: SVGSVGElement, x: number, y: number) {
  const matrix = svg.getScreenCTM()
  return matrix ? new DOMPoint(x, y).matrixTransform(matrix) : undefined
}
function synchronizeBones() {
  if (!props.spine || !allowed()) return
  const separated = new Set<number>()
  props.spine.querySelectorAll<SVGRectElement>('rect').forEach((element, id) => {
    if (!element.classList.contains('separated')) return
    separated.add(id)
    if (bones.has(id) || waitingBones.some(piece => piece.id === id)) return
    const box = element.getBBox(), matrix = element.getScreenCTM()
    if (!matrix) return
    const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(matrix)
    const scale = Math.hypot(matrix.a, matrix.b)
    waitingBones.push({ id, body: { x: center.x, y: center.y, vx: (id % 2 ? 1 : -1) * (12 + id), vy: 0,
      width: box.width * scale, height: box.height * scale, angle: Math.atan2(matrix.b, matrix.a), spin: (id % 2 ? 1 : -1) * 2 } })
  })
  for (const id of bones.keys()) if (!separated.has(id)) bones.delete(id)
  waitingBones = waitingBones.filter(piece => separated.has(piece.id))
  emit('pieces', [...bones.keys()])
}
function spawnDrop() {
  if (!props.cup) return
  const right = sequence++ % 2 === 0, point = sourcePoint(props.cup, right ? 33 : 8, 9)
  if (!point) return
  const surface = 40 + (height - 40) * (1 - props.flooding)
  drops.push({ x: point.x, y: point.y, vx: right ? 16 : -16, vy: 0, width: 2.5, height: 5, angle: 0, spin: 0,
    floor: point.y < surface ? Math.min(surface, height - 3) : height - 3 })
}
function draw(now: number) {
  frame = 0
  if (!allowed() || props.paused) { last = 0; return }
  const dt = last ? Math.min(.04, (now - last) / 1000) : 1 / 60
  last = now
  context!.clearRect(0, 0, width, height)
  if (waitingBones.length && now >= nextBoneAt) {
    const piece = waitingBones.shift()!
    bones.set(piece.id, piece.body)
    nextBoneAt = now + 180
    emit('pieces', [...bones.keys()])
  }
  if (props.wet) {
    debt += dt * (3 + props.spill * 12)
    while (debt >= 1 && drops.length < 64) { spawnDrop(); debt-- }
  }
  const nextDrops: Droplet[] = []
  for (const drop of drops) {
    const next = { ...stepBody(drop, dt, drop.floor, width, 0), floor: drop.floor, splash: drop.splash }
    if (next.landed) {
      if (!drop.splash) {
        ripples.push({ x: next.x, y: drop.floor, age: 0 })
        for (const direction of [-1, 1]) if (nextDrops.length < 64) nextDrops.push({ ...next, x: next.x, y: drop.floor - 2, vx: direction * 36, vy: -75, width: 1.5, height: 2, splash: true })
      }
      continue
    }
    nextDrops.push(next)
    context!.fillStyle = '#78cbdc'
    context!.beginPath(); context!.ellipse(next.x, next.y, next.width / 2, next.height / 2 + Math.min(2, Math.abs(next.vy) / 120), 0, 0, Math.PI * 2); context!.fill()
  }
  drops = nextDrops.slice(0, 64)
  ripples = ripples.map(ripple => ({ ...ripple, age: ripple.age + dt })).filter(ripple => ripple.age < .65).slice(-12)
  for (const ripple of ripples) {
    context!.strokeStyle = `rgba(120,203,220,${(1 - ripple.age / .65) * .65})`
    context!.beginPath(); context!.ellipse(ripple.x, ripple.y, 2 + ripple.age * 22, 1 + ripple.age * 3, 0, Math.PI, Math.PI * 2); context!.stroke()
  }
  for (const [id, body] of bones) {
    const next = stepBody(body, dt, height - 3, width, .27); bones.set(id, next)
    context!.save(); context!.translate(next.x, next.y); context!.rotate(next.angle); context!.fillStyle = props.boneColor
    context!.beginPath(); context!.roundRect(-next.width / 2, -next.height / 2, next.width, next.height, 1); context!.fill(); context!.restore()
  }
  if (now - metricsAt > 100) { counts.value = { water: drops.length, bones: bones.size, active: true }; metricsAt = now }
  if (props.wet || drops.length || ripples.length || waitingBones.length || [...bones.values()].some(body => !body.settled)) frame = requestAnimationFrame(draw)
  else { last = 0; counts.value = { water: drops.length, bones: bones.size, active: false } }
}
function wake() {
  const enabled = allowed()
  emit('enabled', enabled)
  if (!enabled || props.paused) { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; counts.value = { ...counts.value, active: false }; return }
  if (!frame) frame = requestAnimationFrame(draw)
}
function reset() {
  if (!props.wet) { drops = []; ripples = []; debt = 0 }
  if (!props.separation) { bones.clear(); waitingBones = []; nextBoneAt = 0; emit('pieces', []) }
  synchronizeBones(); wake()
}
function environmentChanged() {
  if (reduced?.matches) { drops = []; ripples = []; bones.clear(); waitingBones = []; nextBoneAt = 0; emit('pieces', []); context?.clearRect(0, 0, width, height) }
  synchronizeBones(); wake()
}
watch(() => [props.wet, props.spill, props.separation, props.cup, props.spine, props.paused], reset, { flush: 'post' })
onMounted(() => {
  context = canvas.value?.getContext('2d') ?? null
  reduced = matchMedia('(prefers-reduced-motion: reduce)')
  reduced.addEventListener('change', environmentChanged); document.addEventListener('visibilitychange', environmentChanged); window.addEventListener('resize', resize)
  resize(); reset()
})
onBeforeUnmount(() => { if (frame) cancelAnimationFrame(frame); reduced?.removeEventListener('change', environmentChanged); document.removeEventListener('visibilitychange', environmentChanged); window.removeEventListener('resize', resize); emit('enabled', false) })
</script>
<template><canvas ref="canvas" class="health-physics" aria-hidden="true" :data-water-particles="counts.water" :data-fallen-bones="counts.bones" :data-active="counts.active"/></template>
<style scoped>.health-physics{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2}</style>
