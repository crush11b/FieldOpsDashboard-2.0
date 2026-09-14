# Version 3.0 - Cohesive Field Operations

- Status: **Approved implementation direction; 3.0-00 active**
- Approved: **2026-09-14**
- Baseline: **V2.9.1**, tag `v2.9.1`, peeled commit `7e67ed7a1820ce5fa11b57b89cf33808fb07aa3c`
- Supported deployment: one operator on one locally operated Panasonic ToughBook CF-20
- Entry branch: `planning/3.0-00-scope-contract`
- Initial field-candidate target: **2026-09-17**, for operator deployment before the 2026-09-18 trip

## 1. Purpose

V3.0 turns FieldOps Dashboard from a collection of capable panels into one cohesive field-operations workspace. Location, activation, time, connectivity, station state, evidence freshness, and operator intent must carry consistent meaning through planning, preparation, operation, logging, and review.

The release remains local-first, offline-capable, operator-controlled, and proportionate to the supported single-operator CF-20 deployment. V2.9 is closed and is not reopened without new reproducible evidence.

## 2. Authority and supersession

This contract reconciles the repository's planning and architecture lineage in this order:

1. `FieldOpsDashboard_Architecture_Review_2026-07-24.docx` and `FieldOpsDashboard_Architecture_Design_Specification_v1.0.docx` establish the original trust, layering, telemetry, persistence, offline, UI, diagnostic, and verification principles.
2. `FieldOpsDashboard_Development_Roadmap_v1.0.docx` and the four-part `Engineering_Backlog_v1.0` establish the historical release and epic map.
3. `FieldOpsDashboard_Project_Rebaseline_2026.md` changes sequencing and admission rules around operator value, the supported single-operator deployment, and proportionate engineering.
4. Version 2.4 through Version 2.9 planning and acceptance records document capabilities completed after the original roadmap was written.
5. This contract is the authoritative V3.0 release scope and numbering after the V2.9.1 baseline.

Where the legacy roadmap conflicts with the approved rebaseline, accepted later releases, or this contract, the later authority controls. Historical task IDs remain traceable but are not active merely because they appear in an earlier roadmap.

Architecture-impacting implementation requires an ADR or specification amendment before the affected production change. Slice documentation must identify the contract, migration, validation, and rollback boundary.

## 3. Governing product rules

- Operational honesty takes precedence over a plausible-looking value.
- UTC remains canonical in persistence and service contracts; presentation may use an explicitly identified local timezone.
- Existing domain stores and adapters remain authoritative. A unified operating context is a composed read model, not a second mutable source of truth.
- Live, cached, stale, modeled, manual, unavailable, and error states remain distinct.
- Measured, modeled, observed, station-specific, operator-entered, and derived evidence remain separately attributable.
- A privileged or external action is never implied by detection, evidence, advice, or catalog membership.
- Every implementation slice must leave the supported application deployable, testable, and rollback-safe.
- Browser portability is preserved by keeping Windows-specific hardware and network behavior behind the Agent boundary.
- Touch, keyboard, sunlight, night, and offline use are release concerns rather than optional polish.

## 4. Scope disposition

### 4.1 Required V3.0 product scope

1. Unified operating-context contract and consistent workflow use.
2. Correct forecast-time presentation with explicit timezone and DST behavior.
3. Connected Wi-Fi SSID telemetry with truthful fallbacks and diagnostic separation.
4. Multi-entity POTA/SOTA activation and QSO associations without canonical-QSO duplication.
5. Semantic visual tokens with independent day, night, and red-light field themes.
6. Shared offline Maidenhead conversion, center, distance, and bearing workspace.
7. Duration-aware propagation built on distinct start, midpoint, and end evidence.
8. Explainable deterministic SmartFrequency suggestions built on the V2.9 evidence contract.
9. Bounded, privacy-conscious local diagnostic history and operator-initiated export.
10. Workflow consolidation and final CF-20 acceptance.

### 4.2 Required research and decision tracks

- Current official POTA and SOTA submission and interchange requirements.
- Direwolf read-only interface and field workflow.
- Winlink supported read-only interface feasibility.
- Meshtastic local read-only interface, transport, consent, and location-privacy boundary.
- WSPR evidence through documented WSJT-X facilities or stable supported local artifacts.
- Officially supported POTA/SOTA data contracts, permissions, caching, and rate behavior.

Research does not authorize an integration. Each integration requires a separate go, no-go, or defer record tied to a concrete operator workflow.

### 4.3 Candidates, not commitments

- Persistent equipment inventory and reusable field loadouts.
- Resource-aware SmartDeploy equipment or endurance recommendations.
- True point-to-point path prediction.
- Further MY SIGNAL work not required by a reproducible defect or SmartFrequency dependency.
- Additional operating-context consolidation beyond named slice acceptance criteria.

### 4.4 Legacy V3.0 roadmap disposition

| Legacy work item | V3.0 disposition under this contract |
| --- | --- |
| True path prediction | Candidate only; no implementation commitment. |
| Destination and activation planning | Preserve accepted V2.4-V2.8 behavior and consolidate its workflow. |
| Grounded AI advisor | Not committed. Initial SmartFrequency behavior is deterministic and inspectable. |
| Signed release pipeline | Deferred under the single-operator rebaseline unless separately authorized. |
| Atomic updater and rollback | Existing accepted capability; preserve and regression-test rather than rebuild. |
| Encrypted profile transfer | Deferred; no current multi-device requirement establishes admission. |
| Mature diagnostics | Retained as bounded local history, not a generalized enterprise audit platform. |
| Production hardening | Retained in the final integration, accessibility, recovery, and CF-20 acceptance gate. |

The original SQLite prescription is not automatically revived. The approved rebaseline deferred SQLite until a concrete field capability proves it necessary. V3.0 retains the current versioned, atomic local persistence approach unless a slice-specific design demonstrates that it cannot meet correctness or recovery requirements.

## 5. Unified operating-context contract

`OperatingContextSnapshot` is a typed, immutable-at-observation read model composed from existing authorities. It contains:

- observation time in UTC and presentation-timezone policy;
- operating location, accuracy, status, age, and provenance;
- activation identity, lifecycle state, operating entities, mission window, and operator intent;
- current station band, frequency, and mode with source and freshness;
- connectivity summary that distinguishes local Agent, local network, and Internet state;
- evidence availability, status, source, age, and applicability.

The snapshot must not persist independent copies of authoritative state or create a generalized provider framework. The first implementation proves the contract through forecast-time presentation rather than landing an unused abstraction.

## 6. Multi-entity activation and QSO contract

One activation remains the durable operation lifecycle container. One QSO remains the canonical contact record.

An activation gains an ordered operating-entity set and a default entity subset inherited by newly logged QSOs. A QSO snapshots its operating-entity associations at creation and may separately carry contacted-entity associations for park-to-park or summit-to-summit meaning. Later activation edits do not silently rewrite earlier QSOs; explicit QSO association editing is supported.

Creating one activation or one QSO per entity is prohibited because it would inflate totals, conflict with the single-active-activation invariant, and corrupt WSJT-X routing, review, and export behavior.

### 6.1 Migration

- Activation schema advances from v2 to v3.
- QSO schema advances from v1 to v2.
- SmartDeploy brief and Activation Notes references advance from one program/reference to an entity set.
- Legacy configuration `potaParkRef` migrates to a default entity template and never fabricates an active activation.
- Existing QSO-level references take precedence during migration; otherwise the associated legacy activation reference is used; otherwise associations remain empty with a diagnostic.
- IDs, UTC timestamps, provenance, lifecycle state, and canonical QSO count are preserved.
- Read operations do not rewrite persisted data.
- A complete migrated document is schema-validated before atomic replacement.
- Migration fixtures cover POTA, SOTA, General, combined, malformed, interrupted, retry, update, and rollback cases.

### 6.2 Import and export

- A FieldOps-native bundle is the lossless backup and interchange representation.
- ADIF is a program-specific projection where upstream contracts require separate records or files.
- Generated projection records never enter canonical storage as additional QSOs.
- Export surfaces show canonical QSO totals separately from generated file and record counts.
- A native bundle restores canonical identity and associations on import.
- Generic ADIF lookalikes are not silently merged. Projected rows may be coalesced only with explicit FieldOps identity/manifest evidence or operator confirmation.
- POTA export is defined from current official rules and fixtures.
- SOTA export remains gated until its current official upload/interchange behavior is verified.
- No automatic spotting or submission is authorized.

## 7. Delivery slices

### 3.0-00 - Product contract and operating context

Record this scope, authority chain, legacy traceability, data ownership, operating-context contract, migration boundaries, risks, exclusions, and validation strategy. Add the required ADR/specification amendment before production implementation depends on the new context.

Acceptance: the V2.9.1 baseline is exact; every legacy V3.0 item is dispositioned; every new slice has an operator problem and acceptance gate; no production feature, schema, branch merge, deployment, or version change is implied by planning alone.

### 3.0-01 - Local-time weather and network identity

The weather service retains UTC timestamps and the presentation boundary formats them using an explicit timezone policy. Live/current-location weather defaults to the device IANA timezone. A remote planned location uses an explicitly retained target timezone when available; otherwise the UI visibly falls back to UTC. The operator may select device, UTC, or a named IANA timezone.

Agent network telemetry gains a backward-compatible nullable SSID. Connected Wi-Fi displays a safe SSID when available. Ethernet, unavailable SSID, disconnected state, missing telemetry, and stale telemetry remain distinct. BSSID and MAC addresses do not appear in the normal UI.

Acceptance: deterministic spring-forward, fall-back, repeated-hour, UTC-crossing, named-zone, and fallback tests pass; old Agent payloads remain readable; Windows SSID lookup cannot fail the full telemetry observation; header and diagnostics tests cover all fallbacks.

### 3.0-02 - Multi-entity activation and QSO logging

Implement activation/QSO schemas, migrations, entity inheritance, post-log editing, WSJT-X routing, progress/review, native interchange, and approved program projections.

Acceptance: migrations preserve IDs and canonical counts; combined POTA/SOTA operation works; WSJT-X QSOs inherit the exact active default set; editing does not duplicate a QSO; native export/import round-trips; approved program projections pass fixtures; legacy SmartLog cannot bypass canonical storage.

### 3.0-03 - Visual system and field themes

Introduce semantic surface, text, border, focus, accent, information, success, warning, danger, stale, and unavailable tokens. Provide independent day, night, and red-light palettes and migrate components in bounded groups.

Acceptance: normal text, large text, controls, and focus states meet the approved contrast targets in all themes; meaning is not conveyed by color alone; touch targets are at least 44 pixels; CF-20 landscape, sunlight, reduced motion, keyboard, and print checks pass.

### 3.0-04 - Maidenhead and location workspace

Create one strict shared domain implementation for 4-, 6-, and 8-character locators, representative center coordinates, cell bounds, distance, initial bearing, and copy behavior. Migrate existing consumers away from generic duplicate helpers.

Acceptance: conversion works offline; invalid lengths and characters are rejected; canonical casing, boundary, antimeridian, cell-center, cell-bounds, and precision round-trip tests pass; the UI explains that decoded coordinates represent a cell center rather than a measured fix.

### 3.0-05 - Duration-aware propagation

Build on the accepted start, midpoint, and end P.533 samples. Show per-band conditions and transitions without presenting interpolation or a representative sample as truth for the full operating window.

Acceptance: samples remain distinct; source, model, inputs, age, completeness, and confidence are visible; observed evidence is compared only when its location/time/band/mode applicability overlaps; deterministic plain-language agreement and conflict explanations pass tests.

### 3.0-06 - Explainable SmartFrequency

Build a deterministic, versioned ranking pipeline over the accepted V2.9 evidence families. Suggestions expose supporting evidence, conflicts, missing/stale inputs, source, age, limitations, and categorical confidence based on completeness and consistency.

Acceptance: evidence families never collapse into an unattributed score; missing occupancy evidence is not called clear spectrum; digital activity references remain distinct from SSB occupancy; no CAT, PTT, tuning, transmit, spotting, or submission path exists.

### 3.0-07 - Diagnostics, bounded history, and integration decisions

Retain sanitized configuration-change metadata, telemetry transitions, launch outcomes, update/rollback events, provider failures, and stale/unavailable transitions in a bounded local history. Produce explicit go/no-go/defer decisions for candidate integrations.

Acceptance: retention is bounded by count, age, and size; restart, rotation, corrupt-tail, interrupted-write, redaction, and offline-export tests pass; default exports exclude secrets, raw messages, launch arguments, BSSID/MAC, exact coordinates, IPs, usernames, and sensitive paths.

### 3.0-08 - Workflow consolidation and punch-list closure

Apply one operating context and one canonical workflow across PLAN, PREPARE, OPERATE, REVIEW, logging, weather, propagation, and application launching. Retire or redirect the legacy in-memory SmartLog and duplicated or stale advisory surfaces.

Acceptance: no user-facing workflow bypasses canonical activation/QSO storage; completed Review remains read-only; each V3.0 candidate and punch-list item has an evidence-backed disposition; offline and unavailable behavior remains truthful.

### 3.0-09 - Automated integration, CF-20 acceptance, and release closure

Run the broad application, Agent, Tray, updater, metadata, migration, build, offline, recovery, update/rollback, and hardware gates.

Acceptance: the supported update path preserves V2.9.1 data and V3.0 migrations; rollback behavior is recorded; the CF-20 passes touch, sunlight, night/red-light, network, GNSS, weather, logging, WSJT-X coexistence, offline, restart, and recovery scenarios; release metadata and artifacts are verified before any tag or publication decision.

## 8. Dependency order

1. `3.0-00` establishes authority, contracts, and ownership.
2. `3.0-01` and `3.0-04` prove context-boundary and location-domain changes with no persisted activation migration.
3. `3.0-02` introduces the principal persisted-domain migration after official interchange gates close.
4. `3.0-03` applies the new visual system after the multi-entity interaction model is stable.
5. `3.0-05` consumes stable time, location, entity, and QSO applicability.
6. `3.0-06` consumes stable propagation and evidence applicability.
7. `3.0-07` finalizes event producers and integration decisions.
8. `3.0-08` consolidates the complete workflow.
9. `3.0-09` closes automated, recovery, and hardware acceptance.

## 9. Initial field-test candidate

The first V3.0 field candidate is deliberately smaller than the final release. It targets operator deployment on 2026-09-17 for field use beginning 2026-09-18.

Included:

- accepted `3.0-00` planning and architecture traceability;
- weather UTC transport and explicitly labeled local-time presentation;
- deterministic DST regression coverage;
- nullable SSID Agent contract and truthful header fallbacks;
- shared 4/6/8-character Maidenhead domain and offline workspace;
- focused and broad automated integration gates;
- a CF-20 deployment and field-observation checklist.

Not included merely to meet the date:

- persisted multi-entity migration;
- program-specific POTA/SOTA export changes;
- broad theme migration;
- propagation or SmartFrequency changes;
- diagnostic-history persistence;
- direct third-party integration.

The target may expand only when all committed candidate items have closed with passing tests and the added item can be removed without migration or rollback ambiguity. The candidate is not a V3.0 release tag and does not close any later slice.

## 10. Initial candidate work sequence

| Target | Work | Exit condition |
| --- | --- | --- |
| 2026-09-14 | `3.0-00` contract and traceability | Documentation, metadata checks, and diff review pass. |
| 2026-09-15 | Weather/time vertical slice | Contract, UI, deterministic timezone/DST tests, typecheck, and focused tests pass. |
| 2026-09-16 | SSID vertical slice | Backward-compatible Agent/wire/UI behavior and focused Windows/unit tests pass. |
| 2026-09-17 | Maidenhead workspace and integration candidate | Shared domain, UI, focused tests, full application suite, build, metadata, and deployment package pass. |
| 2026-09-18 onward | CF-20 field evaluation | Findings are recorded as evidence; no release closure is inferred. |

If a committed item misses its gate, scope is reduced rather than bypassing tests, migration safety, or truthful unavailable behavior.

## 11. Regression risks and required controls

| Risk | Required control |
| --- | --- |
| Activation/QSO count inflation | One canonical QSO, projection-only expansion, native round-trip identity, migration fixtures. |
| Migration data loss | Full validation, atomic writes, preserved source, restart/update/rollback fixtures. |
| WSJT-X association race | Snapshot active defaults at QSO creation and test lifecycle boundaries. |
| Weather timezone or cache corruption | Cache UTC only; format at presentation; deterministic IANA/DST cases. |
| Agent/UI version skew | Optional wire fields and explicit missing-telemetry fallback. |
| WLAN lookup destabilizes telemetry | Per-interface failure isolation and nullable SSID. |
| Maidenhead boundary behavior changes downstream results | One shared implementation, golden boundary fixtures, and consumer migration tests. |
| Theme migration obscures status or harms sunlight use | Semantic tokens, independent contrast matrix, incremental component conversion. |
| Propagation or SmartFrequency overstates certainty | Evidence separation, applicability checks, categorical confidence, visible limitations. |
| Diagnostic disclosure or disk growth | Allowlisted events, redaction, hard retention bounds, corrupt-tail recovery. |
| Update/rollback breaks V2.9.1 data | Production-shaped upgrade and rollback fixtures plus CF-20 evidence. |

## 12. Explicit exclusions

V3.0 does not authorize:

- CAT, PTT, tuning, or direct radio control;
- unattended transmit behavior;
- automatic POTA/SOTA spotting or submission;
- arbitrary third-party software installation;
- cloud accounts or remote administration;
- a generalized provider framework without a concrete use case;
- treating AI output as emergency, regulatory, propagation, or equipment-safety truth;
- fixing defects belonging to external radios or applications.

An integration, recommendation, or application record does not weaken these exclusions.

## 13. Release governance

- Every pull request identifies its V3.0 slice and accepted baseline.
- Every slice includes tests, operator-visible failure behavior, diagnostics appropriate to its scope, and documentation.
- Field-candidate deployment and final release authorization are separate decisions.
- V2.9.1 remains the recovery baseline until V3.0 release closure is independently accepted.
- No tag, release publication, production deployment, or automatic submission follows from implementation completion alone.
