export type ActivationNotesNoteKind = 'quick' | 'text';

export interface ActivationNote {
  readonly noteId: string;
  readonly recordedAtUtc: string;
  readonly kind: ActivationNotesNoteKind;
  readonly text: string;
}

export interface ActivationNotesCollection {
  readonly schemaVersion: 1;
  readonly collectionId: string;
  readonly briefId: string;
  readonly activation: { readonly program: 'POTA' | 'SOTA'; readonly reference: string; readonly displayName?: string };
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  readonly notes: readonly ActivationNote[];
}

export type ActivationNotesApiResult =
  | { readonly kind: 'activation_notes_collection'; readonly status: 'created' | 'existing' | 'updated'; readonly collection: ActivationNotesCollection }
  | { readonly kind: 'activation_notes_empty' }
  | { readonly kind: 'activation_notes_error'; readonly code: string; readonly message: string };

export async function getActivationNotesForBrief(briefId: string, signal?: AbortSignal): Promise<ActivationNotesApiResult> {
  const response = await fetch(`/api/activation-notes/brief/${encodeURIComponent(briefId)}`, { signal });
  const payload = await readPayload(response);
  if (response.status === 404) return { kind: 'activation_notes_empty' };
  if (!response.ok || payload?.kind !== 'activation_notes_collection') return apiError(payload, 'Activation Notes could not be loaded.');
  return payload;
}

export async function createActivationNotesForBrief(briefId: string): Promise<ActivationNotesApiResult> {
  const response = await fetch('/api/activation-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ briefId }),
  });
  const payload = await readPayload(response);
  if (!response.ok || payload?.kind !== 'activation_notes_collection') return apiError(payload, 'Activation Notes could not be created.');
  return payload;
}

export async function appendActivationNote(collectionId: string, kind: ActivationNotesNoteKind, text: string): Promise<ActivationNotesApiResult> {
  const response = await fetch(`/api/activation-notes/${encodeURIComponent(collectionId)}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, text }),
  });
  const payload = await readPayload(response);
  if (!response.ok || payload?.kind !== 'activation_notes_collection') return apiError(payload, 'The note could not be saved.');
  return payload;
}

async function readPayload(response: Response): Promise<any> {
  try { return await response.json(); } catch { return null; }
}

function apiError(payload: any, fallback: string): ActivationNotesApiResult {
  return { kind: 'activation_notes_error', code: payload?.code || 'request_failed', message: typeof payload?.message === 'string' ? payload.message : fallback };
}