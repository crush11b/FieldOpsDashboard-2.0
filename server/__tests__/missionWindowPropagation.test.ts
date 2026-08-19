import { describe, expect, it } from 'vitest';
import { executeMissionWindowPropagation, missionSampleTimes } from '../missionWindowPropagation';
import type { SmartDeployExecutionRequest } from '../../src/planning/smartDeployPlanning';

const planningRequest = {
  activationTarget: {
    program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: { lat: 38, lon: -78 },
    provenance: { kind: 'externally_resolved' as const, source: { id: 'pota-api', type: 'pota_individual_park_api' }, resolvedAtUtc: '2026-08-18T00:00:00.000Z' },
  },
  plannedOperatingLocation: { coordinates: { lat: 37, lon: -77 }, gridSquare: 'FM17', provenance: 'manual' as const, status: 'degraded' as const, source: { id: 'test', type: 'manual_location' } },
  propagationObjective: { kind: 'regional' as const, regionId: 'western_us' as const },
  missionWindow: { start: '2026-08-18T14:00:00Z', end: '2026-08-18T18:00:00Z' },
  equipment: { radio: { name: 'Test Radio' }, antenna: { type: 'EFHW' as const }, modes: ['SSB', 'FT8'] as const, transmitPowerWatts: 10, deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const } },
  objective: 'Test mission',
  operatingLocation: { coordinates: { lat: 37, lon: -77 }, gridSquare: 'FM17', provenance: 'manual' as const, status: 'degraded' as const, source: { id: 'test', type: 'manual_location' } },
} satisfies SmartDeployExecutionRequest;

const success = (request: any, reliability = 60) => ({ ok: true as const, result: {
  sourceState: 'modeled' as const, model: 'ITU-R P.533' as const, modelVersion: 'P.533-14' as const, engine: 'ITU-R-HF v14.3' as const,
  request, modeledPeriod: { year: request.year, month: request.month, day: request.day, utcHour: request.utcHour }, elapsedMs: 1, reportBytes: 1, rawReport: '',
  frequency: { frequencyMHz: request.frequencyMHz, basicMufMHz: 15, receivedPowerDb: -80, snrDb: 10, basicCircuitReliabilityPercent: reliability },
  assetProvenance: {} as any,
} });

describe('mission-window propagation adapter', () => {
  it('calculates exact start, midpoint, and end times including odd durations and UTC midnight crossing', () => {
    expect(missionSampleTimes({ start: '2026-08-18T14:00:00Z', end: '2026-08-18T18:00:00Z' }).map(sample => sample.modelDateTimeUtc)).toEqual(['2026-08-18T14:00:00.000Z', '2026-08-18T16:00:00.000Z', '2026-08-18T18:00:00.000Z']);
    expect(missionSampleTimes({ start: '2026-08-18T23:00:00Z', end: '2026-08-19T01:00:00Z' }).map(sample => sample.modelDateTimeUtc)).toEqual(['2026-08-18T23:00:00.000Z', '2026-08-19T00:00:00.000Z', '2026-08-19T01:00:00.000Z']);
    expect(missionSampleTimes({ start: '2026-08-18T00:00:00Z', end: '2026-08-18T00:00:05Z' }).map(sample => sample.modelDateTimeUtc)).toEqual(['2026-08-18T00:00:00.000Z', '2026-08-18T00:00:02.500Z', '2026-08-18T00:00:05.000Z']);
  });

  it('passes mission sample UTC components to P.533 despite a different current clock', async () => {
    const calls: any[] = [];
    const executeCircuit = async (request: any) => { calls.push(request); return success(request); };
    const result = await executeMissionWindowPropagation({ planningRequest, ssn: 100 }, () => new Date('2035-01-01T00:00:00Z'), executeCircuit);
    expect(result.samples.map(sample => sample.modelDateTimeUtc)).toEqual(['2026-08-18T14:00:00.000Z', '2026-08-18T16:00:00.000Z', '2026-08-18T18:00:00.000Z']);
    expect(calls.filter(request => request.utcHour === 14)).toHaveLength(36);
    expect(calls.filter(request => request.utcHour === 16)).toHaveLength(36);
    expect(calls.filter(request => request.utcHour === 18)).toHaveLength(36);
    expect(calls.every(request => request.origin.lat === planningRequest.plannedOperatingLocation.coordinates.lat)).toBe(true);
    expect(calls.every(request => !(request.destination.lat === planningRequest.activationTarget.coordinates.lat && request.destination.lon === planningRequest.activationTarget.coordinates.lon))).toBe(true);
    expect(result.generatedAtUtc).toBe('2035-01-01T00:00:00.000Z');
  });

    it.each([0, 1, 2])('keeps successful samples when sample index %s has failures', async failedSampleIndex => {
    const executeCircuit = async (request: any) => {
      const sampleIndex = request.utcHour === 14 ? 0 : request.utcHour === 16 ? 1 : 2;
      return sampleIndex === failedSampleIndex ? { ok: false as const, error: { code: 'execution_failed' as const, message: 'sample failed' } } : success(request);
    };
    const result = await executeMissionWindowPropagation({ planningRequest, ssn: 100 }, undefined, executeCircuit);
    expect(result.status).toBe('partial');
    expect(result.samples[failedSampleIndex].status).toBe('unavailable');
    expect(result.samples.filter(sample => sample.status !== 'unavailable')).toHaveLength(2);
  });

  it('returns a very limited partial result when two samples fail and unavailable when all fail', async () => {
    const partialExecutor = async (request: any) => {
      const sampleIndex = request.utcHour === 14 ? 0 : request.utcHour === 16 ? 1 : 2;
      return sampleIndex === 0 ? success(request) : { ok: false as const, error: { code: 'execution_failed' as const, message: 'sample failed' } };
    };
    const limited = await executeMissionWindowPropagation({ planningRequest, ssn: 100 }, undefined, partialExecutor);
    expect(limited.status).toBe('partial');
    expect(limited.summary.successfulSampleCount).toBe(1);
    expect(limited.summary.limitations.join(' ')).toContain('no continuous trend');

    const unavailable = await executeMissionWindowPropagation({ planningRequest, ssn: 100 }, undefined, async () => ({ ok: false as const, error: { code: 'execution_failed' as const, message: 'all failed' } }));
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.summary.consistentStrongestBand).toBeNull();
    expect(unavailable.summary.limitations.join(' ')).toContain('no band recommendation');
  });

  it('reports a stable strongest band only when all successful samples agree', async () => {
    const executeCircuit = async (request: any) => {
      const sampleIndex = request.utcHour === 14 ? 0 : request.utcHour === 16 ? 1 : 2;
      return success(request, request.band === (sampleIndex === 1 ? '20m' : '40m') ? 90 : 60);
    };
    const result = await executeMissionWindowPropagation({ planningRequest, ssn: 100 }, undefined, executeCircuit);
    expect(result.summary.strongestBandBySample.map(item => item.band)).toEqual(['40m', '20m', '40m']);
    expect(result.summary.consistentStrongestBand).toBeNull();
  });
});