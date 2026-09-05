import { describe, expect, it, vi } from 'vitest';
import { enrichOperationsReadinessWeather } from '../operationsReadinessWeather';
import type { SmartDeployBriefV2 } from '../smartDeployBrief';

const NOW = new Date('2026-08-20T12:00:00.000Z');

function brief(
  coordinates: { lat: number; lon: number } | null,
  currentDevice = { lat: 40, lon: -80 },
  sourceType = 'manual_planned_site_coordinates',
  planningSemantics?: 'provider_reference_default' | 'operator_selected_current_device' | 'operator_planned_override',
): SmartDeployBriefV2 {
  return {
    schemaVersion: 2,
    briefId: 'brief-1',
    generatedAtUtc: NOW.toISOString(),
    status: 'complete',
    activation: {} as never,
    plannedOperatingSite: {
      location: { coordinates, source: { id: 'planned-test', type: sourceType }, ...(planningSemantics ? { planningSemantics } : {}) } as never,
      source: 'operator_planned_override',
      description: 'Planned site',
    },
    currentDeviceLocation: { coordinates: currentDevice } as never,
    propagationObjective: {} as never,
    missionWindow: {} as never,
    station: {} as never,
    sections: {} as never,
    limitations: [],
    summary: 'Test brief',
  } as SmartDeployBriefV2;
}

function fetcher(options: { weatherOk?: boolean; alertsOk?: boolean; alertsEmpty?: boolean; timezone?: string; urls?: string[] } = {}): typeof fetch {
  return async input => {
    const url = String(input);
    options.urls?.push(url);
    if (url.includes('/alerts/')) return options.alertsOk === false ? new Response(null, { status: 503 }) : json({ features: options.alertsEmpty ? [] : [alert()] });
    if (url.includes('/points/')) return json({ properties: { relativeLocation: { properties: { city: 'Elkins', state: 'WV' } } } });
    return options.weatherOk === false ? new Response(null, { status: 503 }) : json({
      current: { temperature_2m: 41, relative_humidity_2m: 70, pressure_msl: 1012, wind_speed_10m: 12, wind_direction_10m: 270, wind_gusts_10m: 18, weather_code: 3, uv_index: 1 },
      timezone: options.timezone,
      hourly: { time: ['2026-08-20T12:00:00Z'], temperature_2m: [42], weather_code: [2], precipitation_probability: [20], wind_speed_10m: [10] },
    });
  };
}

function alert() {
  return { id: 'alert-1', properties: { event: 'High Wind Warning', description: 'Strong winds expected.', areaDesc: 'Test County' } };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('Operations Readiness planned-site weather enrichment', () => {
  it('uses only retained planned-site coordinates', async () => {
    const urls: string[] = [];
    const result = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), { fetcher: fetcher({ urls }), now: NOW });
    expect(result.weather.status).toBe('live');
    expect(result.alerts.active[0]).toMatchObject({ severity: 'Unknown' });
    expect(result.displayEvidence.weather).toMatchObject({
      status: 'live',
      retrievedAtUtc: NOW.toISOString(),
      data: {
        tempF: 41,
        tempC: 5,
        humidity: 70,
        pressureInHg: 29.88,
        pressureHpa: 1012,
        windMph: 12,
        windGustMph: 18,
        windDir: 'W',
        condition: 'Partly Cloudy',
        locationName: 'Elkins, WV',
        dewPointF: 30,
        uvIndex: 1,
        lastUpdated: NOW.toISOString(),
        cached: false,
        hourlyForecast: [{ tempF: 42, precipProb: 20, windMph: 10, weatherCode: 2, time: expect.any(String) }],
      },
    });
    expect(result.displayEvidence.alerts).toMatchObject({
      status: 'live',
      retrievedAtUtc: NOW.toISOString(),
      active: [{ id: 'alert-1', severity: 'Unknown', title: 'High Wind Warning', description: 'Strong winds expected.', area: 'Test County', issued: 'Recently', expires: 'Until further notice' }],
    });
    const hourly = result.displayEvidence.weather.data?.hourlyForecast?.[0];
    expect(hourly?.time).toEqual(expect.any(String));
    expect(hourly?.time).not.toBe('');
    expect(urls).toHaveLength(3);
    expect(urls.filter(url => url.includes('api.open-meteo.com'))).toHaveLength(1);
    expect(urls.filter(url => url.includes('/points/'))).toHaveLength(1);
    expect(urls.filter(url => url.includes('/alerts/'))).toHaveLength(1);
    expect(urls.every(url => url.includes('37.0000,-77.0000') || url.includes('latitude=37&longitude=-77'))).toBe(true);
    expect(urls.some(url => url.includes('40.0000,-80.0000'))).toBe(false);
  });

  it('retains a successful retrieval timestamp for zero active alerts', async () => {
    const result = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), { fetcher: fetcher({ alertsEmpty: true }), now: NOW });
    expect(result.alerts.status).toBe('live');
    expect(result.displayEvidence.alerts).toMatchObject({ status: 'live', active: [], retrievedAtUtc: NOW.toISOString() });
  });

  it('requests and retains UTC so the browser can render operator-local time once', async () => {
    const result = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), { fetcher: fetcher({ timezone: 'America/New_York' }), now: NOW });
    expect(result.displayEvidence.weather.data).toMatchObject({ timezone: 'UTC', hourlyForecast: [{ time: '12 PM', utcTime: '2026-08-20T12:00:00.000Z' }] });
  });

  it('does not call providers when planned-site coordinates are missing', async () => {
    const fetchSpy = vi.fn(fetcher());
    const result = await enrichOperationsReadinessWeather(brief(null), { fetcher: fetchSpy, now: NOW });
    expect(result.weather.status).toBe('unavailable');
    expect(result.alerts.status).toBe('unavailable');
    expect(result.displayEvidence.weather).toMatchObject({ status: 'unavailable', data: null, retrievedAtUtc: null });
    expect(result.displayEvidence.alerts).toMatchObject({ status: 'unavailable', active: [], retrievedAtUtc: null });
    expect(result.displayEvidence.weather.limitation).toContain('no valid coordinates');
    expect(result.displayEvidence.alerts.limitation).toContain('no valid coordinates');
    expect(result.diagnostics[0].code).toBe('planned_site_coordinates_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['latitude NaN', { lat: Number.NaN, lon: -77 }],
    ['latitude positive Infinity', { lat: Number.POSITIVE_INFINITY, lon: -77 }],
    ['latitude negative Infinity', { lat: Number.NEGATIVE_INFINITY, lon: -77 }],
    ['latitude below -90', { lat: -90.001, lon: -77 }],
    ['latitude above 90', { lat: 90.001, lon: -77 }],
    ['longitude NaN', { lat: 37, lon: Number.NaN }],
    ['longitude positive Infinity', { lat: 37, lon: Number.POSITIVE_INFINITY }],
    ['longitude negative Infinity', { lat: 37, lon: Number.NEGATIVE_INFINITY }],
    ['longitude below -180', { lat: 37, lon: -180.001 }],
    ['longitude above 180', { lat: 37, lon: 180.001 }],
    ['missing coordinates', null],
  ] as const)('rejects %s without using current-device coordinates', async (_label, coordinates) => {
    const fetchSpy = vi.fn(fetcher());
    const result = await enrichOperationsReadinessWeather(brief(coordinates), { fetcher: fetchSpy, now: NOW });
    expect(result.weather.status).toBe('unavailable');
    expect(result.alerts.status).toBe('unavailable');
    expect(result.diagnostics[0].code).toBe('planned_site_coordinates_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', { lat: 0, lon: 0 }],
    ['latitude minimum', { lat: -90, lon: 0 }],
    ['latitude maximum', { lat: 90, lon: 0 }],
    ['longitude minimum', { lat: 0, lon: -180 }],
    ['longitude maximum', { lat: 0, lon: 180 }],
    ['ordinary valid coordinates', { lat: 37, lon: -77 }],
  ] as const)('accepts %s planned-site coordinates', async (_label, coordinates) => {
    const fetchSpy = vi.fn(fetcher());
    const result = await enrichOperationsReadinessWeather(brief(coordinates), { fetcher: fetchSpy, now: NOW });
    expect(result.weather.status).toBe('live');
    expect(result.alerts.status).toBe('live');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('degrades weather and alerts independently', async () => {
    const weatherUnavailable = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), { fetcher: fetcher({ weatherOk: false }), now: NOW });
    expect(weatherUnavailable.weather.status).toBe('unavailable');
    expect(weatherUnavailable.alerts.status).toBe('live');
    expect(weatherUnavailable.displayEvidence.weather.status).toBe('unavailable');
    expect(weatherUnavailable.displayEvidence.alerts.status).toBe('live');
    expect(weatherUnavailable.displayEvidence.weather.retrievedAtUtc).toBeNull();
    expect(weatherUnavailable.displayEvidence.alerts.retrievedAtUtc).toBe(NOW.toISOString());
    expect(weatherUnavailable.displayEvidence.weather.limitation).toContain('did not return usable data');

    const alertsUnavailable = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), { fetcher: fetcher({ alertsOk: false }), now: NOW });
    expect(alertsUnavailable.weather.status).toBe('live');
    expect(alertsUnavailable.alerts.status).toBe('unavailable');
    expect(alertsUnavailable.displayEvidence.weather.status).toBe('live');
    expect(alertsUnavailable.displayEvidence.alerts.status).toBe('unavailable');
    expect(alertsUnavailable.displayEvidence.weather.retrievedAtUtc).toBe(NOW.toISOString());
    expect(alertsUnavailable.displayEvidence.alerts.retrievedAtUtc).toBeNull();
    expect(alertsUnavailable.displayEvidence.alerts.limitation).toContain('did not return usable data');
  });

  it('times out current weather without preventing alerts from succeeding', async () => {
    const result = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), {
      fetcher: abortingFetcher('weather'),
      timeoutMs: 1,
      now: NOW,
    });
    expect(result.weather.status).toBe('unavailable');
    expect(result.alerts.status).toBe('live');
    expect(result.displayEvidence.weather.retrievedAtUtc).toBeNull();
    expect(result.displayEvidence.alerts.retrievedAtUtc).toBe(NOW.toISOString());
    expect(result.diagnostics).toEqual([{ code: 'planned_site_weather_unavailable', message: 'Live weather for the retained planned operating site is unavailable.' }]);
    expect(JSON.stringify(result)).not.toContain('raw timeout');
  });

  it('times out alerts without preventing current weather from succeeding', async () => {
    const result = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), {
      fetcher: abortingFetcher('alerts'),
      timeoutMs: 1,
      now: NOW,
    });
    expect(result.weather.status).toBe('live');
    expect(result.alerts.status).toBe('unavailable');
    expect(result.displayEvidence.weather.retrievedAtUtc).toBe(NOW.toISOString());
    expect(result.displayEvidence.alerts.retrievedAtUtc).toBeNull();
    expect(result.diagnostics).toEqual([{ code: 'planned_site_alerts_unavailable', message: 'Live weather alerts for the retained planned operating site are unavailable.' }]);
    expect(JSON.stringify(result)).not.toContain('raw timeout');
  });

  it('preserves planned-site provenance limitations', async () => {
    const providerReference = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }, { lat: 40, lon: -80 }, 'activation_provider_reference', 'provider_reference_default'), { fetcher: fetcher(), now: NOW });
    expect(providerReference.weather.limitation).toContain('provider reference coordinate');
    expect(providerReference.alerts.limitation).toContain('provider reference coordinate');
    expect(providerReference.displayEvidence.weather.limitation).toContain('provider reference coordinate');
    expect(providerReference.displayEvidence.alerts.limitation).toContain('provider reference coordinate');

    const gridCenter = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }, { lat: 40, lon: -80 }, 'manual_planned_site_grid'), { fetcher: fetcher(), now: NOW });
    expect(gridCenter.weather.limitation).toContain('center of the entered Maidenhead grid');
    expect(gridCenter.alerts.limitation).toContain('center of the entered Maidenhead grid');
    expect(gridCenter.displayEvidence.weather.limitation).toContain('center of the entered Maidenhead grid');
    expect(gridCenter.displayEvidence.alerts.limitation).toContain('center of the entered Maidenhead grid');
  });
});

function abortingFetcher(blocked: 'weather' | 'alerts'): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const shouldBlock = blocked === 'weather' ? url.includes('open-meteo') : url.includes('/alerts/');
    if (!shouldBlock) return fetcher()(input);
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () => {
        const error = new Error('raw timeout provider detail');
        error.name = 'AbortError';
        reject(error);
      };
      if (init?.signal?.aborted) onAbort();
      else init?.signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
}
