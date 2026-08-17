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