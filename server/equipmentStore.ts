import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeEquipment, normalizeLoadout, restoreEquipment, restoreLoadout, tombstoneEquipment, tombstoneLoadout, type EquipmentRecord, type LoadoutRecord } from '../src/equipment/domain';

export const EQUIPMENT_STORE_VERSION = 1 as const;
export const LOADOUT_STORE_VERSION = 1 as const;
export interface StoreDiagnostic { readonly code: 'missing' | 'corrupt' | 'unsupported_store_version' | 'invalid_record' | 'io_error'; readonly message: string; readonly recordId?: string; }
export interface InventoryReadResult { readonly status: 'missing' | 'loaded' | 'invalid' | 'ioError'; readonly equipment: readonly EquipmentRecord[]; readonly diagnostics: readonly StoreDiagnostic[]; }
export interface LoadoutReadResult { readonly status: 'missing' | 'loaded' | 'invalid' | 'ioError'; readonly loadouts: readonly LoadoutRecord[]; readonly diagnostics: readonly StoreDiagnostic[]; }

export function getDefaultEquipmentPaths(environment: NodeJS.ProcessEnv = process.env, homeDirectory = os.homedir()): { inventory: string; loadouts: string } {
  const root = path.join(environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local'), 'FieldOpsDashboard');
  return { inventory: path.join(root, 'equipment-inventory.json'), loadouts: path.join(root, 'loadouts.json') };
}

export class EquipmentStore {
  constructor(private readonly inventoryPath: string, private readonly loadoutPath: string, private readonly options: { readonly now?: () => Date; readonly createId?: () => string } = {}) {}

  loadInventory(): InventoryReadResult {
    const loaded = readDocument(this.inventoryPath, EQUIPMENT_STORE_VERSION, 'equipment');
    if (loaded.status !== 'loaded') return { ...loaded, equipment: [] } as InventoryReadResult;
    const equipment: EquipmentRecord[] = []; const diagnostics: StoreDiagnostic[] = [];
    for (const candidate of loaded.values) { try { equipment.push(normalizeEquipment(candidate)); } catch { diagnostics.push({ code: 'invalid_record', message: 'An equipment record was skipped because it is invalid.', recordId: candidateId(candidate, 'equipmentId') }); } }
    return { status: diagnostics.length ? 'invalid' : 'loaded', equipment: diagnostics.length ? [] : orderEquipment(equipment), diagnostics };
  }

  loadLoadouts(): LoadoutReadResult {
    const inventory = this.loadInventory();
    if (inventory.status === 'invalid' || inventory.status === 'ioError') return { status: inventory.status, loadouts: [], diagnostics: inventory.diagnostics };
    const loaded = readDocument(this.loadoutPath, LOADOUT_STORE_VERSION, 'loadouts');
    if (loaded.status !== 'loaded') return { ...loaded, loadouts: [] } as LoadoutReadResult;
    const loadouts: LoadoutRecord[] = []; const diagnostics: StoreDiagnostic[] = [];
    for (const candidate of loaded.values) { try { loadouts.push(normalizeLoadout(candidate, inventory.equipment, { allowDeletedReferences: true })); } catch { diagnostics.push({ code: 'invalid_record', message: 'A loadout was skipped because it is invalid.', recordId: candidateId(candidate, 'loadoutId') }); } }
    return { status: diagnostics.length ? 'invalid' : 'loaded', loadouts: diagnostics.length ? [] : orderLoadouts(loadouts), diagnostics };
  }

  createEquipment(input: unknown): EquipmentRecord { const loaded = requireWritable(this.loadInventory(), 'inventory'); const now = this.now(); const equipmentId = `equipment-${this.options.createId?.() ?? randomUUID()}`.toLowerCase(); const record = normalizeEquipment({ ...(asRecord(input)), schemaVersion: 1, equipmentId, state: 'active', createdAtUtc: now, updatedAtUtc: now, facts: asRecord(input).facts ?? [], limitations: asRecord(input).limitations ?? [] }); if (loaded.equipment.some(item => item.equipmentId === equipmentId)) throw new Error('Equipment ID already exists.'); this.writeInventory([record, ...loaded.equipment]); return record; }
  updateEquipment(id: string, input: unknown): EquipmentRecord { const loaded = requireWritable(this.loadInventory(), 'inventory'); const current = loaded.equipment.find(item => item.equipmentId === id); if (!current) throw new NotFoundError(); const record = normalizeEquipment({ ...current, ...asRecord(input), schemaVersion: 1, equipmentId: id, createdAtUtc: current.createdAtUtc, updatedAtUtc: this.now(), state: current.state, ...(current.deletedAtUtc ? { deletedAtUtc: current.deletedAtUtc } : {}) }); this.writeInventory([record, ...loaded.equipment.filter(item => item.equipmentId !== id)]); return record; }
  deleteEquipment(id: string): EquipmentRecord { return this.transitionEquipment(id, true); }
  restoreEquipment(id: string): EquipmentRecord { return this.transitionEquipment(id, false); }
  private transitionEquipment(id: string, deleted: boolean): EquipmentRecord { const loaded = requireWritable(this.loadInventory(), 'inventory'); const current = loaded.equipment.find(item => item.equipmentId === id); if (!current) throw new NotFoundError(); const record = deleted ? tombstoneEquipment(current, this.date()) : restoreEquipment(current, this.date()); this.writeInventory([record, ...loaded.equipment.filter(item => item.equipmentId !== id)]); return record; }

  createLoadout(input: unknown): LoadoutRecord { const inventory = requireWritable(this.loadInventory(), 'inventory'); const loaded = requireWritable(this.loadLoadouts(), 'loadouts'); const now = this.now(); const loadoutId = `loadout-${this.options.createId?.() ?? randomUUID()}`.toLowerCase(); const record = normalizeLoadout({ ...asRecord(input), schemaVersion: 1, loadoutId, state: 'active', createdAtUtc: now, updatedAtUtc: now, items: asRecord(input).items ?? [], limitations: asRecord(input).limitations ?? [] }, inventory.equipment); if (loaded.loadouts.some(item => item.loadoutId === loadoutId)) throw new Error('Loadout ID already exists.'); this.writeLoadouts([record, ...loaded.loadouts]); return record; }
  updateLoadout(id: string, input: unknown): LoadoutRecord { const inventory = requireWritable(this.loadInventory(), 'inventory'); const loaded = requireWritable(this.loadLoadouts(), 'loadouts'); const current = loaded.loadouts.find(item => item.loadoutId === id); if (!current) throw new NotFoundError(); const record = normalizeLoadout({ ...current, ...asRecord(input), schemaVersion: 1, loadoutId: id, createdAtUtc: current.createdAtUtc, updatedAtUtc: this.now(), state: current.state, ...(current.deletedAtUtc ? { deletedAtUtc: current.deletedAtUtc } : {}) }, inventory.equipment); this.writeLoadouts([record, ...loaded.loadouts.filter(item => item.loadoutId !== id)]); return record; }
  deleteLoadout(id: string): LoadoutRecord { return this.transitionLoadout(id, true); }
  restoreLoadout(id: string): LoadoutRecord { return this.transitionLoadout(id, false); }
  private transitionLoadout(id: string, deleted: boolean): LoadoutRecord { const inventory = requireWritable(this.loadInventory(), 'inventory'); const loaded = requireWritable(this.loadLoadouts(), 'loadouts'); const current = loaded.loadouts.find(item => item.loadoutId === id); if (!current) throw new NotFoundError(); const record = deleted ? tombstoneLoadout(current, inventory.equipment, this.date()) : restoreLoadout(current, inventory.equipment, this.date()); this.writeLoadouts([record, ...loaded.loadouts.filter(item => item.loadoutId !== id)]); return record; }
  private writeInventory(equipment: readonly EquipmentRecord[]): void { atomicWrite(this.inventoryPath, { storeVersion: 1, equipment: orderEquipment(equipment) }); }
  private writeLoadouts(loadouts: readonly LoadoutRecord[]): void { atomicWrite(this.loadoutPath, { storeVersion: 1, loadouts: orderLoadouts(loadouts) }); }
  private date(): Date { return this.options.now?.() ?? new Date(); }
  private now(): string { return this.date().toISOString(); }
}

export class NotFoundError extends Error {}
type RawRead = { status: 'missing' | 'invalid' | 'ioError'; diagnostics: readonly StoreDiagnostic[] } | { status: 'loaded'; values: readonly unknown[]; diagnostics: readonly StoreDiagnostic[] };
function readDocument(filePath: string, version: number, collection: string): RawRead { let raw: string; try { raw = fs.readFileSync(filePath, 'utf8'); } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { status: 'missing', diagnostics: [{ code: 'missing', message: `No ${collection} store exists yet.` }] } : { status: 'ioError', diagnostics: [{ code: 'io_error', message: `The ${collection} store could not be read.` }] }; } let value: unknown; try { value = JSON.parse(raw); } catch { return { status: 'invalid', diagnostics: [{ code: 'corrupt', message: `The ${collection} store contains invalid JSON.` }] }; } if (!isRecord(value) || value.storeVersion !== version || !Array.isArray(value[collection])) return { status: 'invalid', diagnostics: [{ code: isRecord(value) && value.storeVersion !== version ? 'unsupported_store_version' : 'corrupt', message: `The ${collection} store wrapper is unsupported or malformed.` }] }; return { status: 'loaded', values: value[collection], diagnostics: [] }; }
function requireWritable<T extends InventoryReadResult | LoadoutReadResult>(result: T, name: string): T { if (result.status === 'invalid' || result.status === 'ioError') throw new Error(`The ${name} store is not writable because existing data is unavailable or invalid.`); return result; }
function atomicWrite(filePath: string, document: unknown): void { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`; try { fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temporary, filePath); } finally { try { fs.rmSync(temporary, { force: true }); } catch {} } }
function orderEquipment(values: readonly EquipmentRecord[]): EquipmentRecord[] { return [...values].sort((a, b) => a.label.localeCompare(b.label) || a.equipmentId.localeCompare(b.equipmentId)); }
function orderLoadouts(values: readonly LoadoutRecord[]): LoadoutRecord[] { return [...values].sort((a, b) => a.name.localeCompare(b.name) || a.loadoutId.localeCompare(b.loadoutId)); }
function candidateId(value: unknown, key: string): string | undefined { return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined; }
function asRecord(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw new Error('Request body must be an object.'); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
