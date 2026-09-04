/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivationFoundationPanel, WSJTX_DIAGNOSTICS_POLL_INTERVAL_MS, WSJTX_DIAGNOSTICS_REQUEST_TIMEOUT_MS, WSJTX_POLL_INTERVAL_MS } from '../ActivationFoundationPanel';

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

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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
    expect(screen.getByRole('banner', { name: 'Operational header' })).toHaveTextContent('PLANNED ACTIVATION');
    expect(screen.getByRole('banner', { name: 'Operational header' })).not.toHaveTextContent('ACTIVE ACTIVATION');
    expect(screen.getByText('Technical Details').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'START ACTIVATION' }));
    await waitFor(() => expect(screen.getByText('ACTIVE · Started 2026-08-26 12:00:00 UTC')).toBeTruthy());
    expect(screen.getByRole('banner', { name: 'Operational header' })).toHaveTextContent('K-1234 · Test Park');
    expect(screen.getByRole('banner', { name: 'Operational header' })).toHaveTextContent('0');
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
    expect(screen.getByRole('banner', { name: 'Operational header' })).toHaveTextContent('20m / SSB');
    expect(screen.getByRole('banner', { name: 'Operational header' })).toHaveTextContent('MANUAL · OPERATOR-SET');
    expect(screen.getByText('Source: Manual operating context · Status: Current')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'END ACTIVATION' }));
    await waitFor(() => expect(screen.getByText('Current station state unavailable.')).toBeTruthy());
  });

  it('distinguishes completed and absent Activations without exposing current operation', () => {
    const { rerender } = render(<ActivationFoundationPanel brief={brief} initialActivation={{ ...activeActivation, status: 'completed' }} initialQsoCount={4} showReview={false} />);
    const header = screen.getByRole('banner', { name: 'Operational header' });
    expect(header).toHaveTextContent('COMPLETED ACTIVATION');
    expect(header).not.toHaveTextContent('ACTIVE ACTIVATION');
    expect(header).toHaveTextContent('0');
    expect(header).toHaveTextContent('CURRENT STATION');
    expect(header).toHaveTextContent('Unavailable');
    expect(screen.getByText('Current station state unavailable.')).toBeInTheDocument();

    rerender(<ActivationFoundationPanel brief={brief} initialActivation={null} showReview={false} />);
    const emptyHeader = screen.getByRole('banner', { name: 'Operational header' });
    expect(emptyHeader).toHaveTextContent('NO CURRENT ACTIVATION');
    expect(emptyHeader).not.toHaveTextContent('ACTIVE ACTIVATION');
    expect(emptyHeader).toHaveTextContent('No current Activation');
    expect(emptyHeader).toHaveTextContent('0');
    expect(emptyHeader).toHaveTextContent('Unavailable');
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
    expect(screen.getByLabelText('BAND')).toHaveValue('20m');
    await waitFor(() => expect(screen.getByLabelText('MODE')).toHaveValue('FT8'));
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.074);
    expect(fetcher).toHaveBeenCalledWith('/api/wsjtx/current', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  });

  it('seeds the mounted untouched logger when WSJT-X becomes fresh after unavailable state', async () => {
    let wsjtxCalls = 0;
    const freshState = { band: '40m', frequencyMHz: 7.074, mode: 'FT8', source: 'wsjtx', observedAtUtc: '2026-08-27T12:00:00.000Z', freshness: 'fresh', status: 'available', limitation: 'WSJT-X application status; not CAT, direct radio, or RF confirmation.' };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/wsjtx/current')) {
        wsjtxCalls += 1;
        return wsjtxCalls === 1 ? { ok: true, json: async () => ({ status: 'unavailable', state: null }) } : { ok: true, json: async () => ({ status: 'available', state: freshState }) };
      }
      return { ok: true, json: async () => ({ qsos: [] }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await waitFor(() => expect(screen.getByLabelText('MODE')).toHaveValue('SSB'));
    await waitFor(() => expect(screen.getByLabelText('MODE')).toHaveValue('FT8'), { timeout: 2000 });
    expect(screen.getByLabelText('BAND')).toHaveValue('40m');
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(7.074);

    fireEvent.change(screen.getByLabelText('BAND'), { target: { value: '20m' } });
    fireEvent.change(screen.getByLabelText('FREQUENCY MHz'), { target: { value: '14.075' } });
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(screen.getByLabelText('BAND')).toHaveValue('20m');
    expect(screen.getByLabelText('FREQUENCY MHz')).toHaveValue(14.075);
  });

  it('keeps stale WSJT-X visible instead of flapping to manual state', async () => {
    const wsjtxState = { band: '40m', frequencyMHz: 7.074, mode: 'FT8', source: 'wsjtx', observedAtUtc: '2026-08-27T12:00:00.000Z', freshness: 'stale', status: 'stale', limitation: 'The last WSJT-X Status message is older than the fresh-state tolerance.' };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/wsjtx/current')
      ? { ok: true, json: async () => ({ status: 'stale', state: wsjtxState }) }
      : { ok: true, json: async () => ({ qsos: [] }) }));
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await waitFor(() => expect(screen.getByText('Source: WSJT-X · Stale')).toBeInTheDocument());
    expect(screen.getByText('40m · FT8')).toBeInTheDocument();
    expect(screen.queryByText('Source: Manual operating context · Status: Current')).toBeNull();
  });

  it('uses a one-second WSJT-X refresh cadence for the preliminary latency budget', () => {
    expect(WSJTX_POLL_INTERVAL_MS).toBe(1000);
    expect(WSJTX_DIAGNOSTICS_POLL_INTERVAL_MS).toBe(2000);
  });

  it('shows collapsed WSJT-X diagnostics and refreshes them while active', async () => {
    vi.useFakeTimers();
    let diagnostics = { listenerMode: 'multicast', listenerState: 'active', multicastAddress: '239.255.0.0', multicastInterface: null, multicastInterfaces: ['127.0.0.1', '192.168.1.20'], multicastJoined: true, lastSocketError: null, packetsReceived: 4, lastPacketReceivedAtUtc: null, statusPacketsAccepted: 2, lastStatusParsedAtUtc: null, lastStatusStateUpdatedAtUtc: null, loggedQsoPacketsAccepted: 0, loggedQsoParseFailures: 0, lastLoggedQsoAtUtc: null, lastLoggedQsoResult: null, lastLoggedQsoCallsign: null, lastLoggedQsoBand: null, lastLoggedQsoMode: null, lastLoggedQsoFrequencyMHz: null, lastImportSuccessAtUtc: null, lastImportFailureStage: null, lastImportFailureReason: null, adifFile: { enabled: true, state: 'active', resolvedPath: 'C:\\Users\\Operator\\AppData\\Local\\WSJT-X\\wsjtx_log.adi', filePresent: true, checkpointPath: null, checkpointOffset: 123, baselineEstablished: true, lastFileObservationAtUtc: '2026-09-04T14:00:00.000Z', lastCompletedRecordAtUtc: '2026-09-04T14:00:01.000Z', recordsAccepted: 1, recordsRejected: 2, parseImportFailures: 0, duplicatesSuppressed: 1, lastSuccessfulImportAtUtc: '2026-09-04T14:00:01.000Z', lastFailureStage: null, lastFailureReason: null } };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/api/wsjtx/diagnostics')
      ? { ok: true, json: async () => diagnostics }
      : { ok: true, json: async () => ({ status: 'unavailable', state: null, qsos: [] }) });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const disclosure = screen.getByText('WSJT-X DIAGNOSTICS').closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    diagnostics = { ...diagnostics, loggedQsoPacketsAccepted: 1, lastLoggedQsoResult: 'persisted', lastLoggedQsoCallsign: 'W1AW', lastLoggedQsoBand: '20m', lastLoggedQsoMode: 'FT8', lastImportSuccessAtUtc: '2026-08-28T12:00:00.000Z' };
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    fireEvent.click(screen.getByText('WSJT-X DIAGNOSTICS'));
    expect(screen.getByText('multicast')).toBeInTheDocument();
    expect(screen.getByText('239.255.0.0')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1, 192.168.1.20')).toBeInTheDocument();
    expect(screen.getAllByText('Yes')).toHaveLength(2);
    expect(screen.getByText('persisted')).toBeInTheDocument();
    expect(screen.getByText('W1AW / 20m / FT8')).toBeInTheDocument();
    expect(screen.getByText('WSJT-X ADIF FILE FALLBACK')).toBeInTheDocument();
    expect(screen.getByText('C:\\Users\\Operator\\AppData\\Local\\WSJT-X\\wsjtx_log.adi')).toBeInTheDocument();
    expect(screen.getByText('Records accepted').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Records rejected by Activation gate').parentElement).toHaveTextContent('2');
    expect(fetcher).toHaveBeenCalledWith('/api/wsjtx/diagnostics', expect.objectContaining({ cache: 'no-store' }));
  });

  it('retains diagnostics across a failed poll and updates after recovery without remounting', async () => {
    vi.useFakeTimers();
    const firstDiagnostics = { packetsReceived: 4, lastPacketReceivedAtUtc: null, statusPacketsAccepted: 2, lastStatusParsedAtUtc: null, lastStatusStateUpdatedAtUtc: null, loggedQsoPacketsAccepted: 0, loggedQsoParseFailures: 0, lastLoggedQsoAtUtc: null, lastLoggedQsoResult: null, lastLoggedQsoCallsign: null, lastLoggedQsoBand: null, lastLoggedQsoMode: null, lastLoggedQsoFrequencyMHz: null, lastImportSuccessAtUtc: null, lastImportFailureStage: null, lastImportFailureReason: null };
    const recoveredDiagnostics = { ...firstDiagnostics, packetsReceived: 7, statusPacketsAccepted: 4 };
    let diagnosticsPoll = 0;
    let stationPoll = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/wsjtx/diagnostics')) {
        diagnosticsPoll += 1;
        if (diagnosticsPoll === 2) return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => diagnosticsPoll === 1 ? firstDiagnostics : recoveredDiagnostics };
      }
      if (String(input).includes('/api/wsjtx/current')) {
        stationPoll += 1;
        const state = stationPoll === 1 ? { band: '20m', frequencyMHz: 14.074, mode: 'FT8' } : { band: '40m', frequencyMHz: 7.074, mode: 'FT4' };
        return { ok: true, json: async () => ({ status: 'available', state: { ...state, source: 'wsjtx', observedAtUtc: '2026-08-27T12:00:00.000Z', freshness: 'fresh', status: 'available', limitation: 'WSJT-X application status' } }) };
      }
      return { ok: true, json: async () => ({ qsos: [] }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByText('WSJT-X DIAGNOSTICS'));
    expect(screen.getByText('4')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText('40m · FT4')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('40m · FT4')).toBeInTheDocument();
    expect(diagnosticsPoll).toBeGreaterThanOrEqual(3);
  });

  it('records Current Station and diagnostics transport timing through success and failure', async () => {
    vi.useFakeTimers();
    let resolveDiagnostics!: (value: unknown) => void;
    const pendingDiagnostics = new Promise(resolve => { resolveDiagnostics = resolve; });
    let diagnosticsPoll = 0;
    const diagnostics = { packetsReceived: 4, lastPacketReceivedAtUtc: null, statusPacketsAccepted: 2, lastStatusParsedAtUtc: null, lastStatusStateUpdatedAtUtc: null, loggedQsoPacketsAccepted: 0, loggedQsoParseFailures: 0, lastLoggedQsoAtUtc: null, lastLoggedQsoResult: null, lastLoggedQsoCallsign: null, lastLoggedQsoBand: null, lastLoggedQsoMode: null, lastLoggedQsoFrequencyMHz: null, lastImportSuccessAtUtc: null, lastImportFailureStage: null, lastImportFailureReason: null };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/wsjtx/diagnostics')) {
        diagnosticsPoll += 1;
        if (diagnosticsPoll === 1) return { ok: true, json: async () => pendingDiagnostics };
        return { ok: false, json: async () => ({}) };
      }
      if (String(input).includes('/api/wsjtx/current')) return { ok: true, json: async () => ({ status: 'available', timing: { requestId: 1, requestReceivedAtUtc: '2026-08-29T00:00:00.010Z', responseProducedAtUtc: '2026-08-29T00:00:00.011Z' }, state: { band: '20m', frequencyMHz: 14.074, mode: 'FT8', source: 'wsjtx', observedAtUtc: '2026-08-29T00:00:00.011Z', freshness: 'fresh', status: 'available', limitation: 'WSJT-X application status' } }) };
      return { ok: true, json: async () => ({ qsos: [] }) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByText('WSJT-X DIAGNOSTICS'));
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(diagnosticsPoll).toBe(1);
    resolveDiagnostics(diagnostics);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('20m · FT8')).toBeInTheDocument();
    expect(screen.getByText('CURRENT STATION TIMING')).toBeInTheDocument();
    expect(screen.getByText('DIAGNOSTICS POLLING TRANSPORT')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics requests in flight').parentElement).toHaveTextContent('0');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(diagnosticsPoll).toBe(2);
    expect(screen.getByText('failure')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics requests in flight').parentElement).toHaveTextContent('0');
  });

  it('aborts a pending diagnostics request on unmount and resumes after timeout', async () => {
    vi.useFakeTimers();
    let diagnosticsPoll = 0;
    const diagnosticsSignals: AbortSignal[] = [];
    const diagnostics = { packetsReceived: 8, lastPacketReceivedAtUtc: null, statusPacketsAccepted: 4, lastStatusParsedAtUtc: null, lastStatusStateUpdatedAtUtc: null, loggedQsoPacketsAccepted: 0, loggedQsoParseFailures: 0, lastLoggedQsoAtUtc: null, lastLoggedQsoResult: null, lastLoggedQsoCallsign: null, lastLoggedQsoBand: null, lastLoggedQsoMode: null, lastLoggedQsoFrequencyMHz: null, lastImportSuccessAtUtc: null, lastImportFailureStage: null, lastImportFailureReason: null };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/wsjtx/diagnostics')) {
        diagnosticsPoll += 1;
        if (init?.signal) diagnosticsSignals.push(init.signal);
        if (diagnosticsPoll === 1 || diagnosticsPoll === 3) return { ok: true, json: async () => new Promise((resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) };
        return { ok: true, json: async () => diagnostics };
      }
      if (String(input).includes('/api/wsjtx/current')) return { ok: true, json: async () => ({ status: 'available', state: { band: '20m', frequencyMHz: 14.074, mode: 'FT8', source: 'wsjtx', observedAtUtc: '2026-08-29T00:00:00.000Z', freshness: 'fresh', status: 'available', limitation: 'WSJT-X application status' } }) };
      return { ok: true, json: async () => ({ qsos: [] }) };
    });
    vi.stubGlobal('fetch', fetcher);
    const view = render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(WSJTX_DIAGNOSTICS_REQUEST_TIMEOUT_MS); });
    expect(diagnosticsSignals[0]?.aborted).toBe(true);
    expect(screen.getByText('failure')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(diagnosticsPoll).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    view.unmount();
    expect(diagnosticsSignals[2]?.aborted).toBe(true);
  });

  it('exposes the approved clock sync action in OPERATE and refreshes evidence after confirmation', async () => {
    const status = { status: 'NotSynchronized', error: 'UnsafeOffset', gnssTime: { status: 'Available', timestampUtc: '2026-08-27T12:00:00.000Z', sentenceType: 'RMC' }, lastSuccessfulSynchronizationUtc: null, offsetBeforeSynchronizationSeconds: -1.1, currentOffsetSeconds: null, attemptMessage: 'Windows time differs from fresh GNSS UTC evidence by -1.1 seconds.' };
    const synchronized = { ...status, status: 'Synchronized', error: 'None', currentOffsetSeconds: 0, attemptMessage: 'Windows time was set from fresh GNSS UTC evidence.' };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/clock/synchronize')) return { ok: true, json: async () => synchronized };
      if (String(input).includes('/api/clock/status')) return { ok: true, json: async () => status };
      if (String(input).includes('/wsjtx/current')) return { ok: true, json: async () => ({ status: 'unavailable', state: null }) };
      if (!init) return { ok: true, json: async () => ({ qsos: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await waitFor(() => expect(screen.getByText('NOTSYNCHRONIZED')).toBeInTheDocument());
    const synchronize = screen.getByRole('button', { name: 'SYNCHRONIZE WINDOWS TIME' });
    expect(synchronize).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm Windows clock synchronization in Operate' }));
    expect(synchronize).not.toBeDisabled();
    fireEvent.click(synchronize);
    await waitFor(() => expect(screen.getByText('LAST SYNCHRONIZATION ATTEMPT')).toBeInTheDocument());
    expect(screen.getByText('NO CHANGE / ALREADY SYNCHRONIZED')).toBeInTheDocument();
    expect(screen.getByText('NOTSYNCHRONIZED')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith('/api/clock/synchronize', expect.objectContaining({ method: 'POST', body: '{"confirmed":true}' }));
  });

  it('shows read-only GNSS clock evidence diagnostics collapsed by default', async () => {
    const status = {
      status: 'Unknown', error: 'GnssStaleOrMalformed',
      gnssTime: { status: 'Available', sentenceType: 'RMC', rawUtcField: '123519.00', rawDateField: '230394', timestampUtc: '1994-03-23T12:35:19.000Z', priorTimestampUtc: '1994-03-23T12:35:18.000Z', timestampDeltaSeconds: 1, receiptElapsedSeconds: 0.04, temporalCoherent: false, rejectionReason: 'GNSS UTC elapsed time does not match receipt elapsed time.' },
      lastSuccessfulSynchronizationUtc: null, offsetBeforeSynchronizationSeconds: null, currentOffsetSeconds: -0.482,
      attemptMessage: 'Temporally coherent GNSS UTC evidence is unavailable.', operationStartedAtUtc: '2026-08-28T12:00:00.000Z', operationDurationMilliseconds: 120, gnssObservationReceivedAtUtc: '2026-08-28T11:59:59.900Z', evidenceAgeMilliseconds: 100, projectedTargetUtc: '2026-08-28T12:00:00.100Z', windowsUtcBeforeSet: '2026-08-28T12:00:32.800Z', windowsUtcAfterSet: null, verificationOffsetSeconds: null, attemptCount: 0,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/api/clock/status')
      ? { ok: true, json: async () => status }
      : { ok: true, json: async () => ({ qsos: [] }) });
    vi.stubGlobal('fetch', fetcher);
    render(<ActivationFoundationPanel brief={brief} initialActivation={activeActivation} showReview={false} />);
    await waitFor(() => expect(screen.getByText('GNSS TIME EVIDENCE / DIAGNOSTICS')).toBeInTheDocument());
    const details = screen.getByText('GNSS TIME EVIDENCE / DIAGNOSTICS').closest('details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('GNSS TIME EVIDENCE / DIAGNOSTICS'));
    expect(screen.getByText('123519.00')).toBeInTheDocument();
    expect(screen.getByText('230394')).toBeInTheDocument();
    expect(screen.getByText('1994-03-23T12:35:19.000Z')).toBeInTheDocument();
    expect(screen.getByText('1994-03-23T12:35:18.000Z')).toBeInTheDocument();
    expect(screen.getByText('0.04')).toBeInTheDocument();
    expect(screen.getByText('UNTRUSTED')).toBeInTheDocument();
    expect(screen.getByText('GNSS UTC elapsed time does not match receipt elapsed time.')).toBeInTheDocument();
    expect(screen.getByText('2026-08-28T12:00:00.100Z')).toBeInTheDocument();
    expect(screen.getByText('2026-08-28T12:00:32.800Z')).toBeInTheDocument();
    expect(screen.getByText('Calculated offset seconds')).toBeInTheDocument();
    expect(screen.getByText('-0.482')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(1);
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/api/clock/synchronize'))).toBe(false);
  });
});
