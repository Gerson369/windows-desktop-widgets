import type { BrowserWindow, Rectangle } from 'electron'

// Keep in step with --widget-radius in widget-theme.css.
const widgetRadius = 14

export function roundedWidgetShape(width: number, height: number): Rectangle[] {
  const radius = Math.min(widgetRadius, Math.floor(width / 2), Math.floor(height / 2))
  const rows: Rectangle[] = []
  for (let y = 0; y < radius; y++) {
    const inset = Math.ceil(radius - Math.sqrt(radius ** 2 - (radius - y - .5) ** 2) - .5)
    rows.push({ x: inset, y, width: width - 2 * inset, height: 1 })
    rows.push({ x: inset, y: height - 1 - y, width: width - 2 * inset, height: 1 })
  }
  if (height > 2 * radius) rows.push({ x: 0, y: radius, width, height: height - 2 * radius })
  return rows
}

export function bindRoundedWidgetShape(window: BrowserWindow): void {
  if (process.platform !== 'win32') return
  const apply = () => {
    const [width, height] = window.getContentSize()
    if (width > 0 && height > 0) window.setShape(roundedWidgetShape(width, height))
  }
  window.on('resize', apply)
  window.on('moved', apply)
  window.on('show', apply)
  apply()
}
