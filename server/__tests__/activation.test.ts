import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createActivation, normalizeActivation, updateActivationStatus } from '../activation';
import { ActivationStore } from '../activationStore';
import { createActivationRouter } from '../activationApi';
import { ActivationNotesStore } from '../activationNotesStore';
import { createOperationalIntelligenceRouter } from '../operationalIntelligenceApi';
import { OperationalIntelligenceStore } from '../operationalIntelligenceStore';

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
  it('completes an older active Activation when starting a planned one', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-activation-lifecycle-')); directories.push(directory);
    const store = new ActivationStore(path.join(directory, 'activations.json'), { now, createId: (() => { let id = 0; return () => `activation-${++id}`; })() });
    const first = store.create({ type: 'General' }).activation;
    store.activate(first.activationId);
    const second = store.create({ type: 'General' }).activation;
    const activated = store.activate(second.activationId);
    expect(activated.reconciledActivationIds).toEqual([first.activationId]);
    expect(store.get(first.activationId)).toMatchObject({ status: 'found', activation: { status: 'completed' } });
    expect(store.get(second.activationId)).toMatchObject({ status: 'found', activation: { status: 'active' } });
  });
  it('repairs historical multiple-active records without removing completed history', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-activation-repair-')); directories.push(directory);
    const filePath = path.join(directory, 'activations.json');
    const make = (activationId: string, status: 'active' | 'completed') => createActivation({ type: 'General', status }, { now, createId: () => activationId });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, activations: [make('active-2', 'active'), make('active-1', 'active'), make('completed-1', 'completed')] }));
    const store = new ActivationStore(filePath, { now });
    expect(store.reconcileActive('active-1').reconciledActivationIds).toEqual(['active-2']);
    expect(store.list().activations.filter(item => item.status === 'active')).toHaveLength(1);
    expect(store.get('completed-1')).toMatchObject({ status: 'found', activation: { status: 'completed' } });
  });
  it('keeps Activation history when its SmartDeploy brief is deleted', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-activation-delete-')); directories.push(directory);
    const activationStore = new ActivationStore(path.join(directory, 'activations.json'), { now, createId: () => 'activation-1' });
    const activation = activationStore.create({ type: 'General', briefId: 'brief-1' }).activation;
    const briefStore = { delete: () => ({ status: 'deleted', brief: { briefId: 'brief-1' }, diagnostics: [] }) };
    expect(briefStore.delete().status).toBe('deleted');
    expect(activationStore.get(activation.activationId)).toMatchObject({ status: 'found', activation: { activationId: 'activation-1', briefId: 'brief-1' } });
  });
  it('skips malformed persisted records with diagnostics', () => {
    const { activation: store, activationPath: filePath } = stores();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, activations: [{ activationId: 'bad', type: 'POTA' }] }));
    expect(store.list()).toMatchObject({ status: 'loaded', activations: [], diagnostics: [{ code: 'invalid_activation' }] });
  });
  it('enforces lifecycle transitions and current timing invariants', () => {
    const activation = createActivation({ type: 'General' }, { now, createId: () => 'transition-1' });
    const active = updateActivationStatus(activation, 'active', now);
    expect(active.actualTimingStatus).toBe('recorded');
    expect(() => updateActivationStatus(active, 'active', now)).toThrow();
    expect(() => updateActivationStatus(active, 'planned', now)).toThrow();
    const completed = updateActivationStatus(active, 'completed', now);
    expect(completed.endedAtUtc).toBe(now().toISOString());
    expect(() => updateActivationStatus(completed, 'completed', now)).toThrow();
    expect(normalizeActivation({ ...active, endedAtUtc: now().toISOString() }).valid).toBe(false);
    expect(normalizeActivation({ ...completed, startedAtUtc: undefined }).valid).toBe(false);
    expect(normalizeActivation({ ...completed, endedAtUtc: '2026-08-25T11:00:00.000Z' }).valid).toBe(false);
  });
  it('migrates historical timing explicitly without rewriting and permits later writes', () => {
    const { activationPath } = stores();
    const legacy = { schemaVersion: 1, activationId: 'legacy-active', type: 'General', status: 'active', createdAtUtc: '2026-08-25T10:00:00Z', updatedAtUtc: '2026-08-25T10:00:00Z' };
    fs.writeFileSync(activationPath, JSON.stringify({ storeVersion: 1, activations: [legacy, { ...legacy, activationId: 'legacy-planned', status: 'planned' }, { ...legacy, activationId: 'legacy-completed', status: 'completed' }] }));
    const before = fs.readFileSync(activationPath, 'utf8');
    const store = new ActivationStore(activationPath, { now });
    const loaded = store.list();
    expect(fs.readFileSync(activationPath, 'utf8')).toBe(before);
    expect(loaded.activations.find(item => item.activationId === 'legacy-active')).toMatchObject({ actualTimingStatus: 'unknown_historical', status: 'active' });
    expect(loaded.activations.find(item => item.activationId === 'legacy-completed')).toMatchObject({ actualTimingStatus: 'unknown_historical', status: 'completed' });
    const historical = store.get('legacy-active');
    expect(historical.status).toBe('found');
    if (historical.status === 'found') store.save(historical.activation);
    expect(() => store.reconcileActive('legacy-planned')).toThrow();
    expect(store.reconcileActive('legacy-active').reconciledActivationIds).toEqual([]);
  });
  it('completes a persisted historical active Activation after store reconstruction', () => {
    const { activationPath } = stores();
    const legacy = { schemaVersion: 1, activationId: 'restart-active', type: 'General', status: 'active', createdAtUtc: '2026-08-25T10:00:00Z', updatedAtUtc: '2026-08-25T10:00:00Z' };
    fs.writeFileSync(activationPath, JSON.stringify({ storeVersion: 1, activations: [legacy] }));
    const firstStore = new ActivationStore(activationPath, { now });
    const loaded = firstStore.get('restart-active');
    if (loaded.status !== 'found') throw new Error('Expected migrated Activation.');
    firstStore.save(loaded.activation);
    const secondStore = new ActivationStore(activationPath, { now });
    const reloaded = secondStore.get('restart-active');
    if (reloaded.status !== 'found') throw new Error('Expected persisted historical Activation.');
    const completed = updateActivationStatus(reloaded.activation, 'completed', now);
    secondStore.save(completed);
    const finalStore = new ActivationStore(activationPath, { now });
    expect(finalStore.get('restart-active')).toMatchObject({ status: 'found', activation: { status: 'completed', actualTimingStatus: 'unknown_historical', actualTimingOrigin: 'schema_v1' } });
    const final = finalStore.get('restart-active');
    if (final.status === 'found') { expect(final.activation.startedAtUtc).toBeUndefined(); expect(final.activation.endedAtUtc).toBeUndefined(); }
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
  it('rejects malformed caller objectives as invalid objective requests', async () => {
    const { activation, notes } = stores();
    const brief = { schemaVersion: 2, briefId: 'brief-2', activation: { program: 'General', reference: '', displayName: 'Test' }, plannedOperatingSite: { location: { coordinates: null, gridSquare: null } }, missionWindow: { start: '2026-08-25T10:00:00Z', end: '2026-08-25T11:00:00Z' } } as any;
    const app = express(); app.use(express.json()); app.use(createActivationRouter({ store: activation, notesStore: notes, briefStore: { get: () => ({ status: 'found', brief, diagnostics: [] }) } as any, now }));
    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listener = app.listen(0, () => resolve(listener)); });
    try {
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/activations/from-brief`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ briefId: 'brief-2', operatingObjective: { goal: 'balanced', label: 'Bad' } }) });
      const payload = await response.json() as any;
      expect(response.status).toBe(400); expect(payload.code).toBe('invalid_operating_objective'); expect(payload.message).not.toContain('brief');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe('V2.8 integrated Activation lifecycle', () => {
  it('retains a TX Context observation through completion and closes the segment for Review', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-v28-integration-')); directories.push(directory);
    let currentTime = new Date('2026-08-25T12:00:00.000Z');
    const clock = () => currentTime;
    const activation = new ActivationStore(path.join(directory, 'activations.json'), { now: clock, createId: () => 'activation-1' });
    const notes = new ActivationNotesStore(path.join(directory, 'activation-notes.json'), { now: clock, createId: () => 'notes-1' });
    const operational = new OperationalIntelligenceStore(path.join(directory, 'operational-intelligence.json'), { now: clock, createId: (() => { let id = 0; return () => `id-${++id}`; })(), operatorCallsign: () => 'K1ABC' });
    const brief = { schemaVersion: 2, briefId: 'brief-1', activation: { program: 'General', reference: 'FIELD-1', displayName: 'Field test' }, plannedOperatingSite: { location: { coordinates: { lat: 10, lon: 20 }, gridSquare: 'JJ00' } }, missionWindow: { start: '2026-08-25T10:00:00Z', end: '2026-08-25T11:00:00Z' } } as any;
    const observedRf = { getSnapshot: () => ({ status: 'live', observationWindow: { startsAt: '2026-08-25T11:45:00.000Z', endsAt: '2026-08-25T12:15:00.000Z' }, reports: [] }) } as any;
    const app = express(); app.use(express.json());
    app.use(createActivationRouter({ store: activation, notesStore: notes, briefStore: { get: () => ({ status: 'found', brief, diagnostics: [] }) } as any, now: clock, onCompleted: completed => operational.closeActivation(completed) }));
    app.use(createOperationalIntelligenceRouter({ store: operational, activationStore: activation, observedRf }));
    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listener = app.listen(0, () => resolve(listener)); });
    try {
      const address = server.address() as { port: number };
      const request = (pathName: string, init?: RequestInit) => fetch(`http://127.0.0.1:${address.port}${pathName}`, init);
      const created = await request('/api/activations/from-brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ briefId: 'brief-1', operatingObjective: { goal: 'secure_activation', label: 'Qualify', requiredQsoCount: 2, thresholdProvenance: 'operator_entered', deadlineUtc: '2026-08-25T13:00:00Z', deadlineBasis: 'operator_entered', deadlineProvenance: 'operator_entered' } }) });
      expect(created.status).toBe(201);
      expect((await request('/api/activations/activation-1/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) })).status).toBe(200);
      const contextResponse = await request('/api/activations/activation-1/tx-context', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ radioSetupLabel: 'Portable rig', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8', provenance: { radioSetup: 'operator_entered', antenna: 'operator_entered', transmitPowerWatts: 'operator_entered', band: 'operator_entered', mode: 'operator_entered' } }) });
      expect(contextResponse.status).toBe(201);
      const contextPayload = await contextResponse.json() as { context: { segmentId: string } };
      currentTime = new Date('2026-08-25T12:15:00.000Z');
      const observationResponse = await request(`/api/activations/activation-1/tx-context/${contextPayload.context.segmentId}/observations`, { method: 'POST' });
      expect(observationResponse.status).toBe(201);
      expect((await observationResponse.json()).observation).toMatchObject({ activationId: 'activation-1', txContextSegmentId: contextPayload.context.segmentId, matchingReportCount: 0, limitations: ['No matching reports observed'] });
      expect((await request('/api/activations/activation-1/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) })).status).toBe(200);
      const retained = await (await request('/api/activations/activation-1/operational-intelligence')).json() as { txContexts: Array<{ endedAtUtc?: string }>; observations: Array<{ activationId: string }> };
      expect(retained.txContexts[0].endedAtUtc).toBe(currentTime.toISOString());
      expect(retained.observations).toHaveLength(1);
      expect(retained.observations[0].activationId).toBe('activation-1');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});