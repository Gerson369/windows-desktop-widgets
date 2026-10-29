import type { ReminderClock } from './wellness-reminders'

export interface HydrationPlan { enabled: boolean; goalMl: number; cupMl: number; start: string; end: string; times?: string[] }
export interface HydrationDay { date: string; consumedMl: number; completedTimes?: string[]; lastCupAt?: number; recordIds?: string[] }
export interface HydrationRecording { amountMl: number; recordId: string }
export interface HydrationPlanSnapshot extends HydrationPlan { consumedMl: number; nextCupMl: number; restingProgress: number; status: 'before' | 'active' | 'ended' | 'complete'; restingClock?: ReminderClock }
export const defaultHydrationPlan: HydrationPlan = { enabled: false, goalMl: 2000, cupMl: 250, start: '09:00', end: '20:00' }

const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const validRecordId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
export const hydrationTime = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
export function hydrationTimes(plan: HydrationPlan): string[] {
  const count = Math.ceil(plan.goalMl / plan.cupMl)
  if (!Number.isFinite(count) || count < 1 || count > 100) return []
  return plan.times?.length ? [...plan.times] : Array.from({ length: count }, (_, index) => hydrationTime(minutes(plan.start) + Math.round((index + 1) * (minutes(plan.end) - minutes(plan.start)) / (count + 1))))
}
export function validateHydrationPlan(value: unknown): HydrationPlan {
  if (!value || typeof value !== 'object') throw new Error('喝水计划无效。')
  const plan = value as HydrationPlan
  if (typeof plan.enabled !== 'boolean' || !Number.isInteger(plan.goalMl) || plan.goalMl < 500 || plan.goalMl > 5000 || !Number.isInteger(plan.cupMl) || plan.cupMl < 50 || plan.cupMl > 1000) throw new Error('每日目标须为 500–5000ml，每杯须为 50–1000ml。')
  const time = (input: unknown): input is string => typeof input === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input)
  if (!time(plan.start) || !time(plan.end) || minutes(plan.end) <= minutes(plan.start)) throw new Error('结束时间须晚于开始时间，请选择同一天内的时段。')
  if (plan.times !== undefined && (!Array.isArray(plan.times) || plan.times.length > 100 || plan.times.some(slot => !time(slot)))) throw new Error('喝水时间表无效。')
  return { enabled: plan.enabled, goalMl: plan.goalMl, cupMl: plan.cupMl, start: plan.start, end: plan.end, ...(plan.times ? { times: [...plan.times] } : {}) }
}

export function hydrationDayAt(value: unknown, now: number): HydrationDay {
  const date = new Date(now)
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const day = value as Partial<HydrationDay> | undefined
  return { date: key, consumedMl: day?.date === key && Number.isInteger(day.consumedMl) && day.consumedMl! >= 0 && day.consumedMl! <= 100000 ? day.consumedMl! : 0,
    completedTimes: day?.date === key && Array.isArray(day.completedTimes) ? [...new Set(day.completedTimes.filter(time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)))] : [],
    ...(day?.date === key && Array.isArray(day.recordIds) ? { recordIds: [...new Set(day.recordIds.filter(validRecordId))] } : {}),
    ...(day?.date === key && typeof day.lastCupAt === 'number' && Number.isFinite(day.lastCupAt) && day.lastCupAt <= now && day.lastCupAt >= boundary('00:00', now) ? { lastCupAt: day.lastCupAt } : {}) }
}

export function recordHydration(plan: HydrationPlan, day: HydrationDay, amountMl: number, now: number, recordId: string): HydrationDay {
  validateHydrationPlan(plan)
  if (!Number.isInteger(amountMl) || amountMl < 1 || amountMl > 2000) throw new Error('实际喝水量须为 1–2000ml 的整数。')
  if (!validRecordId(recordId)) throw new Error('喝水记录标识须为 1–100 个字母、数字、下划线或连字符。')
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('喝水记录时间无效。')
  const current = hydrationDayAt(day, now)
  if (current.recordIds?.includes(recordId)) return current
  if (current.consumedMl + amountMl > 100000) throw new Error('今日累计喝水量不能超过 100000ml。')
  return { ...current, consumedMl: current.consumedMl + amountMl, lastCupAt: now, recordIds: [...(current.recordIds ?? []), recordId] }
}

const boundary = (time: string, now: number): number => {
  const date = new Date(now)
  date.setHours(Math.floor(minutes(time) / 60), minutes(time) % 60, 0, 0)
  return date.getTime()
}
export function hydrationPlanSnapshot(plan: HydrationPlan, day: HydrationDay, now: number): HydrationPlanSnapshot {
  const current = hydrationDayAt(day, now)
  const consumedMl = current.consumedMl
  const nextCupMl = Math.min(plan.cupMl, Math.max(0, plan.goalMl - consumedMl))
  const status = consumedMl >= plan.goalMl ? 'complete' : !plan.enabled ? 'active' : now < boundary(plan.start, now) ? 'before' : now >= boundary(plan.end, now) ? 'ended' : 'active'
  return { ...plan, consumedMl, nextCupMl, status, restingProgress: 0 }
}

function hydrationPlanKey(plan: HydrationPlan, day: HydrationDay): string {
  return JSON.stringify([day.date, day.consumedMl, plan.goalMl, plan.cupMl, plan.start, plan.end])
}
export function overdueHydrationClock(plan: HydrationPlan, day: HydrationDay, clock: ReminderClock | undefined, now: number): ReminderClock | undefined {
  const current = hydrationDayAt(day, now)
  if (!plan.enabled || !clock || hydrationPlanSnapshot(plan, current, now).status !== 'ended' || clock.planKey !== hydrationPlanKey(plan, current) || now < clock.dueAt) return undefined
  return clock
}

export function hydrationPlanClock(plan: HydrationPlan, day: HydrationDay, previous: ReminderClock | undefined, now: number): ReminderClock | undefined {
  const current = hydrationDayAt(day, now)
  const snapshot = hydrationPlanSnapshot(plan, current, now)
  if (!plan.enabled || snapshot.status === 'complete' || snapshot.status === 'ended') return undefined
  const end = boundary(plan.end, now)
  const planKey = hydrationPlanKey(plan, current)
  if (previous?.planKey === planKey) return previous
  const startedAt = Math.max(now, boundary(plan.start, now))
  const remainingCups = Math.ceil((plan.goalMl - current.consumedMl) / plan.cupMl)
  const interval = Math.max(5 * 60000, (end - startedAt) / (remainingCups + 1))
  const dueAt = startedAt + interval
  if (dueAt >= end) return undefined
  const due = new Date(dueAt)
  return { intervalMinutes: interval / 60000, startedAt, dueAt, planKey, planTime: hydrationTime(due.getHours() * 60 + due.getMinutes()) }
}

export function hydrationPlanCanRecord(plan:Pick<HydrationPlanSnapshot,'consumedMl'>, _clock?:ReminderClock, _now?:number):boolean {
  return Number.isInteger(plan.consumedMl) && plan.consumedMl >= 0 && plan.consumedMl < 100000
}
