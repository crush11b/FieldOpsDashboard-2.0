import fs from 'node:fs';
import path from 'node:path';
import { parseAdif } from './qsoAdif';
import type { WsjtxLoggedQsoCandidate } from './wsjtx';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_PARTIAL_BUFFER_BYTES = 256 * 1024;
const CHECKPOINT_VERSION = 1 as const;

export type WsjtxAdifImportResult = 'persisted' | 'duplicate' | string;

export interface WsjtxAdifFileDiagnostics {
  readonly enabled: boolean;
  readonly state: 'stopped' | 'waiting' | 'active' | 'unavailable' | 'failed';
  readonly resolvedPath: string | null;
  readonly filePresent: boolean;
  readonly checkpointPath: string | null;
  readonly checkpointOffset: number | null;
  readonly baselineEstablished: boolean;
  readonly lastFileObservationAtUtc: string | null;
  readonly lastCompletedRecordAtUtc: string | null;
  readonly recordsAccepted: number;
  readonly recordsRejected: number;
  readonly parseImportFailures: number;
  readonly duplicatesSuppressed: number;
  readonly lastSuccessfulImportAtUtc: string | null;
  readonly lastFailureStage: string | null;
  readonly lastFailureReason: string | null;
}

interface Checkpoint {
  readonly version: typeof CHECKPOINT_VERSION;
  readonly offset: number;
  readonly fileId: string | null;
}

export interface WsjtxAdifWatcherOptions {
  readonly filePath?: string | null;
  readonly checkpointPath?: string;
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
  readonly onRecord: (candidate: WsjtxLoggedQsoCandidate) => WsjtxAdifImportResult;
}

export class WsjtxAdifWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private partial = '';
  private checkpoint: Checkpoint | null = null;
  private readOffset = 0;
  private state: WsjtxAdifFileDiagnostics['state'] = 'stopped';
  private filePresent = false;
  private lastFileObservationAtUtc: string | null = null;
  private lastCompletedRecordAtUtc: string | null = null;
  private recordsAccepted = 0;
  private recordsRejected = 0;
  private parseImportFailures = 0;
  private duplicatesSuppressed = 0;
  private lastSuccessfulImportAtUtc: string | null = null;
  private lastFailureStage: string | null = null;
  private lastFailureReason: string | null = null;

  constructor(private readonly options: WsjtxAdifWatcherOptions) {
    this.checkpoint = this.readCheckpoint();
    this.readOffset = this.checkpoint?.offset ?? 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.state = this.options.filePath ? 'waiting' : 'unavailable';
    void this.pollNow();
    this.timer = setInterval(() => { void this.pollNow(); }, this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = 'stopped';
  }

  async pollNow(): Promise<void> {
    if (!this.options.filePath) {
      this.state = 'unavailable';
      return;
    }
    const observedAt = this.now();
    this.lastFileObservationAtUtc = observedAt;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.options.filePath);
      this.filePresent = stat.isFile();
      if (!this.filePresent) throw new Error('The configured WSJT-X ADIF path is not a file.');
    } catch (error) {
      this.filePresent = false;
      this.state = 'waiting';
      const errorCode = error instanceof Error && 'code' in error ? error.code : undefined;
      if (errorCode === 'ENOENT' && !this.checkpoint) {
        this.checkpoint = { version: CHECKPOINT_VERSION, offset: 0, fileId: null };
        this.readOffset = 0;
        this.persistCheckpoint();
      }
      this.lastFailureStage = 'observe';
      this.lastFailureReason = errorCode === 'ENOENT' ? 'The WSJT-X ADIF log file is not present.' : 'The WSJT-X ADIF log file could not be observed.';
      return;
    }

    const fileId = `${stat.dev}:${stat.ino}`;
    if (!this.checkpoint) {
      this.partial = '';
      this.checkpoint = { version: CHECKPOINT_VERSION, offset: stat.size, fileId };
      this.readOffset = stat.size;
      this.state = 'active';
      this.persistCheckpoint();
      return;
    }
    if (this.checkpoint.fileId === null) {
      this.partial = '';
      this.checkpoint = { version: CHECKPOINT_VERSION, offset: 0, fileId };
      this.readOffset = 0;
      this.persistCheckpoint();
    } else if (this.checkpoint.fileId !== fileId || stat.size < this.checkpoint.offset || stat.size < this.readOffset) {
      this.partial = '';
      this.checkpoint = { version: CHECKPOINT_VERSION, offset: stat.size, fileId };
      this.readOffset = stat.size;
      this.state = 'active';
      this.persistCheckpoint();
      return;
    }

    this.state = 'active';
    if (stat.size === this.readOffset) return;
    const readStart = this.readOffset;
    const bytes = Buffer.alloc(stat.size - readStart);
    let read = 0;
    try {
      const handle = fs.openSync(this.options.filePath, 'r');
      try { read = fs.readSync(handle, bytes, 0, bytes.length, readStart); } finally { fs.closeSync(handle); }
    } catch (error) {
      this.recordFailure('read', error instanceof Error ? error.message : 'The WSJT-X ADIF log could not be read.');
      return;
    }
    this.readOffset = readStart + read;
    const text = Buffer.concat([Buffer.from(this.partial, 'utf8'), bytes.subarray(0, read)]).toString('utf8');
    const records = text.split(/<eor\s*(?:\/?>)?/i);
    this.partial = records.pop() ?? '';
    if (Buffer.byteLength(this.partial, 'utf8') > MAX_PARTIAL_BUFFER_BYTES) {
      this.partial = '';
      this.recordFailure('parse', 'An incomplete WSJT-X ADIF record exceeded the bounded buffer and was discarded.');
    }
    let importBlocked = false;
    for (const record of records) {
      if (!record.trim()) continue;
      this.lastCompletedRecordAtUtc = this.now();
      try {
        const parsed = parseAdif(`${record}<eor>`);
        if (parsed.errors.length || parsed.records.length !== 1) throw new Error(parsed.errors[0] || 'The WSJT-X ADIF record was not usable.');
        const candidate = toCandidate(parsed.records[0]);
        if (!candidate) throw new Error('The WSJT-X ADIF record omitted a required QSO field.');
        const result = this.options.onRecord(candidate);
        if (result === 'duplicate' || result === 'dedupe:duplicate') this.duplicatesSuppressed += 1;
        else if (result === 'activation:zero_active' || result === 'activation:multiple_active') {
          this.recordsRejected += 1;
          this.lastFailureStage = 'activation';
          this.lastFailureReason = result;
        }
        else if (result !== 'persisted') { importBlocked = true; this.recordFailure('import', result); break; }
        else { this.recordsAccepted += 1; this.lastSuccessfulImportAtUtc = this.now(); }
      } catch (error) {
        this.parseImportFailures += 1;
        this.recordFailure('import', error instanceof Error ? error.message : 'The WSJT-X ADIF record could not be imported.');
      }
    }
    if (importBlocked) { this.partial = ''; this.readOffset = this.checkpoint.offset; return; }
    this.checkpoint = { version: CHECKPOINT_VERSION, offset: this.readOffset - Buffer.byteLength(this.partial, 'utf8'), fileId };
    this.persistCheckpoint();
  }

  getDiagnostics(): WsjtxAdifFileDiagnostics {
    return { enabled: Boolean(this.options.filePath), state: this.state, resolvedPath: this.options.filePath ?? null, filePresent: this.filePresent, checkpointPath: this.options.filePath ? this.checkpointFilePath() : null, checkpointOffset: this.checkpoint?.offset ?? null, baselineEstablished: this.checkpoint !== null, lastFileObservationAtUtc: this.lastFileObservationAtUtc, lastCompletedRecordAtUtc: this.lastCompletedRecordAtUtc, recordsAccepted: this.recordsAccepted, recordsRejected: this.recordsRejected, parseImportFailures: this.parseImportFailures, duplicatesSuppressed: this.duplicatesSuppressed, lastSuccessfulImportAtUtc: this.lastSuccessfulImportAtUtc, lastFailureStage: this.lastFailureStage, lastFailureReason: this.lastFailureReason };
  }

  private now(): string { return (this.options.now ?? (() => new Date()))().toISOString(); }
  private checkpointFilePath(): string { return this.options.checkpointPath ?? `${this.options.filePath}.fieldops-checkpoint.json`; }
  private readCheckpoint(): Checkpoint | null {
    if (!this.options.filePath) return null;
    try { const value: unknown = JSON.parse(fs.readFileSync(this.checkpointFilePath(), 'utf8')); if (!isCheckpoint(value)) return null; return value; } catch { return null; }
  }
  private persistCheckpoint(): void {
    if (!this.options.filePath || !this.checkpoint) return;
    const checkpointPath = this.checkpointFilePath(); const temporaryPath = `${checkpointPath}.${process.pid}.${Date.now()}.tmp`;
    try { fs.mkdirSync(path.dirname(checkpointPath), { recursive: true }); fs.writeFileSync(temporaryPath, `${JSON.stringify(this.checkpoint)}\n`, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temporaryPath, checkpointPath); } catch (error) { this.recordFailure('checkpoint', error instanceof Error ? error.message : 'The WSJT-X ADIF checkpoint could not be persisted.'); } finally { try { fs.rmSync(temporaryPath, { force: true }); } catch {} }
  }
  private recordFailure(stage: string, reason: string): void { this.lastFailureStage = stage; this.lastFailureReason = reason; this.state = this.options.filePath ? 'failed' : 'unavailable'; }
}

function toCandidate(record: ReturnType<typeof parseAdif>['records'][number]): WsjtxLoggedQsoCandidate | null {
  const qsoDateTimeUtc = textValue(record.qsoDateTimeUtc); const callsign = textValue(record.callsign); const mode = textValue(record.mode); const frequencyMHz = typeof record.frequencyMHz === 'number' ? record.frequencyMHz : Number(record.frequencyMHz);
  if (!qsoDateTimeUtc || !callsign || !mode || !Number.isFinite(frequencyMHz)) return null;
  const optional = (value: unknown): string | undefined => { const text = textValue(value); return text || undefined; };
  return { eventType: 12, qsoDateTimeUtc, callsign: callsign.toUpperCase(), band: optional(record.band)?.toLowerCase() ?? null, frequencyMHz, mode: mode.toUpperCase(), ...(optional(record.submode) ? { submode: optional(record.submode)!.toUpperCase() } : {}), ...(optional(record.rstSent) ? { rstSent: optional(record.rstSent) } : {}), ...(optional(record.rstReceived) ? { rstReceived: optional(record.rstReceived) } : {}), ...(optional(record.gridSquare) ? { gridSquare: optional(record.gridSquare) } : {}), ...(optional(record.operatorCallsign) ? { operatorCallsign: optional(record.operatorCallsign) } : {}), ...(optional(record.stationCallsign) ? { stationCallsign: optional(record.stationCallsign) } : {}), ...(optional(record.myGridSquare) ? { myGridSquare: optional(record.myGridSquare) } : {}), source: 'wsjtx', ingestionSource: 'adif_file' };
}

function isCheckpoint(value: unknown): value is Checkpoint { return typeof value === 'object' && value !== null && (value as any).version === CHECKPOINT_VERSION && Number.isInteger((value as any).offset) && (value as any).offset >= 0 && ((value as any).fileId === null || typeof (value as any).fileId === 'string'); }
function textValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
