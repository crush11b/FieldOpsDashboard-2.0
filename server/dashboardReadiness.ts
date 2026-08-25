import type { Request, Response as ExpressResponse, Router } from 'express';
import express from 'express';
import { isUsableDashboardConfig } from '../src/dashboardConfigValidation';
import { getDashboardRuntimeMode } from './runtimeMode';

export interface DashboardReadinessOptions {
  readonly distPath: string;
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
}

export interface DashboardReadinessResult {
  readonly status: 'ready' | 'unavailable';
  readonly checks: {
    readonly runtime: 'production' | 'non-production';
    readonly html: 'ready' | 'unavailable';
    readonly assets: 'ready' | 'unavailable';
    readonly configuration: 'ready' | 'default' | 'unavailable';
  };
  readonly message: string;
}

const ASSET_PATTERN = /(?:src|href)="(\/assets\/[^"?#]+)"/g;
const READINESS_PROBE_TIMEOUT_MS = 3000;

export function createDashboardReadinessRouter(options: DashboardReadinessOptions): Router {
  const router = express.Router();
  router.get('/api/readiness', async (_request: Request, response: ExpressResponse) => {
    const result = await checkDashboardReadiness(options);
    response.status(result.status === 'ready' ? 200 : 503).json(result);
  });
  return router;
}

export async function checkDashboardReadiness(options: DashboardReadinessOptions): Promise<DashboardReadinessResult> {
  if (getDashboardRuntimeMode(process.env.NODE_ENV) !== 'production') {
    return unavailable('The Dashboard is not running in production mode.', 'non-production', 'unavailable', 'unavailable', 'unavailable');
  }

  const fetcher = options.fetcher ?? fetch;
  let htmlResponse: Response;
  try {
    htmlResponse = await fetchWithTimeout(fetcher, new URL('/', options.baseUrl));
  } catch {
    return unavailable('The production Dashboard HTML is unavailable.', 'production', 'unavailable', 'unavailable', 'unavailable');
  }
  const htmlType = htmlResponse.headers.get('content-type')?.toLowerCase() ?? '';
  if (!htmlResponse.ok || !htmlType.includes('text/html')) {
    return unavailable('The production Dashboard HTML is unavailable or has an incorrect content type.', 'production', 'unavailable', 'unavailable', 'unavailable');
  }
  const html = await htmlResponse.text();

  const assets = [...html.matchAll(ASSET_PATTERN)].map(match => match[1]);
  const javascript = assets.find(asset => asset.endsWith('.js'));
  const stylesheet = assets.find(asset => asset.endsWith('.css'));
  if (!javascript || !stylesheet) {
    return unavailable('The production Dashboard HTML does not reference its required assets.', 'production', 'ready', 'unavailable', 'unavailable');
  }

  const [javascriptResponse, stylesheetResponse, configurationResponse] = await Promise.all([
    fetchAsset(fetcher, options.baseUrl, javascript, 'javascript'),
    fetchAsset(fetcher, options.baseUrl, stylesheet, 'stylesheet'),
    fetchConfiguration(fetcher, options.baseUrl),
  ]);
  if (!javascriptResponse || !stylesheetResponse) {
    return unavailable('The production Dashboard assets are unavailable or have incorrect content types.', 'production', 'ready', 'unavailable', configurationResponse);
  }
  if (configurationResponse === 'unavailable') {
    return unavailable('The local Dashboard configuration is unavailable or malformed.', 'production', 'ready', 'ready', configurationResponse);
  }

  return {
    status: 'ready',
    checks: { runtime: 'production', html: 'ready', assets: 'ready', configuration: configurationResponse },
    message: 'The production Dashboard can bootstrap locally.',
  };
}

async function fetchAsset(
  fetcher: typeof fetch,
  baseUrl: string,
  asset: string,
  kind: 'javascript' | 'stylesheet',
): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(fetcher, new URL(asset, baseUrl));
    if (!response.ok) return false;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    return kind === 'javascript'
      ? contentType.includes('javascript')
      : contentType.includes('text/css');
  } catch {
    return false;
  }
}

async function fetchConfiguration(fetcher: typeof fetch, baseUrl: string): Promise<'ready' | 'default' | 'unavailable'> {
  try {
    const response = await fetchWithTimeout(fetcher, new URL('/api/config', baseUrl));
    if (response.status === 404) return 'default';
    if (!response.ok) return 'unavailable';
    const payload = await response.json() as { config?: unknown };
    return isUsableConfiguration(payload.config) ? 'ready' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function isUsableConfiguration(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return (config.theme === 'dark_tactical' || config.theme === 'night_vision' || config.theme === 'sunlight')
    && typeof config.audioFeedback === 'boolean'
    && Array.isArray(config.apps);
}

function unavailable(
  message: string,
  runtime: 'production' | 'non-production',
  html: 'ready' | 'unavailable',
  assets: 'ready' | 'unavailable',
  configuration: 'ready' | 'default' | 'unavailable',
): DashboardReadinessResult {
  return { status: 'unavailable', checks: { runtime, html, assets, configuration }, message };
}

async function fetchWithTimeout(fetcher: typeof fetch, input: RequestInfo | URL): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READINESS_PROBE_TIMEOUT_MS);
  try {
    return await fetcher(input, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}