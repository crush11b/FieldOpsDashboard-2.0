# ADR-013: Operating Context and Multi-Entity QSO Associations

- Status: Accepted for V3.0-01
- Date: 2026-09-14
- Scope: shared operating context, activation entities, and canonical QSO associations
- Baseline: V2.9.1 at `7e67ed7a1820ce5fa11b57b89cf33808fb07aa3c`

## Context

V2.9.1 has three intentionally bounded singular representations:

- an Activation has one `type` and one optional `reference`;
- a QSO has optional singular `potaRef` and `sotaRef`;
- a SmartDeploy brief has one activation target.

V3.0 must support multiple POTA parks, multiple operationally valid SOTA summits, combined POTA/SOTA operations, one canonical QSO associated with several entities, active-entity inheritance for manual and WSJT-X capture, and retained historical review.

The existing Activation lifecycle already owns PLAN, PREPARE, OPERATE, and REVIEW. Introducing a second universal Mission aggregate would create competing lifecycle and persistence authorities.

## Decision

### Activation remains the lifecycle root

V3.0 evolves Activation rather than adding a competing Mission root. “Mission context” is a bounded, versioned context associated with an Activation. It references authoritative records and retains immutable snapshots only where history requires them.

The context may carry:

- planned and actual operating windows;
- current and planned locations with provenance;
- activation entities;
- active entity set;
- station/loadout identity and retained snapshot;
- intended modes and power;
- current confirmed TX context;
- retained evidence references;
- review/diagnostic references.

It does not copy every field from every domain into a universal document.

### Activation entity

An activation entity is a locally usable program reference:

```ts
type ActivationProgram = 'POTA' | 'SOTA';

interface ActivationEntity {
  schemaVersion: 1;
  entityId: string;
  program: ActivationProgram;
  reference: string;
  displayName?: string;
  provenance:
    | { kind: 'operator_entered' }
    | { kind: 'legacy_migration' }
    | { kind: 'retained_provider_evidence'; sourceId: string; observedAtUtc?: string };
  createdAtUtc: string;
  updatedAtUtc: string;
}
```

Stable `entityId` is record identity. Program plus normalized reference is semantic identity within an Activation. Duplicate semantic identities are rejected even when IDs differ.

POTA and SOTA normalization reuse their existing bounded normalizers. Provider lookup is not required for manual entity creation. Missing display names remain absent.

### Activation entity set

An Activation stores an ordered, duplicate-free set of entity IDs and a duplicate-free active subset:

```ts
interface ActivationEntityState {
  schemaVersion: 1;
  entities: readonly ActivationEntity[];
  activeEntityIds: readonly string[];
}
```

Order is canonical: program, normalized reference, then stable ID. Display order must not define QSO identity.

A General operation is represented by an empty entity collection. “General” is not fabricated as a program entity.

### QSO associations

One contact remains one canonical QSO. The QSO gains a normalized association snapshot:

```ts
interface QsoEntityAssociation {
  entityId?: string;
  program: ActivationProgram;
  reference: string;
  source: 'active_operation' | 'operator_edit' | 'adif_import' | 'legacy_migration';
}

interface QsoEntityAssociations {
  schemaVersion: 1;
  entities: readonly QsoEntityAssociation[];
}
```

Program/reference is retained in the QSO association even when `entityId` is present, so deletion, tombstoning, or later Activation edits cannot erase historical credit context.

The canonical QSO fingerprint remains based on contact facts:

- Activation ID;
- callsign;
- QSO timestamp;
- band;
- frequency when present;
- mode;
- submode.

Entity associations are excluded from the fingerprint. Repeated WSJT-X type 5/type 12 representations remain one QSO. Importing matching contact facts merges compatible entity associations instead of creating one QSO per entity.

### Capture and editing

Manual and WSJT-X capture snapshot the active entity set at successful QSO creation. A later active-set change affects only later QSOs.

Editing associations:

- does not change QSO ID, source, creation time, or contact fingerprint;
- validates and normalizes every reference;
- rejects duplicates;
- records the update time through the existing QSO update path;
- does not rewrite the Activation entity set unless the operator explicitly requests a separate Activation edit.

### Legacy compatibility

V2.9.1 fields remain readable during migration:

- Activation `type/reference` becomes zero or one Activation entity;
- QSO `potaRef` and `sotaRef` become association entries;
- matching QSO legacy fields and inherited Activation reference collapse to one association;
- legacy fields may remain read-only compatibility projections during transition;
- there is one authoritative V3 write surface.

Migration behavior is decided in ADR-015. No V2.9.1 data is deleted in V3.0-01.

### ADIF boundary

ADIF import/export behavior for multiple program references is not finalized by this ADR. Current official ADIF and program-specific expectations must be researched before V3.0-06.

Until that decision:

- the domain can represent multiple associations locally;
- export must not silently drop extra associations;
- import must not multiply a canonical QSO;
- no POTA/SOTA API, spotting, or submission is implied.

## Invariants

1. An Activation entity set contains no duplicate program/reference pair.
2. An active entity ID must resolve within the same Activation entity set.
3. A QSO association contains a valid program/reference pair.
4. A QSO association set contains no duplicate program/reference pair.
5. QSO association order does not affect equality or deduplication.
6. Entity edits cannot change canonical contact identity.
7. General operation uses an empty entity set.
8. Unknown provider facts remain absent.
9. Provider access is not required for manual operation.
10. Historical associations survive entity deletion or later edits.

## Ownership

- Express owns persistence, validation orchestration, import/export, and browser-facing APIs.
- Pure TypeScript domain code owns normalization and invariants.
- The browser supplies bounded operator intent, not trusted provider facts.
- WSJT-X supplies read-only QSO evidence and cannot select or mutate the active entity set.
- The Agent and Tray have no role in program-entity or QSO association ownership.

## Consequences

This decision supports multi-park, multi-summit, and combined operations without duplicating contacts or introducing a speculative Mission framework. It requires additive QSO and Activation schema evolution, compatibility projections, migration fixtures, association-aware UI, and ADIF research.

It does not authorize provider APIs, spotting, submission, radio control, or implementation outside an approved V3.0 slice.
