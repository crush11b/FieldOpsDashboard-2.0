import { describe, expect, it } from 'vitest';
import { latLonGrid4 } from '../../src/propagation/observedRf';
import { calculateSolarEvents } from '../../src/location/solarEvents';
import { composeMissionEvidence, MISSION_OBSERVED_RF_APPLICABILITY_WINDOW_MS } from '../missionEvidence';
import type { SmartDeployPlanningRequest } from '../../src/planning/smartDeployPlanning';
import type { MissionWindowPropagationResult } from '../missionWindowPropagation';
import type { ObservedRfSnapshot } from '../../src/propagation/observedRf';

const operatingCoordinates = { lat: 37.4, lon: -77.4 };
const activationCoordinates = { lat: 38, lon: -78 };
const operatingGrid4 = latLonGrid4(operatingCoordinates.lat, operatingCoordinates.lon);
const source = { id: 'pota:test', type: 'pota_catalog' as const, name: 'POTA catalog' };

function planning(overrides: Partial<SmartDeployPlanningRequest> = {}): SmartDeployPlanningRequest {
  return {
    activationTarget: {
      program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: activationCoordinates,
      provenance: { kind: 'externally_resolved', source, resolvedAtUtc: '2026-08-18T12:00:00.000Z' },
    },
    operatingLocation: {
      coordinates: operatingCoordinates, gridSquare: 'FM17', provenance: 'manual', status: 'degraded',
      source: { id: 'manual:test', type: 'manual_location' },
    },
    missionWindow: { start: '2026-08-18T14:00:00Z', end: '2026-08-18T18:00:00Z' },
    equipment: {
      radio: { name: 'Field Radio' }, antenna: { type: 'EFHW' }, modes: ['SSB', 'FT8'], transmitPowerWatts: 10,
      deployment: { geometry: 'inverted_v', heightCategory: '15_to_30_ft' },
    },
    objective: 'Test mission',
    ...overrides,
  } as SmartDeployPlanningRequest;
}

const propagation = (status: 'complete' | 'partial' | 'unavailable' = 'complete'): MissionWindowPropagationResult => ({
  status,
  missionWindow: planning().missionWindow,
  generatedAtUtc: '2026-08-18T12:00:00.000Z',
  samples: [] as unknown as MissionWindowPropagationResult['samples'],
  summary: {
    successfulSampleCount: status === 'unavailable' ? 0 : 2,
    failedSampleCount: status === 'complete' ? 0 : 1,
    strongestBandBySample: [],
    consistentStrongestBand: null,
    limitations: status === 'partial' ? ['One mission sample was unavailable.'] : [],
  },
});

function observedSnapshot(overrides: Partial<ObservedRfSnapshot> = {}): ObservedRfSnapshot {
  return {
    kind: 'observed_rf', status: 'live', evidenceStatus: 'live_observed_rf_source', operatingGrid4,
    observationWindow: { startsAt: '2026-08-18T13:45:00.000Z', endsAt: '2026-08-18T14:00:00.000Z' },
    collectedAtUtc: '2026-08-18T14:00:00.000Z', reports: [], bandSummaries: [],
    provenance: {
      sourceId: 'pskreporter-via-mqtt', sourceName: 'PSKReporter reports via mqtt.pskreporter.info', transport: 'mqtts-websocket',
      brokerHost: 'mqtt.pskreporter.info', brokerPort: 1886, topicPatterns: [],
    },
    ...overrides,
  };
}

describe('SmartDeploy mission evidence composition', () => {
  it('derives operating-location to activation-target geometry using canonical direction', () => {
    const result = composeMissionEvidence({ planningRequest: planning(), propagation: propagation(), observedRf: null });
    expect(result.geometry).toMatchObject({ status: 'derived', distanceKm: expect.any(Number), initialBearingDegrees: expect.any(Number), compassDirection: expect.any(String) });
    expect(result.geometry.originCoordinates).toEqual(operatingCoordinates);
    expect(result.geometry.destinationCoordinates).toEqual(activationCoordinates);
    expect(result.geometry.distanceKm).toBeGreaterThan(0);
    expect(result.geometry.initialBearingDegrees).toBeGreaterThan(0);
  });

  it('does not turn unavailable geometry into zero-valued evidence', () => {
    const result = composeMissionEvidence({ planningRequest: planning({ operatingLocation: { ...planning().operatingLocation, coordinates: null, provenance: 'unavailable' } }), propagation: propagation(), observedRf: null });
    expect(result.status).toBe('unavailable');
    expect(result.geometry).toMatchObject({ status: 'unavailable', distanceKm: null, initialBearingDegrees: null, compassDirection: null });
  });

  it('uses activation-site mission dates instead of the wall clock and handles a UTC date boundary', () => {
    const result = composeMissionEvidence({
      planningRequest: planning({ missionWindow: { start: '2026-08-18T23:00:00Z', end: '2026-08-19T05:00:00Z' } }),
      propagation: propagation(), observedRf: null,
    }, () => new Date('2035-01-01T00:00:00Z'));
    expect(result.solar.site).toBe('activation_target');
    expect(result.solar.siteCoordinates).toEqual(activationCoordinates);
    expect(result.solar.missionDatesUtc).toEqual(['2026-08-18', '2026-08-19']);
    expect(result.solar.days.map(day => day.date)).toEqual(['2026-08-18', '2026-08-19']);
    expect(result.solar.days[0].events.sunrise).toBe(calculateSolarEvents(activationCoordinates, '2026-08-18')!.events.sunrise!.toISOString());
    expect(result.generatedAtUtc).toBe('2035-01-01T00:00:00.000Z');
  });

  it('derives daylight, twilight, and darkness overlap facts without recommendations', () => {
    const solar = calculateSolarEvents(activationCoordinates, '2026-08-18')!;
    const civilDawn = solar.events.civilDawn!;
    const sunrise = solar.events.sunrise!;
    const twilight = composeMissionEvidence({
      planningRequest: planning({ missionWindow: { start: new Date(civilDawn.getTime() - 5 * 60_000).toISOString(), end: new Date(sunrise.getTime() + 5 * 60_000).toISOString() } }),
      propagation: propagation(), observedRf: null,
    });
    expect(twilight.solar.overlap.overlapsCivilTwilight).toBe(true);
    expect(twilight.solar.overlap.includesDaylight).toBe(true);

    const darkness = composeMissionEvidence({
      planningRequest: planning({ missionWindow: { start: '2026-08-18T02:00:00Z', end: '2026-08-18T03:00:00Z' } }),
      propagation: propagation(), observedRf: null,
    });
    expect(darkness.solar.overlap.entirelyDuringDarkness).toBe(true);
  });

  it('keeps solar failure non-blocking and preserves unavailable polar events', () => {
    const result = composeMissionEvidence({
      planningRequest: planning({ activationTarget: { ...planning().activationTarget, coordinates: { lat: 89, lon: 0 } } }),
      propagation: propagation(), observedRf: null,
    });
    expect(result.status).toBe('complete');
    expect(result.solar.status).toBe('derived');
    expect(result.solar.days[0].events.sunrise).toBeNull();
    expect(result.solar.overlap.includesDaylight).toBeNull();
  });

  it('keeps the evidence usable when the solar calculator is unavailable', () => {
    const result = composeMissionEvidence({ planningRequest: planning(), propagation: propagation(), observedRf: null }, undefined, () => null);
    expect(result.status).toBe('complete');
    expect(result.solar.status).toBe('unavailable');
    expect(result.solar.limitation).toContain('unavailable');
  });

  it('marks recent matching-grid observed RF applicable and preserves source metadata', () => {
    const snapshot = observedSnapshot({ reports: [{ observedAtUtc: '2026-08-18T13:55:00.000Z' } as any] });
    const result = composeMissionEvidence({ planningRequest: planning(), propagation: propagation(), observedRf: snapshot });
    expect(result.observedRf.status).toBe('observed');
    expect(result.observedRf.observationWindow).toEqual(snapshot.observationWindow);
    expect(result.observedRf.collectedAtUtc).toBe(snapshot.collectedAtUtc);
    expect(result.observedRf.reports).toBe(snapshot.reports);
  });

  it('allows only the explicit fifteen-minute near-future rule and rejects old evidence', () => {
    const nearFuture = composeMissionEvidence({
      planningRequest: planning({ missionWindow: { start: new Date(Date.parse('2026-08-18T14:00:00Z') + MISSION_OBSERVED_RF_APPLICABILITY_WINDOW_MS).toISOString(), end: '2026-08-18T16:00:00Z' } }),
      propagation: propagation(), observedRf: observedSnapshot(),
    });
    expect(nearFuture.observedRf.status).toBe('observed');

    const outside = composeMissionEvidence({
      planningRequest: planning({ missionWindow: { start: '2026-08-18T14:16:00Z', end: '2026-08-18T16:00:00Z' } }),
      propagation: propagation(), observedRf: observedSnapshot(),
    });
    expect(outside.observedRf.status).toBe('notTemporallyApplicable');

    const stale = composeMissionEvidence({ planningRequest: planning(), propagation: propagation(), observedRf: observedSnapshot({ status: 'stale', evidenceStatus: 'stale_observed_rf_source' }) });
    expect(stale.observedRf.status).toBe('stale');
  });

  it('rejects a grid mismatch and never blocks propagation when observed RF is absent', () => {
    const mismatch = composeMissionEvidence({ planningRequest: planning(), propagation: propagation('partial'), observedRf: observedSnapshot({ operatingGrid4: 'FN20' }) });
    expect(mismatch.observedRf.status).toBe('unavailable');
    expect(mismatch.propagation.status).toBe('partial');
    expect(mismatch.status).toBe('complete');

    const absent = composeMissionEvidence({ planningRequest: planning(), propagation: propagation(), observedRf: null });
    expect(absent.observedRf.status).toBe('unavailable');
    expect(absent.status).toBe('complete');
  });
});