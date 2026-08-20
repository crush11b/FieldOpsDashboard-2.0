import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIELD_READINESS_CHECKLIST_ITEM_COUNT,
  FIELD_READINESS_CHECKLIST_MAX_RETAINED,
  FIELD_READINESS_CHECKLIST_TEMPLATE_ID,
  FIELD_READINESS_CHECKLIST_TEMPLATE_VERSION,
  createFieldReadinessChecklist,
  getFieldReadinessChecklistTemplate,
  normalizeFieldReadinessChecklist,
  validateFieldReadinessChecklist,
  type FieldReadinessChecklist,
} from '../fieldReadinessChecklist';
import { FieldReadinessChecklistStore, getDefaultFieldReadinessChecklistPath } from '../fieldReadinessChecklistStore';

const temporaryDirectories: string[] = [];
const fixedNow = () => new Date('2026-08-19T12:00:00.000Z');

const expectedItems = [
  ['site_access', 'Confirm the operating site and access conditions are suitable.'],
  ['work_area', 'Check footing, visibility, overhead hazards, and the working area.'],
  ['antenna_clearance', 'Place the antenna and supports clear of people, vehicles, structures, and overhead hazards.'],
  ['feedline_route', 'Route and secure the feedline against trip hazards, sharp edges, crushing, and strain.'],
  ['common_mode', 'Install the planned choke or common-mode suppression.'],
  ['station_connections', 'Connect the radio, interface, accessories, and feedline.'],
  ['power_ready', 'Verify the power source, fuse protection, connectors, and polarity.'],
  ['clock_sync', 'Synchronize the station clock if using a time-sensitive digital mode.'],
  ['antenna_path', 'Confirm the intended antenna and feedline path is selected.'],
  ['frequency_mode', 'Verify the intended frequency and mode.'],
  ['swr_output', 'Verify acceptable SWR and the planned transmit output.'],
  ['logging_reference', 'Confirm the logging method and activation reference are ready.'],
  ['brief_review', 'Review the SmartDeploy plan, limitations, and unavailable or stale information.'],
  ['final_station_check', 'Check receive audio, controls, keying, transmit indication, and essential connections.'],
] as const;

afterEach(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function createStore(options: ConstructorParameters<typeof FieldReadinessChecklistStore>[1] = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-readiness-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'field-readiness-checklists.json');
  return { store: new FieldReadinessChecklistStore(filePath, options), directory, filePath };
}

function allItems(checklist: FieldReadinessChecklist) { return checklist.sections.flatMap(section => section.items); }

describe('Field Readiness Checklist model', () => {
  it('provides the exact fixed v1 template in two ordered sections', () => {
    const template = getFieldReadinessChecklistTemplate();
    expect(template.map(section => section.sectionId)).toEqual(['field_setup', 'operating_readiness']);
    expect(template.map(section => section.title)).toEqual(['FIELD SETUP', 'OPERATING READINESS']);
    expect(allItems({ sections: template } as FieldReadinessChecklist).map(item => [item.itemId, item.text])).toEqual(expectedItems);
    expect(allItems({ sections: template } as FieldReadinessChecklist)).toHaveLength(FIELD_READINESS_CHECKLIST_ITEM_COUNT);
  });

  it('creates a versioned checklist with independent incomplete items and no item timestamps', () => {
    const checklist = createFieldReadinessChecklist({ briefId: 'brief-1' }, { createId: () => 'checklist-1', now: fixedNow });
    expect(checklist).toMatchObject({ schemaVersion: 1, templateId: FIELD_READINESS_CHECKLIST_TEMPLATE_ID, templateVersion: FIELD_READINESS_CHECKLIST_TEMPLATE_VERSION, checklistId: 'checklist-1', briefId: 'brief-1', createdAtUtc: '2026-08-19T12:00:00.000Z', updatedAtUtc: '2026-08-19T12:00:00.000Z' });
    expect(allItems(checklist).every(item => item.completed === false)).toBe(true);
    expect(JSON.stringify(checklist)).not.toContain('completedAtUtc');
  });

  it('strictly rejects unsupported fields, malformed values, duplicate IDs, and wrong order', () => {
    const checklist = createFieldReadinessChecklist({ briefId: 'brief-1' }, { createId: () => 'checklist-1', now: fixedNow });
    expect(validateFieldReadinessChecklist({ ...checklist, extra: true })).toBe(false);
    expect(validateFieldReadinessChecklist({ ...checklist, createdAtUtc: '2026-08-19T12:00:00-04:00' })).toBe(false);
    expect(validateFieldReadinessChecklist({ ...checklist, sections: [...checklist.sections, checklist.sections[0]] })).toBe(false);
    expect(validateFieldReadinessChecklist({ ...checklist, sections: checklist.sections.map((section, index) => index === 0 ? { ...section, items: [{ ...section.items[0], itemId: 'clock_sync' }, ...section.items.slice(1)] } : section) })).toBe(false);
    expect(validateFieldReadinessChecklist({ ...checklist, sections: checklist.sections.map(section => ({ ...section, items: section.items.map(item => ({ ...item, completed: 'false' })) })) })).toBe(false);
  });

  it('preserves valid retained wording while model operations change only completion state and update time', () => {
    const checklist = createFieldReadinessChecklist({ briefId: 'brief-1' }, { createId: () => 'checklist-1', now: fixedNow });
    const retained = { ...checklist, sections: checklist.sections.map(section => ({ ...section, items: section.items.map((item, index) => index === 0 ? { ...item, text: 'Operator-visible historical wording.' } : item) })) };
    expect(validateFieldReadinessChecklist(retained)).toBe(true);
    const normalized = normalizeFieldReadinessChecklist(retained).checklist!;
    expect(normalized.sections[0].items[0].text).toBe('Operator-visible historical wording.');
  });
});

describe('FieldReadinessChecklistStore', () => {
  it('uses the application-local path and reports an honest missing store', () => {
    expect(getDefaultFieldReadinessChecklistPath({ LOCALAPPDATA: 'C:\\Users\\Operator\\AppData\\Local' }, 'C:\\Users\\Operator')).toBe('C:\\Users\\Operator\\AppData\\Local\\FieldOpsDashboard\\field-readiness-checklists.json');
    expect(createStore().store.list()).toEqual({ status: 'missing', checklists: [], diagnostics: [{ code: 'missing', message: 'No field readiness checklist store exists yet.' }] });
  });

  it('creates one checklist per brief idempotently, updates items, unchecks, resets, and reloads', () => {
    const { store, filePath } = createStore({ createId: () => 'checklist-1', now: fixedNow });
    const created = store.createForBrief('brief-1');
    const existing = store.createForBrief('brief-1');
    expect(created.status).toBe('created');
    expect(existing).toMatchObject({ status: 'existing', checklist: { checklistId: 'checklist-1' } });
    const completed = store.updateItem('checklist-1', 'site_access', true);
    expect(completed.checklist.sections[0].items[0].completed).toBe(true);
    expect(completed.checklist.updatedAtUtc).toBe('2026-08-19T12:00:00.000Z');
    const unchecked = store.updateItem('checklist-1', 'site_access', false);
    expect(unchecked.checklist.sections[0].items[0].completed).toBe(false);
    const reset = store.reset('checklist-1');
    expect(reset.checklist).toMatchObject({ checklistId: 'checklist-1', briefId: 'brief-1', templateId: FIELD_READINESS_CHECKLIST_TEMPLATE_ID, templateVersion: 1, createdAtUtc: created.checklist.createdAtUtc });
    expect(allItems(reset.checklist).every(item => item.completed === false)).toBe(true);
    expect(new FieldReadinessChecklistStore(filePath).get('checklist-1')).toMatchObject({ status: 'found', checklist: reset.checklist });
  });

  it('looks up by checklist and brief IDs and keeps documents separate from Activation Notes', () => {
    const { store } = createStore({ createId: (() => { let index = 0; return () => `checklist-${++index}`; })(), now: fixedNow });
    const created = store.createForBrief('brief-1').checklist;
    expect(store.get(created.checklistId)).toMatchObject({ status: 'found', checklist: created });
    expect(store.getByBriefId('brief-1').checklists).toEqual([created]);
    expect(store.getByBriefId('unknown').checklists).toEqual([]);
    expect(created).not.toHaveProperty('notes');
    expect(created).not.toHaveProperty('activation');
  });

  it('orders by updated time and retains only ten documents', () => {
    let day = 1;
    let id = 0;
    const { store } = createStore({ createId: () => `checklist-${++id}`, now: () => new Date(Date.UTC(2026, 7, day++)) });
    for (let index = 0; index <= FIELD_READINESS_CHECKLIST_MAX_RETAINED; index += 1) store.createForBrief(`brief-${index}`);
    const result = store.list();
    expect(result.checklists).toHaveLength(10);
    expect(result.checklists[0].briefId).toBe('brief-10');
    expect(result.checklists.at(-1)?.briefId).toBe('brief-1');
  });

  it('reports corruption, unsupported versions, and invalid records without discarding valid records', () => {
    const { store, filePath } = createStore({ createId: () => 'checklist-1', now: fixedNow });
    expect(store.list().status).toBe('missing');
    fs.writeFileSync(filePath, '{broken');
    expect(store.list()).toMatchObject({ status: 'invalid', checklists: [], diagnostics: [{ code: 'corrupt' }] });
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 2, checklists: [] }));
    expect(store.list()).toMatchObject({ status: 'invalid', diagnostics: [{ code: 'unsupported_store_version' }] });
    const valid = createFieldReadinessChecklist({ briefId: 'brief-1' }, { createId: () => 'checklist-1', now: fixedNow });
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, checklists: [valid, { ...valid, checklistId: 'bad id' }] }));
    expect(store.list()).toMatchObject({ status: 'loaded', checklists: [valid], diagnostics: [{ code: 'invalid_checklist' }] });
  });

  it('uses atomic replacement and preserves the previous file on failed writes', () => {
    const { store, filePath } = createStore({ createId: () => 'checklist-1', now: fixedNow });
    store.createForBrief('brief-1');
    const original = fs.readFileSync(filePath, 'utf8');
    const failingFileSystem = { readFileSync: fs.readFileSync.bind(fs), writeFileSync: fs.writeFileSync.bind(fs), mkdirSync: fs.mkdirSync.bind(fs), rmSync: fs.rmSync.bind(fs), renameSync: () => { throw Object.assign(new Error('simulated failure'), { code: 'EIO' }); } } as never;
    const failingStore = new FieldReadinessChecklistStore(filePath, { fileSystem: failingFileSystem, createId: () => 'checklist-2', now: fixedNow });
    expect(() => failingStore.createForBrief('brief-2')).toThrow('simulated failure');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(original);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(['field-readiness-checklists.json']);
  });
});
