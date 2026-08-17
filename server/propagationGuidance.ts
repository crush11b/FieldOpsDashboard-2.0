import type { SpaceWeatherService, SpaceWeatherSnapshot } from './spaceWeather';
import type { ObservedRfService } from './observedRf';
import type { DashboardConfig } from '../src/types';
import type { OperatingLocation } from '../src/location/operatingLocation';
import { parseCoordinates, type Coordinates } from '../src/location/coordinates';
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
}

interface CachedModel { readonly result: RegionalP533Result; readonly storedAt: number }

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
    const config = configResult.kind === 'loaded' ? configResult.config : this.defaultConfig();
    const stationProfile = config.propagation.stationProfile;
    const spaceWeather = await this.spaceWeather.getSnapshot();
    this.observedRf.setOperatingLocation(request.operatingLocation);
    const regionalObservedRf = deriveRegionalObservedRf(this.observedRf.getSnapshot());
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
      const key = modelCacheKey(request.operatingLocation.coordinates!, region.id, stationProfile, evaluatedAtUtc, modelSsn);
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
          if (cache === 'miss') this.modelCache.set(key, { result: model, storedAt: this.now().getTime() });
        } finally {
          if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
        }
      }
    }

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
    };
  }

  private defaultConfig(): DashboardConfig {
    return normalizeDashboardConfig({});
  }
}

export class GuidanceRequestError extends Error {}

function unavailableModelSsn(): NonNullable<SpaceWeatherSnapshot['modelSsn']> {
  return { product: 'ssn', state: 'unavailable', source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } };
}

function modelCacheKey(coordinates: Coordinates, region: PropagationRegionId, profile: StationProfile, evaluatedAtUtc: string, modelSsn: SpaceWeatherSnapshot['modelSsn']): string {
  const hour = evaluatedAtUtc.slice(0, 13);
  return [Math.round(coordinates.lat * 4) / 4, Math.round(coordinates.lon * 4) / 4, region, profile.mode, profile.transmitPowerWatts, profile.antenna.type, profile.deployment.geometry, profile.deployment.heightCategory, hour, modelSsn.value, modelSsn.observedAt].join('|');
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
  const coordinates = parseCoordinates((raw.coordinates as Record<string, unknown> | undefined)?.lat, (raw.coordinates as Record<string, unknown> | undefined)?.lon);
  if (!coordinates || !['current', 'manual', 'stale'].includes(String(raw.provenance))) return null;
  return { destinationRegion: region.id, operatingLocation: { ...raw, coordinates, provenance: raw.provenance as OperatingLocation['provenance'] } as OperatingLocation };
}

export function guidanceBands(): readonly string[] { return PROPAGATION_GUIDANCE_BANDS; }
