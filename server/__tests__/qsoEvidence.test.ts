import { describe, expect, it } from 'vitest';
import { aggregateQsoEvidence } from '../qsoEvidence';

const qso = (qsoId: string, qsoDateTimeUtc: string, band: string, mode: string) => ({ qsoId, qsoDateTimeUtc, band, mode } as any);

describe('QSO evidence aggregation', () => {
  it('aggregates retained QSOs into deterministic band, mode, recency, and two-way facts', () => {
    const evidence = aggregateQsoEvidence([
      qso('older-20', '2026-09-05T18:00:00.000Z', '20m', 'FT8'),
      qso('newer-15', '2026-09-05T18:10:00.000Z', '15m', 'FT4'),
      qso('newer-20', '2026-09-05T18:10:00.000Z', '20m', 'FT8'),
    ], '20m', 'FT8');
    expect(evidence).toMatchObject({ total: 3, byBand: { '20m': 2, '15m': 1 }, byMode: { FT8: 2, FT4: 1 }, byBandMode: { '20m': { FT8: 2 }, '15m': { FT4: 1 } }, mostRecentQsoUtc: '2026-09-05T18:10:00.000Z', mostRecentQsoUtcByBand: { '20m': '2026-09-05T18:10:00.000Z', '15m': '2026-09-05T18:10:00.000Z' }, currentBand: '20m', currentBandQsoCount: 2, currentBandMostRecentQsoUtc: '2026-09-05T18:10:00.000Z', currentBandMode: 'FT8', currentBandModeQsoCount: 2, hasTwoWayQsoByBand: { '20m': true, '15m': true } });
  });

  it('reflects the supplied retained list after edits or deletions', () => {
    const original = aggregateQsoEvidence([qso('one', '2026-09-05T18:00:00.000Z', '20m', 'FT8'), qso('two', '2026-09-05T18:01:00.000Z', '15m', 'FT4')], '20m');
    const changed = aggregateQsoEvidence([qso('one', '2026-09-05T18:02:00.000Z', '20m', 'FT4')], '20m');
    expect(original.total).toBe(2);
    expect(changed).toMatchObject({ total: 1, byBand: { '20m': 1 }, byMode: { FT4: 1 }, currentBandQsoCount: 1, currentBandMostRecentQsoUtc: '2026-09-05T18:02:00.000Z' });
    expect(changed.byBand['15m']).toBeUndefined();
  });
});
