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
    expect(note.previousElementSibling?.textContent).toBe('2026-08-26 23:08:34.065Z');
  });
});

afterEach(() => vi.restoreAllMocks());