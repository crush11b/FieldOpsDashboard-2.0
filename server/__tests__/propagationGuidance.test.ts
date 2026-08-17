import { describe, expect, it } from 'vitest';
import { DashboardConfigStore } from '../dashboardConfig';
import { parseGuidanceRequest, PropagationGuidanceService } from '../propagationGuidance';

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

describe('PropagationGuidanceService', () => {
  it('rejects malformed location payloads and accepts current/manual provenance', () => {
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: { coordinates: { lat: 99, lon: 0 }, provenance: 'manual' } })).toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'unknown', operatingLocation: location })).toBeNull();
    expect(parseGuidanceRequest({ destinationRegion: 'western_europe', operatingLocation: location })).toMatchObject({ destinationRegion: 'western_europe' });
  });

  it('defers local NVIS and returns the canonical ten-band response without running P.533', async () => {
    const service = new PropagationGuidanceService(
      { getSnapshot: async () => weather } as any,
      { setOperatingLocation: () => {}, getSnapshot: () => ({ kind: 'observed_rf', status: 'unavailable', operatingGrid4: null, observationWindow: { startsAt: '2026-08-17T02:45:00.000Z', endsAt: '2026-08-17T03:00:00.000Z' }, collectedAtUtc: '2026-08-17T03:00:00.000Z', reports: [], bandSummaries: [], provenance: { sourceId: 'test', sourceName: 'test', transport: 'mqtts-websocket', brokerHost: 'test', brokerPort: 1886, topicPatterns: [] } }) } as any,
      { read: () => ({ kind: 'loaded', config: { propagation: { stationProfile: { mode: 'SSB', transmitPowerWatts: 10, antenna: { type: 'EFHW' }, deployment: { geometry: 'inverted_v', heightCategory: '15_to_30_ft' } } } } }) } as unknown as DashboardConfigStore,
      () => new Date('2026-08-17T03:00:00.000Z'),
    );
    const result = await service.evaluateGuidance({ destinationRegion: 'local_nvis', operatingLocation: location });
    expect(result.assessments).toHaveLength(10);
    expect(result.assessments.every(item => item.rating === 'UNAVAILABLE')).toBe(true);
    expect(result.model.cache).toBe('not_applicable');
    expect(result.model.ssn.value).toBe(109);
  });
});
