import { calculateDistanceKm, calculateInitialBearing, compassDirection } from '../src/location/geography';
import { calculateSolarEvents, type SolarEventName, type SolarEvents } from '../src/location/solarEvents';
import { latLonGrid4 } from '../src/propagation/observedRf';
import type { ObservedRfSnapshot } from '../src/propagation/observedRf';
import type { SmartDeployExecutionRequest } from '../src/planning/smartDeployPlanning';
import type { MissionWindowPropagationResult } from './missionWindowPropagation';

export const MISSION_OBSERVED_RF_APPLICABILITY_WINDOW_MS = 15 * 60 * 1000;

export type MissionEvidenceStatus = 'complete' | 'unavailable';
export type MissionGeometryStatus = 'derived' | 'unavailable';
export type MissionSolarStatus = 'derived' | 'unavailable';
export type MissionObservedRfStatus = 'observed' | 'unavailable' | 'stale' | 'notTemporallyApplicable';

export interface MissionGeometryEvidence {
  readonly status: MissionGeometryStatus;
  readonly originCoordinates: SmartDeployExecutionRequest['operatingLocation']['coordinates'];
  readonly destinationCoordinates: SmartDeployExecutionRequest['activationTarget']['coordinates'];
  readonly distanceKm: number | null;
  readonly initialBearingDegrees: number | null;
  readonly compassDirection: string | null;
  readonly semantics: 'great_circle_distance_and_initial_bearing';
  readonly limitation?: string;
}

export interface MissionSolarDayEvidence {
  readonly date: string;
  readonly events: Readonly<Record<SolarEventName, string | null>>;
}

export interface MissionSolarOverlapEvidence {
  readonly beginsBeforeCivilDawn: boolean | null;
  readonly includesDaylight: boolean | null;
  readonly overlapsCivilTwilight: boolean | null;
  readonly extendsBeyondCivilDusk: boolean | null;
  readonly entirelyDuringDaylight: boolean | null;
  readonly entirelyDuringDarkness: boolean | null;
}

export interface MissionSolarEvidence {
  readonly status: MissionSolarStatus;
  readonly site: 'activation_target';
  readonly siteCoordinates: SmartDeployExecutionRequest['activationTarget']['coordinates'];
  readonly missionDatesUtc: readonly string[];
  readonly days: readonly MissionSolarDayEvidence[];
  readonly overlap: MissionSolarOverlapEvidence;
  readonly limitation?: string;
}

export interface MissionObservedRfEvidence {
  readonly status: MissionObservedRfStatus;
  readonly sourceStatus: ObservedRfSnapshot['status'];
  readonly evidenceStatus: ObservedRfSnapshot['evidenceStatus'];
  readonly expectedOperatingGrid4: string | null;
  readonly observedOperatingGrid4: string | null;
  readonly observationWindow: ObservedRfSnapshot['observationWindow'];
  readonly collectedAtUtc: string;
  readonly reports: ObservedRfSnapshot['reports'];
  readonly bandSummaries: ObservedRfSnapshot['bandSummaries'];
  readonly provenance: ObservedRfSnapshot['provenance'];
  readonly applicabilityRule: 'mission interval overlaps observation window or starts within 15 minutes after its endpoint';
  readonly limitation?: string;
}

export interface MissionEvidence {
  readonly status: MissionEvidenceStatus;
  readonly planningRequest: SmartDeployExecutionRequest;
  readonly propagation: MissionWindowPropagationResult;
  readonly geometry: MissionGeometryEvidence;
  readonly solar: MissionSolarEvidence;
  readonly observedRf: MissionObservedRfEvidence;
  readonly generatedAtUtc: string;
  readonly limitations: readonly string[];
}

export interface ComposeMissionEvidenceRequest {
  readonly planningRequest: SmartDeployExecutionRequest;
  readonly propagation: MissionWindowPropagationResult;
  readonly observedRf: ObservedRfSnapshot | null;
}

export type MissionSolarCalculator = typeof calculateSolarEvents;

export function composeMissionEvidence(
  request: ComposeMissionEvidenceRequest,
  now: () => Date = () => new Date(),
  solarCalculator: MissionSolarCalculator = calculateSolarEvents,
): MissionEvidence {
  const generatedAtUtc = now().toISOString();
  const geometry = deriveGeometry(request.planningRequest);
  const solar = deriveSolar(request.planningRequest, solarCalculator);
  const observedRf = deriveObservedRf(request.planningRequest, request.observedRf);
  const limitations = [
    ...(geometry.limitation ? [geometry.limitation] : []),
    ...(solar.limitation ? [solar.limitation] : []),
    ...(observedRf.limitation ? [observedRf.limitation] : []),
    ...request.propagation.summary.limitations,
  ];
  return {
    status: geometry.status === 'derived' ? 'complete' : 'unavailable',
    planningRequest: request.planningRequest,
    propagation: request.propagation,
    geometry,
    solar,
    observedRf,
    generatedAtUtc,
    limitations: [...new Set(limitations)],
  };
}

function deriveGeometry(planning: SmartDeployExecutionRequest): MissionGeometryEvidence {
  const origin = planning.operatingLocation.coordinates;
  const destination = planning.activationTarget.coordinates;
  if (!origin || !destination || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon) || !Number.isFinite(destination.lat) || !Number.isFinite(destination.lon)) {
    return {
      status: 'unavailable', originCoordinates: origin, destinationCoordinates: destination, distanceKm: null, initialBearingDegrees: null,
      compassDirection: null, semantics: 'great_circle_distance_and_initial_bearing', limitation: 'Mission geometry is unavailable because one or both coordinate sets are unavailable.',
    };
  }
  const initialBearingDegrees = calculateInitialBearing(origin, destination);
  return {
    status: 'derived',
    originCoordinates: origin,
    destinationCoordinates: destination,
    distanceKm: calculateDistanceKm(origin, destination),
    initialBearingDegrees,
    compassDirection: compassDirection(initialBearingDegrees),
    semantics: 'great_circle_distance_and_initial_bearing',
  };
}

function deriveSolar(planning: SmartDeployExecutionRequest, solarCalculator: MissionSolarCalculator): MissionSolarEvidence {
  const siteCoordinates = planning.activationTarget.coordinates;
  const missionDatesUtc = missionDates(planning.missionWindow.start, planning.missionWindow.end);
  const calculated = missionDatesUtc.map(date => solarCalculator(siteCoordinates, date));
  const days = calculated.map((events, index) => toSolarDayEvidence(missionDatesUtc[index], events));
  if (calculated.some(events => events === null)) {
    return {
      status: 'unavailable', site: 'activation_target', siteCoordinates, missionDatesUtc, days,
      overlap: unavailableSolarOverlap(), limitation: 'Solar events are unavailable for one or more mission dates.',
    };
  }
  const events = calculated.filter((value): value is SolarEvents => value !== null);
  return {
    status: 'derived',
    site: 'activation_target',
    siteCoordinates,
    missionDatesUtc,
    days,
    overlap: deriveSolarOverlap(planning.missionWindow.start, planning.missionWindow.end, events),
  };
}

function deriveObservedRf(planning: SmartDeployExecutionRequest, snapshot: ObservedRfSnapshot | null): MissionObservedRfEvidence {
  const expectedOperatingGrid4 = planning.operatingLocation.coordinates
    ? latLonGrid4(planning.operatingLocation.coordinates.lat, planning.operatingLocation.coordinates.lon)
    : null;
  if (!snapshot) {
    return {
      status: 'unavailable',
      sourceStatus: 'unavailable',
      evidenceStatus: 'unavailable',
      expectedOperatingGrid4,
      observedOperatingGrid4: null,
      observationWindow: { startsAt: '', endsAt: '' },
      collectedAtUtc: '',
      reports: [],
      bandSummaries: [],
      provenance: {
        sourceId: 'pskreporter-via-mqtt',
        sourceName: 'PSKReporter reports via mqtt.pskreporter.info',
        transport: 'mqtts-websocket',
        brokerHost: 'mqtt.pskreporter.info',
        brokerPort: 1886,
        topicPatterns: [],
      },
      applicabilityRule: 'mission interval overlaps observation window or starts within 15 minutes after its endpoint',
      limitation: 'Observed-RF snapshot is unavailable.',
    };
  }
  const base = snapshot;
  const common = {
    sourceStatus: base.status,
    evidenceStatus: base.evidenceStatus,
    expectedOperatingGrid4,
    observedOperatingGrid4: base.operatingGrid4,
    observationWindow: base.observationWindow,
    collectedAtUtc: base.collectedAtUtc,
    reports: base.reports,
    bandSummaries: base.bandSummaries,
    provenance: base.provenance,
    applicabilityRule: 'mission interval overlaps observation window or starts within 15 minutes after its endpoint' as const,
  };
  if (!snapshot) return { ...common, status: 'unavailable', limitation: 'Observed-RF snapshot is unavailable.' };
  if (!expectedOperatingGrid4 || snapshot.operatingGrid4 !== expectedOperatingGrid4) {
    return { ...common, status: 'unavailable', limitation: 'Observed-RF evidence does not match the mission operating grid.' };
  }
  if (snapshot.status === 'stale') return { ...common, status: 'stale', limitation: 'Observed-RF evidence is retained from an expired cache window.' };
  if (snapshot.status !== 'live' && snapshot.status !== 'cached') {
    return { ...common, status: 'unavailable', limitation: 'Observed-RF source is not currently available.' };
  }
  if (!missionOverlapsObservedWindow(planning.missionWindow.start, planning.missionWindow.end, snapshot.observationWindow)) {
    return { ...common, status: 'notTemporallyApplicable', limitation: 'Observed-RF evidence is outside the defined mission-window applicability interval.' };
  }
  return { ...common, status: 'observed' };
}

function missionDates(start: string, end: string): readonly string[] {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dates: string[] = [];
  for (let timestamp = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()); timestamp <= endDate.getTime(); timestamp += 86_400_000) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return dates;
}

function toSolarDayEvidence(date: string, events: SolarEvents | null): MissionSolarDayEvidence {
  return {
    date,
    events: Object.fromEntries((Object.keys({ astronomicalDawn: null, nauticalDawn: null, civilDawn: null, sunrise: null, sunset: null, civilDusk: null, nauticalDusk: null, astronomicalDusk: null }) as SolarEventName[]).map(name => [name, events?.events[name]?.toISOString() ?? null])) as Readonly<Record<SolarEventName, string | null>>,
  };
}

function deriveSolarOverlap(start: string, end: string, solarDays: readonly SolarEvents[]): MissionSolarOverlapEvidence {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const daylightIntervals = solarDays.flatMap(day => day.events.sunrise && day.events.sunset ? [[day.events.sunrise.getTime(), day.events.sunset.getTime()] as const] : []);
  const twilightIntervals = solarDays.flatMap(day => [
    day.events.civilDawn && day.events.sunrise ? [day.events.civilDawn.getTime(), day.events.sunrise.getTime()] as const : null,
    day.events.sunset && day.events.civilDusk ? [day.events.sunset.getTime(), day.events.civilDusk.getTime()] as const : null,
  ].filter((value): value is readonly [number, number] => value !== null));
  const daylightDuration = daylightIntervals.reduce((total, interval) => total + overlapDuration(startMs, endMs, interval[0], interval[1]), 0);
  const twilightOverlap = twilightIntervals.some(interval => overlapDuration(startMs, endMs, interval[0], interval[1]) > 0);
  const firstDay = solarDays[0];
  const lastDay = solarDays.at(-1)!;
  return {
    beginsBeforeCivilDawn: firstDay.events.civilDawn ? startMs < firstDay.events.civilDawn.getTime() : null,
    includesDaylight: daylightIntervals.length > 0 ? daylightDuration > 0 : null,
    overlapsCivilTwilight: twilightIntervals.length > 0 ? twilightOverlap : null,
    extendsBeyondCivilDusk: lastDay.events.civilDusk ? endMs > lastDay.events.civilDusk.getTime() : null,
    entirelyDuringDaylight: daylightIntervals.length > 0 ? daylightDuration >= endMs - startMs : null,
    entirelyDuringDarkness: daylightIntervals.length > 0 ? daylightDuration === 0 : null,
  };
}

function overlapDuration(start: number, end: number, intervalStart: number, intervalEnd: number): number {
  return Math.max(0, Math.min(end, intervalEnd) - Math.max(start, intervalStart));
}

function unavailableSolarOverlap(): MissionSolarOverlapEvidence {
  return { beginsBeforeCivilDawn: null, includesDaylight: null, overlapsCivilTwilight: null, extendsBeyondCivilDusk: null, entirelyDuringDaylight: null, entirelyDuringDarkness: null };
}

function missionOverlapsObservedWindow(start: string, end: string, window: ObservedRfSnapshot['observationWindow']): boolean {
  const missionStart = Date.parse(start);
  const missionEnd = Date.parse(end);
  const observationStart = Date.parse(window.startsAt);
  const observationEnd = Date.parse(window.endsAt);
  return missionStart <= observationEnd + MISSION_OBSERVED_RF_APPLICABILITY_WINDOW_MS && missionEnd >= observationStart;
}
