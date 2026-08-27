import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createActivation, normalizeActivation, updateActivationStatus } from '../activation';
import { ActivationStore } from '../activationStore';
import { createActivationRouter } from '../activationApi';
import { ActivationNotesStore } from '../activationNotesStore';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const now = () => new Date('2026-08-25T12:00:00.000Z');
function stores() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-activation-')); directories.push(directory); const activationPath = path.join(directory, 'activations.json'); return { activation: new ActivationStore(activationPath, { now, createId: () => 'activation-1' }), activationPath, notes: new ActivationNotesStore(path.join(directory, 'activation-notes.json'), { now, createId: () => 'notes-1' }) }; }

describe('Activation model and store', () => {
  it('supports POTA, SOTA, and General with optional context', () => {
    expect(createActivation({ type: 'POTA', reference: 'us-1', plannedLocation: { latitude: 1, longitude: 2 }, missionWindow: { start: '2026-08-25T10:00:00Z', end: '2026-08-25T11:00:00Z' } }, { now, createId: () => 'pota-1' }).type).toBe('POTA');
    expect(createActivation({ type: 'SOTA' }, { now, createId: () => 'sota-1' }).reference).toBeUndefined();
    expect(createActivation({ type: 'General' }, { now, createId: () => 'general-1' }).type).toBe('General');
    expect(normalizeActivation({ type: 'POTA' }).valid).toBe(false);
  });
  it('persists, reloads, transitions, and reports corrupt data honestly', () => {
    const { activation: store, activationPath } = stores();
    const created = store.create({ type: 'General' }).activation;
    const active = updateActivationStatus(created, 'active', now);
    store.save(active);
    const loaded = new ActivationStore(activationPath).get('activation-1');
    expect(loaded.status).toBe('found');
    expect((loaded as any).activation.status).toBe('active');
  });
  it('skips malformed persisted records with diagnostics', () => {
    const { activation: store, activationPath: filePath } = stores();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, activations: [{ activationId: 'bad', type: 'POTA' }] }));
    expect(store.list()).toMatchObject({ status: 'loaded', activations: [], diagnostics: [{ code: 'invalid_activation' }] });
  });
});

describe('Activation API', () => {
  it('initializes once from a SmartDeploy brief and associates notes', async () => {
    const { activation, notes } = stores();
    const brief = { schemaVersion: 2, briefId: 'brief-1', activation: { program: 'POTA', reference: 'US-1', displayName: 'Test Park' }, plannedOperatingSite: { location: { coordinates: { lat: 10, lon: 20 }, gridSquare: 'FN20' } }, missionWindow: { start: '2026-08-25T10:00:00Z', end: '2026-08-25T11:00:00Z' } } as any;
    const app = express(); app.use(express.json()); app.use(createActivationRouter({ store: activation, notesStore: notes, briefStore: { get: () => ({ status: 'found', brief, diagnostics: [] }) } as any, now }));
    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listener = app.listen(0, () => resolve(listener)); });
    try {
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/activations/from-brief`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ briefId: 'brief-1' }) });
      const payload = await response.json() as any;
      expect(response.status).toBe(201); expect(payload.activation.type).toBe('POTA'); expect(payload.activation.briefId).toBe('brief-1'); expect(payload.activation.notesCollectionId).toBe('notes-1');
      const existing = await fetch(`http://127.0.0.1:${address.port}/api/activations/from-brief`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ briefId: 'brief-1' }) });
      expect(existing.status).toBe(200);
      const transition = await fetch(`http://127.0.0.1:${address.port}/api/activations/activation-1/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
      expect(transition.status).toBe(409);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});