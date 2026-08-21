import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOperationsReadinessForBrief, OperationsReadinessApiError } from '../operationsReadinessApi';

const validResponse = (overrides: Record<string, unknown> = {}) => ({
  kind: 'operations_readiness',
  briefId: 'brief/1',
  summary: {
    evaluatedAtUtc: '2026-08-21T04:00:00.000Z',
    plan: { status: 'ready', briefId: 'brief/1', activationReference: 'US-1234', plannedSite: 'Test site' },
    toughBook: { status: 'ready', chargePercent: 80, powerSource: 'AC', charging: true, runtimeEstimateSeconds: 3600 },
    findings: [],
    nextActions: [],
  },
  displayEvidence: {
    weather: { status: 'not_requested', data: null, retrievedAtUtc: null, source: { id: 'weather', type: 'derived' } },
    alerts: { status: 'not_requested', active: [], retrievedAtUtc: null, source: { id: 'alerts', type: 'derived' } },
  },
  diagnostics: [],
  ...overrides,
});

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload };
}

afterEach(() => vi.unstubAllGlobals());

describe('operations readiness API', () => {
  it('encodes brief IDs and uses the local URL by default', async () => {
    const fetcher = vi.fn(async () => response(validResponse()));
    vi.stubGlobal('fetch', fetcher);
    await getOperationsReadinessForBrief('brief/1');
    expect(fetcher).toHaveBeenCalledWith('/api/operations-readiness/brief%2F1', expect.objectContaining({ signal: undefined }));
  });

  it('uses the exact live URL only when requested', async () => {
    const fetcher = vi.fn(async () => response(validResponse()));
    vi.stubGlobal('fetch', fetcher);
    await getOperationsReadinessForBrief('brief/1', true);
    expect(fetcher).toHaveBeenCalledWith('/api/operations-readiness/brief%2F1?includeLiveWeather=true', expect.objectContaining({ signal: undefined }));
  });

  it('passes the abort signal through to fetch', async () => {
    const fetcher = vi.fn(async () => response(validResponse()));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    await getOperationsReadinessForBrief('brief/1', false, controller.signal);
    expect(fetcher).toHaveBeenCalledWith('/api/operations-readiness/brief%2F1', { signal: controller.signal });
  });

  it('rejects a mismatched brief response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(validResponse({ briefId: 'other-brief' }))));
    await expect(getOperationsReadinessForBrief('brief/1')).rejects.toMatchObject({ code: 'brief_mismatch', message: 'Operations Readiness could not be loaded from the local server.' });
  });

  it.each([
    ['summary', validResponse({ summary: { findings: [], nextActions: [] } })],
    ['plan', validResponse({ summary: { ...validResponse().summary, plan: { status: 'ready' } } })],
    ['ToughBook', validResponse({ summary: { ...validResponse().summary, toughBook: { status: 'ready', chargePercent: 80, powerSource: 'AC', charging: true, runtimeEstimateSeconds: -1 } } })],
    ['finding', validResponse({ summary: { ...validResponse().summary, findings: [{ id: 'finding', status: 'ready', priority: 'low', message: 'message', source: null, evaluatedAtUtc: '2026-08-21T04:00:00.000Z' }] } })],
    ['display evidence', validResponse({ displayEvidence: { weather: {}, alerts: {} } })],
    ['weather data', validResponse({ displayEvidence: { ...validResponse().displayEvidence, weather: { ...validResponse().displayEvidence.weather, status: 'live', retrievedAtUtc: '2026-08-21T04:00:00.000Z', data: { tempF: 72 } } } })],
    ['alerts', validResponse({ displayEvidence: { ...validResponse().displayEvidence, alerts: { ...validResponse().displayEvidence.alerts, active: [{ id: 'alert', severity: 'Unknown' }] } } })],
    ['status', validResponse({ displayEvidence: { weather: { status: 'fresh', source: { id: 'weather', type: 'derived' } }, alerts: validResponse().displayEvidence.alerts } })],
    ['JSON', null],
  ])('rejects malformed %s payloads', async (_label, payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(payload)));
    await expect(getOperationsReadinessForBrief('brief/1')).rejects.toBeInstanceOf(OperationsReadinessApiError);
  });

  it.each([
    ['brief_not_found', 'This SmartDeploy brief is no longer retained.'],
    ['unsupported_brief_schema', 'This retained brief uses an unsupported legacy schema for Operations Readiness.'],
    ['readiness_unavailable', 'Local readiness evidence is temporarily unavailable. The retained SmartDeploy brief remains available.'],
  ])('maps %s to its fixed safe message', async (code, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ code, message: 'raw provider details'.repeat(100) }, false)));
    await expect(getOperationsReadinessForBrief('brief/1')).rejects.toMatchObject({ code, message });
  });

  it('uses the fixed live failure message and suppresses raw backend text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ code: 'readiness_unavailable', message: 'secret provider failure'.repeat(100) }, false)));
    await expect(getOperationsReadinessForBrief('brief/1', true)).rejects.toMatchObject({ message: 'Live weather and alerts could not be loaded for the planned site. Local readiness evidence is preserved.' });
  });

  it('uses the fixed fallback for unknown backend errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ code: 'unknown', message: 'raw backend message' }, false)));
    await expect(getOperationsReadinessForBrief('brief/1')).rejects.toMatchObject({ code: 'request_failed', message: 'Operations Readiness could not be loaded from the local server.' });
  });

  it('uses the fixed contract error for malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ code: 'unsupported_brief_schema', message: 'raw malformed response' })));
    await expect(getOperationsReadinessForBrief('brief/1')).rejects.toMatchObject({ code: 'request_failed', message: 'Operations Readiness could not be loaded from the local server.' });
  });
});
