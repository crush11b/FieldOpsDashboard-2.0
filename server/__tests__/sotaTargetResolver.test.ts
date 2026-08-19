import { describe, expect, it } from 'vitest';
import { LocalSotaSummitDataset, SOTA_SUMMIT_SOURCE_ID, SOTA_SUMMIT_SOURCE_NAME, SOTA_SUMMIT_SOURCE_URL, parseSotaSummitCsv } from '../sotaSummitDataset';
import { SotaActivationTargetResolver } from '../sotaTargetResolver';

const csv = 'SummitCode,AssociationName,RegionName,SummitName,AltM,AltFt,GridRef1,GridRef2,Longitude,Latitude,Points,BonusPoints,ValidFrom,ValidTo,ActivationCount,ActivationDate,ActivationCall\nW4V/SH-001,USA,Virginia,High Knob,1287,4222,18S,18S,-82.1234,37.4567,10,3,01/01/2020,31/12/2099,0,,';
const metadata = (stale = false) => ({ sourceVersion: '19/08/2026', downloadedAtUtc: '2026-08-19T12:00:00.000Z', stale, sourceId: SOTA_SUMMIT_SOURCE_ID, sourceName: SOTA_SUMMIT_SOURCE_NAME, sourceUrl: SOTA_SUMMIT_SOURCE_URL });

function dataset(stale = false) {
  const parsed = parseSotaSummitCsv(csv);
  if (parsed.status !== 'valid') throw new Error('Test CSV should parse.');
  return new LocalSotaSummitDataset(parsed.records, metadata(stale));
}

describe('SOTA activation target resolver', () => {
  it('resolves case-insensitive references from the local dataset with authoritative coordinates', async () => {
    const result = await new SotaActivationTargetResolver(dataset()).resolve({ program: 'SOTA', reference: ' w4v/sh-001 ' });
    expect(result).toMatchObject({ status: 'cached', reference: 'W4V/SH-001', target: {
      program: 'SOTA', reference: 'W4V/SH-001', displayName: 'High Knob', coordinates: { lat: 37.4567, lon: -82.1234 },
      provenance: { kind: 'externally_resolved', source: { id: 'sota-summit-database', type: 'sota_official_summit_csv' }, resolvedAtUtc: '2026-08-19T12:00:00.000Z' },
    } });
  });

  it('returns deterministic not-found and unavailable results without network access', async () => {
    expect((await new SotaActivationTargetResolver(dataset()).resolve({ program: 'SOTA', reference: 'W4V/SH-999' })).status).toBe('unknown');
    expect((await new SotaActivationTargetResolver(LocalSotaSummitDataset.unavailable()).resolve({ program: 'SOTA', reference: 'W4V/SH-001' }))).toMatchObject({ status: 'unavailable', reference: 'W4V/SH-001' });
  });

  it('preserves stale state while allowing local lookup', async () => {
    const result = await new SotaActivationTargetResolver(dataset(true)).resolve({ program: 'SOTA', reference: 'W4V/SH-001' });
    expect(result).toMatchObject({ status: 'stale', target: { coordinates: { lat: 37.4567, lon: -82.1234 } }, error: 'SOTA summit data is stale.' });
  });

  it('rejects non-SOTA requests without consulting the dataset', async () => {
    expect((await new SotaActivationTargetResolver(dataset()).resolve({ program: 'POTA', reference: 'US-1234' })).status).toBe('unsupported');
  });
});