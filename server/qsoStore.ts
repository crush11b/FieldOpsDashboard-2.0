import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQso, normalizeQso, type CreateQsoInput, type Qso } from './qso';

export const QSO_STORE_VERSION = 1 as const;
export const QSO_STORE_FILE_NAME = 'qsos.json';
export const QSO_MAX_RETAINED_RECORDS = 10000;
export interface QsoStoreDiagnostic { readonly code: 'missing' | 'corrupt' | 'unsupported_store_version' | 'invalid_qso' | 'io_error'; readonly message: string; readonly qsoId?: string; }
export interface QsoStoreReadResult { readonly status: 'missing' | 'loaded' | 'invalid' | 'ioError'; readonly qsos: readonly Qso[]; readonly diagnostics: readonly QsoStoreDiagnostic[]; }
export type QsoStoreGetResult = { readonly status: 'found'; readonly qso: Qso; readonly diagnostics: readonly QsoStoreDiagnostic[] } | { readonly status: 'notFound'; readonly diagnostics: readonly QsoStoreDiagnostic[] };
interface Document { readonly storeVersion: typeof QSO_STORE_VERSION; readonly qsos: readonly Qso[]; }

export function getDefaultQsoPath(environment: NodeJS.ProcessEnv = process.env, homeDirectory = os.homedir()): string { const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local'); return path.join(localAppData, 'FieldOpsDashboard', QSO_STORE_FILE_NAME); }
export class QsoStore {
  constructor(private readonly filePath: string, private readonly options: { readonly now?: () => Date; readonly createId?: () => string } = {}) {}
  load(): QsoStoreReadResult {
    let json: string; try { json = fs.readFileSync(this.filePath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', qsos: [], diagnostics: [{ code: 'missing', message: 'No QSO store exists yet.' }] }; return { status: 'ioError', qsos: [], diagnostics: [{ code: 'io_error', message: 'The QSO store could not be read.' }] }; }
    let parsed: unknown; try { parsed = JSON.parse(json); } catch { return { status: 'invalid', qsos: [], diagnostics: [{ code: 'corrupt', message: 'The QSO store contains invalid JSON.' }] }; }
    if (!isRecord(parsed) || parsed.storeVersion !== QSO_STORE_VERSION || !Array.isArray(parsed.qsos)) return { status: 'invalid', qsos: [], diagnostics: [{ code: isRecord(parsed) && parsed.storeVersion !== QSO_STORE_VERSION ? 'unsupported_store_version' : 'corrupt', message: 'The QSO store wrapper is unsupported or malformed.' }] };
    const qsos: Qso[] = []; const diagnostics: QsoStoreDiagnostic[] = [];
    for (const candidate of parsed.qsos) { const result = normalizeQso(candidate); if (!result.valid || !result.qso) diagnostics.push({ code: 'invalid_qso', message: 'A stored QSO was skipped because required fields were invalid.', qsoId: isRecord(candidate) && typeof candidate.qsoId === 'string' ? candidate.qsoId : undefined }); else qsos.push(result.qso); }
    return { status: 'loaded', qsos: order(qsos).slice(0, QSO_MAX_RETAINED_RECORDS), diagnostics };
  }
  listByActivation(activationId: string): QsoStoreReadResult { const result = this.load(); return { ...result, qsos: result.qsos.filter(qso => qso.activationId === activationId) }; }
  get(qsoId: string): QsoStoreGetResult { const result = this.load(); const qso = result.qsos.find(item => item.qsoId === qsoId); return qso ? { status: 'found', qso, diagnostics: result.diagnostics } : { status: 'notFound', diagnostics: result.diagnostics }; }
  create(input: CreateQsoInput): { readonly qso: Qso; readonly diagnostics: readonly QsoStoreDiagnostic[] } { const loaded = this.load(); const qso = createQso(input, this.options); if (loaded.qsos.some(item => item.qsoId === qso.qsoId)) throw new Error('The QSO ID already exists.'); this.write({ storeVersion: 1, qsos: order([qso, ...loaded.qsos]).slice(0, QSO_MAX_RETAINED_RECORDS) }); return { qso, diagnostics: loaded.diagnostics }; }
  save(qso: Qso): { readonly qso: Qso; readonly diagnostics: readonly QsoStoreDiagnostic[] } { const loaded = this.load(); const normalized = normalizeQso(qso); if (!normalized.valid || !normalized.qso) throw new Error('The QSO value is invalid.'); this.write({ storeVersion: 1, qsos: order([normalized.qso, ...loaded.qsos.filter(item => item.qsoId !== qso.qsoId)]) }); return { qso: normalized.qso, diagnostics: loaded.diagnostics }; }
  delete(qsoId: string): { readonly status: 'deleted' | 'notFound'; readonly qso?: Qso; readonly diagnostics: readonly QsoStoreDiagnostic[] } { const loaded = this.load(); const qso = loaded.qsos.find(item => item.qsoId === qsoId); if (!qso) return { status: 'notFound', diagnostics: loaded.diagnostics }; this.write({ storeVersion: 1, qsos: loaded.qsos.filter(item => item.qsoId !== qsoId) }); return { status: 'deleted', qso, diagnostics: loaded.diagnostics }; }
  private write(document: Document): void { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`; try { fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temp, this.filePath); } finally { try { fs.rmSync(temp, { force: true }); } catch {} } }
}
function order(qsos: readonly Qso[]): Qso[] { return [...qsos].sort((left, right) => right.qsoDateTimeUtc.localeCompare(left.qsoDateTimeUtc) || right.qsoId.localeCompare(left.qsoId)); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
