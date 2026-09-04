import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createActivation } from '../activation';
import { createOperationalIntelligenceRouter } from '../operationalIntelligenceApi';
import { createActivationRouter } from '../activationApi';
import { OperationalIntelligenceStore } from '../operationalIntelligenceStore';
import { ActivationStore } from '../activationStore';
import { ActivationNotesStore } from '../activationNotesStore';
import type { Activation } from '../activation';
import type { ObservedRfSnapshot, PskReceptionReport } from '../../src/propagation/observedRf';

const NOW = new Date('2026-08-29T12:05:00.000Z');
const provenance = { sourceId: 'pskreporter-via-mqtt', sourceName: 'PSKReporter reports via mqtt.pskreporter.info', semantics: 'observed_digital_reception_report', limitation: 'Does not prove SSB usability, station-specific success, regional openness, confidence, or a propagation rating.' } as const;
function report(id: string, callsign: string, mode: string | null, observedAtUtc: string, overrides: Partial<PskReceptionReport> = {}): PskReceptionReport { return { reportId: id, sourceSequence: id, senderCallsign: callsign, receiverCallsign: `R${id}`, senderLocator: 'FM17AA', receiverLocator: 'FN20AA', senderGrid4: 'FM17', receiverGrid4: 'FN20', frequencyHz: 14_074_000, band: '20m', mode, snrDb: -10, observedAtUtc, receivedAtUtc: NOW.toISOString(), senderDxcc: null, receiverDxcc: null, direction: 'outbound', provenance, ...overrides }; }
function snapshot(reports: readonly PskReceptionReport[], status: ObservedRfSnapshot['status'] = 'live', startsAt = '2026-08-29T11:45:00.000Z', endsAt = NOW.toISOString()): ObservedRfSnapshot { return { kind: 'observed_rf', status, evidenceStatus: status === 'live' ? 'live_observed_rf_source' : status === 'stale' ? 'stale_observed_rf_source' : status === 'unavailable' ? 'unavailable' : 'cached_observed_rf_source', operatingGrid4: 'FM17', observationWindow: { startsAt, endsAt }, collectedAtUtc: NOW.toISOString(), reports, bandSummaries: [], provenance: { sourceId: provenance.sourceId, sourceName: provenance.sourceName, transport: 'mqtts-websocket', brokerHost: 'mqtt.pskreporter.info', brokerPort: 1886, topicPatterns: [] } }; }
function contextInput() { return { radioSetupLabel: 'Portable rig', antennaLabel: 'EFHW', transmitPowerWatts: 10, band: '20m', mode: 'FT8', provenance: { radioSetup: 'operator_entered', antenna: 'operator_entered', transmitPowerWatts: 'operator_entered', band: 'operator_entered', mode: 'operator_entered' } }; }
function tempPath(): string { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-o-int-')), 'operational-intelligence.json'); }
function activeActivation(): Activation { return { schemaVersion: 2, activationId: 'activation-1', type: 'General', status: 'active', startedAtUtc: '2026-08-29T11:00:00.000Z', actualTimingStatus: 'recorded', createdAtUtc: '2026-08-29T10:00:00.000Z', updatedAtUtc: '2026-08-29T11:00:00.000Z' }; }

describe('V2.8-03 Station Signal Observation foundation', () => {
  it('replaces open TX Context, filters compatible outbound reports, and retains factual summaries', () => {
    let id = 0;
    let currentTime = new Date('2026-08-29T12:00:00.000Z');
    const store = new OperationalIntelligenceStore(tempPath(), { now: () => currentTime, createId: () => `id-${++id}`, operatorCallsign: () => 'K1ABC' });
    const activation = activeActivation();
    const first = store.openTxContext(activation, contextInput()).context;
    const second = store.openTxContext(activation, contextInput()).context;
    expect(first.endedAtUtc).toBeUndefined();
    expect(store.list('activation-1').txContexts.find(item => item.segmentId === first.segmentId)?.endedAtUtc).toBe('2026-08-29T12:00:00.000Z');
    currentTime = NOW;
    const result = store.captureObservation(activation, second.segmentId, snapshot([report('1', 'K1ABC', 'FT8', NOW.toISOString()), report('2', 'K1ABC', 'SSB', NOW.toISOString()), report('3', 'OTHER', 'FT8', NOW.toISOString())]));
    expect(result.observation).toMatchObject({ matchingReportCount: 1, uniqueReceiverCount: 1, snr: { reportCount: 1 }, distance: { locatedReportCount: 1 } });
    expect(result.observation).not.toHaveProperty('receiverPopulation');
  });

  it('preserves exact zero-report semantics and closes open context', () => {
    const filePath = tempPath();
    let currentTime = new Date('2026-08-29T12:00:00.000Z');
    const store = new OperationalIntelligenceStore(filePath, { now: () => currentTime, createId: () => 'segment-1', operatorCallsign: () => 'K1ABC' });
    const activation = activeActivation();
    const context = store.openTxContext(activation, contextInput()).context;
    currentTime = NOW;
    const observation = store.captureObservation({ ...activation, startedAtUtc: '2026-08-29T11:00:00.000Z' }, context.segmentId, snapshot([], 'live')).observation;
    expect(observation).toMatchObject({ matchingReportCount: 0, uniqueReceiverCount: 0, reportsPerMinute: 0, uniqueReceiversPerMinute: 0, newestMatchingReportAtUtc: null, limitations: ['No matching reports observed'] });
    expect(observation).not.toHaveProperty('distance');
    expect(observation).not.toHaveProperty('snr');
    store.closeActivation({ ...activation, status: 'completed', endedAtUtc: NOW.toISOString(), updatedAtUtc: NOW.toISOString() });
    expect(store.list('activation-1').txContexts[0].endedAtUtc).toBe(NOW.toISOString());
  });

  it('rejects planned or completed Activations and missing, foreign, or closed segments', () => {
    const store = new OperationalIntelligenceStore(tempPath(), { now: () => NOW, createId: () => 'segment-1', operatorCallsign: () => 'K1ABC' });
    const active = activeActivation();
    const context = store.openTxContext(active, contextInput()).context;
    expect(() => store.openTxContext({ ...active, status: 'planned', startedAtUtc: undefined, actualTimingStatus: undefined }, contextInput())).toThrow('active');
    expect(() => store.captureObservation({ ...active, status: 'completed', endedAtUtc: NOW.toISOString() }, context.segmentId, snapshot([]))).toThrow('active');
    expect(() => store.captureObservation(active, 'missing', snapshot([]))).toThrow('not found');
    expect(() => store.captureObservation({ ...active, activationId: 'foreign' }, context.segmentId, snapshot([]))).toThrow('not found');
    store.closeActivation({ ...active, status: 'completed', endedAtUtc: NOW.toISOString() });
    expect(() => store.captureObservation(active, context.segmentId, snapshot([]))).toThrow('closed');
  });

  it('maps every supported source status and rejects connecting, reconnecting, and unavailable', () => {
    for (const [status, expected] of [['live', 'live'], ['cached', 'retained'], ['stale', 'stale']] as const) {
      let currentTime = new Date('2026-08-29T12:00:00.000Z');
      const store = new OperationalIntelligenceStore(tempPath(), { now: () => currentTime, createId: () => `segment-${status}`, operatorCallsign: () => 'K1ABC' });
      const context = store.openTxContext(activeActivation(), contextInput()).context;
      currentTime = NOW;
      expect(store.captureObservation(activeActivation(), context.segmentId, snapshot([], status)).observation.status).toBe(expected);
    }
    for (const status of ['connecting', 'reconnecting', 'unavailable'] as const) {
      const filePath = tempPath();
      let currentTime = new Date('2026-08-29T12:00:00.000Z');
      const store = new OperationalIntelligenceStore(filePath, { now: () => currentTime, createId: () => `segment-${status}`, operatorCallsign: () => 'K1ABC' });
      const context = store.openTxContext(activeActivation(), contextInput()).context;
      currentTime = NOW;
      const before = fs.readFileSync(filePath, 'utf8');
      expect(() => store.captureObservation(activeActivation(), context.segmentId, snapshot([], status))).toThrow('unavailable');
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
    }
  });

  it('requires a configured non-placeholder callsign and exact mode evidence', () => {
    for (const callsign of ['', ' N0CALL ', 'W7FIELD', 'K7POTA', 'W6SOTA', 'VE3FIELD']) {
      const store = new OperationalIntelligenceStore(tempPath(), { now: () => NOW, createId: () => 'segment-1', operatorCallsign: () => callsign });
      const context = store.openTxContext(activeActivation(), contextInput()).context;
      expect(() => store.captureObservation(activeActivation(), context.segmentId, snapshot([]))).toThrow('callsign');
    }
    let currentTime = new Date('2026-08-29T12:00:00.000Z');
    const store = new OperationalIntelligenceStore(tempPath(), { now: () => currentTime, createId: () => 'segment-1', operatorCallsign: () => 'K1ABC' });
    const context = store.openTxContext(activeActivation(), contextInput()).context;
    currentTime = NOW;
    const reports = [
      report('match', ' k1abc ', ' ft8 ', NOW.toISOString()),
      report('null', 'K1ABC', null, NOW.toISOString()),
      report('blank', 'K1ABC', '   ', NOW.toISOString()),
      report('malformed', 'K1ABC', '{FT8}', NOW.toISOString()),
      report('other-mode', 'K1ABC', 'SSB', NOW.toISOString()),
      report('other-band', 'K1ABC', 'FT8', NOW.toISOString(), { band: '40m' }),
      report('inbound', 'K1ABC', 'FT8', NOW.toISOString(), { direction: 'inbound' }),
      report('other-callsign', 'N0CALL', 'FT8', NOW.toISOString()),
    ] as PskReceptionReport[];
    expect(store.captureObservation(activeActivation(), context.segmentId, snapshot(reports)).observation.matchingReportCount).toBe(1);
  });

  it('clips all interval boundaries, includes endpoint reports, and rejects invalid exposure', () => {
    const activation = { ...activeActivation(), startedAtUtc: '2026-08-29T11:55:00.000Z' };
    let currentTime = new Date('2026-08-29T12:00:00.000Z');
    const store = new OperationalIntelligenceStore(tempPath(), { now: () => currentTime, createId: () => 'segment-1', operatorCallsign: () => 'K1ABC' });
    const context = store.openTxContext(activation, contextInput()).context;
    currentTime = NOW;
    const result = store.captureObservation(activation, context.segmentId, snapshot([
      report('start', 'K1ABC', 'FT8', '2026-08-29T12:00:00.000Z'), report('end', 'K1ABC', 'FT8', NOW.toISOString()), report('before', 'K1ABC', 'FT8', '2026-08-29T11:59:59.999Z'), report('after', 'K1ABC', 'FT8', '2026-08-29T12:05:00.001Z'),
    ])).observation;
    expect(result.matchingReportCount).toBe(2);
    expect(result.startsAtUtc).toBe('2026-08-29T12:00:00.000Z');
    expect(result.endsAtUtc).toBe(NOW.toISOString());
    for (const invalid of [
      snapshot([], 'live', '2026-08-29T12:01:00.000Z', '2026-08-29T12:01:00.000Z'),
      snapshot([], 'live', '2026-08-29T12:02:00.000Z', '2026-08-29T12:01:00.000Z'),
      snapshot([], 'live', '2026-08-29T12:06:00.000Z', '2026-08-29T12:07:00.000Z'),
      snapshot([], 'live', '2026-08-29T10:00:00.000Z', '2026-08-29T10:01:00.000Z'),
    ]) {
      expect(() => store.captureObservation(activation, context.segmentId, invalid)).toThrow('interval');
    }
  });

  it('orders reports deterministically and aggregates locator distance and SNR independently', () => {
    let id = 0;
    let currentTime = new Date('2026-08-29T12:00:00.000Z');
    const store = new OperationalIntelligenceStore(tempPath(), { now: () => currentTime, createId: () => `segment-${++id}`, operatorCallsign: () => 'K1ABC' });
    const context = store.openTxContext(activeActivation(), contextInput()).context;
    currentTime = NOW;
    const reports = [
      report('z', 'K1ABC', 'FT8', '2026-08-29T12:01:00.000Z', { receiverLocator: 'FN40AA', snrDb: 10 }),
      report('a', 'K1ABC', 'FT8', '2026-08-29T12:01:00.000Z', { receiverLocator: 'FN20AA', snrDb: -20 }),
      report('m', 'K1ABC', 'FT8', '2026-08-29T12:02:00.000Z', { receiverLocator: 'FN30AA', snrDb: 0 }),
      report('missing', 'K1ABC', 'FT8', '2026-08-29T12:03:00.000Z', { senderLocator: null, receiverLocator: 'bad', snrDb: null }),
    ];
    const observation = store.captureObservation(activeActivation(), context.segmentId, snapshot(reports)).observation;
    expect(observation.matchingReportCount).toBe(4);
    expect(observation.newestMatchingReportAtUtc).toBe('2026-08-29T12:03:00.000Z');
    expect(observation.distance).toMatchObject({ locatedReportCount: 3 });
    expect(observation.distance!.nearestKm).toBeLessThanOrEqual(observation.distance!.medianKm);
    expect(observation.distance!.medianKm).toBeLessThanOrEqual(observation.distance!.farthestKm);
    expect(observation.snr).toEqual({ reportCount: 3, minimumDb: -20, medianDb: 0, maximumDb: 10 });
    let evenTime = new Date('2026-08-29T12:00:00.000Z');
    const evenStore = new OperationalIntelligenceStore(tempPath(), { now: () => evenTime, createId: () => 'even-segment', operatorCallsign: () => 'K1ABC' });
    const evenContext = evenStore.openTxContext(activeActivation(), contextInput()).context;
    evenTime = NOW;
    const even = evenStore.captureObservation(activeActivation(), evenContext.segmentId, snapshot([
      report('1', 'K1ABC', 'FT8', '2026-08-29T12:01:00.000Z', { receiverLocator: 'FN20AA', snrDb: -20 }), report('2', 'K1ABC', 'FT8', '2026-08-29T12:01:01.000Z', { receiverLocator: 'FN30AA', snrDb: 0 }), report('3', 'K1ABC', 'FT8', '2026-08-29T12:01:02.000Z', { receiverLocator: 'FN40AA', snrDb: 10 }), report('4', 'K1ABC', 'FT8', '2026-08-29T12:01:03.000Z', { receiverLocator: 'FN50AA', snrDb: 20 }),
    ])).observation;
    expect(even.distance?.locatedReportCount).toBe(4);
    expect(even.snr).toEqual({ reportCount: 4, minimumDb: -20, medianDb: 5, maximumDb: 20 });
  });

  it('refuses corrupt, unsupported, unreadable, and failed replacements without losing valid data', () => {
    const corruptPath = tempPath(); fs.writeFileSync(corruptPath, '{broken');
    const corruptStore = new OperationalIntelligenceStore(corruptPath, { now: () => NOW, createId: () => 'segment-1', operatorCallsign: () => 'K1ABC' });
    expect(() => corruptStore.openTxContext(activeActivation(), contextInput())).toThrow('storage');
    expect(fs.readFileSync(corruptPath, 'utf8')).toBe('{broken');
    const unsupportedPath = tempPath(); fs.writeFileSync(unsupportedPath, JSON.stringify({ storeVersion: 99, txContexts: [], observations: [] }));
    const unsupported = new OperationalIntelligenceStore(unsupportedPath);
    expect(() => unsupported.openTxContext(activeActivation(), contextInput())).toThrow('storage');
    const directoryPath = tempPath(); fs.mkdirSync(directoryPath);
    const unreadable = new OperationalIntelligenceStore(directoryPath);
    expect(() => unreadable.openTxContext(activeActivation(), contextInput())).toThrow('storage');
    const validPath = tempPath();
    const store = new OperationalIntelligenceStore(validPath, { now: () => NOW, createId: () => 'segment-1', operatorCallsign: () => 'K1ABC' });
    store.openTxContext(activeActivation(), contextInput());
    const before = fs.readFileSync(validPath, 'utf8');
    const rename = fs.renameSync;
    fs.renameSync = (() => { throw Object.assign(new Error('replacement failed'), { code: 'EIO' }); }) as typeof fs.renameSync;
    try { expect(() => store.openTxContext(activeActivation(), contextInput())).toThrow('replacement failed'); } finally { fs.renameSync = rename; }
    expect(fs.readFileSync(validPath, 'utf8')).toBe(before);
    expect(fs.readFileSync(validPath, 'utf8').endsWith('\n')).toBe(true);
    expect(fs.readdirSync(path.dirname(validPath))).toEqual(['operational-intelligence.json']);
  });

  it('serves the Activation-scoped API from the same store and observed service', async () => {
    const activationPath = tempPath();
    const activationStore = new ActivationStore(activationPath, { now: () => NOW, createId: () => 'activation-1' });
    activationStore.create({ type: 'General', status: 'active' });
    const store = new OperationalIntelligenceStore(tempPath(), { now: () => NOW, createId: () => 'segment-1', operatorCallsign: () => 'K1ABC' });
    const app = express().use(express.json()).use(createOperationalIntelligenceRouter({ store, activationStore, observedRf: { getSnapshot: () => snapshot([]) } as any }));
    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listener = app.listen(0, () => resolve(listener)); });
    try {
      const address = server.address() as { port: number };
      const opened = await fetch(`http://127.0.0.1:${address.port}/api/activations/activation-1/tx-context`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contextInput()) });
      expect(opened.status).toBe(201);
      const listed = await fetch(`http://127.0.0.1:${address.port}/api/activations/activation-1/operational-intelligence`);
      expect(listed.status).toBe(200);
      expect((await listed.json() as any).txContexts).toHaveLength(1);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('closes displaced segments for create(active), activate, and reconcile paths', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-o-int-lifecycle-'));
    let activationId = 0;
    const activationStore = new ActivationStore(path.join(directory, 'activations.json'), { now: () => NOW, createId: () => `activation-${++activationId}` });
    const operational = new OperationalIntelligenceStore(path.join(directory, 'operational-intelligence.json'), { now: () => NOW, createId: (() => { let id = 0; return () => `segment-${++id}`; })(), operatorCallsign: () => 'K1ABC' });
    const first = activationStore.create({ type: 'General', status: 'active' }).activation;
    const firstContext = operational.openTxContext(first, contextInput()).context;
    const second = activationStore.create({ type: 'General', status: 'active' }).activation;
    operational.openTxContext(second, contextInput());
    operational.closeActivation({ ...first, status: 'completed', endedAtUtc: second.startedAtUtc, updatedAtUtc: second.updatedAtUtc });
    expect(operational.list(first.activationId).txContexts.find(item => item.segmentId === firstContext.segmentId)?.endedAtUtc).toBe(second.startedAtUtc);
    const planned = activationStore.create({ type: 'General' }).activation;
    const activated = activationStore.activate(planned.activationId).activation;
    operational.closeActivation({ ...second, status: 'completed', endedAtUtc: activated.startedAtUtc, updatedAtUtc: activated.updatedAtUtc });
    expect(operational.list(second.activationId).txContexts[0].endedAtUtc).toBe(activated.startedAtUtc);
    const repaired = activationStore.reconcileActive(activated.activationId);
    expect(repaired.reconciledActivationIds).toEqual([]);
  });

  it('reports exact API status mappings and preserves Activation mutation on closure failure', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-o-int-api-'));
    let activationId = 0;
    const activationStore = new ActivationStore(path.join(directory, 'activations.json'), { now: () => NOW, createId: () => `activation-${++activationId}` });
    const notesStore = new ActivationNotesStore(path.join(directory, 'notes.json'), { now: () => NOW, createId: () => 'notes-1' });
    const operational = new OperationalIntelligenceStore(path.join(directory, 'operational-intelligence.json'), { now: () => NOW, createId: () => 'segment-1', operatorCallsign: () => null });
    const active = activationStore.create({ type: 'General', status: 'active' }).activation;
    const app = express().use(express.json()).use(createActivationRouter({ store: activationStore, notesStore, briefStore: { get: () => ({ status: 'notFound', diagnostics: [] }) } as any, onCompleted: () => { throw new Error('closure failed'); } })).use(createOperationalIntelligenceRouter({ store: operational, activationStore, observedRf: { getSnapshot: () => snapshot([], 'live') } as any }));
    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listener = app.listen(0, () => resolve(listener)); });
    try {
      const port = (server.address() as { port: number }).port;
      const get = (id: string) => fetch(`http://127.0.0.1:${port}/api/activations/${id}/operational-intelligence`);
      expect((await get('missing')).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/api/activations/${active.activationId}/tx-context`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contextInput()) })).status).toBe(201);
      expect((await fetch(`http://127.0.0.1:${port}/api/activations/${active.activationId}/tx-context/segment-1/observations`, { method: 'POST' })).status).toBe(422);
      expect((await fetch(`http://127.0.0.1:${port}/api/activations/${active.activationId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) })).status).toBe(503);
      expect(activationStore.get(active.activationId)).toMatchObject({ status: 'found', activation: { status: 'completed' } });
      const planned = activationStore.create({ type: 'General' }).activation;
      expect((await fetch(`http://127.0.0.1:${port}/api/activations/${planned.activationId}/tx-context`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contextInput()) })).status).toBe(409);
      expect((await fetch(`http://127.0.0.1:${port}/api/activations/${active.activationId}/tx-context/no-segment/observations`, { method: 'POST' })).status).toBe(409);
      expect((await fetch(`http://127.0.0.1:${port}/api/activations/${active.activationId}/operational-intelligence`)).status).toBe(200);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
