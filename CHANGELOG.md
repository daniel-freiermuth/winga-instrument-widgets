# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-18

### Changed

- Long-press gesture no longer opens the configuration panel from inside the widget — the host chartplotter is responsible for that.

### Fixed

- Path-selection control in the configuration panel replaced with a dropdown so that available paths are visible and selectable on mobile devices.

## [0.2.0] - 2026-07-18

### Added

- New `m/nm` distance unit: displays values in metres for short distances and switches to nautical miles beyond 1 nm.
- Configuration panel now suggests commonly-used Signal K paths with friendly human-readable labels.
- Timestamps (`s` epoch values) and durations are formatted in human-readable form (e.g. `14:32`, `2 h 15 min`).

## [0.1.5] - 2026-07-18

### Fixed

- Static asset directory was resolved one level too high, causing widget pages to fail to load.

## [0.1.4] - 2026-07-18

### Fixed

- Plugin identifier had not been updated after the rename, preventing Signal K from recognising the plugin.

## [0.1.3] - 2026-07-18

### Fixed

- Plugin failed to start due to an incorrect rollup bundle output configuration introduced during the rename.

## [0.1.2] - 2026-07-18

### Fixed

- Several source locations still referenced the old package name.

## [0.1.1] - 2026-07-18

### Fixed

- Plugin display name and internal identifiers had not yet been updated after the rename.

## [0.1.0] - 2026-07-18

Initial release as `winga-instrument-widgets`. Full rewrite in TypeScript of the earlier `signalk-instrument-widgets` proof of concept.

### Added

- **Gauge widget** — circular analogue gauge; configurable Signal K path, unit, range, and label.
- **Meter widget** — horizontal bar meter with configurable min/max range.
- **Switch widget** — on/off toggle that issues a Signal K PUT to a configurable path.
- **Display Value widget** — plain numeric readout that scales its typography to fill the available iframe.
- Unit-aware value conversion: reads `displayScale`/`units` from the server's per-path metadata and lets the user override the unit per widget.
- Simple math formula support: an expression (e.g. `x * 1.5 + 10`) can transform the raw value before display.
- Long-press gesture inside any widget opens the host configuration panel.
- All widgets render responsively inside whatever frame size the host chartplotter provides.
