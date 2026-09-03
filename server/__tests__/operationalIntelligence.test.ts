import { describe, expect, it } from 'vitest';
import { createActivation, normalizeActivation } from '../activation';
import { normalizeStationSignalObservation, normalizeTxContext } from '../operationalIntelligence';

const base = { activationId: 'activation-1', createdAtUtc: '2026-08-25T10:00:00.000Z', updatedAtUtc: '2026-08-25T10:00:00.000Z', status: 'planned', type: 'General', schemaVersion: 2 };

describe('operational intelligence contracts', () => {
  it('accepts an explicit objective and preserves its provenance', () => {
    const activation = createActivation({ type: 'General', operatingObjective: { goal: 'secure_activation', label: 'Qualify the activation', requiredQsoCount: 10, thresholdProvenance: 'operator_entered', deadlineUtc: '2026-08-25T18:00:00Z', deadlineBasis: 'mission_end', deadlineProvenance: 'operator_entered' } }, { now: () => new Date('2026-08-25T10:00:00Z'), createId: () => 'activation-1' });
    expect(activation.operatingObjective?.requiredQsoCount).toBe(10);
    expect(activation.operatingObjective?.deadlineBasis).toBe('mission_end');
  });

  it('does not infer a structured objective from free text', () => {
    const result = normalizeActivation({ ...base, objective: 'Make some contacts' });
    expect(result.valid).toBe(true);
    expect(result.activation?.operatingObjective).toBeUndefined();
  });

  it('requires complete timestamped TX Context values and accepts mixed provenance', () => {
    expect(normalizeTxContext({ contextId: 'context-1', activationId: 'activation-1', startedAtUtc: '2026-08-25T10:00:00Z', radioSetupLabel: 'Portable rig', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8', provenance: { radioSetup: 'operator_supplied', band: 'wsjtx_reported' } })).toBeTruthy();
    expect(normalizeTxContext({ contextId: 'context-1', activationId: 'activation-1', startedAtUtc: '2026-08-25T10:00:00Z', endedAtUtc: '2026-08-25T09:00:00Z', radioSetupLabel: 'Portable rig', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8', provenance: {} })).toBeNull();
  });

  it('accepts bounded station observations and rejects reversed intervals', () => {
    const observation = { observationId: 'observation-1', activationId: 'activation-1', contextId: 'context-1', startsAtUtc: '2026-08-25T10:00:00Z', endsAtUtc: '2026-08-25T10:05:00Z', source: 'pskreporter', status: 'retained', matchingReports: 4, uniqueReceivers: 3, reportsPerMinute: 0.8, uniqueReceiversPerMinute: 0.6, limitation: 'Observed RF only; not proof of transmission.' };
    expect(normalizeStationSignalObservation(observation)).toBeTruthy();
    expect(normalizeStationSignalObservation({ ...observation, endsAtUtc: '2026-08-25T09:59:00Z' })).toBeNull();
  });
});
