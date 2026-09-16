# Version 3.0-11 Workflow and Punch-List Audit

- Status: **CLOSED — committed workflow scope implemented and field accepted**
- Initial audit baseline: `e7bed0be2e30812e74b5c53f5a65586dad0397da`
- Closure baseline: `5edf5e73fe0e9e7ed77056c25426b4444918b583`
- Scope: PLAN → PREPARE → OPERATE → REVIEW, authoritative data homes, primary terminology, committed V3.0 requirements, and remaining release gates
- Release effect: this record does not authorize merge, deployment, version change, tag, or publication

## 1. Outcome

The unified workflow is coherent and has one shared context strip across PLAN, PREPARE, OPERATE, and REVIEW. Planned facts, lifecycle facts, canonical QSOs, evidence, notes, checklist state, inventory, and historical loadout snapshots have identifiable owners. The audit found and corrects a small set of primary-UI terminology leaks.

The initial audit found one material committed V3.0 gap: multi-entity POTA/SOTA operation and QSO association had not been connected to the production runtime. V3.0-11B and V3.0-11C closed that gap. Production Activation and QSO persistence now performs compatibility reads and writes current entity/association schemas; the operator can add POTA and SOTA entities, choose the active set, and edit retained QSO associations without changing canonical QSO identity or totals. Manual and WSJT-X creation snapshot the active set. Duplicate ADIF import merges association evidence rather than adding another canonical QSO.

Entity export is intentionally an artifact projection rather than a persistence duplication. FieldOps produces one `.adif` file per associated activating entity. POTA artifacts identify the applicable park with `MY_SIG`, `MY_SIG_INFO`, and `MY_POTA_REF`; SOTA artifacts use `MY_SOTA_REF`. The same canonical QSO may therefore appear in multiple program artifacts while remaining one stored QSO and one result in FieldOps.

## 2. Authoritative data homes

| Datum | Authoritative home | Workflow use | Audit result |
| --- | --- | --- | --- |
| Planned program/reference, display name, site, window, station, modes, power | Retained SmartDeploy brief | Shared across all four phases | **Pass** — Activation compatibility copies do not replace retained plan truth. |
| Current inventory and reusable loadout definitions | Equipment inventory/loadout stores | PLAN selection and Equipment workspace | **Pass** — operator-managed current facts. |
| Historical mission loadout | Immutable loadout snapshot in brief and Activation | PLAN through REVIEW | **Pass** — later inventory edits do not rewrite history. |
| Activation status, actual start/end, objective and deadline | Activation store | PREPARE, OPERATE, REVIEW | **Pass** — lifecycle authority remains the Activation. |
| Canonical QSO contact | QSO store | OPERATE logger and REVIEW totals | **Pass** — entity associations and export projections do not duplicate canonical contacts or inflate totals. |
| POTA/SOTA entity set and QSO/entity associations | V3 Activation/QSO records | PLAN, OPERATE, REVIEW, import/export | **Pass** — production persistence, active-set inheritance, editing, duplicate-safe import, and per-entity export are implemented. |
| Operator notes | Activation Notes collection | OPERATE and REVIEW | **Pass**. |
| Field checklist | Checklist persistence keyed to brief/Activation workflow | PREPARE and retained operation | **Pass**. |
| Mission forecast and space weather | Retained evidence stores keyed by brief | PLAN and REVIEW | **Pass** — live refresh does not erase prior retained evidence on failure. |
| Modeled propagation | Retained SmartDeploy brief | PLAN, OPERATE comparison, REVIEW | **Pass** — discrete sampling and limitations remain explicit. |
| General/station-specific observed RF | Operational-intelligence evidence store | OPERATE and REVIEW | **Pass** — observed evidence remains distinct from modeled evidence and QSOs. |
| Windows hardware/OS telemetry | .NET Agent, constrained Express projection | Dashboard/PREPARE | **Pass** — browser remains outside Agent credential ownership. |
| App definition and runtime availability | App Catalog plus discovery evidence | Application workspace | **Pass** — launcher metadata is not an integration claim. |

## 3. Workflow audit

| Phase | Primary operator purpose | Result |
| --- | --- | --- |
| PLAN | Confirm site/window/station/loadout, retained forecast/space weather, duration-aware propagation, and resource-aware guidance. | **Pass**. |
| PREPARE | Confirm readiness, objective/deadline, checklist, offline evidence, live planned-site conditions, location/clock, and start decision. | **Pass**. Raw brief identity is removed from the primary header and remains in evidence details. |
| OPERATE | Maintain the active lifecycle, TX context, QSO log, station-specific evidence, and notes without radio control. | **Pass** — active entity selection, inherited associations, and QSO association editing are available without radio control. |
| REVIEW | Read the completed operation, retained plan/evidence, actual results, notes, and retrospective comparisons without live-provider mutation. | **Pass** — retained associations remain attached to canonical QSOs and export as entity-specific artifacts. |

## 4. Primary terminology corrections

This slice makes presentation-only corrections without changing persistence or authority:

- `retained mission context` becomes `operation context` in the phase header;
- `Brief-anchored decision support` becomes `Pre-operation checks`;
- the raw brief ID is removed from the primary PREPARE header and remains available in evidence/technical details;
- `Selection provenance` becomes `Objective choice`, with older-record wording stated plainly;
- REVIEW describes a `Read-only record of the completed operation` instead of an internal evidence-assembly phrase.

Technical identifiers, provenance, schema, source states, and diagnostics remain available in expandable evidence/technical sections because they are useful for trustworthy diagnosis.

## 5. Committed-scope disposition

| Requirement | Disposition at this audit |
| --- | --- |
| Architecture/scope contract and V2.9 handoff reconciliation | **Completed** |
| Domain, persistence, backup, hash, restore, rollback-data contracts | **Completed foundation**; real V2.9.1 migration/rollback proof remains V3.0-12 acceptance work |
| Weather local-time/DST correction and richer six-hour condition/precipitation | **Implemented and field accepted** |
| Agent-owned Wi-Fi SSID and header fallbacks | **Implemented and field accepted** |
| Semantic day/night visual system | **Implemented**; optional red-light mode deferred; operator-requested blue/green direction preserved instead of the rejected brown palette |
| Standalone offline Maidenhead calculator | **Implemented and field accepted**; distance/bearing remains in the existing separate location tool by accepted operator choice rather than duplicating it in the Maidenhead tab |
| Multiple POTA/SOTA entities and canonical multi-association logging | **Implemented and field accepted** at `5edf5e73fe0e9e7ed77056c25426b4444918b583`; two POTA plus one SOTA produced three entity-specific ADIF files while retaining one canonical QSO set |
| Persistent inventory, reusable loadouts, snapshots, mission association | **Implemented and field accepted** |
| Unified workflow context | **Implemented and field accepted** |
| Duration-aware propagation | **Implemented and field accepted** |
| Deterministic resource-aware guidance | **Implemented and field accepted** |
| SmartFrequency/integration decisions | **Completed by V3.0-10A** |

## 6. Remaining items by terminal state

### Closed committed blocker

1. Production multi-entity Activation/QSO persistence, active-set editing, manual and WSJT-X inheritance, association editing, duplicate-safe import, and entity-specific export are complete. Focused V3.0-11C validation passed 32/32 tests, and the CF-20 update verified exact source/native parity and a running Dashboard before the operator accepted the two-POTA/one-SOTA export workflow.

### Release-gated, not defects

1. Complete automated V3.0 gates and record exact totals.
2. Prove migration using a backed-up and hashed real V2.9.1 operator configuration.
3. Complete running-Dashboard update, listener ownership, rollback, reboot/sign-in, Agent, Tray, Dashboard, and source/native parity acceptance on the CF-20.
4. Reconcile README, documentation index, changelog, package metadata, badges, and version claims to `3.0.0` only at final release closure.
5. Build/publish/tag/deploy only the exact authorized release commit and only after explicit approval.

### Deferred, blocked, or excluded by approved decision

The terminal decisions in `docs/planning/Version-3.0-Integration-Decision-Closure.md` govern SmartFrequency recommendations, Local/NVIS, true path prediction, APRS, Direwolf, Meshtastic, Winlink, DigiPi, WSPR, external log synchronization, contest scoring, award tracking, broad diagnostic history/export, and external equipment enrichment. CAT/PTT/tuning/transmit control, automatic spotting/submission, arbitrary installation/shell access, cloud/fleet/enterprise scope, and broad privileged APIs remain excluded without separate approval.

## 7. Closure and next slice

V3.0-11 is closed. No committed workflow feature remains open from this audit. V3.0-12 may begin the full integration, real-data migration, rollback, CF-20 acceptance, version reconciliation, and release-closure process. This closure does not claim those gates have passed and does not authorize version change, merge, final deployment, reboot, tag, native publication, or stable release.
