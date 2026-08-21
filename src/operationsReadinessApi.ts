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
    throw new OperationsReadinessApiError(
      typeof record?.message === 'string' ? record.message : includeLiveWeather
        ? 'Live Operations Readiness evidence could not be loaded.'
        : 'Operations Readiness could not be loaded from the local server.',
      typeof record?.code === 'string' ? record.code : 'request_failed',
    );
  }
  if (payload.briefId !== briefId) throw new OperationsReadinessApiError('The Operations Readiness response did not match this SmartDeploy brief.', 'brief_mismatch');
  return payload;
}

async function readPayload(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function isReadinessPayload(value: unknown): value is OperationsReadinessApiResponse {
  return isRecord(value)
    && value.kind === 'operations_readiness'
    && typeof value.briefId === 'string'
    && isRecord(value.summary)
    && isRecord(value.displayEvidence)
    && Array.isArray(value.diagnostics);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
