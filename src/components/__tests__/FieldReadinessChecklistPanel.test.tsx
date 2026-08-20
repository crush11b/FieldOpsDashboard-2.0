/* @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SmartDeployBriefV2 } from '../../../server/smartDeployBrief';
import { FieldReadinessChecklistPanel } from '../FieldReadinessChecklistPanel';

const brief = (briefId: string) => ({ schemaVersion: 2, briefId, activation: { program: 'POTA', reference: briefId === 'brief-2' ? 'US-0183' : 'US-0182' } } as unknown as SmartDeployBriefV2);

function checklist(briefId = 'brief-1', completed = false, text = 'Server-returned setup wording.') {
  return {
    schemaVersion: 1,
    templateId: 'smartdeploy-field-readiness',
    templateVersion: 1,
    checklistId: `checklist-${briefId}`,
    briefId,
    createdAtUtc: '2026-08-19T11:00:00.000Z',
    updatedAtUtc: '2026-08-19T12:05:00.000Z',
    sections: [
      { sectionId: 'field_setup', title: 'FIELD SETUP', items: [{ itemId: 'site_access', text, completed }, { itemId: 'work_area', text: 'Second server item.', completed: false }] },
      { sectionId: 'operating_readiness', title: 'OPERATING READINESS', items: [{ itemId: 'frequency_mode', text: 'Operating server item.', completed: false }] },
    ],
  };
}

function response(payload: unknown, status = 200, ok = status >= 200 && status < 300) {
  return { ok, status, json: async () => payload };
}

function collection(value: any, status: 'created' | 'existing' | 'updated' | 'reset' = 'existing') {
  return response({ kind: 'field_readiness_checklist', status, checklist: value });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('FieldReadinessChecklistPanel', () => {
  it('shows loading and treats a missing checklist as not started without creating it', async () => {
    let resolveLoad!: (value: unknown) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).includes('/brief/') ? new Promise(resolve => { resolveLoad = resolve; }) : Promise.resolve(response({}))) as any;
    vi.stubGlobal('fetch', fetcher);
    render(<FieldReadinessChecklistPanel brief={brief('brief-1')} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    resolveLoad(response({ kind: 'field_readiness_checklist_error', code: 'not_found', message: 'not found' }, 404, false));
    await waitFor(() => expect(screen.getByRole('button', { name: 'START CHECKLIST' })).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalledWith('/api/field-checklists', expect.anything());
  });

  it('starts by the displayed brief ID and renders server sections, wording, and progress', async () => {
    const persisted = checklist();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/brief/')) return response({}, 404, false);
      expect(String(input)).toBe('/api/field-checklists');
      expect(init?.body).toBe(JSON.stringify({ briefId: 'brief-1' }));
      return collection(persisted, 'created');
    });
    vi.stubGlobal('fetch', fetcher);
    render(<FieldReadinessChecklistPanel brief={brief('brief-1')} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'START CHECKLIST' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'START CHECKLIST' }));
    await waitFor(() => expect(screen.getByText('Server-returned setup wording.')).toBeTruthy());
    expect(screen.getByText('0 of 3 complete')).toBeTruthy();
    expect(screen.getByText('FIELD SETUP')).toBeTruthy();
    expect(screen.getByText('OPERATING READINESS')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith('/api/field-checklists', expect.objectContaining({ method: 'POST' }));
  });

  it('persists checking and unchecking, locks duplicate mutations, and does not fabricate failed saves', async () => {
    const persisted = checklist();
    let resolveSave!: (value: unknown) => void;
    let failSave = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/brief/')) return response({}, 404, false);
      if (String(input) === '/api/field-checklists') return collection(persisted, 'created');
      if (failSave) return response({ kind: 'field_readiness_checklist_error', code: 'persistence_unavailable', message: 'unavailable' }, 503, false);
      if (init?.body === JSON.stringify({ completed: true })) return new Promise(resolve => { resolveSave = resolve; });
      return collection(checklist('brief-1', false), 'updated');
    });
    vi.stubGlobal('fetch', fetcher);
    render(<FieldReadinessChecklistPanel brief={brief('brief-1')} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'START CHECKLIST' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'START CHECKLIST' }));
    await waitFor(() => expect(screen.getByLabelText('Server-returned setup wording.')).toBeTruthy());
    const item = screen.getByLabelText('Server-returned setup wording.') as HTMLInputElement;
    fireEvent.click(item);
    expect(item).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    fireEvent.click(item);
    expect(fetcher).toHaveBeenCalledTimes(3);
    resolveSave(collection(checklist('brief-1', true), 'updated'));
    await waitFor(() => expect(item).toBeChecked());
    failSave = true;
    fireEvent.click(item);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not save or load/i));
    expect(screen.getByLabelText('Server-returned setup wording.')).toBeChecked();
  });

  it('requires reset confirmation and uses the persisted reset result', async () => {
    const persisted = checklist('brief-1', true);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/brief/')) return collection(persisted);
      if (String(input).endsWith('/reset')) return collection(checklist('brief-1', false), 'reset');
      return response({});
    });
    vi.stubGlobal('fetch', fetcher);
    render(<FieldReadinessChecklistPanel brief={brief('brief-1')} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'RESET CHECKLIST' })).toBeTruthy());
    expect(screen.getByText('1 of 3 complete')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'RESET CHECKLIST' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('/reset'), expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM RESET' }));
    await waitFor(() => expect(screen.getByText('0 of 3 complete')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledWith('/api/field-checklists/checklist-brief-1/reset', expect.objectContaining({ method: 'POST', body: '{}' }));
  });

  it('keeps the checklist visible on reset failure and supports retry after load failure', async () => {
    let loadAttempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/brief/')) {
        loadAttempts += 1;
        return loadAttempts === 1 ? response({ kind: 'field_readiness_checklist_error', code: 'persistence_unavailable', message: 'hidden detail' }, 503, false) : collection(checklist());
      }
      return response({ kind: 'field_readiness_checklist_error', code: 'persistence_unavailable', message: 'hidden detail' }, 503, false);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<FieldReadinessChecklistPanel brief={brief('brief-1')} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'RETRY' })).toBeTruthy());
    expect(screen.getByRole('alert')).not.toHaveTextContent('hidden detail');
    fireEvent.click(screen.getByRole('button', { name: 'RETRY' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'RESET CHECKLIST' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'RESET CHECKLIST' }));
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM RESET' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not save or load/i));
    expect(screen.getByText('0 of 3 complete')).toBeTruthy();
  });

  it('clears prior state and ignores stale responses when the displayed brief changes', async () => {
    let resolveFirst!: (value: unknown) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).includes('brief-1')
      ? new Promise(resolve => { resolveFirst = resolve; })
      : Promise.resolve(collection(checklist('brief-2', false, 'Second brief wording.')))) as any;
    vi.stubGlobal('fetch', fetcher);
    const view = render(<FieldReadinessChecklistPanel brief={brief('brief-1')} />);
    view.rerender(<FieldReadinessChecklistPanel brief={brief('brief-2')} />);
    await waitFor(() => expect(screen.getByText('Second brief wording.')).toBeTruthy());
    resolveFirst(collection(checklist('brief-1', true, 'Old brief wording.')));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText('Old brief wording.')).toBeNull();
    expect(screen.getByText('Second brief wording.')).toBeTruthy();
  });
});