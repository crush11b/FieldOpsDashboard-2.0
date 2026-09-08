import type { StationSignalObservation, TxContext } from '../server/operationalIntelligence';

export const MY_SIGNAL_TIMING_POLICY = {
  initialProviderLatencyMs: 3 * 60_000,
  minimumRefreshIntervalMs: 2 * 60_000,
  countdownTickMs: 1_000,
} as const;

export type MySignalDecisionWindowState =
  | 'missing_context'
  | 'retained_evidence'
  | 'awaiting_provider_latency'
  | 'query_pending'
  | 'no_matching_reports'
  | 'evidence_available'
  | 'stale_evidence'
  | 'provider_unavailable'
  | 'capture_unavailable';

export interface MySignalDecisionWindow {
  readonly state: MySignalDecisionWindowState;
  readonly nextEligibleAtMs: number | null;
  readonly lastCompletedAtMs: number | null;
  readonly latestObservation: StationSignalObservation | null;
}

export function nextEligibleCaptureAt(context: TxContext, lastCompletedAtMs: number | null): number {
  const contextEligibleAt = Date.parse(context.startedAtUtc) + MY_SIGNAL_TIMING_POLICY.initialProviderLatencyMs;
  const refreshEligibleAt = lastCompletedAtMs === null ? contextEligibleAt : lastCompletedAtMs + MY_SIGNAL_TIMING_POLICY.minimumRefreshIntervalMs;
  return Math.max(contextEligibleAt, refreshEligibleAt);
}

export function deriveMySignalDecisionWindow(input: {
  readonly openContext: TxContext | null;
  readonly observations: readonly StationSignalObservation[];
  readonly nowMs: number;
  readonly queryPending: boolean;
  readonly providerError: string | null;
  readonly providerErrorCode?: string | null;
}): MySignalDecisionWindow {
  const contextObservations = input.observations
    .filter(observation => !input.openContext || observation.txContextSegmentId === input.openContext.segmentId)
    .sort((left, right) => right.endsAtUtc.localeCompare(left.endsAtUtc) || right.observationId.localeCompare(left.observationId));
  const latestObservation = contextObservations[0] ?? null;
  if (!input.openContext) return { state: 'missing_context', nextEligibleAtMs: null, lastCompletedAtMs: null, latestObservation };
  const lastCompletedAtMs = latestObservation ? Date.parse(latestObservation.endsAtUtc) : null;
  const nextEligibleAtMs = nextEligibleCaptureAt(input.openContext, lastCompletedAtMs);
  if (input.queryPending) return { state: 'query_pending', nextEligibleAtMs, lastCompletedAtMs, latestObservation };
  if (input.providerError) return { state: input.providerErrorCode === 'observed_rf_unavailable' ? 'provider_unavailable' : 'capture_unavailable', nextEligibleAtMs, lastCompletedAtMs, latestObservation };
  if (latestObservation?.status === 'stale') return { state: 'stale_evidence', nextEligibleAtMs, lastCompletedAtMs, latestObservation };
  if (latestObservation) return { state: latestObservation.matchingReportCount > 0 ? 'evidence_available' : 'no_matching_reports', nextEligibleAtMs, lastCompletedAtMs, latestObservation };
  return { state: 'awaiting_provider_latency', nextEligibleAtMs, lastCompletedAtMs, latestObservation };
}

export function formatDecisionWindowDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? '' : 's'}`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export function summarizeConsecutiveZeroObservations(observations: readonly StationSignalObservation[]): readonly { readonly observations: readonly StationSignalObservation[]; readonly kind: 'zero' | 'positive' }[] {
  const groups: { observations: StationSignalObservation[]; kind: 'zero' | 'positive' }[] = [];
  for (const observation of observations) {
    const kind = observation.matchingReportCount === 0 ? 'zero' : 'positive';
    const previous = groups.at(-1);
    if (kind === 'zero' && previous?.kind === 'zero') previous.observations.push(observation);
    else groups.push({ kind, observations: [observation] });
  }
  return groups;
}
