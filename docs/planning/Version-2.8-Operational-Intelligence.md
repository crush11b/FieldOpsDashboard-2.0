# Version 2.8 - Operational Intelligence

- Status: V2.8-01 through V2.8-05 are merged into `main`; V2.8-07 is the source-complete integration candidate pending CF-20 hardware acceptance
- Baseline: Version 2.7.0 - Connected Operations
- Current integration slice: 2.8-07 Integrated Operational Intelligence & CF-20 Field Validation
- Supported deployment: single operator on one locally operated Windows field computer
- Release gate: V2.8 publication requires independent review of the V2.8-07 integration candidate, successful CF-20 hardware acceptance, and a separate explicit release decision

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

The V2.8-01 implementation defines explicit backward-compatible Activation schema and store-wrapper migration behavior. Migration preserves readable historical records, distinguishes absent historical operating timestamps from known values, avoids fabricating start/end times, and remains restart-safe when migrated records are reloaded before later lifecycle transitions.

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

Station-specific observation is not station success, contact probability, or proof of RF transmission unless a separate accepted evidence source establishes that fact. General observed RF remains separate from station-specific observation. Required fields and consistency rules preserve zero-evidence semantics: zero matching reports means zero unique receivers and a null newest-report timestamp; positive matching reports require a newest-report timestamp; receiver counts, distance summaries, SNR summaries, and limitations are bounded and internally consistent.

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

2.8-01 precedes all semantic consumers. 2.8-03 precedes 2.8-04. 2.8-04 precedes 2.8-05. 2.8-01 through 2.8-05 are merged into `main`. 2.8-06 is removable without blocking the release and remains deferred/no-go for this release. 2.8-07 integrates accepted slices.

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

#### 2.8-03 implementation evidence

Implemented and merged into `main`. `OperationalIntelligenceStore` persists versioned TX Context segments and Station Signal Observations under the normal local application-data directory using atomic JSON replacement. Reads skip malformed entries with bounded diagnostics and never rewrite the store; invalid or unsupported stores reject mutations and are reported as unavailable by the API. Opening a new context closes the prior open segment for that Activation, and every Activation path that reconciles or completes an Activation closes remaining operational segments through the API callback boundary.

The API provides Activation-scoped listing, server-generated TX Context replacement, and observation capture. Capture consumes the existing injected `ObservedRfService` snapshot and matches only compatible outbound PSKReporter reports from the configured operator callsign, context band/mode, and exact positive intersection of the context, Activation, snapshot, and current-time intervals. It retains counts, exposure rates, locator-center distance summaries, SNR summaries, source status, newest matching report, and limitations. Zero matches retain exactly `No matching reports observed` with zero receivers, zero rates, a null newest-report timestamp, and no distance/SNR object. No receiver denominator, ratio, confidence, rating, contact probability, or transmission proof is produced. Lifecycle, callsign, source-status, missing-segment, closed-segment, interval, and persistence failures map to explicit API statuses.

Focused contract/store/API tests pass. The follow-on MY SIGNAL UI presents compact TX Context controls during OPERATE, explicit capture from the singleton observed-RF source, exposure-normalized retained summaries, exact zero-report meaning, and read-only TX Context/observation history during REVIEW. Radio control, transmit proof, WSPR, spotting, hardware acceptance, and broader layered-evidence integration remain pending later slices.

### 2.8-04 - Layered Propagation Picture

- **Purpose:** Present modeled, environmental, general observed-RF, and station-specific evidence as separate layers.
- **Implementation boundary:** Deterministic assembly, source/freshness/applicability labels, conflicts, and limitations.
- **Acceptance gates:** Each layer remains attributable; three-point P.533 coverage is labeled representative; general observed RF is not station success; stale/missing layers degrade independently; no universal best-band score is introduced.
- **Excluded scope:** Guidance objectives/deadlines, AI, equipment optimization, and control.
- **Automated validation:** Layer assembly fixtures for complete, partial, stale, unavailable, zero-match, and disagreement cases.
- **Hardware acceptance:** None beyond the integrated field validation slice.

#### 2.8-04 implementation evidence

Implemented and merged into `main`. A deterministic client-domain assembler produces exactly four separately attributable layers: retained representative P.533 modeling, retained environmental evidence, general PSKReporter observed RF, and Activation/TX-Context-scoped MY SIGNAL observations. Each layer carries its own source, timing, applicability, freshness/state, summary, and limitations; missing and stale layers degrade independently.

The OPERATE presentation reads existing local APIs and the singleton observed-RF snapshot without adding a provider connection. REVIEW uses retained review evidence and does not request live band activity. Explicit layer-difference statements identify a current TX band outside the representative modeled strongest-band set, general activity without matching station reports, and unequal freshness without treating those differences as contradictions or scores. No universal best-band score, confidence score, contact probability, recommendation, or guarantee is produced.

### 2.8-05 - Mission-Aware Operating Guidance

- **Purpose:** Turn accepted layered evidence and Activation objective/progress/deadline inputs into explainable next-step guidance.
- **Implementation boundary:** Deterministic rules, categories, reasons, references, input disclosure, and limitations.
- **Acceptance gates:** All required acceptance scenarios pass; recommendations do not claim certainty; deadline basis remains explicit; missing evidence produces honest degraded guidance.
- **Excluded scope:** Generalized AI recommendations, equipment selection, endurance strategy, radio control, spotting, and external submissions.
- **Automated validation:** Scenario tests for all seven required cases, deterministic repeatability tests, provenance/reference tests, and UI rendering tests.
- **Hardware acceptance:** Field validation is deferred to 2.8-07.

#### 2.8-05 implementation evidence

Implemented and merged into `main`. A pure deterministic assembler consumes the persisted Activation objective, actual QSO count, explicit deadline/basis/provenance, current TX Context, and the four separately attributable propagation layers. Its result discloses category, urgency, suggested context when supportable, reasons, evidence references, complete input values, limitations, and evaluation time.

The OPERATE and REVIEW presentations show the same bounded guidance contract. Qualification urgency changes only from persisted progress and an explicit deadline; the planned mission window is not silently treated as an operating deadline. Exploration and DX objectives remain distinct, missing/stale online evidence degrades explicitly, zero MY SIGNAL reports preserve the exact non-failure meaning, and modeled/live disagreement retains both sources. No confidence score, universal best band, success prediction, automatic control, spotting, or external submission is introduced.

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

## V2.8-07 integration evidence and release status

V2.8-01 through V2.8-05 are merged into `main`. V2.8-06 WSPR remains optional and deferred/no-go for this release; it is not a V2.8 release dependency. V2.8-07 is a source-complete integration candidate, not a hardware-accepted or published release.

The V2.8-07 integration validation exercises the real Activation and operational-intelligence API boundaries through planned brief initialization, activation start, persisted objective/deadline, TX Context creation, zero-report observation capture, completion closure, and retained operational-intelligence retrieval. The complete automated suite, focused V2.8 contract/UI suite, TypeScript check, production build with P.533 verification, and `git diff --check` are release-candidate gates. The integrated workflow preserves PLAN -> PREPARE -> OPERATE -> REVIEW semantics, retained Review evidence, independent degradation, and offline/manual usefulness; it does not add provider, WSPR, CAT/PTT, spotting, submission, inventory, loadout, or enterprise behavior.

Remaining CF-20 acceptance checklist:

- Exercise a complete PLAN -> PREPARE -> OPERATE -> REVIEW activation on the supported Panasonic ToughBook CF-20.
- Verify multi-day retained forecast presentation, UTC boundaries, partial/missing coverage, refresh failure, and offline retained readability.
- Verify actual Activation start/end timestamps, persisted QSO progress, TX Context replacement, completion/reconciliation closure, and restart behavior.
- Verify retained MY SIGNAL observations remain tied to the correct Activation and TX Context interval, including zero matching reports.
- Verify modeled, environmental, general observed RF, and MY SIGNAL layers remain separately attributable during online, stale, partial, unavailable, and disagreement conditions.
- Verify guidance exposes objective, progress, deadline provenance, reasons, references, evaluation time, and limitations without implying transmission or contact success.
- Record hardware evidence and operator observations before any V2.8 release publication decision.

### Pre-V3.0 App Library roadmap boundary

The existing Dashboard **FIELD APPLICATIONS CATALOG** / App Library requires a dedicated review and improvement slice before V3.0. Detailed requirements will be derived from the operator-maintained application spreadsheet in a later planning task. V2.8-07 must not infer, design, import, or implement spreadsheet fields, and must not modify `AppLauncherGrid`, `AutoAppInstallerModal`, application data, launcher behavior, or installation behavior. This item is not a V2.8 release blocker unless this review discovers a regression in existing behavior.

## Document status and change control

This document is the authoritative Version 2.8 planning contract and architecture boundary. The dated evidence below records merged implementation evidence through V2.8-07 integration. It does not claim CF-20 hardware acceptance or V2.8 release publication and does not change package versions, release metadata, tags, releases, or deployment artifacts.

### 2026-09-03 - 2.8-01 implementation evidence

- SmartDeploy mission windows now accept up to seven days and reject longer or invalid intervals; the mission window remains planning context.
- P.533 remains a start, midpoint, and end representative sample and now discloses that it is not continuous multi-day coverage.
- Activation schema and store v2 retain actual start/end timestamps and structured objectives. Schema/store v1 records are normalized in memory with explicit `unknown_historical` timing where actual timestamps are absent, without fabrication or read-time rewrite; strict lifecycle transitions use one injected clock value.
- Review and Foundation surfaces distinguish actual operating timing from the planned mission window and identify migrated historical timing as unknown.
- TX Context uses exactly `operator_entered`, `operator_confirmed_plan`, and `wsjtx_application` with complete field-specific provenance. Station Signal Observation distinguishes PSKReporter observed reception from WSPR source-reported power and rejects synthetic denominator/confidence fields. No provider, persistence, MY SIGNAL UI, recommendation rule, WSPR access, inventory/loadout, CAT/PTT, or release work is included.
- Validation evidence: focused correction tests pass (67 tests); TypeScript check passes; production build passes; full automated suite passes (94 files, 971 tests); `git diff --check` passes.

### 2026-09-03 - 2.8-02 implementation evidence

- Retained mission forecasts preserve complete hourly Open-Meteo evidence and add schema/store v2 derived operating periods. Schema/store v1 records created with the earlier inclusive mission-end filter are normalized in memory with non-overlapping exact-end rows excluded and a bounded diagnostic; records remain readable across restart without a read-time rewrite and are upgraded to v2 only by an explicit save.
- UTC is the sole presentation boundary because the provider request and retained metadata are UTC and the planning contract has no reliable mission-site timezone. Missions of 12 hours or less present hourly evidence; longer missions present fixed six-hour UTC buckets labeled Overnight, Morning, Afternoon, or Evening as applicable.
- Aggregates expose clipped UTC coverage, temperature range, maximum precipitation probability, sustained-wind range, optional maximum gust, deterministic worst-condition severity, provider, retrieval time, freshness, coverage, limitations, and indexes/timestamps linking back to hourly rows. Missing hours remain visible and are never interpolated; provider gaps are partial rather than fabricated.
- Explicit refresh remains the only replacement path. A failed provider refresh preserves the prior record as retained/stale, while an unavailable forecast without retained evidence returns an explicit empty state.
- Validation evidence: final focused compatibility suite passes (56 tests); TypeScript check passes; production build passes; final full automated suite passes (94 files, 987 tests); `git diff --check` passes. All twelve 2.8-02 acceptance gates remain demonstrated by the implementation and regression coverage.

Any future implementation must name the contract section and acceptance gate it satisfies. A new evidence family, provider, goal, deadline meaning, or equipment concept requires an explicit contract revision and independent review rather than an implicit extension of a consumer.
