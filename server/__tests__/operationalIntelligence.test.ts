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
    expect(normalizeTxContext({ segmentId: 'segment-1', activationId: 'activation-1', startedAtUtc: '2026-08-25T10:00:00Z', radioSetupLabel: 'Portable rig', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8', provenance: { radioSetup: 'operator_entered', antenna: 'operator_confirmed_plan', transmitPowerWatts: 'operator_entered', band: 'wsjtx_application', mode: 'wsjtx_application' } })).toBeTruthy();
    expect(normalizeTxContext({ segmentId: 'segment-1', activationId: 'activation-1', startedAtUtc: '2026-08-25T10:00:00Z', endedAtUtc: '2026-08-25T09:00:00Z', radioSetupLabel: 'Portable rig', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8', provenance: { radioSetup: 'operator_entered', antenna: 'operator_entered', transmitPowerWatts: 'operator_entered', band: 'operator_entered', mode: 'operator_entered' } })).toBeNull();
  });

  it('accepts bounded station observations and rejects reversed intervals', () => {
    const observation = { observationId: 'observation-1', activationId: 'activation-1', txContextSegmentId: 'segment-1', startsAtUtc: '2026-08-25T10:00:00Z', endsAtUtc: '2026-08-25T10:05:00Z', source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', status: 'retained', matchingReportCount: 4, uniqueReceiverCount: 3, reportsPerMinute: 0.8, uniqueReceiversPerMinute: 0.6, newestMatchingReportAtUtc: '2026-08-25T10:04:00Z', limitations: ['Observed RF only; not proof of transmission.'] };
    expect(normalizeStationSignalObservation(observation)).toBeTruthy();
    expect(normalizeStationSignalObservation({ ...observation, endsAtUtc: '2026-08-25T09:59:00Z' })).toBeNull();
  });
  it('supports all objective goals and rejects incomplete objective rules', () => {
    for (const goal of ['secure_activation', 'maximize_contacts', 'chase_dx', 'explore_bands'] as const) expect(createActivation({ type: 'General', operatingObjective: { goal, label: `Goal ${goal}` } }, { createId: () => `activation-${goal}` }).operatingObjective?.goal).toBe(goal);
    expect(normalizeActivation({ ...base, operatingObjective: { goal: 'balanced', label: 'Balanced' } }).valid).toBe(false);
    expect(normalizeActivation({ ...base, operatingObjective: { goal: 'secure_activation', label: ' ' } }).valid).toBe(false);
    expect(normalizeActivation({ ...base, operatingObjective: { goal: 'secure_activation', label: 'Goal', requiredQsoCount: 2 } }).valid).toBe(false);
    expect(normalizeActivation({ ...base, operatingObjective: { goal: 'secure_activation', label: 'Goal', thresholdProvenance: 'operator_entered' } }).valid).toBe(false);
    expect(normalizeActivation({ ...base, missionWindow: { start: '2026-08-25T10:00:00Z', end: '2026-08-25T11:00:00Z' }, operatingObjective: { goal: 'secure_activation', label: 'Goal' } }).activation?.operatingObjective?.deadlineUtc).toBeUndefined();
  });
  it('rejects invalid TX provenance, arbitrary vocabularies, and malformed observation evidence', () => {
    const valid = { segmentId: 'segment-1', activationId: 'activation-1', startedAtUtc: '2026-08-25T10:00:00Z', radioSetupLabel: 'Portable rig', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8', frequencyMHz: 14.074, provenance: { radioSetup: 'operator_entered', antenna: 'operator_entered', transmitPowerWatts: 'operator_entered', band: 'wsjtx_application', mode: 'wsjtx_application', frequencyMHz: 'wsjtx_application' } };
    expect(normalizeTxContext(valid)).toMatchObject({ segmentId: 'segment-1', frequencyMHz: 14.074 });
    expect(normalizeTxContext({ ...valid, provenance: { ...valid.provenance, radioSetup: 'wsjtx_application' } })).toBeNull();
    expect(normalizeTxContext({ ...valid, band: 'bogus' })).toBeNull();
    expect(normalizeTxContext({ ...valid, provenance: { ...valid.provenance, extra: 'operator_entered' } })).toBeNull();
    const observation = { observationId: 'observation-1', activationId: 'activation-1', txContextSegmentId: 'segment-1', startsAtUtc: '2026-08-25T10:00:00Z', endsAtUtc: '2026-08-25T10:05:00Z', source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', status: 'retained', matchingReportCount: 4, uniqueReceiverCount: 3, newestMatchingReportAtUtc: '2026-08-25T10:04:00Z', limitations: ['Observed RF only'] };
    expect(normalizeStationSignalObservation({ ...observation, reportsPerMinute: 1, matchingReportCount: 0 })).toBeNull();
    expect(normalizeStationSignalObservation({ ...observation, receiverPopulation: 10 })).toBeNull();
    expect(normalizeStationSignalObservation({ ...observation, distance: { derivation: 'maidenhead_locator_centers', approximate: true, locatedReportCount: 5, nearestKm: 1, medianKm: 2, farthestKm: 3 } })).toBeNull();
    expect(normalizeStationSignalObservation({ ...observation, snr: { reportCount: 4, minimumDb: 3, medianDb: 1, maximumDb: 5 } })).toBeNull();
  });
  it('normalizes bounded text and timestamps, and models WSPR power separately', () => {
    const context = normalizeTxContext({ segmentId: ' segment-1 ', activationId: ' activation-1 ', startedAtUtc: '2026-08-25T10:00:00Z', radioSetupLabel: ' Rig ', antennaLabel: ' EFHW ', transmitPowerWatts: 10, band: '20m', mode: 'FT8', provenance: { radioSetup: 'operator_entered', antenna: 'operator_entered', transmitPowerWatts: 'operator_entered', band: 'operator_entered', mode: 'operator_entered' } });
    expect(context).toMatchObject({ segmentId: 'segment-1', radioSetupLabel: 'Rig', startedAtUtc: '2026-08-25T10:00:00.000Z' });
    const baseObservation = { observationId: 'observation-1', activationId: 'activation-1', txContextSegmentId: 'segment-1', startsAtUtc: '2026-08-25T10:00:00Z', endsAtUtc: '2026-08-25T10:05:00Z', status: 'live', matchingReportCount: 0, uniqueReceiverCount: 0, newestMatchingReportAtUtc: null, limitations: ['No matching reports observed'] };
    expect(normalizeStationSignalObservation({ ...baseObservation, source: 'wspr', sourceSemantics: 'source_reported_wspr_reception', sourceReportedTransmitPowerWatts: 5 })).toMatchObject({ source: 'wspr', sourceReportedTransmitPowerWatts: 5 });
    expect(normalizeStationSignalObservation({ ...baseObservation, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', reportsPerMinute: 0 })).toBeTruthy();
    expect(normalizeStationSignalObservation({ ...baseObservation, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', endsAtUtc: '2026-08-25T10:00:00Z', reportsPerMinute: 0 })).toBeNull();
    for (const field of ['receiverPopulation', 'observableReceiverPopulation', 'receiverPopulationRatio', 'percentageHearing', 'percentHeard', 'contactProbability', 'confidence', 'confidenceScore', 'rating', 'propagationRating']) expect(normalizeStationSignalObservation({ ...baseObservation, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', [field]: 1 })).toBeNull();
  });
});
