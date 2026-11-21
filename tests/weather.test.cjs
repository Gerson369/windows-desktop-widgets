const test=require('node:test')
const assert=require('node:assert/strict')
const {EventEmitter}=require('node:events')
const {loadTypeScript}=require('./load-typescript.cjs')

function requestHarness(addresses, {status=200, body='weather'}={}) {
  const calls=[]
  const module=loadTypeScript('src/main/public-request.ts',{
    'node:dns/promises':{lookup:async()=>addresses},
    'node:https':{request:(url,options,callback)=>{
      const request=new EventEmitter()
      request.destroy=()=>{}
      request.end=()=>queueMicrotask(()=>{
        options.lookup(url.hostname,{all:true},(_error,selected)=>{calls.push(selected)})
        const response=new EventEmitter()
        response.statusCode=status;response.resume=()=>{}
        callback(response)
        response.emit('data',Buffer.from(body));response.emit('end')
      })
      return request
    }}
  })
  return {module,calls}
}

test('public request bounds DNS by the same 12-second deadline and never starts a late connection',async context=>{
  context.mock.timers.enable({apis:['setTimeout']})
  let resolveLookup,connections=0
  const {publicText}=loadTypeScript('src/main/public-request.ts',{
    'node:dns/promises':{lookup:()=>new Promise(resolve=>{resolveLookup=resolve})},
    'node:https':{request:()=>{connections++;throw Error('unexpected request')}}
  })
  const result=assert.rejects(publicText('https://example.com'),error=>error.code==='ETIMEDOUT' && /超时/.test(error.message))
  context.mock.timers.tick(12000)
  await result
  resolveLookup([{address:'8.8.8.8',family:4}]);await Promise.resolve()
  assert.equal(connections,0)
})

test('public request keeps all verified DNS choices while rejecting private results, redirects and excess content',async()=>{
  const addresses=[{address:'8.8.8.8',family:4},{address:'2606:4700:4700::1111',family:6}]
  const normal=requestHarness(addresses)
  assert.equal(await normal.module.publicText('https://example.com'),'weather')
  assert.deepEqual(normal.calls,[addresses])
  const mixed=requestHarness([...addresses,{address:'127.0.0.1',family:4}])
  await assert.rejects(mixed.module.publicText('https://example.com'),/内网/)
  assert.equal(mixed.calls.length,0)
  const redirect=requestHarness(addresses,{status:302})
  await assert.rejects(redirect.module.publicText('https://example.com'),/302/)
  assert.equal(redirect.calls.length,1)
  const large=requestHarness(addresses,{body:'0123456789'})
  await assert.rejects(large.module.publicText('https://example.com',5),/内容过大/)
})

const city={id:'guangzhou',name:'广州',latitude:23.11667,longitude:113.25}
const body=JSON.stringify({current:{temperature_2m:15.6,apparent_temperature:14.7,relative_humidity_2m:66,wind_speed_10m:5,weather_code:0},daily:{time:['2026-11-21'],temperature_2m_min:[12],temperature_2m_max:[21],weather_code:[3]}})

test('weather retries one transient connection reset, shares in-flight work and then uses its cache',async()=>{
  let calls=0
  const api=loadTypeScript('src/main/weather-service.ts',{'./public-request':{publicText:async()=>{calls++;if(calls===1)throw Object.assign(Error('socket hang up'),{code:'ECONNRESET'});return body}}})
  const [first,second]=await Promise.all([api.cityWeather(city),api.cityWeather(city)])
  assert.equal(calls,2);assert.equal(first.temperature,15.6);assert.equal(first,second)
  assert.equal((await api.cityWeather(city)).temperature,15.6);assert.equal(calls,2)
})

test('weather retry is bounded and does not retry HTTP or security rejection, and a failed request can be retried later',async()=>{
  let calls=0,fail=true
  const api=loadTypeScript('src/main/weather-service.ts',{'./public-request':{publicText:async()=>{calls++;if(fail)throw Object.assign(Error('网络请求超时。'),{code:'ETIMEDOUT'});return body}}})
  await assert.rejects(api.cityWeather(city),/超时/);assert.equal(calls,2)
  fail=false;assert.equal((await api.cityWeather(city)).humidity,66);assert.equal(calls,3)
  for(const message of ['服务返回 429','不能读取本机、内网或保留地址。']){
    let rejectedCalls=0
    const blocked=loadTypeScript('src/main/weather-service.ts',{'./public-request':{publicText:async()=>{rejectedCalls++;throw Error(message)}}})
    await assert.rejects(blocked.cityWeather(city));assert.equal(rejectedCalls,1)
  }
})

test('weather card prevents duplicate refreshes, ends failed loading and clears the error after a successful retry',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue')
  const {parse,compileScript}=require('@vue/compiler-sfc'),{renderToString}=require('vue/server-renderer')
  const {descriptor}=parse(fs.readFileSync('src/renderer/components/suite/WeatherCard.vue','utf8'))
  const compiled=ts.transpileModule(compileScript(descriptor,{id:'weather-card-test'}).content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const props=vue.reactive({data:{suite:{cities:[city]}}})
  let calls=0,rejectRequest,fail=true
  const toolbox={suite:{weather:async()=>{calls++;if(fail)await new Promise((_resolve,reject)=>{rejectRequest=reject});return {city,temperature:15.6}}}}
  const context={exports:{},String,require:request=>{
    if(request==='vue')return vue
    if(request==='../../toolbox')return {toolbox}
    if(request==='../../weather-description')return loadTypeScript('src/renderer/weather-description.ts')
    if(request.endsWith('.vue'))return {}
    throw Error('Unexpected component dependency: '+request)
  }}
  vm.runInNewContext(compiled,context)
  const component=context.exports.default
  let state
  await renderToString(vue.createSSRApp({props:component.props,setup(current,setupContext){state=component.setup(current,setupContext);return()=>null}},props))
  const pending=state.refresh()
  assert.equal(state.refreshing.value,true)
  await state.refresh();assert.equal(calls,1)
  rejectRequest(Error('Error invoking remote method: 网络请求超时。'));await pending
  assert.equal(state.refreshing.value,false)
  assert.match(state.errors.value[city.id],/超时/)
  assert.doesNotMatch(state.errors.value[city.id],/remote method/)
  fail=false;await state.refresh()
  assert.equal(state.refreshing.value,false);assert.equal(state.errors.value[city.id],undefined)
  assert.equal(state.readings.value[city.id].temperature,15.6)
})
