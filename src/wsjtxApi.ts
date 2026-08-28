import type { CurrentStationState } from './currentStationState';

export interface WsjtxDiagnostics {
  readonly packetsReceived: number;
  readonly lastPacketReceivedAtUtc: string | null;
  readonly statusPacketsAccepted: number;
  readonly lastStatusParsedAtUtc: string | null;
  readonly lastStatusStateUpdatedAtUtc: string | null;
  readonly loggedQsoPacketsAccepted: number;
  readonly loggedQsoParseFailures: number;
  readonly lastLoggedQsoAtUtc: string | null;
  readonly lastLoggedQsoResult: string | null;
  readonly lastLoggedQsoCallsign: string | null;
  readonly lastLoggedQsoBand: string | null;
  readonly lastLoggedQsoMode: string | null;
  readonly lastLoggedQsoFrequencyMHz: number | null;
  readonly lastImportSuccessAtUtc: string | null;
  readonly lastImportFailureStage: string | null;
  readonly lastImportFailureReason: string | null;
}

export interface WsjtxCurrentResponse {
  readonly status: 'available' | 'stale' | 'unavailable';
  readonly state: CurrentStationState | null;
  readonly receivedAtUtc: string | null;
  readonly limitation: string;
  readonly apiSnapshotAtUtc?: string;
}

export async function getWsjtxCurrentState(signal?: AbortSignal): Promise<WsjtxCurrentResponse> {
  const response = await fetch('/api/wsjtx/current', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('WSJT-X state is unavailable.');
  return await response.json() as WsjtxCurrentResponse;
}

export async function getWsjtxDiagnostics(signal?: AbortSignal): Promise<WsjtxDiagnostics> {
  const response = await fetch('/api/wsjtx/diagnostics', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('WSJT-X diagnostics are unavailable.');
  return await response.json() as WsjtxDiagnostics;
}