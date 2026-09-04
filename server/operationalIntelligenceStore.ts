import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gridSquareToLatLon } from '../src/types';
import type { Activation } from './activation';
import { type ObservedRfSnapshot, type PskReceptionReport } from '../src/propagation/observedRf';
import { normalizeStationSignalObservation, normalizeTxContext, type StationSignalObservation, type TxContext } from './operationalIntelligence';

export const OPERATIONAL_INTELLIGENCE_STORE_VERSION = 1 as const;
export const OPERATIONAL_INTELLIGENCE_STORE_FILE_NAME = 'operational-intelligence.json';
export const OPERATIONAL_INTELLIGENCE_NO_MATCH = 'No matching reports observed';
const PLACEHOLDER_CALLSIGNS = new Set(['N0CALL', 'W7FIELD', 'K7POTA', 'W6SOTA', 'VE3FIELD']);
export type OperationalIntelligenceDiagnostic = { readonly code: 'missing' | 'corrupt' | 'unsupported_store_version' | 'invalid_entry' | 'io_error' | 'not_found'; readonly message: string; readonly id?: string };
export type OperationalIntelligenceReadResult = { readonly status: 'missing' | 'loaded' | 'invalid' | 'ioError'; readonly txContexts: readonly TxContext[]; readonly observations: readonly StationSignalObservation[]; readonly diagnostics: readonly OperationalIntelligenceDiagnostic[] };

interface Document { readonly storeVersion: typeof OPERATIONAL_INTELLIGENCE_STORE_VERSION; readonly txContexts: readonly TxContext[]; readonly observations: readonly StationSignalObservation[]; }
interface StoreOptions { readonly now?: () => Date; readonly createId?: () => string; readonly operatorCallsign?: () => string | null; }

export function getDefaultOperationalIntelligencePath(environment: NodeJS.ProcessEnv = process.env, homeDirectory = os.homedir()): string {
  const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local');
  return path.join(localAppData, 'FieldOpsDashboard', OPERATIONAL_INTELLIGENCE_STORE_FILE_NAME);
}

export class OperationalIntelligenceStore {
  constructor(private readonly filePath: string, private readonly options: StoreOptions = {}) {}

  load(): OperationalIntelligenceReadResult {
    let json: string;
    try { json = fs.readFileSync(this.filePath, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', txContexts: [], observations: [], diagnostics: [{ code: 'missing', message: 'No operational intelligence store exists yet.' }] };
      return { status: 'ioError', txContexts: [], observations: [], diagnostics: [{ code: 'io_error', message: 'The operational intelligence store could not be read.' }] };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return { status: 'invalid', txContexts: [], observations: [], diagnostics: [{ code: 'corrupt', message: 'The operational intelligence store contains invalid JSON.' }] }; }
    if (!isRecord(parsed) || parsed.storeVersion !== OPERATIONAL_INTELLIGENCE_STORE_VERSION || !Array.isArray(parsed.txContexts) || !Array.isArray(parsed.observations)) return { status: 'invalid', txContexts: [], observations: [], diagnostics: [{ code: 'unsupported_store_version', message: 'The operational intelligence store wrapper is unsupported or malformed.' }] };
    const txContexts: TxContext[] = [], observations: StationSignalObservation[] = [], diagnostics: OperationalIntelligenceDiagnostic[] = [];
    for (const item of parsed.txContexts) { const value = normalizeTxContext(item); if (value) txContexts.push(value); else diagnostics.push({ code: 'invalid_entry', message: 'A stored TX Context was skipped because required fields were invalid.', id: idOf(item) }); }
    for (const item of parsed.observations) { const value = normalizeStationSignalObservation(item); if (value) observations.push(value); else diagnostics.push({ code: 'invalid_entry', message: 'A stored Station Signal Observation was skipped because required fields were invalid.', id: idOf(item) }); }
    return { status: 'loaded', txContexts, observations, diagnostics };
  }

  list(activationId: string): { readonly status: OperationalIntelligenceReadResult['status']; readonly txContexts: readonly TxContext[]; readonly observations: readonly StationSignalObservation[]; readonly diagnostics: readonly OperationalIntelligenceDiagnostic[] } {
    const result = this.load();
    return { status: result.status, txContexts: result.txContexts.filter(item => item.activationId === activationId), observations: result.observations.filter(item => item.activationId === activationId), diagnostics: result.diagnostics };
  }

  openTxContext(activation: Activation, input: unknown): { readonly context: TxContext; readonly diagnostics: readonly OperationalIntelligenceDiagnostic[] } {
    const loaded = this.load();
    this.ensureWritable(loaded);
    if (activation.status !== 'active' || !activation.startedAtUtc || activation.endedAtUtc) throw operationalError('invalid_lifecycle', 'The Activation must be active to open a TX Context.');
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const source = isRecord(input) ? { ...input } : {};
    delete source.segmentId; delete source.activationId; delete source.startedAtUtc; delete source.endedAtUtc;
    const candidate = { ...source, segmentId: this.id('tx'), activationId: activation.activationId, startedAtUtc: now };
    const context = normalizeTxContext(candidate);
    if (!context) throw new Error('The TX Context request is invalid.');
    const updated = loaded.txContexts.map(item => item.activationId === activation.activationId && item.endedAtUtc === undefined ? { ...item, endedAtUtc: now } : item);
    this.write({ storeVersion: OPERATIONAL_INTELLIGENCE_STORE_VERSION, txContexts: [context, ...updated], observations: loaded.observations });
    return { context, diagnostics: loaded.diagnostics };
  }

  closeActivation(activation: Activation): void {
    const loaded = this.load();
    this.ensureWritable(loaded);
    if (!activation.endedAtUtc) return;
    const updated = loaded.txContexts.map(item => item.activationId === activation.activationId && item.endedAtUtc === undefined ? { ...item, endedAtUtc: activation.endedAtUtc } : item);
    if (updated.some((item, index) => item !== loaded.txContexts[index])) this.write({ storeVersion: OPERATIONAL_INTELLIGENCE_STORE_VERSION, txContexts: updated, observations: loaded.observations });
  }

  captureObservation(activation: Activation, segmentId: string, snapshot: ObservedRfSnapshot): { readonly observation: StationSignalObservation; readonly diagnostics: readonly OperationalIntelligenceDiagnostic[] } {
    const loaded = this.load();
    this.ensureWritable(loaded);
    if (activation.status !== 'active' || !activation.startedAtUtc || activation.endedAtUtc) throw operationalError('invalid_lifecycle', 'The Activation must be active to capture an observation.');
    const context = loaded.txContexts.find(item => item.activationId === activation.activationId && item.segmentId === segmentId);
    if (!context) throw operationalError('not_found', 'The TX Context segment was not found.');
    if (context.endedAtUtc) throw operationalError('closed_segment', 'The TX Context segment is closed.');
    const sourceStatus = snapshot.status === 'live' ? 'live' : snapshot.status === 'cached' ? 'retained' : snapshot.status === 'stale' ? 'stale' : null;
    if (!sourceStatus) throw operationalError('observed_rf_unavailable', 'Observed RF is unavailable for capture.');
    const now = (this.options.now ?? (() => new Date()))();
    const callsign = (this.options.operatorCallsign?.() ?? '').trim().toUpperCase();
    if (!callsign || PLACEHOLDER_CALLSIGNS.has(callsign)) throw operationalError('invalid_callsign', 'A configured non-placeholder operator callsign is required.');
    const interval = deriveInterval(snapshot, context, activation, now);
    if (!interval) throw operationalError('non_overlapping_interval', 'The TX Context and observed-RF intervals do not overlap.');
    const reports = snapshot.reports.filter(report => report.direction === 'outbound' && report.senderCallsign.trim().toUpperCase() === callsign && report.band === context.band && (report.mode === null || report.mode.trim().toUpperCase() === context.mode.toUpperCase()) && timestampWithin(report.observedAtUtc, interval.startsAtUtc, interval.endsAtUtc)).sort((left, right) => left.observedAtUtc.localeCompare(right.observedAtUtc) || left.reportId.localeCompare(right.reportId));
    const durationMinutes = (interval.endsAtMs - interval.startsAtMs) / 60000;
    const matchingReportCount = reports.length;
    const receivers = new Set(reports.map(report => report.receiverCallsign));
    const candidate = { observationId: this.id('observation'), activationId: activation.activationId, txContextSegmentId: segmentId, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc: interval.startsAtUtc, endsAtUtc: interval.endsAtUtc, status: sourceStatus, matchingReportCount, uniqueReceiverCount: receivers.size, reportsPerMinute: matchingReportCount / durationMinutes, uniqueReceiversPerMinute: receivers.size / durationMinutes, newestMatchingReportAtUtc: reports.at(-1)?.observedAtUtc ?? null, limitations: matchingReportCount ? ['Observed digital reception does not prove RF transmission, SSB usability, station success, or contact probability.', 'Distance uses approximate Maidenhead locator centers.'] : [OPERATIONAL_INTELLIGENCE_NO_MATCH], ...(matchingReportCount ? buildDistance(reports) : {}), ...(matchingReportCount ? buildSnr(reports) : {}) };
    const observation = normalizeStationSignalObservation(candidate);
    if (!observation) throw new Error('The captured Station Signal Observation was invalid.');
    this.write({ storeVersion: OPERATIONAL_INTELLIGENCE_STORE_VERSION, txContexts: loaded.txContexts, observations: [observation, ...loaded.observations] });
    return { observation, diagnostics: loaded.diagnostics };
  }

  private id(prefix: string): string { return this.options.createId?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`; }
  private ensureWritable(result: OperationalIntelligenceReadResult): void { if (result.status === 'invalid' || result.status === 'ioError') throw operationalError('storage_unavailable', 'Operational intelligence storage is unavailable; no mutation was applied.'); }
  private write(document: Document): void { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`; try { fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); try { fs.renameSync(temporaryPath, this.filePath); } catch (error) { if (!isNodeError(error) || (error.code !== 'EEXIST' && error.code !== 'EPERM')) throw error; fs.rmSync(this.filePath, { force: true }); fs.renameSync(temporaryPath, this.filePath); } } finally { try { fs.rmSync(temporaryPath, { force: true }); } catch {} } }
}

function buildDistance(reports: readonly PskReceptionReport[]): Pick<StationSignalObservation, 'distance'> {
  const distances = reports.map(report => { const sender = report.senderLocator ? gridSquareToLatLon(report.senderLocator) : null; const receiver = report.receiverLocator ? gridSquareToLatLon(report.receiverLocator) : null; return sender && receiver ? haversineKm(sender.lat, sender.lon, receiver.lat, receiver.lon) : null; }).filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!distances.length) return {};
  return { distance: { derivation: 'maidenhead_locator_centers', approximate: true, locatedReportCount: distances.length, nearestKm: distances[0], medianKm: distances.length % 2 ? distances[Math.floor(distances.length / 2)] : (distances[distances.length / 2 - 1] + distances[distances.length / 2]) / 2, farthestKm: distances.at(-1)! } };
}
function buildSnr(reports: readonly PskReceptionReport[]): Pick<StationSignalObservation, 'snr'> { const values = reports.map(report => report.snrDb).filter((value): value is number => value !== null).sort((a, b) => a - b); if (!values.length) return {}; return { snr: { reportCount: values.length, minimumDb: values[0], medianDb: values.length % 2 ? values[Math.floor(values.length / 2)] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2, maximumDb: values.at(-1)! } }; }
function haversineKm(leftLat: number, leftLon: number, rightLat: number, rightLon: number): number { const radians = (value: number) => value * Math.PI / 180; const a = Math.sin((radians(rightLat) - radians(leftLat)) / 2) ** 2 + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin((radians(rightLon) - radians(leftLon)) / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function deriveInterval(snapshot: ObservedRfSnapshot, context: TxContext, activation: Activation, now: Date): { readonly startsAtMs: number; readonly endsAtMs: number; readonly startsAtUtc: string; readonly endsAtUtc: string } | null {
  const starts = [Date.parse(snapshot.observationWindow.startsAt), Date.parse(context.startedAtUtc), Date.parse(activation.startedAtUtc!)];
  const ends = [Date.parse(snapshot.observationWindow.endsAt), now.getTime(), ...(context.endedAtUtc ? [Date.parse(context.endedAtUtc)] : []), ...(activation.endedAtUtc ? [Date.parse(activation.endedAtUtc)] : [])];
  if (starts.some(value => !Number.isFinite(value)) || ends.some(value => !Number.isFinite(value))) return null;
  const startsAtMs = Math.max(...starts), endsAtMs = Math.min(...ends);
  if (startsAtMs >= endsAtMs || endsAtMs > now.getTime() || startsAtMs > now.getTime()) return null;
  return { startsAtMs, endsAtMs, startsAtUtc: new Date(startsAtMs).toISOString(), endsAtUtc: new Date(endsAtMs).toISOString() };
}
function timestampWithin(value: string, startsAtUtc: string, endsAtUtc: string): boolean { const timestamp = Date.parse(value); return Number.isFinite(timestamp) && timestamp >= Date.parse(startsAtUtc) && timestamp <= Date.parse(endsAtUtc); }
function operationalError(code: OperationalIntelligenceDiagnostic['code'] | 'invalid_lifecycle' | 'closed_segment' | 'non_overlapping_interval' | 'observed_rf_unavailable' | 'invalid_callsign' | 'storage_unavailable', message: string): Error & { readonly operationalCode: string } { return Object.assign(new Error(message), { operationalCode: code }); }
function isNodeError(value: unknown): value is NodeJS.ErrnoException { return value instanceof Error && 'code' in value; }
function idOf(value: unknown): string | undefined { return isRecord(value) && typeof value.observationId === 'string' ? value.observationId : isRecord(value) && typeof value.segmentId === 'string' ? value.segmentId : undefined; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }