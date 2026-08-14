// Time widget: a zero-config course readout. Cycles ETA (goal) → ETA (waypoint)
// → TTG (goal) → TTG (waypoint) on tap.

import { formatDuration, formatTimestamp } from './common'
import { startCyclic } from './cyclic'
import type { CyclicMode } from './cyclic'

/** ISO 8601 timestamp string → compact local time-of-arrival. */
const eta = (v: unknown): string =>
  typeof v === 'string' ? formatTimestamp(v) : '--'

/** Seconds remaining → human-readable duration. */
const ttg = (v: unknown): string =>
  typeof v === 'number' ? formatDuration(v) : '--'

const MODES: CyclicMode[] = [
  { path: 'navigation.course.calcValues.route.estimatedTimeOfArrival', label: 'ETA · Goal', format: eta },
  { path: 'navigation.course.calcValues.estimatedTimeOfArrival', label: 'ETA · WPT', format: eta },
  { path: 'navigation.course.calcValues.route.timeToGo', label: 'TTG · Goal', format: ttg },
  { path: 'navigation.course.calcValues.timeToGo', label: 'TTG · WPT', format: ttg }
]

startCyclic(MODES).catch((err: unknown) => {
  const root = document.getElementById('root')
  if (root) root.textContent = 'Host connection failed'
  console.error(err)
})
