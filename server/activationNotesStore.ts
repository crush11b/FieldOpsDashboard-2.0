import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ACTIVATION_NOTES_MAX_RETAINED_COLLECTIONS,
  appendActivationNote,
  createActivationNotesCollection,
  normalizeActivationNotesCollection,
  type ActivationNotesCollection,
  type AddActivationNoteInput,
  type CreateActivationNotesCollectionInput,
} from './activationNotes';

export const ACTIVATION_NOTES_STORE_VERSION = 1 as const;
export const ACTIVATION_NOTES_STORE_FILE_NAME = 'activation-notes.json';
export type ActivationNotesStoreDiagnosticCode = 'missing' | 'corrupt' | 'unsupported_store_version' | 'invalid_collection' | 'io_error';
export interface ActivationNotesStoreDiagnostic { readonly code: ActivationNotesStoreDiagnosticCode; readonly message: string; readonly collectionId?: string; }
export interface ActivationNotesStoreReadResult { readonly status: 'missing' | 'loaded' | 'invalid' | 'ioError'; readonly collections: readonly ActivationNotesCollection[]; readonly diagnostics: readonly ActivationNotesStoreDiagnostic[]; }
export type ActivationNotesStoreGetResult = { readonly status: 'found'; readonly collection: ActivationNotesCollection; readonly diagnostics: readonly ActivationNotesStoreDiagnostic[] } | { readonly status: 'notFound'; readonly diagnostics: readonly ActivationNotesStoreDiagnostic[] };
export type ActivationNotesStoreDeleteResult = { readonly status: 'deleted'; readonly collection: ActivationNotesCollection; readonly diagnostics: readonly ActivationNotesStoreDiagnostic[] } | { readonly status: 'notFound'; readonly diagnostics: readonly ActivationNotesStoreDiagnostic[] };

interface ActivationNotesStoreDocument { readonly storeVersion: typeof ACTIVATION_NOTES_STORE_VERSION; readonly collections: readonly ActivationNotesCollection[]; }
interface ActivationNotesFileSystem {
  readFileSync(filePath: string, encoding: 'utf8'): string;
  writeFileSync(filePath: string, content: string, options: { encoding: 'utf8'; flag: 'wx' }): void;
  renameSync(oldPath: string, newPath: string): void;
  mkdirSync(directory: string, options: { recursive: true }): unknown;
  rmSync(filePath: string, options: { force: true }): void;
}

export function getDefaultActivationNotesPath(environment: NodeJS.ProcessEnv = process.env, homeDirectory = os.homedir()): string {
  const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local');
  return path.join(localAppData, 'FieldOpsDashboard', ACTIVATION_NOTES_STORE_FILE_NAME);
}

export class ActivationNotesStore {
  private readonly fileSystem: ActivationNotesFileSystem;
  private readonly now?: () => Date;
  private readonly createId?: () => string;

  constructor(private readonly filePath: string, options: { readonly fileSystem?: ActivationNotesFileSystem; readonly now?: () => Date; readonly createId?: () => string } = {}) {
    this.fileSystem = options.fileSystem ?? fs as unknown as ActivationNotesFileSystem;
    this.now = options.now;
    this.createId = options.createId;
  }

  load(): ActivationNotesStoreReadResult {
    let json: string;
    try { json = this.fileSystem.readFileSync(this.filePath, 'utf8'); }
    catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return { status: 'missing', collections: [], diagnostics: [{ code: 'missing', message: 'No activation notes store exists yet.' }] };
      return { status: 'ioError', collections: [], diagnostics: [{ code: 'io_error', message: 'The activation notes store could not be read.' }] };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return { status: 'invalid', collections: [], diagnostics: [{ code: 'corrupt', message: 'The activation notes store contains invalid JSON.' }] }; }
    if (!isRecord(parsed) || parsed.storeVersion !== ACTIVATION_NOTES_STORE_VERSION || !Array.isArray(parsed.collections)) {
      const code = isRecord(parsed) && parsed.storeVersion !== ACTIVATION_NOTES_STORE_VERSION ? 'unsupported_store_version' : 'corrupt';
      return { status: 'invalid', collections: [], diagnostics: [{ code, message: 'The activation notes store wrapper is unsupported or malformed.' }] };
    }
    const collections: ActivationNotesCollection[] = [];
    const diagnostics: ActivationNotesStoreDiagnostic[] = [];
    for (const candidate of parsed.collections) {
      const normalized = normalizeActivationNotesCollection(candidate);
      if (!normalized.valid || !normalized.collection) diagnostics.push({ code: 'invalid_collection', message: 'A stored activation notes collection was skipped because required fields were invalid.', collectionId: isRecord(candidate) && typeof candidate.collectionId === 'string' ? candidate.collectionId : undefined });
      else collections.push(normalized.collection);
    }
    return { status: 'loaded', collections: orderCollections(collections).slice(0, ACTIVATION_NOTES_MAX_RETAINED_COLLECTIONS), diagnostics };
  }

  list(): ActivationNotesStoreReadResult { return this.load(); }
  get(collectionId: string): ActivationNotesStoreGetResult {
    const loaded = this.load();
    const collection = loaded.collections.find(candidate => candidate.collectionId === collectionId);
    return collection ? { status: 'found', collection, diagnostics: loaded.diagnostics } : { status: 'notFound', diagnostics: loaded.diagnostics };
  }
  getByBriefId(briefId: string): ActivationNotesStoreReadResult {
    const loaded = this.load();
    return { ...loaded, collections: loaded.collections.filter(collection => collection.briefId === briefId) };
  }
  create(input: CreateActivationNotesCollectionInput): { readonly collection: ActivationNotesCollection; readonly diagnostics: readonly ActivationNotesStoreDiagnostic[] } {
    const loaded = this.load();
    const collection = createActivationNotesCollection(input, { now: this.now, createId: this.createId });
    if (loaded.collections.some(existing => existing.collectionId === collection.collectionId)) throw new Error(`Activation notes collection ${collection.collectionId} already exists.`);
    this.write({ storeVersion: ACTIVATION_NOTES_STORE_VERSION, collections: orderCollections([collection, ...loaded.collections]).slice(0, ACTIVATION_NOTES_MAX_RETAINED_COLLECTIONS) });
    return { collection, diagnostics: loaded.diagnostics };
  }
  appendNote(collectionId: string, input: AddActivationNoteInput): { readonly collection: ActivationNotesCollection; readonly diagnostics: readonly ActivationNotesStoreDiagnostic[] } {
    const loaded = this.load();
    const existing = loaded.collections.find(collection => collection.collectionId === collectionId);
    if (!existing) throw new Error(`Activation notes collection ${collectionId} was not found.`);
    const collection = appendActivationNote(existing, input, { now: this.now, createId: this.createId });
    this.write({ storeVersion: ACTIVATION_NOTES_STORE_VERSION, collections: orderCollections(loaded.collections.map(candidate => candidate.collectionId === collectionId ? collection : candidate)) });
    return { collection, diagnostics: loaded.diagnostics };
  }
  delete(collectionId: string): ActivationNotesStoreDeleteResult {
    const loaded = this.load();
    const collection = loaded.collections.find(candidate => candidate.collectionId === collectionId);
    if (!collection) return { status: 'notFound', diagnostics: loaded.diagnostics };
    this.write({ storeVersion: ACTIVATION_NOTES_STORE_VERSION, collections: loaded.collections.filter(candidate => candidate.collectionId !== collectionId) });
    return { status: 'deleted', collection, diagnostics: loaded.diagnostics };
  }

  private write(document: ActivationNotesStoreDocument): void {
    const directory = path.dirname(this.filePath);
    this.fileSystem.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      this.fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      try { this.fileSystem.renameSync(temporaryPath, this.filePath); }
      catch (error) {
        if (!isNodeError(error) || (error.code !== 'EEXIST' && error.code !== 'EPERM')) throw error;
        this.fileSystem.rmSync(this.filePath, { force: true });
        this.fileSystem.renameSync(temporaryPath, this.filePath);
      }
    } finally { try { this.fileSystem.rmSync(temporaryPath, { force: true }); } catch { /* best-effort temporary cleanup */ } }
  }
}

function orderCollections(collections: readonly ActivationNotesCollection[]): ActivationNotesCollection[] {
  return [...collections].sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc) || right.collectionId.localeCompare(left.collectionId));
}
function isRecord(input: unknown): input is Record<string, any> { return typeof input === 'object' && input !== null && !Array.isArray(input); }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error; }