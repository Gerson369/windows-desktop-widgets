export const extraWidgetKinds = ['calendar', 'notes', 'clock', 'countdown', 'focus', 'weather', 'devices'] as const
export type ExtraWidgetKind = typeof extraWidgetKinds[number]
export const widgetTitles: Record<ExtraWidgetKind, string> = { calendar:'日历与日程', notes:'快速便签', clock:'世界时钟', countdown:'重要日期', focus:'专注计时', weather:'多地天气', devices:'设备与性能' }
export interface CalendarEvent { id: string; title: string; start: string; end: string; allDay: boolean; category: 'work' | 'personal' }
export interface CalendarSource { id: string; name: string; enabled: boolean; url?: string; content: string; updatedAt: string }
export interface Countdown { id: string; title: string; date: string }
export interface WeatherCity { id: string; name: string; latitude: number; longitude: number }
export interface FocusClock { durationSeconds: number; remainingSeconds: number; endAt: number | null; notified: boolean }
export interface WidgetSuite {
  version: number
  background: string
  textColor: string
  fontSize: number
  showSystemIcons: boolean
  timeZones: string[]
  events: CalendarEvent[]
  sources: CalendarSource[]
  countdowns: Countdown[]
  cities: WeatherCity[]
  focus: FocusClock
}
export function defaultSuite(): WidgetSuite {
  return { version:1, background:'#232729', textColor:'#f4f7f6', fontSize:14, showSystemIcons:true, timeZones:['Asia/Shanghai'], events:[], sources:[], countdowns:[], cities:[], focus:{durationSeconds:1500,remainingSeconds:1500,endAt:null,notified:false} }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('组件配置必须是对象。')
  return value as Record<string, unknown>
}
function text(value: unknown, maximum = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`文字须为 1–${maximum} 个字符。`)
  return value.trim()
}
export function dateKey(value: Date | number): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
export function validDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) && dateKey(date) === value
}
export function daysUntil(date: string, now: number): number {
  const today = dateKey(now)
  return Math.round((Date.parse(`${date}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000)
}
export function focusRemaining(clock: FocusClock, now: number): number {
  return clock.endAt === null ? clock.remainingSeconds : Math.max(0, Math.ceil((clock.endAt-now)/1000))
}
export function changeFocus(clock: FocusClock, action: string, now: number, duration?: number): FocusClock {
  if (action === 'reset') return {...clock,endAt:null,remainingSeconds:clock.durationSeconds,notified:false}
  if (action === 'pause') return {...clock,remainingSeconds:focusRemaining(clock,now),endAt:null}
  if (action === 'start') {
    const seconds = duration === undefined ? focusRemaining(clock,now) || clock.durationSeconds : duration
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error('计时须为 1 秒至 24 小时。')
    return {durationSeconds:duration ?? clock.durationSeconds,remainingSeconds:seconds,endAt:now+seconds*1000,notified:false}
  }
  throw new Error('计时操作无效。')
}
export function validateSuite(value: unknown): WidgetSuite {
  const source = record(value)
  const result = defaultSuite()
  for (const key of ['background','textColor'] as const) {
    if (source[key] !== undefined) {
      if (typeof source[key] !== 'string' || !/^#[\da-f]{6}$/i.test(source[key])) throw new Error('颜色格式无效。')
      result[key] = source[key]
    }
  }
  if (source.fontSize !== undefined) {
    if (typeof source.fontSize !== 'number' || !Number.isInteger(source.fontSize) || source.fontSize < 12 || source.fontSize > 20) throw new Error('字号须为 12–20。')
    result.fontSize = source.fontSize
  }
  if (source.showSystemIcons !== undefined) {
    if (typeof source.showSystemIcons !== 'boolean') throw new Error('系统图标开关无效。')
    result.showSystemIcons = source.showSystemIcons
  }
  const list = (key: string, maximum: number): unknown[] => {
    const entries = source[key] ?? []
    if (!Array.isArray(entries) || entries.length > maximum) throw new Error(`${key} 条目过多或格式无效。`)
    return entries
  }
  result.timeZones = list('timeZones',12).map(value => {
    const zone = text(value,80)
    try { new Intl.DateTimeFormat('zh-CN',{timeZone:zone}).format() } catch { throw new Error('时区无效，请使用 Asia/Shanghai 等名称。') }
    return zone
  })
  if (!result.timeZones.length) result.timeZones = ['Asia/Shanghai']
  const identified = <T extends {id:string}>(items: T[]): T[] => {
    if (new Set(items.map(item=>item.id)).size !== items.length) throw new Error('条目标识重复。')
    return items
  }
  result.events = identified(list('events',1000).map(value=>{
    const event = record(value)
    const start = text(event.start,40), end = text(event.end,40)
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end)<Date.parse(start)) throw new Error('日程起止时间无效。')
    return {id:text(event.id,160),title:text(event.title),start,end,allDay:event.allDay===true,category:event.category==='work'?'work' as const:'personal' as const}
  }))
  let contentSize = 0
  result.sources = identified(list('sources',12).map(value=>{
    const entry=record(value), content = typeof entry.content==='string'?entry.content:''
    contentSize += content.length
    if (contentSize>8_000_000 || content.length>2_000_000) throw new Error('日历内容过大。')
    const url = entry.url === undefined ? undefined : text(entry.url,2048)
    if (url) { const parsed=new URL(url); if(parsed.protocol!=='https:' || parsed.username || parsed.password) throw new Error('订阅须为不含账号密码的 HTTPS 地址。') }
    return {id:text(entry.id,160),name:text(entry.name),enabled:entry.enabled!==false,url,content,updatedAt:typeof entry.updatedAt==='string'?entry.updatedAt:''}
  }))
  result.countdowns = identified(list('countdowns',100).map(value=>{
    const entry=record(value)
    if (!validDateKey(entry.date)) throw new Error('重要日期无效。')
    return {id:text(entry.id,160),title:text(entry.title),date:entry.date}
  }))
  result.cities = identified(list('cities',12).map(value=>{
    const city=record(value)
    if (typeof city.latitude!=='number' || !Number.isFinite(city.latitude) || Math.abs(city.latitude)>90 || typeof city.longitude!=='number' || !Number.isFinite(city.longitude) || Math.abs(city.longitude)>180) throw new Error('城市经纬度无效。')
    return {id:text(city.id,160),name:text(city.name),latitude:city.latitude,longitude:city.longitude}
  }))
  if (source.focus !== undefined) {
    const clock=record(source.focus)
    if (typeof clock.durationSeconds!=='number' || !Number.isInteger(clock.durationSeconds) || clock.durationSeconds<1 || clock.durationSeconds>86400 || typeof clock.remainingSeconds!=='number' || !Number.isInteger(clock.remainingSeconds) || clock.remainingSeconds<0 || clock.remainingSeconds>86400 || (clock.endAt!==null && (typeof clock.endAt!=='number' || !Number.isFinite(clock.endAt) || clock.endAt<0))) throw new Error('计时状态无效。')
    result.focus = {durationSeconds:clock.durationSeconds,remainingSeconds:clock.remainingSeconds,endAt:clock.endAt as number|null,notified:clock.notified===true}
  }
  return result
}
