import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INITIAL_CONFIG } from '../../src/data/defaultConfig';
import { deleteCatalogRecord, setCatalogRecordEnabled } from '../../src/appCatalog/domain';
import {
  DashboardConfigStore,
  createDashboardConfigRouter,
  getDefaultDashboardConfigPath,
  isLoopbackRequest,
  normalizeDashboardConfig,
  parseDashboardConfigJson,
  resolveWsjtxConfiguration,
} from '../dashboardConfig';

const temporaryDirectories: string[] = [];

function invokePut(router: ReturnType<typeof createDashboardConfigRouter>, body: unknown): { statusCode: number; payload: unknown } {
  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) { statusCode = code; return response; },
    json(value: unknown) { payload = value; return response; },
  };
  router({ method: 'PUT', url: '/api/config', body, socket: { remoteAddress: '127.0.0.1' } } as any, response as any, () => undefined);
  return { statusCode, payload };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('product-owned Dashboard configuration', () => {
  it('uses the enrolled operator local app-data location', () => {
    expect(getDefaultDashboardConfigPath({ LOCALAPPDATA: 'C:\\Users\\Operator\\AppData\\Local' }, 'C:\\Users\\Operator'))
      .toBe('C:\\Users\\Operator\\AppData\\Local\\FieldOpsDashboard\\dashboard-config.json');
  });

  it('normalizes missing fields and excludes unknown properties', () => {
    const config = normalizeDashboardConfig({ callsign: 'kq4evk', unknown: 'do not trust', apps: [] });

    expect(config.callsign).toBe('KQ4EVK');
    expect(config.theme).toBe(INITIAL_CONFIG.theme);
    expect(config).not.toHaveProperty('unknown');
    expect(config.apps.map(app => ({ id: app.id, favorite: app.favorite, installed: app.installed })))
      .toEqual(INITIAL_CONFIG.apps.map(app => ({ id: app.id, favorite: app.favorite, installed: false })));
    expect(config.appCatalog.records.map(record => record.id)).toEqual(INITIAL_CONFIG.appCatalog.records.map(record => record.id));
    expect(config.propagation.stationProfile).toEqual(INITIAL_CONFIG.propagation.stationProfile);
  });

  it('defaults a missing propagation profile and preserves unrelated fields', () => {
    const config = normalizeDashboardConfig({ callsign: 'KQ4EVK', theme: 'sunlight' });

    expect(config.callsign).toBe('KQ4EVK');
    expect(config.theme).toBe('sunlight');
    expect(config.propagation.stationProfile).toEqual(INITIAL_CONFIG.propagation.stationProfile);
  });

  it('preserves bounded legacy hotkeys while discarding runtime installed state', () => {
    const config = normalizeDashboardConfig({ apps: [{ ...INITIAL_CONFIG.apps[0], hotkey: 'F9', installed: true }] });
    const migrated = config.appCatalog.records.find(record => record.id === INITIAL_CONFIG.apps[0].id);

    expect(migrated?.hotkey).toBe('F9');
    expect(config.apps.find(app => app.id === INITIAL_CONFIG.apps[0].id)).toMatchObject({ hotkey: 'F9', installed: false });
  });

  it('rejects malformed legacy application input and non-object configuration bodies', () => {
    expect(() => normalizeDashboardConfig({ apps: {} })).toThrow(/apps field must be an array/i);
    expect(() => normalizeDashboardConfig(null)).toThrow(/JSON object/i);
    expect(() => normalizeDashboardConfig({ appCatalog: { schemaVersion: 1, records: [{ ...INITIAL_CONFIG.appCatalog.records[0], name: '   ' }], deletedBuiltInIds: [] } })).toThrow();
  });

  it('defaults production WSJT-X to multicast without selecting an interface', () => {
    const config = normalizeDashboardConfig({});
    expect(config.wsjtx).toMatchObject({ mode: 'multicast', multicastAddress: '239.255.0.0', multicastInterface: '', port: 2237 });
    expect(resolveWsjtxConfiguration(config, {})).toEqual({ mode: 'multicast', multicastAddress: '239.255.0.0', multicastInterface: undefined, port: 2237, adifLogPath: null, adifCheckpointPath: null });
  });

  it('gives explicit environment overrides precedence over persisted configuration', () => {
    const config = normalizeDashboardConfig({ wsjtx: { mode: 'multicast', multicastAddress: '239.255.0.1', multicastInterface: '10.0.0.2', host: '10.0.0.3', port: 2240 } });
    expect(resolveWsjtxConfiguration(config, { WSJTX_MODE: 'unicast', WSJTX_HOST: '127.0.0.9', WSJTX_PORT: '2238' })).toEqual({ mode: 'unicast', host: '127.0.0.9', port: 2238, adifLogPath: null, adifCheckpointPath: null });
    expect(resolveWsjtxConfiguration(config, { WSJTX_MULTICAST_ADDRESS: '239.255.0.9', WSJTX_MULTICAST_INTERFACE: '10.0.0.4', WSJTX_PORT: '2241' })).toEqual({ mode: 'multicast', multicastAddress: '239.255.0.9', multicastInterface: '10.0.0.4', port: 2241, adifLogPath: null, adifCheckpointPath: null });
  });

  it('preserves deliberate persisted unicast compatibility', () => {
    const config = normalizeDashboardConfig({ wsjtx: { mode: 'unicast', host: '127.0.0.8', port: 2239 } });
    expect(resolveWsjtxConfiguration(config, {})).toEqual({ mode: 'unicast', host: '127.0.0.8', port: 2239, adifLogPath: null, adifCheckpointPath: null });
    expect(resolveWsjtxConfiguration(normalizeDashboardConfig({}), { WSJTX_HOST: '127.0.0.7' })).toEqual({ mode: 'unicast', host: '127.0.0.7', port: 2237, adifLogPath: null, adifCheckpointPath: null });
  });

  it('resolves an explicit ADIF path and checkpoint override', () => {
    const config = normalizeDashboardConfig({});
    expect(resolveWsjtxConfiguration(config, { WSJTX_ADIF_LOG_PATH: 'D:\\WSJT\\wsjtx_log.adi', WSJTX_ADIF_CHECKPOINT_PATH: 'D:\\FieldOps\\wsjtx.checkpoint.json' })).toMatchObject({ adifLogPath: 'D:\\WSJT\\wsjtx_log.adi', adifCheckpointPath: 'D:\\FieldOps\\wsjtx.checkpoint.json' });
  });

  it('resolves the Windows local-app-data default without scanning profiles', () => {
    const config = normalizeDashboardConfig({});
    expect(resolveWsjtxConfiguration(config, { LOCALAPPDATA: 'C:\\Users\\Operator\\AppData\\Local' })).toMatchObject({ adifLogPath: 'C:\\Users\\Operator\\AppData\\Local\\WSJT-X\\wsjtx_log.adi' });
  });

  it('round-trips valid station profiles and normalizes invalid fields independently', () => {
    const valid = {
      mode: 'FT8', transmitPowerWatts: 37, antenna: { type: 'beam' },
      deployment: { geometry: 'directional', heightCategory: 'not_applicable' },
    };
    expect(normalizeDashboardConfig({ propagation: { stationProfile: valid } }).propagation.stationProfile).toEqual(valid);

    const invalid = normalizeDashboardConfig({ propagation: { stationProfile: {
      mode: 'VARA', transmitPowerWatts: 0, antenna: { type: 'invalid' },
      deployment: { geometry: 'inverted_v', heightCategory: 'under_15_ft' },
    } } });
    expect(invalid.propagation.stationProfile).toEqual({
      mode: 'SSB', transmitPowerWatts: 10, antenna: { type: 'EFHW' },
      deployment: { geometry: 'inverted_v', heightCategory: 'under_15_ft' },
    });
    expect(normalizeDashboardConfig({ propagation: { stationProfile: {
      mode: 'SSB', transmitPowerWatts: 10, antenna: { type: 'EFHW' },
      deployment: { geometry: 'inverted_v', heightCategory: 'not_applicable' },
    } } }).propagation.stationProfile).toEqual(INITIAL_CONFIG.propagation.stationProfile);
  });

  it('rejects malformed configuration JSON', () => {
    expect(parseDashboardConfigJson('{broken')).toBeNull();
  });

  it('writes validated config atomically and reads it back', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-config-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'dashboard-config.json');
    const store = new DashboardConfigStore(filePath);

    const saved = store.write({ callsign: 'KQ4EVK', secret: 'ignored' });

    expect(saved.callsign).toBe('KQ4EVK');
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).callsign).toBe('KQ4EVK');
    expect(fs.readdirSync(directory)).toEqual(['dashboard-config.json']);
    const replaced = new DashboardConfigStore(filePath).write({ callsign: 'W7FIELD' });
    expect(replaced.callsign).toBe('W7FIELD');
    expect(store.read()).toEqual({ kind: 'loaded', config: replaced });
  });

  it('persists catalog state and curated tombstones across store instances', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-config-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'dashboard-config.json');
    const favoriteCatalog = setCatalogRecordEnabled(INITIAL_CONFIG.appCatalog, 'wsjtx', false);
    const deletedCatalog = deleteCatalogRecord(favoriteCatalog, 'winlink');
    const store = new DashboardConfigStore(filePath);

    store.write({ appCatalog: deletedCatalog });
    const restoredStore = new DashboardConfigStore(filePath);
    const result = restoredStore.read();

    expect(result.kind).toBe('loaded');
    if (result.kind !== 'loaded') return;
    expect(result.config.appCatalog.records.find(record => record.id === 'wsjtx')?.enabled).toBe(false);
    expect(result.config.appCatalog.deletedBuiltInIds).toContain('winlink');
    expect(result.config.appCatalog.records.some(record => record.id === 'winlink')).toBe(false);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).appCatalog.records[0]).not.toHaveProperty('installed');
  });

  it('makes a valid catalog authoritative over conflicting legacy apps', () => {
    const catalog = setCatalogRecordEnabled(INITIAL_CONFIG.appCatalog, 'wsjtx', false);
    const config = normalizeDashboardConfig({
      appCatalog: catalog,
      apps: [{ ...INITIAL_CONFIG.apps[0], name: 'Conflicting legacy name', favorite: true }],
    });

    expect(config.appCatalog.records.find(record => record.id === 'wsjtx')?.enabled).toBe(false);
    expect(config.apps.find(app => app.id === 'wsjtx')?.name).toBe('WSJT-X');
  });

  it('rejects duplicate catalog IDs instead of replacing persisted input', () => {
    const duplicate = {
      ...INITIAL_CONFIG.appCatalog,
      records: [INITIAL_CONFIG.appCatalog.records[0], INITIAL_CONFIG.appCatalog.records[0]],
    };

    expect(() => normalizeDashboardConfig({ appCatalog: duplicate })).toThrow();
  });

  it('returns 422 for invalid catalog input and 500 for filesystem failures', () => {
    const duplicate = {
      ...INITIAL_CONFIG.appCatalog,
      records: [INITIAL_CONFIG.appCatalog.records[0], INITIAL_CONFIG.appCatalog.records[0]],
    };
    const invalidResponse = invokePut(createDashboardConfigRouter({ write: (input: unknown) => normalizeDashboardConfig(input) } as any), { appCatalog: duplicate });
    expect(invalidResponse.statusCode).toBe(422);
    expect(invalidResponse.payload).toMatchObject({ code: 'invalid_dashboard_config' });

    const failureResponse = invokePut(createDashboardConfigRouter({ write: () => { throw new Error('disk full'); } } as any), {});
    expect(failureResponse.statusCode).toBe(500);
  });

  it('returns 422 when persisted target validation fails', () => {
    const invalidTarget = {
      ...INITIAL_CONFIG.appCatalog,
      records: [{ ...INITIAL_CONFIG.appCatalog.records[0], target: { kind: 'web', url: 'https:///missing-host' } }],
    };
    const response = invokePut(createDashboardConfigRouter({ write: (input: unknown) => normalizeDashboardConfig(input) } as any), { appCatalog: invalidTarget });
    expect(response.statusCode).toBe(422);
    expect(response.payload).toMatchObject({ code: 'invalid_dashboard_config' });
  });

  it('reports corrupt files instead of treating them as trusted config', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-config-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'dashboard-config.json');
    fs.writeFileSync(filePath, '{broken');

    expect(new DashboardConfigStore(filePath).read()).toMatchObject({ kind: 'invalid' });
  });

  it('recognizes only loopback request addresses', () => {
    expect(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } } as any)).toBe(true);
    expect(isLoopbackRequest({ socket: { remoteAddress: '::1' } } as any)).toBe(true);
    expect(isLoopbackRequest({ socket: { remoteAddress: '192.168.1.20' } } as any)).toBe(false);
  });

  it('does not expose a browser-selected filesystem path', () => {
    const config = normalizeDashboardConfig({ path: 'C:\\Users\\attacker\\secrets.json', callsign: 'KQ4EVK' });

    expect(config).not.toHaveProperty('path');
    expect(config.callsign).toBe('KQ4EVK');
  });
});