/* @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GPSProvenance, GPSStatus } from '../types';
import { INITIAL_CONFIG } from '../data/defaultConfig';
import App from '../App';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function jsonResponse(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => payload };
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const currentProvenance: GPSProvenance = {
  status: 'ok',
  source: { id: 'gps:test', type: 'serial_nmea', name: 'Test GNSS' },
};

vi.mock('../components/GPSGridWidget', () => ({
  GPSGridWidget: (props: { onUpdateGPS: (updated: Partial<GPSStatus>, provenance?: GPSProvenance) => void }) => {
    React.useEffect(() => {
      props.onUpdateGPS({ lat: 40, lon: -75, gridSquare: 'FN10aa' }, currentProvenance);
    }, []);
    return React.createElement('div', { 'data-testid': 'gps-widget' }, [
      React.createElement('button', { key: 'jitter', onClick: () => props.onUpdateGPS({ lat: 40.001, lon: -75 }, currentProvenance), 'data-testid': 'gps-jitter' }, 'jitter'),
      React.createElement('button', { key: 'move', onClick: () => props.onUpdateGPS({ lat: 40.01, lon: -75 }, currentProvenance), 'data-testid': 'gps-move' }, 'move'),
    ]);
  },
}));

vi.mock('../components/BatteryStatusWidget', () => ({ BatteryStatusWidget: () => React.createElement('div', { 'data-testid': 'battery-widget' }) }));
vi.mock('../components/WeatherNOAAWidget', () => ({
  WeatherNOAAWidget: (props: { weather: { tempF?: number } | null }) => React.createElement('div', { 'data-testid': 'weather-value' }, String(props.weather?.tempF ?? 'none')),
}));
vi.mock('../components/VOACAPPropagationWidget', () => ({ VOACAPPropagationWidget: () => React.createElement('div') }));
vi.mock('../components/AppLauncherGrid', () => ({ AppLauncherGrid: () => React.createElement('div') }));
vi.mock('../components/ConfigModal', () => ({ ConfigModal: () => null }));
vi.mock('../components/RoadmapToolsModal', () => ({ RoadmapToolsModal: () => null }));
vi.mock('../components/TouchMenuDrawer', () => ({ TouchMenuDrawer: () => null }));

describe('App weather and NOAA polling integration', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let weatherResponses: Array<Deferred<ReturnType<typeof jsonResponse>>>;
  let alertResponses: Array<Deferred<ReturnType<typeof jsonResponse>>>;
  let weatherUrls: string[];
  let alertUrls: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    weatherResponses = [];
    alertResponses = [];
    weatherUrls = [];
    alertUrls = [];
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/config') return Promise.resolve(jsonResponse({ config: INITIAL_CONFIG }));
      if (url === '/api/solar-data') return Promise.resolve(jsonResponse({}));
      if (url.startsWith('/api/weather/current')) {
        weatherUrls.push(url);
        const response = deferred<ReturnType<typeof jsonResponse>>();
        weatherResponses.push(response);
        return response.promise;
      }
      if (url.startsWith('/api/weather/alerts')) {
        alertUrls.push(url);
        if (alertResponses.length >= 2) return Promise.resolve(jsonResponse({ alerts: [], alertsStatus: 'live' }));
        const response = deferred<ReturnType<typeof jsonResponse>>();
        alertResponses.push(response);
        return response.promise;
      }
      return Promise.resolve(jsonResponse({}, false));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('polls the real App effects by location, interval, and cleanup rules', async () => {
    const view = render(<App />);

    await flushReact();
    expect(weatherUrls).toHaveLength(1);
    expect(alertUrls).toHaveLength(1);
    expect(weatherUrls[0]).toContain('lat=40&lon=-75');
    expect(alertUrls[0]).toContain('lat=40&lon=-75');

    fireEvent.click(screen.getByTestId('gps-jitter'));
    await flushReact();
    expect(weatherUrls).toHaveLength(1);
    expect(alertUrls).toHaveLength(1);

    fireEvent.click(screen.getByTestId('gps-move'));
    await flushReact();
    expect(weatherUrls).toHaveLength(2);
    expect(alertUrls).toHaveLength(2);
    expect(weatherUrls[1]).toContain('lat=40.01&lon=-75');
    expect(alertUrls[1]).toContain('lat=40.01&lon=-75');

    await act(async () => {
      weatherResponses[1].resolve(jsonResponse({ weather: { tempF: 22 }, weatherStatus: 'live' }));
      alertResponses[1].resolve(jsonResponse({ alerts: [], alertsStatus: 'live' }));
    });
    await flushReact();
    expect(screen.getByTestId('weather-value')).toHaveTextContent('22');

    await act(async () => {
      weatherResponses[0].resolve(jsonResponse({ weather: { tempF: 11 }, weatherStatus: 'live' }));
      alertResponses[0].resolve(jsonResponse({ alerts: [], alertsStatus: 'live' }));
    });
    expect(screen.getByTestId('weather-value')).toHaveTextContent('22');

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(weatherUrls).toHaveLength(2);
    expect(alertUrls).toHaveLength(2);

    await act(async () => { vi.advanceTimersByTime(2 * 60 * 1000); });
    expect(alertUrls).toHaveLength(3);
    expect(weatherUrls).toHaveLength(2);
    await flushReact();

    for (let interval = 0; interval < 4; interval += 1) {
      await act(async () => { vi.advanceTimersByTime(2 * 60 * 1000); });
      await flushReact();
    }
    expect(weatherUrls).toHaveLength(3);
    expect(alertUrls).toHaveLength(7);
    for (const response of alertResponses.slice(3)) response.resolve(jsonResponse({ alerts: [], alertsStatus: 'live' }));
    weatherResponses[2].resolve(jsonResponse({ weatherStatus: 'unavailable' }, false));
    await flushReact();
    expect(screen.getByTestId('weather-value')).toHaveTextContent('22');

    view.unmount();
    const weatherCount = weatherUrls.length;
    const alertCount = alertUrls.length;
    await act(async () => { vi.advanceTimersByTime(10 * 60 * 1000); });
    expect(weatherUrls).toHaveLength(weatherCount);
    expect(alertUrls).toHaveLength(alertCount);
  });
});