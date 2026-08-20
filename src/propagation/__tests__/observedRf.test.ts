import { describe, expect, it } from 'vitest';
import {
  OBSERVED_RF_BANDS,
  buildObservedRfTopicPatterns,
  classifyObservedRfBand,
  parsePskPayload,
  parsePskTopic,
  summarizeObservedRfReports,
} from '../observedRf';

const TX_TOPIC = 'pskr/filter/v2/20m/FT8/K1ABC/W1XYZ/FM17/FN20/291/291';
const RX_TOPIC = 'pskr/filter/v2/20m/FT8/K1ABC/W1XYZ/FM17/FM17/291/291';
const NOW = new Date('2026-08-16T12:00:00.000Z');

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ seq: 42, sc: 'k1abc', rc: 'w1xyz', sl: 'FM17gm', rl: 'FN20aa', f: 14_074_000, md: 'FT8', rp: -12, t: 1786881300, b: '20m', ...overrides });
}

describe('PSKReporter MQTT observed-RF contracts', () => {
  it('builds the documented sender and receiver grid filters', () => {
    expect(buildObservedRfTopicPatterns('fm17')).toEqual([
      'pskr/filter/v2/+/+/+/+/FM17/+/+/+',
      'pskr/filter/v2/+/+/+/+/+/FM17/+/+',
    ]);
  });

  it('parses topic positions independently of payload field order', () => {
    expect(parsePskTopic(TX_TOPIC)).toEqual({
      band: '20m', mode: 'FT8', senderCallsign: 'K1ABC', receiverCallsign: 'W1XYZ',
      senderLocator: 'FM17', receiverLocator: 'FN20', senderDxcc: '291', receiverDxcc: '291',
    });
    expect(parsePskTopic('not/a/pskr/topic')).toBeNull();
  });

  it('normalizes callsigns and preserves the documented report fields', () => {
    const report = parsePskPayload(TX_TOPIC, payload(), 'FM17', NOW);
    expect(report).toMatchObject({
      reportId: 'sequence:42', senderCallsign: 'K1ABC', receiverCallsign: 'W1XYZ', senderGrid4: 'FM17', receiverGrid4: 'FN20',
      frequencyHz: 14_074_000, band: '20m', mode: 'FT8', snrDb: -12, direction: 'outbound',
      senderDxcc: '291', receiverDxcc: '291',
    });
    expect(report?.provenance.sourceName).toBe('PSKReporter reports via mqtt.pskreporter.info');
  });

  it('accepts current canonical sequence and DXCC fields alongside legacy aliases', () => {
    const report = parsePskPayload(TX_TOPIC, payload({ sq: 99, sa: 291, ra: 226 }), 'FM17', NOW);
    expect(report).toMatchObject({ reportId: 'sequence:99', sourceSequence: 99, senderDxcc: 291, receiverDxcc: 226 });
  });

  it('rejects malformed messages and cannot fabricate required fields', () => {
    expect(parsePskPayload(TX_TOPIC, '{broken', 'FM17', NOW)).toBeNull();
    expect(parsePskPayload('pskr/filter/v2/20m/FT8/+/+/FM17/FN20/291/291', JSON.stringify({ f: 14_074_000 }), 'FM17', NOW)).toBeNull();
    expect(parsePskPayload(TX_TOPIC, payload({ f: 'not-a-frequency' }), 'FM17', NOW)).toBeNull();
  });

  it('requires a valid source timestamp and keeps receipt time separate', () => {
    const report = parsePskPayload(TX_TOPIC, payload({ t: 1786881300000 }), 'FM17', NOW);
    expect(report?.observedAtUtc).toBe('2026-08-16T11:55:00.000Z');
    expect(report?.receivedAtUtc).toBe(NOW.toISOString());
    expect(parsePskPayload(TX_TOPIC, payload({ t: undefined }), 'FM17', NOW)).toBeNull();
    expect(parsePskPayload(TX_TOPIC, payload({ t: -1 }), 'FM17', NOW)).toBeNull();
    expect(parsePskPayload(TX_TOPIC, payload({ t: 1786881900 }), 'FM17', NOW)).toBeNull();
  });

  it('classifies all ten production bands, supports 6m, and excludes 60m', () => {
    const frequencies = [1_900_000, 3_700_000, 7_100_000, 10_125_000, 14_074_000, 18_100_000, 21_074_000, 24_915_000, 28_074_000, 50_313_000];
    expect(frequencies.map(frequency => classifyObservedRfBand(frequency, undefined))).toEqual(OBSERVED_RF_BANDS);
    expect(classifyObservedRfBand(5_357_000, '60m')).toBeNull();
    expect(classifyObservedRfBand(14_074_000, '40m')).toBe('20m');
  });

  it('identifies inbound and local reports, retaining missing and zero SNR honestly', () => {
    const inbound = parsePskPayload(TX_TOPIC, payload({ seq: 43, sl: 'FN20aa', rl: 'FM17gm', rp: 0, md: undefined }), 'FM17', NOW);
    const local = parsePskPayload(RX_TOPIC, payload({ seq: 44, rl: 'FM17gm' }), 'FM17', NOW);
    expect(inbound?.direction).toBe('inbound');
    expect(inbound?.snrDb).toBe(0);
    expect(inbound?.mode).toBe('FT8');
    expect(local?.direction).toBe('local');
    expect(parsePskPayload(TX_TOPIC, payload({ seq: 45, rp: undefined }), 'FM17', NOW)).toMatchObject({ senderLocator: 'FM17GM', receiverLocator: 'FN20AA', snrDb: null });
  });

  it('summarizes counts, paths, modes, SNR, and locator coverage for every band', () => {
    const reports = [
      parsePskPayload(TX_TOPIC, payload({ seq: 1, rp: -20 }), 'FM17', NOW)!,
      parsePskPayload(TX_TOPIC, payload({ seq: 2, rp: 0, t: 1786881360 }), 'FM17', NOW)!,
      parsePskPayload(TX_TOPIC, payload({ seq: 3, f: 50_313_000, b: '6m', md: 'FT4' }), 'FM17', NOW)!,
    ];
    const summaries = summarizeObservedRfReports(reports);
    expect(summaries).toHaveLength(10);
    expect(summaries.find(summary => summary.band === '20m')).toMatchObject({ reportCount: 2, outboundReportCount: 2, uniqueSenderCount: 1, uniqueReceiverCount: 1, uniquePathCount: 1, modeCounts: { FT8: 2 }, snrDb: { minimum: -20, maximum: 0, median: -10 }, locatorCoverage: { reportsWithBothLocators: 2, percentage: 100 } });
    expect(summaries.find(summary => summary.band === '6m')).toMatchObject({ reportCount: 1, modeCounts: { FT4: 1 } });
  });
});
