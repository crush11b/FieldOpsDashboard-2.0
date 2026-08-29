import http from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createLiveBandActivityRouter } from '../liveBandActivityApi';
import type { ObservedRfSnapshot } from '../../src/propagation/observedRf';

const snapshot: ObservedRfSnapshot = {
  kind: 'observed_rf', status: 'live', evidenceStatus: 'live_observed_rf_source', operatingGrid4: 'FM17',
  observationWindow: { startsAt: '2026-08-29T11:45:00.000Z', endsAt: '2026-08-29T12:00:00.000Z' }, collectedAtUtc: '2026-08-29T12:00:00.000Z', reports: [], bandSummaries: [],
  provenance: { sourceId: 'pskreporter-via-mqtt', sourceName: 'PSKReporter reports via mqtt.pskreporter.info', transport: 'mqtts-websocket', brokerHost: 'mqtt.pskreporter.info', brokerPort: 1886, topicPatterns: [] },
};

describe('Live Band Activity API', () => {
  it('reads the injected singleton snapshot without propagation work', async () => {
    const setOperatingLocation = vi.fn();
    const getSnapshot = vi.fn(() => snapshot);
    const readLocation = vi.fn(async () => ({ latitude: 37.54, longitude: -77.43 } as any));
    const app = express().use(createLiveBandActivityRouter({ observedRf: { setOperatingLocation, getSnapshot }, readLocation }));
    const listener = await new Promise<http.Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    try {
      const response = await fetch(`http://127.0.0.1:${(listener.address() as { port: number }).port}/api/live-band-activity`);
      const payload = await response.json();
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(readLocation).toHaveBeenCalledTimes(1);
      expect(setOperatingLocation).toHaveBeenCalledTimes(1);
      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(payload).toMatchObject({ status: 'live', operatingGrid4: 'FM17', windowMinutes: 15, bands: expect.any(Array) });
      expect(payload).not.toHaveProperty('assessments');
      expect(payload).not.toHaveProperty('model');
    } finally {
      await new Promise<void>(resolve => listener.close(() => resolve()));
    }
  });

  it('clears the service location when Agent location is unavailable', async () => {
    const setOperatingLocation = vi.fn();
    const getSnapshot = vi.fn(() => snapshot);
    const app = express().use(createLiveBandActivityRouter({ observedRf: { setOperatingLocation, getSnapshot }, readLocation: async () => { throw new Error('unavailable'); } }));
    const listener = await new Promise<http.Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    try {
      await fetch(`http://127.0.0.1:${(listener.address() as { port: number }).port}/api/live-band-activity`);
      expect(setOperatingLocation).toHaveBeenCalledWith(null);
    } finally {
      await new Promise<void>(resolve => listener.close(() => resolve()));
    }
  });
});
