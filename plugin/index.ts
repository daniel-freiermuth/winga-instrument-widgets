// signalk-instrument-widgets
//
// Reference extension for the plotterExtensions specification. The plugin
// itself is intentionally small: it registers a read-only plotterExtensions
// resource provider whose single resource is this extension's manifest, and
// (optionally) provides a demo switch path with a PUT handler so the switch
// widget can be exercised against playback data that has no real switches.
//
// The widget/panel web assets live in public/ and are served by the plugin
// itself, mounted as a top-level Express static route at
// /plotterext/<package-name>/. This is a public route (no token required,
// same as the old signalk-webapp mechanism) but, unlike a signalk-webapp, it
// does NOT appear in the server's Webapps launcher — these assets are only
// ever loaded inside a host chartplotter's iframe, never launched directly.
// It is deliberately NOT a /plugins/* route: those are admin-gated, which
// would break read-only users.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import pkg from '../package.json'

const _dirname = dirname(fileURLToPath(import.meta.url))

const PLUGIN_ID = 'winga-instrument-widgets'
const ASSET_BASE = `/plotterext/${PLUGIN_ID}`
const PUBLIC_DIR = join(_dirname, '..', '..', 'public')
const DEMO_SWITCH_PATH = 'electrical.switches.demo.state'

// ── Signal K server interfaces ─────────────────────────────────────────────

interface PutResult {
  state: string
  statusCode: number
}

type PutHandler = (context: string, path: string, value: unknown) => PutResult

interface ResourceProviderMethods {
  listResources: (query: unknown) => Promise<Record<string, unknown>>
  getResource: (id: string, query?: unknown) => Promise<unknown>
  setResource: (id: string, value: unknown) => Promise<void>
  deleteResource: (id: string) => Promise<void>
}

interface ResourceProviderOptions {
  type: string
  methods: ResourceProviderMethods
}

/** Minimal surface of the Signal K server `app` object used by this plugin. */
export interface SkApp {
  debug(msg: string): void
  error(msg: string): void
  use?: (path: string, handler: unknown) => void
  registerResourceProvider?: (opts: ResourceProviderOptions) => void
  registerPutHandler?: (context: string, path: string, handler: PutHandler) => void
  handleMessage(pluginId: string, delta: unknown): void
}

// ── Plugin manifest ────────────────────────────────────────────────────────

function buildManifest(): Record<string, unknown> {
  return {
    name: 'Winga Instrument Widgets',
    description:
      'Instrument widgets: gauge, percent meter, switch, display, plus ' +
      'tap-to-cycle distance and time course widgets.',
    version: pkg.version,
    apiVersion: '1',
    requires: ['widgets', 'panels.iframe', 'signalk.stream'],
    optional: ['signalk.put'],
    widgets: [
      {
        id: 'gauge',
        title: 'Gauge',
        type: 'iframe',
        url: `${ASSET_BASE}/gauge.html`,
        size: '1x1',
        configPanel: 'instrument-config',
        lifecycle: 'whileEnabled'
      },
      {
        id: 'meter',
        title: 'Meter (0-100%)',
        type: 'iframe',
        url: `${ASSET_BASE}/meter.html`,
        size: '2x1',
        configPanel: 'instrument-config',
        lifecycle: 'whileEnabled'
      },
      {
        id: 'switch',
        title: 'Switch',
        type: 'iframe',
        url: `${ASSET_BASE}/switch.html`,
        size: '1x1',
        configPanel: 'instrument-config',
        lifecycle: 'whileEnabled'
      },
      {
        id: 'display',
        title: 'Display Value',
        type: 'iframe',
        url: `${ASSET_BASE}/display.html`,
        size: '1x1',
        configPanel: 'instrument-config',
        lifecycle: 'whileEnabled'
      },
      {
        id: 'distance',
        title: 'Distance (DTG)',
        type: 'iframe',
        url: `${ASSET_BASE}/distance.html`,
        size: '1x1',
        lifecycle: 'whileEnabled'
      },
      {
        id: 'time',
        title: 'Time (ETA / TTG)',
        type: 'iframe',
        url: `${ASSET_BASE}/time.html`,
        size: '1x1',
        lifecycle: 'whileEnabled'
      }
    ],
    panels: [
      {
        id: 'instrument-config',
        title: 'Instrument Setup',
        type: 'iframe',
        url: `${ASSET_BASE}/config.html`,
        lifecycle: 'onOpen'
      }
    ]
  }
}

// ── Plugin factory ─────────────────────────────────────────────────────────

export interface Plugin {
  id: string
  name: string
  description: string
  schema: () => Record<string, unknown>
  start: (options: Record<string, unknown> | null | undefined) => void
  stop: () => void
}

export default function plugin(app: SkApp): Plugin {
  let providerRegistered = false
  let assetsMounted = false
  let demoSwitchState = 0
  let running = false

  const debug = (msg: string): void => app.debug(`${PLUGIN_ID}: ${msg}`)

  // Serve public/ as a top-level static route. Express is provided by the
  // Signal K server, so requiring it adds no runtime dependency of our own.
  // Guarded so the test harness (a fake app with no .use) is a no-op.
  // express is a peerDependency served by the Signal K server. Rollup compiles
  // this file to CJS with express external, so this static import becomes a
  // synchronous require() in the output — assets are mounted before start()
  // returns and the manifest never exposes widget URLs before they are served.
  const mountAssets = (): void => {
    if (assetsMounted) return
    if (typeof app.use !== 'function') return
    try {
      app.use(ASSET_BASE, express.static(PUBLIC_DIR))
    } catch {
      app.error(`${PLUGIN_ID}: express unavailable; cannot serve ${ASSET_BASE}`)
      return
    }
    assetsMounted = true
    debug(`assets served at ${ASSET_BASE}`)
  }

  const registerProvider = (): void => {
    if (providerRegistered) return
    if (typeof app.registerResourceProvider !== 'function') {
      app.error(`${PLUGIN_ID}: server has no resource provider registry`)
      return
    }
    app.registerResourceProvider({
      type: 'plotterExtensions',
      methods: {
        listResources: (): Promise<Record<string, unknown>> => {
          if (!running) return Promise.resolve({})
          return Promise.resolve({ [PLUGIN_ID]: buildManifest() })
        },
        getResource: (id: string): Promise<unknown> => {
          if (!running || id !== PLUGIN_ID) {
            return Promise.reject(new Error(`No such plotterExtensions resource: ${id}`))
          }
          return Promise.resolve(buildManifest())
        },
        setResource: (): Promise<void> =>
          Promise.reject(new Error(`${PLUGIN_ID} is a read-only provider`)),
        deleteResource: (): Promise<void> =>
          Promise.reject(new Error(`${PLUGIN_ID} is a read-only provider`))
      }
    })
    providerRegistered = true
  }

  const emitDemoSwitch = (): void => {
    app.handleMessage(PLUGIN_ID, {
      updates: [
        {
          values: [{ path: DEMO_SWITCH_PATH, value: demoSwitchState }]
        }
      ]
    })
  }

  const startDemoSwitch = (): void => {
    if (typeof app.registerPutHandler !== 'function') return
    app.registerPutHandler(
      'vessels.self',
      DEMO_SWITCH_PATH,
      (_context: string, _path: string, value: unknown): PutResult => {
        demoSwitchState = value === true || value === 1 || value === '1' ? 1 : 0
        emitDemoSwitch()
        return { state: 'COMPLETED', statusCode: 200 }
      }
    )
    emitDemoSwitch()
    debug(`demo switch active at ${DEMO_SWITCH_PATH}`)
  }

  return {
    id: PLUGIN_ID,
    name: 'Winga Instrument Widgets',
    description:
      'Gauge, meter and switch widgets for chartplotters that support the plotterExtensions resource type.',

    schema: (): Record<string, unknown> => ({
      type: 'object',
      properties: {
        enableDemoSwitch: {
          type: 'boolean',
          title: 'Provide a demo switch path',
          description:
            `Registers a PUT handler and emits ${DEMO_SWITCH_PATH} so the ` +
            'switch widget can be tested without real switch hardware.',
          default: true
        }
      }
    }),

    start(options: Record<string, unknown> | null | undefined): void {
      running = true
      mountAssets()
      registerProvider()
      if (options?.['enableDemoSwitch'] !== false) {
        startDemoSwitch()
      }
      debug('started')
    },

    stop(): void {
      running = false
      debug('stopped')
    }
  }
}
