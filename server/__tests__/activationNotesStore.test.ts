import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIVATION_NOTES_MAX_DISPLAY_NAME_LENGTH,
  ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH,
  ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION,
  ACTIVATION_NOTES_MAX_RETAINED_COLLECTIONS,
  appendActivationNote,
  createActivationNotesCollection,
  normalizeActivationNotesCollection,
  validateActivationNotesCollection,
  type ActivationNotesCollection,
} from '../activationNotes';
import { ActivationNotesStore, getDefaultActivationNotesPath } from '../activationNotesStore';

const temporaryDirectories: string[] = [];
const fixedNow = () => new Date('2026-08-19T12:00:00.000Z');

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createStore(options: ConstructorParameters<typeof ActivationNotesStore>[1] = {}): { store: ActivationNotesStore; directory: string; filePath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-activation-notes-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'activation-notes.json');
  return { store: new ActivationNotesStore(filePath, options), directory, filePath };
}

function createCollection(id = 'collection-1', briefId = 'brief-1', now = fixedNow): ActivationNotesCollection {
  return createActivationNotesCollection({ briefId, activation: { program: 'pota', reference: ' us-0182 ', displayName: '  Test Park  ' } }, { createId: () => id, now });
}

describe('Activation Notes model', () => {
  it('creates a versioned collection with copied activation identity and UTC timestamps', () => {
    const sourceBrief = { briefId: 'brief-1', activation: { program: 'POTA', reference: 'US-0182', displayName: 'Test Park' } };
    const sourceBefore = structuredClone(sourceBrief);
    const collection = createActivationNotesCollection({ briefId: sourceBrief.briefId, activation: sourceBrief.activation }, { createId: () => 'collection-1', now: fixedNow });

    expect(collection).toEqual({ schemaVersion: 1, collectionId: 'collection-1', briefId: 'brief-1', activation: { program: 'POTA', reference: 'US-0182', displayName: 'Test Park' }, createdAtUtc: '2026-08-19T12:00:00.000Z', updatedAtUtc: '2026-08-19T12:00:00.000Z', notes: [] });
    expect(sourceBrief).toEqual(sourceBefore);
  });

  it('creates preset and free-text notes in append order with normalized text', () => {
    const collection = createCollection();
    const withQuick = appendActivationNote(collection, { kind: 'quick', text: '  Arrived\r\n  clear site  ' }, { createId: () => 'note-1', now: () => new Date('2026-08-19T12:01:00.000Z') });
    const withText = appendActivationNote(withQuick, { kind: 'text', text: 'Observed strong 20m activity.' }, { createId: () => 'note-2', now: () => new Date('2026-08-19T12:02:00.000Z') });

    expect(withText.notes).toEqual([
      { noteId: 'note-1', recordedAtUtc: '2026-08-19T12:01:00.000Z', kind: 'quick', text: 'Arrived\n  clear site' },
      { noteId: 'note-2', recordedAtUtc: '2026-08-19T12:02:00.000Z', kind: 'text', text: 'Observed strong 20m activity.' },
    ]);
    expect(withText.updatedAtUtc).toBe('2026-08-19T12:02:00.000Z');
  });

  it('rejects blank text, malformed IDs and non-UTC timestamps', () => {
    const collection = createCollection();
    expect(() => appendActivationNote(collection, { kind: 'quick', text: ' \r\n ' })).toThrow('cannot be blank');
    expect(validateActivationNotesCollection({ ...collection, collectionId: 'has spaces' })).toBe(false);
    expect(validateActivationNotesCollection({ ...collection, createdAtUtc: '2026-08-19T12:00:00-04:00' })).toBe(false);
    expect(validateActivationNotesCollection({ ...collection, activation: { program: 'POTA', reference: '' } })).toBe(false);
    expect(validateActivationNotesCollection({ ...collection, notes: [{ noteId: 'note-1', recordedAtUtc: collection.createdAtUtc, kind: 'qso', text: 'not a structured log' }] })).toBe(false);
  });

  it('enforces note and copied display-name bounds', () => {
    const collection = createCollection();
    expect(validateActivationNotesCollection({ ...collection, activation: { ...collection.activation, displayName: 'x'.repeat(ACTIVATION_NOTES_MAX_DISPLAY_NAME_LENGTH + 1) } })).toBe(false);
    expect(() => appendActivationNote(collection, { kind: 'text', text: 'x'.repeat(ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH + 1) })).toThrow('exceeds the maximum length');
  });

  it('rejects appending beyond the maximum notes per collection', () => {
    let collection = createCollection();
    for (let index = 0; index < ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION; index += 1) {
      collection = appendActivationNote(collection, { kind: 'quick', text: `Note ${index}` }, { createId: () => `note-${index}`, now: fixedNow });
    }
    expect(collection.notes).toHaveLength(ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION);
    expect(() => appendActivationNote(collection, { kind: 'quick', text: 'overflow' })).toThrow('cannot contain more than');
  });
});

describe('ActivationNotesStore', () => {
  it('uses application-local data and reports an honest missing store', () => {
    expect(getDefaultActivationNotesPath({ LOCALAPPDATA: 'C:\\Users\\Operator\\AppData\\Local' }, 'C:\\Users\\Operator'))
      .toBe('C:\\Users\\Operator\\AppData\\Local\\FieldOpsDashboard\\activation-notes.json');
    const { store } = createStore();
    expect(store.list()).toEqual({ status: 'missing', collections: [], diagnostics: [{ code: 'missing', message: 'No activation notes store exists yet.' }] });
  });

  it('creates, appends, reloads, orders, and looks up collections by brief ID', () => {
    const { store, filePath } = createStore({ createId: (() => { let index = 0; return () => `generated-${++index}`; })(), now: fixedNow });
    const created = store.create({ briefId: 'brief-1', activation: { program: 'SOTA', reference: 'W7-TEST', displayName: 'Test Summit' } }).collection;
    const appended = store.appendNote(created.collectionId, { kind: 'quick', text: 'Set up.' }).collection;
    expect(appended.notes).toHaveLength(1);
    expect(new ActivationNotesStore(filePath).get(created.collectionId)).toMatchObject({ status: 'found', collection: appended });
    expect(store.getByBriefId('brief-1').collections).toEqual([appended]);
    expect(store.getByBriefId('unknown').collections).toEqual([]);
  });

  it('retains only the newest collections with deterministic ordering', () => {
    let day = 1;
    let id = 0;
    const { store } = createStore({ createId: () => `collection-${++id}`, now: () => new Date(Date.UTC(2026, 7, day++)) });
    for (let index = 0; index <= ACTIVATION_NOTES_MAX_RETAINED_COLLECTIONS; index += 1) store.create({ briefId: `brief-${index}`, activation: { program: 'POTA', reference: `US-${String(index).padStart(4, '0')}` } });
    const result = store.list();
    expect(result.collections).toHaveLength(ACTIVATION_NOTES_MAX_RETAINED_COLLECTIONS);
    expect(result.collections[0].briefId).toBe('brief-10');
    expect(result.collections.at(-1)?.briefId).toBe('brief-1');
    expect(result.collections.some(collection => collection.briefId === 'brief-0')).toBe(false);
  });

  it('skips invalid stored collections while preserving valid data', () => {
    const { store, filePath } = createStore();
    const valid = createCollection();
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, collections: [valid, { ...valid, collectionId: 'bad id' }] }));
    expect(store.list()).toMatchObject({ status: 'loaded', collections: [valid], diagnostics: [{ code: 'invalid_collection' }] });
  });

  it('reports corrupt content and recovers on the next write', () => {
    const { store, filePath } = createStore({ createId: () => 'collection-1', now: fixedNow });
    fs.writeFileSync(filePath, '{broken');
    expect(store.list()).toMatchObject({ status: 'invalid', collections: [] });
    expect(store.create({ briefId: 'brief-1', activation: { program: 'POTA', reference: 'US-0182' } }).collection.collectionId).toBe('collection-1');
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).collections).toHaveLength(1);
  });

  it('uses atomic replacement and preserves the valid file when writing fails', () => {
    const { store, filePath } = createStore({ createId: () => 'collection-1', now: fixedNow });
    store.create({ briefId: 'brief-1', activation: { program: 'POTA', reference: 'US-0182' } });
    const originalContent = fs.readFileSync(filePath, 'utf8');
    const failingFileSystem = {
      readFileSync: fs.readFileSync.bind(fs),
      writeFileSync: fs.writeFileSync.bind(fs),
      mkdirSync: fs.mkdirSync.bind(fs),
      rmSync: fs.rmSync.bind(fs),
      renameSync: () => { throw Object.assign(new Error('simulated failure'), { code: 'EIO' }); },
    } as never;
    const failingStore = new ActivationNotesStore(filePath, { fileSystem: failingFileSystem, createId: () => 'collection-2', now: fixedNow });
    expect(() => failingStore.create({ briefId: 'brief-2', activation: { program: 'POTA', reference: 'US-0183' } })).toThrow('simulated failure');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(originalContent);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(['activation-notes.json']);
  });

  it('deletes an existing collection without changing the brief data it references', () => {
    const { store } = createStore({ createId: () => 'collection-1', now: fixedNow });
    const collection = store.create({ briefId: 'immutable-brief', activation: { program: 'POTA', reference: 'US-0182' } }).collection;
    expect(store.delete(collection.collectionId)).toMatchObject({ status: 'deleted', collection });
    expect(store.delete(collection.collectionId)).toMatchObject({ status: 'notFound' });
  });
});