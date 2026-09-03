import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MissionForecastStore } from '../missionForecastStore';
import type { MissionForecastRecord } from '../missionForecast';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function record(briefId: string): MissionForecastRecord {
  return { schemaVersion: 1, briefId, activation: { program: 'POTA', reference: 'US-1' }, plannedSite: { latitude: 40, longitude: -75, gridSquare: null, provenance: 'manual' }, missionWindow: { start: '2026-08-19T12:00:00.000Z', end: '2026-08-19T14:00:00.000Z' }, provider: { id: 'open-meteo-mission-forecast', name: 'Open-Meteo', timezone: 'UTC' }, retrievedAtUtc: '2026-08-19T11:00:00.000Z', periods: [{ startsAtUtc: '2026-08-19T12:00:00.000Z', endsAtUtc: '2026-08-19T13:00:00.000Z', temperatureF: 0, precipitationProbability: 0, windSpeedMph: 0, windDirectionDegrees: 0, windDirection: 'N', weatherCode: 0, condition: 'Clear Sky' }], status: 'live', sourceUrl: 'https://api.open-meteo.com/v1/forecast', limitations: [], diagnostics: [], updatedAtUtc: '2026-08-19T11:00:00.000Z' };
}

describe('mission forecast store', () => {
  it('persists and reconstructs isolated brief records', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-forecast-store-')); directories.push(directory);
    const store = new MissionForecastStore(path.join(directory, 'mission-forecasts.json'));
    store.save(record('brief-a'));
    store.save(record('brief-b'));
    const restarted = new MissionForecastStore(path.join(directory, 'mission-forecasts.json'));
    expect(restarted.getByBriefId('brief-a').status).toBe('found');
    expect(restarted.getByBriefId('brief-b').status).toBe('found');
    expect(restarted.getByBriefId('brief-missing').status).toBe('notFound');
  });

  it('rejects unsupported, malformed, and mismatched persisted entries safely', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-forecast-store-invalid-')); directories.push(directory);
    const filePath = path.join(directory, 'mission-forecasts.json');
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, records: [{ briefId: 'different-key', record: record('brief-a') }, { briefId: 'bad', record: { ...record('bad'), plannedSite: { ...record('bad').plannedSite, latitude: Number.NaN } } }] }));
    const invalid = new MissionForecastStore(filePath).load();
    expect(invalid.status).toBe('loaded');
    expect(invalid.records).toHaveLength(0);
    expect(invalid.diagnostics).toHaveLength(2);
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 99, records: [] }));
    expect(new MissionForecastStore(filePath).load().status).toBe('invalid');
  });

  it('replaces only the same brief and leaves other records unchanged', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-forecast-store-replace-')); directories.push(directory);
    const store = new MissionForecastStore(path.join(directory, 'mission-forecasts.json'));
    store.save(record('brief-a')); store.save(record('brief-b'));
    const replacement = { ...record('brief-a'), updatedAtUtc: '2026-08-19T12:00:00.000Z' };
    store.save(replacement);
    expect(store.getByBriefId('brief-a')).toMatchObject({ status: 'found', record: { updatedAtUtc: replacement.updatedAtUtc } });
    expect(store.getByBriefId('brief-b').status).toBe('found');
    expect(fs.readdirSync(directory)).toEqual(['mission-forecasts.json']);
  });

  it('returns bounded diagnostics for malformed JSON', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-forecast-store-json-')); directories.push(directory);
    const filePath = path.join(directory, 'mission-forecasts.json'); fs.writeFileSync(filePath, '{broken');
    const result = new MissionForecastStore(filePath).load();
    expect(result.status).toBe('invalid');
    expect(result.records).toEqual([]);
    expect(result.diagnostics[0].message).not.toContain(filePath);
  });

  it('normalizes schema-v1 evidence on read without rewriting until an explicit save', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-forecast-store-migration-')); directories.push(directory);
    const filePath = path.join(directory, 'mission-forecasts.json'); const legacy = record('legacy-brief');
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, records: [{ briefId: 'legacy-brief', record: legacy }] }));
    const before = fs.readFileSync(filePath, 'utf8'); const restarted = new MissionForecastStore(filePath); const loaded = restarted.getByBriefId('legacy-brief');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
    expect(loaded).toMatchObject({ status: 'found', record: { schemaVersion: 2, freshness: 'retained', hourly: [{ startsAtUtc: legacy.periods[0].startsAtUtc }], operatingPeriods: expect.any(Array) } });
    if (loaded.status === 'found') restarted.save(loaded.record);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).storeVersion).toBe(2);
    const reloaded = new MissionForecastStore(filePath).getByBriefId('legacy-brief');
    expect(reloaded).toMatchObject({ status: 'found', record: { schemaVersion: 2, freshness: 'retained' } });
  });
});