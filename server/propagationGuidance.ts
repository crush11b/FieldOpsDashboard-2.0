import type { SpaceWeatherService, SpaceWeatherSnapshot } from './spaceWeather';
import type { ObservedRfService } from './observedRf';
import type { DashboardConfig } from '../src/types';
import type { OperatingLocation } from '../src/location/operatingLocation';
import { parseCoordinates, type Coordinates } from '../src/location/coordinates';
import { latLonToGridSquare } from '../src/types';
import { deriveRegionalObservedRf } from '../src/propagation/regionalObservedRf';
import { evaluateRegionalBandAssessments, PROPAGATION_RATING_POLICY_VERSION, type PropagationBandAssessment } from '../src/propagation/ratingEvaluator';
import { PROPAGATION_GUIDANCE_BANDS, type StationProfile } from '../src/propagation/domain';
import { getPropagationRegion, resolveRegionalDestination, type PropagationRegionId } from '../src/propagation/regionalDestinations';
import { executeRegionalP533 } from './regionalP533';
import { getRegionalP533Assumptions } from '../src/propagation/regionalP533';
import type { RegionalP533Result } from '../src/propagation/regionalP533';
import { DashboardConfigStore, normalizeDashboardConfig } from './dashboardConfig';

export interface PropagationGuidanceRequest {
  readonly destinationRegion: string;
  readonly operatingLocation: OperatingLocation;
}

export interface PropagationGuidanceResponse {
  readonly kind: 'propagation_guidance';
  readonly status: 'complete' | 'partial' | 'unavailable';
  readonly evaluatedAtUtc: string;
  readonly destinationRegion: PropagationRegionId;
  readonly operatingLocation: OperatingLocation;
  readonly stationProfile: StationProfile;
  readonly assessments: readonly PropagationBandAssessment[];
  readonly spaceWeather: SpaceWeatherSnapshot;
  readonly model: {
    readonly status: RegionalP533Result['status'] | 'not_attempted';
    readonly cache: 'hit' | 'miss' | 'shared' | 'not_applicable';
    readonly ssn: SpaceWeatherSnapshot['modelSsn'];
    readonly provenance: RegionalP533Result['provenance'] | null;
    readonly sampleCount: number;
    readonly executionCount: number;
    readonly elapsedMs: number;
    readonly reason?: string;
  };
  readonly ratingPolicyVersion: typeof PROPAGATION_RATING_POLICY_VERSION;
  readonly sourceErrors: readonly string[];
  readonly modelBandSummaries: readonly {
    readonly band: string;
    readonly medianBcrPercent: number | null;
    readonly minimumBcrPercent: number | null;
    readonly maximumBcrPercent: number | null;
    readonly successfulSampleCount: number;
    readonly sampleCount: number;
  }[];
  readonly observedBandSummaries: readonly {
    readonly band: string;
    readonly sourceState: 'live' | 'cached' | 'stale' | 'unavailable';
    readonly reportCount: number;
    readonly uniquePathCount: number;
    readonly uniqueRemoteCallsignCount: number;
    readonly modeCounts: Readonly<Record<string, number>>;
    readonly newestReportAt: string | null;
  }[];
}

interface CachedModel { readonly result: RegionalP533Result; readonly storedAt: number }

export const PROPAGATION_GUIDANCE_MODEL_CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
export const PROPAGATION_GUIDANCE_MODEL_CACHE_MAX_ENTRIES = 24;

export class PropagationGuidanceService {
  private readonly modelCache = new Map<string, CachedModel>();
  private readonly inFlight = new Map<string, Promise<RegionalP533Result>>();

  constructor(
    private readonly spaceWeather: SpaceWeatherService,
    private readonly observedRf: ObservedRfService,
    private readonly configStore: DashboardConfigStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async evaluateGuidance(request: PropagationGuidanceRequest): Promise<PropagationGuidanceResponse> {
    const evaluatedAtUtc = this.now().toISOString();
    const region = resolveRegionalDestination(request.destinationRegion);
    const configResult = this.configStore.read();
    if (configResult.kind === 'invalid') throw new GuidanceServiceError('Persisted dashboard configuration is unavailable.');
    const config = configResult.kind === 'loaded' ? configResult.config : this.defaultConfig();
    const stationProfile = config.propagation.stationProfile;
    const spaceWeather = await this.spaceWeather.getSnapshot();
    this.observedRf.setOperatingLocation(request.operatingLocation);
    const modelSsn = spaceWeather.modelSsn ?? unavailableModelSsn();
    const modelAvailable = typeof modelSsn.value === 'number' && Number.isFinite(modelSsn.value) && modelSsn.state !== 'unavailable';

    let model: RegionalP533Result;
    let cache: PropagationGuidanceResponse['model']['cache'] = 'miss';
    if (!region) {
      throw new GuidanceRequestError('Unknown propagation destination region.');
    }
    if (region.kind === 'local_nvis') {
      model = unavailableModel(request.operatingLocation, stationProfile, request.destinationRegion as PropagationRegionId, 'Local / NVIS P.533 is deferred.');
      cache = 'not_applicable';
    } else if (!modelAvailable) {
      model = unavailableModel(request.operatingLocation, stationProfile, region.id, 'P.533 model SSN is unavailable; no model result was attempted.');
    } else {
      const key = propagationGuidanceModelCacheKey(request.operatingLocation.coordinates!, region.id, stationProfile, evaluatedAtUtc, modelSsn);
      this.pruneModelCache(this.now().getTime());
      const cached = this.modelCache.get(key);
      if (cached) {
        model = cached.result;
        cache = 'hit';
      } else {
        let pending = this.inFlight.get(key);
        if (pending) cache = 'shared';
        if (!pending) {
          pending = executeRegionalP533({ operatingLocation: request.operatingLocation, regionId: region.id, stationProfile, modelDateTimeUtc: evaluatedAtUtc, ssn: modelSsn.value as number });
          this.inFlight.set(key, pending);
        }
        try {
          model = await pending;
          if (cache === 'miss') {
            this.modelCache.set(key, { result: model, storedAt: this.now().getTime() });
            this.pruneModelCache(this.now().getTime());
          }
        } finally {
          if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
        }
      }
    }

    const regionalObservedRf = deriveRegionalObservedRf(this.observedRf.getSnapshot());
    const assessments = evaluateRegionalBandAssessments({
      destinationRegion: region.id,
      selectedTimeUtc: evaluatedAtUtc,
      nowUtc: evaluatedAtUtc,
      regionalP533: model,
      spaceWeather,
      regionalObservedRf,
      stationProfile,
    });
    const sourceErrors = [
      ...Object.values(spaceWeather.products).filter(item => item.error).map(item => `NOAA ${item.product}: ${item.error}`),
      ...(spaceWeather.modelSsn?.error ? [`NOAA model SSN: ${spaceWeather.modelSsn.error}`] : []),
      ...(model.reason ? [model.reason] : []),
    ];
    return {
      kind: 'propagation_guidance',
      status: assessments.some(item => item.rating !== 'UNAVAILABLE') ? model.status === 'complete' ? 'complete' : 'partial' : 'unavailable',
      evaluatedAtUtc,
      destinationRegion: region.id,
      operatingLocation: request.operatingLocation,
      stationProfile,
      assessments,
      spaceWeather,
      model: { status: model.status, cache, ssn: modelSsn, provenance: model.status === 'not_applicable' || model.status === 'unavailable' ? null : model.provenance, sampleCount: model.sampleCount, executionCount: model.executionCount, elapsedMs: model.elapsedMs, ...(model.reason ? { reason: model.reason } : {}) },
      ratingPolicyVersion: PROPAGATION_RATING_POLICY_VERSION,
      sourceErrors,
      modelBandSummaries: model.bandResults.map(item => ({
        band: item.band,
        medianBcrPercent: item.summary.basicCircuitReliabilityPercent.median,
        minimumBcrPercent: item.summary.basicCircuitReliabilityPercent.minimum,
        maximumBcrPercent: item.summary.basicCircuitReliabilityPercent.maximum,
        successfulSampleCount: item.summary.successfulSampleCount,
        sampleCount: item.summary.sampleCount,
      })),
      observedBandSummaries: regionalObservedRf.regionBandSummaries.map(item => ({
        band: item.band,
        sourceState: regionalObservedRf.sourceStatus === 'live' || regionalObservedRf.sourceStatus === 'cached' || regionalObservedRf.sourceStatus === 'stale'
          ? regionalObservedRf.sourceStatus
          : 'unavailable',
        reportCount: item.reportCount,
        uniquePathCount: item.uniquePathCount,
        uniqueRemoteCallsignCount: item.uniqueRemoteCallsignCount,
        modeCounts: item.modeCounts,
        newestReportAt: item.newestReportAt,
      })),
    };
  }

  private defaultConfig(): DashboardConfig {
    return normalizeDashboardConfig({});
  }

  private pruneModelCache(nowMs: number): void {
    for (const [key, entry] of this.modelCache) {
      if (nowMs - entry.storedAt > PROPAGATION_GUIDANCE_MODEL_CACHE_MAX_AGE_MS) this.modelCache.delete(key);
    }
    while (this.modelCache.size > PROPAGATION_GUIDANCE_MODEL_CACHE_MAX_ENTRIES) {
      const oldestKey = this.modelCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.modelCache.delete(oldestKey);
    }
  }
}

export class GuidanceRequestError extends Error {}

export class GuidanceServiceError extends Error {}

function unavailableModelSsn(): NonNullable<SpaceWeatherSnapshot['modelSsn']> {
  return { product: 'ssn', state: 'unavailable', source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } };
}

export function propagationGuidanceModelCacheKey(coordinates: Coordinates, region: PropagationRegionId, profile: StationProfile, evaluatedAtUtc: string, modelSsn: NonNullable<SpaceWeatherSnapshot['modelSsn']>): string {
  const hour = evaluatedAtUtc.slice(0, 13);
  const originGrid6 = latLonToGridSquare(coordinates.lat, coordinates.lon).slice(0, 6);
  return [originGrid6, region, profile.mode, profile.transmitPowerWatts, profile.antenna.type, profile.deployment.geometry, profile.deployment.heightCategory, hour, modelSsn.value, modelSsn.observedAt].join('|');
}

function unavailableModel(location: OperatingLocation, stationProfile: StationProfile, regionId: PropagationRegionId, reason: string): RegionalP533Result {
  return {
    status: regionId === 'local_nvis' ? 'not_applicable' : 'unavailable', regionId, regionLabel: getPropagationRegion(regionId)?.label ?? regionId,
    operatingLocation: location, stationProfile, assumptions: getRegionalP533Assumptions(),
    modeledAtUtc: new Date().toISOString(), ssn: Number.NaN, unsupportedBands: ['6m'], provenance: { sourceState: 'modeled', model: 'ITU-R P.533', recommendation: 'P.533-14', engine: 'ITU-R-HF v14.3', assetProvenance: null }, bandResults: [], reason, sampleCount: 0, executionCount: 0, elapsedMs: 0,
  };
}

export function parseGuidanceRequest(body: unknown): PropagationGuidanceRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const region = typeof value.destinationRegion === 'string' ? resolveRegionalDestination(value.destinationRegion) : null;
  const location = value.operatingLocation;
  if (!region || !location || typeof location !== 'object' || Array.isArray(location)) return null;
  const raw = location as Record<string, unknown>;
  const coordinatesValue = raw.coordinates;
  if (!coordinatesValue || typeof coordinatesValue !== 'object' || Array.isArray(coordinatesValue)) return null;
  const coordinates = parseCoordinates((coordinatesValue as Record<string, unknown>).lat, (coordinatesValue as Record<string, unknown>).lon);
  const provenance = raw.provenance;
  const status = raw.status;
  const source = raw.source;
  if (!coordinates || !isCoordinateProvenance(provenance) || !isTelemetryStatus(status) || !isValidLocationSource(source, provenance, status)) return null;
  const timestamps = raw.timestamps;
  if (timestamps !== undefined && !isValidLocationTimestamps(timestamps)) return null;
  const validTimestamps = timestamps as NonNullable<OperatingLocation['timestamps']> | undefined;
  const gridSquare = latLonToGridSquare(coordinates.lat, coordinates.lon);
  if (!/^[A-R]{2}\d{2}[a-x]{2}$/.test(gridSquare)) return null;
  return {
    destinationRegion: region.id,
    operatingLocation: {
      coordinates,
      gridSquare,
      provenance,
      status,
      source,
      ...(validTimestamps === undefined ? {} : { timestamps: validTimestamps }),
    },
  };
}

function isCoordinateProvenance(value: unknown): value is OperatingLocation['provenance'] {
  return value === 'current' || value === 'manual' || value === 'stale';
}

function isTelemetryStatus(value: unknown): value is OperatingLocation['status'] {
  return value === 'ok' || value === 'degraded' || value === 'stale' || value === 'cached';
}

function isValidLocationSource(value: unknown, provenance: OperatingLocation['provenance'], status: OperatingLocation['status']): value is OperatingLocation['source'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || source.id.trim() === '' || typeof source.type !== 'string' || source.type.trim() === '') return false;
  const currentTypes = ['browser_geolocation', 'serial_nmea', 'local_telemetry_agent'];
  const manualTypes = ['manual_location', 'preset_location', 'configured_station_location'];
  const staleTypes = ['cached_local_storage', ...currentTypes];
  if (provenance === 'current') return status === 'ok' && currentTypes.includes(source.type);
  if (provenance === 'manual') return status === 'degraded' && manualTypes.includes(source.type);
  return (status === 'stale' || status === 'cached') && staleTypes.includes(source.type);
}

function isValidLocationTimestamps(value: unknown): value is NonNullable<OperatingLocation['timestamps']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const timestamps = value as Record<string, unknown>;
  return isIsoTimestamp(timestamps.observedAt) && isIsoTimestamp(timestamps.receivedAt)
    && (timestamps.expiresAt === undefined || isIsoTimestamp(timestamps.expiresAt));
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function guidanceBands(): readonly string[] { return PROPAGATION_GUIDANCE_BANDS; }
