// Shared runtime for instrument widgets: host connection, per-instance
// configuration, Signal K value subscription, unit conversion, and the
// press-and-hold gesture that asks the host to open the configuration panel.
// (Pointer events inside a sandboxed iframe are invisible to the host, so the
// gesture is detected here and delivered via the ui.openConfigPanel method.)

import { connectExtension, type ExtensionClient } from 'signalk-plotterext-bus/extension'
import type { SkMeta, UnitPrefs } from './units'

// Unit conversion / display resolution lives in units.ts (pure, no bus) so it
// can be unit tested. Re-exported here so widgets keep a single import surface.
export {
  CONVERSIONS,
  USE_DEFAULT,
  convert,
  conversionUnits,
  formatDistance,
  formatDuration,
  formatTimestamp,
  resolveDisplay
} from './units'

export type { ExtensionClient }

// ─── Safe HTML templating ─────────────────────────────────────────────────────
//
// `html` is a tagged template literal that auto-escapes every interpolated
// value, so injection safety is the default and cannot be forgotten.
//
// Wrap a value in `raw()` to opt out — only for strings you have already built
// safely (SVG path data, pre-joined option lists, etc.).
//
//   root.innerHTML = html`<text>${label}</text>`         ← auto-escaped
//   root.innerHTML = html`<path d="${raw(arcPath(…))}"/>`← trusted numeric output

/** Sentinel for pre-trusted HTML fragments passed to the `html` tag. */
class SafeHtml {
  constructor(readonly value: string) {}
}

/** Mark a string as already-safe so the `html` tag won't escape it. */
export function raw(s: string): SafeHtml { return new SafeHtml(s) }

/** Tagged template that HTML-escapes every interpolated value by default. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = ''
  for (let i = 0; i < strings.length; i++) {
    out += strings[i] ?? ''
    if (i < values.length) {
      const v = values[i]
      out += v instanceof SafeHtml
        ? v.value
        : String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
    }
  }
  return out
}

/** Per-instance widget configuration as persisted in state storage. */
export interface InstrumentConfig {
  path?: string | undefined
  convert?: string | undefined
  decimals?: number | undefined
  min?: number | undefined
  max?: number | undefined
  label?: string | undefined
  topLabel?: string | undefined
  bottomLabel?: string | undefined
  units?: string | undefined
}

/** Payload delivered to each widget's `onUpdate` callback. */
export interface UpdateArgs {
  config: InstrumentConfig
  value: unknown
  meta: SkMeta | undefined
  prefs: UnitPrefs | null
  client: ExtensionClient
}

/** Returned by `startInstrument` once the host handshake completes. */
export interface InstrumentHandle {
  client: ExtensionClient
  /** Returns true when the most recent pointer sequence was a long press. */
  longPressFired: () => boolean
}

export function formatValue(value: unknown, decimals = 1): string {
  if (typeof value !== 'number' || !isFinite(value)) return '--'
  return value.toFixed(decimals)
}

const LONG_PRESS_MS = 1500

function installLongPress(client: ExtensionClient): () => boolean {
  let timer: ReturnType<typeof setTimeout> | undefined
  let fired = false
  const start = (): void => {
    fired = false
    timer = setTimeout(() => {
      fired = true
      client.call('ui.openConfigPanel').catch(() => {})
    }, LONG_PRESS_MS)
  }
  const cancel = (): void => {
    clearTimeout(timer)
    timer = undefined
  }
  window.addEventListener('pointerdown', start)
  window.addEventListener('pointerup', cancel)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('pointerleave', cancel)
  return (): boolean => fired
}

/**
 * Fetch a path's Signal K metadata (which carries `units` and the server's
 * `displayUnits` preference) over same-origin REST. The bus value stream does
 * not carry meta, so widgets read it here. Returns undefined on any failure.
 */
async function fetchMeta(path: string): Promise<SkMeta | undefined> {
  try {
    const res = await fetch(
      `/signalk/v1/api/vessels/self/${path.replace(/\./g, '/')}/meta`,
      { credentials: 'include' }
    )
    if (!res.ok) return undefined
    return (await res.json()) as SkMeta
  } catch {
    return undefined
  }
}

/** The host's coarse display-unit category preferences (capability `units`),
 *  or null when the host does not expose them. Used only as the fallback when
 *  the server publishes no per-path `displayUnits`. */
async function fetchPrefs(client: ExtensionClient): Promise<UnitPrefs | null> {
  if (!client.hasCapability('units')) return null
  try {
    const r = await client.call('units.get') as { units?: UnitPrefs } | undefined
    return r?.units ?? null
  } catch {
    return null
  }
}

/**
 * Connect, load per-instance config, follow config changes and the
 * configured Signal K path. Calls onUpdate({ config, value, meta, prefs,
 * client }) on every change. Returns an InstrumentHandle once connected.
 */
export async function startInstrument({
  defaults = {},
  onUpdate,
}: {
  defaults?: Partial<InstrumentConfig>
  onUpdate: (args: UpdateArgs) => void
}): Promise<InstrumentHandle> {
  const client = await connectExtension()
  const longPressFired = installLongPress(client)
  const prefs = await fetchPrefs(client)

  // config is typed as InstrumentConfig; state storage may include extra keys
  // which we ignore — only the typed fields are accessed after this point.
  let config: InstrumentConfig = { ...defaults }
  let value: unknown
  let meta: SkMeta | undefined
  let unsubscribeSk: (() => Promise<void>) | null = null

  const emit = (): void => onUpdate({ config, value, meta, prefs, client })

  async function applyConfig(): Promise<void> {
    const stored = await client.state.get()
    // Spread stored (Record<string,unknown>) over typed defaults. TypeScript
    // accepts this via contextual typing; at runtime the stored values come
    // from Signal K state and always carry compatible InstrumentConfig types.
    config = { ...defaults, ...stored }
    value = undefined
    meta = undefined
    if (unsubscribeSk !== null) {
      const u = unsubscribeSk
      unsubscribeSk = null
      await u().catch(() => {})
    }
    emit()
    if (config.path) {
      meta = await fetchMeta(config.path)
      emit()
      unsubscribeSk = await client.signalk.subscribe([config.path], (ev) => {
        value = ev.value
        emit()
      })
    }
  }

  await client.subscribe(['state.changed'], () => {
    applyConfig().catch((err: unknown) => console.warn('config reload failed', err))
  })
  await applyConfig()
  return { client, longPressFired }
}
