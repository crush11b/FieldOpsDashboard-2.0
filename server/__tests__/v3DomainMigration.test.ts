import { describe, expect, it } from 'vitest';
import { migrateV2_9_1DomainDocuments } from '../v3DomainMigration';

const timestamps = {
  createdAtUtc: '2026-08-25T11:00:00.000Z',
  updatedAtUtc: '2026-08-25T12:00:00.000Z',
};

function activation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    activationId: 'activation-1',
    type: 'POTA',
    reference: 'US-0182',
    status: 'active',
    ...timestamps,
    ...overrides,
  };
}

function qso(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    qsoId: 'qso-1',
    activationId: 'activation-1',
    qsoDateTimeUtc: '2026-08-25T11:59:00.000Z',
    callsign: 'W1AW',
    band: '20m',
    mode: 'FT8',
    source: 'wsjtx',
    ...timestamps,
    ...overrides,
  };
}

const documents = (
  activations: unknown[] = [activation()],
  qsos: unknown[] = [qso()],
) => [
  { storeVersion: 2, activations },
  { storeVersion: 1, qsos },
] as const;

describe('V2.9.1 Activation and QSO domain migration', () => {
  it('migrates a singular POTA Activation and inherited QSO association without retaining legacy write fields', () => {
    const [activations, qsos] = documents();
    const result = migrateV2_9_1DomainDocuments(activations, qsos);
    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    expect(result.activations.storeVersion).toBe(3);
    expect(result.activations.activations[0]).toMatchObject({
      schemaVersion: 3,
      activationId: 'activation-1',
      entityState: {
        schemaVersion: 1,
        entities: [{
          schemaVersion: 1,
          program: 'POTA',
          reference: 'US-0182',
          provenance: { kind: 'legacy_migration' },
        }],
      },
    });
    const entity = result.activations.activations[0].entityState.entities[0];
    expect(result.activations.activations[0].entityState.activeEntityIds).toEqual([entity.entityId]);
    expect(result.qsos.qsos[0]).toMatchObject({
      schemaVersion: 2,
      qsoId: 'qso-1',
      entityAssociations: {
        schemaVersion: 1,
        entities: [{ entityId: entity.entityId, program: 'POTA', reference: 'US-0182', source: 'legacy_migration' }],
      },
    });
    expect(result.activations.activations[0]).not.toHaveProperty('type');
    expect(result.activations.activations[0]).not.toHaveProperty('reference');
    expect(result.qsos.qsos[0]).not.toHaveProperty('potaRef');
    expect(result.qsos.qsos[0]).not.toHaveProperty('sotaRef');
  });

  it('preserves a differing QSO reference as a second association without duplicating the contact', () => {
    const [activations, qsos] = documents(
      [activation()],
      [qso({ potaRef: 'US-0001' })],
    );
    const result = migrateV2_9_1DomainDocuments(activations, qsos);
    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    expect(result.qsos.qsos).toHaveLength(1);
    expect(result.qsos.qsos[0].entityAssociations.entities.map(entity => [entity.program, entity.reference])).toEqual([
      ['POTA', 'US-0001'],
      ['POTA', 'US-0182'],
    ]);
  });

  it('deduplicates matching inherited and QSO references and retains the stable entity link', () => {
    const [activations, qsos] = documents(
      [activation({ reference: 'us-0182' })],
      [qso({ potaRef: ' US-0182 ' })],
    );
    const result = migrateV2_9_1DomainDocuments(activations, qsos);
    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    expect(result.qsos.qsos[0].entityAssociations.entities).toHaveLength(1);
    expect(result.qsos.qsos[0].entityAssociations.entities[0].entityId).toMatch(/^entity-[a-f0-9]{24}$/);
  });

  it('migrates SOTA and General Activations truthfully', () => {
    const [activations, qsos] = documents([
      activation({ activationId: 'sota-1', type: 'SOTA', reference: 'W4V/SH-001' }),
      activation({ activationId: 'general-1', type: 'General', reference: undefined }),
    ], [
      qso({ qsoId: 'sota-qso', activationId: 'sota-1', sotaRef: 'W4V/SH-001' }),
      qso({ qsoId: 'general-qso', activationId: 'general-1' }),
    ]);
    const result = migrateV2_9_1DomainDocuments(activations, qsos);
    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    expect(result.activations.activations[0].entityState.entities[0]).toMatchObject({ program: 'SOTA', reference: 'W4V/SH-001' });
    expect(result.activations.activations[1].entityState).toEqual({ schemaVersion: 1, entities: [], activeEntityIds: [] });
    expect(result.qsos.qsos[1].entityAssociations.entities).toEqual([]);
  });

  it('is deterministic and recognizes its validated output as current on rerun', () => {
    const [activations, qsos] = documents();
    const first = migrateV2_9_1DomainDocuments(activations, qsos);
    expect(first).toEqual(migrateV2_9_1DomainDocuments(activations, qsos));
    expect(first.status).toBe('migrated');
    if (first.status !== 'migrated') return;
    expect(migrateV2_9_1DomainDocuments(first.activations, first.qsos)).toEqual({
      status: 'current',
      activations: first.activations,
      qsos: first.qsos,
    });
  });

  it('fails the whole transform for malformed references or duplicate stable IDs', () => {
    const [, qsos] = documents();
    expect(migrateV2_9_1DomainDocuments(
      { storeVersion: 2, activations: [activation({ reference: 'not-a-park' })] },
      qsos,
    )).toMatchObject({ status: 'invalid' });
    expect(migrateV2_9_1DomainDocuments(
      { storeVersion: 2, activations: [activation(), activation()] },
      qsos,
    )).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/duplicate Activation IDs/) });
    expect(migrateV2_9_1DomainDocuments(
      { storeVersion: 2, activations: [activation()] },
      { storeVersion: 1, qsos: [qso(), qso()] },
    )).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/duplicate QSO IDs/) });
  });

  it('distinguishes malformed and unsupported aggregate versions', () => {
    const [activations, qsos] = documents();
    expect(migrateV2_9_1DomainDocuments({ storeVersion: 99, activations: [] }, qsos))
      .toEqual({ status: 'unsupported', aggregate: 'activations', storeVersion: 99 });
    expect(migrateV2_9_1DomainDocuments(activations, { storeVersion: 99, qsos: [] }))
      .toEqual({ status: 'unsupported', aggregate: 'qsos', storeVersion: 99 });
    expect(migrateV2_9_1DomainDocuments({ storeVersion: 2 }, qsos)).toMatchObject({ status: 'invalid' });
  });

  it('preserves valid zero-valued and retained evidence fields verbatim', () => {
    const [activations, qsos] = documents(
      [activation({ transmitPowerWatts: 0, notesCollectionId: 'notes-1' })],
      [qso({ frequencyMHz: 0, rstSent: '0', notes: '' })],
    );
    const result = migrateV2_9_1DomainDocuments(activations, qsos);
    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    expect(result.activations.activations[0].transmitPowerWatts).toBe(0);
    expect(result.activations.activations[0].notesCollectionId).toBe('notes-1');
    expect(result.qsos.qsos[0].frequencyMHz).toBe(0);
    expect(result.qsos.qsos[0].rstSent).toBe('0');
    expect(result.qsos.qsos[0].notes).toBe('');
  });
});
