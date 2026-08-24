import { describe, expect, it, vi } from 'vitest';
import { INITIAL_CONFIG } from '../data/defaultConfig';
import { CONFIG_LOAD_TIMEOUT_MS, CONFIG_STORAGE_KEY, loadDashboardConfig, saveDashboardConfig } from '../configPersistence';

function storage(value: string | null): Storage {
  return {
    getItem: vi.fn(() => value),
    removeItem: vi.fn(),
    length: 0,
    clear: vi.fn(),
    key: vi.fn(),
    setItem: vi.fn(),
  };
}

describe('Dashboard configuration browser migration', () => {
  it('migrates valid localStorage only when the product-owned file is absent', async () => {
    const legacy = { ...INITIAL_CONFIG, callsign: 'KQ4EVK' };
    const localStorage = storage(JSON.stringify(legacy));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ config: legacy }), { status: 200 }));

    const result = await loadDashboardConfig(fetcher, localStorage);

    expect(result.config.callsign).toBe('KQ4EVK');
    expect(result.migrated).toBe(true);
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/config', expect.objectContaining({ method: 'PUT' }));
    expect(localStorage.removeItem).toHaveBeenCalledWith(CONFIG_STORAGE_KEY);
  });

  it('uses the product-owned file before checking localStorage', async () => {
    const persisted = { ...INITIAL_CONFIG, callsign: 'KQ4EVK' };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ config: persisted }), { status: 200 }));

    const result = await loadDashboardConfig(fetcher, storage(JSON.stringify({ ...INITIAL_CONFIG, callsign: 'W7FIELD' })));

    expect(result.config.callsign).toBe('KQ4EVK');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses defaults when neither product-owned nor legacy config exists', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

    const result = await loadDashboardConfig(fetcher, storage(null));

    expect(result.config).toEqual(INITIAL_CONFIG);
    expect(result.migrated).toBe(false);
  });

  it('rejects a malformed persisted configuration response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ config: { theme: 'dark_tactical' } }), { status: 200 }));

    await expect(loadDashboardConfig(fetcher, storage(null))).rejects.toThrow('response was invalid');
  });

  it('bounds a configuration request that never settles', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));

    await expect(loadDashboardConfig(fetcher, storage(null), 1)).rejects.toThrow('timed out');
    expect(CONFIG_LOAD_TIMEOUT_MS).toBe(5000);
  });

  it('surfaces a migration persistence failure without claiming migration succeeded', async () => {
    const legacy = { ...INITIAL_CONFIG, callsign: 'KQ4EVK' };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const result = await loadDashboardConfig(fetcher, storage(JSON.stringify(legacy)));

    expect(result.config).toEqual(INITIAL_CONFIG);
    expect(result.migrated).toBe(false);
    expect(result.persistenceError).toBeDefined();
  });

  it('surfaces save failures honestly', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));

    await expect(saveDashboardConfig(INITIAL_CONFIG, fetcher)).rejects.toThrow('could not be persisted');
  });
});