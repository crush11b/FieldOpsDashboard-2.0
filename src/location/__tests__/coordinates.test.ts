import { describe, expect, it } from 'vitest';
import {
  classifyCoordinateProvenance,
  isCurrentOperatingLocation,
  parseCoordinates,
  parseGpsRequestCoordinates,
  resolveGpsCoordinates,
} from '../coordinates';
import type { GPSProvenance } from '../../types';
import { latLonToGridSquare } from '../../types';

describe('coordinate guardrails', () => {
  it.each([
    [0, 0],
    [-90, -180],
    [90, 180],
    [-33.9, 151.2],
    ['0', '-77.4'],
  ])('accepts valid coordinates %s, %s', (lat, lon) => {
    expect(parseCoordinates(lat, lon)).toEqual({ lat: Number(lat), lon: Number(lon) });
  });

  it.each([
    [undefined, 0], [0, undefined], ['', 0], [0, ' '],
    [NaN, 0], [0, Infinity], ['37abc', -77], [91, 0], [-91, 0], [0, 181], [0, -181],
  ])('rejects invalid coordinates %s, %s', (lat, lon) => {
    expect(parseCoordinates(lat, lon)).toBeNull();
  });

  it.each([
    ['ok', 'browser_geolocation', 'current'],
    ['ok', 'local_telemetry_agent', 'current'],
    ['degraded', 'manual_location', 'manual'],
    ['degraded', 'preset_location', 'manual'],
    ['degraded', 'configured_station_location', 'manual'],
    ['cached', 'cached_local_storage', 'stale'],
    ['stale', 'browser_geolocation', 'stale'],
    ['stale', 'unknown_legacy_producer', 'unavailable'],
    ['cached', 'unknown_legacy_producer', 'unavailable'],
    ['degraded', 'simulated_default', 'unavailable'],
    ['degraded', 'unknown_legacy_producer', 'unavailable'],
    ['ok', 'unknown_legacy_producer', 'unavailable'],
    ['unavailable', 'system_gps', 'unavailable'],
  ] as const)('classifies %s/%s as %s', (status, type, expected) => {
    expect(classifyCoordinateProvenance(provenance(status, type))).toBe(expected);
  });

  it('retains stale coordinates for display but not as a current operating location', () => {
    const resolved = resolveGpsCoordinates({ lat: 0, lon: 0 }, provenance('stale', 'browser_geolocation'));
    expect(resolved).toEqual({ lat: 0, lon: 0, provenance: 'stale' });
    expect(isCurrentOperatingLocation(resolved)).toBe(false);
  });

  it('allows only current device and explicit manual coordinates to drive local services', () => {
    const current = resolveGpsCoordinates({ lat: 38, lon: -79 }, provenance('ok', 'browser_geolocation'));
    const manual = resolveGpsCoordinates({ lat: 38, lon: -79 }, provenance('degraded', 'manual_location'));
    const assumed = resolveGpsCoordinates({ lat: 37.5407, lon: -77.436 }, provenance('degraded', 'simulated_default'));

    expect(isCurrentOperatingLocation(current)).toBe(true);
    expect(isCurrentOperatingLocation(manual)).toBe(true);
    expect(isCurrentOperatingLocation(assumed)).toBe(false);
  });

  it('fails closed for contradictory live provenance with invalid coordinates', () => {
    expect(resolveGpsCoordinates({ lat: 100, lon: 0 }, provenance('ok', 'browser_geolocation'))).toBeNull();
  });

  it('accepts legacy coordinate aliases without supplying an assumed fallback', () => {
    expect(parseGpsRequestCoordinates({ latitude: '0', longitude: '-180' }, {})).toEqual({ lat: 0, lon: -180 });
    expect(parseGpsRequestCoordinates({}, { lat: '90', lng: '180' })).toEqual({ lat: 90, lon: 180 });
    expect(parseGpsRequestCoordinates({}, {})).toBeNull();
  });

  it('converts inclusive coordinate boundaries without generating an invalid Maidenhead field', () => {
    expect(latLonToGridSquare(-90, -180)).toMatch(/^[A-R]{2}[0-9]{2}[a-x]{2}$/);
    expect(latLonToGridSquare(90, 180)).toMatch(/^[A-R]{2}[0-9]{2}[a-x]{2}$/);
    expect(latLonToGridSquare(91, 0)).toBe('');
  });
});

function provenance(status: GPSProvenance['status'], type: string): GPSProvenance {
  return { status, source: { id: `gps:${type}`, type } };
}
