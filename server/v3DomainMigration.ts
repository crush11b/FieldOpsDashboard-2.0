import { createHash } from 'node:crypto';
import { normalizePotaReference } from './potaTargetResolver';
import { normalizeSotaReference } from './sotaSummitDataset';

export const V3_ACTIVATION_STORE_VERSION = 3 as const;
export const V3_ACTIVATION_SCHEMA_VERSION = 3 as const;
export const V3_QSO_STORE_VERSION = 2 as const;
export const V3_QSO_SCHEMA_VERSION = 2 as const;
export const V3_ENTITY_STATE_SCHEMA_VERSION = 1 as const;
export const V3_QSO_ASSOCIATIONS_SCHEMA_VERSION = 1 as const;

export type V3ActivationProgram = 'POTA' | 'SOTA';
export type V3DomainMigrationStatus =
  | { readonly status: 'migrated' | 'current'; readonly activations: V3ActivationStoreDocument; readonly qsos: V3QsoStoreDocument }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'unsupported'; readonly aggregate: 'activations' | 'qsos'; readonly storeVersion: unknown };

export interface V3ActivationEntity {
  readonly schemaVersion: 1;
  readonly entityId: string;
  readonly program: V3ActivationProgram;
  readonly reference: string;
  readonly provenance: { readonly kind: 'legacy_migration' };
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
}

export interface V3ActivationEntityState {
  readonly schemaVersion: 1;
  readonly entities: readonly V3ActivationEntity[];
  readonly activeEntityIds: readonly string[];
}

export interface V3ActivationRecord extends Record<string, unknown> {
  readonly schemaVersion: 3;
  readonly activationId: string;
  readonly entityState: V3ActivationEntityState;
}

export interface V3QsoEntityAssociation {
  readonly entityId?: string;
  readonly program: V3ActivationProgram;
  readonly reference: string;
  readonly source: 'legacy_migration';
}

export interface V3QsoRecord extends Record<string, unknown> {
  readonly schemaVersion: 2;
  readonly qsoId: string;
  readonly activationId: string;
  readonly entityAssociations: {
    readonly schemaVersion: 1;
    readonly entities: readonly V3QsoEntityAssociation[];
  };
}

export interface V3ActivationStoreDocument {
  readonly storeVersion: 3;
  readonly activations: readonly V3ActivationRecord[];
}

export interface V3QsoStoreDocument {
  readonly storeVersion: 2;
  readonly qsos: readonly V3QsoRecord[];
}

export function migrateV2_9_1DomainDocuments(
  activationInput: unknown,
  qsoInput: unknown,
): V3DomainMigrationStatus {
  if (isV3ActivationStoreDocument(activationInput) && isV3QsoStoreDocument(qsoInput)) {
    return { status: 'current', activations: activationInput, qsos: qsoInput };
  }
  if (!isRecord(activationInput) || typeof activationInput.storeVersion !== 'number') {
    return { status: 'invalid', reason: 'The V2.9.1 Activation store is malformed.' };
  }
  if (activationInput.storeVersion > 2) {
    return { status: 'unsupported', aggregate: 'activations', storeVersion: activationInput.storeVersion };
  }
  if (activationInput.storeVersion !== 2 || !Array.isArray(activationInput.activations)) {
    return { status: 'invalid', reason: 'The Activation store is not the supported V2.9.1 store version.' };
  }
  if (!isRecord(qsoInput) || typeof qsoInput.storeVersion !== 'number') {
    return { status: 'invalid', reason: 'The V2.9.1 QSO store is malformed.' };
  }
  if (qsoInput.storeVersion > 1) {
    return { status: 'unsupported', aggregate: 'qsos', storeVersion: qsoInput.storeVersion };
  }
  if (qsoInput.storeVersion !== 1 || !Array.isArray(qsoInput.qsos)) {
    return { status: 'invalid', reason: 'The QSO store is not the supported V2.9.1 store version.' };
  }

  const activations: V3ActivationRecord[] = [];
  const entityStates = new Map<string, V3ActivationEntityState>();
  const activationIds = new Set<string>();
  for (const candidate of activationInput.activations) {
    const migrated = migrateActivation(candidate);
    if (!migrated) return { status: 'invalid', reason: 'A V2.9.1 Activation record is malformed or contains an invalid reference.' };
    if (activationIds.has(migrated.activationId)) return { status: 'invalid', reason: 'The V2.9.1 Activation store contains duplicate Activation IDs.' };
    activationIds.add(migrated.activationId);
    activations.push(migrated);
    entityStates.set(migrated.activationId, migrated.entityState);
  }

  const qsos: V3QsoRecord[] = [];
  const qsoIds = new Set<string>();
  for (const candidate of qsoInput.qsos) {
    const migrated = migrateQso(candidate, entityStates.get(isRecord(candidate) && typeof candidate.activationId === 'string' ? candidate.activationId : ''));
    if (!migrated) return { status: 'invalid', reason: 'A V2.9.1 QSO record is malformed or contains an invalid reference.' };
    if (qsoIds.has(migrated.qsoId)) return { status: 'invalid', reason: 'The V2.9.1 QSO store contains duplicate QSO IDs.' };
    qsoIds.add(migrated.qsoId);
    qsos.push(migrated);
  }

  return {
    status: 'migrated',
    activations: { storeVersion: V3_ACTIVATION_STORE_VERSION, activations },
    qsos: { storeVersion: V3_QSO_STORE_VERSION, qsos },
  };
}

function migrateActivation(value: unknown): V3ActivationRecord | null {
  if (!isRecord(value)
    || value.schemaVersion !== 2
    || !isStableId(value.activationId)
    || !isUtcTimestamp(value.createdAtUtc)
    || !isUtcTimestamp(value.updatedAtUtc)
    || (value.type !== 'POTA' && value.type !== 'SOTA' && value.type !== 'General')) return null;

  const entities: V3ActivationEntity[] = [];
  if (value.type !== 'General') {
    const reference = normalizeReference(value.type, value.reference);
    if (!reference) return null;
    entities.push({
      schemaVersion: V3_ENTITY_STATE_SCHEMA_VERSION,
      entityId: entityId(value.activationId, value.type, reference),
      program: value.type,
      reference,
      provenance: { kind: 'legacy_migration' },
      createdAtUtc: value.createdAtUtc,
      updatedAtUtc: value.updatedAtUtc,
    });
  } else if (value.reference !== undefined && value.reference !== '') {
    return null;
  }

  const { type: _legacyType, reference: _legacyReference, schemaVersion: _legacyVersion, ...retained } = value;
  const ordered = orderEntities(entities);
  return {
    ...retained,
    schemaVersion: V3_ACTIVATION_SCHEMA_VERSION,
    activationId: value.activationId,
    entityState: {
      schemaVersion: V3_ENTITY_STATE_SCHEMA_VERSION,
      entities: ordered,
      activeEntityIds: ordered.map(entity => entity.entityId),
    },
  };
}

function migrateQso(value: unknown, activationState: V3ActivationEntityState | undefined): V3QsoRecord | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || !isStableId(value.qsoId)
    || !isStableId(value.activationId)
    || !isUtcTimestamp(value.createdAtUtc)
    || !isUtcTimestamp(value.updatedAtUtc)) return null;

  const associations: V3QsoEntityAssociation[] = [];
  for (const entity of activationState?.entities ?? []) {
    associations.push({ entityId: entity.entityId, program: entity.program, reference: entity.reference, source: 'legacy_migration' });
  }
  if (value.potaRef !== undefined) {
    const reference = normalizeReference('POTA', value.potaRef);
    if (!reference) return null;
    associations.push({ program: 'POTA', reference, source: 'legacy_migration' });
  }
  if (value.sotaRef !== undefined) {
    const reference = normalizeReference('SOTA', value.sotaRef);
    if (!reference) return null;
    associations.push({ program: 'SOTA', reference, source: 'legacy_migration' });
  }

  const canonical = deduplicateAssociations(associations);
  const { potaRef: _legacyPota, sotaRef: _legacySota, schemaVersion: _legacyVersion, ...retained } = value;
  return {
    ...retained,
    schemaVersion: V3_QSO_SCHEMA_VERSION,
    qsoId: value.qsoId,
    activationId: value.activationId,
    entityAssociations: { schemaVersion: V3_QSO_ASSOCIATIONS_SCHEMA_VERSION, entities: canonical },
  };
}

function deduplicateAssociations(values: readonly V3QsoEntityAssociation[]): V3QsoEntityAssociation[] {
  const byIdentity = new Map<string, V3QsoEntityAssociation>();
  for (const value of values) {
    const key = `${value.program}|${value.reference}`;
    const existing = byIdentity.get(key);
    if (!existing || (!existing.entityId && value.entityId)) byIdentity.set(key, value);
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.program.localeCompare(right.program)
    || left.reference.localeCompare(right.reference)
    || (left.entityId ?? '').localeCompare(right.entityId ?? ''));
}

function orderEntities(values: readonly V3ActivationEntity[]): V3ActivationEntity[] {
  return [...values].sort((left, right) =>
    left.program.localeCompare(right.program)
    || left.reference.localeCompare(right.reference)
    || left.entityId.localeCompare(right.entityId));
}

function normalizeReference(program: V3ActivationProgram, value: unknown): string | null {
  return program === 'POTA' ? normalizePotaReference(value) : normalizeSotaReference(value);
}

function entityId(activationId: string, program: V3ActivationProgram, reference: string): string {
  const digest = createHash('sha256').update(`${activationId}|${program}|${reference}`).digest('hex').slice(0, 24);
  return `entity-${digest}`;
}

function isV3ActivationStoreDocument(value: unknown): value is V3ActivationStoreDocument {
  return isRecord(value)
    && value.storeVersion === V3_ACTIVATION_STORE_VERSION
    && Array.isArray(value.activations)
    && value.activations.every((activation: unknown) => isRecord(activation)
      && activation.schemaVersion === V3_ACTIVATION_SCHEMA_VERSION
      && isStableId(activation.activationId)
      && isRecord(activation.entityState)
      && activation.entityState.schemaVersion === V3_ENTITY_STATE_SCHEMA_VERSION
      && Array.isArray(activation.entityState.entities)
      && Array.isArray(activation.entityState.activeEntityIds));
}

function isV3QsoStoreDocument(value: unknown): value is V3QsoStoreDocument {
  return isRecord(value)
    && value.storeVersion === V3_QSO_STORE_VERSION
    && Array.isArray(value.qsos)
    && value.qsos.every((qso: unknown) => isRecord(qso)
      && qso.schemaVersion === V3_QSO_SCHEMA_VERSION
      && isStableId(qso.qsoId)
      && isStableId(qso.activationId)
      && isRecord(qso.entityAssociations)
      && qso.entityAssociations.schemaVersion === V3_QSO_ASSOCIATIONS_SCHEMA_VERSION
      && Array.isArray(qso.entityAssociations.entities));
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
