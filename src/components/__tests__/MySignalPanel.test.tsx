/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Activation } from '../../../server/activation';
import type { StationSignalObservation, TxContext } from '../../../server/operationalIntelligence';
import { MySignalPanel } from '../MySignalPanel';

const activation: Activation = { schemaVersion: 2, activationId: 'activation/1', type: 'General', status: 'active', startedAtUtc: '2026-09-05T00:00:00.000Z', actualTimingStatus: 'recorded', createdAtUtc: '2026-09-05T00:00:00.000Z', updatedAtUtc: '2026-09-05T00:00:00.000Z' };
const context: TxContext = { segmentId: 'segment/1', activationId: activation.activationId, startedAtUtc: '2026-09-05T00:01:00.000Z', radioSetupLabel: 'IC-705', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8', frequencyMHz: 14.074, provenance: { radioSetup: 'operator_entered', antenna: 'operator_entered', transmitPowerWatts: 'operator_entered', band: 'wsjtx_application', mode: 'wsjtx_application', frequencyMHz: 'wsjtx_application' } };

const station = { band: '20m', mode: 'FT8', frequencyMHz: 14.074, source: 'wsjtx', observedAtUtc: '2026-09-05T00:01:00.000Z', freshness: 'fresh', status: 'available', limitation: 'WSJT-X application status; not direct-radio proof.' } as const;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('MySignalPanel', () => {
  it('sets an Activation-owned TX Context with field-level WSJT-X provenance', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return response({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] });
      return response({ kind: 'tx_context', status: 'opened', context, diagnostics: [] }, 201);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<MySignalPanel activation={activation} stationState={station as any} />);
    await screen.findByRole('button', { name: 'SET TX CONTEXT' });
    await waitFor(() => expect(screen.getByLabelText('MY SIGNAL BAND')).toHaveValue('20m'));
    expect(screen.getByLabelText('MY SIGNAL MODE')).toHaveValue('FT8');
    expect(screen.getByLabelText('MY SIGNAL FREQUENCY MHz')).toHaveValue(14.074);
    fireEvent.change(screen.getByLabelText('MY SIGNAL RADIO / SETUP'), { target: { value: 'IC-705' } });
    fireEvent.change(screen.getByLabelText('MY SIGNAL ANTENNA'), { target: { value: 'EFHW' } });
    fireEvent.change(screen.getByLabelText('MY SIGNAL POWER W'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'SET TX CONTEXT' }));
    await screen.findByText('TX Context saved. MY SIGNAL capture is ready.');
    const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(String(put?.[0])).toBe('/api/activations/activation%2F1/tx-context');
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ band: '20m', mode: 'FT8', frequencyMHz: 14.074, provenance: { band: 'wsjtx_application', mode: 'wsjtx_application', frequencyMHz: 'wsjtx_application' } });
  });

  it('marks operator-edited station fields as operator-entered', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => !init?.method
      ? response({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] })
      : response({ kind: 'tx_context', status: 'opened', context: { ...context, band: '40m', frequencyMHz: 7.074 }, diagnostics: [] }, 201));
    vi.stubGlobal('fetch', fetcher);
    render(<MySignalPanel activation={activation} stationState={station as any} />);
    await screen.findByRole('button', { name: 'SET TX CONTEXT' });
    fireEvent.change(screen.getByLabelText('MY SIGNAL RADIO / SETUP'), { target: { value: 'G90' } });
    fireEvent.change(screen.getByLabelText('MY SIGNAL ANTENNA'), { target: { value: 'Vertical' } });
    fireEvent.change(screen.getByLabelText('MY SIGNAL POWER W'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('MY SIGNAL BAND'), { target: { value: '40m' } });
    fireEvent.change(screen.getByLabelText('MY SIGNAL FREQUENCY MHz'), { target: { value: '7.074' } });
    fireEvent.click(screen.getByRole('button', { name: 'SET TX CONTEXT' }));
    await screen.findByText('TX Context saved. MY SIGNAL capture is ready.');
    const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body)).provenance).toMatchObject({ band: 'operator_entered', frequencyMHz: 'operator_entered' });
  });

  it('captures and presents bounded evidence with exposure, distance, SNR, and limitations', async () => {
    const evidence: StationSignalObservation = { observationId: 'observation-1', activationId: activation.activationId, txContextSegmentId: context.segmentId, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc: '2026-09-05T00:01:00.000Z', endsAtUtc: '2026-09-05T00:06:00.000Z', status: 'live', matchingReportCount: 3, uniqueReceiverCount: 2, reportsPerMinute: 0.6, uniqueReceiversPerMinute: 0.4, newestMatchingReportAtUtc: '2026-09-05T00:05:00.000Z', distance: { derivation: 'maidenhead_locator_centers', approximate: true, locatedReportCount: 3, nearestKm: 100, medianKm: 420, farthestKm: 800 }, snr: { reportCount: 3, minimumDb: -18, medianDb: -10, maximumDb: -2 }, limitations: ['Observed digital reception does not prove transmission.'] };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? response({ kind: 'station_signal_observation', status: 'captured', observation: evidence, diagnostics: [] }, 201)
      : response({ kind: 'operational_intelligence', txContexts: [context], observations: [], diagnostics: [] }));
    vi.stubGlobal('fetch', fetcher);
    render(<MySignalPanel activation={activation} />);
    fireEvent.click(await screen.findByRole('button', { name: 'CAPTURE MY SIGNAL' }));
    await screen.findByText('3 reports / 2 receivers');
    expect(screen.getByText(/0.60 reports\/min/)).toBeInTheDocument();
    expect(screen.getByText(/100–800 km; median 420 km/)).toBeInTheDocument();
    expect(screen.getByText(/SNR: -18 to -2 dB; median -10 dB/)).toBeInTheDocument();
    expect(screen.getByText('Observed digital reception does not prove transmission.')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith('/api/activations/activation%2F1/tx-context/segment%2F1/observations', { method: 'POST' });
  });

  it('shows exact zero-report meaning without distance or SNR claims', async () => {
    const zero: StationSignalObservation = { observationId: 'zero', activationId: activation.activationId, txContextSegmentId: context.segmentId, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc: '2026-09-05T00:01:00.000Z', endsAtUtc: '2026-09-05T00:06:00.000Z', status: 'retained', matchingReportCount: 0, uniqueReceiverCount: 0, reportsPerMinute: 0, uniqueReceiversPerMinute: 0, newestMatchingReportAtUtc: null, limitations: ['No matching reports observed'] };
    vi.stubGlobal('fetch', vi.fn(async () => response({ kind: 'operational_intelligence', txContexts: [{ ...context, endedAtUtc: '2026-09-05T00:07:00.000Z' }], observations: [zero], diagnostics: [] })));
    render(<MySignalPanel activation={{ ...activation, status: 'completed', endedAtUtc: '2026-09-05T00:07:00.000Z' }} readOnly />);
    expect((await screen.findAllByText('No matching reports observed')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/0.00 reports\/min/)).toBeInTheDocument();
    expect(screen.queryByText(/Approx. distance/)).toBeNull();
    expect(screen.queryByText(/SNR:/)).toBeNull();
    expect(screen.getByText('TX CONTEXT HISTORY (1)')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('presents API limitations without inventing evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ kind: 'operational_intelligence_error', code: 'persistence_unavailable', message: 'Operational intelligence is temporarily unavailable.' }, 503)));
    render(<MySignalPanel activation={activation} />);
    expect(await screen.findByText('Operational intelligence is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/reports \/ /)).toBeNull();
  });
});

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}
