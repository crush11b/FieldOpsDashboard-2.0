# ADR-008: App Catalog Domain Contract

- Status: Accepted; extended by V2.9-04 persistence and source-of-truth cutover
- Date: 2026-09-08
- Scope: pure single-operator App Catalog domain contract

## Decision

V2.9-01 establishes a versioned, pure `AppCatalogConfig` domain contract. Each record has a stable ID, exactly one of the seven authoritative catalog categories, ownership/source, an explicitly typed launch target, capability and dependency metadata, operator enablement/favorite state, and an edit/delete/restore policy. It does not change production behavior.

Native targets and web targets are separate domain variants. Only absolute executable and HTTP/HTTPS validation belongs to later launcher slices. Unsupported legacy targets remain represented as unsupported; migration does not turn them into executable authorization.

Configured status is derived from the durable target. Detection, installation, availability, and launch outcomes are runtime-only observations in `AppCatalogRuntimeStates`, keyed by stable application ID. Enabled has one canonical durable representation on the record. Unknown and unsupported values are retained as truthful states. Catalog membership and capability metadata do not imply FieldOps integration or control.

## Migration and deletion semantics

Legacy launcher records can be migrated deterministically to schema version 1 through the pure domain API. Migration distinguishes an absent catalog, a valid current catalog, malformed input, and unsupported/newer schema versions; malformed or newer input never falls back to legacy records. Trusted curated defaults are reconciled by stable ID: genuinely omitted defaults are restored unless tombstoned, while persisted records retain operator-editable state. A persisted record cannot spoof a trusted default's owner or policy. Deleting a curated built-in removes its record and creates a tombstone. Restoration requires that tombstone and an explicit trusted curated-default definition. Required-system records cannot be disabled or deleted, and contradictory persisted policies are rejected.

Migration is idempotent, deduplicates stable IDs deterministically, bounds no new target authorization, and preserves operator-managed records. The 40 workbook rows are not migrated by this slice; curated production migration remains V2.9-05.

## Consequences

DashboardConfig is the single durable per-operator persistence location. `appCatalog` is authoritative for catalog rendering, management, launcher resolution, and discovery; legacy `apps` is retained only as a compatibility projection and is not a write surface. Runtime detection, installation, availability, and launch outcomes are consumed by V2.9-02 and V2.9-03. This ADR does not authorize executable discovery, launcher protocol changes, third-party installation, CAT/PTT/radio control, automatic spotting, automatic submission, or SmartFrequency behavior.
