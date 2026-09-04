import type { CurrentStationState } from './currentStationState';

export interface WsjtxDiagnostics {
  readonly listenerMode: 'unicast' | 'multicast';
  readonly listenerState: 'stopped' | 'starting' | 'active' | 'failed' | 'recovering';
  readonly multicastAddress: string | null;
  readonly multicastInterface: string | null;
  readonly multicastInterfaces: readonly string[];
  readonly multicastJoined: boolean;
  readonly lastSocketError: string | null;
  readonly packetsReceived: number;
  readonly lastPacketReceivedAtUtc: string | null;
  readonly statusPacketsAccepted: number;
  readonly lastStatusParsedAtUtc: string | null;
  readonly lastStatusStateUpdatedAtUtc: string | null;
  readonly loggedQsoPacketsAccepted: number;
  readonly loggedQsoParseFailures: number;
  readonly loggedQsoType5Accepted?: number;
  readonly loggedQsoType5ParseFailures?: number;
  readonly loggedAdifPacketsAccepted?: number;
  readonly loggedAdifParseFailures?: number;
  readonly loggedQsoDuplicatesSuppressed?: number;
  readonly lastLoggedQsoAtUtc: string | null;
  readonly lastLoggedQsoResult: string | null;
  readonly lastLoggedQsoCallsign: string | null;
  readonly lastLoggedQsoBand: string | null;
  readonly lastLoggedQsoMode: string | null;
  readonly lastLoggedQsoFrequencyMHz: number | null;
  readonly lastImportSuccessAtUtc: string | null;
  readonly lastImportFailureStage: string | null;
  readonly lastImportFailureReason: string | null;
  readonly timing?: WsjtxTimingEvidence;
  readonly adifFile?: WsjtxAdifFileDiagnostics;
}

export interface WsjtxAdifFileDiagnostics {
  readonly enabled: boolean;
  readonly state: 'stopped' | 'waiting' | 'active' | 'unavailable' | 'failed';
  readonly resolvedPath: string | null;
  readonly filePresent: boolean;
  readonly checkpointPath: string | null;
  readonly checkpointOffset: number | null;
  readonly baselineEstablished: boolean;
  readonly lastFileObservationAtUtc: string | null;
  readonly lastCompletedRecordAtUtc: string | null;
  readonly recordsAccepted: number;
  readonly parseImportFailures: number;
  readonly duplicatesSuppressed: number;
  readonly lastSuccessfulImportAtUtc: string | null;
  readonly lastFailureStage: string | null;
  readonly lastFailureReason: string | null;
}

export interface WsjtxTimingEvidence {
  readonly lastStatusPacketReceivedAtUtc: string | null;
  readonly lastStatusParsedAtUtc: string | null;
  readonly lastStatusStateUpdatedAtUtc: string | null;
  readonly lastCurrentRequestId: number | null;
  readonly lastCurrentRequestReceivedAtUtc: string | null;
  readonly lastCurrentResponseProducedAtUtc: string | null;
}

export interface WsjtxCurrentTiming {
  readonly requestId: number;
  readonly requestReceivedAtUtc: string;
  readonly responseProducedAtUtc: string;
}

export interface WsjtxCurrentResponse {
  readonly status: 'available' | 'stale' | 'unavailable';
  readonly state: CurrentStationState | null;
  readonly receivedAtUtc: string | null;
  readonly limitation: string;
  readonly apiSnapshotAtUtc?: string;
  readonly timing?: WsjtxCurrentTiming;
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