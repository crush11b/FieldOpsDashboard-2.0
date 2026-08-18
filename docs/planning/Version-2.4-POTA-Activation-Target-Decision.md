# Version 2.4 POTA Activation-Target Research Input

- Status: **Research complete - product definition pending**
- Date: 2026-08-17
- Release: Version 2.4 - Field Tools
- Roadmap task ID: **None assigned**
- Related authority: [FieldOpsDashboard Project Rebaseline 2026](FieldOpsDashboard_Project_Rebaseline_2026.md)
- Research topic: **POTA activation-target lookup and offline-aware planning context**

## Research disposition

No POTA production implementation has been approved. This document is a research and design input only; it is not an implementation-ready product decision, task authorization, acceptance specification, or replacement for the rebaseline, roadmap, backlog, or ADR-007.

The operator-facing purpose and contents of a future POTA Field Tools tab remain to be defined. The operator-facing purpose and contents of a future SOTA Field Tools tab also remain to be defined. POTA-first, SOTA-first, and combined sequencing remain open until product design is complete.

The activation-target concept described below is a candidate architecture, not an approved workflow. The proposed planning-target workflow, UI contents, caching behavior, and offline role are technical options for product design review. Acceptance criteria and implementation scope must be written only after the operator workflow is approved.

The source research may be reused when product definition is complete. It does not authorize implementation or establish a Version 2.4 task number.

This decision follows the rebaseline priorities:

1. Operator value: a park reference becomes a usable planning target.
2. Trustworthy information: source, freshness, limitations, and failure states remain visible.
3. Reliable local operation: the backend owns external access and bounds failures.
4. Offline usefulness: the selected park may remain available from a bounded last-known-good cache.
5. Maintainability: one narrow provider and one internal target shape are sufficient.
6. Proportionate security: no credentials, privileged operations, or remote access are introduced.
7. Future scalability: the target concept is reusable without creating a provider framework.

Propagation remains closed as **FUNCTIONAL / MVP ACCEPTED - REFINEMENT BACKLOG**. This research does not reopen propagation work.

## Candidate operator problem and workflow for design review

The following is a candidate workflow to evaluate with the operator; it is not approved:

1. Operator opens Field Tools.
2. Operator enters a POTA reference such as `US-0182`.
3. The local backend performs an individual POTA lookup when network access is available.
4. A valid response is normalized into an internal activation-target representation.
5. Field Tools displays the park under an explicit **PLANNING TARGET** label.
6. The target view shows the park reference and name, coordinates, Maidenhead grid, source state, and source age where available.
7. Existing Field Tools calculations use the planning target as a destination for distance, bearing, and relevant solar/twilight calculations.
8. The live or manual operating location remains separately labeled and unchanged.

The candidate is read-only and does not submit an activation, create a spot, manage spots, or persist a QSO/session. Whether this is the right first workflow remains unresolved.

## POTA upstream research

### Practical source candidate

The POTA-hosted structured individual park route is the current practical source candidate:

`GET https://api.pota.app/park/{reference}`

If product design later selects online lookup, the backend should call this route rather than the browser. The reference should be normalized and validated before it is placed in the URL, with a fixed HTTPS origin and bounded request timeout. These are design recommendations, not an approved implementation contract.

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

The collection routes tested (`/parks` and `/parks?entityId=291`) returned `403`. This research therefore provides no basis for depending on a bulk collection endpoint or a complete local park mirror.

The individual response advertised `Cache-Control: public, max-age=3600, immutable`. This is useful operational cache guidance, but it is not a complete API contract.

### Authentication and usage

No authentication was required for the tested individual lookup. The implementation must still identify itself with a product user agent, use one request per explicit operator lookup, apply a timeout, avoid polling, and avoid retry storms. No rate limit was found in the public documentation reviewed. The absence of a published limit is an operational risk, not permission for high-volume access.

### Contract and stability risk

The individual route is practical and POTA-hosted, but no public, versioned API contract or schema guarantee was found in the POTA documentation reviewed. Any future implementation must therefore treat it as an external compatibility dependency:

- validate every field;
- tolerate nullable optional fields;
- reject malformed coordinates and identity fields;
- keep the adapter isolated behind an internal contract;
- expose unavailable behavior rather than inventing values;
- add recorded-response tests for success, `null`, malformed, timeout, and upstream failure;
- revisit the source decision if POTA publishes a supported API contract or changes the route.

The application must not scrape HTML pages when this structured route is available.

### Licensing, attribution, and caching considerations

POTA describes Parks on the Air as a registered service mark and states copyright ownership on its public site. The reviewed public pages did not provide an explicit API data license or a clear bulk-redistribution grant. The application must not assume that park records may be redistributed as a complete dataset.

The response headers make bounded local caching technically feasible, but caching and its role in the first product slice remain product decisions. If product design later requires offline continuity, the following conservative policy is a candidate for review:

- cache only successful individual lookups selected by the operator;
- retain the source URL, fetched time, and normalized source metadata;
- honor one hour as the fresh-cache lifetime unless POTA documents a different rule;
- permit a bounded stale last-known-good display after that lifetime, clearly labeled as cached/stale and not current;
- use a small bounded cache with eviction, not a national/global park database;
- avoid redistributing raw bulk data or shipping a preloaded park dataset;
- link or attribute POTA as the source where the production UI can do so.

This is not an approval to cache or redistribute POTA data, and it is not a legal conclusion. Any future cache, bulk packaging, redistribution, or long-lived mirror requires product approval and an explicit POTA licensing review.

## Candidate activation-target semantics

If product design selects a target-oriented workflow, the provider could normalize into a reusable internal concept without introducing a generalized provider/plugin framework:

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

The fields above are candidate semantics, not an approved schema. Any future normalization should require valid identity and coordinates, locally validate or derive Maidenhead data, preserve nullable optional fields, and keep the target as planning data rather than telemetry.

An eventual SOTA design could reuse the conceptual target shape with `kind: 'sota'`, but SOTA-specific product definition is pending. No generalized provider registry is justified by this research alone.

## Candidate source-state semantics

The following states are proposed for product design review. They are not approved UI or API behavior.

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

## Candidate backend and UI boundaries

If a future product decision selects an online lookup and planning-target workflow, the following ownership boundary is recommended:

The local Express backend owns:

- reference validation and normalization;
- fixed-origin URL construction;
- timeout and bounded request behavior;
- response schema validation and normalization;
- cache reads and writes;
- source-state classification;
- user-safe error mapping.

The future production UI would own:

- POTA reference entry and lookup action;
- PLANNING TARGET presentation;
- live/cached/unavailable/invalid/unknown labels;
- target versus operating-location distinction;
- reuse of existing distance, bearing, Maidenhead, and solar calculations.

Regardless of the eventual UI, any future planning target must remain distinct from live GNSS or manual operating-location telemetry. Selecting one must not update GPS state, GPS provenance, local-storage live-location state, telemetry envelopes, or the operating-location object.

## Scope deliberately left unresolved

The following are not authorized by this research and remain subject to later product definition:

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

POTA park boundaries, access permissions, closures, and operating legality remain outside the researched lookup. Any future product must direct the operator to verify current park rules and boundaries through authoritative local park sources, consistent with POTA guidance.

## Future acceptance and validation inputs

The prior acceptance and implementation requirements are design inputs only. They do not constitute an authorized implementation task. After the operator workflow and tab contents are approved, the team must write new acceptance criteria that match that product definition.

Potential concerns to revisit during product design include:

- whether lookup is the primary operator action or only one part of a broader POTA/SOTA experience;
- which metadata is useful enough to display;
- whether distance, bearing, and solar/twilight calculations belong in the first tab;
- which source states must be visible to the operator;
- whether any offline cache is needed and what retention is acceptable;
- whether the selected source remains suitable at implementation time.

## Future test and field-validation inputs

If product design authorizes implementation, focused tests should be derived from the approved workflow. The following research-derived cases should be considered:

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

## Future ToughBook validation inputs

If a product slice is later approved, the production Panasonic ToughBook CF-20 should be used to validate the approved workflow. Research-derived scenarios to consider include:

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

## Recommended next activity

Do not begin POTA or SOTA implementation from this document. The next activity should be operator/product design of the POTA and SOTA Field Tools experiences. That design should decide:

- the operator problem and purpose of each tab;
- the contents and interaction model of each tab;
- POTA-first, SOTA-first, or combined sequencing;
- whether an activation-target concept is needed and what it means;
- whether online lookup and offline caching are required;
- the acceptance criteria and implementation scope.

After that product decision, reuse this source research and re-evaluate the upstream contract, cache policy, and licensing position before implementation.
