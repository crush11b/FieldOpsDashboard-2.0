/* @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SmartDeployBriefV2 } from '../../../server/smartDeployBrief';
import { ActivationNotesPanel } from '../ActivationNotesPanel';

const baseBrief = (briefId: string) => ({
  schemaVersion: 2,
  briefId,
  activation: { program: 'POTA', reference: briefId === 'brief-2' ? 'US-0183' : 'US-0182', displayName: briefId === 'brief-2' ? 'Second Park' : 'Test Park' },
} as unknown as SmartDeployBriefV2);

const collection = (briefId = 'brief-1', notes: any[] = []) => ({
  schemaVersion: 1,
  collectionId: `collection-${briefId}`,
  briefId,
  activation: { program: 'POTA', reference: briefId === 'brief-2' ? 'US-0183' : 'US-0182', displayName: briefId === 'brief-2' ? 'Second Park' : 'Test Park' },
  createdAtUtc: '2026-08-19T11:00:00.000Z',
  updatedAtUtc: '2026-08-19T12:05:00.000Z',
  notes,
});

function collectionResponse(value: any, status: 'created' | 'existing' | 'updated' = 'existing') {
  return { ok: true, status: 200, json: async () => ({ kind: 'activation_notes_collection', status, collection: value }) };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ActivationNotesPanel', () => {
  it('shows the empty state for a brief with no collection and loads persisted notes chronologically', async () => {
    const persisted = collection('brief-1', [
      { noteId: 'note-1', recordedAtUtc: '2026-08-19T11:02:00.000Z', kind: 'quick', text: 'On air' },
      { noteId: 'note-2', recordedAtUtc: '2026-08-19T11:04:00.000Z', kind: 'text', text: 'Conditions changed' },
    ]);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/brief/brief-1')
      ? { ok: false, status: 404, json: async () => ({ kind: 'activation_notes_error', code: 'not_found' }) }
      : collectionResponse(persisted));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<ActivationNotesPanel brief={baseBrief('brief-1')} />);
    await waitFor(() => expect(screen.getByText(/No notes yet/)).toBeTruthy());
    vi.stubGlobal('fetch', vi.fn(async () => collectionResponse(persisted)));
    view.rerender(<ActivationNotesPanel brief={baseBrief('brief-2')} />);
    await waitFor(() => expect(screen.getAllByText('Conditions changed')).toHaveLength(2));
    expect(screen.getByTitle('2026-08-19T11:02:00.000Z')).toHaveTextContent('11:02Z');
    expect(screen.getByText(/2 notes/)).toBeTruthy();
  });

  it('creates on the first note, appends free text, clears after success, and preserves it after failure', async () => {
    let failAppend = true;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/brief/')) return { ok: false, status: 404, json: async () => ({}) };
      if (String(input) === '/api/activation-notes') return collectionResponse(collection(), 'created');
      if (failAppend) return { ok: false, status: 503, json: async () => ({ kind: 'activation_notes_error', message: 'Service unavailable.' }) };
      return collectionResponse(collection('brief-1', [{ noteId: 'note-1', recordedAtUtc: '2026-08-19T12:00:00.000Z', kind: 'text', text: 'Field observation' }]), 'updated');
    });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationNotesPanel brief={baseBrief('brief-1')} />);
    await waitFor(() => expect(screen.getByText(/No notes yet/)).toBeTruthy());
    const input = screen.getByLabelText('Field note');
    fireEvent.change(input, { target: { value: 'Field observation' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD NOTE' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable.'));
    expect(input).toHaveValue('Field observation');
    failAppend = false;
    fireEvent.click(screen.getByRole('button', { name: 'ADD NOTE' }));
    await waitFor(() => expect(screen.getByText('Field observation')).toBeTruthy());
    expect(input).toHaveValue('');
    expect(fetcher).toHaveBeenCalledWith('/api/activation-notes', expect.objectContaining({ body: JSON.stringify({ briefId: 'brief-1' }) }));
  });

  it('supports every fixed quick note and disables controls while saving', async () => {
    let resolveAppend!: (value: unknown) => void;
    const persisted = collection('brief-1');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/brief/')) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      if (String(input) === '/api/activation-notes') return Promise.resolve(collectionResponse(persisted, 'created'));
      return new Promise(resolve => { resolveAppend = resolve; });
    }));
    render(<ActivationNotesPanel brief={baseBrief('brief-1')} />);
    await waitFor(() => expect(screen.getByText(/No notes yet/)).toBeTruthy());
    for (const label of ['On air', 'Band/mode changed', 'Conditions changed', 'Equipment adjusted', 'Off air']) expect(screen.getByRole('button', { name: label })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'On air' }));
    expect(screen.getByRole('button', { name: 'On air' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'SAVING...' })).toBeDisabled();
    await waitFor(() => expect(resolveAppend).toEqual(expect.any(Function)));
    resolveAppend(collectionResponse(collection('brief-1', [{ noteId: 'note-1', recordedAtUtc: '2026-08-19T12:00:00.000Z', kind: 'quick', text: 'On air' }]), 'updated'));
    await waitFor(() => expect(screen.getByText('On air')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Off air' })).toBeEnabled();
  });

  it('validates blank and oversized text and does not send a request', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationNotesPanel brief={baseBrief('brief-1')} />);
    await waitFor(() => expect(screen.getByText(/No notes yet/)).toBeTruthy());
    const input = screen.getByLabelText('Field note');
    expect(screen.getByRole('button', { name: 'ADD NOTE' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'x'.repeat(501) } });
    expect(screen.getByText('501/500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ADD NOTE' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/limited to 500/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries a failed load and ignores a stale response after the brief changes', async () => {
    let resolveFirst!: (value: unknown) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/brief/brief-1')) return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve(collectionResponse(collection('brief-2', [{ noteId: 'note-2', recordedAtUtc: '2026-08-19T12:00:00.000Z', kind: 'quick', text: 'Second brief note' }])));
    });
    vi.stubGlobal('fetch', fetcher);
    const view = render(<ActivationNotesPanel brief={baseBrief('brief-1')} />);
    view.rerender(<ActivationNotesPanel brief={baseBrief('brief-2')} />);
    await waitFor(() => expect(screen.getByText('Second brief note')).toBeTruthy());
    resolveFirst({ ok: true, status: 200, json: async () => collectionResponse(collection('brief-1', [{ noteId: 'old', recordedAtUtc: '2026-08-19T12:00:00.000Z', kind: 'text', text: 'Old brief note' }])) });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText('Old brief note')).toBeNull();
    expect(screen.getByText('Second brief note')).toBeTruthy();
  });

  it('reports a brief that is no longer retained during first-note creation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/brief/')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: false, status: 404, json: async () => ({ kind: 'activation_notes_error', code: 'brief_not_found', message: 'The SmartDeploy brief was not found.' }) };
    }));
    render(<ActivationNotesPanel brief={baseBrief('brief-1')} />);
    await waitFor(() => expect(screen.getByText(/No notes yet/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Field note'), { target: { value: 'Will not persist' } });
    fireEvent.click(screen.getByRole('button', { name: 'ADD NOTE' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no longer retained/i));
    expect(screen.getByLabelText('Field note')).toHaveValue('Will not persist');
  });
});