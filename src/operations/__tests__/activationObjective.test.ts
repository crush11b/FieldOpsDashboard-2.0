import { describe, expect, it } from 'vitest';
import { defaultActivationObjective, normalizeActivationObjective } from '../activationObjective';

describe('activation objective defaults', () => {
  it('uses program defaults and leaves General without a threshold', () => {
    expect(defaultActivationObjective('POTA')).toMatchObject({ goal: 'secure_activation', requiredQsoCount: '10', thresholdProvenance: 'program_default' });
    expect(defaultActivationObjective('SOTA')).toMatchObject({ goal: 'secure_activation', requiredQsoCount: '4', thresholdProvenance: 'program_default' });
    expect(defaultActivationObjective('General')).toMatchObject({ goal: 'maximize_contacts', requiredQsoCount: '' });
  });

  it('normalizes a positive operator threshold and local deadline once to UTC', () => {
    const result = normalizeActivationObjective({ goal: 'secure_activation', label: 'Qualify', requiredQsoCount: '7', thresholdProvenance: 'operator_entered', deadlineLocal: '2026-09-05T08:30' });
    expect(result.objective).toMatchObject({ requiredQsoCount: 7, thresholdProvenance: 'operator_entered', deadlineBasis: 'operator_entered', deadlineProvenance: 'operator_entered' });
    expect(result.deadlineUtc).toBe(result.objective?.deadlineUtc);
    expect(result.deadlineUtc).toMatch(/Z$/);
  });

  it('blocks zero and fractional thresholds before start', () => {
    expect(normalizeActivationObjective({ ...defaultActivationObjective('POTA'), requiredQsoCount: '0' }).error).toContain('positive');
    expect(normalizeActivationObjective({ ...defaultActivationObjective('POTA'), requiredQsoCount: '1.5' }).error).toContain('whole');
  });
});