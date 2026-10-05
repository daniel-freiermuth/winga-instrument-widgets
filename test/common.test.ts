// Per-instance config parsing tests (parseInstrumentConfig in src/web/common.ts).

import { test } from 'node:test'
import assert from 'node:assert'
import { parseInstrumentConfig } from '../src/web/common.ts'

const GAUGE_DEFAULTS = { min: 0, max: 10, decimals: 1, label: 'Speed' }

test('mistyped stored fields fall back to the widget defaults', () => {
  const config = { ...GAUGE_DEFAULTS, ...parseInstrumentConfig({ max: '10', decimals: null, label: 5 }) }
  assert.deepStrictEqual(config, GAUGE_DEFAULTS)
})

test('non-finite numbers are rejected so the default applies', () => {
  const config = { ...GAUGE_DEFAULTS, ...parseInstrumentConfig({ min: NaN, max: Infinity }) }
  assert.strictEqual(config.min, 0)
  assert.strictEqual(config.max, 10)
})

test('well-typed stored fields override defaults; unknown keys are dropped', () => {
  const stored = {
    path: 'navigation.speedOverGround',
    convert: 'ms-kn',
    label: '',
    topLabel: 'SOG',
    bottomLabel: 'kn',
    units: 'kt',
    min: -5,
    max: 0,
    decimals: 0,
    extra: 'ignored'
  }
  assert.deepStrictEqual(parseInstrumentConfig(stored), {
    path: 'navigation.speedOverGround',
    convert: 'ms-kn',
    label: '',
    topLabel: 'SOG',
    bottomLabel: 'kn',
    units: 'kt',
    min: -5,
    max: 0,
    decimals: 0
  })
})
