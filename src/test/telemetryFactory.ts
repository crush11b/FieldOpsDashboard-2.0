import type {
  TelemetryEnvelope,
  TelemetryError,
  TelemetrySource,
  TelemetryStatus,
  TelemetryTimestamps,
} from '../telemetry';

export const TEST_NOW = new Date('2026-07-28T12:00:00.000Z');

export function createTelemetrySource(
  overrides: Partial<TelemetrySource> = {},
): TelemetrySource {
  return {
    id: 'test:source',
    type: 'test_adapter',
    name: 'Test Adapter',
    ...overrides,
  };
}

export function createTelemetryTimestamps(
  overrides: Partial<TelemetryTimestamps> = {},
): TelemetryTimestamps {
  return {
    observedAt: new Date(TEST_NOW.getTime() - 10_000).toISOString(),
    receivedAt: new Date(TEST_NOW.getTime() - 9_000).toISOString(),
    expiresAt: new Date(TEST_NOW.getTime() + 20_000).toISOString(),
    ...overrides,
  };
}

interface EnvelopeOptions {
  readonly source?: TelemetrySource;
  readonly timestamps?: TelemetryTimestamps;
}

export function createLiveEnvelope<TPayload>(
  data: TPayload,
  options: EnvelopeOptions & { status?: Extract<TelemetryStatus, 'ok' | 'degraded'> } = {},
): TelemetryEnvelope<TPayload> {
  return {
    status: options.status ?? 'ok',
    source: options.source ?? createTelemetrySource(),
    timestamps: options.timestamps ?? createTelemetryTimestamps(),
    data,
  };
}

export function createRetainedEnvelope<TPayload>(
  status: Extract<TelemetryStatus, 'cached' | 'stale'>,
  data?: TPayload,
  options: EnvelopeOptions = {},
): TelemetryEnvelope<TPayload> {
  return {
    status,
    source: options.source ?? createTelemetrySource(),
    timestamps: options.timestamps ?? createTelemetryTimestamps(),
    ...(data === undefined ? {} : { data }),
  };
}

export function createUnavailableEnvelope<TPayload = unknown>(
  options: EnvelopeOptions = {},
): TelemetryEnvelope<TPayload> {
  return {
    status: 'unavailable',
    source: options.source ?? createTelemetrySource(),
    timestamps: options.timestamps ?? createTelemetryTimestamps(),
  };
}

export function createErrorEnvelope<TPayload = unknown>(
  error: TelemetryError,
  data?: TPayload,
  options: EnvelopeOptions = {},
): TelemetryEnvelope<TPayload> {
  return {
    status: 'error',
    source: options.source ?? createTelemetrySource(),
    timestamps: options.timestamps ?? createTelemetryTimestamps(),
    error,
    ...(data === undefined ? {} : { data }),
  };
}
