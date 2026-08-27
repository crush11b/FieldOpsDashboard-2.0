import type { CurrentStationState } from './currentStationState';

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