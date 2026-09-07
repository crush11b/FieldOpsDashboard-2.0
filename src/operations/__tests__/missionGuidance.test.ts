import { describe, expect, it } from 'vitest';
import { aggregateQsoEvidence } from '../../../server/qsoEvidence';
import { MISSION_GUIDANCE_POLICY, assembleMissionGuidance } from '../missionGuidance';

const activation = (goal?: string, extra: any = {}) => ({ activationId: 'a', type: 'General', status: 'active', updatedAtUtc: '2026-09-05T12:00:00.000Z', operatingObjective: goal ? { goal, label: goal, ...extra } : undefined } as any);
const picture = (station = '2 matching reports from 2 unique receivers.', stationState: any = 'evidence_available', modeled = '20m') => ({ kind: 'layered_propagation_picture', layers: [{ id: 'modeled', state: modeled ? 'retained' : 'unavailable', summary: modeled ? `Representative strongest bands: ${modeled}.` : 'Unavailable.' }, { id: 'environmental', state: 'retained', summary: 'Retained.' }, { id: 'general_observed_rf', state: 'live', summary: '49 recent reports.' }, { id: 'station_signal', state: stationState, summary: station }], relationships: [], limitation: 'Separate evidence.' } as any);
const qso = (id: string, band: string, at: string, mode = 'FT8') => ({ qsoId: id, qsoDateTimeUtc: at, band, mode, source: 'manual' } as any);
const evaluate = (active: any, qsos: any[], at = '2026-09-05T12:00:00.000Z', evidence = picture(), currentBand = '20m') => assembleMissionGuidance({ activation: active, qsoEvidence: aggregateQsoEvidence(qsos, currentBand, 'FT8'), evaluatedAtUtc: at, picture: evidence, modeledBands: ['15m'], currentBand, currentMode: 'FT8' });

describe('mission-aware operating guidance', () => {
  it('renders the exact field acceptance evidence without inventing an objective', () => {
    const result = evaluate(activation(), [
      ...Array.from({ length: 8 }, (_, i) => qso(`old-${i}`, '20m', `2026-09-05T11:4${i}:00.000Z`)),
      qso('recent-20', '20m', '2026-09-05T11:55:00.000Z'),
      qso('one-15', '15m', '2026-09-05T11:56:00.000Z'), qso('two-15', '15m', '2026-09-05T11:57:00.000Z'),
    ], '2026-09-05T12:00:00.000Z', picture('49 matching reports from 49 unique receivers.', 'evidence_available', '15m'));
    expect(result.action).toContain('Remain on productive 20m');
    expect(result.supportingEvidence.join(' ')).toContain('9 two-way QSOs on 20m');
    expect(result.supportingEvidence.join(' ')).toContain('49 matching reports');
    expect(result.conflictingEvidence).toEqual(['Retained modeled propagation favors 15m; actual current-band results are on 20m.']);
    expect(result.evidenceReferences).toEqual(['activation_qso_results', 'modeled', 'station_signal']);
    expect(result.reconsiderWhen).toContain(`${MISSION_GUIDANCE_POLICY.progressStallMinutes} minutes`);
    expect(result.inputs.goal).toBe('unspecified');
    expect(result.inputs.deadlineUtc).toBeNull();
    expect(result.action).not.toMatch(/best-band|score|guarantee|return path|contact probability/i);
  });
  it('reassesses a current band after the named progress stall', () => {
    const result = evaluate(activation('secure_activation', { requiredQsoCount: 10 }), [qso('a', '20m', '2026-09-05T11:49:00.000Z')]);
    expect(result.action).toContain('Reassess 20m now');
    expect(result.reasons.join(' ')).toContain('10 minutes');
  });
  it('lets actual QSOs outrank a modeled alternative when qualification is incomplete', () => {
    const result = evaluate(activation('secure_activation', { requiredQsoCount: 10 }), [qso('a', '20m', '2026-09-05T11:59:00.000Z')]);
    expect(result.suggestedBand).toBe('20m');
    expect(result.inputs.remainingQsos).toBe(9);
  });
  it('marks qualification complete and preserves the retained log', () => {
    const result = evaluate(activation('secure_activation', { requiredQsoCount: 2 }), [qso('a', '20m', '2026-09-05T11:58:00.000Z'), qso('b', '15m', '2026-09-05T11:59:00.000Z')]);
    expect(result.urgency).toBe('complete');
    expect(result.action).toContain('preserve the log');
  });
  it('treats positive MY SIGNAL as outbound evidence only', () => {
    const result = evaluate(activation('secure_activation', { requiredQsoCount: 10 }), [], '2026-09-05T12:00:00.000Z', picture());
    expect(result.supportingEvidence.join(' ')).toContain('MY SIGNAL');
    expect(result.limitations.join(' ')).toContain('return path');
  });
  it('distinguishes mature zero, pending, stale, and unavailable station evidence', () => {
    for (const [state, summary] of [['no_matching_reports', 'No matching reports observed.'], ['awaiting_provider_latency', 'PSKReporter pending.'], ['stale_evidence', '2 matching reports from 2 unique receivers.'], ['unavailable', 'Unavailable.']] as const) {
      const result = evaluate(activation(), [], '2026-09-05T12:00:00.000Z', picture(summary, state));
      expect(result.inputs.qsoEvidence.total).toBe(0);
      expect(JSON.stringify(result)).not.toContain('contact probability');
    }
  });
  it('abstains without an objective or current-band result', () => {
    const result = evaluate(activation(), [], '2026-09-05T12:00:00.000Z', picture(), '40m');
    expect(result.action).toContain('Log a two-way QSO');
    expect(result.missingLimitations.join(' ')).toContain('No explicit objective');
  });
  it('does not infer urgency from the mission window', () => {
    const result = evaluate(activation('maximize_contacts'), [qso('a', '20m', '2026-09-05T11:59:00.000Z')]);
    expect(result.inputs.deadlineUtc).toBeNull();
    expect(result.reasons.join(' ')).toContain('not inferred from the planned mission window');
  });
  it('uses the current-context start as the no-QSO attempt boundary', () => {
    const active = activation('maximize_contacts');
    const base = { ...aggregateQsoEvidence([], '20m', 'FT8') };
    const input = (at: string) => assembleMissionGuidance({ activation: active, qsoEvidence: base, evaluatedAtUtc: at, picture: picture('PSKReporter pending.', 'awaiting_provider_latency'), currentBand: '20m', currentMode: 'FT8', currentContextStartedAtUtc: '2026-09-05T11:50:00.000Z' });
    expect(input('2026-09-05T11:59:59.000Z').action).toContain('Continue the bounded 20m attempt');
    expect(input('2026-09-05T12:00:00.000Z').action).toContain('Reassess 20m now');
    expect(input('2026-09-05T12:00:01.000Z').action).toContain('no two-way QSO');
    expect(input('2026-09-05T12:00:01.000Z').action).not.toMatch(/failed|unusable|productive|workable/i);
  });
  it('is deterministic for identical retained inputs', () => {
    const active = activation('maximize_contacts');
    expect(evaluate(active, [qso('a', '20m', '2026-09-05T11:59:00.000Z')])).toEqual(evaluate(active, [qso('a', '20m', '2026-09-05T11:59:00.000Z')]));
  });
});
