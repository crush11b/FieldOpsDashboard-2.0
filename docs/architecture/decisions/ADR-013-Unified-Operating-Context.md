# ADR-013: Unified Operating Context

- Status: Accepted for V3.0 implementation
- Date: 2026-09-14
- Scope: V3.0 composed operating-context read model
- Related planning: `docs/planning/Version-3.0-Cohesive-Field-Operations.md`

## Context

FieldOps already has accepted authorities for operating location, activation lifecycle, mission window, operator objective, current station state, network/system telemetry, weather, propagation, observed activity, station-specific reception, and QSO results. These authorities were built in separate product slices and are consumed by panels with partially different assumptions about time, location, freshness, and applicability.

V3.0 must make those meanings consistent across PLAN, PREPARE, OPERATE, and REVIEW without moving every domain into a new store or generalized provider framework. The first confirmed defect is forecast display: the server preserves UTC retrieval but also creates a UTC-formatted display string that the dashboard presents as though it were local time.

## Decision drivers

- Preserve V2.9.1 domain ownership and accepted behavior.
- Make time, location, activation, connectivity, station state, and evidence applicability consistent.
- Keep UTC canonical in persistence and service contracts.
- Avoid duplicated mutable state and cross-panel interpretation drift.
- Retain the single-operator, local-first, offline-capable product boundary.
- Introduce abstractions only where a named V3.0 consumer proves their value.

## Decision

FieldOps will use a typed `OperatingContextSnapshot` as a composed read model over existing domain authorities.

The snapshot is immutable at its observation time and contains references or normalized projections for:

- observation time in UTC;
- presentation-timezone policy;
- operating location, source, age, status, and quality;
- activation identity, lifecycle state, mission window, entity set, and operator intent;
- current station band, frequency, and mode with source and freshness;
- local Agent, local network, and Internet connectivity state;
- evidence source, age, status, applicability, and limitations.

Existing stores and adapters remain authoritative. A consumer must not write through the snapshot or persist it as an independent source of truth. The snapshot may be retained only as explicit historical evidence when a domain contract requires an immutable observation, and that retained record must identify its originating authorities and observation time.

Implementation will proceed through named consumers rather than a speculative all-product framework. The first consumer is forecast-time presentation.

## Time contract

- UTC timestamps are canonical in service payloads, persistence, caches, comparisons, and evidence records.
- Services do not create locale-formatted display labels for timestamps.
- Presentation formatting occurs at the UI boundary under an explicit timezone policy.
- Live/current-location weather defaults to the device IANA timezone.
- Remote planned-location weather uses an explicitly retained target IANA timezone when available.
- When a remote target timezone is unknown, the UI displays UTC rather than silently using the device zone.
- The operator may explicitly select device, UTC, or a named IANA timezone.
- The displayed zone abbreviation or numeric offset remains visible, including repeated daylight-saving-transition hours.

## Location contract

The operating-location authority continues to resolve live, cached/stale, and manual planning locations according to the accepted source priority. A lower-priority source cannot overwrite a higher-priority current source. Manual planning coordinates never become a claimed live GPS fix.

Location-dependent consumers use the same resolved coordinates and provenance. Precision-derived values, including Maidenhead locators, identify their precision and limitations.

## Activation and entity contract

The current activation remains the operation lifecycle authority. V3.0 may extend it to multiple operating entities, but the composed context does not create or mutate activations. A QSO snapshots its applicable entity set at logging time so later context changes do not silently alter historical records.

## Connectivity contract

Connectivity distinguishes:

- Local Agent availability;
- local network/interface connectivity;
- Internet reachability;
- missing or stale telemetry.

An interface type, SSID, or local connection does not prove Internet reachability. A missing SSID does not mean disconnected. Sensitive network identifiers remain outside the normal UI.

## Evidence contract

The composed context preserves the V2.8 and V2.9 evidence families. It may identify relationships and applicability but cannot upgrade the truth status of an input. In particular:

- modeled evidence is not measured evidence;
- general observed RF is not station-specific reception;
- a spot is not propagation proof;
- absence of occupancy evidence does not prove a clear frequency;
- a recommendation is derived guidance and must expose its named inputs and limitations.

## Non-goals

This decision does not authorize:

- a replacement state store or database migration;
- a generalized provider framework;
- AI-generated operating facts;
- CAT, PTT, tuning, transmit, spotting, or submission;
- remote administration or cloud accounts;
- rewriting accepted V2.9.1 domain behavior without a slice-specific contract.

## Alternatives considered

### Continue panel-specific composition

Rejected because the confirmed weather defect and existing fragmentation show that separate interpretation at each panel boundary will continue to produce inconsistent time, provenance, and applicability behavior.

### Create one new mutable global operating-context store

Rejected because it would duplicate existing authorities, introduce synchronization races, complicate migration, and make source ownership less clear.

### Move all authorities into SQLite first

Rejected because the approved rebaseline requires a concrete need before generalizing persistence. The current atomic, versioned local stores remain adequate for the first V3.0 slices.

### Build the legacy generalized AI Context Engine

Rejected for the initial V3.0 implementation. Operating context is deterministic product state. Advice may consume it later, but a model is not the authority for its facts.

## Consequences

### Positive

- Time, location, connectivity, activation, and evidence semantics become reusable and testable.
- New V3.0 features can consume one consistent contextual projection.
- Existing domain ownership and rollback boundaries remain intact.
- UI presentation errors can be fixed without converting stored data.

### Negative

- Adapters are required between existing authorities and the composed view.
- Consumers must be migrated incrementally, so temporary parallel paths require regression tests.
- Historical context retention still requires explicit domain-specific snapshot decisions.

## Verification

- Unit tests cover context composition from live, cached, stale, manual, unavailable, and error inputs.
- Time tests cover named IANA zones, UTC, spring-forward gaps, fall-back repeated hours, and UTC/date boundaries.
- Location tests prevent manual planning coordinates from being presented as live GPS.
- Connectivity tests distinguish Agent, interface, SSID, and Internet state.
- Evidence tests preserve family, source, age, status, and applicability.
- Consumer tests prove that no locale-formatted timestamp or fabricated fallback crosses a service boundary.
