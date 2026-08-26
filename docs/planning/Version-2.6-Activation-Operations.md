# Version 2.6 - Activation Operations

- Status: 2.6-05 implemented; Version 2.6 planned slices complete
- Baseline: Version 2.5.0
- Supported deployment: single operator on one locally operated Windows field computer

## Release objective

Evolve the Version 2.5 Operations Assistant into a practical activation workspace that prepares field context, retains mission context, records contacts, and preserves an activation as a coherent operational record.

## Approved slices

1. **2.6-01 - Activation Foundation**: durable Activation identity, local persistence, SmartDeploy and Activation Notes association, and minimal lifecycle UI.
2. **2.6-02 - GPS Time & Offline Readiness**: GPS/Windows time evidence and offline preparation workflow.
3. **2.6-03 - QSO Logging & ADIF**: durable contact records and ADIF import/export workflow.
4. **2.6-04 - Activation Review**: post-activation review and analysis of retained activation artifacts.
5. **2.6-05 - Activation Workspace UX Consolidation**: phase-based PLAN, PREPARE, OPERATE, and REVIEW workspace.

## 2.6-01 status

Complete on the consolidated `feature/2.6-activation-operations` branch. Activation is a first-class typed domain concept backed by a local JSON store. It references retained SmartDeploy briefs and Activation Notes rather than copying their evidence payloads.

The slice supports POTA, SOTA, and General activations; optional planned coordinates, Maidenhead grid, mission window, title, and reference; planned, active, and completed lifecycle states; corrupt-data diagnostics; and a minimal SmartDeploy-integrated operator panel.

## 2.6-02 status

Implemented on the same branch. The .NET Local Agent remains the sole COM6 owner and exposes RMC-derived GNSS UTC independently of geographic fix validity. Freshness is based on monotonic receipt age, while UTC syntax/date validity is checked separately. The operator can explicitly synchronize Windows time through the Agent; the operation enables only `SeSystemtimePrivilege` for that call, rejects corrections over five minutes, and reports unavailable, stale, malformed, privilege, native, and unsafe-offset outcomes without changing the service identity.

Operations Readiness now consumes synchronization evidence without treating a historical success as continuously synchronized. Offline Preparation independently evaluates retained plan/location/readiness evidence and requests live weather/alerts, returning per-check states and partial diagnostics rather than a global GO/NO-GO decision. The NMEA clock source is not PPS-disciplined and does not claim sub-second or FT8/FT4 timing suitability; that remains a field-validation concern.

2.6-02 is complete. Practical FT8 field validation used WSJT-X connected to the actual radio and observed 19 decoded FT8 stations. DT values were mostly approximately -0.5 s, with some around +0.1 s and one observed outlier approximately -1.1 s. FieldOps GPS synchronization was active, BktTimeSync was not required, and COM6 remained under FieldOps ownership. This is practical FT8 timing validation, not precision clock certification.

## 2.6-03 status

Implemented on the same consolidated branch. QSOs are durable Activation-owned records in the local JSON persistence path, with UTC time, callsign, band/frequency, mode/submode, reports, supported grid and POTA/SOTA metadata, timestamps, and manual/import provenance. The compact Activation workflow supports rapid manual logging, edit/delete, chronological listing, bounded ADIF import with partial-error reporting, deterministic duplicate detection, and standards-shaped ADIF export. Duplicate identity is Activation plus normalized callsign, UTC QSO time, band, frequency when known, mode, and submode.

Known limitations: this slice does not provide rig control, automatic radio metadata, direct WSJT-X or Ham2K integration, online lookups, submission workflows, or contest features. Unknown ADIF fields are ignored; supported values are preserved without inventing missing station or location evidence. POTA/SOTA context is exported through standard `POTA_REF` or `SOTA_REF` fields when Activation evidence exists.

## 2.6-04 status

Implemented on the same consolidated branch. Activation Review is a read-only assembly over the Activation, associated SmartDeploy brief, retained mission forecast and space-weather snapshot, modeled/observed propagation evidence, Activation Notes, and Activation-owned QSOs. It presents plan, retained environment, modeled propagation, QSO results and provenance, operator notes, and deterministic factual plan-versus-result findings without duplicating source stores.

Review evidence uses explicit available, retained, unavailable, unknown, and provisional semantics. It does not infer causality, score operator performance, or generate AI summaries. Opening Review never fetches live providers or mutates historical evidence; live refresh remains an explicit separate workflow. The existing QSO logger and Activation Notes panels remain the editing surfaces.

## 2.6-05 status

Implemented on the same branch as a persistent Activation workspace. The operator lifecycle is organized as **PLAN -> PREPARE -> OPERATE -> REVIEW**: PLAN is for pre-departure planning and retained outlook, PREPARE is for summit-arrival readiness and offline preparation, OPERATE prioritizes the QSO Logger, Activation Notes, and completion controls, and REVIEW is the post-operation retained-evidence view.

Each datum has one primary home; other phases use only compact context. Provenance and model limitations remain available under secondary technical details. Generic utilities, including the Antenna Length Calculator, remain in Field Tools outside the Activation workspace. Phase changes replace the main content rather than scrolling through the former stacked workflow.

The Local Agent GNSS lifecycle is restart-safe: restarting `FieldOpsAgent` resets the active session, releases the configured NMEA serial reader, and reacquires the configured GNSS serial interface automatically. Transport-active/no-fix and independent RMC UTC evidence semantics remain unchanged.

CF-20 acceptance confirmed the four-phase workspace architecture. The bounded acceptance corrections remove redundant PLAN operation details and internal identifiers from primary presentation, make PREPARE a compact summit-readiness summary with evidence details secondary, and expose the existing QSO Logger immediately in OPERATE for active and completed Activations. REVIEW now distinguishes modeled candidate bands from explicitly planned operation, retains and flags QSOs outside the mission window without distorting in-window chronology, and keeps exact brief identifiers in Evidence Details. Mission Forecast refresh now requests the retained UTC mission dates explicitly, retains successful provider evidence, and surfaces specific provider, horizon, or planned-coordinate failure reasons; it remains independent of Space Weather evidence.

## Deployment revision parity correction

The development ToughBook helper now resolves one canonical 40-character revision from the checked-out repository `HEAD` and requires a clean worktree before copying source. Native Agent and Tray publication is performed into an isolated temporary output outside the repository, so ignored or stale `agent\\artifacts\\publish\\win-x64` content cannot be reused. The generated deployment manifest is written into the installed Dashboard from that same published artifact identity.

Deployment success is gated on parity between repository `HEAD`, the native artifact manifest, installed Agent and Tray informational revisions, deployment-manifest `sourceRevision`/`nativeRevision`, and the live Dashboard `/api/version` response. Any missing or mismatched identity fails the helper with expected and observed revisions; the six green summary is unreachable until all checks pass. The helper does not perform a ToughBook deployment automatically. Interactive Tray startup restoration remains a separate field-acceptance concern unless the operator's deployment run demonstrates otherwise through the existing runtime checks.

## Operator-facing phase contract

The default workspace answers the question for the current phase: **PLAN** describes the destination, timing, station, retained outlook, and modeled guidance before departure; **PREPARE** is a compact summit preflight for location, clock, power, conditions, station, checklist, and the next action; **OPERATE** starts the durable Activation, keeps the QSO Logger primary, and retains quick Activation Notes until **END ACTIVATION**; **REVIEW** is the after-action summary available after completion. Technical Details and Evidence Details retain UUIDs, provider states, provenance, timestamps, limitations, diagnostics, and source vocabulary without making them the normal operating surface.

The following remain separate Version 2.6 closure defects and are not hidden by this UX correction: successful deployment still requires follow-up validation for restoring the interactive Tray; CF-20 power telemetry may report `Unknown / Unknown` and requires separate diagnosis; and clock synchronization evidence must be evaluated across Agent restart/deployment before it can be treated as current. The UI continues to report these states honestly.

The PLAN acceptance correction traced the production path through `RoadmapToolsModal` -> `SmartDeployPlanner` -> retained-brief loading -> `SmartDeployBriefView` -> `V2BriefView`. The earlier regression exercised `SmartDeployBriefView` fixtures but did not cover the planner's real retained-brief configuration; the committed implementation had only changed phase wiring and had not removed the old PLAN blocks. The correction removes those blocks from V2 PLAN, demotes planner GNSS context into a closed disclosure, and adds a planner render-path regression while preserving the retained forecast and underlying evidence.

## Explicit exclusions

The following remain deferred after 2.6-04: continuous clock steering, NTP/PPS discipline, PSKReporter, spotting, equipment/loadout profiles, direct WSJT-X or radio integration, APRS, Meshtastic, Direwolf, Winlink, DigiPi, Local/NVIS, AI features, rig control, CAT, automatic radio detection, POTA/SOTA website submission, QRZ lookup, QSL workflows, LoTW, Club Log, eQSL, contest scoring, and award tracking.