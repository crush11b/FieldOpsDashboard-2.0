# Version 2.3 Single-Operator Field MVP Acceptance

- Date: 2026-08-14
- Platform: Production Panasonic ToughBook CF-20
- Revision: `67c982993415e557c184f46962ec3bf1e4485e82`
- Result: **PASSED**

## Acceptance Gate

The Single-Operator Field MVP acceptance gate **PASSED** on the production ToughBook.

Validation confirmed:

- normal operator startup after reboot;
- Tray auto-start;
- Tray-owned production Dashboard backend;
- persistent operator configuration, including KQ4EVK surviving reboot;
- native SerialNmea GPS and Maidenhead/grid display;
- weather and location integration;
- Windows battery and power telemetry with two physical CF-VZSU0Q batteries;
- CPU, memory, storage, and network telemetry;
- bounded Tray application launcher;
- successful VARA FM launch;
- successful JS8Call launch;
- successful PSK Reporter URI launch;
- honest `ExecutableNotFound` behavior for GridTracker;
- updater and exact-revision deployment workflow;
- system telemetry Node named-pipe ACL correction;
- clean reboot/login operation without PowerShell or manual startup.

## Known Non-Blockers

These items were observed during field preparation and are not represented as fixed:

- WSJT-X local Hamlib DLL/install issue;
- GridTracker executable missing or configured path mismatch;
- HF Band Guidance remains modeled guidance when live ionosonde data is unavailable;
- Gemini advisor requires a configured API key;
- historical updater backup directories remain cleanup/hardening work;
- enterprise installer, signing, and multi-session work remains deferred.