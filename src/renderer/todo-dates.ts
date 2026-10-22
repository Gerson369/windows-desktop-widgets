import { dateKey, validDateKey } from '../main/widget-suite'

export function relativeDateKey(now: number, offset: number): string {
  const date = new Date(now)
  date.setDate(date.getDate() + offset)
  return dateKey(date)
}
export function todoDateLabel(value: string, now: number): string {
  if (!validDateKey(value)) return '日期'
  if (value === relativeDateKey(now, 0)) return '今天'
  if (value === relativeDateKey(now, 1)) return '明天'
  if (value === relativeDateKey(now, -1)) return '昨天'
  const date = new Date(`${value}T12:00:00`)
  return date.getFullYear() === new Date(now).getFullYear() ? `${date.getMonth() + 1}月${date.getDate()}日` : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function parseTodoDate(input:string,now:number):string|null {
  const value=input.trim()
  if(!value)return ''
  const shortcuts:Record<string,number>={'今天':0,'明天':1,'后天':2,'昨天':-1}
  if(value in shortcuts)return relativeDateKey(now,shortcuts[value])
  const match=value.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if(!match)return null
  const key=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`
  return validDateKey(key)?key:null
}
export function parseTodoDateTime(input: string, now: number): string | null {
  const parts = input.trim().split(/[T ]/)
  if (parts.length === 1) return parseTodoDate(parts[0], now)
  if (parts.length !== 2 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(parts[1])) return null
  const day = parseTodoDate(parts[0], now)
  return day ? `${day}T${parts[1]}` : null
}
export function todoDueAt(value: string): string | undefined {
  if (!value) return undefined
  const parsed = parseTodoDateTime(value, 0)
  if (!parsed) throw new Error('请输入有效的年月日和时间。')
  return new Date(parsed.includes('T') ? `${parsed}:00` : `${parsed}T23:59:00`).toISOString()
}
export function todoDueValue(value: string): string {
  const date = new Date(value)
  return `${dateKey(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
}
export function calendarMonthDays(month:string):string[] {
  const first=new Date(`${month}-01T12:00:00`)
  first.setDate(first.getDate()-((first.getDay()+6)%7))
  return Array.from({length:42},(_,offset)=>{const day=new Date(first);day.setDate(first.getDate()+offset);return dateKey(day)})
}
