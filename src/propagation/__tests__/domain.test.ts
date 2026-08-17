import { describe, expect, it } from 'vitest';
import { resolveOperatingLocation } from '../../location/operatingLocation';
import {
  ANTENNA_TYPES,
  DEPLOYMENT_GEOMETRIES,
  HEIGHT_CATEGORIES,
  isPropagationOperatingMode,
  isRegionalDestination,
  isSpecificDestination,
  isP533SupportedBand,
  isValidObservedRfEvidence,
  isValidStationProfile,
  PROPAGATION_OPERATING_MODES,
  PROPAGATION_GUIDANCE_BANDS,
  P533_SUPPORTED_BANDS,
  PROPAGATION_MODES,
  type PropagationBandAssessment,
  type PropagationEvidence,
  type PropagationRequest,
  type PropagationSourceReference,
  validatePropagationRequest,
} from '../domain';

const timestamps = {
  observedAt: '2026-08-16T12:00:00.000Z',
  receivedAt: '2026-08-16T12:00:05.000Z',
};

const modeledSource = {
  state: 'modeled' as const,
  source: { id: 'model:p533', type: 'local_propagation_model', name: 'Local propagation model' },
  timestamps,
};

const stationProfile = {
  mode: 'FT8' as const,
  transmitPowerWatts: 20,
  antenna: { type: 'EFHW' as const },
  deployment: { geometry: 'inverted_v' as const, heightCategory: 'low' as const },
};

const location = resolveOperatingLocation(
  { lat: 0, lon: 0, gridSquare: '' },
  { status: 'ok', source: { id: 'gps:test', type: 'serial_nmea', name: 'Test GNSS' }, timestamps },
);

describe('Slice 5A propagation domain', () => {
  it('preserves the ten supported HF bands and intended modes', () => {
    expect(PROPAGATION_GUIDANCE_BANDS).toEqual(['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m']);
    expect(PROPAGATION_GUIDANCE_BANDS).toContain('6m');
    expect(PROPAGATION_GUIDANCE_BANDS).not.toContain('60m');
    expect(PROPAGATION_MODES).toEqual(['SSB', 'CW', 'FT8', 'FT4', 'JS8', 'RTTY']);
  });

  it('keeps the P.533-supported subset explicit and outside the 6m boundary', () => {
    expect(P533_SUPPORTED_BANDS).toEqual(['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m']);
    expect(P533_SUPPORTED_BANDS).not.toContain('6m');
    expect(P533_SUPPORTED_BANDS.every(isP533SupportedBand)).toBe(true);
    expect(PROPAGATION_GUIDANCE_BANDS.filter(band => band !== '6m')).toEqual(P533_SUPPORTED_BANDS);
  });

  it('exposes the four explicit online/offline operating modes', () => {
    expect(PROPAGATION_OPERATING_MODES).toEqual([
      'online_live_enhanced',
      'online_partial',
      'offline_modeled',
      'offline_cached_modeled',
    ]);
    expect(PROPAGATION_OPERATING_MODES.every(isPropagationOperatingMode)).toBe(true);
  });

  it('represents online live-enhanced and partial evidence independently', () => {
    const evidence: PropagationEvidence = {
      model: { kind: 'model', model: 'P.533', provenance: modeledSource },
      currentEnvironment: { kind: 'current_environment', summary: { geomagnetic: 'quiet' }, provenance: { ...modeledSource, state: 'live' } },
      observedRf: {
        kind: 'observed_rf', observationWindow: { startsAt: timestamps.observedAt, endsAt: timestamps.receivedAt },
        band: '20m', mode: 'FT8', reportCount: 0, uniqueStationCount: 0, uniqueReporterCount: 0,
        provenance: { ...modeledSource, state: 'unavailable' },
      },
    };
    expect(evidence.model.provenance.state).toBe('modeled');
    expect(evidence.currentEnvironment?.provenance.state).toBe('live');
    expect(evidence.observedRf?.provenance.state).toBe('unavailable');
  });

  it('represents offline modeled-only and offline cached-plus-modeled states', () => {
    const modeledOnly: PropagationEvidence = { model: { kind: 'model', model: 'P.533', provenance: modeledSource } };
    const cached: PropagationEvidence = {
      ...modeledOnly,
      currentEnvironment: { kind: 'current_environment', summary: { solarFlux: 150 }, provenance: { ...modeledSource, state: 'cached' } },
    };
    expect(modeledOnly.currentEnvironment).toBeUndefined();
    expect(cached.currentEnvironment?.provenance.state).toBe('cached');
    expect(cached.currentEnvironment?.provenance.timestamps.observedAt).toBe(timestamps.observedAt);
  });

  it('keeps unavailable optional ionosphere evidence separate from the model', () => {
    const evidence: PropagationEvidence = {
      model: { kind: 'model', model: 'P.533', provenance: modeledSource },
      liveIonosphere: { kind: 'live_ionosphere', summary: {}, provenance: { ...modeledSource, state: 'unavailable' } },
    };
    expect(evidence.model.provenance.state).toBe('modeled');
    expect(evidence.liveIonosphere?.provenance.state).toBe('unavailable');
  });

  it('supports regional sample points, specific zero coordinates, and request validation', () => {
    const regional = { kind: 'regional' as const, regionId: 'western_europe', representativeSamplePoints: [{ lat: 51.5, lon: -0.1 }, { lat: 48.8, lon: 2.3 }] };
    const specific = { kind: 'specific' as const, coordinates: { lat: 0, lon: 0 }, resolver: 'coordinates' as const };
    const request: PropagationRequest = { operatingLocation: location, dateTimeUtc: timestamps.observedAt, stationProfile, destination: regional };
    expect(isRegionalDestination(regional)).toBe(true);
    expect(isSpecificDestination(specific)).toBe(true);
    expect(validatePropagationRequest(request)).toEqual([]);
    expect(isValidStationProfile(stationProfile)).toBe(true);
  });

  it('validates canonical antenna, deployment, and height vocabularies at runtime', () => {
    expect(ANTENNA_TYPES).toContain('EFHW');
    expect(DEPLOYMENT_GEOMETRIES).toContain('inverted_v');
    expect(HEIGHT_CATEGORIES).toEqual(['ground_level', 'low', 'elevated', 'unknown']);
    expect(isValidStationProfile({ ...stationProfile, antenna: { type: 'not-an-antenna' } })).toBe(false);
    expect(isValidStationProfile({ ...stationProfile, deployment: { geometry: 'not-a-geometry' } })).toBe(false);
    expect(isValidStationProfile({ ...stationProfile, deployment: { geometry: 'inverted_v', heightCategory: 'not-a-height' } })).toBe(false);
    expect(isValidStationProfile({ ...stationProfile, deployment: { geometry: 'other', heightCategory: 'unknown' } })).toBe(true);
    expect(isValidStationProfile({ ...stationProfile, antenna: { type: 'custom' }, deployment: { geometry: 'other' } })).toBe(true);
  });

  it('represents rating and confidence independently and preserves zero RF reports', () => {
    const assessment: PropagationBandAssessment = {
      band: '40m', rating: 'GOOD', confidence: 'modeled_only',
      modelResult: { status: 'available', modelName: 'P.533', calculationTimeUtc: timestamps.observedAt },
      reasons: [{ text: 'Model result available.', sourceStates: ['modeled'] }],
      cautions: [{ text: 'Observed RF evidence unavailable.', sourceStates: ['unavailable'] }],
      provenance: [modeledSource],
    };
    const observed: unknown = {
      kind: 'observed_rf', observationWindow: { startsAt: timestamps.observedAt, endsAt: timestamps.receivedAt },
      band: '40m', mode: 'CW', reportCount: 0, uniqueStationCount: 0, uniqueReporterCount: 0,
      provenance: { ...modeledSource, state: 'stale' },
    };
    expect(assessment.rating).toBe('GOOD');
    expect(assessment.confidence).toBe('modeled_only');
    expect(isValidObservedRfEvidence(observed)).toBe(true);
  });
});