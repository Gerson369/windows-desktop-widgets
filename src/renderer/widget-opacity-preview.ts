const channel = new BroadcastChannel('gerson-widget-opacity-preview')

function applyOpacity(opacity: unknown): void {
  if (opacity === null) document.documentElement.style.removeProperty('--widget-preview-alpha')
  else if (typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 100) {
    document.documentElement.style.setProperty('--widget-preview-alpha', String(opacity / 100))
  }
}

channel.onmessage = event => applyOpacity(event.data)

export function previewWidgetOpacity(opacity: number | null): void {
  applyOpacity(opacity)
  channel.postMessage(opacity)
}
