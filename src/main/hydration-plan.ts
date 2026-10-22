import type { ReminderClock } from './wellness-reminders'

export interface HydrationPlan { enabled: boolean; goalMl: number; cupMl: number; start: string; end: string; times?: string[] }
export interface HydrationDay { date: string; consumedMl: number; completedTimes?: string[]; lastCupAt?: number }
export interface HydrationPlanSnapshot extends HydrationPlan { consumedMl: number; nextCupMl: number; restingProgress: number; status: 'before' | 'active' | 'ended' | 'complete'; restingClock?: ReminderClock }
export const defaultHydrationPlan: HydrationPlan = { enabled: false, goalMl: 2000, cupMl: 250, start: '09:00', end: '20:00' }

const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
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
  if (!Array.isArray(plan.times ?? [])) throw new Error('喝水时间表无效。')
  const times = hydrationTimes(plan)
  if (times.length !== Math.ceil(plan.goalMl / plan.cupMl) || times.some((slot, index) => !time(slot) || minutes(slot) < minutes(plan.start) || minutes(slot) >= minutes(plan.end) || (index > 0 && minutes(slot) - minutes(times[index - 1]) < 5))) throw new Error('每杯时间须按先后排列，在计划时段内，至少相隔 5 分钟。')
  return { enabled: plan.enabled, goalMl: plan.goalMl, cupMl: plan.cupMl, start: plan.start, end: plan.end, times }
}

export function hydrationDayAt(value: unknown, now: number): HydrationDay {
  const date = new Date(now)
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const day = value as Partial<HydrationDay> | undefined
  return { date: key, consumedMl: day?.date === key && Number.isInteger(day.consumedMl) && day.consumedMl! >= 0 && day.consumedMl! <= 5000 ? day.consumedMl! : 0,
    completedTimes: day?.date === key && Array.isArray(day.completedTimes) ? [...new Set(day.completedTimes.filter(time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)))] : [],
    ...(day?.date === key && typeof day.lastCupAt === 'number' && Number.isFinite(day.lastCupAt) && day.lastCupAt <= now && day.lastCupAt >= boundary('00:00', now) ? { lastCupAt: day.lastCupAt } : {}) }
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
  const status = consumedMl >= plan.goalMl ? 'complete' : now < boundary(plan.start, now) ? 'before' : now >= boundary(plan.end, now) ? 'ended' : 'active'
  const latest = hydrationTimes(plan).filter(time => boundary(time, now) <= now).at(-1)
  const restingProgress = latest && (current.lastCupAt ?? 0) < boundary(latest, now) ? 1 : 0
  let restingClock: ReminderClock | undefined
  if (restingProgress && latest && status !== 'complete') {
    const times = hydrationTimes(plan), index = times.indexOf(latest), dueAt = boundary(latest, now)
    const prior = index > 0 ? boundary(times[index - 1], now) : boundary(plan.start, now)
    const startedAt = Math.min(dueAt - 60000, Math.max(prior, current.lastCupAt ?? 0))
    restingClock = { startedAt, dueAt, intervalMinutes: (dueAt - startedAt) / 60000 }
  }
  return { ...plan, consumedMl, nextCupMl, status, restingProgress, ...(restingClock ? { restingClock } : {}) }
}

function hydrationPlanKey(plan: HydrationPlan, day: HydrationDay): string {
  return JSON.stringify([day.date, day.consumedMl, plan.goalMl, plan.cupMl, plan.start, plan.end, hydrationTimes(plan), day.completedTimes])
}
export function overdueHydrationClock(plan: HydrationPlan, day: HydrationDay, clock: ReminderClock | undefined, now: number): ReminderClock | undefined {
  const current = hydrationDayAt(day, now)
  if (!plan.enabled || !clock || hydrationPlanSnapshot(plan, current, now).status !== 'ended' || clock.planKey !== hydrationPlanKey(plan, current) || now < clock.dueAt) return undefined
  return clock
}

export function hydrationPlanClock(plan: HydrationPlan, day: HydrationDay, previous: ReminderClock | undefined, now: number): ReminderClock | undefined {
  const current = hydrationDayAt(day, now)
  const snapshot = hydrationPlanSnapshot(plan, current, now)
  if (!plan.enabled || snapshot.status !== 'active') return undefined
  const end = boundary(plan.end, now)
  const times = hydrationTimes(plan)
  const planKey = hydrationPlanKey(plan, current)
  if (previous?.planKey === planKey && previous.dueAt <= end) return previous
  // Missed slots stay missed; restarting never creates a burst of catch-up alerts.
  const next = times.find(time => !current.completedTimes?.includes(time) && boundary(time, now) >= now)
  if (!next) return undefined
  const dueAt = boundary(next, now)
  const index=times.indexOf(next)
  const prior=index>0?boundary(times[index-1],now):boundary(plan.start,now)
  const startedAt = Math.min(now, dueAt - 1000, Math.max(prior,current.lastCupAt ?? 0))
  return { intervalMinutes: (dueAt - startedAt) / 60_000, startedAt, dueAt, planKey }
}

export function hydrationPlanCanRecord(plan:Pick<HydrationPlanSnapshot,'enabled'|'status'>):boolean {
  return !plan.enabled || plan.status==='active'
}
