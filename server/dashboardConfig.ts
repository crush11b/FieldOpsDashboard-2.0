import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type Router } from 'express';
import type { AppCategory, AppLauncherItem, DashboardConfig } from '../src/types';
import { INITIAL_CONFIG } from '../src/data/defaultConfig';
import { normalizeStationProfile } from '../src/propagation/stationProfileCatalog';
import { PROPAGATION_REGION_IDS, type PropagationRegionId } from '../src/propagation/regionalDestinations';
import { isUsableDashboardConfig } from '../src/dashboardConfigValidation';

const CONFIG_FILE_NAME = 'dashboard-config.json';
const MAX_TEXT_LENGTH = 512;
const APP_CATEGORIES: readonly AppCategory[] = [
  'digital', 'aprs', 'satellite', 'network_voice', 'web_apps', 'utilities',
  'logging', 'mapping', 'radio_control', 'custom',
];
const VALID_BAUD_RATES = new Set([4800, 9600, 19200, 38400, 57600, 115200]);
const WSJTX_DEFAULT_PORT = 2237;
const WSJTX_DEFAULT_MULTICAST_ADDRESS = '239.255.0.0';
const WSJTX_DEFAULT_HOST = '127.0.0.1';

export interface ResolvedWsjtxConfiguration {
  readonly mode: 'multicast' | 'unicast';
  readonly host?: string;
  readonly port: number;
  readonly multicastAddress?: string;
  readonly multicastInterface?: string;
}

export type DashboardConfigFileResult =
  | { kind: 'missing' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'loaded'; config: DashboardConfig };

export function getDefaultDashboardConfigPath(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const localAppData = environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local');
  return path.join(localAppData, 'FieldOpsDashboard', CONFIG_FILE_NAME);
}

export function normalizeDashboardConfig(input: unknown): DashboardConfig {
  const source = isRecord(input) ? input : {};
  const defaultConfig = INITIAL_CONFIG;
  const sourceApps = Array.isArray(source.apps) ? source.apps : [];
  const apps = sourceApps
    .map(normalizeApp)
    .filter((app): app is AppLauncherItem => app !== null);
  const appIds = new Set(apps.map(app => app.id));
  const completeApps = [
    ...apps,
    ...defaultConfig.apps.filter(app => !appIds.has(app.id)).map(cloneApp),
  ];

  return {
    theme: source.theme === 'night_vision' || source.theme === 'sunlight' ? source.theme : defaultConfig.theme,
    audioFeedback: typeof source.audioFeedback === 'boolean' ? source.audioFeedback : defaultConfig.audioFeedback,
    autoGps: typeof source.autoGps === 'boolean' ? source.autoGps : defaultConfig.autoGps,
    appGridColumns: source.appGridColumns === 2 || source.appGridColumns === 3 || source.appGridColumns === 4 || source.appGridColumns === 6 ? source.appGridColumns : defaultConfig.appGridColumns,
    showRoadmapTools: typeof source.showRoadmapTools === 'boolean' ? source.showRoadmapTools : defaultConfig.showRoadmapTools,
    favoriteCategoryOnly: typeof source.favoriteCategoryOnly === 'boolean' ? source.favoriteCategoryOnly : defaultConfig.favoriteCategoryOnly,
    callsign: boundedString(source.callsign, defaultConfig.callsign).trim().toUpperCase(),
    potaParkRef: boundedString(source.potaParkRef, defaultConfig.potaParkRef).trim(),
    gpsComPort: boundedString(source.gpsComPort, defaultConfig.gpsComPort ?? '').trim(),
    gpsBaudRate: typeof source.gpsBaudRate === 'number' && VALID_BAUD_RATES.has(source.gpsBaudRate) ? source.gpsBaudRate : defaultConfig.gpsBaudRate,
    wsjtx: normalizeWsjtxConfig(source.wsjtx),
    propagation: {
      stationProfile: normalizeStationProfile(isRecord(source.propagation) ? source.propagation.stationProfile : undefined),
      destinationRegion: isRecord(source.propagation) && PROPAGATION_REGION_IDS.includes(source.propagation.destinationRegion as PropagationRegionId)
        ? source.propagation.destinationRegion as PropagationRegionId
        : defaultConfig.propagation.destinationRegion,
    },
    apps: completeApps,
  };
}

export function resolveWsjtxConfiguration(
  config: DashboardConfig,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedWsjtxConfiguration {
  const configuredMode = environment.WSJTX_MODE?.trim().toLowerCase();
  const mode = configuredMode === 'unicast' || (!configuredMode && environment.WSJTX_HOST?.trim() && !environment.WSJTX_MULTICAST_ADDRESS?.trim())
    ? 'unicast'
    : configuredMode === 'multicast' || environment.WSJTX_MULTICAST_ADDRESS?.trim() || config.wsjtx.mode === 'multicast'
      ? 'multicast'
      : 'unicast';
  const portValue = Number.parseInt(environment.WSJTX_PORT || '', 10);
  const port = Number.isInteger(portValue) && portValue > 0 ? portValue : config.wsjtx.port;
  if (mode === 'unicast') return { mode, host: environment.WSJTX_HOST?.trim() || config.wsjtx.host || WSJTX_DEFAULT_HOST, port };
  return {
    mode,
    port,
    multicastAddress: environment.WSJTX_MULTICAST_ADDRESS?.trim() || config.wsjtx.multicastAddress || WSJTX_DEFAULT_MULTICAST_ADDRESS,
    multicastInterface: environment.WSJTX_MULTICAST_INTERFACE?.trim() || config.wsjtx.multicastInterface || undefined,
  };
}

export function parseDashboardConfigJson(json: string): DashboardConfig | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) return null;
    const config = normalizeDashboardConfig(parsed);
    return isUsableDashboardConfig(config) ? config : null;
  } catch {
    return null;
  }
}

export class DashboardConfigStore {
  constructor(private readonly filePath: string) {}

  read(): DashboardConfigFileResult {
    try {
      const json = fs.readFileSync(this.filePath, 'utf8');
      const config = parseDashboardConfigJson(json);
      return config ? { kind: 'loaded', config } : { kind: 'invalid', reason: 'The configuration file did not contain valid JSON configuration.' };
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return { kind: 'missing' };
      return { kind: 'invalid', reason: 'The configuration file could not be read.' };
    }
  }

  write(input: unknown): DashboardConfig {
    const config = normalizeDashboardConfig(input);
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      try {
        fs.renameSync(temporaryPath, this.filePath);
      } catch (error) {
        if (!isNodeError(error) || (error.code !== 'EEXIST' && error.code !== 'EPERM')) throw error;
        fs.rmSync(this.filePath, { force: true });
        fs.renameSync(temporaryPath, this.filePath);
      }
    } finally {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best-effort temporary cleanup */ }
    }
    return config;
  }
}

export function isLoopbackRequest(request: Pick<Request, 'socket'>): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function createDashboardConfigRouter(
  store: DashboardConfigStore,
): Router {
  const router = express.Router();
  router.get('/api/config', (request, response) => {
    if (!isLoopbackRequest(request)) {
      response.status(403).json({ error: 'Configuration is local-only.' });
      return;
    }
    const result = store.read();
    if (result.kind === 'missing') {
      response.status(404).json({ error: 'No persisted Dashboard configuration exists.' });
      return;
    }
    if (result.kind === 'invalid') {
      response.status(422).json({ error: result.reason });
      return;
    }
    response.json({ config: result.config });
  });

  router.put('/api/config', (request, response) => {
    if (!isLoopbackRequest(request)) {
      response.status(403).json({ error: 'Configuration is local-only.' });
      return;
    }
    try {
      response.json({ config: store.write(request.body) });
    } catch {
      response.status(500).json({ error: 'Dashboard configuration could not be persisted.' });
    }
  });
  return router;
}

function normalizeApp(input: unknown): AppLauncherItem | null {
  if (!isRecord(input)) return null;
  const id = boundedString(input.id, '').trim();
  const name = boundedString(input.name, '').trim();
  if (!id || id.length > 128 || !name) return null;
  const category = APP_CATEGORIES.includes(input.category as AppCategory) ? input.category as AppCategory : 'custom';
  const app: AppLauncherItem = {
    id,
    name,
    category,
    iconName: boundedString(input.iconName, 'Radio'),
    executablePath: boundedString(input.executablePath, ''),
    description: boundedString(input.description, ''),
    installed: typeof input.installed === 'boolean' ? input.installed : false,
    favorite: typeof input.favorite === 'boolean' ? input.favorite : false,
  };
  if (typeof input.uri === 'string' && input.uri.length <= MAX_TEXT_LENGTH) app.uri = input.uri;
  if (typeof input.hotkey === 'string') app.hotkey = input.hotkey.slice(0, 32);
  if (typeof input.args === 'string') app.args = input.args.slice(0, MAX_TEXT_LENGTH);
  if (typeof input.workingDir === 'string') app.workingDir = input.workingDir.slice(0, MAX_TEXT_LENGTH);
  if (Array.isArray(input.deps)) app.deps = input.deps.filter((dep): dep is string => typeof dep === 'string').slice(0, 32).map(dep => dep.slice(0, 128));
  return app;
}

function normalizeWsjtxConfig(input: unknown): DashboardConfig['wsjtx'] {
  const source = isRecord(input) ? input : {};
  const mode = source.mode === 'unicast' ? 'unicast' : 'multicast';
  const port = typeof source.port === 'number' && Number.isInteger(source.port) && source.port > 0 && source.port <= 65535 ? source.port : WSJTX_DEFAULT_PORT;
  return {
    mode,
    multicastAddress: boundedString(source.multicastAddress, WSJTX_DEFAULT_MULTICAST_ADDRESS).trim() || WSJTX_DEFAULT_MULTICAST_ADDRESS,
    multicastInterface: boundedString(source.multicastInterface, '').trim(),
    host: boundedString(source.host, WSJTX_DEFAULT_HOST).trim() || WSJTX_DEFAULT_HOST,
    port,
  };
}

function cloneApp(app: AppLauncherItem): AppLauncherItem {
  return { ...app, deps: app.deps ? [...app.deps] : undefined };
}

function boundedString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : fallback;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
