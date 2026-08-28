# Version 2.7 - Connected Operations

- Status: Approved planning baseline; 2.7-01 through 2.7-03 accepted
- Baseline: Version 2.6.0 - Activation Operations
- Supported deployment: single operator on one locally operated Windows field computer
- Primary field target: ToughBook/ToughPad activation workflow

## Release objective

Evolve the Version 2.6 Activation Operations workspace from a durable manual activation record into a source-aware operating console that can understand current station state, consume live operating-software evidence, capture digital QSOs with provenance, and present observed RF activity alongside retained planning guidance without conflating those evidence classes.

Version 2.7 is the bridge between the completed PLAN -> PREPARE -> OPERATE -> REVIEW lifecycle and the future Version 3.0 Field Operations Assistant. It does not implement the complete Version 3.0 equipment/loadout/mission-reasoning model.

## Governing product rules

Version 2.7 follows the approved 2026 rebaseline and ADR-007:

1. Operator value outranks speculative framework work.
2. Missing integrations must degrade honestly and must not break manual operation.
3. Existing source, freshness, provenance, modeled, observed, retained, unavailable, and manual semantics remain authoritative.
4. The Express backend remains the browser-facing integration owner under ADR-006. The .NET Agent remains the local hardware and privileged-service boundary.
5. Architecture is generalized only when at least two real implemented capabilities require the abstraction or a release acceptance criterion cannot safely be met otherwise.
6. The activation workspace remains PLAN -> PREPARE -> OPERATE -> REVIEW. Version 2.7 enriches OPERATE rather than replacing the Version 2.6 lifecycle.
7. Offline/local operation remains useful when internet providers or optional radio applications are absent.

## Release boundary

Version 2.7 is **Connected Operations**.

It answers:

> What is my station actually doing now, what is being observed on the air around me, and how can FieldOps reduce duplicate operator entry while preserving a trustworthy activation record?

It deliberately does not yet answer the broader Version 3.0 question:

> Given my mission, equipment, location, expected conditions, power resources, and current field evidence, how should I conduct the operation?

## Approved slices

1. **2.7-01 - QSO Logger Operating Ergonomics**
2. **2.7-02 - Source-Aware Current Station State**
3. **2.7-03 - WSJT-X Read-Only Integration**
4. **2.7-04 - WSJT-X-Assisted QSO Capture**
5. **2.7-05 - Live Band Activity**
6. **2.7-06 - Integrated OPERATE Console**
7. **2.7-07 - Field Validation and Release Closure**

The sequence is intentional: logger vocabulary -> station-state contract -> first live software source -> QSO automation -> observed-RF presentation -> OPERATE consolidation -> real field validation.

---

## 2.7-01 - QSO Logger Operating Ergonomics

### Operator problem

Version 2.6 proves durable manual QSO logging, but repeated free-form band/mode/frequency entry is unnecessarily slow and error-prone during an activation.

### Scope

- Replace normal free-form band entry with a controlled amateur-band vocabulary while preserving valid imported ADIF values and compatibility.
- Replace normal free-form mode entry with a controlled operating-mode vocabulary and explicit mode/submode handling where required by the existing log model.
- Establish one shared canonical band/mode vocabulary suitable for later station-state and WSJT-X integration.
- Add conservative standard digital calling-frequency defaults for modes where a single conventional dial frequency is appropriate.
- Auto-populated frequency remains editable by the operator.
- Do not invent a default for modes such as SSB where no single operating frequency is authoritative.
- Clear or reconsider an auto-derived frequency when band/mode changes make the prior value inappropriate.
- Remember the current operating band/mode/frequency context within the active Activation so repeated contacts do not require redundant entry.
- Preserve manual QSO logging, edit/delete, duplicate detection, ADIF import, and ADIF export.
- Clarify SmartDeploy's Radio requirement in the form: either visibly mark it required and explain the validation condition, or narrow the requirement if modeling does not actually need a radio name/model. This is a UX/contract decision, not equipment inventory.

### Acceptance

- An operator can log a sequence of same-band/same-mode QSOs with materially less repeated entry.
- Selecting a supported digital band/mode pair may supply an editable conventional frequency.
- Changing to a combination without a defensible single default does not leave a misleading digital frequency behind.
- Manual override always wins.
- Imported/exported QSO semantics and Version 2.6 duplicate identity remain correct.
- No radio integration is required for the logger to remain fully usable.

### Acceptance evidence - 2026-08-27

- 2.7-01 was accepted after the CF-20 frequency-override correction; JS8 conventional-frequency defaults remain a non-blocking deferred enhancement.
- 2.7-02 adds a bounded manual Current Station State contract and compact OPERATE presentation. It is Activation-scoped, reconstructs from the active QSO Logger context, and clears or becomes unavailable when the Activation is changed or completed.
- Manual state uses `operatorUpdatedAtUtc` and `operator_set` freshness semantics. It does not claim radio, CAT, WSJT-X, hardware, or RF confirmation.
- The contract remains frontend/domain-owned for this manual-only producer. Express remains the browser-facing integration owner for later WSJT-X source ingestion under ADR-006; no new API, runtime, persistence store, or integration transport was added.

### Explicit non-goals

- CAT control
- automatic radio detection
- equipment inventory
- contest logging
- online callsign lookup

---

## 2.7-02 - Source-Aware Current Station State

### Operator problem

Later integrations need one truthful answer to "what does FieldOps currently know about the station's operating state?" without coupling the Activation model directly to WSJT-X, CAT, or any specific radio.

### Scope

Introduce a bounded current-station-state domain contract. Minimum candidate fields:

- band
- frequency
- mode
- submode where meaningful
- source
- observedAtUtc
- freshness/age
- status
- limitations/diagnostic context where needed

Initial source vocabulary should be no broader than real 2.7 consumers require. Expected first sources are `manual` and `wsjtx`. Future CAT/rigctld sources are reserved, not implemented merely to complete an abstraction.

### Semantics

- Current Station State is current operational evidence, not equipment inventory.
- Unknown values remain unknown.
- Stale source state must not be presented as live.
- A missing optional source must not make the Activation unusable.
- Manual logger context and observed software state may coexist; source precedence must be explicit rather than accidental.
- The contract must not claim radio control or direct hardware truth when the evidence comes only from an application such as WSJT-X.

### Implementation evidence - 2026-08-27

- 2.7-02 CF-20 acceptance is complete. Manual state remains Activation-scoped and is preserved as fallback context.
- 2.7-03 implements the bounded WSJT-X Status-message subset behind the Express backend. The browser polls a same-origin read route; it does not listen for UDP and no Agent/runtime/service was added.
- The listener targets the normal local WSJT-X UDP arrangement: `127.0.0.1:2237`. It is idempotently initialized once, tolerates WSJT-X absence, ignores malformed/unknown packets, and exposes unavailable state until a valid Status message arrives.
- Status observations are fresh for 10 seconds. This allows short packet gaps while preventing indefinite live presentation; older observations are returned as stale. The threshold is a bounded operational choice for periodic local Status traffic, not a claim about RF activity.
- Fresh WSJT-X state takes precedence during an ACTIVE Activation. Stale/unavailable WSJT-X state does not erase manual context, which is then presented when meaningful. Non-active Activations suppress current station presentation.
- Supported protocol fields are the WSJT-X header, client ID, dial frequency, and mode. Frequency is preserved in MHz, bands are conservatively derived from the shared amateur-band vocabulary, and unknown modes/bands remain source-faithful rather than being relabeled.
- WSJT-X state means application-reported operating context only; it is not CAT, direct radio, transmit, or RF confirmation. CAT, Hamlib, rigctld, QSO automation, PSKReporter, and later integrations remain deferred.

### CF-20 acceptance evidence - 2026-08-27

- Version 2.7-03 CF-20 hardware acceptance passed on a Panasonic ToughBook CF-20 Mk2 with WSJT-X v3.0.0-rc1. See [Version 2.7-03 WSJT-X CF-20 Field Acceptance](../validation/Version-2.7-03-WSJTX-CF20-Field-Acceptance-2026-08-27.md).
- Acceptance exposed that the original synthetic packets modeled the WSJT-X wire protocol incorrectly. Revision `a4726c847e2a29629ca8bff8812cb0e6fa92de6f` corrected the real 12-byte header, `quint32` message type, schema 2/3 compatibility, unsigned safe `quint64` frequency handling, nullable UTF-8/QByteArray semantics, and malformed/truncated packet handling.
- With WSJT-X configured for `127.0.0.1:2237` and UDP requests accepted, live endpoint evidence reported `20m / 14.074 MHz / FT8` with `source=wsjtx` and `freshness=fresh`. CURRENT STATION changed from retained manual `20m / SSB` to WSJT-X automatically, tracked WSJT-X context changes, and fell back to manual context after WSJT-X stopped and freshness expired.
- The acceptance proves WSJT-X application status only. It does not claim CAT, direct-radio, transmit, or RF confirmation. The broader 2.7-07 release gate remains open for its separate full-lifecycle, logged-QSO, observed-RF, GNSS/clock, offline, and REVIEW requirements.
- A same-session GNSS interruption is recorded as a hardware/driver/GNSS recovery observation, not as a 2.7-03 defect: COM6 opened but emitted no NMEA, Agent restart did not recover it, and a full ToughBook reboot restored GPS.

### Acceptance

- OPERATE can consume a single source-aware station-state representation without knowing WSJT-X protocol details.
- Manual state remains available when no integration is present.
- Source loss transitions honestly to stale/unavailable according to defined timing semantics.
- Tests prove that unknown/stale values are not silently promoted to live facts.

---

## 2.7-03 - WSJT-X Read-Only Integration

### Operator problem

During FT8/FT4 operation the operator already has authoritative operating context in WSJT-X. Re-entering that context into FieldOps adds friction and creates opportunities for mismatch.

### Architecture

The local Express backend owns the WSJT-X integration because it is the existing browser-facing integration owner. Do not add a third runtime process. Do not move general browser integration into the Windows Agent merely because the integration is local.

The first integration is observational/read-only. FieldOps must not transmit, command the radio, change WSJT-X frequency/mode, or modify WSJT-X configuration.

### Scope

- Implement the minimum local WSJT-X status receiver required to obtain useful current operating state.
- Bind/listen only as required for the local single-operator deployment; do not create LAN/remote scope by default.
- Expose source health and freshness to the backend/domain layer.
- Map supported WSJT-X evidence into Current Station State.
- Surface connected/not detected/stale/unavailable states honestly.
- Keep the integration optional and configurable enough to coexist with normal WSJT-X operation.
- Document any WSJT-X configuration the operator must perform.

### Acceptance

With WSJT-X running during a real digital session, FieldOps can display the current supported band/mode/frequency state with WSJT-X provenance and bounded freshness. Stopping/restarting WSJT-X or losing its messages does not crash the Dashboard and does not leave stale state labeled live.

### Explicit non-goals

- controlling WSJT-X
- CAT commands
- PTT
- transmit initiation
- decode/waterfall interpretation
- radio ownership
- Hamlib/rigctld integration

---

## 2.7-04 - WSJT-X-Assisted QSO Capture

### Operator problem

When WSJT-X has already logged a completed digital QSO, manually re-entering the same contact into the Activation log is duplicate work.

### Scope

- Consume the authoritative WSJT-X logged-QSO event rather than inferring contacts from decodes.
- When an Activation is ACTIVE, create an Activation-owned QSO from a supported logged-QSO event.
- Preserve source provenance such as `wsjtx` distinct from `manual` and `adif_import`.
- Reuse the existing Activation-owned QSO model and deterministic duplicate protections.
- Preserve UTC, callsign, band, frequency, mode/submode, reports, and other fields only when supplied and supported; do not invent missing values.
- Define behavior for events received while no Activation is active. Default direction: do not silently attach them to an unrelated Activation.
- Define operator-visible handling for rejected/duplicate/unsupported events without turning normal digital operation into alert spam.

### Acceptance

A completed WSJT-X QSO during an ACTIVE Activation appears in the FieldOps QSO log without manual re-entry, with correct provenance and without duplicate creation. Manual logging remains available before, during, and after WSJT-X connectivity loss.

### 2.7-04A - Logged QSO protocol and normalization implementation evidence

- 2.7-04A adds real-wire parsing for WSJT-X `QSO Logged` message type `5` under supported schemas `2` and `3`.
- The parser follows the authoritative `WSJTX/wsjtx` `Network/NetworkMessage.hpp` field table: header, UTF-8/QByteArray fields, `QDateTime` Date/Time Off and On values, unsigned `quint64` transmit frequency, and the complete message field sequence. Qt `QDateTime` decoding uses the documented Julian day, milliseconds-since-midnight, and UTC/offset timespec representation.
- The transient `WsjtxLoggedQsoCandidate` normalizes Date/Time On to canonical UTC, callsign using the existing QSO validation rule, frequency in MHz, conservative band derivation, source mode including FT8/FT4 and unknown values, supplied reports, DX grid, and supplied station/operator context. Source is `wsjtx`.
- The parser consumes but does not expose or persist WSJT-X power, comments, name, exchanges, or ADIF propagation mode because this slice does not widen the persistent QSO schema.
- Tests include builder-based packets and a fixed byte fixture independently derived from the upstream field table and Qt serialization documentation. Malformed, truncated, unsupported-schema, unknown-type, null, and invalid UTF-8 packets are rejected safely.

### 2.7-04B - Logged QSO routing and durable persistence evidence

- A valid normalized WSJT-X `QSO Logged` candidate is routed only when exactly one persisted Activation has status `active`; planned, completed, missing, or ambiguous active state is not silently attached to another Activation.
- The candidate is mapped into the existing Activation-owned QSO model with `source=wsjtx`, canonical UTC time, normalized callsign, band/frequency, mode, reports, grid, and supplied station/operator context. Manual and ADIF paths remain unchanged.
- Duplicate identity reuses `qsoFingerprint`: Activation, callsign, UTC contact time, band, frequency, mode, and submode. The check reads the file-backed store before creation, so repeated delivery and delivery after store reconstruction produce one retained QSO.
- Persistence is receive-only and local. The listener does not send WSJT-X commands, control CAT/PTT/radio state, infer contacts from decodes, or create an Activation. Persistence failures are contained so Status observation remains healthy.
- Focused tests cover active persistence and field mapping, no-active/planned/completed gating, same-process and reconstructed-store duplicates, and legitimate distinct contacts. Remaining 2.7-04C work is field acceptance and operator-visible handling of rejected/duplicate events; 2.7-05 remains out of scope.

### 2.7-04B CF-20 acceptance correction - 2026-08-27

- Initial CF-20 retest failed: a completed WSJT-X QSO did not appear in the mounted FieldOps QSO Logger, and automatic Status-follow was reported as unreliable during band changes. FT8 timing was also observed at approximately `-0.8` to `-1.4` seconds before repeated Windows/GNSS synchronization.
- Production-path tracing found that the listener handles Status and Logged QSO packets independently; a regression test proves `Status 20m -> Logged QSO -> Status 40m` leaves Current Station at `40m / FT8`. The initial failure therefore remains a field retest finding rather than evidence that the Logged QSO callback replaces Status state.
- The concrete display defect was mount-only QSO loading. The QSO Logger now refreshes its existing local API view every two seconds, so a server-persisted WSJT-X QSO appears without a page reload. The complete parser -> active router -> file persistence -> Status integration regression passes.
- Bounded diagnostics are available at `/api/wsjtx/diagnostics`; they report received packet count, accepted Status and Logged QSO counts, last Logged QSO time, and the bounded route result without retaining raw datagrams. This supports the next CF-20 retest distinction between receive, parse, route, persistence, and display.
- OPERATE now includes a compact Current Clock / Time Sync control that reuses the existing explicit GNSS UTC -> Windows synchronization API and confirmation requirement. Unknown or unavailable GNSS evidence cannot enable synchronization, and no continuous clock steering was added.
- 2.7-04B remains **not accepted** pending a fresh CF-20 retest. The timing observation does not establish that FieldOps caused clock drift. 2.7-04C and the broader 2.7-07 field gate remain open; 2.7-05 is not started.

### 2.7-04B live-state reliability and performance correction - 2026-08-27

- A follow-up CF-20 observation recorded approximately `17s` and `29s` band-change delays and approximately `84s` from FT8 to FT4, with the visible sequence `40m FT8 -> 20m SSB Manual -> 40m FT4`. Under the representative workload of Chrome + FieldOps Dashboard, FieldOps Agent/Tray, WSJT-X, and one diagnostic PowerShell window, this remains a failed acceptance result; no root cause is assigned to FieldOps before timing evidence is collected.
- The confirmed source-flap defect was in the browser path: a backend `stale` snapshot was converted to `null`, which immediately exposed retained Manual state. The OPERATE path now preserves stale WSJT-X state and falls back to Manual only after a bounded unavailable interval.
- Live-state policy is explicit: WSJT-X is `fresh` through 5 seconds, `stale` from more than 5 seconds through 30 seconds, and `unavailable` after 30 seconds. These values are implementation safeguards pending a fresh cadence measurement on WSJT-X v3.0.0-rc1; they are not a claim about the application's transmission cadence.
- `/api/wsjtx/current` and `/api/wsjtx/diagnostics` now send `Cache-Control: no-store`; browser polling requests the current snapshot with `cache: no-store`. Diagnostics include bounded packet-receive and Status-parse timestamps alongside existing counts, without retaining raw datagrams.
- Logged QSO routing is deferred to the next local event-loop turn after packet parsing. This preserves immediate Status observation and prevents synchronous file-backed QSO persistence from blocking the UDP callback. The persisted QSO path and interleaved Status regression remain covered by focused tests.
- The preliminary performance target for the next field retest is median live-state update latency at or below `3s`, with no ordinary update above `5s`, measured under the representative workload. 2.7-04 remains **not accepted** until a fresh CF-20 retest passes; 2.7-05 is not started.

### 2.7-04 CF-20 hardware acceptance corrections - 2026-08-28

- CF-20 acceptance remains **not accepted**: the deployed frontend required Ctrl+F5 before Time Sync and WSJT-X behavior appeared, observed WSJT-X updates remained approximately `6-8s` rather than the `1-3s` target and `<=5s` preliminary maximum, OPERATE synchronization improved approximately `-1.4s -> -0.5s` but did not match the proven Tray result, and a real WSJT-X Logged QSO did not appear in the FieldOps logger.
- Production HTML now uses `no-store`; fingerprinted `/assets/*` remain immutable. The service worker now uses network-first navigation with cached `index.html` only as offline fallback, so a restarted Dashboard can discover the new shell without a forced Ctrl+F5.
- WSJT-X OPERATE polling is now explicitly `1000ms` instead of `2000ms`; fresh/stale/unavailable thresholds and no-short-gap Manual fallback are unchanged. This is a timing correction pending measurement on hardware, not an acceptance claim.
- `/api/wsjtx/diagnostics` now includes packet-receive, Status-parse, Status-state-update, Logged QSO parse-failure, and bounded route/persistence result stages. No raw datagrams are retained.
- The repository's Tray source contains no Windows Time Sync command; OPERATE and the Dashboard clock route both invoke the same Agent `SynchronizeClock` pipe operation. No second synchronization algorithm was added, and the field-reported Tray-versus-OPERATE outcome remains unresolved pending retest with the actual deployed Tray control.

---

## 2.7-05 - Live Band Activity

### Operator problem

FieldOps already has PSKReporter-derived observed-RF infrastructure, but the Activation workflow does not yet turn that evidence into a useful live OPERATE view.

### Evidence contract

Observed RF remains observational digital reception-report evidence. It does not prove SSB usability, station-specific success, regional openness, confidence, or modeled propagation. A live source with zero matching reports is not the same as an unavailable source.

### Scope

- Reuse the existing observed-RF/PSKReporter foundation and its cache/freshness semantics.
- Present recent digital activity in a compact operator-oriented view, initially by band and useful bounded geographic/path context supported by the existing evidence.
- Keep counts/activity and source freshness visible enough to avoid qualitative overclaiming.
- Integrate the view into active-operation context without changing P.533 or retained SmartDeploy evidence.
- Preserve offline behavior: retained/model evidence remains available while live observed RF becomes unavailable/stale according to its own semantics.

### Acceptance

OPERATE can show truthful recent observed digital activity when available, including valid zero-report states, and clearly distinguish it from modeled propagation and from the station's actual current operating state.

---

## 2.7-06 - Integrated OPERATE Console

### Operator problem

Version 2.6 OPERATE correctly prioritizes the QSO Logger and Activation Notes, but it does not yet provide a compact operational picture of the station and surrounding RF evidence.

### Scope

Consolidate the completed 2.7 capabilities into OPERATE without returning to the pre-2.6 stacked-workspace problem.

The primary OPERATE surface should answer, at a glance:

- What Activation is active?
- What band/mode/frequency does FieldOps currently know?
- What source supplied that station state and how fresh is it?
- How many QSOs have been logged?
- What recent observed digital activity is available?
- What retained planned/model guidance is relevant as context?
- Where are the logger and quick notes controls?

Maintain three independent evidence classes:

1. **Planned/modeled** - retained SmartDeploy/P.533 guidance.
2. **Observed RF** - recent PSKReporter-derived digital reception evidence.
3. **Actual station state** - manual or WSJT-X-derived current operating context.

Do not collapse these into a synthetic confidence score or imply causality.

### REVIEW impact

REVIEW may summarize source-backed operating facts that were actually retained with the Activation/QSOs, but Version 2.7 must not silently turn ephemeral live station state into historical truth. Any additional retained operating-state history requires an explicit bounded persistence decision and tests.

### Acceptance

The active operator can work primarily from OPERATE without bouncing among FieldOps screens for logger, current station context, live observed RF, and retained plan context. Optional-source failures remain secondary and do not obstruct logging or ending the Activation.

---

## 2.7-07 - Field Validation and Release Closure

### Required validation

Version 2.7 requires real field or representative-radio validation, not browser-only acceptance.

At minimum validate one real digital operating session with:

- FieldOps Agent and Dashboard running on the primary Windows field computer;
- GNSS active and clock readiness behaving according to the Version 2.6 contract;
- a SmartDeploy Activation progressing through PLAN/PREPARE/OPERATE/REVIEW;
- WSJT-X connected to an actual radio for FT8 or FT4;
- Current Station State updating from real WSJT-X evidence;
- at least one actual or controlled logged-QSO event captured into the active Activation;
- manual QSO logging still usable;
- observed-RF activity presented when network evidence is available;
- WSJT-X stop/restart or message loss producing honest state transitions;
- internet loss/unavailability not breaking local Activation operation;
- completed Activation retaining its QSO and note evidence in REVIEW.

Also validate at least one manual/non-WSJT-X operating path, such as SSB, to prove Version 2.7 did not make the activation workflow digital-only.

### Weekend checkpoint

The first weekend activation after Version 2.6 is an **early field-validation checkpoint, not a Version 2.7 release deadline**. The preferred field build is the newest slice that has independently passed its automated and ToughBook acceptance gates. Do not rush unfinished WSJT-X or station-state work into the field build merely to increase slice count.

Field observations from that activation should be fed back into the remaining 2.7 slices before final OPERATE consolidation.

---

## Explicit exclusions from Version 2.7

Unless a concrete acceptance defect proves one is necessary, the following remain deferred:

- full CAT/rig-control implementation
- Hamlib/rigctld control platform
- PTT or transmit control
- automatic radio detection
- persistent full equipment inventory
- reusable loadouts
- automatic equipment selection or optimization
- power/endurance optimization
- broad antenna deployment optimization
- autonomous operating-plan generation
- generalized AI operations assistance
- APRS integration
- Meshtastic integration
- Direwolf integration
- Winlink integration
- DigiPi integration
- Local/NVIS evaluator expansion
- POTA/SOTA website submission or spotting workflow
- QRZ lookup
- QSL/LoTW/Club Log/eQSL workflows
- contest scoring
- award tracking
- enterprise/multi-user/fleet architecture

These are not rejected. They are deliberately kept out of Connected Operations so the release remains coherent and field-testable.

## Relationship to Version 3.0

The future concept remains:

```text
Equipment Inventory
        -> Reusable Loadout
        -> Mission
        -> Online Planning Intelligence
        -> Equipment / Deployment Analysis
        -> SmartDeploy Operations Brief / Risk Assessment
        -> Active Mission
```

Version 2.7 supplies important inputs to that future system without prematurely implementing it:

- a canonical current operating-state vocabulary;
- live software-derived station evidence;
- automatic provenance-aware QSO capture;
- operator-facing observed-RF evidence;
- an OPERATE surface capable of keeping planned, observed, and actual station evidence distinct.

Version 3.0 may then add persistent equipment inventory, reusable loadouts, mission/equipment reasoning, power/endurance and deployment analysis, contingencies, and evidence-grounded operational recommendations.

The intended progression is:

- **2.6 - Activation Operations:** What mission did I plan, and what did I record while doing it?
- **2.7 - Connected Operations:** What is my station actually doing now, and what is being observed on the air around me?
- **3.0 - Field Operations Assistant:** Given the mission, equipment, environment, retained intelligence, and current field evidence, how should I conduct the operation?

## Preliminary Version 2.7 release acceptance statement

Version 2.7 is successful when an operator can begin an Activation, have FieldOps automatically understand supported current digital operating band/mode/frequency from WSJT-X, automatically capture supported WSJT-X-logged QSOs with provenance, display truthful live observed-RF activity alongside retained propagation guidance, and continue operating manually and honestly when any optional integration or network source is unavailable.

## Preliminary release-end state

Compared with Version 2.6:

- QSO entry is faster and less error-prone.
- OPERATE understands a source-aware current station state.
- WSJT-X can supply live operating context without controlling the radio.
- completed WSJT-X QSOs can enter the Activation record automatically.
- live observed digital RF activity is useful in the activation workspace.
- planned/model evidence, observed RF, and actual station state remain visibly independent.
- manual SSB/CW/digital operation still works with no integration present.

Compared with the Version 3.0 target, Version 2.7 still does **not** know the operator's full equipment inventory, build reusable loadouts, select equipment, optimize power or deployment, or synthesize a complete evidence-grounded operating strategy. It establishes the live connected-operation evidence that Version 3.0 can later reason over.

## Implementation discipline

For every slice:

1. Trace the existing production render/runtime path before changing it.
2. Reuse existing domain/persistence/evidence contracts where they already fit.
3. Add the smallest abstraction justified by the current slice.
4. Add focused regression coverage before broad consolidation.
5. Run typecheck, relevant focused tests, full dashboard tests, production build, and applicable native/PowerShell gates before slice closure.
6. Do not deploy to the ToughBook automatically; field deployment remains an explicit operator action.
7. Record accepted limitations rather than fabricating completeness.
8. Keep the worktree and release identity trustworthy.

## First implementation checkpoint

Begin with **2.7-01 - QSO Logger Operating Ergonomics**. It has immediate field value, is independent of WSJT-X availability, and establishes the band/mode/frequency vocabulary required by the later station-state and WSJT-X slices.

The first weekend objective is not to finish Version 2.7. It is to take a stable, independently validated build into a real activation and use field observations to shape the remaining Connected Operations work.