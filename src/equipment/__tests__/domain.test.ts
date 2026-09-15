import { describe, expect, it } from 'vitest';
import { createLoadoutSnapshot, normalizeEquipment, normalizeLoadout, restoreEquipment, tombstoneEquipment } from '../domain';

const time = '2026-09-15T18:00:00.000Z';
const radio = () => normalizeEquipment({ schemaVersion: 1, equipmentId: 'radio-ic705', kind: 'radio', label: 'IC-705', manufacturer: 'Icom', model: 'IC-705', facts: [{ key: 'max_power_watts', value: 10, unit: 'W', source: 'operator_entered' }], limitations: ['External amplifier required above 10 W.'], notes: 'Portable radio', state: 'active', createdAtUtc: time, updatedAtUtc: time });

describe('equipment inventory domain', () => {
  it('normalizes bounded operator facts without inventing unknown values', () => { const value = radio(); expect(value.facts).toEqual([{ key: 'max_power_watts', value: 10, unit: 'W', source: 'operator_entered' }]); expect(value.facts.find(fact => fact.key === 'battery_capacity')).toBeUndefined(); });
  it('rejects unsupported schemas, duplicate facts, and invalid identities', () => {
    expect(() => normalizeEquipment({ ...radio(), schemaVersion: 2 })).toThrow(/unsupported/);
    expect(() => normalizeEquipment({ ...radio(), equipmentId: '../radio' })).toThrow(/equipmentId/);
    expect(() => normalizeEquipment({ ...radio(), facts: [...radio().facts, ...radio().facts] })).toThrow(/unique/);
  });
  it('tombstones and restores without changing stable identity', () => { const deleted = tombstoneEquipment(radio(), new Date('2026-09-16T00:00:00Z')); expect(deleted).toMatchObject({ equipmentId: 'radio-ic705', state: 'deleted', deletedAtUtc: '2026-09-16T00:00:00.000Z' }); const restored = restoreEquipment(deleted, new Date('2026-09-17T00:00:00Z')); expect(restored).toMatchObject({ equipmentId: 'radio-ic705', state: 'active' }); expect(restored).not.toHaveProperty('deletedAtUtc'); });
});

describe('loadout domain', () => {
  it('references inventory records and rejects missing, deleted, or duplicate configurations', () => {
    const input = { schemaVersion: 1, loadoutId: 'portable-50w', name: 'Portable 50 W', items: [{ equipmentId: 'radio-ic705', role: 'primary radio', quantity: 1 }], limitations: [], state: 'active', createdAtUtc: time, updatedAtUtc: time };
    expect(normalizeLoadout(input, [radio()]).items).toHaveLength(1);
    expect(() => normalizeLoadout(input, [])).toThrow(/missing equipment/);
    expect(() => normalizeLoadout({ ...input, items: [input.items[0], input.items[0]] }, [radio()])).toThrow(/consolidated/);
    expect(() => normalizeLoadout(input, [tombstoneEquipment(radio(), new Date(time))])).toThrow(/deleted equipment/);
  });
  it('creates a deeply immutable historical snapshot', () => {
    const equipment = radio();
    const loadout = normalizeLoadout({ schemaVersion: 1, loadoutId: 'portable', name: 'Portable', items: [{ equipmentId: equipment.equipmentId, role: 'radio', quantity: 1 }], limitations: ['Packing list is not proof of readiness.'], state: 'active', createdAtUtc: time, updatedAtUtc: time }, [equipment]);
    const snapshot = createLoadoutSnapshot(loadout, [equipment], new Date(time));
    expect(snapshot.items[0].equipment.label).toBe('IC-705');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.items[0].equipment.facts)).toBe(true);
  });
});
