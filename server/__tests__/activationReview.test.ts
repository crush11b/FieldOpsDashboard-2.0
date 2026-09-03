import { describe, expect, it } from 'vitest';
import { assembleActivationReview } from '../activationReview';
import { createQso } from '../qso';

const activation = { schemaVersion: 1, activationId: 'activation-1', type: 'General', status: 'active', briefId: 'brief-1', createdAtUtc: '2026-08-25T10:00:00.000Z', updatedAtUtc: '2026-08-25T10:00:00.000Z' } as any;
const qso = (id: string, time: string, band: string, mode: string, source: 'manual' | 'adif_import') => createQso({ activationId: 'activation-1', qsoId: id, qsoDateTimeUtc: time, callsign: id === 'qso-1' ? 'W1AW' : 'K1ABC', band, mode, source, createdAtUtc: time, updatedAtUtc: time } as any);
const dependencies = (qsos: unknown[] = [], brief: unknown = null) => ({ activation, briefStore: { get: () => brief ? { status: 'found', brief, diagnostics: [] } : { status: 'notFound', diagnostics: [] } }, notesStore: { getByBriefId: () => ({ status: 'missing', collections: [], diagnostics: [] }) }, forecastStore: { getByBriefId: () => ({ status: 'notFound', diagnostics: [] }) }, spaceWeatherStore: { getByBriefId: () => ({ status: 'notFound', diagnostics: [] }) }, qsoStore: { listByActivation: () => ({ status: 'loaded', qsos, diagnostics: [] }) }, now: () => new Date('2026-08-25T13:00:00.000Z') } as any);
const modeledBrief = { schemaVersion: 2, briefId: 'brief-1', activation: { program: 'POTA', reference: 'US-1' }, plannedOperatingSite: { location: { coordinates: { lat: 40, lon: -75 } } }, missionWindow: { start: '2026-08-25T12:00:00.000Z', end: '2026-08-25T13:00:00.000Z' }, station: { selectedModes: ['FT8'], transmitPowerWatts: 10 }, sections: { propagation: { evidence: { samples: [{ bands: [{ band: '160m' }, { band: '20m' }] }] } }, observedRf: { evidence: null } } } as any;

describe('Activation Review assembly', () => {
  it('summarizes QSO counts, chronology, callsigns, and provenance', () => {
    const review = assembleActivationReview(dependencies([qso('qso-1', '2026-08-25T12:00:00Z', '20m', 'SSB', 'manual'), qso('qso-2', '2026-08-25T12:05:00Z', '40m', 'FT8', 'adif_import')]));
    expect(review.results).toMatchObject({ total: 2, byBand: { '20m': 1, '40m': 1 }, byMode: { SSB: 1, FT8: 1 }, firstQsoUtc: '2026-08-25T12:00:00.000Z', lastQsoUtc: '2026-08-25T12:05:00.000Z', uniqueCallsigns: 2, manual: 1, adifImported: 1 });
    expect(review.findings).toContain('Results are provisional while the Activation is active.');
  });

  it('keeps partial and no-evidence reviews useful', () => {
    const review = assembleActivationReview(dependencies());
    expect(review.plan.state).toBe('unavailable');
    expect(review.results).toMatchObject({ state: 'unknown', total: 0, firstQsoUtc: null, lastQsoUtc: null });
    expect(review.environment.forecast.state).toBe('unavailable');
    expect(review.environment.spaceWeather.state).toBe('unavailable');
    expect(review.propagation.state).toBe('unavailable');
    expect(review.findings).toContain('No QSOs logged.');
    expect(review.findings).toContain('No Activation Notes are present.');
  });

  it('does not infer planned bands from propagation candidates and excludes anomalous QSOs from chronology', () => {
    const review = assembleActivationReview(dependencies([
      qso('qso-1', '2026-08-25T12:05:00Z', '20m', 'FT8', 'manual'),
      qso('qso-2', '2025-05-03T20:48:15Z', '160m', 'FT8', 'adif_import'),
    ], modeledBrief));
    expect(review.plan.bands).toEqual([]);
    expect(review.results).toMatchObject({ total: 2, inWindowTotal: 1, outsideWindowTotal: 1, firstQsoUtc: '2026-08-25T12:05:00.000Z', lastQsoUtc: '2026-08-25T12:05:00.000Z' });
    expect(review.findings).not.toContain('Planned 160m operation has no logged 160m contacts.');
    expect(review.findings).toContain('1 associated QSO falls outside the retained planned mission window.');
  });
});