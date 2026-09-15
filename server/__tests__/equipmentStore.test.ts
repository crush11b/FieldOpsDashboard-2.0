import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EquipmentStore } from '../equipmentStore';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function store() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-equipment-')); roots.push(root); let id = 0; return { root, value: new EquipmentStore(path.join(root, 'equipment-inventory.json'), path.join(root, 'loadouts.json'), { now: () => new Date('2026-09-15T18:00:00Z'), createId: () => String(++id) }) }; }
function radio(value: EquipmentStore) { return value.createEquipment({ kind: 'radio', label: 'IC-705', facts: [{ key: 'max_power_watts', value: 10, source: 'operator_entered', unit: 'W' }], limitations: [] }); }
describe('EquipmentStore', () => {
  it('treats absent stores as empty without creating fabricated defaults', () => { const { value } = store(); expect(value.loadInventory()).toMatchObject({ status: 'missing', equipment: [] }); expect(value.loadLoadouts()).toMatchObject({ status: 'missing', loadouts: [] }); });
  it('persists equipment, tombstones it, and restores the same stable ID', () => { const { value } = store(); const created = radio(value); expect(value.loadInventory().equipment).toHaveLength(1); expect(value.deleteEquipment(created.equipmentId).state).toBe('deleted'); expect(value.restoreEquipment(created.equipmentId)).toMatchObject({ equipmentId: created.equipmentId, state: 'active' }); });
  it('persists reusable loadouts and retains deleted equipment references', () => { const { value } = store(); const equipment = radio(value); const loadout = value.createLoadout({ name: 'Portable', items: [{ equipmentId: equipment.equipmentId, role: 'primary radio', quantity: 1 }], limitations: [] }); value.deleteEquipment(equipment.equipmentId); expect(value.loadLoadouts().loadouts[0]).toMatchObject({ loadoutId: loadout.loadoutId }); });
  it('fails closed instead of overwriting corrupt or newer stores', () => { const { root, value } = store(); fs.writeFileSync(path.join(root, 'equipment-inventory.json'), '{broken'); expect(value.loadInventory().status).toBe('invalid'); expect(() => radio(value)).toThrow(/not writable/); fs.writeFileSync(path.join(root, 'equipment-inventory.json'), JSON.stringify({ storeVersion: 99, equipment: [] })); expect(value.loadInventory().diagnostics[0].code).toBe('unsupported_store_version'); });
  it('fails the whole store closed when any retained record is invalid', () => { const { root, value } = store(); fs.writeFileSync(path.join(root, 'equipment-inventory.json'), JSON.stringify({ storeVersion: 1, equipment: [{ schemaVersion: 1, equipmentId: '../invalid' }] })); expect(value.loadInventory()).toMatchObject({ status: 'invalid', equipment: [], diagnostics: [{ code: 'invalid_record' }] }); expect(() => radio(value)).toThrow(/not writable/); });
});
