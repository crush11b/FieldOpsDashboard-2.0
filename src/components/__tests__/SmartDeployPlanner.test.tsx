/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartDeployPlanner } from '../SmartDeployPlanner';
import { SmartDeployBriefView } from '../SmartDeployBriefView';
import type { SmartDeployBriefV1, SmartDeployBriefV2 } from '../../../server/smartDeployBrief';

const location = { coordinates: { lat: 37.4, lon: -77.4 }, gridSquare: 'FM17', provenance: 'current' as const, status: 'ok' as const, source: { id: 'gps', type: 'serial_nmea', name: 'GNSS' } };
const profile = { mode: 'SSB' as const, transmitPowerWatts: 10, antenna: { type: 'EFHW' as const }, deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const } };
const target = { program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: { lat: 38, lon: -78 }, gridSquare: 'FM18', provenance: { kind: 'externally_resolved', source: { id: 'pota', type: 'pota_api' }, resolvedAtUtc: '2026-08-18T11:00:00.000Z' } };
const sotaTarget = { program: 'SOTA', reference: 'W4V/SH-001', displayName: 'High Knob', elevationM: 1287, coordinates: { lat: 37.4567, lon: -82.1234 }, gridSquare: 'EM97', provenance: { kind: 'externally_resolved', source: { id: 'sota-summit-database', type: 'sota_official_summit_csv', name: 'Official Summits on the Air summit database' }, resolvedAtUtc: '2026-08-19T12:00:00.000Z' } };

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
} as unknown as SmartDeployBriefV1;

const v2Brief = {
  schemaVersion: 2,
  briefId: 'brief-v2',
  generatedAtUtc: '2026-08-18T11:00:00.000Z',
  status: 'complete',
  activation: target,
  plannedOperatingSite: { location, source: 'provider_reference_default', description: 'POTA reference location - approximate planning point' },
  currentDeviceLocation: location,
  propagationObjective: { kind: 'regional', regionId: 'eastern_us', regionLabel: 'Eastern U.S.' },
  missionWindow: { start: '2026-08-18T12:00:00.000Z', midpoint: '2026-08-18T13:00:00.000Z', end: '2026-08-18T14:00:00.000Z' },
  station: { radio: { name: 'Field Radio' }, antenna: { type: 'EFHW' }, selectedModes: ['SSB', 'FT8'], modeledMode: 'SSB', transmitPowerWatts: 10 },
  sections: {
    activation: { status: 'available', evidence: target }, plannedOperatingSite: { status: 'derived', evidence: { location, source: 'provider_reference_default', description: 'POTA reference location - approximate planning point' } }, currentDevice: { status: 'available', evidence: location },
    propagationObjective: { status: 'available', evidence: { kind: 'regional', regionId: 'eastern_us', regionLabel: 'Eastern U.S.' } }, missionWindow: { status: 'available', evidence: { start: '2026-08-18T12:00:00.000Z', midpoint: '2026-08-18T13:00:00.000Z', end: '2026-08-18T14:00:00.000Z' } }, station: { status: 'available', evidence: { radio: { name: 'Field Radio' }, antenna: { type: 'EFHW' }, selectedModes: ['SSB', 'FT8'], modeledMode: 'SSB', transmitPowerWatts: 10 } },
    propagation: { status: 'complete', evidence: { samples: [{ position: 'start', modelDateTimeUtc: '2026-08-18T12:00:00.000Z', status: 'complete', stationProfile: { mode: 'SSB' }, bands: [{ regional: { samples: [{ distanceKm: 120 }] } }] }], summary: { successfulSampleCount: 1, strongestBandBySample: [{ position: 'start', band: '20m' }] } } }, solar: { status: 'derived', evidence: { overlap: { entirelyDuringDaylight: true, entirelyDuringDarkness: false, includesDaylight: true } } }, observedRf: { status: 'notTemporallyApplicable', evidence: brief.sections.observedRf.evidence },
  },
  limitations: [{ code: 'planned_site_reference_coordinate', message: 'The planned site uses the provider reference coordinate and may not be the exact station setup point.' }, { code: 'model_no_forecast', message: 'Uses a general solar-cycle model value; mission-time space-weather forecast is not included.' }],
  summary: 'v2 summary',
} as unknown as SmartDeployBriefV2;

function fillRequiredFields(program: 'POTA' | 'SOTA' = 'POTA', reference = program === 'POTA' ? 'US-1234' : 'W4V/SH-001') {
  fireEvent.change(screen.getByLabelText(`${program} reference`), { target: { value: reference } });
  fireEvent.change(screen.getByLabelText('Radio'), { target: { value: 'Field Radio' } });
  fireEvent.change(screen.getByLabelText('Mission start'), { target: { value: '2026-08-18T08:00' } });
  fireEvent.change(screen.getByLabelText('Mission end'), { target: { value: '2026-08-18T10:00' } });
  fireEvent.change(screen.getByLabelText('RF target region'), { target: { value: 'eastern_us' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('SmartDeploy planner', () => {
  it('marks Radio as required and explains its planning purpose', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => input === '/api/smartdeploy/briefs'
      ? { ok: true, json: async () => ({ briefs: [] }) }
      : { ok: true, json: async () => ({ state: 'UNAVAILABLE', metadata: null }) }));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    expect(screen.getByLabelText('Radio')).toBeRequired();
    expect(screen.getByText(/planning brief records the station equipment/i)).toBeTruthy();
  });

  it('renders the operator form with a modern POTA example and current location', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ briefs: [] }) })));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    expect(screen.getByPlaceholderText('US-1234')).toBeTruthy();
    expect(screen.queryByPlaceholderText('K-0182')).toBeNull();
    expect(screen.getByText(/FM17/)).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/smartdeploy/briefs'));
  });

  it('shows SOTA data status and refreshes only after the operator requests it', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/smartdeploy/briefs') return { ok: true, json: async () => ({ briefs: [] }) };
      if (input === '/api/sota-data/status') return { ok: true, json: async () => ({ state: 'STALE', metadata: { downloadedAtUtc: '2026-08-19T12:00:00.000Z', sourceVersion: '19/08/2026' } }) };
      expect(input).toBe('/api/sota-data/refresh');
      expect(init?.method).toBe('POST');
      return { ok: true, json: async () => ({ state: 'AVAILABLE', metadata: { downloadedAtUtc: '2026-08-20T12:00:00.000Z', sourceVersion: '20/08/2026' } }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    await waitFor(() => expect(screen.getByText(/Stale/)).toBeTruthy());
    expect(fetcher).not.toHaveBeenCalledWith('/api/sota-data/refresh', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'REFRESH SOTA DATA' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/sota-data/refresh', { method: 'POST' }));
    await waitFor(() => expect(screen.getByText(/Available/)).toBeTruthy());
  });

  it('keeps antenna geometry and height selections valid as the operator changes field antennas', () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => input === '/api/smartdeploy/briefs'
      ? { ok: true, json: async () => ({ briefs: [] }) }
      : { ok: true, json: async () => ({ state: 'UNAVAILABLE', metadata: null }) }));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    const antennaSelect = screen.getByLabelText('Antenna');
    const geometrySelect = screen.getByLabelText('Deployment geometry');
    const heightSelect = screen.getByLabelText('Height category');

    fireEvent.change(antennaSelect, { target: { value: 'vertical' } });
    expect(geometrySelect).toHaveValue('vertical');
    expect(heightSelect).toHaveValue('not_applicable');
    fireEvent.change(antennaSelect, { target: { value: 'portable_whip' } });
    expect(geometrySelect).toHaveValue('vertical');
    expect(heightSelect).toHaveValue('not_applicable');
    fireEvent.change(antennaSelect, { target: { value: 'loaded_vertical' } });
    expect(geometrySelect).toHaveValue('vertical');
    expect(heightSelect).toHaveValue('not_applicable');
    fireEvent.change(antennaSelect, { target: { value: 'EFHW' } });
    expect(geometrySelect).toHaveValue('inverted_v');
    expect(heightSelect).toHaveValue('15_to_30_ft');
  });

  it('selects SOTA, shows its example, resolves a known summit, and displays identity and coordinates', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/smartdeploy/briefs') return { ok: true, json: async () => ({ briefs: [] }) };
      if (input === '/api/sota-data/status') return { ok: true, json: async () => ({ state: 'AVAILABLE', metadata: { downloadedAtUtc: '2026-08-19T12:00:00.000Z', sourceVersion: '19/08/2026' } }) };
      return { ok: true, json: async () => ({ kind: 'smartdeploy_target', status: 'cached', target: sotaTarget }) };
    }));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    expect(screen.getByLabelText('POTA reference')).toHaveAttribute('placeholder', 'US-1234');
    fireEvent.change(screen.getByLabelText('Activation program'), { target: { value: 'SOTA' } });
    expect(screen.getByLabelText('SOTA reference')).toHaveAttribute('placeholder', 'W4V/SH-001');
    fireEvent.change(screen.getByLabelText('SOTA reference'), { target: { value: 'w4v/sh-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'RESOLVE SOTA TARGET' }));
    await waitFor(() => expect(screen.getByText(/High Knob/)).toBeTruthy());
    expect(screen.getByText(/37.45670, -82.12340/)).toBeTruthy();
    expect(screen.getByText(/1287 m/)).toBeTruthy();
    expect(screen.getByText(/SOURCE: cached/)).toBeTruthy();
  });

  it('allows stale SOTA planning with a visible warning and blocks unavailable SOTA honestly', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/smartdeploy/briefs') return { ok: true, json: async () => ({ briefs: [] }) };
      if (input === '/api/sota-data/status') return { ok: true, json: async () => ({ state: 'STALE', metadata: { downloadedAtUtc: '2026-07-01T12:00:00.000Z', sourceVersion: '01/07/2026' } }) };
      if (input === '/api/smartdeploy/target') return { ok: true, json: async () => ({ status: 'stale', target: sotaTarget }) };
      return { ok: true, json: async () => ({ brief: v2Brief, persistence: { status: 'saved' } }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    fireEvent.change(screen.getByLabelText('Activation program'), { target: { value: 'SOTA' } });
    fillRequiredFields('SOTA');
    fireEvent.click(screen.getByRole('button', { name: 'RESOLVE SOTA TARGET' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/stale/i));
    expect(screen.getByText(/SOURCE: stale/)).toBeTruthy();

    const unavailableFetcher = vi.fn(async (input: RequestInfo | URL) => input === '/api/smartdeploy/briefs'
      ? { ok: true, json: async () => ({ briefs: [] }) }
      : input === '/api/sota-data/status' ? { ok: true, json: async () => ({ state: 'UNAVAILABLE', metadata: null }) }
      : { ok: false, json: async () => ({ status: 'unavailable', message: 'The SOTA source is currently unavailable.' }) });
    vi.stubGlobal('fetch', unavailableFetcher);
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    fireEvent.change(screen.getAllByLabelText('Activation program')[1], { target: { value: 'SOTA' } });
    fireEvent.change(screen.getAllByLabelText('SOTA reference')[1], { target: { value: 'W4V/SH-001' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'RESOLVE SOTA TARGET' })[1]);
    await waitFor(() => expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/unavailable/i));
    expect(unavailableFetcher).not.toHaveBeenCalledWith('/api/smartdeploy/generate', expect.anything());
  });

  it('preserves usable SOTA state when an explicit refresh fails and restores POTA semantics when switched back', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/smartdeploy/briefs') return { ok: true, json: async () => ({ briefs: [] }) };
      if (input === '/api/sota-data/status') return { ok: true, json: async () => ({ state: 'AVAILABLE', metadata: { downloadedAtUtc: '2026-08-19T12:00:00.000Z', sourceVersion: '19/08/2026' } }) };
      if (input === '/api/sota-data/refresh') return { ok: false, json: async () => ({ state: 'AVAILABLE', metadata: { downloadedAtUtc: '2026-08-19T12:00:00.000Z' }, message: 'Refresh failed; prior dataset remains available.' }) };
      return { ok: true, json: async () => ({ target: sotaTarget, status: 'cached' }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    fireEvent.click(screen.getByRole('button', { name: 'REFRESH SOTA DATA' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/prior dataset remains available/i));
    fireEvent.change(screen.getByLabelText('Activation program'), { target: { value: 'SOTA' } });
    expect(screen.getByLabelText('SOTA reference')).toHaveAttribute('placeholder', 'W4V/SH-001');
    fireEvent.change(screen.getByLabelText('Activation program'), { target: { value: 'POTA' } });
    expect(screen.getByLabelText('POTA reference')).toHaveAttribute('placeholder', 'US-1234');
  });

  it('plans a known SOTA summit offline through the shared generation endpoint using authoritative coordinates', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/smartdeploy/briefs') return { ok: true, json: async () => ({ briefs: [] }) };
      if (input === '/api/sota-data/status') return { ok: true, json: async () => ({ state: 'AVAILABLE', metadata: { downloadedAtUtc: '2026-08-19T12:00:00.000Z', sourceVersion: '19/08/2026' } }) };
      if (input === '/api/smartdeploy/target') return { ok: true, json: async () => ({ status: 'cached', target: sotaTarget }) };
      if (input === '/api/smartdeploy/generate') {
        const body = JSON.parse(String(init?.body));
        expect(body.targetRequest).toEqual({ program: 'SOTA', reference: 'W4V/SH-001' });
        expect(body.activationTarget.coordinates).toEqual(sotaTarget.coordinates);
        return { ok: true, json: async () => ({ brief: v2Brief, persistence: { status: 'saved' } }) };
      }
      throw new Error(`Unexpected network request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    fireEvent.change(screen.getByLabelText('Activation program'), { target: { value: 'SOTA' } });
    fillRequiredFields('SOTA');
    fireEvent.click(screen.getByText('GENERATE SMARTDEPLOY PLAN'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/smartdeploy/generate', expect.objectContaining({ method: 'POST' })));
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('sotadata.org.uk'))).toBe(false);
  });

  it('shows a loading state and preserves fields during generation', async () => {
    let resolveRequest!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => input === '/api/smartdeploy/briefs'
      ? Promise.resolve({ ok: true, json: async () => ({ briefs: [] }) })
      : input === '/api/sota-data/status' ? Promise.resolve({ ok: true, json: async () => ({ state: 'UNAVAILABLE', metadata: null }) })
      : String(input) === '/api/smartdeploy/target' ? Promise.resolve({ ok: true, json: async () => ({ target, status: 'live' }) })
      : new Promise(resolve => { resolveRequest = resolve; })));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    fillRequiredFields();
    fireEvent.click(screen.getByText('GENERATE SMARTDEPLOY PLAN'));
    expect(screen.getByText('GENERATING SMARTDEPLOY PLAN...')).toBeTruthy();
    expect(screen.getByLabelText('POTA reference')).toHaveValue('US-1234');
    await waitFor(() => expect(resolveRequest).toBeTypeOf('function'));
    resolveRequest({ ok: true, json: async () => ({ brief, persistence: { status: 'saved' } }) });
    await waitFor(() => expect(screen.getByText('LEGACY SMARTDEPLOY BRIEF')).toBeTruthy());
  });

  it('renders structured server validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => input === '/api/smartdeploy/briefs'
      ? { ok: true, json: async () => ({ briefs: [] }) }
      : input === '/api/sota-data/status' ? { ok: true, json: async () => ({ state: 'UNAVAILABLE', metadata: null }) }
      : String(input) === '/api/smartdeploy/target' ? { ok: true, json: async () => ({ target, status: 'live' }) }
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
    await waitFor(() => expect(screen.getByText('LEGACY SMARTDEPLOY BRIEF')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Delete US-1234/ }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/smartdeploy/briefs/brief-1', { method: 'DELETE' }));
  });

  it('sends an explicitly entered planned site without replacing it with current GPS or the POTA target', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/smartdeploy/briefs') return { ok: true, json: async () => ({ briefs: [] }) };
      if (input === '/api/sota-data/status') return { ok: true, json: async () => ({ state: 'UNAVAILABLE', metadata: null }) };
      if (String(input) === '/api/smartdeploy/target') return { ok: true, json: async () => ({ target, status: 'live' }) };
      if (String(input) === '/api/smartdeploy/generate') {
        const body = JSON.parse(String(init?.body));
        expect(body.plannedOperatingLocation.coordinates).toEqual({ lat: 37.4, lon: -77.4 });
        expect(body.plannedOperatingLocation.coordinates).not.toEqual(target.coordinates);
        expect(body.plannedOperatingLocation.coordinates).toEqual(location.coordinates);
        expect(body.plannedOperatingLocation.planningSemantics).toBe('operator_planned_override');
        expect(body.plannedOperatingLocation.source.type).toBe('manual_planned_site_coordinates');
        return { ok: true, json: async () => ({ brief: v2Brief, persistence: { status: 'saved' } }) };
      }
      return { ok: false, json: async () => ({ message: 'Unexpected request.' }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SmartDeployPlanner operatingLocation={{ ...location, coordinates: { lat: 40, lon: -80 }, gridSquare: 'FM29' }} stationProfile={profile} />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Planned operating site'), { target: { value: 'manual' } });
    fireEvent.change(screen.getByLabelText('Planned site latitude'), { target: { value: '37.4' } });
    fireEvent.change(screen.getByLabelText('Planned site longitude'), { target: { value: '-77.4' } });
    fireEvent.click(screen.getByText('GENERATE SMARTDEPLOY PLAN'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/smartdeploy/generate', expect.objectContaining({ method: 'POST' })));
  });
});

describe('SmartDeploy brief rendering', () => {
  it('presents retained multi-day forecast periods compactly and discloses hourly evidence', async () => {
    const forecast = { schemaVersion: 2, briefId: v2Brief.briefId, provider: { name: 'Open-Meteo', timezone: 'UTC' }, retrievedAtUtc: '2026-08-18T11:00:00.000Z', updatedAtUtc: '2026-08-18T11:00:00.000Z', missionWindow: v2Brief.missionWindow, freshness: 'retained', coverageStatus: 'partial', presentation: { mode: 'aggregated', hourlyThresholdHours: 12 }, operatingPeriods: [{ periodId: 'utc-2026-08-18T12', label: 'Afternoon (UTC)', startsAtUtc: '2026-08-18T12:00:00.000Z', endsAtUtc: '2026-08-18T18:00:00.000Z', timezoneLabel: 'UTC', expectedHourlySlotCount: 6, observedHourlySlotCount: 5, missingHourlySlotCount: 1, coverageStatus: 'partial', temperatureMinF: 70, temperatureMaxF: 75, precipitationProbabilityMax: 40, sustainedWindMinMph: 2, sustainedWindMaxMph: 9, significantCondition: 'Cloudy', provider: 'Open-Meteo', retrievedAtUtc: '2026-08-18T11:00:00.000Z', freshness: 'retained', limitations: ['1 hourly slot is missing'], hourlyObservationIndexes: [0], hourlyObservationTimestampsUtc: ['2026-08-18T12:00:00.000Z'] }], periods: [{ startsAtUtc: '2026-08-18T12:00:00.000Z', endsAtUtc: '2026-08-18T13:00:00.000Z', missionApplicable: true, temperatureF: 70, precipitationProbability: 20, windSpeedMph: 2, windDirectionDegrees: 0, windDirection: 'N', weatherCode: 0, condition: 'Clear Sky' }], hourly: [{ startsAtUtc: '2026-08-18T12:00:00.000Z', endsAtUtc: '2026-08-18T13:00:00.000Z', missionApplicable: true, temperatureF: 70, precipitationProbability: 20, windSpeedMph: 2, windDirectionDegrees: 0, windDirection: 'N', weatherCode: 0, condition: 'Clear Sky' }], limitations: ['1 hourly slot is missing'] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { if (String(input) === '/api/activations') return { ok: true, json: async () => ({ activations: [] }) }; if (String(input).includes('/mission-forecast/brief/')) return { ok: true, json: async () => ({ record: forecast }) }; if (String(input).includes('/space-weather/brief/')) return { ok: true, json: async () => ({ record: null }) }; return { ok: false, json: async () => ({ message: 'Unavailable' }) }; }));
    render(<SmartDeployBriefView brief={v2Brief} />);
    await waitFor(() => expect(screen.getByText(/Compact operating periods \/ UTC/)).toBeTruthy());
    expect(screen.getByText(/Afternoon \(UTC\)/)).toBeTruthy();
    expect(screen.getAllByText(/partial coverage/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Underlying hourly evidence / UTC'));
    expect(screen.getAllByText(/provider Open-Meteo/).length).toBeGreaterThan(0);
  });

  it('keeps retained evidence visible and marks an explicit failed refresh distinctly', async () => {
    const forecast = { schemaVersion: 2, briefId: v2Brief.briefId, provider: { name: 'Open-Meteo' }, retrievedAtUtc: '2026-08-18T11:00:00.000Z', updatedAtUtc: '2026-08-18T11:00:00.000Z', missionWindow: v2Brief.missionWindow, freshness: 'retained', coverageStatus: 'complete', presentation: { mode: 'hourly' }, periods: [{ startsAtUtc: '2026-08-18T12:00:00.000Z', endsAtUtc: '2026-08-18T13:00:00.000Z', condition: 'Clear Sky', temperatureF: 70, precipitationProbability: 0, windSpeedMph: 2, windDirection: 'N', windGustMph: 4 }], hourly: [{ startsAtUtc: '2026-08-18T12:00:00.000Z', endsAtUtc: '2026-08-18T13:00:00.000Z', condition: 'Clear Sky', temperatureF: 70, precipitationProbability: 0, windSpeedMph: 2, windDirection: 'N', windGustMph: 4 }] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { if (String(input).includes('/mission-forecast/brief/') && init?.method === 'POST') return { ok: false, json: async () => ({ message: 'Provider unavailable.' }) }; if (String(input).includes('/mission-forecast/brief/')) return { ok: true, json: async () => ({ record: forecast }) }; if (String(input).includes('/space-weather/brief/')) return { ok: true, json: async () => ({ record: null }) }; return { ok: true, json: async () => ({ activations: [] }) }; }));
    render(<SmartDeployBriefView brief={v2Brief} />);
    await waitFor(() => expect(screen.getByText(/Hourly evidence \/ UTC/)).toBeTruthy());
    expect(screen.getByText(/Clear Sky, 70°F/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'REFRESH MISSION FORECAST' }));
    await waitFor(() => expect(screen.getByText(/Status: FAILED\./)).toBeTruthy());
    expect(screen.getByText('Refresh failed; prior retained evidence is preserved.')).toBeTruthy();
    expect(screen.getByText(/Clear Sky, 70°F/)).toBeTruthy();
  });

  it('shows an explicit unavailable state when refresh fails without retained evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { if (String(input).includes('/mission-forecast/brief/') && init?.method === 'POST') return { ok: false, json: async () => ({ message: 'Provider unavailable.' }) }; if (String(input).includes('/mission-forecast/brief/')) return { ok: true, json: async () => ({ record: null }) }; if (String(input).includes('/space-weather/brief/')) return { ok: true, json: async () => ({ record: null }) }; return { ok: true, json: async () => ({ activations: [] }) }; }));
    render(<SmartDeployBriefView brief={v2Brief} />);
    await waitFor(() => expect(screen.getByText(/Mission forecast unavailable\./)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'REFRESH MISSION FORECAST' }));
    await waitFor(() => expect(screen.getByText(/Status: UNAVAILABLE\./)).toBeTruthy());
    expect(screen.queryByText('Refresh failed; prior retained evidence is preserved.')).toBeNull();
  });

  it('switches between exclusive PLAN, PREPARE, OPERATE, and REVIEW views', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/activations') return { ok: true, json: async () => ({ activations: [] }) };
      if (String(input).includes('/mission-forecast/brief/')) return { ok: true, json: async () => ({ record: null }) };
      if (String(input).includes('/space-weather/brief/')) return { ok: true, json: async () => ({ record: null }) };
      return { ok: false, json: async () => ({ message: 'Unavailable' }) };
    }));
    render(<SmartDeployBriefView brief={v2Brief} />);
    expect(screen.getByText('SMARTDEPLOY PLAN')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    expect(screen.getByText('OPERATIONS READINESS')).toBeTruthy();
    expect(screen.queryByText('SMARTDEPLOY PLAN')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'operate' }));
    expect(screen.getByText('START ACTIVATION')).toBeTruthy();
    expect(screen.queryByText('OPERATIONS READINESS')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'review' }));
    expect(screen.getByText('OPEN OPERATE')).toBeTruthy();
    expect(screen.queryByText('ACTIVATION')).toBeNull();
  });

  it('starts the Activation before navigating from PREPARE to OPERATE', async () => {
    const plannedActivation = { activationId: 'activation-prepare', briefId: v2Brief.briefId, type: 'POTA', reference: 'US-1234', title: 'Test Park', status: 'planned', plannedLocation: { gridSquare: 'FM18' }, missionWindow: v2Brief.missionWindow } as any;
    const activeActivation = { ...plannedActivation, status: 'active', startedAtUtc: '2026-08-18T12:00:00.000Z' };
    const readiness = { kind: 'operations_readiness', briefId: v2Brief.briefId, summary: { evaluatedAtUtc: '2026-08-18T11:00:00.000Z', plan: { status: 'ready', briefId: v2Brief.briefId, activationReference: 'US-1234', plannedSite: 'FM17' }, toughBook: { status: 'ready', chargePercent: 100, powerSource: 'AC', charging: true, runtimeEstimateSeconds: 3600 }, findings: [], nextActions: [] }, diagnostics: [], displayEvidence: { weather: { status: 'not_requested', data: null, retrievedAtUtc: null, source: { id: 'weather', type: 'local' } }, alerts: { status: 'not_requested', active: [], retrievedAtUtc: null, source: { id: 'alerts', type: 'local' } } } };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/activations') return { ok: true, json: async () => ({ activations: [] }) };
      if (path === `/api/operations-readiness/${v2Brief.briefId}`) return { ok: true, json: async () => readiness };
      if (path === '/api/activations/from-brief') return { ok: true, json: async () => ({ kind: 'activation', activation: plannedActivation }) };
      if (path === `/api/activations/${plannedActivation.activationId}/status`) { expect(init?.method).toBe('PATCH'); return { ok: true, json: async () => ({ kind: 'activation', status: 'updated', activation: activeActivation }) }; }
      if (path.includes('/qsos')) return { ok: true, json: async () => ({ qsos: [] }) };
      return { ok: false, json: async () => ({ message: 'Unexpected request.' }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SmartDeployBriefView brief={v2Brief} />);
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'START ACTIVATION' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'START ACTIVATION' }));
    await waitFor(() => expect(screen.getByText('ACTIVE · Started 2026-08-18 12:00:00 UTC')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledWith('/api/activations/from-brief', expect.objectContaining({ method: 'POST' }));
    expect(fetcher).toHaveBeenCalledWith(`/api/activations/${plannedActivation.activationId}/status`, expect.objectContaining({ method: 'PATCH' }));
    expect(screen.queryByRole('button', { name: 'START ACTIVATION' })).toBeNull();
  });

  it('keeps the active OPERATE work surface usable when optional evidence is unavailable', async () => {
    const activeActivation = { activationId: 'activation-operate', briefId: v2Brief.briefId, type: 'POTA', reference: 'US-1234', title: 'Test Park', status: 'active', plannedLocation: { gridSquare: 'FM18' }, missionWindow: v2Brief.missionWindow };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/activations') return { ok: true, json: async () => ({ activations: [activeActivation] }) };
      if (path === `/api/activation-notes/brief/${v2Brief.briefId}`) return { ok: true, json: async () => ({ kind: 'activation_notes_empty' }) };
      if (path === '/api/live-band-activity') return { ok: false, status: 503, json: async () => ({}) };
      if (path.includes('/qsos')) return { ok: true, json: async () => ({ qsos: [] }) };
      if (path.includes('/wsjtx/')) return { ok: true, json: async () => ({ status: 'unavailable', state: null }) };
      return { ok: true, json: async () => ({ record: null }) };
    }));
    render(<SmartDeployBriefView brief={v2Brief} />);
    fireEvent.click(screen.getByRole('button', { name: 'operate' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'QSO LOG' })).toBeTruthy());
    expect(screen.getByRole('banner', { name: 'Operational header' })).toHaveTextContent('ACTIVE ACTIVATION');
    expect(screen.getByRole('heading', { name: 'ACTIVATION NOTES' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Operate supporting context' })).toHaveTextContent('PLANNED / MODELED');
    expect(screen.getByRole('region', { name: 'Live Band Activity' })).toHaveTextContent('Live Band Activity request failed');
    expect(screen.getByLabelText('QSO logging').compareDocumentPosition(screen.getByRole('region', { name: 'Operate supporting context' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clears a stale ambiguity warning when PREPARE start returns the reconciled active Activation', async () => {
    const plannedActivation = { activationId: 'activation-new', briefId: v2Brief.briefId, type: 'POTA', reference: 'US-1234', title: 'Test Park', status: 'planned', plannedLocation: { gridSquare: 'FM18' }, missionWindow: v2Brief.missionWindow } as any;
    const oldActiveActivations = [
      { ...plannedActivation, activationId: 'activation-old-1', reference: 'OLD-1', status: 'active' },
      { ...plannedActivation, activationId: 'activation-old-2', reference: 'OLD-2', status: 'active' },
    ];
    const activeActivation = { ...plannedActivation, status: 'active', startedAtUtc: '2026-08-29T12:00:00.000Z' };
    const readiness = { kind: 'operations_readiness', briefId: v2Brief.briefId, summary: { evaluatedAtUtc: '2026-08-29T11:00:00.000Z', plan: { status: 'ready', briefId: v2Brief.briefId, activationReference: 'US-1234', plannedSite: 'FM17' }, toughBook: { status: 'ready', chargePercent: 100, powerSource: 'AC', charging: true, runtimeEstimateSeconds: 3600 }, findings: [], nextActions: [] }, diagnostics: [], displayEvidence: { weather: { status: 'not_requested', data: null, retrievedAtUtc: null, source: { id: 'weather', type: 'local' } }, alerts: { status: 'not_requested', active: [], retrievedAtUtc: null, source: { id: 'alerts', type: 'local' } } } };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/activations') return { ok: true, json: async () => ({ activations: oldActiveActivations }) };
      if (path === `/api/operations-readiness/${v2Brief.briefId}`) return { ok: true, json: async () => readiness };
      if (path === '/api/activations/from-brief') return { ok: true, json: async () => ({ kind: 'activation', activation: plannedActivation }) };
      if (path === `/api/activations/${plannedActivation.activationId}/status`) return { ok: true, json: async () => ({ kind: 'activation', status: 'updated', activation: activeActivation, reconciledActivationIds: oldActiveActivations.map(item => item.activationId) }) };
      if (path.includes('/qsos')) return { ok: true, json: async () => ({ qsos: [] }) };
      return { ok: false, json: async () => ({ message: 'Unexpected request.' }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SmartDeployBriefView brief={v2Brief} />);
    await waitFor(() => expect(screen.getByText('AMBIGUOUS ACTIVE ACTIVATION STATE')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'START ACTIVATION' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'START ACTIVATION' }));
    await waitFor(() => expect(screen.getByText('ACTIVE · Started 2026-08-29 12:00:00 UTC')).toBeTruthy());
    expect(screen.queryByText('AMBIGUOUS ACTIVE ACTIVATION STATE')).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(`/api/activations/${plannedActivation.activationId}/status`, expect.objectContaining({ method: 'PATCH' }));
  });

  it('renders partial samples, modeled mode limitation, and temporal RF status', () => {
    render(<SmartDeployBriefView brief={brief} />);
    expect(screen.getByText('partial')).toBeTruthy();
    expect(screen.getAllByText(/Only SSB was modeled/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not temporally applicable/)).toBeTruthy();
    expect(screen.getByText('HISTORICAL EVIDENCE')).toBeTruthy();
  });

  it('renders the concise v2 operator view and technical details', () => {
    render(<SmartDeployBriefView brief={v2Brief} />);
    expect(screen.getByText('SMARTDEPLOY PLAN')).toBeTruthy();
    expect(screen.getAllByText('POTA reference location - approximate planning point').length).toBeGreaterThan(0);
    expect(screen.getByText('Eastern U.S.')).toBeTruthy();
    expect(screen.getByText('Strongest modeled band: 20m')).toBeTruthy();
    expect(screen.getByText('Technical Details')).toBeTruthy();
    expect(screen.getByText('Live band activity is too early to apply to this mission.')).toBeTruthy();
    expect(screen.getAllByText('CURRENT DEVICE', { exact: true })).toHaveLength(1);
    expect(screen.getAllByText(/POTA reference location - approximate planning point/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/POTA reference location - approximate planning point/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Uses a general solar-cycle model value/).length).toBeGreaterThan(0);
    expect(screen.queryByText('western_europe')).toBeNull();
    expect(screen.queryByText('OPERATION')).toBeNull();
  });

  it('renders the generated PLAN through the production planner path', async () => {
    const acceptanceBrief = { ...v2Brief, activation: { ...v2Brief.activation, reference: 'W4V/SH-005' }, propagationObjective: { ...v2Brief.propagationObjective, regionId: 'western_europe', regionLabel: 'Western Europe' } } as SmartDeployBriefV2;
    const forecast = { coverage: 'mission-window hourly forecast', retrievedAtUtc: '2026-08-18T11:30:00.000Z', periods: [{ startsAtUtc: '2026-08-18T12:00:00.000Z', condition: 'Clear', temperatureF: 72, precipitationProbability: 5, windSpeedMph: 4, windDirection: 'NW' }] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/smartdeploy/briefs') return { ok: true, json: async () => ({ briefs: [{ schemaVersion: 2, briefId: 'acceptance-brief', generatedAtUtc: acceptanceBrief.generatedAtUtc, status: acceptanceBrief.status, activation: acceptanceBrief.activation }] }) };
      if (path === '/api/sota-data/status') return { ok: true, json: async () => ({ state: 'UNAVAILABLE', metadata: null }) };
      if (path === '/api/smartdeploy/briefs/acceptance-brief') return { ok: true, json: async () => ({ brief: acceptanceBrief }) };
      if (path === '/api/activations') return { ok: true, json: async () => ({ activations: [] }) };
      if (path.includes('/mission-forecast/brief/')) return { ok: true, json: async () => ({ record: forecast }) };
      if (path.includes('/space-weather/brief/')) return { ok: true, json: async () => ({ record: null }) };
      return { ok: false, json: async () => ({ message: 'Unexpected request.' }) };
    }));
    render(<SmartDeployPlanner operatingLocation={location} stationProfile={profile} />);
    await waitFor(() => expect(screen.getByText('W4V/SH-005', { selector: 'strong' })).toBeTruthy());
    fireEvent.click(screen.getByText('W4V/SH-005', { selector: 'strong' }));
    await waitFor(() => expect(screen.getByText('W4V/SH-005')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Clear, 72°F, 5% precipitation/)).toBeTruthy());
    expect(screen.getAllByText('Western Europe')).toHaveLength(2);
    expect(screen.getAllByText('FM17').length).toBeGreaterThan(0);
    expect(screen.getByText(/Field Radio - EFHW - 10 W/)).toBeTruthy();
    expect(screen.getAllByText(/2026-08-18 12:00:00 UTC to 2026-08-18 14:00:00 UTC/)).toHaveLength(2);
    expect(screen.queryByText('western_europe')).toBeNull();
    expect(screen.queryByText('FIELD OPERATION')).toBeNull();
    expect(screen.queryByText('IMPORTANT NOTES')).toBeNull();
    const technicalDetails = screen.getByText('Technical Details').closest('details');
    expect(technicalDetails).not.toHaveAttribute('open');
    expect(screen.getByText('LOCATION CONTEXT').closest('details')).not.toHaveAttribute('open');
  });

  it('keeps unavailable observed RF visible without repeating it in primary notes', () => {
    const unavailableBrief = {
      ...v2Brief,
      sections: { ...v2Brief.sections, observedRf: { ...v2Brief.sections.observedRf, status: 'unavailable' } },
      limitations: [{ code: 'observed_rf_unavailable', message: 'Live band activity is unavailable.' }],
    } as unknown as SmartDeployBriefV2;
    render(<SmartDeployBriefView brief={unavailableBrief} />);
    expect(screen.getByText('Live activity unavailable.')).toBeTruthy();
    expect(screen.getByText('LIVE BAND ACTIVITY')).toBeTruthy();
    expect(screen.queryByText('IMPORTANT NOTES')).toBeNull();
    expect(screen.getAllByText('Live band activity is unavailable.')).toHaveLength(1);
  });

  it('labels an explicitly selected current device as the planned site', () => {
    const selectedCurrentDeviceBrief = {
      ...v2Brief,
      plannedOperatingSite: { ...v2Brief.plannedOperatingSite, source: 'operator_selected_current_device', description: 'Current device location selected by operator' },
    } as unknown as SmartDeployBriefV2;
    render(<SmartDeployBriefView brief={selectedCurrentDeviceBrief} />);
    expect(screen.getByText('Current device location selected by operator')).toBeTruthy();
    expect(screen.queryByText('Context only; this location was not used as the modeled transmitter site.')).toBeNull();
  });
});