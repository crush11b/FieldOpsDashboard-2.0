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

function response(body: string, statusOrOk: number | boolean = 200, headers?: HeadersInit) {
  const status = typeof statusOrOk === 'boolean' ? (statusOrOk ? 200 : 503) : statusOrOk;
  return new Response(body, { status, headers });
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

  it('follows exactly the official SOTA delivery redirect', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response('', 302, { Location: 'https://storage.sota.org.uk/summitslist.csv' }))
      .mockResolvedValueOnce(response(csv));
    const { store } = createStore(fetcher);

    await expect(store.refresh()).resolves.toMatchObject({ status: 'refreshed', recordCount: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(SOTA_SUMMIT_SOURCE_URL);
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://storage.sota.org.uk/summitslist.csv');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it.each([
    ['an arbitrary host', 'https://example.com/summitslist.csv'],
    ['an HTTP delivery URL', 'http://storage.sota.org.uk/summitslist.csv'],
    ['a wrong delivery path', 'https://storage.sota.org.uk/other.csv'],
    ['a delivery URL with a query', 'https://storage.sota.org.uk/summitslist.csv?download=1'],
  ])('rejects %s', async (_description, location) => {
    const fetcher = vi.fn().mockResolvedValue(response('', 302, { Location: location }));
    const { store } = createStore(fetcher);

    await expect(store.refresh()).resolves.toMatchObject({ status: 'failed', message: 'SOTA source returned an unexpected redirect.' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.status.state).toBe('UNAVAILABLE');
  });

  it('rejects a second redirect and reports redirected-source failures', async () => {
    const chainedFetcher = vi.fn()
      .mockResolvedValueOnce(response('', 302, { Location: 'https://storage.sota.org.uk/summitslist.csv' }))
      .mockResolvedValueOnce(response('', 302, { Location: 'https://storage.sota.org.uk/summitslist.csv' }));
    const { store } = createStore(chainedFetcher);
    await expect(store.refresh()).resolves.toMatchObject({ status: 'failed', message: 'SOTA source returned an unexpected second redirect.' });
    expect(chainedFetcher).toHaveBeenCalledTimes(2);

    const failedFetcher = vi.fn()
      .mockResolvedValueOnce(response('', 302, { Location: 'https://storage.sota.org.uk/summitslist.csv' }))
      .mockRejectedValueOnce(new Error('storage unavailable'));
    const failedStore = createStore(failedFetcher).store;
    await expect(failedStore.refresh()).resolves.toMatchObject({ status: 'failed', message: 'SOTA redirected source request failed: storage unavailable' });
  });

  it('times out a refresh and remains unavailable when no dataset exists', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const directory = mkdtempSync(path.join(tmpdir(), 'fieldops-sota-'));
    directories.push(directory);
    const store = new SotaSummitDataStore(path.join(directory, 'sota-summits.json'), { fetcher, timeoutMs: 5 });

    await expect(store.refresh()).resolves.toMatchObject({ status: 'failed', state: 'UNAVAILABLE', message: 'SOTA summit refresh timed out.' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});