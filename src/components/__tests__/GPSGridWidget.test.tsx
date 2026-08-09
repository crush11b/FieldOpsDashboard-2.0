import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GPSGridWidget } from '../GPSGridWidget';
import type { GPSProvenance, GPSStatus } from '../../types';

describe('GPS source guardrail presentation', () => {
  it('treats the real native SerialNmea observation as current GPS', () => {
    const markup = render(provenance('ok', 'serial_nmea'), {
      lat: 37.4078745833333,
      lon: -77.4590382833333,
      altitudeM: 73.1,
      satCount: 3,
      fixType: 'Fix quality 1',
      lockTime: '2026-08-09T02:28:34Z',
      gridSquare: 'FM17ma',
    });
    expect(markup).toContain('SATELLITE AUTO-FIX');
    expect(markup).toContain('37.4079');
    expect(markup).toContain('73.1 meters');
    expect(markup).toContain('3 SATS');
    expect(markup).toContain('FM17ma');
  });
  it('shows a waiting state without assumed coordinates before a source is available', () => {
    const markup = render(provenance('connecting', 'gps_acquisition'), { lat: Number.NaN, lon: Number.NaN, gridSquare: '' });

    expect(markup).toContain('ACQUIRING GPS');
    expect(markup).toContain('Unavailable');
    expect(markup).not.toContain('37.5407');
    expect(markup).not.toContain('FM17hd');
    expect(markup).toMatch(/id="btn-trigger-gps-refresh"[^>]*disabled/);
    expect(markup).toContain('aria-label="Request native GPS fix"');
  });

  it('keeps valid zero-valued cached coordinates visible as last-known data', () => {
    const markup = render(provenance('cached', 'cached_local_storage'), { lat: 0, lon: 0, gridSquare: 'JJ00aa' });

    expect(markup).toContain('CACHED LAST POSITION');
    expect(markup).toContain('0.0000°');
    expect(markup).toContain('JJ00aa');
    expect(markup).toContain('0 SATS (No Fix)');
    expect(markup).toContain('0 meters (0 ft)');
  });

  it('identifies manually supplied coordinates without presenting a satellite auto-fix', () => {
    const markup = render(provenance('degraded', 'manual_location'));

    expect(markup).toContain('MANUAL OVERRIDE');
    expect(markup).not.toContain('SATELLITE AUTO-FIX');
  });
});

function render(provenanceValue: GPSProvenance, overrides: Partial<GPSStatus> = {}) {
  const gps: GPSStatus = {
    lat: 38,
    lon: -79,
    altitudeM: 0,
    speedKmh: 0,
    gridSquare: 'FM08ma',
    satCount: 0,
    fixType: 'No Fix',
    lockTime: '',
    mode: 'auto',
    deviceName: 'GPS Receiver',
    ...overrides,
  };
  return renderToStaticMarkup(
    <GPSGridWidget
      gps={gps}
      provenance={provenanceValue}
      theme="dark_tactical"
      audioEnabled={false}
      onUpdateGPS={() => undefined}
    />,
  );
}

function provenance(status: GPSProvenance['status'], type: string): GPSProvenance {
  return { status, source: { id: `gps:${type}`, type } };
}
