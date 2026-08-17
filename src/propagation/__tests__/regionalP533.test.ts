import { describe, expect, it } from 'vitest';
import { resolveOperatingLocation } from '../../location/operatingLocation';
import { DEFAULT_STATION_PROFILE } from '../stationProfileCatalog';
import { getPropagationRegion } from '../regionalDestinations';
import { P533_BAND_FREQUENCIES, type P533CircuitResult } from '../p533';
import {
  createRegionalP533RequestFromConfig,
  getRegionalP533Assumptions,
  summarizeRegionalP533Samples,
  type RegionalP533SampleResult,
} from '../regionalP533';
import { executeRegionalP533 } from '../../../server/regionalP533';
import type { DashboardConfig } from '../../types';

const origin = resolveOperatingLocation(
  { lat: 37.408, lon: -77.4592, gridSquare: '' },
  { status: 'ok', source: { id: 'gps:test', type: 'serial_nmea', name: 'Test GNSS' } },
);

const baseRequest = {
  operatingLocation: origin,
  stationProfile: DEFAULT_STATION_PROFILE,
  modelDateTimeUtc: '2025-01-15T17:00:00Z',
  ssn: 120,
} as const;

function request(regionId: 'western_europe' | 'local_nvis' | 'western_us' | 'middle_east' | 'oceania') {
  return { ...baseRequest, regionId };
}

describe('Slice 5E regional P.533 modeling', () => {
  it('records the missing real-engine reference matrix under fixed assumptions', async () => {
    const destinations = [
      ['western_europe', { lat: 40.4168, lon: -3.7038 }],
      ['western_us', { lat: 47.6062, lon: -122.3321 }],
      ['middle_east', { lat: 24.7136, lon: 46.6753 }],
      ['oceania', { lat: -33.8688, lon: 151.2093 }],
    ] as const;
    const results = [];
    for (const [regionId, destination] of destinations) {
      const region = getPropagationRegion(regionId);
      if (!region || region.kind !== 'sampled_region') throw new Error(`Missing ${regionId} catalog entry`);
      const sample = region.representativeSamplePoints.find(point => point.coordinates.lat === destination.lat && point.coordinates.lon === destination.lon)!;
      const regional = await executeRegionalP533(request(regionId));
      const band = regional.bandResults.find(result => result.band === '20m')!;
      const sampleResult = band.samples.find(result => result.sampleId === sample.id)!;
      expect(sampleResult.execution.ok).toBe(true);
      if (sampleResult.execution.ok) results.push({ regionId, destination: sample.label, distanceKm: sampleResult.distanceKm, frequencyMHz: sampleResult.execution.result.frequency.frequencyMHz, bmufMHz: sampleResult.execution.result.frequency.basicMufMHz, receivedPowerDb: sampleResult.execution.result.frequency.receivedPowerDb, snrDb: sampleResult.execution.result.frequency.snrDb, bcr: sampleResult.execution.result.frequency.basicCircuitReliabilityPercent });
    }
    expect(results).toHaveLength(4);
    expect(results.map(result => result.regionId)).toEqual(['western_europe', 'western_us', 'middle_east', 'oceania']);
  }, 60_000);

  it('proves frequency, hour, and transmit power affect real model output', async () => {
    const region = getPropagationRegion('western_europe');
    if (!region || region.kind !== 'sampled_region') throw new Error('Missing Western Europe catalog entry');
    const sample = region.representativeSamplePoints.find(point => point.id === 'western_europe_madrid')!;
    const base = { ...baseRequest, regionId: 'western_europe' as const };
    const normal = await executeRegionalP533(base);
    const night = await executeRegionalP533({ ...base, modelDateTimeUtc: '2025-01-15T05:00:00Z' });
    const lowerPower = await executeRegionalP533({ ...base, stationProfile: { ...DEFAULT_STATION_PROFILE, transmitPowerWatts: 5 } });
    const normalValue = normal.bandResults.find(band => band.band === '20m')!.samples.find(result => result.sampleId === sample.id)!.execution;
    const tenMeterValue = normal.bandResults.find(band => band.band === '10m')!.samples.find(result => result.sampleId === sample.id)!.execution;
    const nightValue = night.bandResults.find(band => band.band === '20m')!.samples.find(result => result.sampleId === sample.id)!.execution;
    const lowerPowerValue = lowerPower.bandResults.find(band => band.band === '20m')!.samples.find(result => result.sampleId === sample.id)!.execution;
    expect(normalValue.ok && tenMeterValue.ok && nightValue.ok && lowerPowerValue.ok).toBe(true);
    if (normalValue.ok && tenMeterValue.ok && nightValue.ok && lowerPowerValue.ok) {
      expect(tenMeterValue.result.frequency.snrDb).not.toBe(normalValue.result.frequency.snrDb);
      expect(nightValue.result.frequency.snrDb).not.toBe(normalValue.result.frequency.snrDb);
      expect(lowerPowerValue.result.frequency.receivedPowerDb).not.toBe(normalValue.result.frequency.receivedPowerDb);
    }
    expect(P533_BAND_FREQUENCIES['20m'].modelFrequencyMHz).toBe(14.1);
  }, 60_000);

  it('returns explicit separate-evaluator and unavailable outcomes', async () => {
    const local = await executeRegionalP533(request('local_nvis'));
    expect(local).toMatchObject({ status: 'not_applicable', bandResults: [], executionCount: 0 });
    const unavailable = await executeRegionalP533({ ...request('western_europe'), operatingLocation: resolveOperatingLocation({ lat: 37, lon: -77, gridSquare: '' }, { status: 'unavailable', source: { id: 'gps:none', type: 'serial_nmea', name: 'Unavailable GNSS' } }) });
    expect(unavailable).toMatchObject({ status: 'unavailable', bandResults: [], executionCount: 0 });
  });

  it('consumes the persisted DashboardConfig propagation station profile', () => {
    const config = { propagation: { stationProfile: { ...DEFAULT_STATION_PROFILE, mode: 'FT8' as const, transmitPowerWatts: 50 } } } as Pick<DashboardConfig, 'propagation'>;
    const regional = createRegionalP533RequestFromConfig({ ...baseRequest, regionId: 'western_europe', config });
    expect(regional.stationProfile).toBe(config.propagation.stationProfile);
    expect(getRegionalP533Assumptions().antennaModel).toBe('ISOTROPIC');
    expect(getRegionalP533Assumptions().modeInterpretation).toContain('preserved as metadata');
  });

  it('aggregates successful values and preserves explicit failures without ratings', () => {
    const result = (bcr: number | null, snr: number | null, power: number | null, muf: number | null): P533CircuitResult => ({ frequency: { frequencyMHz: 14.1, basicCircuitReliabilityPercent: bcr, snrDb: snr, receivedPowerDb: power, basicMufMHz: muf }, sourceState: 'modeled', model: 'ITU-R P.533', modelVersion: 'P.533-14', engine: 'ITU-R-HF v14.3', request: {} as never, modeledPeriod: { year: 2025, month: 1, day: 15, utcHour: 17 }, elapsedMs: 1, reportBytes: 1, rawReport: 'fixture', assetProvenance: {} as never });
    const sample = (sampleId: string, execution: RegionalP533SampleResult['execution']): RegionalP533SampleResult => ({ regionId: 'western_europe', sampleId, sampleLabel: sampleId, distanceKm: 1, initialBearingDegrees: 1, compassDirection: 'N', band: '20m', modelFrequencyMHz: 14.1, stationProfile: DEFAULT_STATION_PROFILE, assumptions: getRegionalP533Assumptions(), execution });
    const summary = summarizeRegionalP533Samples([sample('a', { ok: true, result: result(10, 1, -100, 20) }), sample('b', { ok: true, result: result(30, 3, -80, 30) }), sample('c', { ok: true, result: result(20, 2, -90, 25) }), sample('d', { ok: false, error: { code: 'report_parse_failed', message: 'fixture failure' } })]);
    expect(summary).toMatchObject({ sampleCount: 4, successfulSampleCount: 3, failedSampleCount: 1, basicCircuitReliabilityPercent: { minimum: 10, maximum: 30, median: 20 }, snrDb: { minimum: 1, maximum: 3, median: 2 }, receivedPowerDb: { minimum: -100, maximum: -80, median: -90 }, basicMufMHz: { minimum: 20, maximum: 30, median: 25 }, sampleFailures: [{ sampleId: 'd', error: 'fixture failure' }] });
    expect(summary).not.toHaveProperty('rating');
  });

  it('executes all five Western Europe samples across exactly nine P.533 bands', async () => {
    const started = Date.now();
    const result = await executeRegionalP533(request('western_europe'));
    const elapsed = Date.now() - started;
    expect(result.status).toBe('complete');
    expect(result.executionCount).toBe(45);
    expect(result.bandResults).toHaveLength(9);
    expect(result.unsupportedBands).toEqual(['6m']);
    expect(result.bandResults.every(band => band.samples.length === 5)).toBe(true);
    expect(result.bandResults.every(band => band.samples.every(sample => sample.execution.ok))).toBe(true);
    expect(new Set(result.bandResults.flatMap(band => band.samples.map(sample => sample.sampleId))).size).toBe(5);
    expect(result.bandResults.every(band => band.summary.sampleCount === 5 && band.summary.successfulSampleCount === 5 && band.summary.failedSampleCount === 0)).toBe(true);
    expect(result.bandResults.every(band => band.samples.every(sample => sample.stationProfile === DEFAULT_STATION_PROFILE))).toBe(true);
    expect(result.bandResults.every(band => band.samples.every(sample => sample.execution.ok && sample.execution.result.sourceState === 'modeled'))).toBe(true);
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(elapsed).toBeGreaterThan(0);
  }, 120_000);
});