/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationsReadinessWorkspace } from '../OperationsReadinessWorkspace';
import type { SmartDeployBriefV2 } from '../../../server/smartDeployBrief';

const brief = {
  briefId: 'brief-readiness',
  activation: { reference: 'US-1234', displayName: 'Test Park' },
  plannedOperatingSite: { description: 'Planned park site', source: 'provider_reference_default', location: { coordinates: { lat: 38, lon: -78 }, gridSquare: 'FM18', planningSemantics: 'provider_reference_default' } },
  currentDeviceLocation: { coordinates: { lat: 37, lon: -77 }, gridSquare: 'FM17' },
  station: { radio: { name: 'Field Radio' }, antenna: { type: 'EFHW' }, selectedModes: ['SSB'], modeledMode: 'SSB', transmitPowerWatts: 10 },
} as unknown as SmartDeployBriefV2;

const summary = {
  evaluatedAtUtc: '2026-08-21T04:00:00.000Z',
  plan: { status: 'ready', briefId: brief.briefId, activationReference: 'US-1234', plannedSite: 'Planned park site' },
  currentLocation: { status: 'ready', provenance: 'current' },
  toughBook: { status: 'ready', chargePercent: 80, powerSource: 'AC', charging: true, runtimeEstimateSeconds: 3600 },
  stationEndurance: { status: 'unknown', limitation: 'Station endurance unavailable.' },
  findings: [
    { id: 'current-location', status: 'ready', priority: 'low', message: 'Current operating location is available.', source: {} },
    { id: 'clock-synchronization', status: 'unknown', priority: 'medium', message: 'Clock synchronization cannot currently be verified.', source: {} },
    { id: 'propagation-evidence', status: 'attention', priority: 'low', message: 'Propagation guidance is modeled.', source: {} },
    { id: 'field-readiness-checklist', status: 'unknown', priority: 'medium', message: 'Field Readiness Checklist has not been created.', source: {} },
    { id: 'activation-notes', status: 'unknown', priority: 'medium', message: 'Activation Notes metadata is unavailable.', source: {} },
  ],
  nextActions: ['Review the propagation limitation.'],
};

const response = (weatherStatus: 'not_requested' | 'live' | 'unavailable' = 'not_requested', summaryValue = summary, evidenceOverrides: Record<string, unknown> = {}) => ({
  kind: 'operations_readiness', briefId: brief.briefId, summary: summaryValue, diagnostics: [], displayEvidence: {
    weather: { status: weatherStatus, data: weatherStatus === 'live' ? { tempF: 72, condition: 'Clear', humidity: 45, windMph: 4, windDir: 'NW', pressureInHg: 30, uvIndex: 3, locationName: 'Planned park site', hourlyForecast: [] } : null, retrievedAtUtc: weatherStatus === 'live' ? '2026-08-21T04:01:00.000Z' : null, source: { id: 'weather-provider', type: 'weather_api', name: 'Planned-site weather provider' } },
    alerts: { status: weatherStatus, active: [], retrievedAtUtc: weatherStatus === 'live' ? '2026-08-21T04:01:00.000Z' : null, source: { id: 'alert-provider', type: 'weather_alert_api', name: 'Planned-site alert provider' } },
    ...evidenceOverrides,
  },
});

afterEach(() => vi.unstubAllGlobals());

describe('OperationsReadinessWorkspace', () => {
  it('loads local readiness by brief and only requests live weather explicitly', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/operations-readiness/brief-readiness');
      return { ok: true, json: async () => response() };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText('Current weather and alerts are not loaded; readiness is using local retained evidence only.')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'LOAD LIVE WEATHER FOR PLANNED SITE' }));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith('/api/operations-readiness/brief-readiness?includeLiveWeather=true', expect.anything()));
  });

  it('renders live evidence provenance and retrieval time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response('live') })));
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText(/Planned-site weather provider \(weather_api\)/)).toBeTruthy());
    expect(screen.getAllByRole('time').some(element => element.textContent === '2026-08-21 04:01:00 UTC')).toBe(true);
  });

  it('preserves the local summary when live enrichment fails', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('includeLiveWeather')
      ? { ok: false, json: async () => ({ code: 'readiness_unavailable', message: 'Planned-site provider unavailable.' }) }
      : { ok: true, json: async () => response() });
    vi.stubGlobal('fetch', fetcher);
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText('Current weather and alerts are not loaded; readiness is using local retained evidence only.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'LOAD LIVE WEATHER FOR PLANNED SITE' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Live weather and alerts could not be loaded for the planned site. Local readiness evidence is preserved.'));
    expect(screen.queryByText('Planned-site provider unavailable.')).toBeNull();
    expect(screen.queryByText('READINESS POSTURE')).toBeNull();
    expect(screen.getByText('Current weather and alerts are not loaded; readiness is using local retained evidence only.')).toBeTruthy();
  });

  it('renders an unsupported readiness response without offering a misleading retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ code: 'unsupported_brief_schema', message: 'Unsupported schema.' }) })));
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText('Operations Readiness is unsupported for this retained SmartDeploy brief schema.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'RETRY' })).toBeNull();
  });

  it('shows factual plan status, runtime wording, ordered actions, findings, and exact controls', async () => {
    const runtimeSummary = { ...summary, toughBook: { ...summary.toughBook, runtimeEstimateSeconds: 0 }, nextActions: ['First action', 'Second action'], findings: [{ ...summary.findings[0], status: 'attention', priority: 'high', source: { id: 'gps', type: 'serial_nmea', name: 'GNSS' }, observedAtUtc: '2026-08-21T03:00:00.000Z', limitation: 'Check the location.' }] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response('not_requested', runtimeSummary) })));
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText('RETAINED PLAN STATUS')).toBeTruthy());
    expect(screen.getByText('Decision support only. This is not a safety, permission, legality, or go/no-go determination.')).toBeTruthy();
    expect(screen.getByText('Windows estimates approximately 0m remaining.')).toBeTruthy();
    expect(screen.getByText('Radio and station endurance unknown.')).toBeTruthy();
    expect(screen.getByText('First action')).toBeTruthy();
    expect(screen.getByText('Second action')).toBeTruthy();
    expect(screen.getByText(/Status: attention \| Priority: high \| Source: GNSS/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'OPEN FIELD READINESS CHECKLIST' })).toHaveAttribute('href', '#field-readiness-checklist');
    expect(screen.getByRole('link', { name: 'OPEN ACTIVATION NOTES' })).toHaveAttribute('href', '#activation-notes');
  });

  it('renders missing runtime and empty actions without deriving runtime from charge', async () => {
    const missingRuntimeSummary = { ...summary, toughBook: { ...summary.toughBook, chargePercent: 99, runtimeEstimateSeconds: null }, nextActions: [] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response('not_requested', missingRuntimeSummary) })));
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText('Windows runtime estimate unavailable.')).toBeTruthy());
    expect(screen.getByText('No additional action is identified by the available readiness evidence.')).toBeTruthy();
    expect(screen.queryByText(/99% remaining/)).toBeNull();
  });

  it('renders partial weather and alert results independently, including Unknown alerts', async () => {
    const alert = { id: 'alert-1', severity: 'Unknown', title: 'Unclassified condition', description: 'Review details.', area: 'Planned site', issued: '2026-08-21T03:00:00.000Z', expires: '2026-08-21T05:00:00.000Z' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response('unavailable', summary, { alerts: { status: 'live', active: [alert], retrievedAtUtc: '2026-08-21T04:01:00.000Z', source: { id: 'alerts', type: 'weather_alert_api' } } }) })));
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText('Live weather for the retained planned site is unavailable. Local readiness evidence is preserved.')).toBeTruthy());
    expect(screen.getByText('Unknown: Unclassified condition')).toBeTruthy();
    expect(screen.getByText('Weather alerts are advisory evidence and do not constitute a universal operational block.')).toBeTruthy();
    expect(screen.getByText('Uses the retained planned-site coordinates. Current-device location is not used as a fallback. Network access is required.')).toBeTruthy();
  });
});
