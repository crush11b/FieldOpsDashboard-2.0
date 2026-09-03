import { randomUUID } from 'node:crypto';

export const ACTIVATION_SCHEMA_VERSION = 2 as const;
export const ACTIVATION_PREVIOUS_SCHEMA_VERSION = 1 as const;
export const ACTIVATION_TYPES = ['POTA', 'SOTA', 'General'] as const;
export type ActivationType = typeof ACTIVATION_TYPES[number];
export const ACTIVATION_STATUSES = ['planned', 'active', 'completed'] as const;
export type ActivationStatus = typeof ACTIVATION_STATUSES[number];
export const ACTIVATION_MAX_ID_LENGTH = 128;
export const ACTIVATION_MAX_REFERENCE_LENGTH = 64;
export const ACTIVATION_MAX_TITLE_LENGTH = 160;
export const ACTIVATION_MAX_OBJECTIVE_LABEL_LENGTH = 128;
export const ACTIVATION_TIMING_STATUSES = ['recorded', 'unknown_historical'] as const;
export type ActivationTimingStatus = typeof ACTIVATION_TIMING_STATUSES[number];
export const ACTIVATION_GOALS = ['secure_activation', 'maximize_contacts', 'chase_dx', 'explore_bands'] as const;
export type ActivationGoal = typeof ACTIVATION_GOALS[number];
export const ACTIVATION_THRESHOLD_PROVENANCES = ['operator_entered', 'program_default'] as const;
export type ActivationThresholdProvenance = typeof ACTIVATION_THRESHOLD_PROVENANCES[number];
export const ACTIVATION_DEADLINE_BASES = ['operator_entered', 'mission_end', 'utc_rollover', 'program_rule'] as const;
export type ActivationDeadlineBasis = typeof ACTIVATION_DEADLINE_BASES[number];
export const ACTIVATION_DEADLINE_PROVENANCES = ['operator_entered', 'derived', 'program_default'] as const;
export type ActivationDeadlineProvenance = typeof ACTIVATION_DEADLINE_PROVENANCES[number];

export interface ActivationLocation { readonly latitude: number; readonly longitude: number; readonly gridSquare?: string; }
export interface ActivationMissionWindow { readonly start: string; readonly end: string; }
export interface ActivationOperatingObjective {
  readonly goal: ActivationGoal;
  readonly label: string;
  readonly requiredQsoCount?: number;
  readonly thresholdProvenance?: ActivationThresholdProvenance;
  readonly deadlineUtc?: string;
  readonly deadlineBasis?: ActivationDeadlineBasis;
  readonly deadlineProvenance?: ActivationDeadlineProvenance;
}
export interface Activation {
  readonly schemaVersion: typeof ACTIVATION_SCHEMA_VERSION;
  readonly activationId: string;
  readonly type: ActivationType;
  readonly reference?: string;
  readonly title?: string;
  readonly plannedLocation?: ActivationLocation;
  readonly missionWindow?: ActivationMissionWindow;
  readonly status: ActivationStatus;
  readonly startedAtUtc?: string;
  readonly endedAtUtc?: string;
  readonly actualTimingStatus?: ActivationTimingStatus;
  readonly actualTimingOrigin?: 'schema_v1';
  readonly operatingObjective?: ActivationOperatingObjective;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  readonly briefId?: string;
  readonly notesCollectionId?: string;
}
export interface CreateActivationInput { readonly type: string; readonly reference?: unknown; readonly title?: unknown; readonly plannedLocation?: unknown; readonly missionWindow?: unknown; readonly status?: unknown; readonly startedAtUtc?: unknown; readonly endedAtUtc?: unknown; readonly operatingObjective?: unknown; readonly briefId?: unknown; readonly notesCollectionId?: unknown; }

export function createActivation(input: CreateActivationInput, options: { readonly now?: () => Date; readonly createId?: () => string } = {}): Activation {
  const now = utcNow(options.now);
  const status = input.status ?? 'planned';
  const candidate = { schemaVersion: ACTIVATION_SCHEMA_VERSION, activationId: options.createId?.() ?? randomUUID(), type: input.type, reference: input.reference, title: input.title, plannedLocation: input.plannedLocation, missionWindow: input.missionWindow, status, actualTimingStatus: status === 'planned' ? undefined : 'recorded' as const, startedAtUtc: input.startedAtUtc ?? (status === 'planned' ? undefined : now), endedAtUtc: input.endedAtUtc ?? (status === 'completed' ? now : undefined), operatingObjective: input.operatingObjective, createdAtUtc: now, updatedAtUtc: now, briefId: input.briefId, notesCollectionId: input.notesCollectionId };
  const normalized = normalizeActivationValue(candidate, false);
  if (!normalized.valid || !normalized.activation) throw new Error(`The activation value is invalid: ${normalized.issues.join(' ')}`);
  return normalized.activation;
}

export function updateActivationStatus(activation: Activation, status: string, now = () => new Date()): Activation {
  if ((activation.status === 'planned' && status !== 'active') || (activation.status === 'active' && status !== 'completed') || activation.status === 'completed') throw new Error(`An Activation cannot move from ${activation.status} to ${status}.`);
  const timestamp = utcNow(now);
  const candidate = status === 'active' && activation.status === 'planned'
    ? { ...activation, status, actualTimingStatus: 'recorded' as const, startedAtUtc: timestamp, updatedAtUtc: timestamp }
    : status === 'completed' && activation.status === 'active'
      ? { ...activation, status, actualTimingStatus: activation.actualTimingStatus ?? 'recorded', endedAtUtc: activation.actualTimingStatus === 'unknown_historical' ? undefined : timestamp, updatedAtUtc: timestamp }
      : { ...activation, status, updatedAtUtc: timestamp };
  const normalized = normalizeActivationValue(candidate, migratedHistoricalActivations.has(activation) || (activation.actualTimingStatus === 'unknown_historical' && activation.actualTimingOrigin === 'schema_v1'));
  if (!normalized.valid || !normalized.activation) throw new Error(`The activation value is invalid: ${normalized.issues.join(' ')}`);
  return normalized.activation;
}

const migratedHistoricalActivations = new WeakSet<object>();
export function validateActivation(value: unknown): value is Activation { return normalizeActivation(value).valid; }
export function validateOperatingObjective(value: unknown): boolean { const issues: string[] = []; return objective(value, issues) !== undefined && issues.length === 0; }
export function normalizePersistedActivation(value: unknown): ActivationNormalizationResult {
  const result = normalizeActivationValue(value, true);
  if (result.valid && result.activation && isRecord(value) && value.schemaVersion === ACTIVATION_PREVIOUS_SCHEMA_VERSION && (value.status === 'active' || value.status === 'completed') && (!value.startedAtUtc || !value.endedAtUtc)) migratedHistoricalActivations.add(result.activation);
  return result;
}
export interface ActivationNormalizationResult { readonly valid: boolean; readonly activation: Activation | null; readonly issues: readonly string[]; }
export function normalizeActivation(value: unknown): ActivationNormalizationResult { return normalizeActivationValue(value, false); }
function normalizeActivationValue(value: unknown, allowHistorical: boolean): ActivationNormalizationResult {
  const issues: string[] = [];
  if (!isRecord(value)) return invalid(['activation must be an object.']);
  if (value.schemaVersion !== ACTIVATION_SCHEMA_VERSION && value.schemaVersion !== ACTIVATION_PREVIOUS_SCHEMA_VERSION) issues.push('schemaVersion is unsupported.');
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
  const startedAtUtc = optionalTimestamp(value.startedAtUtc, 'startedAtUtc', issues);
  const endedAtUtc = optionalTimestamp(value.endedAtUtc, 'endedAtUtc', issues);
  const actualTimingStatus = value.actualTimingStatus === undefined ? undefined : enumValue(value.actualTimingStatus, ACTIVATION_TIMING_STATUSES, 'actualTimingStatus', issues);
  const operatingObjective = objective(value.operatingObjective, issues);
  if (status === 'planned' && (startedAtUtc || endedAtUtc)) issues.push('planned Activations cannot have actual operating timestamps.');
  if (status === 'planned' && actualTimingStatus) issues.push('planned Activations cannot have actual timing status.');
  if (status === 'active' && !startedAtUtc && !(allowHistorical && (value.schemaVersion === ACTIVATION_PREVIOUS_SCHEMA_VERSION || actualTimingStatus === 'unknown_historical'))) issues.push('active Activations require startedAtUtc.');
  if (status === 'active' && endedAtUtc) issues.push('active Activations cannot have endedAtUtc.');
  if (status === 'completed' && (!startedAtUtc || !endedAtUtc) && !(allowHistorical && (value.schemaVersion === ACTIVATION_PREVIOUS_SCHEMA_VERSION || actualTimingStatus === 'unknown_historical'))) issues.push('completed Activations require startedAtUtc and endedAtUtc.');
  if (actualTimingStatus === 'unknown_historical' && !allowHistorical && !migratedHistoricalActivations.has(value)) issues.push('unknown_historical timing is reserved for schema-v1 migration.');
  if (actualTimingStatus === 'unknown_historical' && value.actualTimingOrigin !== 'schema_v1') issues.push('unknown_historical timing requires schema-v1 migration origin.');
  if (endedAtUtc && !startedAtUtc) issues.push('endedAtUtc requires startedAtUtc.');
  if (startedAtUtc && endedAtUtc && Date.parse(endedAtUtc) < Date.parse(startedAtUtc)) issues.push('endedAtUtc cannot precede startedAtUtc.');
  if (createdAtUtc && updatedAtUtc && Date.parse(updatedAtUtc) < Date.parse(createdAtUtc)) issues.push('updatedAtUtc cannot precede createdAtUtc.');
  if (issues.length || !activationId || !type || !status || !createdAtUtc || !updatedAtUtc) return invalid(issues);
  const migratedUnknown = allowHistorical && value.schemaVersion === ACTIVATION_PREVIOUS_SCHEMA_VERSION && (status === 'active' || status === 'completed') && (!startedAtUtc || !endedAtUtc);
  const unknown = migratedUnknown || actualTimingStatus === 'unknown_historical';
  if (status === 'completed' && unknown && !allowHistorical) issues.push('historical unknown timing is not valid for current input.');
  if (issues.length) return invalid(issues);
  return { valid: true, activation: { schemaVersion: ACTIVATION_SCHEMA_VERSION, activationId, type, ...(reference ? { reference } : {}), ...(title ? { title } : {}), ...(plannedLocation ? { plannedLocation } : {}), ...(missionWindow ? { missionWindow } : {}), status, ...(startedAtUtc ? { startedAtUtc } : {}), ...(endedAtUtc ? { endedAtUtc } : {}), ...(unknown ? { actualTimingStatus: 'unknown_historical' as const, actualTimingOrigin: 'schema_v1' as const } : actualTimingStatus ? { actualTimingStatus } : {}), ...(operatingObjective ? { operatingObjective } : {}), createdAtUtc, updatedAtUtc, ...(briefId ? { briefId } : {}), ...(notesCollectionId ? { notesCollectionId } : {}) }, issues: [] };
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
function optionalTimestamp(value: unknown, field: string, issues: string[]): string | undefined { if (value === undefined) return undefined; const result = timestamp(value, field, issues); return result ?? undefined; }
function objective(value: unknown, issues: string[]): ActivationOperatingObjective | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) { issues.push('operatingObjective must be an object.'); return undefined; }
  const goal = typeof value.goal === 'string' && (ACTIVATION_GOALS as readonly string[]).includes(value.goal) ? value.goal as ActivationGoal : null;
  if (!goal) issues.push('operatingObjective.goal is unsupported.');
  const label = bounded(value.label, 'operatingObjective.label', ACTIVATION_MAX_OBJECTIVE_LABEL_LENGTH, issues);
  if (!label) issues.push('operatingObjective.label is required.');
  const hasCount = value.requiredQsoCount !== undefined;
  const count = hasCount && Number.isSafeInteger(value.requiredQsoCount) && value.requiredQsoCount > 0 ? value.requiredQsoCount as number : undefined;
  if (hasCount && count === undefined) issues.push('operatingObjective.requiredQsoCount must be a positive safe integer.');
  const threshold = enumValue(value.thresholdProvenance, ACTIVATION_THRESHOLD_PROVENANCES, 'operatingObjective.thresholdProvenance', issues);
  if (hasCount && !threshold) issues.push('operatingObjective.thresholdProvenance is required with requiredQsoCount.');
  if (!hasCount && threshold) issues.push('operatingObjective.thresholdProvenance requires requiredQsoCount.');
  const deadline = value.deadlineUtc === undefined ? undefined : optionalTimestamp(value.deadlineUtc, 'operatingObjective.deadlineUtc', issues);
  const basis = enumValue(value.deadlineBasis, ACTIVATION_DEADLINE_BASES, 'operatingObjective.deadlineBasis', issues);
  const provenance = enumValue(value.deadlineProvenance, ACTIVATION_DEADLINE_PROVENANCES, 'operatingObjective.deadlineProvenance', issues);
  if (deadline && (!basis || !provenance)) issues.push('operatingObjective deadline basis and provenance are required with deadlineUtc.');
  if (!deadline && (basis || provenance)) issues.push('operatingObjective deadline basis and provenance require deadlineUtc.');
  if (issues.some(issue => issue.startsWith('operatingObjective.'))) return undefined;
  return { goal: goal!, label: label!, ...(count === undefined ? {} : { requiredQsoCount: count, thresholdProvenance: threshold! }), ...(deadline === undefined ? {} : { deadlineUtc: deadline, deadlineBasis: basis!, deadlineProvenance: provenance! }) };
}
function enumValue<T extends string>(value: unknown, values: readonly T[], field: string, issues: string[]): T | undefined { if (value === undefined) return undefined; if (typeof value === 'string' && values.includes(value as T)) return value as T; issues.push(`${field} is unsupported.`); return undefined; }
function utcNow(now?: () => Date): string { const value = (now ?? (() => new Date()))(); if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('The activation clock returned an invalid date.'); return value.toISOString(); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function invalid(issues: readonly string[]): ActivationNormalizationResult { return { valid: false, activation: null, issues }; }