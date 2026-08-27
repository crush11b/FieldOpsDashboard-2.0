/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivationFoundationPanel } from '../ActivationFoundationPanel';

const brief = {
  briefId: 'brief-start',
  activation: { program: 'POTA', reference: 'K-1234', displayName: 'Test Park' },
} as any;
const plannedActivation = {
  activationId: 'activation-start',
  briefId: 'brief-start',
  type: 'POTA',
  reference: 'K-1234',
  title: 'Test Park',
  status: 'planned',
  createdAtUtc: '2026-08-26T10:00:00.000Z',
  updatedAtUtc: '2026-08-26T10:00:00.000Z',
  plannedLocation: { gridSquare: 'FM18', latitude: 38, longitude: -78 },
  missionWindow: { start: '2026-08-26T12:00:00.000Z', end: '2026-08-26T14:00:00.000Z' },
} as any;
const activeActivation = { ...plannedActivation, status: 'active', startedAtUtc: '2026-08-26T12:00:00.000Z' };

afterEach(() => vi.unstubAllGlobals());

describe('ActivationFoundationPanel', () => {
  it('starts a planned activation, exposes the logger, and keeps IDs in technical details', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/status')) return { ok: true, json: async () => ({ kind: 'activation', activation: activeActivation }) };
      if (String(input).includes('/from-brief')) return { ok: true, json: async () => ({ kind: 'activation', activation: plannedActivation }) };
      if (String(input).includes('/qsos')) return { ok: true, json: async () => ({ qsos: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    const onActivationChange = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={plannedActivation} showReview={false} onActivationChange={onActivationChange} />);

    expect(screen.getByRole('button', { name: 'START ACTIVATION' })).toBeTruthy();
    expect(screen.getByText('Technical Details').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'START ACTIVATION' }));
    await waitFor(() => expect(screen.getByText('ACTIVE · Started 2026-08-26 12:00:00 UTC')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'QSO LOG' })).toBeTruthy();
    expect(onActivationChange).toHaveBeenCalledWith(activeActivation);
    fireEvent.click(screen.getByText('Technical Details'));
    expect(screen.getByText('activation-start')).toBeTruthy();
  });

  it('shows manual current station state in OPERATE and clears it when activation ends', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/status')) return { ok: true, json: async () => ({ kind: 'activation', activation: { ...activeActivation, status: 'completed' } }) };
      if (String(input).includes('/qsos')) return { ok: true, json: async () => ({ qsos: [] }) };
      return { ok: true, json: async () => ({ kind: 'activation', activation: { ...activeActivation, status: 'completed' } }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await waitFor(() => expect(screen.getByText('20m · SSB')).toBeTruthy());
    expect(screen.getByText('Source: Manual operating context · Status: Current')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'END ACTIVATION' }));
    await waitFor(() => expect(screen.getByText('Current station state unavailable.')).toBeTruthy());
  });

  it('reconstructs current station state for a new Activation without leaking the prior context', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/qsos') ? { ok: true, json: async () => ({ qsos: [] }) } : { ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await waitFor(() => expect(screen.getByText('20m · SSB')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('FREQUENCY MHz'), { target: { value: '14.260' } });
    expect(screen.getByText('14.26 MHz')).toBeTruthy();
    const nextActivation = { ...activeActivation, activationId: 'activation-next' };
    rerender(<ActivationFoundationPanel brief={brief} initialActivation={nextActivation} showReview={false} />);
    await waitFor(() => expect(screen.getByText('20m · SSB')).toBeTruthy());
    expect(screen.queryByText('14.26 MHz')).toBeNull();
  });

  it('prefers fresh WSJT-X state in the production OPERATE path', async () => {
    const wsjtxState = { band: '20m', frequencyMHz: 14.074, mode: 'FT8', source: 'wsjtx', observedAtUtc: '2026-08-27T12:00:00.000Z', freshness: 'fresh', status: 'available', limitation: 'WSJT-X application status; not CAT, direct radio, or RF confirmation.' };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/wsjtx/current')
      ? { ok: true, json: async () => ({ status: 'available', state: wsjtxState }) }
      : { ok: true, json: async () => ({ qsos: [] }) });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await waitFor(() => expect(screen.getByText('Source: WSJT-X · Live / fresh')).toBeTruthy());
    expect(screen.getByText('20m · FT8')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith('/api/wsjtx/current', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
