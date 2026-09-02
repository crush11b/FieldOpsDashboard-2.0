import type { Activation, ActivationStatus } from '../server/activation';

export type ActivationApiResult = { readonly kind: 'activation'; readonly status?: 'created' | 'existing' | 'updated' | 'reconciled'; readonly activation: Activation; readonly diagnostics?: readonly unknown[]; readonly reconciledActivationIds?: readonly string[] } | { readonly kind: 'activation_error'; readonly code: string; readonly message: string };

export async function openActivationFromBrief(briefId: string): Promise<ActivationApiResult> {
  const response = await fetch('/api/activations/from-brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ briefId }) });
  return readResult(response, 'The Activation could not be opened.');
}
export async function updateActivationStatus(activationId: string, status: ActivationStatus): Promise<ActivationApiResult> {
  const response = await fetch(`/api/activations/${encodeURIComponent(activationId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  return readResult(response, 'The Activation status could not be updated.');
}
export async function reconcileActiveActivation(keepActivationId: string): Promise<ActivationApiResult> {
  const response = await fetch('/api/activations/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepActivationId }) });
  return readResult(response, 'The active Activations could not be reconciled.');
}
export async function startActivationFromBrief(briefId: string): Promise<ActivationApiResult> {
  const opened = await openActivationFromBrief(briefId);
  if (opened.kind !== 'activation') return opened;
  return updateActivationStatus(opened.activation.activationId, 'active');
}
async function readResult(response: Response, fallback: string): Promise<ActivationApiResult> { let payload: any = null; try { payload = await response.json(); } catch {} if (!response.ok || payload?.kind !== 'activation') return { kind: 'activation_error', code: payload?.code || 'request_failed', message: typeof payload?.message === 'string' ? payload.message : fallback }; return payload as ActivationApiResult; }