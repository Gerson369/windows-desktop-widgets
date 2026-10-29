const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { renderToString } = require('vue/server-renderer')
const { loadTypeScript } = require('./load-typescript.cjs')

function loadComponent(filename, dependencies = {}, { inlineTemplate = true, vueApi = vue, globals = {} } = {}) {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'))
  const script = compileScript(descriptor, { id: 'health-flood-test', inlineTemplate })
  const compiled = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = { exports: {}, ...globals, require: id => {
    if (id === 'vue') return vueApi
    if (Object.hasOwn(dependencies, id)) return dependencies[id]
    throw Error(`Unexpected flood dependency: ${id}`)
  } }
  vm.runInNewContext(compiled, context)
  return context.exports.default
}

const flood = loadComponent('src/renderer/components/HydrationFlood.vue')
const physics = loadComponent('src/renderer/components/HealthPhysics.vue', {
  './HydrationFlood.vue': { default: flood },
  '../health-physics': loadTypeScript('src/renderer/health-physics.ts')
})
const render = props => renderToString(vue.createSSRApp(physics, {
  cup: null, spine: null, spill: 1, wet: true, separation: 0, paused: false, boneColor: '#c1e4bb', ...props
}))

test('water accumulation reaches the full component, pauses without disappearing and drains after drinking', async () => {
  const { waterOverflowEffects } = loadTypeScript('src/renderer/health-effects.ts')
  const justFull = await render({ flooding: waterOverflowEffects(100, true).flood })
  assert.doesNotMatch(justFull, /class="health-flood"/)

  const halfway = await render({ flooding: waterOverflowEffects(250, true).flood })
  assert.match(halfway, /data-water-level="0.5"/)

  const full = await render({ flooding: waterOverflowEffects(400, true).flood })
  assert.match(full, /data-water-level="1"/)
  assert.match(full, /aria-hidden="true"/)
  assert.doesNotMatch(full, /<button|<input/)

  const paused = await render({ flooding: 1, paused: true })
  assert.match(paused, /class="health-flood paused"/)
  assert.match(paused, /data-water-level="1"/)

  const drained = await render({ flooding: 1, wet: false })
  assert.doesNotMatch(drained, /class="health-flood"/)
  const restarted = await render({ flooding: waterOverflowEffects(1, false).flood, wet: false })
  assert.doesNotMatch(restarted, /data-water-level=/)
})

async function floodAdapter({ initial, failGet = false, getGate, panelKey = 'quick' } = {}) {
  const mounted = [], unmounted = []
  let listener, state, disposals = 0
  const toolbox = { wellness: {
    get: async () => { if (getGate) await getGate; if (failGet) throw Error('initial status unavailable'); return initial },
    onChanged: callback => { listener = callback; return () => { listener = undefined; disposals++ } }
  } }
  const component = loadComponent('src/renderer/components/DesktopHydrationFlood.vue', {
    './HydrationFlood.vue': { default: flood },
    '../toolbox': { toolbox },
    '../../main/wellness-reminders': loadTypeScript('src/main/wellness-reminders.ts'),
    '../health-effects': loadTypeScript('src/renderer/health-effects.ts')
  }, { inlineTemplate: false, vueApi: { ...vue, onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback) } })
  await renderToString(vue.createSSRApp({ props: component.props, setup(props, context) { state = component.setup(props, context); return () => null } }, { panelKey }))
  return {
    mount: () => Promise.all(mounted.map(callback => callback())),
    unmount: () => unmounted.forEach(callback => callback()),
    update: value => listener?.(value),
    render: () => renderToString(vue.createSSRApp(flood, { wet: state.water.value?.overdue ?? false, level: state.level.value, paused: state.snapshot.value?.paused ?? false })),
    get disposals() { return disposals }
  }
}
const snapshotAt = (percent, paused = false, floodOrder = ['health', 'quick', 'todos', 'zone:demo', 'note:demo', 'main']) => ({ state: { hydration: { startedAt: 0, dueAt: 60000, intervalMinutes: 1 } }, paused, now: percent * 600, floodOrder })

test('visible panels fill one after another, with no water in an unknown slot or before overflow', () => {
  const { panelFloodLevel } = loadTypeScript('src/renderer/health-effects.ts')
  for (const [percent, levels] of [[100, [0, 0, 0]], [250, [.5, 0, 0]], [400, [1, 0, 0]], [550, [1, .5, 0]], [700, [1, 1, 0]], [850, [1, 1, .5]], [1000, [1, 1, 1]]]) {
    assert.deepEqual([0, 1, 2].map(index => panelFloodLevel(percent, true, index)), levels)
  }
  for (const index of [-1, NaN, .5]) assert.equal(panelFloodLevel(1000, true, index), 0)
  assert.equal(panelFloodLevel(1000, false, 0), 0)
  assert.equal(panelFloodLevel(Infinity, true, 0), 0)
})

test('other panels derive their own half/full/drained water level from the shared clock and stable order', async () => {
  const panel = await floodAdapter({ initial: snapshotAt(100) })
  try {
    await panel.mount()
    assert.doesNotMatch(await panel.render(), /data-water-level=/)
    panel.update(snapshotAt(250))
    assert.doesNotMatch(await panel.render(), /data-water-level=/)
    panel.update(snapshotAt(550))
    assert.match(await panel.render(), /data-water-level="0.5"/)
    panel.update(snapshotAt(700, true))
    assert.match(await panel.render(), /class="health-flood paused"/)
    assert.match(await panel.render(), /data-water-level="1"/)
    panel.update(snapshotAt(0))
    assert.doesNotMatch(await panel.render(), /data-water-level=/)
    panel.update({ ...snapshotAt(1000), hydrationPlan: { status: 'complete' } })
    assert.doesNotMatch(await panel.render(), /data-water-level=/)
  } finally { panel.unmount() }
  assert.equal(panel.disposals, 1)
})

test('initial read failure leaves the page usable and a newer broadcast wins over a slow initial read', async () => {
  const failed = await floodAdapter({ failGet: true })
  await failed.mount()
  assert.doesNotMatch(await failed.render(), /data-water-level=/)
  failed.update(snapshotAt(700))
  assert.match(await failed.render(), /data-water-level="1"/)
  failed.unmount()
  failed.update(snapshotAt(0))
  assert.match(await failed.render(), /data-water-level="1"/)
  assert.equal(failed.disposals, 1)

  let release
  const slow = await floodAdapter({ initial: snapshotAt(100), getGate: new Promise(resolve => { release = resolve }) })
  const ready = slow.mount()
  slow.update(snapshotAt(700))
  release(); await ready
  assert.match(await slow.render(), /data-water-level="1"/)
  slow.unmount()
})

test('missing order or unknown panel does not fill, while hidden panels are skipped by the supplied order', async () => {
  const panel = await floodAdapter({ initial: { ...snapshotAt(1000), floodOrder: undefined } })
  await panel.mount()
  assert.doesNotMatch(await panel.render(), /data-water-level=/)
  panel.update(snapshotAt(1000, false, ['health', 'todos']))
  assert.doesNotMatch(await panel.render(), /data-water-level=/)
  panel.update(snapshotAt(250, false, ['quick', 'todos']))
  assert.match(await panel.render(), /data-water-level="0.5"/)
  panel.unmount()
})

test('every non-health route mounts one shared adapter while the health route keeps its original layer', async () => {
  const stub = label => ({ render: () => vue.h('main', { 'data-page': label }) })
  const dependencies = Object.fromEntries(['SuiteWidget', 'AssistantPanel', 'HealthPanel', 'FloatingNote', 'DesktopCollection', 'DesktopZoneWindow'].map(name => [`./components/${name}.vue`, { default: stub(name) }]))
  dependencies['./components/DesktopHydrationFlood.vue'] = { default: { render: () => vue.h('aside', { 'data-flood-adapter': true }) } }
  dependencies['../main/widget-suite'] = loadTypeScript('src/main/widget-suite.ts')
  for (const [query, key] of [['', 'main'], ['?dashboard', 'main'], ['?desktopModule=todos', 'todos'], ['?desktopModule=quick', 'quick'], ['?desktopModule=calendar', 'calendar'], ['?desktopZone=demo', 'zone:demo'], ['?note=demo', 'note:demo'], ['?desktopModule=health', 'health']]) {
    const app = loadComponent('src/renderer/App.vue', dependencies, { globals: { location: { search: query }, URLSearchParams } })
    const html = await renderToString(vue.createSSRApp(app))
    assert.equal([...html.matchAll(/data-flood-adapter/g)].length, query === '?desktopModule=health' ? 0 : 1, query)
    if (key !== 'health') assert.ok(html.includes(`panel-key="${key}"`), query)
  }
})
