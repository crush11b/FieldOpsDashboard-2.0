import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createActivation } from '../activation';
import { createOperationalIntelligenceRouter } from '../operationalIntelligenceApi';
import { OperationalIntelligenceStore } from '../operationalIntelligenceStore';
import { ActivationStore } from '../activationStore';
import type { Activation } from '../activation';
import type { ObservedRfSnapshot, PskReceptionReport } from '../../src/propagation/observedRf';

const NOW = new Date('2026-08-29T12:05:00.000Z');
const provenance = { sourceId: 'pskreporter-via-mqtt', sourceName: 'PSKReporter reports via mqtt.pskreporter.info', semantics: 'observed_digital_reception_report', limitation: 'Does not prove SSB usability, station-specific success, regional openness, confidence, or a propagation rating.' } as const;
function report(id: string, callsign: string, mode: string, observedAtUtc: string): PskReceptionReport { return { reportId: id, sourceSequence: id, senderCallsign: callsign, receiverCallsign: `R${id}`, senderLocator: 'FM17AA', receiverLocator: 'FN20AA', senderGrid4: 'FM17', receiverGrid4: 'FN20', frequencyHz: 14_074_000, band: '20m', mode, snrDb: -10, observedAtUtc, receivedAtUtc: NOW.toISOString(), senderDxcc: null, receiverDxcc: null, direction: 'outbound', provenance }; }
function snapshot(reports: readonly PskReceptionReport[], status: ObservedRfSnapshot['status'] = 'live'): ObservedRfSnapshot { return { kind: 'observed_rf', status, evidenceStatus: status === 'live' ? 'live_observed_rf_source' : 'cached_observed_rf_source', operatingGrid4: 'FM17', observationWindow: { startsAt: '2026-08-29T11:45:00.000Z', endsAt: NOW.toISOString() }, collectedAtUtc: NOW.toISOString(), reports, bandSummaries: [], provenance: { sourceId: provenance.sourceId, sourceName: provenance.sourceName, transport: 'mqtts-websocket', brokerHost: 'mqtt.pskreporter.info', brokerPort: 1886, topicPatterns: [] } }; }
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
});