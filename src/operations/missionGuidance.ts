import type { Activation, ActivationOperatingObjective } from '../../server/activation';
import type { LayeredPropagationPicture } from '../propagation/layeredPicture';
import { aggregateQsoEvidence, type QsoEvidence } from '../../server/qsoEvidence';

export type GuidanceCategory = 'qualification' | 'exploration' | 'reach' | 'contact_opportunity' | 'maintain_context';
export type GuidanceUrgency = 'none' | 'routine' | 'focused' | 'urgent' | 'complete';
export const MISSION_GUIDANCE_POLICY = { progressStallMinutes: 10 } as const;
export type GuidanceEvidenceReference = 'activation_qso_results' | 'station_signal' | 'general_observed_rf' | 'modeled' | 'environmental' | 'objective';

export interface MissionGuidance {
  readonly kind: 'mission_aware_operating_guidance';
  readonly category: GuidanceCategory;
  readonly urgency: GuidanceUrgency;
  readonly action: string;
  readonly suggestedBand?: string;
  readonly suggestedMode?: string;
  readonly supportingEvidence: readonly string[];
  readonly conflictingEvidence: readonly string[];
  readonly reasons: readonly string[];
  readonly missingLimitations: readonly string[];
  readonly reconsiderWhen: string;
  readonly evidenceReferences: readonly GuidanceEvidenceReference[];
  readonly inputs: {
    readonly goal: ActivationOperatingObjective['goal'] | 'unspecified';
    readonly goalLabel: string;
    readonly completedQsos: number;
    readonly requiredQsos: number | null;
    readonly remainingQsos: number | null;
    readonly deadlineUtc: string | null;
    readonly deadlineBasis: ActivationOperatingObjective['deadlineBasis'] | null;
    readonly deadlineProvenance: ActivationOperatingObjective['deadlineProvenance'] | null;
    readonly minutesRemaining: number | null;
    readonly qsoEvidence: QsoEvidence;
  };
  readonly limitations: readonly string[];
  readonly evaluatedAtUtc: string;
}

export interface MissionGuidanceInput {
  readonly activation: Activation;
  readonly qsoEvidence?: QsoEvidence;
  readonly picture: LayeredPropagationPicture;
  readonly evaluatedAtUtc: string;
  readonly retrospective?: boolean;
  readonly modeledBands?: readonly string[];
  readonly currentBand?: string;
  readonly currentMode?: string;
  readonly currentContextStartedAtUtc?: string;
}

export function assembleMissionGuidance(input: MissionGuidanceInput): MissionGuidance {
  const evaluatedAtUtc = requireUtc(input.retrospective && input.activation.endedAtUtc ? input.activation.endedAtUtc : input.evaluatedAtUtc);
  const qsoEvidence = input.qsoEvidence ?? aggregateQsoEvidence([], input.currentBand, input.currentMode);
  const objective = input.activation.operatingObjective;
  const required = objective?.requiredQsoCount ?? null;
  const remaining = required === null ? null : Math.max(0, required - qsoEvidence.total);
  const deadlineUtc = objective?.deadlineUtc ?? null;
  const minutesRemaining = deadlineUtc === null ? null : Math.floor((Date.parse(deadlineUtc) - Date.parse(evaluatedAtUtc)) / 60_000);
  const currentBand = input.currentBand ?? qsoEvidence.currentBand;
  const currentMode = input.currentMode ?? qsoEvidence.currentBandMode ?? undefined;
  const currentLastQso = currentBand ? qsoEvidence.mostRecentQsoUtcByBand[currentBand] ?? null : null;
  const attemptAnchor = currentLastQso ?? input.currentContextStartedAtUtc ?? null;
  const minutesSinceAttempt = attemptAnchor ? Math.floor((Date.parse(evaluatedAtUtc) - Date.parse(attemptAnchor)) / 60_000) : null;
  const stalled = Boolean(currentBand && minutesSinceAttempt !== null && minutesSinceAttempt >= MISSION_GUIDANCE_POLICY.progressStallMinutes);
  const station = input.picture.layers.find(layer => layer.id === 'station_signal');
  const stationMatch = station?.summary.match(/^(\d+) matching reports from (\d+) unique receivers/);
  const stationReportCount = Number(stationMatch?.[1] ?? 0);
  const stationReceiverCount = Number(stationMatch?.[2] ?? 0);
  const stationPositive = station?.state === 'evidence_available' && stationReportCount > 0;
  const stationZero = station?.state === 'no_matching_reports';
  const stationLimited = !station || ['stale_evidence', 'awaiting_provider_latency', 'query_pending', 'provider_unavailable', 'unavailable'].includes(station.state);
  const modeledBand = input.modeledBands?.find(Boolean);
  const references = new Set<GuidanceEvidenceReference>();
  const supportingEvidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const missingLimitations: string[] = [];
  const reasons: string[] = [];
  let category: GuidanceCategory = 'maintain_context';
  let urgency: GuidanceUrgency = 'none';
  let action = 'Log a two-way QSO in a current TX Context or select an explicit objective to obtain actionable guidance.';
  let suggestedBand = currentBand;
  const suggestedMode = currentMode;

  if (objective?.goal === 'explore_bands') {
    category = 'exploration'; urgency = 'routine'; action = 'Continue the planned band exploration; record each change as a new TX Context.';
    reasons.push('The explicit objective is band exploration, not a hidden contact-count target.'); references.add('objective'); references.add('modeled'); references.add('general_observed_rf');
  } else if (objective?.goal === 'chase_dx') {
    category = 'reach'; urgency = minutesRemaining !== null && minutesRemaining <= 15 ? 'focused' : 'routine';
    action = modeledBand ? `Consider a bounded test of modeled reach-oriented alternative ${modeledBand}; confirm conditions and operator constraints before changing.` : 'Continue the current reach-oriented attempt; modeled band support is unavailable.';
    suggestedBand = modeledBand; reasons.push('The explicit objective is DX reach.'); references.add('objective'); references.add('modeled'); references.add('general_observed_rf'); references.add('station_signal');
  } else if (objective?.goal === 'maximize_contacts') {
    category = 'contact_opportunity'; urgency = minutesRemaining !== null && minutesRemaining <= 15 ? 'focused' : 'routine';
    action = currentBand && qsoEvidence.currentBandQsoCount > 0 ? `Continue the productive ${currentBand} context; reassess only when progress stalls or current evidence changes.` : currentBand ? `Continue the bounded ${currentBand} attempt while current evidence is incomplete; reassess when new evidence arrives or the attempt reaches the policy boundary.` : action;
    reasons.push('The explicit objective is maximizing contacts.'); references.add('objective'); references.add('general_observed_rf'); references.add('modeled');
  } else if (objective?.goal === 'secure_activation') {
    category = 'qualification';
    if (remaining === 0) { urgency = 'complete'; action = 'The recorded QSO threshold is met; preserve the log and do not require a band change.'; reasons.push('Persisted progress meets the explicit qualification threshold.'); }
    else if (minutesRemaining !== null && minutesRemaining <= 10) { urgency = 'urgent'; action = currentBand && qsoEvidence.currentBandQsoCount > 0 ? 'Prioritize qualification attempts using the current context; minimize discretionary changes.' : 'Prioritize qualification attempts using a bounded current context; no two-way result yet supports calling it workable.'; reasons.push('The explicit deadline is near and the recorded threshold is not yet met.'); }
    else if (minutesRemaining !== null && minutesRemaining <= 30) { urgency = 'focused'; action = 'Focus on qualification attempts while retaining enough time for a deliberate context change.'; reasons.push('Recorded progress remains below the explicit threshold with limited time remaining.'); }
    else { urgency = 'routine'; action = currentBand && qsoEvidence.currentBandQsoCount > 0 ? 'Continue qualification attempts using the current context and reassess progress against the explicit threshold.' : 'Continue the bounded qualification attempt and wait for a two-way result before calling the context workable.'; reasons.push('Recorded progress remains below the explicit qualification threshold.'); }
    references.add('objective'); references.add('station_signal'); references.add('general_observed_rf'); references.add('modeled');
  }

  if (qsoEvidence.currentBandQsoCount > 0 && currentBand) {
    supportingEvidence.push(`Actual Activation results include ${qsoEvidence.currentBandQsoCount} two-way QSO${qsoEvidence.currentBandQsoCount === 1 ? '' : 's'} on ${currentBand}; the most recent current-band QSO was ${currentLastQso}.`);
    references.add('activation_qso_results');
    if (modeledBand && modeledBand !== currentBand) { conflictingEvidence.push(`Retained modeled propagation favors ${modeledBand}; actual current-band results are on ${currentBand}.`); references.add('modeled'); }
    if (stalled) {
      reasons.push(`Progress has stalled for ${MISSION_GUIDANCE_POLICY.progressStallMinutes} minutes since ${currentLastQso}; this triggers reassessment but does not prove propagation failure.`);
      if (modeledBand && modeledBand !== currentBand && (stationLimited || stationZero) && remaining !== 0) {
        action = `Reassess ${currentBand}; a bounded test of retained modeled alternative ${modeledBand} is supported while the objective remains incomplete.`;
        suggestedBand = modeledBand; supportingEvidence.push(`The retained model identifies ${modeledBand} as an alternative.`);
      } else action = `Reassess ${currentBand} now; retain the log and compare the next bounded evidence before changing.`;
    }
  }
  if (stationPositive) { supportingEvidence.push(`Current MY SIGNAL shows ${stationReportCount} matching reports from ${stationReceiverCount} unique receivers in station-specific outbound reception evidence.`); references.add('station_signal'); }
  else if (stationZero) { supportingEvidence.push('MY SIGNAL mature-zero reports no matching reception in its bounded observation; this does not establish propagation failure.'); reasons.push('Mature-zero MY SIGNAL is combined with other evidence and is not treated as proof of an unusable band.'); references.add('station_signal'); }
  else if (stationLimited) { missingLimitations.push(`MY SIGNAL is ${station?.state ?? 'unavailable'}; station-specific evidence is limited until the next applicable result.`); references.add('station_signal'); if (station?.state === 'awaiting_provider_latency' || station?.state === 'query_pending') reasons.push('Next expected evidence event: the bounded MY SIGNAL provider result for the current TX Context.'); }
  if (input.picture.layers.some(layer => layer.id === 'general_observed_rf' && ['stale', 'unavailable', 'not_applicable'].includes(layer.state))) { missingLimitations.push('General observed RF is stale, unavailable, or not applicable to the current context.'); references.add('general_observed_rf'); }
  if (input.picture.layers.some(layer => layer.id === 'environmental' && ['partial', 'unavailable'].includes(layer.state))) { missingLimitations.push('Environment or space-weather evidence is partial or unavailable.'); references.add('environmental'); }
  if (input.picture.layers.some(layer => layer.id === 'modeled' && layer.state === 'unavailable')) { missingLimitations.push('Retained modeled propagation is unavailable.'); references.add('modeled'); }
  if (objective) references.add('objective');
  if (modeledBand && currentBand && modeledBand !== currentBand) { references.add('modeled'); conflictingEvidence.push(`Retained modeled propagation favors ${modeledBand}; actual current-band results are on ${currentBand}.`); }
  if (deadlineUtc) reasons.push(`${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'} remain until ${deadlineUtc}; basis ${objective?.deadlineBasis}, provenance ${objective?.deadlineProvenance}.`);
  else reasons.push('No explicit operating deadline is available; urgency is not inferred from the planned mission window.');
  if (!objective && qsoEvidence.currentBandQsoCount > 0 && currentBand) { action = stalled ? `Reassess productive ${currentBand} after the ${MISSION_GUIDANCE_POLICY.progressStallMinutes}-minute progress stall; retain the log before changing.` : `Remain on productive ${currentBand}; reconsider after a ${MISSION_GUIDANCE_POLICY.progressStallMinutes}-minute progress stall or changed evidence.`; supportingEvidence.push('No objective is retained, so this recommendation uses actual results and bounded evidence without inventing a target.'); }
  if (!objective && qsoEvidence.currentBandQsoCount === 0) missingLimitations.push('No explicit objective or current-band QSO result is retained, so no band can be justified.');
  if (currentBand && qsoEvidence.currentBandQsoCount === 0 && input.currentContextStartedAtUtc) action = stalled ? `Reassess ${currentBand} now; this bounded attempt has produced no two-way QSO, but that does not establish propagation failure.` : `Continue the bounded ${currentBand} attempt until ${MISSION_GUIDANCE_POLICY.progressStallMinutes} minutes have elapsed or new evidence arrives; no two-way QSO is recorded yet.`;
  const reconsiderWhen = stalled ? `Reconsider now: no new ${currentBand ?? 'current-band'} QSO has been recorded for ${MISSION_GUIDANCE_POLICY.progressStallMinutes} minutes. Reconsider sooner if current evidence changes or becomes stale.` : `Reconsider after ${MISSION_GUIDANCE_POLICY.progressStallMinutes} minutes without a new current-band QSO, or sooner if MY SIGNAL/general evidence changes or becomes stale.`;
  const common = { kind: 'mission_aware_operating_guidance' as const, category, supportingEvidence, conflictingEvidence: [...new Set(conflictingEvidence)], missingLimitations, evidenceReferences: [...references], inputs: { goal: (objective?.goal ?? 'unspecified') as MissionGuidance['inputs']['goal'], goalLabel: objective?.label ?? 'No explicit objective', completedQsos: qsoEvidence.total, requiredQsos: required, remainingQsos: remaining, deadlineUtc, deadlineBasis: objective?.deadlineBasis ?? null, deadlineProvenance: objective?.deadlineProvenance ?? null, minutesRemaining, qsoEvidence }, limitations: ['Deterministic guidance from named inputs; not a prediction, guarantee, score, command, or automatic radio control.', 'Outbound reception evidence does not prove a usable return path or contact success.', 'Operator safety, access, band conditions, and legal requirements remain controlling.'], evaluatedAtUtc };
  if (input.retrospective) {
    const bandResults = Object.entries(qsoEvidence.byBand).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const primaryBand = currentBand ?? bandResults[0]?.[0] ?? null;
    const primaryCount = primaryBand ? qsoEvidence.byBand[primaryBand] ?? 0 : 0;
    const modeledSummary = modeledBand ? `the retained model favored ${modeledBand}` : 'the retained model did not identify a favored band';
    const stationSummary = stationPositive && stationMatch ? `MY SIGNAL retained ${stationReportCount} matching reports from ${stationReceiverCount} unique receivers${primaryBand && currentMode ? ` on ${primaryBand}/${currentMode}` : ''}` : 'MY SIGNAL retained no positive matching-receiver evidence';
    const comparison = primaryBand && primaryCount > 0 ? `${primaryBand} produced ${primaryCount} of ${qsoEvidence.total} QSOs; ${stationSummary}; ${modeledSummary}${modeledBand && modeledBand !== primaryBand ? `, while ${modeledBand} produced ${qsoEvidence.byBand[modeledBand] ?? 0} QSOs` : ''}.` : `${stationSummary}; ${modeledSummary}.`;
    return { ...common, urgency: 'complete' as const, action: `At activation end, ${comparison} This is a retrospective comparison, not a command to resume operating.`, reasons: ['This assessment is bounded by the retained Activation completion time and retained evidence.', 'The assessment describes the completed activation and does not direct future operation.'], reconsiderWhen: 'Reassessment would have been triggered only during the completed activation by the retained progress or evidence boundary.' };
  }
  return { ...common, urgency, action, ...(suggestedBand ? { suggestedBand } : {}), ...(suggestedMode ? { suggestedMode } : {}), reasons, reconsiderWhen };
}

function requireUtc(value: string): string { const parsed = Date.parse(value); if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(parsed)) throw new Error('evaluatedAtUtc must be a valid UTC timestamp.'); return new Date(parsed).toISOString(); }
