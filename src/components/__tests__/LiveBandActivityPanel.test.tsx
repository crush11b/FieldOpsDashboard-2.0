/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveBandActivityPanel } from '../LiveBandActivityPanel';
import { OBSERVED_RF_BANDS } from '../../propagation/observedRf';

const activity = (status: 'live' | 'cached' | 'stale' | 'unavailable', reports = 0) => ({
  source: { id: 'pskreporter-via-mqtt', name: 'PSKReporter reports via mqtt.pskreporter.info' }, status, observedAtUtc: '2026-08-29T12:00:00.000Z', newestObservedAtUtc: reports ? '2026-08-29T11:59:00.000Z' : null, collectedAtUtc: '2026-08-29T12:00:00.000Z', observationWindow: { startsAt: '2026-08-29T11:45:00.000Z', endsAt: '2026-08-29T12:00:00.000Z' }, windowMinutes: 15, operatingGrid4: 'FM17', limitation: 'Recent digital reception reports only; not a propagation prediction or guarantee of station success.', bands: OBSERVED_RF_BANDS.map(band => ({ band, reportCount: band === '20m' ? reports : 0, newestObservedAtUtc: band === '20m' && reports ? '2026-08-29T11:59:00.000Z' : null, inboundCount: band === '20m' ? reports : 0, outboundCount: 0, localCount: 0 })),
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('LiveBandActivityPanel', () => {
  it('renders live reports and preserves zero-report rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => activity('live', 3) })));
    render(<LiveBandActivityPanel active />);
    expect(await screen.findByText('LIVE · 3 REPORTS')).toBeInTheDocument();
    expect(screen.getByTestId('live-band-row-20m')).toHaveTextContent('3 reports');
    expect(screen.getByTestId('live-band-row-40m')).toHaveTextContent('0 reports');
    expect(screen.getByText(/not a propagation prediction/i)).toBeInTheDocument();
  });

  it('renders source status without converting unavailable into zero activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => activity('unavailable') })));
    render(<LiveBandActivityPanel active />);
    expect(await screen.findByText('UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText(/band counts are not asserted/i)).toBeInTheDocument();
    expect(screen.queryByTestId('live-band-row-20m')).not.toBeInTheDocument();
  });

  it('keeps the error state separate from a zero-report response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<LiveBandActivityPanel active />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Live Band Activity request failed');
    expect(screen.queryByTestId('live-band-row-20m')).not.toBeInTheDocument();
  });

  it('keeps retained reports visible and labels an in-flight refresh', async () => {
    vi.useFakeTimers();
    let resolveRefresh!: (response: unknown) => void;
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => activity('cached', 450) })
      .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    render(<LiveBandActivityPanel active />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('CACHED')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole('status')).toHaveTextContent('retained observation');
    expect(screen.getByTestId('live-band-row-20m')).toHaveTextContent('450 reports');
    await act(async () => { resolveRefresh({ ok: true, json: async () => activity('live', 715) }); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('LIVE · 715 REPORTS')).toBeInTheDocument();
    expect(screen.getByTestId('live-band-row-20m')).toHaveTextContent('715 reports');
  });

  it('does not refetch when an unrelated parent render occurs', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => activity('live', 1) }));
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(<LiveBandActivityPanel active />);
    await screen.findByText('LIVE · 1 REPORTS');
    rerender(<LiveBandActivityPanel active />);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
