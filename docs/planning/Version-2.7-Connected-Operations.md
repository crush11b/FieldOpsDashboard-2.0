# Version 2.7 - Connected Operations

- Status: **V2.7.0 release-ready source closure; 2.7-01 through 2.7-07 accepted on CF-20 hardware**
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

For a simple single-consumer setup, the default listener remains unicast on `127.0.0.1:2237`. When multiple WSJT-X consumers share the computer, configure WSJT-X multicast instead: set WSJT-X UDP Server to `239.255.0.0`, UDP port to `2237`, and select the appropriate outgoing interface. FieldOps can be configured with `WSJTX_MULTICAST_ADDRESS=239.255.0.0` and, when needed, `WSJTX_MULTICAST_INTERFACE=<local-interface-address>`; it binds the port on `0.0.0.0` and joins the group. `WSJTX_HOST` and `WSJTX_PORT` remain available for explicit unicast configuration. FieldOps is one telemetry subscriber, not the exclusive owner; other companion or logging applications may subscribe independently. Otto is not a FieldOps dependency or integration.

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

### 2.7-03 multicast reliability correction - 2026-08-29

- CF-20 field retest initially received WSJT-X multicast traffic and reached 51 packets. FieldOps and Otto initially coexisted, but FieldOps then froze; closing Otto, changing bands/decode cycles, and restarting WSJT-X did not restore traffic. The HTTP/API and frontend diagnostics paths remained healthy, so sustained multicast reception was classified as a release blocker.
- The correction requests shared multicast-port reuse, binds multicast on `0.0.0.0`, records listener configuration and membership state, exposes socket failure diagnostics, and performs at most three delayed listener recovery attempts without creating duplicate sockets or memberships.
- The correction is not hardware acceptance. The CF-20 retest gate remains: prove sustained multicast reception through band changes, WSJT-X restart, and an independent subscriber, then verify honest listener diagnostics and no regression to default unicast operation.

### 2.7-03 production multicast configuration wiring - 2026-09-02

- Revision `aa5daa31` was deployed to the CF-20, but Current Station remained unavailable and the WSJT-X packet count stayed at zero through three band changes. `/api/wsjtx/diagnostics` proved that FieldOps was active in unicast mode with `multicastAddress=null` and `multicastJoined=false`, while WSJT-X was transmitting to `239.255.0.0:2237`; the multicast reliability correction had therefore not actually been exercised.
- The root issue was production configuration wiring: deployed Dashboard launchers supplied only `NODE_ENV`, while `WSJTX_MULTICAST_ADDRESS` existed only as an environment override and was never provided to the Dashboard process. Dashboard-owned configuration now supplies the production multicast default and preserves deliberate unicast compatibility.
- Hardware acceptance remains pending after this correction. This record does not declare multicast validated.

### 2.7-03 Windows multicast interface membership correction - 2026-09-02

- Revision `042839ff` was deployed successfully. FieldOps correctly reported multicast, active, joined, and `239.255.0.0`, but five WSJT-X decode cycles produced zero FieldOps packets. WSJT-X was sending through `wireless_32768` and `loopback_0`; Otto then received the same multicast traffic while FieldOps remained at zero packets.
- This proves the sender, group, port, and local subscriber coexistence are functioning. The remaining failure is FieldOps automatic multicast interface membership on Windows: the prior listener allowed the OS to select one interface when no explicit address was configured.
- FieldOps now enumerates unique local IPv4 addresses and joins the group on each eligible address, while retaining explicit-interface and bounded lifecycle behavior. Hardware acceptance remains pending.

### V2.7-07 Windows native receiver proof - 2026-09-02

- Revision `a523846` was deployed to the CF-20. FieldOps successfully joined `127.0.0.1` and `192.168.0.94`, but its packet count remained zero. A loopback-only WSJT-X test also remained at zero, and temporarily disabling Windows Defender Firewall did not change the result.
- With FieldOps closed, a standalone Node receiver bound `0.0.0.0:2237`, joined both addresses, and remained at zero packets through three WSJT-X decode cycles. Otto had already demonstrated successful WSJT-X multicast reception on the same system.
- A separate Windows-native .NET receiver proof is therefore being tested before any architecture change. It reports raw UDP transport evidence only and does not move WSJT-X interpretation or domain ownership out of Express. Hardware acceptance remains pending; .NET receive success is not yet claimed.

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

### V2.7 WSJT-X logging hardening - field finding and bounded correction

- The final field validation found that the zero-packet failure was caused by a malformed WSJT-X multicast destination. After correcting the destination to exactly `239.255.0.0`, FieldOps sustained multicast reception, Current Station tracking, and simultaneous FieldOps plus Otto multicast consumption all succeeded.
- A real over-the-air WSJT-X-assisted QSO was received and persisted by FieldOps. Diagnostics recorded `3192` packets received, `2` accepted Logged QSO packets, `0` Logged QSO parse failures, last import result `persisted`, and last QSO `AA4SS / 40m / FT8`.
- The two accepted events represented the same QSO because the WSJT-X Log QSO action was invoked twice. Final bounded V2.7 hardening therefore adds conservative duplicate suppression across repeated type-5 events and type-5/type-12 pairs, while allowing a later QSO with the same station. A failed first persistence attempt does not retain a dedupe entry, so a valid retry remains possible.
- WSJT-X message type `12` (`Logged ADIF`) is now recognized for supported schemas and parsed through the existing ADIF utility into the same normalized candidate and Activation validation/persistence path as message type `5` (`QSO Logged`). Type-12 compatibility is implementation- and test-validated only; no type-12 hardware validation is claimed.
- Diagnostics distinguish type-5 and type-12 accepted events, malformed events, duplicate suppression, and persisted imports. The separate .NET multicast proof remains diagnostic only and is not production architecture.

### WSJT-X logged-QSO ADIF fallback - field evidence and bounded hotfix - 2026-09-04

- Field validation confirmed that WSJT-X Status messages reliably reached multicast `239.255.0.0:2237`, and band/mode tracking worked after correcting WSJT-X's outgoing interface. The same session saved completed QSOs to the local `%LOCALAPPDATA%\\WSJT-X\\wsjtx_log.adi` file, while the primary stream emitted no type-5 or type-12 logged-QSO packet and the secondary logged-contact ADIF broadcast at `127.0.0.1:2238` emitted nothing to an active listener.
- Existing UDP Status, type-5, and type-12 handling remains in place. The bounded fallback polls the resolved local ADIF file, establishes the current EOF as its first-run baseline, retains only incomplete tail bytes in memory, and persists a byte checkpoint only after complete records have been processed through the existing ADIF parser, Activation association, QSO normalization, persistence, and duplicate-suppression path.
- File replacement, truncation, missing files, missing `LOCALAPPDATA`, malformed records, and failed imports remain nonfatal and diagnostic. This is a reliability hotfix for logged-QSO ingestion and does not widen V2.8-02 or claim a new WSJT-X protocol guarantee.

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

The next CF-20 validation exposed a repeatable visible flash between the SmartDeploy/Roadmap Tools modal and the underlying dashboard, approximately ten flips in eight seconds. Modal ownership tracing found no recurring React state transition: `roadmapModalOpen` changes only in the two explicit Field Tools/Touch Menu open handlers and the modal close callback, while Roadmap Tools `activeTab` changes only from its tab buttons. The omitted SmartDeploy-specific compositing path was the modal's full-screen `backdrop-blur-md` overlay and spinning header icon, which were applied while the dashboard beneath continued updating. This 06B correction removes both effects, adds modal shell/tab/explicit-close regression coverage, and preserves SmartDeploy lifecycle and polling behavior. The earlier audit statement that no animation loop remained on the primary shell was incomplete because it omitted this continuously visible modal path; the corrected shell still has no canvas/map/chart or continuous decorative animation. The flash mechanism remains a hardware retest question: source tracing does not prove whether the observed effect was compositor flicker rather than logical modal remounting.

The following natural CF-20 `SerialSilence` failure reached session 30 with 29 reconnects. One operator-initiated `Recover GPS` attempt was made; Event Viewer retained only `FieldOpsAgent` service start/stop entries, so the COM7 open, `AT!GPSEND=0,255` response, COM6 observation, and final recovery category could not be classified. This bounded 06B observability correction adds one correlated 12-character request identifier to structured Agent logs for each explicit recovery request and maps every existing recovery result to immediate Dashboard feedback, including the pending state. It does not retry recovery, add `GPSSTART`, alter the modem command sequence, change COM6 ownership/reconnect behavior, or begin 06C. A one-click CF-20 retest remains required to capture the new evidence.

The next CF-20 deployment returned `GPS recovery is disabled.` after the one permitted Recover GPS click. The coordinator was correctly honoring its configuration contract: the base Agent `appsettings.json` defaults `Agent:Location:Recovery:Enabled` to `false`, while the intended CF-20 values had previously been supplied only by an optional updater switch. The deployed path did not carry that override, so the Agent loaded recovery as disabled. The same deployment showed only service lifecycle entries in Application Event Log. The existing `AddEventLog` setup did not retain the recovery coordinator's Information category in the deployed result, leaving its correlated recovery entries invisible. The correction adds a packaged `Cf20` profile selected by the existing deployment environment wiring, retains the base disabled default, explicitly filters only `GnssRecoveryCoordinator` Information entries into the existing `FieldOpsAgent` Application source, and emits one bounded startup configuration observation. Recovery mechanics remain unchanged.

The subsequent CF-20 hardware acceptance passed on deployed commit `d7a1db443058ecf63ff24bb7b287a6c78b29ea22` (`Correct GNSS runtime configuration activation`). A natural pre-deployment failure showed COM6 at 9600 in an Open/reconnect loop with no serial data, valid NMEA, or fix and failure category `SerialSilence`. The operator clicked `Recover GPS` exactly once. Recovery self-reported `enabled / SierraEm7455B / COM7 @ 115200`; COM6 transitioned to `Receiving`, fresh serial and NMEA resumed, and the stream subsequently produced a valid real GNSS fix: Maidenhead `FM17gj`, coordinates, 8 satellites, fix quality 1, altitude 74.2 m, and populated GNSS UTC. No reboot, Agent/service restart, manual COM intervention, or second recovery action was required. The acceptance proves `SerialSilence -> ordinary reconnects ineffective -> one Recover GPS action -> Sierra EM7455B COM7 control path -> COM6 NMEA restoration -> sustained serial/NMEA -> valid GNSS fix`; GNSS recovery mechanism and runtime configuration activation are hardware-accepted.

Two bounded presentation defects were found after that successful recovery. Historical `SerialSilence` remained under an unconditional `FAILURE` label even while COM6 was `Receiving` with fresh serial/NMEA/fix evidence; the Dashboard now labels that retained diagnostic as `LAST FAILURE` only when current healthy evidence is present. The recovery result also retained the truthful-at-completion message `NMEA data recovered; acquiring GPS fix.` after a valid fix had subsequently returned; the Dashboard now derives the visible wording from current GNSS evidence and shows `GNSS fix restored.` while preserving the original recovery result as evidence. No-fix state continues to show the acquiring-fix wording. Recovery mechanics, modem command, retry behavior, COM6/COM7 ownership, updater/deployment behavior, and 06C scope are unchanged.

The exact `077ad2a` acceptance failed for deployment configuration, not for the recovery command path: deployment completed, one `Recover GPS` click returned `GPS recovery is disabled.`, and COM6 remained `SerialSilence` with no serial/NMEA/fix data while continuing to reconnect. The installed Agent directory and published native package both contained `appsettings.Cf20.json`, but that presence did not prove runtime activation. Root-cause tracing found the actual Desktop `FieldOpsDevelopmentUpdater.ps1` was stale and omitted `-EnableCf20GnssRecovery`; consequently `UpdateDashboard.ps1` received `false`, persisted no CF-20 recovery environment values, and the running service had no `DOTNET_ENVIRONMENT=Cf20`. The correction also recognizes the exact SHA-keyed Development native artifact URL as the CF-20 profile signal, while keeping the default `mvp-native` release URL disabled, and self-reports loaded recovery enabled/provider/control port/baud in the result. This is a deployment correction pending one fresh CF-20 acceptance; no modem command, retry, `GPSSTART`, COM6 ownership, or 06C behavior changed.

### V2.7-06C implementation evidence - OPERATE working surface consolidation

06B is hardware-accepted on CF-20 after the bounded runtime corrections: with SmartDeploy open, OPERATE active, WSJT-X decoding FT8, Live Band Activity populated, GNSS active, and Task Manager open, settled CPU averaged approximately 30% with transient spikes but no sustained saturation, while GPU remained approximately 20%. The Live Band Activity observation populated normally at `LIVE · 506 REPORTS`, and the existing fifteen-minute observed-RF disclaimer remained visible. This closes 06B performance acceptance only; it does not close 2.7-06 or Version 2.7.

The 06C layout decision keeps one phase-owned OPERATE surface and makes the existing operational header and QSO Logger the primary working area. Activation controls remain immediately above the Logger, Activation Notes follow directly after it, and station-state, clock, technical, review, and WSJT-X diagnostics are grouped behind a closed `STATION STATE / TIME DIAGNOSTICS` disclosure. A compact `SUPPORTING CONTEXT` block keeps retained planned/modeled guidance visible beside an explicit observed-RF explanation; Live Band Activity remains a separate observed-RF panel below it. Optional observed RF, WSJT-X, and current-station failures do not block manual logging or notes.

The three evidence classes remain independent: retained SmartDeploy/P.533 guidance is labeled planned/modeled, PSKReporter reports remain observed RF only, and manual or WSJT-X state remains actual station context. No new polling or data pipeline was introduced; existing QSO, WSJT-X, clock, notes, and 30-second Live Band Activity ownership and cadences are unchanged. The detailed evidence remains available through existing disclosures and lifecycle phases rather than being removed. 06C automated validation is required before one coherent commit; no 2.7-06C hardware acceptance or overall release completion is claimed here.

### Bounded 06C semantic correction - 2026-08-29

The initial CF-20 06C layout passed field use as a working surface, but three bounded presentation/ergonomic defects were identified. Live Band Activity rendered local reports only as `local`, which was opaque; the label now reads `local-area` with the limitation that the propagation mechanism is unknown. The `localCount` domain field and classification remain unchanged, and the UI does not call the activity NVIS. WSJT-X appeared suspiciously `STALE` because the implementation used a five-second boundary while the accepted contract documented ten seconds; the listener now uses the documented ten-second freshness interval, while still presenting stale state as stale and unavailable state as unavailable. Finally, the Logger always opened at `20m / SSB`; it now seeds an untouched active form once from fresh WSJT-X band, mode, and frequency, without replacing operator edits, in-progress contact fields, stale/unavailable state, or non-active Activation state.

These corrections preserve the evidence boundaries: modeled P.533 guidance remains planned/modeled, Live Band Activity remains observed digital reception evidence, and WSJT-X remains application-reported operating context rather than CAT, direct-radio, transmit, or RF confirmation. 2.7-06 and Version 2.7 remain open pending the separate automated, hardware, field-validation, and release gates.

### V2.7-06D/06E bounded CF-20 closeout preparation - 2026-09-01

The deployed `9f311c7` CF-20 acceptance exercised the corrected WSJT-X freshness contract. CURRENT STATION was initially `STALE`, then transitioned to `LIVE` as fresh Status evidence arrived. This passed the hardware acceptance for the ten-second freshness behavior. While WSJT-X was not providing supported current operating state during WSPR use, CURRENT STATION correctly displayed unavailable. Live Band Activity remained operational; one overnight observation reported `LIVE · 178 REPORTS`: 160m 1, 80m 8, 40m 114, 30m 31, and 20m 24, with 17m through 6m at 0. These are observed PSKReporter activity counts only and must not be interpreted as propagation quality.

No `local` classification occurred during this observation, so the `local-area` presentation change was not exercised, not failed. Logger station-state initialization did not occur on hardware. The bounded correction removes the cancelable deferred seed from the Logger lifecycle: an active, untouched mounted form now commits one seed when a supported fresh WSJT-X state arrives, even if the form first saw unavailable or stale state. The activation guard, one-seed guard, stale/unavailable exclusion, and operator-edit precedence remain in place. This commit does not declare 2.7-06 complete; one short CF-20 acceptance of this exact commit remains required.

Focused automated validation passed: 2 test files and 27 tests. The full suite completed with 92 of 93 files passing and 940 of 941 tests passing; the sole failure was the known unrelated 60-second timeout in `src/propagation/__tests__/regionalP533.test.ts`, test `records the missing real-engine reference matrix under fixed assumptions`. TypeScript, production build, and `git diff --check` passed. Automated validation does not close 2.7-06 or replace the required hardware gate.

### Future layered band-planning architecture (documented only)

The eventual layered evidence model is explicitly:

1. P.533 / SmartDeploy modeled propagation.
2. Current space-weather context.
3. PSKReporter grid/local Live Band Activity.
4. Future PSKReporter `MY SIGNAL` FT8/FT4 station-specific evidence.
5. Future WSPR station-specific propagation survey evidence.
6. WSJT-X actual operating, decode, and QSO evidence.

Higher layers refine earlier evidence; they do not erase it. Every layer must preserve source, freshness, provenance, and limitations. A future purpose-aware recommendation must remain explainable and must not reduce the evidence to an unexplained Poor/Fair/Good/Excellent label or opaque magic score.

WSPR is not PSKReporter data and must not be modeled as a PSKReporter subtype or provider. WSJT-X can operate WSPR, but remote reported reception evidence requires a separate future external data-source boundary. WSPRnet/WSPR.live-derived data may be candidates, but Version 2.7 selects no permanent provider. Provider, API, licensing, availability, and freshness review are required before implementation. This slice adds no provider-specific production code or query examples.

The operational concept is workflow-aware. For POTA/basecamp, WSPR may be useful during PREPARE: deploy the antenna and radio, begin a low-power WSPR propagation survey, let it run while camp or the base station is completed, and enter OPERATE with station-specific evidence from the actual deployed station. For SOTA or another fast activation, a long pre-activation WSPR survey may not fit; modeled guidance, space weather, and grid Live Band Activity can support a fast start, after which station-specific PSKReporter or WSJT-X evidence may refine the decision.

WSPR survey evidence complements rather than replaces PSKReporter `MY SIGNAL`. WSPR answers an intentional low-power propagation-survey question. PSKReporter `MY SIGNAL` answers how the operator's actual FT8/FT4 operating signal is currently being received. Neither future source is implemented in Version 2.7.

The proposed controlled experiment is a paired 40m/30m comparison under a declared time window, station setup, mode, power, antenna, and operator purpose, recording modeled guidance, space-weather context, Live Band Activity, any `MY SIGNAL` evidence, WSJT-X state, and actual logged outcomes separately. Results must be interpreted as observations under those controls, not as a universal band ranking or causal propagation claim. This architecture is deferred and is not part of 2.7-06C implementation.

---

## 2.7-07 - Field Validation and Release Closure

### V2.7-07 real field activation - 2026-09-01

The final CF-20 Mk2 acceptance evidence below supersedes the earlier interim observations in this section where they described multicast or WSJT-X-assisted logging as pending.

The operator created a mission, used PLAN, PREPARE, OPERATE, and REVIEW, and ended the Activation successfully. During the same acceptance cycle, PLAN/PREPARE observations were: Mission Forecast required manual refresh; Retained Space Weather required manual refresh; Operations Readiness reported Location Ready, GPS Ready, Clock Ready, ToughBook Ready, Weather Unknown, Alerts Unknown, Space Weather Ready, and Propagation Ready. These are release punch-list observations, not automatically blockers.

On the CF-20 with WSJT-X, Chrome Dashboard, the Node/local Dashboard server, the Command Prompt server window, and VS Code still running, CPU was generally approximately 30-50% with brief increases into the 70% range, and GPU remained below 10%. This is acceptable representative hardware behavior and passes relative to the prior sustained 90%+ CPU/GPU regression.

The activation modeled/preferred 17m, where only two contacts were made; 20m was substantially busier. This single activation does not show that the model was wrong. It supports the layered architecture: modeled viability is not contact density, and live observed activity plus actual station/QSO evidence may refine operator choice. No recommendation engine is implemented.

The FX-4CR and WSJT-X did not successfully complete transmit control: WSJT-X visually indicated transmitting, but RF/transmit did not reach the radio as expected. This is an external radio/software integration limitation, not evidence that FieldOps failed; CAT/PTT or FX-4CR troubleshooting is outside this task. During FT8CN/FT8TW operation over Bluetooth, initial replies were sometimes received, while repeated follow-up transmissions and CQ exchanges often failed to complete the QSO. This is field-stack evidence for separate investigation; no cause is assigned here.

Because the radio transmit path was unsuccessful, QSOs were logged manually. Manual logging preserved the Activation workflow and exposed the Callsign/RST keyboard and focus defects corrected in this slice. This confirms graceful manual fallback. Another WSJT-X consumer, Otto, could not coexist with FieldOps under loopback unicast `127.0.0.1:2237`; the field guidance is to use multicast for multiple consumers. This task implements protocol/configuration coexistence only, not Otto integration.

### V2.7-07 release classification and acceptance review

### V2.7-07 final CF-20 release-closure acceptance - 2026-09-02

Final production hardware was a Panasonic ToughBook CF-20 Mk2. WSJT-X was configured for multicast group `239.255.0.0` on UDP port `2237`; FieldOps was observed joined on `127.0.0.1` and `192.168.0.94`.

The root cause of the prolonged zero-packet investigation was a malformed WSJT-X multicast destination containing an extra character after `239.255.0.0`. After correcting the destination to exactly `239.255.0.0`, the existing Node/Express production architecture received sustained multicast traffic. This confirms Windows multicast reception and FieldOps transport validity; Windows Defender Firewall was not the root cause, Otto did not monopolize the socket, and no native/.NET multicast bridge is required. The separate `FieldOps.WsjtxMulticastProof` project remains diagnostic/proof-only.

Final field gates passed:

- Sustained multicast reception: PASS; packet count continuously increased during real WSJT-X operation.
- Current Station: PASS; live WSJT-X band, mode, and frequency changes were tracked.
- Multi-consumer coexistence: PASS; Otto reached Ready while FieldOps continued receiving the multicast stream.
- Real over-the-air QSO ingestion: PASS; AA4SS / 40m / FT8 was previously persisted, and the final controlled N2NDV / 40m / FT8 QSO was persisted without manually clicking Log QSO.
- Type 5 and type 12 acceptance: PASS; N2NDV caused both `QSO Logged` type `5` and `Logged ADIF` type `12` events, both parsed successfully and converged on the existing normalized Activation ingestion path.
- Cross-type duplicate suppression: PASS; the N2NDV QSO persisted once and its second representation was suppressed.
- Current Station timing: PASS; Status receive/parse/state-update timestamps, `/current`, and frontend polling remained healthy.
- Manual logger fallback and keyboard ergonomics: PASS; previously field-validated during the Activation.

Immediately after the completed N2NDV QSO, diagnostics recorded `6652` packets received, type 5 accepted/parse failures `2 / 0`, type 12 accepted/parse failures `2 / 0`, duplicate WSJT-X events suppressed `2`, total Logged QSO parse failures `0`, last callsign/band/mode `N2NDV / 40m / FT8`, last import success `2026-09-02T23:22:15.136Z`, and final import result `dedupe:duplicate` with failure stage/reason `dedupe / duplicate`. Before this QSO, type 5 accepted was `1`, type 12 accepted was `1`, and duplicates suppressed was `1`.

One completed RI1FJL QSO appeared in the WSJT-X ADIF log without a logging event visible to FieldOps at that time. Later, manually clicking WSJT-X Log QSO caused WSJT-X to emit an event for OK7CM even though that QSO had not completed. FieldOps correctly received and deduplicated the type 5 and type 12 events that WSJT-X actually emitted. This is recorded as intermittent upstream WSJT-X logging behavior, not a FieldOps ingestion failure or V2.7 blocker; no speculative FieldOps compensation was added.

The V2.7-07 gates are satisfied: full PLAN -> PREPARE -> OPERATE -> REVIEW lifecycle, GNSS/clock readiness, source-aware Current Station, sustained multicast, independent multicast consumer coexistence, real WSJT-X-assisted persistence, type 5/type 12 compatibility, duplicate suppression, manual fallback, observed-RF presentation, offline/local operation, and retained REVIEW evidence are accepted within the documented limitations. No V2.7-owned release blocker remains.

**V2.7-07 - COMPLETE. V2.7 Connected Operations is release-ready for independent ChatGPT release review.**

**Release blocker:** No FieldOps-owned blocker was found in the completed PLAN -> PREPARE -> OPERATE -> REVIEW lifecycle, successful Activation completion, exercised GNSS/clock readiness, previously exercised real WSJT-X Current Station, Live Band Activity, manual QSO logging, graceful unavailable-WSJT-X fallback, CF-20 performance, or retained Activation evidence. WSJT-X-assisted actual QSO capture was not fully field-exercised because the FX-4CR/WSJT-X transmit stack failed externally. It remains a planned evidence gap, but does not block the defined Connected Operations release because controlled/automated parser-routing-persistence evidence exists and manual fallback was successfully demonstrated. This is an explicit acceptance decision, not a silent waiver.

**Fix if cheap / safe:** The Logger keyboard sequence and focus restoration, plus configured WSJT-X multicast coexistence, are the bounded low-risk corrections in this pass.

**Deferred:** Installed operator launcher, automatic PLAN forecast/space-weather refresh, duration-aware Retained Mission Forecast, Weather/Alerts Unknown investigation unless a current regression is proven, layered propagation recommendations, PSKReporter `MY SIGNAL`, WSPR survey integration, FX-4CR/WSJT-X radio-control troubleshooting, and FT8CN/FT8TW Bluetooth QSO-completion troubleshooting remain outside this release-closure pass.

This dated evidence was an interim acceptance record. The final CF-20 acceptance and release-closure decision are recorded in the V2.7-07 final closure entry above; this source-closure commit does not tag or publish a GitHub release.

Validation for this correction pass: focused Logger, Activation, WSJT-X listener/API, and WSJT-X QSO-routing coverage passed with 50 tests across 5 files. TypeScript, production build, and `git diff --check` passed. The full automated suite passed with 944 tests across 93 files. No WSPR, PSKReporter `MY SIGNAL`, recommendation-engine, CAT/PTT, launcher, or forecast-redesign implementation was added.

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

## Version 2.7 release acceptance statement

Version 2.7 is successful when an operator can begin an Activation, have FieldOps automatically understand supported current digital operating band/mode/frequency from WSJT-X, automatically capture supported WSJT-X-logged QSOs with provenance, display truthful live observed-RF activity alongside retained propagation guidance, and continue operating manually and honestly when any optional integration or network source is unavailable.

## Release-end state

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