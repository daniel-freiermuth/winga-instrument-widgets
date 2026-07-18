// Display Value widget: a centered three-row text readout. Small top label,
// large value in the middle, larger bottom label. Blank labels collapse.
// Example: top "Speed over ground", middle the live value, bottom "SOG".

import {
  startInstrument,
  resolveDisplay,
  USE_DEFAULT,
  formatValue,
  formatDistance,
  formatDuration,
  formatTimestamp,
  html,
  raw
} from './common'
import type { UpdateArgs } from './common'

function render({ config, value, meta, prefs }: UpdateArgs): void {
  const root = document.getElementById('root')
  if (!root) return

  const key = config.convert ?? USE_DEFAULT
  let text: string
  let units: string

  if (key === 'iso8601') {
    // ISO 8601 timestamp string → compact local-time display.
    text = (value == null) ? '--'
      : typeof value === 'string' ? formatTimestamp(value)
      : '--'
    units = config.units ?? ''
  } else if (key === 's-duration') {
    // Seconds number → human-readable duration.
    text = (value == null) ? '--'
      : typeof value === 'number' ? formatDuration(value)
      : '--'
    units = config.units ?? ''
  } else if (key === 'm-nm-auto') {
    // Metres → "452 m" below 0.5 nm, "2.3 nm" above.
    text = (value == null) ? '--'
      : typeof value === 'number' ? formatDistance(value)
      : '--'
    units = config.units ?? ''
  } else {
    const { value: display, symbol } = resolveDisplay({
      value,
      convert: config.convert,
      meta,
      prefs,
      path: config.path
    })
    units = config.units ?? symbol
    if (value === undefined || value === null) {
      text = '--'
    } else if (typeof display === 'number') {
      text = formatValue(display, config.decimals ?? 1)
    } else {
      text = String(display)
    }
  }
  const configured = !!config.path
  const rows: string[] = []
  if (config.topLabel) {
    rows.push(html`<div class="display-top">${config.topLabel}</div>`)
  }
  rows.push(html`<div class="display-value">${text}${
    raw(units ? html`<span class="display-units">${units}</span>` : '')
  }</div>`)
  if (config.bottomLabel) {
    rows.push(html`<div class="display-bottom">${config.bottomLabel}</div>`)
  }
  if (!configured) {
    rows.push('<div class="display-bottom">Not configured</div>')
  }
  root.innerHTML = html`<div class="display">${raw(rows.join(''))}</div>`
}

startInstrument({
  defaults: { convert: USE_DEFAULT, decimals: 1, topLabel: '', bottomLabel: '' },
  onUpdate: render
}).catch((err: unknown) => {
  const root = document.getElementById('root')
  if (root) root.textContent = 'Host connection failed'
  console.error(err)
})
