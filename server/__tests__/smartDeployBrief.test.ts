import { describe, expect, it } from 'vitest';
import { composeMissionEvidence } from '../missionEvidence';
import { generateSmartDeployBrief } from '../smartDeployBrief';
import type { SmartDeployExecutionRequest } from '../../src/planning/smartDeployPlanning';
import type { MissionWindowPropagationResult } from '../missionWindowPropagation';
import type { ObservedRfSnapshot } from '../../src/propagation/observedRf';
import { latLonGrid4 } from '../../src/propagation/observedRf';

const operatingCoordinates = { lat: 37.4, lon: -77.4 };
const targetCoordinates = { lat: 38, lon: -78 };
const operatingGrid4 = latLonGrid4(operatingCoordinates.lat, operatingCoordinates.lon);
const source = { id: 'pota:test', type: 'pota_catalog' as const, name: 'POTA catalog' };

function planning(): SmartDeployExecutionRequest {
  return {
    activationTarget: { program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: targetCoordinates, gridSquare: 'FM18', provenance: { kind: 'externally_resolved', source, resolvedAtUtc: '2026-08-18T12:00:00.000Z' } },
    plannedOperatingLocation: { coordinates: operatingCoordinates, gridSquare: 'FM17', provenance: 'manual', status: 'degraded', source: { id: 'manual:test', type: 'manual_location' } },
    currentDeviceLocation: { coordinates: operatingCoordinates, gridSquare: 'FM17', provenance: 'current', status: 'ok', source: { id: 'gps:test', type: 'serial_nmea' } },
    propagationObjective: { kind: 'regional', regionId: 'western_us' },
    missionWindow: { start: '2026-08-18T14:00:00Z', end: '2026-08-18T18:00:00Z' },
    equipment: { radio: { name: 'Field Radio', model: 'Test-1' }, antenna: { type: 'EFHW' }, modes: ['SSB', 'FT8'], transmitPowerWatts: 10, deployment: { geometry: 'inverted_v', heightCategory: '15_to_30_ft' }, deploymentNotes: 'Use the south clearing.' },
    objective: 'Complete the activation',
    operatingLocation: { coordinates: operatingCoordinates, gridSquare: 'FM17', provenance: 'manual', status: 'degraded', source: { id: 'manual:test', type: 'manual_location' } },
  } as SmartDeployExecutionRequest;
}

function propagation(status: 'complete' | 'partial' | 'unavailable' = 'complete', strongest: ('20m' | '40m')[] = ['20m', '20m', '20m'], failedIndexes: readonly number[] = status === 'partial' ? [1] : status === 'unavailable' ? [0, 1, 2] : []): MissionWindowPropagationResult {
  const samples = (['start', 'midpoint', 'end'] as const).map((position, index) => ({
    position, modelDateTimeUtc: `2026-08-18T${14 + index * 2}:00:00.000Z`, status: failedIndexes.includes(index) ? 'unavailable' as const : 'complete' as const,
    stationProfile: { mode: 'SSB' as const, transmitPowerWatts: 10, antenna: { type: 'EFHW' as const }, deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const } }, modes: ['SSB', 'FT8'] as const,
    bands: [], provenance: { model: 'ITU-R P.533' as const, engine: 'ITU-R-HF v14.3' as const, sourceState: 'modeled' as const },
  }));
  return {
    status, missionWindow: planning().missionWindow, generatedAtUtc: '2026-08-18T12:00:00.000Z', samples: samples as unknown as MissionWindowPropagationResult['samples'],
    summary: { successfulSampleCount: 3 - failedIndexes.length, failedSampleCount: failedIndexes.length, strongestBandBySample: samples.map((sample, index) => ({ position: sample.position, band: sample.status === 'unavailable' ? null : strongest[index] })), consistentStrongestBand: status === 'complete' && new Set(strongest).size === 1 ? strongest[0] : null, limitations: failedIndexes.length > 0 ? ['One or more mission samples were unavailable.'] : ['Samples are discrete model observations.'] },
  };
}

function observed(status: ObservedRfSnapshot['status'] = 'live'): ObservedRfSnapshot {
  return {
    kind: 'observed_rf', status, evidenceStatus: status === 'stale' ? 'stale_observed_rf_source' : status === 'live' ? 'live_observed_rf_source' : 'cached_observed_rf_source', operatingGrid4,
    observationWindow: { startsAt: '2026-08-18T13:45:00.000Z', endsAt: '2026-08-18T14:00:00.000Z' }, collectedAtUtc: '2026-08-18T14:00:00.000Z', reports: [], bandSummaries: [],
    provenance: { sourceId: 'pskreporter-via-mqtt', sourceName: 'PSKReporter reports via mqtt.pskreporter.info', transport: 'mqtts-websocket', brokerHost: 'mqtt.pskreporter.info', brokerPort: 1886, topicPatterns: [] },
  };
}

function brief(overrides: { propagation?: MissionWindowPropagationResult; observedRf?: ObservedRfSnapshot | null } = {}) {
  const request = planning();
  return generateSmartDeployBrief({ planningRequest: request, missionEvidence: composeMissionEvidence({ planningRequest: request, propagation: overrides.propagation ?? propagation(), observedRf: overrides.observedRf === undefined ? observed() : overrides.observedRf }) }, { now: () => new Date('2026-08-18T12:30:00.000Z'), createBriefId: () => 'brief-test-1' });
}

describe('SmartDeploy operations brief', () => {
  it('creates a versioned deterministic identity and snapshots the normalized mission', () => {
    const result = brief();
    expect(result).toMatchObject({ schemaVersion: 1, briefId: 'brief-test-1', generatedAtUtc: '2026-08-18T12:30:00.000Z', status: 'complete' });
    expect(result.mission).toMatchObject({ activationTarget: { program: 'POTA', reference: 'US-1234', displayName: 'Test Park' }, operatingLocation: { coordinates: operatingCoordinates }, missionWindow: planning().missionWindow, objective: 'Complete the activation' });
    expect(result.mission.equipment.modes).toEqual(['SSB', 'FT8']);
  });

  it('retains all propagation samples, timestamps, partial state, and modeled-mode truth', () => {
    const result = brief({ propagation: propagation('partial', ['20m', '40m', '20m']) });
    expect(result.status).toBe('partial');
    expect(result.sections.propagation.evidence.samples).toHaveLength(3);
    expect(result.sections.propagation.evidence.samples.map(sample => sample.modelDateTimeUtc)).toEqual(['2026-08-18T14:00:00.000Z', '2026-08-18T16:00:00.000Z', '2026-08-18T18:00:00.000Z']);
    expect(result.sections.propagation.evidence.samples[0].modes).toEqual(['SSB', 'FT8']);
    expect(result.sections.propagation.evidence.samples[0].stationProfile.mode).toBe('SSB');
    expect(result.limitations.some(limitation => limitation.code === 'single_mode_modeled')).toBe(true);
    expect(result.limitations.some(limitation => limitation.code === 'propagation_partial')).toBe(true);
    expect(result.summary).toContain('2 of 3 mission samples');
  });

  it('keeps a one-sample propagation result partial when two mission samples fail', () => {
    const result = brief({ propagation: propagation('partial', ['20m', '40m', '20m'], [0, 1]) });
    expect(result.status).toBe('partial');
    expect(result.sections.propagation.evidence.summary.successfulSampleCount).toBe(1);
    expect(result.summary).toContain('1 of 3 mission samples');
    expect(result.summary).not.toContain('changes across the sampled mission times');
  });

  it('summarizes stable and changing strongest-band conclusions deterministically', () => {
    expect(brief().summary).toContain('20m is the strongest modeled band at all three sampled mission times');
    const changing = brief({ propagation: propagation('complete', ['20m', '40m', '20m']) });
    expect(changing.summary).toContain('The strongest modeled band changes across the sampled mission times');
    expect(changing.summary).toContain('start: 20m; midpoint: 40m; end: 20m');
  });

  it('preserves solar and observed-RF states without treating not-applicable RF as failure', () => {
    const futurePlanning = { ...planning(), missionWindow: { start: '2026-08-18T18:00:00Z', end: '2026-08-18T20:00:00Z' } };
    const futureEvidence = composeMissionEvidence({ planningRequest: futurePlanning, propagation: propagation(), observedRf: observed() });
    const future = generateSmartDeployBrief({ planningRequest: futurePlanning, missionEvidence: futureEvidence }, { now: () => new Date('2026-08-18T12:30:00Z'), createBriefId: () => 'future' });
    expect(future.sections.observedRf.status).toBe('notTemporallyApplicable');
    expect(future.status).toBe('complete');
    expect(future.summary).toContain('not temporally applicable');

    const stale = brief({ observedRf: observed('stale') });
    expect(stale.status).toBe('partial');
    expect(stale.sections.observedRf.status).toBe('stale');
    expect(stale.sections.solar.evidence.site).toBe('planned_operating_location');
  });

  it('marks foundational geometry failure unavailable while retaining serializable evidence', () => {
    const invalidPlanning = { ...planning(), plannedOperatingLocation: { ...planning().plannedOperatingLocation, coordinates: null, provenance: 'unavailable' as const } } as SmartDeployExecutionRequest;
    const evidence = composeMissionEvidence({ planningRequest: invalidPlanning, propagation: propagation(), observedRf: null });
    const result = generateSmartDeployBrief({ planningRequest: invalidPlanning, missionEvidence: evidence }, { createBriefId: () => 'unavailable', now: () => new Date('2026-08-18T12:30:00Z') });
    expect(result.status).toBe('unavailable');
    expect(result.sections.geometry.status).toBe('unavailable');
    expect(result.limitations.some(limitation => limitation.code === 'geometry_unavailable')).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ schemaVersion: 1, briefId: 'unavailable', status: 'unavailable' });
  });

  it('produces identical content with injected identity and clock', () => {
    const first = brief();
    const second = brief();
    expect(second).toEqual(first);
  });

  it('represents all propagation unavailable without substituting current guidance', () => {
    const result = brief({ propagation: propagation('unavailable'), observedRf: null });
    expect(result.status).toBe('partial');
    expect(result.sections.propagation.status).toBe('unavailable');
    expect(result.summary).toContain('Modeled propagation is unavailable');
    expect(result.summary).not.toContain('current propagation');
  });
});