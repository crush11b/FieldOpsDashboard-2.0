import type { ActivationReview } from '../server/activationReview';

export async function getActivationReview(activationId: string, signal?: AbortSignal): Promise<ActivationReview> {
  const response = await fetch(`/api/activations/${encodeURIComponent(activationId)}/review`, { signal });
  const payload = await response.json();
  if (!response.ok || payload?.kind !== 'activation_review') throw new Error(payload?.message || 'Activation Review could not be loaded.');
  return payload as ActivationReview;
}