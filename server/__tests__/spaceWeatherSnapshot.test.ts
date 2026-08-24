import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { retainSpaceWeatherSnapshot, interpretSpaceWeather } from '../spaceWeatherSnapshot';
import { SpaceWeatherSnapshotStore } from '../spaceWeatherSnapshotStore';
import type { SmartDeployBriefV2 } from '../smartDeployBrief';
import type { SpaceWeatherSnapshot } from '../spaceWeather';

const brief = { briefId: 'brief-a', activation: { program: 'POTA', reference: 'US-1' }, missionWindow: { start: '2026-08-24T10:00:00.000Z', midpoint: '2026-08-24T11:00:00.000Z', end: '2026-08-24T12:00:00.000Z' } } as SmartDeployBriefV2;
const snapshot = { kind: 'noaa_space_weather', status: 'live', fetchedAt: '2026-08-24T09:00:00.000Z', products: { f107: { product: 'f107', state: 'live', value: 150, observedAt: '2026-08-24T08:00:00.000Z', receivedAt: '2026-08-24T09:00:00.000Z', source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } }, ssn: { product: 'ssn', state: 'live', value: 100, observedAt: '2026-08-01T00:00:00.000Z', receivedAt: '2026-08-24T09:00:00.000Z', source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } }, kp: { product: 'kp', state: 'live', value: 2, observedAt: '2026-08-24T08:00:00.000Z', receivedAt: '2026-08-24T09:00:00.000Z', source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } }, rScale: { product: 'rScale', state: 'live', value: null, observedAt: '2026-08-24T08:00:00.000Z', receivedAt: '2026-08-24T09:00:00.000Z', source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } }, xray: { product: 'xray', state: 'live', value: 'C1.0', observedAt: '2026-08-24T08:00:00.000Z', receivedAt: '2026-08-24T09:00:00.000Z', source: { id: 'noaa-swpc', type: 'noaa-swpc', name: 'NOAA SWPC' } } }, modelSsn: undefined } as unknown as SpaceWeatherSnapshot;

describe('retained space weather', () => {
  it('interprets evidence without making an operating guarantee', () => {
    expect(interpretSpaceWeather(snapshot.products).solarSupport).toBe('supportive');
    expect(interpretSpaceWeather(snapshot.products).geomagneticActivity).toBe('quiet');
    expect(retainSpaceWeatherSnapshot(brief, snapshot, new Date('2026-08-24T09:01:00.000Z')).limitations.join(' ')).toContain('do not guarantee');
  });

  it('survives restart and remains isolated by brief id', () => {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-space-weather-')), 'space-weather-snapshots.json');
    const store = new SpaceWeatherSnapshotStore(filePath);
    store.save(retainSpaceWeatherSnapshot(brief, snapshot, new Date('2026-08-24T09:01:00.000Z')));
    const restarted = new SpaceWeatherSnapshotStore(filePath);
    expect(restarted.getByBriefId('brief-a').status).toBe('found');
    expect(restarted.getByBriefId('brief-b').status).toBe('notFound');
  });
});