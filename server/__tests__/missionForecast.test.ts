import { describe, expect, it, vi } from 'vitest';
import { retrieveMissionForecast } from '../missionForecast';
import type { SmartDeployBriefV2 } from '../smartDeployBrief';

function brief(overrides: Record<string, unknown> = {}): SmartDeployBriefV2 {
  return {
    schemaVersion: 2,
    briefId: 'brief-forecast',
    activation: { program: 'POTA', reference: 'US-1', coordinates: null, provenance: { kind: 'externally_resolved' } },
    plannedOperatingSite: { location: { coordinates: { lat: 40, lon: -75 }, provenance: 'manual' }, source: 'operator_planned_override', description: 'planned' },
    missionWindow: { start: '2026-08-19T12:00:00.000Z', midpoint: '2026-08-19T13:00:00.000Z', end: '2026-08-19T14:00:00.000Z' },
    ...overrides,
  } as unknown as SmartDeployBriefV2;
}

function providerResponse(hourly: Record<string, unknown> = { time: ['2026-08-19T11:00', '2026-08-19T12:00', '2026-08-19T14:00'], temperature_2m: [1, 2, 3], precipitation_probability: [0, 0, 100], wind_speed_10m: [0, 4, 5], wind_direction_10m: [0, 90, 180], wind_gusts_10m: [0, 6, 7], weather_code: [0, 2, 61] }) {
  const body = { hourly };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('mission forecast adapter', () => {
  it('uses only the retained planned site and keeps valid zero values', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { expect(String(input)).toContain('latitude=40&longitude=-75'); return providerResponse(); });
    const result = await retrieveMissionForecast(brief(), { fetcher: fetcher as typeof fetch, now: new Date('2026-08-19T11:00:00.000Z') });
    expect(result.status).toBe('live');
    expect(result.record?.periods).toHaveLength(2);
    expect(result.record?.periods[0].precipitationProbability).toBe(0);
    expect(result.record?.periods[0].windSpeedMph).toBe(4);
  });

  it('does not contact a provider when retained planned coordinates are invalid', async () => {
    const fetcher = vi.fn();
    const result = await retrieveMissionForecast(brief({ plannedOperatingSite: { location: { coordinates: null, provenance: 'unavailable' } } }), { fetcher: fetcher as typeof fetch });
    expect(result.status).toBe('planned_coordinates_invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses interval intersection and includes both deterministic boundaries', async () => {
    const fetcher = vi.fn(async () => providerResponse({ time: ['2026-08-19T11:30', '2026-08-19T14:00', '2026-08-19T15:00'], temperature_2m: [1, 2, 3], precipitation_probability: [0, 0, 0], wind_speed_10m: [0, 0, 0], wind_direction_10m: [0, 0, 0], wind_gusts_10m: [0, 0, 0], weather_code: [0, 0, 0] }));
    const result = await retrieveMissionForecast(brief(), { fetcher: fetcher as typeof fetch, now: new Date('2026-08-19T11:00:00.000Z') });
    expect(result.record?.periods.map(period => period.startsAtUtc)).toEqual(['2026-08-19T11:30:00.000Z', '2026-08-19T14:00:00.000Z']);
  });

  it('rejects malformed or mismatched provider arrays and reports horizon explicitly', async () => {
    const mismatched = await retrieveMissionForecast(brief(), { fetcher: vi.fn(async () => providerResponse({ time: ['2026-08-19T12:00'], temperature_2m: [], precipitation_probability: [0], wind_speed_10m: [0], wind_direction_10m: [0], weather_code: [0] })) as typeof fetch });
    const horizon = await retrieveMissionForecast(brief({ missionWindow: { start: '2030-01-01T00:00:00Z', midpoint: '2030-01-01T01:00:00Z', end: '2030-01-01T02:00:00Z' } }), { fetcher: vi.fn(async () => providerResponse()) as typeof fetch });
    expect(mismatched.status).toBe('provider_unusable');
    expect(horizon.status).toBe('outside_provider_horizon');
  });

  it('bounds provider timeout and does not expose provider exception text', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('provider secret detail'))); }));
    const result = await retrieveMissionForecast(brief(), { fetcher: fetcher as typeof fetch, timeoutMs: 5 });
    expect(result.status).toBe('provider_unavailable');
    expect(result.message).not.toContain('provider secret detail');
  });

  it('rejects invalid numbers and timestamps without treating provider metadata as forecast evidence', async () => {
    const invalid = await retrieveMissionForecast(brief(), { fetcher: vi.fn(async () => providerResponse({ time: ['not-a-timestamp'], temperature_2m: [1], precipitation_probability: [0], wind_speed_10m: [0], wind_direction_10m: [0], wind_gusts_10m: [0], weather_code: [0] })) as typeof fetch });
    const result = await retrieveMissionForecast(brief(), { fetcher: vi.fn(async () => new Response(JSON.stringify({ generationtime_ms: 12, hourly: { time: ['2026-08-19T12:00'], temperature_2m: [0], precipitation_probability: [0], wind_speed_10m: [0], wind_direction_10m: [0], wind_gusts_10m: [0], weather_code: [0] } })) as Response) as typeof fetch, now: new Date('2026-08-24T00:00:00.000Z') });
    expect(invalid.status).toBe('provider_unusable');
    expect(result.record).not.toHaveProperty('generationtime_ms');
    expect(result.record?.retrievedAtUtc).toBe('2026-08-24T00:00:00.000Z');
  });
});