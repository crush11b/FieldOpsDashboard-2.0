import { describe, expect, it } from 'vitest';
import { POTA_TARGET_FRESH_MS, POTA_TARGET_STALE_MS, PotaActivationTargetResolver, normalizePotaReference } from '../potaTargetResolver';
import type { ActivationTarget } from '../../src/planning/smartDeployPlanning';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const park = { reference: 'US-1234', name: 'Test Park', latitude: 38.123, longitude: -78.456 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function resolver(fetcher: typeof fetch, now: () => Date = () => NOW): PotaActivationTargetResolver {
  return new PotaActivationTargetResolver({ fetcher, now });
}

describe('POTA activation target resolver', () => {
  it('normalizes current references conservatively', () => {
    expect(normalizePotaReference(' us-1234 ')).toBe('US-1234');
    expect(normalizePotaReference('ca-5082')).toBe('CA-5082');
    expect(normalizePotaReference('ABC-12345')).toBe('ABC-12345');
    expect(normalizePotaReference('K-1234')).toBeNull();
    expect(normalizePotaReference('US-12')).toBeNull();
    expect(normalizePotaReference('US-12/34')).toBeNull();
  });

  it('rejects invalid input without making a provider request', async () => {
    let calls = 0;
    const result = await resolver(async () => { calls += 1; return jsonResponse(park); }).resolve('K-1234');
    expect(result.status).toBe('invalid');
    expect(calls).toBe(0);
  });

  it('maps a valid provider response directly to the provider-neutral target contract', async () => {
    let requestedUrl = '';
    const result = await resolver(async input => { requestedUrl = String(input); return jsonResponse(park); }).resolve(' us-1234 ');
    expect(result).toMatchObject({ status: 'live', reference: 'US-1234', target: {
      program: 'POTA', reference: 'US-1234', displayName: 'Test Park', coordinates: { lat: park.latitude, lon: park.longitude },
      provenance: { kind: 'externally_resolved', source: { id: 'pota-api', type: 'pota_individual_park_api' }, resolvedAtUtc: NOW.toISOString() },
    }, retrievedAtUtc: NOW.toISOString() });
    expect(result.target?.gridSquare).toBe('FM08sc');
    const target: ActivationTarget | undefined = result.target;
    expect(target?.program).toBe('POTA');
    expect(requestedUrl).toBe('https://api.pota.app/park/US-1234');
  });

  it('accepts the provider-neutral POTA target request without changing normalization or provenance', async () => {
    const result = await resolver(async input => jsonResponse(park)).resolve({ program: 'POTA', reference: ' us-1234 ' });
    expect(result).toMatchObject({ status: 'live', reference: 'US-1234', target: {
      program: 'POTA', reference: 'US-1234', coordinates: { lat: park.latitude, lon: park.longitude },
      provenance: { kind: 'externally_resolved', source: { id: 'pota-api' }, resolvedAtUtc: NOW.toISOString() },
    } });
  });

  it('returns unknown for null and authoritative not-found responses without stale fallback', async () => {
    let mode: 'live' | 'unknown' = 'live';
    let now = NOW;
    const service = resolver(async (_input) => mode === 'live' ? jsonResponse(park) : jsonResponse(null), () => now);
    await service.resolve('US-1234');
    mode = 'unknown';
    now = new Date(NOW.getTime() + POTA_TARGET_FRESH_MS + 1);
    expect((await service.resolve('US-1234')).status).toBe('unknown');
  });

  it('returns unavailable for non-success, malformed JSON, and unusable provider data', async () => {
    expect((await resolver(async () => jsonResponse({}, 503)).resolve('US-1234')).status).toBe('unavailable');
    expect((await resolver(async () => new Response('{bad', { status: 200 })).resolve('US-1234')).status).toBe('unavailable');
    expect((await resolver(async () => jsonResponse({ ...park, latitude: '38.123' })).resolve('US-1234')).status).toBe('unavailable');
    expect((await resolver(async () => jsonResponse({ ...park, longitude: 181 })).resolve('US-1234')).status).toBe('unavailable');
  });

  it('aborts a hung provider request at the configured timeout', async () => {
    const result = await new PotaActivationTargetResolver({ timeoutMs: 1, fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }) }).resolve('US-1234');
    expect(result.status).toBe('unavailable');
    expect(result.error).toBe('POTA provider is unavailable.');
  });

  it('uses fresh cache without a second request and refreshes after six hours', async () => {
    let now = NOW;
    let calls = 0;
    const service = resolver(async () => { calls += 1; return jsonResponse(park); }, () => now);
    expect((await service.resolve('US-1234')).status).toBe('live');
    expect((await service.resolve('US-1234')).status).toBe('cached');
    expect(calls).toBe(1);
    now = new Date(NOW.getTime() + POTA_TARGET_FRESH_MS + 1);
    expect((await service.resolve('US-1234')).status).toBe('live');
    expect(calls).toBe(2);
  });

  it('uses a stale fallback only after a failed refresh within seven days', async () => {
    let now = NOW;
    let online = true;
    const service = resolver(async () => online ? jsonResponse(park) : Promise.reject(new Error('offline')), () => now);
    await service.resolve('US-1234');
    now = new Date(NOW.getTime() + POTA_TARGET_FRESH_MS + 1);
    online = false;
    const stale = await service.resolve('US-1234');
    expect(stale.status).toBe('stale');
    expect(stale.retrievedAtUtc).toBe(NOW.toISOString());
    expect(stale.refreshAttemptedAtUtc).toBe(now.toISOString());
    now = new Date(NOW.getTime() + POTA_TARGET_STALE_MS + 1);
    expect((await service.resolve('US-1234')).status).toBe('unavailable');
  });
});