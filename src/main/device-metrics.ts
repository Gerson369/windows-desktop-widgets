import { cpus, freemem, totalmem } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run=promisify(execFile)
export interface CounterSample { at:number; key:string; received:number; sent:number }
export function networkRate(before: CounterSample | undefined, after: CounterSample): {down:number|null;up:number|null} {
  if(!before || before.key!==after.key || after.at<=before.at || after.received<before.received || after.sent<before.sent) return {down:null,up:null}
  const seconds=(after.at-before.at)/1000
  return {down:(after.received-before.received)/seconds,up:(after.sent-before.sent)/seconds}
}
export interface Metrics { at:number; cpu:number|null; memoryUsed:number; memoryTotal:number; gpu:number|null; down:number|null; up:number|null; batteries:Array<{name:string;percent:number}>; warnings:string[] }
let previousCpu: {idle:number;total:number}|undefined
let previousNetwork: CounterSample|undefined
let saved:Metrics|undefined
let pending:Promise<Metrics>|undefined
function cpuTotals() {
  return cpus().reduce((sum,cpu)=>({idle:sum.idle+cpu.times.idle,total:sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0})
}
export async function readMetrics():Promise<Metrics> {
  if(saved && Date.now()-saved.at<9000) return saved
  if(pending) return saved!
  const result:Metrics={at:Date.now(),cpu:null,memoryUsed:totalmem()-freemem(),memoryTotal:totalmem(),gpu:saved?.gpu ?? null,down:saved?.down ?? null,up:saved?.up ?? null,batteries:saved?.batteries || [],warnings:['设备读数更新中']}
    const totals=cpuTotals()
    if(previousCpu && totals.total>previousCpu.total) result.cpu=Math.max(0,Math.min(100,100*(1-(totals.idle-previousCpu.idle)/(totals.total-previousCpu.total))))
    previousCpu=totals
    saved=result
  pending=(async()=>{
    if(process.platform==='win32') {
      const command=`[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
$warnings = @()
$adapters = @()
$batteries = @()
$gpu = $null
try {
  $adapters = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' } |
    ForEach-Object {
      $stats = $_.GetIPv4Statistics()
      [pscustomobject]@{ Name = $_.Id; ReceivedBytes = $stats.BytesReceived; SentBytes = $stats.BytesSent }
    })
} catch { $warnings += '网卡计数不可用' }
try {
  $batteries = @(Get-CimInstance Win32_Battery |
    Where-Object { $null -ne $_.EstimatedChargeRemaining -and $_.EstimatedChargeRemaining -le 100 } |
    ForEach-Object { [pscustomobject]@{ name = $_.Name; percent = $_.EstimatedChargeRemaining } })
  $devices = @(Get-PnpDevice -Class Bluetooth -Status OK -PresentOnly -ErrorAction SilentlyContinue)
  foreach ($device in $devices) {
    $battery = Get-PnpDeviceProperty -InstanceId $device.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue
    if ($null -ne $battery.Data -and $battery.Data -ge 0 -and $battery.Data -le 100) {
      $batteries += [pscustomobject]@{ name = $device.FriendlyName; percent = [int]$battery.Data }
    }
  }
} catch { $warnings += '部分设备电量不可读取' }
try {
  $engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Filter "Name LIKE '%engtype_3D%'")
  if ($engines.Count) {
    $gpu = ($engines | Measure-Object UtilizationPercentage -Sum).Sum
    $gpu = [Math]::Min(100, $gpu)
  }
} catch { $warnings += 'GPU 指标不可读取' }
[pscustomobject]@{ adapters = $adapters; batteries = $batteries; gpu = $gpu; warnings = $warnings } | ConvertTo-Json -Depth 5 -Compress`
      try {
        const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:20000,maxBuffer:500000,encoding:'utf8'})
        const body=JSON.parse(stdout)
        result.warnings=[]
        const adapters=(Array.isArray(body.adapters)?body.adapters:[]).filter((item:Record<string,unknown>)=>Number.isFinite(item.ReceivedBytes)&&Number.isFinite(item.SentBytes)).sort((a:{Name:string},b:{Name:string})=>a.Name.localeCompare(b.Name))
        // ponytail: sums active adapters; add an adapter selector if virtual adapters duplicate traffic.
        const sample:CounterSample={at:Date.now(),key:adapters.map((item:{Name:string})=>item.Name).join('|'),received:adapters.reduce((sum:number,item:{ReceivedBytes:number})=>sum+item.ReceivedBytes,0),sent:adapters.reduce((sum:number,item:{SentBytes:number})=>sum+item.SentBytes,0)}
        if(adapters.length) Object.assign(result,networkRate(previousNetwork,sample))
        else result.warnings.push('没有活动网卡')
        previousNetwork=sample
        result.batteries=(Array.isArray(body.batteries)?body.batteries:[]).filter((item:{name:unknown;percent:unknown})=>typeof item.name==='string' && typeof item.percent==='number' && item.percent>=0 && item.percent<=100)
        result.gpu=typeof body.gpu==='number' && Number.isFinite(body.gpu)?body.gpu:null
        result.warnings.push(...(Array.isArray(body.warnings)?body.warnings.filter((item:unknown)=>typeof item==='string'):[]))
      } catch(error) {result.warnings=['设备读数暂不可用，将在下一轮重试'];console.error('[设备采样]',error)}
    } else result.warnings=['外设电量、GPU 和网速当前仅支持 Windows']
    result.at=Date.now();saved=result
    return result
  })().finally(()=>{pending=undefined})
  return result
}
