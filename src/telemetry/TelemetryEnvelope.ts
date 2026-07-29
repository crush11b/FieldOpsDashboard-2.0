import type { TelemetryError } from './TelemetryError';
import type { TelemetryStatus } from './TelemetryStatus';

/** Identifies the producer and transport behind a telemetry reading. */
export interface TelemetrySource {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
  readonly version?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** ISO-8601 timestamps describing the reading's lifecycle. */
export interface TelemetryTimestamps {
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly expiresAt?: string;
}

interface TelemetryEnvelopeBase {
  readonly source: TelemetrySource;
  readonly timestamps: TelemetryTimestamps;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface LiveTelemetryEnvelope<TPayload> extends TelemetryEnvelopeBase {
  readonly status: Extract<TelemetryStatus, 'ok' | 'degraded'>;
  readonly data: TPayload;
  readonly error?: never;
}

interface RetainedTelemetryEnvelope<TPayload> extends TelemetryEnvelopeBase {
  readonly status: Extract<TelemetryStatus, 'stale' | 'cached'>;
  readonly data?: TPayload;
  readonly error?: never;
}

interface PendingTelemetryEnvelope<TPayload> extends TelemetryEnvelopeBase {
  readonly status: Extract<TelemetryStatus, 'connecting' | 'unavailable'>;
  readonly data?: TPayload;
  readonly error?: never;
}

interface ErrorTelemetryEnvelope<TPayload> extends TelemetryEnvelopeBase {
  readonly status: Extract<TelemetryStatus, 'error'>;
  readonly data?: TPayload;
  readonly error: TelemetryError;
}

/** Transport-neutral telemetry snapshot narrowed by its lifecycle status. */
export type TelemetryEnvelope<TPayload = unknown> =
  | LiveTelemetryEnvelope<TPayload>
  | RetainedTelemetryEnvelope<TPayload>
  | PendingTelemetryEnvelope<TPayload>
  | ErrorTelemetryEnvelope<TPayload>;
