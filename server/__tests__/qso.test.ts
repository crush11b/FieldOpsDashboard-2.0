import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createQso, normalizeQso, qsoFingerprint } from '../qso';
import { QsoStore } from '../qsoStore';
import { exportQsos, parseAdif } from '../qsoAdif';

const dirs: string[] = [];
const now = () => new Date('2026-08-25T12:00:00.000Z');
const input = { activationId: 'activation-1', qsoDateTimeUtc: '2026-08-25T11:59:00Z', callsign: '  w1aw  ', band: '20M', frequencyMHz: 14.074, mode: 'FT8', rstSent: '-10', rstReceived: '-12' };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('QSO model and persistence', () => {
  it('normalizes callsign and preserves Activation ownership', () => { const qso = createQso(input, { now, createId: () => 'qso-1' }); expect(qso).toMatchObject({ qsoId: 'qso-1', activationId: 'activation-1', callsign: 'W1AW', band: '20m', source: 'manual' }); });
  it('derives band from known frequency and rejects contradictions', () => { expect(createQso({ ...input, band: undefined }, { now }).band).toBe('20m'); expect(normalizeQso({ ...input, band: '40m', qsoId: 'qso-1', createdAtUtc: '2026-08-25T12:00:00Z', updatedAtUtc: '2026-08-25T12:00:00Z' }).valid).toBe(false); });
  it('persists, updates, and deletes across store reconstruction', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-qso-')); dirs.push(dir); const file = path.join(dir, 'qsos.json'); const store = new QsoStore(file, { now, createId: () => 'qso-1' }); const qso = store.create(input).qso; expect(new QsoStore(file).listByActivation('activation-1').qsos).toEqual([qso]); const updated = { ...qso, callsign: 'K1ABC', updatedAtUtc: '2026-08-25T12:01:00.000Z' }; expect(store.save(updated).qso.callsign).toBe('K1ABC'); expect(store.delete(qso.qsoId).status).toBe('deleted'); expect(store.listByActivation('activation-1').qsos).toHaveLength(0); });
  it('does not accept empty or malformed required values', () => { expect(normalizeQso({ ...input, callsign: ' ' }).valid).toBe(false); expect(normalizeQso({ ...input, qsoDateTimeUtc: 'local time' }).valid).toBe(false); });
});

describe('ADIF QSO interoperability', () => {
  const adif = '<ADIF_VER:5>3.1.0<EOH>\n<QSO_DATE:8>20260825<TIME_ON:6>120000<CALL:5>W1AW <BAND:3>20M<FREQ:6>14.074<MODE:3>FT8<SUBMODE:3>FT8<RST_SENT:3>-10<RST_RCVD:3>-12<GRIDSQUARE:6>FN31pr<EOR>\n<QSO_DATE:8>20260825<TIME_ON:6>120100<CALL:5>K1ABC<BAND:3>20M<MODE:3>SSB<EOR>';
  it('parses multiple Ham2K or WSJT-X style records and optional fields', () => { const parsed = parseAdif(adif); expect(parsed.recordsFound).toBe(2); expect(parsed.records).toHaveLength(2); expect(parsed.records[0]).toMatchObject({ callsign: 'W1AW', mode: 'FT8', submode: 'FT8', gridSquare: 'FN31pr' }); });
  it('reports malformed records while retaining usable records', () => { const parsed = parseAdif(`${adif}<QSO_DATE:8>bad<CALL:3>BAD<EOR>`); expect(parsed.records).toHaveLength(2); expect(parsed.errors.length).toBeGreaterThan(0); });
  it('exports standards-shaped UTC records and Activation metadata', () => { const qso = createQso({ ...input, potaRef: undefined }, { now, createId: () => 'qso-1' }); const output = exportQsos([qso], { type: 'POTA', reference: 'US-0182', myGridSquare: 'FM17gj' }); expect(output).toContain('<QSO_DATE:8>20260825'); expect(output).toContain('<TIME_ON:6>115900'); expect(output).toContain('<CALL:4>W1AW'); expect(output).toContain('<MODE:3>FT8'); expect(output).toContain('<POTA_REF:7>US-0182'); expect(qsoFingerprint(qso)).toContain('W1AW'); });
});
