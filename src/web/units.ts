// Unit-aware conversion selection and display resolution. Pure logic (no DOM,
// no bus) so it can be unit tested with node --test.
//
// Three sources decide how a value is shown, in descending authority:
//   1. A per-widget conversion the user explicitly picked in the config panel
//      (a CONVERSIONS key) — the ultimate authority, never overridden.
//   2. The server's per-path display preference (`meta.displayUnits`), part of
//      the Signal K Unit Preferences system: the user's chosen unit, a
//      conversion formula, and a symbol, published per path.
//   3. A fallback heuristic combining the path's SK base unit (`meta.units`)
//      with the host's coarse category preferences (`units.get`).
// The default per-widget setting is "use default" (USE_DEFAULT), which means
// "consult 2, then 3" — so an unconfigured widget follows the user's
// server-defined display preferences automatically.

/** Per-widget setting meaning "follow the server / host preference, not a
 *  hard-coded conversion". The default value of a widget's `convert` field. */
export const USE_DEFAULT = 'default'

export interface ConversionDef {
  label: string
  units: string
  fn: (v: number) => number
}

export interface DisplayUnits {
  formula?: string
  symbol?: string
  targetUnit?: string
}

export interface SkMeta {
  units?: string
  displayUnits?: DisplayUnits
}

export interface UnitPrefs {
  speed?: string
  temperature?: string
  depth?: string
  distance?: string
  length?: string
}

export interface DisplayResult {
  value: unknown
  symbol: string
}

export interface ResolveDisplayArgs {
  value: unknown
  convert?: string | undefined
  meta?: SkMeta | undefined
  prefs?: UnitPrefs | null | undefined
  path?: string | undefined
  fallback?: string
}

// Internal fallback — avoids indexed-access uncertainty when CONVERSIONS['none'] is needed.
const NONE_CONV: ConversionDef = { label: 'Raw value', units: '', fn: (v) => v }

/** Named conversions from SK SI base units to common display units. Each holds
 *  the display symbol (`units`) and the conversion function (`fn`). Used both
 *  as explicit per-widget overrides and as the fallback when the server
 *  publishes no `displayUnits` for a path. */
export const CONVERSIONS: Record<string, ConversionDef> = {
  none: NONE_CONV,
  'ms-kn': { label: 'm/s → knots', units: 'kn', fn: (v) => v * 1.943844 },
  'ms-kmh': { label: 'm/s → km/h', units: 'km/h', fn: (v) => v * 3.6 },
  'ms-mph': { label: 'm/s → mph', units: 'mph', fn: (v) => v * 2.236936 },
  'k-c': { label: 'K → °C', units: '°C', fn: (v) => v - 273.15 },
  'k-f': {
    label: 'K → °F',
    units: '°F',
    fn: (v) => (v - 273.15) * 1.8 + 32
  },
  'rad-deg': {
    label: 'rad → °',
    units: '°',
    fn: (v) => (v * 180) / Math.PI
  },
  'ratio-pct': { label: 'ratio → %', units: '%', fn: (v) => v * 100 },
  'm-ft': { label: 'm → ft', units: 'ft', fn: (v) => v * 3.28084 },
  'm-nm': { label: 'm → nm', units: 'nm', fn: (v) => v / 1852 },
  'm-km': { label: 'm → km', units: 'km', fn: (v) => v / 1000 },
  'pa-hpa': { label: 'Pa → hPa', units: 'hPa', fn: (v) => v / 100 },
  // Display-only formatters for the Display widget.
  // `fn` is an identity no-op; display.ts intercepts these keys before calling
  // convert() so this fn is never invoked in normal operation.
  'iso8601': { label: 'Time of day / date', units: '', fn: (v) => v },
  's-duration': { label: 'Duration', units: '', fn: (v) => v },
  'm-nm-auto': { label: 'Distance (auto: m or nm)', units: '', fn: (v) => v }
}

export function convert(value: unknown, conversionKey: string): unknown {
  const conv = CONVERSIONS[conversionKey] ?? NONE_CONV
  return typeof value === 'number' ? conv.fn(value) : value
}

export function conversionUnits(conversionKey: string): string {
  return (CONVERSIONS[conversionKey] ?? NONE_CONV).units
}

/** Conversion keys (see CONVERSIONS) valid per SK meta unit. */
export const VALID_BY_UNIT: Record<string, string[]> = {
  'm/s': ['none', 'ms-kn', 'ms-kmh', 'ms-mph'],
  K: ['none', 'k-c', 'k-f'],
  rad: ['none', 'rad-deg'],
  ratio: ['none', 'ratio-pct'],
  m: ['none', 'm-ft', 'm-nm', 'm-km', 'm-nm-auto'],
  Pa: ['none', 'pa-hpa'],
  s: ['none', 's-duration'],
  // Signal K publishes timestamp meta.units as one of these strings.
  'RFC 2822': ['iso8601'],
  'ISO 8601': ['iso8601']
}

/**
 * Conversion keys to offer for a path. Unknown/missing meta units offer
 * everything (the user knows best when the server provides no metadata).
 */
export function validConversions(units: string | undefined, allKeys: string[]): string[] {
  if (units === undefined) return allKeys
  return VALID_BY_UNIT[units] ?? allKeys
}

/**
 * The fallback conversion for a path when the server publishes no
 * `displayUnits`, combining its SK meta units with the host's preferred
 * display units (may be null when the host lacks the `units` capability).
 *
 * Metre-unit paths are ambiguous (depth vs. trip distance vs. lengths), so
 * the path name picks which preference applies.
 */
export function defaultConversion(
  units: string | undefined,
  path: string | undefined,
  prefs: UnitPrefs | null | undefined
): string {
  switch (units) {
    case 'm/s': {
      const speed = prefs?.speed
      if (speed === 'km/h') return 'ms-kmh'
      if (speed === 'mph') return 'ms-mph'
      if (speed === 'm/s') return 'none'
      return 'ms-kn'
    }
    case 'K':
      return prefs?.temperature === 'F' ? 'k-f' : 'k-c'
    case 'rad':
      return 'rad-deg'
    case 'ratio':
      return 'ratio-pct'
    case 'Pa':
      return 'pa-hpa'
    case 'm': {
      const p = path ?? ''
      if (/depth/i.test(p)) {
        return prefs?.depth === 'foot' ? 'm-ft' : 'none'
      }
      if (/(distance|log|range)/i.test(p)) {
        return prefs?.distance === 'naut-mile' ? 'm-nm' : 'm-km'
      }
      return prefs?.length === 'foot' ? 'm-ft' : 'none'
    }
    case 'RFC 2822':
    case 'ISO 8601':
      return 'iso8601'
    case 's':
      return 's-duration'
    default:
      return 'none'
  }
}

// ─── Formula evaluation ──────────────────────────────────────────────────────
//
// Signal K servers publish a `meta.displayUnits.formula` string per path when
// the user has configured unit preferences.  Example response for SOG with the
// "Nautical" preset:
//
//   { "units": "m/s", "displayUnits": { "targetUnit": "kn",
//     "formula": "value * 1.94384", "symbol": "kn" } }
//
// The formulas are Math.js expressions, but in practice every SK conversion is
// linear: f(value) = a·value + b.  Examples:
//   "value * 1.94384"              m/s  → kn
//   "(value - 273.15) * 1.8 + 32" K    → °F
//   "value / 1852"                 m    → nm
//
// Library alternatives assessed (as of 2025-07):
//
//   mathjs          — the spec-correct choice (SK explicitly says "Math.js
//                     expressions"), actively maintained, full-featured.
//                     REJECTED: ~500 KB bundle, completely unacceptable for
//                     widget iframes.  Would be the right pick if formulas
//                     ever become non-linear or use math functions (sin, log…).
//
//   expr-eval       — lightweight (~15 KB), safe parser, good API.
//                     REJECTED: last published 2019, effectively abandoned;
//                     no native TypeScript source (only a hand-written .d.ts).
//
//   math-expression-  — has native TypeScript, small, token-based postfix
//   evaluator           evaluation.
//                     REJECTED: niche project with low activity; unclear
//                     long-term maintenance.
//
//   expressionparser — tiny, zero dependencies, published April 2025.
//                     REJECTED: more complexity than the problem warrants for
//                     our strictly linear subset.
//
// Hand-rolled evalArith wins here: the grammar is tiny and well-defined, and
// enforcing linearity as an explicit invariant adds safety no library gives us.
//
// Strategy:
//  1. Whitelist — after substituting 'value', only digit/operator chars allowed.
//  2. evalArith — a ~40-line recursive descent parser for pure arithmetic.
//  3. Probe at x=0 and x=1 to extract the linear coefficients a and b.
//  4. Spot-check at x=7 to confirm the formula is actually linear.
//  5. Cache the resulting closure (value: number) => a*value + b.

type FormulaFn = (value: number) => number
const formulaCache = new Map<string, FormulaFn | null>()

/**
 * Evaluate a pure arithmetic expression string (no variable names, no calls).
 * Grammar: expr = term (('+' | '-') term)*
 *          term = atom (('*' | '/') atom)*
 *          atom = '(' expr ')' | '-' atom | number
 * Returns NaN on any parse error so callers never need a try/catch.
 */
function evalArith(expr: string): number {
  let pos = 0
  const ws = (): void => { while (expr[pos] === ' ') pos++ }
  const at = (): string => expr[pos] ?? ''

  // Addition and subtraction — lowest precedence.
  function parseExpr(): number {
    let v = parseTerm(); ws()
    while (at() === '+' || at() === '-') {
      const op = expr[pos++]!; ws()
      v = op === '+' ? v + parseTerm() : v - parseTerm(); ws()
    }
    return v
  }

  // Multiplication and division — higher precedence than +/-.
  function parseTerm(): number {
    let v = parseAtom(); ws()
    while (at() === '*' || at() === '/') {
      const op = expr[pos++]!; ws()
      v = op === '*' ? v * parseAtom() : v / parseAtom(); ws()
    }
    return v
  }

  // Parenthesised sub-expression, unary minus, or numeric literal
  // (integers, decimals, and scientific notation such as 1.8e3).
  function parseAtom(): number {
    ws()
    if (at() === '(') { pos++; const v = parseExpr(); ws(); if (at() === ')') pos++; return v }
    if (at() === '-') { pos++; return -parseAtom() }
    const start = pos
    while (/[\d.]/.test(at())) pos++
    if ((at() === 'e' || at() === 'E') && pos > start) {
      pos++; if (at() === '+' || at() === '-') pos++
      while (/\d/.test(at())) pos++
    }
    if (pos === start) return NaN   // nothing was consumed → syntax error
    return parseFloat(expr.slice(start, pos))
  }

  ws()
  const result = parseExpr()
  ws()
  // If pos didn't reach the end, there were unconsumed characters → error.
  return pos === expr.length ? result : NaN
}

/**
 * Compile a Signal K display formula into a cached linear closure.
 *
 * Because all SK formulas are linear (a·value + b) we can extract the
 * coefficients algebraically using two evaluations:
 *   b     = formula(0)          ← the intercept
 *   a + b = formula(1)          ← slope + intercept
 *   a     = formula(1) - formula(0)
 *
 * A spot-check at x=7 guards against any non-linear formula that somehow
 * slips through — if it's not linear, we refuse to cache and return null.
 *
 * Returns null for anything that fails the safety whitelist, doesn't parse,
 * or turns out not to be linear.
 */
function compileFormula(formula: string): FormulaFn | null {
  if (formulaCache.has(formula)) return formulaCache.get(formula) ?? null

  // Safety whitelist: after substituting 'value' with a number, the remaining
  // string must consist solely of digits, decimal points, arithmetic operators,
  // parentheses, and scientific-notation markers (e/E).  Any letter that isn't
  // part of 'value' (e.g. a function name like "sin") rejects the formula.
  const safe = formula.replace(/\bvalue\b/g, '(0)')
  if (!/^[0-9\s.+\-*/()eE]+$/.test(safe)) {
    formulaCache.set(formula, null)
    return null
  }

  // Substitute helper: replace 'value' and evaluate the resulting expression.
  const sub = (x: number): number =>
    evalArith(formula.replace(/\bvalue\b/g, `(${x})`))

  // Extract linear coefficients.
  const b   = sub(0)
  const apb = sub(1)
  if (!isFinite(b) || !isFinite(apb)) { formulaCache.set(formula, null); return null }
  const a = apb - b

  // Linearity check: a·7 + b must equal formula(7) within floating-point noise.
  if (Math.abs(sub(7) - (7 * a + b)) > 1e-9) { formulaCache.set(formula, null); return null }

  const fn: FormulaFn = (value: number) => a * value + b
  formulaCache.set(formula, fn)
  return fn
}

/** Apply a server `displayUnits.formula` to a value. Returns the value
 *  unchanged if it is not a finite number or the formula cannot be evaluated. */
export function applyFormula(value: unknown, formula: string): unknown {
  if (typeof value !== 'number' || !isFinite(value)) return value
  const fn = compileFormula(formula)
  if (!fn) return value
  const out = fn(value)
  return isFinite(out) ? out : value
}

/**
 * Resolve how to display a value for a widget, honouring the authority order
 * described at the top of this file. Returns `{ value, symbol }`.
 */
export function resolveDisplay({
  value,
  convert: key,
  meta,
  prefs,
  path,
  fallback = 'none'
}: ResolveDisplayArgs): DisplayResult {
  // 1. Explicit per-widget conversion — the ultimate authority.
  if (key && key !== USE_DEFAULT) {
    const conv = CONVERSIONS[key]
    if (conv) return { value: convert(value, key), symbol: conv.units }
  }

  // 2. Server per-path display preference.
  const du = meta?.displayUnits
  if (du && (du.formula || du.symbol || du.targetUnit)) {
    return {
      value: du.formula ? applyFormula(value, du.formula) : value,
      symbol: du.symbol ?? du.targetUnit ?? ''
    }
  }

  // 3. Fallback: SK base unit + host category preference.
  let fk = defaultConversion(meta?.units, path, prefs)
  if (fk === 'none' && CONVERSIONS[fallback]) fk = fallback
  return { value: convert(value, fk), symbol: (CONVERSIONS[fk] ?? NONE_CONV).units }
}

// ─── Time formatters ─────────────────────────────────────────────────────────
//
// Used exclusively by the Display widget (display.ts) for the 'iso8601' and
// 's-duration' conversion keys.  Pure functions with no DOM or bus dependency,
// kept here so they can be unit-tested alongside the rest of units.ts.

/** Pad a non-negative integer to at least two digits. */
const p2 = (n: number) => n.toString().padStart(2, '0')

/**
 * Format a duration (seconds, possibly negative) as a compact string.
 *
 *  |s| <  1 h  →  MM:SS.S    (one decimal second)
 *  |s| < 24 h  →  HH:MM:SS
 *  |s| < 10 d  →  Nd HH:MM   (N = 1–9)
 *  |s| ≥ 10 d  →  Nd HHh
 *
 * Negative values get a leading '−' (e.g. countdown that has elapsed).
 */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return '--'
  const neg = seconds < 0
  const s = Math.abs(seconds)
  const prefix = neg ? '-' : ''

  if (s < 3600) {
    const m = Math.floor(s / 60)
    // Floor to one decimal place to prevent the boundary "60.0" from floating-
    // point representation of values like 3599.99.
    const sec = Math.floor((s % 60) * 10) / 10
    return `${prefix}${p2(m)}:${sec.toFixed(1).padStart(4, '0')}`
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    return `${prefix}${p2(h)}:${p2(m)}:${p2(sec)}`
  }
  if (s < 864000) {
    const n = Math.floor(s / 86400)
    const rem = s % 86400
    const h = Math.floor(rem / 3600)
    const m = Math.floor((rem % 3600) / 60)
    return `${prefix}${n}d ${p2(h)}:${p2(m)}`
  }
  const n = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return `${prefix}${n}d ${h}h`
}

/**
 * Format an ISO 8601 timestamp string as a compact local-time display.
 *
 *  |Δ| <  1 d  →  HH:MM:SS              (browser local time zone)
 *  future, cal-day 1  →  HH:MM +1d
 *  future, cal-day 2–7  →  W HH:MM       (short weekday, e.g. "Thu 14:30")
 *  future, cal-day > 7  →  localised date (e.g. "Jul 28" or "Jul 28, 2027")
 *  past, |Δ| < 10 d  →  HH:MM-Nd
 *  past, |Δ| ≥ 10 d  →  localised date
 *
 * Unparseable input is returned verbatim.
 */
export function formatTimestamp(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  if (!isFinite(d.getTime())) return iso

  const delta = d.getTime() - now        // positive = future
  const absDays = Math.abs(delta) / 86400000

  const hh = p2(d.getHours())
  const mm = p2(d.getMinutes())
  const ss = p2(d.getSeconds())

  if (absDays < 1) {
    return `${hh}:${mm}:${ss}`
  }

  if (delta > 0) {
    // Calendar-day distance in the browser's local time zone.
    const nowDay = new Date(now); nowDay.setHours(0, 0, 0, 0)
    const evtDay = new Date(d.getTime()); evtDay.setHours(0, 0, 0, 0)
    const calDays = Math.round((evtDay.getTime() - nowDay.getTime()) / 86400000)

    if (calDays === 1) return `${hh}:${mm} +1d`
    if (calDays <= 7) {
      const wd = d.toLocaleDateString(undefined, { weekday: 'short' })
      return `${wd} ${hh}:${mm}`
    }
    // > 7 calendar days: date only.
    const nowDate = new Date(now)
    const opts: Intl.DateTimeFormatOptions =
      d.getFullYear() === nowDate.getFullYear()
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' }
    return d.toLocaleDateString(undefined, opts)
  }

  // Past (delta ≤ 0, absDays ≥ 1): legacy −Nd / date format.
  if (absDays < 10) {
    const n = Math.floor(absDays)
    return `${hh}:${mm}-${n}d`
  }
  const nowDate = new Date(now)
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === nowDate.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
  return d.toLocaleDateString(undefined, opts)
}

const NM_IN_M = 1852

/**
 * Format a distance (metres) adaptively for nautical display.
 *
 *  ≥ 0.5 nm  →  "2.3 nm"   (one decimal place)
 *  < 0.5 nm  →  "452 m"    (whole metres)
 */
export function formatDistance(metres: number): string {
  if (!isFinite(metres)) return '--'
  const nm = metres / NM_IN_M
  return nm >= 0.5 ? `${nm.toFixed(1)} nm` : `${Math.round(metres)} m`
}
