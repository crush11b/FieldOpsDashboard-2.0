/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveBandActivityPanel } from '../LiveBandActivityPanel';
import { OBSERVED_RF_BANDS } from '../../propagation/observedRf';

const activity = (status: 'live' | 'cached' | 'stale' | 'unavailable', reports = 0) => ({
  source: { id: 'pskreporter-via-mqtt', name: 'PSKReporter reports via mqtt.pskreporter.info' }, status, observedAtUtc: '2026-08-29T12:00:00.000Z', newestObservedAtUtc: reports ? '2026-08-29T11:59:00.000Z' : null, collectedAtUtc: '2026-08-29T12:00:00.000Z', observationWindow: { startsAt: '2026-08-29T11:45:00.000Z', endsAt: '2026-08-29T12:00:00.000Z' }, windowMinutes: 15, operatingGrid4: 'FM17', limitation: 'Recent digital reception reports only; not a propagation prediction or guarantee of station success.', bands: OBSERVED_RF_BANDS.map(band => ({ band, reportCount: band === '20m' ? reports : 0, newestObservedAtUtc: band === '20m' && reports ? '2026-08-29T11:59:00.000Z' : null, inboundCount: band === '20m' ? reports : 0, outboundCount: 0, localCount: 0 })),
});

afterEach(() => vi.restoreAllMocks());

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
});
