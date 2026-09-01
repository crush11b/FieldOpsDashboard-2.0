/* @vitest-environment jsdom */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render as renderDom, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GPSGridWidget } from '../GPSGridWidget';
import type { GPSProvenance, GPSStatus } from '../../types';
import type { ClockSynchronizationEvidence, GnssRecoveryResult, GnssSerialDiagnostics } from '../../../server/locationTelemetryPipe';
import { recoverGnss } from '../../gnssRecoveryApi';

vi.mock('../../gnssRecoveryApi', () => ({ recoverGnss: vi.fn() }));

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

  it('distinguishes GNSS UTC from synchronized Windows clock evidence', () => {
    const markup = render(provenance('ok', 'serial_nmea'), { lockTime: 'legacy GNSS value', gridSquare: 'FM17ma' }, synchronizedClock());
    expect(markup).toContain('GNSS UTC TIME');
    expect(markup).not.toContain('UTC TIME SYNC');
    expect(markup).toContain('GPS SYNCHRONIZED');
    expect(markup).toContain('LAST GPS SYNC: 2026-08-25 23:12:54 UTC');
    expect(markup).toContain('CALCULATED OFFSET: -0.659 s');
    expect(markup).toContain('SYNCHRONIZE WINDOWS CLOCK');
  });

  it('shows honest unsynchronized and unavailable clock states', () => {
    expect(render(provenance('ok', 'serial_nmea'), {}, { ...synchronizedClock(), status: 'Unknown', lastSuccessfulSynchronizationUtc: null, offsetBeforeSynchronizationSeconds: null })).toContain('NOT GPS-SYNCHRONIZED');
    expect(render(provenance('connecting', 'gps_acquisition'), { lat: Number.NaN, lon: Number.NaN, gridSquare: '' }, { ...synchronizedClock(), status: 'Unknown', gnssTime: { status: 'Unavailable', timestampUtc: null, sentenceType: 'RMC' } })).toContain('GNSS TIME UNAVAILABLE');
  });

  it('requires confirmation before invoking the existing synchronization workflow', async () => {
    const onSynchronizeClock = vi.fn().mockResolvedValue(undefined);
    renderDom(<GPSGridWidget gps={baseGps()} provenance={provenance('ok', 'serial_nmea')} theme="dark_tactical" audioEnabled={false} onUpdateGPS={() => undefined} clockEvidence={synchronizedClock()} onSynchronizeClock={onSynchronizeClock} />);
    const button = screen.getByRole('button', { name: 'SYNCHRONIZE WINDOWS CLOCK' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'CONFIRM WINDOWS CLOCK SYNC' }));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(onSynchronizeClock).toHaveBeenCalledOnce());
    await waitFor(() => expect(button).toBeDisabled());
  });

  it('shows compact serial diagnostics without presenting receiving as a fix', () => {
    const markup = render(provenance('unavailable', 'serial_nmea'), { lat: Number.NaN, lon: Number.NaN, gridSquare: '' }, undefined, diagnostics('Receiving'));
    expect(markup).toContain('GNSS Diagnostics');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('RECEIVING');
    expect(markup).not.toContain('animate-spin-slow');
    expect(markup).not.toContain('animate-pulse');
  });

  it('shows honest missing timestamps and failure state when expanded', () => {
    renderDom(<GPSGridWidget gps={baseGps({ lat: Number.NaN, lon: Number.NaN, gridSquare: '' })} provenance={provenance('unavailable', 'serial_nmea')} theme="dark_tactical" audioEnabled={false} onUpdateGPS={() => undefined} gnssDiagnostics={diagnostics('OpenFailed')} />);
    fireEvent.click(screen.getByRole('button', { name: 'GNSS Diagnostics' }));
    expect(screen.getByTestId('gnss-diagnostics')).toHaveTextContent('OpenFailed');
    expect(screen.getByTestId('gnss-diagnostics')).toHaveTextContent('—');
  });

  it('keeps SerialSilence as last-failure evidence after a healthy Receiving fix', () => {
    renderDom(<GPSGridWidget gps={baseGps({ lat: 38.1234, lon: -77.4567, gridSquare: 'FM18aa' })} provenance={provenance('ok', 'serial_nmea')} theme="dark_tactical" audioEnabled={false} onUpdateGPS={() => undefined} gnssDiagnostics={{ ...diagnostics('Receiving'), lastSerialDataUtc: '2026-08-29T20:01:00.000Z', lastValidNmeaUtc: '2026-08-29T20:01:00.000Z', lastFixUtc: '2026-08-29T20:01:00.000Z', lastFailureCategory: 'SerialSilence', lastFailureMessage: 'No NMEA serial data received for 10 seconds.' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'GNSS Diagnostics' }));
    expect(screen.getByTestId('gnss-diagnostics')).toHaveTextContent('LAST FAILURE SerialSilence: No NMEA serial data received for 10 seconds.');
    expect(screen.getByTestId('gnss-diagnostics')).not.toHaveTextContent(/^FAILURE SerialSilence/m);
  });

  it('presents restored fix after NMEA recovery when current GNSS evidence is healthy', async () => {
    vi.mocked(recoverGnss).mockResolvedValue({ state: 'NmeaRecovered', failureCategory: 'None', failureMessage: null, supported: true, available: true, providerType: 'SierraEm7455B', controlPort: 'COM7', controlBaud: 115200, configurationEnabled: true, operationStartedUtc: null, operationCompletedUtc: null, commandAccepted: true, serialActivityRecovered: true, nmeaActivityRecovered: true, fixStatus: 'NoFix', attemptCount: 1, lastSerialBeforeUtc: null, lastSerialAfterUtc: null, lastNmeaAfterUtc: null });
    renderDom(<GPSGridWidget gps={baseGps({ lat: 38.1234, lon: -77.4567, gridSquare: 'FM18aa' })} provenance={provenance('ok', 'serial_nmea')} theme="dark_tactical" audioEnabled={false} onUpdateGPS={() => undefined} gnssDiagnostics={{ ...diagnostics('Receiving'), lastSerialDataUtc: '2026-08-29T20:01:00.000Z', lastValidNmeaUtc: '2026-08-29T20:01:00.000Z', lastFixUtc: '2026-08-29T20:01:00.000Z', lastFailureCategory: 'SerialSilence' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'GNSS Diagnostics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recover GPS' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('GNSS fix restored.'));
    expect(screen.getByRole('status')).not.toHaveTextContent('acquiring GPS fix');
  });

  it('keeps acquiring-fix wording after NMEA recovery when current GNSS evidence has no fix', async () => {
    vi.mocked(recoverGnss).mockResolvedValue({ state: 'NmeaRecovered', failureCategory: 'None', failureMessage: null, supported: true, available: true, providerType: 'SierraEm7455B', controlPort: 'COM7', controlBaud: 115200, configurationEnabled: true, operationStartedUtc: null, operationCompletedUtc: null, commandAccepted: true, serialActivityRecovered: true, nmeaActivityRecovered: true, fixStatus: 'NoFix', attemptCount: 1, lastSerialBeforeUtc: null, lastSerialAfterUtc: null, lastNmeaAfterUtc: null });
    renderDom(<GPSGridWidget gps={baseGps({ lat: Number.NaN, lon: Number.NaN, gridSquare: '' })} provenance={provenance('connecting', 'gps_acquisition')} theme="dark_tactical" audioEnabled={false} onUpdateGPS={() => undefined} gnssDiagnostics={{ ...diagnostics('Receiving'), lastFailureCategory: 'SerialSilence' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'GNSS Diagnostics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recover GPS' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('NMEA data recovered; acquiring GPS fix.'));
  });

  it('acknowledges recovery immediately and surfaces the returned result', async () => {
    let resolveRecovery!: (result: GnssRecoveryResult) => void;
    vi.mocked(recoverGnss).mockReturnValue(new Promise(resolve => { resolveRecovery = resolve; }));
    renderDom(
      <GPSGridWidget
        gps={baseGps({ lat: Number.NaN, lon: Number.NaN, gridSquare: '' })}
        provenance={provenance('unavailable', 'serial_nmea')}
        theme="dark_tactical"
        audioEnabled={false}
        onUpdateGPS={() => undefined}
        gnssDiagnostics={{ ...diagnostics('Receiving'), lastFailureCategory: 'SerialSilence', lastFailureMessage: 'No NMEA serial data received for 10 seconds.' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'GNSS Diagnostics' }));
    const recoverButton = screen.getByRole('button', { name: 'Recover GPS' });
    fireEvent.click(recoverButton);
    expect(screen.getByRole('status')).toHaveTextContent('Recovery requested; recovering GPS...');
    expect(recoverButton).toBeDisabled();

    resolveRecovery({
      state: 'PortUnavailable',
      failureCategory: 'AccessDenied',
      failureMessage: 'COM7 is in use.',
      supported: true,
      available: false,
      providerType: 'SierraEm7455B',
      controlPort: 'COM7',
      operationStartedUtc: null,
      operationCompletedUtc: null,
      commandAccepted: false,
      serialActivityRecovered: false,
      nmeaActivityRecovered: false,
      fixStatus: 'Error',
      attemptCount: 1,
      lastSerialBeforeUtc: null,
      lastSerialAfterUtc: null,
      lastNmeaAfterUtc: null,
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('GPS recovery could not open the control port.'));
    expect(screen.getByRole('button', { name: 'Recover GPS' })).not.toBeDisabled();
  });
});

function render(provenanceValue: GPSProvenance, overrides: Partial<GPSStatus> = {}, clockEvidence?: ClockSynchronizationEvidence, gnssDiagnostics?: GnssSerialDiagnostics) {
  return renderToStaticMarkup(<GPSGridWidget gps={baseGps(overrides)} provenance={provenanceValue} theme="dark_tactical" audioEnabled={false} onUpdateGPS={() => undefined} clockEvidence={clockEvidence} onSynchronizeClock={async () => undefined} gnssDiagnostics={gnssDiagnostics} />);
}

function diagnostics(state: GnssSerialDiagnostics['state']): GnssSerialDiagnostics {
  return { portName: 'COM6', baudRate: 9600, state, sessionGeneration: 4, reconnectCount: 3, lastOpenAttemptUtc: '2026-08-29T20:00:00.000Z', lastSuccessfulOpenUtc: null, lastSerialDataUtc: null, lastValidNmeaUtc: null, lastFixUtc: null, lastFailureUtc: '2026-08-29T20:00:10.000Z', lastFailureCategory: state === 'OpenFailed' ? 'AccessDenied' : 'None', lastFailureMessage: state === 'OpenFailed' ? 'COM6 is in use.' : null };
}

function baseGps(overrides: Partial<GPSStatus> = {}): GPSStatus {
  return {
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
}

function synchronizedClock(): ClockSynchronizationEvidence {
  return { status: 'Synchronized', error: 'None', gnssTime: { status: 'Available', timestampUtc: '2026-08-25T23:13:29.000Z', sentenceType: 'RMC' }, lastSuccessfulSynchronizationUtc: '2026-08-25T23:12:54.000Z', offsetBeforeSynchronizationSeconds: -0.658801, currentOffsetSeconds: null, attemptMessage: 'Windows time was set from fresh GNSS UTC evidence.' };
}

function provenance(status: GPSProvenance['status'], type: string): GPSProvenance {
  return { status, source: { id: `gps:${type}`, type } };
}
