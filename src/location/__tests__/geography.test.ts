import { describe, expect, it } from 'vitest';
import { calculateDistanceKm, calculateInitialBearing, compassDirection } from '../geography';

const point = (lat: number, lon: number) => ({ lat, lon });

describe('geographic calculations', () => {
  it('returns zero distance and no bearing for the same point', () => {
    const location = point(37.4, -77.4);
    expect(calculateDistanceKm(location, location)).toBe(0);
    expect(calculateInitialBearing(location, location)).toBeNull();
    expect(compassDirection(null)).toBe('N/A');
  });

  it.each([
    [point(0, 0), point(1, 0), 0, 'N'],
    [point(0, 0), point(-1, 0), 180, 'S'],
    [point(0, 0), point(0, 1), 90, 'E'],
    [point(0, 0), point(0, -1), 270, 'W'],
    [point(0, 0), point(1, 1), 45, 'NE'],
    [point(0, 0), point(-1, -1), 225, 'SW'],
  ])('calculates %s direction', (origin, destination, expectedBearing, expectedDirection) => {
    expect(calculateInitialBearing(origin, destination)).toBeCloseTo(expectedBearing as number, 1);
    expect(compassDirection(expectedBearing as number)).toBe(expectedDirection);
  });

  it('handles antimeridian crossing and high latitude routes', () => {
    expect(calculateDistanceKm(point(0, 179), point(0, -179))).toBeCloseTo(222.39, 1);
    expect(calculateInitialBearing(point(80, 0), point(80, 90))).toBeCloseTo(45.44, 1);
  });

  it('preserves zero and negative coordinates', () => {
    expect(calculateDistanceKm(point(0, 0), point(-1, -1))).toBeGreaterThan(0);
  });
});