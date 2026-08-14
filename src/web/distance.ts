// Distance widget: a zero-config course readout. Starts on distance-to-goal
// (route end) and cycles to distance-to-waypoint (next point) on tap.

import { formatDistance } from './common'
import { startCyclic } from './cyclic'
import type { CyclicMode } from './cyclic'

/** Metres → adaptive nautical distance ("2.3 nm" / "452 m"). */
const dist = (v: unknown): string =>
  typeof v === 'number' ? formatDistance(v) : '--'

const MODES: CyclicMode[] = [
  { path: 'navigation.course.calcValues.route.distance', label: 'DTG · Goal', format: dist },
  { path: 'navigation.course.calcValues.distance', label: 'DTG · WPT', format: dist }
]

startCyclic(MODES).catch((err: unknown) => {
  const root = document.getElementById('root')
  if (root) root.textContent = 'Host connection failed'
  console.error(err)
})
