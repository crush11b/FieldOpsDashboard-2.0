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

## V2.7-04 P.533 event-loop isolation correction

### Root cause and evidence

The production regional guidance path executes nine supported P.533 bands across four or five representative paths, producing 36 or 45 synchronous WASM executions per uncached refresh. A real five-path calculation measured approximately 6.2 seconds for 45 executions, with individual executions measuring approximately 103-263 ms. The existing synchronous `module.callMain()` therefore occupied the primary Node/Express event loop long enough to explain the observed 5-7 second application-wide stalls and to amplify longer queued-request incidents.

### Architecture

The P.533 engine now runs in one long-lived Node Worker Thread. The worker owns WASM initialization, virtual filesystem/data population, synchronous `module.callMain()`, report retrieval, and report parsing. The main process retains request validation, the public promise contract, global serialized execution semantics, and all existing regional/cache/rating behavior. The production build emits `dist/p533Worker.cjs` beside `dist/server.cjs`; source execution uses the TypeScript worker entry and repository-local TSX loader.

The bridge correlates deterministic request identifiers, rejects outstanding calls when the worker errors or exits, recreates the worker on the next request, and supports explicit shutdown. Workers are unreferenced so tests and process shutdown are not held open by an idle model worker.

### Preserved semantics and validation

P.533 inputs, assets, provenance, parsing, regional paths, supported bands, aggregation, cache keys/TTL/capacity, in-flight sharing, SmartDeploy mission-window behavior, and UI/runtime integrations are unchanged. Focused tests pass for real-engine parity, regional 45-call output, serialized requests, main-thread timer progress during a real regional run, worker failure rejection, and worker recovery. The measured worker-backed regional calculation remains approximately six seconds wall time while independent main-thread timers continue to run.

This correction is not the V2.7 release-completion decision. ToughBook hardware acceptance remains required after deployment.

### GNSS structured diagnostics - 2026-08-29

Persistent CF-20 GNSS unavailability recurred after deployment, and neither Tray nor Services.msc Agent restart recovered it. The existing coarse `GPS UNAVAILABLE` state could not distinguish serial-open failure from an opened but silent COM6 session, while expected `FieldOpsAgent` Application Event Log diagnostics were not available on hardware. Structured GNSS serial diagnostics were therefore added before further recovery changes. The diagnostic contract reports observed serial lifecycle state, session/reconnect counters, independent UTC activity timestamps, and bounded failure categories through the existing Agent location pipe, native endpoint, Dashboard API, and compact GPS details surface. This slice is observational only; it does not mark the GNSS defect fixed or establish hardware acceptance.

### V2.7-04 updater graceful-Agent-exit experiment - 2026-08-29

Repeated post-development-update CF-20 GNSS failures continued after the cumulative-silence watchdog correction: the corrected watchdog reached its intended silent-session behavior, but ordinary provider retries did not restore GNSS and Windows reboot remained the recovery path. A controlled Services.msc test then established that restarting only `FieldOpsAgent` normally releases and reopens COM6 and reacquires GNSS. The updater-vs-service differential investigation identified updater-only post-stop force termination of a matching Agent process and a later installer stop; the first controlled experiment isolates the former while deliberately leaving the installer stop unchanged.

After the updater confirms `FieldOpsAgent` is `Stopped`, it now captures the old Agent PID and waits for that exact process/path to disappear naturally within the existing bounded shutdown timeout. It never falls back to force-killing that Agent; if the PID remains, the update aborts before installation replacement. Tray and Dashboard force-stop behavior, exact package/revision validation, rollback, and runtime quiescence remain in place. The updater reports the old PID, natural-exit elapsed time, service-stopped confirmation, and replacement Agent PID. This experiment requires CF-20 hardware testing and does not establish V2.7-04 acceptance; V2.7-05 remains out of scope.

### V2.7-04 GNSS silent-session recovery correction

Repeated CF-20 Mk2 updates reproduced an open-but-silent COM6 NMEA session: the Agent had opened the Sierra Wireless Snapdragon X7 LTE-A NMEA port, but no serial data arrived and the existing read loop could wait indefinitely. The serial provider now uses a configurable `Agent:Location:NmeaNoDataTimeoutSeconds` watchdog, defaulting to 10 seconds. This tolerates ordinary 1 Hz scheduling jitter and missing individual sentences while recovering a genuinely silent session in an operator-visible interval.

The first watchdog implementation failed ToughBook hardware acceptance because production `SerialPortNmeaReader` wakes approximately every 250 ms with `null` after its `ReadTimeout`; a per-read watchdog therefore never expired. The corrected watchdog establishes a monotonic session baseline and tracks elapsed time since actual serial data was last received. Every non-null line resets that timestamp before NMEA parsing, including valid traffic with no fix, invalid coordinates, zero fix quality, RMC no-fix status, and parser-rejected sentences. `null` read timeouts and polling iterations do not reset it. When no data arrives for the interval, the current reader exits through the existing retry path; the `using` scope disposes the reader before the retry delay and the next COM6 open. Cancellation cancels the read, disposes the active reader, and prevents another retry or reopen. Focused tests now model production timeout/null behavior, including repeated nulls, nulls interspersed with traffic, no-fix traffic, traffic stopping, replacement-session recovery, and shutdown. ToughBook hardware acceptance remains required; this correction does not mark V2.7-04 complete.

This correction is not the V2.7 release-completion decision. ToughBook hardware acceptance remains required after deployment.

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

### 2.7-04 OPERATE clock synchronization hard failure - 2026-08-28

- CF-20 reported a hard failure: despite WSJT-X being approximately `-0.2` to `-0.4s`, OPERATE observed an approximately `22s` GNSS disagreement, remained in `Synchronizing` for more than five minutes, wandered through approximately `-22`, `+15`, `+24`, and `-37s`, and degraded WSJT-X timing to approximately `2.1-2.8s`. Clock acceptance is **blocked**; Logged QSO acceptance is deferred.
- Code-path finding: the prior synchronizer accepted a syntactically valid RMC timestamp whose freshness was based only on serial receipt, not the age of the timestamp itself, then compared that raw whole-second timestamp to Windows time and passed it directly to `SetSystemTime`. The implementation contained no convergence loop; therefore the alternating field deltas cannot be produced by this class alone and require the deployed Agent/runtime or another caller to be captured. The approximately `22s` discrepancy is consistent with stale-but-received-valid GNSS evidence; hardware packet evidence is required to distinguish stale RMC data from an external time-source conflict.
- Correction: GNSS evidence now carries monotonic receipt timing and is projected to the set instant. After a recent verified clock within `2s`, a discontinuous GNSS disagreement over `5s` fails closed as `SuspiciousEvidence` without changing Windows time. Synchronization is serialized, bounded to `15s`, performs at most one controlled set, reacquires the Windows clock for post-set verification, and returns explicit timeout, verification, native, privilege, or evidence failure results.
- Bounded diagnostics now include operation start/duration, GNSS observation receipt, evidence age, projected target, Windows time before and after the set, verification offset, attempt count, and final reason. No unbounded history or raw NMEA payload is retained.

### 2.7-04 Activation lifecycle correction - 2026-08-29

- Activation persistence is separate from SmartDeploy brief persistence. Deleting a brief therefore does not delete, complete, or otherwise mutate its Activation or Activation-owned QSOs.
- The existing single-operator lifecycle remains `planned -> active -> completed`. Starting a planned Activation is an explicit operator action; the Activation store now completes any older active records deterministically before making the requested record active. The response exposes the reconciled Activation IDs so OPERATE can explain the result.
- Existing installations may contain multiple active records from before this invariant. OPERATE presents the ambiguity and offers an explicit keep-one repair action. Repair completes the other active records without deleting any Activation or QSO data. Until repair, WSJT-X routing continues to refuse the ambiguous state rather than selecting an arbitrary record.
- Review remains read-only; it does not complete Activations. CAT, radio control, packet parsing, Current Station polling, GNSS/clock behavior, and the separate local-HTTP performance correction are unchanged.

### V2.7-04 CF-20 hardware acceptance - 2026-08-29

The prior interim WSJT-X acceptance blockers are superseded by completed Panasonic ToughBook CF-20 Mk2 evidence. With real WSJT-X, Current Station followed band, mode, and frequency with ordinary updates of approximately 1-2 seconds; backend Status receive, parse, and state update were effectively immediate. Earlier multi-second/global stalls were traced primarily to synchronous P.533 WASM execution on the Node/Express event loop, not the WSJT-X parser/state path.

Real WSJT-X Logged QSO events completed the full path `UDP packet -> parsed -> normalized -> active Activation -> persisted -> QSO Logger display`, including AD9DU on 40m FT8 and TE5T on 20m FT4. The single-active Activation invariant corrected ambiguity while preserving historical Activations and QSOs: a subsequent Activation started without stale ambiguity, and completed Activation REVIEW retained its QSO history. The previously demonstrated GNSS/Windows clock synchronization no-op within the allowed tolerance remains accepted evidence; clock algorithm work is not reopened here.

P.533 regional guidance performs 36-45 synchronous WASM calls per uncached calculation and may occupy the CF-20 event loop for approximately 5-7 seconds. It now runs in a long-lived Worker Thread. Real worker-backed computation remains computationally expensive, as expected for the target hardware, but while it ran the operator returned to Field Tools and Current Station continued following WSJT-X changes. Raw P.533 speed is hardware-limited; application-wide blocking is sufficiently isolated and is accepted for the CF-20 target.

The GNSS updater failure was also retested on revision `a56bf4e4a2fe0a6f4801240abdf4bb0f5ee2eaca`. After the Desktop Development Updater, GPS reacquired without a Windows reboot. This is hardware-supported evidence that graceful Agent teardown resolves the reproduced updater/GNSS failure for this acceptance cycle: the updater waits for the exact old Agent PID to disappear naturally and fails closed if it does not, while Tray/Dashboard forced shutdown remains unchanged. This does not claim that every Sierra/driver failure mode is solved.

**V2.7-04 - ACCEPTED on CF-20 hardware.**

Accepted limitations:

- P.533 calculations may require several seconds on CF-20-class hardware, but WSJT-X and other UI/runtime functions remain responsive while P.533 computes.
- Residual one-off timing variation may occur on constrained hardware; no known V2.7-04 defect remains that blocks proceeding.
- Future updater deployments provide additional natural confirmation of the GNSS graceful-exit correction.

V2.7-05 may now begin. This acceptance does not mark the V2.7 release complete.

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

### V2.7-05A implementation evidence - 2026-08-29

The first implementation slice reuses the singleton `ObservedRfService` and adds a bounded `GET /api/live-band-activity` read model. It preserves the existing PSKReporter source identity, 15-minute window, live/cached/stale/unavailable status semantics, canonical ten-band order, and inbound/outbound/local report counts. The endpoint does not create a second MQTT connection, invoke P.533, or call propagation guidance.

Active OPERATE now includes a compact read-only panel sourced from that endpoint. It refreshes at a tens-of-seconds cadence with one in-flight request guard, keeps request failures separate from zero-report evidence, and does not persist activity into Activation or REVIEW. Unavailable source state is shown without fabricated band-zero rows; live zero-report state remains explicit and visible.

Focused mapper, endpoint, and panel tests pass, and TypeScript typecheck passes. CF-20 hardware validation and full V2.7-05 acceptance remain pending; this is the 2.7-05A foundation slice only.

### V2.7-05B implementation evidence - GNSS Operator Recovery

The Agent now exposes an explicit, default-disabled `RecoverGnss` operation through the authenticated location pipe. It is limited to the configured `SierraEm7455B` provider and COM7 control port, sends only the bounded operator-authorized recovery operation, serializes concurrent requests, disposes the control port, and requires newer post-operation COM6 evidence before reporting recovery. Command acceptance, serial activity, NMEA activity, and fix acquisition remain separate outcomes; no automatic recovery is performed.

The Dashboard exposes `Recover GPS` only in GNSS Diagnostics when persisted serial-silence evidence is present, disables repeated clicks while active, and reports accepted, NMEA-recovered/no-fix, fully recovered, and failed outcomes without displaying modem command details. Hardware acceptance on the CF-20 remains pending; this entry does not close 2.7-05 or the broader V2.7 release gate.

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

### 2.7-06A implementation evidence - Integrated OPERATE operational header

The active OPERATE workspace now begins with a compact operational header showing the selected Activation identity, current band/mode/frequency, source and freshness, and the retained QSO count. The header reuses the existing Activation state, source-aware Current Station selection, and QSO Logger list refresh; it adds no persistence, API route, polling loop, runtime, or GNSS behavior. The detailed Current Station panel remains in place because its timestamps and explicit radio/CAT/RF limitations are not redundant with the compact summary.

Fresh WSJT-X state is labeled `WSJT-X / LIVE`, stale WSJT-X state is labeled `WSJT-X / STALE`, and manual context is labeled `MANUAL / OPERATOR-SET`. Unknown or unavailable values remain unknown or unavailable, and inactive Activations show no active station context or QSO count. Focused Activation/current-station tests and TypeScript validation pass. This is implementation evidence for 2.7-06A only; CF-20 hardware acceptance and the broader 2.7-06 consolidation remain pending.

### V2.7-06B implementation evidence - OPERATE Live Band Activity runtime

CF-20 validation found repeatable mid-90% CPU and low-90% GPU utilization with Live Band Activity active, plus roughly three minutes of settling while the view refreshed an approximately 450-report retained observation. The traced path was the active OPERATE `SmartDeployBriefView` through `LiveBandActivityPanel`, its 30-second fetch, the Express `/api/live-band-activity` route, `ObservedRfService.getSnapshot()`, and the `createLiveBandActivity()` read model. The client rendered ten bounded band rows, but the read model repeatedly scanned each retained report set once per band and once for each direction count; the polling effect also captured its initial empty activity value, so every refresh re-entered `loading` while the retained status badge still showed the old report count.

The bounded correction keeps the existing singleton PSKReporter/Observed RF ownership and 30-second cadence, isolates the summary panel from unrelated OPERATE parent renders, replaces repeated per-band scans with one aggregation pass, and keeps retained band summaries visible during refresh with explicit retained-observation wording. It does not add polling, APIs, persistence, workers, qualitative band judgments, or new evidence semantics. Live/cached/stale/unavailable provenance remains source-backed, and the observation remains digital reception evidence only. Automated focused and full Dashboard validation passes; CF-20 retest is still required to establish field performance and does not promise a specific CPU/GPU target.

The first post-correction CF-20 performance result remained failed, with sustained CPU/GPU utilization near 90%. A follow-up runtime audit found additional always-mounted dashboard costs outside the bounded Live Band Activity path: the global header used backdrop blur and continuous pulse/spin effects, and the GPS widget used continuous navigation/satellite animation. This 06B correction removes those decorative effects while preserving the existing polling cadences, GNSS controls, clock synchronization workflow, WSJT-X/QSO behavior, and evidence semantics. Focused GPS and action-guardrail tests, TypeScript validation, and production build validation pass; a fresh CF-20 retest remains required. No 2.7-06C or later slice is started.

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