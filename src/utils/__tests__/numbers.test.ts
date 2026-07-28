import { describe, expect, it } from 'vitest';
import { toFiniteNumber } from '../numbers';

describe('finite numeric normalization', () => {
  it('preserves zero and negative finite values', () => {
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber('0')).toBe(0);
    expect(toFiniteNumber(-12.5)).toBe(-12.5);
  });

  it('does not collapse absent or invalid values into zero', () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('   ')).toBeNull();
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber('not-a-number')).toBeNull();
  });

  it('does not reinterpret boolean false as numeric zero', () => {
    expect(toFiniteNumber(false)).toBeNull();
  });
});
