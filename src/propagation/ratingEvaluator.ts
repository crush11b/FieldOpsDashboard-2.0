import type { SpaceWeatherSnapshot, SpaceWeatherEvidenceItem } from '../../server/spaceWeather';
import type { DashboardConfig } from '../types';
import { PROPAGATION_GUIDANCE_BANDS, type PropagationConfidence, type PropagationGuidanceBand, type PropagationOperatingMode, type PropagationRating, type PropagationSourceState, type StationProfile } from './domain';
import { type RegionalObservedRfBandSummary, type RegionalObservedRfSnapshot } from './regionalObservedRf';
import { type RegionalP533BandResult, type RegionalP533Result } from './regionalP533';
import {
  createPropagationDecisionBasis,
  deriveOperatingMode,
  type CautionCode,
  type EnvironmentState,
  type EvidenceSynthesisInput,
  type ModelOpportunityState,
  type PropagationDecisionBasis,
  type ReasonCode,
  type SourceCoverage,
  type SynthesisMessage,
} from './evidenceSynthesis';
import type { PropagationRegionId } from './regionalDestinations';

export const PROPAGATION_RATING_POLICY_VERSION = 'regional_guidance_v1' as const;

export type RatingRuleId =
  | 'model_baseline_very_favorable' | 'model_baseline_favorable' | 'model_baseline_marginal' | 'model_baseline_unfavorable'
  | 'observed_confirmation' | 'observed_strong_direct_promotion' | 'observed_opening_direct' | 'observed_opening_adjacent' | 'observed_opening_indirect_limit'
  | 'observed_only_direct' | 'observed_only_adjacent' | 'observed_only_indirect'
  | 'environment_disturbed_qualification' | 'environment_severe_cap' | 'environment_blackout_cap'
  | 'insufficient_evidence' | 'local_nvis_deferred';

export type RatingDecisionAction = 'baseline' | 'retain' | 'promote' | 'downgrade' | 'cap' | 'unavailable';

export interface RatingDecisionStep {
  readonly ruleId: RatingRuleId;
  readonly action: RatingDecisionAction;
  readonly previousRating: PropagationRating | null;
  readonly resultingRating: PropagationRating;
  readonly evidenceBasis: string;
}

export interface PropagationBandAssessment {
  readonly band: PropagationGuidanceBand;
  readonly destinationRegion: PropagationRegionId;
  readonly rating: PropagationRating;
  readonly confidence: PropagationConfidence;
  readonly operatingMode: PropagationOperatingMode;
  readonly decisionBasis: PropagationDecisionBasis;
  readonly ratingPolicyVersion: typeof PROPAGATION_RATING_POLICY_VERSION;
  readonly ratingDecisionSteps: readonly RatingDecisionStep[];
  readonly reasons: readonly SynthesisMessage[];
  readonly cautions: readonly SynthesisMessage[];
  readonly provenance: {
    readonly modelRevision: string | null;
    readonly modelProvenance: EvidenceSynthesisInput['model']['provenance'] | null;
    readonly environmentStatus: EvidenceSynthesisInput['environment']['status'];
    readonly observedSourceState: EvidenceSynthesisInput['observedRf']['state'];
    readonly observationWindow: EvidenceSynthesisInput['observedRf']['observationWindow'];
    readonly stationProfile: StationProfile;
  };
}

const RATING_ORDER: readonly PropagationRating[] = ['POOR', 'FAIR', 'GOOD', 'EXCELLENT'];
const MODEL_BASELINE_RATINGS: Readonly<Record<Exclude<ModelOpportunityState, 'unavailable'>, PropagationRating>> = {
  very_favorable: 'EXCELLENT',
  favorable: 'GOOD',
  marginal: 'FAIR',
  unfavorable: 'POOR',
};

export function promoteOneLevel(rating: PropagationRating): PropagationRating {
  if (!isArithmeticRating(rating)) return rating;
  return RATING_ORDER[Math.min(RATING_ORDER.length - 1, RATING_ORDER.indexOf(rating) + 1)];
}

export function degradeOneLevel(rating: PropagationRating): PropagationRating {
  if (!isArithmeticRating(rating)) return rating;
  return RATING_ORDER[Math.max(0, RATING_ORDER.indexOf(rating) - 1)];
}

export function capRating(rating: PropagationRating, cap: Exclude<PropagationRating, 'UNAVAILABLE'>): PropagationRating {
  if (!isArithmeticRating(rating)) return rating;
  return RATING_ORDER[Math.min(RATING_ORDER.indexOf(rating), RATING_ORDER.indexOf(cap))];
}

function isArithmeticRating(rating: PropagationRating): rating is Exclude<PropagationRating, 'UNAVAILABLE'> {
  return rating !== 'UNAVAILABLE';
}

function isCurrentObservedConfirmation(basis: PropagationDecisionBasis): boolean {
  return basis.sourceCoverage.observedRf === 'live' && basis.observedRf.recent && (basis.observedRf.state === 'strongly_observed' || basis.observedRf.state === 'observed');
}

function isStrongDirectCurrentObservation(basis: PropagationDecisionBasis): boolean {
  return isCurrentObservedConfirmation(basis) && basis.observedRf.state === 'strongly_observed' && basis.modeRelevance === 'direct';
}

function isCurrentEnvironment(state: EnvironmentState): boolean {
  return state === 'favorable' || state === 'quiet' || state === 'disturbed' || state === 'severely_disturbed' || state === 'radio_blackout';
}

function addStep(steps: RatingDecisionStep[], ruleId: RatingRuleId, action: RatingDecisionAction, previousRating: PropagationRating | null, resultingRating: PropagationRating, evidenceBasis: string): void {
  steps.push({ ruleId, action, previousRating, resultingRating, evidenceBasis });
}

function addMessage(messages: SynthesisMessage[], code: ReasonCode | CautionCode, text: string): void {
  if (!messages.some(message => message.code === code)) messages.push({ code, text });
}

function baselineStep(model: ModelOpportunityState): { ruleId: RatingRuleId; rating: PropagationRating } | null {
  if (model === 'unavailable') return null;
  return { ruleId: `model_baseline_${model}` as RatingRuleId, rating: MODEL_BASELINE_RATINGS[model] };
}

function deriveFinalConfidence(basis: PropagationDecisionBasis, rating: PropagationRating): PropagationConfidence {
  if (rating === 'UNAVAILABLE') return 'unavailable';
  if (basis.model.state !== 'unavailable' && basis.observedRf.state === 'unavailable' && (!isCurrentEnvironment(basis.environment.state) || basis.sourceCoverage.spaceWeather !== 'live')) return 'modeled_only';
  if (basis.model.state === 'unavailable') return 'low';
  if (basis.environment.state === 'stale' || basis.environment.state === 'cached_context' || basis.environment.state === 'partial' || basis.environment.state === 'unavailable' || basis.observedRf.state === 'limited') return 'low';
  if (basis.agreement === 'observed_opening') return basis.modeRelevance === 'indirect' ? 'low' : 'medium';
  if (basis.agreement === 'confirmed' && isCurrentObservedConfirmation(basis) && basis.modeRelevance === 'direct' && (basis.environment.state === 'favorable' || basis.environment.state === 'quiet') && basis.sourceCoverage.spaceWeather === 'live' && !basis.model.regionalSpreadCaution && basis.sourceCoverage.model !== 'partial') return 'high';
  return 'medium';
}

export function evaluatePropagationBand(input: EvidenceSynthesisInput): PropagationBandAssessment {
  const basis = createPropagationDecisionBasis(input);
  const steps: RatingDecisionStep[] = [];
  const reasons = [...basis.reasons];
  const cautions = [...basis.cautions];
  const operatingMode = deriveOperatingMode(basis.sourceCoverage, basis.observedRf);
  let rating: PropagationRating = 'UNAVAILABLE';

  if (input.destinationRegion === 'local_nvis') {
    addStep(steps, 'local_nvis_deferred', 'unavailable', null, rating, 'Local digital activity does not establish an NVIS mechanism; a separate evaluator is required.');
    addMessage(cautions, 'local_mechanism_unknown', 'Local digital activity does not establish NVIS; local/NVIS rating evaluation is deferred.');
  } else {
    const baseline = baselineStep(basis.model.state);
    if (baseline) {
      rating = baseline.rating;
      addStep(steps, baseline.ruleId, 'baseline', null, rating, `5H-A model opportunity state is ${basis.model.state}; BCR and threshold provenance are retained in the decision basis.`);
    }

    const currentObservation = isCurrentObservedConfirmation(basis);
    const strongDirect = isStrongDirectCurrentObservation(basis);
    if (baseline && basis.agreement === 'confirmed') {
      addStep(steps, 'observed_confirmation', 'retain', rating, rating, 'Current observed RF confirms the modeled opportunity without changing the model baseline.');
      if (basis.model.state === 'favorable' && strongDirect && (basis.environment.state === 'favorable' || basis.environment.state === 'quiet') && !basis.model.regionalSpreadCaution && input.model.state !== 'partial') {
        const promoted = promoteOneLevel(rating);
        addStep(steps, 'observed_strong_direct_promotion', 'promote', rating, promoted, 'A favorable baseline is promoted one level only for strong, live, recent, direct observations in favorable or quiet current conditions.');
        rating = promoted;
      }
    } else if (baseline && basis.agreement === 'observed_opening' && currentObservation) {
      const promoted = promoteOneLevel(rating);
      if (basis.modeRelevance === 'direct') {
        addStep(steps, 'observed_opening_direct', 'promote', rating, promoted, 'Live, recent, direct observed RF exceeds the modeled expectation by one rating level.');
        rating = promoted;
      } else if (basis.modeRelevance === 'adjacent') {
        const capped = capRating(promoted, 'GOOD');
        addStep(steps, 'observed_opening_adjacent', 'promote', rating, capped, 'Live, recent, adjacent-mode observed RF permits one-step promotion, capped at GOOD.');
        rating = capped;
      } else if (basis.modeRelevance === 'indirect') {
        const capped = capRating(promoted, 'FAIR');
        addStep(steps, 'observed_opening_indirect_limit', 'promote', rating, capped, 'Live, recent, indirect-mode observed RF permits at most FAIR.');
        rating = capped;
      }
    } else if (!baseline && currentObservation) {
      if (basis.modeRelevance === 'direct' && basis.observedRf.state === 'strongly_observed') {
        rating = 'GOOD';
        addStep(steps, 'observed_only_direct', 'baseline', null, rating, 'Strong, live, recent, direct observed RF provides observed-only GOOD guidance without a P.533 baseline.');
      } else if (basis.modeRelevance === 'direct' || basis.modeRelevance === 'adjacent') {
        rating = 'FAIR';
        addStep(steps, basis.modeRelevance === 'direct' ? 'observed_only_direct' : 'observed_only_adjacent', 'baseline', null, rating, 'Observed-only RF evidence provides conservative FAIR guidance without a P.533 baseline.');
      } else {
        rating = 'FAIR';
        addStep(steps, 'observed_only_indirect', 'baseline', null, rating, 'Indirect observed RF provides conservative FAIR maximum guidance without a P.533 baseline.');
      }
    } else if (!baseline) {
      addStep(steps, 'insufficient_evidence', 'unavailable', null, rating, 'Neither a usable P.533 baseline nor sufficient current observed RF evidence is available.');
    }

    const protectWithDirectObservation = strongDirect;
    if (basis.environment.state === 'disturbed' && !protectWithDirectObservation && rating !== 'UNAVAILABLE') {
      const qualified = degradeOneLevel(rating);
      addStep(steps, 'environment_disturbed_qualification', 'downgrade', rating, qualified, 'Current disturbed conditions qualify an unconfirmed modeled result by at most one level.');
      rating = qualified;
    }
    if (basis.environment.state === 'severely_disturbed' && rating !== 'UNAVAILABLE') {
      const cap = protectWithDirectObservation ? 'GOOD' : 'FAIR';
      const qualified = capRating(rating, cap);
      addStep(steps, 'environment_severe_cap', 'cap', rating, qualified, `Current severe disturbance caps the result at ${cap} unless strong direct live RF is being observed.`);
      rating = qualified;
    }
    if (basis.environment.state === 'radio_blackout' && rating !== 'UNAVAILABLE') {
      const cap = protectWithDirectObservation ? 'GOOD' : 'FAIR';
      const qualified = capRating(rating, cap);
      addStep(steps, 'environment_blackout_cap', 'cap', rating, qualified, `Current R-scale blackout evidence with unknown sunlit-path applicability caps the result at ${cap}.`);
      rating = qualified;
    }
  }

  if (basis.environment.state === 'disturbed' || basis.environment.state === 'severely_disturbed') addMessage(cautions, 'current_conditions_disturbed', 'Current NOAA conditions are disturbed; rating qualification is recorded in the decision steps.');
  const confidence = deriveFinalConfidence(basis, rating);
  return {
    band: input.band,
    destinationRegion: input.destinationRegion,
    rating,
    confidence,
    operatingMode,
    decisionBasis: basis,
    ratingPolicyVersion: PROPAGATION_RATING_POLICY_VERSION,
    ratingDecisionSteps: steps,
    reasons,
    cautions,
    provenance: {
      modelRevision: input.model.modelRevision,
      modelProvenance: input.model.provenance,
      environmentStatus: input.environment.status,
      observedSourceState: input.observedRf.state,
      observationWindow: input.observedRf.observationWindow,
      stationProfile: input.stationProfile,
    },
  };
}

export function evaluatePropagationBands(inputs: readonly EvidenceSynthesisInput[]): readonly PropagationBandAssessment[] {
  return [...inputs].sort((left, right) => PROPAGATION_GUIDANCE_BANDS.indexOf(left.band) - PROPAGATION_GUIDANCE_BANDS.indexOf(right.band)).map(evaluatePropagationBand);
}

export interface RegionalEvidenceAdapterInput {
  readonly band: PropagationGuidanceBand;
  readonly destinationRegion: PropagationRegionId;
  readonly selectedTimeUtc: string;
  readonly nowUtc: string;
  readonly regionalP533: RegionalP533Result;
  readonly spaceWeather: SpaceWeatherSnapshot;
  readonly regionalObservedRf: RegionalObservedRfSnapshot;
  readonly stationProfile?: StationProfile;
  readonly config?: Pick<DashboardConfig, 'propagation'>;
}

function sourceState(value: PropagationSourceState): Extract<PropagationSourceState, 'live' | 'cached' | 'stale' | 'unavailable'> {
  return value === 'live' || value === 'cached' || value === 'stale' ? value : 'unavailable';
}

function numericValue(item: SpaceWeatherEvidenceItem): number | null {
  return typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : null;
}

function stringValue(item: SpaceWeatherEvidenceItem): string | null {
  return typeof item.value === 'string' ? item.value : null;
}

function adaptProduct<T extends number | string | null>(item: SpaceWeatherEvidenceItem, value: T): { readonly value: T; readonly state: Extract<PropagationSourceState, 'live' | 'cached' | 'stale' | 'unavailable'>; readonly observedAtUtc: string | null; readonly receivedAtUtc: string | null } {
  return { value, state: sourceState(item.state), observedAtUtc: item.observedAt ?? null, receivedAtUtc: item.receivedAt ?? null };
}

function findModelBand(result: RegionalP533Result, band: PropagationGuidanceBand): RegionalP533BandResult | null {
  return result.bandResults.find(item => item.band === band) ?? null;
}

function adaptModel(input: RegionalEvidenceAdapterInput): EvidenceSynthesisInput['model'] {
  const band = findModelBand(input.regionalP533, input.band);
  const state = input.band === '6m' ? 'unsupported' : band && input.regionalP533.status === 'complete' ? 'available' : band && input.regionalP533.status === 'partial' ? 'partial' : 'unavailable';
  const summary = band?.summary;
  return {
    state,
    medianBcrPercent: summary?.basicCircuitReliabilityPercent.median ?? null,
    bcrSpreadPercent: summary && summary.basicCircuitReliabilityPercent.minimum !== null && summary.basicCircuitReliabilityPercent.maximum !== null ? summary.basicCircuitReliabilityPercent.maximum - summary.basicCircuitReliabilityPercent.minimum : null,
    snrDb: summary?.snrDb ?? { minimum: null, maximum: null, median: null },
    successfulSampleCount: summary?.successfulSampleCount ?? 0,
    sampleCount: summary?.sampleCount ?? 0,
    modeledAtUtc: input.regionalP533.modeledAtUtc ?? null,
    modelRevision: input.regionalP533.provenance.recommendation,
    assumptions: { stationProfileFullyModeled: false, antennaModel: input.regionalP533.assumptions.antennaModel, modeInterpretation: input.regionalP533.assumptions.modeInterpretation },
    provenance: { model: 'ITU-R P.533', recommendation: input.regionalP533.provenance.recommendation, engine: input.regionalP533.provenance.engine },
  };
}

function adaptObservedRf(input: RegionalEvidenceAdapterInput): EvidenceSynthesisInput['observedRf'] {
  const summary: RegionalObservedRfBandSummary | undefined = input.regionalObservedRf.regionBandSummaries.find(item => item.regionId === input.destinationRegion && item.band === input.band);
  const state = input.regionalObservedRf.sourceStatus === 'live' ? 'live' : input.regionalObservedRf.sourceStatus === 'cached' ? 'cached' : input.regionalObservedRf.sourceStatus === 'stale' ? 'stale' : 'unavailable';
  return {
    state,
    reportCount: summary?.reportCount ?? 0,
    uniquePathCount: summary?.uniquePathCount ?? 0,
    uniqueRemoteCallsignCount: summary?.uniqueRemoteCallsignCount ?? 0,
    outboundReportCount: summary?.outboundReportCount ?? 0,
    inboundReportCount: summary?.inboundReportCount ?? 0,
    modeCounts: summary?.modeCounts ?? {},
    snrDb: summary?.snrDb ?? { minimum: null, maximum: null, median: null },
    newestObservationAt: summary?.newestReportAt ?? null,
    observationWindow: input.regionalObservedRf.observationWindow,
    sourceName: input.regionalObservedRf.sourceProvenance.sourceName,
    digitalOnlyLimitation: true,
  };
}

function adaptEnvironment(snapshot: SpaceWeatherSnapshot): EvidenceSynthesisInput['environment'] {
  const products = snapshot.products;
  return {
    status: snapshot.status,
    fetchedAtUtc: snapshot.fetchedAt,
    f107: adaptProduct(products.f107, numericValue(products.f107)),
    ssn: adaptProduct(products.ssn, numericValue(products.ssn)),
    kp: adaptProduct(products.kp, numericValue(products.kp)),
    rScale: adaptProduct(products.rScale, numericValue(products.rScale)),
    latestGoesFlareClass: adaptProduct(products.xray, stringValue(products.xray)),
  };
}

export function adaptRegionalEvidenceToSynthesisInput(input: RegionalEvidenceAdapterInput): EvidenceSynthesisInput {
  const stationProfile = input.stationProfile ?? input.config?.propagation.stationProfile ?? input.regionalP533.stationProfile;
  return { band: input.band, destinationRegion: input.destinationRegion, selectedTimeUtc: input.selectedTimeUtc, stationProfile, model: adaptModel(input), environment: adaptEnvironment(input.spaceWeather), observedRf: adaptObservedRf(input), nowUtc: input.nowUtc };
}

export function evaluateRegionalBandAssessments(input: Omit<RegionalEvidenceAdapterInput, 'band'>): readonly PropagationBandAssessment[] {
  const normalized = PROPAGATION_GUIDANCE_BANDS.map(band => adaptRegionalEvidenceToSynthesisInput({ ...input, band }));
  return evaluatePropagationBands(normalized);
}
