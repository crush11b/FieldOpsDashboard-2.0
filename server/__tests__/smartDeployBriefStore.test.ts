import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SmartDeployBrief } from '../smartDeployBrief';
import {
  SMART_DEPLOY_BRIEF_RETENTION_LIMIT,
  SmartDeployBriefStore,
  getDefaultSmartDeployBriefPath,
} from '../smartDeployBriefStore';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createBrief(id: string, generatedAtUtc: string): SmartDeployBrief {
  const snapshot = {
    activationTarget: { program: 'POTA', reference: id, displayName: 'Test Park', coordinates: null, provenance: 'resolver' },
    operatingLocation: { gridSquare: 'EM00', coordinates: null, provenance: 'manual', status: 'ok', source: { type: 'manual' } },
    missionWindow: { start: '2026-08-18T12:00:00.000Z', end: '2026-08-18T14:00:00.000Z' },
    equipment: { radio: { name: 'Test Radio' }, antenna: { name: 'EFHW' }, modes: ['SSB'], transmitPowerWatts: 10 },
  };
  const evidence = { status: 'available', evidence: {} };
  return {
    schemaVersion: 1,
    briefId: id,
    generatedAtUtc,
    status: 'complete',
    mission: snapshot,
    sections: {
      mission: { status: 'available', snapshot },
      geometry: evidence,
      solar: { status: 'derived', evidence: {} },
      propagation: { status: 'complete', evidence: {} },
      observedRf: { status: 'notTemporallyApplicable', evidence: {} },
    },
    limitations: [],
    summary: `Summary for ${id}`,
  } as unknown as SmartDeployBrief;
}

function createStore(): { store: SmartDeployBriefStore; directory: string; filePath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-smartdeploy-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'smartdeploy-briefs.json');
  return { store: new SmartDeployBriefStore(filePath), directory, filePath };
}

describe('SmartDeployBriefStore', () => {
  it('uses the product local app-data location and treats first run as empty', () => {
    expect(getDefaultSmartDeployBriefPath({ LOCALAPPDATA: 'C:\\Users\\Operator\\AppData\\Local' }, 'C:\\Users\\Operator'))
      .toBe('C:\\Users\\Operator\\AppData\\Local\\FieldOpsDashboard\\smartdeploy-briefs.json');
    const { store } = createStore();
    expect(store.list()).toEqual({ status: 'missing', briefs: [], diagnostics: [{ code: 'missing', message: 'No SmartDeploy brief store exists yet.' }] });
  });

  it('saves and reloads a complete brief without changing historical evidence', () => {
    const { store, filePath } = createStore();
    const brief = createBrief('brief-1', '2026-08-18T12:00:00.000Z');
    store.save(brief);
    const reloaded = new SmartDeployBriefStore(filePath).get('brief-1');
    expect(reloaded).toMatchObject({ status: 'found', brief });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).briefs).toEqual([brief]);
  });

  it('orders newest first and retains only the ten newest briefs', () => {
    const { store } = createStore();
    for (let index = 0; index <= SMART_DEPLOY_BRIEF_RETENTION_LIMIT; index += 1) {
      store.save(createBrief(`brief-${index}`, `2026-08-${String(8 + index).padStart(2, '0')}T12:00:00.000Z`));
    }
    const result = store.list();
    expect(result.briefs).toHaveLength(10);
    expect(result.briefs[0].briefId).toBe('brief-10');
    expect(result.briefs.at(-1)?.briefId).toBe('brief-1');
    expect(result.briefs.some(brief => brief.briefId === 'brief-0')).toBe(false);
  });

  it('replaces an existing identity and reorders by its actual timestamp', () => {
    const { store } = createStore();
    store.save(createBrief('brief-1', '2026-08-18T12:00:00.000Z'));
    store.save(createBrief('brief-2', '2026-08-19T12:00:00.000Z'));
    const replacement = createBrief('brief-1', '2026-08-20T12:00:00.000Z');
    store.save(replacement);
    expect(store.list().briefs).toEqual([replacement, expect.objectContaining({ briefId: 'brief-2' })]);
  });

  it('gets and deletes existing identities honestly', () => {
    const { store, filePath } = createStore();
    const brief = createBrief('brief-1', '2026-08-18T12:00:00.000Z');
    store.save(brief);
    expect(store.get('unknown')).toMatchObject({ status: 'notFound' });
    expect(store.delete('unknown')).toMatchObject({ status: 'notFound' });
    expect(store.delete('brief-1')).toMatchObject({ status: 'deleted', brief });
    expect(new SmartDeployBriefStore(filePath).list().briefs).toEqual([]);
  });

  it('skips unsupported and malformed entries while preserving valid entries', () => {
    const { store, filePath } = createStore();
    const valid = createBrief('valid', '2026-08-18T12:00:00.000Z');
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 1, briefs: [valid, { ...valid, briefId: 'future', schemaVersion: 2 }, { briefId: 'invalid', schemaVersion: 1 }] }));
    const result = store.list();
    expect(result.status).toBe('loaded');
    expect(result.briefs).toEqual([valid]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsupported_brief_schema', 'invalid_brief']);
  });

  it('reports corrupt root content and recovers on the next save', () => {
    const { store, filePath } = createStore();
    fs.writeFileSync(filePath, '{broken');
    expect(store.list()).toMatchObject({ status: 'invalid', briefs: [] });
    const brief = createBrief('recovered', '2026-08-18T12:00:00.000Z');
    store.save(brief);
    expect(store.list().briefs).toEqual([brief]);
  });

  it('does not replace a valid store when an atomic write fails before rename', () => {
    const { store, filePath } = createStore();
    const original = createBrief('original', '2026-08-18T12:00:00.000Z');
    store.save(original);
    const originalContent = fs.readFileSync(filePath, 'utf8');
    const realRename = fs.renameSync;
    fs.renameSync = (() => { throw Object.assign(new Error('simulated failure'), { code: 'EIO' }); }) as typeof fs.renameSync;
    try {
      expect(() => store.save(createBrief('new', '2026-08-19T12:00:00.000Z'))).toThrow('simulated failure');
    } finally {
      fs.renameSync = realRename;
    }
    expect(fs.readFileSync(filePath, 'utf8')).toBe(originalContent);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(['smartdeploy-briefs.json']);
  });
});