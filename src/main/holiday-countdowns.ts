import { dateKey, validDateKey, type Countdown } from './widget-suite'

export const holidayCalendarSource = 'https://www.hko.gov.hk/tc/gts/time/conversion1_text.htm'
export const holidayCalendarRange = '2026–2035'

const festivalTitles = ['春节', '元宵节', '清明节', '端午节', '七夕节', '中秋节', '重阳节'] as const
// HKO Gregorian–Lunar Conversion Tables, T{year}c.txt, checked 2026-11-20.
// ponytail: extend this verified table before 2036; do not guess dates with ICU's differing lunar calculations.
const festivalDates: Record<number, readonly string[]> = {
  2026: ['02-17', '03-03', '04-05', '06-19', '08-19', '09-25', '10-18'],
  2027: ['02-06', '02-20', '04-05', '06-09', '08-08', '09-15', '10-08'],
  2028: ['01-26', '02-09', '04-04', '05-28', '08-26', '10-03', '10-26'],
  2029: ['02-13', '02-27', '04-04', '06-16', '08-16', '09-22', '10-16'],
  2030: ['02-03', '02-17', '04-05', '06-05', '08-05', '09-12', '10-05'],
  2031: ['01-23', '02-06', '04-05', '06-24', '08-24', '10-01', '10-24'],
  2032: ['02-11', '02-25', '04-04', '06-12', '08-12', '09-19', '10-12'],
  2033: ['01-31', '02-14', '04-04', '06-01', '08-01', '09-08', '10-01'],
  2034: ['02-19', '03-05', '04-05', '06-20', '08-20', '09-27', '10-20'],
  2035: ['02-08', '02-22', '04-05', '06-10', '08-10', '09-16', '10-09']
}

export function hasVerifiedHolidayDates(today: string): boolean {
  return Object.hasOwn(festivalDates, Number(today.slice(0, 4)))
}

export function holidayCountdowns(today: string): Countdown[] {
  if (!validDateKey(today)) throw new Error('节日日期无效。')
  const year = Number(today.slice(0, 4))
  const upcoming = new Map<string, Countdown>()
  for (const currentYear of [year, year + 1]) {
    const holidays = [
      { title: '元旦', date: `${currentYear}-01-01` },
      { title: '劳动节', date: `${currentYear}-05-01` },
      { title: '国庆节', date: `${currentYear}-10-01` },
      ...(festivalDates[currentYear] ?? []).map((date, index) => ({ title: festivalTitles[index], date: `${currentYear}-${date}` }))
    ]
    const newYear = holidays.find(item => item.title === '春节')
    if (newYear) {
      const eve = new Date(`${newYear.date}T12:00:00`)
      eve.setDate(eve.getDate() - 1)
      holidays.push({ title: '除夕', date: dateKey(eve) })
    }
    for (const holiday of holidays) {
      if (holiday.date >= today && !upcoming.has(holiday.title)) upcoming.set(holiday.title, { id: `holiday-${holiday.title}`, ...holiday })
    }
  }
  return [...upcoming.values()].sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title, 'zh-CN'))
}
