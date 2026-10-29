<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { toolbox } from '../toolbox'
import { createSaveQueue } from '../save-queue'
import { desktopPanels } from '../../main/desktop-panels'
import AssistantIcon from './AssistantIcon.vue'
import type { AppData } from '../../main/types'

const props = defineProps<{ data: AppData; group: 'desktop' | 'data' }>()
const emit = defineEmits<{ return: []; status: [message: string] }>()
const api = toolbox
const confirm = window.confirm.bind(window)
const error = ref('')
const displays = ref<Array<{ id: number; label: string }>>([])
const busy = ref(false)
const pendingLabel = ref('')
const savedShortcut = computed(() => props.data.settings.shortcuts.find(item => item.action === 'toggle-panel')?.accelerator || 'CommandOrControl+Shift+Space')
const displayShortcut = computed(() => savedShortcut.value.replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl').split('+'))
const shortcut = ref(savedShortcut.value)
const editingShortcut = ref(false)
const shortcutInput = ref<HTMLInputElement>()
const shortcutButton = ref<HTMLButtonElement>()
const queue = createSaveQueue()
const retry = ref<(() => Promise<void>) | null>(null)
let saveRevision = 0
let disposeShortcut: (() => void) | undefined

async function perform(action: () => Promise<unknown>, pending = '正在保存…', completed = '已保存') {
  const current = ++saveRevision
  busy.value = true
  error.value = ''
  retry.value = null
  pendingLabel.value = pending
  emit('status', pending)
  try {
    const result = await queue(action)
    if (current !== saveRevision || error.value) return
    emit('status', typeof result === 'string' ? result : completed)
  } catch (reason) {
    if (current === saveRevision) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      retry.value = () => perform(action, pending, completed)
      emit('status', `操作失败：${error.value}`)
    }
  } finally {
    if (current === saveRevision) { busy.value = false; pendingLabel.value = '' }
  }
}

async function toggleShortcutEditor() {
  editingShortcut.value = !editingShortcut.value
  if (editingShortcut.value) shortcut.value = savedShortcut.value
  await nextTick()
  if (editingShortcut.value) { shortcutInput.value?.focus(); shortcutInput.value?.select() }
  else shortcutButton.value?.focus()
}

async function setShortcut() {
  const accelerator = shortcut.value.trim()
  if (!accelerator) throw new Error('请输入组合键，例如 Ctrl+Shift+Space。')
  await api.settings.update({ shortcuts: [
    ...props.data.settings.shortcuts.filter(item => item.action !== 'toggle-panel'),
    { action: 'toggle-panel', accelerator, enabled: true }
  ] })
  // 注册失败通过独立事件返回，不能被保存成功覆盖。
  if (error.value) throw new Error(error.value)
  editingShortcut.value = false
  await nextTick()
  shortcutButton.value?.focus()
  return '快捷键已保存'
}

async function loadDisplays() {
  displays.value = await api.suite.displays()
}

async function restoreLayout() {
  if (!confirm('将桌面收纳和桌面搭子移至主显示器右侧，显示这两个组件，并按屏幕调整尺寸。继续？')) return '已取消恢复布局'
  await api.suite.visibility('resetLayout')
  return '已恢复右侧布局'
}

async function exportData() {
  const path = await api.config.export()
  return path ? '已导出全部数据' : '已取消导出'
}

async function importData() {
  if (!confirm('导入会替换当前配置；请先导出备份。继续？')) return '已取消导入'
  return await api.config.import() ? '数据已导入' : '已取消导入'
}

onBeforeUnmount(() => disposeShortcut?.())
onMounted(async () => {
  if (props.group !== 'desktop') return
  disposeShortcut = api.events.onShortcutError(key => {
    error.value = `快捷键 ${key.replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')} 无法注册，可能已被其他程序占用。请修改后重试。`
    if (key === shortcut.value || key === savedShortcut.value) {
      shortcut.value = key
      editingShortcut.value = true
      retry.value = () => perform(setShortcut)
    }
    emit('status', `快捷键注册失败：${error.value}`)
  })
  if (props.group === 'desktop') await perform(loadDisplays, '正在读取显示器…', '显示器已更新')
})
</script>

<template>
  <div class="suite-settings" :aria-busy="busy">
    <template v-if="group === 'desktop'">
      <section class="settings-card component-card">
        <h3>组件显示</h3>
        <div v-for="module in desktopPanels(data.desktopModules)" :key="module.id" class="settings-row component-row">
          <AssistantIcon class="component-icon" :name="module.kind === 'quick' ? 'layout' : module.kind === 'health' ? 'water' : 'todo'"/>
          <div class="component-info">
            <span class="component-name">{{ module.title }}</span>
            <select :value="displays.some(display => display.id === module.displayId) ? module.displayId : ''" :aria-label="`${module.title}所在显示器`" :disabled="busy || !displays.length" @change="perform(() => api.suite.moveDisplay(module.id, Number(($event.target as HTMLSelectElement).value)))">
              <option value="" disabled>{{ !displays.length ? '正在读取显示器…' : module.displayId == null ? '跟随当前位置' : '原显示器已断开' }}</option>
              <option v-for="display in displays" :key="display.id" :value="display.id">{{ display.label }}</option>
            </select>
          </div>
          <button type="button" class="settings-switch" role="switch" :aria-label="`显示${module.title}`" :aria-checked="module.visible" :disabled="busy" @click="perform(() => api.desktopModules.update(module.id, { visible: !module.visible }))"><span/></button>
        </div>
      </section>
      <div class="settings-actions desktop-actions">
        <button type="button" class="settings-primary" @click="emit('return')"><AssistantIcon name="expand"/>打开桌面搭子</button>
        <button type="button" class="secondary" :disabled="busy" @click="perform(() => api.suite.visibility('toggle'), '正在切换组件显隐…', '已切换组件临时显隐')">临时显示 / 隐藏</button>
      </div>
      <section class="settings-card behavior-card">
        <h3>桌面行为</h3>
        <slot name="behavior"/>
        <div class="settings-row">
          <div><span>收纳框显示系统图标</span><p class="settings-hint">系统图标也能从应用页打开。</p></div>
          <button type="button" class="settings-switch" role="switch" aria-label="显示系统图标" :aria-checked="data.suite.showSystemIcons" :disabled="busy" @click="perform(() => api.suite.save({ showSystemIcons: !data.suite.showSystemIcons }))"><span/></button>
        </div>
        <p class="settings-hint">显示原桌面可恢复 Explorer 图标。</p>
      </section>
      <section class="settings-card shortcut-card">
        <h3>快捷键</h3>
        <div class="shortcut-heading"><div><span>呼出 / 收起助手</span><p class="settings-hint">面板内按 Esc 收起。</p></div><button ref="shortcutButton" type="button" class="secondary" :aria-expanded="editingShortcut" :disabled="busy" @click="toggleShortcutEditor">{{ editingShortcut ? '取消' : '修改' }}</button></div>
        <div class="shortcut-keys" aria-label="当前快捷键"><template v-for="(key, index) in displayShortcut" :key="index"><span v-if="index" aria-hidden="true">+</span><kbd>{{ key }}</kbd></template></div>
        <form v-if="editingShortcut" class="shortcut-editor" @submit.prevent="perform(setShortcut)" @keydown.esc.stop.prevent="toggleShortcutEditor">
          <label class="settings-field">组合键<input ref="shortcutInput" v-model="shortcut" maxlength="100" aria-label="桌面搭子快捷键" placeholder="Ctrl+Shift+Space" :disabled="busy" required/></label>
          <p class="settings-hint">用 + 连接按键，例如 Ctrl+Shift+Space。</p>
          <button class="settings-primary" type="submit" :disabled="busy || !shortcut.trim()">保存快捷键</button>
        </form>
      </section>
      <section class="settings-card layout-card">
        <div><h3>恢复右侧布局</h3><p class="settings-hint">在主显示器重新摆放桌面收纳和桌面搭子。</p></div>
        <button type="button" class="settings-link restore-button" :disabled="busy" @click="perform(restoreLayout, '正在恢复布局…')"><AssistantIcon name="refresh"/>恢复</button>
      </section>
    </template>
    <template v-else>
      <section class="settings-card data-card">
        <h3>数据备份</h3>
        <p class="settings-hint">导出全部数据，或从备份文件恢复。</p>
        <div class="settings-actions data-actions"><button type="button" class="settings-primary" :disabled="busy" @click="perform(exportData, '正在导出…')">导出全部数据</button><button type="button" class="secondary" :disabled="busy" @click="perform(importData, '正在导入…')">导入数据</button></div>
        <p class="settings-hint">导入会替换当前配置，请先导出备份。</p>
        <p class="settings-hint">导出含便签正文和私人日历订阅链接，请妥善保管。</p>
      </section>
      <section class="settings-card privacy-card">
        <h3>数据与隐私</h3>
        <p class="settings-hint">便签、待办、布局和日程保存在本机。</p>
        <p class="settings-hint">天气仅发送所选城市信息；订阅仅访问你添加的地址。</p>
        <p class="settings-hint">无新闻推荐、广告或收费试用。</p>
      </section>
    </template>
    <p v-if="busy" class="settings-hint operation-status" role="status">{{ pendingLabel }}</p>
    <div v-if="error" class="suite-error" role="alert"><span>{{ error }}</span><button v-if="retry" class="settings-link" :disabled="busy" @click="retry()">重试</button></div>
  </div>
</template>

<style scoped>
.suite-settings { display: grid; gap: 14px; min-width: 0; }
.suite-settings h3 { margin: 0 0 12px; font-size: 15px; line-height: 1.5; }
.component-row { display: grid; grid-template-columns: 23px minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.component-row:last-child { border-bottom: 0; padding-bottom: 0; }
.component-icon { width: 22px; height: 22px; color: var(--settings-muted, #b5bec3); }
.component-info { display: grid; gap: 8px; min-width: 0; }
.component-name { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.component-info select { width: 100%; max-width: 228px; min-width: 0; }
.desktop-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.desktop-actions button { display: inline-flex; justify-content: center; align-items: center; gap: 6px; min-width: 0; }
.desktop-actions svg { width: 17px; height: 17px; flex: 0 0 auto; }
.behavior-card > .settings-hint { margin-bottom: 0; }
.shortcut-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.shortcut-heading .settings-hint { margin: 5px 0 0; }
.shortcut-keys { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
.shortcut-keys > span { color: var(--settings-muted, #b5bec3); }
.shortcut-keys kbd { min-width: 42px; padding: 6px 10px; border: 1px solid var(--settings-line, #394148); border-radius: 6px; background: #ffffff06; color: inherit; text-align: center; font: inherit; font-size: 12px; }
.shortcut-editor { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--settings-line, #394148); }
.shortcut-editor input { width: 100%; min-width: 0; }
.layout-card { display: flex; align-items: center; gap: 12px; }
.layout-card > div { flex: 1; min-width: 0; }
.layout-card h3 { margin-bottom: 5px; }
.layout-card .settings-hint { margin: 0; }
.restore-button { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; }
.restore-button svg { width: 20px; height: 20px; }
.data-actions { margin: 16px 0; }
.data-card .settings-hint, .privacy-card .settings-hint { margin: 9px 0 0; line-height: 1.8; }
.operation-status { margin: 0; }
.suite-error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; line-height: 1.7; color: #f0b7b2; }
.suite-error > span { overflow-wrap: anywhere; }
@media (max-width: 380px) {
  .component-row { gap: 9px; }
  .desktop-actions { grid-template-columns: minmax(0, 1fr); }
}
</style>
