import { publicText } from './public-request'
import type { WeatherCity } from './widget-suite'
export interface WeatherReading { city: WeatherCity; updatedAt: string; temperature: number; apparent: number; humidity: number; wind: number; code: number; days: Array<{date:string;low:number;high:number;code:number}>; stale?: boolean; error?: string }
const cache=new Map<string,WeatherReading>()
const pending=new Map<string,Promise<WeatherReading>>()
export async function searchCities(query: unknown): Promise<WeatherCity[]> {
  if(typeof query!=='string' || query.trim().length<2 || query.length>80) throw new Error('请输入 2–80 个字符的城市名称。')
  const body=JSON.parse(await publicText(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=8&language=zh&format=json`,200000))
  if(!Array.isArray(body.results)) return []
  return body.results.filter((city:Record<string,unknown>)=>Number.isFinite(city.latitude) && Number.isFinite(city.longitude)).map((city:Record<string,unknown>)=>({id:String(city.id),name:[city.name,city.admin1,city.country].filter(Boolean).join(' · ').slice(0,120),latitude:city.latitude as number,longitude:city.longitude as number}))
}
export async function cityWeather(city:WeatherCity):Promise<WeatherReading> {
  const key=`${city.latitude},${city.longitude}`
  const saved=cache.get(key)
  if(saved && Date.now()-Date.parse(saved.updatedAt)<15*60000) return {...saved,city}
  if(pending.has(key)) return pending.get(key)!
  const task=(async()=>{
    try {
      const body=JSON.parse(await publicText(`https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`,200000))
      const current=body.current, daily=body.daily
      if(!current || ![current.temperature_2m,current.apparent_temperature,current.relative_humidity_2m,current.wind_speed_10m,current.weather_code].every(Number.isFinite) || !Array.isArray(daily?.time)) throw new Error('天气服务返回数据不完整。')
      const reading:WeatherReading={city,updatedAt:new Date().toISOString(),temperature:current.temperature_2m,apparent:current.apparent_temperature,humidity:current.relative_humidity_2m,wind:current.wind_speed_10m,code:current.weather_code,days:daily.time.slice(0,3).map((date:string,index:number)=>({date,low:daily.temperature_2m_min[index],high:daily.temperature_2m_max[index],code:daily.weather_code[index]}))}
      if(cache.size>=24) cache.delete(cache.keys().next().value!)
      cache.set(key,reading)
      return reading
    } catch(error) {
      if(saved) return {...saved,city,stale:true,error:error instanceof Error?error.message:'天气更新失败'}
      throw error
    } finally {pending.delete(key)}
  })()
  pending.set(key,task)
  return task
}
