# Version 2.4 POTA Activation-Target Decision

- Status: **Approved sequencing decision / implementation-ready planning slice**
- Date: 2026-08-17
- Release: Version 2.4 - Field Tools
- Roadmap task ID: **None assigned**
- Related authority: [FieldOpsDashboard Project Rebaseline 2026](FieldOpsDashboard_Project_Rebaseline_2026.md)
- Selected capability: **POTA activation-target lookup and offline-aware planning context**

## Decision summary

POTA is selected as the next Version 2.4 operator-facing slice. This is a new sequencing decision under the approved 2026 rebaseline. It does not create, rename, or renumber a historical roadmap or backlog task.

POTA is selected before SOTA because the current product already contains POTA-oriented operator configuration and logging fields, while the immediate operator problem is concrete and narrow: identify a park, verify its basic location context, and use that location for planning without replacing the live operating location. SOTA remains the follow-up provider using the same activation-target concept after this slice proves useful in field operation.

This decision follows the rebaseline priorities:

1. Operator value: a park reference becomes a usable planning target.
2. Trustworthy information: source, freshness, limitations, and failure states remain visible.
3. Reliable local operation: the backend owns external access and bounds failures.
4. Offline usefulness: the selected park may remain available from a bounded last-known-good cache.
5. Maintainability: one narrow provider and one internal target shape are sufficient.
6. Proportionate security: no credentials, privileged operations, or remote access are introduced.
7. Future scalability: the target concept is reusable without creating a provider framework.

Propagation remains closed as **FUNCTIONAL / MVP ACCEPTED - REFINEMENT BACKLOG** and is not a dependency for this slice.

## Operator problem and first workflow

The first useful workflow is:

1. Operator opens Field Tools.
2. Operator enters a POTA reference such as `US-0182`.
3. The local backend performs an individual POTA lookup when network access is available.
4. A valid response is normalized into an internal activation-target representation.
5. Field Tools displays the park under an explicit **PLANNING TARGET** label.
6. The target view shows the park reference and name, coordinates, Maidenhead grid, source state, and source age where available.
7. Existing Field Tools calculations use the planning target as a destination for distance, bearing, and relevant solar/twilight calculations.
8. The live or manual operating location remains separately labeled and unchanged.

The first slice is read-only. It does not submit an activation, create a spot, manage spots, or persist a QSO/session.

## POTA upstream decision

### Chosen source

Use the POTA-hosted structured individual park route:

`GET https://api.pota.app/park/{reference}`

The backend, not the browser, calls this route. The reference is normalized and validated before it is placed in the URL. The provider must use a fixed HTTPS origin and a bounded request timeout.

### Findings

The route was tested with `GET https://api.pota.app/park/US-0182` and returned `200 application/json` with a single park object. The observed object included:

- `reference`
- `name`
- `latitude` and `longitude`
- `grid4` and `grid6`
- `parktypeDesc`
- `locationDesc` and `locationName`
- `entityName`
- `agencies` and agency URLs
- park and website URL fields when present
- administrative identifiers and activation-history fields

A syntactically valid unknown reference such as `US-0000` returned `200` with JSON `null`.

The collection routes tested (`/parks` and `/parks?entityId=291`) returned `403`. The first slice therefore does not depend on a bulk collection endpoint or a complete local park mirror.

The individual response advertised `Cache-Control: public, max-age=3600, immutable`. This is useful operational cache guidance, but it is not a complete API contract.

### Authentication and usage

No authentication was required for the tested individual lookup. The implementation must still identify itself with a product user agent, use one request per explicit operator lookup, apply a timeout, avoid polling, and avoid retry storms. No rate limit was found in the public documentation reviewed. The absence of a published limit is an operational risk, not permission for high-volume access.

### Contract and stability risk

The individual route is practical and official-looking, but no public, versioned API contract or schema guarantee was found in the POTA documentation reviewed. The route must therefore be treated as an external compatibility dependency:

- validate every field;
- tolerate nullable optional fields;
- reject malformed coordinates and identity fields;
- keep the adapter isolated behind an internal contract;
- expose unavailable behavior rather than inventing values;
- add recorded-response tests for success, `null`, malformed, timeout, and upstream failure;
- revisit the source decision if POTA publishes a supported API contract or changes the route.

The application must not scrape HTML pages when this structured route is available.

### Licensing, attribution, and caching

POTA describes Parks on the Air as a registered service mark and states copyright ownership on its public site. The reviewed public pages did not provide an explicit API data license or a clear bulk-redistribution grant. The application must not assume that park records may be redistributed as a complete dataset.

The first slice may cache the operator-selected individual park response locally for offline planning because the response explicitly advertises public one-hour HTTP caching and the cache is narrow, user-initiated, and not a bulk mirror. The implementation must:

- cache only successful individual lookups selected by the operator;
- retain the source URL, fetched time, and normalized source metadata;
- honor one hour as the fresh-cache lifetime unless POTA documents a different rule;
- permit a bounded stale last-known-good display after that lifetime, clearly labeled as cached/stale and not current;
- use a small bounded cache with eviction, not a national/global park database;
- avoid redistributing raw bulk data or shipping a preloaded park dataset;
- link or attribute POTA as the source where the production UI can do so.

This is a practical engineering decision, not a legal conclusion. Any future bulk packaging, redistribution, or long-lived mirror requires an explicit POTA licensing review.

## Internal activation-target semantics

The provider should normalize into a reusable internal concept without introducing a generalized provider/plugin framework:

```ts
interface ActivationTarget {
  kind: 'pota';
  reference: string;
  name: string;
  coordinates: { lat: number; lon: number };
  gridSquare: string;
  region?: string;
  jurisdiction?: string;
  parkType?: string;
  agency?: string;
  source: {
    id: 'pota-api';
    url: string;
    fetchedAtUtc: string;
    state: 'live' | 'cached';
  };
}
```

Required normalized fields are reference, name, valid coordinates, and a locally derived Maidenhead grid. `grid4`/`grid6` from upstream are useful evidence but must not replace local validation and conversion. Optional source fields remain nullable. The target is planning data and is never telemetry.

The eventual SOTA provider may produce the same conceptual target shape with `kind: 'sota'`, but SOTA-specific work is deferred. No generalized provider registry is required for the POTA slice.

## Exact source-state semantics

### Live

The upstream request succeeds with a valid park object and valid required fields. Display the target as **LIVE POTA DATA**, including the fetched time. Live means the response was obtained for this lookup; it does not prove current park access, boundary status, road access, or permission to operate.

### Cached

The upstream request is unavailable due to timeout, network failure, or service failure, and a previously successful individual record exists locally. Display the target as **CACHED POTA DATA**, include the original fetch time and cache age, and explain that upstream availability was not confirmed. Cached data must never be relabeled live.

A record older than the fresh-cache lifetime may still be shown only as bounded last-known-good planning context. It must remain visibly cached/stale and may be rejected once the implementation-defined maximum retained age is exceeded.

### Unavailable

No valid upstream response is available and no usable local record exists. Display no target coordinates or derived distance/bearing/solar results. Show a user-safe reason such as network unavailable, POTA service unavailable, or response unavailable.

### Invalid reference

The operator input fails local POTA reference syntax or length limits. Do not call the upstream service. Show a validation message and retain the current operating location unchanged.

### Unknown reference

The reference is syntactically valid, the upstream lookup succeeds, and the structured response is JSON `null` or otherwise explicitly indicates no matching park. Show **PARK NOT FOUND**. Do not create a target or cache the negative result as park metadata.

### Malformed upstream data

The response is not valid JSON or lacks valid required identity/coordinate fields. Treat it as unavailable for new data. Do not fabricate or partially display a target. A prior valid record may be shown as cached with the source error disclosed.

## Backend and UI boundary

The local Express backend owns:

- reference validation and normalization;
- fixed-origin URL construction;
- timeout and bounded request behavior;
- response schema validation and normalization;
- cache reads and writes;
- source-state classification;
- user-safe error mapping.

The production UI owns:

- POTA reference entry and lookup action;
- PLANNING TARGET presentation;
- live/cached/unavailable/invalid/unknown labels;
- target versus operating-location distinction;
- reuse of existing distance, bearing, Maidenhead, and solar calculations.

Selecting a planning target must not update GPS state, GPS provenance, local-storage live-location state, telemetry envelopes, or the operating-location object.

## Explicit non-goals

This slice does not include:

- SOTA provider implementation;
- activation submission;
- POTA spotting or spot management;
- POTA rules-engine implementation;
- complete national or global park database mirroring;
- QSO or activation-session persistence;
- SQLite;
- ADIF redesign;
- propagation recalibration or rating-policy changes;
- generalized provider/plugin frameworks;
- enterprise, fleet, remote, or multi-user architecture.

POTA park boundaries, access permissions, closures, and operating legality remain outside this lookup. The operator must verify current park rules and boundaries through authoritative local park sources, consistent with POTA guidance.

## Acceptance criteria for the implementation slice

- A valid POTA reference can be submitted from Field Tools.
- The backend performs one bounded individual lookup against the chosen POTA route.
- A successful response is normalized only when required identity and coordinates validate.
- The UI displays reference, name, coordinates, derived Maidenhead grid, source state, source URL, and fetch/cache age as applicable.
- The selected park is labeled PLANNING TARGET and remains distinct from live/manual operating location.
- Existing distance and bearing calculations can use the target without mutating GPS or telemetry state.
- Relevant solar/twilight calculations can use the target coordinates without mutating operating location.
- Invalid, unknown, unavailable, cached, and malformed-source states are distinguishable and tested.
- A successful individual lookup can be reused offline under the bounded cache policy.
- No bulk park dataset is downloaded, shipped, or mirrored.
- No POTA credentials, activation submission, spotting, or privileged agent operation is introduced.
- The feature remains useful with no network connection after a prior successful lookup.

## Automated test requirements

Add focused tests for:

- reference syntax and normalization;
- URL construction that cannot be redirected by operator input;
- successful response normalization;
- null/unknown response;
- malformed JSON and missing required fields;
- invalid coordinates;
- timeout, network failure, and HTTP failure;
- fresh cache hit;
- stale last-known-good cache behavior;
- cache bounds and eviction;
- target/live-location separation;
- distance, bearing, and solar calculations from a planning target;
- UI labels for every source state.

Use recorded, redacted response fixtures rather than live POTA calls in automated tests.

## ToughBook field validation

On the production Panasonic ToughBook CF-20, validate:

- online lookup of a known park reference;
- touch-friendly entry and readable target details;
- correct target distance, bearing, grid, and solar/twilight output;
- live GNSS location remains unchanged after target selection;
- manual operating location remains unchanged after target selection;
- network loss after a successful lookup shows the cached target honestly;
- cold offline lookup with no cache shows unavailable or unknown correctly;
- invalid and unknown references do not create a target;
- restart preserves only the approved bounded cache behavior;
- no repeated polling or request storm occurs during normal use.

## Recommended implementation task

Implement the first vertical slice only:

> Add a backend-owned POTA individual-reference adapter for `GET https://api.pota.app/park/{reference}`, a bounded operator-selected last-known-good cache, and a Field Tools PLANNING TARGET view that reuses the existing coordinate, Maidenhead, distance/bearing, and solar infrastructure without changing live operating-location telemetry.

Re-evaluate the upstream contract, cache policy, and licensing position before expanding to bulk data, spotting, submission, or SOTA.
