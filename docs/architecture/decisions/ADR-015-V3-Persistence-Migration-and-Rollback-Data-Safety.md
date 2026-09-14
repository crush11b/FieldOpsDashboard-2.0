# ADR-015: V3 Persistence Migration and Rollback Data Safety

- Status: Accepted for V3.0-01
- Date: 2026-09-14
- Scope: V2.9.1-to-V3 schema migration, compatibility, corruption, backup, and rollback data behavior

## Context

V3.0 adds multi-entity Activation/QSO data plus equipment inventory and loadouts. Executable rollback alone cannot protect operator data if V3 rewrites a store that V2.9.1 cannot understand.

V2.9.1 configuration, App Catalog, Activations, SmartDeploy briefs, mission forecasts, notes, checklists, QSOs, and operational-intelligence evidence must remain readable and recoverable.

## Decision

### Migration is explicit and versioned

Each independently persisted aggregate owns an explicit schema version and migration function. Migration is deterministic, idempotent, bounded, and testable without starting the production server.

A present malformed current aggregate is not treated as absent. A newer unsupported version is not interpreted as legacy. Neither case silently falls back to defaults.

### Pre-migration backup set

Before the first write that changes a V2.9.1 store:

1. enumerate the exact product-owned persistence files;
2. record existence, size, and SHA-256 for each;
3. copy them to a uniquely identified pre-V3 backup set;
4. write a manifest containing source revision, product version, timestamp, file paths, hashes, and migration target versions;
5. fsync/close completed outputs through the repository’s supported persistence pattern;
6. fail closed if the backup or manifest cannot be completed.

The backup set is immutable during the acceptance window.

### Copy-on-write activation

Where practical, V3 writes a new versioned file and atomically activates it only after complete validation. In-place destructive transformation is prohibited.

If an existing store architecture requires replacement, the temporary file must be validated and atomically renamed according to the established store pattern.

### Compatibility and authority

During a transition, legacy singular fields may remain read-only projections. V3 has one authoritative write representation. Dual independent write authorities are prohibited.

Historical V2.9.1 records remain readable without forcing provider refresh or fabricating missing fields.

### Corruption and unsupported versions

The store reports distinct outcomes for:

- absent;
- current;
- migrated;
- malformed/corrupt;
- unsupported newer version;
- I/O failure.

Malformed or unsupported data is preserved for diagnosis. It is not deleted, reset, or overwritten automatically.

### Rollback data policy

The supported rollback restores:

- the prior executable/runtime revision; and
- the exact pre-migration V2.9.1 data snapshot from the recorded backup manifest.

V3-only data created after migration is preserved in a quarantined forward-data set before the V2.9.1 snapshot is restored. V2.9.1 is not launched against V3-only schemas and cannot overwrite them silently.

Returning from rollback to V3 requires an explicit reconciliation decision. Automatic bidirectional merge is not authorized.

### Failure atomicity

If any aggregate migration fails:

- production activation fails;
- the prior runtime/data state remains authoritative;
- completed temporary outputs are not treated as active;
- the failure names the aggregate and stage without exposing secrets;
- rerun inspects the existing migration manifest/output before attempting new work.

A timeout alone is not a migration failure; the process and result artifact must be inspected.

## Required migration fixtures

V3.0-02 must include representative V2.9.1 data for:

- configuration and App Catalog;
- POTA, SOTA, and General Activations;
- manual, ADIF-imported, and WSJT-X QSOs;
- QSO legacy references both matching and differing from Activation reference;
- retained briefs, forecasts, notes, and checklists;
- operational-intelligence/TX-context evidence;
- empty optional collections;
- valid zero values;
- malformed aggregate;
- unsupported newer version;
- interrupted/partial migration artifact.

No fixture may contain real secrets or unnecessary personal data.

## Acceptance properties

1. Migration preserves every valid V2.9.1 record.
2. Migration is idempotent.
3. Semantic duplicates collapse without losing associations.
4. QSO totals do not inflate.
5. Historical brief and review paths remain readable.
6. Inventory/loadout absence is represented as absent, not fabricated defaults.
7. Backup hashes verify before activation.
8. Interrupted migration leaves V2.9.1 authoritative.
9. Rollback restores the exact pre-migration snapshot.
10. Forward V3 data survives rollback in quarantine.
11. Newer schemas fail safely.
12. Corrupt inputs are preserved and reported.
13. Migration and rollback are independently testable.
14. CF-20 acceptance uses a backed-up and hashed real V2.9.1 configuration.

## Ownership

- Pure domain modules own schema recognition and transformation.
- Store modules own atomic file operations and corruption states.
- Express coordinates product-owned migration readiness.
- Updater/deployment scripts coordinate runtime activation and rollback only through explicit migration/readiness results.
- Browser code never performs persistence migration.
- Agent and Tray do not own Dashboard domain migration.

## Consequences

V3.0 adds an explicit data rollback contract rather than assuming executable rollback is sufficient. This increases V3.0-02 work but prevents silent loss or overwrite of operator records.

This ADR does not implement migration, modify stores, deploy, or authorize rollback execution.
