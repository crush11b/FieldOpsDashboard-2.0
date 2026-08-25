import { randomUUID } from 'node:crypto';

export const ACTIVATION_SCHEMA_VERSION = 1 as const;
export const ACTIVATION_TYPES = ['POTA', 'SOTA', 'General'] as const;
export type ActivationType = typeof ACTIVATION_TYPES[number];
export const ACTIVATION_STATUSES = ['planned', 'active', 'completed'] as const;
export type ActivationStatus = typeof ACTIVATION_STATUSES[number];
export const ACTIVATION_MAX_ID_LENGTH = 128;
export const ACTIVATION_MAX_REFERENCE_LENGTH = 64;
export const ACTIVATION_MAX_TITLE_LENGTH = 160;

export interface ActivationLocation { readonly latitude: number; readonly longitude: number; readonly gridSquare?: string; }
export interface ActivationMissionWindow { readonly start: string; readonly end: string; }
export interface Activation {
  readonly schemaVersion: typeof ACTIVATION_SCHEMA_VERSION;
  readonly activationId: string;
  readonly type: ActivationType;
  readonly reference?: string;
  readonly title?: string;
  readonly plannedLocation?: ActivationLocation;
  readonly missionWindow?: ActivationMissionWindow;
  readonly status: ActivationStatus;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  readonly briefId?: string;
  readonly notesCollectionId?: string;
}
export interface CreateActivationInput { readonly type: string; readonly reference?: unknown; readonly title?: unknown; readonly plannedLocation?: unknown; readonly missionWindow?: unknown; readonly status?: unknown; readonly briefId?: unknown; readonly notesCollectionId?: unknown; }

export function createActivation(input: CreateActivationInput, options: { readonly now?: () => Date; readonly createId?: () => string } = {}): Activation {
  const now = utcNow(options.now);
  const candidate = { schemaVersion: 1 as const, activationId: options.createId?.() ?? randomUUID(), type: input.type, reference: input.reference, title: input.title, plannedLocation: input.plannedLocation, missionWindow: input.missionWindow, status: input.status ?? 'planned', createdAtUtc: now, updatedAtUtc: now, briefId: input.briefId, notesCollectionId: input.notesCollectionId };
  const normalized = normalizeActivation(candidate);
  if (!normalized.valid || !normalized.activation) throw new Error(`The activation value is invalid: ${normalized.issues.join(' ')}`);
  return normalized.activation;
}

export function updateActivationStatus(activation: Activation, status: string, now = () => new Date()): Activation {
  const normalized = normalizeActivation({ ...activation, status, updatedAtUtc: utcNow(now) });
  if (!normalized.valid || !normalized.activation) throw new Error(`The activation value is invalid: ${normalized.issues.join(' ')}`);
  return normalized.activation;
}

export function validateActivation(value: unknown): value is Activation { return normalizeActivation(value).valid; }
export interface ActivationNormalizationResult { readonly valid: boolean; readonly activation: Activation | null; readonly issues: readonly string[]; }
export function normalizeActivation(value: unknown): ActivationNormalizationResult {
  const issues: string[] = [];
  if (!isRecord(value)) return invalid(['activation must be an object.']);
  if (value.schemaVersion !== 1) issues.push('schemaVersion is unsupported.');
  const activationId = id(value.activationId, 'activationId', issues);
  const briefId = optionalId(value.briefId, 'briefId', issues);
  const notesCollectionId = optionalId(value.notesCollectionId, 'notesCollectionId', issues);
  const type = typeof value.type === 'string' && (ACTIVATION_TYPES as readonly string[]).includes(value.type.trim()) ? value.type.trim() as ActivationType : null;
  if (!type) issues.push('type is unsupported.');
  const reference = bounded(value.reference, 'reference', ACTIVATION_MAX_REFERENCE_LENGTH, issues);
  const title = bounded(value.title, 'title', ACTIVATION_MAX_TITLE_LENGTH, issues);
  const plannedLocation = location(value.plannedLocation, issues);
  const missionWindow = window(value.missionWindow, issues);
  const status = typeof value.status === 'string' && (ACTIVATION_STATUSES as readonly string[]).includes(value.status) ? value.status as ActivationStatus : null;
  if (!status) issues.push('status is unsupported.');
  const createdAtUtc = timestamp(value.createdAtUtc, 'createdAtUtc', issues);
  const updatedAtUtc = timestamp(value.updatedAtUtc, 'updatedAtUtc', issues);
  if (createdAtUtc && updatedAtUtc && Date.parse(updatedAtUtc) < Date.parse(createdAtUtc)) issues.push('updatedAtUtc cannot precede createdAtUtc.');
  if (issues.length || !activationId || !type || !status || !createdAtUtc || !updatedAtUtc) return invalid(issues);
  return { valid: true, activation: { schemaVersion: 1, activationId, type, ...(reference ? { reference } : {}), ...(title ? { title } : {}), ...(plannedLocation ? { plannedLocation } : {}), ...(missionWindow ? { missionWindow } : {}), status, createdAtUtc, updatedAtUtc, ...(briefId ? { briefId } : {}), ...(notesCollectionId ? { notesCollectionId } : {}) }, issues: [] };
}

function location(value: unknown, issues: string[]): ActivationLocation | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !finite(value.latitude) || value.latitude < -90 || value.latitude > 90 || !finite(value.longitude) || value.longitude < -180 || value.longitude > 180) { issues.push('plannedLocation is invalid.'); return undefined; }
  if (value.gridSquare !== undefined && (typeof value.gridSquare !== 'string' || value.gridSquare.length > 16)) issues.push('plannedLocation.gridSquare is invalid.');
  return { latitude: value.latitude, longitude: value.longitude, ...(typeof value.gridSquare === 'string' && value.gridSquare ? { gridSquare: value.gridSquare } : {}) };
}
function window(value: unknown, issues: string[]): ActivationMissionWindow | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) { issues.push('missionWindow is invalid.'); return undefined; }
  const start = timestamp(value.start, 'missionWindow.start', issues); const end = timestamp(value.end, 'missionWindow.end', issues);
  if (start && end && Date.parse(end) < Date.parse(start)) issues.push('missionWindow.end cannot precede start.');
  return start && end ? { start, end } : undefined;
}
function bounded(value: unknown, field: string, max: number, issues: string[]): string | undefined { if (value === undefined) return undefined; if (typeof value !== 'string') { issues.push(`${field} must be a string.`); return undefined; } const result = value.trim(); if (result.length > max) issues.push(`${field} exceeds the maximum length.`); return result || undefined; }
function id(value: unknown, field: string, issues: string[]): string | null { if (typeof value !== 'string' || !isValidId(value)) { issues.push(`${field} is malformed.`); return null; } return value.trim(); }
function optionalId(value: unknown, field: string, issues: string[]): string | undefined { if (value === undefined) return undefined; const result = id(value, field, issues); return result ?? undefined; }
function isValidId(value: string): boolean { return value.trim().length > 0 && value.trim().length <= ACTIVATION_MAX_ID_LENGTH && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.trim()); }
function timestamp(value: unknown, field: string, issues: string[]): string | null { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) { issues.push(`${field} must be a valid UTC timestamp.`); return null; } return new Date(value).toISOString(); }
function utcNow(now?: () => Date): string { const value = (now ?? (() => new Date()))(); if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('The activation clock returned an invalid date.'); return value.toISOString(); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function invalid(issues: readonly string[]): ActivationNormalizationResult { return { valid: false, activation: null, issues }; }