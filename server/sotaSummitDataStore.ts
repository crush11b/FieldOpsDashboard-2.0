import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCoordinates } from '../src/location/coordinates';
import { getProductUserAgent } from '../src/productMetadata';
import {
  LocalSotaSummitDataset,
  SOTA_SUMMIT_SOURCE_ID,
  SOTA_SUMMIT_SOURCE_NAME,
  SOTA_SUMMIT_SOURCE_TYPE,
  SOTA_SUMMIT_SOURCE_URL,
  parseSotaSummitCsv,
  type SummitRecord,
  type SotaDatasetMetadata,
  type SotaDatasetState,
} from './sotaSummitDataset';

export const SOTA_SUMMIT_DATA_FILE_NAME = 'sota-summits.json';
export const SOTA_SUMMIT_DATA_DOCUMENT_VERSION = 1 as const;
export const SOTA_SUMMIT_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
export const SOTA_SUMMIT_REFRESH_TIMEOUT_MS = 15_000;
export const SOTA_SUMMIT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

interface SotaSummitDataDocument {
  readonly documentVersion: typeof SOTA_SUMMIT_DATA_DOCUMENT_VERSION;
  readonly metadata: Pick<SotaDatasetMetadata, 'sourceVersion' | 'downloadedAtUtc'>;
  readonly records: readonly SummitRecord[];
}

export interface SotaSummitDataFileSystem {
  readonly mkdirSync: typeof fs.mkdirSync;
  readonly readFileSync: typeof fs.readFileSync;
  readonly writeFileSync: typeof fs.writeFileSync;
  readonly renameSync: typeof fs.renameSync;
  readonly rmSync: typeof fs.rmSync;
}

export interface SotaSummitDataStoreOptions {
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly fileSystem?: SotaSummitDataFileSystem;
}

export interface SotaSummitDataStatus {
  readonly state: SotaDatasetState;
  readonly metadata: SotaDatasetMetadata | null;
  readonly refreshError?: string;
}

export type SotaSummitRefreshResult =
  | { readonly status: 'refreshed'; readonly state: 'AVAILABLE'; readonly metadata: SotaDatasetMetadata; readonly recordCount: number }
  | { readonly status: 'failed'; readonly state: SotaDatasetState; readonly metadata: SotaDatasetMetadata | null; readonly message: string };

export function getDefaultSotaSummitDatasetPath(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local');
  return path.join(localAppData, 'FieldOpsDashboard', SOTA_SUMMIT_DATA_FILE_NAME);
}

export class SotaSummitDataStore {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly fileSystem: SotaSummitDataFileSystem;
  private currentDataset: LocalSotaSummitDataset;
  private refreshError: string | undefined;
  private refreshInFlight: Promise<SotaSummitRefreshResult> | null = null;

  constructor(private readonly filePath: string, options: SotaSummitDataStoreOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? SOTA_SUMMIT_REFRESH_TIMEOUT_MS;
    this.fileSystem = options.fileSystem ?? fs;
    this.currentDataset = this.loadFromDisk();
  }

  get dataset(): LocalSotaSummitDataset {
    return this.currentDataset;
  }

  get status(): SotaSummitDataStatus {
    return { state: this.currentDataset.state, metadata: this.currentDataset.metadata, ...(this.refreshError ? { refreshError: this.refreshError } : {}) };
  }

  async refresh(): Promise<SotaSummitRefreshResult> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.performRefresh();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async performRefresh(): Promise<SotaSummitRefreshResult> {
    try {
      const csv = await this.downloadCsv();
      const parsed = parseSotaSummitCsv(csv);
      if (parsed.status !== 'valid' || parsed.records.size === 0) {
        throw new Error(parsed.status === 'invalid' ? `SOTA CSV validation failed: ${parsed.issues[0]?.message ?? 'invalid dataset.'}` : 'SOTA CSV contained no summit records.');
      }
      const metadata = createMetadata(parsed.sourceVersion, this.now());
      const candidate = new LocalSotaSummitDataset(parsed.records, metadata);
      this.writeCandidate(candidate);
      this.currentDataset = candidate;
      this.refreshError = undefined;
      return { status: 'refreshed', state: 'AVAILABLE', metadata, recordCount: parsed.records.size };
    } catch (error) {
      const message = errorMessage(error);
      this.refreshError = message;
      return { status: 'failed', state: this.currentDataset.state, metadata: this.currentDataset.metadata, message };
    }
  }

  private async downloadCsv(): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(SOTA_SUMMIT_SOURCE_URL, {
        headers: { Accept: 'text/csv,text/plain', 'User-Agent': getProductUserAgent('SOTA summit CSV') },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`SOTA summit source returned HTTP ${response.status}.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error('SOTA summit source returned an empty response.');
      if (bytes.byteLength > SOTA_SUMMIT_MAX_DOWNLOAD_BYTES) throw new Error('SOTA summit source exceeded the download size limit.');
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  private loadFromDisk(): LocalSotaSummitDataset {
    let raw: string;
    try {
      raw = this.fileSystem.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return LocalSotaSummitDataset.unavailable();
      this.refreshError = 'The local SOTA dataset could not be read.';
      return LocalSotaSummitDataset.unavailable();
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const document = parseDocument(parsed);
      if (!document) throw new Error('The local SOTA dataset is corrupt.');
      return new LocalSotaSummitDataset(new Map(document.records.map(record => [record.reference, record])), createMetadata(document.metadata.sourceVersion, new Date(document.metadata.downloadedAtUtc), this.now()));
    } catch {
      this.refreshError = 'The local SOTA dataset is corrupt or unsupported.';
      return LocalSotaSummitDataset.unavailable();
    }
  }

  private writeCandidate(dataset: LocalSotaSummitDataset): void {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    this.fileSystem.mkdirSync(directory, { recursive: true });
    try {
      const document: SotaSummitDataDocument = {
        documentVersion: SOTA_SUMMIT_DATA_DOCUMENT_VERSION,
        metadata: { sourceVersion: dataset.metadata?.sourceVersion ?? null, downloadedAtUtc: dataset.metadata?.downloadedAtUtc ?? this.now().toISOString() },
        records: [...dataset.records?.values() ?? []],
      };
      this.fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(document)}\n`, { encoding: 'utf8', flag: 'wx' });
      replaceFile(this.fileSystem, temporaryPath, this.filePath);
    } finally {
      try { this.fileSystem.rmSync(temporaryPath, { force: true }); } catch { }
    }
  }
}

function createMetadata(sourceVersion: string | null, downloadedAt: Date, evaluatedAt = downloadedAt): SotaDatasetMetadata {
  const downloadedAtUtc = downloadedAt.toISOString();
  return {
    sourceVersion, downloadedAtUtc, stale: evaluatedAt.getTime() - downloadedAt.getTime() > SOTA_SUMMIT_FRESH_MS,
    sourceId: SOTA_SUMMIT_SOURCE_ID, sourceName: SOTA_SUMMIT_SOURCE_NAME, sourceUrl: SOTA_SUMMIT_SOURCE_URL,
  };
}

function parseDocument(input: unknown): SotaSummitDataDocument | null {
  if (!isRecord(input) || input.documentVersion !== SOTA_SUMMIT_DATA_DOCUMENT_VERSION || !isRecord(input.metadata) || !Array.isArray(input.records)) return null;
  const sourceVersion = input.metadata.sourceVersion === null || typeof input.metadata.sourceVersion === 'string' ? input.metadata.sourceVersion : undefined;
  if (sourceVersion === undefined || typeof input.metadata.downloadedAtUtc !== 'string' || !Number.isFinite(Date.parse(input.metadata.downloadedAtUtc))) return null;
  const records: SummitRecord[] = [];
  const references = new Set<string>();
  for (const item of input.records) {
    if (!isRecord(item) || typeof item.reference !== 'string' || !item.reference || typeof item.name !== 'string' || !item.name
      || typeof item.latitude !== 'number' || typeof item.longitude !== 'number' || !parseCoordinates(item.latitude, item.longitude)
      || (item.elevationM !== undefined && (typeof item.elevationM !== 'number' || !Number.isFinite(item.elevationM)))) return null;
    if (references.has(item.reference)) return null;
    references.add(item.reference);
    records.push(item as SummitRecord);
  }
  return records.length > 0 ? { documentVersion: SOTA_SUMMIT_DATA_DOCUMENT_VERSION, metadata: { sourceVersion, downloadedAtUtc: input.metadata.downloadedAtUtc }, records } : null;
}

function replaceFile(fileSystem: SotaSummitDataFileSystem, temporaryPath: string, targetPath: string): void {
  try {
    fileSystem.renameSync(temporaryPath, targetPath);
    return;
  } catch (error) {
    if (!isNodeError(error) || (error.code !== 'EEXIST' && error.code !== 'EPERM')) throw error;
  }
  const backupPath = `${targetPath}.${process.pid}.${Date.now()}.bak`;
  fileSystem.renameSync(targetPath, backupPath);
  try {
    fileSystem.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try { fileSystem.renameSync(backupPath, targetPath); } catch { }
    throw error;
  }
  try { fileSystem.rmSync(backupPath, { force: true }); } catch { }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'SOTA summit refresh timed out.';
  return error instanceof Error ? error.message : 'SOTA summit refresh failed.';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}