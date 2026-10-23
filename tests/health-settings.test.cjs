const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { loadTypeScript } = require('./load-typescript.cjs')

function healthSettings({ failSave = false, confirmReset = true } = {}) {
  const plan = { enabled: true, goalMl: 2000, cupMl: 250, start: '09:00', end: '20:00' }
  const props = vue.reactive({ data: { settings: { hydrationPlan: plan, hydrationReminderEnabled: true, hydrationIntervalMinutes: 30, sedentaryReminderEnabled: true, sedentaryIntervalMinutes: 60, healthSoundEnabled: true } } })
  const calls = [], statuses = []
  let resets = 0, confirmations = 0, rejectNextSave = failSave
  const toolbox = {
    settings: { update: async patch => {
      calls.push(JSON.parse(JSON.stringify(patch)))
      if (rejectNextSave) { rejectNextSave = false; throw Error('disk full') }
      Object.assign(props.data.settings, patch)
      return props.data
    } },
    wellness: { resetHydration: async () => { resets++; return props.data } }
  }
  const source = fs.readFileSync('src/renderer/components/HydrationPlanSettings.vue', 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'health-settings-test' })
  const compiled = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = {
    exports: {}, Error,
    require: id => id === 'vue' ? vue : id === '../toolbox' ? { toolbox } : id === '../save-queue' ? loadTypeScript('src/renderer/save-queue.ts') : loadTypeScript('src/main/hydration-plan.ts'),
    confirm: () => { confirmations++; return confirmReset }
  }
  vm.runInNewContext(compiled, context)
  const scope = vue.effectScope()
  const state = scope.run(() => context.exports.default.setup(props, { expose() {}, emit: (name, message) => statuses.push([name, message]) }))
  return { state, calls, statuses, props, counts: () => ({ resets, confirmations }), stop: () => scope.stop() }
}

async function flushSaves() {
  await new Promise(resolve => setImmediate(resolve))
  await vue.nextTick()
}

test('health plan saves keep failed custom times for retry and redistribute after goal changes', async () => {
  const health = healthSettings({ failSave: true })
  try {
    const original = [...health.state.times.value]
    health.state.setTime(0, { target: { value: '10:10' } })
    await flushSaves()
    assert.equal(health.state.planFailed.value, true)
    assert.equal(health.state.draft.times[0], '10:10')
    assert.equal(health.state.dirty.value, true)
    await health.state.savePlan()
    assert.equal(health.state.planFailed.value, false)
    assert.equal(health.state.dirty.value, false)
    assert.equal(health.calls.at(-1).hydrationPlan.times[0], '10:10')
    health.state.setPlan({ goalMl: 3000 })
    await flushSaves()
    assert.equal(health.state.times.value.length, 12)
    assert.equal(health.state.customSchedule.value, false)
    assert.notEqual(health.calls.at(-1).hydrationPlan.times[0], '10:10')
    assert.equal(original.length, 8)
  } finally { health.stop() }
})

test('invalid custom schedule is retained without calling the save API', async () => {
  const health = healthSettings()
  try {
    health.state.setTime(1, { target: { value: health.state.times.value[0] } })
    await flushSaves()
    assert.equal(health.calls.length, 0)
    assert.equal(health.state.planFailed.value, true)
    assert.match(health.state.planMessage.value, /至少相隔 5 分钟/)
    assert.equal(health.state.draft.times[1], health.state.draft.times[0])
  } finally { health.stop() }
})

test('health reminder saves validate the interval and retry a failed patch', async () => {
  const health = healthSettings({ failSave: true })
  try {
    await health.state.saveSettings({ sedentaryIntervalMinutes: 1 })
    assert.equal(health.calls.length, 0)
    assert.match(health.state.settingMessage.value, /15–240/)
    await health.state.saveSettings({ hydrationReminderEnabled: false })
    assert.equal(health.state.failedSetting.value.hydrationReminderEnabled, false)
    await health.state.saveSettings(health.state.failedSetting.value)
    assert.equal(health.state.failedSetting.value, null)
    assert.equal(health.props.data.settings.hydrationReminderEnabled, false)
    assert.equal(health.props.data.settings.hydrationPlan.enabled, true)
  } finally { health.stop() }
})

test('today reset requires confirmation and does not alter the daily time range', async () => {
  for (const confirmReset of [false, true]) {
    const health = healthSettings({ confirmReset })
    try {
      await health.state.resetToday()
      assert.deepEqual(health.counts(), { resets: Number(confirmReset), confirmations: 1 })
      assert.equal(health.props.data.settings.hydrationPlan.start, '09:00')
      assert.equal(health.props.data.settings.hydrationPlan.end, '20:00')
    } finally { health.stop() }
  }
})


test('custom sedentary interval stays collapsed for presets and opens for custom values', async () => {
  const health = healthSettings()
  try {
    assert.equal(health.state.showCustomSedentary.value, false)
    health.state.customSedentary.value = true
    assert.equal(health.state.showCustomSedentary.value, true)
    health.state.selectSedentaryInterval(45)
    await flushSaves()
    assert.equal(health.state.showCustomSedentary.value, false)
    assert.equal(health.props.data.settings.sedentaryIntervalMinutes, 45)
    health.props.data.settings.sedentaryIntervalMinutes = 75
    assert.equal(health.state.showCustomSedentary.value, true)
    assert.equal(health.props.data.settings.sedentaryReminderEnabled, true)
  } finally { health.stop() }
})

test('health status retains an unresolved plan or reminder failure when another save succeeds', async () => {
  for (const failureSource of ['plan', 'reminder']) {
    const health = healthSettings({ failSave: true })
    try {
      if (failureSource === 'plan') await health.state.savePlan()
      else await health.state.saveSettings({ healthSoundEnabled: false })
      assert.equal(health.statuses.at(-1)[1], '保存失败：disk full')
      const afterFailure = health.statuses.length
      if (failureSource === 'plan') await health.state.saveSettings({ healthSoundEnabled: false })
      else await health.state.savePlan()
      assert.ok(health.statuses.slice(afterFailure).every(([, message]) => message === '保存失败：disk full'))
      if (failureSource === 'plan') {
        assert.equal(health.state.planFailed.value, true)
        assert.equal(health.state.dirty.value, true)
        await health.state.savePlan()
      } else {
        assert.equal(health.state.failedSetting.value.healthSoundEnabled, false)
        await health.state.saveSettings(health.state.failedSetting.value)
      }
      assert.equal(health.statuses.at(-1)[1], '已保存')
    } finally { health.stop() }
  }
})
