import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SmartDeployBrief } from '../smartDeployBrief';
import { createFieldReadinessChecklistRouter } from '../fieldReadinessChecklistApi';
import { FieldReadinessChecklistStore } from '../fieldReadinessChecklistStore';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createBrief(id = 'brief-1'): SmartDeployBrief {
  return {
    schemaVersion: 2,
    briefId: id,
    generatedAtUtc: '2026-08-19T10:00:00.000Z',
    status: 'complete',
    activation: { program: 'POTA', reference: 'US-0182', displayName: 'Test Park', coordinates: null, provenance: { kind: 'externally_resolved' } },
  } as unknown as SmartDeployBrief;
}

function createApi(options: { readonly store?: any; readonly brief?: SmartDeployBrief | null; readonly logger?: any } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-checklist-api-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'field-readiness-checklists.json');
  let id = 0;
  const store = options.store ?? new FieldReadinessChecklistStore(filePath, {
    createId: () => `checklist-${++id}`,
    now: () => new Date('2026-08-19T12:00:00.000Z'),
  });
  const brief = options.brief === undefined ? createBrief() : options.brief;
  const briefStore = {
    get: vi.fn((briefId: string) => brief && briefId === brief.briefId
      ? { status: 'found', brief, diagnostics: [] }
      : { status: 'notFound', diagnostics: [] }),
  };
  const app = express();
  app.use(express.json());
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(400).json({ kind: 'request_error', code: 'malformed_json', message: 'The request body contains malformed JSON.' });
  });
  app.use(createFieldReadinessChecklistRouter({ store, briefStore: briefStore as any, logger: options.logger }));
  return { app, store, briefStore, filePath, brief };
}

async function withApi(options: Parameters<typeof createApi>[0], callback: (baseUrl: string, api: ReturnType<typeof createApi>) => Promise<void>) {
  const api = createApi(options);
  const server = http.createServer(api.app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  try { await callback(baseUrl, api); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function jsonRequest(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() };
}

function postBody(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('Field Readiness Checklist API', () => {
  it('creates idempotently from a retained brief and retrieves by brief ID', async () => {
    await withApi({}, async (baseUrl, api) => {
      const created = await jsonRequest(`${baseUrl}/api/field-checklists`, postBody({ briefId: 'brief-1' }));
      const existing = await jsonRequest(`${baseUrl}/api/field-checklists`, postBody({ briefId: 'brief-1' }));
      const found = await jsonRequest(`${baseUrl}/api/field-checklists/brief/brief-1`);
      expect(created.status).toBe(201);
      expect(existing.status).toBe(200);
      expect(existing.body).toMatchObject({ status: 'existing', checklist: { checklistId: created.body.checklist.checklistId, briefId: 'brief-1' } });
      expect(found.body.checklist).toEqual(existing.body.checklist);
      expect(api.briefStore.get).toHaveBeenCalledWith('brief-1');
    });
  });

  it('rejects malformed input and does not create for a missing retained brief', async () => {
    await withApi({}, async (baseUrl) => {
      const invalid = await jsonRequest(`${baseUrl}/api/field-checklists`, postBody({ briefId: 'bad id' }));
      const missing = await jsonRequest(`${baseUrl}/api/field-checklists`, postBody({ briefId: 'brief-2' }));
      const malformed = await fetch(`${baseUrl}/api/field-checklists`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
      expect(invalid.status).toBe(400);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('brief_not_found');
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ code: 'malformed_json' });
    });
  });

  it('updates an item, persists it, and reset clears completion while preserving identity', async () => {
    await withApi({}, async (baseUrl, api) => {
      const created = await jsonRequest(`${baseUrl}/api/field-checklists`, postBody({ briefId: 'brief-1' }));
      const checklistId = created.body.checklist.checklistId;
      const updated = await jsonRequest(`${baseUrl}/api/field-checklists/${checklistId}/items/site_access`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) });
      const reset = await jsonRequest(`${baseUrl}/api/field-checklists/${checklistId}/reset`, postBody({}));
      const reopened = new FieldReadinessChecklistStore(api.filePath).get(checklistId);
      expect(updated.status).toBe(200);
      expect(updated.body.checklist.sections[0].items[0].completed).toBe(true);
      expect(reset.status).toBe(200);
      expect(reset.body.checklist).toMatchObject({ checklistId, briefId: 'brief-1', createdAtUtc: created.body.checklist.createdAtUtc });
      expect(reset.body.checklist.sections.flatMap((section: any) => section.items).every((item: any) => !item.completed)).toBe(true);
      expect(reopened.status).toBe('found');
      if (reopened.status === 'found') expect(reopened.checklist).toEqual(reset.body.checklist);
    });
  });

  it('reports missing resources, invalid item requests, and safe persistence failures', async () => {
    const logger = { warn: vi.fn() };
    await withApi({ logger }, async (baseUrl) => {
      const missing = await jsonRequest(`${baseUrl}/api/field-checklists/missing/items/site_access`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) });
      const invalid = await jsonRequest(`${baseUrl}/api/field-checklists/missing/reset`, postBody({}));
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('checklist_not_found');
      expect(invalid.status).toBe(404);
    });

    const failingStore = {
      getByBriefId: vi.fn(() => ({ status: 'missing', checklists: [], diagnostics: [] })),
      get: vi.fn(() => ({ status: 'notFound', diagnostics: [] })),
      createForBrief: vi.fn(() => { throw new Error('filesystem path must not escape'); }),
      updateItem: vi.fn(),
      reset: vi.fn(),
    };
    await withApi({ store: failingStore, logger }, async (baseUrl) => {
      const result = await jsonRequest(`${baseUrl}/api/field-checklists`, postBody({ briefId: 'brief-1' }));
      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({ kind: 'field_readiness_checklist_error', code: 'persistence_unavailable' });
      expect(JSON.stringify(result.body)).not.toContain('filesystem path');
      expect(logger.warn).toHaveBeenCalledWith('Field Readiness Checklist persistence operation failed.');
    });
  });
});