import { describe, expect, it } from 'vitest';
import { DEFAULT_STATION_PROFILE } from '../stationProfileCatalog';
import {
  createPropagationDecisionBasis,
  deriveEvidenceAgreement,
  deriveConfidence,
  deriveModeRelevance,
  deriveOperatingMode,
  interpretEnvironment,
  interpretModelEvidence,
  interpretObservedRfEvidence,
  type EvidenceSynthesisInput,
  type ModelEvidenceInput,
  type ObservedRfEvidenceInput,
  type SpaceWeatherEvidenceInput,
} from '../evidenceSynthesis';

const NOW = '2026-08-16T12:00:00.000Z';

const product = <T extends number | string | null>(value: T, state: 'live' | 'cached' | 'stale' | 'unavailable' = 'live') => ({ value, state, observedAtUtc: NOW, receivedAtUtc: NOW });
const model: ModelEvidenceInput = { state: 'available', medianBcrPercent: 80, bcrSpreadPercent: 10, snrDb: { minimum: 10, maximum: 20, median: 15 }, successfulSampleCount: 5, sampleCount: 5, modeledAtUtc: NOW, modelRevision: 'P.533-14', assumptions: { stationProfileFullyModeled: false, antennaModel: 'ISOTROPIC', modeInterpretation: 'Reference modulation and SNR assumptions.' }, provenance: { model: 'ITU-R P.533', recommendation: 'P.533-14', engine: 'ITU-R-HF v14.3' } };
const environment: SpaceWeatherEvidenceInput = { status: 'live', fetchedAtUtc: NOW, f107: product(150), ssn: product(120), kp: product(1), rScale: product(0), latestGoesFlareClass: product('C1.0') };
const observedRf: ObservedRfEvidenceInput = { state: 'live', reportCount: 8, uniquePathCount: 4, uniqueRemoteCallsignCount: 3, outboundReportCount: 5, inboundReportCount: 3, modeCounts: { FT8: 8 }, snrDb: { minimum: -20, maximum: 0, median: -10 }, newestObservationAt: NOW, observationWindow: { startsAt: '2026-08-16T11:45:00.000Z', endsAt: NOW }, sourceName: 'PSKReporter reports via mqtt.pskreporter.info', digitalOnlyLimitation: true };

function input(overrides: { band?: EvidenceSynthesisInput['band']; destinationRegion?: EvidenceSynthesisInput['destinationRegion']; stationProfile?: EvidenceSynthesisInput['stationProfile']; model?: Partial<ModelEvidenceInput>; environment?: Partial<SpaceWeatherEvidenceInput>; observedRf?: Partial<ObservedRfEvidenceInput>; nowUtc?: string } = {}): EvidenceSynthesisInput {
  return {
    band: overrides.band ?? '20m', destinationRegion: overrides.destinationRegion ?? 'western_europe', selectedTimeUtc: NOW, stationProfile: overrides.stationProfile ?? DEFAULT_STATION_PROFILE,
    model: { ...model, ...overrides.model },
    environment: { ...environment, ...overrides.environment },
    observedRf: { ...observedRf, ...overrides.observedRf },
    nowUtc: overrides.nowUtc ?? NOW,
  };
}

describe('Slice 5H-A evidence synthesis contracts', () => {
  it('keeps categorical rating separate from confidence and does not assign a final rating', () => {
    const basis = createPropagationDecisionBasis(input());
    expect(basis).toMatchObject({ band: '20m', destinationRegion: 'western_europe' });
    expect(basis.sourceCoverage).toEqual({ model: 'available', spaceWeather: 'live', observedRf: 'live', ionosphere: 'future' });
    expect(basis.limitations).toContain('reference_antenna_assumptions');
  });

  it('interprets favorable, uneven, marginal, unfavorable, and unsupported model evidence without mutating BCR', () => {
    expect(interpretModelEvidence(model).state).toBe('very_favorable');
    expect(interpretModelEvidence({ ...model, bcrSpreadPercent: 40 }).regionalSpreadCaution).toBe(true);
    expect(interpretModelEvidence({ ...model, medianBcrPercent: 55, successfulSampleCount: 3 }).state).toBe('favorable');
    expect(interpretModelEvidence({ ...model, medianBcrPercent: 35, successfulSampleCount: 1 }).state).toBe('marginal');
    expect(interpretModelEvidence({ ...model, medianBcrPercent: 10, successfulSampleCount: 0 }).state).toBe('unfavorable');
    expect(interpretModelEvidence({ ...model, state: 'unsupported', medianBcrPercent: null }).state).toBe('unavailable');
    expect(interpretModelEvidence({ ...model, medianBcrPercent: null }).state).toBe('unavailable');
    expect(interpretModelEvidence({ ...model, medianBcrPercent: Number.NaN }).state).toBe('unavailable');
    expect(interpretModelEvidence({ ...model, successfulSampleCount: 6 }).state).toBe('unavailable');
    expect(interpretModelEvidence({ ...model, medianBcrPercent: 0, successfulSampleCount: 0 }).state).toBe('unfavorable');
    expect(model.medianBcrPercent).toBe(80);
  });

  it('distinguishes strongly observed, observed, limited, none observed, and unavailable RF', () => {
    expect(interpretObservedRfEvidence(observedRf, NOW).state).toBe('strongly_observed');
    expect(interpretObservedRfEvidence({ ...observedRf, reportCount: 1, uniquePathCount: 1, uniqueRemoteCallsignCount: 1 }, NOW).state).toBe('observed');
    expect(interpretObservedRfEvidence({ ...observedRf, state: 'stale' }, NOW).state).toBe('limited');
    expect(interpretObservedRfEvidence({ ...observedRf, reportCount: 0, uniquePathCount: 0, uniqueRemoteCallsignCount: 0 }, NOW).state).toBe('none_observed');
    expect(interpretObservedRfEvidence({ ...observedRf, state: 'unavailable', reportCount: 0 }, NOW).state).toBe('unavailable');
  });

  it('exports an explicit semantic mode-relevance policy with reachable indirect evidence', () => {
    expect(deriveModeRelevance('FT8', { FT8: 4 })).toBe('direct');
    expect(deriveModeRelevance('FT4', { FT8: 4 })).toBe('adjacent');
    expect(deriveModeRelevance('JS8', { FT8: 4 })).toBe('adjacent');
    expect(deriveModeRelevance('SSB', { FT8: 4 })).toBe('indirect');
    expect(deriveModeRelevance('CW', { FT8: 4 })).toBe('indirect');
    expect(deriveModeRelevance('RTTY', { FT8: 4 })).toBe('adjacent');
    expect(deriveModeRelevance('SSB', { SSB: 1 })).toBe('direct');
    expect(deriveModeRelevance('SSB', {})).toBe('none');
  });

  it('represents model-observed agreement and observed opening explicitly', () => {
    const favorable = interpretModelEvidence(model);
    const strong = interpretObservedRfEvidence(observedRf, NOW);
    expect(deriveEvidenceAgreement(favorable, strong)).toBe('confirmed');
    expect(deriveEvidenceAgreement(interpretModelEvidence({ ...model, medianBcrPercent: 15, successfulSampleCount: 0 }), strong)).toBe('observed_opening');
    expect(deriveEvidenceAgreement(favorable, interpretObservedRfEvidence({ ...observedRf, state: 'live', reportCount: 0 }, NOW))).toBe('weakly_unconfirmed');
    expect(deriveEvidenceAgreement(favorable, interpretObservedRfEvidence({ ...observedRf, state: 'unavailable' }, NOW))).toBe('model_only');
  });

  it('maps NOAA values to descriptive environment states without changing model evidence', () => {
    expect(interpretEnvironment(environment).state).toBe('favorable');
    expect(interpretEnvironment({ ...environment, kp: product(6) }).state).toBe('disturbed');
    expect(interpretEnvironment({ ...environment, kp: product(8) }).state).toBe('severely_disturbed');
    expect(interpretEnvironment({ ...environment, rScale: product(3) })).toMatchObject({ state: 'radio_blackout', hfBlackoutSeverity: 'R3', sunlitPathApplicability: 'unknown', applicabilityUnknown: true });
    expect(interpretEnvironment({ ...environment, status: 'stale', rScale: product(3, 'stale'), kp: product(8, 'stale') })).toMatchObject({ state: 'stale', hfBlackoutSeverity: 'R3' });
    expect(interpretEnvironment({ ...environment, status: 'cached', rScale: product(3, 'cached'), kp: product(1, 'cached') })).toMatchObject({ state: 'cached_context', hfBlackoutSeverity: 'R3' });
    expect(interpretEnvironment({ ...environment, status: 'stale', rScale: product(0, 'stale'), kp: product(1, 'stale') }).state).toBe('stale');
    expect(interpretEnvironment({ ...environment, status: 'partial', rScale: product(null, 'unavailable'), kp: product(8) }).state).toBe('partial');
    expect(interpretEnvironment({ ...environment, status: 'unavailable', kp: product(null), rScale: product(null) }).state).toBe('unavailable');
  });

  it('derives the required operating modes and source coverage', () => {
    expect(deriveOperatingMode({ model: 'available', spaceWeather: 'live', observedRf: 'live', ionosphere: 'future' }, interpretObservedRfEvidence(observedRf, NOW))).toBe('online_live_enhanced');
    expect(deriveOperatingMode({ model: 'available', spaceWeather: 'live', observedRf: 'unavailable', ionosphere: 'future' }, interpretObservedRfEvidence({ ...observedRf, state: 'unavailable' }, NOW))).toBe('online_partial');
    expect(deriveOperatingMode({ model: 'available', spaceWeather: 'unavailable', observedRf: 'cached', ionosphere: 'future' }, interpretObservedRfEvidence({ ...observedRf, state: 'cached' }, NOW))).toBe('offline_cached_modeled');
    expect(deriveOperatingMode({ model: 'available', spaceWeather: 'unavailable', observedRf: 'unavailable', ionosphere: 'future' }, interpretObservedRfEvidence({ ...observedRf, state: 'unavailable' }, NOW))).toBe('offline_modeled');
    expect(deriveOperatingMode({ model: 'unsupported', spaceWeather: 'live', observedRf: 'live', ionosphere: 'future' }, interpretObservedRfEvidence(observedRf, NOW))).toBe('observed_only');
    expect(deriveOperatingMode({ model: 'unavailable', spaceWeather: 'unavailable', observedRf: 'unavailable', ionosphere: 'future' }, interpretObservedRfEvidence({ ...observedRf, state: 'unavailable' }, NOW))).toBe('unavailable');
  });

  it('supports 6m observed-only evidence without forcing it through P.533', () => {
    const basis = createPropagationDecisionBasis(input({ band: '6m', model: { state: 'unsupported', medianBcrPercent: null }, environment: { status: 'unavailable', kp: product(null), rScale: product(null) } }));
    expect(basis.model.state).toBe('unavailable');
    expect(basis.sourceCoverage.model).toBe('unsupported');
    expect(basis.limitations).toContain('model_unsupported');
  });

  it('keeps local digital activity separate from NVIS claims', () => {
    const basis = createPropagationDecisionBasis(input({ destinationRegion: 'local_nvis', observedRf: { reportCount: 2, uniquePathCount: 1, uniqueRemoteCallsignCount: 1 } }));
    expect(basis.destinationRegion).toBe('local_nvis');
    expect(basis.limitations).toContain('local_mechanism_unknown');
    expect(basis.cautions.some(caution => caution.code === 'local_mechanism_unknown')).toBe(true);
  });

  it('preserves cached, stale, NOAA partial, and fully offline semantics', () => {
    const cached = createPropagationDecisionBasis(input({ observedRf: { state: 'cached' }, environment: { status: 'partial' } }));
    expect(cached.sourceCoverage).toMatchObject({ observedRf: 'cached', spaceWeather: 'partial' });
    const stale = createPropagationDecisionBasis(input({ observedRf: { state: 'stale' }, environment: { status: 'stale' } }));
    expect(stale.cautions.some(caution => caution.code === 'stale_observed_rf')).toBe(true);
    expect(stale.cautions.some(caution => caution.code === 'space_weather_stale')).toBe(true);
    const offlineBasis = createPropagationDecisionBasis(input({ observedRf: { state: 'unavailable' }, environment: { status: 'unavailable', kp: product(null), rScale: product(null) } }));
    expect(offlineBasis.agreement).toBe('model_only');
    const livePsksStaleNoaa = createPropagationDecisionBasis(input({ environment: { status: 'stale', kp: product(1, 'stale'), rScale: product(0, 'stale') } }));
    expect(deriveConfidence(livePsksStaleNoaa)).not.toBe('high');
    expect(deriveOperatingMode(livePsksStaleNoaa.sourceCoverage, livePsksStaleNoaa.observedRf)).toBe('online_partial');
    const modeledWithStaleNoaa = createPropagationDecisionBasis(input({ observedRf: { state: 'unavailable' }, environment: { status: 'stale', kp: product(1, 'stale'), rScale: product(0, 'stale') } }));
    expect(deriveConfidence(modeledWithStaleNoaa)).toBe('modeled_only');
    expect(deriveOperatingMode(modeledWithStaleNoaa.sourceCoverage, modeledWithStaleNoaa.observedRf)).toBe('offline_cached_modeled');
    expect(modeledWithStaleNoaa.cautions.some(caution => caution.code === 'current_radio_blackout')).toBe(false);
  });

  it('retains traceability for station profile, model, NOAA, PSK, and observation window', () => {
    const basis = createPropagationDecisionBasis(input());
    expect(basis.stationProfile).toEqual(DEFAULT_STATION_PROFILE);
    expect(basis.evidenceFreshness).toEqual({ modelAtUtc: NOW, spaceWeatherFetchedAtUtc: NOW, observedWindow: observedRf.observationWindow });
  });
});
