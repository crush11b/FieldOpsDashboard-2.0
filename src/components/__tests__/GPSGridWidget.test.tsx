import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GPSGridWidget } from '../GPSGridWidget';
import type { GPSProvenance, GPSStatus } from '../../types';

describe('GPS source guardrail presentation', () => {
  it('shows a waiting state without assumed coordinates before a source is available', () => {
    const markup = render(provenance('connecting', 'gps_acquisition'), { lat: Number.NaN, lon: Number.NaN, gridSquare: '' });

    expect(markup).toContain('ACQUIRING GPS');
    expect(markup).toContain('Unavailable');
    expect(markup).not.toContain('37.5407');
    expect(markup).not.toContain('FM17hd');
  });

  it('keeps valid zero-valued cached coordinates visible as last-known data', () => {
    const markup = render(provenance('cached', 'cached_local_storage'), { lat: 0, lon: 0, gridSquare: 'JJ00aa' });

    expect(markup).toContain('CACHED LAST POSITION');
    expect(markup).toContain('0.0000°');
    expect(markup).toContain('JJ00aa');
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
