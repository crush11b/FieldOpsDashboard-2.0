/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    { id: 'current-location', status: 'ready', priority: 'low', message: 'Current operating location is available.', source: { id: 'gps', type: 'serial_nmea', name: 'GNSS' }, evaluatedAtUtc: '2026-08-21T04:00:00.000Z' },
    { id: 'clock-synchronization', status: 'unknown', priority: 'medium', message: 'Clock synchronization cannot currently be verified.', source: { id: 'clock', type: 'derived', name: 'Clock check' }, evaluatedAtUtc: '2026-08-21T04:00:00.000Z' },
    { id: 'propagation-evidence', status: 'attention', priority: 'low', message: 'Propagation guidance is modeled.', source: { id: 'propagation', type: 'derived', name: 'Propagation model' }, evaluatedAtUtc: '2026-08-21T04:00:00.000Z' },
    { id: 'field-readiness-checklist', status: 'unknown', priority: 'medium', message: 'Field Readiness Checklist has not been created.', source: { id: 'checklist', type: 'derived', name: 'Checklist state' }, evaluatedAtUtc: '2026-08-21T04:00:00.000Z' },
    { id: 'activation-notes', status: 'unknown', priority: 'medium', message: 'Activation Notes metadata is unavailable.', source: { id: 'notes', type: 'derived', name: 'Activation Notes state' }, evaluatedAtUtc: '2026-08-21T04:00:00.000Z' },
  ],
  nextActions: ['Review the propagation limitation.'],
};

const response = (weatherStatus: 'not_requested' | 'live' | 'unavailable' = 'not_requested', summaryValue = summary, evidenceOverrides: Record<string, unknown> = {}, responseBriefId = brief.briefId) => ({
  kind: 'operations_readiness', briefId: responseBriefId, summary: summaryValue, diagnostics: [], displayEvidence: {
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
    await waitFor(() => expect(screen.getByText('This retained brief uses an unsupported legacy schema for Operations Readiness.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'RETRY LOCAL READINESS' })).toBeNull();
  });

  it('shows factual plan status, runtime wording, ordered actions, findings, and exact controls', async () => {
    const runtimeSummary = { ...summary, toughBook: { ...summary.toughBook, runtimeEstimateSeconds: 0 }, nextActions: ['First action', 'Second action'], findings: [{ ...summary.findings[0], status: 'attention', priority: 'high', source: { id: 'gps', type: 'serial_nmea', name: 'GNSS' }, observedAtUtc: '2026-08-21T03:00:00.000Z', limitation: 'Check the location.' }, { id: 'toughbook-runtime-estimate', status: 'ready', priority: 'low', message: 'Windows reports an estimated 0m remaining for the ToughBook.', source: { id: 'windows', type: 'local_telemetry_pipe', name: 'Windows power' }, evaluatedAtUtc: '2026-08-21T04:00:00.000Z', limitation: 'This is a Windows-provided ToughBook estimate, not radio or station endurance.' }] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response('not_requested', runtimeSummary) })));
    render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByText('RETAINED PLAN STATUS')).toBeTruthy());
    expect(screen.getByText('Decision support only. This is not a safety, permission, legality, or go/no-go determination.')).toBeTruthy();
    expect(screen.getByText('Windows estimates approximately 0m remaining.')).toBeTruthy();
    const toughBookSection = screen.getByRole('heading', { name: 'TOUGHBOOK POWER' }).closest('section');
    expect(toughBookSection).not.toBeNull();
    expect(within(toughBookSection!).getAllByText(/This is a Windows-provided ToughBook estimate, not radio or station endurance\./)).toHaveLength(1);
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

  it('rejects a stale local response after the brief changes', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => new Promise(resolve => {
      if (fetcher.mock.calls.length === 1) resolveFirst = resolve;
      else resolveSecond = resolve;
      void input;
    }));
    vi.stubGlobal('fetch', fetcher);
    const { rerender: rerenderView } = render(<OperationsReadinessWorkspace brief={brief} />);
    const secondBrief = { ...brief, briefId: 'brief-readiness-2' } as SmartDeployBriefV2;
    rerenderView(<OperationsReadinessWorkspace brief={secondBrief} />);
    resolveFirst(response('not_requested', summary, {}, brief.briefId));
    resolveSecond(response('not_requested', summary, {}, secondBrief.briefId));
    await waitFor(() => expect(screen.getByText('BRIEF brief-readiness-2')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts pending local and live requests on unmount', async () => {
    const localSignals: AbortSignal[] = [];
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => { localSignals.push(init?.signal as AbortSignal); return new Promise(() => undefined); });
    vi.stubGlobal('fetch', fetcher);
    const view = render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(localSignals[0].aborted).toBe(true);
  });

  it('aborts a pending live request on unmount', async () => {
    const liveSignals: AbortSignal[] = [];
    const liveFetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      liveSignals.push(init?.signal as AbortSignal);
      return String(input).includes('includeLiveWeather') ? new Promise(() => undefined) : Promise.resolve({ ok: true, json: async () => response() });
    });
    vi.stubGlobal('fetch', liveFetcher);
    const liveView = render(<OperationsReadinessWorkspace brief={brief} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'LOAD LIVE WEATHER FOR PLANNED SITE' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'LOAD LIVE WEATHER FOR PLANNED SITE' }));
    liveView.unmount();
    expect(liveSignals.at(-1)?.aborted).toBe(true);
  });
});
