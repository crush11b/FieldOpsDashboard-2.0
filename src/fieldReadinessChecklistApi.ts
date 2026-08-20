export type FieldReadinessChecklistItemId = string;

export interface FieldReadinessChecklistItem {
  readonly itemId: FieldReadinessChecklistItemId;
  readonly text: string;
  readonly completed: boolean;
}

export interface FieldReadinessChecklistSection {
  readonly sectionId: string;
  readonly title: string;
  readonly items: readonly FieldReadinessChecklistItem[];
}

export interface FieldReadinessChecklist {
  readonly schemaVersion: 1;
  readonly templateId: string;
  readonly templateVersion: 1;
  readonly checklistId: string;
  readonly briefId: string;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  readonly sections: readonly FieldReadinessChecklistSection[];
}

export type FieldReadinessChecklistApiResult =
  | { readonly kind: 'field_readiness_checklist'; readonly status: 'created' | 'existing' | 'updated' | 'reset'; readonly checklist: FieldReadinessChecklist }
  | { readonly kind: 'field_readiness_checklist_empty' }
  | { readonly kind: 'field_readiness_checklist_error'; readonly code: string; readonly message: string };

export async function getFieldReadinessChecklistForBrief(briefId: string, signal?: AbortSignal): Promise<FieldReadinessChecklistApiResult> {
  const response = await fetch(`/api/field-checklists/brief/${encodeURIComponent(briefId)}`, { signal });
  const payload = await readPayload(response);
  if (response.status === 404) return { kind: 'field_readiness_checklist_empty' };
  if (!response.ok || !isChecklistPayload(payload)) return apiError(payload, 'Field Readiness Checklist could not be loaded.');
  return payload;
}

export async function createFieldReadinessChecklistForBrief(briefId: string, signal?: AbortSignal): Promise<FieldReadinessChecklistApiResult> {
  const response = await fetch('/api/field-checklists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ briefId }),
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok || !isChecklistPayload(payload)) return apiError(payload, 'Field Readiness Checklist could not be started.');
  return payload;
}

export async function updateFieldReadinessChecklistItem(checklistId: string, itemId: string, completed: boolean, signal?: AbortSignal): Promise<FieldReadinessChecklistApiResult> {
  const response = await fetch(`/api/field-checklists/${encodeURIComponent(checklistId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok || !isChecklistPayload(payload)) return apiError(payload, 'The checklist item could not be saved.');
  return payload;
}

export async function resetFieldReadinessChecklist(checklistId: string, signal?: AbortSignal): Promise<FieldReadinessChecklistApiResult> {
  const response = await fetch(`/api/field-checklists/${encodeURIComponent(checklistId)}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok || !isChecklistPayload(payload)) return apiError(payload, 'The checklist could not be reset.');
  return payload;
}

async function readPayload(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function isChecklistPayload(value: unknown): value is Extract<FieldReadinessChecklistApiResult, { readonly kind: 'field_readiness_checklist' }> {
  if (!isRecord(value) || value.kind !== 'field_readiness_checklist' || !['created', 'existing', 'updated', 'reset'].includes(String(value.status)) || !isChecklist(value.checklist)) return false;
  return true;
}

function isChecklist(value: unknown): value is FieldReadinessChecklist {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.templateVersion !== 1 || !isBoundedString(value.templateId, 128) || !isBoundedString(value.checklistId, 128) || !isBoundedString(value.briefId, 128) || !isBoundedString(value.createdAtUtc, 64) || !isBoundedString(value.updatedAtUtc, 64) || !Array.isArray(value.sections) || value.sections.length !== 2) return false;
  return value.sections.every(section => isRecord(section) && isBoundedString(section.sectionId, 64) && isBoundedString(section.title, 128) && Array.isArray(section.items) && section.items.every(item => isRecord(item) && isBoundedString(item.itemId, 128) && isBoundedString(item.text, 512) && typeof item.completed === 'boolean'));
}

function apiError(payload: unknown, fallback: string): FieldReadinessChecklistApiResult {
  const record = isRecord(payload) ? payload : null;
  return { kind: 'field_readiness_checklist_error', code: record && typeof record.code === 'string' ? record.code : 'request_failed', message: record && typeof record.message === 'string' && record.message.length <= 300 ? record.message : fallback };
}

function isBoundedString(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }