import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createQso } from '../qso';
import { applyQsoReassociation, planQsoReassociation } from '../qsoRecovery';
import type { Activation } from '../activation';

const temporaryDirectories: string[] = [];
const activation = (activationId: string) => ({ activationId } as Activation);
const qso = (activationId: string, qsoId: string, callsign = 'K1ABC') => ({ ...createQso({ activationId, qsoDateTimeUtc: '2026-01-01T12:00:00Z', callsign, band: '20m', mode: 'FT8', source: 'manual' }, { now: () => new Date('2026-01-01T12:00:00Z') }), qsoId });

afterEach(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('QSO reassociation recovery', () => {
  it('rejects target contact collisions and does not produce an executable plan', () => {
    const plan = planQsoReassociation([qso('source', 'qso-1'), qso('target', 'qso-2')], [activation('target')], { sourceActivationId: 'source', targetActivationId: 'target' });
    expect(plan.status).toBe('rejected');
    expect(plan.collisions.map(item => item.qsoId)).toEqual(['qso-2']);
  });

  it('applies only a ready plan with a backup and audit record', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-qso-recovery-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'qsos.json');
    const sourceQso = qso('source', 'qso-1');
    fs.writeFileSync(filePath, JSON.stringify({ storeVersion: 2, qsos: [sourceQso] }));
    const plan = planQsoReassociation([sourceQso], [activation('target')], { sourceActivationId: 'source', targetActivationId: 'target', expectedQsoIds: ['qso-1'] });
    const result = applyQsoReassociation(filePath, plan, new Date('2026-01-01T13:00:00Z'));
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).qsos[0].activationId).toBe('target');
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(result.auditPath, 'utf8')).selectedQsoIds).toEqual(['qso-1']);
  });
});
