/* @vitest-environment jsdom */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

function renderDistance(gpsValue: GPSStatus, provenance: GPSProvenance) {
  return render(
    <RoadmapToolsModal
      theme="dark_tactical"
      audioEnabled={false}
      isOpen
      onClose={vi.fn()}
      callsign="N0CALL"
      gridSquare={gpsValue.gridSquare}
      gps={gpsValue}
      gpsProvenance={provenance}
      initialTab="distance_bearing"
    />,
  );
}

function renderSun(gpsValue: GPSStatus, provenance: GPSProvenance) {
  return render(
    <RoadmapToolsModal
      theme="dark_tactical"
      audioEnabled={false}
      isOpen
      onClose={vi.fn()}
      callsign="N0CALL"
      gridSquare={gpsValue.gridSquare}
      gps={gpsValue}
      gpsProvenance={provenance}
      initialTab="sun_twilight"
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

  it('calculates distance and bearing from the operating location', () => {
    renderDistance({ ...gps, lat: 0, lon: 0 }, {
      status: 'ok',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
    });

    fireEvent.change(screen.getByLabelText('Destination latitude'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Destination longitude'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE DISTANCE / BEARING' }));

    expect(screen.getByText('DISTANCE')).toBeInTheDocument();
    expect(screen.getByText('0.0°')).toBeInTheDocument();
    expect(screen.getByText('N', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows a non-meaningful bearing for the same point', () => {
    renderDistance({ ...gps, lat: 0, lon: 0 }, {
      status: 'ok',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
    });

    fireEvent.change(screen.getByLabelText('Destination latitude'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Destination longitude'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE DISTANCE / BEARING' }));

    expect(screen.getByText('0.00 mi')).toBeInTheDocument();
    expect(screen.getAllByText('N/A')).toHaveLength(2);
  });

  it('rejects malformed and out-of-range destinations without a result', () => {
    renderDistance(gps, {
      status: 'ok',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
    });

    fireEvent.change(screen.getByLabelText('Destination latitude'), { target: { value: '91' } });
    fireEvent.change(screen.getByLabelText('Destination longitude'), { target: { value: 'not-a-number' } });
    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE DISTANCE / BEARING' }));

    expect(screen.getByText('ENTER A VALID DESTINATION LATITUDE AND LONGITUDE.')).toBeInTheDocument();
    expect(screen.queryByText('DISTANCE', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('rejects invalid destinations and unavailable origins', () => {
    renderDistance({ ...gps, lat: Number.NaN, lon: Number.NaN }, {
      status: 'connecting',
      source: { id: 'gps:startup', type: 'gps_acquisition', name: 'Waiting for GPS Location' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'CALCULATE DISTANCE / BEARING' }));
    expect(screen.getByText('DISTANCE UNAVAILABLE: OPERATING LOCATION HAS NO VALID FIX.')).toBeInTheDocument();
    expect(screen.queryByText('DISTANCE', { selector: 'span' })).not.toBeInTheDocument();
  });

  it.each([
    ['MANUAL OPERATING LOCATION', 'degraded', 'manual_location'],
    ['STALE OPERATING LOCATION', 'stale', 'serial_nmea'],
  ])('labels %s origin honestly', (label, status, type) => {
    renderDistance(gps, {
      status: status as GPSProvenance['status'],
      source: { id: `gps:${type}`, type, name: type },
    });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders ordered solar events and explicit system timezone', () => {
    renderSun(gps, {
      status: 'ok',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
    });

    for (const label of ['ASTRONOMICAL DAWN', 'NAUTICAL DAWN', 'CIVIL DAWN', 'SUNRISE', 'SUNSET', 'CIVIL DUSK', 'NAUTICAL DUSK', 'ASTRONOMICAL DUSK']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/DISPLAY TIMEZONE:/)).toBeInTheDocument();
    expect(screen.getByText('CURRENT OPERATING LOCATION')).toBeInTheDocument();
  });

  it('updates solar results when the selected date changes', () => {
    renderSun({ ...gps, lat: 40.7128, lon: -74.006 }, {
      status: 'ok',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
    });

    const dateInput = screen.getByLabelText('Selected date');
    fireEvent.change(dateInput, { target: { value: '2024-06-21' } });
    expect(dateInput).toHaveValue('2024-06-21');
    const summerSunrise = screen.getByText('SUNRISE').parentElement?.textContent;
    fireEvent.change(dateInput, { target: { value: '2024-12-21' } });
    expect(dateInput).toHaveValue('2024-12-21');
    expect(screen.getByText('SUNRISE').parentElement?.textContent).not.toBe(summerSunrise);
  });

  it.each([
    ['MANUAL OPERATING LOCATION', 'degraded', 'manual_location'],
    ['STALE OPERATING LOCATION', 'stale', 'serial_nmea'],
  ])('preserves %s solar origin labeling', (label, status, type) => {
    renderSun(gps, {
      status: status as GPSProvenance['status'],
      source: { id: `gps:${type}`, type, name: type },
    });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('does not calculate without an operating location', () => {
    renderSun({ ...gps, lat: Number.NaN, lon: Number.NaN }, {
      status: 'connecting',
      source: { id: 'gps:startup', type: 'gps_acquisition', name: 'Waiting for GPS Location' },
    });

    expect(screen.getByText('SOLAR EVENTS UNAVAILABLE: NO VALID OPERATING LOCATION')).toBeInTheDocument();
  });

  it('shows honest no-event values for polar conditions', () => {
    renderSun({ ...gps, lat: 89, lon: 0 }, {
      status: 'ok',
      source: { id: 'gps:serial-nmea', type: 'serial_nmea', name: 'Internal GNSS / NMEA' },
    });

    fireEvent.change(screen.getByLabelText('Selected date'), { target: { value: '2024-06-21' } });
    expect(screen.getAllByText('DOES NOT OCCUR').length).toBeGreaterThan(0);
  });
});
