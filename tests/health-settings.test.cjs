const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { renderToString } = require('vue/server-renderer')
const { loadTypeScript } = require('./load-typescript.cjs')

function healthSettings({ failSave = false, confirmReset = true, enabled = true, failReset = false, render = false } = {}) {
  const plan = { enabled, goalMl: 2000, cupMl: 250, start: '09:00', end: '20:00' }
  const props = vue.reactive({ data: { settings: { hydrationPlan: plan, hydrationReminderEnabled: true, hydrationIntervalMinutes: 30, sedentaryReminderEnabled: true, sedentaryIntervalMinutes: 60, healthSoundEnabled: true } } })
  const calls = [], statuses = [], confirmationMessages = []
  let resets = 0, confirmations = 0, rejectNextSave = failSave, rejectNextReset = failReset
  const toolbox = {
    settings: { update: async patch => {
      calls.push(JSON.parse(JSON.stringify(patch)))
      if (rejectNextSave) { rejectNextSave = false; throw Error('disk full') }
      Object.assign(props.data.settings, patch)
      return props.data
    } },
    wellness: { resetHydration: async () => {
      resets++
      if (rejectNextReset) { rejectNextReset = false; throw Error('reset failed') }
      return props.data
    } }
  }
  const source = fs.readFileSync('src/renderer/components/HydrationPlanSettings.vue', 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'health-settings-test', inlineTemplate: render })
  const compiled = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = {
    exports: {}, Error,
    require: id => id === 'vue' ? vue : id === '../toolbox' ? { toolbox } : id === '../save-queue' ? loadTypeScript('src/renderer/save-queue.ts') : loadTypeScript('src/main/hydration-plan.ts'),
    confirm: message => { confirmations++; confirmationMessages.push(message); return confirmReset }
  }
  vm.runInNewContext(compiled, context)
  if (render) return renderToString(vue.createSSRApp(context.exports.default, props))
  const scope = vue.effectScope()
  const state = scope.run(() => context.exports.default.setup(props, { expose() {}, emit: (name, message) => statuses.push([name, message]) }))
  return { state, calls, statuses, props, confirmationMessages, counts: () => ({ resets, confirmations }), stop: () => scope.stop() }
}

async function flushSaves() {
  await new Promise(resolve => setImmediate(resolve))
  await vue.nextTick()
}

test('failed water goal saves preserve the draft across updates and retry without an obsolete schedule', async () => {
  const health = healthSettings({ failSave: true })
  try {
    health.props.data.settings.hydrationPlan.times = ['10:10']
    await vue.nextTick()
    health.state.setPlan({ goalMl: 3000 })
    await flushSaves()
    assert.equal(health.state.planFailed.value, true)
    assert.equal(health.state.draft.goalMl, 3000)
    assert.equal(health.state.dirty.value, true)
    health.props.data.settings.hydrationPlan = { ...health.props.data.settings.hydrationPlan, goalMl: 2500 }
    await vue.nextTick()
    assert.equal(health.state.draft.goalMl, 3000)
    await health.state.savePlan()
    assert.equal(health.state.planFailed.value, false)
    assert.equal(health.state.dirty.value, false)
    assert.equal(health.calls.at(-1).hydrationPlan.goalMl, 3000)
    assert.equal(health.calls.at(-1).hydrationPlan.times, undefined)
  } finally { health.stop() }
})

test('invalid default record amounts stay in the draft without calling the save API', async () => {
  const health = healthSettings()
  try {
    health.state.setNumber('cupMl', { target: { value: '0' } })
    await flushSaves()
    assert.equal(health.calls.length, 0)
    assert.equal(health.state.planFailed.value, true)
    assert.match(health.state.planMessage.value, /50.*1000/)
    assert.equal(health.state.draft.cupMl, 0)
    health.state.setNumber('cupMl', { target: { value: '300' } })
    await flushSaves()
    assert.equal(health.state.planFailed.value, false)
    assert.equal(health.props.data.settings.hydrationPlan.cupMl, 300)
  } finally { health.stop() }
})

test('both reminder modes save a daily goal and default amount without turning notifications on', async () => {
  for (const enabled of [false, true]) {
    const health = healthSettings({ enabled })
    try {
      await health.state.saveSettings({ hydrationReminderEnabled: false, sedentaryReminderEnabled: false })
      health.state.setNumber('goalMl', { target: { value: '2500' } })
      health.state.setNumber('cupMl', { target: { value: '300' } })
      await flushSaves()
      assert.equal(health.props.data.settings.hydrationPlan.goalMl, 2500)
      assert.equal(health.props.data.settings.hydrationPlan.cupMl, 300)
      assert.equal(health.props.data.settings.hydrationPlan.enabled, enabled)
      health.state.setPlan({ enabled: !enabled })
      await flushSaves()
      assert.equal(health.props.data.settings.hydrationReminderEnabled, false)
      health.state.selectSedentaryInterval(45)
      await flushSaves()
      assert.equal(health.props.data.settings.sedentaryReminderEnabled, false)
    } finally { health.stop() }
  }
})

test('both modes render common water amounts and only daily mode offers a reminder time range', async () => {
  for (const enabled of [false, true]) {
    const html = await healthSettings({ enabled, render: true })
    assert.match(html, /id="hydration-goal"/)
    assert.match(html, /id="hydration-cup"/)
    assert.match(html, /水杯容量/)
    assert.match(html, /点击按杯中当前毫升数记录/)
    assert.doesNotMatch(html, /编辑时间|每杯喝水时间|第 1 杯|结束后.*不能记录/)
    assert.equal(html.includes('id="hydration-start"'), enabled)
    assert.equal(html.includes('id="hydration-end"'), enabled)
    assert.equal(html.includes('aria-label="喝水间隔快捷选择"'), !enabled)
    if (enabled) assert.match(html, /按剩余水量与剩余时段自动均分提醒/)
  }
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
      assert.match(health.confirmationMessages[0], /水杯容量和提醒时段保持不变/)
      assert.doesNotMatch(health.confirmationMessages[0], /不能记录/)
    } finally { health.stop() }
  }
})


test('failed daily resets expose retry without changing the saved plan', async () => {
  const health = healthSettings({ failReset: true })
  try {
    const planBeforeReset = JSON.stringify(health.props.data.settings.hydrationPlan)
    await health.state.resetToday()
    assert.equal(health.state.resetFailed.value, true)
    assert.equal(health.state.resetting.value, false)
    assert.equal(health.statuses.at(-1)[1], '保存失败：reset failed')
    await health.state.resetToday()
    assert.equal(health.state.resetFailed.value, false)
    assert.equal(health.counts().resets, 2)
    assert.equal(JSON.stringify(health.props.data.settings.hydrationPlan), planBeforeReset)
  } finally { health.stop() }
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
