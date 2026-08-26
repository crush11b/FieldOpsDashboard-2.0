import { randomUUID } from 'node:crypto';

export const QSO_SCHEMA_VERSION = 1 as const;
export const QSO_MAX_ID_LENGTH = 128;
export const QSO_MAX_CALLSIGN_LENGTH = 32;
export const QSO_MAX_TEXT_LENGTH = 500;
export const QSO_MODES = ['SSB', 'CW', 'FM', 'AM', 'FT8', 'FT4'] as const;
export type QsoMode = typeof QSO_MODES[number] | (string & {});
export type QsoSource = 'manual' | 'adif_import';

export interface Qso {
  readonly schemaVersion: typeof QSO_SCHEMA_VERSION;
  readonly qsoId: string;
  readonly activationId: string;
  readonly qsoDateTimeUtc: string;
  readonly callsign: string;
  readonly band: string;
  readonly frequencyMHz?: number;
  readonly mode: QsoMode;
  readonly submode?: string;
  readonly rstSent?: string;
  readonly rstReceived?: string;
  readonly stationCallsign?: string;
  readonly operatorCallsign?: string;
  readonly myGridSquare?: string;
  readonly gridSquare?: string;
  readonly potaRef?: string;
  readonly sotaRef?: string;
  readonly notes?: string;
  readonly source: QsoSource;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
}

export interface CreateQsoInput { readonly activationId: unknown; readonly qsoDateTimeUtc: unknown; readonly callsign: unknown; readonly band?: unknown; readonly frequencyMHz?: unknown; readonly mode: unknown; readonly submode?: unknown; readonly rstSent?: unknown; readonly rstReceived?: unknown; readonly stationCallsign?: unknown; readonly operatorCallsign?: unknown; readonly myGridSquare?: unknown; readonly gridSquare?: unknown; readonly potaRef?: unknown; readonly sotaRef?: unknown; readonly notes?: unknown; readonly source?: unknown; }
export interface QsoNormalizationResult { readonly valid: boolean; readonly qso: Qso | null; readonly issues: readonly string[]; }

export function createQso(input: CreateQsoInput, options: { readonly now?: () => Date; readonly createId?: () => string } = {}): Qso {
  const now = utcNow(options.now);
  return requireQso(normalizeQso({ ...input, qsoId: options.createId?.() ?? randomUUID(), schemaVersion: QSO_SCHEMA_VERSION, createdAtUtc: now, updatedAtUtc: now, source: input.source ?? 'manual' }));
}
export function updateQso(existing: Qso, input: CreateQsoInput, options: { readonly now?: () => Date } = {}): Qso {
  return requireQso(normalizeQso({ ...existing, ...input, qsoId: existing.qsoId, activationId: existing.activationId, createdAtUtc: existing.createdAtUtc, updatedAtUtc: utcNow(options.now), source: existing.source }));
}
export function normalizeQso(input: unknown): QsoNormalizationResult {
  const issues: string[] = [];
  if (!isRecord(input)) return invalid(['QSO must be an object.']);
  const schemaVersion = input.schemaVersion === undefined ? QSO_SCHEMA_VERSION : input.schemaVersion;
  if (schemaVersion !== QSO_SCHEMA_VERSION) issues.push('schemaVersion is unsupported.');
  const qsoId = id(input.qsoId, 'qsoId', issues); const activationId = id(input.activationId, 'activationId', issues);
  const qsoDateTimeUtc = timestamp(input.qsoDateTimeUtc, 'qsoDateTimeUtc', issues); const callsign = callsignValue(input.callsign, issues);
  const mode = text(input.mode, 'mode', 32, issues, true)?.toUpperCase();
  let band = text(input.band, 'band', 16, issues, false)?.toLowerCase();
  const frequencyMHz = number(input.frequencyMHz, 'frequencyMHz', issues);
  if (!band && frequencyMHz !== undefined) band = bandForFrequency(frequencyMHz);
  if (!band) issues.push('band is required when frequency is unknown.');
  if (band && frequencyMHz !== undefined && !isCompatibleBand(band, frequencyMHz)) issues.push('frequencyMHz contradicts band.');
  const source = input.source === undefined ? 'manual' : input.source;
  if (source !== 'manual' && source !== 'adif_import') issues.push('source is unsupported.');
  const result: Qso = { schemaVersion: QSO_SCHEMA_VERSION, qsoId: qsoId!, activationId: activationId!, qsoDateTimeUtc: qsoDateTimeUtc!, callsign: callsign!, band: band!, ...(frequencyMHz === undefined ? {} : { frequencyMHz }), mode: mode as QsoMode, ...optionalText(input, issues), source: source as QsoSource, createdAtUtc: timestamp(input.createdAtUtc, 'createdAtUtc', issues)!, updatedAtUtc: timestamp(input.updatedAtUtc, 'updatedAtUtc', issues)! };
  return issues.length || !qsoId || !activationId || !qsoDateTimeUtc || !callsign || !band || !result.createdAtUtc || !result.updatedAtUtc ? invalid(issues) : { valid: true, qso: result, issues: [] };
}
export function validateQso(input: unknown): input is Qso { return normalizeQso(input).valid; }
export function isValidQsoId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.trim()); }
export function qsoFingerprint(qso: Pick<Qso, 'activationId'|'callsign'|'qsoDateTimeUtc'|'band'|'frequencyMHz'|'mode'|'submode'>): string { return [qso.activationId, qso.callsign, qso.qsoDateTimeUtc, qso.band, qso.frequencyMHz ?? '', qso.mode.toUpperCase(), qso.submode?.toUpperCase() ?? ''].join('|'); }
export function bandForFrequency(value: number): string | undefined { const ranges: readonly [number, number, string][] = [[1.8,2,'160m'],[3.5,4,'80m'],[7,7.3,'40m'],[10.1,10.15,'30m'],[14,14.35,'20m'],[18.068,18.168,'17m'],[21,21.45,'15m'],[24.89,24.99,'12m'],[28,29.7,'10m'],[50,54,'6m'],[144,148,'2m'],[420,450,'70cm']]; return ranges.find(([min,max]) => value >= min && value <= max)?.[2]; }
function isCompatibleBand(band: string, frequency: number): boolean { return bandForFrequency(frequency) === band || (band === '23cm' && frequency >= 1240 && frequency <= 1300); }
function optionalText(input: Record<string, any>, issues: string[]): Record<string, string> { const fields: Record<string, string> = {}; for (const key of ['submode','rstSent','rstReceived','stationCallsign','operatorCallsign','myGridSquare','gridSquare','potaRef','sotaRef','notes']) { const value = text(input[key], key, QSO_MAX_TEXT_LENGTH, issues, false); if (value) fields[key] = value; } return fields; }
function callsignValue(value: unknown, issues: string[]): string | undefined { const result = text(value, 'callsign', QSO_MAX_CALLSIGN_LENGTH, issues, true)?.toUpperCase(); if (result && !/^[A-Z0-9][A-Z0-9\-/]*$/.test(result)) issues.push('callsign is invalid.'); return result; }
function text(value: unknown, field: string, max: number, issues: string[], required: boolean): string | undefined { if (value === undefined && !required) return undefined; if (typeof value !== 'string') { issues.push(`${field} must be a string.`); return undefined; } const result = value.trim(); if (!result && required) issues.push(`${field} cannot be blank.`); if (result.length > max) issues.push(`${field} exceeds the maximum length.`); return result || undefined; }
function number(value: unknown, field: string, issues: string[]): number | undefined { if (value === undefined || value === null || value === '') return undefined; if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) { issues.push(`${field} must be a positive number.`); return undefined; } return value; }
function id(value: unknown, field: string, issues: string[]): string | undefined { if (!isValidQsoId(value)) { issues.push(`${field} is malformed.`); return undefined; } return value.trim(); }
function timestamp(value: unknown, field: string, issues: string[]): string | undefined { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) { issues.push(`${field} must be a valid UTC timestamp.`); return undefined; } return new Date(value).toISOString(); }
function utcNow(now?: () => Date): string { const value = (now ?? (() => new Date()))(); if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('The QSO clock returned an invalid date.'); return value.toISOString(); }
function requireQso(result: QsoNormalizationResult): Qso { if (!result.valid || !result.qso) throw new Error(`The QSO value is invalid: ${result.issues.join(' ')}`); return result.qso; }
function invalid(issues: readonly string[]): QsoNormalizationResult { return { valid: false, qso: null, issues }; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
