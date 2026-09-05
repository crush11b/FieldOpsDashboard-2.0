import type { Activation, ActivationOperatingObjective } from '../../server/activation';
import type { LayeredPropagationPicture, PropagationLayerId } from '../propagation/layeredPicture';

export type GuidanceCategory = 'qualification' | 'exploration' | 'reach' | 'contact_opportunity' | 'maintain_context';
export type GuidanceUrgency = 'none' | 'routine' | 'focused' | 'urgent' | 'complete';

export interface MissionGuidance {
  readonly kind: 'mission_aware_operating_guidance';
  readonly category: GuidanceCategory;
  readonly urgency: GuidanceUrgency;
  readonly action: string;
  readonly suggestedBand?: string;
  readonly suggestedMode?: string;
  readonly reasons: readonly string[];
  readonly evidenceReferences: readonly PropagationLayerId[];
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
  };
  readonly limitations: readonly string[];
  readonly evaluatedAtUtc: string;
}

export interface MissionGuidanceInput {
  readonly activation: Activation;
  readonly qsoCount: number;
  readonly picture: LayeredPropagationPicture;
  readonly evaluatedAtUtc: string;
  readonly modeledBands?: readonly string[];
  readonly currentBand?: string;
  readonly currentMode?: string;
}

export function assembleMissionGuidance(input: MissionGuidanceInput): MissionGuidance {
  const evaluatedAtUtc = requireUtc(input.evaluatedAtUtc);
  const qsoCount = Number.isSafeInteger(input.qsoCount) && input.qsoCount >= 0 ? input.qsoCount : 0;
  const objective = input.activation.operatingObjective;
  const required = objective?.requiredQsoCount ?? null;
  const remaining = required === null ? null : Math.max(0, required - qsoCount);
  const deadlineUtc = objective?.deadlineUtc ?? null;
  const minutesRemaining = deadlineUtc === null ? null : Math.floor((Date.parse(deadlineUtc) - Date.parse(evaluatedAtUtc)) / 60_000);
  const modeledBand = input.modeledBands?.find(Boolean);
  const onlineLayers = input.picture.layers.filter(layer => layer.id === 'general_observed_rf' || layer.id === 'station_signal');
  const degradedOnline = onlineLayers.filter(layer => layer.state === 'stale' || layer.state === 'unavailable' || layer.state === 'not_applicable');
  const station = input.picture.layers.find(layer => layer.id === 'station_signal');
  const zeroSignal = station?.summary === 'No matching reports observed.';
  const disagreement = input.picture.relationships.length > 0;
  const reasons: string[] = [];
  const references = new Set<PropagationLayerId>();
  let category: GuidanceCategory = 'maintain_context';
  let urgency: GuidanceUrgency = 'none';
  let action = 'Continue operating with operator judgment; no explicit mission objective is available.';
  let suggestedBand: string | undefined;
  let suggestedMode: string | undefined;

  if (objective?.goal === 'explore_bands') {
    category = 'exploration'; urgency = 'routine';
    action = 'Continue the planned band exploration; record each change as a new TX Context.';
    reasons.push('The explicit objective is band exploration, not a hidden contact-count target.');
    if (remaining === 0 && required !== null) reasons.push('The recorded QSO threshold is already met; exploration remains the explicit objective.');
    references.add('modeled'); references.add('general_observed_rf');
  } else if (objective?.goal === 'chase_dx') {
    category = 'reach'; urgency = minutesRemaining !== null && minutesRemaining <= 15 ? 'focused' : 'routine';
    action = modeledBand ? `Consider the modeled reach-oriented opportunity on ${modeledBand}; confirm conditions and operator constraints before changing.` : 'Continue the current reach-oriented attempt; modeled band support is unavailable.';
    suggestedBand = modeledBand; suggestedMode = input.currentMode;
    reasons.push('The explicit objective is DX reach.'); references.add('modeled'); references.add('general_observed_rf'); references.add('station_signal');
  } else if (objective?.goal === 'maximize_contacts') {
    category = 'contact_opportunity'; urgency = minutesRemaining !== null && minutesRemaining <= 15 ? 'focused' : 'routine';
    action = input.currentBand ? `Continue evaluating contact opportunity on ${input.currentBand}; change only when the separate evidence and operator judgment support it.` : 'Use the available modeled and observed layers to choose the next contact attempt.';
    suggestedBand = input.currentBand ?? modeledBand; suggestedMode = input.currentMode;
    reasons.push('The explicit objective is maximizing contacts.'); references.add('general_observed_rf'); references.add('modeled');
  } else if (objective?.goal === 'secure_activation') {
    category = 'qualification';
    if (remaining === 0) { urgency = 'complete'; action = 'The recorded QSO threshold is met; preserve the log and continue only as the operator chooses.'; reasons.push('Persisted progress meets the explicit qualification threshold.'); }
    else if (minutesRemaining !== null && minutesRemaining <= 10) { urgency = 'urgent'; action = 'Prioritize qualification attempts using the current workable context; minimize discretionary changes.'; reasons.push('The explicit deadline is near and the recorded threshold is not yet met.'); }
    else if (minutesRemaining !== null && minutesRemaining <= 30) { urgency = 'focused'; action = 'Focus on qualification attempts while retaining enough time for a deliberate context change.'; reasons.push('Recorded progress remains below the explicit threshold with limited time remaining.'); }
    else { urgency = 'routine'; action = 'Continue qualification attempts and reassess progress against the explicit threshold.'; reasons.push('Recorded progress remains below the explicit qualification threshold.'); }
    suggestedBand = input.currentBand ?? modeledBand; suggestedMode = input.currentMode; references.add('station_signal'); references.add('general_observed_rf'); references.add('modeled');
  }

  if (deadlineUtc) reasons.push(`${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'} remain until ${deadlineUtc}; basis ${objective?.deadlineBasis}, provenance ${objective?.deadlineProvenance}.`);
  else reasons.push('No explicit operating deadline is available; urgency is not inferred from the planned mission window.');
  if (references.has('general_observed_rf') || references.has('station_signal')) reasons.push(`Referenced observed evidence states: ${onlineLayers.map(layer => `${layer.label} ${layer.state}`).join(', ')}.`);
  if (degradedOnline.length) reasons.push(`Online evidence is degraded: ${degradedOnline.map(layer => `${layer.label} ${layer.state}`).join(', ')}. Retained planning/model context remains separate.`);
  if (zeroSignal) reasons.push('No matching reports observed. This is not a finding of bad propagation or station failure.');
  if (disagreement) reasons.push('The evidence layers differ; neither modeled nor observed evidence replaces the other.');

  return {
    kind: 'mission_aware_operating_guidance', category, urgency, action,
    ...(suggestedBand ? { suggestedBand } : {}), ...(suggestedMode ? { suggestedMode } : {}),
    reasons, evidenceReferences: [...references],
    inputs: { goal: objective?.goal ?? 'unspecified', goalLabel: objective?.label ?? 'No explicit objective', completedQsos: qsoCount, requiredQsos: required, remainingQsos: remaining, deadlineUtc, deadlineBasis: objective?.deadlineBasis ?? null, deadlineProvenance: objective?.deadlineProvenance ?? null, minutesRemaining },
    limitations: ['Deterministic guidance from named inputs; not a prediction, guarantee, command, or automatic radio control.', 'Operator safety, access, band conditions, and legal requirements remain controlling.'],
    evaluatedAtUtc,
  };
}

function requireUtc(value: string): string { const parsed = Date.parse(value); if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(parsed)) throw new Error('evaluatedAtUtc must be a valid UTC timestamp.'); return new Date(parsed).toISOString(); }
