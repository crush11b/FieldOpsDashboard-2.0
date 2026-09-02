import { describe, expect, it } from 'vitest';
import { executeP533Circuit, P533WorkerClient } from '../p533Engine';
import { executeRegionalP533 } from '../regionalP533';
import type { P533CircuitRequest, P533CircuitExecution } from '../../src/propagation/p533';
import type { P533WorkerLike } from '../p533Engine';

const request: P533CircuitRequest = {
  origin: { lat: 37.54, lon: -77.43 },
  destination: { lat: 40.4168, lon: -3.7038 },
  year: 2026,
  month: 8,
  day: 29,
  utcHour: 12,
  ssn: 109,
  band: '20m',
  frequencyMHz: 14.1,
  mode: 'SSB',
  transmitPowerWatts: 10,
  requiredSnrDb: 15,
  bandwidthHz: 3000,
  requiredReliabilityPercent: 90,
  antenna: { model: 'ISOTROPIC', gainOffsetDb: 0 },
  noiseEnvironment: 'RESIDENTIAL',
};

class FakeWorker implements P533WorkerLike {
  readonly posted: { id: number; request: P533CircuitRequest }[] = [];
  private readonly listeners = {
    message: [] as ((message: { id: number; result: P533CircuitExecution }) => void)[],
    error: [] as ((error: Error) => void)[],
    exit: [] as ((code: number) => void)[],
  };

  on(event: 'message' | 'error' | 'exit', listener: ((message: any) => void)): this {
    this.listeners[event].push(listener as never);
    return this;
  }

  postMessage(message: { id: number; request: P533CircuitRequest }): void {
    this.posted.push(message);
  }

  terminate(): Promise<number> { return Promise.resolve(0); }
  unref(): void {}
  respond(id: number, result: P533CircuitExecution): void { this.listeners.message.forEach(listener => listener({ id, result })); }
  fail(error: Error): void { this.listeners.error.forEach(listener => listener(error)); }
  exit(code: number): void { this.listeners.exit.forEach(listener => listener(code)); }
}

const success = (): P533CircuitExecution => ({
  ok: true,
  result: {
    sourceState: 'modeled', model: 'ITU-R P.533', modelVersion: 'P.533-14', engine: 'ITU-R-HF v14.3', request,
    modeledPeriod: { year: 2026, month: 8, day: 29, utcHour: 12 }, frequency: { frequencyMHz: 14.1, basicMufMHz: 20, receivedPowerDb: -90, snrDb: 20, basicCircuitReliabilityPercent: 95 },
    elapsedMs: 1, reportBytes: 1, rawReport: 'fixture', assetProvenance: {} as never,
  },
});

describe('P.533 worker boundary', () => {
  it('keeps the main event loop progressing during a real regional calculation', async () => {
    const location = { coordinates: { lat: 37.54, lon: -77.43 }, gridSquare: 'FM17', provenance: 'manual' as const, status: 'degraded' as const, source: { id: 'test', type: 'manual_location' as const } };
    const profile = { mode: 'SSB' as const, transmitPowerWatts: 10, antenna: { type: 'EFHW' as const }, deployment: { geometry: 'inverted_v' as const, heightCategory: '15_to_30_ft' as const } };
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 20);
    try {
      const result = await executeRegionalP533({ operatingLocation: location, regionId: 'western_europe', stationProfile: profile, modelDateTimeUtc: '2026-08-29T12:00:00Z', ssn: 109 });
      expect(result.executionCount).toBe(45);
      expect(ticks).toBeGreaterThan(3);
    } finally {
      clearInterval(timer);
    }
  }, 120_000);

  it('correlates responses and rejects outstanding requests after worker failure, then recovers', async () => {
    const workers: FakeWorker[] = [];
    const client = new P533WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const first = client.execute(request);
    workers[0].fail(new Error('worker failed'));
    await expect(first).rejects.toThrow('worker failed');
    const second = client.execute(request);
    workers[1].respond(2, success());
    await expect(second).resolves.toMatchObject({ ok: true });
    await client.shutdown();
  });

  it('keeps worker requests serialized by the public engine queue', async () => {
    const first = executeP533Circuit(request);
    const second = executeP533Circuit({ ...request, band: '40m', frequencyMHz: 7.1 });
    const results = await Promise.all([first, second]);
    expect(results.every(result => result.ok)).toBe(true);
  }, 30_000);
});
