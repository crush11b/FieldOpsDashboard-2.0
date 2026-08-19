import { randomUUID } from 'node:crypto';
import type { SmartDeployExecutionRequest } from '../src/planning/smartDeployPlanning';
import type { MissionEvidence } from './missionEvidence';

export const SMART_DEPLOY_BRIEF_SCHEMA_VERSION = 1 as const;

export type SmartDeployBriefStatus = 'complete' | 'partial' | 'unavailable';
export type SmartDeployBriefSectionStatus = 'available' | 'derived' | 'complete' | 'partial' | 'unavailable' | 'stale' | 'observed' | 'notTemporallyApplicable';

export interface SmartDeployBriefMissionSnapshot {
  readonly activationTarget: SmartDeployExecutionRequest['activationTarget'];
  readonly operatingLocation: SmartDeployExecutionRequest['operatingLocation'];
  readonly missionWindow: SmartDeployExecutionRequest['missionWindow'];
  readonly equipment: SmartDeployExecutionRequest['equipment'];
  readonly objective?: string;
}

export interface SmartDeployBriefLimitation {
  readonly code: string;
  readonly message: string;
}

export interface SmartDeployBriefSections {
  readonly mission: { readonly status: 'available'; readonly snapshot: SmartDeployBriefMissionSnapshot };
  readonly geometry: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['geometry'] };
  readonly solar: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['solar'] };
  readonly propagation: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['propagation'] };
  readonly observedRf: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['observedRf'] };
}

export interface SmartDeployBrief {
  readonly schemaVersion: typeof SMART_DEPLOY_BRIEF_SCHEMA_VERSION;
  readonly briefId: string;
  readonly generatedAtUtc: string;
  readonly status: SmartDeployBriefStatus;
  readonly mission: SmartDeployBriefMissionSnapshot;
  readonly sections: SmartDeployBriefSections;
  readonly limitations: readonly SmartDeployBriefLimitation[];
  readonly summary: string;
}

export interface GenerateSmartDeployBriefRequest {
  readonly planningRequest: SmartDeployExecutionRequest;
  readonly missionEvidence: MissionEvidence;
}

export interface GenerateSmartDeployBriefOptions {
  readonly now?: () => Date;
  readonly createBriefId?: () => string;
}

export function generateSmartDeployBrief(
  request: GenerateSmartDeployBriefRequest,
  options: GenerateSmartDeployBriefOptions = {},
): SmartDeployBrief {
  const generatedAtUtc = (options.now ?? (() => new Date()))().toISOString();
  const briefId = (options.createBriefId ?? randomUUID)();
  const mission = snapshotMission(request.planningRequest);
  const sections = buildSections(mission, request.missionEvidence);
  const limitations = buildLimitations(sections, request.missionEvidence);
  const status = determineOverallStatus(sections);
  return {
    schemaVersion: SMART_DEPLOY_BRIEF_SCHEMA_VERSION,
    briefId,
    generatedAtUtc,
    status,
    mission,
    sections,
    limitations,
    summary: buildSummary(mission, sections, limitations),
  };
}

function snapshotMission(planning: SmartDeployExecutionRequest): SmartDeployBriefMissionSnapshot {
  return {
    activationTarget: { ...planning.activationTarget },
    operatingLocation: { ...planning.operatingLocation },
    missionWindow: { ...planning.missionWindow },
    equipment: {
      ...planning.equipment,
      radio: { ...planning.equipment.radio },
      antenna: { ...planning.equipment.antenna },
      modes: [...planning.equipment.modes],
      ...(planning.equipment.deployment ? { deployment: { ...planning.equipment.deployment } } : {}),
    },
    ...(planning.objective !== undefined ? { objective: planning.objective } : {}),
  };
}

function buildSections(mission: SmartDeployBriefMissionSnapshot, evidence: MissionEvidence): SmartDeployBriefSections {
  return {
    mission: { status: 'available', snapshot: mission },
    geometry: { status: evidence.geometry.status, evidence: evidence.geometry },
    solar: { status: evidence.solar.status, evidence: evidence.solar },
    propagation: { status: evidence.propagation.status, evidence: evidence.propagation },
    observedRf: { status: evidence.observedRf.status, evidence: evidence.observedRf },
  };
}

function determineOverallStatus(sections: SmartDeployBriefSections): SmartDeployBriefStatus {
  if (sections.mission.status !== 'available' || sections.geometry.status === 'unavailable') return 'unavailable';
  if (sections.solar.status !== 'derived'
    || sections.propagation.status !== 'complete'
    || (sections.observedRf.status !== 'observed' && sections.observedRf.status !== 'notTemporallyApplicable')) return 'partial';
  return 'complete';
}

function buildLimitations(sections: SmartDeployBriefSections, evidence: MissionEvidence): readonly SmartDeployBriefLimitation[] {
  const limitations: SmartDeployBriefLimitation[] = [];
  const add = (code: string, message: string) => {
    if (!limitations.some(limitation => limitation.code === code && limitation.message === message)) limitations.push({ code, message });
  };
  if (sections.geometry.status === 'unavailable') add('geometry_unavailable', 'Mission geometry is unavailable.');
  if (sections.solar.status === 'unavailable') add('solar_unavailable', 'Solar evidence is unavailable.');
  if (sections.propagation.status === 'partial') add('propagation_partial', 'Propagation evidence is partial across the mission window.');
  if (sections.propagation.status === 'unavailable') add('propagation_unavailable', 'Propagation modeling is unavailable across the mission window.');
  if (sections.observedRf.status === 'stale') add('observed_rf_stale', 'Observed RF is stale context.');
  if (sections.observedRf.status === 'unavailable') add('observed_rf_unavailable', 'Observed RF is unavailable or does not match the operating grid.');
  if (sections.observedRf.status === 'notTemporallyApplicable') add('observed_rf_not_temporally_applicable', 'Observed RF is not temporally applicable to this mission window.');
  const selectedModes = evidence.propagation.samples[0]?.modes ?? evidence.planningRequest.equipment.modes;
  const modeledMode = evidence.propagation.samples[0]?.stationProfile.mode;
  if (modeledMode && selectedModes.length > 1) add('single_mode_modeled', `Only ${modeledMode} was modeled; selected modes were ${selectedModes.join(', ')}.`);
  for (const message of evidence.propagation.summary.limitations) add('propagation_evidence_limitation', message);
  for (const message of evidence.limitations) add('mission_evidence_limitation', message);
  return limitations;
}

function buildSummary(
  mission: SmartDeployBriefMissionSnapshot,
  sections: SmartDeployBriefSections,
  limitations: readonly SmartDeployBriefLimitation[],
): string {
  const lines = [
    `Activate ${mission.activationTarget.program} ${mission.activationTarget.reference}${mission.activationTarget.displayName ? ` (${mission.activationTarget.displayName})` : ''}.`,
    `Mission window: ${mission.missionWindow.start} to ${mission.missionWindow.end} UTC.`,
    `Operating from ${formatLocation(mission.operatingLocation)} with ${mission.equipment.radio.name}, ${mission.equipment.modes.join(' / ')}, and ${mission.equipment.transmitPowerWatts} W intended transmit power.`,
    geometrySummary(sections.geometry),
    propagationSummary(sections.propagation),
    solarSummary(sections.solar),
    observedRfSummary(sections.observedRf),
  ];
  if (limitations.length > 0) lines.push(`Limitations: ${limitations.map(limitation => limitation.message).join(' ')}`);
  return lines.join(' ');
}

function formatLocation(location: SmartDeployBriefMissionSnapshot['operatingLocation']): string {
  if (location.gridSquare) return `grid ${location.gridSquare}`;
  if (location.coordinates) return `${location.coordinates.lat.toFixed(4)}, ${location.coordinates.lon.toFixed(4)}`;
  return 'an unavailable operating location';
}

function geometrySummary(section: SmartDeployBriefSections['geometry']): string {
  const geometry = section.evidence;
  if (section.status === 'unavailable' || geometry.distanceKm === null) return 'Mission geometry is unavailable.';
  const bearing = geometry.initialBearingDegrees === null ? 'no bearing' : `${geometry.initialBearingDegrees.toFixed(1)}° ${geometry.compassDirection ?? ''}`.trim();
  return `The activation site is ${geometry.distanceKm.toFixed(1)} km from the operating location on an initial bearing of ${bearing}.`;
}

function propagationSummary(section: SmartDeployBriefSections['propagation']): string {
  const propagation = section.evidence;
  const successful = propagation.summary.successfulSampleCount;
  if (propagation.status === 'unavailable' || successful === 0) return 'Modeled propagation is unavailable across the mission window.';
  const strongest = propagation.summary.strongestBandBySample;
  const availableStrongest = strongest.filter(sample => sample.band !== null);
  const mode = propagation.samples[0]?.stationProfile.mode;
  const modeText = mode ? ` using modeled mode ${mode}` : '';
  if (propagation.status === 'partial') return `Modeled propagation is partial: ${successful} of ${propagation.samples.length} mission samples are available${modeText}.`;
  if (propagation.summary.consistentStrongestBand) return `${propagation.summary.consistentStrongestBand} is the strongest modeled band at all three sampled mission times${modeText}.`;
  if (availableStrongest.length > 0) {
    const labels = strongest.map(sample => `${sample.position}: ${sample.band ?? 'unavailable'}`).join('; ');
    return `The strongest modeled band changes across the sampled mission times${modeText}: ${labels}.`;
  }
  return `Modeled propagation is available, but no strongest band could be determined${modeText}.`;
}

function solarSummary(section: SmartDeployBriefSections['solar']): string {
  if (section.status === 'unavailable') return 'Solar evidence is unavailable.';
  const overlap = section.evidence.overlap;
  const facts: string[] = [];
  if (overlap.entirelyDuringDaylight) facts.push('the mission occurs entirely during daylight');
  else if (overlap.entirelyDuringDarkness) facts.push('the mission occurs entirely during darkness');
  else if (overlap.includesDaylight) facts.push('the mission includes daylight');
  if (overlap.overlapsCivilTwilight) facts.push('the mission overlaps civil twilight');
  if (overlap.extendsBeyondCivilDusk) facts.push('the mission extends beyond civil dusk');
  return facts.length > 0 ? `At the activation site, ${facts.join(' and ')}.` : 'The mission does not overlap a derived daylight or civil-twilight interval.';
}

function observedRfSummary(section: SmartDeployBriefSections['observedRf']): string {
  if (section.status === 'observed') return `Recent observed RF evidence is available for operating grid ${section.evidence.observedOperatingGrid4 ?? 'unavailable'} during ${section.evidence.observationWindow.startsAt} to ${section.evidence.observationWindow.endsAt}.`;
  if (section.status === 'notTemporallyApplicable') return 'Observed RF is not temporally applicable to this mission window.';
  if (section.status === 'stale') return 'Observed RF is stale context.';
  return 'Observed RF is unavailable.';
}