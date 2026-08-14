// Shared runtime for cyclic navigation widgets (distance, time).
//
// Unlike the single-path instruments (gauge/meter/switch/display) these widgets
// are zero-configuration: they read a fixed set of well-known Signal K course
// paths and cycle through them on tap. There is nothing to set up — the mode
// list is baked in — so they declare no config panel in the manifest. A short
// tap advances to the next mode; a long press is ignored so it can reach the
// host's remove affordance.

import { connectExtension } from 'signalk-plotterext-bus/extension'
import { html, raw } from './common'

/** One display mode of a cyclic widget: a fixed path and how to render it. */
export interface CyclicMode {
  /** Signal K path this mode reads. */
  path: string
  /** Short label shown above the value (e.g. "ETA · Goal"). */
  label: string
  /** Format a raw SK value into display text (`--` when absent/wrong type). */
  format: (value: unknown) => string
}

// A tap is a quick press that does not travel far; anything longer or draggier
// is a long-press/scroll and must not cycle (it belongs to the host's
// press-and-hold remove gesture).
const TAP_MAX_MS = 500
const TAP_MAX_MOVE = 12

/** Render a mode indicator like `●○○` — one glyph per mode, filled at `active`. */
function dots(count: number, active: number): string {
  let out = ''
  for (let i = 0; i < count; i++) out += i === active ? '●' : '○'
  return out
}

/**
 * Connect, subscribe to every mode's path, and render the current mode. Tap to
 * advance. The selected mode lives only in memory, so the widget always starts
 * on the first mode after a (re)load.
 */
export async function startCyclic(modes: CyclicMode[]): Promise<void> {
  const root = document.getElementById('root')
  if (!root) return

  const client = await connectExtension()
  const values = new Map<string, unknown>()
  let index = 0

  const render = (): void => {
    const mode = modes[index]
    if (!mode) return
    const text = mode.format(values.get(mode.path))
    root.innerHTML = html`
    <div class="cyclic">
      <div class="cyclic-top">${mode.label}</div>
      <div class="cyclic-value">${text}</div>
      <div class="cyclic-dots">${raw(dots(modes.length, index))}</div>
    </div>`
  }
  render()

  const advance = (): void => {
    index = (index + 1) % modes.length
    render()
  }

  // Keyboard operability: the widget acts as a button that advances on
  // Enter/Space. The attributes and listener live on the persistent #root
  // element (render() only replaces its children), so they survive re-renders.
  root.tabIndex = 0
  root.setAttribute('role', 'button')
  root.setAttribute('aria-label', 'Cycle navigation mode')
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    advance()
  })

  // Tap-to-cycle, guarding against long-press and drags (see constants above).
  let downT = 0
  let downX = 0
  let downY = 0
  window.addEventListener('pointerdown', (e) => {
    downT = Date.now()
    downX = e.clientX
    downY = e.clientY
  })
  window.addEventListener('pointerup', (e) => {
    if (
      Date.now() - downT > TAP_MAX_MS ||
      Math.abs(e.clientX - downX) > TAP_MAX_MOVE ||
      Math.abs(e.clientY - downY) > TAP_MAX_MOVE
    ) return
    advance()
  })

  const paths = [...new Set(modes.map((m) => m.path))]
  await client.signalk.subscribe(paths, (ev) => {
    values.set(ev.path, ev.value)
    render()
  })
}
