export interface WidgetBounds { x: number; y: number; width: number; height: number }

const nearby = (start: number, size: number, otherStart: number, otherSize: number, threshold: number): boolean => Math.max(otherStart - start - size, start - otherStart - otherSize, 0) <= threshold
const closest = (value: number, targets: number[], threshold: number): number => {
  let result = value
  let bestDistance = threshold + 1
  for (const target of targets) {
    const delta = Math.abs(target - value)
    if (delta <= threshold && delta < bestDistance) { result = target; bestDistance = delta }
  }
  return result
}

export function snapResizedWidgetBounds(raw: WidgetBounds, workArea: WidgetBounds, neighbors: WidgetBounds[], distance: number): WidgetBounds {
  const threshold = Math.max(6, Math.min(16, distance))
  const bottoms = [workArea.y + workArea.height]
  for (const other of neighbors) {
    if (nearby(raw.x, raw.width, other.x, other.width, threshold)) bottoms.push(other.y + other.height)
  }
  const bottom = closest(raw.y + raw.height, bottoms, threshold)
  return bottom > raw.y ? { ...raw, height: bottom - raw.y } : raw
}

export function fitWidgetToWorkArea(bounds: WidgetBounds, area: WidgetBounds): WidgetBounds {
  const width = Math.min(bounds.width, Math.max(300, area.width))
  const height = Math.min(bounds.height, Math.max(160, area.height))
  return {width,height,x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-height))}
}

export function draggedWidgetBounds(origin: WidgetBounds, anchor: {x:number;y:number}, pointer: {x:number;y:number}): WidgetBounds {
  return {...origin,x:origin.x+pointer.x-anchor.x,y:origin.y+pointer.y-anchor.y}
}

/** Calculate magnetism from the proposed pointer position, never the previous snapped position. */
export function snapWidgetBounds(raw: WidgetBounds, workArea: WidgetBounds, neighbors: WidgetBounds[], distance: number): WidgetBounds {
  const threshold = Math.max(6, Math.min(16, distance))
  const xTargets = [workArea.x, workArea.x + workArea.width - raw.width]
  const yTargets = [workArea.y, workArea.y + workArea.height - raw.height]
  for (const other of neighbors) {
    if (nearby(raw.y, raw.height, other.y, other.height, threshold)) xTargets.push(other.x - raw.width, other.x + other.width, other.x, other.x + other.width - raw.width)
    if (nearby(raw.x, raw.width, other.x, other.width, threshold)) yTargets.push(other.y - raw.height, other.y + other.height, other.y, other.y + other.height - raw.height)
  }
  return { ...raw, x: closest(raw.x, xTargets, threshold), y: closest(raw.y, yTargets, threshold) }
}
