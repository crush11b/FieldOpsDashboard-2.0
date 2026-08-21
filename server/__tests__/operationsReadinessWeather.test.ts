import { describe, expect, it, vi } from 'vitest';
import { enrichOperationsReadinessWeather } from '../operationsReadinessWeather';
import type { SmartDeployBriefV2 } from '../smartDeployBrief';

const NOW = new Date('2026-08-20T12:00:00.000Z');

function brief(coordinates: { lat: number; lon: number } | null, currentDevice = { lat: 40, lon: -80 }): SmartDeployBriefV2 {
  return {
    schemaVersion: 2,
    briefId: 'brief-1',
    generatedAtUtc: NOW.toISOString(),
    status: 'complete',
    activation: {} as never,
    plannedOperatingSite: {
      location: { coordinates } as never,
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

function fetcher(options: { weatherOk?: boolean; alertsOk?: boolean; urls?: string[] } = {}): typeof fetch {
  return async input => {
    const url = String(input);
    options.urls?.push(url);
    if (url.includes('/alerts/')) return options.alertsOk === false ? new Response(null, { status: 503 }) : json({ features: [alert()] });
    if (url.includes('/points/')) return json({ properties: { relativeLocation: { properties: { city: 'Elkins', state: 'WV' } } } });
    return options.weatherOk === false ? new Response(null, { status: 503 }) : json({ current: { temperature_2m: 41, relative_humidity_2m: 70, pressure_msl: 1012, wind_speed_10m: 12, wind_direction_10m: 270, wind_gusts_10m: 18, weather_code: 3, uv_index: 1 }, hourly: { time: [] } });
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
    expect(urls.every(url => url.includes('37.0000,-77.0000') || url.includes('latitude=37&longitude=-77'))).toBe(true);
    expect(urls.some(url => url.includes('40.0000,-80.0000'))).toBe(false);
  });

  it('does not call providers when planned-site coordinates are missing', async () => {
    const fetchSpy = vi.fn(fetcher());
    const result = await enrichOperationsReadinessWeather(brief(null), { fetcher: fetchSpy, now: NOW });
    expect(result.weather.status).toBe('unavailable');
    expect(result.alerts.status).toBe('unavailable');
    expect(result.diagnostics[0].code).toBe('planned_site_coordinates_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('degrades weather and alerts independently', async () => {
    const weatherUnavailable = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), { fetcher: fetcher({ weatherOk: false }), now: NOW });
    expect(weatherUnavailable.weather.status).toBe('unavailable');
    expect(weatherUnavailable.alerts.status).toBe('live');

    const alertsUnavailable = await enrichOperationsReadinessWeather(brief({ lat: 37, lon: -77 }), { fetcher: fetcher({ alertsOk: false }), now: NOW });
    expect(alertsUnavailable.weather.status).toBe('live');
    expect(alertsUnavailable.alerts.status).toBe('unavailable');
  });
});
