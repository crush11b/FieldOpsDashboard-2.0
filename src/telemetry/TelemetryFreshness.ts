import type { TelemetryTimestamps } from './TelemetryEnvelope';

type FreshnessTimestamps = Pick<TelemetryTimestamps, 'observedAt' | 'expiresAt'>;

/** Describes telemetry age and declared expiration without changing lifecycle status. */
export function getTelemetryFreshness(
  timestamps: FreshnessTimestamps,
  now: number | Date = Date.now(),
) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const observed = new Date(timestamps.observedAt);
  const observedMs = observed.getTime();

  if (!Number.isFinite(nowMs) || Number.isNaN(observedMs)) {
    return {
      ageMs: null,
      relativeAge: 'Time unavailable',
      observedAtLabel: timestamps.observedAt,
      isFresh: false,
      isExpired: false,
    } as const;
  }

  const ageMs = Math.max(0, nowMs - observedMs);
  const elapsedSeconds = Math.floor(ageMs / 1000);
  let relativeAge: string;
  if (elapsedSeconds < 5) relativeAge = 'Just now';
  else if (elapsedSeconds < 60) relativeAge = `${elapsedSeconds}s ago`;
  else if (elapsedSeconds < 3600) relativeAge = `${Math.floor(elapsedSeconds / 60)}m ago`;
  else if (elapsedSeconds < 86400) relativeAge = `${Math.floor(elapsedSeconds / 3600)}h ago`;
  else relativeAge = `${Math.floor(elapsedSeconds / 86400)}d ago`;

  let isFresh = true;
  let isExpired = false;
  if (timestamps.expiresAt !== undefined) {
    const expiresAtMs = new Date(timestamps.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) {
      isFresh = false;
    } else {
      isExpired = nowMs > expiresAtMs;
      isFresh = !isExpired;
    }
  }

  return {
    ageMs,
    relativeAge,
    observedAtLabel: observed.toLocaleString(),
    isFresh,
    isExpired,
  } as const;
}
