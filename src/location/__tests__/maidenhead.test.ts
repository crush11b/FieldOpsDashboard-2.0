import { describe, expect, it } from 'vitest';
import { coordinatesToMaidenhead, maidenheadToCell, normalizeMaidenhead } from '../maidenhead';

describe('Maidenhead conversions', () => {
  it('calculates 4, 6, and 8 character locators from a known reference', () => {
    expect(coordinatesToMaidenhead(37.40787458, -77.45903828, 4)).toBe('FM17');
    expect(coordinatesToMaidenhead(37.40787458, -77.45903828, 6)).toBe('FM17gj');
    expect(coordinatesToMaidenhead(37.40787458, -77.45903828, 8)).toBe('FM17gj47');
  });

  it('handles both hemispheres, the origin, and inclusive geographic boundaries', () => {
    expect(coordinatesToMaidenhead(0, 0, 6)).toBe('JJ00aa');
    expect(coordinatesToMaidenhead(-33.8688, 151.2093, 6)).toMatch(/^[A-R]{2}[0-9]{2}[a-x]{2}$/);
    expect(coordinatesToMaidenhead(-90, -180, 8)).toBe('AA00aa00');
    expect(coordinatesToMaidenhead(90, 180, 8)).toBe('RR99xx99');
  });

  it('normalizes valid locators and rejects malformed or unsupported precision', () => {
    expect(normalizeMaidenhead(' fm17GJ44 ')).toBe('FM17gj44');
    expect(normalizeMaidenhead('FM17g')).toBeNull();
    expect(normalizeMaidenhead('SM17gj')).toBeNull();
    expect(normalizeMaidenhead('FM1Xgj')).toBeNull();
    expect(coordinatesToMaidenhead(91, 0, 6)).toBeNull();
    expect(coordinatesToMaidenhead(0, 181, 6)).toBeNull();
  });

  it('returns the representative center and precision for each supported length', () => {
    expect(maidenheadToCell('JJ00')).toMatchObject({
      locator: 'JJ00',
      center: { lat: 0.5, lon: 1 },
      latitudeSpanDegrees: 1,
      longitudeSpanDegrees: 2,
    });
    expect(maidenheadToCell('JJ00aa')).toMatchObject({
      locator: 'JJ00aa',
      center: { lat: 1 / 48, lon: 1 / 24 },
      latitudeSpanDegrees: 1 / 24,
      longitudeSpanDegrees: 1 / 12,
    });
    expect(maidenheadToCell('JJ00aa00')).toMatchObject({
      locator: 'JJ00aa00',
      center: { lat: 1 / 480, lon: 1 / 240 },
      latitudeSpanDegrees: 1 / 240,
      longitudeSpanDegrees: 1 / 120,
    });
  });
});
