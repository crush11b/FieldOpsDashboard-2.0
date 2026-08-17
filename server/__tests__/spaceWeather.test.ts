import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSpaceWeatherSnapshot, parseF107, parseKp, parseRScale, parseSsn, parseXray } from '../spaceWeather';

const NOW = new Date('2026-08-17T03:00:00.000Z');
const temporaryDirectories: string[] = [];

function cachePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-space-weather-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'cache.json');
}

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 503, headers: { 'content-type': 'application/json' } });
}

function payloadFor(url: string): unknown {
  if (url.includes('f107')) return [{ time_tag: '2026-08-16T20:00:00', flux: 129 }, { time_tag: '2026-08-16T22:00:00', flux: 122 }];
  if (url.includes('solar-cycle')) return [{ 'time-tag': '2026-06', ssn: 114, observed_swpc_ssn: 106.83 }];
  if (url.includes('planetary')) return [{ time_tag: '2026-08-17T00:00:00', Kp: 2.33, a_running: 8, station_count: 8 }];
  if (url.includes('scales')) return { '0': { DateStamp: '2026-08-17', TimeStamp: '02:24:00', R: { Scale: '1' } } };
  return [{ time_tag: '2026-08-17T02:23:00Z', current_class: 'C2.1' }];
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('NOAA space-weather evidence', () => {
  it('selects the newest valid observation and rejects malformed products', () => {
    expect(parseF107([{ time_tag: '2026-08-16T20:00:00', flux: 129 }, { time_tag: 'bad', flux: 900 }])).toMatchObject({ value: 129 });
    expect(parseSsn([{ 'time-tag': '2026-06', ssn: 114, observed_swpc_ssn: 106.83 }])).toMatchObject({ value: 106.83 });
    expect(parseKp([{ time_tag: '2026-08-17T00:00:00', Kp: 2.33 }])).toMatchObject({ value: 2.33 });
    expect(parseRScale({ '0': { DateStamp: '2026-08-17', TimeStamp: '02:24:00', R: { Scale: '1' } } })).toMatchObject({ value: 1 });
    expect(parseXray([{ time_tag: '2026-08-17T02:23:00Z', current_class: 'C2.1' }])).toMatchObject({ value: 'C2.1' });
    expect(parseKp({})).toBeNull();
  });

  it('keeps valid products live when one NOAA product fails', async () => {
    const result = await getSpaceWeatherSnapshot({ cachePath: cachePath(), now: () => NOW, fetcher: async input => {
      const url = String(input);
      return url.includes('planetary') ? jsonResponse({}, false) : jsonResponse(payloadFor(url));
    } });

    expect(result.products.f107).toMatchObject({ state: 'live', value: 122 });
    expect(result.products.kp.state).toBe('unavailable');
    expect(result.products.kp.value).toBeUndefined();
    expect(result.products.xray).toMatchObject({ state: 'live', value: 'C2.1' });
  });

  it('retains a truthful cached observation and marks it stale by observation age', async () => {
    const filePath = cachePath();
    await getSpaceWeatherSnapshot({ cachePath: filePath, now: () => NOW, fetcher: async input => jsonResponse(payloadFor(String(input))) });
    const later = new Date('2026-08-20T03:00:00.000Z');
    const result = await getSpaceWeatherSnapshot({ cachePath: filePath, now: () => later, fetcher: async () => { throw new Error('offline'); } });

    expect(result.products.f107).toMatchObject({ state: 'stale', value: 122, observedAt: '2026-08-16T22:00:00.000Z' });
    expect(result.products.xray.state).toBe('stale');
  });

  it('does not fabricate values when live and cache are unavailable', async () => {
    const result = await getSpaceWeatherSnapshot({ cachePath: cachePath(), now: () => NOW, fetcher: async () => { throw new Error('offline'); } });
    expect(Object.values(result.products).every(product => product.state === 'unavailable')).toBe(true);
    expect(Object.values(result.products).every(product => product.value === undefined)).toBe(true);
  });
});
