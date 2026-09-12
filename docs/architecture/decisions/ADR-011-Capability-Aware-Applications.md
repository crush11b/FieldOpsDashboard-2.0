# ADR-011: Capability-Aware Applications

## Status

Accepted for V2.9-06.

## Decision

The App Catalog distinguishes five separate concerns:

- catalog membership identifies an approved record;
- capabilities are bounded declarations about the external application and are not FieldOps integrations;
- dependencies are declarations evaluated against catalog membership, enabled/configured state, and independent runtime evidence;
- FieldOps evidence relationships are code-owned and describe implemented evidence paths only;
- configured, detected, installed, enabled, available, and launch outcomes remain separate runtime states.

Capability IDs and their display labels come from the typed registry; persisted records must use the canonical label for each ID. User-managed applications default to no capabilities, dependencies, or FieldOps evidence claims. Missing runtime evidence is `unknown`, never an inferred availability result. Dependency declarations use stable catalog IDs and do not authorize installation or launch behavior.

WSJT-X is the only catalog application with an implemented FieldOps relationship, and that relationship is read-only evidence. The catalog contains no write, CAT, PTT, tuning, spotting, or submission relationship. An external-radio-control capability describes the third-party application only and never means FieldOps controls a radio.

Manual web launchers remain launchers. WebSDR declares remote reception only; it does not imply receiver control. Configured applications are not called installed or available without corresponding evidence. Discovery requests accept catalog IDs only and resolve all metadata from trusted server-side catalog records.

## Consequences

The API and App Library render declared capabilities, evaluated dependency states, FieldOps evidence, and runtime observations in separate labeled sections. A discovery failure leaves the catalog usable and displays unknown runtime state. Existing catalog schema version 1 and operator persistence, enablement, favorites, hotkeys, targets, edits, and tombstones remain unchanged.
