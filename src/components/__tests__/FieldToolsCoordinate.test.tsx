import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RoadmapToolsModal } from '../RoadmapToolsModal';
import type { GPSProvenance, GPSStatus } from '../../types';

const gps: GPSStatus = {
  lat: 37.4078745833333,
  lon: -77.4590382833333,
  altitudeM: 0,
  speedKmh: 0,
  gridSquare: 'FM17ma',
  satCount: 3,
  fixType: 'Fix quality 1',
  lockTime: '2026-08-09T02:28:34Z',
  mode: 'auto',
  deviceName: 'GPS Receiver',
};

function renderLocation(gpsValue: GPSStatus, provenance: GPSProvenance) {
  return renderToStaticMarkup(
    <RoadmapToolsModal
      theme="dark_tactical"
      audioEnabled={false}
      isOpen
      onClose={vi.fn()}
      callsign="N0CALL"
      gridSquare={gpsValue.gridSquare}
      gps={gpsValue}
      gpsProvenance={provenance}
    />,
  );
}

describe('Field Tools coordinate workspace', () => {
  it('shows native coordinates, source, freshness, and Maidenhead', () => {
    const markup = renderLocation(gps, {
      status: 'ok',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
      timestamps: {
        observedAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      },
    });

    expect(markup).toContain('OPERATING LOCATION');
    expect(markup).toContain('37.407875');
    expect(markup).toContain('-77.459038');
    expect(markup).toContain('FM17gj');
    expect(markup).toContain('Internal GNSS / NMEA');
    expect(markup).toContain('CURRENT GNSS LOCATION');
  });

  it('labels manual coordinates and does not imply a GNSS fix', () => {
    const markup = renderLocation(gps, {
      status: 'degraded',
      source: { id: 'gps:manual', type: 'manual_location', name: 'Manual Location' },
    });

    expect(markup).toContain('MANUAL LOCATION');
    expect(markup).toContain('Operator-provided coordinates; not a satellite fix.');
    expect(markup).not.toContain('CURRENT GNSS LOCATION');
  });

  it('shows stale coordinates as retained rather than current', () => {
    const markup = renderLocation(gps, {
      status: 'stale',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
      timestamps: {
        observedAt: '2026-08-09T02:28:34Z',
        receivedAt: '2026-08-09T02:29:35Z',
      },
    });

    expect(markup).toContain('STALE LAST FIX');
    expect(markup).toContain('Last known coordinates retained; do not treat as current.');
    expect(markup).not.toContain('CURRENT GNSS LOCATION');
  });

  it('does not display coordinates or a grid for unavailable location', () => {
    const markup = renderLocation({ ...gps, lat: Number.NaN, lon: Number.NaN, gridSquare: '' }, {
      status: 'connecting',
      source: { id: 'gps:startup', type: 'gps_acquisition', name: 'Waiting for GPS Location' },
    });

    expect(markup).toContain('ACQUIRING LOCATION');
    expect(markup).toContain('NO VALID COORDINATES');
    expect(markup).not.toContain('FM17gj');
    expect(markup).not.toContain('37.407875');
  });

  it('keeps zero coordinates and their Maidenhead grid visible', () => {
    const markup = renderLocation({ ...gps, lat: 0, lon: 0, gridSquare: 'JJ00aa' }, {
      status: 'ok',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
    });

    expect(markup).toContain('0.000000');
    expect(markup).toContain('JJ00aa');
  });
});
