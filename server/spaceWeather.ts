import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { PropagationSourceState } from '../src/propagation/domain';
import { getProductUserAgent } from '../src/productMetadata';

export const NOAA_SPACE_WEATHER_HOST = 'https://services.swpc.noaa.gov';
export const NOAA_DAILY_SSN_PATH = '/text/daily-solar-indices.txt';

export type SpaceWeatherProduct = 'f107' | 'ssn' | 'kp' | 'rScale' | 'xray';
export type SpaceWeatherSnapshotStatus = 'live' | 'partial' | 'cached' | 'stale' | 'unavailable';
export type ModelSsnBasis = 'observed_smoothed' | 'predicted_smoothed';

export interface SpaceWeatherEvidenceItem {
  readonly product: SpaceWeatherProduct;
  readonly evidenceType?: 'latest_goes_xray_flare_class';
  readonly state: PropagationSourceState;
  readonly value?: number | string | null;
  readonly unit?: string;
  readonly observedAt?: string;
  readonly receivedAt?: string;
  readonly source: { readonly id: string; readonly type: 'noaa-swpc'; readonly name: 'NOAA SWPC' };
  readonly error?: string;
  readonly modelInput?: {
    readonly semanticBasis: 'noaa_smoothed_monthly_ssn' | 'noaa_predicted_smoothed_monthly_ssn';
    readonly validity: 'long_lived_model_input';
    readonly basis: ModelSsnBasis;
    readonly effectiveMonth: string;
  };
}

export interface SpaceWeatherSnapshot {
  readonly kind: 'noaa_space_weather';
  readonly status: SpaceWeatherSnapshotStatus;
  readonly fetchedAt: string;
  readonly products: Readonly<Record<SpaceWeatherProduct, SpaceWeatherEvidenceItem>>;
  readonly modelSsn?: SpaceWeatherEvidenceItem;
}

interface CacheRecord {
  readonly value: number | string | null;
  readonly unit?: string;
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly modelBasis?: ModelSsnBasis;
  readonly effectiveMonth?: string;
}

type CacheFile = Partial<Record<SpaceWeatherProduct | 'modelSsn', CacheRecord>>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export const SPACE_WEATHER_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const PRODUCT_CONFIG: Readonly<Record<SpaceWeatherProduct, { path: string; maxAgeMs: number; unit?: string }>> = {
  f107: { path: '/json/f107_cm_flux.json', maxAgeMs: 72 * 60 * 60 * 1000, unit: 'sfu' },
  ssn: { path: NOAA_DAILY_SSN_PATH, maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  kp: { path: '/products/noaa-planetary-k-index.json', maxAgeMs: 12 * 60 * 60 * 1000 },
  rScale: { path: '/products/noaa-scales.json', maxAgeMs: 36 * 60 * 60 * 1000 },
  xray: { path: '/json/goes/primary/xray-flares-latest.json', maxAgeMs: 3 * 60 * 60 * 1000 },
};

const MODEL_INPUT_SOURCE_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const PREDICTED_MODEL_SSN_PATH = '/json/solar-cycle/predicted-solar-cycle.json';

const SOURCE = { id: 'noaa-swpc', type: 'noaa-swpc' as const, name: 'NOAA SWPC' as const };

export function getDefaultSpaceWeatherCachePath(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local');
  return path.join(localAppData, 'FieldOpsDashboard', 'space-weather-cache.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function observationState(observedAt: string, now: Date, maxAgeMs: number, retained: boolean): PropagationSourceState {
  const ageMs = now.getTime() - Date.parse(observedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) return 'stale';
  return retained ? 'cached' : 'live';
}

function newest<T>(items: T[], getTimestamp: (item: T) => string | null): T | null {
  return items.reduce<T | null>((best, item) => {
    const current = getTimestamp(item);
    if (!current) return best;
    return !best || current > (getTimestamp(best) ?? '') ? item : best;
  }, null);
}

export function parseF107(payload: unknown): CacheRecord | null {
  if (!Array.isArray(payload)) return null;
  const item = newest(payload.filter(isRecord), row => timestamp(row.time_tag));
  const observedAt = item && timestamp(item.time_tag);
  const value = item && finite(item.flux);
  return observedAt && value !== null ? { value, unit: 'sfu', observedAt, receivedAt: '' } : null;
}

export function parseSsn(payload: unknown): CacheRecord | null {
  if (typeof payload !== 'string') return null;
  let latest: CacheRecord | null = null;
  for (const line of payload.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5) continue;
    const [year, month, day] = fields.slice(0, 3).map(Number);
    const value = Number(fields[4]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
      || !Number.isFinite(value) || value < 0 || value > 1000) continue;
    const observedAt = timestamp(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`);
    const parsedDate = observedAt ? new Date(observedAt) : null;
    if (!parsedDate || parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() + 1 !== month || parsedDate.getUTCDate() !== day) continue;
    if (!latest || observedAt > latest.observedAt) latest = { value, observedAt, receivedAt: '' };
  }
  return latest;
}

export function parseModelSsn(payload: unknown, targetDate?: Date): CacheRecord | null {
  if (!Array.isArray(payload)) return null;
  const valid = payload.filter((row): row is Record<string, unknown> => isRecord(row) && modelSsnValue(row) !== null);
  const targetMonth = targetDate ? monthTag(targetDate) : null;
  const item = targetMonth
    ? valid.find(row => row['time-tag'] === targetMonth) ?? null
    : newest(valid, row => timestamp(`${String(row['time-tag'] ?? '')}-01`));
  const effectiveMonth = item && typeof item['time-tag'] === 'string' ? item['time-tag'] : null;
  const observedAt = effectiveMonth && timestamp(`${effectiveMonth}-01`);
  const value = item && modelSsnValue(item);
  return observedAt && effectiveMonth && value !== null && value >= 0 && value <= 400
    ? { value, observedAt, receivedAt: '', modelBasis: 'observed_smoothed', effectiveMonth }
    : null;
}

export function parsePredictedModelSsn(payload: unknown, targetDate: Date): CacheRecord | null {
  if (!Array.isArray(payload)) return null;
  const effectiveMonth = monthTag(targetDate);
  const item = payload.find((row): row is Record<string, unknown> => isRecord(row) && row['time-tag'] === effectiveMonth);
  const value = item ? finite(item.predicted_ssn) : null;
  const observedAt = timestamp(`${effectiveMonth}-01`);
  return observedAt && value !== null && value >= 0 && value <= 400
    ? { value, observedAt, receivedAt: '', modelBasis: 'predicted_smoothed', effectiveMonth }
    : null;
}

function monthTag(date: Date): string {
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : '';
}

function modelSsnValue(row: Record<string, unknown>): number | null {
  const smoothedSsn = finite(row.smoothed_ssn);
  if (smoothedSsn !== null && smoothedSsn >= 0) return smoothedSsn;
  const smoothedSwpcSsn = finite(row.smoothed_swpc_ssn);
  return smoothedSwpcSsn !== null && smoothedSwpcSsn >= 0 ? smoothedSwpcSsn : null;
}

export function parseKp(payload: unknown): CacheRecord | null {
  if (!Array.isArray(payload)) return null;
  const item = newest(payload.filter(isRecord), row => timestamp(row.time_tag));
  const observedAt = item && timestamp(item.time_tag);
  const value = item && finite(item.Kp);
  return observedAt && value !== null && value >= 0 && value <= 9 ? { value, observedAt, receivedAt: '' } : null;
}

export function parseRScale(payload: unknown): CacheRecord | null {
  if (!isRecord(payload)) return null;
  const item = payload['0'];
  if (!isRecord(item) || !isRecord(item.R)) return null;
  const observedAt = timestamp(`${String(item.DateStamp ?? '')}T${String(item.TimeStamp ?? '')}`);
  const scale = item.R.Scale === null ? null : Number(item.R.Scale);
  return observedAt && (scale === null || (Number.isInteger(scale) && scale >= 0 && scale <= 5))
    ? { value: scale, observedAt, receivedAt: '' }
    : null;
}

export function parseXray(payload: unknown): CacheRecord | null {
  if (!Array.isArray(payload)) return null;
  const item = newest(payload.filter(isRecord), row => timestamp(row.time_tag));
  const observedAt = item && timestamp(item.time_tag);
  const value = item && typeof item.current_class === 'string' ? item.current_class : null;
  return observedAt && value ? { value, observedAt, receivedAt: '' } : null;
}

function readCache(filePath: string): CacheFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isRecord(parsed) ? parsed as CacheFile : {};
  } catch {
    return {};
  }
}

function isCacheRecord(value: unknown): value is CacheRecord {
  if (!isRecord(value)
    || !(typeof value.value === 'string' || value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value)))
    || typeof value.observedAt !== 'string'
    || timestamp(value.observedAt) === null
    || typeof value.receivedAt !== 'string'
    || timestamp(value.receivedAt) === null) return false;
  const hasModelBasis = value.modelBasis !== undefined;
  const hasEffectiveMonth = value.effectiveMonth !== undefined;
  if (hasModelBasis !== hasEffectiveMonth) return false;
  if (!hasModelBasis) return true;
  return (value.modelBasis === 'observed_smoothed' || value.modelBasis === 'predicted_smoothed')
    && typeof value.effectiveMonth === 'string'
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.effectiveMonth)
    && value.observedAt.slice(0, 7) === value.effectiveMonth;
}

function writeCache(filePath: string, cache: CacheFile): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
  }
}

function itemFromRecord(product: SpaceWeatherProduct | 'modelSsn', record: CacheRecord, state: PropagationSourceState): SpaceWeatherEvidenceItem {
  return {
    product: product === 'modelSsn' ? 'ssn' : product,
    ...(product === 'xray' ? { evidenceType: 'latest_goes_xray_flare_class' as const } : {}),
    state,
    value: record.value,
    unit: record.unit ?? (product === 'modelSsn' ? undefined : PRODUCT_CONFIG[product].unit),
    observedAt: record.observedAt,
    receivedAt: record.receivedAt,
    source: SOURCE,
  };
}

function modelSsnItemFromRecord(record: CacheRecord, state: PropagationSourceState): SpaceWeatherEvidenceItem {
  const basis = record.modelBasis ?? 'observed_smoothed';
  const effectiveMonth = record.effectiveMonth ?? record.observedAt.slice(0, 7);
  return {
    ...itemFromRecord('modelSsn', record, state),
    evidenceType: undefined,
    modelInput: {
      semanticBasis: basis === 'predicted_smoothed' ? 'noaa_predicted_smoothed_monthly_ssn' : 'noaa_smoothed_monthly_ssn',
      validity: 'long_lived_model_input',
      basis,
      effectiveMonth,
    },
  };
}

function retainedModelState(record: CacheRecord, now: Date): PropagationSourceState {
  return observationState(record.receivedAt, now, MODEL_INPUT_SOURCE_MAX_AGE_MS, true);
}

function snapshotStatus(products: Readonly<Record<SpaceWeatherProduct, SpaceWeatherEvidenceItem>>): SpaceWeatherSnapshotStatus {
  const states = Object.values(products).map(product => product.state);
  if (states.every(state => state === 'live')) return 'live';
  if (states.every(state => state === 'unavailable')) return 'unavailable';
  if (states.every(state => state === 'stale')) return 'stale';
  if (states.every(state => state === 'cached' || state === 'stale')) return 'cached';
  return 'partial';
}

export async function getSpaceWeatherSnapshot(options: {
  cachePath?: string;
  fetcher?: Fetcher;
  now?: () => Date;
  timeoutMs?: number;
  modelDate?: Date;
} = {}): Promise<SpaceWeatherSnapshot> {
  const cachePath = options.cachePath ?? getDefaultSpaceWeatherCachePath();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const receivedAt = now().toISOString();
  const cache = readCache(cachePath);
  const products = {} as Record<SpaceWeatherProduct, SpaceWeatherEvidenceItem>;
  let modelSsn: SpaceWeatherEvidenceItem;
  const parsers: Readonly<Record<SpaceWeatherProduct, (payload: unknown) => CacheRecord | null>> = { f107: parseF107, ssn: parseSsn, kp: parseKp, rScale: parseRScale, xray: parseXray };

  await Promise.all((Object.keys(PRODUCT_CONFIG) as SpaceWeatherProduct[]).map(async product => {
    const config = PRODUCT_CONFIG[product];
    let live: CacheRecord | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
      let response: Response;
      try {
        const isText = product === 'ssn';
        response = await fetcher(`${NOAA_SPACE_WEATHER_HOST}${config.path}`, {
          headers: { Accept: isText ? 'text/plain' : 'application/json', 'User-Agent': getProductUserAgent('NOAA SWPC') },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      live = parsers[product](product === 'ssn' ? await response.text() : await response.json());
      if (!live) throw new Error('NOAA payload did not contain a valid observation');
      live = { ...live, receivedAt };
      cache[product] = live;
      products[product] = itemFromRecord(product, live, observationState(live.observedAt, now(), config.maxAgeMs, false));
    } catch (error) {
      const retained = isCacheRecord(cache[product]) ? cache[product] : null;
      if (retained && timestamp(retained.observedAt)) {
        const state = observationState(retained.observedAt, now(), config.maxAgeMs, true);
        products[product] = itemFromRecord(product, retained, state);
      } else {
        products[product] = { product, state: 'unavailable', source: SOURCE, error: error instanceof Error ? error.message : 'NOAA source unavailable' };
      }
    }
  }));

  const modelDate = options.modelDate ?? now();
  const requestedModelMonth = monthTag(modelDate);
  try {
    const fetchJson = async (sourcePath: string): Promise<unknown> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
      try {
        const response = await fetcher(`${NOAA_SPACE_WEATHER_HOST}${sourcePath}`, {
          headers: { Accept: 'application/json', 'User-Agent': getProductUserAgent('NOAA SWPC') },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      } finally {
        clearTimeout(timeout);
      }
    };

    const observedPayload = await fetchJson('/json/solar-cycle/observed-solar-cycle-indices.json');
    let record = parseModelSsn(observedPayload, modelDate);
    if (!record) {
      record = parsePredictedModelSsn(await fetchJson(PREDICTED_MODEL_SSN_PATH), modelDate);
    }
    if (!record) throw new Error(`NOAA payloads did not contain a model SSN for ${requestedModelMonth}`);
    record = { ...record, receivedAt };
    cache.modelSsn = record;
    modelSsn = modelSsnItemFromRecord(record, 'live');
  } catch (error) {
    const retained = isCacheRecord(cache.modelSsn)
      && (cache.modelSsn.effectiveMonth ?? cache.modelSsn.observedAt.slice(0, 7)) === requestedModelMonth
      ? cache.modelSsn
      : null;
    modelSsn = retained
      ? modelSsnItemFromRecord(retained, retainedModelState(retained, now()))
      : { product: 'ssn', state: 'unavailable', source: SOURCE, error: error instanceof Error ? error.message : 'NOAA model input unavailable' };
  }

  writeCache(cachePath, cache);
  return { kind: 'noaa_space_weather', status: snapshotStatus(products), fetchedAt: receivedAt, products, modelSsn };
}

export class SpaceWeatherService {
  private snapshot: SpaceWeatherSnapshot | null = null;
  private snapshotModelMonth: string | null = null;
  private refreshPromise: Promise<SpaceWeatherSnapshot> | null = null;
  private refreshModelMonth: string | null = null;
  private lastRefreshAt = 0;

  constructor(private readonly options: Parameters<typeof getSpaceWeatherSnapshot>[0] = {}, private readonly refreshIntervalMs = SPACE_WEATHER_REFRESH_INTERVAL_MS) {}

  async getSnapshot(forceRefresh = false, modelDate?: Date): Promise<SpaceWeatherSnapshot> {
    const clock = this.options.now ?? (() => new Date());
    const requestedDate = modelDate ?? clock();
    const requestedMonth = monthTag(requestedDate);
    const now = clock().getTime();
    if (this.snapshot && this.snapshotModelMonth === requestedMonth && !forceRefresh && now - this.lastRefreshAt < this.refreshIntervalMs) return this.snapshot;
    if (this.refreshPromise && this.refreshModelMonth !== requestedMonth) {
      await this.refreshPromise;
      return this.getSnapshot(forceRefresh, requestedDate);
    }
    if (!this.refreshPromise) {
      this.refreshModelMonth = requestedMonth;
      this.refreshPromise = getSpaceWeatherSnapshot({ ...this.options, modelDate: requestedDate }).then(snapshot => {
        this.snapshot = snapshot;
        this.snapshotModelMonth = requestedMonth;
        this.lastRefreshAt = clock().getTime();
        return snapshot;
      }).finally(() => {
        this.refreshPromise = null;
        this.refreshModelMonth = null;
      });
    }
    return this.refreshPromise;
  }
}
