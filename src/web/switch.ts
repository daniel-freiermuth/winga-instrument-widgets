// Switch widget: displays a boolean/0-1 Signal K path and actuates it with
// signalk.put on tap.

import { startInstrument, html, raw } from './common'
import type { InstrumentConfig, ExtensionClient, UpdateArgs } from './common'

interface CurrentState {
  config: InstrumentConfig
  value: unknown
  client: ExtensionClient | null
}

let current: CurrentState = { config: {}, value: undefined, client: null }

function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'on'
}

function render({ config, value, client }: UpdateArgs): void {
  current = { config, value, client }
  const root = document.getElementById('root')
  if (!root) return
  const label = config.label ?? config.path ?? 'Not configured'
  const on = isOn(value)
  const known = value !== undefined && value !== null
  root.innerHTML = html`
  <div class="switch ${raw(known ? (on ? 'on' : 'off') : 'unknown')}">
    <div class="switch-pill"><div class="switch-knob"></div></div>
    <div class="switch-state">${known ? (on ? 'ON' : 'OFF') : '--'}</div>
    <div class="switch-label">${label}</div>
  </div>`
}

window.addEventListener('pointerup', () => {
  const { config, value, client } = current
  if (!client || !config.path) return
  if (!client.hasCapability('signalk.put')) return
  client.signalk.put(config.path, isOn(value) ? 0 : 1).catch((err: unknown) => {
    console.warn('switch PUT failed', err)
    const sw = document.querySelector<HTMLElement>('#root .switch')
    if (sw) {
      sw.classList.add('error')
      setTimeout(() => { sw.classList.remove('error') }, 2000)
    }
  })
})

startInstrument({ defaults: {}, onUpdate: render })
  .catch((err: unknown) => {
    const root = document.getElementById('root')
    if (root) root.textContent = 'Host connection failed'
    console.error(err)
  })
