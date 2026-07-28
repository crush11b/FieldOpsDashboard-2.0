import { describe, expect, expectTypeOf, it } from 'vitest';
import type { TelemetryEnvelope, TelemetryError } from '../index';

interface TestPayload {
  value: number;
}

const source = { id: 'test-source', type: 'test_adapter' } as const;
const timestamps = {
  observedAt: '2026-07-27T12:00:00.000Z',
  receivedAt: '2026-07-27T12:00:01.000Z',
} as const;

describe('TelemetryEnvelope', () => {
  it('narrows live envelopes to their required payload', () => {
    const envelope: TelemetryEnvelope<TestPayload> = {
      status: 'ok',
      source,
      timestamps,
      data: { value: 0 },
    };

    if (envelope.status === 'ok') {
      expectTypeOf(envelope.data).toEqualTypeOf<TestPayload>();
      expect(envelope.data.value).toBe(0);
    }
  });

  it('allows retained data for cached and stale envelopes', () => {
    const envelopes: TelemetryEnvelope<TestPayload>[] = [
      { status: 'cached', source, timestamps, data: { value: 1 } },
      { status: 'stale', source, timestamps, data: { value: 2 } },
    ];

    expect(envelopes.map((envelope) => envelope.data?.value)).toEqual([1, 2]);
  });

  it('allows unavailable envelopes without a plausible payload', () => {
    const envelope: TelemetryEnvelope<TestPayload> = {
      status: 'unavailable',
      source,
      timestamps,
    };

    expect(envelope.data).toBeUndefined();
  });

  it('requires structured errors and permits retained error data', () => {
    const error: TelemetryError = {
      code: 'TEST_FAILURE',
      message: 'Test adapter failed',
      retryable: true,
    };
    const envelope: TelemetryEnvelope<TestPayload> = {
      status: 'error',
      source,
      timestamps,
      data: { value: 3 },
      error,
    };

    if (envelope.status === 'error') {
      expectTypeOf(envelope.error).toEqualTypeOf<TelemetryError>();
      expect(envelope.error.message).toBe('Test adapter failed');
      expect(envelope.data?.value).toBe(3);
    }
  });

  it('rejects contradictory live/error shapes at compile time', () => {
    expectTypeOf<{
      status: 'ok';
      source: typeof source;
      timestamps: typeof timestamps;
      data: TestPayload;
      error: TelemetryError;
    }>().not.toMatchTypeOf<TelemetryEnvelope<TestPayload>>();
  });
});
