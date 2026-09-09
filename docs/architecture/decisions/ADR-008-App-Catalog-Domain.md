# ADR-008: App Catalog Domain Contract

- Status: Accepted for V2.9-01
- Date: 2026-09-08
- Scope: pure single-operator App Catalog domain contract

## Decision

V2.9-01 establishes a versioned, pure `AppCatalogConfig` domain contract. Each record has a stable ID, exactly one of the seven authoritative catalog categories, ownership/source, an explicitly typed launch target, capability and dependency metadata, operator enablement/favorite state, and an edit/delete/restore policy. It does not change production behavior.

Native targets and web targets are separate domain variants. Only absolute executable and HTTP/HTTPS validation belongs to later launcher slices. Unsupported legacy targets remain represented as unsupported; migration does not turn them into executable authorization.

Configured status is derived from the durable target. Detection, installation, availability, and launch outcomes are runtime-only observations in `AppCatalogRuntimeStates`, keyed by stable application ID. Enabled has one canonical durable representation on the record. Unknown and unsupported values are retained as truthful states. Catalog membership and capability metadata do not imply FieldOps integration or control.

## Migration and deletion semantics

Legacy launcher records can be migrated deterministically to schema version 1 through the pure domain API. Migration distinguishes an absent catalog, a valid current catalog, malformed input, and unsupported/newer schema versions; malformed or newer input never falls back to legacy records. Once a versioned catalog is present, its records and `deletedBuiltInIds` are authoritative; missing built-ins are not silently reinserted. Deleting a curated built-in removes its record and creates a tombstone. Restoration requires that tombstone and an explicit trusted curated-default definition. Required-system records cannot be disabled or deleted, and contradictory persisted policies are rejected.

Migration is idempotent, deduplicates stable IDs deterministically, bounds no new target authorization, and preserves operator-managed records. The 40 workbook rows are not migrated by this slice; curated production migration remains V2.9-05.

## Consequences

DashboardConfig persistence, the transitional legacy projection, and the source-of-truth cutover are deferred to V2.9-04. Runtime detection, installation, availability, and launch outcomes are consumed by V2.9-02 and V2.9-03. Later launcher, discovery, catalog-management, curated-migration, and capability-presentation slices consume this contract. This ADR does not authorize executable discovery, launcher protocol changes, catalog UI, third-party installation, CAT/PTT/radio control, automatic spotting, automatic submission, or SmartFrequency behavior.
