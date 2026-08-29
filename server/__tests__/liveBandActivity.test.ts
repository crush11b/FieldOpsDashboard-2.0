import { describe, expect, it } from 'vitest';
import { OBSERVED_RF_BANDS, type ObservedRfSnapshot, type PskReceptionReport } from '../../src/propagation/observedRf';
import { createLiveBandActivity, LIVE_BAND_ACTIVITY_LIMITATION } from '../liveBandActivity';

const NOW = '2026-08-29T12:00:00.000Z';

function report(band: PskReceptionReport['band'], direction: PskReceptionReport['direction'], observedAtUtc: string): PskReceptionReport {
  return {
    reportId: `${band}-${direction}-${observedAtUtc}`,
    sourceSequence: null,
    senderCallsign: direction === 'inbound' ? 'REMOTE' : 'LOCAL',
    receiverCallsign: direction === 'outbound' ? 'REMOTE' : 'LOCAL',
    senderLocator: 'FM17AA',
    receiverLocator: 'FN20AA',
    senderGrid4: direction === 'inbound' ? 'FN20' : 'FM17',
    receiverGrid4: direction === 'outbound' ? 'FN20' : 'FM17',
    frequencyHz: 14_074_000,
    band,
    mode: 'FT8',
    snrDb: -10,
    observedAtUtc,
    receivedAtUtc: NOW,
    senderDxcc: null,
    receiverDxcc: null,
    direction,
    provenance: {
      sourceId: 'pskreporter-via-mqtt',
      sourceName: 'PSKReporter reports via mqtt.pskreporter.info',
      semantics: 'observed_digital_reception_report',
      limitation: 'Does not prove SSB usability, station-specific success, regional openness, confidence, or a propagation rating.',
    },
  };
}

function snapshot(status: ObservedRfSnapshot['status'], reports: readonly PskReceptionReport[]): ObservedRfSnapshot {
  return {
    kind: 'observed_rf', status,
    evidenceStatus: status === 'live' ? 'live_observed_rf_source' : status === 'cached' ? 'cached_observed_rf_source' : status === 'stale' ? 'stale_observed_rf_source' : 'unavailable',
    operatingGrid4: 'FM17',
    observationWindow: { startsAt: '2026-08-29T11:45:00.000Z', endsAt: NOW },
    collectedAtUtc: NOW,
    reports,
    bandSummaries: [],
    provenance: { sourceId: 'pskreporter-via-mqtt', sourceName: 'PSKReporter reports via mqtt.pskreporter.info', transport: 'mqtts-websocket', brokerHost: 'mqtt.pskreporter.info', brokerPort: 1886, topicPatterns: [] },
  };
}

describe('Live Band Activity read model', () => {
  it('preserves all ten canonical bands and exact direction counts', () => {
    const activity = createLiveBandActivity(snapshot('live', [
      report('20m', 'outbound', '2026-08-29T11:59:00.000Z'),
      report('20m', 'inbound', '2026-08-29T11:58:00.000Z'),
      report('20m', 'local', '2026-08-29T11:57:00.000Z'),
    ]));
    expect(activity.bands).toHaveLength(OBSERVED_RF_BANDS.length);
    expect(activity.bands.map(item => item.band)).toEqual(OBSERVED_RF_BANDS);
    expect(activity.bands.find(item => item.band === '20m')).toMatchObject({ reportCount: 3, inboundCount: 1, outboundCount: 1, localCount: 1, newestObservedAtUtc: '2026-08-29T11:59:00.000Z' });
    expect(activity.bands.find(item => item.band === '40m')).toMatchObject({ reportCount: 0, inboundCount: 0, outboundCount: 0, localCount: 0, newestObservedAtUtc: null });
    expect(activity.limitation).toBe(LIVE_BAND_ACTIVITY_LIMITATION);
    expect(activity).not.toHaveProperty('rating');
    expect(activity).not.toHaveProperty('recommendation');
  });

  it.each(['live', 'cached', 'stale', 'unavailable'] as const)('preserves %s source status without fabricating reports', status => {
    const activity = createLiveBandActivity(snapshot(status, []));
    expect(activity.status).toBe(status);
    expect(activity.bands.every(item => item.reportCount === 0)).toBe(true);
    expect(activity.newestObservedAtUtc).toBeNull();
  });
});
