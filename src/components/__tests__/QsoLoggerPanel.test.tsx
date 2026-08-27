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

  it('uses editable digital defaults, clears unsupported auto defaults, and preserves manual overrides', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 });
      return new Response(JSON.stringify({ kind: 'qso', status: 'created', qso }), { status: 201 });
    });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('BAND')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.074);
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'SSB' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    fireEvent.change(screen.getByLabelText('FREQUENCY MHz'), { target: { value: '14.123' } });
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'SSB' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.123);
  });

  it('retains operating context after logging and resets contact fields', async () => {
    const created = { ...qso, band: '40m', frequencyMHz: 7.074, mode: 'FT8', rstSent: '-10', rstReceived: '-12' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 });
      return new Response(JSON.stringify({ kind: 'qso', status: 'created', qso: created }), { status: 201 });
    });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('CALLSIGN')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('BAND'), { target: { value: '40m' } });
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    fireEvent.change(screen.getByLabelText('CALLSIGN'), { target: { value: 'w1aw' } });
    fireEvent.click(screen.getByRole('button', { name: 'LOG QSO' }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/activations/activation-1/qsos', expect.objectContaining({ method: 'POST' })));
    expect(screen.getByLabelText('BAND')).toHaveValue('40m');
    expect(screen.getByLabelText('MODE')).toHaveValue('FT8');
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(7.074);
    expect(screen.getByLabelText('CALLSIGN')).toHaveValue('');
    expect(screen.getByLabelText('RST SENT')).toHaveValue('');
    expect(screen.getByLabelText('RST RECEIVED')).toHaveValue('');
  });

  it('keeps an imported noncanonical mode and band editable without replacing it', async () => {
    const imported = { ...qso, band: '4m', mode: 'DIGITALVOICE', source: 'adif_import' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [imported] }), { status: 200 });
      return new Response(JSON.stringify({ kind: 'qso', status: 'updated', qso: imported }), { status: 200 });
    });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByText('DIGITALVOICE')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'EDIT' }));
    expect(screen.getByLabelText('BAND')).toHaveValue('4m');
    expect(screen.getByLabelText('MODE')).toHaveValue('DIGITALVOICE');
    expect(screen.getByLabelText('BAND')).toHaveTextContent('4m (imported)');
    expect(screen.getByLabelText('MODE')).toHaveTextContent('DIGITALVOICE (imported)');
  });

  it('clears transient form state when the active Activation changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 }));
    const { rerender } = render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('CALLSIGN')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('BAND'), { target: { value: '40m' } });
    fireEvent.change(screen.getByLabelText('CALLSIGN'), { target: { value: 'W1AW' } });
    rerender(<QsoLoggerPanel activation={{ ...activation, activationId: 'activation-2' }} />);
    await waitFor(() => expect(screen.getByLabelText('CALLSIGN')).toHaveValue(''));
    expect(screen.getByLabelText('BAND')).toHaveValue('20m');
    expect(screen.getByLabelText('MODE')).toHaveValue('SSB');
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(null);
  });
});
