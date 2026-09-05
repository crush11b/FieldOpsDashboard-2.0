/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LayeredPropagationPicture } from '../LayeredPropagationPicture';

const activation = { schemaVersion: 2, activationId: 'activation-1', type: 'General', status: 'completed', startedAtUtc: '2026-09-05T00:00:00.000Z', endedAtUtc: '2026-09-05T01:00:00.000Z', actualTimingStatus: 'recorded', createdAtUtc: '2026-09-05T00:00:00.000Z', updatedAtUtc: '2026-09-05T01:00:00.000Z' } as any;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LayeredPropagationPicture', () => {
  it('renders retained review layers and does not request live band activity', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) }));
    vi.stubGlobal('fetch', fetcher);
    render(<LayeredPropagationPicture activation={activation} readOnly retained={{ modeled: { summary: { strongestBandBySample: [{ band: '20m' }] } }, modeledStatus: 'retained', modeledAtUtc: '2026-09-05T00:00:00.000Z', forecast: { provider: { name: 'Open-Meteo' }, retrievedAtUtc: '2026-09-04T23:00:00.000Z' }, generalObserved: { status: 'stale', reports: [], observationWindow: { startsAt: '2026-09-04T22:00:00.000Z', endsAt: '2026-09-04T22:15:00.000Z' }, provenance: { sourceName: 'PSKReporter' }, limitation: 'Retained planning evidence.' } }} />);
    expect(await screen.findByText('MODELED PROPAGATION')).toBeInTheDocument();
    expect(screen.getByText('ENVIRONMENT')).toBeInTheDocument();
    expect(screen.getByText('GENERAL OBSERVED RF')).toBeInTheDocument();
    expect(screen.getByText('MY SIGNAL')).toBeInTheDocument();
    expect(screen.getByText(/No universal best-band score/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('live-band-activity'))).toBe(false);
  });

  it('degrades safely when a legacy brief has no V2 evidence sections', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) })));
    render(<LayeredPropagationPicture activation={{ ...activation, status: 'active' }} brief={{ briefId: 'legacy-brief' } as any} readOnly />);
    expect(await screen.findByText('Modeled propagation evidence is unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Environmental evidence is unavailable.')).toBeInTheDocument();
  });

  it('renders disclosed deterministic guidance inputs and limitations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) })));
    const guided = { ...activation, operatingObjective: { goal: 'secure_activation', label: 'Qualify POTA', requiredQsoCount: 10, thresholdProvenance: 'program_default', deadlineUtc: '2026-09-05T00:30:00.000Z', deadlineBasis: 'program_rule', deadlineProvenance: 'program_default' } } as any;
    render(<LayeredPropagationPicture activation={guided} qsoCount={6} evaluatedAtUtc="2026-09-05T00:00:00.000Z" readOnly retained={{}} />);
    expect(await screen.findByRole('region', { name: 'Mission-aware operating guidance' })).toHaveTextContent('qualification / focused');
    expect(screen.getByText(/Progress: 6\/10 QSOs/)).toBeInTheDocument();
    expect(screen.getByText(/30 minutes to 2026-09-05T00:30:00.000Z \(program_rule \/ program_default\)/)).toBeInTheDocument();
    expect(screen.getByText(/not a prediction, guarantee, command/)).toBeInTheDocument();
  });
});
