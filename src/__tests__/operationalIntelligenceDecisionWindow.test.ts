import { describe, expect, it } from 'vitest';
import type { StationSignalObservation, TxContext } from '../../server/operationalIntelligence';
import { deriveMySignalDecisionWindow, formatDecisionWindowDuration, MY_SIGNAL_TIMING_POLICY, nextEligibleCaptureAt, summarizeConsecutiveZeroObservations } from '../operationalIntelligenceDecisionWindow';

const context: TxContext = {
  segmentId: 'segment/1', activationId: 'activation/1', startedAtUtc: '2026-09-05T00:00:00.000Z',
  radioSetupLabel: 'IC-705', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8',
  provenance: { radioSetup: 'operator_entered', antenna: 'operator_entered', transmitPowerWatts: 'operator_entered', band: 'operator_entered', mode: 'operator_entered' },
};

function observation(id: string, status: StationSignalObservation['status'], matchingReportCount: number): StationSignalObservation {
  return { observationId: id, activationId: context.activationId, txContextSegmentId: context.segmentId, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc: '2026-09-05T00:00:00.000Z', endsAtUtc: `2026-09-05T00:0${id}.000Z`, status, matchingReportCount, uniqueReceiverCount: matchingReportCount, reportsPerMinute: matchingReportCount, uniqueReceiversPerMinute: matchingReportCount, newestMatchingReportAtUtc: matchingReportCount ? '2026-09-05T00:01:00.000Z' : null, limitations: [] };
}

const input = (overrides: Partial<Parameters<typeof deriveMySignalDecisionWindow>[0]> = {}) => ({ openContext: context, observations: [], nowMs: Date.parse(context.startedAtUtc), queryPending: false, providerError: null, ...overrides });

describe('operational intelligence decision window', () => {
  it('uses the documented first eligibility and refresh floor', () => {
    const started = Date.parse(context.startedAtUtc);
    expect(MY_SIGNAL_TIMING_POLICY.initialProviderLatencyMs).toBe(3 * 60_000);
    expect(MY_SIGNAL_TIMING_POLICY.minimumRefreshIntervalMs).toBe(2 * 60_000);
    expect(nextEligibleCaptureAt(context, null)).toBe(started + 3 * 60_000);
    expect(nextEligibleCaptureAt(context, started + 3 * 60_000)).toBe(started + 5 * 60_000);
  });

  it('keeps an uncaptured context awaiting until the query starts', () => {
    const eligibleAt = nextEligibleCaptureAt(context, null);
    expect(deriveMySignalDecisionWindow(input({ nowMs: eligibleAt })).state).toBe('awaiting_provider_latency');
    expect(deriveMySignalDecisionWindow(input({ nowMs: eligibleAt, queryPending: true })).state).toBe('query_pending');
  });

  it('derives retained evidence, zero reports, stale evidence, and provider failure', () => {
    expect(deriveMySignalDecisionWindow(input({ observations: [observation('1', 'live', 2)] })).state).toBe('evidence_available');
    expect(deriveMySignalDecisionWindow(input({ observations: [observation('2', 'retained', 0)] })).state).toBe('no_matching_reports');
    expect(deriveMySignalDecisionWindow(input({ observations: [observation('3', 'stale', 2)] })).state).toBe('stale_evidence');
    expect(deriveMySignalDecisionWindow(input({ providerError: 'provider down', providerErrorCode: 'observed_rf_unavailable' })).state).toBe('provider_unavailable');
    expect(deriveMySignalDecisionWindow(input({ providerError: 'storage down', providerErrorCode: 'persistence_unavailable' })).state).toBe('capture_unavailable');
    expect(deriveMySignalDecisionWindow({ ...input(), openContext: null }).state).toBe('missing_context');
  });

  it('keeps the decision state honest when only retained observations remain', () => {
    const retained = observation('1', 'retained', 2);
    expect(deriveMySignalDecisionWindow({ ...input({ observations: [retained] }), openContext: null }).state).toBe('missing_context');
  });

  it('groups only consecutive zero-report observations', () => {
    const groups = summarizeConsecutiveZeroObservations([observation('1', 'retained', 0), observation('2', 'retained', 0), observation('3', 'retained', 1), observation('4', 'retained', 0)]);
    expect(groups.map(group => [group.kind, group.observations.length])).toEqual([['zero', 2], ['positive', 1], ['zero', 1]]);
  });

  it('formats countdowns without negative values', () => {
    expect(formatDecisionWindowDuration(0)).toBe('0 seconds');
    expect(formatDecisionWindowDuration(1_001)).toBe('2 seconds');
    expect(formatDecisionWindowDuration(60_000)).toBe('1 minute');
  });
});
