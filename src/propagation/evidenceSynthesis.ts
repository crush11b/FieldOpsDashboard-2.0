import type {
  PropagationConfidence,
  PropagationGuidanceBand,
  PropagationOperatingMode,
  PropagationRating,
  PropagationSourceState,
  StationProfile,
} from './domain';
import { PROPAGATION_MODES, type PropagationMode } from './domain';
import type { PropagationRegionId } from './regionalDestinations';

export type ModelState = 'available' | 'partial' | 'unavailable' | 'unsupported';
export type ModelOpportunityState = 'very_favorable' | 'favorable' | 'marginal' | 'unfavorable' | 'unavailable';
export type ObservedRfActivityState = 'strongly_observed' | 'observed' | 'limited' | 'none_observed' | 'unavailable';
export type EnvironmentState = 'favorable' | 'quiet' | 'disturbed' | 'severely_disturbed' | 'radio_blackout' | 'partial' | 'unavailable';
export type EvidenceAgreementState = 'confirmed' | 'consistent' | 'model_only' | 'observed_opening' | 'contradictory' | 'weakly_unconfirmed' | 'insufficient';
export type ModeRelevance = 'direct' | 'adjacent' | 'indirect' | 'none';
export type SourceCoverageState = 'available' | 'partial' | 'unsupported' | 'live' | 'cached' | 'stale' | 'unavailable' | 'future';
export type HfBlackoutSeverity = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | null;

export type ReasonCode =
  | 'model_very_favorable' | 'model_favorable' | 'model_marginal' | 'model_unfavorable'
  | 'model_samples_successful' | 'observed_paths_to_region' | 'observed_activity_current'
  | 'environment_quiet' | 'environment_favorable' | 'evidence_confirmed'
  | 'observed_opening' | 'modeled_only_guidance' | 'observed_only_guidance';

export type CautionCode =
  | 'model_reference_antenna_assumptions' | 'model_regional_spread_wide' | 'partial_model_samples'
  | 'model_unsupported_band' | 'digital_only_observed_rf' | 'no_current_observation'
  | 'stale_observed_rf' | 'space_weather_stale' | 'space_weather_unavailable'
  | 'current_radio_blackout' | 'current_conditions_disturbed' | 'evidence_weakly_unconfirmed'
  | 'evidence_contradictory' | 'mode_indirectly_supported' | 'local_mechanism_unknown';

export type SynthesisLimitationCode = 'reference_antenna_assumptions' | 'digital_only' | 'no_ionosphere' | 'model_unsupported' | 'local_mechanism_unknown';

export interface NumericEvidenceSummary {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly median: number | null;
}

export interface ModelEvidenceInput {
  readonly state: ModelState;
  readonly medianBcrPercent: number | null;
  readonly bcrSpreadPercent: number | null;
  readonly snrDb: NumericEvidenceSummary;
  readonly successfulSampleCount: number;
  readonly sampleCount: number;
  readonly modeledAtUtc: string | null;
  readonly modelRevision: string;
  readonly assumptions: {
    readonly stationProfileFullyModeled: false;
    readonly antennaModel: string;
    readonly modeInterpretation: string;
  };
  readonly provenance: { readonly model: 'ITU-R P.533'; readonly recommendation: string; readonly engine: string };
}

export interface ObservedRfEvidenceInput {
  readonly state: Extract<PropagationSourceState, 'live' | 'cached' | 'stale' | 'unavailable'>;
  readonly reportCount: number;
  readonly uniquePathCount: number;
  readonly uniqueRemoteCallsignCount: number;
  readonly outboundReportCount: number;
  readonly inboundReportCount: number;
  readonly modeCounts: Readonly<Record<string, number>>;
  readonly snrDb: NumericEvidenceSummary;
  readonly newestObservationAt: string | null;
  readonly observationWindow: { readonly startsAt: string; readonly endsAt: string } | null;
  readonly sourceName: string;
  readonly digitalOnlyLimitation: true;
}

export interface SpaceWeatherProductInput<T extends number | string | null> {
  readonly value: T;
  readonly state: Extract<PropagationSourceState, 'live' | 'cached' | 'stale' | 'unavailable'>;
  readonly observedAtUtc: string | null;
  readonly receivedAtUtc: string | null;
}

export interface SpaceWeatherEvidenceInput {
  readonly status: 'live' | 'partial' | 'cached' | 'stale' | 'unavailable';
  readonly fetchedAtUtc: string | null;
  readonly f107: SpaceWeatherProductInput<number | null>;
  readonly ssn: SpaceWeatherProductInput<number | null>;
  readonly kp: SpaceWeatherProductInput<number | null>;
  readonly rScale: SpaceWeatherProductInput<number | null>;
  readonly latestGoesFlareClass: SpaceWeatherProductInput<string | null>;
}

export interface OptionalIonosphereEvidenceInput {
  readonly state: 'future' | 'unavailable' | 'live' | 'cached' | 'stale';
  readonly summary?: Readonly<Record<string, unknown>>;
}

export interface EvidenceSynthesisInput {
  readonly band: PropagationGuidanceBand;
  readonly destinationRegion: PropagationRegionId;
  readonly selectedTimeUtc: string;
  readonly stationProfile: StationProfile;
  readonly model: ModelEvidenceInput;
  readonly environment: SpaceWeatherEvidenceInput;
  readonly observedRf: ObservedRfEvidenceInput;
  readonly ionosphere?: OptionalIonosphereEvidenceInput;
  readonly nowUtc: string;
}

export interface ModelInterpretation {
  readonly state: ModelOpportunityState;
  readonly thresholdVersion: 'preliminary_5h_a';
  readonly successfulSampleRatio: number | null;
  readonly regionalSpreadCaution: boolean;
}

export interface ObservedRfInterpretation {
  readonly state: ObservedRfActivityState;
  readonly recent: boolean;
  readonly modeDiversity: number;
}

export interface EnvironmentInterpretation {
  readonly state: EnvironmentState;
  readonly hfBlackoutSeverity: HfBlackoutSeverity;
  readonly sunlitPathApplicability: 'unknown';
  readonly applicabilityUnknown: true;
}

export interface SourceCoverage {
  readonly model: ModelState;
  readonly spaceWeather: SpaceWeatherEvidenceInput['status'];
  readonly observedRf: ObservedRfEvidenceInput['state'];
  readonly ionosphere: OptionalIonosphereEvidenceInput['state'];
}

export interface EvidenceFreshness {
  readonly modelAtUtc: string | null;
  readonly spaceWeatherFetchedAtUtc: string | null;
  readonly observedWindow: ObservedRfEvidenceInput['observationWindow'];
}

export interface SynthesisMessage {
  readonly code: ReasonCode | CautionCode;
  readonly text: string;
}

export interface PropagationDecisionBasis {
  readonly band: PropagationGuidanceBand;
  readonly destinationRegion: PropagationRegionId;
  readonly selectedTimeUtc: string;
  readonly stationProfile: StationProfile;
  readonly model: ModelInterpretation;
  readonly environment: EnvironmentInterpretation;
  readonly observedRf: ObservedRfInterpretation;
  readonly agreement: EvidenceAgreementState;
  readonly modeRelevance: ModeRelevance;
  readonly sourceCoverage: SourceCoverage;
  readonly evidenceFreshness: EvidenceFreshness;
  readonly exceptionalConditions: { readonly hfBlackoutSeverity: HfBlackoutSeverity; readonly sunlitPathApplicability: 'unknown'; readonly applicabilityUnknown: true };
  readonly limitations: readonly SynthesisLimitationCode[];
  readonly reasons: readonly SynthesisMessage[];
  readonly cautions: readonly SynthesisMessage[];
}

export interface PropagationBandAssessmentContract {
  readonly band: PropagationGuidanceBand;
  readonly destinationRegion: PropagationRegionId;
  readonly rating: PropagationRating | null;
  readonly ratingStatus: 'deferred_to_5h_b';
  readonly confidence: PropagationConfidence;
  readonly decisionBasis: PropagationDecisionBasis;
  readonly provenance: {
    readonly modelRevision: string | null;
    readonly modelProvenance: ModelEvidenceInput['provenance'] | null;
    readonly environmentStatus: SpaceWeatherEvidenceInput['status'];
    readonly observedSourceState: ObservedRfEvidenceInput['state'];
    readonly observationWindow: ObservedRfEvidenceInput['observationWindow'];
    readonly stationProfile: StationProfile;
  };
}

export function interpretModelEvidence(input: ModelEvidenceInput): ModelInterpretation {
  if (input.state === 'unavailable' || input.state === 'unsupported' || input.sampleCount <= 0) return { state: 'unavailable', thresholdVersion: 'preliminary_5h_a', successfulSampleRatio: null, regionalSpreadCaution: false };
  const ratio = input.successfulSampleCount / input.sampleCount;
  const median = input.medianBcrPercent ?? 0;
  const spread = input.bcrSpreadPercent ?? Number.POSITIVE_INFINITY;
  const state = median >= 75 && ratio >= 0.8 && spread <= 20
    ? 'very_favorable'
    : median >= 55 && ratio >= 0.6
      ? 'favorable'
      : median >= 30 && ratio > 0
        ? 'marginal'
        : 'unfavorable';
  return { state, thresholdVersion: 'preliminary_5h_a', successfulSampleRatio: ratio, regionalSpreadCaution: spread > 25 };
}

export function interpretObservedRfEvidence(input: ObservedRfEvidenceInput, nowUtc: string): ObservedRfInterpretation {
  const modeDiversity = Object.keys(input.modeCounts).filter(mode => input.modeCounts[mode] > 0).length;
  const ageMinutes = input.newestObservationAt ? (Date.parse(nowUtc) - Date.parse(input.newestObservationAt)) / 60_000 : Number.POSITIVE_INFINITY;
  const recent = Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes <= 15;
  if (input.state === 'unavailable') return { state: 'unavailable', recent: false, modeDiversity };
  if (input.reportCount === 0) return { state: 'none_observed', recent, modeDiversity };
  if (input.state === 'stale' || !recent) return { state: 'limited', recent, modeDiversity };
  if (input.reportCount >= 3 && input.uniquePathCount >= 2 && input.uniqueRemoteCallsignCount >= 2) return { state: 'strongly_observed', recent, modeDiversity };
  if (input.uniquePathCount > 0 && input.uniqueRemoteCallsignCount > 0) return { state: 'observed', recent, modeDiversity };
  return { state: 'limited', recent, modeDiversity };
}

export function interpretEnvironment(input: SpaceWeatherEvidenceInput): EnvironmentInterpretation {
  const rScale = input.rScale.value;
  const kp = input.kp.value;
  const hfBlackoutSeverity = Number.isInteger(rScale) && rScale !== null && rScale >= 0 && rScale <= 5 ? `R${rScale}` as HfBlackoutSeverity : null;
  const state: EnvironmentState = hfBlackoutSeverity && Number(hfBlackoutSeverity.slice(1)) >= 3
    ? 'radio_blackout'
    : kp === null || rScale === null
      ? 'partial'
      : kp >= 7
        ? 'severely_disturbed'
        : kp >= 5 || rScale >= 1
          ? 'disturbed'
          : kp <= 2 && rScale === 0
            ? 'favorable'
            : 'quiet';
  return { state: input.status === 'unavailable' ? 'unavailable' : state, hfBlackoutSeverity, sunlitPathApplicability: 'unknown', applicabilityUnknown: true };
}

export function deriveModeRelevance(selectedMode: PropagationMode, modeCounts: Readonly<Record<string, number>>): ModeRelevance {
  const observedModes = Object.keys(modeCounts).filter(mode => modeCounts[mode] > 0);
  if (observedModes.length === 0) return 'none';
  if (observedModes.includes(selectedMode)) return 'direct';
  if (selectedMode === 'SSB' || PROPAGATION_MODES.includes(selectedMode)) return 'adjacent';
  return 'indirect';
}

export function deriveEvidenceAgreement(model: ModelInterpretation, observed: ObservedRfInterpretation): EvidenceAgreementState {
  if (model.state === 'unavailable' && observed.state === 'unavailable') return 'insufficient';
  if (model.state === 'unavailable') return observed.state === 'strongly_observed' || observed.state === 'observed' ? 'insufficient' : 'insufficient';
  if (observed.state === 'unavailable') return 'model_only';
  if (observed.state === 'strongly_observed' || observed.state === 'observed') {
    return model.state === 'very_favorable' || model.state === 'favorable' ? 'confirmed' : 'observed_opening';
  }
  if (observed.state === 'none_observed') {
    return model.state === 'unfavorable' ? 'consistent' : 'weakly_unconfirmed';
  }
  if (model.state === 'unfavorable') return 'contradictory';
  return 'insufficient';
}

export function deriveOperatingMode(coverage: SourceCoverage, observed: ObservedRfInterpretation): PropagationOperatingMode {
  const modelUseful = coverage.model === 'available' || coverage.model === 'partial';
  const observedUseful = observed.state === 'strongly_observed' || observed.state === 'observed';
  if (!modelUseful && observedUseful) return 'observed_only';
  if (!modelUseful) return 'unavailable';
  if (coverage.observedRf === 'live' && coverage.spaceWeather === 'live' && observedUseful) return 'online_live_enhanced';
  if (coverage.observedRf === 'live' || coverage.spaceWeather === 'live') return 'online_partial';
  if (coverage.observedRf === 'cached' || coverage.observedRf === 'stale' || coverage.spaceWeather === 'cached' || coverage.spaceWeather === 'stale') return 'offline_cached_modeled';
  return 'offline_modeled';
}

export function deriveConfidence(basis: Pick<PropagationDecisionBasis, 'model' | 'environment' | 'observedRf' | 'agreement' | 'sourceCoverage'>): PropagationConfidence {
  if (basis.model.state === 'unavailable' && basis.observedRf.state === 'unavailable' && basis.environment.state === 'unavailable') return 'unavailable';
  if (basis.model.state !== 'unavailable' && basis.observedRf.state === 'unavailable' && basis.environment.state === 'unavailable') return 'modeled_only';
  if (basis.agreement === 'confirmed' && basis.environment.state !== 'radio_blackout' && basis.sourceCoverage.observedRf === 'live') return 'high';
  if (basis.agreement === 'observed_opening' || basis.agreement === 'weakly_unconfirmed' || basis.environment.state === 'radio_blackout' || basis.environment.state === 'severely_disturbed') return 'low';
  return 'medium';
}

export function createPropagationDecisionBasis(input: EvidenceSynthesisInput): PropagationDecisionBasis {
  const model = interpretModelEvidence(input.model);
  const observedRf = interpretObservedRfEvidence(input.observedRf, input.nowUtc);
  const environment = interpretEnvironment(input.environment);
  const agreement = deriveEvidenceAgreement(model, observedRf);
  const modeRelevance = deriveModeRelevance(input.stationProfile.mode, input.observedRf.modeCounts);
  const sourceCoverage: SourceCoverage = { model: input.model.state, spaceWeather: input.environment.status, observedRf: input.observedRf.state, ionosphere: input.ionosphere?.state ?? 'future' };
  const limitations: SynthesisLimitationCode[] = ['reference_antenna_assumptions', 'digital_only', 'no_ionosphere'];
  if (input.model.state === 'unsupported') limitations.push('model_unsupported');
  if (input.destinationRegion === 'local_nvis') limitations.push('local_mechanism_unknown');
  const reasons: SynthesisMessage[] = [];
  if (model.state !== 'unavailable') reasons.push({ code: `model_${model.state}` as ReasonCode, text: `Regional P.533 model is ${model.state.replace('_', ' ')}.` });
  if (observedRf.state === 'strongly_observed' || observedRf.state === 'observed') reasons.push({ code: 'observed_paths_to_region', text: 'Current digital paths were observed to the selected region.' });
  if (environment.state === 'quiet') reasons.push({ code: 'environment_quiet', text: 'Current geomagnetic conditions are quiet.' });
  if (agreement === 'observed_opening') reasons.push({ code: 'observed_opening', text: 'Current RF activity exceeds modeled expectation.' });
  if (agreement === 'confirmed') reasons.push({ code: 'evidence_confirmed', text: 'Modeled and observed evidence are consistent.' });
  const cautions: SynthesisMessage[] = [{ code: 'model_reference_antenna_assumptions', text: 'P.533 currently uses reference antenna assumptions rather than fully modeling the selected antenna and deployment.' }, { code: 'digital_only_observed_rf', text: 'PSKReporter evidence is observed digital reception activity and does not prove SSB usability.' }];
  if (observedRf.state === 'unavailable' || observedRf.state === 'none_observed') cautions.push({ code: 'no_current_observation', text: 'No current matching observed-RF activity is available; this does not prove the band is closed.' });
  if (input.observedRf.state === 'stale') cautions.push({ code: 'stale_observed_rf', text: 'Observed-RF evidence is stale.' });
  if (input.environment.status === 'stale') cautions.push({ code: 'space_weather_stale', text: 'NOAA space-weather evidence is stale.' });
  if (environment.state === 'radio_blackout') cautions.push({ code: 'current_radio_blackout', text: 'NOAA R-scale indicates current HF radio-blackout conditions; sunlit-path applicability is unknown.' });
  if (model.regionalSpreadCaution) cautions.push({ code: 'model_regional_spread_wide', text: 'Modeled regional sample results have a wide BCR spread.' });
  if (input.model.state === 'partial') cautions.push({ code: 'partial_model_samples', text: 'Some P.533 regional samples failed or are unavailable.' });
  if (modeRelevance === 'adjacent') cautions.push({ code: 'mode_indirectly_supported', text: 'Observed digital modes provide propagation evidence but only indirect relevance to the selected station mode.' });
  if (input.destinationRegion === 'local_nvis') cautions.push({ code: 'local_mechanism_unknown', text: 'Local digital activity does not establish NVIS propagation.' });
  if (agreement === 'weakly_unconfirmed') cautions.push({ code: 'evidence_weakly_unconfirmed', text: 'The favorable model has no current matching observed activity and is not confirmed by observation.' });
  return { band: input.band, destinationRegion: input.destinationRegion, selectedTimeUtc: input.selectedTimeUtc, stationProfile: input.stationProfile, model, environment, observedRf, agreement, modeRelevance, sourceCoverage, evidenceFreshness: { modelAtUtc: input.model.modeledAtUtc, spaceWeatherFetchedAtUtc: input.environment.fetchedAtUtc, observedWindow: input.observedRf.observationWindow }, exceptionalConditions: { hfBlackoutSeverity: environment.hfBlackoutSeverity, sunlitPathApplicability: 'unknown', applicabilityUnknown: true }, limitations, reasons, cautions };
}

export function createPropagationBandAssessment(input: EvidenceSynthesisInput): PropagationBandAssessmentContract {
  const decisionBasis = createPropagationDecisionBasis(input);
  return {
    band: input.band,
    destinationRegion: input.destinationRegion,
    rating: null,
    ratingStatus: 'deferred_to_5h_b',
    confidence: deriveConfidence(decisionBasis),
    decisionBasis,
    provenance: { modelRevision: input.model.modelRevision, modelProvenance: input.model.provenance, environmentStatus: input.environment.status, observedSourceState: input.observedRf.state, observationWindow: input.observedRf.observationWindow, stationProfile: input.stationProfile },
  };
}
