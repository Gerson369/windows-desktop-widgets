import type { HydrationPlanSnapshot } from './hydration-plan'
export interface ReminderSettings {
  hydrationReminderEnabled: boolean
  hydrationIntervalMinutes: number
  sedentaryReminderEnabled: boolean
  sedentaryIntervalMinutes: number
}

export interface ReminderClock {
  intervalMinutes: number
  startedAt: number
  dueAt: number
  notified?: boolean
  snoozedUntil?: number
  planKey?: string
  planTime?: string
}
export type ReminderKind = keyof ReminderState
export interface WellnessSnapshot { state: ReminderState; paused: boolean; now: number; hydrationPlan?: HydrationPlanSnapshot; floodOrder?: string[]; undo?: { id: string; kind: ReminderKind; expiresAt: number } }

export interface ReminderState {
  hydration?: ReminderClock
  sedentary?: ReminderClock
}

export function resumeReminderClocks(previous: ReminderState, pausedAt: number, now: number): ReminderState {
  const pausedDuration = Math.max(0, now - pausedAt)
  const state: ReminderState = {}
  for (const kind of ['hydration', 'sedentary'] as const) {
    const clock = previous[kind]
    if (!clock) continue
    state[kind] = { ...clock, startedAt: clock.startedAt + pausedDuration, dueAt: clock.dueAt + pausedDuration }
    if (clock.snoozedUntil !== undefined) state[kind]!.snoozedUntil = clock.snoozedUntil + pausedDuration
  }
  return state
}

export const normalizeReminderSettings = (source: Partial<ReminderSettings>, fallback: ReminderSettings): ReminderSettings => {
  const interval = (value: unknown, defaultValue: number): number => typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(5, Math.min(240, value))) : defaultValue
  return {
    hydrationReminderEnabled: typeof source.hydrationReminderEnabled === 'boolean' ? source.hydrationReminderEnabled : fallback.hydrationReminderEnabled,
    hydrationIntervalMinutes: interval(source.hydrationIntervalMinutes, fallback.hydrationIntervalMinutes),
    sedentaryReminderEnabled: typeof source.sedentaryReminderEnabled === 'boolean' ? source.sedentaryReminderEnabled : fallback.sedentaryReminderEnabled,
    sedentaryIntervalMinutes: interval(source.sedentaryIntervalMinutes, fallback.sedentaryIntervalMinutes)
  }
}

export const tickReminders = (settings: ReminderSettings, previous: ReminderState, now: number): { state: ReminderState; due: Array<keyof ReminderState> } => {
  const state: ReminderState = {}
  const due: Array<keyof ReminderState> = []
  for (const kind of ['hydration', 'sedentary'] as const) {
    const enabled = kind === 'hydration' ? settings.hydrationReminderEnabled : settings.sedentaryReminderEnabled
    if (!enabled) continue
    const minutes = kind === 'hydration' ? settings.hydrationIntervalMinutes : settings.sedentaryIntervalMinutes
    const clock = previous[kind]
    if (!clock || clock.intervalMinutes !== minutes) state[kind] = { intervalMinutes: minutes, startedAt: now, dueAt: now + minutes * 60_000 }
    else if (now >= (clock.snoozedUntil || clock.dueAt) && !clock.notified) {
      due.push(kind)
      state[kind] = { ...clock, notified: true }
    } else state[kind] = { ...clock }
  }
  return { state, due }
}

export function respondToReminder(settings: ReminderSettings, previous: ReminderState, kind: ReminderKind, action: 'done' | 'snooze', now: number): ReminderState {
  const minutes = kind === 'hydration' ? settings.hydrationIntervalMinutes : settings.sedentaryIntervalMinutes
  const clock = previous[kind] || { intervalMinutes: minutes, startedAt: now, dueAt: now + minutes * 60_000 }
  return { ...previous, [kind]: action === 'done'
    ? { intervalMinutes: minutes, startedAt: now, dueAt: now + minutes * 60_000 }
    : { ...clock, snoozedUntil: now + 10 * 60_000, notified: false } }
}

export function reminderPercent(progress: number): number {
  return Math.max(1, Math.floor(progress * 100))
}

export function hydrationCupMl(cupMl: number, progress: number): number {
  if (!Number.isFinite(cupMl) || cupMl <= 0 || !Number.isFinite(progress)) return 0
  return Math.floor(Math.floor(cupMl) * Math.max(0, Math.min(1, progress)))
}

export function reminderVisual(clock: ReminderClock | undefined, now: number): { progress: number; percent: number; overdue: boolean; snoozed: boolean; minutes: number } {
  if (!clock) return { progress: 0, percent: 1, overdue: false, snoozed: false, minutes: 0 }
  const snoozed = Boolean(clock.snoozedUntil && clock.snoozedUntil > now)
  return {
    progress: Math.max(0, Math.min(1, (now - clock.startedAt) / (clock.intervalMinutes * 60_000))),
    percent: reminderPercent((now - clock.startedAt) / (clock.intervalMinutes * 60_000)),
    overdue: now >= clock.dueAt && !snoozed,
    snoozed,
    minutes: Math.max(0, Math.ceil(((snoozed ? clock.snoozedUntil! : clock.dueAt) - now) / 60_000))
  }
}

export function hydrationReminderVisual(snapshot: WellnessSnapshot, now: number): ReturnType<typeof reminderVisual> {
  const plan = snapshot.hydrationPlan
  if (plan?.status === 'complete') return { progress: 0, percent: 0, overdue: false, snoozed: false, minutes: 0 }
  if (plan?.enabled && (plan.status !== 'active' || !snapshot.state.hydration)) {
    if (plan.status === 'ended' && snapshot.state.hydration) return reminderVisual(snapshot.state.hydration, now)
    if (plan.restingClock) return reminderVisual(plan.restingClock, now)
    const progress = plan.restingProgress
    return { progress, percent: reminderPercent(progress), overdue: false, snoozed: false, minutes: 0 }
  }
  return reminderVisual(snapshot.state.hydration, now)
}
