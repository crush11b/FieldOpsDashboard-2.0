import {
  OBSERVED_RF_BANDS,
  OBSERVED_RF_SOURCE_ID,
  OBSERVED_RF_SOURCE_NAME,
  OBSERVED_RF_WINDOW_MS,
  type ObservedRfConnectionStatus,
  type ObservedRfSnapshot,
  type PskReceptionReport,
} from '../src/propagation/observedRf';

export const LIVE_BAND_ACTIVITY_WINDOW_MINUTES = OBSERVED_RF_WINDOW_MS / 60_000;
export const LIVE_BAND_ACTIVITY_LIMITATION = 'Recent digital reception reports only; not a propagation prediction or guarantee of station success.';

export interface LiveBandActivityBand {
  readonly band: (typeof OBSERVED_RF_BANDS)[number];
  readonly reportCount: number;
  readonly newestObservedAtUtc: string | null;
  readonly inboundCount: number;
  readonly outboundCount: number;
  readonly localCount: number;
}

export interface LiveBandActivity {
  readonly source: {
    readonly id: typeof OBSERVED_RF_SOURCE_ID;
    readonly name: typeof OBSERVED_RF_SOURCE_NAME;
  };
  readonly status: ObservedRfConnectionStatus;
  readonly observedAtUtc: string;
  readonly newestObservedAtUtc: string | null;
  readonly collectedAtUtc: string;
  readonly observationWindow: ObservedRfSnapshot['observationWindow'];
  readonly windowMinutes: number;
  readonly operatingGrid4: string | null;
  readonly limitation: typeof LIVE_BAND_ACTIVITY_LIMITATION;
  readonly bands: readonly LiveBandActivityBand[];
}

export function createLiveBandActivity(snapshot: ObservedRfSnapshot): LiveBandActivity {
  const reportsByBand = new Map<string, PskReceptionReport[]>();
  snapshot.reports.forEach(report => {
    const reports = reportsByBand.get(report.band) ?? [];
    reports.push(report);
    reportsByBand.set(report.band, reports);
  });
  const newestObservedAtUtc = snapshot.reports.reduce<string | null>((newest, report) =>
    newest === null || report.observedAtUtc > newest ? report.observedAtUtc : newest, null);

  return {
    source: { id: OBSERVED_RF_SOURCE_ID, name: OBSERVED_RF_SOURCE_NAME },
    status: snapshot.status,
    observedAtUtc: newestObservedAtUtc ?? snapshot.collectedAtUtc,
    newestObservedAtUtc,
    collectedAtUtc: snapshot.collectedAtUtc,
    observationWindow: snapshot.observationWindow,
    windowMinutes: LIVE_BAND_ACTIVITY_WINDOW_MINUTES,
    operatingGrid4: snapshot.operatingGrid4,
    limitation: LIVE_BAND_ACTIVITY_LIMITATION,
    bands: OBSERVED_RF_BANDS.map(band => {
      const reports = reportsByBand.get(band) ?? [];
      return {
        band,
        reportCount: reports.length,
        newestObservedAtUtc: reports.reduce<string | null>((newest, report) =>
          newest === null || report.observedAtUtc > newest ? report.observedAtUtc : newest, null),
        inboundCount: reports.filter(report => report.direction === 'inbound').length,
        outboundCount: reports.filter(report => report.direction === 'outbound').length,
        localCount: reports.filter(report => report.direction === 'local').length,
      };
    }),
  };
}
