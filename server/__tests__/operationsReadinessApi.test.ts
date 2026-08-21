import express from 'express';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createOperationsReadinessRouter } from '../operationsReadinessApi';
import type { OperationsReadinessAssemblyOptions, OperationsReadinessAssemblyResult } from '../operationsReadinessAssembly';

function appFor(result: OperationsReadinessAssemblyResult) {
  const app = express();
  app.use(createOperationsReadinessRouter({ assembly: async () => result }));
  return app;
}

function appForAssembly(assembly: (briefId: string, options?: OperationsReadinessAssemblyOptions) => Promise<OperationsReadinessAssemblyResult>) {
  const app = express();
  app.use(createOperationsReadinessRouter({ assembly }));
  return app;
}

async function request(result: OperationsReadinessAssemblyResult, path: string) {
  const server = http.createServer(appFor(result));
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${path}`;
  try {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function requestApp(app: express.Express, path: string) {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${path}`;
  try {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('Operations Readiness API', () => {
  it('rejects malformed brief IDs before assembly', async () => {
    const result = await request({ status: 'ok', summary: {} as never, diagnostics: [] }, '/api/operations-readiness/%5Cbad');
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ kind: 'operations_readiness_error', code: 'invalid_id' });
  });

  it.each([
    ['notFound', 404, 'brief_not_found'],
    ['unsupported', 422, 'unsupported_brief_schema'],
    ['unavailable', 503, 'readiness_unavailable'],
  ] as const)('maps %s assembly results to the contract status', async (status, expectedStatus, code) => {
    const result = await request({ status, diagnostics: [{ code: code as never, message: 'safe diagnostic' }] } as never, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(expectedStatus);
    expect(result.body).toMatchObject({ kind: 'operations_readiness_error', code, diagnostics: [{ message: 'safe diagnostic' }] });
  });

  it('returns the read-only summary envelope', async () => {
    const result = await request({ status: 'ok', summary: { evaluatedAtUtc: '2026-08-19T12:00:00.000Z' } as never, diagnostics: [] }, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: 'operations_readiness', briefId: 'brief-1', summary: { evaluatedAtUtc: '2026-08-19T12:00:00.000Z' }, diagnostics: [] });
  });

  it('passes the decoded valid brief ID to the assembly', async () => {
    let receivedBriefId = '';
    const result = await requestApp(appForAssembly(async briefId => {
      receivedBriefId = briefId;
      return { status: 'ok', summary: {} as never, diagnostics: [] };
    }), '/api/operations-readiness/brief%3Aone');
    expect(result.status).toBe(200);
    expect(receivedBriefId).toBe('brief:one');
  });

  it.each([
    ['omitted', '', false],
    ['empty', '?includeLiveWeather=', false],
    ['false', '?includeLiveWeather=false', false],
    ['one', '?includeLiveWeather=1', false],
    ['yes', '?includeLiveWeather=yes', false],
    ['uppercase', '?includeLiveWeather=TRUE', false],
    ['repeated values', '?includeLiveWeather=true&includeLiveWeather=false', false],
    ['array-like value', '?includeLiveWeather[]=true', false],
    ['object-like value', '?includeLiveWeather[enabled]=true', false],
    ['exact lowercase true', '?includeLiveWeather=true', true],
  ] as const)('uses live weather only for %s', async (_label, query, expected) => {
    let received: boolean | undefined;
    const result = await requestApp(appForAssembly(async (_briefId, options) => {
      received = options?.includeLiveWeather;
      return { status: 'ok', summary: {} as never, diagnostics: [] };
    }), `/api/operations-readiness/brief-1${query}`);
    expect(result.status).toBe(200);
    expect(received).toBe(expected);
  });

  it('returns 200 when optional evidence is diagnosed but summary assembly succeeds', async () => {
    const result = await request({ status: 'ok', summary: {} as never, diagnostics: [{ code: 'checklist_unavailable', message: 'Checklist evidence is unavailable.' }] }, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ kind: 'operations_readiness', diagnostics: [{ code: 'checklist_unavailable' }] });
  });

  it('keeps bounded unavailable results at 503', async () => {
    const result = await request({ status: 'unavailable', diagnostics: [{ code: 'evaluation_clock_unavailable', message: 'The evaluation clock is unavailable.' }] }, '/api/operations-readiness/brief-1');
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: 'readiness_unavailable', diagnostics: [{ code: 'evaluation_clock_unavailable' }] });
  });

  it('returns a safe 500 when assembly unexpectedly throws', async () => {
    const result = await requestApp(appForAssembly(async () => { throw new Error('C:\\private\\secret\nstack'); }), '/api/operations-readiness/brief-1');
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ kind: 'operations_readiness_error', code: 'readiness_internal_error', message: 'Operations Readiness encountered an unexpected internal error.' });
    expect(JSON.stringify(result.body)).not.toContain('private');
    expect(JSON.stringify(result.body)).not.toContain('secret');
  });

  it('does not invoke assembly for a malformed ID', async () => {
    const assembly = async () => ({ status: 'ok', summary: {} as never, diagnostics: [] } as OperationsReadinessAssemblyResult);
    const spy = vi.fn(assembly);
    const result = await requestApp(appForAssembly(spy), '/api/operations-readiness/%5Cbad');
    expect(result.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
