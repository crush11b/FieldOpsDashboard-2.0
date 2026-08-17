import { describe, expect, it } from 'vitest';
import { DEFAULT_STATION_PROFILE } from '../stationProfileCatalog';
import { PROPAGATION_GUIDANCE_BANDS } from '../domain';
import {
  PROPAGATION_RATING_POLICY_VERSION,
  adaptRegionalEvidenceToSynthesisInput,
  capRating,
  degradeOneLevel,
  evaluatePropagationBand,
  evaluatePropagationBands,
  evaluateRegionalBandAssessments,
  promoteOneLevel,
  type PropagationBandAssessment,
} from '../ratingEvaluator';
import type { EvidenceSynthesisInput, ModelEvidenceInput, ObservedRfEvidenceInput, SpaceWeatherEvidenceInput } from '../evidenceSynthesis';
import type { RegionalP533Result } from '../regionalP533';
import type { RegionalObservedRfSnapshot } from '../regionalObservedRf';
import type { SpaceWeatherSnapshot } from '../../../server/spaceWeather';

const NOW = '2026-08-16T12:00:00.000Z';
const product = <T extends number | string | null>(value: T, state: 'live' | 'cached' | 'stale' | 'unavailable' = 'live') => ({ value, state, observedAtUtc: NOW, receivedAtUtc: NOW });
const quietEnvironment: SpaceWeatherEvidenceInput = { status: 'live', fetchedAtUtc: NOW, f107: product(150), ssn: product(120), kp: product(1), rScale: product(0), latestGoesFlareClass: product('C1.0') };
const baseModel: ModelEvidenceInput = { state: 'available', medianBcrPercent: 80, bcrSpreadPercent: 10, snrDb: { minimum: 10, maximum: 20, median: 15 }, successfulSampleCount: 5, sampleCount: 5, modeledAtUtc: NOW, modelRevision: 'P.533-14', assumptions: { stationProfileFullyModeled: false, antennaModel: 'ISOTROPIC', modeInterpretation: 'Reference modulation and SNR assumptions.' }, provenance: { model: 'ITU-R P.533', recommendation: 'P.533-14', engine: 'ITU-R-HF v14.3' } };
const strongObserved: ObservedRfEvidenceInput = { state: 'live', reportCount: 8, uniquePathCount: 4, uniqueRemoteCallsignCount: 3, outboundReportCount: 5, inboundReportCount: 3, modeCounts: { FT8: 8 }, snrDb: { minimum: -20, maximum: 0, median: -10 }, newestObservationAt: NOW, observationWindow: { startsAt: '2026-08-16T11:45:00.000Z', endsAt: NOW }, sourceName: 'PSKReporter reports via mqtt.pskreporter.info', digitalOnlyLimitation: true };

function synthesisInput(overrides: { band?: EvidenceSynthesisInput['band']; region?: EvidenceSynthesisInput['destinationRegion']; profile?: EvidenceSynthesisInput['stationProfile']; model?: Partial<ModelEvidenceInput>; environment?: Partial<SpaceWeatherEvidenceInput>; observedRf?: Partial<ObservedRfEvidenceInput> } = {}): EvidenceSynthesisInput {
  return { band: overrides.band ?? '20m', destinationRegion: overrides.region ?? 'western_europe', selectedTimeUtc: NOW, stationProfile: overrides.profile ?? { ...DEFAULT_STATION_PROFILE, mode: 'FT8' }, model: { ...baseModel, ...overrides.model }, environment: { ...quietEnvironment, ...overrides.environment }, observedRf: { ...strongObserved, ...overrides.observedRf }, nowUtc: NOW };
}

function assessment(overrides: Parameters<typeof synthesisInput>[0] = {}): PropagationBandAssessment {
  return evaluatePropagationBand(synthesisInput(overrides));
}

function modelFor(medianBcrPercent: number | null, state: ModelEvidenceInput['state'] = 'available', overrides: Partial<ModelEvidenceInput> = {}): Partial<ModelEvidenceInput> {
  return { state, medianBcrPercent, ...overrides };
}

function staleEnvironment(rScale = 0, kp = 1): Partial<SpaceWeatherEvidenceInput> {
  return { status: 'stale', kp: product(kp, 'stale'), rScale: product(rScale, 'stale') };
}

function summary(band: typeof PROPAGATION_GUIDANCE_BANDS[number], reportCount = 8, modeCounts: Readonly<Record<string, number>> = { FT8: reportCount }) {
  return { regionId: 'western_europe' as const, band, reportCount, outboundReportCount: reportCount, inboundReportCount: 0, localReportCount: 0, uniqueRemoteCallsignCount: reportCount ? 3 : 0, uniquePathCount: reportCount ? 4 : 0, modeCounts, newestReportAt: reportCount ? NOW : null, oldestReportAt: reportCount ? NOW : null, snrDb: { minimum: -20, maximum: 0, median: -10 }, locatorCoverage: { reportsWithRemoteLocator: reportCount, percentage: reportCount ? 100 : null }, classificationCoverage: { classifiedReportCount: reportCount, percentage: reportCount ? 100 : null } };
}

function realPipelineFixtures(): { regionalP533: RegionalP533Result; spaceWeather: SpaceWeatherSnapshot; regionalObservedRf: RegionalObservedRfSnapshot } {
  const bandResults = PROPAGATION_GUIDANCE_BANDS.filter(band => band !== '6m').map(band => ({ band, modelFrequencyMHz: 14, samples: [], summary: { sampleCount: 5, successfulSampleCount: 5, failedSampleCount: 0, basicCircuitReliabilityPercent: { minimum: 70, maximum: 90, median: 80 }, snrDb: { minimum: 10, maximum: 20, median: 15 }, receivedPowerDb: { minimum: -100, maximum: -80, median: -90 }, basicMufMHz: { minimum: 15, maximum: 20, median: 17 }, sampleFailures: [] } }));
  const item = (productName: 'f107' | 'ssn' | 'kp' | 'rScale' | 'xray', value: number | string): any => ({ product: productName, value, state: 'live', observedAt: NOW, receivedAt: NOW, source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } });
  return {
    regionalP533: { status: 'complete', regionId: 'western_europe', regionLabel: 'Western Europe', operatingLocation: {} as never, stationProfile: { ...DEFAULT_STATION_PROFILE, mode: 'FT8' }, assumptions: { antennaModel: 'ISOTROPIC', antennaGainOffsetDb: 0, bandwidthHz: 3000, requiredSnrDb: 15, requiredReliabilityPercent: 90, noiseEnvironment: 'RESIDENTIAL', modulation: 'ANALOG', pathDirection: 'SHORTPATH', modeInterpretation: 'Station mode is preserved as metadata; P.533 uses the explicit provisional reference modulation and SNR/bandwidth assumptions.', antennaInterpretation: 'Selected antenna and deployment are preserved as metadata; no radiation-pattern or dBi adjustment is applied.' }, modeledAtUtc: NOW, ssn: 120, unsupportedBands: ['6m'], provenance: { sourceState: 'modeled', model: 'ITU-R P.533', recommendation: 'P.533-14', engine: 'ITU-R-HF v14.3', assetProvenance: null }, bandResults, sampleCount: 5, executionCount: 45, elapsedMs: 1 },
    spaceWeather: { kind: 'noaa_space_weather', status: 'live', fetchedAt: NOW, products: { f107: item('f107', 150), ssn: item('ssn', 120), kp: item('kp', 1), rScale: item('rScale', 0), xray: item('xray', 'C1.0') } },
    regionalObservedRf: { kind: 'regional_observed_rf', sourceStatus: 'live', operatingGrid4: 'FM18', observationWindow: { startsAt: '2026-08-16T11:45:00.000Z', endsAt: NOW }, collectedAtUtc: NOW, sourceProvenance: { sourceId: 'pskreporter-via-mqtt', sourceName: 'PSKReporter reports via mqtt.pskreporter.info', semantics: 'regional_observed_rf', transport: 'mqtts-websocket', brokerHost: 'mqtt.pskreporter.info', brokerPort: 1886, topicPatterns: [] }, classifiedReportCount: 8, unclassifiedReportCount: 0, insufficientLocationCount: 0, localReportCount: 0, reports: [], classifiedReports: [], regionBandSummaries: PROPAGATION_GUIDANCE_BANDS.map(band => summary(band)), },
  } as { regionalP533: RegionalP533Result; spaceWeather: SpaceWeatherSnapshot; regionalObservedRf: RegionalObservedRfSnapshot };
}

describe('Slice 5H-B explainable propagation rating evaluator', () => {
  it('locks the policy version, ordered helpers, and no weighted score field', () => {
    expect(PROPAGATION_RATING_POLICY_VERSION).toBe('regional_guidance_v1');
    expect(promoteOneLevel('POOR')).toBe('FAIR');
    expect(promoteOneLevel('EXCELLENT')).toBe('EXCELLENT');
    expect(degradeOneLevel('EXCELLENT')).toBe('GOOD');
    expect(degradeOneLevel('POOR')).toBe('POOR');
    expect(capRating('EXCELLENT', 'FAIR')).toBe('FAIR');
    expect(Object.keys(assessment())).not.toContain('score');
  });

  it('maps model opportunity to baseline ratings', () => {
    const noObservation = { state: 'unavailable' as const, reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} };
    expect(assessment({ model: modelFor(80), observedRf: noObservation }).rating).toBe('EXCELLENT');
    expect(assessment({ model: modelFor(60), observedRf: noObservation }).rating).toBe('GOOD');
    expect(assessment({ model: modelFor(35), observedRf: noObservation }).rating).toBe('FAIR');
    expect(assessment({ model: modelFor(0), observedRf: noObservation }).rating).toBe('POOR');
    expect(assessment({ model: modelFor(null), observedRf: noObservation }).rating).toBe('UNAVAILABLE');
  });

  it('handles confirmation, conservative promotion, and zero reports', () => {
    expect(assessment({ model: modelFor(80) })).toMatchObject({ rating: 'EXCELLENT', confidence: 'high' });
    expect(assessment({ model: modelFor(60) })).toMatchObject({ rating: 'EXCELLENT', confidence: 'high' });
    expect(assessment({ model: modelFor(60), observedRf: { reportCount: 1, uniquePathCount: 1, uniqueRemoteCallsignCount: 1 } }).rating).toBe('GOOD');
    expect(assessment({ model: modelFor(60), observedRf: { reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} } })).toMatchObject({ rating: 'GOOD', confidence: 'medium' });
    expect(assessment({ model: modelFor(60), observedRf: { state: 'unavailable', reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} } })).toMatchObject({ rating: 'GOOD', confidence: 'medium' });
  });

  it('applies observed openings with mode limits', () => {
    expect(assessment({ model: modelFor(35) })).toMatchObject({ rating: 'GOOD' });
    expect(assessment({ model: modelFor(0) })).toMatchObject({ rating: 'FAIR' });
    expect(assessment({ model: modelFor(0), profile: { ...DEFAULT_STATION_PROFILE, mode: 'SSB' } })).toMatchObject({ rating: 'FAIR', confidence: 'low' });
    expect(assessment({ model: modelFor(0), profile: { ...DEFAULT_STATION_PROFILE, mode: 'FT4' } })).toMatchObject({ rating: 'FAIR' });
  });

  it('never promotes stale, cached, or empty evidence and keeps historical NOAA outside rating rules', () => {
    expect(assessment({ model: modelFor(60), observedRf: { state: 'stale' } }).rating).toBe('GOOD');
    expect(assessment({ model: modelFor(60), observedRf: { state: 'cached' } }).rating).toBe('GOOD');
    expect(assessment({ model: modelFor(80), environment: staleEnvironment(3, 8) })).toMatchObject({ rating: 'EXCELLENT' });
    expect(assessment({ model: modelFor(60), environment: { status: 'cached', kp: product(1, 'cached'), rScale: product(0, 'cached') } }).rating).toBe('GOOD');
  });

  it('qualifies current disturbed, severe, and blackout environments after observations', () => {
    expect(assessment({ model: modelFor(60), observedRf: { state: 'live', reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} }, environment: { kp: product(6), rScale: product(0) } })).toMatchObject({ rating: 'FAIR' });
    expect(assessment({ model: modelFor(80), observedRf: { state: 'live', reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} }, environment: { kp: product(8), rScale: product(0) } })).toMatchObject({ rating: 'FAIR' });
    expect(assessment({ model: modelFor(80), environment: { kp: product(8), rScale: product(0) } })).toMatchObject({ rating: 'GOOD' });
    expect(assessment({ model: modelFor(80), observedRf: { reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} }, environment: { rScale: product(3) } })).toMatchObject({ rating: 'FAIR' });
    expect(assessment({ model: modelFor(80), environment: { rScale: product(3) } })).toMatchObject({ rating: 'GOOD' });
  });

  it('supports observed-only 6m guidance and defers local NVIS', () => {
    expect(assessment({ band: '6m', model: modelFor(null, 'unsupported') })).toMatchObject({ rating: 'GOOD', confidence: 'low' });
    expect(assessment({ band: '6m', model: modelFor(null, 'unsupported'), observedRf: { reportCount: 1, uniquePathCount: 1, uniqueRemoteCallsignCount: 1 } }).rating).toBe('FAIR');
    expect(assessment({ band: '6m', model: modelFor(null, 'unsupported'), profile: { ...DEFAULT_STATION_PROFILE, mode: 'SSB' } })).toMatchObject({ rating: 'FAIR' });
    expect(assessment({ band: '6m', model: modelFor(null, 'unsupported'), observedRf: { reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} } }).rating).toBe('UNAVAILABLE');
    expect(assessment({ band: '6m', model: modelFor(null, 'unsupported'), observedRf: { state: 'unavailable' } }).rating).toBe('UNAVAILABLE');
    expect(assessment({ region: 'local_nvis' })).toMatchObject({ rating: 'UNAVAILABLE', confidence: 'unavailable' });
  });

  it('derives conservative confidence and records every rating route', () => {
    expect(assessment({ model: modelFor(60), profile: { ...DEFAULT_STATION_PROFILE, mode: 'FT4' } })).toMatchObject({ rating: 'GOOD', confidence: 'medium' });
    expect(assessment({ model: modelFor(80, 'partial') })).not.toMatchObject({ confidence: 'high' });
    expect(assessment({ model: modelFor(80, 'available', { bcrSpreadPercent: 40 }) })).not.toMatchObject({ confidence: 'high' });
    expect(assessment({ model: modelFor(60), observedRf: { state: 'unavailable' } })).toMatchObject({ rating: 'GOOD', confidence: 'medium' });
    expect(assessment({ model: modelFor(null, 'unsupported'), observedRf: { state: 'unavailable' }, environment: { status: 'unavailable', kp: product(null, 'unavailable'), rScale: product(null, 'unavailable') } })).toMatchObject({ rating: 'UNAVAILABLE', confidence: 'unavailable' });
    expect(assessment().ratingDecisionSteps.length).toBeGreaterThan(0);
    expect(assessment({ model: modelFor(80), observedRf: { reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} } }).ratingDecisionSteps.map(step => step.ruleId)).toContain('model_baseline_very_favorable');
  });

  it('handles central disagreement cases explicitly', () => {
    expect(assessment({ model: modelFor(80), observedRf: { reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} } }).rating).toBe('EXCELLENT');
    expect(assessment({ model: modelFor(0) }).rating).toBe('FAIR');
    expect(assessment({ model: modelFor(0), profile: { ...DEFAULT_STATION_PROFILE, mode: 'SSB' } }).rating).toBe('FAIR');
    expect(assessment({ model: modelFor(60), environment: { kp: product(8), rScale: product(0) } }).rating).toBe('GOOD');
    expect(assessment({ model: modelFor(80), observedRf: { reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} }, environment: { rScale: product(3) } }).rating).toBe('FAIR');
  });

  it('adapts real normalized regional sources and returns canonical ten-band order', () => {
    const fixtures = realPipelineFixtures();
    const normalized = adaptRegionalEvidenceToSynthesisInput({ band: '20m', destinationRegion: 'western_europe', selectedTimeUtc: NOW, nowUtc: NOW, ...fixtures });
    expect(normalized.model.medianBcrPercent).toBe(80);
    expect(normalized.environment.kp.value).toBe(1);
    expect(normalized.observedRf.modeCounts).toEqual({ FT8: 8 });
    expect(evaluatePropagationBand(normalized)).toMatchObject({ rating: 'EXCELLENT', ratingPolicyVersion: PROPAGATION_RATING_POLICY_VERSION });
    const bands = evaluateRegionalBandAssessments({ destinationRegion: 'western_europe', selectedTimeUtc: NOW, nowUtc: NOW, ...fixtures });
    expect(bands).toHaveLength(10);
    expect(bands.map(result => result.band)).toEqual([...PROPAGATION_GUIDANCE_BANDS]);
    expect(evaluatePropagationBands([normalized, { ...normalized, band: '6m', model: { ...normalized.model, state: 'unsupported', medianBcrPercent: null }, observedRf: { ...normalized.observedRf, reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0, modeCounts: {} } }]).map(result => result.band)).toEqual(['20m', '6m']);
  });
});
