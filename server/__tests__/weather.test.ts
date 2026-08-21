import { describe, expect, it } from 'vitest';

import {
  getActiveAlertsApiResponse,
  getCurrentWeatherApiResponse,
  getWeatherApiResponse,
  parseWeatherCoordinates,
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

  it.each([
    ['0', '0', { latitude: 0, longitude: 0 }],
    ['-90', '-180', { latitude: -90, longitude: -180 }],
    ['90', '180', { latitude: 90, longitude: 180 }],
    ['37.5', '-77.4', { latitude: 37.5, longitude: -77.4 }],
  ])('accepts coordinate boundary %s, %s', (latitude, longitude, expected) => {
    expect(parseWeatherCoordinates(latitude, longitude)).toEqual(expected);
  });

  it.each([
    [undefined, '-77'],
    ['', '-77'],
    ['NaN', '-77'],
    ['Infinity', '-77'],
    ['90.0001', '0'],
    ['-90.0001', '0'],
    ['0', '180.0001'],
    ['0', '-180.0001'],
  ])('rejects invalid coordinates %s, %s', (latitude, longitude) => {
    expect(parseWeatherCoordinates(latitude, longitude)).toBeNull();
  });

  it('treats legitimate zero weather measurements as live data', async () => {
    const body = weatherBody();
    Object.assign(body.current, {
      temperature_2m: 0,
      relative_humidity_2m: 0,
      wind_speed_10m: 0,
      wind_direction_10m: 0,
      wind_gusts_10m: 0,
      weather_code: 0,
      uv_index: 0,
    });
    const result = await getCurrentWeatherApiResponse(0, 0, async (input) =>
      jsonResponse(String(input).includes('/points/') ? pointBody() : body), NOW);

    expect(result.weatherStatus).toBe('live');
    expect(result.weather).toMatchObject({ tempF: 0, humidity: 0, windMph: 0, windGustMph: 0, uvIndex: 0 });
  });

  it('fails closed for malformed NOAA features', async () => {
    const result = await getActiveAlertsApiResponse(38, -79, async () =>
      jsonResponse({ features: [null] }), NOW);

    expect(result).toEqual({ alerts: null, alertsStatus: 'unavailable' });
  });

  it('deduplicates alerts, excludes expired alerts, and permits missing optional times', async () => {
    const active = alertFeature('active', undefined);
    const result = await getActiveAlertsApiResponse(38, -79, async () => jsonResponse({
      features: [
        active,
        active,
        alertFeature('expired', '2026-07-28T15:59:59.000Z'),
      ],
    }), NOW);

    expect(result.alertsStatus).toBe('live');
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts?.[0]).toMatchObject({ id: 'active', severity: 'Unknown', expires: 'Until further notice' });
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

function alertFeature(id: string, expires: string | undefined) {
  return {
    id,
    properties: {
      event: 'High Wind Warning',
      description: 'Strong winds expected.',
      areaDesc: 'Test County',
      ...(expires === undefined ? {} : { expires }),
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(): Response {
  return new Response(null, { status: 503 });
}
