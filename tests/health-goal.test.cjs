const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { renderToString } = require('vue/server-renderer')
const { loadTypeScript } = require('./load-typescript.cjs')

const { descriptor } = parse(fs.readFileSync('src/renderer/components/WellnessControls.vue', 'utf8'))
const script = compileScript(descriptor, { id: 'health-goal-test' })
const compiled = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

async function goalEditor({ failSave = false, saveGate } = {}) {
  const props = vue.reactive({ data: {
    settings: { hydrationPlan: { enabled: true, goalMl: 2000, cupMl: 250, start: '09:00', end: '17:00' }, hydrationReminderEnabled: true, hydrationIntervalMinutes: 30 },
    hydrationDay: { date: '2026-10-29', consumedMl: 750, lastCupAt: 1793236500000, recordIds: ['existing-record'] }
  } })
  const calls = []
  const counts = { reads: 0, opens: 0, closes: 0, focuses: 0, selections: 0 }
  let rejectNextSave = failSave
  const toolbox = { wellness: {
    setHydrationGoal: async value => {
      calls.push(value)
      if (saveGate) await saveGate
      if (rejectNextSave) { rejectNextSave = false; throw Error('disk full') }
      props.data.settings.hydrationPlan.goalMl = value
      return props.data
    },
    get: async () => { counts.reads++; throw Error('status refresh unavailable') }
  } }
  const context = { exports: {}, Error, Date, require: id => {
    if (id === 'vue') return vue
    if (id === '../toolbox') return { toolbox }
    if (id.endsWith('.vue')) return {}
    if (id === '../../main/wellness-reminders') return loadTypeScript('src/main/wellness-reminders.ts')
    if (id === '../../main/hydration-plan') return loadTypeScript('src/main/hydration-plan.ts')
    if (id === '../health-effects') return loadTypeScript('src/renderer/health-effects.ts')
    throw Error(`Unexpected component dependency: ${id}`)
  } }
  vm.runInNewContext(compiled, context)
  const component = context.exports.default
  let state
  // SSR supplies a real component instance without starting desktop subscriptions or timers.
  await renderToString(vue.createSSRApp({ setup(currentProps, setupContext) {
    state = component.setup(currentProps, setupContext)
    return () => null
  }, props: component.props }, props))
  state.goalEditor.value = { showModal() { counts.opens++ }, close() { counts.closes++ } }
  state.goalInput.value = { focus() { counts.focuses++ }, select() { counts.selections++ } }
  return { state, props, calls, counts }
}

test('invalid goal drafts stay editable and never reach the save API', async () => {
  const editor = await goalEditor()
  for (const value of ['', ' ', '499', '5001', '1000.5', '2e3', '-1000', '2000ml', 'NaN', 'Infinity']) {
    editor.state.goalMl.value = value
    await editor.state.saveGoal()
    assert.equal(editor.state.goalMl.value, value)
    assert.ok(editor.state.goalError.value)
    assert.equal(editor.state.pending.value, false)
  }
  assert.equal(editor.calls.length, 0)
  assert.equal(editor.counts.closes, 0)
  assert.equal(editor.counts.focuses, 10)
  assert.equal(editor.props.data.settings.hydrationPlan.goalMl, 2000)
  assert.equal(editor.props.data.hydrationDay.consumedMl, 750)
})

test('valid boundary and ordinary goals save as numbers without a second status read', async () => {
  for (const [draft, expected] of [['500', 500], ['2500', 2500], ['5000', 5000], [' 2000 ', 2000]]) {
    const editor = await goalEditor()
    const dayBefore = JSON.stringify(editor.props.data.hydrationDay)
    const { goalMl, ...planBefore } = editor.props.data.settings.hydrationPlan
    editor.state.goalMl.value = draft
    await editor.state.saveGoal()
    assert.deepEqual(editor.calls, [expected])
    assert.equal(typeof editor.calls[0], 'number')
    assert.equal(editor.counts.reads, 0)
    assert.equal(editor.counts.closes, 1)
    assert.equal(editor.state.goalError.value, '')
    assert.equal(editor.state.pending.value, false)
    assert.ok(editor.state.menuFeedback.value.includes(String(expected)))
    assert.equal(editor.state.menuFailed.value, false)
    assert.equal(editor.props.data.settings.hydrationPlan.goalMl, expected)
    assert.equal(JSON.stringify(editor.props.data.hydrationDay), dayBefore)
    const { goalMl: savedGoal, ...planAfter } = editor.props.data.settings.hydrationPlan
    assert.deepEqual(planAfter, planBefore)
  }
})

test('a failed save retains the draft and open dialog, then retry succeeds', async () => {
  const editor = await goalEditor({ failSave: true })
  const dayBefore = JSON.stringify(editor.props.data.hydrationDay)
  editor.state.goalMl.value = '3000'
  await editor.state.saveGoal()
  assert.deepEqual(editor.calls, [3000])
  assert.equal(editor.props.data.settings.hydrationPlan.goalMl, 2000)
  assert.equal(editor.state.goalMl.value, '3000')
  assert.ok(editor.state.goalError.value)
  assert.equal(editor.counts.closes, 0)
  assert.equal(editor.counts.focuses, 1)
  assert.equal(editor.state.pending.value, false)
  await editor.state.saveGoal()
  assert.deepEqual(editor.calls, [3000, 3000])
  assert.equal(editor.props.data.settings.hydrationPlan.goalMl, 3000)
  assert.equal(editor.state.goalError.value, '')
  assert.equal(editor.counts.closes, 1)
  assert.equal(JSON.stringify(editor.props.data.hydrationDay), dayBefore)
})

test('pending saves ignore duplicate submissions, closing and reopening', async () => {
  let resolveSave
  const saveGate = new Promise(resolve => { resolveSave = resolve })
  const editor = await goalEditor({ saveGate })
  editor.state.goalMl.value = '3500'
  const saving = editor.state.saveGoal()
  try {
    assert.equal(editor.state.pending.value, true)
    await editor.state.saveGoal()
    editor.state.closeGoalEditor()
    await editor.state.openGoalEditor()
    assert.deepEqual(editor.calls, [3500])
    assert.equal(editor.counts.closes, 0)
    assert.equal(editor.counts.opens, 0)
    assert.equal(editor.state.goalMl.value, '3500')
    assert.equal(editor.props.data.settings.hydrationPlan.goalMl, 2000)
  } finally {
    resolveSave()
    await saving
  }
  assert.equal(editor.counts.closes, 1)
  assert.equal(editor.state.pending.value, false)
  assert.equal(editor.props.data.settings.hydrationPlan.goalMl, 3500)
})

test('opening selects the current saved goal and cancellation leaves data intact', async () => {
  const editor = await goalEditor()
  const dayBefore = JSON.stringify(editor.props.data.hydrationDay)
  editor.state.goalMl.value = '5000'
  editor.state.goalError.value = 'previous error'
  editor.props.data.settings.hydrationPlan.goalMl = 2800
  await editor.state.openGoalEditor()
  assert.equal(editor.state.goalMl.value, '2800')
  assert.equal(editor.state.goalError.value, '')
  assert.equal(editor.counts.opens, 1)
  assert.equal(editor.counts.focuses, 1)
  assert.equal(editor.counts.selections, 1)
  editor.state.goalMl.value = '4000'
  editor.state.closeGoalEditor()
  assert.equal(editor.counts.closes, 1)
  assert.equal(editor.calls.length, 0)
  assert.equal(editor.props.data.settings.hydrationPlan.goalMl, 2800)
  assert.equal(JSON.stringify(editor.props.data.hydrationDay), dayBefore)
})
