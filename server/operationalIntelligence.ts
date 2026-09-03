export const VALUE_PROVENANCES = ['operator_supplied', 'wsjtx_reported', 'pskreporter_reported', 'wspr_reported', 'program_default'] as const;
export type ValueProvenance = typeof VALUE_PROVENANCES[number];

export interface FieldProvenance {
  readonly radioSetup?: ValueProvenance;
  readonly antenna?: ValueProvenance;
  readonly transmitPowerWatts?: ValueProvenance;
  readonly band?: ValueProvenance;
  readonly mode?: ValueProvenance;
  readonly frequencyMHz?: ValueProvenance;
}
export interface TxContext {
  readonly contextId: string;
  readonly activationId: string;
  readonly startedAtUtc: string;
  readonly endedAtUtc?: string;
  readonly radioSetupLabel: string;
  readonly antennaLabel: string;
  readonly transmitPowerWatts: number;
  readonly band: string;
  readonly mode: string;
  readonly frequencyMHz?: number;
  readonly provenance: FieldProvenance;
}
export interface StationSignalObservation {
  readonly observationId: string;
  readonly activationId: string;
  readonly contextId: string;
  readonly startsAtUtc: string;
  readonly endsAtUtc: string;
  readonly source: 'pskreporter' | 'wspr';
  readonly status: 'retained' | 'unavailable';
  readonly matchingReports: number;
  readonly uniqueReceivers: number;
  readonly reportsPerMinute?: number;
  readonly uniqueReceiversPerMinute?: number;
  readonly newestReportAtUtc?: string;
  readonly limitation: string;
}

export function normalizeTxContext(value: unknown): TxContext | null {
  if (!isRecord(value) || !nonEmpty(value.contextId) || !nonEmpty(value.activationId) || !utc(value.startedAtUtc) || (value.endedAtUtc !== undefined && !utc(value.endedAtUtc)) || !nonEmpty(value.radioSetupLabel) || !nonEmpty(value.antennaLabel) || !positive(value.transmitPowerWatts) || !nonEmpty(value.band) || !nonEmpty(value.mode) || (value.frequencyMHz !== undefined && !positive(value.frequencyMHz)) || !isProvenance(value.provenance)) return null;
  if (value.endedAtUtc !== undefined && Date.parse(value.endedAtUtc) < Date.parse(value.startedAtUtc)) return null;
  return value as TxContext;
}

export function normalizeStationSignalObservation(value: unknown): StationSignalObservation | null {
  if (!isRecord(value) || !nonEmpty(value.observationId) || !nonEmpty(value.activationId) || !nonEmpty(value.contextId) || !utc(value.startsAtUtc) || !utc(value.endsAtUtc) || Date.parse(value.endsAtUtc) < Date.parse(value.startsAtUtc) || (value.source !== 'pskreporter' && value.source !== 'wspr') || (value.status !== 'retained' && value.status !== 'unavailable') || !count(value.matchingReports) || !count(value.uniqueReceivers) || !nonNegativeOptional(value.reportsPerMinute) || !nonNegativeOptional(value.uniqueReceiversPerMinute) || (value.newestReportAtUtc !== undefined && !utc(value.newestReportAtUtc)) || !nonEmpty(value.limitation)) return null;
  return value as StationSignalObservation;
}

function isProvenance(value: unknown): value is FieldProvenance { return isRecord(value) && Object.values(value).every(item => typeof item === 'string' && (VALUE_PROVENANCES as readonly string[]).includes(item)); }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function nonNegativeOptional(value: unknown): boolean { return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0); }
function utc(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.endsWith('Z'); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
