// `html` tagged template / `raw()` tests (src/web/common.ts). `html` is the
// only XSS defense between Signal K data (paths, labels, units, values) and
// every widget's innerHTML, so its escaping contract is pinned here.

import { test } from 'node:test'
import assert from 'node:assert'
import { html, raw } from '../src/web/common.ts'

test('escapes & < > " in interpolated values', () => {
  assert.strictEqual(html`${'&'}|${'<'}|${'>'}|${'"'}`, '&amp;|&lt;|&gt;|&quot;')
  assert.strictEqual(
    html`<text>${'<script>alert("x")</script>'}</text>`,
    '<text>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</text>'
  )
})

test('escapes & exactly once, so existing entities are not decoded', () => {
  assert.strictEqual(html`${'&lt;b&gt;'}`, '&amp;lt;b&amp;gt;')
})

test('interpolated value cannot break out of a double-quoted attribute', () => {
  const out = html`<input value="${'" onfocus="alert(1)" x="'}">`
  assert.strictEqual(out, '<input value="&quot; onfocus=&quot;alert(1)&quot; x=&quot;">')
})

test('template literal text itself is not escaped', () => {
  assert.strictEqual(html`<b class="a">&nbsp;</b>`, '<b class="a">&nbsp;</b>')
  assert.strictEqual(html``, '')
})

test('raw() values bypass escaping, others in the same template do not', () => {
  const path = 'M 0 0 L 10 10'
  assert.strictEqual(html`<path d="${raw(path)}"/>`, '<path d="M 0 0 L 10 10"/>')
  assert.strictEqual(
    html`${raw('<option>a</option>')}${'<option>b</option>'}`,
    '<option>a</option>&lt;option&gt;b&lt;/option&gt;'
  )
})

test('only raw() wrappers bypass escaping, not look-alike objects', () => {
  const fake = { value: '<img src=x onerror=alert(1)>' }
  assert.strictEqual(html`${fake}`, '[object Object]')
  const tricky = { toString: () => '<b>' }
  assert.strictEqual(html`${tricky}`, '&lt;b&gt;')
})

test('non-string values are coerced with String()', () => {
  assert.strictEqual(html`${0}|${-1.5}|${NaN}`, '0|-1.5|NaN')
  assert.strictEqual(html`${null}|${undefined}|${false}`, 'null|undefined|false')
  assert.strictEqual(html`${[1, '<', 2]}`, '1,&lt;,2')
})

test('values at the start, end, and adjacent positions keep literal order', () => {
  assert.strictEqual(html`${'a'}-${'b'}${'c'}-${'d'}`, 'a-bc-d')
})
