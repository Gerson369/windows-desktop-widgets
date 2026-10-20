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
export function calendarMonthDays(month:string):string[] {
  const first=new Date(`${month}-01T12:00:00`)
  first.setDate(first.getDate()-((first.getDay()+6)%7))
  return Array.from({length:42},(_,offset)=>{const day=new Date(first);day.setDate(first.getDate()+offset);return dateKey(day)})
}
