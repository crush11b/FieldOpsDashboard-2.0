import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createActivation } from '../activation';
import { ActivationStore } from '../activationStore';
import { createQsoRouter } from '../qsoApi';
import { QsoStore } from '../qsoStore';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
async function setup() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-qso-api-')); dirs.push(dir); const now = () => new Date('2026-08-25T12:00:00.000Z'); const activationStore = new ActivationStore(path.join(dir, 'activations.json'), { now, createId: () => 'activation-1' }); const activation = activationStore.create({ type: 'POTA', reference: 'US-0182' }).activation; const qsoStore = new QsoStore(path.join(dir, 'qsos.json'), { now, createId: (() => { let id = 0; return () => `qso-${++id}`; })() }); const app = express(); app.use(express.json()); app.use(createQsoRouter({ activationStore, store: qsoStore, now })); const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, resolve)); const address = server.address(); return { activation, server, base: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` }; }
async function json(url: string, init?: RequestInit) { const response = await fetch(url, init); return { status: response.status, body: await response.json() }; }
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('QSO API', () => {
  it('supports manual CRUD, Activation scoping, import duplicate reporting, and export', async () => { const api = await setup(); try { const root = `${api.base}/api/activations/${api.activation.activationId}/qsos`; const created = await json(root, post({ qsoDateTimeUtc: '2026-08-25T11:00:00Z', callsign: 'w1aw', band: '20m', mode: 'SSB' })); expect(created.status).toBe(201); const qsoId = created.body.qso.qsoId; const updated = await json(`${root}/${qsoId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callsign: 'K1ABC', qsoDateTimeUtc: '2026-08-25T11:01:00Z', band: '20m', mode: 'SSB' }) }); expect(updated.body.qso.callsign).toBe('K1ABC'); const adif = '<QSO_DATE:8>20260825<TIME_ON:6>120000<CALL:4>W1AW<BAND:3>20M<MODE:3>FT8<EOR>'; const imported = await json(`${root}/import`, post({ content: adif })); const repeated = await json(`${root}/import`, post({ content: adif })); expect(imported.body.imported).toBe(1); expect(repeated.body.duplicates).toBe(1); const exported = await fetch(`${root}/export`); expect(exported.status).toBe(200); expect(await exported.text()).toContain('<CALL:4>W1AW'); const deleted = await fetch(`${root}/${qsoId}`, { method: 'DELETE' }); expect(deleted.status).toBe(200); } finally { await new Promise<void>(resolve => api.server.close(() => resolve())); } });
  it('requires an existing Activation and rejects invalid QSO data', async () => { const api = await setup(); try { const missing = await json(`${api.base}/api/activations/missing/qsos`, post({ callsign: 'W1AW' })); expect(missing.status).toBe(404); const invalid = await json(`${api.base}/api/activations/${api.activation.activationId}/qsos`, post({ callsign: ' ', mode: 'SSB', band: '20m', qsoDateTimeUtc: 'bad' })); expect(invalid.status).toBe(400); } finally { await new Promise<void>(resolve => api.server.close(() => resolve())); } });
});
