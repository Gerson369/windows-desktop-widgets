import type { AgendaEvent } from '../main/calendar-service'
import { dateKey, validDateKey } from '../main/widget-suite'

export function monthDates(month: string): string[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) return []
  const first = new Date(`${month}-01T12:00:00`)
  const last = new Date(first); last.setMonth(last.getMonth() + 1); last.setDate(0)
  const leading = (first.getDay() + 6) % 7
  const count = Math.ceil((leading + last.getDate()) / 7) * 7
  first.setDate(first.getDate() - leading)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first); date.setDate(date.getDate() + index)
    return dateKey(date)
  })
}

export function eventsOnCalendarDate(events: AgendaEvent[], date: string): AgendaEvent[] {
  if (!validDateKey(date)) return []
  const first = new Date(`${date}T00:00:00`)
  const last = new Date(first); last.setDate(last.getDate() + 1)
  return events.filter(event => {
    const start = Date.parse(event.start), end = Date.parse(event.end)
    return start < last.getTime() && (end > first.getTime() || start === end && start >= first.getTime())
  }).sort((left, right) => Number(right.allDay) - Number(left.allDay) || left.start.localeCompare(right.start) || left.id.localeCompare(right.id))
}

export function calendarWeeks(dates: string[], events: AgendaEvent[]) {
  const weeks = []
  for (let offset = 0; offset < dates.length; offset += 7) {
    const days = dates.slice(offset, offset + 7).map(date => ({ date, events: eventsOnCalendarDate(events, date) }))
    const entries = [...new Map(days.flatMap(day => day.events).map(event => [event.id, event])).values()]
      .sort((left, right) => Number(right.allDay) - Number(left.allDay) || left.start.localeCompare(right.start) || right.end.localeCompare(left.end) || left.id.localeCompare(right.id))
    const lanes: boolean[][] = []
    const segments = entries.map(event => {
      const columns = days.flatMap((day, index) => day.events.some(item => item.id === event.id) ? [index] : [])
      const start = columns[0], end = columns[columns.length - 1] + 1
      let lane = lanes.findIndex(occupied => columns.every(column => !occupied[column]))
      if (lane === -1) { lane = lanes.length; lanes.push(Array(7).fill(false)) }
      for (const column of columns) lanes[lane][column] = true
      const first = new Date(`${days[0].date}T00:00:00`)
      const last = new Date(`${days[days.length - 1].date}T00:00:00`); last.setDate(last.getDate() + 1)
      return { event, start, end, lane, continuesBefore: Date.parse(event.start) < first.getTime(), continuesAfter: Date.parse(event.end) > last.getTime() }
    }).filter(segment => segment.lane < 2)
    weeks.push({
      days: days.map((day, index) => {
        const preview = segments.filter(segment => segment.start <= index && segment.end > index).map(segment => segment.event)
        return { ...day, preview, remaining: day.events.length - preview.length }
      }), segments
    })
  }
  return weeks
}
