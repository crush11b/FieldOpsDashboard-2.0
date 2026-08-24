import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProductionStaticRouter } from '../productionStatic';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function server() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fieldops-static-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><script type="module" src="/assets/app.123.js"></script><link rel="stylesheet" href="/assets/app.123.css">');
  await fs.writeFile(path.join(root, 'assets', 'app.123.js'), 'console.log(1);');
  await fs.writeFile(path.join(root, 'assets', 'app.123.css'), 'body{}');
  const app = express().use(createProductionStaticRouter(root));
  const listener = await new Promise<ReturnType<typeof app.listen>>(resolve => { const value = app.listen(0, () => resolve(value)); });
  return { baseUrl: `http://127.0.0.1:${(listener.address() as any).port}`, close: () => new Promise<void>(resolve => listener.close(() => resolve())) };
}

describe('production static routing', () => {
  it('serves assets with their content types, 404s missing assets, and falls back for SPA routes', async () => {
    const running = await server();
    try {
      expect((await fetch(`${running.baseUrl}/assets/app.123.js`)).headers.get('content-type')).toContain('javascript');
      expect((await fetch(`${running.baseUrl}/assets/app.123.css`)).headers.get('content-type')).toContain('text/css');
      for (const asset of ['missing.js', 'missing.css']) {
        const response = await fetch(`${running.baseUrl}/assets/${asset}`);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('<!doctype html>');
      }
      const route = await fetch(`${running.baseUrl}/mission/brief`);
      expect(route.status).toBe(200);
      expect(await route.text()).toContain('<!doctype html>');
    } finally { await running.close(); }
  });
});