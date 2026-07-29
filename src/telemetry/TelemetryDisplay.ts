import type { TelemetrySource } from './TelemetryEnvelope';

/** Canonical non-value shown when telemetry has no displayable payload. */
export const TELEMETRY_UNAVAILABLE_VALUE = '—';

/** Accessible text accompanying an unavailable telemetry value. */
export const TELEMETRY_UNAVAILABLE_LABEL = 'Unavailable';

/** Returns operator-facing source provenance without inferring source semantics. */
export function getTelemetrySourceLabel(
  source: Pick<TelemetrySource, 'name' | 'type'>,
): string {
  return source.name?.trim() || source.type;
}
