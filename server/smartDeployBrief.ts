import { randomUUID } from 'node:crypto';
import type { SmartDeployExecutionRequest } from '../src/planning/smartDeployPlanning';
import { getPropagationRegion } from '../src/propagation/regionalDestinations';
import type { MissionEvidence } from './missionEvidence';

export const SMART_DEPLOY_BRIEF_SCHEMA_VERSION = 2 as const;
export const SMART_DEPLOY_BRIEF_V1_SCHEMA_VERSION = 1 as const;

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

export interface SmartDeployBriefV1 {
  readonly schemaVersion: 1;
  readonly briefId: string;
  readonly generatedAtUtc: string;
  readonly status: SmartDeployBriefStatus;
  readonly mission: SmartDeployBriefMissionSnapshot;
  readonly sections: {
    readonly mission: { readonly status: 'available'; readonly snapshot: SmartDeployBriefMissionSnapshot };
    readonly geometry: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['geometry'] };
    readonly solar: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['solar'] };
    readonly propagation: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['propagation'] };
    readonly observedRf: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['observedRf'] };
  };
  readonly limitations: readonly SmartDeployBriefLimitation[];
  readonly summary: string;
}

export interface SmartDeployBriefV2Activation {
  readonly program: string;
  readonly reference: string;
  readonly displayName?: string;
  readonly coordinates: SmartDeployExecutionRequest['activationTarget']['coordinates'];
  readonly gridSquare?: string;
  readonly provenance: SmartDeployExecutionRequest['activationTarget']['provenance'];
}

export interface SmartDeployBriefV2PlannedOperatingSite {
  readonly location: SmartDeployExecutionRequest['plannedOperatingLocation'];
  readonly source: 'provider_reference_default' | 'operator_selected_current_device' | 'operator_planned_override';
  readonly description: string;
}

export interface SmartDeployBriefV2PropagationObjective {
  readonly kind: SmartDeployExecutionRequest['propagationObjective']['kind'];
  readonly regionId: SmartDeployExecutionRequest['propagationObjective']['regionId'];
  readonly regionLabel: string;
}

export interface SmartDeployBriefV2MissionWindow {
  readonly start: string;
  readonly midpoint: string;
  readonly end: string;
}

export interface SmartDeployBriefV2Station {
  readonly radio: SmartDeployExecutionRequest['equipment']['radio'];
  readonly antenna: SmartDeployExecutionRequest['equipment']['antenna'];
  readonly selectedModes: SmartDeployExecutionRequest['equipment']['modes'];
  readonly modeledMode: MissionEvidence['propagation']['samples'][number]['stationProfile']['mode'] | null;
  readonly transmitPowerWatts: number;
  readonly deployment?: SmartDeployExecutionRequest['equipment']['deployment'];
}

export interface SmartDeployBriefV2Sections {
  readonly activation: { readonly status: 'available'; readonly evidence: SmartDeployBriefV2Activation };
  readonly plannedOperatingSite: { readonly status: 'derived' | 'unavailable'; readonly evidence: SmartDeployBriefV2PlannedOperatingSite };
  readonly currentDevice: { readonly status: 'available'; readonly evidence: SmartDeployExecutionRequest['currentDeviceLocation'] };
  readonly propagationObjective: { readonly status: 'available'; readonly evidence: SmartDeployBriefV2PropagationObjective };
  readonly missionWindow: { readonly status: 'available'; readonly evidence: SmartDeployBriefV2MissionWindow };
  readonly station: { readonly status: 'available'; readonly evidence: SmartDeployBriefV2Station };
  readonly propagation: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['propagation'] };
  readonly solar: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['solar'] };
  readonly observedRf: { readonly status: SmartDeployBriefSectionStatus; readonly evidence: MissionEvidence['observedRf'] };
}

export interface SmartDeployBriefV2 {
  readonly schemaVersion: 2;
  readonly briefId: string;
  readonly generatedAtUtc: string;
  readonly status: SmartDeployBriefStatus;
  readonly activation: SmartDeployBriefV2Activation;
  readonly plannedOperatingSite: SmartDeployBriefV2PlannedOperatingSite;
  readonly currentDeviceLocation?: SmartDeployExecutionRequest['currentDeviceLocation'];
  readonly propagationObjective: SmartDeployBriefV2PropagationObjective;
  readonly missionWindow: SmartDeployBriefV2MissionWindow;
  readonly station: SmartDeployBriefV2Station;
  readonly objective?: string;
  readonly sections: SmartDeployBriefV2Sections;
  readonly limitations: readonly SmartDeployBriefLimitation[];
  readonly summary: string;
}

export type SmartDeployBrief = SmartDeployBriefV1 | SmartDeployBriefV2;

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
): SmartDeployBriefV2 {
  const generatedAtUtc = (options.now ?? (() => new Date()))().toISOString();
  const briefId = (options.createBriefId ?? randomUUID)();
  const planning = request.planningRequest;
  const region = getPropagationRegion(planning.propagationObjective.regionId);
  const activation: SmartDeployBriefV2Activation = { ...planning.activationTarget };
  const plannedOperatingSite = plannedSiteSnapshot(planning);
  const propagationObjective: SmartDeployBriefV2PropagationObjective = {
    ...planning.propagationObjective,
    regionLabel: region?.label ?? planning.propagationObjective.regionId,
  };
  const missionWindow = missionWindowSnapshot(planning.missionWindow);
  const station: SmartDeployBriefV2Station = {
    radio: { ...planning.equipment.radio },
    antenna: { ...planning.equipment.antenna },
    selectedModes: [...planning.equipment.modes],
    modeledMode: request.missionEvidence.propagation.samples[0]?.stationProfile.mode ?? null,
    transmitPowerWatts: planning.equipment.transmitPowerWatts,
    ...(planning.equipment.deployment ? { deployment: { ...planning.equipment.deployment } } : {}),
  };
  const sections: SmartDeployBriefV2Sections = {
    activation: { status: 'available', evidence: activation },
    plannedOperatingSite: { status: request.missionEvidence.geometry.status, evidence: plannedOperatingSite },
    currentDevice: { status: 'available', evidence: planning.currentDeviceLocation },
    propagationObjective: { status: 'available', evidence: propagationObjective },
    missionWindow: { status: 'available', evidence: missionWindow },
    station: { status: 'available', evidence: station },
    propagation: { status: request.missionEvidence.propagation.status, evidence: request.missionEvidence.propagation },
    solar: { status: request.missionEvidence.solar.status, evidence: request.missionEvidence.solar },
    observedRf: { status: request.missionEvidence.observedRf.status, evidence: request.missionEvidence.observedRf },
  };
  const limitations = buildV2Limitations(planning, request.missionEvidence);
  return {
    schemaVersion: 2,
    briefId,
    generatedAtUtc,
    status: determineV2Status(request.missionEvidence),
    activation,
    plannedOperatingSite,
    ...(planning.currentDeviceLocation ? { currentDeviceLocation: planning.currentDeviceLocation } : {}),
    propagationObjective,
    missionWindow,
    station,
    ...(planning.objective !== undefined ? { objective: planning.objective } : {}),
    sections,
    limitations,
    summary: buildV2Summary(activation, plannedOperatingSite, propagationObjective, missionWindow, station, sections, limitations),
  };
}

function plannedSiteSnapshot(planning: SmartDeployExecutionRequest): SmartDeployBriefV2PlannedOperatingSite {
  const source = planning.plannedOperatingLocation.planningSemantics ?? 'operator_planned_override';
  const description = source === 'provider_reference_default'
    ? 'POTA reference location - approximate planning point'
    : source === 'operator_selected_current_device'
      ? 'Current device location selected by operator'
      : 'Operator-planned location';
  return { location: planning.plannedOperatingLocation, source, description };
}

function missionWindowSnapshot(window: SmartDeployExecutionRequest['missionWindow']): SmartDeployBriefV2MissionWindow {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  return { start: new Date(start).toISOString(), midpoint: new Date(start + Math.floor((end - start) / 2)).toISOString(), end: new Date(end).toISOString() };
}

function determineV2Status(evidence: MissionEvidence): SmartDeployBriefStatus {
  if (evidence.geometry.status === 'unavailable') return 'unavailable';
  if (evidence.propagation.status !== 'complete' || evidence.solar.status !== 'derived' || evidence.observedRf.status === 'stale' || evidence.observedRf.status === 'unavailable') return 'partial';
  return 'complete';
}

function buildV2Limitations(planning: SmartDeployExecutionRequest, evidence: MissionEvidence): readonly SmartDeployBriefLimitation[] {
  const limitations: SmartDeployBriefLimitation[] = [];
  const add = (code: string, message: string) => {
    if (!limitations.some(limitation => limitation.code === code || limitation.message === message)) limitations.push({ code, message });
  };
  if (planning.plannedOperatingLocation.planningSemantics === 'provider_reference_default') add('planned_site_reference_coordinate', 'The planned site uses the provider reference coordinate and may not be the exact station setup point.');
  if (evidence.propagation.status !== 'complete') add(`propagation_${evidence.propagation.status}`, evidence.propagation.status === 'partial' ? 'Band outlook is partial across the mission samples.' : 'Band outlook is unavailable across the mission samples.');
  if (evidence.solar.status === 'unavailable') add('solar_unavailable', 'Solar and twilight evidence is unavailable for the planned site.');
  if (evidence.observedRf.status === 'notTemporallyApplicable') add('observed_rf_not_temporally_applicable', 'Live band activity is too early to apply to this mission.');
  if (evidence.observedRf.status === 'stale') add('observed_rf_stale', 'Live band activity is available but stale.');
  if (evidence.observedRf.status === 'unavailable') add('observed_rf_unavailable', 'Live band activity is unavailable.');
  if (evidence.propagation.samples[0]?.modes.length && evidence.propagation.samples[0].modes.length > 1 && evidence.propagation.samples[0].stationProfile.mode) add('mode_selected_vs_modeled', `Propagation modeled with ${evidence.propagation.samples[0].stationProfile.mode}; selected modes were ${evidence.propagation.samples[0].modes.join(', ')}.`);
  add('model_no_forecast', 'Uses a general solar-cycle model value; mission-time space-weather forecast is not included.');
  for (const message of evidence.limitations) {
    if (!message.includes('long-lived smoothed monthly SSN') && !message.includes('mission-window space-weather forecasting')) add('evidence_limitation', message);
  }
  return limitations;
}

function buildV2Summary(
  activation: SmartDeployBriefV2Activation,
  plannedSite: SmartDeployBriefV2PlannedOperatingSite,
  objective: SmartDeployBriefV2PropagationObjective,
  window: SmartDeployBriefV2MissionWindow,
  station: SmartDeployBriefV2Station,
  sections: SmartDeployBriefV2Sections,
  limitations: readonly SmartDeployBriefLimitation[],
): string {
  const bands = sections.propagation.evidence.summary.strongestBandBySample.map(sample => `${sample.position}: ${sample.band ?? 'unavailable'}`).join('; ');
  const notes = limitations.length ? ` ${limitations.map(limitation => limitation.message).join(' ')}` : '';
  const sampleStatus = sections.propagation.evidence.summary.successfulSampleCount === 0
    ? 'Modeled propagation is unavailable.'
    : sections.propagation.evidence.summary.successfulSampleCount < sections.propagation.evidence.samples.length
      ? `Band outlook is partial: ${sections.propagation.evidence.summary.successfulSampleCount} of ${sections.propagation.evidence.samples.length} mission samples are available.`
      : '';
  return `SmartDeploy plan: ${activation.reference}${activation.displayName ? ` - ${activation.displayName}` : ''}. Mission ${window.start} to ${window.end} UTC from ${plannedSite.description}. RF target: ${objective.regionLabel}. ${sampleStatus} Strongest modeled bands: ${bands || 'unavailable'}; modeled mode: ${station.modeledMode ?? 'unavailable'}.${notes}`;
}
