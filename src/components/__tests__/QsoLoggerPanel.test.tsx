/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QsoLoggerPanel } from '../QsoLoggerPanel';

const activation = { schemaVersion: 1, activationId: 'activation-1', type: 'General', status: 'active', createdAtUtc: '2026-08-25T12:00:00.000Z', updatedAtUtc: '2026-08-25T12:00:00.000Z' } as any;
const qso = { schemaVersion: 1, qsoId: 'qso-1', activationId: 'activation-1', qsoDateTimeUtc: '2026-08-25T12:00:00.000Z', callsign: 'W1AW', band: '20m', mode: 'SSB', source: 'manual', createdAtUtc: '2026-08-25T12:00:00.000Z', updatedAtUtc: '2026-08-25T12:00:00.000Z' };
afterEach(() => vi.restoreAllMocks());

describe('QsoLoggerPanel', () => {
  it('logs a contact and clears the callsign for the next contact', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => { if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 }); return new Response(JSON.stringify({ kind: 'qso', status: 'created', qso }), { status: 201 }); });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('CALLSIGN'), { target: { value: ' w1aw ' } });
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    fireEvent.click(screen.getByRole('button', { name: 'LOG QSO' }));
    await waitFor(() => expect(screen.getByText('W1AW')).toBeInTheDocument());
    expect(screen.getByLabelText('CALLSIGN')).toHaveValue('');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/activations/activation-1/qsos', expect.objectContaining({ method: 'POST' }));
  });
});
