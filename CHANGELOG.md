# Changelog

All notable changes to the **FieldOps Dashboard** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
