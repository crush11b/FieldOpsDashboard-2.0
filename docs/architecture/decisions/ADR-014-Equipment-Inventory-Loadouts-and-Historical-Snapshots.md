# ADR-014: Equipment Inventory, Loadouts, and Historical Snapshots

- Status: Accepted for V3.0-01
- Date: 2026-09-14
- Scope: operator-managed equipment facts, reusable loadouts, and retained mission snapshots

## Context

V2.9.1 retains thin station descriptions in SmartDeploy and TX Context but has no persistent equipment inventory or reusable loadout domain. The App Catalog describes launchable software and runtime discovery evidence; it is not an equipment database.

V3.0 needs locally retained operator facts that can support repeatable planning and deterministic guidance without pretending to know every device capability.

## Decision

### Separate inventory domain

Inventory is independent of App Catalog, Windows telemetry, and application discovery.

```ts
type EquipmentKind =
  | 'radio'
  | 'amplifier'
  | 'antenna'
  | 'tuner'
  | 'battery'
  | 'power_system'
  | 'computer'
  | 'interface'
  | 'cable_adapter'
  | 'other';

type FactSource = 'operator_entered' | 'operator_confirmed' | 'legacy_migration';

interface EquipmentFact<T = string | number | boolean> {
  key: string;
  value: T;
  unit?: string;
  source: FactSource;
  notes?: string;
}

interface EquipmentRecord {
  schemaVersion: 1;
  equipmentId: string;
  kind: EquipmentKind;
  label: string;
  manufacturer?: string;
  model?: string;
  facts: readonly EquipmentFact[];
  limitations: readonly string[];
  notes?: string;
  state: 'active' | 'deleted';
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string;
}
```

The initial fact-key registry is bounded to facts consumed by an approved V3.0 capability. Unknown values remain absent. Free-form notes do not become machine facts.

No built-in model catalog, automatic hardware discovery, or inferred capability database is authorized.

### Stable IDs and deletion

IDs are stable and never reused. Delete is a tombstone transition, not destructive removal, when a record is referenced by a loadout or retained operation. Restore clears the tombstone while preserving identity and history.

Deleted equipment is unavailable for new loadouts but remains readable in existing loadouts and retained snapshots.

### Reusable loadouts

```ts
interface LoadoutItem {
  equipmentId: string;
  role: string;
  quantity: number;
  configuration?: Readonly<Record<string, string | number | boolean>>;
  notes?: string;
}

interface LoadoutRecord {
  schemaVersion: 1;
  loadoutId: string;
  name: string;
  description?: string;
  items: readonly LoadoutItem[];
  limitations: readonly string[];
  state: 'active' | 'deleted';
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc?: string;
}
```

A loadout references inventory records; it does not duplicate the complete inventory record. Duplicate equipment IDs are permitted only when their roles/configurations are distinct and the domain can explain the distinction. Otherwise quantities are consolidated.

A loadout cannot prove that equipment is packed, connected, functional, charged, licensed, or suitable. Those require explicit observations or confirmations.

### Historical operation snapshot

An Activation or retained SmartDeploy brief associates:

- optional `loadoutId`;
- immutable loadout snapshot;
- snapshot time;
- snapshot provenance.

The snapshot contains the planning-relevant equipment facts and limitations as they existed when committed to the operation. Later inventory/loadout edits do not rewrite retained briefs, active-operation history, or completed review.

A missing current inventory record does not invalidate a historical snapshot.

### Guidance boundary

Deterministic guidance may consume only typed facts with explicit sources. It distinguishes:

- stored operator fact;
- operator preference;
- current observation;
- modeled result;
- cached/stale evidence;
- deterministic rule;
- unknown value.

Examples such as endurance require approved formulas and all required facts. Missing capacity, voltage, consumption, efficiency, duty cycle, or reserve policy produces an incomplete/unknown finding rather than an invented estimate.

Optional AI may explain structured findings but cannot create missing equipment or safety facts.

## Validation requirements

Pure-domain tests must cover:

- stable-ID grammar and uniqueness;
- supported kinds and bounded text;
- typed fact values and units;
- duplicate fact keys;
- active/deleted/restore transitions;
- loadout item references and quantities;
- duplicate/consolidation rules;
- tombstoned references;
- immutable snapshots;
- malformed, unsupported, and newer schema versions;
- deterministic normalization and ordering;
- unknown values remaining absent.

Persistence and V2.9.1 migration are V3.0-02 work.

## Ownership

- Pure TypeScript domain code owns records, validation, normalization, and snapshots.
- Express owns local persistence and browser-facing APIs.
- The browser supplies bounded operator edits.
- Agent telemetry remains observed runtime evidence and is not silently written into inventory.
- App Catalog remains the software-launch domain.
- Tray launching remains unchanged.

## Consequences

V3.0 gains the minimum durable fact model required by loadouts and resource-aware guidance while avoiding a speculative universal asset platform. Historical operations remain stable even after inventory edits.

This ADR does not authorize hardware discovery, equipment optimization, automatic selection, remote inventory, cloud synchronization, radio control, or generalized plug-ins.
