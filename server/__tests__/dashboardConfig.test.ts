import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INITIAL_CONFIG } from '../../src/data/defaultConfig';
import {
  DashboardConfigStore,
  getDefaultDashboardConfigPath,
  isLoopbackRequest,
  normalizeDashboardConfig,
  parseDashboardConfigJson,
  resolveWsjtxConfiguration,
} from '../dashboardConfig';

const temporaryDirectories: string[] = [];

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
    expect(config.apps).toEqual(INITIAL_CONFIG.apps);
    expect(config.propagation.stationProfile).toEqual(INITIAL_CONFIG.propagation.stationProfile);
  });

  it('defaults a missing propagation profile and preserves unrelated fields', () => {
    const config = normalizeDashboardConfig({ callsign: 'KQ4EVK', theme: 'sunlight' });

    expect(config.callsign).toBe('KQ4EVK');
    expect(config.theme).toBe('sunlight');
    expect(config.propagation.stationProfile).toEqual(INITIAL_CONFIG.propagation.stationProfile);
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