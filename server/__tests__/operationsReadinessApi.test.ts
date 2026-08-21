import express from 'express';
import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { createOperationsReadinessRouter } from '../operationsReadinessApi';
import type { OperationsReadinessAssemblyResult } from '../operationsReadinessAssembly';

function appFor(result: OperationsReadinessAssemblyResult) {
  const app = express();
  app.use(createOperationsReadinessRouter({ assembly: async () => result }));
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
});
