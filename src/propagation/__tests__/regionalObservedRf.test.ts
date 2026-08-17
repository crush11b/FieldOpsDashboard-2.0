import { describe, expect, it } from 'vitest';
import { latLonToGridSquare } from '../../types';
import { OBSERVED_RF_BANDS, parsePskPayload, type ObservedRfSnapshot, type PskReceptionReport } from '../observedRf';
import { PROPAGATION_REGION_IDS } from '../regionalDestinations';
import { findPropagationRegionMembership, validatePropagationRegionMembership } from '../regionalMembership';
import { classifyRegionalObservedRfReport, deriveRegionalObservedRf } from '../regionalObservedRf';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const OPERATING_GRID = 'FM17';
const TOPIC = 'pskr/filter/v2/20m/FT8/K1ABC/W1XYZ/FM17/FN20/291/291';

const expectedRegions: readonly [string, string][] = [
  ['Virginia', 'eastern_us'], ['New York', 'eastern_us'], ['Florida', 'eastern_us'],
  ['Texas', 'central_us'], ['Minnesota', 'central_us'],
  ['California', 'western_us'], ['Washington', 'western_us'], ['Arizona', 'western_us'],
  ['Cuba', 'caribbean'], ['Puerto Rico', 'caribbean'], ['Jamaica', 'caribbean'],
  ['Guatemala', 'central_america'], ['Costa Rica', 'central_america'], ['Panama', 'central_america'],
  ['Colombia', 'south_america'], ['Brazil', 'south_america'], ['Chile', 'south_america'], ['Argentina', 'south_america'],
  ['UK', 'western_europe'], ['Spain', 'western_europe'], ['France', 'western_europe'], ['Germany', 'western_europe'], ['Italy', 'western_europe'],
  ['Poland', 'eastern_europe'], ['Romania', 'eastern_europe'], ['Ukraine', 'eastern_europe'], ['Greece', 'eastern_europe'],
  ['Morocco', 'north_africa'], ['Algeria', 'north_africa'], ['Egypt', 'north_africa'],
  ['South Africa', 'southern_africa'], ['Namibia', 'southern_africa'], ['Mozambique', 'southern_africa'],
  ['Israel', 'middle_east'], ['Saudi Arabia', 'middle_east'], ['UAE', 'middle_east'], ['Iran', 'middle_east'], ['Turkey', 'middle_east'],
  ['Japan', 'east_asia'], ['South Korea', 'east_asia'], ['China', 'east_asia'], ['Taiwan', 'east_asia'],
  ['Australia', 'oceania'], ['New Zealand', 'oceania'], ['Papua New Guinea', 'oceania'], ['Fiji', 'oceania'],
];

const coordinates: Record<string, { lat: number; lon: number }> = {
  Virginia: { lat: 37.54, lon: -77.43 }, 'New York': { lat: 42.9, lon: -74 }, Florida: { lat: 28.5, lon: -81.5 },
  Texas: { lat: 31, lon: -99 }, Minnesota: { lat: 45, lon: -94 }, California: { lat: 36.5, lon: -119.5 }, Washington: { lat: 47.4, lon: -120.5 }, Arizona: { lat: 34, lon: -111.5 },
  Cuba: { lat: 23, lon: -82 }, 'Puerto Rico': { lat: 18.2, lon: -66.4 }, Jamaica: { lat: 18.1, lon: -77.3 },
  Guatemala: { lat: 14.6, lon: -90.5 }, 'Costa Rica': { lat: 9.9, lon: -84.1 }, Panama: { lat: 9, lon: -79.5 },
  Colombia: { lat: 4.7, lon: -74 }, Brazil: { lat: -15, lon: -47 }, Chile: { lat: -33, lon: -70 }, Argentina: { lat: -34.6, lon: -58.4 },
  UK: { lat: 51.5, lon: -0.1 }, Spain: { lat: 40.4, lon: -3.7 }, France: { lat: 48.8, lon: 2.3 }, Germany: { lat: 50.1, lon: 8.7 }, Italy: { lat: 45.5, lon: 9.2 },
  Poland: { lat: 52.2, lon: 21 }, Romania: { lat: 44.4, lon: 26.1 }, Ukraine: { lat: 50.4, lon: 30.5 }, Greece: { lat: 38, lon: 23.7 },
  Morocco: { lat: 33.6, lon: -7.6 }, Algeria: { lat: 36.7, lon: 3.1 }, Egypt: { lat: 30, lon: 31.2 },
  'South Africa': { lat: -30, lon: 25 }, Namibia: { lat: -22.5, lon: 17 }, Mozambique: { lat: -25.9, lon: 32.6 },
  Israel: { lat: 32.1, lon: 34.8 }, 'Saudi Arabia': { lat: 24.7, lon: 46.7 }, UAE: { lat: 25.2, lon: 55.3 }, Iran: { lat: 35.7, lon: 51.4 }, Turkey: { lat: 39, lon: 32 },
  Japan: { lat: 35.7, lon: 139.7 }, 'South Korea': { lat: 37.6, lon: 127 }, China: { lat: 39.9, lon: 116.4 }, Taiwan: { lat: 25, lon: 121.5 },
  Australia: { lat: -33.9, lon: 151.2 }, 'New Zealand': { lat: -36.9, lon: 174.8 }, 'Papua New Guinea': { lat: -9.4, lon: 147.2 }, Fiji: { lat: -18.1, lon: 178.4 },
};

function reportFor(remote: { lat: number; lon: number } | null, direction: 'outbound' | 'inbound' | 'local' = 'outbound', overrides: Record<string, unknown> = {}): PskReceptionReport {
  const remoteLocator = remote ? latLonToGridSquare(remote.lat, remote.lon) : '';
  const senderLocator = direction === 'inbound' ? remoteLocator : 'FM17gm';
  const receiverLocator = direction === 'outbound' ? remoteLocator : 'FM17gm';
  const sender = direction === 'inbound' ? 'REMOTE' : 'K1ABC';
  const receiver = direction === 'outbound' ? 'REMOTE' : 'W1XYZ';
  const topic = `pskr/filter/v2/20m/FT8/${sender}/${receiver}/${senderLocator}/${receiverLocator}/291/291`;
  const parsed = parsePskPayload(topic, JSON.stringify({ seq: `${direction}-${remoteLocator || 'missing'}`, sc: sender, rc: receiver, sl: senderLocator, rl: receiverLocator, f: 14_074_000, md: 'FT8', rp: -12, t: 1786881300, b: '20m', ...overrides }), OPERATING_GRID, NOW);
  if (!parsed) throw new Error('Fixture did not parse');
  return parsed;
}

function snapshot(reports: readonly PskReceptionReport[], status: ObservedRfSnapshot['status'] = 'live'): ObservedRfSnapshot {
  return {
    kind: 'observed_rf', status, evidenceStatus: status === 'live' ? 'live_observed_rf_source' : 'cached_observed_rf_source', operatingGrid4: OPERATING_GRID,
    observationWindow: { startsAt: '2026-08-16T11:45:00.000Z', endsAt: NOW.toISOString() }, collectedAtUtc: NOW.toISOString(), reports,
    bandSummaries: [], provenance: { sourceId: 'pskreporter-via-mqtt', sourceName: 'PSKReporter reports via mqtt.pskreporter.info', transport: 'mqtts-websocket', brokerHost: 'mqtt.pskreporter.info', brokerPort: 1886, topicPatterns: [] },
  };
}

describe('Slice 5G-B deterministic regional observed-RF classification', () => {
  it.each(expectedRegions)('classifies %s as %s', (label, regionId) => {
    expect(findPropagationRegionMembership(coordinates[label])).toBe(regionId);
  });

  it('leaves Alaska, Hawaii, Canada, Mexico, South Asia, Central Asia, Russia, and Antarctica unclassified', () => {
    for (const coordinate of [{ lat: 64, lon: -149 }, { lat: 20.8, lon: -156 }, { lat: 56, lon: -106 }, { lat: 20, lon: -100 }, { lat: 20, lon: 78 }, { lat: 42, lon: 75 }, { lat: 60, lon: 90 }, { lat: -75, lon: 0 }]) {
      expect(findPropagationRegionMembership(coordinate)).toBeNull();
    }
  });

  it('uses explicit half-open boundaries and proves the catalog has no cross-region overlaps', () => {
    expect(validatePropagationRegionMembership()).toEqual([]);
    expect(findPropagationRegionMembership({ lat: 37, lon: -90 })).toBe('eastern_us');
    expect(findPropagationRegionMembership({ lat: 37, lon: -90.001 })).toBe('central_us');
    expect(findPropagationRegionMembership({ lat: 37, lon: -110 })).toBe('central_us');
    expect(findPropagationRegionMembership({ lat: 37, lon: -110.001 })).toBe('western_us');
    expect(findPropagationRegionMembership({ lat: 48, lon: 12 })).toBe('eastern_europe');
    expect(findPropagationRegionMembership({ lat: 48, lon: 11.999 })).toBe('western_europe');
  });

  it('resolves outbound, inbound, local, missing-location, and unclassified endpoints', () => {
    const outbound = classifyRegionalObservedRfReport(reportFor(coordinates.UK), OPERATING_GRID);
    const inbound = classifyRegionalObservedRfReport(reportFor(coordinates.Japan, 'inbound'), OPERATING_GRID);
    const local = classifyRegionalObservedRfReport(reportFor(coordinates.Virginia, 'local'), OPERATING_GRID);
    const missing = classifyRegionalObservedRfReport(reportFor(null), OPERATING_GRID);
    const unclassified = classifyRegionalObservedRfReport(reportFor({ lat: 64, lon: -149 }), OPERATING_GRID);
    expect(outbound).toMatchObject({ direction: 'outbound', remoteCallsign: 'REMOTE', regionId: 'western_europe', classificationStatus: 'classified', coordinateBasis: 'maidenhead_center' });
    expect(inbound).toMatchObject({ direction: 'inbound', remoteLocator: expect.any(String), regionId: 'east_asia', classificationStatus: 'classified' });
    expect(local).toMatchObject({ regionId: 'local_nvis', classificationStatus: 'local', remoteCallsign: null, remoteCoordinateEstimate: null });
    expect(local.provenance.limitation).toContain('propagation mechanism');
    expect(missing).toMatchObject({ classificationStatus: 'insufficient_location', regionId: null, remoteCoordinateEstimate: null });
    expect(unclassified).toMatchObject({ classificationStatus: 'unclassified', regionId: null });
  });

  it('builds ten-band summaries with counts, paths, modes, SNR, coverage, and zero rows', () => {
    const reports = [
      reportFor(coordinates.UK), reportFor(coordinates.UK, 'inbound', { seq: 'inbound-uk', sc: 'REMOTE', rc: 'W1XYZ', sl: latLonToGridSquare(coordinates.UK.lat, coordinates.UK.lon), rl: 'FM17gm', rp: 0 }),
      reportFor(coordinates.UK, 'outbound', { seq: 'duplicate-copy' }),
      reportFor({ lat: 64, lon: -149 }, 'outbound', { seq: 'alaska' }), reportFor(null, 'outbound', { seq: 'missing' }), reportFor(coordinates.Virginia, 'local', { seq: 'local' }),
      reportFor(coordinates.Australia, 'outbound', { seq: '6m', f: 50_313_000, b: '6m', md: 'FT4' }),
    ];
    const regional = deriveRegionalObservedRf(snapshot(reports));
    expect(regional).toMatchObject({ sourceStatus: 'live', classifiedReportCount: 4, unclassifiedReportCount: 1, insufficientLocationCount: 1, localReportCount: 1 });
    expect(regional.regionBandSummaries).toHaveLength(PROPAGATION_REGION_IDS.length * OBSERVED_RF_BANDS.length);
    expect(regional.regionBandSummaries.find(summary => summary.regionId === 'western_europe' && summary.band === '20m')).toMatchObject({ reportCount: 3, outboundReportCount: 2, inboundReportCount: 1, uniqueRemoteCallsignCount: 1, uniquePathCount: 2, modeCounts: { FT8: 3 }, snrDb: { minimum: -12, maximum: 0, median: -12 }, locatorCoverage: { reportsWithRemoteLocator: 3, percentage: 100 } });
    expect(regional.regionBandSummaries.find(summary => summary.regionId === 'oceania' && summary.band === '6m')).toMatchObject({ reportCount: 1, modeCounts: { FT4: 1 } });
    expect(regional.regionBandSummaries.find(summary => summary.regionId === 'western_europe' && summary.band === '6m')).toMatchObject({ reportCount: 0, newestReportAt: null, snrDb: { minimum: null, maximum: null, median: null } });
    expect(regional.classifiedReports.every(report => report.classificationStatus === 'classified')).toBe(true);
    expect(regional).not.toHaveProperty('rating');
  });

  it.each(['live', 'cached', 'stale', 'unavailable'] as const)('preserves %s source state', status => {
    expect(deriveRegionalObservedRf(snapshot([reportFor(coordinates.UK)], status)).sourceStatus).toBe(status);
  });
});
