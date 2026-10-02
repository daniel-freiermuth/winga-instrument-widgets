// startInstrument tests (src/web/common.ts): config loading, Signal K
// subscription lifecycle, and the configGen guards that keep overlapping
// applyConfig runs (rapid state.changed events) from writing stale config,
// meta or values, or leaking Signal K subscriptions.
//
// The widget runs the real bus client against a fake host: a BusEndpoint
// wired to globalThis.parent / globalThis 'message' events, the same window
// transport connectExtension() uses inside an iframe. Host methods and fetch
// are replaceable per test so each await in applyConfig can be held open.

import { test, afterEach } from 'node:test'
import assert from 'node:assert'
import { BusEndpoint, EVENT_HANDSHAKE, EVENT_READY } from 'signalk-plotterext-bus'
import type { BusPort, Handshake } from 'signalk-plotterext-bus'
import { startInstrument } from '../src/web/common.ts'
import type { InstrumentHandle, UpdateArgs } from '../src/web/common.ts'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

type MessageListener = (ev: { source: unknown; data: unknown }) => void
type Handler = (params: unknown) => unknown

interface FakeHost {
  endpoint: BusEndpoint
  /** Values returned by the default state.get handler. */
  state: Record<string, unknown>
  /** Replaceable host method handlers, looked up on every call. */
  handlers: Record<string, Handler>
  /** Active host-side Signal K subscriptions: subscriptionId → paths. */
  skSubs: Map<number, string[]>
  /** Every signalk.subscribe / signalk.unsubscribe call, in order. */
  skLog: string[]
  stateChanged: () => void
  skValue: (path: string, value: unknown) => void
}

const ORIGINAL_FETCH = globalThis.fetch
let fetchHandler: (url: string) => Promise<Response> = () =>
  Promise.resolve(new Response('', { status: 404 }))
let openClient: InstrumentHandle | null = null

function installHost(capabilities: string[] = []): FakeHost {
  const toClient: MessageListener[] = []
  const toHost: ((data: unknown) => void)[] = []
  const hostWindow = {
    postMessage(data: unknown): void {
      const copy = structuredClone(data)
      setImmediate(() => { for (const h of toHost) h(copy) })
    }
  }
  Object.assign(globalThis, {
    parent: hostWindow,
    addEventListener: (_type: string, fn: MessageListener): void => { toClient.push(fn) },
    removeEventListener: (_type: string, fn: MessageListener): void => {
      const i = toClient.indexOf(fn)
      if (i >= 0) toClient.splice(i, 1)
    }
  })
  const port: BusPort = {
    post(data) {
      const copy = structuredClone(data)
      setImmediate(() => { for (const fn of [...toClient]) fn({ source: hostWindow, data: copy }) })
    },
    listen(handler) {
      toHost.push(handler)
      return () => { toHost.splice(toHost.indexOf(handler), 1) }
    }
  }
  const endpoint = new BusEndpoint({ port })
  let nextId = 1
  const host: FakeHost = {
    endpoint,
    state: {},
    skSubs: new Map(),
    skLog: [],
    handlers: {
      'events.subscribe': () => ({ subscriptionId: nextId++ }),
      'events.unsubscribe': () => null,
      'state.get': () => ({ values: { ...host.state } }),
      'signalk.subscribe': (params) => {
        const { paths } = params as { paths: string[] }
        const id = nextId++
        host.skSubs.set(id, paths)
        host.skLog.push(`sub ${paths.join(',')}`)
        return { subscriptionId: id }
      },
      'signalk.unsubscribe': (params) => {
        const { subscriptionId } = params as { subscriptionId: number }
        host.skLog.push(`unsub ${host.skSubs.get(subscriptionId)?.join(',') ?? '?'}`)
        host.skSubs.delete(subscriptionId)
        return null
      },
      'units.get': () => ({ units: { speed: 'kn' } })
    },
    stateChanged: () => { endpoint.notify('state.changed', {}) },
    skValue: (path, value) => { endpoint.notify(`sk.${path}`, { path, value }) }
  }
  for (const name of Object.keys(host.handlers)) {
    endpoint.registerMethod(name, (params) => host.handlers[name]!(params))
  }
  const handshake: Handshake = {
    host: 'fake',
    hostVersion: '0',
    apiVersion: '1',
    capabilities,
    context: { kind: 'widget', id: 'gauge', instanceId: 'w1' }
  }
  endpoint.onEvent([EVENT_READY], () => { endpoint.notify(EVENT_HANDSHAKE, handshake) })
  return host
}

/** Start the widget runtime without waiting for the initial applyConfig. */
function launch(
  defaults: Record<string, unknown> = {}
): { updates: UpdateArgs[]; ready: Promise<void> } {
  const updates: UpdateArgs[] = []
  const ready = startInstrument({ defaults, onUpdate: (u) => { updates.push({ ...u }) } })
    .then((h) => { openClient = h })
  return { updates, ready }
}

async function start(
  defaults: Record<string, unknown> = {}
): Promise<{ updates: UpdateArgs[] }> {
  const { updates, ready } = launch(defaults)
  await ready
  return { updates }
}

/** Let bus round-trips (setImmediate hops) and promise chains settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r))
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return
    await new Promise((r) => setImmediate(r))
  }
  assert.fail(`timed out waiting for ${what}`)
}

const metaResponse = (meta: unknown): Response =>
  new Response(JSON.stringify(meta), { status: 200 })

globalThis.fetch = (input) =>
  fetchHandler(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

afterEach(async () => {
  // Let in-flight bus replies land before closing so no reload is cut off.
  await settle()
  openClient?.client.close()
  openClient = null
  fetchHandler = () => Promise.resolve(new Response('', { status: 404 }))
  for (const k of ['parent', 'addEventListener', 'removeEventListener']) {
    Reflect.deleteProperty(globalThis, k)
  }
})

process.on('exit', () => { globalThis.fetch = ORIGINAL_FETCH })

test('config without a path emits once and subscribes to nothing', async () => {
  const host = installHost()
  host.state = { label: 'Stored' }
  const { updates } = await start({ label: 'Default', decimals: 2 })
  await settle()
  assert.strictEqual(updates.length, 1)
  assert.deepStrictEqual(updates[0]!.config, { label: 'Stored', decimals: 2 })
  assert.strictEqual(updates[0]!.value, undefined)
  assert.strictEqual(updates[0]!.meta, undefined)
  assert.deepStrictEqual(host.skLog, [])
})

test('path config emits reset, then fetched meta, then live values', async () => {
  const host = installHost()
  host.state = { path: 'navigation.speedOverGround' }
  const urls: string[] = []
  fetchHandler = (url) => {
    urls.push(url)
    return Promise.resolve(metaResponse({ units: 'm/s' }))
  }
  const { updates } = await start()
  await waitFor(() => host.skSubs.size === 1, 'SK subscription')
  assert.deepStrictEqual(urls, ['/signalk/v1/api/vessels/self/navigation/speedOverGround/meta'])
  assert.deepStrictEqual(updates.map((u) => [u.value, u.meta]), [
    [undefined, undefined],
    [undefined, { units: 'm/s' }]
  ])
  host.skValue('navigation.speedOverGround', 3.2)
  await waitFor(() => updates.length === 3, 'value update')
  assert.strictEqual(updates[2]!.value, 3.2)
  assert.deepStrictEqual(updates[2]!.meta, { units: 'm/s' })
})

test('meta is undefined when the meta fetch is non-ok or throws', async () => {
  for (const failing of [
    () => Promise.resolve(new Response('', { status: 404 })),
    () => Promise.reject(new TypeError('network down'))
  ]) {
    const host = installHost()
    host.state = { path: 'a.b' }
    fetchHandler = failing
    const { updates } = await start()
    await waitFor(() => host.skSubs.size === 1, 'SK subscription')
    assert.strictEqual(updates.length, 2)
    assert.ok(updates.every((u) => u.meta === undefined))
    openClient?.client.close()
  }
})

test('prefs come from units.get only when the host has the units capability', async () => {
  installHost(['units'])
  const withCap = await start()
  assert.deepStrictEqual(withCap.updates[0]!.prefs, { speed: 'kn' })
  openClient?.client.close()

  let host = installHost([])
  let unitsCalled = false
  host.handlers['units.get'] = () => { unitsCalled = true; return { units: { speed: 'kn' } } }
  const noCap = await start()
  assert.strictEqual(noCap.updates[0]!.prefs, null)
  assert.strictEqual(unitsCalled, false)
  openClient?.client.close()

  host = installHost(['units'])
  host.handlers['units.get'] = () => { throw new Error('boom') }
  const rejected = await start()
  assert.strictEqual(rejected.updates[0]!.prefs, null)
})

test('path change unsubscribes the old SK path before subscribing the new one and resets value/meta', async () => {
  const host = installHost()
  host.state = { path: 'a.one' }
  fetchHandler = (url) => Promise.resolve(metaResponse({ units: url.includes('one') ? 'K' : 'm' }))
  const { updates } = await start()
  await waitFor(() => host.skSubs.size === 1, 'first subscription')
  host.skValue('a.one', 280)
  await waitFor(() => updates.at(-1)?.value === 280, 'first value')

  const before = updates.length
  host.state = { path: 'a.two' }
  host.stateChanged()
  await waitFor(() => host.skLog.length === 3, 'resubscribe')
  assert.deepStrictEqual(host.skLog, ['sub a.one', 'unsub a.one', 'sub a.two'])
  assert.deepStrictEqual([...host.skSubs.values()], [['a.two']])

  const reset = updates[before]!
  assert.strictEqual(reset.config.path, 'a.two')
  assert.strictEqual(reset.value, undefined)
  assert.strictEqual(reset.meta, undefined)
  assert.deepStrictEqual(updates[before + 1]!.meta, { units: 'm' })
})

test('two rapid state.changed events: only the latest config is applied, one SK subscription survives', async () => {
  const host = installHost()
  const { updates } = await start()
  assert.strictEqual(updates.length, 1)

  const gets: Deferred<unknown>[] = []
  host.handlers['state.get'] = () => {
    const d = deferred<unknown>()
    gets.push(d)
    return d.promise
  }
  host.stateChanged()
  host.stateChanged()
  await waitFor(() => gets.length === 2, 'both state.get calls')
  // Newer reload resolves first; the older (stale) one lands afterwards.
  gets[1]!.resolve({ values: { path: 'new.path' } })
  await waitFor(() => host.skSubs.size === 1, 'new subscription')
  gets[0]!.resolve({ values: { path: 'old.path' } })
  await settle()

  assert.ok(updates.slice(1).every((u) => u.config.path === 'new.path'),
    `stale config emitted: ${JSON.stringify(updates.map((u) => u.config))}`)
  assert.deepStrictEqual(host.skLog, ['sub new.path'])
  assert.deepStrictEqual([...host.skSubs.values()], [['new.path']])
})

test('stale meta from an older reload is not written once a newer reload started', async () => {
  const host = installHost()
  host.state = { path: 'slow.path' }
  const metas: Record<string, Deferred<Response>> = {}
  fetchHandler = (url) => {
    const d = deferred<Response>()
    metas[url] = d
    return d.promise
  }
  const slowUrl = '/signalk/v1/api/vessels/self/slow/path/meta'
  const fastUrl = '/signalk/v1/api/vessels/self/fast/path/meta'
  const { updates, ready } = launch()
  await waitFor(() => slowUrl in metas, 'slow meta fetch')

  host.state = { path: 'fast.path' }
  host.stateChanged()
  await waitFor(() => fastUrl in metas, 'fast meta fetch')
  metas[fastUrl]!.resolve(metaResponse({ units: 'fast' }))
  await waitFor(() => host.skSubs.size === 1, 'fast subscription')
  metas[slowUrl]!.resolve(metaResponse({ units: 'slow' }))
  await ready
  await settle()
  // A later emit (live value) must still carry the newer reload's meta.
  host.skValue('fast.path', 1)
  await waitFor(() => updates.at(-1)?.value === 1, 'live value')

  assert.ok(updates.every((u) => u.meta?.units !== 'slow'),
    `stale meta emitted: ${JSON.stringify(updates.map((u) => u.meta))}`)
  assert.deepStrictEqual(updates.at(-1)!.meta, { units: 'fast' })
  assert.deepStrictEqual(host.skLog, ['sub fast.path'])
})

test('a SK subscription that completes after a newer reload started is unsubscribed', async () => {
  const host = installHost()
  host.state = { path: 'old.path' }
  const subscribe = host.handlers['signalk.subscribe']!
  const heldOld = deferred<undefined>()
  host.handlers['signalk.subscribe'] = async (params) => {
    if ((params as { paths: string[] }).paths[0] === 'old.path') await heldOld.promise
    return subscribe(params)
  }
  let oldRequested = false
  fetchHandler = (url) => {
    if (url.includes('old')) oldRequested = true
    return Promise.resolve(new Response('', { status: 404 }))
  }
  const { ready } = launch()
  await waitFor(() => oldRequested, 'old meta fetch')
  await settle()

  host.state = { path: 'new.path' }
  host.stateChanged()
  await waitFor(() => host.skLog.includes('sub new.path'), 'new subscription')
  heldOld.resolve(undefined)
  await ready
  await waitFor(() => host.skLog.includes('unsub old.path'), 'late unsubscribe')

  assert.deepStrictEqual([...host.skSubs.values()], [['new.path']])
})

test('SK values arriving for the old generation during a reload are ignored', async () => {
  const host = installHost()
  host.state = { path: 'a.path' }
  const { updates } = await start()
  await waitFor(() => host.skSubs.size === 1, 'subscription')

  const held = deferred<unknown>()
  let getCalled = false
  host.handlers['state.get'] = () => { getCalled = true; return held.promise }
  host.stateChanged()
  await waitFor(() => getCalled, 'reload state.get')
  host.skValue('a.path', 99)
  await settle()
  assert.ok(updates.every((u) => u.value !== 99), 'stale SK value emitted during reload')

  held.resolve({ values: { path: 'a.path' } })
  await waitFor(() => host.skLog.length === 3, 'resubscribe')
  host.skValue('a.path', 7)
  await waitFor(() => updates.at(-1)?.value === 7, 'fresh value')
})
