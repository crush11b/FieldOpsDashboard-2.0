# Regional Observed-RF Classification

Slice 5G-B derives regional observed digital reception evidence from the normalized PSKReporter MQTT reports produced by Slice 5G-A. It is a pure transformation: it opens no MQTT connection, performs no network request, and does not change the 5G-A cache or reconnect lifecycle.

## Membership model

`src/propagation/regionalMembership.ts` is a separate deterministic membership layer. It uses documented, non-overlapping, half-open latitude/longitude rectangles rather than the Slice 5C representative sample points. Sample points remain modeling anchors only.

The catalog uses these operational rules:

- Eastern U.S.: contiguous U.S. at longitudes `[-90, -66)` and latitudes `[24, 49)`.
- Central U.S.: contiguous U.S. at longitudes `[-110, -90)` and latitudes `[24, 49)`.
- Western U.S.: contiguous U.S. at longitudes `[-125, -110)` and latitudes `[24, 49)`. Alaska and Hawaii are excluded.
- Caribbean: separate Cuba, Jamaica, Puerto Rico, and Lesser Antilles envelopes.
- Central America: separate Guatemala/northern, Honduras-through-Nicaragua, and Costa Rica/Panama envelopes.
- South America: mainland envelope south of the Central America boundary.
- Western Europe: operational envelope west of 12 degrees east and north of the Maghreb boundary.
- Eastern Europe: northern/eastern, southeastern, and Romania-specific envelopes east of 12 degrees east.
- North Africa: separate Maghreb and Egypt envelopes.
- Southern Africa: southern mainland envelope including South Africa, Namibia, and Mozambique.
- Middle East: western Turkey plus a Levant/Arabian Peninsula/Gulf/Iranian plateau envelope.
- East Asia: China, Japan, Korea, Taiwan, and adjacent East Asian envelope north of Oceania.
- Oceania: separate Australia, New Zealand, Papua New Guinea, Fiji, and southwest Pacific envelopes.

Coordinates outside these zones intentionally return `unclassified`; there is no nearest-region fallback. The catalog validation helper proves that zones belonging to different canonical regions do not overlap.

## Locator semantics

A valid 4-character or 6-character PSK locator is converted with the existing `gridSquareToLatLon` utility. The result is a locator-center estimate, not an exact transmitter or receiver position. Missing or unusable remote locators produce `insufficient_location`. A usable locator outside the catalog produces `unclassified`.

For outbound reports the remote endpoint is the receiver. For inbound reports it is the sender. Local reports do not classify the local endpoint as a destination: they are retained as `local_nvis` with status `local`, described as local-area digital activity with unknown propagation mechanism. They are not labeled NVIS observed.

## Derived contracts

`deriveRegionalObservedRf(snapshot)` returns `RegionalObservedRfSnapshot`. It preserves the source status (`live`, `cached`, `stale`, or `unavailable`), observation window, collection time, source provenance, every deduplicated source report, and the derived classified reports.

Each `RegionalObservedRfReport` preserves source report ID, original report, operating grid, direction, band, exact mode, SNR, observed time, remote callsign and locator, locator-center estimate, canonical region ID, classification status, and observed-digital provenance. It does not contain ratings, confidence, P.533 results, NOAA data, ionosonde data, or an activity label.

The transformation emits one `RegionalObservedRfBandSummary` for every canonical region ID and each of the ten production bands: `160m`, `80m`, `40m`, `30m`, `20m`, `17m`, `15m`, `12m`, `10m`, and `6m`. Empty rows are valid zero-report evidence. Counts, unique remote callsigns, unique paths, exact mode counts, newest/oldest observation time, SNR statistics, locator coverage, classification coverage, and observed directions remain facts only.

Unique paths use `sender|receiver|band|mode`. Slice 5G-A report IDs remain authoritative, and the pure transformation deduplicates repeated source IDs defensively.
