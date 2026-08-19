import { randomUUID } from 'node:crypto';

export const ACTIVATION_NOTES_SCHEMA_VERSION = 1 as const;
export const ACTIVATION_NOTES_NOTE_KINDS = ['quick', 'text'] as const;
export type ActivationNotesNoteKind = typeof ACTIVATION_NOTES_NOTE_KINDS[number];

export const ACTIVATION_NOTES_MAX_ID_LENGTH = 128;
export const ACTIVATION_NOTES_MAX_BRIEF_ID_LENGTH = ACTIVATION_NOTES_MAX_ID_LENGTH;
export const ACTIVATION_NOTES_MAX_REFERENCE_LENGTH = 64;
export const ACTIVATION_NOTES_MAX_DISPLAY_NAME_LENGTH = 160;
export const ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH = 500;
export const ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION = 200;
export const ACTIVATION_NOTES_MAX_RETAINED_COLLECTIONS = 10;

export interface ActivationNotesActivationIdentity {
  readonly program: 'POTA' | 'SOTA';
  readonly reference: string;
  readonly displayName?: string;
}

export interface ActivationNote {
  readonly noteId: string;
  readonly recordedAtUtc: string;
  readonly kind: ActivationNotesNoteKind;
  readonly text: string;
}

export interface ActivationNotesCollection {
  readonly schemaVersion: typeof ACTIVATION_NOTES_SCHEMA_VERSION;
  readonly collectionId: string;
  readonly briefId: string;
  readonly activation: ActivationNotesActivationIdentity;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  readonly notes: readonly ActivationNote[];
}

export interface CreateActivationNotesCollectionInput {
  readonly briefId: string;
  readonly activation: { readonly program: string; readonly reference: string; readonly displayName?: string };
}

export interface AddActivationNoteInput {
  readonly kind: string;
  readonly text: string;
}

export interface ActivationNotesNormalizationResult {
  readonly valid: boolean;
  readonly collection: ActivationNotesCollection | null;
  readonly issues: readonly string[];
}

export function createActivationNotesCollection(
  input: CreateActivationNotesCollectionInput,
  options: { readonly now?: () => Date; readonly createId?: () => string } = {},
): ActivationNotesCollection {
  const now = utcNow(options.now);
  const collection: ActivationNotesCollection = {
    schemaVersion: ACTIVATION_NOTES_SCHEMA_VERSION,
    collectionId: options.createId?.() ?? randomUUID(),
    briefId: input.briefId,
    activation: { ...input.activation } as ActivationNotesActivationIdentity,
    createdAtUtc: now,
    updatedAtUtc: now,
    notes: [],
  };
  const normalized = normalizeActivationNotesCollection(collection);
  if (!normalized.valid || !normalized.collection) throw validationError(normalized.issues);
  return normalized.collection;
}

export function appendActivationNote(
  collection: ActivationNotesCollection,
  input: AddActivationNoteInput,
  options: { readonly now?: () => Date; readonly createId?: () => string } = {},
): ActivationNotesCollection {
  const normalized = normalizeActivationNotesCollection(collection);
  if (!normalized.valid || !normalized.collection) throw validationError(normalized.issues);
  if (normalized.collection.notes.length >= ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION) {
    throw new Error(`An activation notes collection cannot contain more than ${ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION} notes.`);
  }

  const recordedAtUtc = utcNow(options.now);
  const note: ActivationNote = {
    noteId: options.createId?.() ?? randomUUID(),
    recordedAtUtc,
    kind: input.kind as ActivationNotesNoteKind,
    text: input.text,
  };
  const candidate: ActivationNotesCollection = {
    ...normalized.collection,
    updatedAtUtc: recordedAtUtc,
    notes: [...normalized.collection.notes, note],
  };
  const result = normalizeActivationNotesCollection(candidate);
  if (!result.valid || !result.collection) throw validationError(result.issues);
  return result.collection;
}

export function validateActivationNotesCollection(input: unknown): input is ActivationNotesCollection {
  return normalizeActivationNotesCollection(input).valid;
}

export function normalizeActivationNotesCollection(input: unknown): ActivationNotesNormalizationResult {
  const issues: string[] = [];
  if (!isRecord(input)) return invalid(['collection must be an object.']);
  if (input.schemaVersion !== ACTIVATION_NOTES_SCHEMA_VERSION) issues.push('schemaVersion is unsupported.');

  const collectionId = normalizeId(input.collectionId, 'collectionId', issues);
  const briefId = normalizeId(input.briefId, 'briefId', issues);
  const activation = normalizeActivation(input.activation, issues);
  const createdAtUtc = normalizeUtcTimestamp(input.createdAtUtc, 'createdAtUtc', issues);
  const updatedAtUtc = normalizeUtcTimestamp(input.updatedAtUtc, 'updatedAtUtc', issues);
  if (createdAtUtc && updatedAtUtc && Date.parse(updatedAtUtc) < Date.parse(createdAtUtc)) issues.push('updatedAtUtc cannot precede createdAtUtc.');

  const notes = normalizeNotes(input.notes, issues);
  if (issues.length > 0 || !collectionId || !briefId || !activation || !createdAtUtc || !updatedAtUtc || !notes) return invalid(issues);
  return { valid: true, collection: { schemaVersion: ACTIVATION_NOTES_SCHEMA_VERSION, collectionId, briefId, activation, createdAtUtc, updatedAtUtc, notes }, issues: [] };
}

function normalizeActivation(input: unknown, issues: string[]): ActivationNotesActivationIdentity | null {
  if (!isRecord(input)) { issues.push('activation must be an object.'); return null; }
  const program = typeof input.program === 'string' ? input.program.trim().toUpperCase() : '';
  if (program !== 'POTA' && program !== 'SOTA') issues.push('activation.program is unsupported.');
  const reference = normalizeBoundedString(input.reference, 'activation.reference', ACTIVATION_NOTES_MAX_REFERENCE_LENGTH, issues, true)?.toUpperCase();
  const displayName = normalizeBoundedString(input.displayName, 'activation.displayName', ACTIVATION_NOTES_MAX_DISPLAY_NAME_LENGTH, issues, false);
  if (issues.some(issue => issue.startsWith('activation.'))) return null;
  return { program: program as 'POTA' | 'SOTA', reference: reference!, ...(displayName ? { displayName } : {}) };
}

function normalizeNotes(input: unknown, issues: string[]): readonly ActivationNote[] | null {
  if (!Array.isArray(input)) { issues.push('notes must be an array.'); return null; }
  if (input.length > ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION) issues.push(`notes cannot contain more than ${ACTIVATION_NOTES_MAX_NOTES_PER_COLLECTION} items.`);
  const notes: ActivationNote[] = [];
  for (const [index, candidate] of input.entries()) {
    if (!isRecord(candidate)) { issues.push(`notes[${index}] must be an object.`); continue; }
    const noteId = normalizeId(candidate.noteId, `notes[${index}].noteId`, issues);
    const recordedAtUtc = normalizeUtcTimestamp(candidate.recordedAtUtc, `notes[${index}].recordedAtUtc`, issues);
    const kind = typeof candidate.kind === 'string' ? candidate.kind.trim() : '';
    if (!(ACTIVATION_NOTES_NOTE_KINDS as readonly string[]).includes(kind)) issues.push(`notes[${index}].kind is unsupported.`);
    const text = normalizeNoteText(candidate.text, `notes[${index}].text`, issues);
    if (noteId && recordedAtUtc && text && (ACTIVATION_NOTES_NOTE_KINDS as readonly string[]).includes(kind)) notes.push({ noteId, recordedAtUtc, kind: kind as ActivationNotesNoteKind, text });
  }
  return issues.some(issue => issue.startsWith('notes')) ? null : notes;
}

function normalizeNoteText(input: unknown, field: string, issues: string[]): string | null {
  if (typeof input !== 'string') { issues.push(`${field} must be a string.`); return null; }
  const text = input.replace(/\r\n?/g, '\n').trim();
  if (!text) { issues.push(`${field} cannot be blank.`); return null; }
  if (text.length > ACTIVATION_NOTES_MAX_NOTE_TEXT_LENGTH) { issues.push(`${field} exceeds the maximum length.`); return null; }
  return text;
}

function normalizeBoundedString(input: unknown, field: string, maximum: number, issues: string[], required: boolean): string | undefined {
  if (input === undefined && !required) return undefined;
  if (typeof input !== 'string') { issues.push(`${field} must be a string.`); return undefined; }
  const value = input.trim();
  if (!value && required) issues.push(`${field} cannot be blank.`);
  if (value.length > maximum) issues.push(`${field} exceeds the maximum length.`);
  return value || undefined;
}

function normalizeId(input: unknown, field: string, issues: string[]): string | null {
  if (typeof input !== 'string') { issues.push(`${field} must be a string.`); return null; }
  const value = input.trim();
  if (!value || value.length > ACTIVATION_NOTES_MAX_ID_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) issues.push(`${field} is malformed.`);
  return value || null;
}

function normalizeUtcTimestamp(input: unknown, field: string, issues: string[]): string | null {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input) || Number.isNaN(Date.parse(input))) {
    issues.push(`${field} must be a valid UTC timestamp.`);
    return null;
  }
  return new Date(input).toISOString();
}

function utcNow(now: (() => Date) | undefined): string {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('The activation notes clock returned an invalid date.');
  return value.toISOString();
}

function invalid(issues: readonly string[]): ActivationNotesNormalizationResult { return { valid: false, collection: null, issues }; }
function validationError(issues: readonly string[]): Error { return new Error(`The activation notes value is invalid: ${issues.join(' ')}`); }
function isRecord(input: unknown): input is Record<string, any> { return typeof input === 'object' && input !== null && !Array.isArray(input); }