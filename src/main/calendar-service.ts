import ICAL from 'ical.js'
import type { CalendarSource, CalendarEvent } from './widget-suite'

export interface AgendaEvent { id: string; title: string; start: string; end: string; allDay: boolean; source: string }
export function validateCalendar(content: string): void {
  if (Buffer.byteLength(content,'utf8') > 2_000_000) throw new Error('日历文件不能超过 2 MB。')
  const calendar = new ICAL.Component(ICAL.parse(content))
  if (calendar.name !== 'vcalendar' || calendar.getAllSubcomponents('vevent').length > 2000) throw new Error('请选择包含不超过 2000 项日程的 ICS 日历。')
}

function instant(time: ICAL.Time, component: ICAL.Component, property: string): Date {
  if (time.isDate) return new Date(time.year,time.month-1,time.day)
  const zone = component.getFirstProperty(property)?.getParameter('tzid')
  if (!zone || typeof zone !== 'string' || time.zone.tzid !== 'floating') return time.toJSDate()
  // Some feeds omit VTIMEZONE but supply an IANA TZID; use the platform's timezone database.
  const format = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  const wall = Date.UTC(time.year,time.month-1,time.day,time.hour,time.minute,time.second)
  let timestamp=wall
  for(let attempt=0;attempt<3;attempt++) {
    const parts=Object.fromEntries(format.formatToParts(timestamp).map(part=>[part.type,part.value]))
    const projected=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second))
    const correction=wall-projected
    timestamp+=correction
    if(!correction) break
  }
  return new Date(timestamp)
}

export function expandCalendar(source: CalendarSource, from: number, until: number): AgendaEvent[] {
  validateCalendar(source.content)
  const calendar=new ICAL.Component(ICAL.parse(source.content))
  const components=calendar.getAllSubcomponents('vevent')
  const result: AgendaEvent[]=[]
  let budget=50000
  for(const component of components) {
    const event=new ICAL.Event(component)
    if(event.isRecurrenceException()) continue
    const append=(details: {startDate:ICAL.Time;endDate:ICAL.Time;item:ICAL.Event})=>{
      if(String(details.item.component.getFirstPropertyValue('status')).toUpperCase()==='CANCELLED') return
      const start=instant(details.startDate,details.item.component,'dtstart'), end=instant(details.endDate,details.item.component,'dtend')
      if(!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error('日历中存在无效时间。')
      if(start.getTime()<until && (end.getTime()>from || start.getTime()>=from)) result.push({id:`${source.id}:${event.uid}:${start.toISOString()}`,title:String(details.item.summary || '未命名日程').slice(0,120),start:start.toISOString(),end:end.toISOString(),allDay:details.startDate.isDate,source:source.name})
      if(result.length>2000) throw new Error('此日期范围日程过多，请缩小范围。')
    }
    if(event.isRecurring()) {
      const iterator=event.iterator()
      let next: ICAL.Time | undefined
      while((next=iterator.next())) {
        if(--budget<=0) throw new Error('重复日程过于密集，请使用较短的订阅历史。')
        // Preserve the original recurrence start so COUNT and EXDATE remain correct.
        if(instant(next,component,'dtstart').getTime()>until+366*86400000) break
        append(event.getOccurrenceDetails(next))
      }
    } else append({startDate:event.startDate,endDate:event.endDate,item:event})
  }
  return result
}

export function agenda(events: CalendarEvent[], sources: CalendarSource[], from: number, until: number): {events:AgendaEvent[];errors:string[]} {
  const result:AgendaEvent[]=events.filter(event=>Date.parse(event.start)<until && (Date.parse(event.end)>from || Date.parse(event.start)>=from)).map(event=>({...event,source:event.category==='work'?'工作':'个人'}))
  const errors:string[]=[]
  for(const source of sources.filter(source=>source.enabled)) {
    try {result.push(...expandCalendar(source,from,until))}
    catch(error) {errors.push(`${source.name}：${error instanceof Error?error.message:'日历解析失败'}`)}
  }
  return {events:result.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id)).slice(0,2000),errors}
}
