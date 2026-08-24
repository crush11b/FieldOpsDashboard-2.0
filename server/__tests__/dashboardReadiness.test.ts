import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDashboardReadiness } from '../dashboardReadiness';
import { INITIAL_CONFIG } from '../../src/data/defaultConfig';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

async function fixture() {
  const distPath = await mkdtemp(path.join(os.tmpdir(), 'fieldops-readiness-'));
  await mkdir(path.join(distPath, 'assets'));
  await writeFile(path.join(distPath, 'index.html'), '<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">');
  await writeFile(path.join(distPath, 'assets', 'app.js'), 'console.log(1);');
  await writeFile(path.join(distPath, 'assets', 'app.css'), 'body{}');
  return distPath;
}

function fetcher(overrides: Record<string, Response> = {}) {
  return async (input: RequestInfo | URL) => overrides[new URL(input.toString()).pathname]
    ?? new Response('{}', { status: 404 });
}

describe('Dashboard bootstrap readiness', () => {
  it('rejects non-production runtime mode', async () => {
    process.env.NODE_ENV = 'development';
    const result = await checkDashboardReadiness({ distPath: 'missing', baseUrl: 'http://127.0.0.1:3000' });
    expect(result).toMatchObject({ status: 'unavailable', checks: { runtime: 'non-production' } });
  });

  it('requires served assets and usable configuration', async () => {
    process.env.NODE_ENV = 'production';
    const distPath = await fixture();
    const result = await checkDashboardReadiness({
      distPath,
      baseUrl: 'http://127.0.0.1:3000',
      fetcher: fetcher({
        '/': new Response('<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">', { headers: { 'content-type': 'text/html' } }),
        '/assets/app.js': new Response('console.log(1);', { headers: { 'content-type': 'text/javascript' } }),
        '/assets/app.css': new Response('body{}', { headers: { 'content-type': 'text/css' } }),
        '/api/config': new Response(JSON.stringify({ config: INITIAL_CONFIG }), { headers: { 'content-type': 'application/json' } }),
      }),
    });
    expect(result).toMatchObject({ status: 'ready', checks: { runtime: 'production', html: 'ready', assets: 'ready', configuration: 'ready' } });
  });

  it('rejects HTML served in place of a JavaScript asset', async () => {
    process.env.NODE_ENV = 'production';
    const distPath = await fixture();
    const result = await checkDashboardReadiness({
      distPath,
      baseUrl: 'http://127.0.0.1:3000',
      fetcher: fetcher({
        '/': new Response('<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">', { headers: { 'content-type': 'text/html' } }),
        '/assets/app.js': new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
        '/assets/app.css': new Response('body{}', { headers: { 'content-type': 'text/css' } }),
        '/api/config': new Response(JSON.stringify({ config: INITIAL_CONFIG })),
      }),
    });
    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('assets');
  });
});
