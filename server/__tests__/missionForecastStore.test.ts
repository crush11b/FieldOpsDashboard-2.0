import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MissionForecastStore } from '../missionForecastStore';
import type { MissionForecastRecord } from '../missionForecast';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function record(briefId: string): MissionForecastRecord {
  return { schemaVersion: 1, briefId, activation: { program: 'POTA', reference: 'US-1' }, plannedSite: { latitude: 40, longitude: -75, provenance: 'manual' }, missionWindow: { start: '2026-08-19T12:00:00.000Z', end: '2026-08-19T14:00:00.000Z' }, provider: { id: 'open-meteo-mission-forecast', name: 'Open-Meteo', timezone: 'UTC' }, retrievedAtUtc: '2026-08-19T11:00:00.000Z', periods: [{ startsAtUtc: '2026-08-19T12:00:00.000Z', endsAtUtc: '2026-08-19T13:00:00.000Z', temperatureF: 0, precipitationProbability: 0, windSpeedMph: 0, windDirectionDegrees: 0, windDirection: 'N', weatherCode: 0, condition: 'Clear Sky' }], status: 'live', sourceUrl: 'https://api.open-meteo.com/v1/forecast', limitations: [], diagnostics: [], updatedAtUtc: '2026-08-19T11:00:00.000Z' };
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
});