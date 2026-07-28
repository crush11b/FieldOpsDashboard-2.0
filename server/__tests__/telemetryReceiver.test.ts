import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  createTelemetryReceiverRouter,
  InMemoryLatestTelemetryStore,
  TELEMETRY_MAX_BODY_BYTES,
  type AuthenticatedAgentIdentity,
  type TelemetryCredentialResolver,
} from '../telemetryReceiver';

const TEST_TIMEOUT_MS = 5_000;
const FIXED_NOW = new Date('2026-07-28T16:00:00.000Z');
const WRITE_TOKEN = 'test-only-write-credential';
const READ_TOKEN = 'test-only-read-credential';

describe('Express telemetry receiver', () => {
  it('stores a canonical envelope and returns an empty 204 response', async () => {
    const harness = createHarness();

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope(),
    });

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const [entry] = harness.store.getSnapshot().entries;
    expect(entry.agent.agentId).toBe('agent-alpha');
    expect(entry.sourceId).toBe('gps-1');
    expect(entry.envelope.source.id).toBe('gps-1');
    expect(entry.ingestedAt).toBe(FIXED_NOW.toISOString());
  });

  it('replaces the same agent/source key without retaining history', async () => {
    const harness = createHarness();
    await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ data: { sequence: 1 } }),
    });

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ data: { sequence: 2 } }),
    });

    expect(response.status).toBe(204);
    const snapshot = harness.store.getSnapshot();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].envelope.data).toEqual({ sequence: 2 });
  });

  it('keeps multiple sources for one authenticated agent distinct', async () => {
    const harness = createHarness();
    await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ source: { id: 'gps', type: 'test' } }),
    });
    await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ source: { id: 'battery', type: 'test' } }),
    });

    expect(harness.store.getSnapshot().entries.map((entry) => entry.sourceId)).toEqual(['battery', 'gps']);
  });

  it('keeps the same source ID under different authenticated agents distinct', async () => {
    const harness = createHarness(new Map([
      [WRITE_TOKEN, identity('agent-alpha', 'telemetry:write')],
      ['test-only-agent-beta', identity('agent-beta', 'telemetry:write')],
      [READ_TOKEN, identity('diagnostic-reader', 'telemetry:read')],
    ]));
    await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope(),
    });
    await harness.request('POST', '/api/v1/telemetry', {
      token: 'test-only-agent-beta',
      body: canonicalEnvelope(),
    });

    const entries = harness.store.getSnapshot().entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.agent.agentId)).toEqual(['agent-alpha', 'agent-beta']);
    expect(entries.every((entry) => entry.sourceId === 'gps-1')).toBe(true);
  });

  it.each([
    ['ok', { data: { value: 1 } }],
    ['degraded', { data: { value: 1 } }],
    ['stale', { data: { value: 1 } }],
    ['cached', {}],
    ['connecting', {}],
    ['unavailable', {}],
    ['error', { error: { code: 'ADAPTER_FAILED', message: 'Adapter failed.', retryable: true } }],
  ])('accepts canonical %s semantics', async (status, statusFields) => {
    const harness = createHarness();
    const body = canonicalEnvelope({ status, ...statusFields });
    if (!Object.prototype.hasOwnProperty.call(statusFields, 'data')) {
      delete body.data;
    }

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body,
    });

    expect(response.status).toBe(204);
  });

  it.each([
    ['unknown status', { status: 'live' }],
    ['missing status', { status: undefined }],
    ['missing source', { source: undefined }],
    ['missing timestamps', { timestamps: undefined }],
    ['invalid source type', { source: { id: 'gps', type: 42 } }],
    ['empty source ID', { source: { id: '  ', type: 'test' } }],
    ['oversized source ID', { source: { id: 'x'.repeat(129), type: 'test' } }],
    ['invalid source metadata', { source: { id: 'gps', type: 'test', metadata: [] } }],
    ['invalid envelope metadata', { metadata: [] }],
    ['ok without data', { data: undefined }],
    ['ok with error', { error: { code: 'FAIL', message: 'Failed.', retryable: true } }],
    ['non-error status with error', { status: 'stale', error: { code: 'FAIL', message: 'Failed.', retryable: true } }],
    ['error without metadata', { status: 'error', data: undefined }],
    ['error with empty code', { status: 'error', data: undefined, error: { code: '', message: 'Failed.', retryable: true } }],
    ['error with invalid retryable', { status: 'error', data: undefined, error: { code: 'FAIL', message: 'Failed.', retryable: 'yes' } }],
    ['error with invalid details', { status: 'error', data: undefined, error: { code: 'FAIL', message: 'Failed.', retryable: true, details: [] } }],
  ])('returns 422 for %s', async (_name, changes) => {
    const harness = createHarness();
    const body = canonicalEnvelope(changes);
    removeUndefinedProperties(body);

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body,
    });

    expect(response.status).toBe(422);
    expect(response.json).toMatchObject({
      type: 'urn:fieldops:telemetry:invalid_envelope',
      status: 422,
    });
    expect(harness.store.getSnapshot().entries).toHaveLength(0);
  });

  it.each([
    ['invalid observedAt', { observedAt: 'not-a-date', receivedAt: FIXED_NOW.toISOString() }],
    ['offset-free observedAt', { observedAt: '2026-07-28T16:00:00', receivedAt: FIXED_NOW.toISOString() }],
    ['invalid calendar date', { observedAt: '2026-02-31T16:00:00Z', receivedAt: FIXED_NOW.toISOString() }],
    ['future observedAt', { observedAt: '2026-07-28T16:05:00.001Z', receivedAt: FIXED_NOW.toISOString() }],
    ['future receivedAt', { observedAt: FIXED_NOW.toISOString(), receivedAt: '2026-07-28T16:05:00.001Z' }],
    ['expires before observed', { observedAt: FIXED_NOW.toISOString(), receivedAt: FIXED_NOW.toISOString(), expiresAt: '2026-07-28T15:59:59Z' }],
  ])('returns 422 for %s', async (_name, timestamps) => {
    const harness = createHarness();

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ timestamps }),
    });

    expect(response.status).toBe(422);
    expect(harness.store.getSnapshot().entries).toHaveLength(0);
  });

  it('accepts old timestamps and additive unknown properties', async () => {
    const harness = createHarness();
    const body = canonicalEnvelope({
      timestamps: {
        observedAt: '2020-01-01T00:00:00-05:00',
        receivedAt: '2020-01-01T05:00:01Z',
      },
      futureField: { supportedLater: true },
    });

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body,
    });

    expect(response.status).toBe(204);
    expect(harness.store.getSnapshot().entries[0].envelope).toHaveProperty('futureField');
  });

  it('accepts canonical explicit JSON null payload and metadata values', async () => {
    const harness = createHarness();

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({
        data: null,
        metadata: null,
        source: { id: 'gps-1', type: 'test', metadata: null },
      }),
    });

    expect(response.status).toBe(204);
    expect(harness.store.getSnapshot().entries[0].envelope.data).toBeNull();
  });

  it('rejects JSON nesting deeper than the receiver limit', async () => {
    const harness = createHarness();
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 33; depth += 1) {
      nested = { child: nested };
    }

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ data: nested }),
    });

    expect(response.status).toBe(422);
  });

  it('returns 400 for malformed JSON without updating the store', async () => {
    const harness = createHarness();

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      rawBody: '{"status":',
    });

    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({ type: 'urn:fieldops:telemetry:malformed_json' });
    expect(harness.store.getSnapshot().entries).toHaveLength(0);
  });

  it.each([null, true, 'telemetry', [canonicalEnvelope()]])(
    'returns 422 when readable JSON is not an envelope object: %j',
    async (body) => {
      const harness = createHarness();

      const response = await harness.request('POST', '/api/v1/telemetry', {
        token: WRITE_TOKEN,
        rawBody: JSON.stringify(body),
      });

      expect(response.status).toBe(422);
      expect(harness.store.getSnapshot().entries).toHaveLength(0);
    },
  );

  it('returns 415 for a non-JSON content type', async () => {
    const harness = createHarness();

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      rawBody: 'status=ok',
      contentType: 'application/x-www-form-urlencoded',
    });

    expect(response.status).toBe(415);
    expect(harness.store.getSnapshot().entries).toHaveLength(0);
  });

  it('returns 413 for a body over 64 KiB without updating the store', async () => {
    const harness = createHarness();
    const body = canonicalEnvelope({ data: { content: 'x'.repeat(TELEMETRY_MAX_BODY_BYTES) } });

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body,
    });

    expect(response.status).toBe(413);
    expect(harness.store.getSnapshot().entries).toHaveLength(0);
  });

  it('does not emit wildcard CORS and does not reject Origin alone', async () => {
    const harness = createHarness();

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope(),
      headers: { Origin: 'https://example.invalid' },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not allow telemetry preflight to fall through to wildcard CORS', async () => {
    const harness = createHarness();

    const response = await harness.request('OPTIONS', '/api/v1/telemetry', {
      headers: { Origin: 'https://example.invalid' },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns 401 for missing and invalid credentials without updating the store', async () => {
    const harness = createHarness();

    const missing = await harness.request('POST', '/api/v1/telemetry', {
      body: canonicalEnvelope(),
    });
    const invalid = await harness.request('POST', '/api/v1/telemetry', {
      token: 'test-only-invalid-credential',
      body: canonicalEnvelope(),
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(missing.json).toEqual(invalid.json);
    expect(harness.store.getSnapshot().entries).toHaveLength(0);
  });

  it('returns 403 when the authenticated identity lacks telemetry write scope', async () => {
    const harness = createHarness();

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: READ_TOKEN,
      body: canonicalEnvelope(),
    });

    expect(response.status).toBe(403);
    expect(harness.store.getSnapshot().entries).toHaveLength(0);
  });

  it('sanitizes resolver failures and does not invoke the store', async () => {
    const secret = 'test-only-secret C:\\credentials\\write-token.dat';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const resolver: TelemetryCredentialResolver = {
      async resolveBearerToken() {
        throw new Error(secret);
      },
    };
    const harness = createHarness(undefined, resolver);

    const response = await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ data: { secret } }),
    });

    expect(response.status).toBe(500);
    expect(response.text).not.toContain(secret);
    expect(consoleError).not.toHaveBeenCalled();
    expect(harness.store.getSnapshot().entries).toHaveLength(0);
    consoleError.mockRestore();
  });

  it('protects the diagnostic snapshot and returns only accepted latest entries', async () => {
    const harness = createHarness();
    await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ data: { sequence: 1 } }),
    });
    await harness.request('POST', '/api/v1/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope({ data: { sequence: 2 } }),
    });

    const unauthorized = await harness.request('GET', '/api/v1/telemetry/snapshot');
    const snapshot = await harness.request('GET', '/api/v1/telemetry/snapshot', { token: READ_TOKEN });

    expect(unauthorized.status).toBe(401);
    expect(snapshot.status).toBe(200);
    expect(snapshot.json.entries).toHaveLength(1);
    expect(snapshot.json.entries[0]).toMatchObject({
      agent: { agentId: 'agent-alpha' },
      sourceId: 'gps-1',
      envelope: { data: { sequence: 2 } },
    });
    expect(snapshot.text).not.toContain(WRITE_TOKEN);
    expect(snapshot.text).not.toContain(READ_TOKEN);
  });

  it('returns 404 for an unknown versioned telemetry route', async () => {
    const harness = createHarness();

    const response = await harness.request('POST', '/api/v2/telemetry', {
      token: WRITE_TOKEN,
      body: canonicalEnvelope(),
    });

    expect(response.status).toBe(404);
  });
});

describe('InMemoryLatestTelemetryStore', () => {
  it('starts empty and owns an immutable copy of accepted telemetry', () => {
    const store = new InMemoryLatestTelemetryStore(() => FIXED_NOW);
    const envelope = canonicalEnvelope();
    store.upsert(identity('agent-alpha', 'telemetry:write'), envelope as never);
    envelope.data.value = 999;

    const snapshot = store.getSnapshot();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].envelope.data).toEqual({ value: 1 });
    expect(Object.isFrozen(snapshot.entries[0].envelope)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0].envelope.data)).toBe(true);
  });
});

function createHarness(
  identities = new Map<string, AuthenticatedAgentIdentity>([
    [WRITE_TOKEN, identity('agent-alpha', 'telemetry:write')],
    [READ_TOKEN, identity('diagnostic-reader', 'telemetry:read')],
  ]),
  resolver: TelemetryCredentialResolver = {
    async resolveBearerToken(token) {
      return identities.get(token) ?? null;
    },
  },
) {
  const store = new InMemoryLatestTelemetryStore(() => FIXED_NOW);
  const app = express();
  app.use(createTelemetryReceiverRouter({
    credentialResolver: resolver,
    store,
    now: () => FIXED_NOW,
    enableDiagnosticSnapshot: true,
  }));
  // Mirrors the legacy middleware that follows the receiver in server.ts.
  // Receiver responses must complete before this wildcard policy is reached.
  app.use((_request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });

  return {
    store,
    request: (
      method: 'GET' | 'POST' | 'OPTIONS',
      path: string,
      options: RequestOptions = {},
    ) => sendRequest(app, method, path, options),
  };
}

interface RequestOptions {
  readonly token?: string;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

async function sendRequest(
  app: express.Express,
  method: 'GET' | 'POST' | 'OPTIONS',
  path: string,
  options: RequestOptions,
) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const headers = new Headers(options.headers);
    if (options.token) {
      headers.set('Authorization', `Bearer ${options.token}`);
    }

    let body: string | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
      headers.set('Content-Type', options.contentType ?? 'application/json');
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers.set('Content-Type', options.contentType ?? 'application/json');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const text = await response.text();
    const responseContentType = response.headers.get('content-type');
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: text && responseContentType?.includes('json') ? JSON.parse(text) : null,
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function canonicalEnvelope(changes: Record<string, any> = {}) {
  return {
    status: 'ok',
    source: { id: 'gps-1', type: 'test' },
    timestamps: {
      observedAt: '2026-07-28T15:59:59.0000000Z',
      receivedAt: '2026-07-28T16:00:00.0000000Z',
    },
    data: { value: 1 },
    ...changes,
  };
}

function identity(agentId: string, ...scopes: string[]): AuthenticatedAgentIdentity {
  return { agentId, scopes };
}

function removeUndefinedProperties(value: Record<string, any>): void {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
}
