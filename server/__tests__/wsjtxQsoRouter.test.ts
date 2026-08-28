import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createActivation, updateActivationStatus, type Activation } from '../activation';
import { ActivationStore } from '../activationStore';
import { QsoStore } from '../qsoStore';
import { WsjtxQsoRouter } from '../wsjtxQsoRouter';
import type { WsjtxLoggedQsoCandidate } from '../wsjtx';

const directories: string[] = [];
const now = () => new Date('2026-08-27T18:00:00.000Z');
const candidate: WsjtxLoggedQsoCandidate = { qsoDateTimeUtc: '2026-08-27T17:42:00.000Z', callsign: 'W1AW', band: '20m', frequencyMHz: 14.074, mode: 'FT8', rstSent: '-10', rstReceived: '-12', gridSquare: 'FN31', operatorCallsign: 'N0CALL', stationCallsign: 'N0CALL', myGridSquare: 'FM17', source: 'wsjtx' };
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function setup(status: Activation['status'] = 'active') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-wsjtx-qso-'));
  directories.push(directory);
  const activationStore = new ActivationStore(path.join(directory, 'activations.json'), { now, createId: () => 'activation-1' });
  const created = activationStore.create({ type: 'General' }).activation;
  if (status !== 'planned') activationStore.save(updateActivationStatus(created, 'active', now));
  if (status === 'completed') activationStore.save(updateActivationStatus(activationStore.get(created.activationId).status === 'found' ? (activationStore.get(created.activationId) as any).activation : created, 'completed', now));
  const activationPath = path.join(directory, 'activations.json');
  const qsoPath = path.join(directory, 'qsos.json');
  let qsoNumber = 0;
  const qsoStore = new QsoStore(qsoPath, { now, createId: () => `qso-${++qsoNumber}` });
  return { activationStore, activationPath, qsoStore, qsoPath };
}

describe('WSJT-X QSO routing', () => {
  it('persists the complete candidate against the active Activation', () => {
    const stores = setup();
    const result = new WsjtxQsoRouter(stores).route(candidate);
    expect(result.status).toBe('persisted');
    expect((result as any).qso).toMatchObject({ activationId: 'activation-1', source: 'wsjtx', callsign: 'W1AW', band: '20m', frequencyMHz: 14.074, mode: 'FT8', rstSent: '-10', rstReceived: '-12', gridSquare: 'FN31', operatorCallsign: 'N0CALL', stationCallsign: 'N0CALL', myGridSquare: 'FM17' });
  });

  it('does not create a second record for same-process or reconstructed delivery', () => {
    const stores = setup();
    const first = new WsjtxQsoRouter(stores).route(candidate);
    expect(new WsjtxQsoRouter(stores).route(candidate).status).toBe('duplicate');
    const reconstructed = new WsjtxQsoRouter({ activationStore: new ActivationStore(stores.activationPath), qsoStore: new QsoStore(stores.qsoPath) });
    expect(reconstructed.route(candidate).status).toBe('duplicate');
    expect(stores.qsoStore.listByActivation('activation-1').qsos).toHaveLength(1);
    expect(first.status).toBe('persisted');
  });

  it('identifies persistence-stage failures without exposing packet content', () => {
    const stores = setup();
    const result = new WsjtxQsoRouter({ activationStore: stores.activationStore, qsoStore: { listByActivation: stores.qsoStore.listByActivation.bind(stores.qsoStore), create: () => { throw new Error('write failed'); } } }).route(candidate);
    expect(result).toEqual({ status: 'unavailable', reason: 'persistence_failed' });
  });

  it('skips planned and completed Activations without creating one', () => {
    expect(new WsjtxQsoRouter(setup('planned')).route(candidate).status).toBe('no_active');
    expect(new WsjtxQsoRouter(setup('completed')).route(candidate).status).toBe('no_active');
  });

  it('does not confuse a distinct contact with a duplicate', () => {
    const stores = setup();
    const router = new WsjtxQsoRouter(stores);
    router.route(candidate);
    expect(router.route({ ...candidate, qsoDateTimeUtc: '2026-08-27T17:43:00.000Z' }).status).toBe('persisted');
    expect(stores.qsoStore.listByActivation('activation-1').qsos).toHaveLength(2);
  });
});