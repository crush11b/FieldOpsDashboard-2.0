import { createHash, randomUUID } from 'node:crypto';
import { normalizePotaReference } from './potaTargetResolver';
import { normalizeSotaReference } from './sotaSummitDataset';

export type OperationProgram = 'POTA' | 'SOTA';
export type EntityProvenance = 'operator_entered' | 'legacy_migration' | 'retained_provider_evidence';
export type AssociationSource = 'active_operation' | 'operator_edit' | 'adif_import' | 'legacy_migration';
export interface ActivationEntity { readonly schemaVersion: 1; readonly entityId: string; readonly program: OperationProgram; readonly reference: string; readonly displayName?: string; readonly provenance: EntityProvenance; readonly createdAtUtc: string; readonly updatedAtUtc: string; }
export interface ActivationEntityState { readonly schemaVersion: 1; readonly entities: readonly ActivationEntity[]; readonly activeEntityIds: readonly string[]; }
export interface QsoEntityAssociation { readonly entityId?: string; readonly program: OperationProgram; readonly reference: string; readonly source: AssociationSource; }
export interface QsoEntityAssociations { readonly schemaVersion: 1; readonly entities: readonly QsoEntityAssociation[]; }

export function normalizeReference(program: OperationProgram, value: unknown): string | null { return program === 'POTA' ? normalizePotaReference(value) : normalizeSotaReference(value); }
export function legacyEntityId(activationId: string, program: OperationProgram, reference: string): string { return `entity-${createHash('sha256').update(`${activationId}|${program}|${reference}`).digest('hex').slice(0, 24)}`; }
export function createActivationEntity(input: { program: OperationProgram; reference: unknown; displayName?: unknown }, now: string, createId: () => string = randomUUID): ActivationEntity {
  const reference = normalizeReference(input.program, input.reference); if (!reference) throw new Error(`${input.program} reference is invalid.`);
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim().slice(0, 160) : '';
  return { schemaVersion: 1, entityId: createId(), program: input.program, reference, ...(displayName ? { displayName } : {}), provenance: 'operator_entered', createdAtUtc: now, updatedAtUtc: now };
}
export function normalizeEntityState(value: unknown, legacy: { activationId: string; type: string; reference?: unknown; createdAtUtc: string; updatedAtUtc: string }): ActivationEntityState {
  if (isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.entities) && Array.isArray(value.activeEntityIds)) {
    const entities = value.entities.map(normalizeEntity); const ids = new Set(entities.map(item => item.entityId));
    if (new Set(entities.map(item => `${item.program}|${item.reference}`)).size !== entities.length) throw new Error('Activation entities must be unique.');
    const activeEntityIds = [...new Set(value.activeEntityIds.map(String))]; if (activeEntityIds.some(id => !ids.has(id))) throw new Error('Active entities must belong to the Activation.');
    return { schemaVersion: 1, entities: orderEntities(entities), activeEntityIds };
  }
  if ((legacy.type === 'POTA' || legacy.type === 'SOTA') && legacy.reference) {
    const program = legacy.type; const reference = normalizeReference(program, legacy.reference) ?? legacyReference(legacy.reference); if (!reference) throw new Error('Legacy Activation reference is invalid.');
    const entity: ActivationEntity = { schemaVersion: 1, entityId: legacyEntityId(legacy.activationId, program, reference), program, reference, provenance: 'legacy_migration', createdAtUtc: legacy.createdAtUtc, updatedAtUtc: legacy.updatedAtUtc };
    return { schemaVersion: 1, entities: [entity], activeEntityIds: [entity.entityId] };
  }
  return { schemaVersion: 1, entities: [], activeEntityIds: [] };
}
export function normalizeAssociations(value: unknown, legacy: { potaRef?: unknown; sotaRef?: unknown } = {}): QsoEntityAssociations {
  const candidates: unknown[] = isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.entities) ? value.entities : [
    ...(legacy.potaRef ? [{ program: 'POTA', reference: legacy.potaRef, source: 'legacy_migration' }] : []),
    ...(legacy.sotaRef ? [{ program: 'SOTA', reference: legacy.sotaRef, source: 'legacy_migration' }] : []),
  ];
  const byKey = new Map<string, QsoEntityAssociation>();
  for (const candidate of candidates) { if (!isRecord(candidate) || (candidate.program !== 'POTA' && candidate.program !== 'SOTA')) throw new Error('QSO entity association is invalid.'); const reference = normalizeReference(candidate.program, candidate.reference); if (!reference) throw new Error('QSO entity reference is invalid.'); const source = candidate.source; if (!['active_operation','operator_edit','adif_import','legacy_migration'].includes(source)) throw new Error('QSO entity association source is invalid.'); const entityId = typeof candidate.entityId === 'string' && candidate.entityId.trim() ? candidate.entityId.trim() : undefined; const normalized = { ...(entityId ? { entityId } : {}), program: candidate.program, reference, source } as QsoEntityAssociation; const key = `${candidate.program}|${reference}`; const existing = byKey.get(key); if (!existing?.entityId || entityId) byKey.set(key, normalized); }
  return { schemaVersion: 1, entities: [...byKey.values()].sort((a,b) => a.program.localeCompare(b.program) || a.reference.localeCompare(b.reference)) };
}
export function activeAssociations(state: ActivationEntityState, source: AssociationSource = 'active_operation'): QsoEntityAssociations { const active = new Set(state.activeEntityIds); return { schemaVersion: 1, entities: state.entities.filter(entity => active.has(entity.entityId)).map(entity => ({ entityId: entity.entityId, program: entity.program, reference: entity.reference, source })) }; }
function normalizeEntity(value: unknown): ActivationEntity { if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.entityId !== 'string' || (value.program !== 'POTA' && value.program !== 'SOTA')) throw new Error('Activation entity is invalid.'); const provenance = isRecord(value.provenance) ? value.provenance.kind : value.provenance; if (!['operator_entered','legacy_migration','retained_provider_evidence'].includes(provenance)) throw new Error('Activation entity provenance is invalid.'); const reference = normalizeReference(value.program, value.reference) ?? (provenance === 'legacy_migration' ? legacyReference(value.reference) : null); if (!reference) throw new Error('Activation entity reference is invalid.'); if (typeof value.createdAtUtc !== 'string' || typeof value.updatedAtUtc !== 'string') throw new Error('Activation entity timestamps are invalid.'); return { schemaVersion: 1, entityId: value.entityId, program: value.program, reference, ...(typeof value.displayName === 'string' && value.displayName.trim() ? { displayName: value.displayName.trim() } : {}), provenance, createdAtUtc: new Date(value.createdAtUtc).toISOString(), updatedAtUtc: new Date(value.updatedAtUtc).toISOString() }; }
function orderEntities(values: readonly ActivationEntity[]): ActivationEntity[] { return [...values].sort((a,b) => a.program.localeCompare(b.program) || a.reference.localeCompare(b.reference) || a.entityId.localeCompare(b.entityId)); }
function legacyReference(value: unknown): string | null { if (typeof value !== 'string') return null; const result = value.trim().toUpperCase(); return result && result.length <= 64 && /^[A-Z0-9][A-Z0-9/-]*$/.test(result) ? result : null; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
