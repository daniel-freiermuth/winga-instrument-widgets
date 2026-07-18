// Rollup build config for signalk-instrument-widgets.
//
// Two output targets:
//   1. Browser IIFE bundles  →  public/js/<name>.js  (one per widget / panel)
//   2. Signal K plugin        →  dist/plugin/index.js  (CJS, loaded by SK server)
//
// Static web assets (CSS, icons, HTML shells) are written by the `webAssets`
// plugin that runs in the closeBundle hook of the last config.
//
// Type checking is deliberately omitted from the build pass; run
// `pnpm typecheck` for that.  Separating the two keeps the build fast and
// avoids @rollup/plugin-typescript re-checking files outside the bundle graph
// (scripts/, test/) that are included in tsconfig for the typecheck pass only.

import { cpSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const root = dirname(fileURLToPath(import.meta.url))
const pub  = join(root, 'public')

// Override tsconfig options for the emit pass: disable noEmit and the options
// that only make sense when type-checking (allowImportingTsExtensions requires
// noEmit; noCheck skips type diagnostics so the build pass is pure transpile).
const tsOpts = {
  compilerOptions: {
    noEmit: false,
    allowImportingTsExtensions: false,
    declaration: false,
    noCheck: true,
  }
}

const webEntries = ['gauge', 'meter', 'switch', 'display', 'config']

// ─── HTML shells ─────────────────────────────────────────────────────────────

const widgetPage = (name, title) =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="instruments.css">
</head>
<body class="widget">
<div id="root"></div>
<script src="js/${name}.js"></script>
</body>
</html>`

const panelPage = (name, title) =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="instruments.css">
</head>
<body class="panel">
<div id="root"></div>
<script src="js/${name}.js"></script>
</body>
</html>`

// ─── Custom plugin: copy static assets and emit HTML ─────────────────────────

function webAssets() {
  return {
    name: 'web-assets',
    // Runs after all bundle files have been written to disk.
    closeBundle() {
      cpSync(join(root, 'src/web/instruments.css'), join(pub, 'instruments.css'))
      cpSync(join(root, 'src/web/assets'), join(pub, 'assets'), { recursive: true })

      writeFileSync(join(pub, 'gauge.html'),   widgetPage('gauge',   'Gauge'))
      writeFileSync(join(pub, 'meter.html'),   widgetPage('meter',   'Meter'))
      writeFileSync(join(pub, 'switch.html'),  widgetPage('switch',  'Switch'))
      writeFileSync(join(pub, 'display.html'), widgetPage('display', 'Display Value'))
      writeFileSync(join(pub, 'config.html'),  panelPage('config',   'Instrument Setup'))

      writeFileSync(join(pub, 'index.html'), `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Instrument Widgets</title>
<link rel="stylesheet" href="instruments.css"></head>
<body class="panel">
<div id="root">
<h2>Instrument Widgets</h2>
<p class="status">This package provides gauge, meter, switch and display
widgets for chartplotters that support the Signal K
<code>plotterExtensions</code> resource type (e.g. Freeboard-SK). There is
nothing to configure here: in your chartplotter, press and hold an empty
widget area to add a widget, and press and hold a placed widget to
configure it.</p>
</div>
</body>
</html>`)
    }
  }
}

// ─── Build configs ────────────────────────────────────────────────────────────

// One IIFE bundle per widget / panel page.
const browserConfigs = webEntries.map((name) => ({
  input: `src/web/${name}.ts`,
  output: {
    file: `public/js/${name}.js`,
    format: 'iife',
    name: '_w',   // self-executing; the global name is never referenced
    sourcemap: true,
  },
  plugins: [resolve(), typescript(tsOpts)],
}))

// Signal K plugin → CJS.
// express is a runtime peer supplied by the SK server; mark it external.
// The footer hoists the default export so require('dist/plugin/index.js')
// returns the factory function directly, as SK expects.
// json() is needed because plugin/index.ts imports package.json for the version.
const pluginConfig = {
  input: 'plugin/index.ts',
  external: ['express'],
  output: {
    file: 'dist/plugin/index.js',
    format: 'cjs',
    sourcemap: true,
    footer: 'module.exports = exports["default"];',
  },
  plugins: [
    json(),
    resolve({ preferBuiltins: true }),
    typescript(tsOpts),
    webAssets(),  // asset copy + HTML generation after all bundles are written
  ],
}

export default [...browserConfigs, pluginConfig]
