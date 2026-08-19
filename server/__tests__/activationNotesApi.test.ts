import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SmartDeployBrief } from '../smartDeployBrief';
import { createActivationNotesRouter } from '../activationNotesApi';
import { ActivationNotesStore } from '../activationNotesStore';

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-activation-api-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'activation-notes.json');
  let id = 0;
  const store = options.store ?? new ActivationNotesStore(filePath, {
    createId: () => `id-${++id}`,
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
  app.use((_error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    response.status(400).json({ kind: 'request_error', code: 'malformed_json', message: 'The request body contains malformed JSON.' });
    return;
  });
  app.use(createActivationNotesRouter({ store, briefStore: briefStore as any, logger: options.logger }));
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

describe('Activation Notes API', () => {
  it('lists an empty store honestly', async () => {
    await withApi({}, async (baseUrl) => {
      const result = await jsonRequest(`${baseUrl}/api/activation-notes`);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ kind: 'activation_notes_collections', status: 'missing', collections: [] });
    });
  });

  it('creates from a retained brief and derives activation identity without mutating the brief', async () => {
    await withApi({}, async (baseUrl, api) => {
      const before = structuredClone(api.brief);
      const result = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({ kind: 'activation_notes_collection', status: 'created', collection: { briefId: 'brief-1', activation: { program: 'POTA', reference: 'US-0182', displayName: 'Test Park' } } });
      expect(api.brief).toEqual(before);
      expect(api.briefStore.get).toHaveBeenCalledWith('brief-1');
    });
  });

  it('rejects client activation identity and returns the existing collection idempotently', async () => {
    await withApi({}, async (baseUrl) => {
      const rejected = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1', activation: { program: 'SOTA', reference: 'W1/XX-001' } }));
      expect(rejected.status).toBe(400);
      const created = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      const existing = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      expect(created.status).toBe(201);
      expect(existing.status).toBe(200);
      expect(existing.body).toMatchObject({ status: 'existing', collection: { collectionId: created.body.collection.collectionId } });
    });
  });

  it('retrieves by brief ID and reports a missing brief collection', async () => {
    await withApi({}, async (baseUrl) => {
      await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      const found = await jsonRequest(`${baseUrl}/api/activation-notes/brief/brief-1`);
      const missing = await jsonRequest(`${baseUrl}/api/activation-notes/brief/brief-2`);
      expect(found.status).toBe(200);
      expect(found.body.collection.briefId).toBe('brief-1');
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('not_found');
    });
  });

  it('appends quick and text notes with server-assigned IDs and UTC timestamps', async () => {
    await withApi({}, async (baseUrl) => {
      const created = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      const collectionId = created.body.collection.collectionId;
      const quick = await jsonRequest(`${baseUrl}/api/activation-notes/${collectionId}/notes`, postBody({ kind: 'quick', text: ' Arrived. ' }));
      const text = await jsonRequest(`${baseUrl}/api/activation-notes/${collectionId}/notes`, postBody({ kind: 'text', text: 'Longer field note.' }));
      expect(quick.status).toBe(200);
      expect(text.status).toBe(200);
      expect(text.body.collection.notes).toEqual([
        { noteId: 'id-2', recordedAtUtc: '2026-08-19T12:00:00.000Z', kind: 'quick', text: 'Arrived.' },
        { noteId: 'id-3', recordedAtUtc: '2026-08-19T12:00:00.000Z', kind: 'text', text: 'Longer field note.' },
      ]);
    });
  });

  it('rejects blank, oversized, unsupported, and client-owned note fields', async () => {
    await withApi({}, async (baseUrl) => {
      const created = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      const collectionId = created.body.collection.collectionId;
      for (const body of [
        { kind: 'quick', text: ' ' },
        { kind: 'text', text: 'x'.repeat(501) },
        { kind: 'qso', text: 'ordinary note text' },
        { kind: 'quick', text: 'valid', noteId: 'client-id' },
        { kind: 'quick', text: 'valid', recordedAtUtc: '2026-08-19T12:00:00.000Z' },
      ]) {
        const result = await jsonRequest(`${baseUrl}/api/activation-notes/${collectionId}/notes`, postBody(body));
        expect(result.status).toBe(400);
      }
    });
  });

  it('reports missing briefs and collections without exposing internal details', async () => {
    await withApi({}, async (baseUrl) => {
      const missingBrief = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'unknown' }));
      const missingCollection = await jsonRequest(`${baseUrl}/api/activation-notes/missing/notes`, postBody({ kind: 'quick', text: 'hello' }));
      const missingDelete = await jsonRequest(`${baseUrl}/api/activation-notes/missing`, { method: 'DELETE' });
      expect(missingBrief.status).toBe(404);
      expect(missingBrief.body.code).toBe('brief_not_found');
      expect(missingCollection.status).toBe(404);
      expect(missingCollection.body.code).toBe('collection_not_found');
      expect(missingDelete.status).toBe(404);
      expect(missingDelete.body.code).toBe('collection_not_found');
      expect(JSON.stringify(missingBrief.body)).not.toContain('activation-notes.json');
    });
  });

  it('deletes a collection and persists it across store reconstruction', async () => {
    await withApi({}, async (baseUrl, api) => {
      const created = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      const collectionId = created.body.collection.collectionId;
      const reopened = new ActivationNotesStore(api.filePath);
      expect(reopened.getByBriefId('brief-1').collections).toHaveLength(1);
      const deleted = await jsonRequest(`${baseUrl}/api/activation-notes/${collectionId}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      expect(new ActivationNotesStore(api.filePath).getByBriefId('brief-1').collections).toEqual([]);
    });
  });

  it('returns a safe persistence failure response and logs only a bounded diagnostic', async () => {
    const logger = { warn: vi.fn() };
    const store = {
      list: vi.fn(() => ({ status: 'missing', collections: [], diagnostics: [] })),
      getByBriefId: vi.fn(() => ({ status: 'missing', collections: [], diagnostics: [] })),
      get: vi.fn(() => ({ status: 'notFound', diagnostics: [] })),
      create: vi.fn(() => { throw new Error('filesystem path must not escape'); }),
      appendNote: vi.fn(),
      delete: vi.fn(),
    };
    await withApi({ store, logger }, async (baseUrl) => {
      const result = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({ kind: 'activation_notes_error', code: 'persistence_unavailable' });
      expect(JSON.stringify(result.body)).not.toContain('filesystem path');
      expect(logger.warn).toHaveBeenCalledWith('Activation Notes persistence operation failed.');
    });
  });

  it('distinguishes brief-store and notes-store read failures from not-found', async () => {
    const logger = { warn: vi.fn() };
    const failingBriefStore = { get: vi.fn(() => ({ status: 'notFound', diagnostics: [{ code: 'io_error', message: 'hidden' }] })) };
    await withApi({ brief: null, logger, store: {
      list: vi.fn(() => ({ status: 'ioError', collections: [], diagnostics: [{ code: 'io_error', message: 'hidden' }] })),
      getByBriefId: vi.fn(), get: vi.fn(), create: vi.fn(), appendNote: vi.fn(), delete: vi.fn(),
    } }, async (baseUrl) => {
      const list = await jsonRequest(`${baseUrl}/api/activation-notes`);
      expect(list.status).toBe(503);
    });

    const api = createApi({ brief: null, logger });
    const app = express();
    app.use(express.json());
    app.use(createActivationNotesRouter({ store: api.store, briefStore: failingBriefStore as any, logger }));
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try {
      const result = await jsonRequest(`${baseUrl}/api/activation-notes`, postBody({ briefId: 'brief-1' }));
      expect(result.status).toBe(503);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('returns JSON for malformed request bodies', async () => {
    await withApi({}, async (baseUrl) => {
      const result = await fetch(`${baseUrl}/api/activation-notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({ code: 'malformed_json' });
    });
  });
});