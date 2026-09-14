import { describe, expect, it } from 'vitest';
import {
  gridSquareToLatLon,
  isMaidenheadLocator,
  latLonToGridSquare,
  latLonToMaidenhead,
  maidenheadToLocation,
} from '../maidenhead';

describe('Maidenhead domain', () => {
  it('encodes coordinates at 4-, 6-, and 8-character precision', () => {
    expect(latLonToMaidenhead(37.4078745833333, -77.4590382833333, 4)).toBe('FM17');
    expect(latLonToMaidenhead(37.4078745833333, -77.4590382833333, 6)).toBe('FM17gj');
    expect(latLonToMaidenhead(37.4078745833333, -77.4590382833333, 8)).toBe('FM17gj47');
    expect(latLonToGridSquare(37.4078745833333, -77.4590382833333)).toBe('FM17gj');
  });

  it('keeps exact geographic upper bounds in the final valid cells', () => {
    expect(latLonToMaidenhead(-90, -180, 8)).toBe('AA00aa00');
    expect(latLonToMaidenhead(90, 180, 8)).toBe('RR99xx99');
  });

  it('rejects invalid coordinates and unsupported precision', () => {
    expect(latLonToMaidenhead(91, 0, 6)).toBe('');
    expect(latLonToMaidenhead(0, 181, 6)).toBe('');
    expect(latLonToMaidenhead(Number.NaN, 0, 6)).toBe('');
    expect(latLonToMaidenhead(0, 0, 5 as 6)).toBe('');
  });

  it('decodes a locator to its canonical form, bounds, and geometric center', () => {
    expect(maidenheadToLocation('fm17')).toEqual({
      locator: 'FM17',
      precision: 4,
      center: { lat: 37.5, lon: -77 },
      bounds: { south: 37, west: -78, north: 38, east: -76 },
      latitudeSpanDegrees: 1,
      longitudeSpanDegrees: 2,
    });

    const sixCharacter = maidenheadToLocation('FM17GJ');
    expect(sixCharacter?.locator).toBe('FM17gj');
    expect(sixCharacter?.center.lat).toBeCloseTo(37.3958333333, 9);
    expect(sixCharacter?.center.lon).toBeCloseTo(-77.4583333333, 9);
    expect(sixCharacter?.latitudeSpanDegrees).toBeCloseTo(1 / 24, 12);
    expect(sixCharacter?.longitudeSpanDegrees).toBeCloseTo(1 / 12, 12);
  });

  it('round-trips the representative center at every supported precision', () => {
    for (const precision of [4, 6, 8] as const) {
      const locator = latLonToMaidenhead(-33.8688, 151.2093, precision);
      const decoded = maidenheadToLocation(locator);
      expect(decoded).not.toBeNull();
      expect(latLonToMaidenhead(decoded!.center.lat, decoded!.center.lon, precision)).toBe(locator);
    }
  });

  it.each(['FM1', 'FM170', 'SM17aa', 'FM17yy', 'FM17aa0x', 'FM17aa000', ''])('strictly rejects malformed locator %j', (locator) => {
    expect(maidenheadToLocation(locator)).toBeNull();
    expect(isMaidenheadLocator(locator)).toBe(false);
  });

  it('supports explicit accepted precisions and compatibility center decoding', () => {
    expect(isMaidenheadLocator('FM17', [4])).toBe(true);
    expect(isMaidenheadLocator('FM17gj', [4])).toBe(false);
    expect(gridSquareToLatLon('FM17')).toEqual({ lat: 37.5, lon: -77 });
  });
});
