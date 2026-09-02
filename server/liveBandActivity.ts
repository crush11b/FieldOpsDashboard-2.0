import {
  OBSERVED_RF_BANDS,
  OBSERVED_RF_SOURCE_ID,
  OBSERVED_RF_SOURCE_NAME,
  OBSERVED_RF_WINDOW_MS,
  type ObservedRfConnectionStatus,
  type ObservedRfSnapshot,
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
  const summaries = new Map<string, { reportCount: number; newestObservedAtUtc: string | null; inboundCount: number; outboundCount: number; localCount: number }>();
  OBSERVED_RF_BANDS.forEach(band => summaries.set(band, { reportCount: 0, newestObservedAtUtc: null, inboundCount: 0, outboundCount: 0, localCount: 0 }));
  snapshot.reports.forEach(report => {
    const summary = summaries.get(report.band);
    if (!summary) return;
    summary.reportCount += 1;
    summary.newestObservedAtUtc = summary.newestObservedAtUtc === null || report.observedAtUtc > summary.newestObservedAtUtc ? report.observedAtUtc : summary.newestObservedAtUtc;
    if (report.direction === 'inbound') summary.inboundCount += 1;
    if (report.direction === 'outbound') summary.outboundCount += 1;
    if (report.direction === 'local') summary.localCount += 1;
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
      return { band, ...summaries.get(band)! };
    }),
  };
}
