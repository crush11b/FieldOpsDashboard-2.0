# Version 2.8 - Operational Intelligence

- Status: Architecture/planning contract; no V2.8 production implementation yet
- Baseline: Version 2.7.0 - Connected Operations
- Initial slice: 2.8-01 Operational Intelligence Contract & Time Model
- Supported deployment: single operator on one locally operated Windows field computer
- Review gate: 2.8-01 implementation may begin only after independent ChatGPT review of this commit

## Governing question

> Given what FieldOps knows about this mission and what is happening right now, what operating strategy makes sense next, and why?

Operational Intelligence is a deterministic, evidence-grounded layer over the existing PLAN -> PREPARE -> OPERATE -> REVIEW workflow. It does not authorize FieldOps to control a radio, operate WSJT-X, invent provider evidence, or choose equipment for the operator.

## Release boundary

The product progression is:

- **V2.6 - Activation Operations:** durable activation planning, logging, notes, and review.
- **V2.7 - Connected Operations:** read-only connected station/application evidence, logged-QSO ingestion, live activity, and integrated OPERATE workflow.
- **V2.8 - Operational Intelligence:** mission-aware, explainable operating guidance from separated retained, modeled, environmental, observed, application, operator, and derived evidence.
- **V3 - Field Operations Assistant:** persistent equipment inventory and reusable loadouts with resource-aware equipment recommendations.

V2.8 explicitly excludes:

- CAT, PTT, or direct rig control
- automatic radio detection
- persistent equipment inventory
- reusable loadouts
- equipment selection or optimization
- battery or endurance strategy
- generalized AI recommendations
- APRS, Meshtastic, Direwolf, Winlink, or DigiPi
- spotting, submission, or external-logbook integrations
- enterprise, multi-user, or fleet work

V2.8 may consume read-only WSJT-X application evidence already accepted in V2.7. It must not imply control of WSJT-X or the radio.

## Evidence contract

Evidence families remain distinct:

1. **Planned/retained mission evidence:** target, location, mission window, planned station context, retained forecast, notes, and other locally retained plan facts.
2. **Modeled P.533 evidence:** deterministic model outputs and their model inputs, sample times, engine, and limitations.
3. **Environmental evidence:** weather, alerts, space weather, GNSS/time, and other environmental observations or forecasts.
4. **General observed RF:** aggregate reception activity such as Live Band Activity and PSKReporter reports that are not tied to the operator's station.
5. **Station-specific observed RF:** retained observations associated with one Activation and one TX Context segment, such as compatible reports of the operator's signal.
6. **Actual station/application state:** current application-reported state, including read-only WSJT-X Current Station. This is not direct radio or transmit state.
7. **Operator-supplied TX Context:** bounded operator/session declarations of the setup used during an operating segment.
8. **WSPR source-reported evidence:** values and observations reported by WSPR sources, kept distinct from operator context.
9. **Derived deterministic guidance:** rules applied to named inputs, with reasons and limitations; it is not a provider observation.

Every evidence record or summary must identify, as applicable:

- source and source identifier
- observation or retrieval time in UTC
- freshness and status
- applicability to the Activation, segment, band, mode, location, and time window
- limitations and known exclusions

The system must prohibit:

- synthetic confidence scores
- unexplained `GOOD` or `87%` style ratings
- treating general PSKReporter activity as station success
- treating zero matching reports as bad propagation
- attributing operator-entered power to PSKReporter
- attributing WSPR-supplied power to operator context
- silently replacing retained planning evidence with a refresh or live result

Unavailable, stale, partial, unknown, and retained evidence must remain visibly and semantically different. A derived result cannot upgrade its inputs' status.

## Mission and activation time model

### Current mismatch

The current implementation records an important boundary that 2.8-01 must resolve:

- SmartDeploy rejects missions longer than 12 hours.
- Mission-window propagation samples only start, midpoint, and end.
- Mission Forecast already works from the full retained mission interval.
- Activation currently copies `missionWindow` but does not persist an actual operating start or end.
- `ActivationFoundationPanel` references `startedAtUtc` even though the current Activation schema does not define or populate it.

### MissionWindow

`MissionWindow` is the overall field-planning interval. It may span a realistic weekend and is bounded to a maximum of seven days as a deliberate single-operator field-product constraint. It supplies forecast and retained planning/model context.

Three representative P.533 samples do not claim continuous P.533 coverage. Existing output must say that it represents samples at start, midpoint, and end and must not imply a continuous multi-day forecast or trend.

### Activation operating window

The Activation operating window is the actual bounded operating event inside the mission:

- `startedAtUtc` is set when `planned -> active` succeeds.
- `endedAtUtc` is set when `active -> completed` succeeds.
- A completion before a start is rejected.
- Each lifecycle transition records its timestamp once; retries do not rewrite the original event time.
- Only one active Activation remains the current invariant; existing reconciliation behavior is preserved.
- The copied `missionWindow` remains planning context and is never relabeled as the actual operation.

Future implementation must define explicit backward-compatible schema and store migration behavior for existing persisted Activations, SmartDeploy briefs, QSOs, and REVIEW paths. Migration must preserve readable historical records, distinguish absent historical operating timestamps from known values, and avoid fabricating start/end times. No migration is implemented in this task.

## Operator goals and progress

The initial deterministic goal vocabulary is:

- `secure_activation`
- `maximize_contacts`
- `chase_dx`
- `explore_bands`

`balanced` is not adopted until its behavior can be defined deterministically.

An Activation-owned operating objective contains:

- goal
- `requiredQsoCount` when applicable
- threshold provenance
- relevant deadline when applicable
- deadline basis and provenance
- operator-visible label

QSO progress comes from persisted Activation-owned QSOs. A deadline remains explicit: mission end, UTC rollover, and qualification deadline are different concepts and must not be silently treated as equivalent.

Program defaults may be proposed only as visible, editable defaults with explicit provenance. They must never masquerade as live provider evidence or immutable external rules. Missing threshold or deadline values remain missing rather than being inferred.

## TX Context

An Activation owns a sequence of bounded TX Context segments. Each segment supports:

- segment ID
- Activation ID
- `startedAtUtc`
- `endedAtUtc` or active/open state
- radio/setup label
- antenna label
- transmit power in watts
- band
- mode
- optional frequency
- per-field provenance where values come from different sources

Required provenance distinctions:

- radio/setup, antenna, and PSKReporter-associated power are operator/session supplied;
- band, mode, and frequency may be operator supplied or WSJT-X application-reported;
- WSJT-X is not CAT, direct-radio state, PTT state, or proof of RF transmission;
- PSKReporter proves only that a compatible receiver reported the signal;
- WSPR-reported power is source-reported WSPR evidence.

Changing actual setup closes the prior segment and opens a new one. Planned SmartDeploy equipment may initialize visible suggestions, but it cannot be silently promoted to actual TX evidence. V2.8 does not create a reusable inventory or loadout system.

## Station Signal Observation

A Station Signal Observation is evidence associated with:

- one Activation
- one TX Context segment
- one bounded observation interval
- one evidence source

For PSKReporter, candidate retained measurements may include:

- matching reports
- unique receivers
- observation duration and exposure
- reports per minute
- unique receivers per minute
- nearest, median, and farthest locator-derived distance where locators support it
- geographic and path distribution
- SNR distribution
- newest report
- freshness and status

Distance derived from Maidenhead locator centers is approximate. Reports per minute measure reports during observed exposure; they are not a probability of contact. No reports means exactly `No matching reports observed`. Raw counts across unequal exposure periods are not directly comparable. Finalized comparisons require intentionally retained observation summaries because the current Observed RF cache is rolling and ephemeral.

Station-specific observation is not station success, contact probability, or proof of RF transmission unless a separate accepted evidence source establishes that fact. General observed RF remains separate from station-specific observation.

## PSKReporter feasibility decision

Current implementation facts:

- `ObservedRfService` owns the singleton MQTT connection.
- Current subscriptions are operating-grid sender/receiver-locator filters.
- Normalized reports already contain sender and receiver callsigns, locators, frequency, band, mode, SNR, timestamps, direction, and provenance.
- MY SIGNAL can initially filter compatible outbound reports where `senderCallsign` matches the configured operator callsign.
- No second MQTT connection is permitted.

The current grid-filtered feed does not establish the total same-window, same-band, same-mode population of compatible reporting receivers. Therefore V2.8 must not initially calculate or display an `observable receiver population ratio` or imply `percent of stations hearing me`.

A later implementation investigation may determine whether additional subscriptions on the same singleton service can rigorously and safely supply a defined denominator. Absence of that denominator does not block MY SIGNAL.

## Deterministic guidance

Guidance is rule-based and explainable. Every recommendation exposes:

- recommendation category
- suggested band and mode when supportable
- reasons
- evidence references
- limitations
- `evaluatedAtUtc`
- the goal, progress, and deadline inputs used

The following questions remain distinct:

- best current contact opportunity
- best relative station performance, only where normalization is defensible
- best reach
- best modeled opportunity
- best mission strategy

They must not be collapsed into one universal `best band`.

Guidance must degrade honestly when evidence is missing, stale, conflicting, or not applicable. Disagreement between P.533 and live evidence is a reason to expose both evidence families and their limitations, not a reason to invent a winner or confidence score.

### Required acceptance scenarios

Future guidance and contract tests must cover:

1. Ample time plus `chase_dx`: prioritize a defensible reach-oriented opportunity and expose the modeled/observed reasons and limitations.
2. Activation secured plus `explore_bands`: preserve exploration as the objective and avoid converting it into a hidden contact-count target.
3. `6/10` QSOs with 30 minutes remaining: use persisted progress and an explicit deadline to show the deterministic qualification strategy inputs.
4. `8/10` QSOs with 10 minutes remaining: show the changed urgency inputs without claiming a guaranteed completion.
5. Missing or stale online evidence: retain usable planning/model context and mark online evidence unavailable or stale.
6. Zero MY SIGNAL reports: show `No matching reports observed`, never `bad propagation` or a failure score.
7. P.533/live disagreement: present separate evidence, reasons, and limitations without silently replacing either source.

## Slice plan

The slices and dependencies are:

1. **2.8-01 - Operational Intelligence Contract & Time Model**
2. **2.8-02 - Duration-Aware Retained Mission Forecast**
3. **2.8-03 - Station Signal Observation / MY SIGNAL**
4. **2.8-04 - Layered Propagation Picture**
5. **2.8-05 - Mission-Aware Operating Guidance**
6. **2.8-06 - WSPR Survey Experiment with explicit go/no-go gate**
7. **2.8-07 - Integrated Operational Intelligence & CF-20 Field Validation**

2.8-01 precedes all semantic consumers. 2.8-03 precedes 2.8-04. 2.8-04 precedes 2.8-05. 2.8-06 is removable without blocking the release. 2.8-07 integrates accepted slices.

### 2.8-01 - Operational Intelligence Contract & Time Model

- **Purpose:** Freeze shared time, objective, provenance, TX Context, and observation semantics before consumer work.
- **Implementation boundary:** SmartDeploy duration validation, Activation operating timestamps, backward-compatible persistence migration, Activation-owned objective, and contract types only.
- **Acceptance gates:** The exact gates in the 2.8-01 section below.
- **Excluded scope:** Provider connections, recommendation engine, WSPR, MY SIGNAL UI, equipment inventory/loadouts, and new radio control.
- **Automated validation:** Focused contract/store/API/UI tests, full automated suite, TypeScript, production build, and `git diff --check`, subject only to already documented unrelated test behavior.
- **Hardware acceptance:** None for this contract slice; hardware is required only for integrated acceptance where a later slice names it.

### 2.8-02 - Duration-Aware Retained Mission Forecast

- **Purpose:** Make retained forecast coverage and status honest across the seven-day mission interval while presenting a useful amount of information for the mission duration.
- **Implementation boundary:** Forecast retrieval, preservation of underlying hourly Open-Meteo evidence, duration-aware aggregated operating periods, coverage, freshness, horizon diagnostics, and explicit interval applicability. Aggregation belongs to 2.8-02 and is not pulled into 2.8-01.
- **Underlying evidence:** The retained forecast record preserves the underlying hourly Open-Meteo evidence. Aggregated periods are a presentation/derived view over that evidence, not a replacement for it.
- **Duration-aware presentation:** Short missions retain a useful hourly presentation. Longer or multi-day missions present understandable aggregated operating periods instead of dozens of hourly rows. Candidate labels include Morning, Midday, Afternoon, Evening, and Overnight. The exact UTC/local-boundary handling must be selected and documented during 2.8-02 design; implementation must not silently mix UTC evidence with unlabeled local periods.
- **Aggregated period contract:** Each period exposes its covered start and end, temperature range rather than a misleading single temperature, maximum precipitation probability, sustained-wind range or representative range, maximum gust, significant or worst applicable condition, provider, retrieval time, freshness/retained status, and limitations. Each period must be traceable to its underlying hourly evidence.
- **Aggregation constraints:** Aggregation must not invent precision, interpolate missing hours, hide partial coverage, or replace the retained hourly source evidence. Missing hours and incomplete coverage remain explicit. A deliberate refresh remains distinguishable from the previously retained forecast; no automatic or silent replacement of retained planning evidence is allowed.
- **Acceptance gates:** The exact gates in the 2.8-02 section below.
- **Excluded scope:** P.533 redesign, station observations, guidance, inventory, and control.
- **Automated validation:** Provider fixtures and presentation tests for short hourly, Friday-through-Sunday compact aggregation, partial coverage, missing hours within a period, provider-unavailable with and without retained evidence, refresh distinction, labeling, and hourly-source preservation; typecheck and focused API/store tests.
- **Hardware acceptance:** None unless the final integrated workflow requires a CF-20 offline/online retrieval check.

#### 2.8-02 acceptance gates

The future 2.8-02 implementation is accepted only when all of these are true:

1. A short mission presents useful hourly forecast evidence without requiring aggregation to hide the underlying time resolution.
2. A realistic Friday-through-Sunday mission presents compact, understandable aggregated operating periods rather than dozens of hourly rows.
3. Aggregated periods use documented UTC or local boundaries; every period is labeled so UTC evidence is never silently presented as an unlabeled local period.
4. Every aggregated period exposes covered start and end, temperature range, maximum precipitation probability, sustained-wind range or representative range, maximum gust, significant/worst applicable condition, provider, retrieval time, freshness/retained status, and limitations.
5. Every aggregated value derives transparently from the underlying hourly evidence, with enough references or structured linkage to inspect that source evidence.
6. Partial provider coverage remains visible at both hourly and aggregated-period presentation levels.
7. Missing hours inside an otherwise covered period are visible; the implementation does not interpolate them, invent precision, or imply complete coverage.
8. When the provider is unavailable but existing retained evidence is present, the retained record remains readable and visibly identified as retained/stale or otherwise applicable, and the failed refresh is distinguishable.
9. When the provider is unavailable and no retained evidence exists, the forecast is explicitly unavailable with a bounded diagnostic and no fabricated period values.
10. Source, retrieval time, freshness/retained status, and coverage are clearly labeled for both the retained hourly record and aggregated presentation.
11. The complete underlying hourly Open-Meteo evidence remains preserved in the retained forecast record and is not replaced by aggregated periods.
12. A deliberate refresh is visibly distinguishable from the previously retained forecast, and no automatic or silent replacement of retained planning evidence occurs.

### 2.8-03 - Station Signal Observation / MY SIGNAL

- **Purpose:** Associate bounded, honest station-specific observed-RF summaries with an Activation and TX Context segment.
- **Implementation boundary:** Same singleton ObservedRfService, compatible outbound filtering, bounded observation intervals, retained summaries, provenance, and no-denominator semantics.
- **Acceptance gates:** No second MQTT connection; reports are tied to the correct Activation/segment and interval; zero reports has the exact no-match meaning; unequal exposure is not compared as raw counts; receiver-population ratios are absent until rigorously supported.
- **Excluded scope:** Radio control, transmit proof, generalized station success scoring, spotting, external logs, and a second broker connection.
- **Automated validation:** Parser/filter fixtures, mixed provenance tests, interval/freshness tests, retention tests, denominator regression tests, and API tests.
- **Hardware acceptance:** Later CF-20 observation may verify live traffic and coexistence, but no hardware claim is required to define the contract.

### 2.8-04 - Layered Propagation Picture

- **Purpose:** Present modeled, environmental, general observed-RF, and station-specific evidence as separate layers.
- **Implementation boundary:** Deterministic assembly, source/freshness/applicability labels, conflicts, and limitations.
- **Acceptance gates:** Each layer remains attributable; three-point P.533 coverage is labeled representative; general observed RF is not station success; stale/missing layers degrade independently; no universal best-band score is introduced.
- **Excluded scope:** Guidance objectives/deadlines, AI, equipment optimization, and control.
- **Automated validation:** Layer assembly fixtures for complete, partial, stale, unavailable, zero-match, and disagreement cases.
- **Hardware acceptance:** None beyond the integrated field validation slice.

### 2.8-05 - Mission-Aware Operating Guidance

- **Purpose:** Turn accepted layered evidence and Activation objective/progress/deadline inputs into explainable next-step guidance.
- **Implementation boundary:** Deterministic rules, categories, reasons, references, input disclosure, and limitations.
- **Acceptance gates:** All required acceptance scenarios pass; recommendations do not claim certainty; deadline basis remains explicit; missing evidence produces honest degraded guidance.
- **Excluded scope:** Generalized AI recommendations, equipment selection, endurance strategy, radio control, spotting, and external submissions.
- **Automated validation:** Scenario tests for all seven required cases, deterministic repeatability tests, provenance/reference tests, and UI rendering tests.
- **Hardware acceptance:** Field validation is deferred to 2.8-07.

### 2.8-06 - WSPR Survey Experiment

- **Purpose:** Investigate whether a bounded WSPR survey can add useful source-reported evidence without contaminating operator context.
- **Implementation boundary:** A removable experiment with explicit source-reported semantics, cost, retention, and a go/no-go decision.
- **Acceptance gates:** Define a measurable question, source and sampling interval, operator burden, storage/retention, limitations, and a go/no-go review before making it a release dependency. WSPR power remains source-reported WSPR evidence.
- **Excluded scope:** Required V2.8 guidance, automatic transmit, CAT/PTT, permanent infrastructure, and generalized propagation truth.
- **Automated validation:** Contract fixtures for accepted, unavailable, stale, malformed, and rejected experimental evidence; removal test proving 2.8 remains buildable and useful without the slice.
- **Hardware acceptance:** Optional experiment only; no CF-20 release gate unless the explicit go/no-go decision adds one.

### 2.8-07 - Integrated Operational Intelligence & CF-20 Field Validation

- **Purpose:** Integrate accepted slices into PLAN -> PREPARE -> OPERATE -> REVIEW and validate the complete single-operator field workflow.
- **Implementation boundary:** Cross-slice wiring, retained review summaries, field diagnostics, and documented CF-20 acceptance.
- **Acceptance gates:** Accepted slices remain separated and explainable; offline/manual operation remains useful; retained summaries survive the workflow; all field evidence names source, timing, status, applicability, and limitations.
- **Excluded scope:** V3 equipment/loadouts/resources, enterprise/fleet work, radio control, and unapproved experiments.
- **Automated validation:** Full suite, typecheck, production build, contract regression suite, and release-specific diff/metadata checks.
- **Hardware acceptance:** CF-20 validation must exercise the complete lifecycle, evidence degradation, actual TX Context changes, supported live integrations, and review of retained facts without treating application evidence as direct-radio proof.

## 2.8-01 implementation acceptance gates

The future 2.8-01 implementation is accepted only when all of these are true:

1. SmartDeploy accepts a valid multi-day mission up to seven days and rejects longer or invalid intervals.
2. Mission-window semantics remain planning semantics.
3. Existing three-point P.533 output explicitly states representative-sample coverage and does not claim continuous multi-day coverage.
4. Activation persistence gains actual operating-window timestamps with safe migration from existing records.
5. `planned -> active` records the actual start time once.
6. `active -> completed` records the actual end time once.
7. Invalid or reversed operating windows are rejected.
8. Existing one-active-Activation reconciliation remains intact.
9. Activation can retain one supported operator goal, optional success threshold, and optional explicit deadline with provenance.
10. Existing QSO ownership and counts remain unchanged.
11. Planned station data remains distinct from actual TX Context.
12. TX Context and Station Signal Observation contracts can represent mixed provenance without requiring inventory/loadouts.
13. Old persisted SmartDeploy briefs, Activations, QSOs, and REVIEW paths remain readable.
14. No provider connection, recommendation engine, WSPR integration, MY SIGNAL UI, or equipment inventory is implemented in 2.8-01.
15. Focused tests, full automated suite, TypeScript, production build, and `git diff --check` pass, subject only to already documented unrelated test behavior.

## UX placement

The existing phase contract remains **PLAN -> PREPARE -> OPERATE -> REVIEW**. A second giant stacked workspace is prohibited.

- **PLAN:** mission window, retained forecast, retained modeled evidence, and operating-objective defaults.
- **PREPARE:** confirm the Activation objective and initial TX Context; an optional WSPR survey may appear later.
- **OPERATE:** actual operating window, QSO progress, Current Station, active TX Context, MY SIGNAL, live activity, and recommendations.
- **REVIEW:** retained mission facts, actual Activation timing, QSOs, operator-declared TX segments, and only explicitly persisted/finalized observation summaries.

Each concept has one primary home. Other phases may show compact context, but must not duplicate or relabel evidence. Technical details remain available without making the normal field workflow an undifferentiated evidence dump.

## Document status and change control

This document is the authoritative Version 2.8 planning contract and architecture boundary. It records no production implementation. It does not change schemas, tests, package versions, release metadata, tags, releases, deployment artifacts, or hardware acceptance evidence.

Any future implementation must name the contract section and acceptance gate it satisfies. A new evidence family, provider, goal, deadline meaning, or equipment concept requires an explicit contract revision and independent review rather than an implicit extension of a consumer.
