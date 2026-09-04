import { describe, expect, it, vi } from 'vitest';
import { MISSION_FORECAST_HOURLY_PRESENTATION_MAX_HOURS, deriveMissionForecastPeriods, retrieveMissionForecast } from '../missionForecast';
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
  it('keeps short missions hourly and preserves provider evidence', async () => {
    const result = await retrieveMissionForecast(brief(), { fetcher: vi.fn(async () => providerResponse()) as typeof fetch, now: new Date('2026-08-19T11:00:00.000Z') });
    expect(result.record?.presentation).toMatchObject({ mode: 'hourly', hourlyThresholdHours: MISSION_FORECAST_HOURLY_PRESENTATION_MAX_HOURS, boundaryStrategy: 'utc_fixed_six_hour_periods' });
    expect(result.record?.hourly).toHaveLength(1);
    expect(result.record?.hourly[0]).toMatchObject({ startsAtUtc: '2026-08-19T12:00:00.000Z', missionApplicable: true });
    expect(result.record?.operatingPeriods[0].hourlyObservationIndexes).toEqual([0]);
  });
  it('uses only the retained planned site and keeps valid zero values', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { expect(String(input)).toContain('latitude=40&longitude=-75'); return providerResponse(); });
    const result = await retrieveMissionForecast(brief(), { fetcher: fetcher as typeof fetch, now: new Date('2026-08-19T11:00:00.000Z') });
    expect(result.status).toBe('live');
    expect(result.record?.periods).toHaveLength(1);
    expect(result.record?.periods[0].precipitationProbability).toBe(0);
    expect(result.record?.periods[0].windSpeedMph).toBe(4);
  });

  it('requests a valid future same-day mission date explicitly', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { expect(String(input)).toContain('start_date=2026-08-26&end_date=2026-08-26'); return providerResponse({ time: ['2026-08-26T16:00', '2026-08-26T17:00'], temperature_2m: [72, 73], precipitation_probability: [0, 10], wind_speed_10m: [4, 5], wind_direction_10m: [180, 200], wind_gusts_10m: [6, 7], weather_code: [0, 1] }); });
    const result = await retrieveMissionForecast(brief({ missionWindow: { start: '2026-08-26T16:30:00.000Z', midpoint: '2026-08-26T17:30:00.000Z', end: '2026-08-26T19:30:00.000Z' } }), { fetcher: fetcher as typeof fetch, now: new Date('2026-08-26T11:30:00.000Z') });
    expect(result.status).toBe('live');
    expect(result.record?.periods).toHaveLength(2);
  });

  it('does not contact a provider when retained planned coordinates are invalid', async () => {
    const fetcher = vi.fn();
    const result = await retrieveMissionForecast(brief({ plannedOperatingSite: { location: { coordinates: null, provenance: 'unavailable' } } }), { fetcher: fetcher as typeof fetch });
    expect(result.status).toBe('planned_coordinates_invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses interval intersection and includes both deterministic boundaries', async () => {
    const fetcher = vi.fn(async () => providerResponse({ time: ['2026-08-19T11:00', '2026-08-19T13:00', '2026-08-19T14:00'], temperature_2m: [1, 2, 3], precipitation_probability: [0, 0, 0], wind_speed_10m: [0, 0, 0], wind_direction_10m: [0, 0, 0], wind_gusts_10m: [0, 0, 0], weather_code: [0, 0, 0] }));
    const result = await retrieveMissionForecast(brief(), { fetcher: fetcher as typeof fetch, now: new Date('2026-08-19T11:00:00.000Z') });
    expect(result.record?.periods.map(period => period.startsAtUtc)).toEqual(['2026-08-19T13:00:00.000Z']);
  });

  it('rejects non-hour-aligned provider timestamps as unusable', async () => {
    const result = await retrieveMissionForecast(brief(), { fetcher: vi.fn(async () => providerResponse({ time: ['2026-08-19T12:30'], temperature_2m: [1], precipitation_probability: [0], wind_speed_10m: [1], wind_direction_10m: [0], weather_code: [0] })) as typeof fetch });
    expect(result.status).toBe('provider_unusable');
    expect(result.record).toBeNull();
  });

  it('excludes a provider interval beginning exactly at mission end', async () => {
    const result = await retrieveMissionForecast(brief(), { fetcher: vi.fn(async () => providerResponse({ time: ['2026-08-19T12:00', '2026-08-19T14:00'], temperature_2m: [1, 2], precipitation_probability: [0, 0], wind_speed_10m: [1, 1], wind_direction_10m: [0, 0], weather_code: [0, 0] })) as typeof fetch });
    expect(result.record?.hourly).toHaveLength(1);
    expect(result.record?.hourly[0].missionApplicable).toBe(true);
  });

  it('uses canonical overlapping slots for non-hour-aligned mission boundaries', async () => {
    const result = await retrieveMissionForecast(brief({ missionWindow: { start: '2026-08-19T12:30:00.000Z', midpoint: '2026-08-19T13:30:00.000Z', end: '2026-08-19T14:30:00.000Z' } }), { fetcher: vi.fn(async () => providerResponse({ time: ['2026-08-19T12:00', '2026-08-19T13:00', '2026-08-19T14:00'], temperature_2m: [1, 2, 3], precipitation_probability: [0, 0, 0], wind_speed_10m: [1, 2, 3], wind_direction_10m: [0, 0, 0], weather_code: [0, 0, 0] })) as typeof fetch });
    expect(result.record?.operatingPeriods[0]).toMatchObject({ startsAtUtc: '2026-08-19T12:30:00.000Z', endsAtUtc: '2026-08-19T14:30:00.000Z', expectedHourlySlotCount: 3, observedHourlySlotCount: 3, missingHourlySlotCount: 0 });
  });

  it('counts clipped six-hour periods from canonical slots at a fractional end', async () => {
    const result = await retrieveMissionForecast(brief({ missionWindow: { start: '2026-08-19T12:00:00.000Z', midpoint: '2026-08-19T13:00:00.000Z', end: '2026-08-19T14:30:00.000Z' } }), { fetcher: vi.fn(async () => providerResponse({ time: ['2026-08-19T12:00', '2026-08-19T13:00', '2026-08-19T14:00'], temperature_2m: [1, 2, 3], precipitation_probability: [0, 0, 0], wind_speed_10m: [1, 2, 3], wind_direction_10m: [0, 0, 0], weather_code: [0, 0, 0] })) as typeof fetch });
    expect(result.record?.operatingPeriods[0].expectedHourlySlotCount).toBe(3);
  });

  it('rejects duplicate provider timestamps instead of double-counting observations', async () => {
    const result = await retrieveMissionForecast(brief(), { fetcher: vi.fn(async () => providerResponse({ time: ['2026-08-19T12:00', '2026-08-19T12:00'], temperature_2m: [1, 2], precipitation_probability: [0, 0], wind_speed_10m: [1, 2], wind_direction_10m: [0, 0], weather_code: [0, 0] })) as typeof fetch });
    expect(result.status).toBe('provider_unusable');
    expect(result.record).toBeNull();
  });

  it('derives clipped periods with the supplied record freshness', () => {
    const hourly = [{ startsAtUtc: '2026-08-19T12:00:00.000Z', endsAtUtc: '2026-08-19T13:00:00.000Z', missionApplicable: true, temperatureF: 1, precipitationProbability: 0, windSpeedMph: 1, windDirectionDegrees: 0, windDirection: 'N', weatherCode: 0, condition: 'Clear Sky' }];
    const periods = deriveMissionForecastPeriods({ missionWindow: { start: '2026-08-19T12:30:00.000Z', end: '2026-08-19T13:30:00.000Z' }, hourly, provider: { id: 'open-meteo-mission-forecast', name: 'Open-Meteo', timezone: 'UTC' }, retrievedAtUtc: '2026-08-19T11:00:00.000Z', limitations: [], freshness: 'retained' });
    expect(periods[0].freshness).toBe('retained');
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

  it('uses compact UTC periods for a Friday-through-Sunday mission and exposes deterministic ranges', async () => {
    const start = Date.parse('2026-08-21T00:00:00.000Z'); const times = Array.from({ length: 72 }, (_, index) => `${new Date(start + index * 3_600_000).toISOString().slice(0, 13)}:00`);
    const result = await retrieveMissionForecast(brief({ missionWindow: { start: '2026-08-21T00:00:00.000Z', midpoint: '2026-08-22T12:00:00.000Z', end: '2026-08-23T23:00:00.000Z' } }), { fetcher: vi.fn(async () => providerResponse({ time: times, temperature_2m: times.map((_, index) => 50 + index), precipitation_probability: times.map((_, index) => index % 100), wind_speed_10m: times.map((_, index) => index % 20), wind_direction_10m: times.map(() => 90), wind_gusts_10m: times.map((_, index) => 20 + index), weather_code: times.map((_, index) => index % 2 ? 2 : 0) })) as typeof fetch, now: new Date('2026-08-20T00:00:00.000Z') });
    expect(result.record?.presentation.mode).toBe('aggregated');
    expect(result.record?.operatingPeriods.length).toBeGreaterThan(8);
    expect(result.record?.operatingPeriods[0]).toMatchObject({ label: 'Overnight (UTC)', timezoneLabel: 'UTC', expectedHourlySlotCount: 6, observedHourlySlotCount: 6, coverageStatus: 'complete', temperatureMinF: 50, temperatureMaxF: 55, precipitationProbabilityMax: 5, sustainedWindMinMph: 0, sustainedWindMaxMph: 5, windGustMaxMph: 25, significantCondition: 'Cloudy' });
    expect(result.record?.operatingPeriods[0].hourlyObservationTimestampsUtc).toHaveLength(6);
  });

  it('marks a missing hour and horizon shortfall without interpolation or fabricated gusts', async () => {
    const times = ['2026-08-19T00:00', '2026-08-19T01:00', '2026-08-19T03:00', '2026-08-19T04:00'];
    const result = await retrieveMissionForecast(brief({ missionWindow: { start: '2026-08-19T00:00:00.000Z', midpoint: '2026-08-19T06:00:00.000Z', end: '2026-08-19T06:00:00.000Z' } }), { fetcher: vi.fn(async () => providerResponse({ time: times, temperature_2m: [10, 11, 13, 14], precipitation_probability: [0, 10, 20, 30], wind_speed_10m: [1, 2, 3, 4], wind_direction_10m: [0, 0, 0, 0], weather_code: [0, 0, 2, 2] })) as typeof fetch });
    expect(result.record?.coverageStatus).toBe('partial');
    expect(result.record?.hourly).toHaveLength(4);
    expect(result.record?.hourly[0].windGustMph).toBeUndefined();
    expect(result.record?.operatingPeriods[0]).toMatchObject({ expectedHourlySlotCount: 6, observedHourlySlotCount: 4, missingHourlySlotCount: 2, coverageStatus: 'partial' });
    expect(result.record?.operatingPeriods[0].limitations.some(item => item.includes('no interpolation'))).toBe(true);
  });

  it('labels a mission crossing midnight with UTC boundaries', async () => {
    const result = await retrieveMissionForecast(brief({ missionWindow: { start: '2026-08-19T23:00:00.000Z', midpoint: '2026-08-20T00:00:00.000Z', end: '2026-08-20T02:00:00.000Z' } }), { fetcher: vi.fn(async () => providerResponse({ time: ['2026-08-19T23:00', '2026-08-20T00:00', '2026-08-20T01:00'], temperature_2m: [1, 2, 3], precipitation_probability: [0, 0, 0], wind_speed_10m: [1, 1, 1], wind_direction_10m: [0, 0, 0], weather_code: [0, 0, 0] })) as typeof fetch });
    expect(result.record?.operatingPeriods.map(period => period.timezoneLabel)).toEqual(['UTC', 'UTC']);
    expect(result.record?.operatingPeriods[0].startsAtUtc).toBe('2026-08-19T23:00:00.000Z');
    expect(result.record?.operatingPeriods[0].endsAtUtc).toBe('2026-08-20T00:00:00.000Z');
    expect(result.record?.operatingPeriods[1].startsAtUtc).toBe('2026-08-20T00:00:00.000Z');
    expect(result.record?.operatingPeriods[1].endsAtUtc).toBe('2026-08-20T02:00:00.000Z');
  });
});