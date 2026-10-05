// Configuration panel. Opened by the host with context.targetInstance set to
// the widget instance being configured (and context.targetWidget naming the
// widget type). Reads/writes that instance's state; the widget re-renders
// live via the host's state.changed event.

import { connectExtension } from 'signalk-plotterext-bus/extension'
import { CONVERSIONS, USE_DEFAULT, html, parseInstrumentConfig, raw } from './common'
import { validConversions } from './units'
import type { InstrumentConfig } from './common'

const NUMERIC = 'numeric' as const
const BOOLEAN = 'boolean' as const

type PathKind = typeof NUMERIC | typeof BOOLEAN

interface WidgetSpec {
  pathKind: PathKind
  fields: readonly string[]
}

const WIDGET_FIELDS: Record<string, WidgetSpec> = {
  gauge: { pathKind: NUMERIC, fields: ['label', 'convert', 'min', 'max', 'decimals'] },
  meter: { pathKind: NUMERIC, fields: ['label', 'convert', 'decimals'] },
  switch: { pathKind: BOOLEAN, fields: ['label'] },
  display: {
    pathKind: NUMERIC,
    fields: ['topLabel', 'bottomLabel', 'convert', 'decimals']
  }
}

interface KnownPath {
  readonly path: string
  /** Label shown in the datalist dropdown. */
  readonly label: string
  /** SK meta units — pre-seeded into unitsByPath so conversion selection works
   *  even before the server publishes the path. */
  readonly units: string
  /** Widget types that should see this path in their suggestion list. */
  readonly widgets: readonly string[]
}

/**
 * Well-known Signal K paths, always shown in the config datalist regardless of
 * whether the server has published them yet.  Paths sourced from the SK
 * course-provider-plugin (`navigation.course.calcValues.*`).
 */
const KNOWN_PATHS: readonly KnownPath[] = [
  {
    path: 'navigation.speedOverGround',
    label: 'SOG – Speed over ground',
    units: 'm/s',
    widgets: ['gauge', 'meter', 'display']
  },
  {
    path: 'navigation.courseOverGroundTrue',
    label: 'COG – Course over ground (true)',
    units: 'rad',
    widgets: ['display']
  },
  {
    path: 'navigation.course.calcValues.bearingTrue',
    label: 'BTW – Bearing to next waypoint (true)',
    units: 'rad',
    widgets: ['display']
  },
  {
    path: 'navigation.course.calcValues.distance',
    label: 'DTG – Distance to next waypoint',
    units: 'm',
    widgets: ['gauge', 'display']
  },
  {
    path: 'navigation.course.calcValues.route.distance',
    label: 'DTG – Distance to route end',
    units: 'm',
    widgets: ['gauge', 'display']
  },
  {
    path: 'navigation.course.calcValues.estimatedTimeOfArrival',
    label: 'ETA – Next waypoint',
    units: 'RFC 2822',
    widgets: ['display']
  },
  {
    path: 'navigation.course.calcValues.route.estimatedTimeOfArrival',
    label: 'ETA – Route end',
    units: 'RFC 2822',
    widgets: ['display']
  },
  {
    path: 'navigation.course.calcValues.timeToGo',
    label: 'TTG – Time to next waypoint',
    units: 's',
    widgets: ['display']
  },
  {
    path: 'navigation.course.calcValues.route.timeToGo',
    label: 'TTG – Time to route end',
    units: 's',
    widgets: ['display']
  }
]

/** Runtime check that `v` is a non-null object (required before property access). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Flatten the Signal K full tree into [path, value, metaUnits] leaves. */
function flattenTree(
  node: unknown,
  prefix = '',
  out: [string, unknown, string | undefined][] = []
): [string, unknown, string | undefined][] {
  if (!isRecord(node)) return out
  if ('value' in node && (typeof node['value'] !== 'object' || node['value'] === null)) {
    const meta = node['meta']
    const units = isRecord(meta) && typeof meta['units'] === 'string' ? meta['units'] : undefined
    out.push([prefix, node['value'], units])
    return out
  }
  for (const [key, child] of Object.entries(node)) {
    if (key === 'meta' || key === 'timestamp' || key === '$source' || key === 'values') {
      continue
    }
    flattenTree(child, prefix ? `${prefix}.${key}` : key, out)
  }
  return out
}

function kindOf(value: unknown): PathKind | null {
  if (typeof value === 'number') return NUMERIC
  if (typeof value === 'boolean') return BOOLEAN
  return null
}

/**
 * Candidate paths for a widget kind, plus a path -> SK meta units map used
 * for unit-aware conversion selection.
 */
async function fetchPaths(pathKind: PathKind): Promise<{
  paths: string[]
  unitsByPath: Record<string, string>
}> {
  const res = await fetch('/signalk/v1/api/vessels/self', {
    credentials: 'include'
  })
  if (!res.ok) throw new Error(`vessels/self fetch failed: ${res.status}`)
  const tree: unknown = await res.json()
  const leaves = flattenTree(tree)
  const paths: string[] = []
  const unitsByPath: Record<string, string> = {}
  for (const [path, value, metaUnits] of leaves) {
    if (metaUnits !== undefined) unitsByPath[path] = metaUnits
    const kind = kindOf(value)
    if (kind === pathKind) paths.push(path)
    // Switch-style paths are numeric 0/1 on the wire; offer them for
    // boolean widgets too.
    if (pathKind === BOOLEAN && kind === NUMERIC && /(switches|\.state$)/.test(path)) {
      paths.push(path)
    }
  }
  return { paths: [...new Set(paths)].sort(), unitsByPath }
}

function fieldRow(label: string, control: string): string {
  return html`<label class="row"><span>${label}</span>${raw(control)}</label>`
}

function buildForm(widgetType: string, state: InstrumentConfig): string {
  const spec = WIDGET_FIELDS[widgetType] ?? WIDGET_FIELDS['gauge']!
  const rows: string[] = []
  rows.push(
    fieldRow(
      'Signal K path',
      html`<div class="path-picker">
        <input id="path" type="text" autocomplete="off"
               value="${state.path ?? ''}" placeholder="Type to search…">
        <ul class="path-suggestions" id="path-suggestions" hidden></ul>
      </div>`
    )
  )
  if (spec.fields.includes('label')) {
    rows.push(
      fieldRow('Label',
        html`<input id="label" value="${state.label ?? ''}" placeholder="Display name">`)
    )
  }
  if (spec.fields.includes('topLabel')) {
    rows.push(
      fieldRow('Top label',
        html`<input id="topLabel" value="${state.topLabel ?? ''}" placeholder="Small title (blank = hidden)">`)
    )
  }
  if (spec.fields.includes('bottomLabel')) {
    rows.push(
      fieldRow('Bottom label',
        html`<input id="bottomLabel" value="${state.bottomLabel ?? ''}" placeholder="Large label (blank = hidden)">`)
    )
  }
  if (spec.fields.includes('convert')) {
    rows.push(fieldRow('Units', `<select id="convert"></select>`))
  }
  if (spec.fields.includes('min')) {
    rows.push(fieldRow('Minimum', `<input id="min" type="number" step="any" value="${state.min ?? 0}">`))
    rows.push(fieldRow('Maximum', `<input id="max" type="number" step="any" value="${state.max ?? 10}">`))
  }
  if (spec.fields.includes('decimals')) {
    rows.push(fieldRow('Decimals', `<input id="decimals" type="number" min="0" max="4" value="${state.decimals ?? 1}">`))
  }
  return rows.join('')
}

/** Read the current form values into a state record compatible with state.set(). */
function readForm(widgetType: string): Record<string, unknown> {
  const spec = WIDGET_FIELDS[widgetType] ?? WIDGET_FIELDS['gauge']!
  const inp = (id: string): string =>
    (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? ''
  const values: Record<string, unknown> = { path: inp('path') }
  if (spec.fields.includes('label')) values['label'] = inp('label')
  if (spec.fields.includes('topLabel')) values['topLabel'] = inp('topLabel')
  if (spec.fields.includes('bottomLabel')) values['bottomLabel'] = inp('bottomLabel')
  if (spec.fields.includes('convert')) values['convert'] = inp('convert')
  if (spec.fields.includes('min')) {
    values['min'] = Number(inp('min'))
    values['max'] = Number(inp('max'))
  }
  if (spec.fields.includes('decimals')) values['decimals'] = Number(inp('decimals'))
  return values
}

/**
 * Repopulate the conversion select for the currently entered path. The default,
 * always-offered choice is "Server default", which lets the widget follow the
 * user's server-defined display preference (`meta.displayUnits`) at render
 * time — so most widgets never need this changed.
 */
function refreshConversionOptions(
  unitsByPath: Record<string, string>,
  savedPath: string | undefined,
  savedConvert: string | undefined
): void {
  const select = document.getElementById('convert') as HTMLSelectElement | null
  if (!select) return
  const path = (document.getElementById('path') as HTMLInputElement | null)?.value.trim() ?? ''
  const units = unitsByPath[path]
  const valid = validConversions(units, Object.keys(CONVERSIONS))
  const keep =
    path === savedPath &&
    savedConvert !== undefined &&
    (savedConvert === USE_DEFAULT || valid.includes(savedConvert))
  const selected = keep ? savedConvert : USE_DEFAULT
  const options = [
    `<option value="${USE_DEFAULT}" ${selected === USE_DEFAULT ? 'selected' : ''}>Server default</option>`,
    ...valid.map(
      (key) =>
        `<option value="${key}" ${key === selected ? 'selected' : ''}>${CONVERSIONS[key]?.label ?? key}</option>`
    )
  ]
  select.innerHTML = options.join('')
}

async function main(): Promise<void> {
  const root = document.getElementById('root')
  if (!root) return
  const client = await connectExtension()
  const widgetType = client.context.targetWidget ?? 'gauge'
  const spec = WIDGET_FIELDS[widgetType] ?? WIDGET_FIELDS['gauge']!

  root.innerHTML = '<p class="status">Loading Signal K paths…</p>'
  const [{ paths, unitsByPath }, stored] = await Promise.all([
    fetchPaths(spec.pathKind).catch(
      (): { paths: string[]; unitsByPath: Record<string, string> } => ({
        paths: [],
        unitsByPath: {}
      })
    ),
    client.state.get()
  ])

  // Merge well-known paths for this widget type.
  // Known paths go first (labelled, in declaration order); server paths that
  // are already in the known list are deduplicated.  Known-path units are
  // pre-seeded so the conversion selector works correctly even for paths not
  // yet published by the server (e.g. ETA paths that are ISO 8601 strings).
  const knownForWidget = KNOWN_PATHS.filter((kp) => kp.widgets.includes(widgetType))
  const labelByPath: Record<string, string> = {}
  for (const kp of knownForWidget) {
    labelByPath[kp.path] = kp.label
    unitsByPath[kp.path] ??= kp.units
  }
  const knownPaths = knownForWidget.map((kp) => kp.path)
  const allPaths = [...knownPaths, ...paths.filter((p) => !(p in labelByPath))]

  const state = parseInstrumentConfig(stored)

  root.innerHTML = html`
    <h2>Configure ${widgetType}</h2>
    <form id="form">${raw(buildForm(widgetType, state))}</form>
    <p class="status" id="status"></p>
    <div class="actions">
      <button type="button" id="cancel">Cancel</button>
      <button type="button" id="save" class="primary">Save</button>
    </div>`

  // ── Path autocomplete ───────────────────────────────────────────────────────
  const pathInput = document.getElementById('path') as HTMLInputElement
  const suggList  = document.getElementById('path-suggestions') as HTMLUListElement

  const showSuggestions = (filter: string): void => {
    const f = filter.trim().toLowerCase()
    const hits = f === ''
      ? allPaths
      : allPaths.filter(
          (p) => p.toLowerCase().includes(f) ||
                 (labelByPath[p] ?? '').toLowerCase().includes(f)
        )
    if (hits.length === 0) { suggList.hidden = true; return }
    suggList.innerHTML = hits.slice(0, 60).map((p) => {
      const lbl = labelByPath[p]
      return lbl
        ? html`<li data-path="${p}"><span class="sugg-label">${lbl}</span><span class="sugg-path">${p}</span></li>`
        : html`<li data-path="${p}"><span class="sugg-path">${p}</span></li>`
    }).join('')
    suggList.hidden = false
  }

  // pointerdown.preventDefault() keeps focus on the input so blur doesn't fire
  // before the click handler selects the suggestion.  Works for both mouse
  // and touch in Chromium-based WebViews.
  suggList.addEventListener('pointerdown', (e) => e.preventDefault())
  suggList.addEventListener('click', (e) => {
    const li = (e.target as Element).closest<HTMLElement>('li[data-path]')
    if (!li) return
    pathInput.value = li.dataset['path'] ?? ''
    suggList.hidden = true
    pathInput.dispatchEvent(new Event('change'))
  })
  pathInput.addEventListener('focus',  () => showSuggestions(pathInput.value))
  pathInput.addEventListener('blur',   () => { suggList.hidden = true })
  pathInput.addEventListener('input',  () => showSuggestions(pathInput.value))

  // ── Conversion options ──────────────────────────────────────────────────────
  if (spec.fields.includes('convert')) {
    const refresh = (): void =>
      refreshConversionOptions(unitsByPath, state.path, state.convert)
    refresh()
    pathInput.addEventListener('change', refresh)
    pathInput.addEventListener('input', () => {
      if (unitsByPath[pathInput.value.trim()] !== undefined) refresh()
    })
  }

  const status = document.getElementById('status')
  document.getElementById('save')?.addEventListener('click', () => {
    void (async () => {
      try {
        await client.state.set(readForm(widgetType))
        if (status) status.textContent = 'Saved.'
        await client.call('ui.closePanel').catch(() => {})
      } catch (err: unknown) {
        if (status) {
          status.textContent = `Save failed: ${err instanceof Error ? err.message : String(err)}`
        }
      }
    })()
  })
  document.getElementById('cancel')?.addEventListener('click', () => {
    client.call('ui.closePanel').catch(() => {})
  })
}

main().catch((err: unknown) => {
  const root = document.getElementById('root')
  if (root) {
    root.textContent = `Host connection failed: ${err instanceof Error ? err.message : String(err)}`
  }
  console.error(err)
})
