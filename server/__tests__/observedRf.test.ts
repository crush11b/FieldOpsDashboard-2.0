import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ObservedRfService, type ObservedRfMqttClient } from '../observedRf';
import type { OperatingLocation } from '../../src/location/operatingLocation';

class FakeMqttClient implements ObservedRfMqttClient {
  private listeners = new Map<string, ((...args: any[]) => void)[]>();
  subscriptions: string[][] = [];
  unsubscriptions: string[][] = [];
  ended = false;

  on(event: string, listener: (...args: any[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  subscribe(topic: string | string[], _options: { qos: 0 }, callback: (error?: Error) => void): this {
    this.subscriptions.push(Array.isArray(topic) ? topic : [topic]); callback(); return this;
  }
  unsubscribe(topic: string | string[], callback: (error?: Error) => void): this {
    this.unsubscriptions.push(Array.isArray(topic) ? topic : [topic]); callback(); return this;
  }
  end(): this { this.ended = true; return this; }
  removeAllListeners(): this { this.listeners.clear(); return this; }
  emit(event: string, ...args: any[]): void { for (const listener of this.listeners.get(event) ?? []) listener(...args); }
}

const LOCATION = { coordinates: { lat: 37.54, lon: -77.43 }, provenance: 'current' } as OperatingLocation;
const TOPIC = 'pskr/filter/v2/20m/FT8/K1ABC/W1XYZ/FM17/FN20/291/291';
const MESSAGE = JSON.stringify({ seq: 7, sc: 'K1ABC', rc: 'W1XYZ', sl: 'FM17gm', rl: 'FN20aa', f: 14_074_000, md: 'FT8', rp: -10, t: 1786881300, b: '20m' });
const NOW = new Date('2026-08-16T12:00:00.000Z');

async function tempCache(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fieldops-observed-rf-'));
  return path.join(directory, 'observed-rf.json');
}

describe('ObservedRfService', () => {
  it('connects once, subscribes twice, and reports live zero activity', async () => {
    const cachePath = await tempCache();
    const client = new FakeMqttClient();
    let creates = 0;
    const service = new ObservedRfService({ cachePath, now: () => NOW, mqttFactory: () => { creates += 1; return client; } });
    service.setOperatingLocation(LOCATION);
    client.emit('connect');
    const snapshot = service.getSnapshot();
    expect(creates).toBe(1);
    expect(client.subscriptions[0]).toEqual(['pskr/filter/v2/+/+/+/+/FM17/+/+/+', 'pskr/filter/v2/+/+/+/+/+/FM17/+/+']);
    expect(snapshot.status).toBe('live');
    expect(snapshot.evidenceStatus).toBe('live_observed_rf_source');
    expect(snapshot.reports).toHaveLength(0);
    service.close();
    await rm(path.dirname(cachePath), { recursive: true, force: true });
  });

  it('deduplicates a local report delivered through both subscriptions', async () => {
    const cachePath = await tempCache();
    const client = new FakeMqttClient();
    const service = new ObservedRfService({ cachePath, now: () => NOW, mqttFactory: () => client });
    service.setOperatingLocation(LOCATION);
    client.emit('connect');
    client.emit('message', TOPIC, MESSAGE);
    client.emit('message', TOPIC, MESSAGE);
    const snapshot = service.getSnapshot();
    expect(snapshot.reports).toHaveLength(1);
    expect(snapshot.bandSummaries.find(summary => summary.band === '20m')?.reportCount).toBe(1);
    service.close();
    await rm(path.dirname(cachePath), { recursive: true, force: true });
  });

  it('changes grid subscriptions without reacting to same-grid GPS jitter', async () => {
    const cachePath = await tempCache();
    const clients: FakeMqttClient[] = [];
    const service = new ObservedRfService({ cachePath, now: () => NOW, mqttFactory: () => { const client = new FakeMqttClient(); clients.push(client); return client; } });
    service.setOperatingLocation(LOCATION);
    clients[0].emit('connect');
    service.setOperatingLocation({ ...LOCATION, coordinates: { lat: 37.55, lon: -77.42 } });
    expect(clients[0].subscriptions).toHaveLength(1);
    service.setOperatingLocation({ ...LOCATION, coordinates: { lat: 40.0, lon: -75.0 } });
    expect(clients[0].unsubscriptions).toHaveLength(1);
    service.close();
    await rm(path.dirname(cachePath), { recursive: true, force: true });
  });

  it('retains recent evidence as cached and old cache as stale after restart', async () => {
    const cachePath = await tempCache();
    let now = new Date('2026-08-16T12:00:00.000Z');
    const firstClient = new FakeMqttClient();
    const first = new ObservedRfService({ cachePath, now: () => now, mqttFactory: () => firstClient });
    first.setOperatingLocation(LOCATION);
    firstClient.emit('connect');
    firstClient.emit('message', TOPIC, MESSAGE);
    first.close();
    const cached = new ObservedRfService({ cachePath, now: () => now, mqttFactory: () => new FakeMqttClient() });
    cached.setOperatingLocation(LOCATION);
    expect(cached.getSnapshot().status).toBe('cached');
    now = new Date('2026-08-16T12:31:00.000Z');
    const stale = new ObservedRfService({ cachePath, now: () => now, mqttFactory: () => new FakeMqttClient() });
    stale.setOperatingLocation(LOCATION);
    expect(stale.getSnapshot().status).toBe('stale');
    expect(JSON.parse(await readFile(cachePath, 'utf8')).reports[0].observedAtUtc).toBeDefined();
    cached.close(); stale.close();
    await rm(path.dirname(cachePath), { recursive: true, force: true });
  });

  it('persists valid zero activity and rejects shallow or unproven cache entries', async () => {
    const cachePath = await tempCache();
    const client = new FakeMqttClient();
    const live = new ObservedRfService({ cachePath, now: () => NOW, mqttFactory: () => client });
    live.setOperatingLocation(LOCATION);
    client.emit('connect');
    live.close();
    const cached = new ObservedRfService({ cachePath, now: () => NOW, mqttFactory: () => new FakeMqttClient() });
    cached.setOperatingLocation(LOCATION);
    expect(cached.getSnapshot()).toMatchObject({ status: 'cached', reports: [] });
    cached.close();

    await writeFile(cachePath, JSON.stringify({
      grid4: 'FM17',
      observationWindow: { startsAt: '2026-08-16T11:45:00.000Z', endsAt: NOW.toISOString() },
      sourceWasLive: false,
      validCollection: false,
      collectedAtUtc: NOW.toISOString(),
      reports: [{ reportId: 'untrusted' }],
    }));
    const unavailable = new ObservedRfService({ cachePath, now: () => NOW, mqttFactory: () => new FakeMqttClient() });
    unavailable.setOperatingLocation(LOCATION);
    expect(unavailable.getSnapshot().status).toBe('connecting');
    unavailable.close();
    await rm(path.dirname(cachePath), { recursive: true, force: true });
  });

  it('retains evidence through disconnect and schedules bounded reconnect', async () => {
    const cachePath = await tempCache();
    const client = new FakeMqttClient();
    const service = new ObservedRfService({ cachePath, now: () => NOW, reconnectBaseMs: 1, mqttFactory: () => client });
    service.setOperatingLocation(LOCATION);
    client.emit('connect');
    client.emit('message', TOPIC, MESSAGE);
    client.emit('close');
    expect(service.getSnapshot().status).toBe('cached');
    service.close();
    await rm(path.dirname(cachePath), { recursive: true, force: true });
  });
});
