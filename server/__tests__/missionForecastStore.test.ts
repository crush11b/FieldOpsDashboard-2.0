import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateMissionForecastRecord } from '../missionForecast';
import { MissionForecastStore } from '../missionForecastStore';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function record(briefId: string): any {
  return { schemaVersion: 1, briefId, activation: { program: 'POTA', reference: 'US-1' }, plannedSite: { latitude: 40, longitude: -75, gridSquare: null, provenance: 'manual' }, missionWindow: { start: '2026-08-19T12:00:00.000Z', end: '2026-08-19T14:00:00.000Z' }, provider: { id: 'open-meteo-mission-forecast', name: 'Open-Meteo', timezone: 'UTC' }, retrievedAtUtc: '2026-08-19T11:00:00.000Z', periods: [{ startsAtUtc: '2026-08-19T12:00:00.000Z', endsAtUtc: '2026-08-19T13:00:00.000Z', temperatureF: 0, precipitationProbability: 0, windSpeedMph: 0, windDirectionDegrees: 0, windDirection: 'N', weatherCode: 0, condition: 'Clear Sky' }], status: 'live', sourceUrl: 'https://api.open-meteo.com/v1/forecast', limitations: [], diagnostics: [], updatedAtUtc: '2026-08-19T11:00:00.000Z' };
}
function multiPeriodRecord(briefId: string): any { const base = record(briefId); return { ...base, missionWindow: { start: '2026-08-19T12:00:00.000Z', end: '2026-08-19T20:00:00.000Z' }, periods: Array.from({ length: 8 }, (_, index) => ({ startsAtUtc: `2026-08-19T${String(12 + index).padStart(2, '0')}:00:00.000Z`, endsAtUtc: `2026-08-19T${String(13 + index).padStart(2, '0')}:00:00.000Z`, temperatureF: index, precipitationProbability: 0, windSpeedMph: 1, windDirectionDegrees: 0, windDirection: 'N', weatherCode: 0, condition: 'Clear Sky' })) }; }

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
    const filePath = path.join(directory, 'mission-forecasts.json'); const legacy = { ...record('legacy-brief'), periods: [...record('legacy-brief').periods, { startsAtUtc: '2026-08-19T14:00:00.000Z', endsAtUtc: '2026-08-19T15:00:00.000Z', temperatureF: 99, precipitationProbability: 100, windSpeedMph: 20, windDirectionDegrees: 180, windDirection: 'S', weatherCode: 61, condition: 'Precipitation/Rain' }] };
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, records: [{ briefId: 'legacy-brief', record: legacy }] }));
    const before = fs.readFileSync(filePath, 'utf8'); const restarted = new MissionForecastStore(filePath); const loaded = restarted.getByBriefId('legacy-brief');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
    expect(loaded).toMatchObject({ status: 'found', record: { schemaVersion: 2, freshness: 'retained', hourly: [{ startsAtUtc: legacy.periods[0].startsAtUtc }], operatingPeriods: expect.any(Array) } });
    expect(loaded.status === 'found' && loaded.record.hourly.some(hour => hour.startsAtUtc === '2026-08-19T14:00:00.000Z')).toBe(false);
    expect(loaded.status === 'found' && loaded.record.diagnostics.some(diagnostic => diagnostic.includes('excluded 1 non-applicable'))).toBe(true);
    expect(loaded.status === 'found' && validateMissionForecastRecord(loaded.record)).toBe(true);
    if (loaded.status === 'found') {
      const saved = restarted.save(loaded.record);
      expect(saved.record.freshness).toBe('retained');
      expect(saved.record.operatingPeriods.every(period => period.freshness === 'retained')).toBe(true);
    }
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).storeVersion).toBe(2);
    const reloaded = new MissionForecastStore(filePath).getByBriefId('legacy-brief');
    expect(reloaded).toMatchObject({ status: 'found', record: { schemaVersion: 2, freshness: 'retained', operatingPeriods: [{ freshness: 'retained' }] } });
  });

  it('rejects contradictory schema-v2 aggregate traceability', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-forecast-store-v2-invalid-')); directories.push(directory);
    const filePath = path.join(directory, 'mission-forecasts.json'); const store = new MissionForecastStore(filePath); store.save(record('brief-v2-invalid'));
    const document = JSON.parse(fs.readFileSync(filePath, 'utf8')); document.records[0].record.operatingPeriods[0].hourlyObservationIndexes = [99];
    fs.writeFileSync(filePath, JSON.stringify(document));
    expect(store.getByBriefId('brief-v2-invalid')).toMatchObject({ status: 'notFound', diagnostics: [{ code: 'invalid_record' }] });
  });

  it('rejects duplicate and reordered canonical operating-period collections', () => {
    for (const mutation of ['duplicate', 'reordered'] as const) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), `fieldops-forecast-store-${mutation}-`)); directories.push(directory);
      const filePath = path.join(directory, 'mission-forecasts.json'); const store = new MissionForecastStore(filePath); store.save(multiPeriodRecord(`brief-${mutation}`));
      const document = JSON.parse(fs.readFileSync(filePath, 'utf8')); const periods = document.records[0].record.operatingPeriods;
      document.records[0].record.operatingPeriods = mutation === 'duplicate' ? [periods[0], periods[0]] : [periods[1], periods[0]];
      fs.writeFileSync(filePath, JSON.stringify(document));
      expect(store.getByBriefId(`brief-${mutation}`)).toMatchObject({ status: 'notFound', diagnostics: [{ code: 'invalid_record' }] });
    }
  });
});