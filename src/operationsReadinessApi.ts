import type { OperationsReadinessDisplayEvidence } from '../server/operationsReadinessDisplayEvidence';
import type { OperationsReadinessSummary } from '../server/operationsReadiness';

export interface OperationsReadinessApiResponse {
  readonly kind: 'operations_readiness';
  readonly briefId: string;
  readonly summary: OperationsReadinessSummary;
  readonly displayEvidence: OperationsReadinessDisplayEvidence;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

export type OperationsReadinessClientErrorCode = 'brief_not_found' | 'unsupported_brief_schema' | 'readiness_unavailable' | 'request_failed' | 'brief_mismatch';

export class OperationsReadinessApiError extends Error {
  readonly code: OperationsReadinessClientErrorCode;

  constructor(message: string, code: OperationsReadinessClientErrorCode = 'request_failed') {
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
  if (!response.ok) {
    const record = isRecord(payload) ? payload : null;
    const code = normalizeErrorCode(record?.code);
    throw new OperationsReadinessApiError(errorMessage(code, includeLiveWeather), code);
  }
  if (!isReadinessPayload(payload)) {
    throw new OperationsReadinessApiError(errorMessage('request_failed', includeLiveWeather));
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
    && isPlan(value.plan)
    && isToughBook(value.toughBook)
    && Array.isArray(value.findings)
    && value.findings.every(isFinding)
    && Array.isArray(value.nextActions)
    && value.nextActions.every(action => isNonemptyString(action, 500));
}

function isPlan(value: unknown): boolean {
  return isRecord(value)
    && isReadinessStatus(value.status)
    && (value.briefId === null || isNonemptyString(value.briefId, 128))
    && (value.activationReference === null || isNonemptyString(value.activationReference, 256))
    && (value.plannedSite === null || isNonemptyString(value.plannedSite, 512));
}

function isToughBook(value: unknown): boolean {
  return isRecord(value)
    && isReadinessStatus(value.status)
    && (value.chargePercent === null || isFiniteNumber(value.chargePercent) && value.chargePercent >= 0 && value.chargePercent <= 100)
    && isNonemptyString(value.powerSource, 128)
    && (value.charging === null || typeof value.charging === 'boolean')
    && (value.runtimeEstimateSeconds === null || isFiniteNumber(value.runtimeEstimateSeconds) && value.runtimeEstimateSeconds >= 0);
}

function isFinding(value: unknown): boolean {
  return isRecord(value)
    && isNonemptyString(value.id, 128)
    && isReadinessStatus(value.status)
    && isPriority(value.priority)
    && isNonemptyString(value.message, 1000)
    && isSource(value.source)
    && (value.observedAtUtc === undefined || isNonemptyString(value.observedAtUtc, 64))
    && isNonemptyString(value.evaluatedAtUtc, 64)
    && (value.freshness === undefined || value.freshness === 'fresh' || value.freshness === 'stale' || value.freshness === 'unavailable')
    && (value.limitation === undefined || isNonemptyString(value.limitation, 1000))
    && (value.recommendedAction === undefined || isNonemptyString(value.recommendedAction, 1000));
}

function isDisplayEvidence(value: unknown): boolean {
  return isRecord(value) && isWeatherBranch(value.weather) && isAlertsBranch(value.alerts);
}

function isWeatherBranch(value: unknown): boolean {
  if (!isRecord(value) || !isDisplayStatus(value.status) || !isSource(value.source)
    || !isNullableTimestamp(value.retrievedAtUtc) || !('data' in value)) return false;
  if (value.status === 'live' && value.retrievedAtUtc === null) return false;
  if (value.status !== 'live' && value.retrievedAtUtc !== null) return false;
  return isWeatherDataForDisplay(value.data, value.status === 'live');
}

function isAlertsBranch(value: unknown): boolean {
  if (!isRecord(value) || !isDisplayStatus(value.status) || !isSource(value.source)
    || !isNullableTimestamp(value.retrievedAtUtc) || !('active' in value)) return false;
  if (value.status === 'live' && value.retrievedAtUtc === null) return false;
  if (value.status !== 'live' && value.retrievedAtUtc !== null) return false;
  return isAlertsForDisplay(value.active);
}

function isWeatherDataForDisplay(value: unknown, live: boolean): boolean {
  if (!live) return value === null;
  return isRecord(value)
    && isFiniteNumber(value.tempF)
    && isFiniteNumber(value.humidity)
    && isFiniteNumber(value.pressureInHg)
    && isFiniteNumber(value.windMph)
    && isNonemptyString(value.windDir, 32)
    && isNonemptyString(value.condition, 256)
    && isNonemptyString(value.locationName, 256)
    && isFiniteNumber(value.uvIndex)
    && (value.windGustMph === undefined || isFiniteNumber(value.windGustMph))
    && (value.hourlyForecast === undefined || Array.isArray(value.hourlyForecast) && value.hourlyForecast.every(isHourlyForecastItem));
}

function isHourlyForecastItem(value: unknown): boolean {
  return isRecord(value) && isNonemptyString(value.time, 64) && isFiniteNumber(value.tempF) && isFiniteNumber(value.precipProb);
}

function isAlertsForDisplay(value: unknown): boolean {
  return Array.isArray(value) && value.every(isAlert);
}

function isAlert(value: unknown): boolean {
  return isRecord(value)
    && isNonemptyString(value.id, 256)
    && (value.severity === 'Extreme' || value.severity === 'Severe' || value.severity === 'Moderate' || value.severity === 'Minor' || value.severity === 'Unknown')
    && isNonemptyString(value.title, 512)
    && isNonemptyString(value.description, 2000)
    && isNonemptyString(value.area, 512)
    && isNonemptyString(value.issued, 64)
    && isNonemptyString(value.expires, 64);
}

function isDisplayStatus(value: unknown): boolean {
  return value === 'not_requested' || value === 'live' || value === 'unavailable';
}

function isReadinessStatus(value: unknown): boolean {
  return value === 'ready' || value === 'attention' || value === 'blocked' || value === 'unknown' || value === 'stale' || value === 'unavailable' || value === 'unsupported';
}

function isPriority(value: unknown): boolean {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isNonemptyString(value, 64);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeErrorCode(value: unknown): OperationsReadinessClientErrorCode {
  if (value === 'brief_not_found' || value === 'unsupported_brief_schema' || value === 'readiness_unavailable' || value === 'brief_mismatch') return value;
  return 'request_failed';
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
