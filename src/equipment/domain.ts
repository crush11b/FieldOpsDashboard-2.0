export const EQUIPMENT_SCHEMA_VERSION = 1 as const;
export const LOADOUT_SCHEMA_VERSION = 1 as const;

export const EQUIPMENT_KINDS = ['radio', 'amplifier', 'antenna', 'tuner', 'battery', 'power_system', 'computer', 'interface', 'cable_adapter', 'other'] as const;
export type EquipmentKind = typeof EQUIPMENT_KINDS[number];
export type FactSource = 'operator_entered' | 'operator_confirmed' | 'legacy_migration';
export type EquipmentState = 'active' | 'deleted';
export type FactValue = string | number | boolean;
export interface EquipmentFact { readonly key: string; readonly value: FactValue; readonly unit?: string; readonly source: FactSource; readonly notes?: string; }
export interface EquipmentRecord { readonly schemaVersion: 1; readonly equipmentId: string; readonly kind: EquipmentKind; readonly label: string; readonly manufacturer?: string; readonly model?: string; readonly facts: readonly EquipmentFact[]; readonly limitations: readonly string[]; readonly notes?: string; readonly state: EquipmentState; readonly createdAtUtc: string; readonly updatedAtUtc: string; readonly deletedAtUtc?: string; }
export interface LoadoutItem { readonly equipmentId: string; readonly role: string; readonly quantity: number; readonly configuration?: Readonly<Record<string, FactValue>>; readonly notes?: string; }
export interface LoadoutRecord { readonly schemaVersion: 1; readonly loadoutId: string; readonly name: string; readonly description?: string; readonly items: readonly LoadoutItem[]; readonly limitations: readonly string[]; readonly state: EquipmentState; readonly createdAtUtc: string; readonly updatedAtUtc: string; readonly deletedAtUtc?: string; }
export interface LoadoutSnapshot { readonly schemaVersion: 1; readonly loadoutId: string; readonly loadoutName: string; readonly capturedAtUtc: string; readonly provenance: 'operator_committed'; readonly items: readonly { readonly item: LoadoutItem; readonly equipment: EquipmentRecord }[]; readonly limitations: readonly string[]; }

const ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const FACT_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const FACT_SOURCES = new Set<FactSource>(['operator_entered', 'operator_confirmed', 'legacy_migration']);

export function normalizeEquipment(input: unknown): EquipmentRecord {
  const value = record(input, 'Equipment');
  if (value.schemaVersion !== 1) throw new Error('Equipment schema version is unsupported.');
  const state = equipmentState(value.state);
  const facts = array(value.facts, 'Equipment facts').map(normalizeFact).sort((a, b) => a.key.localeCompare(b.key));
  if (new Set(facts.map(fact => fact.key)).size !== facts.length) throw new Error('Equipment fact keys must be unique.');
  const deletedAtUtc = optionalTimestamp(value.deletedAtUtc, 'deletedAtUtc');
  if ((state === 'deleted') !== Boolean(deletedAtUtc)) throw new Error('Deleted equipment requires deletedAtUtc; active equipment must omit it.');
  return freeze({ schemaVersion: 1, equipmentId: stableId(value.equipmentId, 'equipmentId'), kind: oneOf(value.kind, EQUIPMENT_KINDS, 'kind'), label: text(value.label, 'label', 120), ...optionalTextFields(value, ['manufacturer', 'model'], 120), facts, limitations: textArray(value.limitations, 'limitations', 500), ...optionalTextFields(value, ['notes'], 2000), state, createdAtUtc: timestamp(value.createdAtUtc, 'createdAtUtc'), updatedAtUtc: timestamp(value.updatedAtUtc, 'updatedAtUtc'), ...(deletedAtUtc ? { deletedAtUtc } : {}) });
}

export function normalizeLoadout(input: unknown, equipment: readonly EquipmentRecord[], options: { readonly allowDeletedReferences?: boolean } = {}): LoadoutRecord {
  const value = record(input, 'Loadout');
  if (value.schemaVersion !== 1) throw new Error('Loadout schema version is unsupported.');
  const equipmentById = new Map(equipment.map(item => [item.equipmentId, item]));
  const items = array(value.items, 'Loadout items').map(normalizeLoadoutItem).sort((a, b) => a.equipmentId.localeCompare(b.equipmentId) || a.role.localeCompare(b.role));
  const keys = items.map(item => `${item.equipmentId}\0${item.role}\0${JSON.stringify(item.configuration ?? {})}`);
  if (new Set(keys).size !== keys.length) throw new Error('Equivalent loadout items must be consolidated by quantity.');
  for (const item of items) {
    const referenced = equipmentById.get(item.equipmentId);
    if (!referenced) throw new Error(`Loadout references missing equipment: ${item.equipmentId}.`);
    if (referenced.state === 'deleted' && value.state !== 'deleted' && !options.allowDeletedReferences) throw new Error(`Active loadouts cannot add deleted equipment: ${item.equipmentId}.`);
  }
  const state = equipmentState(value.state);
  const deletedAtUtc = optionalTimestamp(value.deletedAtUtc, 'deletedAtUtc');
  if ((state === 'deleted') !== Boolean(deletedAtUtc)) throw new Error('Deleted loadouts require deletedAtUtc; active loadouts must omit it.');
  return freeze({ schemaVersion: 1, loadoutId: stableId(value.loadoutId, 'loadoutId'), name: text(value.name, 'name', 120), ...optionalTextFields(value, ['description'], 1000), items, limitations: textArray(value.limitations, 'limitations', 500), state, createdAtUtc: timestamp(value.createdAtUtc, 'createdAtUtc'), updatedAtUtc: timestamp(value.updatedAtUtc, 'updatedAtUtc'), ...(deletedAtUtc ? { deletedAtUtc } : {}) });
}

export function tombstoneEquipment(value: EquipmentRecord, now: Date): EquipmentRecord { return normalizeEquipment({ ...value, state: 'deleted', updatedAtUtc: now.toISOString(), deletedAtUtc: now.toISOString() }); }
export function restoreEquipment(value: EquipmentRecord, now: Date): EquipmentRecord { const { deletedAtUtc: _, ...rest } = value; return normalizeEquipment({ ...rest, state: 'active', updatedAtUtc: now.toISOString() }); }
export function tombstoneLoadout(value: LoadoutRecord, equipment: readonly EquipmentRecord[], now: Date): LoadoutRecord { return normalizeLoadout({ ...value, state: 'deleted', updatedAtUtc: now.toISOString(), deletedAtUtc: now.toISOString() }, equipment); }
export function restoreLoadout(value: LoadoutRecord, equipment: readonly EquipmentRecord[], now: Date): LoadoutRecord { const { deletedAtUtc: _, ...rest } = value; return normalizeLoadout({ ...rest, state: 'active', updatedAtUtc: now.toISOString() }, equipment); }

export function createLoadoutSnapshot(loadout: LoadoutRecord, equipment: readonly EquipmentRecord[], now: Date): LoadoutSnapshot {
  const byId = new Map(equipment.map(item => [item.equipmentId, item]));
  const items = loadout.items.map(item => { const found = byId.get(item.equipmentId); if (!found) throw new Error(`Snapshot equipment is unavailable: ${item.equipmentId}.`); return { item, equipment: found }; });
  return freeze({ schemaVersion: 1, loadoutId: loadout.loadoutId, loadoutName: loadout.name, capturedAtUtc: timestamp(now.toISOString(), 'capturedAtUtc'), provenance: 'operator_committed', items, limitations: loadout.limitations });
}

export function normalizeLoadoutSnapshot(input: unknown): LoadoutSnapshot {
  const value = record(input, 'Loadout snapshot');
  if (value.schemaVersion !== 1 || value.provenance !== 'operator_committed') throw new Error('Loadout snapshot schema is unsupported.');
  const rawItems = array(value.items, 'Loadout snapshot items');
  const equipment = rawItems.map(raw => normalizeEquipment(record(raw, 'Loadout snapshot item').equipment));
  const items = rawItems.map(raw => {
    const itemValue = record(raw, 'Loadout snapshot item');
    return freeze({ item: normalizeLoadoutItem(itemValue.item), equipment: normalizeEquipment(itemValue.equipment) });
  });
  const loadout = normalizeLoadout({ schemaVersion: 1, loadoutId: value.loadoutId, name: value.loadoutName, items: items.map(entry => entry.item), limitations: value.limitations, state: 'active', createdAtUtc: value.capturedAtUtc, updatedAtUtc: value.capturedAtUtc }, equipment, { allowDeletedReferences: true });
  return freeze({ schemaVersion: 1, loadoutId: loadout.loadoutId, loadoutName: loadout.name, capturedAtUtc: timestamp(value.capturedAtUtc, 'capturedAtUtc'), provenance: 'operator_committed', items, limitations: loadout.limitations });
}

function normalizeFact(input: unknown): EquipmentFact { const value = record(input, 'Equipment fact'); const key = typeof value.key === 'string' ? value.key.trim().toLowerCase() : ''; if (!FACT_KEY.test(key)) throw new Error('Equipment fact key is invalid.'); if (!['string', 'number', 'boolean'].includes(typeof value.value) || (typeof value.value === 'number' && !Number.isFinite(value.value)) || (typeof value.value === 'string' && (!value.value.trim() || value.value.length > 500))) throw new Error(`Equipment fact ${key} has an invalid value.`); if (!FACT_SOURCES.has(value.source as FactSource)) throw new Error(`Equipment fact ${key} has an invalid source.`); return freeze({ key, value: typeof value.value === 'string' ? value.value.trim() : value.value as number | boolean, ...optionalTextFields(value, ['unit'], 40), source: value.source as FactSource, ...optionalTextFields(value, ['notes'], 500) }); }
function normalizeLoadoutItem(input: unknown): LoadoutItem { const value = record(input, 'Loadout item'); const quantity = value.quantity; if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 99) throw new Error('Loadout item quantity must be an integer from 1 to 99.'); const configuration = value.configuration === undefined ? undefined : configurationRecord(value.configuration); return freeze({ equipmentId: stableId(value.equipmentId, 'equipmentId'), role: text(value.role, 'role', 120), quantity: quantity as number, ...(configuration ? { configuration } : {}), ...optionalTextFields(value, ['notes'], 500) }); }
function configurationRecord(input: unknown): Readonly<Record<string, FactValue>> { const value = record(input, 'Loadout configuration'); const output: Record<string, FactValue> = {}; for (const [key, item] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) { if (!FACT_KEY.test(key) || !['string', 'number', 'boolean'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('Loadout configuration is invalid.'); output[key] = typeof item === 'string' ? text(item, key, 500) : item as number | boolean; } return freeze(output); }
function stableId(input: unknown, name: string): string { const value = typeof input === 'string' ? input.trim() : ''; if (!ID.test(value)) throw new Error(`${name} is invalid.`); return value; }
function text(input: unknown, name: string, max: number): string { const value = typeof input === 'string' ? input.trim() : ''; if (!value || value.length > max) throw new Error(`${name} is invalid.`); return value; }
function optionalTextFields(value: Record<string, unknown>, keys: readonly string[], max: number): Record<string, string> { return Object.fromEntries(keys.flatMap(key => value[key] === undefined ? [] : [[key, text(value[key], key, max)]])); }
function textArray(input: unknown, name: string, max: number): readonly string[] { const values = array(input, name).map((item, index) => text(item, `${name}[${index}]`, max)); return [...new Set(values)].sort(); }
function equipmentState(input: unknown): EquipmentState { if (input !== 'active' && input !== 'deleted') throw new Error('Record state is invalid.'); return input; }
function timestamp(input: unknown, name: string): string { if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input) || !Number.isFinite(Date.parse(input))) throw new Error(`${name} is invalid.`); return new Date(input).toISOString(); }
function optionalTimestamp(input: unknown, name: string): string | undefined { return input === undefined ? undefined : timestamp(input, name); }
function oneOf<T extends string>(input: unknown, values: readonly T[], name: string): T { if (!values.includes(input as T)) throw new Error(`${name} is invalid.`); return input as T; }
function array(input: unknown, name: string): unknown[] { if (!Array.isArray(input)) throw new Error(`${name} must be an array.`); return input; }
function record(input: unknown, name: string): Record<string, unknown> { if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error(`${name} is malformed.`); return input as Record<string, unknown>; }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const item of Object.values(value as Record<string, unknown>)) freeze(item); Object.freeze(value); } return value; }
