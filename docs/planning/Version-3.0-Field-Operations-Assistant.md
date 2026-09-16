# Version 3.0 — Field Operations Assistant

- Status: **Approved planning contract; implementation not authorized by this document**
- Baseline: `v2.9.1` / `7e67ed7a1820ce5fa11b57b89cf33808fb07aa3c`
- Supported deployment: one operator on one locally operated Windows Panasonic ToughBook CF-20
- Product version targeted at release closure: **3.0.0**
- Planning slice: **V3.0-00**
- Last updated: **2026-09-14**

## 1. Purpose and authority

Version 3.0 turns the accepted Dashboard, Activation workspace, App Catalog, SmartDeploy briefs, evidence sources, Windows telemetry, and QSO logging into a cohesive Field Operations Assistant for one operator using one local field computer.

This is the authoritative V3.0 scope, architecture, sequencing, migration, and acceptance contract. It reconciles the approved 2026 rebaseline, accepted architecture decisions, the completed V2.9 contract and punch-list handoffs, historical roadmap and backlog documents, and current field corrections.

This document authorizes planning only. It does not authorize production implementation, merge, deployment, updater execution, reboot, native-artifact publication, tag creation, or GitHub release publication. Each implementation slice requires a bounded branch and approval. Irreversible release and CF-20 actions require separate explicit authorization.

## 2. Governing precedence

When sources conflict, use this order:

1. This approved V3.0 contract and later accepted V3.0 ADRs.
2. The 2026 Project Rebaseline and ADR-007.
3. Later accepted architecture decisions, including ADR-002, ADR-006, ADR-008, ADR-010, and ADR-012.
4. Accepted V2.9 planning and validation records.
5. Current focused architecture documents for telemetry, Windows telemetry, propagation orchestration, and offline P.533 assets.
6. Historical architecture, roadmap, and engineering-backlog DOCX documents.

Historical backlog entries do not reopen completed V2.3–V2.9 behavior. A completed feature may be changed only for an approved V3.0 requirement or a new reproducible defect.

## 3. Accepted V2.9.1 baseline

The V3.0 source baseline is commit `7e67ed7a1820ce5fa11b57b89cf33808fb07aa3c`, tagged `v2.9.1`. Canonical product metadata reports `2.9.1` and release name `Deployment Identity and Rollback Safety`.

V2.9.1 accepted behavior includes:

- source/native revision parity and runtime-bundle identity;
- running-Dashboard update, readiness, rollback, and listener ownership;
- Agent and Tray startup/restoration;
- persistent operator configuration;
- persistent App Catalog configuration and truthful discovery/availability;
- retained SmartDeploy briefs, forecasts, notes, and checklists;
- Activation PLAN, PREPARE, OPERATE, and REVIEW;
- manual and WSJT-X QSO capture with conservative duplicate suppression;
- offline P.533 modeled guidance;
- source, freshness, provenance, unavailable, stale, and error semantics.

V2.9.1 reports 1,256 application tests, 481 .NET tests, and 139 Pester tests passing. Those totals are historical V2.9.1 evidence, not predicted V3.0 totals.

Before any V3.0 implementation branch begins, the local worktree must be checked for exact `main`/`origin/main` parity, tag state, worktree cleanliness, and preservation of the protected untracked `.github/agents/fieldops-implementation.agent.md` file.

## 4. Product boundary

The supported product remains:

- one operator;
- one local Windows field computer;
- React touch-oriented dashboard;
- local Express browser-facing backend;
- .NET Agent for Windows hardware and operating-system telemetry;
- interactive Tray for application launching and its existing privileged boundary;
- loopback-only authenticated Agent communication;
- offline-capable operation with truthful degradation.

The operational flow is:

```text
Equipment inventory
        ↓
Reusable field loadout
        ↓
Mission and activation context
        ↓
Weather, propagation, location, and observed evidence
        ↓
Equipment/deployment analysis and explainable guidance
        ↓
SmartDeploy operations brief
        ↓
Active POTA/SOTA/general operation
        ↓
Multi-entity QSO logging
        ↓
Retained review and diagnostics
```

The existing Activation remains the lifecycle root. V3.0 must not introduce a competing generalized Mission framework. “Mission context” is the minimum shared, versioned context needed by multiple implemented V3.0 capabilities and is associated with an Activation and retained SmartDeploy evidence.

## 5. Architectural invariants

1. Express owns browser-facing external-data integration, local configuration, persistence coordination, and constrained Agent access.
2. The Agent owns Windows telemetry, including connected Wi-Fi SSID acquisition.
3. The Tray retains its existing interactive-session and launcher ownership.
4. Browser code never receives or stores reusable Agent credentials.
5. Agent communication remains loopback-only and authenticated.
6. Live, cached, stale, unavailable, error, manual, modeled, inferred, deterministic, and observed information remain distinct.
7. Missing information remains nullable or unavailable; FieldOps never fabricates network identity, location, weather, frequency, propagation, equipment capability, endurance, installation state, or operational status.
8. Infrastructure is generalized only when two implemented capabilities require it or a current acceptance requirement cannot otherwise be met.
9. V3.0 preserves existing V2.9.1 operator data through migration.
10. FieldOps provides decision support; it does not independently operate a radio.

## 6. Shared operating context

The minimum shared operating context must be versioned and capable of representing:

- Activation identity and lifecycle state;
- one current operating location with provenance;
- a separate planning target/location with provenance;
- zero or more POTA/SOTA activation entities;
- General operation with no program entity;
- planned mission start and end;
- actual operation start and end;
- selected station/loadout reference and retained snapshot;
- allowed or intended modes;
- intended power;
- current confirmed TX context where available;
- weather/hazard, space-weather, propagation, and SmartFrequency evidence references;
- active entity set used for new QSO associations;
- retained review and diagnostic references.

The shared contract must reference authoritative domain records rather than copy every field into a universal object. Each datum has one authoritative home. Retained briefs and completed operations may store immutable snapshots where history must survive later edits.

## 7. Multi-entity operation and QSO contract

### 7.1 Entity model

An operation may contain:

- multiple normalized POTA park references;
- multiple normalized SOTA summit references where operationally valid;
- both POTA and SOTA references;
- no program reference for General operation.

Entity records require stable IDs, program, normalized reference, operator-visible label where known, provenance, and lifecycle timestamps. Provider access is not required for manual entry.

### 7.2 Canonical QSO identity

One over-the-air contact is one canonical QSO. Program associations are credit/context associations and do not create additional QSO records.

The QSO fingerprint and WSJT-X duplicate-suppression identity must remain based on contact facts, not the ordering or number of associated activation entities. Editing entity associations must not duplicate the QSO or alter unrelated contact facts.

Manual and WSJT-X-created QSOs inherit a snapshot of the active entity set. Associations remain editable after capture.

### 7.3 Legacy migration

V2.9.1 Activation `type/reference` and QSO `potaRef/sotaRef` fields must migrate deterministically into the multi-entity representation. Migration must be idempotent, order-normalized, duplicate-free, and capable of reading retained historical records.

Legacy compatibility fields may remain as projections during transition but must not remain competing write authorities.

### 7.4 Import/export

Import must merge compatible entity associations without multiplying a canonical QSO. Export behavior must be finalized only after current official ADIF and program-specific requirements are documented.

POTA and SOTA machine APIs remain outside this local entity capability. Multi-entity logging does not imply spotting, submission, or provider synchronization.

## 8. Equipment inventory and loadouts

Inventory is a separate domain from the App Catalog. Software launch records must not be repurposed as equipment records.

Initial equipment types may include radios, amplifiers, antennas, tuners, batteries/power systems, computers/interfaces, and operationally useful cables/adapters. Records require:

- stable IDs;
- schema version;
- operator-entered type and label;
- optional make/model;
- bounded structured facts supported by current use cases;
- operator-entered limitations and notes;
- created/updated timestamps;
- active/deleted state;
- explicit restore behavior.

Unknown capability values remain unknown. The first implementation does not claim a universal equipment database and performs no automatic hardware discovery.

A reusable loadout contains stable component references plus operator configuration and notes. An Activation/brief stores both loadout identity and an immutable mission-time snapshot so later inventory edits do not rewrite historical operations.

Deletion must not destroy retained history. A record referenced by a retained operation is tombstoned or hidden from new selection while historical snapshots remain readable.

## 9. Persistence, migration, corruption, and rollback

V3.0 persistence remains local and versioned. Migration work must precede UI write paths.

Required migration properties:

- representative real V2.9.1 fixtures;
- additive or copy-on-write migration where practical;
- pre-migration backup and digest;
- deterministic and idempotent transformations;
- malformed and unsupported-newer-schema failure states;
- no silent fallback from corrupt current data to unrelated legacy data;
- preservation of configuration, catalog, briefs, notes, checklists, Activations, QSOs, and operational-intelligence records;
- documented expected file/schema changes;
- restart survival;
- rollback plan distinct from executable rollback.

Rollback acceptance must state whether V2.9.1 is restored with the exact pre-migration data snapshot or whether forward-written V3 records are quarantined. V2.9.1 must not be allowed to overwrite migrated-only data silently.

## 10. Six-hour weather time contract

Provider timestamps remain UTC internally. The server must return machine-readable UTC timestamps and must not preformat UTC hours as operator-local labels.

Presentation defaults to the Windows/browser operator timezone and must:

- use an IANA timezone identifier where available;
- respect daylight-saving transitions;
- label or disclose the selected timezone;
- never append `Z` to a local value;
- never label UTC as local;
- preserve cached, stale, unavailable, and provider-error truth.

Remote planning-target weather remains operator-local by default. A target-local view is optional and requires an explicit, attributable timezone source and visible label; it must never be silently inferred from longitude alone.

Deterministic tests must set explicit timezones and cover America/New_York standard time, daylight time, DST boundaries, invalid/missing timezone, and host-timezone independence. Provider acquisition must not change unless reproduction proves provider data is incorrect.

## 11. Wi-Fi SSID telemetry contract

The Agent acquires connected SSID through a supported Windows WLAN/native API behind an injectable adapter. Localized command-line parsing is not the preferred production path.

Network telemetry gains an optional nullable SSID while retaining independent:

- interface name;
- description;
- adapter type;
- IPv4 address;
- link speed;
- operational state.

SSID is observed runtime evidence, not inferred from interface description and not retained as unnecessary history. Normal presentation excludes BSSID and MAC addresses.

Header behavior:

- connected Wi-Fi with SSID: show SSID;
- connected Wi-Fi without readable SSID: show truthful generic Wi-Fi;
- connected Ethernet: show an appropriate Ethernet/interface label;
- no connected interface: show Disconnected;
- telemetry failure or absence: show Unavailable.

Technical adapter type such as `Wireless80211` remains available in diagnostics.

## 12. Maidenhead and location utility contract

One shared TypeScript location module owns:

- latitude/longitude to 4-, 6-, and 8-character Maidenhead;
- normalization and validation;
- Maidenhead to representative center coordinates;
- precision/center-point descriptions;
- distance and initial bearing using existing geography functions.

The utility works offline and must not mutate GNSS, manual operating location, planned location, SmartDeploy, or Activation state unless the operator performs a separately labeled apply action approved in a later slice.

Tests cover known references, both hemispheres, equator/prime meridian, antimeridian and pole-adjacent boundaries, half-open geographic limits, normalization, mixed case, invalid lengths/characters, center precision, and copyable output.

The Agent/PowerShell GNSS implementation may remain native, but shared cross-language reference vectors must prevent calculation drift.

## 13. Semantic visual system

V3.0 establishes semantic tokens before component migration.

Required token families include:

- canvas and surface levels;
- primary/secondary/muted text;
- ordinary/subtle/strong borders;
- primary and secondary actions;
- focus ring;
- hover, active, selected, and disabled states;
- success/healthy;
- caution/stale;
- error/danger/destructive;
- informational;
- live/cached/modeled/manual/observed/unknown evidence where color is useful.

Day mode uses warm light-neutral/sandstone surfaces, charcoal text, and restrained copper/amber accents. Night mode uses near-black/charcoal surfaces, warm muted amber accents, and limited cool steel.

Green is mainly success/healthy; red is error/danger/destructive; amber is caution/stale; blue is informational; ordinary controls are neutral. Status must not depend on color alone.

The visual pass covers hierarchy, typography, spacing, nested-card reduction, touch targets, CF-20 landscape layout, sunlight readability, night glare, dense views, freshness/timestamp consistency, keyboard/focus behavior, contrast, and color-blind accessibility.

Red-light mode is conditional. It ships only if brought under the token system and independently validated without compromising day/night acceptance. No global color search-and-replace is permitted.

## 14. Duration-aware propagation

Existing start/midpoint/end samples are representative samples, not continuous prediction.

V3.0 must define:

- deterministic mission-window sampling;
- bounded maximum sample count and cadence;
- explicit start, midpoint, end, and intervening sample identity;
- band transitions over time;
- model identity, source age, confidence/limitations, and input availability;
- comparison with current or observed RF without conflation;
- explicit disagreement explanation;
- offline behavior when model inputs are unavailable.

The UI must describe sampled modeled guidance accurately. “True path prediction” is prohibited unless separately defined, implemented, and validated. Local/NVIS requires a separate evaluator decision and must not be approximated by unsupported P.533 output.

## 15. Resource-aware mission reasoning

Guidance may combine only available structured inputs:

- inventory facts;
- loadout snapshot;
- operator preferences;
- mission window and location;
- intended power/modes;
- weather and hazard evidence;
- space-weather evidence;
- modeled propagation;
- observed RF;
- retained QSO results.

Each finding names its basis, source/status, limitations, and conditions that would change the conclusion. Unknown facts remain visible.

Committed reasoning is deterministic and explainable. Optional AI may render or summarize already structured findings only after a separate decision. AI must not fill missing safety, regulatory, equipment, weather, propagation, frequency, or endurance facts.

FieldOps does not independently select a frequency, guarantee a path, assert that spectrum is clear, or control the radio.

## 16. SmartFrequency and integration decision tracks

Every candidate receives a documented disposition during V3.0, but implementation requires a concrete approved workflow.

| Candidate | Required V3.0 disposition |
| --- | --- |
| Explainable SmartFrequency | Decide whether evidence supports bounded suggestions without clear-frequency claims |
| Local/NVIS | Define separate evaluator or defer |
| True path prediction | Define/research or defer; P.533 is not automatically true path prediction |
| APRS | Evaluate one read-only workflow |
| Direwolf | Evaluate a concrete TNC/packet protocol use case |
| Meshtastic | Evaluate supported interfaces and field value |
| Winlink | Evaluate bounded message/status workflow |
| DigiPi | Evaluate a concrete local protocol |
| WSPR | Research evidence semantics and disposition |
| LoTW/Club Log/eQSL | Research auth, terms, duplication, retention, and approval |
| Contest/award tracking | Decide whether it belongs in FieldOps |
| Automatic recommendations | Require evidence and operator-trust design |
| Diagnostic history/export | Implement only bounded local evidence needed for current operation |
| External equipment-data enrichment | Research approved sources, terms, model matching, provenance, caching, conflicts, and operator-confirmed import; defer implementation |

ADR-012 remains controlling: POTA machine-API support is unconfirmed and SOTA access is blocked without explicit approval and authorization.

## 17. Committed, conditional, deferred, and excluded scope

### Committed for V3.0

- this authoritative contract and active-document reconciliation;
- shared operating context;
- safe versioned migration;
- weather timezone correction;
- Agent-owned SSID telemetry;
- semantic day/night visual system;
- standalone Maidenhead calculator;
- multi-entity POTA/SOTA/general operations and QSO associations;
- safe WSJT-X inheritance and import/export behavior;
- persistent inventory and reusable loadouts;
- mission-time loadout snapshots;
- duration-aware propagation;
- deterministic explainable mission guidance;
- automated and CF-20 acceptance;
- documentation and release closure.

### Conditional after research and approval

- red-light mode;
- optional AI explanation;
- bounded SmartFrequency suggestions;
- Local/NVIS evaluator;
- diagnostic history/export beyond immediate acceptance needs;
- any concrete APRS, Direwolf, Meshtastic, Winlink, DigiPi, WSPR, or logbook integration.

### Deferred by default

- true path prediction;
- automatic frequency recommendations;
- external logbook synchronization;
- contest scoring and award tracking;
- provider integration without confirmed terms and authorization.

### Explicitly excluded without separate approval

- CAT, PTT, transmit control, tuning, unattended transmitting;
- automatic spotting or POTA/SOTA submission;
- arbitrary third-party installation or shell execution;
- generalized provider/plugin platforms;
- cloud accounts, remote administration, fleet or multi-user enterprise operation;
- centralized policy and broad privileged APIs;
- continuous NTP/PPS steering;
- code-signing or enterprise-installer expansion unless distribution requires it.

## 18. Slice sequence

### V3.0-00 — Scope and architecture reconciliation

Create this contract, inventory handoffs, verify baseline claims, and reconcile factual README/documentation drift. No production-code changes.

### V3.0-01 — Domain and ADR contracts

Define pure operating-context, entity, QSO-association, inventory, loadout, snapshot, schema, and rollback contracts. Add ADRs where ownership is not already decided.

### V3.0-02 — Migration implementation

Implement representative V2.9.1 migrations, backups, hashing, idempotence, corruption handling, compatibility reads, and rollback-data behavior before new UI write paths.

### V3.0-03 — Field correctness

Correct six-hour weather presentation and implement Agent-owned SSID observation and header states. Validate both on the CF-20.

### V3.0-04 — Visual system and themes

Establish tokens, migrate components deliberately, redesign day/night, and perform accessibility and CF-20 review. Red-light remains conditional.

### V3.0-05 — Maidenhead/location workspace

Extract the shared implementation, add 4/6/8-character and center conversion, add the standalone offline calculator, and preserve location-state isolation.

### V3.0-06 — Multi-entity operations and logging

Implement entity management, active entity sets, QSO association editing, WSJT-X inheritance, ADIF import/export, migration projections, and duplicate prevention.

### V3.0-07 — Inventory and loadouts

Implement versioned inventory, delete/restore, reusable loadouts, Activation/brief association, and immutable retained snapshots.

Implementation disposition: the inventory and reusable-loadout stores are operator-managed and local. SmartDeploy may optionally select one active loadout; the Express backend resolves it and freezes the loadout plus referenced equipment facts into the retained brief. An Activation opened from that brief receives the same immutable snapshot. Historical briefs and Activations without a loadout remain valid, and unavailable or deleted loadouts block snapshot creation rather than producing invented evidence.

### V3.0-08 — Workflow context consolidation

Carry one authoritative mission/operation context through PLAN, PREPARE, OPERATE, and REVIEW; remove duplicate primary data entry without creating a universal framework.

### V3.0-09 — Mission reasoning and duration-aware propagation

Implement sampled mission-window presentation and bounded deterministic equipment, power, weather, antenna/deployment, contingency, and limitation findings.

### V3.0-10 — SmartFrequency and integration decisions

Complete the decision matrix. Implement only separately approved concrete capabilities.

### V3.0-11 — Workflow and punch-list closure

Review the complete workflow, remove internal terminology from primary UI, confirm authoritative data homes, finish documentation, and disposition all unresolved items.

### V3.0-12 — Integration, CF-20 acceptance, and release closure

Run the complete automated gate, migrate real V2.9.1 data, verify update and rollback, complete reboot/sign-in field acceptance, and prepare release closure. Publication remains separately authorized.

## 19. Dependencies

- V3.0-01 precedes all schema and UI work.
- V3.0-02 precedes production writes for multi-entity records, inventory, and loadouts.
- V3.0-03 may proceed after its focused telemetry/time contracts are accepted.
- V3.0-04 tokens precede broad UI restyling in later slices.
- V3.0-05 provides shared location utilities consumed by later workflow consolidation.
- V3.0-06 and V3.0-07 depend on migration acceptance.
- V3.0-08 depends on stable entity and loadout contracts.
- V3.0-09 depends on operating context, loadout snapshots, and evidence contracts.
- V3.0-10 cannot weaken ADR-012 or authorize integrations by implication.
- V3.0-12 follows every committed slice and closure disposition.

## 20. Per-slice working rules

- One bounded feature slice per branch and PR.
- No unrelated cleanup.
- Draft PR until scoped validation passes.
- Write boundary/failing regression before correction where practical.
- Use focused validation during a slice and the full suite only at integration/release gates.
- Record exact results; never invent totals.
- A timeout alone is not failure. Inspect the existing process and output artifact before rerunning.
- Never silently rerun a completed gate.
- Preserve `.github/agents/fieldops-implementation.agent.md`.
- Do not deploy, reboot, merge, tag, publish, or release without explicit approval.

## 21. Automated release gate

Capture durable reports and exact totals for:

- `npm run metadata:check`;
- `npm run typecheck`;
- `npm run build`;
- four sequential Vitest shards with `--maxWorkers=1`;
- complete `.NET Agent` solution tests;
- complete Windows PowerShell Pester suite using the repository-supported version;
- `git diff --check`;
- representative V2.9.1 migration and rollback-data tests;
- offline tests;
- live/cached/stale/unavailable/error tests;
- theme-specific UI and accessibility tests;
- timezone, DST, and host-timezone-independent weather tests;
- SSID connected/unavailable/disconnected tests;
- Maidenhead known-reference and boundary tests;
- multi-entity association, deduplication, import, and export tests;
- updater activation, readiness, rollback, and listener-ownership tests.

## 22. CF-20 field acceptance

Before release, verify:

- upgrade from the accepted V2.9.1 installation;
- pre-migration backup and hash;
- documented migration changes;
- preserved configuration, App Catalog, Activations, briefs, notes, checklists, QSOs, and operational evidence;
- inventory, loadouts, and multi-entity records surviving restart;
- successful running-Dashboard update;
- exactly one Dashboard listener on port 3000;
- source/native parity and runtime-bundle hash;
- Agent Running/Automatic;
- exactly one interactive Tray;
- actual connected Wi-Fi SSID and Ethernet/unavailable fallbacks;
- operator-local six-hour weather and DST behavior;
- offline Maidenhead reference calculations;
- readable day/night themes under field conditions;
- duplicate-free multi-entity manual and WSJT-X logging;
- rollback to the previous installation and defined previous data state;
- reboot/sign-in restoration of Dashboard, Agent, and Tray.

If reboot or sign-out/sign-in is required, the operator must be told plainly before that step.

## 23. Documentation and release identity

Before V3.0 release, reconcile:

- active README and badges;
- documentation index;
- changelog;
- canonical product metadata and generated projections;
- package and lock metadata;
- web manifest/service-worker identity;
- deployment guides;
- release closure and acceptance records.

The current README’s V2.8 badge and V2.9.0 release-candidate wording are factual drift and must be corrected without claiming V3.0 before release approval.

## 24. Release procedure and authorization

After all implementation and acceptance work is merged:

1. Create the final V3.0 release-closure record.
2. Update all active release claims to `3.0.0`.
3. Confirm `main` and `origin/main` at the exact approved commit.
4. Build/publish the immutable native artifact for that exact source revision.
5. Verify asset name, size, digest, target commit, and publication state.
6. Create annotated tag `v3.0.0` at that exact commit.
7. Publish the stable source release with approved notes.
8. Never attach a mismatched or independently rebuilt native artifact.
9. Deploy that exact revision to the CF-20.
10. Verify parity, migration, runtime identity, Agent, Tray, Dashboard, and reboot survival.
11. Record final field acceptance.

Automated success does not authorize merge, publication, tagging, deployment, reboot, or release. Each irreversible action requires explicit operator authorization.

## 25. Requirements traceability

Every V3.0 slice PR and final closure must map each committed requirement to:

- owning slice;
- implementation files;
- persistence/schema impact;
- focused automated evidence;
- CF-20 evidence where required;
- documentation output;
- final disposition: fixed, accepted, blocked, deferred, excluded, or future-authorized.

No unresolved requirement may disappear silently from the release record.
