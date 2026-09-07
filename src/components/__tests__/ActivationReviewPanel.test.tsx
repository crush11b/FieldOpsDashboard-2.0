/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivationReviewPanel } from '../ActivationReviewPanel';

const activation = { activationId: 'activation-1', type: 'General', status: 'active', createdAtUtc: '2026-08-25T10:00:00.000Z', updatedAtUtc: '2026-08-25T10:00:00.000Z' } as any;
const review = { kind: 'activation_review', reviewVersion: 1, reviewedAtUtc: '2026-08-25T13:00:00.000Z', activation, plan: { state: 'unavailable', briefId: null, type: 'General', reference: null, displayName: null, plannedLocation: null, missionWindow: null, bands: [], modes: [], powerWatts: null, sequence: null, briefAssociation: 'unavailable' }, environment: { forecast: { state: 'unavailable', record: null }, alerts: { state: 'unavailable', message: 'No retained alert evidence is available for this Activation.' }, spaceWeather: { state: 'unavailable', record: null } }, propagation: { state: 'unavailable', modeled: null, observedRf: null, source: 'No retained SmartDeploy brief.' }, results: { state: 'unknown', total: 0, byBand: {}, byMode: {}, firstQsoUtc: null, lastQsoUtc: null, uniqueCallsigns: 0, manual: 0, adifImported: 0, qsos: [] }, notes: { state: 'unavailable', collection: null }, findings: ['No QSOs logged.', 'Results are provisional while the Activation is active.'], diagnostics: [] } as any;

describe('ActivationReviewPanel', () => {
  it('renders a concise completion gate for an active activation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => review }));
    render(<ActivationReviewPanel activation={activation} />);
    expect(await screen.findByText('ACTIVATION REVIEW')).toBeTruthy();
    expect(screen.getByText('Review available after activation is completed.')).toBeTruthy();
    expect(screen.queryByText('No QSOs logged.')).toBeNull();
    expect(screen.queryByText('BANDS / MODES')).toBeNull();
  });

  it('separates completed review note timestamps from note text', async () => {
    const completedActivation = { ...activation, status: 'completed' };
    const completedReview = { ...review, activation: completedActivation, notes: { state: 'retained', collection: { updatedAtUtc: '2026-08-26T23:08:34.065Z', notes: [{ noteId: 'note-1', recordedAtUtc: '2026-08-26T23:08:34.065Z', text: 'Test Note' }] } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => completedReview }));
    render(<ActivationReviewPanel activation={completedActivation} />);
    const note = (await screen.findAllByText('Test Note')).find(element => element.tagName === 'SPAN');
    expect(note).toBeTruthy();
    expect(note.tagName).toBe('SPAN');
    expect(note.previousElementSibling?.textContent).toBe('2026-08-26 23:08:34 UTC');
  });

  it('keeps planned and actual timing distinct and uses truthful QSO source labels', async () => {
    const completedActivation = { ...activation, status: 'completed', startedAtUtc: '2026-08-25T12:01:02.000Z', endedAtUtc: '2026-08-25T12:59:03.000Z' };
    const completedReview = { ...review, activation: completedActivation, plan: { ...review.plan, missionWindow: { start: '2026-08-25T12:00:00.000Z', end: '2026-08-25T13:00:00.000Z' } }, results: { ...review.results, total: 3, inWindowTotal: 3, outsideWindowTotal: 0, qsos: [
      { qsoId: 'manual', qsoDateTimeUtc: '2026-08-25T12:10:00.000Z', callsign: 'W1AW', band: '20m', mode: 'SSB', source: 'manual' },
      { qsoId: 'direct', qsoDateTimeUtc: '2026-08-25T12:20:00.000Z', callsign: 'K1ABC', band: '20m', mode: 'FT8', source: 'wsjtx' },
      { qsoId: 'fallback', qsoDateTimeUtc: '2026-08-25T12:30:00.000Z', callsign: 'N0CALL', band: '15m', mode: 'FT8', source: 'adif_import' },
    ] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => completedReview }));
    render(<ActivationReviewPanel activation={completedActivation} />);
    const panel = await screen.findByRole('region', { name: 'Activation Review' });
    expect(panel).toHaveTextContent('MISSION WINDOW');
    expect(panel).toHaveTextContent('ACTUAL ACTIVATION WINDOW');
    expect(panel).toHaveTextContent('OUTSIDE PLANNED WINDOW');
    expect(panel).toHaveTextContent('WSJT-X automatic import');
    expect(panel).toHaveTextContent('WSJT-X ADIF log');
    expect(panel).not.toHaveTextContent('ADIF import');
    expect(panel).toHaveTextContent('2026-08-25 12:10:00 UTC');
    expect(panel).not.toHaveTextContent('2026-08-25T12:10:00.000Z');
  });

  it('does not offer TX Context creation in completed review when retained MY SIGNAL evidence is absent', async () => {
    const completedActivation = { ...activation, status: 'completed' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...review, activation: completedActivation }) }));
    render(<ActivationReviewPanel activation={completedActivation} />);
    const panel = await screen.findByRole('region', { name: 'Activation Review' });
    expect(panel).not.toHaveTextContent('SET TX CONTEXT');
  });

  it.each([
    ['program_default', { goal: 'secure_activation', label: 'Qualify POTA', requiredQsoCount: 10, thresholdProvenance: 'program_default' }],
    ['operator_entered', { goal: 'maximize_contacts', label: 'Field objective' }],
    ['explicitly_absent', undefined],
    [undefined, { goal: 'secure_activation', label: 'Legacy objective' }],
  ])('renders %s objective provenance in completed review', async (selection, operatingObjective) => {
    const completedActivation = { ...activation, status: 'completed', objectiveSelection: selection, operatingObjective };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...review, activation: completedActivation }) }));
    render(<ActivationReviewPanel activation={completedActivation} />);
    expect(await screen.findByText('ACTIVATION REVIEW')).toBeTruthy();
    expect(screen.getByText(selection || 'Unavailable (legacy record)')).toBeInTheDocument();
    expect(screen.getByText(operatingObjective ? `${operatingObjective.label} / ${operatingObjective.goal}` : 'No explicit objective')).toBeInTheDocument();
  });
});

afterEach(() => vi.restoreAllMocks());
