import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SotaSummitDataStore } from '../sotaSummitDataStore';
import { SOTA_SUMMIT_SOURCE_URL } from '../sotaSummitDataset';

const csv = 'SOTA Summits List (Date=19/08/2026)\nSummitCode,AssociationName,RegionName,SummitName,AltM,AltFt,GridRef1,GridRef2,Longitude,Latitude\nW4V/SH-001,USA,Virginia,High Knob,1287,4222,18S,18S,-82.1234,37.4567';
const directories: string[] = [];

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function createStore(fetcher: typeof fetch, now = new Date('2026-08-20T00:00:00.000Z')) {
  const directory = mkdtempSync(path.join(tmpdir(), 'fieldops-sota-'));
  directories.push(directory);
  return { store: new SotaSummitDataStore(path.join(directory, 'sota-summits.json'), { fetcher, now: () => now }), filePath: path.join(directory, 'sota-summits.json') };
}

function response(body: string, ok = true) {
  return new Response(body, { status: ok ? 200 : 503 });
}

describe('SOTA summit data store', () => {
  it('refreshes once from the fixed official URL, persists, and reloads', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { expect(input).toBe(SOTA_SUMMIT_SOURCE_URL); return response(csv); });
    const { store, filePath } = createStore(fetcher);
    const result = await store.refresh();
    expect(result).toMatchObject({ status: 'refreshed', recordCount: 1 });
    expect(readFileSync(filePath, 'utf8')).toContain('W4V/SH-001');
      const reloaded = new SotaSummitDataStore(filePath, { fetcher, now: () => new Date('2026-09-21T00:00:00.000Z') });
    expect(reloaded.status.state).toBe('STALE');
    expect(reloaded.dataset.get('W4V/SH-001')?.name).toBe('High Knob');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves the last valid dataset when a later refresh fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(csv))
      .mockRejectedValueOnce(new Error('network unavailable'));
    const { store } = createStore(fetcher);
    await expect(store.refresh()).resolves.toMatchObject({ status: 'refreshed' });
    await expect(store.refresh()).resolves.toMatchObject({ status: 'failed', state: 'AVAILABLE', message: 'network unavailable' });
    expect(store.dataset.get('W4V/SH-001')).not.toBeNull();
  });
});