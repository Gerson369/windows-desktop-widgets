import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address,prefix,'ipv4')
export function publicAddress(address: string): boolean {
  const family=isIP(address)
  if(family===4) return !blocked.check(address,'ipv4')
  if(family===6) return /^[23][\da-f]{3}:/i.test(address) && !/^2001:(?:db8|0*0):/i.test(address) && !/^2002:/i.test(address)
  return false
}
export async function publicText(address: string, maximum=2_000_000): Promise<string> {
  const url=new URL(address)
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443')) throw new Error('仅支持公网 HTTPS 地址和标准端口。')
  const host=url.hostname.replace(/^\[|\]$/g,'')
  return new Promise((resolve,reject)=>{
    let currentRequest: ReturnType<typeof request> | undefined
    let finished=false
    const finish=(error:Error|null,body=''):void=>{
      if(finished) return
      finished=true
      clearTimeout(timeout)
      if(error) reject(error)
      else resolve(body)
    }
    // DNS lookup and connection share one deadline, including a resolver that never returns.
    const timeout=setTimeout(()=>{
      finish(Object.assign(new Error('网络请求超时。'),{code:'ETIMEDOUT'}))
      currentRequest?.destroy()
    },12000)
    void lookup(host,{all:true}).then(resolved=>{
      if(finished) return
      if(!resolved.length || resolved.some(item=>!publicAddress(item.address))) throw new Error('不能读取本机、内网或保留地址。')
      const selected=resolved[0]
      currentRequest=request(url,{
        headers:{'User-Agent':'GersonDesktop/2.0','Accept':'application/json,text/calendar,text/plain'},
        lookup:((_host:unknown,options:{all?:boolean},callback:Function)=>options.all?callback(null,resolved):callback(null,selected.address,selected.family)) as never
      },response=>{
        if(response.statusCode!==200) {
          finish(new Error(`服务返回 ${response.statusCode}；请提供最终地址，不自动跟随重定向。`))
          response.resume();currentRequest?.destroy();return
        }
        const chunks:Buffer[]=[]
        let size=0
        response.on('data',(chunk:Buffer)=>{
          size+=chunk.length
          if(size>maximum) {finish(new Error('服务返回内容过大。'));currentRequest?.destroy()}
          else chunks.push(chunk)
        })
        response.on('end',()=>finish(null,Buffer.concat(chunks).toString('utf8')))
        response.on('error',error=>finish(error))
      })
      currentRequest.on('error',error=>finish(error))
      currentRequest.end()
    }).catch(error=>finish(error))
  })
}
