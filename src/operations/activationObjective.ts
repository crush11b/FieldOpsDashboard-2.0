import type { ActivationGoal, ActivationOperatingObjective, ActivationType } from '../../server/activation';

export interface ActivationObjectiveDraft {
  readonly goal: ActivationGoal;
  readonly label: string;
  readonly requiredQsoCount: string;
  readonly thresholdProvenance: 'operator_entered' | 'program_default';
  readonly deadlineLocal: string;
}

export function defaultActivationObjective(type: ActivationType): ActivationObjectiveDraft {
  if (type === 'POTA') return { goal: 'secure_activation', label: 'Qualify POTA', requiredQsoCount: '10', thresholdProvenance: 'program_default', deadlineLocal: '' };
  if (type === 'SOTA') return { goal: 'secure_activation', label: 'Qualify SOTA', requiredQsoCount: '4', thresholdProvenance: 'program_default', deadlineLocal: '' };
  return { goal: 'maximize_contacts', label: 'Maximize contacts', requiredQsoCount: '', thresholdProvenance: 'operator_entered', deadlineLocal: '' };
}

export function normalizeActivationObjective(draft: ActivationObjectiveDraft): { objective?: ActivationOperatingObjective; error?: string; deadlineUtc?: string } {
  const label = draft.label.trim();
  if (!label) return { error: 'Objective label is required.' };
  const countText = draft.requiredQsoCount.trim();
  const count = countText ? Number(countText) : undefined;
  if (countText && (!Number.isSafeInteger(count) || count <= 0)) return { error: 'The objective threshold must be a positive whole number.' };
  const deadlineUtc = draft.deadlineLocal ? localDateTimeToUtc(draft.deadlineLocal) : undefined;
  if (draft.deadlineLocal && !deadlineUtc) return { error: 'The objective deadline is not a valid local date and time.' };
  return { objective: { goal: draft.goal, label, ...(count === undefined ? {} : { requiredQsoCount: count, thresholdProvenance: draft.thresholdProvenance }), ...(deadlineUtc ? { deadlineUtc, deadlineBasis: 'operator_entered', deadlineProvenance: 'operator_entered' } : {}) }, ...(deadlineUtc ? { deadlineUtc } : {}) };
}

export function localDateTimeToUtc(value: string): string | undefined {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}