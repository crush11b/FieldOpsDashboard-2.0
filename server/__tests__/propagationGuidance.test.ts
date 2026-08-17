import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardConfigStore, normalizeDashboardConfig } from '../dashboardConfig';
import { parseGuidanceRequest, propagationGuidanceModelCacheKey, PropagationGuidanceService } from '../propagationGuidance';
import { latLonToGridSquare } from '../../src/types';
import { parsePskPayload } from '../../src/propagation/observedRf';

vi.mock('../regionalP533', () => ({ executeRegionalP533: vi.fn() }));
import { executeRegionalP533 } from '../regionalP533';

const location = {
  coordinates: { lat: 37.54, lon: -77.43 },
  gridSquare: 'FM17',
  provenance: 'manual' as const,
  status: 'degraded' as const,
  source: { id: 'test-location', type: 'manual_location' as const },
};

const product = (productName: string, value: number | string, state = 'live') => ({ product: productName, value, state, observedAt: '2026-08-17T03:00:00.000Z', receivedAt: '2026-08-17T03:00:00.000Z', source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } });
const weather = {
  kind: 'noaa_space_weather' as const,
  status: 'live' as const,
  fetchedAt: '2026-08-17T03:00:00.000Z',
  products: { f107: product('f107', 130), ssn: product('ssn', 106), kp: product('kp', 2), rScale: product('rScale', 0), xray: product('xray', 'C1.0') },
  modelSsn: { ...product('ssn', 109), modelInput: { semanticBasis: 'noaa_smoothed_monthly_ssn' as const, validity: 'long_lived_model_input' as const } },
};

const profile = { mode: 'SSB' as const, transmitPowerWatts: 10, antenna: { type: 'EFHW' as const }, deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const } };
const currentLocation = { coordinates: { lat: 37.54, lon: -77.43 }, gridSquare: null, provenance: 'current' as const, status: 'ok' as const, source: { id: 'gps:test', type: 'browser_geolocation' } };
const observedRf = { setOperatingLocation: vi.fn(), getSnapshot: () => ({ kind: 'observed_rf', status: 'unavailable', operatingGrid4: null, observationWindow: { startsAt: '2026-08-17T02:45:00.000Z', endsAt: '2026-08-17T03:00:00.000Z' }, collectedAtUtc: '2026-08-17T03:00:00.000Z', reports: [], bandSummaries: [], provenance: { sourceId: 'test', sourceName: 'test', transport: 'mqtts-websocket', brokerHost: 'test', brokerPort: 1886, topicPatterns: [] } }) };
const config = (stationProfile = profile) => ({ read: () => ({ kind: 'loaded' as const, config: { propagation: { stationProfile } } }) }) as unknown as DashboardConfigStore;

function modelResult(request: any) {
  const bandResults = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'].map(band => ({ band, modelFrequencyMHz: 14, samples: [], summary: { sampleCount: 1, successfulSampleCount: 1, failedSampleCount: 0, basicCircuitReliabilityPercent: { minimum: 60, maximum: 60, median: 60 }, snrDb: { minimum: 10, maximum: 10, median: 10 }, receivedPowerDb: { minimum: -90, maximum: -90, median: -90 }, basicMufMHz: { minimum: 15, maximum: 15, median: 15 }, sampleFailures: [] } }));
  return { status: 'complete', regionId: request.regionId, regionLabel: request.regionId, operatingLocation: request.operatingLocation, stationProfile: request.stationProfile, assumptions: { antennaModel: 'ISOTROPIC', antennaGainOffsetDb: 0, bandwidthHz: 3000, requiredSnrDb: 15, requiredReliabilityPercent: 90, noiseEnvironment: 'RESIDENTIAL', modulation: 'ANALOG', pathDirection: 'SHORTPATH', modeInterpretation: 'test', antennaInterpretation: 'test' }, modeledAtUtc: request.modelDateTimeUtc, ssn: request.ssn, unsupportedBands: ['6m'], provenance: { sourceState: 'modeled', model: 'ITU-R P.533', recommendation: 'P.533-14', engine: 'ITU-R-HF v14.3', assetProvenance: null }, bandResults, sampleCount: 1, executionCount: 10, elapsedMs: 3 };
}

function createService(options: { stationProfile?: typeof profile; snapshot?: any; observedSnapshot?: any; clock?: string; configStore?: DashboardConfigStore } = {}) {
  return new PropagationGuidanceService(
    { getSnapshot: async () => options.snapshot ?? weather } as any,
    options.observedSnapshot ? { setOperatingLocation: vi.fn(), getSnapshot: () => options.observedSnapshot } as any : observedRf as any,
    options.configStore ?? config(options.stationProfile),
    () => new Date(options.clock ?? '2026-08-17T03:00:00.000Z'),
  );
}

beforeEach(() => {
  vi.mocked(executeRegionalP533).mockReset();
  vi.mocked(executeRegionalP533).mockImplementation(async request => modelResult(request) as any);
  observedRf.setOperatingLocation.mockClear();
});

describe('PropagationGuidanceService', () => {
  it('rejects malformed location payloads and accepts current/manual provenance', () => {
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: { coordinates: { lat: 99, lon: 0 }, provenance: 'manual' } })).toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: { ...currentLocation, status: 'error' } })).toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: { ...currentLocation, source: { id: '', type: 'browser_geolocation' } } })).toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: { ...currentLocation, gridSquare: 'CM87' } })).toMatchObject({ operatingLocation: { gridSquare: latLonToGridSquare(37.54, -77.43) } });
    expect(parseGuidanceRequest({ destinationRegion: 'unknown', operatingLocation: location })).toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: location })).toMatchObject({ destinationRegion: 'western_europe' });
  });

  it('accepts valid current, manual, and stale contracts only', () => {
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: currentLocation })).not.toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: location })).not.toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: { ...currentLocation, provenance: 'stale', status: 'cached', source: { id: 'cache:test', type: 'cached_local_storage' } } })).not.toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: { ...currentLocation, provenance: 'manual', status: 'ok', source: { id: 'manual:test', type: 'manual_location' } } })).toBeNull();
  });

  it('defers local NVIS and returns the canonical ten-band response without running P.533', async () => {
    const guidance = createService();
    const result = await guidance.evaluateGuidance({ destinationRegion: 'local_nvis', operatingLocation: location });
    expect(result.assessments).toHaveLength(10);
    expect(result.assessments.every(item => item.rating === 'UNAVAILABLE')).toBe(true);
    expect(result.model.cache).toBe('not_applicable');
    expect(result.model.ssn.value).toBe(109);
  });

  it('does not substitute defaults when persisted configuration is corrupt or unreadable', async () => {
    await expect(createService({ configStore: { read: () => ({ kind: 'invalid', reason: 'corrupt' }) } as DashboardConfigStore }).evaluateGuidance({ destinationRegion: 'western_europe', operatingLocation: currentLocation })).rejects.toThrow('configuration is unavailable');
  });

  it('uses the canonical default profile only for a missing first-run configuration', async () => {
    const result = await createService({ configStore: { read: () => ({ kind: 'missing' }) } as DashboardConfigStore }).evaluateGuidance({ destinationRegion: 'local_nvis', operatingLocation: currentLocation });
    expect(result.stationProfile).toEqual(normalizeDashboardConfig({}).propagation.stationProfile);
  });

  it('does not execute P.533 when model SSN is unavailable', async () => {
    const snapshot = { ...weather, modelSsn: { product: 'ssn', state: 'unavailable', source: weather.modelSsn.source } };
    const result = await createService({ snapshot }).evaluateGuidance({ destinationRegion: 'western_europe', operatingLocation: currentLocation });
    expect(executeRegionalP533).not.toHaveBeenCalled();
    expect(result.model.status).toBe('unavailable');
  });

  it('keeps cached model guidance working when current NOAA and MQTT evidence are offline', async () => {
    const offlineProducts = Object.fromEntries(Object.entries(weather.products).map(([key, item]) => [key, { ...item, state: 'unavailable', value: null, error: 'offline' }]));
    const result = await createService({ snapshot: { ...weather, status: 'unavailable', products: offlineProducts }, observedSnapshot: { ...observedRf.getSnapshot(), status: 'unavailable', reports: [] } }).evaluateGuidance({ destinationRegion: 'western_europe', operatingLocation: currentLocation });
    expect(result.model.status).toBe('complete');
    expect(result.assessments.some(item => item.confidence === 'modeled_only')).toBe(true);
  });

  it('preserves observed-only guidance when P.533 is unavailable', async () => {
    const report = parsePskPayload('pskr/filter/v2/20m/FT8/K1ABC/REMOTE/FM17gm/IO91wm/291/291', JSON.stringify({ seq: 'integration-observed-only', sc: 'K1ABC', rc: 'REMOTE', sl: 'FM17gm', rl: 'IO91wm', f: 14_074_000, md: 'FT8', rp: -12, t: Math.floor(Date.parse('2026-08-17T02:55:00.000Z') / 1000), b: '20m' }), 'FM17', new Date('2026-08-17T03:00:00.000Z'));
    vi.mocked(executeRegionalP533).mockImplementation(async request => ({ ...modelResult(request), status: 'unavailable', bandResults: [], executionCount: 0 }) as any);
    const result = await createService({ observedSnapshot: { ...observedRf.getSnapshot(), status: 'live', evidenceStatus: 'live_observed_rf_source', reports: report ? [report] : [] } }).evaluateGuidance({ destinationRegion: 'western_europe', operatingLocation: currentLocation });
    expect(result.model.status).toBe('unavailable');
    expect(result.assessments.find(item => item.band === '20m')?.rating).not.toBe('UNAVAILABLE');
  });

  it('uses GRID6 and invalidates only on model-key inputs', async () => {
    const sameGrid = { ...currentLocation, coordinates: { lat: 37.540001, lon: -77.430001 } };
    const differentGrid = { ...currentLocation, coordinates: { lat: 37.6, lon: -77.43 } };
    const guidance = createService();
    const first = await guidance.evaluateGuidance({ destinationRegion: 'western_europe', operatingLocation: currentLocation });
    const second = await guidance.evaluateGuidance({ destinationRegion: 'western_europe', operatingLocation: sameGrid });
    expect(first.stationProfile).toEqual(profile);
    expect(first.model.cache).toBe('miss');
    expect(second.model.cache).toBe('hit');
    expect(executeRegionalP533).toHaveBeenCalledTimes(1);
    expect(propagationGuidanceModelCacheKey(currentLocation.coordinates, 'western_europe', profile, '2026-08-17T03:00:00.000Z', weather.modelSsn as any)).toContain(latLonToGridSquare(37.54, -77.43));
    expect(propagationGuidanceModelCacheKey(currentLocation.coordinates, 'western_europe', profile, '2026-08-17T03:00:00.000Z', weather.modelSsn as any)).not.toContain('0.25');
    await guidance.evaluateGuidance({ destinationRegion: 'western_europe', operatingLocation: differentGrid });
    expect(executeRegionalP533).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache identity for region, profile, hour, and model SSN while ignoring current evidence', () => {
    const base = propagationGuidanceModelCacheKey(currentLocation.coordinates, 'western_europe', profile, '2026-08-17T03:00:00.000Z', weather.modelSsn as any);
    expect(propagationGuidanceModelCacheKey(currentLocation.coordinates, 'eastern_us', profile, '2026-08-17T03:00:00.000Z', weather.modelSsn as any)).not.toBe(base);
    expect(propagationGuidanceModelCacheKey(currentLocation.coordinates, 'western_europe', { ...profile, mode: 'FT8' }, '2026-08-17T03:00:00.000Z', weather.modelSsn as any)).not.toBe(base);
    expect(propagationGuidanceModelCacheKey(currentLocation.coordinates, 'western_europe', profile, '2026-08-17T04:00:00.000Z', weather.modelSsn as any)).not.toBe(base);
    expect(propagationGuidanceModelCacheKey(currentLocation.coordinates, 'western_europe', profile, '2026-08-17T03:00:00.000Z', { ...weather.modelSsn, value: 110 } as any)).not.toBe(base);
    expect(propagationGuidanceModelCacheKey(currentLocation.coordinates, 'western_europe', profile, '2026-08-17T03:00:00.000Z', weather.modelSsn as any)).toBe(base);
  });

  it('shares simultaneous model execution for one GRID6 key', async () => {
    vi.mocked(executeRegionalP533).mockImplementation(async request => { await new Promise(resolve => setTimeout(resolve, 10)); return modelResult(request) as any; });
    const guidance = createService();
    const request = { destinationRegion: 'western_europe', operatingLocation: currentLocation };
    const [first, second] = await Promise.all([guidance.evaluateGuidance(request), guidance.evaluateGuidance(request)]);
    expect(executeRegionalP533).toHaveBeenCalledTimes(1);
    expect([first.model.cache, second.model.cache].sort()).toEqual(['miss', 'shared']);
  });
});
