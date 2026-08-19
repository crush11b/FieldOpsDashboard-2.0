/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartDeployPlanner } from '../SmartDeployPlanner';
import { SmartDeployBriefView } from '../SmartDeployBriefView';
import type { SmartDeployBrief } from '../../../server/smartDeployBrief';

const location = { coordinates: { lat: 37.4, lon: -77.4 }, gridSquare: 'FM17', provenance: 'current' as const, status: 'ok' as const, source: { id: 'gps', type: 'serial_nmea', name: 'GNSS' } };
const profile = { mode: 'SSB' as const, transmitPowerWatts: 10, antenna: { type: 'EFHW' as const }, deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const } };
const target = { program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: { lat: 38, lon: -78 }, gridSquare: 'FM18', provenance: { kind: 'externally_resolved', source: { id: 'pota', type: 'pota_api' }, resolvedAtUtc: '2026-08-18T11:00:00.000Z' } };

const brief = {
  schemaVersion: 1,
  briefId: 'brief-1',
  generatedAtUtc: '2026-08-18T11:00:00.000Z',
  status: 'partial',
  mission: { activationTarget: { program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: { lat: 37.5, lon: -77.5 }, provenance: { kind: 'externally_resolved' } }, operatingLocation: location, missionWindow: { start: '2026-08-18T12:00:00.000Z', end: '2026-08-18T14:00:00.000Z' }, equipment: { radio: { name: 'Field Radio' }, antenna: { type: 'EFHW' }, modes: ['SSB', 'FT8'], transmitPowerWatts: 10, deployment: { geometry: 'inverted_v', heightCategory: '15_to_30_ft' } }, objective: 'Test objective' },
  sections: {
    mission: { status: 'available', snapshot: {} },
    geometry: { status: 'derived', evidence: { distanceKm: 12.3, initialBearingDegrees: 45, compassDirection: 'NE' } },
    solar: { status: 'derived', evidence: { days: [{ date: '2026-08-18', events: { sunrise: '2026-08-18T10:00:00.000Z' } }], overlap: { includesDaylight: true } } },
    propagation: { status: 'partial', evidence: { samples: [{ position: 'start', modelDateTimeUtc: '2026-08-18T12:00:00.000Z', status: 'complete', stationProfile: { mode: 'SSB' } }, { position: 'midpoint', modelDateTimeUtc: '2026-08-18T13:00:00.000Z', status: 'unavailable', stationProfile: { mode: 'SSB' } }, { position: 'end', modelDateTimeUtc: '2026-08-18T14:00:00.000Z', status: 'complete', stationProfile: { mode: 'SSB' } }], summary: { successfulSampleCount: 2, strongestBandBySample: [{ position: 'start', band: '20m' }, { position: 'midpoint', band: null }, { position: 'end', band: '40m' }], consistentStrongestBand: null } } },
    observedRf: { status: 'notTemporallyApplicable', evidence: { observationWindow: { startsAt: '', endsAt: '' } } },
  },
  limitations: [{ code: 'single_mode_modeled', message: 'Only SSB was modeled; selected modes were SSB, FT8.' }],
  summary: 'Deterministic SmartDeploy summary.',
} as unknown as SmartDeployBrief;

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('POTA reference'), { target: { value: 'US-1234' } });
  fireEvent.change(screen.getByLabelText('Radio'), { target: { value: 'Field Radio' } });
  fireEvent.change(screen.getByLabelText('Mission start'), { target: { value: '2026-08-18T08:00' } });
  fireEvent.change(screen.getByLabelText('Mission end'), { target: { value: '2026-08-18T10:00' } });
  fireEvent.change(screen.getByLabelText('RF target region'), { target: { value: 'eastern_us' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('SmartDeploy planner', () => {
  it('renders the operator form with a modern POTA example and current location', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ briefs: [] }) })));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    expect(screen.getByPlaceholderText('US-1234')).toBeTruthy();
    expect(screen.queryByPlaceholderText('K-0182')).toBeNull();
    expect(screen.getByText(/FM17/)).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/smartdeploy/briefs'));
  });

  it('shows a loading state and preserves fields during generation', async () => {
    let resolveRequest!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => input === '/api/smartdeploy/briefs'
      ? Promise.resolve({ ok: true, json: async () => ({ briefs: [] }) })
      : String(input).startsWith('/api/pota-target') ? Promise.resolve({ ok: true, json: async () => ({ target }) })
      : new Promise(resolve => { resolveRequest = resolve; })));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    fillRequiredFields();
    fireEvent.click(screen.getByText('GENERATE SMARTDEPLOY PLAN'));
    expect(screen.getByText('GENERATING SMARTDEPLOY PLAN...')).toBeTruthy();
    expect(screen.getByLabelText('POTA reference')).toHaveValue('US-1234');
    await waitFor(() => expect(resolveRequest).toBeTypeOf('function'));
    resolveRequest({ ok: true, json: async () => ({ brief, persistence: { status: 'saved' } }) });
    await waitFor(() => expect(screen.getByText('OPERATIONS BRIEF')).toBeTruthy());
  });

  it('renders structured server validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => input === '/api/smartdeploy/briefs'
      ? { ok: true, json: async () => ({ briefs: [] }) }
      : String(input).startsWith('/api/pota-target') ? { ok: true, json: async () => ({ target }) }
      : { ok: false, json: async () => ({ message: 'The POTA park reference was not found.' }) }));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    fillRequiredFields();
    fireEvent.click(screen.getByText('GENERATE SMARTDEPLOY PLAN'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The POTA park reference was not found.'));
  });

  it('loads and deletes retained briefs without generating them', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/smartdeploy/briefs') return { ok: true, json: async () => ({ briefs: [{ briefId: 'brief-1', generatedAtUtc: brief.generatedAtUtc, status: brief.status, mission: brief.mission }] }) };
      if (String(input).endsWith('/brief-1') && init?.method === 'DELETE') return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({ brief }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    await waitFor(() => expect(screen.getByText(/US-1234/)).toBeTruthy());
    fireEvent.click(screen.getByText('US-1234', { selector: 'strong' }));
    await waitFor(() => expect(screen.getByText('OPERATIONS BRIEF')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Delete US-1234/ }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/smartdeploy/briefs/brief-1', { method: 'DELETE' }));
  });
});

describe('SmartDeploy brief rendering', () => {
  it('renders partial samples, modeled mode limitation, and temporal RF status', () => {
    render(<SmartDeployBriefView brief={brief} />);
    expect(screen.getByText('partial')).toBeTruthy();
    expect(screen.getByText(/Only SSB was modeled/)).toBeTruthy();
    expect(screen.getByText(/Not temporally applicable/)).toBeTruthy();
    expect(screen.getByText('midpoint')).toBeTruthy();
  });
});