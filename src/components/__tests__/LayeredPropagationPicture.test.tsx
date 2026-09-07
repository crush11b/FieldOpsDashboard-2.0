/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { LayeredPropagationPicture } from '../LayeredPropagationPicture';
import { aggregateQsoEvidence } from '../../../server/qsoEvidence';

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
    const qsoEvidence = aggregateQsoEvidence(Array.from({ length: 6 }, (_, index) => ({ qsoId: `qso-${index}`, qsoDateTimeUtc: `2026-09-04T23:0${index}:00.000Z`, band: '20m', mode: 'FT8' } as any)), '20m', 'FT8');
    render(<LayeredPropagationPicture activation={guided} qsoEvidence={qsoEvidence} evaluatedAtUtc="2026-09-05T00:00:00.000Z" readOnly retained={{}} />);
    expect(await screen.findByRole('region', { name: 'Mission-aware operating guidance' })).toHaveTextContent('qualification / focused');
    expect(screen.getByText(/Progress: 6\/10 QSOs/)).toBeInTheDocument();
    expect(screen.getByText(/30 minutes to 2026-09-05 00:30:00 UTC \(program_rule \/ program_default\)/)).toBeInTheDocument();
    expect(screen.getByText(/Deterministic guidance from named inputs/)).toBeInTheDocument();
  });

  it('recomputes guidance for new QSO evidence without refetching unrelated evidence', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) }));
    vi.stubGlobal('fetch', fetcher);
    const first = aggregateQsoEvidence([{ qsoId: 'one', qsoDateTimeUtc: '2026-09-05T11:59:00.000Z', band: '20m', mode: 'FT8' } as any], '20m', 'FT8');
    const second = aggregateQsoEvidence([{ qsoId: 'two', qsoDateTimeUtc: '2026-09-05T11:59:00.000Z', band: '40m', mode: 'FT8' } as any], '40m', 'FT8');
    const { rerender } = render(<LayeredPropagationPicture activation={{ ...activation, operatingObjective: undefined }} qsoEvidence={first} evaluatedAtUtc="2026-09-05T12:00:00.000Z" retained={{}} />);
    expect(await screen.findByText(/Remain on productive 20m/)).toBeInTheDocument();
    rerender(<LayeredPropagationPicture activation={{ ...activation, operatingObjective: undefined }} qsoEvidence={second} evaluatedAtUtc="2026-09-05T12:00:00.000Z" retained={{}} />);
    expect(await screen.findByText(/Remain on productive 40m/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('updates MY SIGNAL guidance from an owner snapshot without remounting or provider refetches', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) }));
    vi.stubGlobal('fetch', fetcher);
    const snapshot = { txContexts: [{ ...activation, segmentId: 'segment-1', startedAtUtc: '2026-09-05T11:00:00.000Z', endedAtUtc: undefined, band: '20m', mode: 'FT8', radioSetupLabel: 'IC-705', antennaLabel: 'EFHW', transmitPowerWatts: 10, provenance: {} } as any], observations: [{ observationId: 'observation-49', activationId: activation.activationId, txContextSegmentId: 'segment-1', source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc: '2026-09-05T11:03:00.000Z', endsAtUtc: '2026-09-05T11:04:00.000Z', status: 'live', matchingReportCount: 49, uniqueReceiverCount: 49, newestMatchingReportAtUtc: '2026-09-05T11:04:00.000Z', limitations: [] } as any] };
    const emptyEvidence = aggregateQsoEvidence([]);
    const { rerender } = render(<LayeredPropagationPicture activation={{ ...activation, operatingObjective: undefined }} operationalIntelligence={{ txContexts: snapshot.txContexts, observations: [] }} qsoEvidence={emptyEvidence} readOnly retained={{}} />);
    expect(await screen.findByText(/PSKReporter reports may take several minutes/)).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    rerender(<LayeredPropagationPicture activation={{ ...activation, operatingObjective: undefined }} operationalIntelligence={snapshot} retained={{}} />);
    expect(await screen.findByText('49 matching reports from 49 unique receivers.')).toBeInTheDocument();
    const fetchCalls = fetcher.mock.calls as unknown as Array<[unknown]>;
    const unrelatedFetchCount = fetchCalls.filter(([url]) => /mission-forecast|space-weather|live-band-activity/.test(String(url))).length;
    rerender(<LayeredPropagationPicture activation={{ ...activation, operatingObjective: undefined }} operationalIntelligence={snapshot} qsoEvidence={emptyEvidence} readOnly retained={{}} />);
    expect(fetchCalls.filter(([url]) => /mission-forecast|space-weather|live-band-activity/.test(String(url))).length).toBe(unrelatedFetchCount);
  });

  it('renders the 20m field scenario with attributable evidence and one model disagreement', async () => {
    const context = { segmentId: 'segment-field', activationId: activation.activationId, startedAtUtc: '2026-09-05T11:00:00.000Z', band: '20m', mode: 'FT8', radioSetupLabel: 'IC-705', antennaLabel: 'EFHW', transmitPowerWatts: 10, provenance: {} } as any;
    const qsoEvidence = aggregateQsoEvidence([
      ...Array.from({ length: 9 }, (_, index) => ({ qsoId: `20m-${index}`, qsoDateTimeUtc: `2026-09-05T11:${String(index).padStart(2, '0')}:00.000Z`, band: '20m', mode: 'FT8' } as any)),
      ...Array.from({ length: 2 }, (_, index) => ({ qsoId: `15m-${index}`, qsoDateTimeUtc: `2026-09-05T10:${String(index).padStart(2, '0')}:00.000Z`, band: '15m', mode: 'FT8' } as any)),
    ], '20m', 'FT8');
    const snapshot = { txContexts: [context], observations: [{ observationId: 'observation-field', activationId: activation.activationId, txContextSegmentId: context.segmentId, source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc: '2026-09-05T11:03:00.000Z', endsAtUtc: '2026-09-05T11:07:00.000Z', status: 'live', matchingReportCount: 49, uniqueReceiverCount: 49, newestMatchingReportAtUtc: '2026-09-05T11:07:00.000Z', limitations: [] } as any] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) })));
    render(<LayeredPropagationPicture activation={{ ...activation, operatingObjective: undefined }} qsoEvidence={qsoEvidence} operationalIntelligence={snapshot} retained={{ modeled: { summary: { strongestBandBySample: [{ band: '15m' }] } }, modeledStatus: 'complete' }} />);
    const guidance = await screen.findByRole('region', { name: 'Mission-aware operating guidance' });
    expect(guidance).toHaveTextContent('Remain on productive 20m');
    expect(guidance).toHaveTextContent('Progress: 11 QSOs');
    expect(guidance).toHaveTextContent('Current MY SIGNAL shows 49 matching reports');
    expect(guidance).toHaveTextContent('Retained modeled propagation favors 15m');
    expect(guidance.textContent?.match(/Retained modeled propagation favors 15m/g)).toHaveLength(1);
    expect(guidance).toHaveTextContent('activation_qso_results');
    expect(guidance).toHaveTextContent('station_signal');
    expect(guidance).toHaveTextContent('modeled');
  });

  it('renders retrospective station relationships without embedded terminal punctuation', async () => {
    const context = { segmentId: 'segment-retro', activationId: activation.activationId, startedAtUtc: '2026-09-05T00:01:00.000Z', endedAtUtc: '2026-09-05T00:10:00.000Z', band: '20m', mode: 'FT8', radioSetupLabel: 'IC-705', antennaLabel: 'EFHW', transmitPowerWatts: 10, provenance: {} } as any;
    const observation = { ...minimalObservation('retro', 'retained', 49), txContextSegmentId: context.segmentId, uniqueReceiverCount: 49 } as any;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) })));
    render(<LayeredPropagationPicture activation={activation} readOnly retrospective operationalIntelligence={{ txContexts: [context], observations: [observation] }} retained={{}} />);
    expect(await screen.findByText('MY SIGNAL has 49 matching reports from 49 unique receivers for 20m / FT8 / TX Context segment-retro; this is bounded station-specific outbound evidence.')).toBeInTheDocument();
    expect(screen.queryByText(/reports\. for|reports\.\.|evidence\.\./)).toBeNull();
  });

  it('uses completion time for stable retrospective assessment and reports the retained scenario', async () => {
    const context = { segmentId: 'segment-retro-scenario', activationId: activation.activationId, startedAtUtc: '2026-09-05T00:01:00.000Z', endedAtUtc: '2026-09-05T01:00:00.000Z', band: '20m', mode: 'FT8', radioSetupLabel: 'IC-705', antennaLabel: 'EFHW', transmitPowerWatts: 10, provenance: {} } as any;
    const observation = { ...minimalObservation('scenario', 'retained', 49), txContextSegmentId: context.segmentId, uniqueReceiverCount: 49 } as any;
    const qsoEvidence = aggregateQsoEvidence([...Array.from({ length: 9 }, (_, index) => ({ qsoId: `20-${index}`, qsoDateTimeUtc: `2026-09-05T00:${String(index).padStart(2, '0')}:00.000Z`, band: '20m', mode: 'FT8' } as any)), ...Array.from({ length: 2 }, (_, index) => ({ qsoId: `15-${index}`, qsoDateTimeUtc: `2026-09-05T00:${String(index + 20).padStart(2, '0')}:00.000Z`, band: '15m', mode: 'FT8' } as any))], '20m', 'FT8');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) })));
    const { rerender } = render(<LayeredPropagationPicture activation={activation} readOnly retrospective evaluatedAtUtc="2026-09-08T01:00:00.000Z" operationalIntelligence={{ txContexts: [context], observations: [observation] }} qsoEvidence={qsoEvidence} retained={{ modeled: { summary: { strongestBandBySample: [{ band: '15m' }] } }, modeledStatus: 'retained' }} />);
    const guidance = await screen.findByRole('region', { name: 'Mission-aware operating guidance' });
    expect(guidance).toHaveTextContent('END-OF-ACTIVATION ASSESSMENT');
    expect(guidance).toHaveTextContent('20m produced 9 of 11 QSOs; MY SIGNAL retained 49 matching reports from 49 unique receivers on 20m/FT8; the retained model favored 15m, while 15m produced 2 QSOs.');
    expect(guidance).toHaveTextContent('Evaluated 2026-09-05 01:00:00 UTC');
    expect(guidance).toHaveTextContent('WHAT WOULD HAVE TRIGGERED REASSESSMENT');
    expect(guidance.textContent).not.toMatch(/\b(reassess|remain on|change band|wait|capture|set a TX Context)\b/i);
    const first = guidance.textContent;
    rerender(<LayeredPropagationPicture activation={activation} readOnly retrospective evaluatedAtUtc="2026-09-20T01:00:00.000Z" operationalIntelligence={{ txContexts: [context], observations: [observation] }} qsoEvidence={qsoEvidence} retained={{ modeled: { summary: { strongestBandBySample: [{ band: '15m' }] } }, modeledStatus: 'retained' }} />);
    expect((await screen.findByRole('region', { name: 'Mission-aware operating guidance' })).textContent).toBe(first);
  });

  it('renders unavailable station evidence when completed review has neither contexts nor observations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'operational_intelligence', txContexts: [], observations: [], diagnostics: [] }) })));
    render(<LayeredPropagationPicture activation={activation} readOnly retrospective retained={{}} />);
    expect(await screen.findByText('Station-specific evidence is unavailable in this retained review.')).toBeInTheDocument();
  });
});

function minimalObservation(id: string, status: string, matchingReportCount: number) { return { observationId: id, activationId: activation.activationId, txContextSegmentId: 'segment-retro', source: 'pskreporter', sourceSemantics: 'observed_digital_reception_report', startsAtUtc: '2026-09-05T00:01:00.000Z', endsAtUtc: '2026-09-05T00:05:00.000Z', status, matchingReportCount, uniqueReceiverCount: matchingReportCount, reportsPerMinute: matchingReportCount, uniqueReceiversPerMinute: matchingReportCount, newestMatchingReportAtUtc: '2026-09-05T00:04:00.000Z', limitations: [] }; }
