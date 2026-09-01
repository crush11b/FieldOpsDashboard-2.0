/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('supplies the 20m FT8 default and keeps a manual override in the same context', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 });
      return new Response(JSON.stringify({ kind: 'qso', status: 'created', qso }), { status: 201 });
    });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('BAND')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.074);
    fireEvent.change(screen.getByLabelText('FREQUENCY MHz'), { target: { value: '14.075' } });
    fireEvent.change(screen.getByLabelText('CALLSIGN'), { target: { value: 'W1AW' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.075);
  });

  it('clears the FT8 frequency when changing to SSB and restores it when changing back', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 });
      return new Response(JSON.stringify({ kind: 'qso', status: 'created', qso }), { status: 201 });
    });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('MODE')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    fireEvent.change(screen.getByLabelText('FREQUENCY MHz'), { target: { value: '14.075' } });
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'SSB' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.074);
  });

  it('replaces a manual SSB frequency with the new digital default', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 });
      return new Response(JSON.stringify({ kind: 'qso', status: 'created', qso }), { status: 201 });
    });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('MODE')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('FREQUENCY MHz'), { target: { value: '14.260' } });
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.074);
  });

  it('supplies the 40m FT8 default after changing band', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 }));
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('MODE')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    fireEvent.change(screen.getByLabelText('FREQUENCY MHz'), { target: { value: '14.075' } });
    fireEvent.change(screen.getByLabelText('BAND'), { target: { value: '40m' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(7.074);
  });

  it('clears frequency when the new operating context has no conventional default', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 }));
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('MODE')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FM' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(null);
  });

  it('preserves an existing QSO frequency until band or mode is changed during edit', async () => {
    const stored = { ...qso, mode: 'FT8', frequencyMHz: 14.075 };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [stored] }), { status: 200 });
      return new Response(JSON.stringify({ kind: 'qso', status: 'updated', qso: stored }), { status: 200 });
    });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByText('W1AW')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'EDIT' }));
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.075);
    fireEvent.change(screen.getByLabelText('CALLSIGN'), { target: { value: 'N0CALL' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.075);
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'SSB' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(null);
  });

  it('clears an auto default when changing to a mode without a defined default', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!init) return new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 });
      return new Response(JSON.stringify({ kind: 'qso', status: 'created', qso }), { status: 201 });
    });
    render(<QsoLoggerPanel activation={activation} />);
    await waitFor(() => expect(screen.getByLabelText('MODE')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'FT8' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.074);
    fireEvent.change(screen.getByLabelText('MODE'), { target: { value: 'SSB' } });
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(null);
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

  it('seeds a fresh WSJT-X context once without replacing an in-progress contact', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ kind: 'qsos', qsos: [] }), { status: 200 }));
    const fresh = { band: '40m', frequencyMHz: 7.074, mode: 'FT8', source: 'wsjtx', freshness: 'fresh', status: 'available' } as any;
    const { rerender } = render(<QsoLoggerPanel activation={activation} initialStationState={fresh} />);
    await waitFor(() => expect(screen.getByLabelText('MODE')).toHaveValue('FT8'));
    fireEvent.change(screen.getByLabelText('CALLSIGN'), { target: { value: 'W1AW' } });
    rerender(<QsoLoggerPanel activation={activation} initialStationState={{ ...fresh, band: '20m', frequencyMHz: 14.074 }} />);
    expect(screen.getByLabelText('CALLSIGN')).toHaveValue('W1AW');
    expect(screen.getByLabelText('BAND')).toHaveValue('40m');
  });

  it('refreshes externally persisted QSOs while the logger remains mounted', async () => {
    vi.useFakeTimers();
    let current = { qsos: [] as any[] };
    const persisted = { ...qso, source: 'wsjtx', mode: 'FT8' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(current), { status: 200 }));
    render(<QsoLoggerPanel activation={activation} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    current = { qsos: [persisted] };
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('W1AW')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
