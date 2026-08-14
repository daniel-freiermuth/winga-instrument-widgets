// Plugin contract tests: provider registration shape and manifest validity.

import { test } from 'node:test'
import assert from 'node:assert'
import pluginFactory from '../plugin/index.ts'
import type { SkApp, Plugin } from '../plugin/index.ts'

interface ProviderCall {
  type: string
  methods: {
    listResources: (q: unknown) => Promise<Record<string, unknown>>
    getResource: (id: string, q?: unknown) => Promise<unknown>
    setResource: (id: string, v: unknown) => Promise<void>
    deleteResource: (id: string) => Promise<void>
  }
}

interface PutHandlerCall {
  ctx: string
  path: string
  handler: (ctx: string, path: string, value: unknown) => { state: string; statusCode: number }
}

interface MessageCall {
  id: string
  delta: unknown
}

interface FakeAppCalls {
  providers: ProviderCall[]
  putHandlers: PutHandlerCall[]
  messages: MessageCall[]
}

function fakeApp(): SkApp & { calls: FakeAppCalls } {
  const calls: FakeAppCalls = { providers: [], putHandlers: [], messages: [] }
  return {
    calls,
    debug: (): void => {},
    error: (): void => {},
    registerResourceProvider: (p): void => {
      calls.providers.push(p)
    },
    registerPutHandler: (ctx, path, handler): void => {
      calls.putHandlers.push({ ctx, path, handler })
    },
    handleMessage: (id, delta): void => {
      calls.messages.push({ id, delta })
    }
  }
}

function getManifestField(manifest: unknown, field: string): unknown {
  if (typeof manifest === 'object' && manifest !== null && field in manifest) {
    return (manifest as Record<string, unknown>)[field]
  }
  return undefined
}

test('registers a read-only plotterExtensions provider with a valid manifest', async () => {
  const app = fakeApp()
  const p: Plugin = pluginFactory(app)
  p.start({})

  assert.strictEqual(app.calls.providers.length, 1)
  const provider = app.calls.providers[0]!
  assert.strictEqual(provider.type, 'plotterExtensions')

  const list = await provider.methods.listResources({})
  const ids = Object.keys(list)
  assert.deepStrictEqual(ids, ['winga-instrument-widgets'])

  const manifest = list['winga-instrument-widgets']
  assert.strictEqual(getManifestField(manifest, 'apiVersion'), '1')

  const requires = getManifestField(manifest, 'requires')
  assert.ok(Array.isArray(requires) && requires.includes('widgets'))
  assert.ok(Array.isArray(requires) && requires.includes('signalk.stream'))

  const widgets = getManifestField(manifest, 'widgets')
  assert.ok(Array.isArray(widgets))
  assert.strictEqual(widgets.length, 6)
  assert.deepStrictEqual(
    widgets.map((w: unknown) => getManifestField(w, 'id')),
    ['gauge', 'meter', 'switch', 'display', 'distance', 'time']
  )
  // Widgets that name a config panel must reference the one this manifest ships;
  // the zero-config cyclic widgets (distance, time) name none.
  const CONFIGURABLE = new Set(['gauge', 'meter', 'switch', 'display'])
  for (const widget of widgets) {
    const size = getManifestField(widget, 'size')
    assert.ok(typeof size === 'string' && /^[12]x[12]$/.test(size))
    assert.strictEqual(getManifestField(widget, 'type'), 'iframe')
    const url = getManifestField(widget, 'url')
    assert.ok(typeof url === 'string' && url.startsWith('/plotterext/winga-instrument-widgets/'))
    const configPanel = getManifestField(widget, 'configPanel')
    if (CONFIGURABLE.has(getManifestField(widget, 'id') as string)) {
      assert.strictEqual(configPanel, 'instrument-config')
    } else {
      assert.strictEqual(configPanel, undefined)
    }
  }

  const panels = getManifestField(manifest, 'panels')
  assert.ok(Array.isArray(panels))
  assert.strictEqual(getManifestField(panels[0], 'id'), 'instrument-config')

  const single = await provider.methods.getResource('winga-instrument-widgets')
  assert.strictEqual(getManifestField(single, 'name'), getManifestField(manifest, 'name'))
  await assert.rejects(() => provider.methods.getResource('nope'))
  await assert.rejects(() => provider.methods.setResource('x', {}))
  await assert.rejects(() => provider.methods.deleteResource('x'))
})

test('demo switch PUT handler toggles and emits deltas', () => {
  const app = fakeApp()
  const p: Plugin = pluginFactory(app)
  p.start({ enableDemoSwitch: true })

  assert.strictEqual(app.calls.putHandlers.length, 1)
  const call = app.calls.putHandlers[0]!
  assert.strictEqual(call.path, 'electrical.switches.demo.state')
  // Initial emit
  assert.strictEqual(app.calls.messages.length, 1)

  const result = call.handler('vessels.self', call.path, 1)
  assert.strictEqual(result.state, 'COMPLETED')
  const last = app.calls.messages.at(-1)
  if (
    last !== undefined &&
    typeof last.delta === 'object' &&
    last.delta !== null &&
    'updates' in last.delta
  ) {
    const updates = (last.delta as { updates: unknown[] }).updates
    const firstUpdate = updates[0]
    if (
      typeof firstUpdate === 'object' &&
      firstUpdate !== null &&
      'values' in firstUpdate
    ) {
      const values = (firstUpdate as { values: unknown[] }).values
      assert.deepStrictEqual(values[0], { path: call.path, value: 1 })
    }
  }
})

test('demo switch can be disabled', () => {
  const app = fakeApp()
  const p: Plugin = pluginFactory(app)
  p.start({ enableDemoSwitch: false })
  assert.strictEqual(app.calls.putHandlers.length, 0)
})

test('provider returns empty list when plugin is stopped', async () => {
  const app = fakeApp()
  const p: Plugin = pluginFactory(app)
  p.start({})
  p.stop()
  const provider = app.calls.providers[0]!
  assert.deepStrictEqual(await provider.methods.listResources({}), {})
})

test('assets are mounted synchronously during start()', () => {
  const useCalls: { path: string }[] = []
  const app: SkApp & { calls: FakeAppCalls } = {
    ...fakeApp(),
    use: (path: string, _handler: unknown): void => {
      useCalls.push({ path })
    }
  }
  const p: Plugin = pluginFactory(app)
  p.start({})
  assert.strictEqual(useCalls.length, 1, 'app.use must be called before start() returns')
  assert.match(useCalls[0]!.path, /^\/plotterext\//)
  p.stop()
})

test('start with null options enables demo switch by default', () => {
  const app = fakeApp()
  const p: Plugin = pluginFactory(app)
  assert.doesNotThrow(() => { p.start(null) })
  assert.strictEqual(app.calls.putHandlers.length, 1, 'PUT handler registered')
  assert.strictEqual(app.calls.messages.length, 1, 'initial delta emitted')
  p.stop()
})
