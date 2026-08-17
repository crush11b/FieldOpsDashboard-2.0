import { gridSquareToLatLon } from '../types';
import type { Coordinates } from '../location/coordinates';
import type { PropagationGuidanceBand } from './domain';
import {
  OBSERVED_RF_BANDS,
  type ObservedRfConnectionStatus,
  type ObservedRfSnapshot,
  type PskReceptionReport,
  type ObservedRfDirection,
} from './observedRf';
import { findPropagationRegionMembership } from './regionalMembership';
import { PROPAGATION_REGION_IDS, type PropagationRegionId } from './regionalDestinations';

export type RegionalObservedRfClassificationStatus = 'classified' | 'unclassified' | 'insufficient_location' | 'local';

export interface RegionalObservedRfReport {
  readonly sourceReportId: string;
  readonly sourceReport: PskReceptionReport;
  readonly operatingGrid4: string | null;
  readonly direction: ObservedRfDirection;
  readonly band: PropagationGuidanceBand;
  readonly mode: string | null;
  readonly snrDb: number | null;
  readonly observedAtUtc: string;
  readonly remoteCallsign: string | null;
  readonly remoteLocator: string | null;
  readonly remoteCoordinateEstimate: Coordinates | null;
  readonly coordinateBasis: 'maidenhead_center' | null;
  readonly regionId: PropagationRegionId | null;
  readonly classificationStatus: RegionalObservedRfClassificationStatus;
  readonly provenance: {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly semantics: 'observed_digital_reception_report';
    readonly coordinateSemantics: 'locator_center_estimate' | 'not_applicable';
    readonly limitation: 'Does not prove SSB usability, station-specific success, regional openness, confidence, a propagation mechanism, or a propagation rating.';
  };
}

export interface RegionalObservedRfNumericSummary {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly median: number | null;
}

export interface RegionalObservedRfBandSummary {
  readonly regionId: PropagationRegionId;
  readonly band: PropagationGuidanceBand;
  readonly reportCount: number;
  readonly outboundReportCount: number;
  readonly inboundReportCount: number;
  readonly localReportCount: number;
  readonly uniqueRemoteCallsignCount: number;
  readonly uniquePathCount: number;
  readonly modeCounts: Readonly<Record<string, number>>;
  readonly newestReportAt: string | null;
  readonly oldestReportAt: string | null;
  readonly snrDb: RegionalObservedRfNumericSummary;
  readonly locatorCoverage: { readonly reportsWithRemoteLocator: number; readonly percentage: number | null };
  readonly classificationCoverage: { readonly classifiedReportCount: number; readonly percentage: number | null };
}

export interface RegionalObservedRfSnapshot {
  readonly kind: 'regional_observed_rf';
  readonly sourceStatus: ObservedRfConnectionStatus;
  readonly operatingGrid4: string | null;
  readonly observationWindow: ObservedRfSnapshot['observationWindow'];
  readonly collectedAtUtc: string;
  readonly sourceProvenance: ObservedRfSnapshot['provenance'];
  readonly classifiedReportCount: number;
  readonly unclassifiedReportCount: number;
  readonly insufficientLocationCount: number;
  readonly localReportCount: number;
  readonly reports: readonly RegionalObservedRfReport[];
  readonly classifiedReports: readonly RegionalObservedRfReport[];
  readonly regionBandSummaries: readonly RegionalObservedRfBandSummary[];
}

const LOCAL_NVIS_DESCRIPTION = 'Local-area digital activity; the propagation mechanism is unknown and this is not NVIS observed.';

export function deriveRegionalObservedRf(snapshot: ObservedRfSnapshot): RegionalObservedRfSnapshot {
  const sourceReports = [...new Map(snapshot.reports.map(report => [report.reportId, report])).values()];
  const reports = sourceReports.map(report => classifyRegionalObservedRfReport(report, snapshot.operatingGrid4));
  const classifiedReports = reports.filter(report => report.classificationStatus === 'classified');
  return {
    kind: 'regional_observed_rf',
    sourceStatus: snapshot.status,
    operatingGrid4: snapshot.operatingGrid4,
    observationWindow: snapshot.observationWindow,
    collectedAtUtc: snapshot.collectedAtUtc,
    sourceProvenance: snapshot.provenance,
    classifiedReportCount: classifiedReports.length,
    unclassifiedReportCount: reports.filter(report => report.classificationStatus === 'unclassified').length,
    insufficientLocationCount: reports.filter(report => report.classificationStatus === 'insufficient_location').length,
    localReportCount: reports.filter(report => report.classificationStatus === 'local').length,
    reports,
    classifiedReports,
    regionBandSummaries: buildRegionBandSummaries(reports),
  };
}

export function classifyRegionalObservedRfReport(report: PskReceptionReport, operatingGrid4: string | null): RegionalObservedRfReport {
  if (report.direction === 'local') {
    return createDerivedReport(report, operatingGrid4, 'local_nvis', 'local', null, null, null, LOCAL_NVIS_DESCRIPTION);
  }

  const remoteCallsign = report.direction === 'outbound' ? report.receiverCallsign : report.senderCallsign;
  const remoteLocator = report.direction === 'outbound' ? report.receiverLocator : report.senderLocator;
  if (!remoteLocator) return createDerivedReport(report, operatingGrid4, null, 'insufficient_location', remoteCallsign, null, null, 'Remote endpoint has no usable Maidenhead locator.');

  const remoteCoordinateEstimate = gridSquareToLatLon(remoteLocator);
  if (!remoteCoordinateEstimate) return createDerivedReport(report, operatingGrid4, null, 'insufficient_location', remoteCallsign, remoteLocator, null, 'Remote endpoint locator could not be converted to a coordinate estimate.');
  const regionId = findPropagationRegionMembership(remoteCoordinateEstimate);
  if (!regionId) return createDerivedReport(report, operatingGrid4, null, 'unclassified', remoteCallsign, remoteLocator, remoteCoordinateEstimate, 'Remote locator-center estimate is outside the current canonical region catalog.');
  return createDerivedReport(report, operatingGrid4, regionId, 'classified', remoteCallsign, remoteLocator, remoteCoordinateEstimate, 'Remote endpoint classified from a Maidenhead locator-center estimate.');
}

function createDerivedReport(
  sourceReport: PskReceptionReport,
  operatingGrid4: string | null,
  regionId: PropagationRegionId | null,
  classificationStatus: RegionalObservedRfClassificationStatus,
  remoteCallsign: string | null,
  remoteLocator: string | null,
  remoteCoordinateEstimate: Coordinates | null,
  limitation: string,
): RegionalObservedRfReport {
  return {
    sourceReportId: sourceReport.reportId,
    sourceReport,
    operatingGrid4,
    direction: sourceReport.direction,
    band: sourceReport.band,
    mode: sourceReport.mode,
    snrDb: sourceReport.snrDb,
    observedAtUtc: sourceReport.observedAtUtc,
    remoteCallsign,
    remoteLocator,
    remoteCoordinateEstimate,
    coordinateBasis: remoteCoordinateEstimate ? 'maidenhead_center' : null,
    regionId,
    classificationStatus,
    provenance: {
      sourceId: sourceReport.provenance.sourceId,
      sourceName: sourceReport.provenance.sourceName,
      semantics: 'observed_digital_reception_report',
      coordinateSemantics: remoteCoordinateEstimate ? 'locator_center_estimate' : 'not_applicable',
      limitation: classificationStatus === 'local'
        ? 'Does not prove SSB usability, station-specific success, regional openness, confidence, a propagation mechanism, or a propagation rating.'
        : limitation === LOCAL_NVIS_DESCRIPTION
          ? 'Does not prove SSB usability, station-specific success, regional openness, confidence, a propagation mechanism, or a propagation rating.'
          : 'Does not prove SSB usability, station-specific success, regional openness, confidence, a propagation mechanism, or a propagation rating.',
    },
  };
}

function buildRegionBandSummaries(reports: readonly RegionalObservedRfReport[]): readonly RegionalObservedRfBandSummary[] {
  return PROPAGATION_REGION_IDS.flatMap(regionId => OBSERVED_RF_BANDS.map(band => summarizeRegionBand(reports, regionId, band)));
}

function summarizeRegionBand(
  reports: readonly RegionalObservedRfReport[],
  regionId: PropagationRegionId,
  band: PropagationGuidanceBand,
): RegionalObservedRfBandSummary {
  const items = reports.filter(report => report.regionId === regionId && report.band === band);
  const remoteCallsigns = new Set(items.filter(report => report.remoteCallsign).map(report => report.remoteCallsign!));
  const paths = new Set(items.map(report => `${report.sourceReport.senderCallsign}|${report.sourceReport.receiverCallsign}|${report.band}|${report.mode ?? ''}`));
  const modes: Record<string, number> = {};
  items.forEach(report => { const mode = report.mode ?? 'unknown'; modes[mode] = (modes[mode] ?? 0) + 1; });
  const times = items.map(report => report.observedAtUtc).sort();
  const snr = numericSummary(items.map(report => report.snrDb).filter((value): value is number => value !== null));
  const reportsWithRemoteLocator = items.filter(report => report.remoteLocator !== null).length;
  return {
    regionId,
    band,
    reportCount: items.length,
    outboundReportCount: items.filter(report => report.direction === 'outbound').length,
    inboundReportCount: items.filter(report => report.direction === 'inbound').length,
    localReportCount: items.filter(report => report.direction === 'local').length,
    uniqueRemoteCallsignCount: remoteCallsigns.size,
    uniquePathCount: paths.size,
    modeCounts: modes,
    newestReportAt: times.at(-1) ?? null,
    oldestReportAt: times[0] ?? null,
    snrDb: snr,
    locatorCoverage: { reportsWithRemoteLocator, percentage: items.length === 0 ? null : reportsWithRemoteLocator / items.length * 100 },
    classificationCoverage: { classifiedReportCount: items.filter(report => report.classificationStatus === 'classified').length, percentage: items.length === 0 ? null : items.filter(report => report.classificationStatus === 'classified').length / items.length * 100 },
  };
}

function numericSummary(values: readonly number[]): RegionalObservedRfNumericSummary {
  if (values.length === 0) return { minimum: null, maximum: null, median: null };
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    minimum: sorted[0],
    maximum: sorted.at(-1)!,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
  };
}
