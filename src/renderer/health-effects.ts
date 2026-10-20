export function healthEffects(percent: number, overdue: boolean) {
  const excess = overdue ? Math.max(0, percent / 100 - 1) : 0
  const severity = Math.min(1, excess / 2)
  const color = overdue ? `rgb(244, ${Math.round(207 - 57 * severity)}, ${Math.round(156 - 96 * severity)})` : undefined
  const fallenCount = overdue ? Math.min(10, Math.max(0, Math.floor((percent - 100) / 10))) : 0
  const looseness = overdue && fallenCount < 10 ? Math.max(0, Math.min(1, (percent - 100 - fallenCount * 10) / 10)) : 0
  return { color, severity, spill: Math.min(1, excess), flood: Math.min(1, excess / 3), separation: fallenCount / 10, looseness }
}
export function spineSegments(progress: number, separation: number, looseness = 0) {
  const bend = progress * 10
  const separatedCount = Math.ceil(separation * 10)
  return Array.from({ length: 10 }, (_, i) => {
    const t = i / 9, separated = separation > 0 && i < separatedCount
    const amount = separated ? separation : 0
    const height = 3 - 1.2 * amount
    const y = (7 + i * 4.3) * (1 - amount) + (4 + t * (47 - height)) * amount
    const angle = i === 0 || i === 9 ? 0 : -Math.atan(bend * Math.PI * Math.cos(t * Math.PI) / 42.3) * 180 / Math.PI + (i % 2 ? 1 : -1) * amount * 14
    return { x: Math.max(5, Math.min(28, 17 + bend * Math.sin(t * Math.PI) + (i % 2 ? 1 : -1) * amount * 3)), y, height, angle, separated, looseness: separated ? 1 : i === separatedCount ? looseness : 0 }
  })
}

export function waterOverflowEffects(percent: number, overdue: boolean) {
  return { ...healthEffects(percent, overdue), color: '#78cbdc' }
}
