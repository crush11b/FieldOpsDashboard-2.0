import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { PropagationSourceState } from '../src/propagation/domain';
import { getProductUserAgent } from '../src/productMetadata';

export const NOAA_SPACE_WEATHER_HOST = 'https://services.swpc.noaa.gov';

export type SpaceWeatherProduct = 'f107' | 'ssn' | 'kp' | 'rScale' | 'xray';
export type SpaceWeatherSnapshotStatus = 'live' | 'partial' | 'cached' | 'stale' | 'unavailable';

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
}

export interface SpaceWeatherSnapshot {
  readonly kind: 'noaa_space_weather';
  readonly status: SpaceWeatherSnapshotStatus;
  readonly fetchedAt: string;
  readonly products: Readonly<Record<SpaceWeatherProduct, SpaceWeatherEvidenceItem>>;
}

interface CacheRecord {
  readonly value: number | string | null;
  readonly unit?: string;
  readonly observedAt: string;
  readonly receivedAt: string;
}

type CacheFile = Partial<Record<SpaceWeatherProduct, CacheRecord>>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export const SPACE_WEATHER_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const PRODUCT_CONFIG: Readonly<Record<SpaceWeatherProduct, { path: string; maxAgeMs: number; unit?: string }>> = {
  f107: { path: '/json/f107_cm_flux.json', maxAgeMs: 72 * 60 * 60 * 1000, unit: 'sfu' },
  ssn: { path: '/json/solar-cycle/observed-solar-cycle-indices.json', maxAgeMs: 45 * 24 * 60 * 60 * 1000 },
  kp: { path: '/products/noaa-planetary-k-index.json', maxAgeMs: 12 * 60 * 60 * 1000 },
  rScale: { path: '/products/noaa-scales.json', maxAgeMs: 36 * 60 * 60 * 1000 },
  xray: { path: '/json/goes/primary/xray-flares-latest.json', maxAgeMs: 3 * 60 * 60 * 1000 },
};

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
  if (!Array.isArray(payload)) return null;
  const item = newest(payload.filter(isRecord), row => timestamp(`${String(row['time-tag'] ?? '')}-01`));
  const observedAt = item && timestamp(`${String(item['time-tag'] ?? '')}-01`);
  const value = item && finite(item.observed_swpc_ssn ?? item.ssn);
  return observedAt && value !== null && value >= 0 ? { value, observedAt, receivedAt: '' } : null;
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
  return isRecord(value)
    && (typeof value.value === 'string' || value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value)))
    && timestamp(value.observedAt) !== null
    && timestamp(value.receivedAt) !== null;
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

function itemFromRecord(product: SpaceWeatherProduct, record: CacheRecord, state: PropagationSourceState): SpaceWeatherEvidenceItem {
  return {
    product,
    ...(product === 'xray' ? { evidenceType: 'latest_goes_xray_flare_class' as const } : {}),
    state,
    value: record.value,
    unit: record.unit ?? PRODUCT_CONFIG[product].unit,
    observedAt: record.observedAt,
    receivedAt: record.receivedAt,
    source: SOURCE,
  };
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
} = {}): Promise<SpaceWeatherSnapshot> {
  const cachePath = options.cachePath ?? getDefaultSpaceWeatherCachePath();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const receivedAt = now().toISOString();
  const cache = readCache(cachePath);
  const products = {} as Record<SpaceWeatherProduct, SpaceWeatherEvidenceItem>;
  const parsers: Readonly<Record<SpaceWeatherProduct, (payload: unknown) => CacheRecord | null>> = { f107: parseF107, ssn: parseSsn, kp: parseKp, rScale: parseRScale, xray: parseXray };

  await Promise.all((Object.keys(PRODUCT_CONFIG) as SpaceWeatherProduct[]).map(async product => {
    const config = PRODUCT_CONFIG[product];
    let live: CacheRecord | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
      let response: Response;
      try {
        response = await fetcher(`${NOAA_SPACE_WEATHER_HOST}${config.path}`, {
          headers: { Accept: 'application/json', 'User-Agent': getProductUserAgent('NOAA SWPC') },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      live = parsers[product](await response.json());
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

  writeCache(cachePath, cache);
  return { kind: 'noaa_space_weather', status: snapshotStatus(products), fetchedAt: receivedAt, products };
}

export class SpaceWeatherService {
  private snapshot: SpaceWeatherSnapshot | null = null;
  private refreshPromise: Promise<SpaceWeatherSnapshot> | null = null;
  private lastRefreshAt = 0;

  constructor(private readonly options: Parameters<typeof getSpaceWeatherSnapshot>[0] = {}, private readonly refreshIntervalMs = SPACE_WEATHER_REFRESH_INTERVAL_MS) {}

  async getSnapshot(forceRefresh = false): Promise<SpaceWeatherSnapshot> {
    const now = (this.options.now ?? (() => new Date()))().getTime();
    if (this.snapshot && !forceRefresh && now - this.lastRefreshAt < this.refreshIntervalMs) return this.snapshot;
    if (!this.refreshPromise) {
      this.refreshPromise = getSpaceWeatherSnapshot(this.options).then(snapshot => {
        this.snapshot = snapshot;
        this.lastRefreshAt = (this.options.now ?? (() => new Date()))().getTime();
        return snapshot;
      }).finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }
}
