import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gridSquareToLatLon } from '../src/types';
import { OBSERVED_RF_WINDOW_MS, type ObservedRfSnapshot, type PskReceptionReport } from '../src/propagation/observedRf';
import { normalizeStationSignalObservation, normalizeTxContext, type StationSignalObservation, type TxContext } from './operationalIntelligence';

export const OPERATIONAL_INTELLIGENCE_STORE_VERSION = 1 as const;
export const OPERATIONAL_INTELLIGENCE_STORE_FILE_NAME = 'operational-intelligence.json';
export const OPERATIONAL_INTELLIGENCE_NO_MATCH = 'No matching reports observed';
export type OperationalIntelligenceDiagnostic = { readonly code: 'missing' | 'corrupt' | 'unsupported_store_version' | 'invalid_entry' | 'io_error'; readonly message: string; readonly id?: string };
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

  list(activationId: string): { readonly txContexts: readonly TxContext[]; readonly observations: readonly StationSignalObservation[]; readonly diagnostics: readonly OperationalIntelligenceDiagnostic[] } {
    const result = this.load();
    return { txContexts: result.txContexts.filter(item => item.activationId === activationId), observations: result.observations.filter(item => item.activationId === activationId), diagnostics: result.diagnostics };
  }

  openTxContext(activationId: string, input: unknown): { readonly context: TxContext; readonly diagnostics: readonly OperationalIntelligenceDiagnostic[] } {
    const loaded = this.load();
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const source = isRecord(input) ? { ...input } : {};
    delete source.segmentId; delete source.activationId; delete source.startedAtUtc; delete source.endedAtUtc;
    const candidate = { ...source, segmentId: this.id('tx'), activationId, startedAtUtc: now };
    const context = normalizeTxContext(candidate);
    if (!context) throw new Error('The TX Context request is invalid.');
    const updated = loaded.txContexts.map(item => item.activationId === activationId && item.endedAtUtc === undefined ? { ...item, endedAtUtc: now } : item);
    this.write({ storeVersion: OPERATIONAL_INTELLIGENCE_STORE_VERSION, txContexts: [context, ...updated], observations: loaded.observations });
    return { context, diagnostics: loaded.diagnostics };
  }

  closeActivation(activationId: string, endedAtUtc = (this.options.now ?? (() => new Date()))().toISOString()): void {
    const loaded = this.load();
    const updated = loaded.txContexts.map(item => item.activationId === activationId && item.endedAtUtc === undefined ? { ...item, endedAtUtc } : item);
    if (updated.some((item, index) => item !== loaded.txContexts[index])) this.write({ storeVersion: OPERATIONAL_INTELLIGENCE_STORE_VERSION, txContexts: updated, observations: loaded.observations });
  }

  captureObservation(activationId: string, segmentId: string, snapshot: ObservedRfSnapshot): { readonly observation: StationSignalObservation; readonly diagnostics: readonly OperationalIntelligenceDiagnostic[] } {
    const loaded = this.load();
    const context = loaded.txContexts.find(item => item.activationId === activationId && item.segmentId === segmentId);
    if (!context) throw new Error('The TX Context segment was not found.');
    const now = (this.options.now ?? (() => new Date()))();
    const endsAtUtc = now.toISOString();
    const startsAtUtc = context.startedAtUtc > new Date(now.getTime() - OBSERVED_RF_WINDOW_MS).toISOString() ? context.startedAtUtc : new Date(now.getTime() - OBSERVED_RF_WINDOW_MS).toISOString();
    const callsign = (this.options.operatorCallsign?.() ?? '').trim().toUpperCase();
    const reports = snapshot.reports.filter(report => report.direction === 'outbound' && report.senderCallsign === callsign && report.band === context.band && (report.mode === null || report.mode === context.mode) && report.observedAtUtc >= startsAtUtc && report.observedAtUtc <= endsAtUtc);
    const durationMinutes = (Date.parse(endsAtUtc) - Date.parse(startsAtUtc)) / 60000;
    const candidate = { observationId: this.id('observation'), activationId, txContextSegmentId: segmentId, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc, endsAtUtc, status: snapshot.status === 'live' ? 'live' : snapshot.status, matchingReportCount: reports.length, uniqueReceiverCount: new Set(reports.map(report => report.receiverCallsign)).size, ...(durationMinutes > 0 ? { reportsPerMinute: reports.length / durationMinutes, uniqueReceiversPerMinute: new Set(reports.map(report => report.receiverCallsign)).size / durationMinutes } : {}), newestMatchingReportAtUtc: reports.at(-1)?.observedAtUtc ?? null, limitations: [ 'Observed digital reception does not prove RF transmission, SSB usability, station success, or contact probability.', ...(reports.length ? [] : [OPERATIONAL_INTELLIGENCE_NO_MATCH]) ], ...(buildDistance(snapshot.operatingGrid4, reports)), ...(buildSnr(reports)) };
    const observation = normalizeStationSignalObservation(candidate);
    if (!observation) throw new Error('The captured Station Signal Observation was invalid.');
    this.write({ storeVersion: OPERATIONAL_INTELLIGENCE_STORE_VERSION, txContexts: loaded.txContexts, observations: [observation, ...loaded.observations] });
    return { observation, diagnostics: loaded.diagnostics };
  }

  private id(prefix: string): string { return this.options.createId?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`; }
  private write(document: Document): void { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`; try { fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temporaryPath, this.filePath); } finally { try { fs.rmSync(temporaryPath, { force: true }); } catch {} } }
}

function buildDistance(grid4: string | null, reports: readonly PskReceptionReport[]): Pick<StationSignalObservation, 'distance'> {
  const origin = grid4 ? gridSquareToLatLon(grid4) : null;
  const distances = origin ? reports.map(report => report.receiverLocator ? gridSquareToLatLon(report.receiverLocator) : null).filter((value): value is { lat: number; lon: number } => value !== null).map(point => haversineKm(origin.lat, origin.lon, point.lat, point.lon)).sort((a, b) => a - b) : [];
  if (!distances.length) return { distance: { derivation: 'maidenhead_locator_centers', approximate: true, locatedReportCount: 0, nearestKm: 0, medianKm: 0, farthestKm: 0 } };
  return { distance: { derivation: 'maidenhead_locator_centers', approximate: true, locatedReportCount: distances.length, nearestKm: distances[0], medianKm: distances.length % 2 ? distances[Math.floor(distances.length / 2)] : (distances[distances.length / 2 - 1] + distances[distances.length / 2]) / 2, farthestKm: distances.at(-1)! } };
}
function buildSnr(reports: readonly PskReceptionReport[]): Pick<StationSignalObservation, 'snr'> { const values = reports.map(report => report.snrDb).filter((value): value is number => value !== null).sort((a, b) => a - b); if (!values.length) return {}; return { snr: { reportCount: values.length, minimumDb: values[0], medianDb: values.length % 2 ? values[Math.floor(values.length / 2)] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2, maximumDb: values.at(-1)! } }; }
function haversineKm(leftLat: number, leftLon: number, rightLat: number, rightLon: number): number { const radians = (value: number) => value * Math.PI / 180; const a = Math.sin((radians(rightLat) - radians(leftLat)) / 2) ** 2 + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin((radians(rightLon) - radians(leftLon)) / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function idOf(value: unknown): string | undefined { return isRecord(value) && typeof value.observationId === 'string' ? value.observationId : isRecord(value) && typeof value.segmentId === 'string' ? value.segmentId : undefined; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }