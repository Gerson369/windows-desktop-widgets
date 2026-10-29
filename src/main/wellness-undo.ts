import { hydrationDayAt, type HydrationDay } from './hydration-plan'
import type { AppSettings } from './types'
import type { ReminderClock, ReminderKind } from './wellness-reminders'

export interface WellnessUndo {
  id: string
  kind: ReminderKind
  expiresAt: number
  date: string
  signature: string
  clock?: ReminderClock
  dayBefore?: HydrationDay
  dayAfter?: HydrationDay
}
function settingsKey(settings: AppSettings, kind: ReminderKind): string {
  return JSON.stringify(kind === 'hydration'
    ? [settings.hydrationReminderEnabled, settings.hydrationIntervalMinutes, settings.hydrationPlan]
    : [settings.sedentaryReminderEnabled, settings.sedentaryIntervalMinutes])
}
export function captureWellnessUndo(id: string, kind: ReminderKind, settings: AppSettings, clock: ReminderClock | undefined, day: HydrationDay, now: number): WellnessUndo {
  return { id, kind, expiresAt: now + 15000, date: hydrationDayAt(day, now).date, signature: settingsKey(settings, kind),
    clock: clock ? { ...clock } : undefined,
    dayBefore: kind === 'hydration' ? structuredClone(hydrationDayAt(day, now)) : undefined }
}
export function validateWellnessUndo(record: WellnessUndo | null, id: unknown, settings: AppSettings, day: HydrationDay, now: number): asserts record is WellnessUndo {
  if (!record || typeof id !== 'string' || record.id !== id || now >= record.expiresAt) throw new Error('这次操作已无法撤销，请在完成后 15 秒内撤销最近一次操作。')
  if (record.date !== hydrationDayAt(day, now).date || record.signature !== settingsKey(settings, record.kind)) throw new Error('日期或提醒设置已改变，无法撤销旧操作。')
  if (record.dayAfter && JSON.stringify(hydrationDayAt(day, now)) !== JSON.stringify(record.dayAfter)) throw new Error('喝水记录已经改变，无法覆盖较新的记录。')
}
