import type { OperationsReadinessDisplayEvidence } from '../server/operationsReadinessDisplayEvidence';
import type { OperationsReadinessSummary } from '../server/operationsReadiness';

export interface OperationsReadinessApiResponse {
  readonly kind: 'operations_readiness';
  readonly briefId: string;
  readonly summary: OperationsReadinessSummary;
  readonly displayEvidence: OperationsReadinessDisplayEvidence;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

export class OperationsReadinessApiError extends Error {
  readonly code: string;

  constructor(message: string, code = 'request_failed') {
    super(message);
    this.name = 'OperationsReadinessApiError';
    this.code = code;
  }
}

export async function getOperationsReadinessForBrief(
  briefId: string,
  includeLiveWeather = false,
  signal?: AbortSignal,
): Promise<OperationsReadinessApiResponse> {
  const query = includeLiveWeather ? '?includeLiveWeather=true' : '';
  const response = await fetch(`/api/operations-readiness/${encodeURIComponent(briefId)}${query}`, { signal });
  const payload = await readPayload(response);
  if (!response.ok || !isReadinessPayload(payload)) {
    const record = isRecord(payload) ? payload : null;
    const code = typeof record?.code === 'string' ? record.code : 'request_failed';
    throw new OperationsReadinessApiError(errorMessage(code, includeLiveWeather), code);
  }
  if (payload.briefId !== briefId) throw new OperationsReadinessApiError('Operations Readiness could not be loaded from the local server.', 'brief_mismatch');
  return payload;
}

async function readPayload(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function isReadinessPayload(value: unknown): value is OperationsReadinessApiResponse {
  return isRecord(value)
    && value.kind === 'operations_readiness'
    && isNonemptyString(value.briefId, 128)
    && isSummary(value.summary)
    && isDisplayEvidence(value.displayEvidence)
    && isDiagnostics(value.diagnostics);
}

function isSummary(value: unknown): boolean {
  return isRecord(value)
    && isNonemptyString(value.evaluatedAtUtc, 64)
    && Array.isArray(value.findings)
    && Array.isArray(value.nextActions)
    && value.nextActions.every(action => isNonemptyString(action, 500));
}

function isDisplayEvidence(value: unknown): boolean {
  return isRecord(value) && isEvidenceBranch(value.weather) && isEvidenceBranch(value.alerts);
}

function isEvidenceBranch(value: unknown): boolean {
  return isRecord(value)
    && (value.status === 'not_requested' || value.status === 'live' || value.status === 'unavailable')
    && isSource(value.source)
    && (value.retrievedAtUtc === null || isNonemptyString(value.retrievedAtUtc, 64));
}

function isSource(value: unknown): boolean {
  return isRecord(value) && isNonemptyString(value.id, 128) && isNonemptyString(value.type, 128)
    && (value.name === undefined || isNonemptyString(value.name, 256));
}

function isDiagnostics(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => isRecord(item) && isNonemptyString(item.code, 128) && isNonemptyString(item.message, 500));
}

function isNonemptyString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function errorMessage(code: string, includeLiveWeather: boolean): string {
  if (code === 'brief_not_found') return 'This SmartDeploy brief is no longer retained.';
  if (code === 'unsupported_brief_schema') return 'This retained brief uses an unsupported legacy schema for Operations Readiness.';
  if (code === 'readiness_unavailable' && !includeLiveWeather) return 'Local readiness evidence is temporarily unavailable. The retained SmartDeploy brief remains available.';
  if (includeLiveWeather) return 'Live weather and alerts could not be loaded for the planned site. Local readiness evidence is preserved.';
  return 'Operations Readiness could not be loaded from the local server.';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
