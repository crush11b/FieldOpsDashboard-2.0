import { latLonToGridSquare } from '../types';
import type { PropagationGuidanceBand } from './domain';

export const OBSERVED_RF_WINDOW_MS = 15 * 60 * 1000;
export const OBSERVED_RF_CACHE_STALE_AFTER_MS = 30 * 60 * 1000;
export const OBSERVED_RF_FUTURE_SKEW_MS = 2 * 60 * 1000;
export const OBSERVED_RF_SOURCE_ID = 'pskreporter-via-mqtt';
export const OBSERVED_RF_SOURCE_NAME = 'PSKReporter reports via mqtt.pskreporter.info';

export const OBSERVED_RF_BANDS: readonly PropagationGuidanceBand[] = [
  '160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m',
];

export type ObservedRfConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'cached' | 'stale' | 'unavailable';
export type ObservedRfDirection = 'outbound' | 'inbound' | 'local';
export type ObservedRfRejectionReason = 'invalid_topic' | 'invalid_json' | 'missing_callsign' | 'missing_frequency' | 'invalid_locator' | 'operating_grid_mismatch' | 'unsupported_band' | 'invalid_timestamp' | 'future_timestamp' | 'other';

export interface PskReceptionReport {
  readonly reportId: string;
  readonly sourceSequence: string | number | null;
  readonly senderCallsign: string;
  readonly receiverCallsign: string;
  readonly senderLocator: string | null;
  readonly receiverLocator: string | null;
  readonly senderGrid4: string | null;
  readonly receiverGrid4: string | null;
  readonly frequencyHz: number;
  readonly band: PropagationGuidanceBand;
  readonly mode: string | null;
  readonly snrDb: number | null;
  readonly observedAtUtc: string;
  readonly receivedAtUtc: string;
  readonly senderDxcc: string | number | null;
  readonly receiverDxcc: string | number | null;
  readonly direction: ObservedRfDirection;
  readonly provenance: {
    readonly sourceId: typeof OBSERVED_RF_SOURCE_ID;
    readonly sourceName: typeof OBSERVED_RF_SOURCE_NAME;
    readonly semantics: 'observed_digital_reception_report';
    readonly limitation: 'Does not prove SSB usability, station-specific success, regional openness, confidence, or a propagation rating.';
  };
}

export interface ObservedRfBandSummary {
  readonly band: PropagationGuidanceBand;
  readonly reportCount: number;
  readonly outboundReportCount: number;
  readonly inboundReportCount: number;
  readonly uniqueSenderCount: number;
  readonly uniqueReceiverCount: number;
  readonly uniquePathCount: number;
  readonly modeCounts: Readonly<Record<string, number>>;
  readonly newestReportAt: string | null;
  readonly oldestReportAt: string | null;
  readonly snrDb: { readonly minimum: number | null; readonly maximum: number | null; readonly median: number | null };
  readonly locatorCoverage: { readonly reportsWithBothLocators: number; readonly percentage: number | null };
}

export interface ObservedRfSnapshot {
  readonly kind: 'observed_rf';
  readonly status: ObservedRfConnectionStatus;
  readonly evidenceStatus: 'live_observed_rf_source' | 'cached_observed_rf_source' | 'stale_observed_rf_source' | 'unavailable';
  readonly operatingGrid4: string | null;
  readonly observationWindow: { readonly startsAt: string; readonly endsAt: string };
  readonly collectedAtUtc: string;
  readonly reports: readonly PskReceptionReport[];
  readonly bandSummaries: readonly ObservedRfBandSummary[];
  readonly provenance: {
    readonly sourceId: typeof OBSERVED_RF_SOURCE_ID;
    readonly sourceName: typeof OBSERVED_RF_SOURCE_NAME;
    readonly transport: 'mqtts-websocket';
    readonly brokerHost: 'mqtt.pskreporter.info';
    readonly brokerPort: 1886;
    readonly topicPatterns: readonly [string, string] | readonly [];
  };
}

export interface ParsedPskTopic {
  readonly band: string | null;
  readonly mode: string | null;
  readonly senderCallsign: string | null;
  readonly receiverCallsign: string | null;
  readonly senderLocator: string | null;
  readonly receiverLocator: string | null;
  readonly senderDxcc: string | null;
  readonly receiverDxcc: string | null;
}

const BAND_RANGES: readonly { band: PropagationGuidanceBand; minHz: number; maxHz: number }[] = [
  { band: '160m', minHz: 1_800_000, maxHz: 2_000_000 },
  { band: '80m', minHz: 3_500_000, maxHz: 4_000_000 },
  { band: '40m', minHz: 7_000_000, maxHz: 7_300_000 },
  { band: '30m', minHz: 10_100_000, maxHz: 10_150_000 },
  { band: '20m', minHz: 14_000_000, maxHz: 14_350_000 },
  { band: '17m', minHz: 18_068_000, maxHz: 18_168_000 },
  { band: '15m', minHz: 21_000_000, maxHz: 21_450_000 },
  { band: '12m', minHz: 24_890_000, maxHz: 24_990_000 },
  { band: '10m', minHz: 28_000_000, maxHz: 29_700_000 },
  { band: '6m', minHz: 50_000_000, maxHz: 54_000_000 },
];

const BAND_ALIASES: Readonly<Record<string, PropagationGuidanceBand | '60m'>> = {
  '160': '160m', '160M': '160m', '80': '80m', '80M': '80m', '40': '40m', '40M': '40m',
  '30': '30m', '30M': '30m', '20': '20m', '20M': '20m', '17': '17m', '17M': '17m',
  '15': '15m', '15M': '15m', '12': '12m', '12M': '12m', '10': '10m', '10M': '10m',
  '6': '6m', '6M': '6m', '60': '60m', '60M': '60m',
};

export function buildObservedRfTopicPatterns(grid4: string): readonly [string, string] {
  const grid = grid4.trim().toUpperCase();
  return [
    `pskr/filter/v2/+/+/+/+/${grid}/+/+/+`,
    `pskr/filter/v2/+/+/+/+/+/${grid}/+/+`,
  ];
}

export function parsePskTopic(topic: string): ParsedPskTopic | null {
  const parts = topic.split('/');
  if (parts.length !== 11 || parts[0] !== 'pskr' || parts[1] !== 'filter' || parts[2] !== 'v2') return null;
  const field = (value: string): string | null => value === '+' || value === '#' || value === '' ? null : value;
  return {
    band: field(parts[3]), mode: field(parts[4]), senderCallsign: field(parts[5]), receiverCallsign: field(parts[6]),
    senderLocator: field(parts[7]), receiverLocator: field(parts[8]), senderDxcc: field(parts[9]), receiverDxcc: field(parts[10]),
  };
}

export function classifyObservedRfBand(frequencyHz: number, explicitBand: unknown): PropagationGuidanceBand | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const derived = BAND_RANGES.find(range => frequencyHz >= range.minHz && frequencyHz <= range.maxHz)?.band ?? null;
  const explicit = typeof explicitBand === 'string' ? BAND_ALIASES[explicitBand.trim().toUpperCase()] : undefined;
  if (explicit === '60m') return null;
  if (explicit && derived && explicit !== derived) return derived;
  return derived;
}

export function normalizeLocator(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const locator = value.trim().toUpperCase();
  return /^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/.test(locator) ? locator : null;
}

export function locatorGrid4(locator: string | null): string | null {
  return locator ? locator.slice(0, 4) : null;
}

export function parsePskPayload(topic: string, payload: string | Uint8Array, operatingGrid4: string, receivedAt: Date): PskReceptionReport | null {
  return parsePskPayloadDiagnostic(topic, payload, operatingGrid4, receivedAt).report;
}

export function parsePskPayloadDiagnostic(topic: string, payload: string | Uint8Array, operatingGrid4: string, receivedAt: Date): { readonly report: PskReceptionReport | null; readonly rejectionReason: ObservedRfRejectionReason | null } {
  const parsedTopic = parsePskTopic(topic);
  if (!parsedTopic) return { report: null, rejectionReason: 'invalid_topic' };
  let value: unknown;
  try { value = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload)); } catch { return { report: null, rejectionReason: 'invalid_json' }; }
  if (!isRecord(value)) return { report: null, rejectionReason: 'other' };

  const senderCallsign = normalizedCallsign(value.sc ?? parsedTopic.senderCallsign);
  const receiverCallsign = normalizedCallsign(value.rc ?? parsedTopic.receiverCallsign);
  const frequencyHz = finiteNumber(value.f);
  if (!senderCallsign || !receiverCallsign) return { report: null, rejectionReason: 'missing_callsign' };
  if (frequencyHz === null) return { report: null, rejectionReason: 'missing_frequency' };
  const senderLocatorValue = value.sl ?? parsedTopic.senderLocator;
  const receiverLocatorValue = value.rl ?? parsedTopic.receiverLocator;
  const senderLocator = normalizeLocator(senderLocatorValue);
  const receiverLocator = normalizeLocator(receiverLocatorValue);
  const hasSenderLocatorValue = typeof senderLocatorValue === 'string' ? senderLocatorValue.trim().length > 0 : senderLocatorValue !== null && senderLocatorValue !== undefined;
  const hasReceiverLocatorValue = typeof receiverLocatorValue === 'string' ? receiverLocatorValue.trim().length > 0 : receiverLocatorValue !== null && receiverLocatorValue !== undefined;
  if ((hasSenderLocatorValue && senderLocator === null) || (hasReceiverLocatorValue && receiverLocator === null)) {
    return { report: null, rejectionReason: 'invalid_locator' };
  }
  const senderGrid4 = locatorGrid4(senderLocator);
  const receiverGrid4 = locatorGrid4(receiverLocator);
  const grid = operatingGrid4.toUpperCase();
  const direction = senderGrid4 === grid && receiverGrid4 === grid ? 'local' : senderGrid4 === grid ? 'outbound' : receiverGrid4 === grid ? 'inbound' : null;
  if (!direction) return { report: null, rejectionReason: 'operating_grid_mismatch' };
  const band = classifyObservedRfBand(frequencyHz, value.b ?? parsedTopic.band);
  if (!band) return { report: null, rejectionReason: 'unsupported_band' };
  const timestamp = parseReportTimestampDiagnostic(value.t, receivedAt);
  if (!timestamp.value) return { report: null, rejectionReason: timestamp.reason };
  const observedAtUtc = timestamp.value;
  const sourceSequence = primitive(value.sq ?? value.seq ?? value.sequence ?? value.sequenceNumber ?? value.id);
  const reportId = sourceSequence !== null
    ? `sequence:${String(sourceSequence)}`
    : deterministicReportId(senderCallsign, receiverCallsign, frequencyHz, value.md ?? parsedTopic.mode, observedAtUtc, senderLocator, receiverLocator);
  return { report: {
    reportId,
    sourceSequence,
    senderCallsign,
    receiverCallsign,
    senderLocator,
    receiverLocator,
    senderGrid4,
    receiverGrid4,
    frequencyHz,
    band,
    mode: optionalString(value.md ?? parsedTopic.mode),
    snrDb: finiteNumber(value.rp),
    observedAtUtc,
    receivedAtUtc: receivedAt.toISOString(),
    senderDxcc: primitive(value.sa ?? value.sdxcc ?? value.sdc ?? value.scountry ?? parsedTopic.senderDxcc),
    receiverDxcc: primitive(value.ra ?? value.rdxcc ?? value.rdc ?? value.rcountry ?? parsedTopic.receiverDxcc),
    direction,
    provenance: {
      sourceId: OBSERVED_RF_SOURCE_ID,
      sourceName: OBSERVED_RF_SOURCE_NAME,
      semantics: 'observed_digital_reception_report',
      limitation: 'Does not prove SSB usability, station-specific success, regional openness, confidence, or a propagation rating.',
    },
  }, rejectionReason: null };
}

export function isPskReceptionReport(value: unknown): value is PskReceptionReport {
  if (!isRecord(value)
    || typeof value.reportId !== 'string' || !value.reportId
    || !isSourceSequence(value.sourceSequence)
    || !isCallsign(value.senderCallsign) || !isCallsign(value.receiverCallsign)
    || !isPositiveFinite(value.frequencyHz)
    || !isHfObservedBand(value.band)
    || !(value.mode === null || typeof value.mode === 'string')
    || !(value.snrDb === null || isFiniteNumber(value.snrDb))
    || !isSourceSequence(value.senderDxcc) || !isSourceSequence(value.receiverDxcc)
    || !isTimestamp(value.observedAtUtc) || !isTimestamp(value.receivedAtUtc)
    || !isNullableLocator(value.senderLocator) || !isNullableLocator(value.receiverLocator)
    || !isNullableGrid4(value.senderGrid4) || !isNullableGrid4(value.receiverGrid4)
    || !isDirection(value.direction)
    || !isRecord(value.provenance)
    || value.provenance.sourceId !== OBSERVED_RF_SOURCE_ID
    || value.provenance.sourceName !== OBSERVED_RF_SOURCE_NAME
    || value.provenance.semantics !== 'observed_digital_reception_report'
    || value.provenance.limitation !== 'Does not prove SSB usability, station-specific success, regional openness, confidence, or a propagation rating.') {
    return false;
  }
  return classifyObservedRfBand(value.frequencyHz, value.band) === value.band
    && ((value.direction === 'outbound' && value.senderGrid4 !== null)
      || (value.direction === 'inbound' && value.receiverGrid4 !== null)
      || (value.direction === 'local' && value.senderGrid4 !== null && value.receiverGrid4 !== null))
    && (value.senderLocator === null || value.senderGrid4 === locatorGrid4(value.senderLocator))
    && (value.receiverLocator === null || value.receiverGrid4 === locatorGrid4(value.receiverLocator));
}

export function summarizeObservedRfReports(reports: readonly PskReceptionReport[]): readonly ObservedRfBandSummary[] {
  return OBSERVED_RF_BANDS.map(band => {
    const items = reports.filter(report => report.band === band);
    const senders = new Set(items.map(report => report.senderCallsign));
    const receivers = new Set(items.map(report => report.receiverCallsign));
    const paths = new Set(items.map(report => `${report.senderCallsign}|${report.receiverCallsign}|${report.frequencyHz}|${report.mode ?? ''}`));
    const snr = items.map(report => report.snrDb).filter((value): value is number => value !== null).sort((a, b) => a - b);
    const times = items.map(report => report.observedAtUtc).sort();
    const modes: Record<string, number> = {};
    items.forEach(report => { const mode = report.mode ?? 'unknown'; modes[mode] = (modes[mode] ?? 0) + 1; });
    const withBothLocators = items.filter(report => report.senderLocator !== null && report.receiverLocator !== null).length;
    return {
      band, reportCount: items.length,
      outboundReportCount: items.filter(report => report.direction === 'outbound' || report.direction === 'local').length,
      inboundReportCount: items.filter(report => report.direction === 'inbound' || report.direction === 'local').length,
      uniqueSenderCount: senders.size, uniqueReceiverCount: receivers.size, uniquePathCount: paths.size,
      modeCounts: modes, newestReportAt: times.at(-1) ?? null, oldestReportAt: times[0] ?? null,
      snrDb: { minimum: snr[0] ?? null, maximum: snr.at(-1) ?? null, median: snr.length === 0 ? null : snr.length % 2 ? snr[Math.floor(snr.length / 2)] : (snr[snr.length / 2 - 1] + snr[snr.length / 2]) / 2 },
      locatorCoverage: { reportsWithBothLocators: withBothLocators, percentage: items.length === 0 ? null : withBothLocators / items.length * 100 },
    };
  });
}

export function latLonGrid4(lat: number, lon: number): string | null {
  const grid = latLonToGridSquare(lat, lon);
  return /^[A-R]{2}[0-9]{2}/.test(grid) ? grid.slice(0, 4).toUpperCase() : null;
}

function normalizedCallsign(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}
function optionalString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function finiteNumber(value: unknown): number | null { const number = typeof value === 'string' && value.trim() ? Number(value) : value; return typeof number === 'number' && Number.isFinite(number) ? number : null; }
function primitive(value: unknown): string | number | null { return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function parseReportTimestampDiagnostic(value: unknown, receivedAt: Date): { value: string | null; reason: 'invalid_timestamp' | 'future_timestamp' } {
  const sourceNumber = finiteNumber(value);
  if (sourceNumber === null || sourceNumber < 0 || !Number.isFinite(receivedAt.getTime())) return { value: null, reason: 'invalid_timestamp' };
  const date = new Date(sourceNumber > 10_000_000_000 ? sourceNumber : sourceNumber * 1000);
  if (!Number.isFinite(date.getTime())) return { value: null, reason: 'invalid_timestamp' };
  if (date.getTime() > receivedAt.getTime() + OBSERVED_RF_FUTURE_SKEW_MS) return { value: null, reason: 'future_timestamp' };
  return { value: date.toISOString(), reason: 'invalid_timestamp' };
}
function deterministicReportId(sender: string, receiver: string, frequency: number, mode: unknown, timestamp: string, senderLocator: string | null, receiverLocator: string | null): string { return `report:${[sender, receiver, frequency, optionalString(mode) ?? '', timestamp, senderLocator ?? '', receiverLocator ?? ''].join('|')}`; }

function isSourceSequence(value: unknown): value is string | number | null { return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)); }
function isCallsign(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isPositiveFinite(value: unknown): value is number { return isFiniteNumber(value) && value > 0; }
function isHfObservedBand(value: unknown): value is PropagationGuidanceBand { return typeof value === 'string' && (OBSERVED_RF_BANDS as readonly string[]).includes(value); }
function isTimestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function isNullableLocator(value: unknown): value is string | null { return value === null || normalizeLocator(value) === value; }
function isNullableGrid4(value: unknown): value is string | null { return value === null || (typeof value === 'string' && /^[A-R]{2}[0-9]{2}$/.test(value)); }
function isDirection(value: unknown): value is ObservedRfDirection { return value === 'outbound' || value === 'inbound' || value === 'local'; }
