import { describe, expect, it } from 'vitest';

import {
  getActiveAlertsApiResponse,
  getCurrentWeatherApiResponse,
  getWeatherApiResponse,
} from '../weather';

const NOW = new Date('2026-07-28T16:00:00.000Z');

describe('weather and NOAA partial-failure semantics', () => {
  it('distinguishes a successful zero-alert check from unavailable weather', async () => {
    const result = await getWeatherApiResponse(38, -79, routeFetch({ weatherOk: false, alertsOk: true }), NOW);

    expect(result.weather).toBeNull();
    expect(result.weatherStatus).toBe('unavailable');
    expect(result.alerts).toEqual([]);
    expect(result.alertsStatus).toBe('live');
  });

  it('retains live weather when the NOAA alert check is unavailable', async () => {
    const result = await getWeatherApiResponse(38, -79, routeFetch({ weatherOk: true, alertsOk: false }), NOW);

    expect(result.weatherStatus).toBe('live');
    expect(result.weather).toMatchObject({ tempF: 41, windMph: 12, locationName: 'Elkins, WV' });
    expect(result.alerts).toBeNull();
    expect(result.alertsStatus).toBe('unavailable');
  });

  it('does not fabricate plausible conditions from an incomplete provider response', async () => {
    const result = await getWeatherApiResponse(38, -79, async (input) => {
      if (String(input).includes('open-meteo')) return jsonResponse({ current: { temperature_2m: 78 } });
      return jsonResponse({ features: [] });
    }, NOW);

    expect(result.weather).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Clear Sky');
  });

  it('preserves valid zero coordinates in all provider requests', async () => {
    const urls: string[] = [];
    await getWeatherApiResponse(0, 0, async (input) => {
      urls.push(String(input));
      return String(input).includes('open-meteo')
        ? jsonResponse(weatherBody())
        : jsonResponse(String(input).includes('/points/') ? pointBody() : { features: [] });
    }, NOW);

    expect(urls).toHaveLength(3);
    expect(urls.every((url) => url.includes('0.0000,0.0000') || url.includes('latitude=0&longitude=0'))).toBe(true);
  });

  it('refreshes current weather and NOAA alerts through independent provider calls', async () => {
    const weatherUrls: string[] = [];
    const alertUrls: string[] = [];

    const weatherResult = await getCurrentWeatherApiResponse(38, -79, async (input) => {
      weatherUrls.push(String(input));
      return jsonResponse(String(input).includes('/points/') ? pointBody() : weatherBody());
    }, NOW);
    const alertResult = await getActiveAlertsApiResponse(38, -79, async (input) => {
      alertUrls.push(String(input));
      return jsonResponse({ features: [] });
    });

    expect(weatherResult.weatherStatus).toBe('live');
    expect(alertResult).toEqual({ alerts: [], alertsStatus: 'live' });
    expect(weatherUrls).toHaveLength(2);
    expect(weatherUrls.some((url) => url.includes('/alerts/'))).toBe(false);
    expect(alertUrls).toHaveLength(1);
    expect(alertUrls[0]).toContain('/alerts/active');
  });
});

function routeFetch(options: { weatherOk: boolean; alertsOk: boolean }): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes('/points/')) return jsonResponse(pointBody());
    if (url.includes('/alerts/')) return options.alertsOk ? jsonResponse({ features: [] }) : errorResponse();
    return options.weatherOk ? jsonResponse(weatherBody()) : errorResponse();
  };
}

function pointBody() {
  return { properties: { relativeLocation: { properties: { city: 'Elkins', state: 'WV' } } } };
}

function weatherBody() {
  return {
    current: {
      temperature_2m: 41,
      relative_humidity_2m: 70,
      pressure_msl: 1012,
      wind_speed_10m: 12,
      wind_direction_10m: 270,
      wind_gusts_10m: 18,
      weather_code: 3,
      uv_index: 1,
    },
    hourly: { time: [] },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(): Response {
  return new Response(null, { status: 503 });
}
