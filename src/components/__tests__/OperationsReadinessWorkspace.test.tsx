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

const response = (weatherStatus: 'not_requested' | 'live' | 'unavailable' = 'not_requested') => ({
  kind: 'operations_readiness', briefId: brief.briefId, summary, diagnostics: [], displayEvidence: {
    weather: { status: weatherStatus, data: weatherStatus === 'live' ? { tempF: 72, condition: 'Clear', humidity: 45, windMph: 4, windDir: 'NW', pressureInHg: 30, uvIndex: 3, locationName: 'Planned park site', hourlyForecast: [] } : null, retrievedAtUtc: weatherStatus === 'live' ? '2026-08-21T04:01:00.000Z' : null, source: { id: 'weather-provider', type: 'weather_api', name: 'Planned-site weather provider' } },
    alerts: { status: weatherStatus, active: [], retrievedAtUtc: weatherStatus === 'live' ? '2026-08-21T04:01:00.000Z' : null, source: { id: 'alert-provider', type: 'weather_alert_api', name: 'Planned-site alert provider' } },
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
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Planned-site provider unavailable.'));
    expect(screen.queryByText('READINESS POSTURE')).toBeNull();
    expect(screen.getByText('Current weather and alerts are not loaded; readiness is using local retained evidence only.')).toBeTruthy();
  });

  it('renders an unsupported readiness response without offering a misleading retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ code: 'unsupported_brief_schema', message: 'Unsupported schema.' }) })));
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText('Operations Readiness is unsupported for this retained SmartDeploy brief schema.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'RETRY' })).toBeNull();
  });
});
