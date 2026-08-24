import type { DashboardConfig } from './types';
import { INITIAL_CONFIG } from './data/defaultConfig';
import { isUsableDashboardConfig } from './dashboardConfigValidation';

export const CONFIG_STORAGE_KEY = 'fieldops_dashboard_config_v115';
export const CONFIG_LOAD_TIMEOUT_MS = 5000;

export interface ConfigLoadResult {
  config: DashboardConfig;
  migrated: boolean;
  persistenceError?: string;
}

export async function loadDashboardConfig(
  fetcher: typeof fetch = fetch,
  storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
  timeoutMs = CONFIG_LOAD_TIMEOUT_MS,
): Promise<ConfigLoadResult> {
  const response = await fetchWithTimeout(fetcher, '/api/config', undefined, timeoutMs);
  if (response.ok) {
    const payload = await response.json() as { config?: DashboardConfig };
    if (!isUsableDashboardConfig(payload.config)) throw new Error('Dashboard configuration response was invalid.');
    return { config: payload.config, migrated: false };
  }

  if (response.status !== 404) throw new Error('Dashboard configuration could not be loaded.');
  const legacy = readLegacyConfig(storage);
  if (!legacy) return { config: INITIAL_CONFIG, migrated: false };

  const migratedResponse = await fetchWithTimeout(fetcher, '/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(legacy),
  }, timeoutMs);
  if (!migratedResponse.ok) {
    return {
      config: INITIAL_CONFIG,
      migrated: false,
      persistenceError: 'Dashboard configuration migration could not be persisted.',
    };
  }
  const migratedPayload = await migratedResponse.json() as { config?: DashboardConfig };
  if (!isUsableDashboardConfig(migratedPayload.config)) throw new Error('Migrated Dashboard configuration response was invalid.');
  storage?.removeItem(CONFIG_STORAGE_KEY);
  return { config: migratedPayload.config, migrated: true };
}

export async function saveDashboardConfig(config: DashboardConfig, fetcher: typeof fetch = fetch): Promise<DashboardConfig> {
  const response = await fetcher('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error('Dashboard configuration could not be persisted.');
  const payload = await response.json() as { config?: DashboardConfig };
  if (!payload.config) throw new Error('Dashboard configuration response was invalid.');
  return payload.config;
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<Response>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Dashboard configuration request timed out.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetcher(input, { ...init, signal: controller.signal }), timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function readLegacyConfig(storage: Pick<Storage, 'getItem'> | undefined): unknown | null {
  if (!storage) return null;
  try {
    const saved = storage.getItem(CONFIG_STORAGE_KEY);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
