import { describe, expect, it } from 'vitest';
import type { GPSProvenance, GPSStatus } from '../../types';
import { resolveOperatingLocation } from '../operatingLocation';

const gps: GPSStatus = {
  lat: 37.4078745833333,
  lon: -77.4590382833333,
  altitudeM: 73.1,
  speedKmh: 0,
  gridSquare: 'FM17ma',
  satCount: 3,
  fixType: 'Fix quality 1',
  lockTime: '2026-08-09T02:28:34Z',
  mode: 'auto',
  deviceName: 'GPS Receiver',
};

function provenance(status: GPSProvenance['status'], type: string, timestamps?: GPSProvenance['timestamps']): GPSProvenance {
  return { status, source: { id: `gps:${type}`, type, name: type }, timestamps };
}

describe('operating location contract', () => {
  it('projects valid native coordinates, source, status, freshness, and Maidenhead', () => {
    const location = resolveOperatingLocation(gps, provenance('ok', 'serial_nmea', {
      observedAt: '2026-08-09T02:28:34Z',
      receivedAt: '2026-08-09T02:28:35Z',
    }));

    expect(location.coordinates).toEqual({ lat: gps.lat, lon: gps.lon });
    expect(location.gridSquare).toBe('FM17gj');
    expect(location.provenance).toBe('current');
    expect(location.status).toBe('ok');
    expect(location.source.type).toBe('serial_nmea');
    expect(location.timestamps?.observedAt).toBe('2026-08-09T02:28:34Z');
  });

  it('keeps manual coordinates explicitly manual', () => {
    const location = resolveOperatingLocation(gps, provenance('degraded', 'manual_location'));

    expect(location.coordinates).toEqual({ lat: gps.lat, lon: gps.lon });
    expect(location.provenance).toBe('manual');
    expect(location.status).toBe('degraded');
  });

  it('retains stale coordinates without classifying them as current', () => {
    const location = resolveOperatingLocation(gps, provenance('stale', 'serial_nmea', {
      observedAt: '2026-08-09T02:28:34Z',
      receivedAt: '2026-08-09T02:29:35Z',
    }));

    expect(location.coordinates).toEqual({ lat: gps.lat, lon: gps.lon });
    expect(location.gridSquare).toBe('FM17gj');
    expect(location.provenance).toBe('stale');
    expect(location.status).toBe('stale');
  });

  it.each([
    provenance('connecting', 'gps_acquisition'),
    provenance('unavailable', 'serial_nmea'),
    provenance('error', 'serial_nmea'),
  ])('does not expose coordinates for %s status', (source) => {
    const location = resolveOperatingLocation(gps, source);

    expect(location.coordinates).toBeNull();
    expect(location.gridSquare).toBeNull();
    expect(location.provenance).toBe('unavailable');
  });

  it('rejects invalid coordinates without producing a grid', () => {
    const location = resolveOperatingLocation({ ...gps, lat: Number.NaN, lon: -77 }, provenance('ok', 'serial_nmea'));

    expect(location.coordinates).toBeNull();
    expect(location.gridSquare).toBeNull();
  });

  it('preserves legitimate zero coordinates', () => {
    const location = resolveOperatingLocation({ ...gps, lat: 0, lon: 0 }, provenance('ok', 'serial_nmea'));

    expect(location.coordinates).toEqual({ lat: 0, lon: 0 });
    expect(location.gridSquare).toBe('JJ00aa');
  });
});
