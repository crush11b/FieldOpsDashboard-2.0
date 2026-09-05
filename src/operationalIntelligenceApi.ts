import type { StationSignalObservation, TxContext } from '../server/operationalIntelligence';

export interface OperationalIntelligenceResult {
  readonly txContexts: readonly TxContext[];
  readonly observations: readonly StationSignalObservation[];
  readonly diagnostics: readonly unknown[];
}

export type TxContextInput = Omit<TxContext, 'segmentId' | 'activationId' | 'startedAtUtc' | 'endedAtUtc'>;

export async function getOperationalIntelligence(activationId: string, signal?: AbortSignal): Promise<OperationalIntelligenceResult> {
  const response = await fetch(endpoint(activationId), { cache: 'no-store', signal });
  const payload = await readJson(response);
  if (!response.ok || payload?.kind !== 'operational_intelligence') throw requestError(payload, 'MY SIGNAL evidence could not be loaded.');
  return { txContexts: payload.txContexts || [], observations: payload.observations || [], diagnostics: payload.diagnostics || [] };
}

export async function openTxContext(activationId: string, input: TxContextInput): Promise<TxContext> {
  const response = await fetch(`${activationEndpoint(activationId)}/tx-context`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await readJson(response);
  if (!response.ok || payload?.kind !== 'tx_context') throw requestError(payload, 'The TX Context could not be saved.');
  return payload.context as TxContext;
}

export async function captureStationSignalObservation(activationId: string, segmentId: string): Promise<StationSignalObservation> {
  const response = await fetch(`${activationEndpoint(activationId)}/tx-context/${encodeURIComponent(segmentId)}/observations`, { method: 'POST' });
  const payload = await readJson(response);
  if (!response.ok || payload?.kind !== 'station_signal_observation') throw requestError(payload, 'MY SIGNAL evidence could not be captured.');
  return payload.observation as StationSignalObservation;
}

function endpoint(activationId: string): string {
  return `${activationEndpoint(activationId)}/operational-intelligence`;
}

function activationEndpoint(activationId: string): string { return `/api/activations/${encodeURIComponent(activationId)}`; }

async function readJson(response: Response): Promise<any> {
  try { return await response.json(); } catch { return null; }
}

function requestError(payload: any, fallback: string): Error {
  return new Error(typeof payload?.message === 'string' ? payload.message : fallback);
}
