import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LocalSotaSummitDataset,
  SOTA_SUMMIT_SOURCE_ID,
  SOTA_SUMMIT_SOURCE_NAME,
  SOTA_SUMMIT_SOURCE_URL,
  parseSotaSummitCsv,
} from '../sotaSummitDataset';

const fixture = readFileSync(new URL('./fixtures/sota-summits.csv', import.meta.url), 'utf8');
const metadata = (stale = false) => ({
  sourceVersion: '19/08/2026', downloadedAtUtc: '2026-08-19T12:00:00.000Z', stale,
  sourceId: SOTA_SUMMIT_SOURCE_ID, sourceName: SOTA_SUMMIT_SOURCE_NAME, sourceUrl: SOTA_SUMMIT_SOURCE_URL,
});

function validRows() {
  const parsed = parseSotaSummitCsv(fixture);
  expect(parsed.status).toBe('valid');
  if (parsed.status !== 'valid') throw new Error('Fixture should parse.');
  return parsed.records;
}

describe('SOTA summit CSV and local dataset', () => {
  it('accepts the official dated preamble and preserves its source version', () => {
    const result = parseSotaSummitCsv(`SOTA Summits List (Date=19/08/2026)\n${fixture}`);
    expect(result).toMatchObject({ status: 'valid', sourceVersion: '19/08/2026' });
    expect(result.status === 'valid' && result.records.size).toBe(2);
  });

  it('parses the official headers, quoted names, coordinates, and absent elevation', () => {
    const records = validRows();
    expect(records.get('W4V/SH-001')).toMatchObject({ reference: 'W4V/SH-001', name: 'High Knob, North Ridge', latitude: 37.4567, longitude: -82.1234, elevationM: 1287 });
    expect(records.get('W4V/SH-002')).toMatchObject({ name: 'Second Summit', latitude: 37, longitude: -82 });
    expect(records.get('W4V/SH-002')).not.toHaveProperty('elevationM');
  });

  it.each([
    ['malformed latitude', 'W4V/SH-001,USA,Virginia,Summit,100,3000,18S,18S,-82,not-a-lat,10,0,01/01/2020,31/12/2099,0,,', 'Latitude'],
    ['malformed longitude', 'W4V/SH-001,USA,Virginia,Summit,100,3000,18S,18S,not-a-lon,37,10,0,01/01/2020,31/12/2099,0,,', 'Longitude'],
    ['missing reference', ',USA,Virginia,Summit,100,3000,18S,18S,-82,37,10,0,01/01/2020,31/12/2099,0,,', 'SummitCode'],
    ['missing name', 'W4V/SH-001,USA,Virginia,,100,3000,18S,18S,-82,37,10,0,01/01/2020,31/12/2099,0,,', 'SummitName'],
  ])('rejects %s', (_name, row, field) => {
    const result = parseSotaSummitCsv(fixture.split('\n').slice(0, 1).concat(row).join('\n'));
    expect(result.status).toBe('invalid');
    expect(result.status === 'invalid' && result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
  });

  it('rejects duplicate normalized references', () => {
    const duplicate = fixture.trimEnd() + '\n' + fixture.split('\n')[1].replace('W4V/SH-001', 'w4v/sh-001');
    const result = parseSotaSummitCsv(duplicate);
    expect(result.status).toBe('invalid');
    expect(result.status === 'invalid' && result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'SummitCode' })]));
  });

  it('rejects a CSV with missing required headers', () => {
    const result = parseSotaSummitCsv('SummitCode,SummitName\nW4V/SH-001,Summit');
    expect(result.status).toBe('invalid');
    expect(result.status === 'invalid' && result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'Latitude' })]));
  });

  it('reports available, stale, and unavailable states without network behavior', () => {
    const records = validRows();
    expect(new LocalSotaSummitDataset(records, metadata()).state).toBe('AVAILABLE');
    expect(new LocalSotaSummitDataset(records, metadata(true)).state).toBe('STALE');
    expect(LocalSotaSummitDataset.unavailable().state).toBe('UNAVAILABLE');
    expect(new LocalSotaSummitDataset(records, metadata()).get(' w4v/sh-001 ')?.reference).toBe('W4V/SH-001');
  });
});