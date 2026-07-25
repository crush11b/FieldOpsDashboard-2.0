/** Canonical lifecycle states shared by all telemetry producers. */
export const TELEMETRY_STATUSES = [
  /** The source is initializing and may not have produced a reading yet. */
  'connecting',
  /** A current reading was received and is fully usable. */
  'ok',
  /** A current reading is usable, but the source reports reduced quality. */
  'degraded',
  /** The last reading is older than its expected freshness window. */
  'stale',
  /** A retained reading is being served because a live source is unavailable. */
  'cached',
  /** The source cannot currently provide a reading. */
  'unavailable',
  /** The source failed and supplied structured error metadata. */
  'error',
] as const;

export type TelemetryStatus = (typeof TELEMETRY_STATUSES)[number];
