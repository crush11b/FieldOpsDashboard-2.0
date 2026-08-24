import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateMissionForecastRecord, type MissionForecastRecord } from './missionForecast';

export const MISSION_FORECAST_STORE_VERSION = 1 as const;
export const MISSION_FORECAST_STORE_FILE_NAME = 'mission-forecasts.json';
const MAX_RETAINED_RECORDS = 10;
export type MissionForecastStoreDiagnosticCode = 'missing' | 'corrupt' | 'unsupported_store_version' | 'invalid_record' | 'io_error';
export interface MissionForecastStoreDiagnostic { readonly code: MissionForecastStoreDiagnosticCode; readonly message: string; readonly briefId?: string; }
export interface MissionForecastStoreReadResult { readonly status: 'missing' | 'loaded' | 'invalid' | 'ioError'; readonly records: readonly MissionForecastRecord[]; readonly diagnostics: readonly MissionForecastStoreDiagnostic[]; }
export type MissionForecastStoreGetResult = { readonly status: 'found'; readonly record: MissionForecastRecord; readonly diagnostics: readonly MissionForecastStoreDiagnostic[] } | { readonly status: 'notFound'; readonly diagnostics: readonly MissionForecastStoreDiagnostic[] };
interface StoreEntry { readonly briefId: string; readonly record: MissionForecastRecord; }
interface StoreDocument { readonly storeVersion: typeof MISSION_FORECAST_STORE_VERSION; readonly records: readonly StoreEntry[]; }

export function getDefaultMissionForecastPath(environment: NodeJS.ProcessEnv = process.env, homeDirectory = os.homedir()): string { const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local'); return path.join(localAppData, 'FieldOpsDashboard', MISSION_FORECAST_STORE_FILE_NAME); }
export class MissionForecastStore {
  constructor(private readonly filePath: string) {}
  load(): MissionForecastStoreReadResult {
    let json: string;
    try { json = fs.readFileSync(this.filePath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', records: [], diagnostics: [{ code: 'missing', message: 'No mission forecast store exists yet.' }] }; return { status: 'ioError', records: [], diagnostics: [{ code: 'io_error', message: 'The mission forecast store could not be read.' }] }; }
    let parsed: unknown; try { parsed = JSON.parse(json); } catch { return { status: 'invalid', records: [], diagnostics: [{ code: 'corrupt', message: 'The mission forecast store contains invalid JSON.' }] }; }
    if (!isRecord(parsed) || parsed.storeVersion !== 1 || !Array.isArray(parsed.records)) return { status: 'invalid', records: [], diagnostics: [{ code: isRecord(parsed) && parsed.storeVersion !== 1 ? 'unsupported_store_version' : 'corrupt', message: 'The mission forecast store wrapper is unsupported or malformed.' }] };
    const records: MissionForecastRecord[] = []; const diagnostics: MissionForecastStoreDiagnostic[] = [];
    for (const candidate of parsed.records) { if (!isRecord(candidate) || typeof candidate.briefId !== 'string' || !validateMissionForecastRecord(candidate.record) || candidate.record.briefId !== candidate.briefId) diagnostics.push({ code: 'invalid_record', message: 'A stored mission forecast was skipped because its key and brief identity were invalid.', briefId: isRecord(candidate) && typeof candidate.briefId === 'string' ? candidate.briefId : undefined }); else if (records.some(record => record.briefId === candidate.briefId)) diagnostics.push({ code: 'invalid_record', message: 'A duplicate stored mission forecast was skipped.', briefId: candidate.briefId }); else records.push(candidate.record); }
    return { status: 'loaded', records: records.sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc)).slice(0, MAX_RETAINED_RECORDS), diagnostics };
  }
  getByBriefId(briefId: string): MissionForecastStoreGetResult { const loaded = this.load(); const record = loaded.records.find(candidate => candidate.briefId === briefId); return record ? { status: 'found', record, diagnostics: loaded.diagnostics } : { status: 'notFound', diagnostics: loaded.diagnostics }; }
  save(record: MissionForecastRecord): { readonly record: MissionForecastRecord; readonly diagnostics: readonly MissionForecastStoreDiagnostic[] } { if (!validateMissionForecastRecord(record)) throw new Error('The mission forecast record is invalid.'); const loaded = this.load(); this.write({ storeVersion: 1, records: [record, ...loaded.records.filter(candidate => candidate.briefId !== record.briefId)].map(candidate => ({ briefId: candidate.briefId, record: candidate })).sort((left, right) => right.record.updatedAtUtc.localeCompare(left.record.updatedAtUtc)).slice(0, MAX_RETAINED_RECORDS) }); return { record, diagnostics: loaded.diagnostics }; }
  private write(document: StoreDocument): void { const directory = path.dirname(this.filePath); fs.mkdirSync(directory, { recursive: true }); const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`; try { fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temporaryPath, this.filePath); } finally { try { fs.rmSync(temporaryPath, { force: true }); } catch {} } }
}
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }