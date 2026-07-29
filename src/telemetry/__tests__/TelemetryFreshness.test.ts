import { describe, expect, it } from 'vitest';
import { getTelemetryFreshness } from '../TelemetryFreshness';

const observedAt = '2026-07-27T12:00:00.000Z';
const now = Date.parse('2026-07-27T12:00:10.000Z');

describe('getTelemetryFreshness', () => {
  it('computes relative age and fresh declared expiration', () => {
    const result = getTelemetryFreshness(
      { observedAt, expiresAt: '2026-07-27T12:00:20.000Z' },
      now,
    );

    expect(result.ageMs).toBe(10_000);
    expect(result.relativeAge).toBe('10s ago');
    expect(result.isFresh).toBe(true);
    expect(result.isExpired).toBe(false);
  });

  it('marks data expired only after expiresAt', () => {
    const atBoundary = getTelemetryFreshness({ observedAt, expiresAt: '2026-07-27T12:00:10.000Z' }, now);
    const expired = getTelemetryFreshness({ observedAt, expiresAt: '2026-07-27T12:00:09.999Z' }, now);

    expect(atBoundary.isFresh).toBe(true);
    expect(atBoundary.isExpired).toBe(false);
    expect(expired.isFresh).toBe(false);
    expect(expired.isExpired).toBe(true);
  });

  it('treats a valid observation without expiresAt as fresh', () => {
    const result = getTelemetryFreshness({ observedAt }, now);

    expect(result.isFresh).toBe(true);
    expect(result.isExpired).toBe(false);
  });

  it('reports invalid observedAt without inventing an age', () => {
    const result = getTelemetryFreshness({ observedAt: 'not-a-timestamp' }, now);

    expect(result.ageMs).toBeNull();
    expect(result.relativeAge).toBe('Time unavailable');
    expect(result.isFresh).toBe(false);
    expect(result.isExpired).toBe(false);
  });

  it('reports malformed expiresAt as unknown rather than expired', () => {
    const result = getTelemetryFreshness({ observedAt, expiresAt: 'not-a-timestamp' }, now);

    expect(result.ageMs).toBe(10_000);
    expect(result.isFresh).toBe(false);
    expect(result.isExpired).toBe(false);
  });

  it('clamps future observations to zero age', () => {
    const result = getTelemetryFreshness(
      { observedAt: '2026-07-27T12:00:20.000Z' },
      now,
    );

    expect(result.ageMs).toBe(0);
    expect(result.relativeAge).toBe('Just now');
  });
});
