// Gauge widget: a 240-degree dial for any numeric Signal K path.

import {
  startInstrument,
  resolveDisplay,
  USE_DEFAULT,
  formatValue,
  html,
  raw
} from './common'
import type { UpdateArgs } from './common'

const START_ANGLE = -210 // degrees; sweep 240 degrees clockwise to +30
const SWEEP = 240

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, fromDeg)
  const [x2, y2] = polar(cx, cy, r, toDeg)
  const large = toDeg - fromDeg > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

function render({ config, value, meta, prefs }: UpdateArgs): void {
  const root = document.getElementById('root')
  if (!root) return
  const min = config.min ?? 0
  const max = config.max ?? 10
  const decimals = config.decimals ?? 1
  const { value: display, symbol } = resolveDisplay({
    value,
    convert: config.convert,
    meta,
    prefs,
    path: config.path
  })
  const units = config.units ?? symbol
  const label = config.label ?? config.path ?? 'Not configured'

  let frac = 0
  if (typeof display === 'number' && isFinite(display) && max > min) {
    frac = Math.min(1, Math.max(0, (display - min) / (max - min)))
  }
  const needleDeg = START_ANGLE + SWEEP * frac

  const [nx, ny] = polar(50, 53, 38, needleDeg)
  root.innerHTML = html`
  <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
    <path d="${raw(arcPath(50, 53, 44, START_ANGLE, START_ANGLE + SWEEP))}"
          class="track"/>
    <path d="${raw(arcPath(50, 53, 44, START_ANGLE, needleDeg))}" class="fill"/>
    <line x1="50" y1="53" x2="${raw(nx.toFixed(2))}" y2="${raw(ny.toFixed(2))}" class="needle"/>
    <circle cx="50" cy="53" r="3.2" class="hub"/>
    <text x="50" y="48" class="value">${raw(formatValue(display, decimals))}</text>
    <text x="50" y="62" class="units">${units}</text>
    <text x="50" y="97" class="label">${label}</text>
    <text x="${raw(polar(50, 53, 48, START_ANGLE)[0].toFixed(0))}" y="86" class="bound">${raw(String(min))}</text>
    <text x="${raw(polar(50, 53, 48, START_ANGLE + SWEEP)[0].toFixed(0))}" y="86" class="bound">${raw(String(max))}</text>
  </svg>`
}

startInstrument({
  defaults: { min: 0, max: 10, decimals: 1, convert: USE_DEFAULT },
  onUpdate: render
}).catch((err: unknown) => {
  const root = document.getElementById('root')
  if (root) root.textContent = 'Host connection failed'
  console.error(err)
})
