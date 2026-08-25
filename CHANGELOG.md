# Changelog

All notable changes to the **FieldOps Dashboard** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.5.0] - 2026-08-24

Version 2.5.0 was field-accepted on the supported ToughBook deployment and published.

### Added
- **Operations Readiness**: Brief-anchored readiness keeps operation, station, antenna, mode, checklist, Activation Notes, and field workflow context together.
- **Mission-window evidence**: Retained terrestrial weather and brief-scoped space-weather evidence remain available after restart and offline; forecasts and propagation are not guarantees.
- **Planning and day-of separation**: Planned locations remain distinct from current/live locations, with existing provider-reference, current-device, manual coordinate, and Maidenhead controls retained.
- **P.533 outlook**: The planning workflow includes a bounded band outlook from the offline P.533 runtime.
- **Field workflow**: Reorganized operation, planning, readiness, day-of live weather/alerts, and troubleshooting surfaces include collapsible Findings and Print / Save PDF.
- **Hardened bootstrap**: Production Dashboard bootstrap and static-serving readiness are included in the release candidate package.

### Limitations
- Clock synchronization remains Unknown/unverified, and radio/station endurance remains unknown.
- Live providers require connectivity; retained and modeled evidence can be stale or unavailable.
- Local/NVIS remains unsupported. There is no logging/ADIF, spotting, Winlink, APRS, Meshtastic, inventory/loadouts, AI, or full mission lifecycle.
- ToughBook power behavior and Windows runtime semantics remain documented limitations; the released package passed the supported ToughBook validation.

---

## [2.4.0] - 2026-08-20

### Added
- **Coordinate Workspace**: GNSS and manual location handling with Maidenhead grid, distance, bearing, and source-aware states.
- **Offline P.533 guidance**: Bundled, hash-verified propagation assets support modeled HF guidance without an Internet connection, alongside retained observed-RF evidence where available.
- **SmartDeploy POTA/SOTA briefs**: Retained local planning briefs preserve propagation, path, mission-window, and operational context for field use.
- **Activation Notes**: Local mission notes support activation preparation and field observations.
- **Field Readiness Checklist**: Persistent readiness tracking supports repeatable ToughBook deployment preparation.
- **Local/offline persistence**: Configuration, briefs, notes, and readiness state survive browser-origin changes, reboot, and intermittent connectivity.

### Changed
- **Field Tools release scope**: Coordinate and planning surfaces are now the current Version 2.4 product surface, with explicit live, cached, stale, unavailable, manual, and modeled status semantics.
- **Updater and native runtime**: Exact-revision updater validation, native artifact packaging/publication contracts, and runtime-readiness checks were strengthened for the Windows Agent and Tray companion.
- **ToughBook validation**: Field readiness, Activation Notes, updater behavior, and the Local/NVIS presentation correction were validated on the supported rugged deployment target.

### Deferred
- **Local/NVIS evaluator**: Local/NVIS remains visible but disabled in the destination presentation. Version 2.4 does not include NVIS prediction or recommendation logic, and no evaluator is claimed.
- **Version 2.5 work**: Multi-user, fleet, remote-administration, signing, enterprise hardening, and broader Field Operations Assistant behavior remain outside this release.

---

## [2.3.0] - 2026-08-14

### Added
- **Single-Operator ToughBook MVP**: Reliable reboot/login startup with Tray-owned production Dashboard backend lifecycle.
- **Native field telemetry**: SerialNmea GNSS, Maidenhead/grid, weather/location integration, Windows battery/power, and CPU/memory/storage/network telemetry.
- **Application launching**: Bounded Tray launcher support for executables and HTTP/HTTPS URIs with truthful unavailable and `ExecutableNotFound` states.
- **Persistent operator configuration**: Product-owned per-operator configuration survives reboot and browser-origin changes.

### Changed
- **Updater workflow**: Exact-revision deployment validation now supports practical release-style Agent and Tray artifact updates.
- **Local telemetry security**: Corrected the system telemetry Node named-pipe ACL boundary.

### Known limitations
- WSJT-X has a local Hamlib DLL/install issue.
- GridTracker is unavailable because its executable is missing or its configured path does not match the installation.
- HF Band Guidance remains modeled guidance when live ionosonde data is unavailable.
- Gemini advisor requires a configured API key.
- Historical updater backup directories remain cleanup and hardening work.
- Enterprise installer, signing, and multi-session work remain deferred.

---

## [1.2.0] - 2026-07-22

### Added
- **Dedicated COM Port Configuration**: Added explicit selection for hardware serial ports (`COM6`, `COM1`–`COM16`, `/dev/ttyUSB*`, `/dev/ttyACM*`) and custom user-entered serial interface paths across both `GPSGridWidget` and `ConfigModal`.
- **WMI Dual-Battery Hardware Polling**: Created backend API endpoint `/api/system/battery` executing PowerShell `Get-CimInstance -ClassName Win32_Battery` to poll real-time charge and voltage on Panasonic ToughBook & ToughPad dual battery systems (Main Tablet BAT1 + Keyboard Dock BAT2).
- **Manual Battery Calibration Panel**: Interactive slider override controls for field testing low-battery alerts, critical voltage warnings, and uncoupled keyboard dock configurations.
- **Project Documentation**: Initialized comprehensive `README.md` and `CHANGELOG.md` repository files detailing hardware setup, features, and deployment procedures.

### Changed
- Default GPS serial device changed to `COM6 (GPS Receiver)` with 9600 BAUD NMEA standard.
- Enhanced battery polling fallback hierarchy: Backend WMI API -> Browser Navigator Battery API -> Field Simulation mode.

---

## [1.1.0] - 2026-07-21

### Added
- **SmartLog+ ADIF Contact Logger**: Quick QSO entry with Maidenhead grid distance & bearing calculation and standard ADIF file generator/parser.
- **VOACAP HF Band Propagation Widget**: SFI, K-index, A-index solar flux indicators with band condition predictions for 80m through 6m.
- **NOAA Weather Field Alert Station**: Weather snapshot with active emergency alert indicators.
- **Tactical Display Themes**: Night Vision (Red Phosphor), High-Contrast Sunlight Readable, and OLED Amber color palettes.

---

## [1.0.0] - 2026-07-20

### Added
- Initial release of FieldOps Dashboard.
- Configurable Ham Radio App Launcher grid supporting WSJT-X, FLdigi, N1MM, HRD, Chirp, GridTracker, and QRZ.
- JSON configuration export/import for zero-internet field operations.
